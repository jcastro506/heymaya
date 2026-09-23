import ConvexMobile
import Foundation
import Observation

/// One live Convex query. The server pushes every change; the view just renders `state`.
@MainActor
@Observable
final class Live<T: Decodable & Equatable> {
  enum State: Equatable {
    case loading
    case value(T)
    case failed(String)
  }

  private(set) var state: State = .loading
  private let name: String
  private let args: [String: ConvexEncodable?]?

  init(_ name: String, args: [String: ConvexEncodable?]? = nil) {
    self.name = name
    self.args = args
  }

  /// Runs for the life of the view's `.task`; cancelled when the view goes away.
  func run() async {
    if Fixtures.enabled {
      if let value = Fixtures.load(name, as: T.self) { state = .value(value) } else { state = .failed("No preview data for \(name).") }
      return
    }
    let stream = convex.subscribe(to: name, with: args, yielding: T.self)
      .removeDuplicates()
      .values
    do {
      for try await next in stream { state = .value(next) }
    } catch {
      state = .failed(Self.plain(error))
    }
  }

  /// Plain words for the user; the technical detail goes to the console for us.
  static func plain(_ error: Error) -> String {
    print("[Live] \(error)")
    return "Couldn't load this. Pull to try again."
  }
}
