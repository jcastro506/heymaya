import ConvexMobile
import Foundation

/// Plan changes go to Stripe's hosted pages (link-out, spec §11.2). The proper in-app upgrade
/// for an existing subscriber — Stripe's subscription-update flow with proration — is M4
/// (spec §11.1); until then a subscriber is sent to the billing portal to switch plans.
@MainActor
enum Billing {
  private struct UrlResult: Decodable {
    let ok: Bool
    let url: String?
    let reason: String?
  }

  /// A Stripe page to unlock `tier`: Checkout for a new subscriber, the portal otherwise.
  static func unlockURL(tier: String) async -> URL? {
    do {
      let checkout: UrlResult = try await convex.action(
        "billing/checkout:createCheckout", with: ["interval": "monthly", "tier": tier, "returnTo": "settings"])
      if checkout.ok, let u = checkout.url { return URL(string: u) }
      return await portalURL()
    } catch {
      print("[Billing] checkout: \(error)")
      return nil
    }
  }

  static func portalURL() async -> URL? {
    do {
      let portal: UrlResult = try await convex.action("billing/checkout:openPortal")
      return portal.url.flatMap(URL.init(string:))
    } catch {
      print("[Billing] portal: \(error)")
      return nil
    }
  }
}
