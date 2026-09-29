import ClerkKit
import ConvexMobile
import SwiftUI
import WidgetKit

/// The one Convex client. Clerk's session is synced into it by `MayaAuthProvider` (the `convex`
/// token the server accepts), so every query runs as the signed-in creator and `me()` resolves them.
@MainActor
let convex: ConvexClientWithAuth<String> = {
  let provider = MayaAuthProvider()
  let client = ConvexClientWithAuth(deploymentUrl: Env.convexURL, authProvider: provider as any AuthProvider<String>)
  provider.bind(client: client)
  return client
}()

@main
struct MayaApp: App {
  init() {
    Clerk.configure(publishableKey: Env.clerkPublishableKey)
    #if DEBUG
    // Testing only (Debug builds): `-MayaShareToken <token>` stores a dev share token the way
    // sign-in does, so the share extension and widgets can be exercised against a test persona
    // without an account. Release builds don't contain this.
    if let token = UserDefaults.standard.string(forKey: "MayaShareToken"), token.count == 64 {
      ShareLink.token = token
      WidgetCenter.shared.reloadAllTimelines()
    }
    #endif
  }

  var body: some Scene {
    WindowGroup {
      RootView()
        .environment(Clerk.shared)
        .tint(Palette.purple)
    }
  }
}
