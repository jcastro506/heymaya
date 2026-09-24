import SwiftUI
import UIKit

/// Sample entries for the widget gallery, placeholders, and the render tests. The covers are
/// drawn here (soft abstract scenes), not photos of anyone: the gallery never shows a real
/// creator's post, and the tests need no network.
enum WidgetSamples {
  static let hour: Double = 3_600_000

  static func full(now: Date = .now, covers: Bool = true) -> MayaEntry {
    let ms = now.timeIntervalSince1970 * 1000
    let day = Calendar.current.startOfDay(for: now).timeIntervalSince1970 * 1000
    let shoot1 = day + 42 * hour, shoot2 = day + 91.5 * hour // tomorrow 6 PM, in three days 7:30 PM
    let data = WidgetData(
      nextBlock: .init(kind: "film", start: shoot1, end: shoot1 + hour, title: "humidity won today", hook: "i love running vs running in 90% humidity", ideaId: "sample-idea-2", booked: true),
      blocks: [
        .init(kind: "film", start: shoot1, end: shoot1 + hour, title: "humidity won today", hook: "i love running vs running in 90% humidity", ideaId: "sample-idea-2", booked: true),
        .init(kind: "film", start: shoot2, end: shoot2 + hour, title: "the 5am alarm negotiation", hook: nil, ideaId: nil, booked: false),
      ],
      bestIdea: .init(id: "sample-idea-1", hook: "the 5am alarm negotiation, but it's my legs doing the talking", cover: nil, coverPlatform: "tiktok",
                      fitWhy: "Your early-run posts beat your normal three times this month.", isNew: true),
      lastPosts: [
        .init(id: "p1", platform: "tiktok", createTime: ms - 20 * hour, views: 4_200, multiple: 0.8, settled: false, cover: nil),
        .init(id: "p2", platform: "instagram", createTime: ms - 3 * 24 * hour, views: 18_400, multiple: 2.4, settled: true, cover: nil),
        .init(id: "p3", platform: "tiktok", createTime: ms - 5 * 24 * hour, views: 6_900, multiple: 1.3, settled: true, cover: nil),
      ],
      newIdeas: 3, asOf: ms)
    guard covers else { return MayaEntry(date: now, data: data, state: .ready) }
    return MayaEntry(date: now, data: data, state: .ready, ideaCover: cover(.dusk),
                     postCovers: ["p1": cover(.track), "p2": cover(.sunrise), "p3": cover(.city)].compactMapValues { $0 })
  }

  static let placeholder = full(covers: false)

  // MARK: drawn covers

  enum Scene { case dusk, sunrise, track, city }

  /// A 9:16 abstract scene as JPEG bytes, sized like a downloaded cover.
  static func cover(_ scene: Scene, width: CGFloat = 270) -> Data? {
    let size = CGSize(width: width, height: width * 16 / 9)
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    let img = UIGraphicsImageRenderer(size: size, format: format).image { ctx in
      let c = ctx.cgContext
      let (top, bottom, sun, ground): (UInt32, UInt32, UInt32, UInt32) = {
        switch scene {
        case .dusk: return (0x2B2A5C, 0xF08A6B, 0xFFD29A, 0x1E1B33)
        case .sunrise: return (0x8FB8E8, 0xFBD3A5, 0xFFF1C9, 0x3F5A45)
        case .track: return (0x6E9BD1, 0xCFE3F2, 0xFFFFFF, 0xB5523B)
        case .city: return (0x151A2E, 0x5B4E8C, 0xF4C06A, 0x0D0F1A)
        }
      }()
      let space = CGColorSpaceCreateDeviceRGB()
      let grad = CGGradient(colorsSpace: space, colors: [UIColor(hex: top).cgColor, UIColor(hex: bottom).cgColor] as CFArray, locations: [0, 1])!
      c.drawLinearGradient(grad, start: .zero, end: CGPoint(x: 0, y: size.height * 0.7), options: [.drawsAfterEndLocation])
      // the sun, with a glow
      let sunCenter = CGPoint(x: size.width * 0.62, y: size.height * 0.52)
      let glow = CGGradient(colorsSpace: space, colors: [UIColor(hex: sun).withAlphaComponent(0.9).cgColor, UIColor(hex: sun).withAlphaComponent(0).cgColor] as CFArray, locations: [0, 1])!
      c.drawRadialGradient(glow, startCenter: sunCenter, startRadius: 0, endCenter: sunCenter, endRadius: size.width * 0.55, options: [])
      c.setFillColor(UIColor(hex: sun).cgColor)
      c.fillEllipse(in: CGRect(x: sunCenter.x - size.width * 0.11, y: sunCenter.y - size.width * 0.11, width: size.width * 0.22, height: size.width * 0.22))
      // hills / skyline
      c.setFillColor(UIColor(hex: ground).cgColor)
      if scene == .city {
        var x: CGFloat = 0
        var i = 0
        while x < size.width {
          let w = size.width * [0.12, 0.18, 0.1, 0.15, 0.2][i % 5]
          let h = size.height * [0.22, 0.34, 0.18, 0.28, 0.4][i % 5]
          c.fill(CGRect(x: x, y: size.height * 0.62 - h + size.height * 0.2, width: w - 2, height: h + size.height))
          x += w; i += 1
        }
      } else {
        let p = UIBezierPath()
        p.move(to: CGPoint(x: 0, y: size.height * 0.64))
        p.addCurve(to: CGPoint(x: size.width, y: size.height * 0.6), controlPoint1: CGPoint(x: size.width * 0.35, y: size.height * 0.55), controlPoint2: CGPoint(x: size.width * 0.6, y: size.height * 0.7))
        p.addLine(to: CGPoint(x: size.width, y: size.height)); p.addLine(to: CGPoint(x: 0, y: size.height)); p.close()
        p.fill()
        if scene == .track {
          c.setStrokeColor(UIColor.white.withAlphaComponent(0.7).cgColor)
          c.setLineWidth(3)
          for k in 0..<4 {
            c.move(to: CGPoint(x: size.width * (0.2 + CGFloat(k) * 0.2), y: size.height))
            c.addLine(to: CGPoint(x: size.width * (0.45 + CGFloat(k) * 0.04), y: size.height * 0.64))
          }
          c.strokePath()
        }
      }
      // a figure, so it reads as a post rather than a wallpaper
      c.setFillColor(UIColor.black.withAlphaComponent(0.55).cgColor)
      let fx = size.width * 0.34, fy = size.height * 0.56
      c.fillEllipse(in: CGRect(x: fx - 9, y: fy - 58, width: 18, height: 18))
      c.fill(CGRect(x: fx - 8, y: fy - 38, width: 16, height: 44))
    }
    return img.jpegData(compressionQuality: 0.8)
  }
}
