import SwiftUI

/// Show, don't tell (operator, 2026-11-13): an onboarding screen shows what Maya would text them because of it,
/// instead of lines explaining it. Her bubbles arrive one after another with typing dots, like Messages.
/// Examples only: made-up posts and places, never a real creator's name.
struct MayaTexts: View {
  let messages: [String]
  @State private var shown = 0
  @State private var typing = false
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text("Maya")
        .font(MayaFont.caption.weight(.semibold))
        .foregroundStyle(Palette.muted)
        .padding(.leading, 6)
      ForEach(Array(messages.prefix(shown).enumerated()), id: \.offset) { _, text in
        bubble(text).transition(.asymmetric(insertion: .move(edge: .bottom).combined(with: .opacity), removal: .opacity))
      }
      if typing { TypingDots().transition(.opacity) }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.top, 8)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("Example texts from Maya: \(messages.joined(separator: " "))")
    // Keyed on the count, so a bubble whose words change (their name, as they type) updates in place.
    .task(id: messages.count) {
      if reduceMotion { shown = messages.count; return }
      shown = 0
      try? await Task.sleep(for: .milliseconds(450))
      for _ in messages.indices {
        withAnimation(.easeOut(duration: 0.2)) { typing = true }
        try? await Task.sleep(for: .milliseconds(750))
        withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) { typing = false; shown += 1 }
        try? await Task.sleep(for: .milliseconds(350))
      }
    }
  }

  private func bubble(_ text: String) -> some View {
    Text(text)
      .font(MayaFont.body)
      .foregroundStyle(Palette.ink)
      .padding(.horizontal, 14)
      .padding(.vertical, 9)
      .background(Palette.wash, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
      .frame(maxWidth: 300, alignment: .leading)
      .fixedSize(horizontal: false, vertical: true)
  }
}

private struct TypingDots: View {
  @State private var on = false
  var body: some View {
    HStack(spacing: 4) {
      ForEach(0..<3, id: \.self) { i in
        Circle().fill(Palette.muted).frame(width: 7, height: 7)
          .opacity(on ? 1 : 0.35)
          .animation(.easeInOut(duration: 0.5).repeatForever().delay(Double(i) * 0.15), value: on)
      }
    }
    .padding(.horizontal, 14)
    .padding(.vertical, 12)
    .background(Palette.wash, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    .onAppear { on = true }
  }
}

/// What she'd text, per screen. Kept out of the views so the copy test reads them. Her voice: lowercase, short.
enum MayaExamples {
  static func name(_ typed: String) -> [String] {
    let n = typed.trimmingCharacters(in: .whitespaces)
    return ["hey \(n.isEmpty ? "there" : n)! it's maya 👋"]
  }
  static let connect = [
    "your thrifted cast iron video did 4× your usual views",
    "it's the reveal at the end. people watched it twice",
    "want another one built the same way?",
  ]
  static let watch = [
    "one of your favorites just posted a ranking video that's doing 10× her usual",
    "your version: rank the 5 pre-run snacks you actually eat",
  ]
  static let calendar = [
    "put the pasta one on thursday at 6, right after your gym class",
    "want it?",
  ]
  static let nearby = [
    "you're in new york this week!",
    "the rockefeller tree just went up. go film it before the crowds get there",
    "text me when you're back and we'll cut it",
  ]
}
