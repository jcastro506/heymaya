import Foundation

/// Debug-only preview mode: launch with `-MayaFixtures` and every screen renders from real
/// captured query outputs (apps/ios/Fixtures) with no sign-in and no network. Used for the
/// design pass and screenshot baselines. Release builds strip the JSON and this is always off.
enum Fixtures {
  static var enabled: Bool {
    #if DEBUG
      ProcessInfo.processInfo.arguments.contains("-MayaFixtures")
    #else
      false
    #endif
  }

  /// "ui:today" → Fixtures/today.json
  static func load<T: Decodable>(_ query: String, as type: T.Type) -> T? {
    let name = query.split(separator: ":").last.map(String.init) ?? query
    // The labelled preview set (Fixtures/make_preview.py) wins over the raw capture.
    guard let url = Bundle.main.url(forResource: "preview.\(name)", withExtension: "json")
      ?? Bundle.main.url(forResource: name, withExtension: "json"),
      let data = try? Data(contentsOf: url)
    else { return nil }
    return try? JSONDecoder().decode(T.self, from: data)
  }
}
