import SwiftUI
import WidgetKit

/// M6, redesigned: the widgets fetch their own data with the creator's share token every 30
/// minutes, so they stay current without push. Covers are downloaded here (views can't load
/// URLs), shrunk, and handed to the entry. The last good answer is kept in the App Group so a
/// failed refresh shows it with its age instead of going blank. Views: UI/WidgetViews.swift.

struct Provider: TimelineProvider {
  private static let savedKey = "maya.widget.lastGood"
  private static let savedAtKey = "maya.widget.lastGoodAt"

  func placeholder(in context: Context) -> MayaEntry { WidgetSamples.placeholder }

  func getSnapshot(in context: Context, completion: @escaping (MayaEntry) -> Void) {
    if context.isPreview { completion(WidgetSamples.full()); return }
    Task { completion(await entry(for: context.family)) }
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<MayaEntry>) -> Void) {
    Task {
      let e = await entry(for: context.family)
      completion(Timeline(entries: [e], policy: .after(.now.addingTimeInterval(30 * 60))))
    }
  }

  private func entry(for family: WidgetFamily) async -> MayaEntry {
    let (data, state, savedAt) = await fetchData()
    guard let data else { return MayaEntry(date: .now, data: nil, state: state) }
    var e = MayaEntry(date: .now, data: data, state: .ready, savedAt: savedAt)
    // Only the images this size shows; accessory families show none.
    switch family {
    case .systemSmall, .systemMedium:
      e.ideaCover = await WidgetImages.fetch(data.bestIdea?.cover, maxPixel: 480)
    case .systemLarge, .systemExtraLarge:
      async let idea = WidgetImages.fetch(data.bestIdea?.cover, maxPixel: 320)
      var posts: [String: Data] = [:]
      await withTaskGroup(of: (String, Data?).self) { group in
        for p in data.lastPosts.prefix(3) { group.addTask { (p.id, await WidgetImages.fetch(p.cover, maxPixel: 300)) } }
        for await (id, d) in group { if let d { posts[id] = d } }
      }
      e.ideaCover = await idea
      e.postCovers = posts
    default:
      break
    }
    return e
  }

  private func fetchData() async -> (WidgetData?, WidgetState, Date?) {
    guard let token = ShareLink.token,
          let convexURL = Bundle.main.object(forInfoDictionaryKey: "MayaConvexURL") as? String,
          let url = ShareLink.widgetEndpoint(convexURL: convexURL) else { return (nil, .signedOut, nil) }
    var req = URLRequest(url: url, timeoutInterval: 15)
    req.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
    let defaults = UserDefaults(suiteName: ShareLink.appGroup)
    if let (body, response) = try? await URLSession.shared.data(for: req), let http = response as? HTTPURLResponse {
      if http.statusCode == 401 { defaults?.removeObject(forKey: Self.savedKey); return (nil, .signedOut, nil) }
      if http.statusCode == 200, let decoded = try? JSONDecoder().decode(WidgetData.self, from: body) {
        defaults?.set(body, forKey: Self.savedKey)
        defaults?.set(Date.now.timeIntervalSince1970, forKey: Self.savedAtKey)
        return (decoded, .ready, nil)
      }
    }
    // Offline or a server hiccup: the last good answer, labelled with its age, for up to a day.
    if let saved = defaults?.data(forKey: Self.savedKey),
       let at = defaults?.double(forKey: Self.savedAtKey), Date.now.timeIntervalSince1970 - at < 86_400,
       let decoded = try? JSONDecoder().decode(WidgetData.self, from: saved) {
      return (decoded, .ready, Date(timeIntervalSince1970: at))
    }
    return (nil, .unreachable, nil)
  }
}

/// Wires the family and the container background into the shared views.
struct WidgetRoot: View {
  let entry: MayaEntry
  var blockFirst = false
  @Environment(\.widgetFamily) private var family

  var body: some View {
    MayaWidgetView(entry: entry, family: family, blockFirst: blockFirst)
      .containerBackground(for: .widget) {
        MayaWidgetBackground(entry: entry, family: family, blockFirst: blockFirst)
      }
  }
}

/// Kind kept from M6 so widgets people already placed keep working.
struct BestIdeaWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "ai.heymaya.best-idea", provider: Provider()) { entry in
      WidgetRoot(entry: entry)
    }
    .configurationDisplayName("Maya")
    .description("Her best new idea, your next shoot, and how your last posts did.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular, .accessoryCircular, .accessoryInline])
  }
}

struct NextShootWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "ai.heymaya.next-shoot", provider: Provider()) { entry in
      WidgetRoot(entry: entry, blockFirst: true)
    }
    .configurationDisplayName("Next shoot")
    .description("Your next filming block and what it's for.")
    .supportedFamilies([.systemSmall, .accessoryRectangular, .accessoryInline])
  }
}

@main
struct MayaWidgets: WidgetBundle {
  var body: some Widget {
    BestIdeaWidget()
    NextShootWidget()
  }
}
