import ConvexMobile
import Foundation
import UIKit

/// The app's writes. Each is a server mutation the chat path can also reach (spec §1 rule 1).
@MainActor
enum Actions {
  static func markPosted(ideaId: String) async -> Bool {
    await ok("taste/events:markPosted", ["ideaId": ideaId])
  }

  static func passIdea(ideaId: String) async -> Bool {
    await ok("ui:passIdea", ["id": ideaId])
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
