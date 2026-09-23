import ConvexMobile
import SwiftUI

/// Signed out → the welcome screen. Signed in → the three tabs (spec §0 D2).
struct RootView: View {
  @State private var auth: AuthState<String> = .loading

  var body: some View {
    if Fixtures.enabled {
      MainTabs()
    } else {
      authed
    }
  }

  private var authed: some View {
    Group {
      switch auth {
      case .loading:
        LaunchView()
      case .unauthenticated:
        WelcomeView()
      case .authenticated:
        MainTabs()
      }
    }
    .animation(.smooth(duration: 0.25), value: stateKey)
    .task {
      for await state in convex.authState.values { auth = state }
    }
  }

  private var stateKey: Int {
    switch auth {
    case .loading: 0
    case .unauthenticated: 1
    case .authenticated: 2
    }
  }
}

struct MainTabs: View {
  var body: some View {
    TabView {
      TodayView()
        .tabItem { Label("Today", systemImage: "sun.max") }
      IdeasView()
        .tabItem { Label("Ideas", systemImage: "lightbulb") }
      OpportunitiesView()
        .tabItem { Label("Deals", systemImage: "dollarsign.circle") }
      YouView()
        .tabItem { Label("You", systemImage: "person.crop.circle") }
    }
  }
}

struct LaunchView: View {
  var body: some View {
    ZStack {
      Palette.ground.ignoresSafeArea()
      FlowerMark(size: 64)
    }
  }
}
