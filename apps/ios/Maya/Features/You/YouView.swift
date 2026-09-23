import SwiftUI

/// You, as she sees you: her read, what works, who she watches for you, your rules.
/// The account side is behind the gear (SettingsView).
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
        ProfileHeader(settings: s)
        herRead(s)
        watching
        rules(s)
      }
    }
    .task { await settings.run() }
    .task { await lane.run() }
  }

  @ViewBuilder
  private func herRead(_ s: CreatorSettings) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      SectionHeader(text: "Her read on you")
      if let k = s.knows {
        if let summary = k.summary {
          HStack(alignment: .top, spacing: 12) {
            FlowerMark(size: 28)
            Text(summary).font(.system(.title3, design: .rounded)).foregroundStyle(Palette.ink)
              .fixedSize(horizontal: false, vertical: true)
          }
          .padding(18)
          .frame(maxWidth: .infinity, alignment: .leading)
          .background(Palette.wash, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        }
        if !k.works.isEmpty { ReadList(title: "What works for you", items: k.works, icon: "arrow.up.right.circle.fill", tint: Palette.ok) }
        if !k.doesNot.isEmpty { ReadList(title: "What doesn't", items: k.doesNot, icon: "arrow.down.right.circle.fill", tint: Palette.muted) }
        Label("Something off? Tell her in Messages and she'll fix it.", systemImage: "bubble.left")
          .font(MayaFont.caption).foregroundStyle(Palette.muted)
      } else {
        EmptyNote(text: "She's still reading your posts. Her read on you lands here.")
      }
    }
  }

  @ViewBuilder
  private var watching: some View {
    if case .value(let l?) = lane.state {
      VStack(alignment: .leading, spacing: 12) {
        SectionHeader(text: "Who she watches for you")
        if l.accounts.isEmpty {
          EmptyNote(text: "No one yet. Text her an account you admire and she'll start watching it.")
        } else {
          ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
              ForEach(l.accounts) { a in
                VStack(spacing: 8) {
                  Avatar(text: a.handle, size: 56)
                  Text("@\(a.handle)").font(.caption.weight(.semibold)).foregroundStyle(Palette.ink).lineLimit(1)
                  Text(a.lastSampledAt.map { Format.ago($0) } ?? "soon").font(.caption2).foregroundStyle(Palette.muted)
                  PlatformBadge(platform: a.platform)
                }
                .frame(width: 104)
                .padding(.vertical, 14)
                .background(Palette.panel, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Palette.line))
              }
            }
          }
          .scrollClipDisabled()
        }
      }
    }
  }

  @ViewBuilder
  private func rules(_ s: CreatorSettings) -> some View {
    if !s.rules.isEmpty {
      VStack(alignment: .leading, spacing: 12) {
        SectionHeader(text: "Your rules for her")
        ForEach(s.rules) { r in
          HStack(alignment: .top, spacing: 12) {
            Image(systemName: "quote.opening").foregroundStyle(Palette.purple)
            Text(r.text).font(MayaFont.callout).foregroundStyle(Palette.ink)
            Spacer(minLength: 8)
            Button {
              Task { _ = await Actions.revokeRule(id: r.id) }
            } label: {
              Image(systemName: "xmark").font(.caption.weight(.bold)).foregroundStyle(Palette.muted)
                .frame(width: 28, height: 28).background(Palette.wash, in: Circle())
            }
            .accessibilityLabel("Remove this rule")
          }
          .padding(14)
          .background(Palette.panel, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
          .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Palette.line))
        }
      }
    }
  }
}

struct ProfileHeader: View {
  let settings: CreatorSettings
  var body: some View {
    let name = settings.handles.tiktok ?? settings.handles.instagram ?? "you"
    HStack(spacing: 16) {
      Avatar(text: name, size: 72)
      VStack(alignment: .leading, spacing: 6) {
        Text("@\(name)").font(MayaFont.title).foregroundStyle(Palette.ink).lineLimit(1).minimumScaleFactor(0.7)
        HStack(spacing: 6) {
          if settings.handles.tiktok != nil { PlatformBadge(platform: "tiktok") }
          if settings.handles.instagram != nil { PlatformBadge(platform: "instagram") }
          Chip(text: settings.tier.capitalized, color: Palette.purple)
        }
      }
      Spacer()
    }
  }
}

struct Avatar: View {
  let text: String
  let size: CGFloat
  var body: some View {
    Text(String(text.trimmingCharacters(in: CharacterSet(charactersIn: "@_. ")).prefix(1)).uppercased())
      .font(.system(size: size * 0.42, weight: .bold, design: .rounded))
      .foregroundStyle(.white)
      .frame(width: size, height: size)
      .background {
        MeshGradient(width: 2, height: 2, points: [[0, 0], [1, 0], [0, 1], [1, 1]],
                     colors: [Palette.purple, Palette.coral, Palette.purple.opacity(0.7), Palette.coral.opacity(0.8)])
          .clipShape(Circle())
      }
      .accessibilityHidden(true)
  }
}

struct PlatformBadge: View {
  let platform: String
  var body: some View {
    Label(platform == "instagram" ? "Instagram" : "TikTok", systemImage: platform == "instagram" ? "camera" : "music.note")
      .font(.caption2.weight(.semibold))
      .padding(.horizontal, 8).padding(.vertical, 3)
      .foregroundStyle(Palette.ink)
      .background(Palette.wash, in: Capsule())
  }
}

struct ReadList: View {
  let title: String
  let items: [String]
  let icon: String
  let tint: Color
  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text(title).font(MayaFont.headline).foregroundStyle(Palette.ink)
      ForEach(items, id: \.self) { item in
        HStack(alignment: .top, spacing: 10) {
          Image(systemName: icon).foregroundStyle(tint)
          Text(item).font(MayaFont.callout).foregroundStyle(Palette.ink).fixedSize(horizontal: false, vertical: true)
        }
      }
    }
    .padding(16)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Palette.panel, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(Palette.line))
  }
}
