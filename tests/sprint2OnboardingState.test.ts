/**
 * Sprint 2 onboarding — state machine reducer tests.
 *
 * The Sprint 2 onboarding flow is conversational, but every transition is a
 * pure function in `app/onboarding/maya/_state.ts`. These tests pin the
 * reducer behavior so a careless change to the UI doesn't silently change
 * the gating logic (e.g. accidentally letting Starter creators add a 2nd
 * handle UI-side, even though the server would still reject it).
 *
 * Why no convex-test here: the state module is a pure TS module with no
 * Convex bindings. We import it directly and assert. The Convex-side
 * verifyHandle action is covered alongside the rest of the ScrapeCreators
 * tests; that is the right home for it because it depends on the same
 * fixture corpus as the bulk pull.
 */

import { describe, it, expect } from "vitest";
import {
  PLAN_MAX_HANDLES,
  STEP_ORDER,
  addHandle,
  canAdvance,
  initialState,
  markCalendarSkipNudgeShown,
  nextStep,
  previousStep,
  recommendChannel,
  recordProviderConnection,
  recordProviderSkip,
  removeHandle,
  setStep,
  type OnboardingState,
  type Plan,
  type VerifiedHandle,
} from "../app/onboarding/maya/_state";

const HANDLE_TT: VerifiedHandle = {
  platform: "tiktok",
  handle: "fitcreator99",
  displayName: "Fit Creator",
  followerCount: 42_000,
  avatarUrl: null,
};

const HANDLE_IG: VerifiedHandle = {
  platform: "instagram",
  handle: "studio.lena",
  displayName: "Studio Lena",
  followerCount: 18_300,
  avatarUrl: null,
};

const HANDLE_YT: VerifiedHandle = {
  platform: "youtube",
  handle: "@codecast",
  displayName: "Codecast",
  followerCount: 9_900,
  avatarUrl: null,
};

const HANDLE_LINKEDIN: VerifiedHandle = {
  platform: "linkedin",
  handle: "joshc",
  displayName: "Josh C.",
  followerCount: 4_200,
  avatarUrl: null,
};

const HANDLE_X: VerifiedHandle = {
  platform: "x",
  handle: "joshc",
  displayName: "Josh C.",
  followerCount: 6_000,
  avatarUrl: null,
};

function withPlan(plan: Plan): OnboardingState {
  return { ...initialState(plan), plan };
}

// ────────────────────────────────────────────────────────────────────────
// Step ordering + transitions
// ────────────────────────────────────────────────────────────────────────

describe("STEP_ORDER", () => {
  it("is the canonical 6-step linear flow", () => {
    expect([...STEP_ORDER]).toEqual([
      "handles",
      "pulling",
      "questions",
      "channel",
      "composio",
      "deploy",
    ]);
  });

  it("nextStep walks forward and stops at the terminal step", () => {
    expect(nextStep("handles")).toBe("pulling");
    expect(nextStep("pulling")).toBe("questions");
    expect(nextStep("questions")).toBe("channel");
    expect(nextStep("channel")).toBe("composio");
    expect(nextStep("composio")).toBe("deploy");
    expect(nextStep("deploy")).toBe("deploy");
  });

  it("previousStep walks back and stops at the head", () => {
    expect(previousStep("deploy")).toBe("composio");
    expect(previousStep("composio")).toBe("channel");
    expect(previousStep("channel")).toBe("questions");
    expect(previousStep("questions")).toBe("pulling");
    expect(previousStep("pulling")).toBe("handles");
    expect(previousStep("handles")).toBe("handles");
  });

  it("setStep replaces step and clears any banner error", () => {
    const s = { ...initialState("manager"), error: "boom" };
    expect(setStep(s, "channel")).toMatchObject({ step: "channel", error: null });
  });
});

// ────────────────────────────────────────────────────────────────────────
// addHandle: plan caps + per-platform uniqueness
// ────────────────────────────────────────────────────────────────────────

describe("addHandle", () => {
  it("Coach allows up to PLAN_MAX_HANDLES (5 in v0)", () => {
    expect(PLAN_MAX_HANDLES.coach).toBe(5);
    let state = withPlan("coach");
    for (const h of [HANDLE_TT, HANDLE_IG, HANDLE_YT, HANDLE_LINKEDIN, HANDLE_X]) {
      const r = addHandle(state, h);
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error("unreachable");
      state = r.state;
    }
    expect(state.handles.length).toBe(5);
  });

  it("Manager allows up to PLAN_MAX_HANDLES (5 in v0)", () => {
    expect(PLAN_MAX_HANDLES.manager).toBe(5);
    let mgr = withPlan("manager");
    for (const h of [HANDLE_TT, HANDLE_IG, HANDLE_YT, HANDLE_LINKEDIN, HANDLE_X]) {
      const r = addHandle(mgr, h);
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error("unreachable");
      mgr = r.state;
    }
    expect(mgr.handles.length).toBe(5);
  });

  it("rejects a duplicate platform regardless of plan", () => {
    let pro = withPlan("manager");
    const r1 = addHandle(pro, HANDLE_TT);
    if (!r1.ok) throw new Error("unreachable");
    pro = r1.state;
    const r2 = addHandle(pro, { ...HANDLE_TT, handle: "different_handle" });
    expect(r2.ok).toBe(false);
    if (r2.ok) throw new Error("unreachable");
    expect(r2.reason).toBe("duplicate-platform");
  });

  it("removeHandle drops the matching platform and is idempotent", () => {
    let pro = withPlan("manager");
    const r1 = addHandle(pro, HANDLE_TT);
    if (!r1.ok) throw new Error("unreachable");
    pro = r1.state;
    const removed = removeHandle(pro, "tiktok");
    expect(removed.handles).toEqual([]);
    // Removing a platform that isn't there is a no-op (no throw).
    const removedAgain = removeHandle(removed, "tiktok");
    expect(removedAgain.handles).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────
// canAdvance gating
// ────────────────────────────────────────────────────────────────────────

describe("canAdvance", () => {
  it("handles step requires at least one handle", () => {
    const empty = withPlan("manager");
    expect(canAdvance(empty)).toBe(false);
    const r = addHandle(empty, HANDLE_TT);
    if (!r.ok) throw new Error("unreachable");
    expect(canAdvance(r.state)).toBe(true);
  });

  it("pulling step requires scrapeComplete=true", () => {
    const s: OnboardingState = { ...withPlan("manager"), step: "pulling" };
    expect(canAdvance(s)).toBe(false);
    expect(canAdvance({ ...s, scrapeComplete: true })).toBe(true);
  });

  it("questions step blocks on missing required answers (full coverage in sprint3.7 test)", () => {
    // Sprint 3.7 expanded the questions step from 3 Q's to 8 (with required +
    // optional gating). The exhaustive matrix lives in
    // `tests/sprint37OnboardingState.test.ts`; here we just sanity-check that
    // an empty answer payload is still rejected.
    const s: OnboardingState = { ...withPlan("manager"), step: "questions" };
    expect(canAdvance(s)).toBe(false);
    expect(
      canAdvance({ ...s, answers: { ...s.answers, goal: "   " } })
    ).toBe(false);
  });

  it("channel step accepts web with no phone, requires a valid phone otherwise", () => {
    const base: OnboardingState = { ...withPlan("manager"), step: "channel" };
    // web → always advances
    expect(canAdvance(base)).toBe(true);
    // imessage with empty phone → blocked
    const sms: OnboardingState = {
      ...base,
      channel: { ...base.channel, selected: "sms", phoneNumber: "" },
    };
    expect(canAdvance(sms)).toBe(false);
    // imessage with valid phone → advances
    expect(
      canAdvance({
        ...base,
        channel: { ...base.channel, selected: "imessage", phoneNumber: "+1 415 555 0101" },
      })
    ).toBe(true);
    // imessage with garbage phone → blocked
    expect(
      canAdvance({
        ...base,
        channel: { ...base.channel, selected: "imessage", phoneNumber: "abcdef" },
      })
    ).toBe(false);
  });

  it("composio step always advances (all providers optional)", () => {
    const s: OnboardingState = { ...withPlan("manager"), step: "composio" };
    expect(canAdvance(s)).toBe(true);
  });

  it("deploy step never advances (terminal)", () => {
    const s: OnboardingState = { ...withPlan("manager"), step: "deploy" };
    expect(canAdvance(s)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Composio provider state transitions
// ────────────────────────────────────────────────────────────────────────

describe("composio reducers", () => {
  it("recordProviderConnection writes a connected record", () => {
    const s = withPlan("manager");
    const next = recordProviderConnection(s, "calendar", "ca_123");
    expect(next.composio.providers.calendar).toEqual({
      status: "connected",
      composioAccountId: "ca_123",
    });
  });

  it("recordProviderSkip writes a skipped record with no account id", () => {
    const s = withPlan("manager");
    const next = recordProviderSkip(s, "calendar");
    expect(next.composio.providers.calendar).toEqual({
      status: "skipped",
      composioAccountId: null,
    });
  });

  it("markCalendarSkipNudgeShown flips the flag idempotently", () => {
    const s = withPlan("manager");
    expect(s.composio.calendarSkipNudgeShown).toBe(false);
    const a = markCalendarSkipNudgeShown(s);
    expect(a.composio.calendarSkipNudgeShown).toBe(true);
    const b = markCalendarSkipNudgeShown(a);
    expect(b.composio.calendarSkipNudgeShown).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────
// recommendChannel device detection
// ────────────────────────────────────────────────────────────────────────

describe("recommendChannel", () => {
  it("iPhone UA → imessage", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15";
    expect(recommendChannel(ua)).toBe("imessage");
  });

  it("Android UA → whatsapp (rich media bias)", () => {
    const ua =
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36";
    expect(recommendChannel(ua)).toBe("whatsapp");
  });

  it("Mac desktop UA → web (no phone needed)", () => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
    expect(recommendChannel(ua)).toBe("web");
  });

  it("empty UA → web", () => {
    expect(recommendChannel("")).toBe("web");
  });
});
