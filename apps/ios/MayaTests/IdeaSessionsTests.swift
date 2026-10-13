import XCTest
@testable import Maya

/// Today's "Coming up" shows one row per idea (2026-10-13: a tester saw the same idea three times).
final class IdeaSessionsTests: XCTestCase {
  private func b(_ id: String, _ kind: String, _ title: String, _ start: Double, idea: String?, status: String = "proposed") -> PlanBlock {
    PlanBlock(id: id, kind: kind, title: title, start: start, end: start + 1, status: status, onCalendar: false, ideaId: idea)
  }

  func testAnIdeasFilmEditAndPostAreOneRow() {
    let blocks = [
      b("3", "post", "post: coffee walk fit check", 300, idea: "i1"),
      b("1", "film", "film: coffee walk fit check", 100, idea: "i1"),
      b("2", "edit", "edit: coffee walk fit check", 200, idea: "i1"),
      b("4", "film", "film: jewelry stack", 400, idea: "i2", status: "confirmed"),
    ]
    let g = IdeaSessions.group(blocks, time: { "t\(Int($0))" })
    XCTAssertEqual(g.map(\.title), ["coffee walk fit check", "jewelry stack"])
    XCTAssertEqual(g[0].when, "Film t100 · Edit t200 · Post t300")
    XCTAssertEqual(g[0].firstStart, 100)
    XCTAssertTrue(g[0].waiting)
    XCTAssertFalse(g[1].waiting)
  }

  func testWithoutAnIdeaTheHookGroupsThem() {
    let g = IdeaSessions.group([b("1", "film", "film: Same Hook", 1, idea: nil), b("2", "post", "post: same hook", 2, idea: nil)], time: { _ in "t" })
    XCTAssertEqual(g.count, 1)
  }
}
