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
    let result = apply(plan, in: store, into: target(in: store), memory: memory)
    memory = result.memory
    let written: [[String: ConvexEncodable?]] = result.written.map { ["id": $0.id, "eventId": $0.eventId] }
    let removed: [ConvexEncodable?] = result.removed
    struct R: Decodable { let ok: Bool }
    if !written.isEmpty || !removed.isEmpty {
      _ = try? await convex.mutation("calendar/device:synced", with: ["written": written.map { $0 as ConvexEncodable? }, "removed": removed]) as R
    }
    // What they changed in Calendar themselves: the plan follows it (and she says so) instead of the app undoing it.
    if !result.moved.isEmpty || !result.gone.isEmpty {
      let moved: [ConvexEncodable?] = result.moved.map { ["id": $0.id, "s": $0.start, "e": $0.end, "seen": $0.seen] as [String: ConvexEncodable?] }
      _ = try? await convex.mutation("calendar/device:changed", with: ["moved": moved, "gone": result.gone.map { $0 as ConvexEncodable? }]) as R
    }
    _ = try? await convex.mutation("calendar/device:events", with: ["events": upcoming().map { $0 as ConvexEncodable? }]) as R
  }

  /// What one session needs on this sync (2026-11-03). `last` is the time the app last wrote it: a different
  /// time on the phone means they moved it in Calendar; gone from the phone means they deleted it. Either
  /// counts only while the server still has what the app wrote; if she moved it since, the server wins.
  enum Change: Equatable { case write, moved(start: Double, end: Double), gone }

  static func change(server: (start: Double, end: Double), current: (start: Double, end: Double)?, last: (start: Double, end: Double)?) -> Change {
    guard let last else { return .write }
    let serverSame = abs(server.start - last.start) < 1_000 && abs(server.end - last.end) < 1_000
    guard let current else { return serverSame ? .gone : .write }
    let theyMoved = abs(current.start - last.start) >= 60_000 || abs(current.end - last.end) >= 60_000
    return theyMoved && serverSame ? .moved(start: current.start, end: current.end) : .write
  }

  static let maxGoneAtOnce = 2

  struct Result {
    var written: [(id: String, eventId: String)] = []
    var removed: [String] = []
    var moved: [(id: String, start: Double, end: Double, seen: Double)] = []
    var gone: [String] = []
    var memory: [String: [Double]] = [:]
  }

  /// The times the app last wrote, per session (ms). Lost memory only means a change isn't noticed once.
  private static let memoryKey = "calendar.written"
  static var memory: [String: [Double]] {
    get { (UserDefaults.standard.dictionary(forKey: memoryKey) as? [String: [Double]]) ?? [:] }
    set { UserDefaults.standard.set(newValue, forKey: memoryKey) }
  }

  /// Make the calendar match the plan: create or update each booked session, remove dropped ones, and notice
  /// the ones they moved or deleted. Returns what changed, for the server. Separate so it can be tested
  /// against a real event store.
  static func apply(_ plan: Plan, in store: EKEventStore, into calendar: EKCalendar? = nil, memory: [String: [Double]] = [:]) -> Result {
    let target = calendar ?? store.defaultCalendarForNewEvents
    var out = Result(memory: memory)
    let ms = { (d: Date) in d.timeIntervalSince1970 * 1000 }
    // An event whose id changed under us (a calendar sync can do that) is still hers by its marker.
    var byMarker: [String: EKEvent] = [:]
    if !plan.write.isEmpty {
      let now = Date.now
      let window = store.predicateForEvents(withStart: now.addingTimeInterval(-86_400), end: now.addingTimeInterval(60 * 86_400), calendars: nil)
      for e in store.events(matching: window) {
        if let u = e.url?.absoluteString, u.hasPrefix(marker) { byMarker[String(u.dropFirst(marker.count))] = e }
      }
    }
    func write(_ w: Plan.Write, over existing: EKEvent?) {
      let event = existing ?? EKEvent(eventStore: store)
      if let target, event.calendar?.calendarIdentifier != target.calendarIdentifier { event.calendar = target }
      guard event.calendar != nil else { return }
      event.title = w.title
      event.notes = w.notes
      event.startDate = Date(timeIntervalSince1970: w.start / 1000)
      event.endDate = Date(timeIntervalSince1970: w.end / 1000)
      event.url = URL(string: marker + w.id)
      do {
        try store.save(event, span: .thisEvent, commit: false)
        out.memory[w.id] = [w.start, w.end]
        // Moving to another calendar can give the event a new id; the server keeps whichever it has now.
        if let eid = event.eventIdentifier, existing == nil || w.eventId != eid { out.written.append((w.id, eid)) }
      } catch {
        print("[CalendarSync] save \(w.id): \(error)")
      }
    }
    var vanished: [Plan.Write] = []
    for w in plan.write {
      let existing = w.eventId.flatMap { store.event(withIdentifier: $0) } ?? byMarker[w.id]
      let current = existing.map { (start: ms($0.startDate), end: ms($0.endDate)) }
      let last = memory[w.id].flatMap { $0.count == 2 ? (start: $0[0], end: $0[1]) : nil }
      switch change(server: (w.start, w.end), current: current, last: last) {
      case .gone where w.eventId != nil:
        vanished.append(w)
        continue
      case .moved(let s, let e):
        out.moved.append((w.id, s, e, w.start))
        out.memory[w.id] = [s, e]
        if let eid = existing?.eventIdentifier, eid != w.eventId { out.written.append((w.id, eid)) }
        continue
      default:
        write(w, over: existing)
      }
    }
    // One or two gone is them deleting a session. More at once is a calendar that went away (an account taken
    // off the phone): put them back rather than cancel their week and text about each one.
    if vanished.count <= maxGoneAtOnce {
      for w in vanished { out.gone.append(w.id); out.memory[w.id] = nil }
    } else {
      for w in vanished { write(w, over: nil) }
    }
    for r in plan.remove {
      if let e = store.event(withIdentifier: r.eventId) ?? byMarker[r.id] { try? store.remove(e, span: .thisEvent, commit: false) }
      out.removed.append(r.id)
      out.memory[r.id] = nil
    }
    try? store.commit()
    return out
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
