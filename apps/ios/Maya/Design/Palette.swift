import SwiftUI
import UIKit

/// Maya's colours, from the web brand (app/app/mission-control.css). One look, white and purple, in light and dark
/// mode alike (operator, 2026-11-23): the app sets UIUserInterfaceStyle Light, and the widget uses these too.
enum Palette {
  static let ground = Color(hex: 0xFCFBF8)
  static let panel = Color(hex: 0xFFFDFB)
  static let wash = Color(hex: 0xF3EFF9)
  static let line = Color(hex: 0xE4DFEA)
  static let ink = Color(hex: 0x29233F)
  static let muted = Color(hex: 0x756E84)
  static let purple = Color(hex: 0x7661B4)
  static let coral = Color(hex: 0xFF795F)
  static let ok = Color(hex: 0x2F7D5B)
  static let warn = Color(hex: 0xB7791F)
  static let err = Color(hex: 0xC2453D)
  /// The flower's face: the ink.
  static let face = Color(hex: 0x29233F)
}

extension Color {
  init(hex: UInt32) { self.init(uiColor: UIColor(hex: hex)) }
}

extension UIColor {
  convenience init(hex: UInt32) {
    self.init(
      red: CGFloat((hex >> 16) & 0xFF) / 255,
      green: CGFloat((hex >> 8) & 0xFF) / 255,
      blue: CGFloat(hex & 0xFF) / 255,
      alpha: 1)
  }
}
