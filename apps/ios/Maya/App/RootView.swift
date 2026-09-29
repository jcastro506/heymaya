import ConvexMobile
import SwiftUI

/// Signed out → the welcome screen. Signed in → onboarding until they're set up (M3), then the tabs.
struct RootView: View {
  @State private var auth: AuthState<String> = .loading
  @State private var router = Router()

  var body: some View {
    Group {
      if let step = OnboardingPreview.step {
        OnboardingGate(preview: step)
      } else if Fixtures.enabled {
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
        OnboardingGate()
      }
    }
    .animation(.smooth(duration: 0.25), value: stateKey)
    .task {
      for await state in convex.authState.values {
        auth = state
        if case .authenticated = state { await ShareSetup.ensureToken() }
      }
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

/// Debug only: `-MayaOnboarding plan|connect|watch|meet|done` shows onboarding from that screen with
/// made-up data and no network, for design review. Release builds never read it.
enum OnboardingPreview {
  static var step: OnboardingStep? {
    #if DEBUG
      let args = ProcessInfo.processInfo.arguments
      guard let i = args.firstIndex(of: "-MayaOnboarding"), i + 1 < args.count else { return nil }
      return ["plan": .plan, "connect": .connect, "watch": .watch, "meet": .meet, "done": .done][args[i + 1]]
    #else
      nil
    #endif
  }
}
