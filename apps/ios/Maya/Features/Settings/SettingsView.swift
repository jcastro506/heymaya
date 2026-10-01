import EventKit
import SwiftUI

/// The account side of Maya, behind the gear on You: how she texts you, your accounts,
/// your plan, sign out, delete your account.
struct SettingsView: View {
  let settings: CreatorSettings
  @State private var confirmSignOut = false
  @State private var confirmDelete = false
  @State private var deleting = false
  @State private var deleteProblem: String?

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
      Section {
        CalendarRow()
      } header: {
        Text("Your calendar")
      } footer: {
        Text("She puts the sessions you book on your iPhone's calendar, plans around your week, and suggests content for things worth filming, like a trip or a race. Anything personal stays private.")
      }
      Section("Plan") {
        NavigationLink { PlanView() } label: { LabeledContent("Your plan", value: settings.tier.capitalized) }
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
      if !Fixtures.enabled {
        Section {
          Button(role: .destructive) { confirmDelete = true } label: {
            HStack {
              Text("Delete account")
              if deleting { Spacer(); ProgressView() }
            }
          }
          .disabled(deleting)
        } footer: {
          Text(deleteProblem ?? "Cancels your plan and deletes everything she has: your posts as she read them, every idea, every message, your calendar and your notes. This can't be undone.")
        }
      }
    }
    .scrollContentBackground(.hidden)
    .background(Palette.ground)
    .navigationTitle("Settings")
    .navigationBarTitleDisplayMode(.inline)
    .confirmationDialog("Sign out of Maya on this phone?", isPresented: $confirmSignOut, titleVisibility: .visible) {
      Button("Sign out", role: .destructive) { Task { await SessionActions.signOut() } }
    }
    .confirmationDialog("Delete your Maya account?", isPresented: $confirmDelete, titleVisibility: .visible) {
      Button("Delete everything", role: .destructive) {
        Task {
          deleting = true
          deleteProblem = await SessionActions.deleteAccount()
          deleting = false
        }
      }
    } message: {
      Text("Your plan is cancelled and everything is deleted. She'll send one last text, then she's gone.")
    }
  }

  private func row(_ label: String, _ value: String) -> some View {
    LabeledContent(label, value: value)
  }
}

/// The iPhone calendar: on, off (in iPhone Settings), or not asked yet.
private struct CalendarRow: View {
  @State private var granted = CalendarSync.granted
  @State private var asked = EKEventStore.authorizationStatus(for: .event) != .notDetermined
  @Environment(\.openURL) private var openURL

  var body: some View {
    if granted {
      LabeledContent("Calendar", value: "On")
    } else if asked {
      Button("Turn on in iPhone Settings") { if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) } }
    } else {
      Button("Add my sessions to my calendar") {
        Task { granted = await CalendarSync.connect(); asked = true }
      }
    }
  }
}

@MainActor
enum SessionActions {
  /// Through the Convex client, so its auth state flips to signed-out (and RootView shows
  /// the welcome screen) as well as ending the Clerk session.
  static func signOut() async {
    ShareSetup.forget() // the share extension stops sending as them
    // The skipped-step marks belong to this person, not the phone.
    for key in ["connectSeen", "watchSeen", "meetSkipped"] { UserDefaults.standard.removeObject(forKey: "onboarding.\(key)") }
    await convex.logout()
  }

  /// Deletion runs on the server (cancel the plan, disconnect everything, purge every row, then the
  /// sign-in itself); the app signs out as soon as it's accepted. Returns a problem to show, or nil.
  static func deleteAccount() async -> String? {
    struct R: Decodable { let ok: Bool; let reason: String? }
    do {
      let r: R = try await convex.mutation("account/deletion:requestDelete", with: ["confirm": "DELETE"])
      guard r.ok else { return "That didn't go through: \(r.reason ?? "try again in a moment")." }
      await signOut()
      return nil
    } catch {
      print("[Settings] delete: \(error)")
      return "That didn't go through. Check your connection and try again."
    }
  }
}
