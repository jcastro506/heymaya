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

  func testTheCalendarLinkOpensTodayAndAsks() {
    XCTAssertEqual(Route.parse(URL(string: "https://hey-maya.ai/app/calendar")!), .calendar)
    XCTAssertEqual(Route.parse(URL(string: "https://staging.hey-maya.ai/app/calendar")!), .calendar)
    XCTAssertEqual(Route.parse(URL(string: "maya://app/calendar")!), .calendar)
  }
}
