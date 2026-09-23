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
