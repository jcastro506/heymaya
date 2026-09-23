import Foundation

/// Every number in the app says how old it is (spec §6.7).
enum Format {
  static func ago(_ ms: Double, now: Date = .now) -> String {
    let hours = (now.timeIntervalSince1970 * 1000 - ms) / 3_600_000
    if hours < 1 { return "just now" }
    if hours < 24 { return "\(Int(hours.rounded()))h ago" }
    return "\(Int((hours / 24).rounded()))d ago"
  }

  static func count(_ n: Double) -> String {
    n.formatted(.number.notation(.compactName).precision(.fractionLength(0...1)))
  }

  static func multiple(_ m: Double) -> String {
    "\(m.formatted(.number.precision(.fractionLength(0...1))))×"
  }

  static func day(_ ms: Double) -> String {
    Date(timeIntervalSince1970: ms / 1000).formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
  }

  static func time(_ ms: Double) -> String {
    Date(timeIntervalSince1970: ms / 1000).formatted(date: .omitted, time: .shortened)
  }
}
