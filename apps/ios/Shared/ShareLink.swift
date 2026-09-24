import Foundation

/// M5: what the app and the share extension share. The extension holds a creator-scoped share
/// token (minted by the server, rotatable), never the Clerk session and never a creator id.
///
/// ⚠️ Stored in the App Group's defaults for now. The spec wants the App Group keychain, which
/// needs a keychain access group under the Apple team id (not set up yet). Move it there with
/// the Apple Developer account; the token is revocable server-side either way.
enum ShareLink {
  static let appGroup = "group.ai.heymaya.maya"
  private static let key = "maya.shareToken"

  static var token: String? {
    get { UserDefaults(suiteName: appGroup)?.string(forKey: key) }
    set { UserDefaults(suiteName: appGroup)?.set(newValue, forKey: key) }
  }

  /// Convex serves HTTP actions from the `.convex.site` twin of the deployment URL.
  static func shareEndpoint(convexURL: String) -> URL? { endpoint(convexURL: convexURL, path: "/share") }

  /// M6: the widget reads its own data with the same token.
  static func widgetEndpoint(convexURL: String) -> URL? { endpoint(convexURL: convexURL, path: "/widget") }

  private static func endpoint(convexURL: String, path: String) -> URL? {
    guard var c = URLComponents(string: convexURL), let host = c.host else { return nil }
    c.host = host.replacingOccurrences(of: ".convex.cloud", with: ".convex.site")
    c.path = path
    return c.url
  }

  /// The first TikTok or Instagram post link anywhere in what was shared (apps share text with the link inside).
  static func postLink(in texts: [String]) -> (url: String, platform: String)? {
    let pattern = #"https?://(?:www\.|m\.|vm\.|vt\.)?(tiktok\.com|instagram\.com)/[^\s"'<>]+"#
    for t in texts {
      if let r = t.range(of: pattern, options: [.regularExpression, .caseInsensitive]) {
        let url = String(t[r])
        return (url, url.lowercased().contains("instagram") ? "Instagram" : "TikTok")
      }
    }
    return nil
  }
}
