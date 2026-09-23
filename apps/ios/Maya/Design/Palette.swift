import SwiftUI
import UIKit

/// Maya's colours, from the web brand (app/app/mission-control.css), with dark variants.
enum Palette {
  static let ground = dynamic(light: 0xFCFBF8, dark: 0x17141F)
  static let panel = dynamic(light: 0xFFFDFB, dark: 0x211C2C)
  static let wash = dynamic(light: 0xF3EFF9, dark: 0x2A2338)
  static let line = dynamic(light: 0xE4DFEA, dark: 0x3A3348)
  static let ink = dynamic(light: 0x29233F, dark: 0xF1EDF7)
  static let muted = dynamic(light: 0x756E84, dark: 0xA79FB5)
  static let purple = dynamic(light: 0x7661B4, dark: 0xA894E6)
  static let coral = dynamic(light: 0xFF795F, dark: 0xFF8D76)
  static let ok = dynamic(light: 0x2F7D5B, dark: 0x6CC49A)
  static let warn = dynamic(light: 0xB7791F, dark: 0xE7B45A)
  static let err = dynamic(light: 0xC2453D, dark: 0xF07C73)
  /// The flower's face is always the ink of the light theme, on either background.
  static let face = Color(hex: 0x29233F)

  private static func dynamic(light: UInt32, dark: UInt32) -> Color {
    Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light) })
  }
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
