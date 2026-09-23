import Charts
import SwiftUI

/// Today is a briefing, not a dashboard: the one thing that matters, what she said, how your
/// posts are doing, what's coming, and how the week went.
struct TodayView: View {
  @State private var today = Live<Today?>("ui:today")
  @State private var ideas = Live<[Idea]?>("ui:ideas", args: ["unpostedOnly": false, "savedOnly": false])
  @State private var plan = Live<Plan?>("ui:plan")
  @State private var results = Live<Results?>("ui:results")
  @Namespace private var zoom

  var body: some View {
    Screen(title: "Today") {
      switch today.state {
      case .loading:
        SkeletonRows(count: 4)
      case .failed(let message):
        ErrorNote(message: message)
      case .value(nil):
        NoAccountNote()
      case .value(let t?):
        content(t)
      }
    }
    .task { await today.run() }
    .task { await ideas.run() }
    .task { await plan.run() }
    .task { await results.run() }
  }

  @ViewBuilder
  private func content(_ t: Today) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      Text(Date.now.formatted(.dateTime.weekday(.wide).month(.wide).day()).uppercased())
        .font(MayaFont.kicker).kerning(0.8).foregroundStyle(Palette.muted)
      StatusPill(text: t.statusLine)
    }

    hero(t)

    PostsSection(posts: t.week, reading: !t.dossier)
    comingUp
    weekCard
  }

  // MARK: hero — the single most important thing right now

  @ViewBuilder
  private func hero(_ t: Today) -> some View {
    if let block = t.nextBlock, block.status == "proposed" {
      HeroCard(kicker: "Needs you", tint: Palette.coral) {
        Text(block.title).font(MayaFont.title).foregroundStyle(Palette.ink)
        Label("\(Format.day(block.start)) at \(Format.time(block.start))", systemImage: "calendar")
          .font(MayaFont.callout).foregroundStyle(Palette.muted)
        Text("Reply yes to her in Messages and it's booked.")
          .font(MayaFont.caption).foregroundStyle(Palette.muted)
      }
    } else if case .value(let all?) = ideas.state, let idea = all.first(where: { $0.status == "sent" || $0.status == "hearted" }) {
      NavigationLink {
        IdeaDetailView(idea: idea).navigationTransition(.zoom(sourceID: idea.id, in: zoom))
      } label: {
        HeroCard(kicker: "Her latest idea", tint: Palette.purple) {
          HStack(alignment: .top, spacing: 14) {
            if let link = idea.evidenceLinks.first {
              PostCover(url: link, cornerRadius: 12)
                .frame(width: 92, height: 164)
                .matchedTransitionSource(id: idea.id, in: zoom)
            }
            VStack(alignment: .leading, spacing: 8) {
              Text(idea.hook ?? "Her idea").font(MayaFont.title).foregroundStyle(Palette.ink)
                .multilineTextAlignment(.leading).lineLimit(4)
              Text(idea.fitWhy).font(MayaFont.callout).foregroundStyle(Palette.muted)
                .multilineTextAlignment(.leading).lineLimit(3)
              Label("Open the idea", systemImage: "arrow.right")
                .font(MayaFont.callout.weight(.semibold)).foregroundStyle(Palette.purple)
                .labelStyle(TrailingIcon())
            }
          }
        }
      }
      .buttonStyle(PressableStyle())
    }
  }

  // MARK: coming up

  @ViewBuilder
  private var comingUp: some View {
    if case .value(let p?) = plan.state {
      let upcoming = p.blocks.filter { $0.start >= Date.now.timeIntervalSince1970 * 1000 }.sorted { $0.start < $1.start }
      VStack(alignment: .leading, spacing: 12) {
        SectionHeader(text: "Coming up")
        if upcoming.isEmpty {
          EmptyNote(text: p.connected
            ? "Nothing planned. She'll propose a filming block when something's worth filming around."
            : "Nothing planned yet. Connect your calendar and she'll plan around your real week.")
        } else {
          ForEach(upcoming.prefix(4)) { b in
            HStack(spacing: 14) {
              DateTile(ms: b.start)
              VStack(alignment: .leading, spacing: 3) {
                Text(b.title).font(MayaFont.headline).foregroundStyle(Palette.ink)
                Text(Format.time(b.start)).font(MayaFont.callout).foregroundStyle(Palette.muted)
              }
              Spacer()
              Chip(text: b.status == "proposed" ? "waiting for you" : "booked", color: b.status == "proposed" ? Palette.warn : Palette.ok)
            }
          }
        }
      }
    }
  }

  // MARK: the week

  @ViewBuilder
  private var weekCard: some View {
    if case .value(let r?) = results.state {
      WeekCard(results: r)
    }
  }
}

// MARK: - Pieces

struct StatusPill: View {
  let text: String
  var body: some View {
    HStack(spacing: 8) {
      FlowerMark(size: 18)
      Text(text).font(MayaFont.callout).foregroundStyle(Palette.ink)
    }
    .padding(.horizontal, 12).padding(.vertical, 8)
    .background(Palette.wash, in: Capsule())
  }
}

struct HeroCard<Content: View>: View {
  let kicker: String
  let tint: Color
  @ViewBuilder var content: Content
  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text(kicker.uppercased()).font(MayaFont.kicker).kerning(0.8).foregroundStyle(tint)
      content
    }
    .padding(18)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background {
      RoundedRectangle(cornerRadius: 24, style: .continuous)
        .fill(Palette.panel)
        .shadow(color: tint.opacity(0.14), radius: 24, y: 10)
    }
    .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).stroke(tint.opacity(0.25), lineWidth: 1))
  }
}

struct DateTile: View {
  let ms: Double
  var body: some View {
    let d = Date(timeIntervalSince1970: ms / 1000)
    VStack(spacing: 0) {
      Text(d.formatted(.dateTime.weekday(.abbreviated)).uppercased()).font(.caption2.weight(.bold)).foregroundStyle(Palette.coral)
      Text(d.formatted(.dateTime.day())).font(.title3.weight(.bold)).foregroundStyle(Palette.ink)
    }
    .frame(width: 48, height: 52)
    .background(Palette.panel, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Palette.line))
  }
}

/// Your last posts: a chart against your normal, then the posts themselves as covers.
struct PostsSection: View {
  let posts: [OwnPost]
  let reading: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      NavigationLink { AnalyticsView() } label: {
        HStack(alignment: .firstTextBaseline) {
          SectionHeader(text: "Your numbers")
          Spacer()
          Label("See all", systemImage: "chevron.right").labelStyle(TrailingIcon())
            .font(MayaFont.callout.weight(.semibold)).foregroundStyle(Palette.purple)
        }
      }
      .buttonStyle(.plain)
      if posts.isEmpty {
        EmptyNote(text: reading ? "She's reading your posts now." : "No posts read yet.")
      } else {
        if let normal = Self.normal(posts) {
          NavigationLink { AnalyticsView() } label: { chart(normal: normal) }.buttonStyle(.plain)
        }
        ScrollView(.horizontal, showsIndicators: false) {
          HStack(spacing: 10) {
            ForEach(posts) { PostTile(post: $0) }
          }
          .scrollTargetLayout()
        }
        .scrollTargetBehavior(.viewAligned)
        .scrollClipDisabled()
      }
    }
  }

  private func chart(normal: Double) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Chart {
        ForEach(Array(posts.reversed().enumerated()), id: \.offset) { i, p in
          BarMark(x: .value("Post", String(i)), y: .value("Views", p.views), width: .ratio(0.62))
            .foregroundStyle(p.views >= normal ? Palette.purple : Palette.purple.opacity(0.25))
            .clipShape(RoundedRectangle(cornerRadius: 5))
        }
      }
      .chartXAxis(.hidden)
      .chartYAxis(.hidden)
      .frame(height: 84)
      HStack(spacing: 14) {
        LegendDot(filled: true, text: "above your normal")
        LegendDot(filled: false, text: "below")
        Spacer()
        Text("normal ≈ \(Format.count(normal))").font(MayaFont.caption.monospacedDigit()).foregroundStyle(Palette.muted)
      }
      if let first = posts.first {
        Text("Updated \(Format.ago(first.metricsAsOf))").font(.caption2).foregroundStyle(Palette.muted)
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("Views of your last \(posts.count) posts; \(posts.filter { $0.views >= normal }.count) were above your normal of \(Format.count(normal))")
  }

  /// Their normal, recovered from the server's multiples (views ÷ multiple), median of those.
  static func normal(_ posts: [OwnPost]) -> Double? {
    let normals = posts.compactMap { p -> Double? in
      guard let m = p.multiple, m > 0 else { return nil }
      return p.views / m
    }.sorted()
    return normals.isEmpty ? nil : normals[normals.count / 2]
  }
}

struct LegendDot: View {
  let filled: Bool
  let text: String
  var body: some View {
    HStack(spacing: 5) {
      RoundedRectangle(cornerRadius: 3).fill(filled ? Palette.purple : Palette.purple.opacity(0.25)).frame(width: 10, height: 10)
      Text(text).font(MayaFont.caption).foregroundStyle(Palette.muted)
    }
  }
}

struct PostTile: View {
  let post: OwnPost
  var body: some View {
    NavigationLink {
      PostNumbersView(post: AnalyticsPost(
        id: post.id, url: post.url, platform: post.platform, createTime: post.createTime, contentType: "video",
        headline: Headline(value: post.views, what: "views", basis: "public", asOfHours: nil),
        multiple: post.multiple.map { Multiple(value: $0, basis: "views") }, diagnosis: nil))
    } label: {
      PostCover(url: post.url, cornerRadius: 14) { _ in
        ZStack(alignment: .bottomLeading) {
          CoverScrim()
          PlatformMark(platform: post.platform).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing).padding(8)
          VStack(alignment: .leading, spacing: 4) {
            if let m = post.multiple {
              Text(Format.multiple(m))
                .font(.caption.weight(.bold).monospacedDigit())
                .padding(.horizontal, 7).padding(.vertical, 3)
                .background(m >= 1.5 ? Palette.ok : .black.opacity(0.35), in: Capsule())
            }
            Text(Format.count(post.views)).font(.headline.monospacedDigit())
            Text(Format.day(post.createTime)).font(.caption2)
          }
          .foregroundStyle(.white)
          .padding(10)
        }
      }
      .frame(width: 124, height: 220)
    }
    .buttonStyle(PressableStyle())
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("Post from \(Format.day(post.createTime)), \(Format.count(post.views)) views\(post.multiple.map { ", \(Format.multiple($0)) your normal" } ?? "")")
  }
}

/// How the week went, in her words, with the Sunday review a tap away (not pasted inline).
struct WeekCard: View {
  let results: Results
  @State private var showReview = false

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      SectionHeader(text: "Your week")
      VStack(alignment: .leading, spacing: 14) {
        Text(RungWords.headline(results.rung.rung)).font(MayaFont.title).foregroundStyle(Palette.ink)
        HStack(spacing: 10) {
          StatTile(value: results.rung.planned.map { "\(Int(results.rung.posted)) of \(Int($0))" } ?? "\(Int(results.rung.posted))", label: "posted")
          StatTile(value: results.rung.medianMultiple.map(Format.multiple) ?? "—", label: "vs your normal")
          StatTile(value: results.lane.usable ? results.lane.medianViews.map(Format.count) ?? "—" : "—", label: "lane median")
        }
        if results.lastReview != nil || !results.experiments.isEmpty {
          Button {
            showReview = true
          } label: {
            HStack {
              FlowerMark(size: 22)
              Text("Read her Sunday review").font(MayaFont.headline)
              Spacer()
              Image(systemName: "chevron.right").font(.caption.weight(.bold))
            }
            .foregroundStyle(Palette.ink)
            .padding(14)
            .background(Palette.wash, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
          }
          .buttonStyle(PressableStyle())
        }
      }
      .padding(18)
      .background(Palette.panel, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).stroke(Palette.line))
    }
    .sheet(isPresented: $showReview) { ReviewSheet(results: results) }
  }
}

struct StatTile: View {
  let value: String
  let label: String
  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(value).font(.title3.weight(.bold).monospacedDigit()).foregroundStyle(Palette.ink)
        .minimumScaleFactor(0.7).lineLimit(1)
      Text(label).font(MayaFont.caption).foregroundStyle(Palette.muted)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(12)
    .background(Palette.ground, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
  }
}

struct ReviewSheet: View {
  let results: Results
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 24) {
          if let review = results.lastReview {
            Text("Sunday, \(Format.day(review.ts))").font(MayaFont.kicker).foregroundStyle(Palette.muted)
            MayaThread(text: review.body)
          }
          if !results.experiments.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
              SectionHeader(text: "What she wants you to try")
              ForEach(results.experiments) { e in
                HStack(alignment: .top, spacing: 12) {
                  Image(systemName: e.result == "held" ? "checkmark.circle.fill" : e.result == "failed" ? "xmark.circle" : "circle.dashed")
                    .foregroundStyle(e.result == "held" ? Palette.ok : e.result == "failed" ? Palette.err : Palette.purple)
                  Text(e.text).font(MayaFont.callout).foregroundStyle(Palette.ink)
                }
              }
            }
          }
        }
        .padding(20)
      }
      .background(Palette.ground.ignoresSafeArea())
      .navigationTitle("Her review")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
    }
    .presentationDetents([.medium, .large])
    .presentationBackground(Palette.ground)
  }
}

enum RungWords {
  static func headline(_ rung: String) -> String {
    switch rung {
    case "L0": "You posted less than you planned"
    case "L1": "Not many people were shown it"
    case "L2": "They saw it, then scrolled"
    case "healthy": "A healthy week"
    default: "Too early to call"
    }
  }
}

struct TrailingIcon: LabelStyle {
  func makeBody(configuration: Configuration) -> some View {
    HStack(spacing: 4) { configuration.title; configuration.icon }
  }
}

/// A gentle press: scale down a touch, spring back.
struct PressableStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .scaleEffect(configuration.isPressed ? 0.97 : 1)
      .animation(.spring(duration: 0.25, bounce: 0.3), value: configuration.isPressed)
  }
}

struct NoAccountNote: View {
  var body: some View {
    EmptyNote(text: "This sign-in isn't linked to a Maya account yet. Finish setting up and she'll start here.")
  }
}
