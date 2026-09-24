import SwiftUI

/// P1: every plan, theirs marked, from the server (no price lives in the app). Switching goes to
/// Stripe's plan-change confirmation (proration shown) or Checkout; the new plan shows up here on
/// its own when Stripe's webhook lands, because this screen is watching the server.
struct PlanView: View {
  @State private var plans = Live<Plans?>("ui:plans")
  @State private var sheet: URL?
  @State private var busy: String?
  @State private var note: String?

  var body: some View {
    List {
      switch plans.state {
      case .loading: Section { ProgressView() }
      case .failed(let m): Section { Text(m).foregroundStyle(Palette.muted) }
      case .value(nil): Section { Text("Sign in to see your plan.").foregroundStyle(Palette.muted) }
      case .value(let p?):
        Section {
          VStack(alignment: .leading, spacing: 6) {
            Text(p.tiers.first { $0.tier == p.current.tier }?.label ?? p.current.tier.capitalized).font(MayaFont.title)
            Text(statusLine(p.current)).font(MayaFont.callout).foregroundStyle(Palette.muted)
          }
          .padding(.vertical, 4)
        } header: { Text("Your plan") }

        Section {
          ForEach(p.tiers) { t in
            PlanRow(tier: t, isCurrent: t.tier == p.current.tier, busy: busy == t.tier) {
              Task { await change(to: t.tier) }
            }
          }
        } header: { Text("Plans") } footer: {
          Text("Change or cancel any time. A switch is prorated, so you only pay the difference.")
        }

        if p.current.subscribed {
          Section {
            Button {
              Task { busy = "portal"; sheet = await Billing.portalURL(); busy = nil }
            } label: {
              HStack { Text("Card, invoices and cancelling"); Spacer(); if busy == "portal" { ProgressView() } }
            }
          }
        }
        if let note { Section { Text(note).font(MayaFont.caption).foregroundStyle(Palette.muted) } }
      }
    }
    .scrollContentBackground(.hidden)
    .background(Palette.ground)
    .navigationTitle("Plan")
    .navigationBarTitleDisplayMode(.inline)
    .task { await plans.run() }
    .sheet(item: $sheet) { SafariSheet(url: $0).ignoresSafeArea() }
  }

  private func change(to tier: String) async {
    guard !Fixtures.enabled else { note = "Preview mode: plans can't change here."; return }
    busy = tier
    let r = await Billing.change(tier: tier)
    busy = nil
    if let url = r.url { sheet = url } else { note = r.reason }
  }

  private func statusLine(_ c: Plans.Current) -> String {
    switch c.status {
    case "trialing": return c.trialEndsAt.map { "Free until \(Format.day($0)), then billed monthly." } ?? "On your free week."
    case "active": return c.renewsAt.map { "Renews \(Format.day($0))." } ?? "Active."
    case "past_due": return "Your last payment didn't go through. Update your card below."
    case "canceled": return "Cancelled. Pick a plan to start again."
    case "paused": return "Paused."
    case "comped": return "On the house."
    default: return c.status.capitalized
    }
  }
}

private struct PlanRow: View {
  let tier: Plans.Tier
  let isCurrent: Bool
  let busy: Bool
  let choose: () -> Void

  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      VStack(alignment: .leading, spacing: 4) {
        HStack(spacing: 6) {
          Text(tier.label).font(MayaFont.headline)
          if isCurrent { Chip(text: "Yours") }
        }
        Text("\(tier.monthly) a month · \(tier.annual) a year").font(MayaFont.callout.monospacedDigit()).foregroundStyle(Palette.ink)
        Text(tier.blurb).font(MayaFont.caption).foregroundStyle(Palette.muted)
      }
      Spacer()
      if !isCurrent {
        Button(action: choose) {
          if busy { ProgressView() } else { Text("Switch") }
        }
        .buttonStyle(.bordered)
        .accessibilityLabel("Switch to \(tier.label)")
      }
    }
    .padding(.vertical, 4)
  }
}

struct Plans: Decodable, Equatable {
  struct Current: Decodable, Equatable { let tier: String; let status: String; let trialEndsAt: Double?; let renewsAt: Double?; let subscribed: Bool; let partnershipsOpen: Bool }
  struct Tier: Decodable, Identifiable, Equatable { let tier: String; let label: String; let blurb: String; let monthly: String; let annual: String; let accounts: Int; let partnerships: Bool; var id: String { tier } }
  let current: Current
  let tiers: [Tier]
}
