import SafariServices
import SwiftUI

/// Stripe's hosted pages open in-app, with Apple Pay available, and return here on close.
struct SafariSheet: UIViewControllerRepresentable {
  let url: URL
  func makeUIViewController(context: Context) -> SFSafariViewController { SFSafariViewController(url: url) }
  func updateUIViewController(_ vc: SFSafariViewController, context: Context) {}
}

extension URL: @retroactive Identifiable {
  public var id: String { absoluteString }
}
