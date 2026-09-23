import XCTest
@testable import Maya

/// The contract between convex/ui.ts and the app (spec §0 D1). Each fixture is a real output
/// captured from the creator dev deployment with `npx convex run ui:<name> --identity …`.
/// A renamed or retyped field on the server fails here, not on a creator's phone.
final class ContractTests: XCTestCase {
  private func load<T: Decodable>(_ name: String, as: T.Type) throws -> T {
    let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: name, withExtension: "json"))
    return try JSONDecoder().decode(T.self, from: Data(contentsOf: url))
  }

  func testToday() throws {
    let t = try load("today", as: Today.self)
    XCTAssertFalse(t.statusLine.isEmpty)
    XCTAssertEqual(t.week.count, 7)
    XCTAssertTrue(t.week.allSatisfy { $0.url.hasPrefix("https://") })
  }

  func testIdeas() throws {
    let ideas = try load("ideas", as: [Idea].self)
    XCTAssertFalse(ideas.isEmpty)
    XCTAssertTrue(ideas.allSatisfy { !$0.id.isEmpty && !$0.fitWhy.isEmpty })
  }

  func testSettings() throws {
    let s = try load("settings", as: CreatorSettings.self)
    XCTAssertNotNil(s.knows)
    XCTAssertEqual(s.tier, "solo")
  }

  func testPlan() throws { _ = try load("plan", as: Plan.self) }

  func testResults() throws {
    let r = try load("results", as: Results.self)
    XCTAssertFalse(r.rung.rung.isEmpty)
  }

  func testLane() throws {
    let l = try load("lane", as: Lane.self)
    XCTAssertFalse(l.accounts.isEmpty)
  }

  func testOpportunitiesLockedTeaserIsGrounded() throws {
    let o = try load("opportunities", as: Opportunities.self)
    XCTAssertFalse(o.unlocked)
    XCTAssertTrue(o.opportunities.isEmpty, "a locked plan never receives a pipeline")
    XCTAssertEqual(o.unlockTier, "partner")
    XCTAssertGreaterThanOrEqual(o.teaser.paidPostsInLane, o.teaser.accountsPaid)
  }

  func testNullMeansNoAccount() throws {
    // Every ui query returns null when the signed-in identity has no creator row.
    let t = try JSONDecoder().decode(Today?.self, from: Data("null".utf8))
    XCTAssertNil(t)
  }

  func testMessageSplitsIntoTextsWithoutLinksOrSeparators() {
    let parts = MessageText.bubbles("made me laugh.\n---\nit works because x.\n---\ntry it?\nhttps://www.tiktok.com/@a/video/1")
    XCTAssertEqual(parts, ["made me laugh.", "it works because x.", "try it?"])
    XCTAssertFalse(parts.joined().contains("http"))
    XCTAssertFalse(parts.joined().contains("---"))
  }

  func testEvidenceLabelNeverShowsARawLink() {
    XCTAssertEqual(EvidenceLabel.text("https://www.tiktok.com/@andi.renay/video/1"), "@andi.renay on TikTok")
    XCTAssertEqual(EvidenceLabel.text("https://www.instagram.com/reel/abc"), "A post on Instagram")
  }
}
