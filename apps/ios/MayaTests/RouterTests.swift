import XCTest
@testable import Maya

/// Links from Maya's texts must land on the right screen; anything else lands safely (spec §6.7).
final class RouterTests: XCTestCase {
  private func r(_ s: String) -> Route? { Route.parse(URL(string: s)!) }

  func testObjectLinks() {
    XCTAssertEqual(r("https://hey-maya.ai/o/idea/jx7abc"), .idea("jx7abc"))
    XCTAssertEqual(r("https://hey-maya.ai/o/post/kh7def"), .post("kh7def"))
    XCTAssertEqual(r("maya://o/idea/jx7abc"), .idea("jx7abc"))
  }

  func testLegacyTabLinksFromOlderMessages() {
    XCTAssertEqual(r("https://hey-maya.ai/app/ideas"), .tab(.ideas))
    XCTAssertEqual(r("https://hey-maya.ai/app/lane"), .tab(.you))
    XCTAssertEqual(r("https://hey-maya.ai/app/results"), .tab(.today))
    XCTAssertEqual(r("https://hey-maya.ai/app/settings"), .tab(.you))
  }

  func testMalformedAndForeignLinksAreSafe() {
    XCTAssertEqual(r("https://hey-maya.ai/o/idea/"), .tab(.today))
    XCTAssertEqual(r("https://hey-maya.ai/o/weird/1"), .tab(.today))
    XCTAssertNil(r("https://evil.com/o/idea/1"))
    XCTAssertNil(r("https://hey-maya.ai.evil.com/o/idea/1"))
    XCTAssertNil(r("https://evilhey-maya.ai/o/idea/1"))
    XCTAssertEqual(r("https://www.hey-maya.ai/o/idea/1"), .idea("1"))
  }
}

/// M5: the share extension finds the post link inside what TikTok and Instagram actually share.
final class ShareLinkTests: XCTestCase {
  func testFindsPostLinkInSharedText() {
    let tt = ShareLink.postLink(in: ["Check out Noah's video! #TikTok https://vm.tiktok.com/ZMabc123/ "])
    XCTAssertEqual(tt?.platform, "TikTok")
    XCTAssertEqual(tt?.url, "https://vm.tiktok.com/ZMabc123/")
    let ig = ShareLink.postLink(in: ["https://www.instagram.com/reel/DcRIKq6xDpQ/?igsh=abc"])
    XCTAssertEqual(ig?.platform, "Instagram")
    XCTAssertNil(ShareLink.postLink(in: ["https://youtube.com/watch?v=1", "no link here"]))
  }

  func testShareEndpointIsTheSiteTwin() {
    XCTAssertEqual(ShareLink.shareEndpoint(convexURL: "https://impressive-roadrunner-997.convex.cloud")?.absoluteString, "https://impressive-roadrunner-997.convex.site/share")
  }
}
