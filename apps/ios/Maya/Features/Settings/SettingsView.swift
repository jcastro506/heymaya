import SwiftUI

/// The account side of Maya, behind the gear on You: how she texts you, your accounts,
/// your plan, sign out.
struct SettingsView: View {
  let settings: CreatorSettings
  @State private var confirmSignOut = false
  @State private var portal: URL?
  @State private var busy = false

  var body: some View {
    List {
      Section("How she texts you") {
        row("Quiet hours", "\(settings.quietHours.start)–\(settings.quietHours.end)")
        row("Tone", settings.tone.capitalized)
        row("Time zone", settings.timezone.replacingOccurrences(of: "_", with: " "))
      }
      Section("Your accounts") {
        if let tiktok = settings.handles.tiktok { row("TikTok", "@\(tiktok)") }
        if let ig = settings.handles.instagram { row("Instagram", "@\(ig)") }
      }
      Section("Plan") {
        row("Plan", settings.tier.capitalized)
        Button {
          Task { await openPortal() }
        } label: {
          HStack {
            Text("Manage plan and billing")
            Spacer()
            if busy { ProgressView() }
          }
        }
        .disabled(Fixtures.enabled || busy)
      }
      Section {
        if Fixtures.enabled {
          Text("Preview mode: sign-in is skipped, so there's nothing to sign out of.")
            .font(MayaFont.caption).foregroundStyle(Palette.muted)
        } else {
          Button("Sign out", role: .destructive) { confirmSignOut = true }
        }
      } footer: {
        Text("Signing out only signs this app out. She keeps working and texting you.")
      }
    }
    .scrollContentBackground(.hidden)
    .background(Palette.ground)
    .navigationTitle("Settings")
    .navigationBarTitleDisplayMode(.inline)
    .confirmationDialog("Sign out of Maya on this phone?", isPresented: $confirmSignOut, titleVisibility: .visible) {
      Button("Sign out", role: .destructive) { Task { await SessionActions.signOut() } }
    }
    .sheet(item: $portal) { SafariSheet(url: $0).ignoresSafeArea() }
  }

  private func openPortal() async {
    busy = true
    portal = await Billing.portalURL()
    busy = false
  }

  private func row(_ label: String, _ value: String) -> some View {
    LabeledContent(label, value: value)
  }
}

@MainActor
enum SessionActions {
  /// Through the Convex client, so its auth state flips to signed-out (and RootView shows
  /// the welcome screen) as well as ending the Clerk session.
  static func signOut() async {
    ShareSetup.forget() // the share extension stops sending as them
    await convex.logout()
  }
}
