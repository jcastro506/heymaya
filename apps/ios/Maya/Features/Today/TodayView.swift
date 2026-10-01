import Charts
import SwiftUI

/// Today is a briefing, not a dashboard: the one thing that matters, what she said, how your
/// posts are doing, what's coming, and how the week went.
struct TodayView: View {
  @State private var today = Live<Today?>("ui:today")
  @State private var ideas = Live<[Idea]?>("ui:ideas", args: ["unpostedOnly": false, "savedOnly": false])
  @State private var plan = Live<Plan?>("ui:plan")
  @State private var results = Live<Results?>("ui:results")
  @State private var reading = Live<ReadingState?>("onboarding/start:reading")
  @State private var engage = Live<EngageRound?>("engage/round:today")
  @Namespace private var zoom
  @Environment(\.dynamicTypeSize) private var typeSize
  @Environment(Router.self) private var router
  @State private var linkedPost: LinkedID?

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
      Color.clear.frame(height: 0)
        .navigationDestination(item: $linkedPost) { PostByIdView(id: $0.id) }
    }
    .onChange(of: router.pendingPost, initial: true) { _, id in
      guard let id else { return }
      linkedPost = LinkedID(id: id)
      router.pendingPost = nil
    }
    // "want them on your calendar? tap here": they asked, so the iPhone's prompt comes straight up.
    .onChange(of: router.pendingCalendar, initial: true) { _, pending in
      guard pending else { return }
      router.pendingCalendar = false
      Task { await CalendarSync.connect() }
    }
    .task { await today.run() }
    .task { await ideas.run() }
    .task { await plan.run() }
    .task { await results.run() }
    .task { await reading.run() }
    .task { await engage.run() }
  }

  @ViewBuilder
  private func content(_ t: Today) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      Text(Date.now.formatted(.dateTime.weekday(.wide).month(.wide).day()).uppercased())
        .font(MayaFont.kicker).kerning(0.8).foregroundStyle(Palette.muted)
      StatusPill(text: t.statusLine)
    }

    if case .value(let r?) = reading.state { ReadingCard(state: r) }

    hero(t)

    if case .value(let round?) = engage.state, !round.items.isEmpty { EngageCard(round: round) }

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
          let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 14)) : AnyLayout(HStackLayout(alignment: .top, spacing: 14))
          layout {
            if let link = idea.evidenceLinks.first {
              PostCover(url: link, stored: idea.firstCover, cornerRadius: 12)
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
          if p.deviceCalendar == nil, !p.connected, upcoming.contains(where: { $0.status != "proposed" }) {
            CalendarAsk()
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

/// Asked once, when there's something to put on the calendar (calendar/device).
struct CalendarAsk: View {
  @State private var busy = false
  var body: some View {
    Button {
      Task { busy = true; await CalendarSync.connect(); busy = false }
    } label: {
      HStack(spacing: 10) {
        Image(systemName: "calendar.badge.plus")
        Text("Add these to my calendar").font(MayaFont.callout.weight(.semibold))
        Spacer()
        if busy { ProgressView() }
      }
      .padding(14)
      .background(RoundedRectangle(cornerRadius: 14).fill(Palette.wash))
      .foregroundStyle(Palette.purple)
    }
    .buttonStyle(PressableStyle())
    .disabled(busy)
  }
}

struct StatusPill: View {
  let text: String
  var body: some View {
    HStack(spacing: 8) {
      FlowerMark(size: 18)
      Text(text).font(MayaFont.callout).foregroundStyle(Palette.ink)
    }
    .padding(.horizontal, 12).padding(.vertical, 8)
    .background(Palette.wash, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
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
        cover: post.cover, headline: Headline(value: post.views, what: "views", basis: "public", asOfHours: nil),
        multiple: post.multiple.map { Multiple(value: $0, basis: "views") }, diagnosis: nil))
    } label: {
      PostCover(url: post.url, stored: post.cover, cornerRadius: 14) { _ in
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
        .dynamicTypeSize(...DynamicTypeSize.xLarge) // text over a fixed-size cover can't grow forever
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

/// Day one: while her first read runs, show the work on their own posts (live counts, the last one
/// she watched); once it lands, what she saw, for a few days. Nothing to do here; it's a receipt.
struct ReadingState: Decodable, Equatable {
  let stage: String
  let posts: Double
  let watched: Double
  let toWatch: Double
  let lastWatched: String?
  let summary: String?
  let topFormat: String?
  let readAt: Double?
}

struct ReadingCard: View {
  let state: ReadingState
  static let showReadForDays = 3.0

  var body: some View {
    if state.stage != "read" {
      Card {
        HStack(alignment: .top, spacing: 12) {
          ProgressView().padding(.top, 2)
          VStack(alignment: .leading, spacing: 6) {
            Text("She's reading your posts").font(MayaFont.headline).foregroundStyle(Palette.ink)
            Text(progressLine).font(MayaFont.callout).foregroundStyle(Palette.muted)
            if let last = state.lastWatched, !last.isEmpty {
              Text("Just watched: \u{201C}\(last)\u{201D}").font(MayaFont.caption).foregroundStyle(Palette.muted).lineLimit(2)
            }
          }
        }
      }
    } else if let summary = state.summary, let at = state.readAt, Date.now.timeIntervalSince1970 * 1000 - at < Self.showReadForDays * 86_400_000 {
      Card {
        VStack(alignment: .leading, spacing: 6) {
          Text("WHAT SHE SEES").font(MayaFont.kicker).kerning(0.8).foregroundStyle(Palette.coral)
          Text(summary).font(MayaFont.body).foregroundStyle(Palette.ink)
          if let top = state.topFormat { Text("Your go-to: \(top)").font(MayaFont.caption).foregroundStyle(Palette.muted) }
        }
      }
    }
  }

  private var progressLine: String {
    if state.posts == 0 { return "Pulling in your posts now." }
    let read = "\(Int(state.posts)) posts in"
    return state.toWatch > 0 ? "\(read), watched \(Int(state.watched)) of \(Int(state.toWatch))." : "\(read), watching them now."
  }
}

/// The engagement round: up to five fresh posts from accounts she watches for them. They open one,
/// comment themselves (she never comments for them), and tick it off; three a day keeps the streak.
struct EngageRound: Decodable, Equatable {
  struct Item: Decodable, Equatable, Identifiable {
    let platform: String
    let handle: String
    let postId: String
    let url: String
    let hoursAgo: Double
    let views: Double
    let comments: Double
    let caption: String?
    let why: String
    let done: Bool
    /// From her lane-wide sweep: a creator they don't watch yet.
    var fromLane: Bool? = nil
    var id: String { "\(platform):\(postId)" }
  }
  let items: [Item]
  let doneToday: Double
  let goal: Double
  let streak: Double
}

struct EngageCard: View {
  let round: EngageRound
  @Environment(\.openURL) private var openURL

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(alignment: .firstTextBaseline) {
        SectionHeader(text: "Worth a comment today")
        Spacer()
        Text(progress).font(MayaFont.caption.monospacedDigit()).foregroundStyle(Palette.muted)
      }
      Card {
        VStack(spacing: 0) {
          ForEach(Array(round.items.enumerated()), id: \.element.id) { index, item in
            if index > 0 { Divider().padding(.vertical, 10) }
            HStack(alignment: .top, spacing: 12) {
              Button {
                Haptics.tap()
                if let url = URL(string: item.url) { openURL(url) }
              } label: {
                VStack(alignment: .leading, spacing: 3) {
                  HStack(spacing: 6) {
                    Text("@\(item.handle)").font(MayaFont.headline).foregroundStyle(Palette.ink)
                    if item.fromLane == true { Chip(text: "New to you") }
                  }
                  if let caption = item.caption, !caption.isEmpty {
                    Text(caption).font(MayaFont.callout).foregroundStyle(Palette.ink).lineLimit(2).multilineTextAlignment(.leading)
                  }
                  Text("\(age(item.hoursAgo)) · \(Format.count(item.views)) views · \(item.why.replacingOccurrences(of: "new to you, in your lane: ", with: ""))")
                    .font(MayaFont.caption).foregroundStyle(Palette.muted).multilineTextAlignment(.leading)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
              }
              .buttonStyle(.plain)
              .accessibilityHint("Opens the post")
              Button {
                guard !item.done else { return }
                Task { await Actions.markCommented(platform: item.platform, postId: item.postId, handle: item.handle) }
              } label: {
                Image(systemName: item.done ? "checkmark.circle.fill" : "circle")
                  .font(.title2)
                  .foregroundStyle(item.done ? Palette.ok : Palette.line)
              }
              .buttonStyle(.plain)
              .accessibilityLabel(item.done ? "Commented" : "Mark as commented")
            }
          }
        }
      }
      Text("Tap a post to open it and leave a real comment. She never comments for you.")
        .font(MayaFont.caption).foregroundStyle(Palette.muted)
    }
  }

  private var progress: String {
    let base = "\(Int(round.doneToday)) of \(Int(round.goal)) today"
    return round.streak >= 2 ? "\(base) · \(Int(round.streak))-day streak" : base
  }

  private func age(_ hours: Double) -> String {
    hours < 1 ? "just now" : hours < 24 ? "\(Int(hours))h ago" : "\(Int(hours / 24))d ago"
  }
}
