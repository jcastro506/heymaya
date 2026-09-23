import SwiftUI

/// Maya's flower, drawn from the same 80×80 path the web uses (app/onboarding/Shell.tsx).
struct FlowerShape: Shape {
  func path(in rect: CGRect) -> Path {
    let s = min(rect.width, rect.height) / 80
    func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: rect.minX + x * s, y: rect.minY + y * s) }
    var path = Path()
    path.move(to: p(40, 9))
    path.addCurve(to: p(58, 20), control1: p(49, -9), control2: p(62, 4))
    path.addCurve(to: p(70, 40), control1: p(77, 13), control2: p(88, 29))
    path.addCurve(to: p(59, 59), control1: p(88, 49), control2: p(77, 66))
    path.addCurve(to: p(40, 71), control1: p(65, 77), control2: p(49, 89))
    path.addCurve(to: p(21, 59), control1: p(30, 89), control2: p(14, 77))
    path.addCurve(to: p(9, 40), control1: p(2, 66), control2: p(-9, 49))
    path.addCurve(to: p(21, 21), control1: p(-9, 30), control2: p(3, 14))
    path.addCurve(to: p(40, 9), control1: p(14, 3), control2: p(30, -9))
    path.closeSubpath()
    return path
  }
}

struct FlowerMark: View {
  var size: CGFloat = 32
  var color: Color = Palette.coral

  var body: some View {
    ZStack {
      FlowerShape().fill(color)
      Canvas { ctx, canvas in
        let s = canvas.width / 80
        for x in [31.0, 49.0] {
          ctx.fill(Path(ellipseIn: CGRect(x: (x - 3) * s, y: 33 * s, width: 6 * s, height: 6 * s)), with: .color(Palette.face))
        }
        var smile = Path()
        smile.move(to: CGPoint(x: 31 * s, y: 47 * s))
        smile.addQuadCurve(to: CGPoint(x: 49 * s, y: 47 * s), control: CGPoint(x: 40 * s, y: 56 * s))
        ctx.stroke(smile, with: .color(Palette.face), style: StrokeStyle(lineWidth: 3 * s, lineCap: .round))
      }
    }
    .frame(width: size, height: size)
    .accessibilityHidden(true)
  }
}
