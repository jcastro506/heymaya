import Foundation

/// TikTok only (2026-11-13). The app once read an Instagram switch from the server; Instagram is gone from the
/// product, so nothing here reads or offers it.
enum Platforms {
  /// The accounts onboarding offers to connect.
  static let connectable = ["tiktok"]
}
