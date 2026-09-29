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
    // "You're in" once, only for someone who went through the steps here (not a returning user).
    .onChange(of: model.step) { old, new in
      if new == .done, old != .done, model.sawSteps { model.celebrate = true; Haptics.success() }
    }
  }
}

struct OnboardingFlow: View {
  @Bindable var model: OnboardingModel

  var body: some View {
    ZStack {
      Palette.ground.ignoresSafeArea()
      switch model.step {
      case .plan: PlanStep(model: model)
      case .connect: ConnectStep(model: model)
      case .watch: WatchStep(model: model)
      case .meet: MeetStep(model: model)
      case .done: DoneStep(paired: model.progress?.paired ?? false) { model.celebrate = false }
      }
    }
    .onAppear { model.sawSteps = true }
  }
}

// MARK: - The frame every step shares

private struct StepFrame<Content: View, Footer: View>: View {
  let step: OnboardingStep
  let kicker: String
  let title: String
  let subtitle: String
  @ViewBuilder var content: Content
  @ViewBuilder var footer: Footer

  var body: some View {
    VStack(spacing: 0) {
      HStack(spacing: 6) {
        ForEach(1...4, id: \.self) { i in
          Capsule().fill(i <= step.index ? Palette.purple : Palette.line).frame(height: 4)
        }
      }
      .padding(.horizontal, 24)
      .padding(.top, 12)
      .accessibilityLabel("Step \(step.index) of 4")

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
    StepFrame(step: .plan, kicker: "Your plan", title: "Start with a free week.", subtitle: "Pick what fits. You won't be charged for 7 days, and you can cancel before then.") {
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

  private var accounts: [SocialStatus.Account] { model.social?.accounts.filter { !$0.needsReconnect } ?? [] }

  var body: some View {
    StepFrame(step: .connect, kicker: "Your work", title: "Let her see what you make.", subtitle: "Connect Instagram or TikTok. She reads your posts and numbers. She never posts for you.") {
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
                Task { busy = platform; problem = await model.connect(platform: platform); busy = nil }
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
  }
}

// MARK: - 3. Worth watching

private struct WatchStep: View {
  let model: OnboardingModel
  @State private var suggestions: [WatchSuggestion]?
  @State private var platform = "instagram"
  @State private var handle = ""
  @State private var busy = false
  @State private var problem: String?

  var body: some View {
    StepFrame(step: .watch, kicker: "Your taste", title: "Who should she keep an eye on?", subtitle: "She watches these accounts for what's working, so her ideas fit your lane. Pick any, or skip and she'll choose.") {
      if let suggestions {
        if suggestions.isEmpty {
          Text("No strong picks yet. Add someone you like, or skip and she'll keep looking.")
            .font(MayaFont.callout).foregroundStyle(Palette.muted)
        }
        VStack(spacing: 12) {
          ForEach(suggestions) { s in
            let on = model.watched.contains { $0.platform == s.platform && $0.handle == s.handle }
            Button { Haptics.tap(); Task { await model.toggle(s) } } label: {
              HStack(alignment: .top, spacing: 12) {
                Image(systemName: on ? "checkmark.circle.fill" : "plus.circle")
                  .font(.title3).foregroundStyle(on ? Palette.purple : Palette.muted)
                VStack(alignment: .leading, spacing: 4) {
                  Text(s.displayName ?? "@\(s.handle)").font(MayaFont.headline).foregroundStyle(Palette.ink)
                  Text("@\(s.handle) · \(s.platform == "tiktok" ? "TikTok" : "Instagram")\(s.followers.map { " · \(Format.count($0))" } ?? "")")
                    .font(MayaFont.caption).foregroundStyle(Palette.muted)
                  Text(s.why).font(MayaFont.callout).foregroundStyle(Palette.ink).multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
              }
              .padding(16)
              .background(RoundedRectangle(cornerRadius: 18).fill(on ? Palette.wash : Palette.panel))
              .overlay(RoundedRectangle(cornerRadius: 18).stroke(on ? Palette.purple : Palette.line, lineWidth: on ? 2 : 1))
            }
            .buttonStyle(.plain)
          }
        }
      } else {
        HStack(spacing: 10) {
          ProgressView()
          Text("Finding people from your posts…").font(MayaFont.callout).foregroundStyle(Palette.muted)
        }
      }

      VStack(alignment: .leading, spacing: 8) {
        Text("Add someone you like").font(MayaFont.headline).foregroundStyle(Palette.ink)
        Picker("Platform", selection: $platform) {
          Text("Instagram").tag("instagram")
          Text("TikTok").tag("tiktok")
        }
        .pickerStyle(.segmented)
        HStack {
          TextField("@handle", text: $handle)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 12).fill(Palette.panel))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Palette.line))
          Button("Add") {
            Task { busy = true; problem = await model.addOwn(platform: platform, handle: handle); if problem == nil { handle = "" }; busy = false }
          }
          .buttonStyle(.bordered)
          .disabled(handle.trimmingCharacters(in: .whitespaces).isEmpty || busy)
        }
        let own = model.watched.filter { w in !(suggestions ?? []).contains { $0.platform == w.platform && $0.handle == w.handle } }
        ForEach(own) { w in
          Label("@\(w.handle)", systemImage: "checkmark").font(MayaFont.callout).foregroundStyle(Palette.ink)
        }
      }
      Problem(text: problem)
    } footer: {
      PrimaryButton(title: model.watched.isEmpty ? "Skip, she'll choose" : "Continue") {
        model.watchSeen = true
      }
    }
    .task { if suggestions == nil { suggestions = await model.suggestions() } }
  }
}

// MARK: - 4. Meet her

private struct MeetStep: View {
  let model: OnboardingModel
  @Environment(\.openURL) private var openURL
  @State private var phone = ""
  @State private var consent = false
  @State private var busy = false
  @State private var waiting = false
  @State private var problem: String?

  var body: some View {
    StepFrame(step: .meet, kicker: "Meet Maya", title: "She lives in your texts.", subtitle: "Text her START and she'll take it from there. That's where you'll talk to her; this app is where her work lives.") {
      VStack(alignment: .leading, spacing: 8) {
        Text("Your mobile number").font(MayaFont.headline).foregroundStyle(Palette.ink)
        TextField("+1 555 123 4567", text: $phone)
          .keyboardType(.phonePad)
          .textContentType(.telephoneNumber)
          .padding(14)
          .background(RoundedRectangle(cornerRadius: 12).fill(Palette.panel))
          .overlay(RoundedRectangle(cornerRadius: 12).stroke(Palette.line))
      }
      Toggle(isOn: $consent) {
        Text("I agree to get texts from Maya at this number. Message and data rates may apply. Reply STOP anytime.")
          .font(MayaFont.caption).foregroundStyle(Palette.muted)
      }
      .toggleStyle(.switch)
      .tint(Palette.purple)
      if waiting {
        HStack(spacing: 10) {
          ProgressView()
          Text("Waiting for your START…").font(MayaFont.callout).foregroundStyle(Palette.muted)
        }
      }
      Problem(text: problem)
    } footer: {
      PrimaryButton(title: waiting ? "Open Messages again" : "Text her START", busy: busy, disabled: phone.filter(\.isNumber).count < 10 || !consent) {
        Task {
          busy = true
          let r = await model.meet(phone: phone)
          busy = false
          problem = r.problem
          if let link = r.link { waiting = true; openURL(link) } else if model.preview { waiting = true }
        }
      }
      Button("I'll do this later") { model.meetSkipped = true }
        .font(MayaFont.callout)
        .foregroundStyle(Palette.muted)
    }
    .onAppear { if phone.isEmpty, let saved = model.progress?.phone { phone = saved } }
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
