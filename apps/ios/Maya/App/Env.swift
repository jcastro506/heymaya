import Foundation

/// Build-time configuration from Config/*.xcconfig, read through Info.plist.
enum Env {
  static let convexURL = value("MayaConvexURL")
  static let clerkPublishableKey = value("MayaClerkPublishableKey")

  private static func value(_ key: String) -> String {
    guard let v = Bundle.main.object(forInfoDictionaryKey: key) as? String, !v.isEmpty else {
      fatalError("\(key) is missing from Info.plist; set it in Config/*.xcconfig")
    }
    return v
  }
}
