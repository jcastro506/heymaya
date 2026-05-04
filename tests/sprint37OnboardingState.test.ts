/**
 * Sprint 3.7 — onboarding state machine extension tests.
 *
 * Sprint 3.7 expanded the `questions` step from 3 Q's (goal/tone/floor) to
 * 8 — adding careerStage (inferred), location, monthlyRevenue (optional),
 * revenueStreams, longTermGoals (optional). Every transition is still a
 * pure function in `app/onboarding/maya/_state.ts`; these tests pin the
 * cursor + skip semantics so the sub-4-min UX never regresses into a form.
 *
 * Five-category sprint matrix:
 *   1. Cross-tenant isolation: covered server-side in
 *      `convex/__tests__/creators.test.ts` (this file is pure-state).
 *   2. Plan-tier × action: questions step is plan-agnostic in v0 (every tier
 *      submits the same 8). Server enforces persistence; covered in convex test.
 *   3. Adversarial: empty answers, all-empty payload, skip-required-Q
 *      attempts.
 *   4. Sibling-file scan: covered repo-wide by sprint1Acceptance.
 *   5. TODO grep: covered repo-wide.
 */

import { describe, it, expect } from "vitest";
import {
  OPTIONAL_QUESTIONS,
  QUESTION_ORDER,
  REQUIRED_QUESTIONS,
  allRequiredAnswered,
  answerQuestion,
  applyCareerStageInference,
  canAdvance,
  currentQuestion,
  inferCareerStage,
  initialState,
  isQuestionAnswered,
  markQuestionSkipped,
  revenueBucketToUsd,
  totalFollowerCount,
  type AnswersState,
  type OnboardingState,
  type Plan,
  type QuestionId,
  type RevenueBucket,
  type VerifiedHandle,
} from "../app/onboarding/maya/_state";

function withPlan(plan: Plan): OnboardingState {
  return { ...initialState(plan), plan, step: "questions" };
}

function answerAllRequired(state: OnboardingState): OnboardingState {
  let s = state;
  s = answerQuestion(s, "goal", "100K on IG by year end");
  s = answerQuestion(s, "tone", "strategic");
  s = answerQuestion(s, "brandDealFloorUsd", 750);
  s = answerQuestion(s, "careerStage", "building");
  s = answerQuestion(s, "location", { city: "Austin", state: "TX", country: "US" });
  s = answerQuestion(s, "revenueStreams", ["brand-deals", "affiliate"]);
  return s;
}

const HANDLE = (followers: number, platform: VerifiedHandle["platform"] = "tiktok"): VerifiedHandle => ({
  platform,
  handle: `creator${followers}`,
  displayName: null,
  followerCount: followers,
  avatarUrl: null,
});

/* -------------------------------------------------------------------------- */
/* Question ordering + cursor                                                  */
/* -------------------------------------------------------------------------- */

describe("QUESTION_ORDER + cursor", () => {
  it("Wave 2: contains the BASE 8 Q's plus the dynamic tail (foundational + senior)", () => {
    // Base 8 must all appear, in the canonical order (careerStage now sits
    // second since it gates the tail). The dynamic-tail Q's appear after.
    const order = [...QUESTION_ORDER];
    // The base Q's are present
    for (const q of [
      "goal",
      "careerStage",
      "tone",
      "brandDealFloor",
      "location",
      "monthlyRevenue",
      "revenueStreams",
      "longTermGoals",
    ] as const) {
      expect(order).toContain(q);
    }
    // The new Wave 2 Q's are present
    for (const q of [
      "primaryGoals",
      "biggestBlockers",
      "ninetyDayPriority",
      "howSerious",
      "brandTypes",
      "weeklyHoursAvailable",
      "sixToTwelveMonthChanges",
      "deprioritizingPlatforms",
      "hiringReadiness",
    ] as const) {
      expect(order).toContain(q);
    }
    // careerStage must precede every dynamic-tail Q so the path resolves
    // before tail Q's surface.
    const careerIdx = order.indexOf("careerStage");
    for (const tail of [
      "primaryGoals",
      "biggestBlockers",
      "ninetyDayPriority",
      "howSerious",
      "brandTypes",
      "sixToTwelveMonthChanges",
      "deprioritizingPlatforms",
      "hiringReadiness",
    ] as const) {
      expect(order.indexOf(tail)).toBeGreaterThan(careerIdx);
    }
  });

  it("required Q's are still the BASE 8 set (Wave 2 tail Q's are all optional)", () => {
    expect([...REQUIRED_QUESTIONS].sort()).toEqual(
      ["brandDealFloor", "careerStage", "goal", "location", "revenueStreams", "tone"].sort()
    );
    // OPTIONAL must include the original 2 plus all Wave 2 dynamic-tail Q's.
    for (const opt of [
      "longTermGoals",
      "monthlyRevenue",
      "primaryGoals",
      "biggestBlockers",
      "ninetyDayPriority",
      "howSerious",
      "brandTypes",
      "weeklyHoursAvailable",
      "sixToTwelveMonthChanges",
      "deprioritizingPlatforms",
      "hiringReadiness",
    ] as const) {
      expect(OPTIONAL_QUESTIONS.has(opt)).toBe(true);
    }
  });

  it("starts cursor at 0 and surfaces the first question (goal)", () => {
    const s = withPlan("manager");
    expect(s.currentQuestionIdx).toBe(0);
    expect(currentQuestion(s)).toBe("goal");
  });
});

/* -------------------------------------------------------------------------- */
/* answerQuestion: cursor advances, payload builds                            */
/* -------------------------------------------------------------------------- */

describe("answerQuestion", () => {
  it("advances the cursor through the BASE 8 Q's (canonical Wave 2 order)", () => {
    // Wave 2 reorder: goal → careerStage → tone → location → monthlyRevenue →
    // revenueStreams → longTermGoals → brandDealFloor → (dynamic tail).
    let s = withPlan("manager");
    s = answerQuestion(s, "goal", "100K on IG by year end");
    expect(currentQuestion(s)).toBe("careerStage");
    // "monetizing" routes the dynamic tail to the SENIOR path.
    s = answerQuestion(s, "careerStage", "monetizing");
    expect(currentQuestion(s)).toBe("tone");
    s = answerQuestion(s, "tone", "tough-love");
    expect(currentQuestion(s)).toBe("location");
    s = answerQuestion(s, "location", { city: "LA", state: "CA", country: "US" });
    expect(currentQuestion(s)).toBe("monthlyRevenue");
    s = answerQuestion(s, "monthlyRevenueBucket", "10k-50k");
    expect(currentQuestion(s)).toBe("revenueStreams");
    s = answerQuestion(s, "revenueStreams", ["brand-deals", "courses"]);
    expect(currentQuestion(s)).toBe("longTermGoals");
    s = answerQuestion(s, "longTermGoals", { oneYear: "ship a course in Q3" });
    expect(currentQuestion(s)).toBe("brandDealFloor");
    s = answerQuestion(s, "brandDealFloorUsd", 1500);
    // Senior tail surfaces next — sixToTwelveMonthChanges first per QUESTION_ORDER.
    expect(currentQuestion(s)).toBe("sixToTwelveMonthChanges");
  });

  it("builds a fully-answered payload that passes canAdvance", () => {
    let s = withPlan("manager");
    s = answerAllRequired(s);
    expect(allRequiredAnswered(s.answers)).toBe(true);
    expect(canAdvance(s)).toBe(true);
  });

  it("answering out-of-order still re-finds the next unanswered Q", () => {
    let s = withPlan("manager");
    // Answer a later Q first (e.g. creator clicked the careerStage chip first).
    s = answerQuestion(s, "careerStage", "building");
    // Cursor should land on the FIRST unanswered Q (goal), not advance past it.
    expect(currentQuestion(s)).toBe("goal");
  });

  it("clears any banner error on answer", () => {
    // Annotate explicitly so the spread doesn't narrow `error` to the
    // literal "boom" — `answerQuestion` returns `OnboardingState` with
    // `error: string | null`, and the reassignment must round-trip.
    let s: OnboardingState = { ...withPlan("manager"), error: "boom" };
    s = answerQuestion(s, "goal", "anything");
    expect(s.error).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Skip semantics                                                              */
/* -------------------------------------------------------------------------- */

describe("markQuestionSkipped", () => {
  it("skipping an OPTIONAL Q advances the cursor and records the skip", () => {
    let s = withPlan("manager");
    s = answerAllRequired(s); // cursor parks at end (length)
    s = markQuestionSkipped(s, "monthlyRevenue");
    expect(s.skippedQuestions.has("monthlyRevenue")).toBe(true);
    // Required Q's are answered, optional skipped → canAdvance true.
    expect(canAdvance(s)).toBe(true);
  });

  it("skipping a REQUIRED Q is rejected with an error banner (no cursor mutation)", () => {
    let s = withPlan("manager");
    const beforeIdx = s.currentQuestionIdx;
    s = markQuestionSkipped(s, "location");
    expect(s.error).toMatch(/cannot skip/i);
    expect(s.skippedQuestions.has("location")).toBe(false);
    expect(s.currentQuestionIdx).toBe(beforeIdx);
  });

  it("skipping both optional Q's still allows advance once requireds are filled", () => {
    let s = withPlan("manager");
    s = answerAllRequired(s);
    s = markQuestionSkipped(s, "monthlyRevenue");
    s = markQuestionSkipped(s, "longTermGoals");
    expect(canAdvance(s)).toBe(true);
    expect(s.skippedQuestions.size).toBe(2);
  });
});

/* -------------------------------------------------------------------------- */
/* canAdvance / required-vs-optional gating                                   */
/* -------------------------------------------------------------------------- */

describe("canAdvance(questions)", () => {
  it("blocks on every empty required Q", () => {
    let s = withPlan("manager");
    expect(canAdvance(s)).toBe(false);
    s = answerQuestion(s, "goal", "100K");
    expect(canAdvance(s)).toBe(false);
    s = answerQuestion(s, "tone", "strategic");
    expect(canAdvance(s)).toBe(false);
    s = answerQuestion(s, "brandDealFloorUsd", 0);
    expect(canAdvance(s)).toBe(false);
    s = answerQuestion(s, "careerStage", "building");
    expect(canAdvance(s)).toBe(false);
    s = answerQuestion(s, "location", { city: "Austin", state: "TX", country: "US" });
    expect(canAdvance(s)).toBe(false);
    s = answerQuestion(s, "revenueStreams", ["brand-deals"]);
    expect(canAdvance(s)).toBe(true);
  });

  it("ADVERSARIAL: an empty location object does not pass the gate", () => {
    let s = withPlan("manager");
    s = answerAllRequired(s);
    s = answerQuestion(s, "location", { city: "", state: "", country: "" });
    expect(canAdvance(s)).toBe(false);
  });

  it("ADVERSARIAL: empty revenueStreams array fails the gate", () => {
    let s = withPlan("manager");
    s = answerAllRequired(s);
    s = answerQuestion(s, "revenueStreams", []);
    expect(canAdvance(s)).toBe(false);
  });

  it("optional Q's never block advance even when null", () => {
    const s = answerAllRequired(withPlan("manager"));
    expect(s.answers.monthlyRevenueBucket).toBeNull();
    expect(s.answers.longTermGoals).toBeNull();
    expect(canAdvance(s)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Career stage inference                                                     */
/* -------------------------------------------------------------------------- */

describe("inferCareerStage", () => {
  it.each<[number, "just-starting" | "building" | "monetizing" | "scaling"]>([
    [0, "just-starting"],
    [9_999, "just-starting"],
    [10_000, "building"],
    [50_000, "building"],
    [99_999, "building"],
    [100_000, "monetizing"],
    [499_999, "monetizing"],
    [500_000, "scaling"],
    [1_500_000, "scaling"],
  ])("totalFollowers=%d → %s", (followers, expected) => {
    expect(inferCareerStage(followers)).toBe(expected);
  });

  it("totalFollowerCount sums across handles, treating undefined as 0", () => {
    const handles: VerifiedHandle[] = [
      HANDLE(12_000, "tiktok"),
      HANDLE(8_000, "instagram"),
      { ...HANDLE(0, "youtube"), followerCount: undefined as unknown as number },
    ];
    expect(totalFollowerCount(handles)).toBe(20_000);
  });

  it("applyCareerStageInference seeds the answer when null and is a no-op once set", () => {
    const baseHandles: VerifiedHandle[] = [HANDLE(12_000)];
    const s = { ...withPlan("manager"), handles: baseHandles };
    const seeded = applyCareerStageInference(s, totalFollowerCount(baseHandles));
    expect(seeded.answers.careerStage).toBe("building");
    // Override path: creator picks "scaling" — re-applying inference does NOT clobber.
    const overridden = answerQuestion(seeded, "careerStage", "scaling");
    const reapplied = applyCareerStageInference(overridden, 12_000);
    expect(reapplied.answers.careerStage).toBe("scaling");
  });
});

/* -------------------------------------------------------------------------- */
/* Revenue bucket → USD midpoint                                              */
/* -------------------------------------------------------------------------- */

describe("revenueBucketToUsd", () => {
  it.each<[RevenueBucket, number]>([
    ["<500", 0],
    ["500-2k", 1_250],
    ["2k-10k", 6_000],
    ["10k-50k", 30_000],
    ["50k+", 50_000],
  ])("bucket=%s → %d USD", (bucket, expected) => {
    expect(revenueBucketToUsd(bucket)).toBe(expected);
  });
});

/* -------------------------------------------------------------------------- */
/* Per-Q `isQuestionAnswered` matrix                                          */
/* -------------------------------------------------------------------------- */

describe("isQuestionAnswered matrix", () => {
  const empty: AnswersState = {
    goal: "",
    tone: "strategic",
    brandDealFloorUsd: 0,
    careerStage: null,
    location: null,
    monthlyRevenueBucket: null,
    revenueStreams: [],
    longTermGoals: null,
    // Wave 2 defaults — empty / null.
    primaryGoals: [],
    biggestBlockers: [],
    ninetyDayPriority: null,
    howSerious: null,
    brandTypes: [],
    weeklyHoursAvailable: null,
    sixToTwelveMonthChanges: [],
    deprioritizingPlatforms: [],
    hiringReadiness: null,
  };

  it("trims whitespace-only goal as not-answered", () => {
    expect(isQuestionAnswered({ ...empty, goal: "   " }, "goal")).toBe(false);
    expect(isQuestionAnswered({ ...empty, goal: "real" }, "goal")).toBe(true);
  });

  it("brandDealFloor=0 is a valid answer", () => {
    expect(isQuestionAnswered({ ...empty, brandDealFloorUsd: 0 }, "brandDealFloor")).toBe(true);
  });

  it("location requires both city and state (country may default)", () => {
    expect(
      isQuestionAnswered(
        { ...empty, location: { city: "Austin", state: "", country: "US" } },
        "location"
      )
    ).toBe(false);
    expect(
      isQuestionAnswered(
        { ...empty, location: { city: "Austin", state: "TX", country: "US" } },
        "location"
      )
    ).toBe(true);
  });

  it("revenueStreams requires at least one selection", () => {
    expect(isQuestionAnswered(empty, "revenueStreams")).toBe(false);
    expect(
      isQuestionAnswered({ ...empty, revenueStreams: ["brand-deals"] }, "revenueStreams")
    ).toBe(true);
  });

  it("optional Q's also report empty as not-answered (caller treats as skip-eligible)", () => {
    expect(isQuestionAnswered(empty, "monthlyRevenue")).toBe(false);
    expect(isQuestionAnswered(empty, "longTermGoals")).toBe(false);
  });

  it("every QUESTION_ORDER entry has a defined isQuestionAnswered branch", () => {
    // Smoke test: walk the order and assert no throw on either polarity.
    for (const q of QUESTION_ORDER) {
      expect(() => isQuestionAnswered(empty, q as QuestionId)).not.toThrow();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Wave 2 (dynamic onboarding) — getQuestionPath + path-aware cursor          */
/* -------------------------------------------------------------------------- */

describe("Wave 2 — getQuestionPath", () => {
  it("returns 'foundational' when careerStage is unset", async () => {
    const { getQuestionPath, DEFAULT_ANSWERS } = await import(
      "../app/onboarding/maya/_state"
    );
    expect(getQuestionPath(DEFAULT_ANSWERS)).toBe("foundational");
  });

  it("returns 'foundational' for just-starting and building", async () => {
    const { getQuestionPath, DEFAULT_ANSWERS } = await import(
      "../app/onboarding/maya/_state"
    );
    expect(
      getQuestionPath({ ...DEFAULT_ANSWERS, careerStage: "just-starting" })
    ).toBe("foundational");
    expect(
      getQuestionPath({ ...DEFAULT_ANSWERS, careerStage: "building" })
    ).toBe("foundational");
  });

  it("returns 'senior' for monetizing and scaling", async () => {
    const { getQuestionPath, DEFAULT_ANSWERS } = await import(
      "../app/onboarding/maya/_state"
    );
    expect(
      getQuestionPath({ ...DEFAULT_ANSWERS, careerStage: "monetizing" })
    ).toBe("senior");
    expect(
      getQuestionPath({ ...DEFAULT_ANSWERS, careerStage: "scaling" })
    ).toBe("senior");
  });
});

describe("Wave 2 — questionAppliesToPath", () => {
  it("BASE 8 Q's always apply to either path", async () => {
    const { questionAppliesToPath, DEFAULT_ANSWERS } = await import(
      "../app/onboarding/maya/_state"
    );
    const base: ReadonlyArray<QuestionId> = [
      "goal",
      "careerStage",
      "tone",
      "brandDealFloor",
      "location",
      "monthlyRevenue",
      "revenueStreams",
      "longTermGoals",
    ];
    for (const q of base) {
      expect(
        questionAppliesToPath(q, { ...DEFAULT_ANSWERS, careerStage: "just-starting" })
      ).toBe(true);
      expect(
        questionAppliesToPath(q, { ...DEFAULT_ANSWERS, careerStage: "scaling" })
      ).toBe(true);
    }
  });

  it("foundational tail Q's apply on foundational path, not senior", async () => {
    const { questionAppliesToPath, DEFAULT_ANSWERS } = await import(
      "../app/onboarding/maya/_state"
    );
    const foundational: ReadonlyArray<QuestionId> = [
      "primaryGoals",
      "biggestBlockers",
      "ninetyDayPriority",
      "howSerious",
      "brandTypes",
    ];
    for (const q of foundational) {
      expect(
        questionAppliesToPath(q, { ...DEFAULT_ANSWERS, careerStage: "just-starting" })
      ).toBe(true);
      expect(
        questionAppliesToPath(q, { ...DEFAULT_ANSWERS, careerStage: "scaling" })
      ).toBe(false);
    }
  });

  it("senior tail Q's apply on senior path, not foundational", async () => {
    const { questionAppliesToPath, DEFAULT_ANSWERS } = await import(
      "../app/onboarding/maya/_state"
    );
    const senior: ReadonlyArray<QuestionId> = [
      "sixToTwelveMonthChanges",
      "deprioritizingPlatforms",
      "hiringReadiness",
    ];
    for (const q of senior) {
      expect(
        questionAppliesToPath(q, { ...DEFAULT_ANSWERS, careerStage: "monetizing" })
      ).toBe(true);
      expect(
        questionAppliesToPath(q, { ...DEFAULT_ANSWERS, careerStage: "building" })
      ).toBe(false);
    }
  });

  it("weeklyHoursAvailable applies to BOTH paths (shared tail Q)", async () => {
    const { questionAppliesToPath, DEFAULT_ANSWERS } = await import(
      "../app/onboarding/maya/_state"
    );
    expect(
      questionAppliesToPath("weeklyHoursAvailable", {
        ...DEFAULT_ANSWERS,
        careerStage: "just-starting",
      })
    ).toBe(true);
    expect(
      questionAppliesToPath("weeklyHoursAvailable", {
        ...DEFAULT_ANSWERS,
        careerStage: "scaling",
      })
    ).toBe(true);
  });
});

describe("Wave 2 — nextUnansweredIdx skips out-of-path Q's", () => {
  it("foundational creator: cursor lands on foundational tail Q's, never on senior tail", () => {
    let s = withPlan("manager");
    s = answerQuestion(s, "goal", "100K by EOY");
    s = answerQuestion(s, "careerStage", "just-starting");
    s = answerQuestion(s, "tone", "strategic");
    s = answerQuestion(s, "location", { city: "Austin", state: "TX", country: "US" });
    // Skip optional monthlyRevenue / longTermGoals
    s = markQuestionSkipped(s, "monthlyRevenue");
    s = answerQuestion(s, "revenueStreams", ["affiliate"]);
    s = markQuestionSkipped(s, "longTermGoals");
    s = answerQuestion(s, "brandDealFloorUsd", 0);
    // Foundational tail surfaces next.
    expect(currentQuestion(s)).toBe("primaryGoals");
    s = answerQuestion(s, "primaryGoals", ["grow-following", "build-community"]);
    expect(currentQuestion(s)).toBe("biggestBlockers");
    s = answerQuestion(s, "biggestBlockers", ["consistency", "unclear-niche"]);
    expect(currentQuestion(s)).toBe("ninetyDayPriority");
    s = answerQuestion(s, "ninetyDayPriority", "build-community");
    expect(currentQuestion(s)).toBe("howSerious");
    s = answerQuestion(s, "howSerious", "side-hustle");
    expect(currentQuestion(s)).toBe("brandTypes");
    s = answerQuestion(s, "brandTypes", ["fitness apparel"]);
    expect(currentQuestion(s)).toBe("weeklyHoursAvailable");
    s = answerQuestion(s, "weeklyHoursAvailable", 12);
    // Cursor parks past end — foundational creator never lands on senior Q's.
    expect(currentQuestion(s)).toBeNull();
  });

  it("senior creator: cursor lands on senior tail Q's, never on foundational tail", () => {
    let s = withPlan("manager");
    s = answerQuestion(s, "goal", "$15K MRR by EOY");
    s = answerQuestion(s, "careerStage", "scaling");
    s = answerQuestion(s, "tone", "strategic");
    s = answerQuestion(s, "location", { city: "NYC", state: "NY", country: "US" });
    s = markQuestionSkipped(s, "monthlyRevenue");
    s = answerQuestion(s, "revenueStreams", ["brand-deals", "courses"]);
    s = markQuestionSkipped(s, "longTermGoals");
    s = answerQuestion(s, "brandDealFloorUsd", 5000);
    // Senior tail surfaces next.
    expect(currentQuestion(s)).toBe("sixToTwelveMonthChanges");
    s = answerQuestion(s, "sixToTwelveMonthChanges", ["raise-rates", "hire-team"]);
    expect(currentQuestion(s)).toBe("deprioritizingPlatforms");
    s = answerQuestion(s, "deprioritizingPlatforms", ["x"]);
    expect(currentQuestion(s)).toBe("hiringReadiness");
    s = answerQuestion(s, "hiringReadiness", "considering");
    expect(currentQuestion(s)).toBe("weeklyHoursAvailable");
    s = answerQuestion(s, "weeklyHoursAvailable", 35);
    expect(currentQuestion(s)).toBeNull();
  });

  it("path flips when careerStage changes mid-flow (tail Q's recompute)", () => {
    let s = withPlan("manager");
    s = answerQuestion(s, "goal", "build a personal brand");
    // Start as foundational
    s = answerQuestion(s, "careerStage", "just-starting");
    s = answerQuestion(s, "tone", "supportive");
    s = answerQuestion(s, "location", { city: "Boise", state: "ID", country: "US" });
    s = markQuestionSkipped(s, "monthlyRevenue");
    s = answerQuestion(s, "revenueStreams", ["affiliate"]);
    s = markQuestionSkipped(s, "longTermGoals");
    s = answerQuestion(s, "brandDealFloorUsd", 0);
    expect(currentQuestion(s)).toBe("primaryGoals");
    // Creator changes careerStage to scaling — foundational tail no longer
    // applies; the cursor should jump to the senior tail.
    s = answerQuestion(s, "careerStage", "scaling");
    expect(currentQuestion(s)).toBe("sixToTwelveMonthChanges");
  });

  it("foundational tail Q's are all OPTIONAL — none block canAdvance", () => {
    let s = withPlan("manager");
    s = answerQuestion(s, "goal", "100K by EOY");
    s = answerQuestion(s, "careerStage", "just-starting");
    s = answerQuestion(s, "tone", "strategic");
    s = answerQuestion(s, "location", { city: "Austin", state: "TX", country: "US" });
    s = answerQuestion(s, "revenueStreams", ["affiliate"]);
    s = answerQuestion(s, "brandDealFloorUsd", 0);
    // No Wave 2 tail answers given — canAdvance still true.
    expect(canAdvance(s)).toBe(true);
  });
});
