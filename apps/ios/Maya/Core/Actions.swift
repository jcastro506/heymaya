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

  /// B6: their public media-kit page. On returns the link (the same one each time); off kills it.
  static func mediaKitLink(on: Bool) async -> URL? {
    struct R: Decodable { let url: String? }
    if Fixtures.enabled { return on ? URL(string: "https://hey-maya.ai/k/fixturekit01") : nil }
    do {
      let r: R = try await convex.mutation("partnerships/kitPage:kitLink", with: ["on": on])
      Haptics.success()
      return r.url.flatMap(URL.init(string:))
    } catch {
      print("[Actions] kitLink: \(error)")
      Haptics.warning()
      return nil
    }
  }

  static func restoreIdea(ideaId: String) async -> Bool {
    await ok("ui:restoreIdea", ["id": ideaId])
  }

  static func saveIdea(ideaId: String, saved: Bool = true) async -> Bool {
    await ok("ui:saveIdea", ["id": ideaId, "saved": saved])
  }

  /// K1: a change to their media kit (the one line, the audience switch, the photo), the same function a text uses.
  static func kitUpdate(_ args: [String: ConvexEncodable?]) async -> Bool {
    await ok("partnerships/kitSettings:appUpdate", args)
  }

  /// K1: a photo of them for the kit, from their library. Uploaded to storage, then set; never edited.
  static func uploadKitPhoto(_ jpeg: Data) async -> Bool {
    if Fixtures.enabled {
      Haptics.success()
      return true
    }
    do {
      let target: String = try await convex.mutation("partnerships/kitSettings:photoUploadUrl", with: [:])
      guard let url = URL(string: target) else { return false }
      var request = URLRequest(url: url)
      request.httpMethod = "POST"
      request.setValue("image/jpeg", forHTTPHeaderField: "Content-Type")
      let (body, _) = try await URLSession.shared.upload(for: request, from: jpeg)
      struct Uploaded: Decodable { let storageId: String }
      let up = try JSONDecoder().decode(Uploaded.self, from: body)
      return await ok("partnerships/kitSettings:appUpdate", ["op": "photo_upload", "storageId": up.storageId])
    } catch {
      print("[Actions] kit photo: \(error)")
      Haptics.warning()
      return false
    }
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
