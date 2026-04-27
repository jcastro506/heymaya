/**
 * creators.ts mutations — Sprint 3.7 acceptance.
 *
 * Five mandatory categories:
 *   1. Cross-tenant: Creator A cannot write a creatorPicture row for
 *      Creator B even if they spoof the creatorId in the args.
 *   2. Plan-tier: every plan can submit onboarding answers (no gate).
 *      Plan-tier matrix lives in `today.test.ts` for the read paths.
 *   3. Adversarial: empty answers payload, missing required fields,
 *      negative monthlyRevenueUsd, empty revenueStreams.
 *   4. Sibling-file scan: covered repo-wide by sprint1Acceptance.
 *   5. TODO grep: covered repo-wide by sprint1Acceptance.
 */

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../../tests/_modules";
import type { Id } from "../_generated/dataModel";

const NOW = 1_700_000_000_000;

async function insertCreator(
  t: ReturnType<typeof convexTest>,
  opts: {
    suffix: string;
    plan: "starter" | "pro" | "studio";
  }
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

const FULL_ANSWERS = {
  goal: "100K on IG by year end",
  tone: "strategic" as const,
  brandDealFloorUsd: 750,
  careerStage: "building" as const,
  location: { city: "Austin", state: "TX", country: "US" },
  monthlyRevenueUsd: 6_000,
  revenueStreams: ["brand-deals" as const, "affiliate" as const],
  longTermGoals: { oneYear: "ship a course in Q3" },
};

/* -------------------------------------------------------------------------- */
/* submitOnboardingAnswers                                                    */
/* -------------------------------------------------------------------------- */

describe("creators.submitOnboardingAnswers", () => {
  it("inserts a stub creatorPicture row when none exists, with the new fields", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    const pictureId = await asUser(t, "a").mutation(
      api.creators.submitOnboardingAnswers,
      { creatorId: a, answers: FULL_ANSWERS }
    );
    expect(pictureId).toBeTruthy();

    const row = await t.run((ctx) => ctx.db.get(pictureId));
    expect(row).not.toBeNull();
    expect(row?.careerStage).toBe("building");
    expect(row?.locationSoul?.city).toBe("Austin");
    expect(row?.locationSoul?.state).toBe("TX");
    expect(row?.monthlyRevenueUsd).toBe(6_000);
    expect(row?.currentRevenueStreams).toEqual(["brand-deals", "affiliate"]);
    expect(row?.longTermGoals?.oneYear).toBe("ship a course in Q3");
  });

  it("patches an existing creatorPicture row instead of duplicating it", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    // Pre-seed the picture (e.g. multimodal synth ran first).
    const seedId = await t.run((ctx) =>
      ctx.db.insert("creatorPicture", {
        creatorId: a,
        niche: "fitness",
        audience: { ageRanges: ["25-34"], topGeos: ["US"], interestTags: ["fit"] },
        voiceFingerprint: "punchy",
        topHooks: [],
        bottomHooks: [],
        postingCadence: { perPlatform: [] },
        brandDealHistory: [],
        generatedAt: NOW,
        model: "gemini-3-flash",
        sourceCitations: [],
      })
    );
    const returnedId = await asUser(t, "a").mutation(
      api.creators.submitOnboardingAnswers,
      { creatorId: a, answers: FULL_ANSWERS }
    );
    expect(returnedId).toBe(seedId);

    const all = await t.run((ctx) =>
      ctx.db
        .query("creatorPicture")
        .withIndex("by_creator", (q) => q.eq("creatorId", a))
        .collect()
    );
    expect(all).toHaveLength(1);
    expect(all[0].niche).toBe("fitness"); // synth-owned field preserved
    expect(all[0].careerStage).toBe("building"); // 3.7 patch applied
  });

  it("CROSS-TENANT (CRITICAL): Creator A cannot write Creator B's picture even if they spoof creatorId", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    const b = await insertCreator(t, { suffix: "b", plan: "pro" });
    expect(a).toBeDefined();
    await expect(
      asUser(t, "a").mutation(api.creators.submitOnboardingAnswers, {
        creatorId: b, // <-- spoofed
        answers: FULL_ANSWERS,
      })
    ).rejects.toThrow(/does not match/i);

    // Creator B has NO picture row.
    const bPics = await t.run((ctx) =>
      ctx.db
        .query("creatorPicture")
        .withIndex("by_creator", (q) => q.eq("creatorId", b))
        .collect()
    );
    expect(bPics).toEqual([]);
  });

  it("rejects unauthenticated calls", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    await expect(
      t.mutation(api.creators.submitOnboardingAnswers, {
        creatorId: a,
        answers: FULL_ANSWERS,
      })
    ).rejects.toThrow(/not authenticated/i);
  });

  it("ADVERSARIAL: rejects an empty goal", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    await expect(
      asUser(t, "a").mutation(api.creators.submitOnboardingAnswers, {
        creatorId: a,
        answers: { ...FULL_ANSWERS, goal: "   " },
      })
    ).rejects.toThrow(/goal/i);
  });

  it("ADVERSARIAL: rejects missing careerStage", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    await expect(
      asUser(t, "a").mutation(api.creators.submitOnboardingAnswers, {
        creatorId: a,
        answers: { ...FULL_ANSWERS, careerStage: undefined },
      })
    ).rejects.toThrow(/careerStage/i);
  });

  it("ADVERSARIAL: rejects negative monthlyRevenueUsd", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    await expect(
      asUser(t, "a").mutation(api.creators.submitOnboardingAnswers, {
        creatorId: a,
        answers: { ...FULL_ANSWERS, monthlyRevenueUsd: -100 },
      })
    ).rejects.toThrow(/monthlyRevenueUsd/i);
  });

  it("ADVERSARIAL: rejects empty revenueStreams array", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    await expect(
      asUser(t, "a").mutation(api.creators.submitOnboardingAnswers, {
        creatorId: a,
        answers: { ...FULL_ANSWERS, revenueStreams: [] },
      })
    ).rejects.toThrow(/revenueStreams/i);
  });

  it("ADVERSARIAL: rejects missing location.city/state", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    await expect(
      asUser(t, "a").mutation(api.creators.submitOnboardingAnswers, {
        creatorId: a,
        answers: { ...FULL_ANSWERS, location: { city: "", state: "TX", country: "US" } },
      })
    ).rejects.toThrow(/location/i);
  });

  it("monthlyRevenueUsd + longTermGoals are optional (skipped path)", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    const minimal = {
      goal: "100K by EOY",
      tone: "supportive" as const,
      brandDealFloorUsd: 0,
      careerStage: "just-starting" as const,
      location: { city: "Austin", state: "TX", country: "US" },
      revenueStreams: ["affiliate" as const],
      // monthlyRevenueUsd omitted, longTermGoals omitted
    };
    const pictureId = await asUser(t, "a").mutation(
      api.creators.submitOnboardingAnswers,
      { creatorId: a, answers: minimal }
    );
    const row = await t.run((ctx) => ctx.db.get(pictureId));
    expect(row?.monthlyRevenueUsd).toBeUndefined();
    expect(row?.longTermGoals).toBeUndefined();
  });

  it("PLAN-TIER: every plan tier can submit answers (no gate)", async () => {
    for (const plan of ["starter", "pro", "studio"] as const) {
      const t = convexTest(schema, modules);
      const c = await insertCreator(t, { suffix: plan, plan });
      await expect(
        asUser(t, plan).mutation(api.creators.submitOnboardingAnswers, {
          creatorId: c,
          answers: FULL_ANSWERS,
        })
      ).resolves.toBeTruthy();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* saveOnboardingProgress (resume buffer)                                     */
/* -------------------------------------------------------------------------- */

describe("creators.saveOnboardingProgress", () => {
  it("persists a partial answer slice + cursor on creators.onboardingProgress", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    await asUser(t, "a").mutation(api.creators.saveOnboardingProgress, {
      creatorId: a,
      currentQuestionIdx: 3,
      answers: {
        goal: "100K by EOY",
        tone: "strategic",
        brandDealFloorUsd: 500,
      },
    });
    const row = await t.run((ctx) => ctx.db.get(a));
    expect(row?.onboardingProgress?.currentQuestionIdx).toBe(3);
    expect(row?.onboardingProgress?.answers.goal).toBe("100K by EOY");
  });

  it("CROSS-TENANT: A cannot save progress for B", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    const b = await insertCreator(t, { suffix: "b", plan: "pro" });
    expect(a).toBeDefined();
    await expect(
      asUser(t, "a").mutation(api.creators.saveOnboardingProgress, {
        creatorId: b,
        currentQuestionIdx: 0,
        answers: { goal: "leak attempt" },
      })
    ).rejects.toThrow(/does not match/i);
    const bRow = await t.run((ctx) => ctx.db.get(b));
    expect(bRow?.onboardingProgress).toBeUndefined();
  });

  it("submitOnboardingAnswers clears the resume buffer once the picture row lands", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    await asUser(t, "a").mutation(api.creators.saveOnboardingProgress, {
      creatorId: a,
      currentQuestionIdx: 5,
      answers: { goal: "in-flight" },
    });
    await asUser(t, "a").mutation(api.creators.submitOnboardingAnswers, {
      creatorId: a,
      answers: FULL_ANSWERS,
    });
    const row = await t.run((ctx) => ctx.db.get(a));
    expect(row?.onboardingProgress).toBeUndefined();
  });
});
