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
      Group { switch model.step {
      case .plan: PlanStep(model: model)
      case .connect: ConnectStep(model: model)
      case .watch: WatchStep(model: model)
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
          ForEach(1...4, id: \.self) { i in
            Capsule().fill(i <= step.index ? Palette.purple : Palette.line).frame(height: 4)
          }
        }
      }
      .frame(minHeight: 32)
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
    StepFrame(step: .plan, kicker: "Your plan", title: "Start with a free week.", subtitle: "Seven days on us, then pick up the tab only if she's earned it.") {
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
    StepFrame(step: .connect, kicker: "Your work", title: "Let her see what you make.", subtitle: "She reads your posts and numbers, and never posts a thing.") {
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

// MARK: - 4. Worth watching

private struct WatchStep: View {
  let model: OnboardingModel
  @State private var platform = "instagram"
  @State private var handle = ""
  @State private var busy = false
  @State private var problem: String?

  var body: some View {
    StepFrame(step: .watch, kicker: "Your favorites", title: "Who do you love watching?", subtitle: "She'll keep an eye on them and tell you what's working.") {
      if let picks = model.picks {
        if picks.isEmpty {
          EmptyPicks()
        } else {
          ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(spacing: 12) {
              ForEach(picks) { s in
                PickCard(pick: s, on: model.watched.contains { $0.platform == s.platform && $0.handle == s.handle }) {
                  Haptics.tap(); Task { await model.toggle(s) }
                }
              }
            }
            .scrollTargetLayout()
            .padding(.horizontal, 24)
          }
          .scrollTargetBehavior(.viewAligned)
          .padding(.horizontal, -24)
        }
      } else {
        LoadingPicks()
      }

      VStack(alignment: .leading, spacing: 10) {
        Text("Add a creator").font(MayaFont.headline).foregroundStyle(Palette.ink)
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
        let own = model.watched.filter { w in !(model.picks ?? []).contains { $0.platform == w.platform && $0.handle == w.handle } }
        if !own.isEmpty {
          ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) { ForEach(own) { w in Chip(text: "@\(w.handle)") } }
          }
        }
      }
      Problem(text: problem)
    } footer: {
      PrimaryButton(title: model.watched.isEmpty ? "Skip for now" : "Done") { model.watchSeen = true }
    }
    .task { model.prefetchPicks() }
  }

  private func add() {
    Task { busy = true; problem = await model.addOwn(platform: platform, handle: handle); if problem == nil { handle = "" }; busy = false }
  }
}

private struct PickCard: View {
  let pick: WatchSuggestion
  let on: Bool
  let toggle: () -> Void

  var body: some View {
    Button(action: toggle) {
      VStack(alignment: .leading, spacing: 10) {
        HStack(alignment: .top) {
          PickAvatar(url: pick.avatarUrl.flatMap(URL.init(string:)), letter: String(pick.handle.prefix(1)).uppercased())
          Spacer()
          Image(systemName: on ? "checkmark.circle.fill" : "plus.circle")
            .font(.title2).foregroundStyle(on ? Palette.purple : Palette.muted)
        }
        VStack(alignment: .leading, spacing: 2) {
          Text(pick.displayName ?? "@\(pick.handle)").font(MayaFont.headline).foregroundStyle(Palette.ink).lineLimit(1)
          Text("\(pick.platform == "tiktok" ? "TikTok" : "Instagram")\(pick.followers.map { " · \(Format.count($0))" } ?? "")")
            .font(MayaFont.caption).foregroundStyle(Palette.muted)
        }
        Text(pick.why).font(MayaFont.callout).foregroundStyle(Palette.ink).lineLimit(3).multilineTextAlignment(.leading)
        Spacer(minLength: 0)
      }
      .padding(16)
      .frame(width: 240, height: 210, alignment: .topLeading)
      .background(RoundedRectangle(cornerRadius: 20).fill(on ? Palette.wash : Palette.panel))
      .overlay(RoundedRectangle(cornerRadius: 20).stroke(on ? Palette.purple : Palette.line, lineWidth: on ? 2 : 1))
    }
    .buttonStyle(.plain)
    .accessibilityAddTraits(on ? .isSelected : [])
  }
}

private struct PickAvatar: View {
  let url: URL?
  let letter: String
  var body: some View {
    ZStack {
      Circle().fill(Palette.wash)
      Text(letter).font(MayaFont.headline).foregroundStyle(Palette.purple)
      if let url {
        AsyncImage(url: url) { $0.resizable().scaledToFill() } placeholder: { Color.clear }
          .clipShape(Circle())
      }
    }
    .frame(width: 48, height: 48)
  }
}

private struct LoadingPicks: View {
  var body: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 12) {
        ForEach(0..<3, id: \.self) { _ in
          RoundedRectangle(cornerRadius: 20).fill(Palette.wash).frame(width: 240, height: 210)
        }
      }
      .padding(.horizontal, 24)
    }
    .padding(.horizontal, -24)
    .overlay(alignment: .bottomLeading) {
      Text("Finding creators you might love…").font(MayaFont.caption).foregroundStyle(Palette.muted).padding(.top, 8).offset(y: 22)
    }
    .padding(.bottom, 22)
    .redacted(reason: .placeholder)
  }
}

private struct EmptyPicks: View {
  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      FlowerMark(size: 32)
      Text("No picks yet. Add the creators you love below and she'll keep an eye on them.")
        .font(MayaFont.callout).foregroundStyle(Palette.muted)
    }
    .padding(16)
    .background(RoundedRectangle(cornerRadius: 18).fill(Palette.panel))
  }
}

// MARK: - 3. Meet her

private struct MeetStep: View {
  let model: OnboardingModel
  @Environment(\.openURL) private var openURL
  @State private var phone = ""
  @State private var consent = false
  @State private var busy = false
  @State private var waiting = false
  @State private var problem: String?

  var body: some View {
    StepFrame(step: .meet, kicker: "Meet Maya", title: "She lives in your texts.", subtitle: "Text her START; the app is just where her work piles up.") {
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
