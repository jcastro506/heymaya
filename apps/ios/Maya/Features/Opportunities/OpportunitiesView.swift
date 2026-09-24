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
          Card {
            HStack {
              Text(o.brand).font(MayaFont.headline).foregroundStyle(Palette.ink)
              Spacer()
              Chip(text: DealType.label(o.type))
            }
            if !o.campaign.isEmpty { Text(o.campaign).font(MayaFont.callout).foregroundStyle(Palette.muted) }
            Text(o.fit).font(MayaFont.callout).foregroundStyle(Palette.ink).lineLimit(3)
            if !o.compensation.isEmpty { Text(o.compensation).font(MayaFont.caption).foregroundStyle(Palette.muted) }
          }
        }
      }
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
