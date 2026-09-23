import SwiftUI

/// The swipe file: every idea she sent, with its evidence and what happened to it.
struct IdeasView: View {
  @State private var ideas = Live<[Idea]?>("ui:ideas", args: ["unpostedOnly": false, "savedOnly": false])
  @State private var filter: IdeaFilter = .new

  var body: some View {
    Screen(title: "Ideas") {
      Picker("Show", selection: $filter) {
        ForEach(IdeaFilter.allCases) { Text($0.label).tag($0) }
      }
      .pickerStyle(.segmented)
      // Declared inside the stack (Screen owns the NavigationStack), not on it.
      .navigationDestination(for: Idea.self) { IdeaDetailView(idea: $0) }

      switch ideas.state {
      case .loading:
        SkeletonRows(count: 4)
      case .failed(let message):
        ErrorNote(message: message)
      case .value(nil):
        NoAccountNote()
      case .value(let all?):
        let shown = all.filter(filter.includes)
        if shown.isEmpty {
          EmptyNote(text: filter.empty)
        } else {
          LazyVStack(spacing: 12) {
            ForEach(shown) { idea in
              NavigationLink(value: idea) { IdeaCard(idea: idea) }
                .buttonStyle(.plain)
            }
          }
        }
      }
    }
    .task { await ideas.run() }
  }
}

enum IdeaFilter: String, CaseIterable, Identifiable {
  case new, saved, posted, passed
  var id: String { rawValue }
  var label: String { rawValue.capitalized }

  func includes(_ i: Idea) -> Bool {
    switch self {
    case .new: i.status == "sent" || i.status == "hearted"
    case .saved: i.saved
    case .posted: i.status == "posted"
    case .passed: i.status == "passed" || i.status == "expired"
    }
  }

  var empty: String {
    switch self {
    case .new: "No open ideas. They land here, with their evidence, the moment she texts one."
    case .saved: "Nothing saved yet. Save an idea and it waits here."
    case .posted: "Nothing posted from her ideas yet. Tap \"I posted it\" on one and she learns from it."
    case .passed: "Nothing passed. Ideas you pass on, or that go stale, collect here."
    }
  }
}

extension Idea: Hashable {
  func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

struct IdeaCard: View {
  let idea: Idea
  var body: some View {
    Card {
      HStack(spacing: 8) {
        Chip(text: IdeaStatus.label(idea.status), color: IdeaStatus.color(idea.status))
        if idea.newForYou { Chip(text: "not your usual", color: Palette.coral) }
        if idea.saved { Image(systemName: "bookmark.fill").foregroundStyle(Palette.purple).font(.caption) }
        Spacer()
        if let sent = idea.sentAt { Text(Format.day(sent)).font(MayaFont.caption).foregroundStyle(Palette.muted) }
      }
      Text(idea.hook ?? idea.messageText)
        .font(MayaFont.headline)
        .foregroundStyle(Palette.ink)
        .lineLimit(3)
        .multilineTextAlignment(.leading)
      Text(idea.fitWhy)
        .font(MayaFont.callout)
        .foregroundStyle(Palette.muted)
        .lineLimit(2)
        .multilineTextAlignment(.leading)
    }
  }
}

enum IdeaStatus {
  static func label(_ s: String) -> String {
    switch s {
    case "sent": "new"
    case "hearted": "loved"
    default: s
    }
  }

  static func color(_ s: String) -> Color {
    switch s {
    case "posted": Palette.ok
    case "hearted": Palette.coral
    case "passed", "expired": Palette.muted
    default: Palette.purple
    }
  }
}
