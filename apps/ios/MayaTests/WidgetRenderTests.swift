import SwiftUI
import WidgetKit
import XCTest
@testable import Maya

/// The widget, checked without a simulator home screen: every family and state is rendered to a
/// PNG at the real widget size (iPhone 16/17 Pro points, @3x) in light, dark and tinted, into
/// /tmp/maya-widget-shots/ for a person to look at. The assertions are structural: each render
/// produced an image of the right size; the payload decodes, old and new.
@MainActor
final class WidgetRenderTests: XCTestCase {
  static let outDir = URL(fileURLWithPath: "/tmp/maya-widget-shots", isDirectory: true)

  enum Look: String { case light, dark, tinted }

  static let sizes: [WidgetFamily: CGSize] = [
    .systemSmall: CGSize(width: 170, height: 170),
    .systemMedium: CGSize(width: 364, height: 170),
    .systemLarge: CGSize(width: 364, height: 382),
    .accessoryRectangular: CGSize(width: 172, height: 76),
    .accessoryCircular: CGSize(width: 76, height: 76),
  ]

  override class func setUp() {
    try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
  }

  /// A widget as the home screen would draw it: background full-bleed, content inside the
  /// system's 16 pt margins, clipped to the widget's corner, on a wallpaper-ish surround.
  private func shot(_ name: String, _ family: WidgetFamily, _ entry: MayaEntry, look: Look = .light, blockFirst: Bool = false) {
    let size = Self.sizes[family]!
    let accessory = family == .accessoryCircular || family == .accessoryRectangular
    let content = MayaWidgetView(entry: entry, family: family, blockFirst: blockFirst)
    let view: AnyView
    if accessory {
      view = AnyView(
        content
          .foregroundStyle(.white)
          .environment(\.widgetRenderingMode, .vibrant)
          .frame(width: size.width, height: size.height)
          .padding(16)
          .background(LinearGradient(colors: [Color(hex: 0x1D2440), Color(hex: 0x4B3A6E)], startPoint: .top, endPoint: .bottom))
          .environment(\.colorScheme, .dark))
    } else {
      let tinted = look == .tinted
      view = AnyView(
        ZStack {
          if tinted {
            Color.white.opacity(0.14)
          } else {
            MayaWidgetBackground(entry: entry, family: family, blockFirst: blockFirst)
          }
          content
            .padding(16)
            .modifier(TintApproximation(on: tinted))
        }
        .frame(width: size.width, height: size.height)
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .environment(\.widgetRenderingMode, tinted ? .accented : .fullColor)
        .environment(\.colorScheme, look == .light ? .light : .dark)
        .padding(18)
        .background(look == .light ? Color(hex: 0xC9D6E8) : Color(hex: 0x10131F)))
    }
    let renderer = ImageRenderer(content: view)
    renderer.scale = 3
    guard let image = renderer.uiImage, let png = image.pngData() else { return XCTFail("\(name) did not render") }
    let pad: CGFloat = accessory ? 32 : 36
    XCTAssertEqual(image.size.width, size.width + pad, accuracy: 1, name)
    XCTAssertEqual(image.size.height, size.height + pad, accuracy: 1, name)
    let url = Self.outDir.appendingPathComponent("\(name)-\(look.rawValue).png")
    XCTAssertNoThrow(try png.write(to: url), name)
  }

  private func all(_ name: String, _ family: WidgetFamily, _ entry: MayaEntry, blockFirst: Bool = false, looks: [Look] = [.light, .dark]) {
    for look in looks { shot(name, family, entry, look: look, blockFirst: blockFirst) }
  }

  // Fixed "now" so day words are stable: a Wednesday afternoon.
  private let now = Date(timeIntervalSince1970: 1_790_000_000)

  func testFullWidgets() {
    let e = WidgetSamples.full(now: now)
    all("small-idea", .systemSmall, e, looks: [.light, .dark, .tinted])
    all("small-shoot", .systemSmall, e, blockFirst: true, looks: [.light, .dark, .tinted])
    all("medium", .systemMedium, e, looks: [.light, .dark, .tinted])
    all("large", .systemLarge, e, looks: [.light, .dark, .tinted])
    shot("lock-rect-idea", .accessoryRectangular, e)
    shot("lock-rect-shoot", .accessoryRectangular, e, blockFirst: true)
    shot("lock-circle", .accessoryCircular, e)
  }

  func testNoImages() {
    let e = WidgetSamples.full(now: now, covers: false)
    all("noimg-small", .systemSmall, e)
    all("noimg-medium", .systemMedium, e)
    all("noimg-large", .systemLarge, e)
  }

  func testLongWords() {
    let base = WidgetSamples.full(now: now)
    let d = base.data!
    let long = WidgetData(
      nextBlock: d.nextBlock.map { .init(kind: $0.kind, start: $0.start, end: $0.end, title: $0.title, hook: String(repeating: "the longest hook anyone ever wrote ", count: 3), ideaId: nil, booked: false) },
      blocks: d.blocks,
      bestIdea: .init(id: "x", hook: "when your coach says easy pace but your watch says you have been lying to yourself for six whole months", cover: nil, coverPlatform: "instagram",
                      fitWhy: "Your honest-training posts get saved twice as often as your race posts, and this one rides a sound that is climbing in your niche right now.", isNew: false),
      lastPosts: d.lastPosts.map { .init(id: $0.id, platform: $0.platform, createTime: $0.createTime, views: 1_234_567, multiple: 12.46, settled: false, cover: $0.cover) },
      newIdeas: 128, asOf: d.asOf)
    let e = MayaEntry(date: now, data: long, state: .ready, ideaCover: base.ideaCover, postCovers: base.postCovers)
    all("long-small", .systemSmall, e)
    all("long-small-shoot", .systemSmall, e, blockFirst: true)
    all("long-medium", .systemMedium, e)
    all("long-large", .systemLarge, e)
    shot("long-lock-rect", .accessoryRectangular, e)
    shot("long-lock-circle", .accessoryCircular, e)
  }

  func testPartialData() {
    let d = WidgetSamples.full(now: now).data!
    // No idea, only shoots; no posts; no multiples yet (fewer than five settled posts).
    let shootsOnly = WidgetData(nextBlock: d.nextBlock, blocks: d.blocks, bestIdea: nil, lastPosts: [], newIdeas: 0, asOf: d.asOf)
    all("shoots-only-small", .systemSmall, MayaEntry(date: now, data: shootsOnly, state: .ready))
    all("shoots-only-medium", .systemMedium, MayaEntry(date: now, data: shootsOnly, state: .ready))
    all("shoots-only-large", .systemLarge, MayaEntry(date: now, data: shootsOnly, state: .ready))
    let ideaOnly = WidgetData(nextBlock: nil, blocks: [], bestIdea: d.bestIdea, lastPosts: d.lastPosts.map { .init(id: $0.id, platform: $0.platform, createTime: $0.createTime, views: $0.views, multiple: nil, settled: $0.settled, cover: nil) }, newIdeas: 1, asOf: d.asOf)
    let stale = MayaEntry(date: now, data: ideaOnly, state: .ready, ideaCover: WidgetSamples.cover(.city), savedAt: now.addingTimeInterval(-3 * 3600))
    all("idea-only-medium", .systemMedium, stale)
    all("idea-only-large", .systemLarge, stale)
  }

  func testStates() {
    let out = MayaEntry(date: now, data: nil, state: .signedOut)
    let down = MayaEntry(date: now, data: nil, state: .unreachable)
    let empty = MayaEntry(date: now, data: WidgetData(nextBlock: nil, blocks: [], bestIdea: nil, lastPosts: [], newIdeas: 0, asOf: nil), state: .ready)
    for (name, e) in [("signedout", out), ("unreachable", down), ("empty", empty)] {
      all("\(name)-small", .systemSmall, e)
      all("\(name)-medium", .systemMedium, e)
      all("\(name)-large", .systemLarge, e)
    }
    shot("signedout-lock-rect", .accessoryRectangular, out)
    shot("signedout-lock-circle", .accessoryCircular, out)
  }

  /// The server's shape (convex/share.ts WidgetData) decodes; an older server without the new lists still does.
  func testPayloadDecodes() throws {
    let now = #"{"ok":true,"nextBlock":{"kind":"film","start":1790000000000,"end":1790003600000,"title":"x","hook":null,"ideaId":null,"booked":false},"blocks":[{"kind":"film","start":1790000000000,"end":1790003600000,"title":"x","hook":null,"ideaId":null,"booked":false}],"bestIdea":{"id":"i1","hook":"h","cover":null,"coverPlatform":null,"fitWhy":null,"isNew":true},"lastPosts":[{"id":"p","platform":"tiktok","createTime":1,"views":10,"multiple":null,"settled":true,"cover":null}],"newIdeas":2,"asOf":1}"#
    let d = try JSONDecoder().decode(WidgetData.self, from: Data(now.utf8))
    XCTAssertEqual(d.blocks.count, 1)
    XCTAssertNil(d.lastPosts[0].multiple)
    XCTAssertNil(d.bestIdea?.fitWhy)
    let old = #"{"ok":true,"nextBlock":{"kind":"film","start":1,"title":"x","hook":null,"ideaId":null,"booked":true},"bestIdea":{"id":"i","hook":"h","cover":null,"isNew":false},"newIdeas":0,"asOf":1}"#
    let o = try JSONDecoder().decode(WidgetData.self, from: Data(old.utf8))
    XCTAssertEqual(o.blocks.count, 1, "an older server's single block still shows")
    XCTAssertEqual(o.lastPosts, [])
  }

  func testLinksOpenTheRightScreen() {
    XCTAssertEqual(Route.parse(WidgetLinks.idea("abc")), .idea("abc"))
    XCTAssertEqual(Route.parse(WidgetLinks.post("p1")), .post("p1"))
    XCTAssertEqual(Route.parse(WidgetLinks.ideas), .tab(.ideas))
    XCTAssertEqual(Route.parse(WidgetLinks.today), .tab(.today))
  }

  func testCoversAreShrunk() throws {
    let big = try XCTUnwrap(WidgetSamples.cover(.dusk, width: 1080))
    let small = try XCTUnwrap(WidgetImages.downsample(big, maxPixel: 300))
    let img = try XCTUnwrap(UIImage(data: small))
    XCTAssertLessThanOrEqual(max(img.size.width, img.size.height) * img.scale, 300)
    XCTAssertNil(WidgetImages.downsample(Data("not an image".utf8), maxPixel: 300))
  }
}

/// A rough stand-in for iOS's tinted home screen: colour drained, content lifted to white.
private struct TintApproximation: ViewModifier {
  let on: Bool
  func body(content: Content) -> some View {
    if on { content.grayscale(1).brightness(0.15) } else { content }
  }
}
