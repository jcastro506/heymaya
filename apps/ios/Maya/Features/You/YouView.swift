import ClerkKit
import SwiftUI

/// What she knows, who she watches, how she texts you, and the account (spec §0 D2).
struct YouView: View {
  @State private var settings = Live<CreatorSettings?>("ui:settings")
  @State private var lane = Live<Lane?>("ui:lane")
  @State private var confirmSignOut = false

  var body: some View {
    Screen(title: "You") {
      switch settings.state {
      case .loading:
        SkeletonRows(count: 4)
      case .failed(let message):
        ErrorNote(message: message)
      case .value(nil):
        NoAccountNote()
      case .value(let s?):
        knows(s)
        watching
        rules(s)
        texting(s)
        account(s)
      }
      Button("Sign out", role: .destructive) { confirmSignOut = true }
        .font(MayaFont.callout)
        .confirmationDialog("Sign out of Maya on this phone?", isPresented: $confirmSignOut, titleVisibility: .visible) {
          Button("Sign out", role: .destructive) { Task { try? await Clerk.shared.auth.signOut() } }
        } message: {
          Text("She keeps working and texting you. This only signs this app out.")
        }
    }
    .task { await settings.run() }
    .task { await lane.run() }
  }

  @ViewBuilder
  private func knows(_ s: CreatorSettings) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      SectionHeader(text: "What she knows about you")
      if let k = s.knows {
        Card {
          if let summary = k.summary { Text(summary).font(MayaFont.body).foregroundStyle(Palette.ink) }
          if !k.works.isEmpty { bullets("What works for you", k.works, Palette.ok) }
          if !k.doesNot.isEmpty { bullets("What doesn't", k.doesNot, Palette.muted) }
        }
        Text("Something wrong? Tell her in Messages and she'll correct it.")
          .font(MayaFont.caption).foregroundStyle(Palette.muted)
      } else {
        EmptyNote(text: "She's still reading your posts. Her picture of you lands here.")
      }
    }
  }

  @ViewBuilder
  private var watching: some View {
    if case .value(let l?) = lane.state {
      VStack(alignment: .leading, spacing: 10) {
        SectionHeader(text: "Who she watches")
        if l.accounts.isEmpty {
          EmptyNote(text: "No one yet. Text her an account you admire and she'll start watching it.")
        } else {
          Card(padding: 4) {
            ForEach(l.accounts) { a in
              HStack {
                Text("@\(a.handle)").font(MayaFont.callout).foregroundStyle(Palette.ink)
                Spacer()
                Text(a.lastSampledAt.map { "looked \(Format.ago($0))" } ?? "from the next pass")
                  .font(MayaFont.caption).foregroundStyle(Palette.muted)
              }
              .padding(12)
            }
          }
        }
      }
    }
  }

  @ViewBuilder
  private func rules(_ s: CreatorSettings) -> some View {
    if !s.rules.isEmpty {
      VStack(alignment: .leading, spacing: 10) {
        SectionHeader(text: "Your rules for her")
        Card(padding: 4) {
          ForEach(s.rules) { r in
            HStack(alignment: .top) {
              Text("“\(r.text)”").font(MayaFont.callout).foregroundStyle(Palette.ink)
              Spacer(minLength: 8)
              Button {
                Task { _ = await Actions.revokeRule(id: r.id) }
              } label: {
                Image(systemName: "xmark.circle").foregroundStyle(Palette.muted)
              }
              .accessibilityLabel("Remove this rule")
            }
            .padding(12)
          }
        }
      }
    }
  }

  private func texting(_ s: CreatorSettings) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      SectionHeader(text: "How she texts you")
      Card {
        row("Quiet hours", "\(s.quietHours.start)–\(s.quietHours.end)")
        row("Tone", s.tone.capitalized)
        row("Time zone", s.timezone.replacingOccurrences(of: "_", with: " "))
      }
    }
  }

  private func account(_ s: CreatorSettings) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      SectionHeader(text: "Account")
      Card {
        row("Plan", s.tier.capitalized)
        if let tiktok = s.handles.tiktok { row("TikTok", "@\(tiktok)") }
        if let ig = s.handles.instagram { row("Instagram", "@\(ig)") }
      }
    }
  }

  private func row(_ label: String, _ value: String) -> some View {
    HStack {
      Text(label).font(MayaFont.callout).foregroundStyle(Palette.muted)
      Spacer()
      Text(value).font(MayaFont.callout).foregroundStyle(Palette.ink)
    }
  }

  private func bullets(_ title: String, _ items: [String], _ color: Color) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(title).font(MayaFont.caption.weight(.semibold)).foregroundStyle(color)
      ForEach(items, id: \.self) { Text("• \($0)").font(MayaFont.callout).foregroundStyle(Palette.ink) }
    }
    .padding(.top, 6)
  }
}
