import SwiftUI

/// Trending: live TikTok trends she thinks fit you, each with what it is, how to film it and your version.
/// They go stale in days, so this is a list you check, not a stack you swipe; saving one makes it an idea.
struct TrendingList: View {
  let trends: [Trend]
  let open: (Trend) -> Void

  var body: some View {
    if trends.isEmpty {
      EmptyNote(text: "Nothing worth hopping on for you right now. She checks TikTok's trends every day and only shows the ones that fit you.")
    } else {
      VStack(alignment: .leading, spacing: 14) {
        Text("Picked for you from what's taking off on TikTok this week. Trends move fast: the early ones get the views.")
          .font(MayaFont.callout).foregroundStyle(Palette.muted)
        ForEach(trends) { trend in
          Button { open(trend) } label: { TrendRow(trend: trend) }
            .buttonStyle(PressableStyle())
        }
      }
    }
  }
}

struct TrendRow: View {
  let trend: Trend

  var body: some View {
    HStack(alignment: .top, spacing: 14) {
      PostCover(url: trend.firstLink, stored: trend.firstCover, cornerRadius: 16) { _ in
        ZStack {
          CoverScrim()
          Image(systemName: "play.fill").font(.title3).foregroundStyle(.white)
        }
      }
      .frame(width: 96, height: 150)

      VStack(alignment: .leading, spacing: 8) {
        HStack(spacing: 6) {
          TrendChip(text: trend.verdictLabel, tint: trend.verdict == "hop_on" ? Palette.coral : Palette.purple)
          if trend.inYourLane { TrendChip(text: "in your lane", tint: Palette.ok) }
        }
        Text(trend.hook)
          .font(.system(.headline, design: .rounded).weight(.bold))
          .foregroundStyle(Palette.ink)
          .lineLimit(3)
          .multilineTextAlignment(.leading)
        Text(trend.what).font(MayaFont.callout).foregroundStyle(Palette.muted).lineLimit(2).multilineTextAlignment(.leading)
        Label(trend.momentum, systemImage: "chart.line.uptrend.xyaxis")
          .font(.caption.weight(.semibold)).foregroundStyle(Palette.muted)
      }
      Spacer(minLength: 0)
    }
    .padding(12)
    .background(Palette.panel, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(Palette.line))
    .accessibilityElement(children: .combine)
  }
}

struct TrendChip: View {
  let text: String
  let tint: Color
  var body: some View {
    Text(text).font(.caption2.weight(.bold)).textCase(.uppercase)
      .padding(.horizontal, 8).padding(.vertical, 4)
      .foregroundStyle(tint)
      .background(tint.opacity(0.14), in: Capsule())
  }
}

/// One trend: watch it, what it is, the beats, your version, why it's you. Save puts it in your ideas.
struct TrendDetailView: View {
  let trend: Trend
  @Environment(\.openURL) private var openURL
  @State private var saved: Bool

  init(trend: Trend) {
    self.trend = trend
    _saved = State(initialValue: trend.ideaId != nil)
  }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 26) {
        hero
        VStack(alignment: .leading, spacing: 26) {
          section("What it is") {
            Text(trend.what).font(MayaFont.body).foregroundStyle(Palette.ink).fixedSize(horizontal: false, vertical: true)
            if let text = trend.trendText, !text.isEmpty {
              Label("People put text like: \(text)", systemImage: "textformat").font(MayaFont.callout).foregroundStyle(Palette.muted)
            }
          }
          if !trend.beats.isEmpty { howTo }
          yourVersion
          section("Why it's for you") {
            HStack(alignment: .top, spacing: 12) {
              FlowerMark(size: 26)
              Text(trend.why).font(MayaFont.body).foregroundStyle(Palette.ink).fixedSize(horizontal: false, vertical: true)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.wash, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
          }
          if trend.examples.count > 1 { moreExamples }
        }
        .padding(.horizontal, 20)
      }
      .padding(.bottom, 120)
    }
    .background(Palette.ground.ignoresSafeArea())
    .ignoresSafeArea(edges: .top)
    .toolbar(.hidden, for: .tabBar)
    .navigationBarTitleDisplayMode(.inline)
    .safeAreaInset(edge: .bottom) { actionBar }
    .sensoryFeedback(.success, trigger: saved)
  }

  private var hero: some View {
    PostCover(url: trend.firstLink, stored: trend.firstCover, cornerRadius: 0) { _ in
      ZStack(alignment: .bottomLeading) {
        LoopingPost(url: trend.firstLink)
        LinearGradient(stops: [.init(color: .black.opacity(0.55), location: 0), .init(color: .clear, location: 0.22), .init(color: .clear, location: 0.5), .init(color: .black.opacity(0.85), location: 1)], startPoint: .top, endPoint: .bottom)
        VStack(alignment: .leading, spacing: 12) {
          Spacer()
          HStack(spacing: 6) {
            CoverChip(text: trend.verdictLabel, tint: trend.verdict == "hop_on" ? Palette.coral : Palette.purple)
            CoverChip(text: trend.momentum, tint: .black.opacity(0.35))
          }
          Text(trend.hook)
            .font(.system(.title, design: .rounded).weight(.bold))
            .foregroundStyle(.white)
            .lineLimit(4)
            .minimumScaleFactor(0.85)
          Label(trend.sound, systemImage: "music.note").font(.subheadline.weight(.semibold)).foregroundStyle(.white.opacity(0.9)).lineLimit(1)
        }
        .padding(20)
        .padding(.bottom, 6)

        if let url = URL(string: trend.firstLink), !trend.firstLink.isEmpty {
          Button { openURL(url) } label: {
            Image(systemName: "play.fill")
              .font(.title2).foregroundStyle(.white)
              .frame(width: 64, height: 64)
              .background(.ultraThinMaterial, in: Circle())
          }
          // In the clear upper half: the hook below can run to four lines.
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .padding(.bottom, 260)
          .accessibilityLabel("Watch an example on TikTok")
        }
      }
    }
    .frame(height: 520)
  }

  private var howTo: some View {
    section("How to film it") {
      VStack(alignment: .leading, spacing: 10) {
        ForEach(Array(trend.beats.enumerated()), id: \.offset) { i, beat in
          HStack(alignment: .top, spacing: 12) {
            Text("\(i + 1)").font(.callout.weight(.bold)).foregroundStyle(.white)
              .frame(width: 26, height: 26).background(Palette.purple, in: Circle())
            Text(beat).font(MayaFont.body).foregroundStyle(Palette.ink).fixedSize(horizontal: false, vertical: true)
          }
        }
        Label(trend.solo ? "\(trend.difficulty.capitalized), on your own" : "\(trend.difficulty.capitalized), with a friend", systemImage: trend.solo ? "person" : "person.2")
          .font(MayaFont.callout).foregroundStyle(Palette.muted)
      }
    }
  }

  private var yourVersion: some View {
    section("Your version") {
      VStack(alignment: .leading, spacing: 8) {
        Text(trend.hook).font(.system(.title3, design: .rounded).weight(.bold)).foregroundStyle(Palette.ink).fixedSize(horizontal: false, vertical: true)
        if let text = trend.onScreenText, !text.isEmpty {
          Label("On screen: \(text)", systemImage: "textformat").font(MayaFont.callout).foregroundStyle(Palette.muted)
        }
        if let len = trend.lengthSec {
          Label("\(Int(len)) seconds", systemImage: "timer").font(MayaFont.callout).foregroundStyle(Palette.muted)
        }
      }
    }
  }

  private var moreExamples: some View {
    section("More examples") {
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 10) {
          ForEach(Array(trend.examples.enumerated()).dropFirst(), id: \.offset) { _, ex in
            Link(destination: URL(string: ex.url) ?? URL(string: "https://www.tiktok.com")!) {
              PostCover(url: ex.url, stored: ex.cover, cornerRadius: 14).frame(width: 110, height: 196)
            }
            .accessibilityLabel("Example by \(ex.handle)")
          }
        }
      }
    }
  }

  private func section<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      SectionHeader(text: title)
      content()
    }
  }

  private var actionBar: some View {
    HStack(spacing: 10) {
      if saved {
        Label("In your ideas. Plan it from there.", systemImage: "checkmark.circle.fill")
          .font(MayaFont.headline).foregroundStyle(Palette.ok)
          .frame(maxWidth: .infinity, minHeight: 52)
          .transition(.opacity)
      } else {
        Button {
          Task { if await Actions.saveTrend(trendId: trend.id) { withAnimation { saved = true } } }
        } label: {
          Label("Save to my ideas", systemImage: "bookmark")
            .font(MayaFont.headline)
            .frame(maxWidth: .infinity, minHeight: 52)
        }
        .buttonStyle(.borderedProminent)
        .buttonBorderShape(.capsule)
      }
    }
    .padding(.horizontal, 16)
    .padding(.top, 10)
    .padding(.bottom, 6)
    .background(.bar)
  }
}
