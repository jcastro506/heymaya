import EventKit
import XCTest
@testable import Maya

/// The iPhone calendar, against a real event store (calendar access granted to the test simulator with
/// `xcrun simctl privacy <device> grant calendar ai.heymaya.maya`; skipped where it isn't).
@MainActor
final class CalendarSyncTests: XCTestCase {
  func testCreatesUpdatesAndRemovesTheirSessions() throws {
    let store = EKEventStore()
    try XCTSkipUnless(EKEventStore.authorizationStatus(for: .event) == .fullAccess, "calendar access not granted on this simulator")
    let start = Date.now.addingTimeInterval(86_400).timeIntervalSince1970 * 1000
    let first = CalendarSync.Plan(status: "granted", write: [.init(id: "blk1", title: "film: night pan", notes: "hook: …", start: start, end: start + 3_600_000, eventId: nil)], remove: [])
    let made = CalendarSync.apply(first, in: store)
    XCTAssertEqual(made.written.count, 1)
    let eventId = made.written[0].eventId
    let event = try XCTUnwrap(store.event(withIdentifier: eventId))
    XCTAssertEqual(event.title, "film: night pan")
    XCTAssertEqual(event.url?.absoluteString, "maya://session/blk1", "marked as hers, so busy times skip it")

    // Moved an hour later on the server: the same event moves; nothing new is created.
    let moved = CalendarSync.Plan(status: "granted", write: [.init(id: "blk1", title: "film: night pan", notes: "hook: …", start: start + 3_600_000, end: start + 7_200_000, eventId: eventId)], remove: [])
    XCTAssertTrue(CalendarSync.apply(moved, in: store).written.isEmpty)
    XCTAssertEqual(store.event(withIdentifier: eventId)?.startDate.timeIntervalSince1970 ?? 0, (start + 3_600_000) / 1000, accuracy: 1)

    // Dropped: it comes off their calendar.
    let dropped = CalendarSync.Plan(status: "granted", write: [], remove: [.init(id: "blk1", eventId: eventId)])
    XCTAssertEqual(CalendarSync.apply(dropped, in: store).removed, ["blk1"])
    XCTAssertNil(store.event(withIdentifier: eventId))
  }

  /// The calendar they picked (often a Google one on the phone, not the iCloud default) gets the sessions,
  /// and a new pick moves the ones already there.
  func testSessionsGoOnTheCalendarTheyPicked() throws {
    let store = EKEventStore()
    try XCTSkipUnless(EKEventStore.authorizationStatus(for: .event) == .fullAccess, "calendar access not granted on this simulator")
    let source = try XCTUnwrap(store.defaultCalendarForNewEvents?.source)
    let picked = EKCalendar(for: .event, eventStore: store)
    picked.title = "Picked"
    picked.source = source
    try store.saveCalendar(picked, commit: true)
    defer { try? store.removeCalendar(picked, commit: true) }

    let start = Date.now.addingTimeInterval(2 * 86_400).timeIntervalSince1970 * 1000
    let plan = CalendarSync.Plan(status: "granted", write: [.init(id: "blk2", title: "film: x", notes: "", start: start, end: start + 3_600_000, eventId: nil)], remove: [])
    let made = CalendarSync.apply(plan, in: store, into: picked)
    let eventId = try XCTUnwrap(made.written.first?.eventId)
    XCTAssertEqual(store.event(withIdentifier: eventId)?.calendar.calendarIdentifier, picked.calendarIdentifier)

    let back = CalendarSync.Plan(status: "granted", write: [.init(id: "blk2", title: "film: x", notes: "", start: start, end: start + 3_600_000, eventId: eventId)], remove: [])
    let moved = CalendarSync.apply(back, in: store, into: store.defaultCalendarForNewEvents)
    let now = moved.written.first?.eventId ?? eventId
    XCTAssertEqual(store.event(withIdentifier: now)?.calendar.calendarIdentifier, store.defaultCalendarForNewEvents?.calendarIdentifier)
    _ = CalendarSync.apply(.init(status: "granted", write: [], remove: [.init(id: "blk2", eventId: now)]), in: store)
  }

  // MARK: - They moved or deleted a session in Calendar (2026-11-03)

  func testWhatEachSessionNeeds() {
    let s = 1_800_000_000_000.0, h = 3_600_000.0
    // Never written by us (or memory lost): the server's times.
    XCTAssertEqual(CalendarSync.change(server: (s, s + h), current: (s + 2 * h, s + 3 * h), last: nil), .write)
    // Untouched: write (a no-op).
    XCTAssertEqual(CalendarSync.change(server: (s, s + h), current: (s, s + h), last: (s, s + h)), .write)
    // They dragged it two hours later: report it.
    XCTAssertEqual(CalendarSync.change(server: (s, s + h), current: (s + 2 * h, s + 3 * h), last: (s, s + h)), .moved(start: s + 2 * h, end: s + 3 * h))
    // They stretched it (end only): still theirs.
    XCTAssertEqual(CalendarSync.change(server: (s, s + h), current: (s, s + 2 * h), last: (s, s + h)), .moved(start: s, end: s + 2 * h))
    // Under a minute of drift is not a move.
    XCTAssertEqual(CalendarSync.change(server: (s, s + h), current: (s + 30_000, s + h + 30_000), last: (s, s + h)), .write)
    // She moved it by text since the app wrote it: the server wins, whatever the phone shows.
    XCTAssertEqual(CalendarSync.change(server: (s + 5 * h, s + 6 * h), current: (s + 2 * h, s + 3 * h), last: (s, s + h)), .write)
    // Gone from the phone: deleted, unless she moved it since (then it's written fresh).
    XCTAssertEqual(CalendarSync.change(server: (s, s + h), current: nil, last: (s, s + h)), .gone)
    XCTAssertEqual(CalendarSync.change(server: (s + 5 * h, s + 6 * h), current: nil, last: (s, s + h)), .write)
  }

  func testADragInCalendarIsReportedNotUndone() throws {
    let store = EKEventStore()
    try XCTSkipUnless(EKEventStore.authorizationStatus(for: .event) == .fullAccess, "calendar access not granted on this simulator")
    // Whole seconds, like real sessions: Calendar keeps times to the second.
    let start = Date.now.addingTimeInterval(86_400).timeIntervalSince1970.rounded() * 1000
    let w = { (eventId: String?, s: Double) in CalendarSync.Plan.Write(id: "blk-mv", title: "film: x", notes: "", start: s, end: s + 3_600_000, eventId: eventId) }
    let first = CalendarSync.apply(.init(status: "granted", write: [w(nil, start)], remove: []), in: store)
    let eventId = try XCTUnwrap(first.written.first?.eventId)
    XCTAssertEqual(first.memory["blk-mv"], [start, start + 3_600_000])
    defer { _ = CalendarSync.apply(.init(status: "granted", write: [], remove: [.init(id: "blk-mv", eventId: eventId)]), in: store) }

    // They drag it two hours later in Calendar.
    let event = try XCTUnwrap(store.event(withIdentifier: eventId))
    event.startDate = event.startDate.addingTimeInterval(7_200)
    event.endDate = event.endDate.addingTimeInterval(7_200)
    try store.save(event, span: .thisEvent, commit: true)

    let next = CalendarSync.apply(.init(status: "granted", write: [w(eventId, start)], remove: []), in: store, memory: first.memory)
    XCTAssertEqual(next.moved.count, 1)
    XCTAssertEqual(next.moved[0].start, start + 7_200_000, accuracy: 1)
    XCTAssertEqual(next.moved[0].seen, start)
    XCTAssertEqual(store.event(withIdentifier: eventId)?.startDate.timeIntervalSince1970 ?? 0, (start + 7_200_000) / 1000, accuracy: 1, "their drag stays")

    // The server took it; the next plan carries the new time and nothing is reported again.
    let after = CalendarSync.apply(.init(status: "granted", write: [w(eventId, start + 7_200_000)], remove: []), in: store, memory: next.memory)
    XCTAssertTrue(after.moved.isEmpty)
    XCTAssertTrue(after.gone.isEmpty)
  }

  func testADeleteInCalendarIsReportedOnce() throws {
    let store = EKEventStore()
    try XCTSkipUnless(EKEventStore.authorizationStatus(for: .event) == .fullAccess, "calendar access not granted on this simulator")
    let start = Date.now.addingTimeInterval(2 * 86_400).timeIntervalSince1970 * 1000
    let w = CalendarSync.Plan.Write(id: "blk-del", title: "film: y", notes: "", start: start, end: start + 3_600_000, eventId: nil)
    let first = CalendarSync.apply(.init(status: "granted", write: [w], remove: []), in: store)
    let eventId = try XCTUnwrap(first.written.first?.eventId)
    try store.remove(try XCTUnwrap(store.event(withIdentifier: eventId)), span: .thisEvent, commit: true)

    let again = CalendarSync.Plan.Write(id: "blk-del", title: "film: y", notes: "", start: start, end: start + 3_600_000, eventId: eventId)
    let next = CalendarSync.apply(.init(status: "granted", write: [again], remove: []), in: store, memory: first.memory)
    XCTAssertEqual(next.gone, ["blk-del"])
    XCTAssertTrue(next.written.isEmpty, "not put back")
    XCTAssertNil(next.memory["blk-del"])
  }

  func testACalendarThatWentAwayIsPutBackNotCancelled() throws {
    let store = EKEventStore()
    try XCTSkipUnless(EKEventStore.authorizationStatus(for: .event) == .fullAccess, "calendar access not granted on this simulator")
    let start = Date.now.addingTimeInterval(3 * 86_400).timeIntervalSince1970 * 1000
    let ids = ["lost1", "lost2", "lost3"]
    let writes = ids.enumerated().map { CalendarSync.Plan.Write(id: $1, title: "film: \($1)", notes: "", start: start + Double($0) * 7_200_000, end: start + Double($0) * 7_200_000 + 3_600_000, eventId: nil) }
    let first = CalendarSync.apply(.init(status: "granted", write: writes, remove: []), in: store)
    XCTAssertEqual(first.written.count, 3)
    for (_, eid) in first.written { try store.remove(try XCTUnwrap(store.event(withIdentifier: eid)), span: .thisEvent, commit: true) }

    let again = writes.map { w in CalendarSync.Plan.Write(id: w.id, title: w.title, notes: "", start: w.start, end: w.end, eventId: first.written.first { $0.id == w.id }?.eventId) }
    let next = CalendarSync.apply(.init(status: "granted", write: again, remove: []), in: store, memory: first.memory)
    XCTAssertTrue(next.gone.isEmpty, "three at once is a lost calendar, not three deletes")
    XCTAssertEqual(next.written.count, 3, "put back")
    _ = CalendarSync.apply(.init(status: "granted", write: [], remove: next.written.map { .init(id: $0.id, eventId: $0.eventId) }), in: store)
  }

  func testTheCalendarLinkOpensTodayAndAsks() {
    XCTAssertEqual(Route.parse(URL(string: "https://hey-maya.ai/app/calendar")!), .calendar)
    XCTAssertEqual(Route.parse(URL(string: "https://staging.hey-maya.ai/app/calendar")!), .calendar)
    XCTAssertEqual(Route.parse(URL(string: "maya://app/calendar")!), .calendar)
  }
}
