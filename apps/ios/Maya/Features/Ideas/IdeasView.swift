import SwiftUI

/// The swipe file. New ideas are a stack you swipe through; everything else is a cover grid.
struct IdeasView: View {
  @State private var ideas = Live<[Idea]?>("ui:ideas", args: ["unpostedOnly": false, "savedOnly": false])
  @State private var filter: IdeaFilter = .new
  @State private var handled: Set<String> = []
  @State private var selected: Idea?
  @Namespace private var zoom

  var body: some View {
    Screen(title: "Ideas") {
      Picker("Show", selection: $filter) {
        ForEach(IdeaFilter.allCases) { Text($0.label).tag($0) }
      }
      .pickerStyle(.segmented)
      .navigationDestination(item: $selected) { idea in
        IdeaDetailView(idea: idea).navigationTransition(.zoom(sourceID: idea.id, in: zoom))
      }

      switch ideas.state {
      case .loading:
        SkeletonRows(count: 3)
      case .failed(let message):
        ErrorNote(message: message)
      case .value(nil):
        NoAccountNote()
      case .value(let all?):
        let shown = all.filter { filter.includes($0) && !(filter == .new && handled.contains($0.id)) }
        if filter == .new {
          IdeaStack(ideas: shown, zoom: zoom, open: { selected = $0 }, decided: { idea, save in
            handled.insert(idea.id)
            Task { _ = save ? await Actions.saveIdea(ideaId: idea.id) : await Actions.passIdea(ideaId: idea.id) }
          })
        } else if shown.isEmpty {
          EmptyNote(text: filter.empty)
        } else {
          LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
            ForEach(shown) { idea in
              Button { selected = idea } label: { IdeaTile(idea: idea) }
                .buttonStyle(PressableStyle())
                .matchedTransitionSource(id: idea.id, in: zoom)
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
    case .new: (i.status == "sent" || i.status == "hearted") && !i.saved
    case .saved: i.saved
    case .posted: i.status == "posted"
    case .passed: i.status == "passed" || i.status == "expired"
    }
  }

  var empty: String {
    switch self {
    case .new: "You're all caught up. New ideas land here, with their proof, the moment she texts one."
    case .saved: "Nothing saved yet. Swipe right on an idea to keep it."
    case .posted: "Nothing posted from her ideas yet. Tap \"I posted it\" on one and she learns from how it does."
    case .passed: "Nothing here. Ideas you pass on, or that go stale, collect here."
    }
  }
}

extension Idea: Hashable {
  func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

// MARK: - The stack

struct IdeaStack: View {
  let ideas: [Idea]
  let zoom: Namespace.ID
  let open: (Idea) -> Void
  let decided: (Idea, Bool) -> Void
  @State private var drag: CGSize = .zero

  var body: some View {
    if ideas.isEmpty {
      VStack(spacing: 14) {
        FlowerMark(size: 56)
        Text("You're all caught up").font(MayaFont.title).foregroundStyle(Palette.ink)
        Text(IdeaFilter.new.empty).font(MayaFont.callout).foregroundStyle(Palette.muted).multilineTextAlignment(.center)
      }
      .frame(maxWidth: .infinity)
      .padding(.vertical, 60)
    } else {
      VStack(spacing: 18) {
        ZStack {
          ForEach(Array(ideas.prefix(3).enumerated().reversed()), id: \.element.id) { index, idea in
            IdeaCard(idea: idea, drag: index == 0 ? drag : .zero, isTop: index == 0)
              .matchedTransitionSource(id: idea.id, in: zoom)
              .scaleEffect(1 - CGFloat(index) * 0.05)
              .offset(y: CGFloat(index) * 14)
              .offset(index == 0 ? drag : .zero)
              .rotationEffect(.degrees(index == 0 ? Double(drag.width / 22) : 0))
              .allowsHitTesting(index == 0)
              .gesture(index == 0 ? swipe(idea) : nil)
              .onTapGesture { if index == 0 { open(idea) } }
              .accessibilityAddTraits(.isButton)
              .accessibilityHint("Swipe right to save, left if it's not for you")
          }
        }
        .frame(height: 500)
        .animation(.spring(duration: 0.4, bounce: 0.25), value: ideas.map(\.id))

        HStack(spacing: 22) {
          RoundAction(icon: "xmark", tint: Palette.muted, label: "Not for me") { fling(ideas[0], save: false) }
          RoundAction(icon: "arrow.up.right", tint: Palette.purple, label: "Open", small: true) { open(ideas[0]) }
          RoundAction(icon: "bookmark.fill", tint: Palette.coral, label: "Save") { fling(ideas[0], save: true) }
        }
        Text("\(ideas.count) new").font(MayaFont.caption).foregroundStyle(Palette.muted)
      }
      .sensoryFeedback(.selection, trigger: ideas.count)
    }
  }

  private func swipe(_ idea: Idea) -> some Gesture {
    DragGesture()
      .onChanged { drag = $0.translation }
      .onEnded { value in
        if value.translation.width > 110 { fling(idea, save: true) }
        else if value.translation.width < -110 { fling(idea, save: false) }
        else { withAnimation(.spring(duration: 0.35, bounce: 0.35)) { drag = .zero } }
      }
  }

  private func fling(_ idea: Idea, save: Bool) {
    withAnimation(.easeIn(duration: 0.22)) { drag = CGSize(width: save ? 600 : -600, height: 40) }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.22) {
      decided(idea, save)
      drag = .zero
    }
  }
}

struct IdeaCard: View {
  let idea: Idea
  var drag: CGSize = .zero
  var isTop = true

  var body: some View {
    let cover = idea.evidenceLinks.first ?? ""
    PostCover(url: cover, cornerRadius: 28) { preview in
      // Cards waiting underneath show only their cover; text on them would bleed together.
      if isTop { content(preview) }
    }
    .frame(maxWidth: .infinity)
    .frame(height: 480)
    .shadow(color: .black.opacity(0.12), radius: 18, y: 10)
  }

  private func content(_ preview: PostPreview?) -> some View {
      ZStack(alignment: .bottomLeading) {
        LinearGradient(colors: [.black.opacity(0.1), .clear, .black.opacity(0.8)], startPoint: .top, endPoint: .bottom)
        VStack(alignment: .leading, spacing: 10) {
          HStack(spacing: 6) {
            if idea.newForYou { CoverChip(text: "not your usual", tint: Palette.coral) }
            if let sent = idea.sentAt { CoverChip(text: Format.ago(sent), tint: .black.opacity(0.35)) }
            Spacer()
          }
          Spacer()
          if let handle = preview?.handle ?? idea.features?.account {
            Text("Inspired by \(handle)").font(.caption.weight(.semibold)).foregroundStyle(.white.opacity(0.85))
          }
          Text(idea.hook ?? idea.messageText)
            .font(.system(.title, design: .rounded).weight(.bold))
            .foregroundStyle(.white)
            .lineLimit(4)
            .minimumScaleFactor(0.8)
          Text(idea.fitWhy).font(.callout).foregroundStyle(.white.opacity(0.85)).lineLimit(2)
          IdeaMeta(idea: idea, onDark: true)
        }
        .padding(20)

        // Swipe stamps
        Stamp(text: "SAVE", color: Palette.coral).opacity(Double(max(0, drag.width) / 110)).rotationEffect(.degrees(-12))
          .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading).padding(24)
        Stamp(text: "NOT FOR ME", color: .white).opacity(Double(max(0, -drag.width) / 110)).rotationEffect(.degrees(12))
          .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing).padding(24)
      }
  }
}

struct IdeaTile: View {
  let idea: Idea
  var body: some View {
    PostCover(url: idea.evidenceLinks.first ?? "", cornerRadius: 18) { _ in
      ZStack(alignment: .bottomLeading) {
        CoverScrim()
        VStack(alignment: .leading, spacing: 6) {
          CoverChip(text: IdeaStatus.label(idea.status, saved: idea.saved), tint: IdeaStatus.color(idea.status))
          Spacer()
          Text(idea.hook ?? idea.messageText)
            .font(.system(.subheadline, design: .rounded).weight(.bold))
            .foregroundStyle(.white).lineLimit(4).multilineTextAlignment(.leading)
        }
        .padding(12)
      }
    }
    .aspectRatio(9 / 14, contentMode: .fit)
  }
}

struct IdeaMeta: View {
  let idea: Idea
  var onDark = false
  var body: some View {
    let items: [String] = [
      idea.version?.lengthSec.map { "\(Int($0))s" },
      idea.features?.format.flatMap { $0 == "unknown" || $0 == "other" ? nil : $0 },
      idea.version?.sound.flatMap { $0.isEmpty ? nil : $0 },
    ].compactMap { $0 }
    HStack(spacing: 6) {
      ForEach(items, id: \.self) { item in
        Text(item).font(.caption.weight(.semibold))
          .padding(.horizontal, 8).padding(.vertical, 4)
          .foregroundStyle(onDark ? .white : Palette.ink)
          .background(onDark ? AnyShapeStyle(.white.opacity(0.18)) : AnyShapeStyle(Palette.wash), in: Capsule())
      }
    }
  }
}

struct CoverChip: View {
  let text: String
  let tint: Color
  var body: some View {
    Text(text).font(.caption2.weight(.bold)).textCase(.uppercase)
      .padding(.horizontal, 8).padding(.vertical, 4)
      .foregroundStyle(.white)
      .background(tint, in: Capsule())
  }
}

struct Stamp: View {
  let text: String
  let color: Color
  var body: some View {
    Text(text).font(.system(.title2, design: .rounded).weight(.heavy))
      .foregroundStyle(color)
      .padding(.horizontal, 12).padding(.vertical, 6)
      .overlay(RoundedRectangle(cornerRadius: 8).stroke(color, lineWidth: 3))
  }
}

struct RoundAction: View {
  let icon: String
  let tint: Color
  let label: String
  var small = false
  let action: () -> Void
  var body: some View {
    Button(action: action) {
      Image(systemName: icon)
        .font(.system(size: small ? 18 : 22, weight: .bold))
        .foregroundStyle(tint)
        .frame(width: small ? 50 : 62, height: small ? 50 : 62)
        .background(Palette.panel, in: Circle())
        .overlay(Circle().stroke(Palette.line))
        .shadow(color: .black.opacity(0.06), radius: 8, y: 4)
    }
    .buttonStyle(PressableStyle())
    .accessibilityLabel(label)
  }
}

enum IdeaStatus {
  static func label(_ s: String, saved: Bool = false) -> String {
    if saved && (s == "sent" || s == "hearted") { return "saved" }
    switch s {
    case "sent": return "new"
    case "hearted": return "loved"
    default: return s
    }
  }

  static func color(_ s: String) -> Color {
    switch s {
    case "posted": Palette.ok
    case "hearted": Palette.coral
    case "passed", "expired": .black.opacity(0.4)
    default: Palette.purple
    }
  }
}
