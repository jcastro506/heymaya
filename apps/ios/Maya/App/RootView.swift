import ConvexMobile
import SwiftUI

/// Signed out → the welcome screen. Signed in → the three tabs (spec §0 D2).
struct RootView: View {
  @State private var auth: AuthState<String> = .loading
  @State private var router = Router()

  var body: some View {
    Group {
      if Fixtures.enabled {
        MainTabs()
      } else {
        authed
      }
    }
    .environment(router)
    .onOpenURL { router.open($0) }
    .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
      if let url = activity.webpageURL { router.open(url) }
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
  @Environment(Router.self) private var router

  var body: some View {
    @Bindable var router = router
    TabView(selection: $router.tab) {
      TodayView()
        .tabItem { Label("Today", systemImage: "sun.max") }
        .tag(AppTab.today)
      IdeasView()
        .tabItem { Label("Ideas", systemImage: "lightbulb") }
        .tag(AppTab.ideas)
      OpportunitiesView()
        .tabItem { Label("Deals", systemImage: "dollarsign.circle") }
        .tag(AppTab.deals)
      YouView()
        .tabItem { Label("You", systemImage: "person.crop.circle") }
        .tag(AppTab.you)
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
