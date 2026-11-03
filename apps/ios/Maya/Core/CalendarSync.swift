import ConvexMobile
import EventKit
import Foundation

/// Their sessions on the iPhone's own calendar (2026-10-01; server side `convex/calendar/device.ts`).
/// Asked once, when there's something to put on it. EventKit writes to whatever calendar the phone
/// uses (iCloud, Google, Outlook) with no sign-in. The server says which booked sessions belong on it;
/// this makes it so whenever the app runs, and reports their upcoming events back (titles included) so
/// she plans around them and suggests content for the ones worth filming. The server keeps no title it
/// sorts as private (health, money, relationships; when in doubt).
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

  /// A calendar sessions can go on, named the way Calendar shows it ("Work", from "Gmail").
  struct Choice: Identifiable, Hashable { let id: String; let title: String; let account: String }

  private static let chosenKey = "calendar.writeId"

  /// Which calendar they picked for sessions (2026-11-02: the default is often iCloud, while they live in a
  /// Google calendar on the same phone). nil means the phone's default.
  static var chosenId: String? {
    get { UserDefaults.standard.string(forKey: chosenKey) }
    set { UserDefaults.standard.set(newValue, forKey: chosenKey) }
  }

  /// The calendars on this phone that can take a session, default first.
  static func writable() -> [Choice] {
    guard granted else { return [] }
    let def = store.defaultCalendarForNewEvents?.calendarIdentifier
    return store.calendars(for: .event)
      .filter(\.allowsContentModifications)
      .sorted { ($0.calendarIdentifier == def ? 0 : 1, $0.source.title, $0.title) < ($1.calendarIdentifier == def ? 0 : 1, $1.source.title, $1.title) }
      .map { Choice(id: $0.calendarIdentifier, title: $0.title, account: $0.source.title) }
  }

  /// Where sessions go: their pick while it still exists and takes events, else the phone's default.
  static func target(in store: EKEventStore) -> EKCalendar? {
    if let id = chosenId, let c = store.calendar(withIdentifier: id), c.allowsContentModifications { return c }
    return store.defaultCalendarForNewEvents
  }

  /// A new pick moves the sessions already on the phone to it.
  static func choose(_ id: String) async {
    chosenId = id
    await sync()
  }

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
    let result = apply(plan, in: store, into: target(in: store))
    let written: [[String: ConvexEncodable?]] = result.written.map { ["id": $0.id, "eventId": $0.eventId] }
    let removed: [ConvexEncodable?] = result.removed
    struct R: Decodable { let ok: Bool }
    if !written.isEmpty || !removed.isEmpty {
      _ = try? await convex.mutation("calendar/device:synced", with: ["written": written.map { $0 as ConvexEncodable? }, "removed": removed]) as R
    }
    _ = try? await convex.mutation("calendar/device:events", with: ["events": upcoming().map { $0 as ConvexEncodable? }]) as R
  }

  /// Make the calendar match the plan: create or update each booked session, remove dropped ones.
  /// Returns what changed, for the server. Separate so it can be tested against a real event store.
  static func apply(_ plan: Plan, in store: EKEventStore, into calendar: EKCalendar? = nil) -> (written: [(id: String, eventId: String)], removed: [String]) {
    let target = calendar ?? store.defaultCalendarForNewEvents
    var written: [(id: String, eventId: String)] = []
    for w in plan.write {
      let existing = w.eventId.flatMap { store.event(withIdentifier: $0) }
      let event = existing ?? EKEvent(eventStore: store)
      if let target, event.calendar?.calendarIdentifier != target.calendarIdentifier { event.calendar = target }
      guard event.calendar != nil else { continue }
      event.title = w.title
      event.notes = w.notes
      event.startDate = Date(timeIntervalSince1970: w.start / 1000)
      event.endDate = Date(timeIntervalSince1970: w.end / 1000)
      event.url = URL(string: marker + w.id)
      do {
        try store.save(event, span: .thisEvent, commit: false)
        // Moving to another calendar can give the event a new id; the server keeps whichever it has now.
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

  /// The next three weeks of their real life. Maya's own sessions and events marked free are left out.
  private static func upcoming() -> [[String: ConvexEncodable?]] {
    let now = Date.now
    let predicate = store.predicateForEvents(withStart: now, end: now.addingTimeInterval(21 * 86_400), calendars: nil)
    return store.events(matching: predicate)
      .filter { !($0.url?.absoluteString.hasPrefix(marker) ?? false) && $0.availability != .free }
      .prefix(300)
      .map { ["id": $0.calendarItemIdentifier + "@" + String(Int($0.startDate.timeIntervalSince1970)), "title": String(($0.title ?? "").prefix(120)), "s": $0.startDate.timeIntervalSince1970 * 1000, "e": $0.endDate.timeIntervalSince1970 * 1000, "allDay": $0.isAllDay, "recurring": $0.hasRecurrenceRules] }
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
