import ConvexMobile
import Foundation

/// Google Calendar, for people who live in it rather than the iPhone's calendar (2026-11-02; server side
/// `convex/calendar/oauth.ts` connectApp). Google's sign-in opens in the system sheet and comes back to the
/// app; from then on the server writes their sessions to Google and the phone stops adding its own copies.
@MainActor
enum GoogleCalendar {
  struct Status: Decodable, Equatable {
    let status: String
    let lastSyncedAt: Double?
    var connected: Bool { status == "connected" || status == "attention" }
    var needsReconnect: Bool { status == "needs_reconnect" }
  }

  /// Opens Google's sign-in and waits for the server to have the connection. Returns a problem to show, or nil.
  static func connect() async -> String? {
    if Fixtures.enabled { return nil }
    struct R: Decodable { let ok: Bool; let url: String?; let reason: String? }
    do {
      let r: R = try await convex.mutation("calendar/oauth:connectApp")
      guard r.ok, let url = r.url.flatMap(URL.init(string:)) else { return r.reason ?? "That didn't open. Try again in a moment." }
      await WebSheet.open(url)
    } catch {
      print("[GoogleCalendar] connect: \(error)")
      return "That didn't open. Try again in a moment."
    }
    // The connection lands a moment after Google hands back; closing the sheet early is fine too.
    for _ in 0..<8 {
      if await status()?.connected == true { return nil }
      try? await Task.sleep(for: .seconds(1))
    }
    return "Google Calendar didn't connect. Try again, or use your iPhone's calendar."
  }

  static func disconnect() async {
    if Fixtures.enabled { return }
    struct R: Decodable { let ok: Bool }
    _ = try? await convex.action("calendar/oauth:disconnect") as R
  }

  /// One read of the connection; nil before sign-in or when it can't be reached.
  static func status() async -> Status? {
    if Fixtures.enabled { return Status(status: "disconnected", lastSyncedAt: nil) }
    let stream = convex.subscribe(to: "calendar/oauth:status", yielding: Status?.self).values
    do {
      for try await next in stream { return next }
    } catch {
      print("[GoogleCalendar] status: \(error)")
    }
    return nil
  }
}
