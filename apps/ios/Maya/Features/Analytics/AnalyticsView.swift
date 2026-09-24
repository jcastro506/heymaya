import Charts
import SwiftUI

/// Your numbers, honestly: per platform, only what TikTok and Instagram actually give us
/// (via your connected accounts, or the public counts), each labelled with where it came from.
struct AnalyticsView: View {
  @State private var data = Live<Analytics?>("ui:analytics")
  @State private var platform = "all"

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 26) {
        switch data.state {
        case .loading: SkeletonRows(count: 4)
        case .failed(let m): ErrorNote(message: m)
        case .value(nil): NoAccountNote()
        case .value(let a?): content(a)
        }
      }
      .padding(20)
      .padding(.bottom, 100)
    }
    .background(Palette.ground.ignoresSafeArea())
    .navigationTitle("Your numbers")
    .navigationBarTitleDisplayMode(.large)
    .navigationDestination(for: AnalyticsPost.self) { PostNumbersView(post: $0) }
    .task { await data.run() }
  }

  @ViewBuilder
  private func content(_ a: Analytics) -> some View {
    VStack(spacing: 12) {
      ForEach(a.accounts) { AccountCard(account: $0) }
    }

    if a.accounts.count > 1 {
      Picker("Platform", selection: $platform) {
        Text("All").tag("all")
        ForEach(a.accounts) { Text($0.platform == "instagram" ? "Instagram" : "TikTok").tag($0.platform) }
      }
      .pickerStyle(.segmented)
    }

    let posts = a.posts.filter { platform == "all" || $0.platform == platform }
    if posts.isEmpty {
      EmptyNote(text: "No posts read yet. They show up here after her next read of your account.")
    } else {
      VStack(alignment: .leading, spacing: 12) {
        SectionHeader(text: "Recent posts")
        if posts.contains(where: { $0.multiple != nil }) {
          PostsChart(posts: posts)
        } else {
          EmptyNote(text: "She needs a few more posts on this account to know your normal. Until then each post shows its own numbers.")
        }
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
          ForEach(posts) { p in
            NavigationLink(value: p) { AnalyticsTile(post: p) }.buttonStyle(PressableStyle())
          }
        }
      }
    }

    Text("Numbers come from your connected accounts where you've connected them, and the public counts otherwise. Each one says which.")
      .font(MayaFont.caption).foregroundStyle(Palette.muted)
  }
}

struct AccountCard: View {
  let account: AnalyticsAccount
  var body: some View {
    HStack(alignment: .center, spacing: 14) {
      VStack(alignment: .leading, spacing: 6) {
        PlatformBadge(platform: account.platform)
        Text(account.handle.map { "@\($0)" } ?? "Your account").font(MayaFont.headline).foregroundStyle(Palette.ink)
        Text(account.connected ? "Connected" : account.needsReconnect ? "Needs reconnecting" : "Public numbers only")
          .font(MayaFont.caption).foregroundStyle(account.connected ? Palette.ok : Palette.warn)
      }
      Spacer()
      VStack(alignment: .trailing, spacing: 4) {
        if let f = account.followers {
          Text(Format.count(f)).font(.title2.weight(.bold).monospacedDigit()).foregroundStyle(Palette.ink)
          Text("followers").font(MayaFont.caption).foregroundStyle(Palette.muted)
          if let past = account.followers30dAgo {
            let delta = f - past
            Text("\(delta >= 0 ? "+" : "")\(Format.count(delta)) in 30 days")
              .font(.caption.weight(.semibold).monospacedDigit())
              .foregroundStyle(delta >= 0 ? Palette.ok : Palette.err)
          }
        } else {
          Text("—").font(.title2.weight(.bold)).foregroundStyle(Palette.muted)
          Text(account.connected ? "followers syncing" : "connect for followers").font(MayaFont.caption).foregroundStyle(Palette.muted)
        }
      }
    }
    .padding(16)
    .background(Palette.panel, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(Palette.line))
  }
}

/// Each post against your normal (1×), so one viral post doesn't flatten the rest. Capped at
/// 5× with the real multiple labelled on top; posts without a multiple are left out, not faked.
struct PostsChart: View {
  let posts: [AnalyticsPost]
  private let cap = 5.0

  var body: some View {
    let ordered = posts.sorted { $0.createTime < $1.createTime }.suffix(14).filter { $0.multiple != nil }
    VStack(alignment: .leading, spacing: 8) {
      Chart {
        ForEach(Array(ordered.enumerated()), id: \.element.id) { i, p in
          let m = p.multiple!.value
          BarMark(x: .value("Post", String(i)), y: .value("× your normal", min(m, cap)), width: .ratio(0.6))
            .foregroundStyle(m >= 1 ? Palette.purple : Palette.purple.opacity(0.25))
            .clipShape(RoundedRectangle(cornerRadius: 3))
            // VoiceOver reads the date and the REAL multiple, never the bar index or the 5× cap.
            .accessibilityLabel(Format.day(p.createTime))
            .accessibilityValue("\(Format.count(m)) times your normal")
            .annotation(position: .top, spacing: 2) {
              if m >= cap {
                Text(Format.count(m) + "×").font(.system(size: 9, weight: .bold)).foregroundStyle(Palette.purple)
                  .fixedSize().rotationEffect(.degrees(-35))
              }
            }
        }
        RuleMark(y: .value("Your normal", 1))
          .lineStyle(StrokeStyle(lineWidth: 1.5))
          .foregroundStyle(Palette.ink.opacity(0.25))
      }
      .chartXAxis(.hidden)
      .chartYScale(domain: 0...cap + 0.6)
      .chartYAxis { AxisMarks(position: .trailing, values: [1, 2, 5]) { v in
        AxisValueLabel {
          if let n = v.as(Double.self) {
            Text(n == 1 ? "normal" : "\(Int(n))×").font(.caption2.weight(n == 1 ? .semibold : .regular))
          }
        }
      } }
      .frame(height: 170)
      Text("Each bar is a post, oldest to newest. Solid bars beat your normal.")
        .font(MayaFont.caption).foregroundStyle(Palette.muted)
    }
    .padding(14)
    .background(Palette.panel, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
  }
}

struct AnalyticsTile: View {
  let post: AnalyticsPost
  var body: some View {
    PostCover(url: post.url, stored: post.cover, cornerRadius: 12) { _ in
      ZStack(alignment: .bottomLeading) {
        CoverScrim()
        PlatformMark(platform: post.platform).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing).padding(6)
        VStack(alignment: .leading, spacing: 2) {
          if let m = post.multiple {
            Text(Format.multiple(m.value)).font(.caption2.weight(.bold).monospacedDigit())
              .padding(.horizontal, 5).padding(.vertical, 2)
              .background(m.value >= 1.5 ? Palette.ok : .black.opacity(0.35), in: Capsule())
          }
          Text(Format.count(post.headline.value)).font(.subheadline.weight(.bold).monospacedDigit())
        }
        .foregroundStyle(.white)
        .padding(7)
        .dynamicTypeSize(...DynamicTypeSize.large)
      }
    }
    .aspectRatio(9 / 16, contentMode: .fit)
    .accessibilityLabel("\(Format.day(post.createTime)), \(Format.count(post.headline.value)) \(post.headline.what == "reach" ? "people reached" : "views")")
  }
}

/// A small platform glyph for covers, so a mixed TikTok + Instagram feed stays readable.
struct PlatformMark: View {
  let platform: String
  var body: some View {
    Image(systemName: platform == "instagram" ? "camera.fill" : "music.note")
      .font(.system(size: 10, weight: .bold))
      .foregroundStyle(.white)
      .frame(width: 22, height: 22)
      .background(platform == "instagram" ? Palette.coral : .black.opacity(0.55), in: Circle())
      .accessibilityLabel(platform == "instagram" ? "Instagram" : "TikTok")
  }
}
