import SwiftUI

/// An idea as a creative brief: what inspired it, the hook, how it looks on screen, why it's
/// yours, what she said, and the three things you can do with it.
struct IdeaDetailView: View {
  let idea: Idea
  @Environment(\.openURL) private var openURL
  @State private var outcome: Outcome?
  @State private var saved: Bool
  @State private var showMessage = false

  enum Outcome { case posted, passed }

  init(idea: Idea) {
    self.idea = idea
    _saved = State(initialValue: idea.saved)
  }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 26) {
        hero
        VStack(alignment: .leading, spacing: 26) {
          if let text = idea.version?.onScreenText, !text.isEmpty { onScreen(text) }
          whyYou
          herMessage
          if idea.evidenceLinks.count > 1 { moreProof }
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
    .sensoryFeedback(.success, trigger: outcome)
    .sensoryFeedback(.impact(weight: .light), trigger: saved)
  }

  // MARK: hero

  private var hero: some View {
    let link = idea.evidenceLinks.first ?? ""
    return PostCover(url: link, cornerRadius: 0) { preview in
      ZStack(alignment: .bottomLeading) {
        LinearGradient(stops: [.init(color: .black.opacity(0.55), location: 0), .init(color: .clear, location: 0.22), .init(color: .clear, location: 0.5), .init(color: .black.opacity(0.85), location: 1)], startPoint: .top, endPoint: .bottom)
        VStack(alignment: .leading, spacing: 12) {
          Spacer()
          if let handle = preview?.handle ?? idea.features?.account {
            Label("Inspired by \(handle)", systemImage: "sparkles")
              .font(.subheadline.weight(.semibold)).foregroundStyle(.white.opacity(0.9))
          }
          Text(idea.hook ?? "Her idea")
            .font(.system(.largeTitle, design: .rounded).weight(.bold))
            .foregroundStyle(.white)
            .fixedSize(horizontal: false, vertical: true)
          IdeaMeta(idea: idea, onDark: true)
        }
        .padding(20)
        .padding(.bottom, 6)

        if !link.isEmpty, let url = URL(string: link) {
          Button { openURL(url) } label: {
            Image(systemName: "play.fill")
              .font(.title2).foregroundStyle(.white)
              .frame(width: 64, height: 64)
              .background(.ultraThinMaterial, in: Circle())
          }
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .accessibilityLabel("Watch the post that inspired this")
        }
      }
    }
    .frame(height: 520)
  }

  // MARK: on screen

  private func onScreen(_ text: String) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      SectionHeader(text: "On screen")
      HStack(alignment: .center, spacing: 18) {
        ZStack(alignment: .top) {
          // The inspiring post's own frame, blurred, so the mock reads as a real video.
          PostCover(url: idea.evidenceLinks.first ?? "", cornerRadius: 22)
            .blur(radius: 6)
            .overlay(Color.black.opacity(0.25))
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
          Text(text)
            .font(.system(size: 13, weight: .heavy))
            .foregroundStyle(.white)
            .shadow(color: .black.opacity(0.9), radius: 0, x: 1, y: 1)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 10)
            .padding(.top, 54)
        }
        .frame(width: 130, height: 230)
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(Palette.line, lineWidth: 1))
        .accessibilityLabel("On-screen text: \(text)")

        VStack(alignment: .leading, spacing: 8) {
          Text("How your text could sit in the first second.").font(MayaFont.callout).foregroundStyle(Palette.ink)
          if let len = idea.version?.lengthSec {
            Label("\(Int(len)) seconds", systemImage: "timer").font(MayaFont.callout).foregroundStyle(Palette.muted)
          }
          if let sound = idea.version?.sound, !sound.isEmpty {
            Label(sound, systemImage: "music.note").font(MayaFont.callout).foregroundStyle(Palette.muted)
          }
        }
      }
    }
  }

  // MARK: why you

  private var whyYou: some View {
    VStack(alignment: .leading, spacing: 12) {
      SectionHeader(text: "Why it's for you")
      HStack(alignment: .top, spacing: 12) {
        FlowerMark(size: 26)
        Text(idea.fitWhy).font(MayaFont.body).foregroundStyle(Palette.ink).fixedSize(horizontal: false, vertical: true)
      }
      .padding(16)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(Palette.wash, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
  }

  // MARK: her message

  private var herMessage: some View {
    VStack(alignment: .leading, spacing: 12) {
      Button {
        withAnimation(.spring(duration: 0.3)) { showMessage.toggle() }
      } label: {
        HStack {
          SectionHeader(text: "What she texted you")
          Spacer()
          Image(systemName: "chevron.down").font(.caption.weight(.bold)).foregroundStyle(Palette.muted)
            .rotationEffect(.degrees(showMessage ? 180 : 0))
        }
      }
      .buttonStyle(.plain)
      if showMessage {
        MayaThread(text: idea.messageText).transition(.opacity.combined(with: .move(edge: .top)))
      }
    }
  }

  private var moreProof: some View {
    VStack(alignment: .leading, spacing: 12) {
      SectionHeader(text: "More proof")
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 10) {
          ForEach(idea.evidenceLinks.dropFirst(), id: \.self) { link in
            Link(destination: URL(string: link) ?? URL(string: "https://www.tiktok.com")!) {
              PostCover(url: link, cornerRadius: 14).frame(width: 110, height: 196)
            }
          }
        }
      }
    }
  }

  // MARK: actions

  @ViewBuilder
  private var actionBar: some View {
    HStack(spacing: 10) {
      if let outcome {
        Label(outcome == .posted ? "Nice. She'll read how it does." : "Passed. She'll weigh that next time.", systemImage: "checkmark.circle.fill")
          .font(MayaFont.headline).foregroundStyle(Palette.ok)
          .frame(maxWidth: .infinity, minHeight: 52)
          .transition(.opacity)
      } else if idea.status == "posted" {
        Label("You posted this one", systemImage: "checkmark.seal.fill")
          .font(MayaFont.headline).foregroundStyle(Palette.ok)
          .frame(maxWidth: .infinity, minHeight: 52)
      } else {
        if idea.status == "sent" || idea.status == "hearted" {
          BarIcon(icon: "xmark", label: "Not for me") {
            Task { if await Actions.passIdea(ideaId: idea.id) { withAnimation { outcome = .passed } } }
          }
        }
        BarIcon(icon: saved ? "bookmark.fill" : "bookmark", label: saved ? "Saved" : "Save", tint: Palette.coral) {
          let next = !saved
          saved = next
          Task { if !(await Actions.saveIdea(ideaId: idea.id, saved: next)) { saved = !next } }
        }
        Button {
          Task { if await Actions.markPosted(ideaId: idea.id) { withAnimation { outcome = .posted } } }
        } label: {
          Label("I posted it", systemImage: "checkmark")
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

struct BarIcon: View {
  let icon: String
  let label: String
  var tint: Color = Palette.muted
  let action: () -> Void
  var body: some View {
    Button(action: action) {
      Image(systemName: icon)
        .font(.system(size: 20, weight: .semibold))
        .foregroundStyle(tint)
        .frame(width: 52, height: 52)
        .background(Palette.panel, in: Circle())
        .overlay(Circle().stroke(Palette.line))
        .contentTransition(.symbolEffect(.replace))
    }
    .buttonStyle(PressableStyle())
    .accessibilityLabel(label)
  }
}

enum EvidenceLabel {
  /// "@andi.renay on TikTok" from the post URL, never a raw link.
  static func text(_ link: String) -> String {
    if let handle = PostPreview.handle(of: link) { return "\(handle) on TikTok" }
    if link.contains("instagram.com") { return "A post on Instagram" }
    return "The post"
  }
}
