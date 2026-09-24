import ClerkConvex
import ClerkKit
import ConvexMobile
import SwiftUI

/// The one Convex client. Clerk's session is synced into it by `ClerkConvexAuthProvider`,
/// so every query runs as the signed-in creator and `me()` on the server resolves them.
@MainActor
let convex = ConvexClientWithAuth(
  deploymentUrl: Env.convexURL,
  authProvider: ClerkConvexAuthProvider()
)

@main
struct MayaApp: App {
  init() {
    Clerk.configure(publishableKey: Env.clerkPublishableKey)
  }

  var body: some Scene {
    WindowGroup {
      RootView()
        .environment(Clerk.shared)
        .tint(Palette.purple)
    }
  }
}
