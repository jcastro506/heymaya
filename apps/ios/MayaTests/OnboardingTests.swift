import XCTest
@testable import Maya

/// Onboarding resumes from the server's facts (spec §5.1): the right screen after a kill, a reinstall
/// or a sign-in on another phone, and nobody who's already texting her is sent back through it.
final class OnboardingTests: XCTestCase {
  private func step(plan: String? = nil, accounts: Int = 0, connectSeen: Bool = false, paired: Bool = false, watchSeen: Bool = false, meetSkipped: Bool = false) -> OnboardingStep {
    OnboardingStep.decide(.init(planStatus: plan, connectedAccounts: accounts, connectSeen: connectSeen, paired: paired, watchSeen: watchSeen, meetSkipped: meetSkipped))
  }

  func testTheOrder() {
    XCTAssertEqual(step(), .plan, "a brand-new account (no row yet) starts at the plan")
    XCTAssertEqual(step(plan: "onboarding"), .plan)
    XCTAssertEqual(step(plan: "trialing"), .connect)
    XCTAssertEqual(step(plan: "trialing", accounts: 1), .connect, "connecting one account doesn't rush them past the other")
    XCTAssertEqual(step(plan: "trialing", accounts: 1, connectSeen: true), .watch)
    XCTAssertEqual(step(plan: "trialing", accounts: 1, connectSeen: true, watchSeen: true), .meet)
    XCTAssertEqual(step(plan: "trialing", accounts: 1, connectSeen: true, watchSeen: true, meetSkipped: true), .done)
  }

  func testOnlyAPaidOrFreePlanGetsPastThePlan() {
    for status in ["active", "trialing", "comped"] { XCTAssertEqual(step(plan: status), .connect, status) }
    for status in ["onboarding", "past_due", "canceled", "paused"] { XCTAssertEqual(step(plan: status), .plan, status) }
  }

  func testContinueWithNoAccountStaysOnConnect() {
    XCTAssertEqual(step(plan: "active", accounts: 0, connectSeen: true), .connect)
  }

  func testSomeoneAlreadyTextingHerIsDone() {
    XCTAssertEqual(step(paired: true), .done)
    XCTAssertEqual(step(plan: "trialing", accounts: 0, paired: true), .done)
  }

  @MainActor func testServerReasonsReadAsSentences() {
    XCTAssertEqual(OnboardingModel.plain("choose a plan before connecting an account"), "Choose a plan before connecting an account.")
    XCTAssertEqual(OnboardingModel.plain("no account"), "We couldn't confirm your sign-in. Close the app and open it again.")
    XCTAssertEqual(OnboardingModel.plain(nil), "Something went wrong. Try again in a moment.")
  }
}
