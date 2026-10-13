import Foundation

/// Which platforms are on (server: convex/config/platforms.ts). The app reads the flag from
/// `onboarding/start:progress` and `ui:settings`; the share extension can't ask the server, so
/// the app copies the last answer into the App Group. Missing means off: Instagram only shows
/// once a server has said it is on.
enum Platforms {
  private static let key = "maya.instagramEnabled"

  static var instagramEnabled: Bool {
    get { UserDefaults(suiteName: ShareLink.appGroup)?.bool(forKey: key) ?? false }
    set { UserDefaults(suiteName: ShareLink.appGroup)?.set(newValue, forKey: key) }
  }

  /// Remembers what the server said, when it said anything (an older server sends nothing).
  static func remember(_ instagram: Bool?) {
    guard let instagram, instagram != instagramEnabled else { return }
    instagramEnabled = instagram
  }

  /// The accounts onboarding offers to connect, in order. Pure.
  static func connectable(instagram: Bool) -> [String] {
    instagram ? ["instagram", "tiktok"] : ["tiktok"]
  }
}
