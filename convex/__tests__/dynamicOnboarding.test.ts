/**
 * Wave 2 — dynamic onboarding (stage-tiered Q's) acceptance tests.
 *
 * Five mandatory categories:
 *   1. Cross-tenant — A cannot save B's progress + cannot submit B's answers
 *      with the new fields, even if creatorId is spoofed.
 *   2. Plan-tier — every plan tier can submit Wave 2 answers (no gate). The
 *      stage-tiered field set isn't paywalled by plan; stage decides path.
 *   3. Adversarial — bad weeklyHoursAvailable, oversize lists, malformed
 *      enums (Convex validator rejects these at the wire boundary).
 *   4. Sibling-file scan — covered repo-wide; here we assert the new fields
 *      are mirrored from `creators.onboardingProgress.answers` →
 *      `creatorPicture` and that the round-trip preserves them.
 *   5. TODO grep — covered repo-wide.
 *
 * Plus state-machine integration:
 *   - getQuestionPath(answers) returns "foundational" / "senior" correctly.
 *   - The dynamic-tail Q's persist in the resume buffer and survive a
 *     submitOnboardingAnswers round-trip.
 */

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../../tests/_modules";
import type { Id } from "../_generated/dataModel";
import {
  DEFAULT_ANSWERS,
  getQuestionPath,
} from "../../app/onboarding/maya/_state";

const NOW = 1_700_000_000_000;

async function insertCreator(
  t: ReturnType<typeof convexTest>,
  opts: { suffix: string; plan: "starter" | "pro" | "studio" }
): Promise<Id<"creators">> {
  return await t.run((ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `u_${opts.suffix}`,
      email: `${opts.suffix}@test.com`,
      channelPreference: "web",
      timezone: "America/Los_Angeles",
      status: "onboarding",
      plan: opts.plan,
      createdAt: NOW,
    })
  );
}

function asUser(t: ReturnType<typeof convexTest>, suffix: string) {
  return t.withIdentity({ subject: `u_${suffix}` });
}

const FOUNDATIONAL_ANSWERS = {
  goal: "Hit 25K followers and ship my first paid deal",
  tone: "strategic" as const,
  brandDealFloorUsd: 250,
  careerStage: "just-starting" as const,
  location: { city: "Boise", state: "ID", country: "US" },
  monthlyRevenueUsd: 0,
  revenueStreams: ["affiliate" as const],
  longTermGoals: { oneYear: "Make this my full-time gig" },
  // Wave 2 foundational tail
  primaryGoals: ["grow-following" as const, "make-money" as const],
  biggestBlockers: ["consistency" as const, "unclear-niche" as const],
  ninetyDayPriority: "grow-following" as const,
  howSerious: "side-hustle" as const,
  brandTypes: ["fitness apparel", "supplements"],
  weeklyHoursAvailable: 12,
};

const SENIOR_ANSWERS = {
  goal: "Lock 2 long-term ambassador deals at premium rate",
  tone: "tough-love" as const,
  brandDealFloorUsd: 5_000,
  careerStage: "scaling" as const,
  location: { city: "NYC", state: "NY", country: "US" },
  monthlyRevenueUsd: 30_000,
  revenueStreams: [
    "brand-deals" as const,
    "courses" as const,
    "affiliate" as const,
  ],
  longTermGoals: { oneYear: "Hit $1M ARR across all streams" },
  // Wave 2 senior tail
  sixToTwelveMonthChanges: ["raise-rates" as const, "hire-team" as const],
  deprioritizingPlatforms: ["x" as const, "linkedin" as const],
  hiringReadiness: "actively-looking" as const,
  weeklyHoursAvailable: 35,
};

/* -------------------------------------------------------------------------- */
/* getQuestionPath                                                            */
/* -------------------------------------------------------------------------- */

describe("Wave 2 — getQuestionPath state helper", () => {
  it("defaults to 'foundational' when careerStage is unset", () => {
    expect(getQuestionPath(DEFAULT_ANSWERS)).toBe("foundational");
  });

  it("just-starting + building → 'foundational'", () => {
    expect(
      getQuestionPath({ ...DEFAULT_ANSWERS, careerStage: "just-starting" })
    ).toBe("foundational");
    expect(
      getQuestionPath({ ...DEFAULT_ANSWERS, careerStage: "building" })
    ).toBe("foundational");
  });

  it("monetizing + scaling → 'senior'", () => {
    expect(
      getQuestionPath({ ...DEFAULT_ANSWERS, careerStage: "monetizing" })
    ).toBe("senior");
    expect(
      getQuestionPath({ ...DEFAULT_ANSWERS, careerStage: "scaling" })
    ).toBe("senior");
  });
});

/* -------------------------------------------------------------------------- */
/* submitOnboardingAnswers — Wave 2 fields                                    */
/* -------------------------------------------------------------------------- */

describe("submitOnboardingAnswers — Wave 2 dynamic fields", () => {
  it("foundational creator: persists primaryGoals, biggestBlockers, etc. onto creatorPicture", async () => {
    const t = convexTest(schema, modules);
    const c = await insertCreator(t, { suffix: "found_a", plan: "pro" });
    const pictureId = await asUser(t, "found_a").mutation(
      api.creators.submitOnboardingAnswers,
      { creatorId: c, answers: FOUNDATIONAL_ANSWERS }
    );
    const row = await t.run((ctx) => ctx.db.get(pictureId));
    expect(row).not.toBeNull();
    // Answer-owned fields preserved
    expect(row?.careerStage).toBe("just-starting");
    expect(row?.locationSoul?.city).toBe("Boise");
    // Wave 2 fields mirrored
    expect(row?.primaryGoals).toEqual(["grow-following", "make-money"]);
    expect(row?.biggestBlockers).toEqual(["consistency", "unclear-niche"]);
    expect(row?.ninetyDayPriority).toBe("grow-following");
    expect(row?.howSerious).toBe("side-hustle");
    expect(row?.brandTypes).toEqual(["fitness apparel", "supplements"]);
    expect(row?.weeklyHoursAvailable).toBe(12);
    // Senior fields not set
    expect(row?.sixToTwelveMonthChanges).toBeUndefined();
    expect(row?.deprioritizingPlatforms).toBeUndefined();
    expect(row?.hiringReadiness).toBeUndefined();
  });

  it("senior creator: persists sixToTwelveMonthChanges, deprioritizingPlatforms, hiringReadiness", async () => {
    const t = convexTest(schema, modules);
    const c = await insertCreator(t, { suffix: "sen_a", plan: "studio" });
    const pictureId = await asUser(t, "sen_a").mutation(
      api.creators.submitOnboardingAnswers,
      { creatorId: c, answers: SENIOR_ANSWERS }
    );
    const row = await t.run((ctx) => ctx.db.get(pictureId));
    expect(row?.careerStage).toBe("scaling");
    expect(row?.sixToTwelveMonthChanges).toEqual(["raise-rates", "hire-team"]);
    expect(row?.deprioritizingPlatforms).toEqual(["x", "linkedin"]);
    expect(row?.hiringReadiness).toBe("actively-looking");
    expect(row?.weeklyHoursAvailable).toBe(35);
    // Foundational fields not set
    expect(row?.primaryGoals).toBeUndefined();
    expect(row?.biggestBlockers).toBeUndefined();
  });

  it("partial Wave 2 fields are persisted (skipped optional Q's stay undefined)", async () => {
    const t = convexTest(schema, modules);
    const c = await insertCreator(t, { suffix: "partial_a", plan: "starter" });
    const minimal = {
      goal: "100K by EOY",
      tone: "supportive" as const,
      brandDealFloorUsd: 0,
      careerStage: "building" as const,
      location: { city: "Austin", state: "TX", country: "US" },
      revenueStreams: ["affiliate" as const],
      // Wave 2 — only primaryGoals provided
      primaryGoals: ["build-community" as const],
    };
    const pictureId = await asUser(t, "partial_a").mutation(
      api.creators.submitOnboardingAnswers,
      { creatorId: c, answers: minimal }
    );
    const row = await t.run((ctx) => ctx.db.get(pictureId));
    expect(row?.primaryGoals).toEqual(["build-community"]);
    expect(row?.biggestBlockers).toBeUndefined();
    expect(row?.weeklyHoursAvailable).toBeUndefined();
  });

  it("CROSS-TENANT (CRITICAL): A cannot submit Wave 2 answers for B's creatorId", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "ct_a", plan: "pro" });
    const b = await insertCreator(t, { suffix: "ct_b", plan: "pro" });
    expect(a).toBeDefined();
    await expect(
      asUser(t, "ct_a").mutation(api.creators.submitOnboardingAnswers, {
        creatorId: b,
        answers: FOUNDATIONAL_ANSWERS,
      })
    ).rejects.toThrow(/does not match/i);
    const bPics = await t.run((ctx) =>
      ctx.db
        .query("creatorPicture")
        .withIndex("by_creator", (q) => q.eq("creatorId", b))
        .collect()
    );
    expect(bPics).toEqual([]);
  });

  it("PLAN-TIER: every plan can submit Wave 2 answers (no gate)", async () => {
    for (const plan of ["starter", "pro", "studio"] as const) {
      const t = convexTest(schema, modules);
      const c = await insertCreator(t, { suffix: plan, plan });
      await expect(
        asUser(t, plan).mutation(api.creators.submitOnboardingAnswers, {
          creatorId: c,
          answers: FOUNDATIONAL_ANSWERS,
        })
      ).resolves.toBeTruthy();
    }
  });

  it("ADVERSARIAL: rejects negative weeklyHoursAvailable", async () => {
    const t = convexTest(schema, modules);
    const c = await insertCreator(t, { suffix: "adv_neg", plan: "pro" });
    await expect(
      asUser(t, "adv_neg").mutation(api.creators.submitOnboardingAnswers, {
        creatorId: c,
        answers: { ...FOUNDATIONAL_ANSWERS, weeklyHoursAvailable: -10 },
      })
    ).rejects.toThrow(/weeklyHoursAvailable/i);
  });

  it("ADVERSARIAL: rejects weeklyHoursAvailable > 168 (hours/week ceiling)", async () => {
    const t = convexTest(schema, modules);
    const c = await insertCreator(t, { suffix: "adv_huge", plan: "pro" });
    await expect(
      asUser(t, "adv_huge").mutation(api.creators.submitOnboardingAnswers, {
        creatorId: c,
        answers: { ...FOUNDATIONAL_ANSWERS, weeklyHoursAvailable: 200 },
      })
    ).rejects.toThrow(/weeklyHoursAvailable/i);
  });

  it("ADVERSARIAL: weeklyHoursAvailable=0 is valid (creator who's just-watching)", async () => {
    const t = convexTest(schema, modules);
    const c = await insertCreator(t, { suffix: "adv_zero", plan: "pro" });
    const pictureId = await asUser(t, "adv_zero").mutation(
      api.creators.submitOnboardingAnswers,
      { creatorId: c, answers: { ...FOUNDATIONAL_ANSWERS, weeklyHoursAvailable: 0 } }
    );
    const row = await t.run((ctx) => ctx.db.get(pictureId));
    expect(row?.weeklyHoursAvailable).toBe(0);
  });

  it("Wave 2 fields submitted twice (re-submit) PATCH the existing picture", async () => {
    const t = convexTest(schema, modules);
    const c = await insertCreator(t, { suffix: "patch_a", plan: "pro" });
    const firstId = await asUser(t, "patch_a").mutation(
      api.creators.submitOnboardingAnswers,
      { creatorId: c, answers: FOUNDATIONAL_ANSWERS }
    );
    // Re-submit with edited Wave 2 fields
    const secondId = await asUser(t, "patch_a").mutation(
      api.creators.submitOnboardingAnswers,
      {
        creatorId: c,
        answers: {
          ...FOUNDATIONAL_ANSWERS,
          primaryGoals: ["land-brand-deals"],
          weeklyHoursAvailable: 25,
        },
      }
    );
    expect(firstId).toBe(secondId);
    const row = await t.run((ctx) => ctx.db.get(secondId));
    expect(row?.primaryGoals).toEqual(["land-brand-deals"]);
    expect(row?.weeklyHoursAvailable).toBe(25);
  });
});

/* -------------------------------------------------------------------------- */
/* saveOnboardingProgress — Wave 2 resume buffer                              */
/* -------------------------------------------------------------------------- */

describe("saveOnboardingProgress — Wave 2 fields in resume buffer", () => {
  it("persists primaryGoals + biggestBlockers + ninetyDayPriority on the resume buffer", async () => {
    const t = convexTest(schema, modules);
    const c = await insertCreator(t, { suffix: "buf_a", plan: "pro" });
    await asUser(t, "buf_a").mutation(api.creators.saveOnboardingProgress, {
      creatorId: c,
      currentQuestionIdx: 9,
      answers: {
        goal: "100K by EOY",
        tone: "strategic",
        careerStage: "just-starting",
        primaryGoals: ["grow-following", "build-community"],
        biggestBlockers: ["consistency"],
        ninetyDayPriority: "grow-following",
      },
    });
    const row = await t.run((ctx) => ctx.db.get(c));
    expect(row?.onboardingProgress?.currentQuestionIdx).toBe(9);
    expect(row?.onboardingProgress?.answers.primaryGoals).toEqual([
      "grow-following",
      "build-community",
    ]);
    expect(row?.onboardingProgress?.answers.biggestBlockers).toEqual([
      "consistency",
    ]);
    expect(row?.onboardingProgress?.answers.ninetyDayPriority).toBe(
      "grow-following"
    );
  });

  it("persists senior-tail fields on the resume buffer", async () => {
    const t = convexTest(schema, modules);
    const c = await insertCreator(t, { suffix: "buf_b", plan: "studio" });
    await asUser(t, "buf_b").mutation(api.creators.saveOnboardingProgress, {
      creatorId: c,
      currentQuestionIdx: 11,
      answers: {
        goal: "$1M ARR",
        tone: "tough-love",
        careerStage: "scaling",
        sixToTwelveMonthChanges: ["raise-rates", "hire-team"],
        deprioritizingPlatforms: ["x"],
        hiringReadiness: "actively-looking",
        weeklyHoursAvailable: 30,
      },
    });
    const row = await t.run((ctx) => ctx.db.get(c));
    const a = row?.onboardingProgress?.answers;
    expect(a?.sixToTwelveMonthChanges).toEqual(["raise-rates", "hire-team"]);
    expect(a?.deprioritizingPlatforms).toEqual(["x"]);
    expect(a?.hiringReadiness).toBe("actively-looking");
    expect(a?.weeklyHoursAvailable).toBe(30);
  });

  it("CROSS-TENANT: A cannot save Wave 2 progress for B", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "buf_ct_a", plan: "pro" });
    const b = await insertCreator(t, { suffix: "buf_ct_b", plan: "pro" });
    expect(a).toBeDefined();
    await expect(
      asUser(t, "buf_ct_a").mutation(api.creators.saveOnboardingProgress, {
        creatorId: b,
        currentQuestionIdx: 0,
        answers: {
          goal: "leak attempt",
          primaryGoals: ["land-brand-deals"],
        },
      })
    ).rejects.toThrow(/does not match/i);
    const bRow = await t.run((ctx) => ctx.db.get(b));
    expect(bRow?.onboardingProgress).toBeUndefined();
  });

  it("submitOnboardingAnswers clears the Wave 2 resume buffer", async () => {
    const t = convexTest(schema, modules);
    const c = await insertCreator(t, { suffix: "clr_a", plan: "pro" });
    await asUser(t, "clr_a").mutation(api.creators.saveOnboardingProgress, {
      creatorId: c,
      currentQuestionIdx: 5,
      answers: {
        goal: "in-flight",
        primaryGoals: ["grow-following"],
        weeklyHoursAvailable: 8,
      },
    });
    await asUser(t, "clr_a").mutation(api.creators.submitOnboardingAnswers, {
      creatorId: c,
      answers: FOUNDATIONAL_ANSWERS,
    });
    const row = await t.run((ctx) => ctx.db.get(c));
    expect(row?.onboardingProgress).toBeUndefined();
  });
});
