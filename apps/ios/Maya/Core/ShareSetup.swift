import ConvexMobile
import Foundation

/// Mints the share extension's token once the creator is signed in, and forgets it on sign-out.
@MainActor
enum ShareSetup {
  private struct Minted: Decodable { let ok: Bool; let token: String? }

  static func ensureToken() async {
    guard !Fixtures.enabled, ShareLink.token == nil else { return }
    do {
      let r: Minted = try await convex.mutation("share:mintShareToken", with: [:])
      if r.ok, let t = r.token { ShareLink.token = t }
    } catch {
      print("[ShareSetup] mint: \(error)")
    }
  }

  static func forget() { ShareLink.token = nil }
}
