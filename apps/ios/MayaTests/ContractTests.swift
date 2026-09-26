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
    XCTAssertTrue(t.week.allSatisfy { $0.cover?.hasPrefix("https://") == true }, "every recent post carries its stored cover")
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
    XCTAssertNotNil(s.avatars?.tiktok, "their own avatar is stored")
  }

  func testPlan() throws { _ = try load("plan", as: Plan.self) }

  /// P1: the plans screen decodes the real query output; prices are strings from the server.
  func testPlans() throws {
    let p = try load("plans", as: Plans.self)
    XCTAssertEqual(p.tiers.map(\.tier), ["solo", "duo", "partner"])
    XCTAssertTrue(p.tiers.allSatisfy { $0.monthly.hasPrefix("$") })
    XCTAssertEqual(p.current.tier, "duo")
  }

  func testResults() throws {
    let r = try load("results", as: Results.self)
    XCTAssertFalse(r.rung.rung.isEmpty)
  }

  func testLane() throws {
    let l = try load("lane", as: Lane.self)
    XCTAssertFalse(l.accounts.isEmpty)
    XCTAssertTrue(l.accounts.allSatisfy { $0.avatar != nil }, "watched accounts carry their avatars")
  }

  /// K1: the Deals tab's kit card decodes ui:kit (the server test kitApp.test.ts keeps this fixture's shape true).
  func testKit() throws {
    let k = try load("kit", as: KitInfo.self)
    XCTAssertEqual(k.platforms.map(\.platform), ["instagram", "tiktok"])
    XCTAssertEqual(k.oneLine?.approved, false, "a proposed line waits for their yes")
    XCTAssertTrue(k.brandLinks.allSatisfy { $0.url.contains("/k/") })
    XCTAssertNil(k.showAudience, "not asked yet")
  }

  func testOpportunitiesLockedTeaserIsGrounded() throws {
    let o = try load("opportunities", as: Opportunities.self)
    XCTAssertFalse(o.unlocked)
    XCTAssertTrue(o.opportunities.isEmpty, "a locked plan never receives a pipeline")
    XCTAssertEqual(o.unlockTier, "partner")
    XCTAssertGreaterThanOrEqual(o.teaser.paidPostsInLane, o.teaser.accountsPaid)
  }

  func testAnalyticsConnectedBothPlatforms() throws {
    let a = try load("analytics", as: Analytics.self)
    XCTAssertEqual(Set(a.accounts.map(\.platform)), ["tiktok", "instagram"])
    XCTAssertTrue(a.posts.allSatisfy { ["connected", "public"].contains($0.headline.basis) })
  }

  func testAnalyticsAccountCards() throws {
    for name in ["analytics", "preview.analytics"] {
      let a = try load(name, as: Analytics.self)
      for acct in a.accounts {
        if acct.platform == "tiktok" {
          XCTAssertNil(acct.profile, "\(name): TikTok has no account-level profile numbers")
          XCTAssertNil(acct.audience, "\(name): TikTok has no account-level audience")
        }
        if let g = acct.growth {
          XCTAssertFalse(g.days.isEmpty)
          XCTAssertEqual(g.days.map(\.day), g.days.map(\.day).sorted(), "\(name): days oldest first")
        }
        if let au = acct.audience {
          XCTAssertTrue(InsightsWords.statuses.contains(au.status))
          for s in au.gender + au.age + au.countries + au.cities { XCTAssertTrue((0...1).contains(s.share)) }
          XCTAssertLessThanOrEqual(au.gender.map(\.share).reduce(0, +), 1.001)
        }
        if let p = acct.profile { XCTAssertTrue(InsightsWords.statuses.contains(p.status)) }
      }
      let ig = try XCTUnwrap(a.accounts.first { $0.platform == "instagram" })
      XCTAssertEqual(ig.audience?.status, "ok", "\(name) shows the Who follows you card")
      XCTAssertEqual(ig.profile?.status, "ok", "\(name) shows the From your profile card")
    }
  }

  func testEveryEmptyCardSaysWhy() {
    for s in InsightsWords.statuses where s != "ok" {
      XCTAssertFalse(InsightsWords.profileEmpty(s).isEmpty)
      XCTAssertFalse(InsightsWords.audienceEmpty(s).isEmpty)
    }
    XCTAssertNotEqual(InsightsWords.audienceEmpty("too_few_followers"), InsightsWords.audienceEmpty("not_connected"))
    XCTAssertNotEqual(InsightsWords.growthEmpty(connected: true, platform: "tiktok"), InsightsWords.growthEmpty(connected: false, platform: "tiktok"))
  }

  func testTikTokPostNeverShowsWatchTime() throws {
    let n = try load("post.tiktok", as: PostNumbers.self)
    let labels = MetricTile.tiles(for: n).map(\.label)
    XCTAssertFalse(labels.contains("watched on average"))
    XCTAssertFalse(labels.contains("left in the first 3s"))
    XCTAssertFalse(n.cannotKnow.isEmpty)
  }

  func testInstagramPostShowsConnectedReach() throws {
    let n = try load("post.instagram", as: PostNumbers.self)
    XCTAssertEqual(n.headline.basis, "connected")
    XCTAssertTrue(MetricTile.tiles(for: n).map(\.label).contains("people reached"))
  }

  func testPublicOnlyPostShowsOnlyPublicCounts() throws {
    let n = try load("post.public", as: PostNumbers.self)
    XCTAssertNil(n.connected)
    XCTAssertFalse(MetricTile.tiles(for: n).map(\.label).contains("people reached"))
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
