import SwiftUI
import WidgetKit

/// M6: two read-only widgets (app spec §10.2). Small: the next filming block with its hook.
/// Medium: today's best idea plus how many new ones are waiting. They fetch their own data with
/// the creator's share token every 30 minutes, so they stay current without push. Never Maya's
/// voice: facts from rows, and a tap opens the object in the app.

struct WidgetData: Decodable {
  struct Block: Decodable { let kind: String; let start: Double; let title: String; let hook: String?; let ideaId: String?; let booked: Bool }
  struct Idea: Decodable { let id: String; let hook: String; let cover: String?; let isNew: Bool }
  let nextBlock: Block?
  let bestIdea: Idea?
  let newIdeas: Int
}

struct MayaEntry: TimelineEntry {
  let date: Date
  let data: WidgetData?
  let signedOut: Bool

  static let placeholder = MayaEntry(date: .now, data: WidgetData(
    nextBlock: .init(kind: "film", start: Date.now.addingTimeInterval(86_400).timeIntervalSince1970 * 1000, title: "humidity won today", hook: "i love running vs running in 90% humidity", ideaId: nil, booked: true),
    bestIdea: .init(id: "", hook: "the 5am alarm negotiation", cover: nil, isNew: true), newIdeas: 3), signedOut: false)
}

struct Provider: TimelineProvider {
  func placeholder(in context: Context) -> MayaEntry { .placeholder }

  func getSnapshot(in context: Context, completion: @escaping (MayaEntry) -> Void) {
    if context.isPreview { completion(.placeholder); return }
    Task { completion(await fetch()) }
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<MayaEntry>) -> Void) {
    Task {
      let entry = await fetch()
      completion(Timeline(entries: [entry], policy: .after(.now.addingTimeInterval(30 * 60))))
    }
  }

  private func fetch() async -> MayaEntry {
    guard let token = ShareLink.token,
          let convexURL = Bundle.main.object(forInfoDictionaryKey: "MayaConvexURL") as? String,
          let url = ShareLink.widgetEndpoint(convexURL: convexURL) else { return MayaEntry(date: .now, data: nil, signedOut: true) }
    var req = URLRequest(url: url)
    req.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
    guard let (data, response) = try? await URLSession.shared.data(for: req),
          (response as? HTTPURLResponse)?.statusCode == 200,
          let decoded = try? JSONDecoder().decode(WidgetData.self, from: data) else {
      return MayaEntry(date: .now, data: nil, signedOut: false)
    }
    return MayaEntry(date: .now, data: decoded, signedOut: false)
  }
}

private let purple = Color(red: 0x76 / 255, green: 0x61 / 255, blue: 0xB4 / 255)
private let coral = Color(red: 1, green: 0x79 / 255, blue: 0x5F / 255)

struct NextShootView: View {
  let entry: MayaEntry
  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Label("Next shoot", systemImage: "video.fill").font(.caption2.weight(.semibold)).foregroundStyle(purple)
      if let b = entry.data?.nextBlock {
        Text(Date(timeIntervalSince1970: b.start / 1000), format: .dateTime.weekday(.abbreviated).hour().minute())
          .font(.headline)
        Text(b.hook ?? b.title).font(.caption).foregroundStyle(.secondary).lineLimit(3)
        if !b.booked { Text("not booked yet").font(.caption2).foregroundStyle(coral) }
      } else {
        Spacer(minLength: 0)
        Text(entry.signedOut ? "Open Maya to connect" : "Nothing booked. Text her to plan one.").font(.caption).foregroundStyle(.secondary)
      }
      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .widgetURL(entry.data?.nextBlock?.ideaId.flatMap { URL(string: "maya://o/idea/\($0)") } ?? URL(string: "maya://app/today"))
  }
}

struct BestIdeaView: View {
  let entry: MayaEntry
  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      VStack(alignment: .leading, spacing: 6) {
        Label("Her best idea", systemImage: "lightbulb.fill").font(.caption2.weight(.semibold)).foregroundStyle(purple)
        if let i = entry.data?.bestIdea {
          Text(i.hook).font(.headline).lineLimit(3)
        } else {
          Text(entry.signedOut ? "Open Maya to connect" : "No ideas waiting.").font(.caption).foregroundStyle(.secondary)
        }
        Spacer(minLength: 0)
        if let n = entry.data?.newIdeas, n > 0 {
          Text("\(n) new in your ideas").font(.caption2.weight(.semibold)).foregroundStyle(coral)
        }
      }
      Spacer(minLength: 0)
      if let b = entry.data?.nextBlock {
        VStack(alignment: .trailing, spacing: 4) {
          Image(systemName: "video.fill").foregroundStyle(purple)
          Text(Date(timeIntervalSince1970: b.start / 1000), format: .dateTime.weekday(.abbreviated).hour()).font(.caption2).foregroundStyle(.secondary)
        }
      }
    }
    .widgetURL(entry.data?.bestIdea.flatMap { URL(string: "maya://o/idea/\($0.id)") } ?? URL(string: "maya://app/ideas"))
  }
}

struct NextShootWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "ai.heymaya.next-shoot", provider: Provider()) { entry in
      NextShootView(entry: entry).containerBackground(.fill.tertiary, for: .widget)
    }
    .configurationDisplayName("Next shoot")
    .description("Your next filming block and what it's for.")
    .supportedFamilies([.systemSmall])
  }
}

struct BestIdeaWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "ai.heymaya.best-idea", provider: Provider()) { entry in
      BestIdeaView(entry: entry).containerBackground(.fill.tertiary, for: .widget)
    }
    .configurationDisplayName("Maya's best idea")
    .description("Her best idea right now, and how many new ones are waiting.")
    .supportedFamilies([.systemMedium])
  }
}

@main
struct MayaWidgets: WidgetBundle {
  var body: some Widget {
    NextShootWidget()
    BestIdeaWidget()
  }
}
