import ConvexMobile
import Foundation
import UIKit
import WidgetKit

/// The app's writes. Each is a server mutation the chat path can also reach (spec §1 rule 1).
@MainActor
enum Actions {
  static func markPosted(ideaId: String) async -> Bool {
    await ok("taste/events:markPosted", ["ideaId": ideaId])
  }

  static func passIdea(ideaId: String) async -> Bool {
    await ok("ui:passIdea", ["id": ideaId])
  }

  /// N1: these were on screen; she won't bring them up in Messages as new. Quiet: no haptic.
  static func markIdeasSeen(_ ids: [String]) async {
    guard !ids.isEmpty, !Fixtures.enabled else { return }
    struct R: Decodable { let ok: Bool }
    _ = try? await convex.mutation("ui:markIdeasSeen", with: ["ids": ids.map { $0 as ConvexEncodable? }]) as R
  }

  /// Ask Maya (§7.4): she'll know what they tapped for ten minutes; Messages opens with a draft.
  static func askMaya(kind: String, id: String) async {
    Haptics.tap()
    guard !Fixtures.enabled else { return }
    struct R: Decodable { let ok: Bool; let url: String? }
    guard let r: R = try? await convex.mutation("share:askMaya", with: ["kind": kind, "id": id]), r.ok,
          let s = r.url, let url = URL(string: s) else { return }
    await UIApplication.shared.open(url)
  }

  /// B6: "I submitted it" on an application (the same record as telling her in Messages).
  static func markApplied(id: String) async -> Bool {
    await ok("ui:markApplied", ["id": id])
  }

  static func restoreIdea(ideaId: String) async -> Bool {
    await ok("ui:restoreIdea", ["id": ideaId])
  }

  static func saveIdea(ideaId: String, saved: Bool = true) async -> Bool {
    await ok("ui:saveIdea", ["id": ideaId, "saved": saved])
  }

  static func revokeRule(id: String) async -> Bool {
    await ok("ui:revokeRule", ["id": id])
  }

  private struct OkResult: Decodable { let ok: Bool }

  private static func ok(_ name: String, _ args: [String: ConvexEncodable?]) async -> Bool {
    if Fixtures.enabled {
      Haptics.success()
      return true
    }
    do {
      let r: OkResult = try await convex.mutation(name, with: args)
      Haptics.success()
      WidgetCenter.shared.reloadAllTimelines() // the home-screen widgets show ideas and blocks
      return r.ok
    } catch {
      print("[Actions] \(name): \(error)")
      Haptics.warning()
      return false
    }
  }
}

enum Haptics {
  @MainActor static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
  @MainActor static func warning() { UINotificationFeedbackGenerator().notificationOccurred(.warning) }
  @MainActor static func tap() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
}
