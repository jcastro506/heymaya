import Foundation
import Observation

enum AppTab: Hashable { case today, ideas, deals, you }

/// Where a link should take them (spec §6.7). Universal links, legacy /app/<tab> links from
/// older messages, and the maya:// scheme (simulator testing) all resolve here.
enum Route: Equatable {
  case tab(AppTab)
  case idea(String)
  case post(String)

  static func parse(_ url: URL) -> Route? {
    let isOurs = url.scheme == "maya" || (["https", "http"].contains(url.scheme ?? "") && (url.host.map { $0 == "hey-maya.ai" || $0.hasSuffix(".hey-maya.ai") } ?? false))
    guard isOurs else { return nil }
    // maya://o/idea/x has "o" as its host; https://hey-maya.ai/o/idea/x has it in the path.
    var parts = url.pathComponents.filter { $0 != "/" }
    if url.scheme == "maya", let host = url.host { parts.insert(host, at: 0) }
    guard let first = parts.first else { return .tab(.today) }
    switch first {
    case "o":
      guard parts.count >= 3, !parts[2].isEmpty else { return .tab(.today) }
      switch parts[1] {
      case "idea": return .idea(parts[2])
      case "post": return .post(parts[2])
      default: return .tab(.today)
      }
    case "app":
      switch parts.count > 1 ? parts[1] : "today" {
      case "ideas": return .tab(.ideas)
      case "lane", "settings", "you", "plan", "billing": return .tab(.you)
      default: return .tab(.today) // today, results, plan: all live on Today now
      }
    default:
      return .tab(.today)
    }
  }
}

@MainActor
@Observable
final class Router {
  var tab: AppTab = .today
  /// An object to push once its tab is showing; the tab clears it after pushing.
  var pendingIdea: String?
  var pendingPost: String?

  func open(_ url: URL) {
    guard let route = Route.parse(url) else { return }
    switch route {
    case .tab(let t): tab = t
    case .idea(let id): tab = .ideas; pendingIdea = id
    case .post(let id): tab = .today; pendingPost = id
    }
  }
}
