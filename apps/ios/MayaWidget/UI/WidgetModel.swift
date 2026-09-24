import Foundation
import ImageIO
import UniformTypeIdentifiers
import WidgetKit

/// What `GET /widget` returns (convex/share.ts `widgetData`). Every field is a stored fact;
/// null means the server doesn't know, and the widget says nothing rather than a zero.
/// Compiled into the widget extension AND the app, so the app's tests can render the views.
struct WidgetData: Codable, Equatable {
  struct Block: Codable, Equatable {
    let kind: String
    let start: Double
    let end: Double?
    let title: String
    let hook: String?
    let ideaId: String?
    let booked: Bool
  }
  struct Idea: Codable, Equatable {
    let id: String
    let hook: String
    let cover: String?
    let coverPlatform: String?
    let fitWhy: String?
    let isNew: Bool
  }
  struct Post: Codable, Equatable {
    let id: String
    let platform: String
    let createTime: Double
    let views: Double
    let multiple: Double?
    let settled: Bool
    let cover: String?
  }
  let nextBlock: Block?
  let blocks: [Block]
  let bestIdea: Idea?
  let lastPosts: [Post]
  let newIdeas: Int
  let asOf: Double?

  init(nextBlock: Block?, blocks: [Block], bestIdea: Idea?, lastPosts: [Post], newIdeas: Int, asOf: Double?) {
    self.nextBlock = nextBlock; self.blocks = blocks; self.bestIdea = bestIdea
    self.lastPosts = lastPosts; self.newIdeas = newIdeas; self.asOf = asOf
  }

  /// Tolerant of an older server that doesn't send the newer lists yet.
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    nextBlock = try c.decodeIfPresent(Block.self, forKey: .nextBlock)
    blocks = try c.decodeIfPresent([Block].self, forKey: .blocks) ?? nextBlock.map { [$0] } ?? []
    bestIdea = try c.decodeIfPresent(Idea.self, forKey: .bestIdea)
    lastPosts = try c.decodeIfPresent([Post].self, forKey: .lastPosts) ?? []
    newIdeas = try c.decodeIfPresent(Int.self, forKey: .newIdeas) ?? 0
    asOf = try c.decodeIfPresent(Double.self, forKey: .asOf)
  }
}

enum WidgetState: Equatable {
  case ready
  case signedOut
  /// Couldn't reach the server and there is nothing saved to show.
  case unreachable
}

struct MayaEntry: TimelineEntry {
  let date: Date
  let data: WidgetData?
  let state: WidgetState
  /// Downsampled JPEG bytes, fetched by the provider (views can't load URLs).
  var ideaCover: Data? = nil
  var postCovers: [String: Data] = [:]
  /// When the data is a saved copy because the last refresh failed, how old it is.
  var savedAt: Date? = nil
}

/// Links into the app (apps/ios/Maya/App/Router.swift parses these).
enum WidgetLinks {
  static let today = URL(string: "maya://app/today")!
  static let ideas = URL(string: "maya://app/ideas")!
  static func idea(_ id: String) -> URL { URL(string: "maya://o/idea/\(id)") ?? ideas }
  static func post(_ id: String) -> URL { URL(string: "maya://o/post/\(id)") ?? today }
  static func block(_ b: WidgetData.Block) -> URL { b.ideaId.map(idea) ?? today }
}

/// Words for times and numbers, kept here so every size says them the same way.
enum WidgetWords {
  static func day(_ ms: Double, now: Date = .now, calendar: Calendar = .current) -> String {
    let d = Date(timeIntervalSince1970: ms / 1000)
    if calendar.isDate(d, inSameDayAs: now) { return "Today" }
    if let t = calendar.date(byAdding: .day, value: 1, to: now), calendar.isDate(d, inSameDayAs: t) { return "Tomorrow" }
    return d.formatted(.dateTime.weekday(.abbreviated))
  }

  /// "6 PM" on the hour, "6:30 PM" otherwise.
  static func time(_ ms: Double, calendar: Calendar = .current) -> String {
    let d = Date(timeIntervalSince1970: ms / 1000)
    return calendar.component(.minute, from: d) == 0 ? d.formatted(.dateTime.hour()) : d.formatted(date: .omitted, time: .shortened)
  }

  static func when(_ ms: Double, now: Date = .now) -> String { "\(day(ms, now: now)) \(time(ms))" }

  /// "Tue 6 PM" (or "Today 6 PM"): for where "Tomorrow" doesn't fit.
  static func shortWhen(_ ms: Double, now: Date = .now, calendar: Calendar = .current) -> String {
    let d = Date(timeIntervalSince1970: ms / 1000)
    let day = calendar.isDate(d, inSameDayAs: now) ? "Today" : d.formatted(.dateTime.weekday(.abbreviated))
    return "\(day) \(time(ms))"
  }

  static func multiple(_ m: Double) -> String {
    "\(m.formatted(.number.precision(.fractionLength(0...1))))×"
  }

  static func count(_ n: Double) -> String {
    n.formatted(.number.notation(.compactName).precision(.fractionLength(0...1)))
  }

  static func newIdeas(_ n: Int) -> String { n == 1 ? "1 new idea" : "\(n) new ideas" }
}

/// Covers for the widget: fetched with a timeout and a byte cap, then shrunk before they
/// reach an entry (a widget has about 30 MB, and an oversized image fails to render at all).
enum WidgetImages {
  static let maxBytes = 3_000_000
  static let timeout: TimeInterval = 8

  static func fetch(_ urlString: String?, maxPixel: Int, session: URLSession = .shared) async -> Data? {
    guard let s = urlString, let url = URL(string: s), url.scheme == "https" || url.scheme == "http" else { return nil }
    var req = URLRequest(url: url, cachePolicy: .returnCacheDataElseLoad, timeoutInterval: timeout)
    req.setValue("image/*", forHTTPHeaderField: "accept")
    guard let (data, response) = try? await session.data(for: req),
          (response as? HTTPURLResponse)?.statusCode == 200,
          data.count <= maxBytes else { return nil }
    return downsample(data, maxPixel: maxPixel)
  }

  /// JPEG bytes no larger than `maxPixel` on the long side, or nil if it isn't an image.
  static func downsample(_ data: Data, maxPixel: Int) -> Data? {
    guard let src = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary) else { return nil }
    let opts: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceShouldCacheImmediately: true,
      kCGImageSourceThumbnailMaxPixelSize: maxPixel,
    ]
    guard let cg = CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary) else { return nil }
    let out = NSMutableData()
    guard let dest = CGImageDestinationCreateWithData(out, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
    CGImageDestinationAddImage(dest, cg, [kCGImageDestinationLossyCompressionQuality: 0.8] as CFDictionary)
    return CGImageDestinationFinalize(dest) ? out as Data : nil
  }
}
