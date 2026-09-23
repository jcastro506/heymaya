import SwiftUI

/// A screen's scrolling body on Maya's warm ground.
struct Screen<Content: View>: View {
  let title: String
  @ViewBuilder var content: Content

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 28) { content }
          .padding(.horizontal, 20)
          .padding(.top, 8)
          .padding(.bottom, 40)
          .frame(maxWidth: .infinity, alignment: .leading)
      }
      .background(Palette.ground.ignoresSafeArea())
      .navigationTitle(title)
      .toolbarBackground(Palette.ground, for: .navigationBar)
    }
  }
}

struct SectionHeader: View {
  let text: String
  var body: some View {
    Text(text.uppercased())
      .font(MayaFont.kicker)
      .kerning(0.8)
      .foregroundStyle(Palette.muted)
      .accessibilityAddTraits(.isHeader)
  }
}

struct Card<Content: View>: View {
  var padding: CGFloat = 16
  @ViewBuilder var content: Content
  var body: some View {
    VStack(alignment: .leading, spacing: 8) { content }
      .padding(padding)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(Palette.panel, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Palette.line, lineWidth: 1))
  }
}

/// Her words, shaped like a text bubble so the app reads as hers, not a dashboard.
struct MayaBubble: View {
  let text: String
  var caption: String?
  var body: some View {
    HStack(alignment: .top, spacing: 10) {
      FlowerMark(size: 26)
      VStack(alignment: .leading, spacing: 6) {
        if let caption { Text(caption).font(MayaFont.caption).foregroundStyle(Palette.muted) }
        Text(text).font(MayaFont.body).foregroundStyle(Palette.ink).fixedSize(horizontal: false, vertical: true)
      }
      .padding(14)
      .background(Palette.wash, in: UnevenRoundedRectangle(topLeadingRadius: 4, bottomLeadingRadius: 18, bottomTrailingRadius: 18, topTrailingRadius: 18, style: .continuous))
    }
  }
}

struct Chip: View {
  let text: String
  var color: Color = Palette.purple
  var body: some View {
    Text(text)
      .font(MayaFont.caption.weight(.semibold))
      .padding(.horizontal, 10)
      .padding(.vertical, 4)
      .foregroundStyle(color)
      .background(color.opacity(0.12), in: Capsule())
  }
}

/// A designed empty state: says what will appear and when, never a blank screen.
struct EmptyNote: View {
  let text: String
  var body: some View {
    Text(text)
      .font(MayaFont.callout)
      .foregroundStyle(Palette.muted)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(16)
      .background(Palette.wash.opacity(0.6), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
  }
}

/// Loading placeholder shaped like content, never a spinner in the middle of a page.
struct SkeletonRows: View {
  var count = 3
  var body: some View {
    VStack(spacing: 12) {
      ForEach(0..<count, id: \.self) { _ in
        RoundedRectangle(cornerRadius: 14, style: .continuous)
          .fill(Palette.wash)
          .frame(height: 64)
      }
    }
    .redacted(reason: .placeholder)
    .accessibilityLabel("Loading")
  }
}

struct ErrorNote: View {
  let message: String
  var body: some View {
    Label(message, systemImage: "exclamationmark.triangle")
      .font(MayaFont.callout)
      .foregroundStyle(Palette.err)
  }
}
