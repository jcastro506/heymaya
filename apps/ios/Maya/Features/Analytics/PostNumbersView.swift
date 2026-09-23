import SwiftUI

/// One post's numbers: only what this post really has, each with where it came from, her read
/// when the data supports one, and what the platform doesn't share.
struct PostNumbersView: View {
  let post: AnalyticsPost
  @State private var data: Live<PostNumbers?>
  @Environment(\.openURL) private var openURL

  init(post: AnalyticsPost) {
    self.post = post
    _data = State(initialValue: Live<PostNumbers?>("ui:post", args: ["id": post.id]))
  }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 24) {
        header
        switch data.state {
        case .loading: SkeletonRows(count: 3)
        case .failed(let m): ErrorNote(message: m)
        case .value(nil): EmptyNote(text: "This post isn't available any more.")
        case .value(let n?): numbers(n)
        }
      }
      .padding(20)
      .padding(.bottom, 100)
    }
    .background(Palette.ground.ignoresSafeArea())
    .navigationTitle(Format.day(post.createTime))
    .navigationBarTitleDisplayMode(.inline)
    .task { await data.run() }
  }

  private var header: some View {
    HStack(alignment: .bottom, spacing: 16) {
      Button { if let u = URL(string: post.url) { openURL(u) } } label: {
        PostCover(url: post.url, stored: post.cover, cornerRadius: 16) { _ in
          Image(systemName: "play.fill").font(.title3).foregroundStyle(.white)
            .frame(width: 44, height: 44).background(.ultraThinMaterial, in: Circle())
        }
        .frame(width: 120, height: 213)
      }
      .accessibilityLabel("Open the post")
      VStack(alignment: .leading, spacing: 8) {
        PlatformBadge(platform: post.platform)
        Text(Format.count(post.headline.value))
          .font(.system(size: 44, weight: .bold, design: .rounded).monospacedDigit())
          .foregroundStyle(Palette.ink)
        Text(post.headline.what == "reach" ? "people reached" : "views").font(MayaFont.callout).foregroundStyle(Palette.muted)
        if let m = post.multiple {
          Chip(text: "\(Format.multiple(m.value)) your normal \(m.basis == "reach" ? "reach" : "views")", color: m.value >= 1.5 ? Palette.ok : m.value < 0.7 ? Palette.warn : Palette.purple)
        }
        BasisLabel(basis: post.headline.basis, asOfHours: post.headline.asOfHours)
      }
    }
  }

  @ViewBuilder
  private func numbers(_ n: PostNumbers) -> some View {
    let tiles = MetricTile.tiles(for: n)
    if !tiles.isEmpty {
      VStack(alignment: .leading, spacing: 12) {
        SectionHeader(text: n.connected != nil ? "From your connected account" : "Public counts")
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
          ForEach(tiles) { t in
            VStack(alignment: .leading, spacing: 4) {
              Text(t.value).font(.title3.weight(.bold).monospacedDigit()).foregroundStyle(Palette.ink)
              Text(t.label).font(MayaFont.caption).foregroundStyle(Palette.muted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(Palette.panel, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Palette.line))
          }
        }
      }
    }

    VStack(alignment: .leading, spacing: 12) {
      SectionHeader(text: "Her read")
      HStack(alignment: .top, spacing: 12) {
        FlowerMark(size: 24)
        Text(n.read ?? "Connect your \(n.platform == "instagram" ? "Instagram" : "TikTok") in Settings and she can tell you how many people it reached, and read why.")
          .font(MayaFont.body).foregroundStyle(n.read == nil ? Palette.muted : Palette.ink)
          .fixedSize(horizontal: false, vertical: true)
      }
      .padding(16)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(Palette.wash, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    if !n.cannotKnow.isEmpty {
      VStack(alignment: .leading, spacing: 10) {
        SectionHeader(text: "What \(n.platform == "instagram" ? "Instagram" : "TikTok") doesn't show")
        ForEach(n.cannotKnow, id: \.self) { line in
          Label(line.prefix(1).uppercased() + line.dropFirst(), systemImage: "eye.slash")
            .font(MayaFont.callout).foregroundStyle(Palette.muted)
        }
      }
    }

    if !n.caption.isEmpty {
      VStack(alignment: .leading, spacing: 8) {
        SectionHeader(text: "Caption")
        Text(n.caption).font(MayaFont.callout).foregroundStyle(Palette.ink)
      }
    }
  }
}

struct BasisLabel: View {
  let basis: String
  let asOfHours: Double?
  var body: some View {
    Label(basis == "connected" ? "From your account\(asOfHours.map { ", \(Int($0))h ago" } ?? "")" : "Public count",
          systemImage: basis == "connected" ? "checkmark.seal" : "globe")
      .font(MayaFont.caption).foregroundStyle(Palette.muted)
  }
}

/// Only the numbers a post really has, in words a creator uses. Never a zero for "not given".
struct MetricTile: Identifiable {
  let id: String
  let value: String
  let label: String

  static func tiles(for n: PostNumbers) -> [MetricTile] {
    let source: [String: Double?] = n.connected ?? n.publicCounts
    func v(_ k: String) -> Double? { source[k] ?? nil }
    var out: [MetricTile] = []
    func add(_ key: String, _ label: String, _ value: String?) { if let value { out.append(MetricTile(id: key, value: value, label: label)) } }
    add("reach", "people reached", v("reach").map(Format.count))
    add("views", "views", v("views").map(Format.count))
    add("impressions", "times shown", v("impressions").map(Format.count))
    add("likes", "likes", v("likes").map(Format.count))
    add("comments", "comments", v("comments").map(Format.count))
    add("shares", "shares", v("shares").map(Format.count))
    add("saves", "saves", v("saves").map(Format.count))
    add("follows", "new followers", v("follows").map(Format.count))
    add("retention", "watched on average", n.derived?.retention.map { "\(Int(($0 * 100).rounded()))%" })
    add("skip", "left in the first 3s", v("skipRatePct").map { "\(Int($0.rounded()))%" })
    add("perPerson", "views per person", n.derived?.distribution.map { $0.formatted(.number.precision(.fractionLength(1))) })
    add("engaged", "engaged per person reached", n.derived?.engagementPerReach.map { "\(($0 * 100).formatted(.number.precision(.fractionLength(1))))%" })
    return out
  }
}
