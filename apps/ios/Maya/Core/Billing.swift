import ConvexMobile
import Foundation

/// Plan changes go to Stripe's hosted pages (link-out, spec §11.2): Stripe's plan-change
/// confirmation for a subscriber (proration shown), Checkout for anyone else (P1).
@MainActor
enum Billing {
  private struct UrlResult: Decodable {
    let ok: Bool
    let url: String?
    let reason: String?
  }

  /// A Stripe page to unlock `tier`: Checkout for a new subscriber, the portal otherwise.
  static func unlockURL(tier: String) async -> URL? { await change(tier: tier).url }

  /// P1: switch plans. Stripe's plan-change confirmation for a subscriber, Checkout otherwise;
  /// both return to the app. The new tier arrives from the webhook, not from this call.
  static func change(tier: String) async -> (url: URL?, reason: String?) {
    do {
      let r: UrlResult = try await convex.action("billing/checkout:changePlan", with: ["tier": tier])
      return r.ok ? (r.url.flatMap(URL.init(string:)), nil) : (nil, r.reason)
    } catch {
      print("[Billing] change: \(error)")
      return (nil, "Couldn't reach billing. Try again in a moment.")
    }
  }

  static func portalURL() async -> URL? {
    do {
      let portal: UrlResult = try await convex.action("billing/checkout:openPortal", with: ["returnTo": "app"])
      return portal.url.flatMap(URL.init(string:))
    } catch {
      print("[Billing] portal: \(error)")
      return nil
    }
  }
}
