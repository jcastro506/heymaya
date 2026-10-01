import ConvexMobile
import EventKit
import Foundation

/// Their sessions on the iPhone's own calendar (2026-10-01; server side `convex/calendar/device.ts`).
/// Asked once, when there's something to put on it. EventKit writes to whatever calendar the phone
/// uses (iCloud, Google, Outlook) with no sign-in. The server says which booked sessions belong on it;
/// this makes it so whenever the app runs, and reports busy times back: start and end only, never
/// what the event is.
@MainActor
enum CalendarSync {
  private static let store = EKEventStore()
  /// Our events carry this in their URL, so busy times never count Maya's own sessions.
  private static let marker = "maya://session/"

  struct Plan: Decodable, Equatable {
    struct Write: Decodable, Equatable { let id: String; let title: String; let notes: String; let start: Double; let end: Double; let eventId: String? }
    struct Remove: Decodable, Equatable { let id: String; let eventId: String }
    let status: String?
    let write: [Write]
    let remove: [Remove]
  }

  static var granted: Bool { EKEventStore.authorizationStatus(for: .event) == .fullAccess }

  /// The permission prompt, then a first sync. Returns whether they said yes.
  @discardableResult
  static func connect() async -> Bool {
    if Fixtures.enabled { return true }
    let ok = (try? await store.requestFullAccessToEvents()) ?? false
    struct R: Decodable { let ok: Bool }
    _ = try? await convex.mutation("calendar/device:setStatus", with: ["status": ok ? "granted" : "denied"]) as R
    if ok { await sync() }
    return ok
  }

  /// Make the phone's calendar match the server, and report busy times. Quiet when not granted.
  static func sync() async {
    guard !Fixtures.enabled, granted else { return }
    guard let plan = await firstValue() else { return }
    let result = apply(plan, in: store)
    let written: [[String: ConvexEncodable?]] = result.written.map { ["id": $0.id, "eventId": $0.eventId] }
    let removed: [ConvexEncodable?] = result.removed
    struct R: Decodable { let ok: Bool }
    if !written.isEmpty || !removed.isEmpty {
      _ = try? await convex.mutation("calendar/device:synced", with: ["written": written.map { $0 as ConvexEncodable? }, "removed": removed]) as R
    }
    _ = try? await convex.mutation("calendar/device:busy", with: ["windows": busyWindows().map { $0 as ConvexEncodable? }]) as R
  }

  /// Make the calendar match the plan: create or update each booked session, remove dropped ones.
  /// Returns what changed, for the server. Separate so it can be tested against a real event store.
  static func apply(_ plan: Plan, in store: EKEventStore) -> (written: [(id: String, eventId: String)], removed: [String]) {
    var written: [(id: String, eventId: String)] = []
    for w in plan.write {
      let existing = w.eventId.flatMap { store.event(withIdentifier: $0) }
      let event = existing ?? EKEvent(eventStore: store)
      if existing == nil { event.calendar = store.defaultCalendarForNewEvents }
      guard event.calendar != nil else { continue }
      event.title = w.title
      event.notes = w.notes
      event.startDate = Date(timeIntervalSince1970: w.start / 1000)
      event.endDate = Date(timeIntervalSince1970: w.end / 1000)
      event.url = URL(string: marker + w.id)
      do {
        try store.save(event, span: .thisEvent, commit: false)
        if let eid = event.eventIdentifier, existing == nil || w.eventId != eid { written.append((w.id, eid)) }
      } catch {
        print("[CalendarSync] save \(w.id): \(error)")
      }
    }
    var removed: [String] = []
    for r in plan.remove {
      if let e = store.event(withIdentifier: r.eventId) { try? store.remove(e, span: .thisEvent, commit: false) }
      removed.append(r.id)
    }
    try? store.commit()
    return (written, removed)
  }

  /// The next three weeks of their real life, as start/end only. All-day events and Maya's own are left out.
  private static func busyWindows() -> [[String: ConvexEncodable?]] {
    let now = Date.now
    let predicate = store.predicateForEvents(withStart: now, end: now.addingTimeInterval(21 * 86_400), calendars: nil)
    return store.events(matching: predicate)
      .filter { !$0.isAllDay && !($0.url?.absoluteString.hasPrefix(marker) ?? false) && $0.availability != .free }
      .prefix(300)
      .map { ["s": $0.startDate.timeIntervalSince1970 * 1000, "e": $0.endDate.timeIntervalSince1970 * 1000] }
  }

  private static func firstValue() async -> Plan? {
    let stream = convex.subscribe(to: "calendar/device:plan", yielding: Plan?.self).values
    do {
      for try await next in stream { return next }
    } catch {
      print("[CalendarSync] plan: \(error)")
    }
    return nil
  }
}
