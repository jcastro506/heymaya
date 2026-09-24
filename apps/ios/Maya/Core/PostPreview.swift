import Foundation

/// What a public post looks like, from TikTok's oEmbed endpoint (no key, meant for embedding).
/// Instagram's oEmbed needs an app token, so IG and unknown links get a designed fallback
/// until post covers are stored server-side (audit doc: image storage).
struct PostPreview: Equatable, Sendable {
  let thumbnail: URL?
  let author: String?
  let handle: String?
  let title: String?
  let platform: Platform

  enum Platform: String, Sendable { case tiktok, instagram, other }

  static func platform(of url: String) -> Platform {
    if url.contains("tiktok.com") { return .tiktok }
    if url.contains("instagram.com") { return .instagram }
    return .other
  }

  /// "@andi.renay" from the URL, when it carries one.
  static func handle(of url: String) -> String? {
    guard let r = url.range(of: #"tiktok\.com/@([^/?]+)"#, options: .regularExpression) else { return nil }
    return String(url[r]).replacingOccurrences(of: "tiktok.com/", with: "")
  }
}

actor PostPreviews {
  static let shared = PostPreviews()
  private var cache: [String: PostPreview] = [:]
  private var inFlight: [String: Task<PostPreview, Never>] = [:]

  func preview(for url: String) async -> PostPreview {
    if let hit = cache[url] { return hit }
    if let running = inFlight[url] { return await running.value }
    let task = Task { await Self.fetch(url) }
    inFlight[url] = task
    let value = await task.value
    cache[url] = value
    inFlight[url] = nil
    return value
  }

  private struct OEmbed: Decodable {
    let thumbnail_url: String?
    let author_name: String?
    let author_unique_id: String?
    let title: String?
  }

  private static func fetch(_ url: String) async -> PostPreview {
    let platform = PostPreview.platform(of: url)
    let fallback = PostPreview(thumbnail: nil, author: nil, handle: PostPreview.handle(of: url), title: nil, platform: platform)
    guard platform == .tiktok,
      var components = URLComponents(string: "https://www.tiktok.com/oembed")
    else { return fallback }
    components.queryItems = [URLQueryItem(name: "url", value: url)]
    guard let endpoint = components.url else { return fallback }
    do {
      let (data, response) = try await URLSession.shared.data(from: endpoint)
      guard (response as? HTTPURLResponse)?.statusCode == 200 else { return fallback }
      let o = try JSONDecoder().decode(OEmbed.self, from: data)
      return PostPreview(
        thumbnail: o.thumbnail_url.flatMap(URL.init(string:)),
        author: o.author_name,
        handle: o.author_unique_id.map { "@\($0)" } ?? fallback.handle,
        title: o.title,
        platform: platform)
    } catch {
      return fallback
    }
  }
}
