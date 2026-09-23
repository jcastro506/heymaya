import SwiftUI

/// Is she working, what did she send, what needs me, how did the week go (spec §0 D2).
struct TodayView: View {
  @State private var today = Live<Today?>("ui:today")
  @State private var plan = Live<Plan?>("ui:plan")
  @State private var results = Live<Results?>("ui:results")

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
    .task { await plan.run() }
    .task { await results.run() }
  }

  @ViewBuilder
  private func content(_ t: Today) -> some View {
    MayaBubble(text: t.statusLine)

    if let block = t.nextBlock, block.status == "proposed" {
      VStack(alignment: .leading, spacing: 10) {
        SectionHeader(text: "Needs you")
        Card {
          Text(block.title).font(MayaFont.headline).foregroundStyle(Palette.ink)
          Text("\(Format.day(block.start)) · \(Format.time(block.start))")
            .font(MayaFont.callout).foregroundStyle(Palette.muted)
          Text("Reply yes to her in Messages to book it.")
            .font(MayaFont.caption).foregroundStyle(Palette.muted)
        }
      }
    }

    VStack(alignment: .leading, spacing: 10) {
      SectionHeader(text: "What she sent today")
      if t.sentToday.isEmpty {
        EmptyNote(text: "Nothing yet. She only texts when something is worth your time.")
      } else {
        ForEach(t.sentToday) { m in
          MayaBubble(text: m.body, caption: "\(Format.time(m.ts))\(m.error != nil ? " · not delivered" : "")")
        }
      }
    }

    upcoming

    VStack(alignment: .leading, spacing: 10) {
      SectionHeader(text: "Your recent posts")
      if t.week.isEmpty {
        EmptyNote(text: t.dossier ? "No posts read yet." : "She's reading your posts now.")
      } else {
        Card(padding: 4) {
          ForEach(t.week) { p in PostRow(post: p) }
        }
        if let first = t.week.first {
          Text("Numbers as of \(Format.ago(first.metricsAsOf))")
            .font(MayaFont.caption).foregroundStyle(Palette.muted)
        }
      }
    }

    lastWeek
  }

  @ViewBuilder
  private var upcoming: some View {
    if case .value(let p?) = plan.state {
      let blocks = p.blocks.filter { $0.start >= Date.now.timeIntervalSince1970 * 1000 }.sorted { $0.start < $1.start }
      VStack(alignment: .leading, spacing: 10) {
        SectionHeader(text: "Coming up")
        if blocks.isEmpty {
          EmptyNote(text: p.connected
            ? "Nothing planned yet. She proposes a filming block when something on your calendar is worth filming around."
            : "Nothing planned yet. Connect your calendar and she'll plan around your real week.")
        } else {
          Card(padding: 4) {
            ForEach(blocks.prefix(5)) { b in
              HStack {
                VStack(alignment: .leading, spacing: 2) {
                  Text(b.title).font(MayaFont.callout).foregroundStyle(Palette.ink)
                  Text("\(Format.day(b.start)) · \(Format.time(b.start))").font(MayaFont.caption).foregroundStyle(Palette.muted)
                }
                Spacer()
                Chip(text: b.status == "proposed" ? "waiting for you" : "booked", color: b.status == "proposed" ? Palette.warn : Palette.ok)
              }
              .padding(12)
            }
          }
        }
      }
    }
  }

  @ViewBuilder
  private var lastWeek: some View {
    if case .value(let r?) = results.state {
      VStack(alignment: .leading, spacing: 10) {
        SectionHeader(text: "Last week")
        Card {
          Text(RungWords.text(r.rung.rung)).font(MayaFont.callout).foregroundStyle(Palette.ink)
          Text(r.rung.why).font(MayaFont.caption).foregroundStyle(Palette.muted)
          if r.lane.usable, let median = r.lane.medianViews {
            Text("Your lane's median this week: \(Format.count(median)) views.")
              .font(MayaFont.caption).foregroundStyle(Palette.muted)
          }
        }
        if let review = r.lastReview {
          MayaBubble(text: review.body, caption: "Sunday review · \(Format.day(review.ts))")
        }
      }
    }
  }
}

enum RungWords {
  static func text(_ rung: String) -> String {
    switch rung {
    case "L0": "You posted less than you planned. Nothing else to diagnose yet."
    case "L1": "Nobody saw it. Reach fell well under your normal — a format problem before a topic one."
    case "L2": "They saw it and scrolled. Reach held; engagement didn't. That's the topic or the promise."
    case "healthy": "Healthy week. Reach and engagement both in your range."
    default: "Not enough posts with two days of numbers to say anything honest."
    }
  }
}

struct PostRow: View {
  let post: OwnPost
  var body: some View {
    Link(destination: URL(string: post.url) ?? URL(string: "https://hey-maya.ai")!) {
      HStack {
        Image(systemName: post.platform == "tiktok" ? "music.note" : "camera")
          .frame(width: 28)
          .foregroundStyle(Palette.purple)
        VStack(alignment: .leading, spacing: 2) {
          Text(Format.day(post.createTime)).font(MayaFont.callout).foregroundStyle(Palette.ink)
          Text(post.platform == "tiktok" ? "TikTok" : "Instagram").font(MayaFont.caption).foregroundStyle(Palette.muted)
        }
        Spacer()
        VStack(alignment: .trailing, spacing: 2) {
          Text("\(Format.count(post.views)) views").font(MayaFont.number).foregroundStyle(Palette.ink)
          if let m = post.multiple {
            Text("\(Format.multiple(m)) your normal")
              .font(MayaFont.caption.monospacedDigit())
              .foregroundStyle(m >= 1.5 ? Palette.ok : Palette.muted)
          }
        }
      }
      .padding(12)
      .contentShape(Rectangle())
    }
    .accessibilityElement(children: .combine)
  }
}

struct NoAccountNote: View {
  var body: some View {
    EmptyNote(text: "This sign-in isn't linked to a Maya account yet. Finish setting up and she'll start here.")
  }
}
