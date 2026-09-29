import AuthenticationServices
import UIKit

/// Stripe Checkout and the Instagram/TikTok connect pages, opened in the system's sign-in sheet
/// (Apple Pay and saved passwords work there). Our return page sends `maya://…`, which closes the
/// sheet by itself; closing it by hand is fine too, because each onboarding step watches the
/// server for the result instead of trusting this callback.
@MainActor
enum WebSheet {
  private static var session: ASWebAuthenticationSession?
  private static let anchor = Anchor()

  /// Returns the `maya://` URL it came back with, or nil if they closed it.
  @discardableResult
  static func open(_ url: URL) async -> URL? {
    await withCheckedContinuation { done in
      let s = ASWebAuthenticationSession(url: url, callbackURLScheme: "maya") { back, _ in
        session = nil
        done.resume(returning: back)
      }
      s.presentationContextProvider = anchor
      s.prefersEphemeralWebBrowserSession = false // keep them signed in to Instagram, TikTok, Google
      session = s
      if !s.start() {
        session = nil
        done.resume(returning: nil)
      }
    }
  }

  private final class Anchor: NSObject, ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
      MainActor.assumeIsolated {
        UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows).first { $0.isKeyWindow } ?? ASPresentationAnchor()
      }
    }
  }
}
