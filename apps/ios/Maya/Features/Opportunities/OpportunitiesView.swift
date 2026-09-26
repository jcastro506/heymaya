import PhotosUI
import SwiftUI

/// Money she finds you (spec §6.6, D6). Everyone sees the tab; the partner plan unlocks it.
struct OpportunitiesView: View {
  @State private var data = Live<Opportunities?>("ui:opportunities")

  var body: some View {
    Screen(title: "Deals") {
      switch data.state {
      case .loading:
        SkeletonRows(count: 3)
      case .failed(let message):
        ErrorNote(message: message)
      case .value(nil):
        NoAccountNote()
      case .value(let o?):
        if o.unlocked { PipelineView(items: o.opportunities) } else { LockedDealsView(o: o) }
      }
    }
    .task { await data.run() }
  }
}

/// The locked screen: what she'd do, one real number from their lane, one button.
struct LockedDealsView: View {
  let o: Opportunities
  @State private var busy = false
  @State private var stripe: URL?
  @State private var failed = false

  var body: some View {
    VStack(alignment: .leading, spacing: 20) {
      HStack(spacing: 12) {
        FlowerMark(size: 44)
        VStack(alignment: .leading, spacing: 2) {
          Text("Maya finds you money").font(MayaFont.title).foregroundStyle(Palette.ink)
          Text("On the Partner plan").font(MayaFont.callout).foregroundStyle(Palette.muted)
        }
      }

      if o.teaser.paidPostsInLane > 0 {
        Card {
          Label {
            Text(teaserLine).font(MayaFont.headline).foregroundStyle(Palette.ink)
          } icon: {
            Image(systemName: "sparkles").foregroundStyle(Palette.coral)
          }
          Text("Brands are paying creators like the ones she watches for you. She can find the ones that fit you.")
            .font(MayaFont.callout).foregroundStyle(Palette.muted)
          if let brands = o.brandsInLane, !brands.isEmpty {
            Text("Paying your lane: " + brands.prefix(4).map { "@\($0.handle)" }.joined(separator: " · "))
              .font(MayaFont.callout.weight(.semibold)).foregroundStyle(Palette.purple)
              .accessibilityLabel("Brands paying creators in your lane: " + brands.prefix(4).map(\.handle).joined(separator: ", "))
          }
        }
      }

      VStack(alignment: .leading, spacing: 14) {
        ladderRow("bag", "Affiliate products that fit what you already make", "TikTok Shop and brands' own affiliate programs, for Reels and TikToks alike. Commission on things you'd post about anyway.")
        ladderRow("camera.aperture", "UGC gigs", "Brands pay for content on their own channels. Your work matters more than your follower count.")
        ladderRow("gift", "Gifting and brand programs", "Official creator programs, with what they ask for and how to apply.")
        ladderRow("envelope", "Pitches, when you're ready", "She drafts it from your real posts. You send it.")
      }
      .padding(.vertical, 4)

      Button {
        Task { await unlock() }
      } label: {
        HStack {
          if busy { ProgressView().tint(.white) }
          Text("Unlock with Partner · \(price)/mo").font(MayaFont.headline)
        }
        .frame(maxWidth: .infinity, minHeight: 54)
      }
      .buttonStyle(.borderedProminent)
      .buttonBorderShape(.roundedRectangle(radius: 16))
      .disabled(busy)

      if failed {
        ErrorNote(message: Fixtures.enabled ? "Upgrading is off in preview mode." : "Couldn't open checkout. Try again in a moment.")
      }
    }
    .sheet(item: $stripe) { SafariSheet(url: $0).ignoresSafeArea() }
  }

  private var teaserLine: String {
    let posts = Int(o.teaser.paidPostsInLane)
    let accounts = Int(o.teaser.accountsPaid)
    let postWord = posts == 1 ? "paid partnership post" : "paid partnership posts"
    let accountWord = accounts == 1 ? "account" : "accounts"
    return "\(posts) \(postWord) from \(accounts) \(accountWord) she watches, in the last \(Int(o.teaser.days)) days"
  }

  private var price: String {
    o.unlockPriceUsd.formatted(.currency(code: "USD"))
  }

  private func unlock() async {
    failed = false
    guard !Fixtures.enabled else { failed = true; return }
    busy = true
    let url = await Billing.unlockURL(tier: o.unlockTier)
    busy = false
    if let url { stripe = url } else { failed = true }
  }

  private func ladderRow(_ icon: String, _ title: String, _ detail: String) -> some View {
    HStack(alignment: .top, spacing: 14) {
      Image(systemName: icon)
        .font(.title3)
        .foregroundStyle(Palette.purple)
        .frame(width: 28)
      VStack(alignment: .leading, spacing: 3) {
        Text(title).font(MayaFont.headline).foregroundStyle(Palette.ink)
        Text(detail).font(MayaFont.callout).foregroundStyle(Palette.muted)
      }
    }
  }
}

/// Unlocked: what she found, what's moving, what's done.
struct PipelineView: View {
  let items: [Opportunity]

  var body: some View {
    MediaKitCard()
    if items.isEmpty {
      EmptyNote(text: "Nothing yet. Text her \"find me brands\" and she'll start with the ones already paying creators in your lane.")
    } else {
      group("Ready for you", items.filter { ["discovered", "shortlisted"].contains($0.status) })
      group("In progress", items.filter { ["contacted", "replied", "negotiating"].contains($0.status) })
      group("Done", items.filter { ["agreed", "completed"].contains($0.status) })
    }
  }

  @ViewBuilder
  private func group(_ title: String, _ rows: [Opportunity]) -> some View {
    if !rows.isEmpty {
      VStack(alignment: .leading, spacing: 10) {
        SectionHeader(text: title)
        ForEach(rows) { o in
          if o.route == "application" {
            NavigationLink { ApplicationView(id: o.id) } label: { card(o, application: true) }.buttonStyle(.plain)
          } else {
            card(o, application: false)
          }
        }
      }
    }
  }

  private func card(_ o: Opportunity, application: Bool) -> some View {
          Card {
            HStack {
              Text(o.brand).font(MayaFont.headline).foregroundStyle(Palette.ink)
              Spacer()
              Chip(text: DealType.label(o.type))
            }
            if !o.campaign.isEmpty { Text(o.campaign).font(MayaFont.callout).foregroundStyle(Palette.muted) }
            Text(o.fit).font(MayaFont.callout).foregroundStyle(Palette.ink).lineLimit(3)
            if !o.compensation.isEmpty { Text(o.compensation).font(MayaFont.caption).foregroundStyle(Palette.muted) }
            if application { Label("Application: answers ready to copy", systemImage: "doc.on.clipboard").font(MayaFont.caption.weight(.semibold)).foregroundStyle(Palette.purple) }
          }
  }
}

enum DealType {
  static func label(_ t: String) -> String {
    switch t {
    case "ugc": "UGC"
    case "affiliate": "Affiliate"
    case "gifting": "Gifting"
    case "sponsorship": "Sponsorship"
    case "ambassador": "Ambassador"
    case "event": "Event"
    default: t.capitalized
    }
  }
}

/// K1: their media kit. The photo (theirs, never made or edited), the one line she proposed (on the kit
/// only once they say yes), whether brands see who watches, the headline numbers, the link to share, and
/// the per-brand links she made for pitches (with "opened"). Every change here is one a text can make too.
struct MediaKitCard: View {
  @State private var kit = Live<KitInfo?>("ui:kit")
  @State private var busy = false
  @State private var picked: PhotosPickerItem?
  @State private var editing = false
  @State private var draftLine = ""
  @State private var legacyLink: URL?

  var body: some View {
    Card {
      Text("Your media kit").font(MayaFont.headline).foregroundStyle(Palette.ink)
      switch kit.state {
      case .loading:
        SkeletonRows(count: 2)
      case .failed(let message):
        ErrorNote(message: message)
      case .value(nil):
        EmptyNote(text: "Your media kit comes with the partnerships plan.")
      case .value(let k?):
        content(k)
      }
    }
    .task { await kit.run() }
    .onChange(of: picked) { _, item in
      guard let item else { return }
      Task {
        busy = true
        if let data = try? await item.loadTransferable(type: Data.self), let jpeg = Self.jpeg(data) { _ = await Actions.uploadKitPhoto(jpeg) }
        picked = nil
        busy = false
      }
    }
    .alert("The line at the top of your kit", isPresented: $editing) {
      TextField("A few words about you and what you make", text: $draftLine)
      Button("Save") { Task { _ = await Actions.kitUpdate(["op": "edit_one_line", "text": draftLine]) } }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("Words only: the numbers come from your accounts.")
    }
  }

  @ViewBuilder
  private func content(_ k: KitInfo) -> some View {
    HStack(spacing: 14) {
      Group {
        if let s = k.photo, let url = URL(string: s) {
          AsyncImage(url: url) { $0.resizable().scaledToFill() } placeholder: { Palette.wash }
        } else {
          ZStack { Palette.wash; Image(systemName: "person.crop.circle").font(.title).foregroundStyle(Palette.muted) }
        }
      }
      .frame(width: 64, height: 64)
      .clipShape(Circle())
      VStack(alignment: .leading, spacing: 6) {
        PhotosPicker(selection: $picked, matching: .images) {
          Label(k.photoSource == "upload" ? "Change photo" : "Use a photo of me", systemImage: "photo")
        }
        .font(MayaFont.callout.weight(.semibold)).tint(Palette.purple).disabled(busy)
        Menu {
          Button("Use my profile picture") { Task { _ = await Actions.kitUpdate(["op": "photo", "source": "auto"]) } }
          Button("No photo on my kit") { Task { _ = await Actions.kitUpdate(["op": "photo", "source": "none"]) } }
        } label: {
          Text(k.photoSource == "none" ? "No photo" : "Photo options").font(MayaFont.caption).foregroundStyle(Palette.muted)
        }
      }
    }
    if k.photoWeak != nil && k.photoSource != "upload" && k.photoSource != "none" {
      Text("Your profile picture isn't a clear photo of you. Brands like to see who they're working with.")
        .font(MayaFont.caption).foregroundStyle(Palette.muted)
    }

    VStack(alignment: .leading, spacing: 6) {
      if let line = k.oneLine {
        Text("“\(line.text)”").font(MayaFont.callout).foregroundStyle(Palette.ink)
        HStack {
          if !line.approved {
            Button("Use this") { Task { _ = await Actions.kitUpdate(["op": "approve_one_line"]) } }
              .buttonStyle(.borderedProminent).tint(Palette.purple)
          }
          Button(line.approved ? "Edit" : "Write my own") { draftLine = line.text; editing = true }
            .foregroundStyle(Palette.purple)
        }
        .font(MayaFont.callout)
      } else {
        Button("Add a line about you") { draftLine = ""; editing = true }.font(MayaFont.callout).foregroundStyle(Palette.purple)
      }
    }

    ForEach(k.platforms) { p in
      HStack(spacing: 12) {
        PlatformBadge(platform: p.platform)
        Text([p.followers.map { "\(Format.count($0)) followers" }, p.typicalViews.map { "\(Format.count($0)) typical views" }, p.engagement.map { "\(String(format: "%.1f", $0 * 100))% engagement" }].compactMap { $0 }.joined(separator: " · "))
          .font(MayaFont.caption.monospacedDigit()).foregroundStyle(Palette.muted)
      }
    }

    if k.platforms.contains(where: \.hasAudience) {
      Toggle(isOn: Binding(get: { k.showAudience == true }, set: { on in Task { _ = await Actions.kitUpdate(["op": "audience", "on": on]) } })) {
        Text("Show who watches (age, gender, places)").font(MayaFont.callout)
      }
      .tint(Palette.purple)
    }

    if let s = k.link ?? legacyLink?.absoluteString, let url = URL(string: s) {
      HStack {
        SwiftUI.ShareLink(item: url) { Label("Share my kit", systemImage: "square.and.arrow.up") }.buttonStyle(.borderedProminent).tint(Palette.purple)
        Spacer()
        Button("Turn off") { Task { busy = true; _ = await Actions.mediaKitLink(on: false); legacyLink = nil; busy = false } }.disabled(busy).foregroundStyle(Palette.muted)
      }
    } else {
      Button { Task { busy = true; legacyLink = await Actions.mediaKitLink(on: true); busy = false } } label: { Label("Get my link", systemImage: "link") }.buttonStyle(.bordered).tint(Palette.purple).disabled(busy)
    }

    if !k.brandLinks.isEmpty {
      SectionHeader(text: "Made for a brand")
      ForEach(k.brandLinks.filter(\.live)) { b in
        HStack {
          Text(b.brand).font(MayaFont.callout).foregroundStyle(Palette.ink)
          if b.opened { Chip(text: "opened", color: Palette.ok) }
          Spacer()
          if let url = URL(string: b.url) { SwiftUI.ShareLink(item: url) { Image(systemName: "square.and.arrow.up") }.accessibilityLabel("Share the \(b.brand) link") }
        }
      }
    }
    Text("Your numbers come straight from your accounts. Never your rates.").font(MayaFont.caption).foregroundStyle(Palette.muted)
  }

  /// A photo small enough to send (the long side at most 1600 px), as JPEG. Resizing only; never edited.
  static func jpeg(_ data: Data) -> Data? {
    guard let image = UIImage(data: data) else { return nil }
    let scale = min(1, 1600 / max(image.size.width, image.size.height))
    let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
    let resized = UIGraphicsImageRenderer(size: size).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
    return resized.jpegData(compressionQuality: 0.85)
  }
}
