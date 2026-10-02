import XCTest
@testable import Maya

/// Onboarding resumes from the server's facts (spec §5.1): the right screen after a kill, a reinstall
/// or a sign-in on another phone, and nobody who's already set up is sent back through it.
final class OnboardingTests: XCTestCase {
  private func step(plan: String? = nil, accounts: Int = 0, connectSeen: Bool = false, paired: Bool = false, watchSeen: Bool = false, nameConfirmed: Bool = true, calendarSeen: Bool = true, watching: Int = 0) -> OnboardingStep {
    OnboardingStep.decide(.init(planStatus: plan, connectedAccounts: accounts, connectSeen: connectSeen, paired: paired, watchSeen: watchSeen, nameConfirmed: nameConfirmed, calendarSeen: calendarSeen, watching: watching))
  }

  func testTheOrder() {
    XCTAssertEqual(step(), .plan, "a brand-new account (no row yet) starts at the plan")
    XCTAssertEqual(step(plan: "onboarding"), .plan)
    XCTAssertEqual(step(plan: "trialing"), .connect)
    XCTAssertEqual(step(plan: "trialing", accounts: 1), .connect, "connecting one account doesn't rush them past the other")
    XCTAssertEqual(step(plan: "trialing", accounts: 1, connectSeen: true), .watch)
    XCTAssertEqual(step(plan: "trialing", accounts: 1, connectSeen: true, watchSeen: true), .meet, "texting her is last: once they're in Messages nobody comes back to finish a step")
    XCTAssertEqual(step(plan: "trialing", accounts: 1, connectSeen: true, paired: true, watchSeen: true), .done)
  }

  func testCalendarComesBeforeTextingHerAndCanBeSkipped() {
    XCTAssertEqual(step(plan: "trialing", accounts: 1, connectSeen: true, watchSeen: true, calendarSeen: false), .calendar, "asked after favorites, before texting her")
    XCTAssertEqual(step(plan: "trialing", accounts: 1, connectSeen: true, watchSeen: true, calendarSeen: true), .meet, "a yes, a no or not now all move on")
    XCTAssertEqual(step(plan: "active", accounts: 1, connectSeen: true, paired: true, watchSeen: true, calendarSeen: false), .done, "someone already texting her isn't stopped for it")
    XCTAssertEqual(OnboardingStep.calendar.index, 5)
    XCTAssertEqual(OnboardingStep.meet.index, OnboardingStep.count)
  }

  func testTheirNameComesFirstAndIsRequired() {
    XCTAssertEqual(step(nameConfirmed: false), .name, "a brand-new signup is asked what Maya should call them first")
    XCTAssertEqual(step(plan: "trialing", accounts: 1, connectSeen: true, nameConfirmed: false), .name, "required: nothing goes past it")
    XCTAssertEqual(step(plan: "active", accounts: 2, connectSeen: true, paired: true, watchSeen: true, nameConfirmed: false), .done, "someone already texting her isn't stopped for it")
    XCTAssertEqual(OnboardingStep.name.index, 1)
    XCTAssertEqual(OnboardingStep.meet.index, OnboardingStep.count)
  }

  func testTextingHerIsRequired() {
    // No skipping it, however far along they are: the app is where her work lives, but she works over Messages.
    XCTAssertEqual(step(plan: "active", accounts: 2, connectSeen: true, watchSeen: true, watching: 3), .meet)
    XCTAssertEqual(step(plan: "active", accounts: 2, connectSeen: true, paired: true, watchSeen: true), .done)
  }

  func testAddingAFavoriteDoesNotRushThemOn() {
    XCTAssertEqual(step(plan: "trialing", accounts: 1, connectSeen: true, watching: 2), .watch)
  }

  func testTextingHerFinishesOnboarding() {
    XCTAssertEqual(step(plan: "trialing", accounts: 1, connectSeen: true, paired: true, watchSeen: true), .done)
    XCTAssertEqual(step(plan: "trialing", accounts: 1, connectSeen: true, paired: true), .done, "paired from any earlier screen: Home, nothing left to tap")
  }

  func testOnlyAPaidOrFreePlanGetsPastThePlan() {
    for status in ["active", "trialing", "comped"] { XCTAssertEqual(step(plan: status), .connect, status) }
    for status in ["onboarding", "past_due", "canceled", "paused"] { XCTAssertEqual(step(plan: status), .plan, status) }
  }

  func testContinueWithNoAccountStaysOnConnect() {
    XCTAssertEqual(step(plan: "active", accounts: 0, connectSeen: true), .connect)
  }

  func testAReturningUserOnANewPhoneIsDone() {
    XCTAssertEqual(step(plan: "active", accounts: 2, paired: true, watching: 3), .done, "paired, connected and watching: nothing to redo")
  }

  @MainActor func testBackOnlyWhereItCanChangeSomething() {
    let m = OnboardingModel(preview: .meet)
    XCTAssertEqual(m.step, .meet)
    XCTAssertTrue(m.canGoBack)
    m.back()
    XCTAssertEqual(m.step, .calendar, "back from texting her reopens the calendar")
    m.back()
    XCTAssertEqual(m.step, .watch, "back from the calendar reopens favorites")
    m.back()
    XCTAssertEqual(m.step, .connect, "back from favorites reopens Connect")
    XCTAssertFalse(m.canGoBack, "no going back past payment")
  }

  @MainActor func testServerReasonsReadAsSentences() {
    XCTAssertEqual(OnboardingModel.plain("choose a plan before connecting an account"), "Choose a plan before connecting an account.")
    XCTAssertEqual(OnboardingModel.plain("no account"), "We couldn't confirm your sign-in. Close the app and open it again.")
    XCTAssertEqual(OnboardingModel.plain(nil), "Something went wrong. Try again in a moment.")
  }
}
