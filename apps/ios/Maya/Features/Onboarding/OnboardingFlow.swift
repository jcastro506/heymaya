import SwiftUI

/// Signed in, not set up yet: the four steps, then the tabs. Each screen moves on when the server
/// says it's done (the plan lands from payment, an account from the connect, pairing from their text).
struct OnboardingGate: View {
  @State private var model: OnboardingModel

  init(preview: OnboardingStep? = nil) {
    _model = State(initialValue: OnboardingModel(preview: preview))
  }

  var body: some View {
    Group {
      if !model.loaded {
        LaunchView()
      } else if model.step == .done && !model.celebrate {
        MainTabs()
      } else {
        OnboardingFlow(model: model)
      }
    }
    .animation(.smooth(duration: 0.3), value: model.step)
    .task { await model.run() }
    // "You're in" once, only for someone who went through the steps here (not a returning user), and
    // only if they skipped texting her: when their START lands they're in Messages, and coming back
    // to the app should land on Home with nothing left to tap.
    .onChange(of: model.step) { old, new in
      if new == .done, old != .done, model.sawSteps, !(model.progress?.paired ?? false) { model.celebrate = true; Haptics.success() }
    }
  }
}

struct OnboardingFlow: View {
  @Bindable var model: OnboardingModel

  var body: some View {
    ZStack {
      Palette.ground.ignoresSafeArea()
      Group { switch model.step {
      case .name: NameStep(model: model)
      case .plan: PlanStep(model: model)
      case .connect: ConnectStep(model: model)
      case .watch: WatchStep(model: model)
      case .calendar: CalendarStep(model: model)
      case .meet: MeetStep(model: model)
      case .done: DoneStep(paired: model.progress?.paired ?? false) { model.celebrate = false }
      } }
      .environment(model)
    }
    .onAppear { model.sawSteps = true }
  }
}

// MARK: - The frame every step shares

private struct StepFrame<Content: View, Footer: View>: View {
  @Environment(OnboardingModel.self) private var model
  let step: OnboardingStep
  let kicker: String
  let title: String
  let subtitle: String
  @ViewBuilder var content: Content
  @ViewBuilder var footer: Footer

  var body: some View {
    VStack(spacing: 0) {
      HStack(spacing: 10) {
        if model.canGoBack {
          Button { Haptics.tap(); model.back() } label: {
            Image(systemName: "chevron.left").font(.headline).foregroundStyle(Palette.ink).frame(width: 32, height: 32)
          }
          .accessibilityLabel("Back")
        }
        HStack(spacing: 6) {
          ForEach(1...OnboardingStep.count, id: \.self) { i in
            Capsule().fill(i <= step.index ? Palette.purple : Palette.line).frame(height: 4)
          }
        }
      }
      .frame(minHeight: 32)
      .padding(.horizontal, 24)
      .padding(.top, 12)
      .accessibilityLabel("Step \(step.index) of \(OnboardingStep.count)")

      ScrollView {
        VStack(alignment: .leading, spacing: 20) {
          VStack(alignment: .leading, spacing: 8) {
            Text(kicker.uppercased()).font(MayaFont.kicker).kerning(0.8).foregroundStyle(Palette.coral)
            Text(title).font(MayaFont.display).foregroundStyle(Palette.ink).fixedSize(horizontal: false, vertical: true)
            Text(subtitle).font(MayaFont.body).foregroundStyle(Palette.muted).fixedSize(horizontal: false, vertical: true)
          }
          content
        }
        .padding(.horizontal, 24)
        .padding(.top, 24)
        .padding(.bottom, 24)
        .frame(maxWidth: .infinity, alignment: .leading)
      }
      .scrollDismissesKeyboard(.interactively)

      VStack(spacing: 10) { footer }
        .padding(.horizontal, 24)
        .padding(.top, 12)
        .padding(.bottom, 8)
        .background(Palette.ground)
    }
  }
}

private struct PrimaryButton: View {
  let title: String
  var busy = false
  var disabled = false
  let action: () -> Void

  var body: some View {
    Button {
      Haptics.tap()
      action()
    } label: {
      ZStack {
        Text(title).opacity(busy ? 0 : 1)
        if busy { ProgressView().tint(.white) }
      }
      .font(MayaFont.headline)
      .frame(maxWidth: .infinity, minHeight: 54)
    }
    .buttonStyle(.borderedProminent)
    .buttonBorderShape(.roundedRectangle(radius: 16))
    .disabled(disabled || busy)
  }
}

private struct Problem: View {
  let text: String?
  var body: some View {
    if let text { Text(text).font(MayaFont.callout).foregroundStyle(Palette.err).frame(maxWidth: .infinity, alignment: .leading) }
  }
}

// MARK: - 1. Plan

// MARK: - 0. Their name

/// What Maya should call them (2026-10-02): required, pre-filled from sign-in, one tap when it's right.
private struct NameStep: View {
  let model: OnboardingModel
  @State private var name = ""
  @State private var busy = false
  @State private var problem: String?
  @FocusState private var focused: Bool

  var body: some View {
    StepFrame(step: .name, kicker: "Hi", title: "What should Maya call you?", subtitle: "Your first name, or what friends call you. She'll use it when she texts you.") {
      VStack(alignment: .leading, spacing: 10) {
        TextField("First name", text: $name)
          .textContentType(.givenName)
          .textInputAutocapitalization(.words)
          .autocorrectionDisabled()
          .submitLabel(.continue)
          .font(MayaFont.title)
          .padding(16)
          .background(RoundedRectangle(cornerRadius: 16).fill(Palette.panel))
          .overlay(RoundedRectangle(cornerRadius: 16).stroke(focused ? Palette.purple : Palette.line, lineWidth: focused ? 2 : 1))
          .focused($focused)
          .onSubmit(save)
        Problem(text: problem)
      }
    } footer: {
      PrimaryButton(title: "Continue", busy: busy, disabled: name.trimmingCharacters(in: .whitespaces).isEmpty, action: save)
    }
    .onAppear {
      if name.isEmpty { name = model.progress?.firstName ?? "" }
      focused = name.isEmpty
    }
  }

  private func save() {
    Task { busy = true; problem = await model.saveName(name); busy = false }
  }
}

private struct PlanStep: View {
  let model: OnboardingModel
  @State private var plans = Live<Plans?>("ui:plans")
  @State private var chosen = "duo"
  @State private var annual = false
  @State private var busy = false
  @State private var problem: String?

  private var tiers: [Plans.Tier] {
    if model.preview { return Fixtures.load("ui:plans", as: Plans.self)?.tiers ?? [] }
    if case .value(let p?) = plans.state { return p.tiers }
    return []
  }

  var body: some View {
    StepFrame(step: .plan, kicker: "Your plan", title: "Try Maya free for a week.", subtitle: "Seven days free. If she's not worth it, cancel in one tap.") {
      Picker("Billing", selection: $annual) {
        Text("Monthly").tag(false)
        Text("Yearly · 2 months free").tag(true)
      }
      .pickerStyle(.segmented)

      if tiers.isEmpty {
        SkeletonRows(count: 3)
      } else {
        VStack(spacing: 12) {
          ForEach(tiers) { t in
            TierCard(tier: t, annual: annual, selected: chosen == t.tier) { chosen = t.tier }
          }
        }
      }
      Problem(text: problem)
    } footer: {
      PrimaryButton(title: "Start my free week", busy: busy, disabled: tiers.isEmpty) {
        Task {
          busy = true
          problem = await model.checkout(tier: chosen, interval: annual ? "annual" : "monthly")
          busy = false
        }
      }
      Text("You'll add a card on the next screen. Apple Pay works too.")
        .font(MayaFont.caption).foregroundStyle(Palette.muted)
    }
    .task { if !model.preview { await plans.run() } }
  }

}

private struct TierCard: View {
  let tier: Plans.Tier
  let annual: Bool
  let selected: Bool
  let choose: () -> Void

  var body: some View {
    Button(action: { Haptics.tap(); choose() }) {
      HStack(alignment: .top, spacing: 12) {
        Image(systemName: selected ? "checkmark.circle.fill" : "circle")
          .font(.title3)
          .foregroundStyle(selected ? Palette.purple : Palette.line)
        VStack(alignment: .leading, spacing: 4) {
          HStack(alignment: .firstTextBaseline) {
            Text(tier.label).font(MayaFont.headline).foregroundStyle(Palette.ink)
            Spacer()
            Text(annual ? tier.annual : tier.monthly).font(MayaFont.headline.monospacedDigit()).foregroundStyle(Palette.ink)
            Text(annual ? "/yr" : "/mo").font(MayaFont.caption).foregroundStyle(Palette.muted)
          }
          Text(tier.blurb).font(MayaFont.callout).foregroundStyle(Palette.muted).multilineTextAlignment(.leading)
        }
      }
      .padding(16)
      .background(RoundedRectangle(cornerRadius: 18).fill(selected ? Palette.wash : Palette.panel))
      .overlay(RoundedRectangle(cornerRadius: 18).stroke(selected ? Palette.purple : Palette.line, lineWidth: selected ? 2 : 1))
    }
    .buttonStyle(.plain)
    .accessibilityAddTraits(selected ? .isSelected : [])
  }
}

// MARK: - 2. Connect

private struct ConnectStep: View {
  let model: OnboardingModel
  @State private var busy: String?
  @State private var problem: String?
  /// Instagram only connects as a Creator or Business account; the steps come from the server's one
  /// definition (account/setup.ts), the same ones the Analytics screen shows.
  @State private var igSetup = Live<AccountSetup?>("account/setup:advice", args: ["platform": "instagram", "accountType": "personal"])
  @State private var showIGSetup = false

  private var accounts: [SocialStatus.Account] { model.social?.accounts.filter { !$0.needsReconnect } ?? [] }

  var body: some View {
    StepFrame(step: .connect, kicker: "Your accounts", title: "Connect your accounts.", subtitle: "So she can see your posts and what your followers love, and her ideas sound like you. She never posts for you.") {
      VStack(spacing: 12) {
        ForEach(["instagram", "tiktok"], id: \.self) { platform in
          let account = accounts.first { $0.platform == platform }
          HStack(spacing: 14) {
            Image(systemName: platform == "instagram" ? "camera" : "music.note")
              .font(.title3)
              .frame(width: 44, height: 44)
              .background(Circle().fill(Palette.wash))
              .foregroundStyle(Palette.purple)
            VStack(alignment: .leading, spacing: 2) {
              Text(platform == "instagram" ? "Instagram" : "TikTok").font(MayaFont.headline).foregroundStyle(Palette.ink)
              Text(account.map { "@\($0.username ?? "connected")" } ?? "Your posts and how they did")
                .font(MayaFont.caption).foregroundStyle(account == nil ? Palette.muted : Palette.ok)
            }
            Spacer()
            if account != nil {
              Image(systemName: "checkmark.circle.fill").font(.title2).foregroundStyle(Palette.ok)
            } else {
              Button {
                Task {
                  busy = platform
                  problem = await model.connect(platform: platform)
                  // Wait for Zernio to attach it before deciding (it confirms a moment after the sheet closes).
                  // Only if it still isn't there is it almost always a personal account: show how to switch.
                  if platform == "instagram", !model.preview {
                    if await model.waitForAccount(platform: "instagram") {
                      problem = nil
                    } else {
                      problem = "Instagram didn't connect. It needs a Creator account first: here's how."
                      showIGSetup = true
                    }
                  }
                  busy = nil
                }
              } label: {
                if busy == platform { ProgressView() } else { Text("Connect").font(MayaFont.headline) }
              }
              .buttonStyle(.bordered)
              .disabled(busy != nil)
            }
          }
          .padding(16)
          .background(RoundedRectangle(cornerRadius: 18).fill(Palette.panel))
          .overlay(RoundedRectangle(cornerRadius: 18).stroke(account != nil ? Palette.ok.opacity(0.5) : Palette.line))
          if platform == "instagram", account == nil {
            Button { Haptics.tap(); showIGSetup = true } label: {
              Label("Needs a Creator account (free, about a minute). How to switch", systemImage: "info.circle")
                .font(MayaFont.caption)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 4)
            .padding(.top, -4)
          }
        }
      }
      Problem(text: problem)
      if accounts.isEmpty {
        Button("Already connected? Check again") {
          Task { busy = "check"; problem = await model.recheck(); busy = nil }
        }
        .font(MayaFont.callout)
        .disabled(busy != nil)
      }
    } footer: {
      PrimaryButton(title: accounts.isEmpty ? "Connect one to continue" : "Continue", disabled: accounts.isEmpty) {
        model.connectSeen = true
      }
      .disabled(accounts.isEmpty)
    }
    .task { await igSetup.run() }
    // An Instagram error is wrong the moment Instagram shows up connected (it can arrive after the check).
    .onChange(of: accounts.contains { $0.platform == "instagram" }) { _, connected in
      if connected, problem?.hasPrefix("Instagram") == true { problem = nil }
      if connected { showIGSetup = false }
    }
    .sheet(isPresented: $showIGSetup) {
      if case .value(let setup?) = igSetup.state {
        AccountSetupSheet(platform: "instagram", setup: setup)
      } else {
        ProgressView().presentationDetents([.medium])
      }
    }
  }
}

// MARK: - 3. Meet her

private struct MeetStep: View {
  let model: OnboardingModel
  @Environment(\.openURL) private var openURL
  @State private var busy = false
  @State private var waiting = false
  @State private var problem: String?

  var body: some View {
    StepFrame(step: .meet, kicker: "Meet Maya", title: "Maya works over text.", subtitle: "She texts you ideas and your plan for the week. Send her START to say hi. Everything she sends is saved in this app.") {
      VStack(alignment: .leading, spacing: 14) {
        MayaBubble(text: "hey, i'm maya. send me START and i'll get to work.")
        if waiting {
          HStack(spacing: 10) {
            ProgressView()
            Text("Waiting for your text…").font(MayaFont.callout).foregroundStyle(Palette.muted)
          }
        }
        Problem(text: problem)
      }
    } footer: {
      PrimaryButton(title: waiting ? "Open Messages again" : "Text Maya", busy: busy) {
        Task {
          busy = true
          let r = await model.meet()
          busy = false
          problem = r.problem
          if let link = r.link { waiting = true; openURL(link) } else if model.preview { waiting = true }
        }
      }
      Text("By texting, you agree to get texts from Maya. Msg & data rates may apply. Reply STOP anytime.")
        .font(MayaFont.caption).foregroundStyle(Palette.muted).multilineTextAlignment(.center)
    }
  }
}

// MARK: - 4. Favorites (theirs; she offers more by text once her read is done)

private struct WatchStep: View {
  let model: OnboardingModel
  @State private var platform = "instagram"
  @State private var handle = ""
  @State private var busy = false
  @State private var problem: String?

  var body: some View {
    StepFrame(step: .watch, kicker: "Your favorites", title: "Who do you love watching?", subtitle: "Add a few creators you like. She'll keep an eye on them for ideas.") {
      VStack(alignment: .leading, spacing: 10) {
        HStack(spacing: 8) {
          Menu {
            Button("Instagram") { platform = "instagram" }
            Button("TikTok") { platform = "tiktok" }
          } label: {
            Image(systemName: platform == "instagram" ? "camera" : "music.note")
              .frame(width: 44, height: 44)
              .background(RoundedRectangle(cornerRadius: 12).fill(Palette.wash))
              .foregroundStyle(Palette.purple)
          }
          .accessibilityLabel(platform == "instagram" ? "Instagram" : "TikTok")
          TextField("@handle", text: $handle)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .submitLabel(.done)
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 12).fill(Palette.panel))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Palette.line))
            .onSubmit(add)
          Button("Add", action: add)
            .buttonStyle(.bordered)
            .disabled(handle.trimmingCharacters(in: .whitespaces).isEmpty || busy)
        }
        if model.watched.isEmpty {
          Text("No one in mind? Skip it. Once she's read your posts she'll text you a few she thinks you'd love.")
            .font(MayaFont.caption).foregroundStyle(Palette.muted)
        } else {
          ForEach(model.watched) { w in
            HStack(spacing: 10) {
              Image(systemName: w.platform == "tiktok" ? "music.note" : "camera").foregroundStyle(Palette.purple).frame(width: 20)
              Text("@\(w.handle)").font(MayaFont.headline).foregroundStyle(Palette.ink)
              Spacer()
              Image(systemName: "checkmark.circle.fill").foregroundStyle(Palette.ok)
            }
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 12).fill(Palette.panel))
          }
        }
      }
      Problem(text: problem)
    } footer: {
      PrimaryButton(title: model.watched.isEmpty ? "Skip for now" : "Done") { model.watchSeen = true }
    }
  }

  private func add() {
    Task { busy = true; problem = await model.addOwn(platform: platform, handle: handle); if problem == nil { handle = "" }; busy = false }
  }
}

// MARK: - 5. Calendar (asked here so her first plan can go straight on it; Apple doesn't let it be required)

private struct CalendarStep: View {
  let model: OnboardingModel
  @State private var busy = false

  var body: some View {
    StepFrame(step: .calendar, kicker: "Your calendar", title: "Maya plans your week for you.", subtitle: "She puts filming and posting times on your calendar, around the plans you already have, so you don't have to.") {
      VStack(alignment: .leading, spacing: 12) {
        Label("Works with the calendars on your iPhone, Google included", systemImage: "calendar")
        Label("She only adds the times you say yes to", systemImage: "checkmark.circle")
        Label("She never shares your plans with anyone", systemImage: "lock")
      }
      .font(MayaFont.callout)
      .foregroundStyle(Palette.ink)
    } footer: {
      PrimaryButton(title: "Use my calendar", busy: busy) {
        Task { busy = true; _ = await CalendarSync.connect(); busy = false; model.calendarSeen = true }
      }
      Button("Not now") { model.calendarSeen = true }
        .font(MayaFont.callout).foregroundStyle(Palette.muted)
    }
  }
}

// MARK: - Done

private struct DoneStep: View {
  let paired: Bool
  let finish: () -> Void

  var body: some View {
    VStack(spacing: 0) {
      Spacer()
      FlowerMark(size: 88).padding(.bottom, 24)
      Text("You're in.").font(MayaFont.display).foregroundStyle(Palette.ink)
      Text(paired
        ? "She's reading your posts now. Watch for her first text; everything she makes shows up here."
        : "She's reading your posts now, and everything she makes shows up here. She'll start texting once you send her START.")
        .font(MayaFont.body).foregroundStyle(Palette.muted)
        .multilineTextAlignment(.center)
        .padding(.top, 10)
        .padding(.horizontal, 32)
      Spacer()
      PrimaryButton(title: "Open Maya", action: finish)
        .padding(.horizontal, 24)
        .padding(.bottom, 28)
    }
  }
}
