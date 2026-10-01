import ConvexMobile
import Foundation
import Observation

/// Onboarding in the app (spec §5, M3): plan → connect → favorites → text her → the app.
/// Texting her is last (2026-10-01): once they're in Messages nobody comes back to finish a step, so
/// the moment their START lands the server says paired and the app is already Home when they return.
/// The server owns where they are (plan, connected accounts, paired), so killing the app, reinstalling
/// or signing in on another phone resumes at the right screen. Only the two skippable steps are
/// remembered on the phone, because skipping them writes nothing to the server.
enum OnboardingStep: Equatable, CaseIterable {
  case plan, connect, watch, meet, done

  struct Facts: Equatable {
    var planStatus: String?
    var connectedAccounts: Int
    /// They tapped Continue on Connect (so connecting one account doesn't rush them past the other).
    var connectSeen: Bool
    var paired: Bool
    var watchSeen: Bool
    var meetSkipped: Bool
    /// Accounts they already watch (so a returning user on a new phone isn't asked again).
    var watching: Int = 0
  }

  static let readyPlans: Set<String> = ["trialing", "active", "comped"]

  /// Pure: the first step that isn't done. Someone already texting her with a plan, an account and
  /// people to watch is finished; the phone-only marks cover the steps a fresh install can't know.
  static func decide(_ f: Facts) -> OnboardingStep {
    let planReady = f.planStatus.map { readyPlans.contains($0) } ?? false
    if !planReady && !f.paired { return .plan }
    if f.connectedAccounts == 0 || !(f.connectSeen || f.paired) { return .connect }
    if !(f.watchSeen || f.paired) { return .watch }
    if !(f.paired || f.meetSkipped) { return .meet }
    return .done
  }

  /// The dots across the top: four real steps.
  var index: Int { [.plan: 1, .connect: 2, .watch: 3, .meet: 4][self] ?? 4 }
}

struct OnboardingProgress: Decodable, Equatable {
  let paired: Bool
  let planStatus: String
  let phone: String?
  let posts: Double
}

struct SocialStatus: Decodable, Equatable {
  struct Account: Decodable, Equatable { let platform: String; let username: String?; let needsReconnect: Bool }
  let status: String
  let accounts: [Account]
}

struct Watched: Decodable, Equatable, Identifiable {
  let id: String
  let platform: String
  let handle: String
}

@MainActor
@Observable
final class OnboardingModel {
  private(set) var progress: OnboardingProgress?
  private(set) var social: SocialStatus?
  private(set) var watched: [Watched] = []
  private(set) var loaded = false
  /// Set when they finish in this session, so they see "You're in" once before the tabs.
  var celebrate = false
  /// They were shown a step in this session (a returning, finished user never is).
  var sawSteps = false

  var connectSeen: Bool { didSet { if !preview { UserDefaults.standard.set(connectSeen, forKey: Self.key("connectSeen")) } } }
  var watchSeen: Bool { didSet { if !preview { UserDefaults.standard.set(watchSeen, forKey: Self.key("watchSeen")) } } }
  var meetSkipped: Bool { didSet { if !preview { UserDefaults.standard.set(meetSkipped, forKey: Self.key("meetSkipped")) } } }

  /// Debug only (`-MayaOnboarding plan|connect|watch|meet`): every screen with made-up data, no network,
  /// and nothing saved to the phone (a preview must never skip a real run's steps).
  let preview: Bool

  init(preview: OnboardingStep? = nil) {
    self.preview = preview != nil
    connectSeen = UserDefaults.standard.bool(forKey: Self.key("connectSeen"))
    watchSeen = UserDefaults.standard.bool(forKey: Self.key("watchSeen"))
    meetSkipped = UserDefaults.standard.bool(forKey: Self.key("meetSkipped"))
    if let start = preview {
      connectSeen = ![.plan, .connect].contains(start)
      watchSeen = [.meet, .done].contains(start)
      meetSkipped = start == .done
      progress = OnboardingProgress(paired: false, planStatus: start == .plan ? "onboarding" : "trialing", phone: nil, posts: 24)
      social = SocialStatus(status: "connected", accounts: [.plan, .connect].contains(start) ? [] : [.init(platform: "instagram", username: "riverloop.runs", needsReconnect: false)])
      loaded = true
    }
  }

  private static func key(_ name: String) -> String { "onboarding.\(name)" }

  var facts: OnboardingStep.Facts {
    .init(planStatus: progress?.planStatus, connectedAccounts: social?.accounts.filter { !$0.needsReconnect }.count ?? 0, connectSeen: connectSeen, paired: progress?.paired ?? false, watchSeen: watchSeen, meetSkipped: meetSkipped, watching: watched.count)
  }

  var step: OnboardingStep { OnboardingStep.decide(facts) }

  /// Back goes to the previous step that is still theirs to change. Payment and pairing are facts on
  /// the server, so there's no going "back" past them.
  var canGoBack: Bool {
    switch step {
    case .watch: return true
    case .meet: return !(progress?.paired ?? false)
    default: return false
    }
  }

  func back() {
    switch step {
    case .watch: connectSeen = false
    case .meet: watchSeen = false
    default: break
    }
  }

  /// Makes their account (idempotent), then follows the three things that decide the step.
  func run() async {
    guard !preview else { return }
    struct Ensured: Decodable { let ok: Bool }
    _ = try? await convex.mutation("onboarding/start:ensureCreator", with: ["timezone": TimeZone.current.identifier]) as Ensured
    await withTaskGroup(of: Void.self) { group in
      group.addTask { await self.follow("onboarding/start:progress", OnboardingProgress?.self) { self.progress = $0; self.loaded = true } }
      group.addTask { await self.follow("connections/zernio:status", SocialStatus?.self) { self.social = $0 } }
      group.addTask { await self.follow("onboarding/admired:list", [Watched]?.self) { self.watched = $0 ?? [] } }
    }
  }

  private func follow<T: Decodable & Equatable>(_ name: String, _ type: T.Type, _ apply: @escaping @MainActor (T) -> Void) async {
    let stream = convex.subscribe(to: name, yielding: T.self).removeDuplicates().values
    do {
      for try await next in stream { apply(next) }
    } catch {
      print("[Onboarding] \(name): \(error)")
      loaded = true
    }
  }

  // MARK: - Actions (each one the same server function the old web onboarding called)

  struct UrlResult: Decodable { let ok: Bool; let url: String?; let reason: String? }

  func checkout(tier: String, interval: String) async -> String? {
    if preview { progress = OnboardingProgress(paired: false, planStatus: "trialing", phone: nil, posts: 24); return nil }
    do {
      let r: UrlResult = try await convex.action("billing/checkout:createCheckout", with: ["tier": tier, "interval": interval, "returnTo": "app_onboarding"])
      guard r.ok, let url = r.url.flatMap(URL.init(string:)) else { return Self.plain(r.reason) }
      await WebSheet.open(url)
      return nil
    } catch {
      print("[Onboarding] checkout: \(error)")
      return "Checkout didn't open. Try again in a moment."
    }
  }

  func connect(platform: String) async -> String? {
    if preview {
      social = SocialStatus(status: "connected", accounts: (social?.accounts ?? []) + [.init(platform: platform, username: platform == "tiktok" ? "riverloopruns" : "riverloop.runs", needsReconnect: false)])
      return nil
    }
    do {
      let r: UrlResult = try await convex.action("connections/zernio:startConnect", with: ["platform": platform, "returnTo": "app"])
      guard r.ok, let url = r.url.flatMap(URL.init(string:)) else { return Self.plain(r.reason) }
      await WebSheet.open(url)
      return await recheck()
    } catch {
      print("[Onboarding] connect: \(error)")
      return "That didn't open. Try again in a moment."
    }
  }

  /// Asks which accounts are attached now. The screen updates from the live status either way.
  func recheck() async -> String? {
    guard !preview else { return nil }
    struct R: Decodable { let accounts: Double }
    guard let r: R = try? await convex.action("connections/zernio:reconcile") else { return "I couldn't check that yet. Try again in a moment." }
    return r.accounts == 0 ? "Nothing's attached yet. If you finished connecting, give it a moment and check again." : nil
  }

  func addOwn(platform: String, handle: String) async -> String? {
    let clean = handle.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "@", with: "")
    guard !clean.isEmpty else { return nil }
    if preview { watched.append(.init(id: "\(platform):\(clean)", platform: platform, handle: clean)); return nil }
    struct Checked: Decodable { let ok: Bool; let handle: String?; let reason: String? }
    struct Added: Decodable { let ok: Bool; let error: String? }
    guard let c: Checked = try? await convex.action("onboarding/admired:validate", with: ["platform": platform, "handle": clean]) else { return "I couldn't check that account. Try again." }
    guard c.ok, let h = c.handle else { return c.reason ?? "I couldn't find that account." }
    guard let a: Added = try? await convex.mutation("onboarding/admired:add", with: ["platform": platform, "handle": h, "addedBy": "creator"]), a.ok else { return "I couldn't add that one." }
    return nil
  }


  /// The link that opens Messages with START and a one-time code to her. Texting it is what pairs
  /// them (the server reads their number from that text), so nothing here asks for a phone number.
  func meet() async -> (link: URL?, problem: String?) {
    if preview { return (nil, nil) }
    struct Pairing: Decodable { let ok: Bool; let deepLink: String?; let error: String? }
    do {
      let pairing: Pairing = try await convex.mutation("core/pairing:createPairingLink")
      guard pairing.ok, let link = pairing.deepLink.flatMap(URL.init(string:)) else { return (nil, "Texting her isn't ready yet. You can do this later from the app.") }
      return (link, nil)
    } catch {
      print("[Onboarding] meet: \(error)")
      return (nil, "That didn't go through. Try again in a moment.")
    }
  }

  /// Server reasons are short and lowercase; make them read like a sentence.
  static func plain(_ reason: String?) -> String {
    guard let r = reason, !r.isEmpty else { return "Something went wrong. Try again in a moment." }
    if r == "no account" { return "We couldn't confirm your sign-in. Close the app and open it again." }
    return r.prefix(1).uppercased() + r.dropFirst() + (r.hasSuffix(".") ? "" : ".")
  }
}
