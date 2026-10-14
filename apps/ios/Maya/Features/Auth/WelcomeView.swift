import ClerkKitUI
import SwiftUI

/// Signed out. One line about her, one action (spec §5.1 screen 0).
struct WelcomeView: View {
  @State private var showAuth = false

  var body: some View {
    ZStack {
      Palette.ground.ignoresSafeArea()
      VStack(spacing: 0) {
        Spacer()
        FlowerMark(size: 88)
          .padding(.bottom, 28)
        Text("Meet Maya")
          .font(MayaFont.display)
          .foregroundStyle(Palette.ink)
        Spacer()
        Button {
          Haptics.tap()
          showAuth = true
        } label: {
          Text("Continue")
            .font(MayaFont.headline)
            .frame(maxWidth: .infinity, minHeight: 54)
        }
        .buttonStyle(.borderedProminent)
        .buttonBorderShape(.roundedRectangle(radius: 16))
        .padding(.horizontal, 24)
        Spacer().frame(height: 28)
      }
    }
    .sheet(isPresented: $showAuth) {
      AuthView()
    }
  }
}
