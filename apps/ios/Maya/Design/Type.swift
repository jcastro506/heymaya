import SwiftUI

/// Type scale mapped to Dynamic Type text styles, so the largest accessibility sizes work.
enum MayaFont {
  static let display = Font.system(.largeTitle, design: .rounded).weight(.bold)
  static let title = Font.system(.title2, design: .rounded).weight(.semibold)
  static let headline = Font.system(.headline, design: .rounded)
  static let body = Font.body
  static let callout = Font.callout
  static let caption = Font.caption
  static let kicker = Font.caption.weight(.semibold)
  static let number = Font.body.monospacedDigit()
}
