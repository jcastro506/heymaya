import SwiftUI

/// What she knows, who she watches, how she texts you, and the account (spec §0 D2).
struct YouView: View {
  @State private var settings = Live<CreatorSettings?>("ui:settings")
  @State private var lane = Live<Lane?>("ui:lane")

  var body: some View {
    Screen(title: "You", trailing: {
      if case .value(let s?) = settings.state {
        NavigationLink { SettingsView(settings: s) } label: { Image(systemName: "gearshape") }
          .accessibilityLabel("Settings")
      }
    }) {
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







  private func bullets(_ title: String, _ items: [String], _ color: Color) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(title).font(MayaFont.caption.weight(.semibold)).foregroundStyle(color)
      ForEach(items, id: \.self) { Text("• \($0)").font(MayaFont.callout).foregroundStyle(Palette.ink) }
    }
    .padding(.top, 6)
  }
}
