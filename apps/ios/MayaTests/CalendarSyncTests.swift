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

  func testTheCalendarLinkOpensTodayAndAsks() {
    XCTAssertEqual(Route.parse(URL(string: "https://hey-maya.ai/app/calendar")!), .calendar)
    XCTAssertEqual(Route.parse(URL(string: "https://staging.hey-maya.ai/app/calendar")!), .calendar)
    XCTAssertEqual(Route.parse(URL(string: "maya://app/calendar")!), .calendar)
  }
}
