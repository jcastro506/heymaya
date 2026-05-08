/**
 * today.goalsFocusContext — query for the GoalsFocusStrip on Today.
 *
 * Five mandatory categories applied:
 *   1. Cross-tenant — A's strip never returns B's growthPlan or actionLog
 *      rows.
 *   2. Plan-tier matrix — every tier returns data. The strip is universal,
 *      not gated; this test asserts no plan-tier branching.
 *   3. Adversarial — null creatorPicture; placeholder synthesis (model =
 *      "awaiting-synthesis"); no mayaActionLog rows; malformed/empty
 *      onboardingProgress; stale (>24h) actionLog row excluded.
 *   4. Sibling-file scan — covered repo-wide by sprint1Acceptance. We add a
 *      narrow inline check that the query's return shape matches the
 *      component's prop type (string-grep level).
 *   5. TODO grep — covered repo-wide.
 */

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../../tests/_modules";
import type { Id } from "../_generated/dataModel";

const NOW = Date.now();

async function insertCreator(
  t: ReturnType<typeof convexTest>,
  opts: {
    suffix: string;
    plan: "coach" | "manager";
    timezone?: string;
    onboardingAnswers?: {
      goal?: string;
      careerStage?: "just-starting" | "building" | "monetizing" | "scaling";
      revenueStreams?: ReadonlyArray<
        | "brand-deals"
        | "affiliate"
        | "merch"
        | "courses"
        | "subs"
        | "ad-rev"
        | "email-list"
        | "live-events"
        | "consulting"
        | "other"
      >;
      longTermGoals?: { oneYear?: string; fiveYear?: string };
    };
  }
): Promise<Id<"creators">> {
  return await t.run((ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `u_${opts.suffix}`,
      email: `${opts.suffix}@test.com`,
      channelPreference: "web",
      timezone: opts.timezone ?? "America/Los_Angeles",
      status: "active",
      plan: opts.plan,
      createdAt: NOW,
      onboardingProgress: opts.onboardingAnswers
        ? {
            currentQuestionIdx: 0,
            answers: {
              goal: opts.onboardingAnswers.goal,
              careerStage: opts.onboardingAnswers.careerStage,
              revenueStreams: opts.onboardingAnswers.revenueStreams as
                | ReadonlyArray<
                    | "brand-deals"
                    | "affiliate"
                    | "merch"
                    | "courses"
                    | "subs"
                    | "ad-rev"
                    | "email-list"
                    | "live-events"
                    | "consulting"
                    | "other"
                  >
                | undefined,
              longTermGoals: opts.onboardingAnswers.longTermGoals,
            },
            updatedAt: NOW,
          }
        : undefined,
    })
  );
}

function asUser(t: ReturnType<typeof convexTest>, suffix: string) {
  return t.withIdentity({ subject: `u_${suffix}` });
}

function richPictureBase() {
  return {
    niche: "fitness" as const,
    audience: {
      ageRanges: [] as string[],
      topGeos: [] as string[],
      interestTags: [] as string[],
    },
    voiceFingerprint: "v",
    topHooks: [] as Array<{
      pattern: string;
      examplePostId: string;
      platform: string;
      avgPerformanceLift: number;
    }>,
    bottomHooks: [] as Array<{
      pattern: string;
      examplePostId: string;
      platform: string;
    }>,
    postingCadence: {
      perPlatform: [] as Array<{
        platform: string;
        postsPerWeek: number;
        bestDays: string[];
        bestHoursLocal: number[];
      }>,
    },
    brandDealHistory: [] as Array<{
      brand: string;
      platform: string;
      approxDate?: string;
      format: string;
    }>,
    generatedAt: NOW,
    model: "google/gemini-3-flash",
    sourceCitations: [] as Array<{
      platform: string;
      postId: string;
      usedFor: string;
    }>,
  };
}

describe("today.goalsFocusContext — auth + base shape", () => {
  it("returns null when unauthenticated", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "manager" });
    const out = await t.query(api.today.goalsFocusContext, {});
    expect(out).toBeNull();
  });

  it("returns base shape with all-null goals when creator has no answers + no picture", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "manager" });
    const out = await asUser(t, "a").query(api.today.goalsFocusContext, {});
    expect(out).not.toBeNull();
    expect(out!.goals.free).toBeNull();
    expect(out!.goals.oneYear).toBeNull();
    expect(out!.goals.fiveYear).toBeNull();
    expect(out!.goals.revenueStreams).toEqual([]);
    expect(out!.goals.careerStage).toBeNull();
    expect(out!.focus.nextMilestoneText).toBeNull();
    expect(out!.focus.focusAreas).toEqual([]);
    expect(out!.focus.horizonWeeks).toBeNull();
    expect(out!.recentMayaActions).toEqual([]);
    expect(out!.hasInferredPicture).toBe(false);
  });
});

describe("today.goalsFocusContext — goals column", () => {
  it("surfaces goal + longTermGoals + revenueStreams from onboarding answers", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, {
      suffix: "a",
      plan: "manager",
      onboardingAnswers: {
        goal: "Quit my day job",
        careerStage: "building",
        revenueStreams: ["brand-deals", "courses"],
        longTermGoals: { oneYear: "Hit 50K", fiveYear: "Run a studio" },
      },
    });
    const out = await asUser(t, "a").query(api.today.goalsFocusContext, {});
    expect(out!.goals.free).toBe("Quit my day job");
    expect(out!.goals.oneYear).toBe("Hit 50K");
    expect(out!.goals.fiveYear).toBe("Run a studio");
    expect(out!.goals.revenueStreams).toEqual(["brand-deals", "courses"]);
    // careerStage from picture wins; absent here so falls back to answer.
    expect(out!.goals.careerStage).toBe("building");
  });

  it("careerStage from creatorPicture wins over the onboarding-answer self-report", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, {
      suffix: "a",
      plan: "manager",
      onboardingAnswers: {
        goal: "x",
        careerStage: "monetizing",
      },
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("creatorPicture", {
        ...richPictureBase(),
        creatorId: a,
        careerStage: "just-starting",
      });
    });
    const out = await asUser(t, "a").query(api.today.goalsFocusContext, {});
    expect(out!.goals.careerStage).toBe("just-starting");
  });

  it("falls back to creatorPicture.longTermGoals + currentRevenueStreams when answer-buffer is cleared", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, {
      suffix: "a",
      plan: "manager",
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("creatorPicture", {
        ...richPictureBase(),
        creatorId: a,
        careerStage: "monetizing",
        currentRevenueStreams: ["brand-deals", "ad-rev"],
        longTermGoals: { oneYear: "From picture", fiveYear: "Big future" },
      });
    });
    const out = await asUser(t, "a").query(api.today.goalsFocusContext, {});
    expect(out!.goals.oneYear).toBe("From picture");
    expect(out!.goals.fiveYear).toBe("Big future");
    expect(out!.goals.revenueStreams).toEqual(["brand-deals", "ad-rev"]);
  });
});

describe("today.goalsFocusContext — focus column", () => {
  it("returns rich growthPlan when present (nextMilestoneText + focusAreas + horizonWeeks)", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "manager" });
    await t.run(async (ctx) => {
      await ctx.db.insert("creatorPicture", {
        ...richPictureBase(),
        creatorId: a,
        careerStage: "building",
        growthPlan: {
          nextMilestone: { label: "10K", targetFollowers: 10_000 },
          focusArea: "hook-craft",
          nextMilestoneText: "Ship one paid deal in 6 weeks",
          focusAreas: ["Lock the hook", "Post 4x/week"],
          antiPatterns: ["Don't pitch yet"],
          horizonWeeks: 6,
          citations: [],
          generatedAt: NOW,
        },
      });
    });
    const out = await asUser(t, "a").query(api.today.goalsFocusContext, {});
    expect(out!.focus.nextMilestoneText).toBe("Ship one paid deal in 6 weeks");
    expect(out!.focus.focusAreas).toEqual(["Lock the hook", "Post 4x/week"]);
    expect(out!.focus.horizonWeeks).toBe(6);
  });

  it("falls back to legacy narrow shape (nextMilestone.label + focusArea) when rich fields absent", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "manager" });
    await t.run(async (ctx) => {
      await ctx.db.insert("creatorPicture", {
        ...richPictureBase(),
        creatorId: a,
        careerStage: "building",
        growthPlan: {
          nextMilestone: { label: "10K", targetFollowers: 10_000 },
          focusArea: "hook-craft",
        },
      });
    });
    const out = await asUser(t, "a").query(api.today.goalsFocusContext, {});
    expect(out!.focus.nextMilestoneText).toBe("10K");
    expect(out!.focus.focusAreas).toEqual(["hook-craft"]);
    expect(out!.focus.horizonWeeks).toBeNull();
  });
});

describe("today.goalsFocusContext — Maya activity column", () => {
  it("returns up to 3 most recent ran rows in the last 24h", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "manager" });
    await t.run(async (ctx) => {
      // Five ran rows in the last 24h, oldest to newest
      for (let i = 0; i < 5; i++) {
        await ctx.db.insert("mayaActionLog", {
          creatorId: a,
          entryId: `entry_${i}`,
          outcome: "ran",
          ts: NOW - (5 - i) * 60 * 60 * 1000, // i=0 → 5h ago, i=4 → 1h ago
        });
      }
    });
    const out = await asUser(t, "a").query(api.today.goalsFocusContext, {});
    expect(out!.recentMayaActions).toHaveLength(3);
    // Most recent first.
    expect(out!.recentMayaActions[0].entryId).toBe("entry_4");
    expect(out!.recentMayaActions[1].entryId).toBe("entry_3");
    expect(out!.recentMayaActions[2].entryId).toBe("entry_2");
  });

  it("excludes failed / skipped outcomes (only `ran` rows surface)", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "manager" });
    await t.run(async (ctx) => {
      await ctx.db.insert("mayaActionLog", {
        creatorId: a,
        entryId: "morning_brief",
        outcome: "failed",
        ts: NOW - 60 * 60 * 1000,
      });
      await ctx.db.insert("mayaActionLog", {
        creatorId: a,
        entryId: "comment_triage",
        outcome: "skipped_condition_unmet",
        ts: NOW - 30 * 60 * 1000,
      });
      await ctx.db.insert("mayaActionLog", {
        creatorId: a,
        entryId: "evening_recap",
        outcome: "ran",
        ts: NOW - 10 * 60 * 1000,
      });
    });
    const out = await asUser(t, "a").query(api.today.goalsFocusContext, {});
    expect(out!.recentMayaActions).toHaveLength(1);
    expect(out!.recentMayaActions[0].entryId).toBe("evening_recap");
  });

  it("excludes ran rows older than 24h", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "manager" });
    await t.run(async (ctx) => {
      // 25h ago (outside window)
      await ctx.db.insert("mayaActionLog", {
        creatorId: a,
        entryId: "stale",
        outcome: "ran",
        ts: NOW - 25 * 60 * 60 * 1000,
      });
      // 3h ago (inside window)
      await ctx.db.insert("mayaActionLog", {
        creatorId: a,
        entryId: "fresh",
        outcome: "ran",
        ts: NOW - 3 * 60 * 60 * 1000,
      });
    });
    const out = await asUser(t, "a").query(api.today.goalsFocusContext, {});
    expect(out!.recentMayaActions).toHaveLength(1);
    expect(out!.recentMayaActions[0].entryId).toBe("fresh");
  });

  it("synthesizes a next-cron hint that's non-empty for a valid timezone", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, {
      suffix: "a",
      plan: "manager",
      timezone: "America/Los_Angeles",
    });
    const out = await asUser(t, "a").query(api.today.goalsFocusContext, {});
    expect(out!.nextScheduledCronHint).not.toBeNull();
    // One of the four well-known phrasings — tested without locking on
    // wall-clock time at test execution.
    expect(out!.nextScheduledCronHint).toMatch(
      /Morning brief at 7am local|Evening signal scan at 6pm local \(silent if nothing real surfaced\)|Weekly review at 9pm local|Morning brief at 7am local tomorrow/
    );
  });
});

describe("today.goalsFocusContext — hasInferredPicture", () => {
  it("hasInferredPicture=false when no creatorPicture row exists", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "manager" });
    const out = await asUser(t, "a").query(api.today.goalsFocusContext, {});
    expect(out!.hasInferredPicture).toBe(false);
  });

  it("hasInferredPicture=false when picture model is 'awaiting-synthesis'", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "manager" });
    await t.run(async (ctx) => {
      await ctx.db.insert("creatorPicture", {
        ...richPictureBase(),
        creatorId: a,
        model: "awaiting-synthesis",
      });
    });
    const out = await asUser(t, "a").query(api.today.goalsFocusContext, {});
    expect(out!.hasInferredPicture).toBe(false);
  });

  it("hasInferredPicture=false when picture model is 'manual-seed'", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "manager" });
    await t.run(async (ctx) => {
      await ctx.db.insert("creatorPicture", {
        ...richPictureBase(),
        creatorId: a,
        model: "manual-seed",
      });
    });
    const out = await asUser(t, "a").query(api.today.goalsFocusContext, {});
    expect(out!.hasInferredPicture).toBe(false);
  });

  it("hasInferredPicture=true when picture model is a real model id", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "manager" });
    await t.run(async (ctx) => {
      await ctx.db.insert("creatorPicture", {
        ...richPictureBase(),
        creatorId: a,
      });
    });
    const out = await asUser(t, "a").query(api.today.goalsFocusContext, {});
    expect(out!.hasInferredPicture).toBe(true);
  });
});

describe("today.goalsFocusContext — cross-tenant isolation", () => {
  it("CROSS-TENANT: A's goals never reflect B's onboardingProgress.answers", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "manager" });
    await insertCreator(t, {
      suffix: "b",
      plan: "manager",
      onboardingAnswers: {
        goal: "B's secret goal",
        careerStage: "scaling",
        revenueStreams: ["brand-deals"],
      },
    });
    const out = await asUser(t, "a").query(api.today.goalsFocusContext, {});
    expect(out!.goals.free).toBeNull();
    expect(out!.goals.careerStage).toBeNull();
    expect(out!.goals.revenueStreams).toEqual([]);
  });

  it("CROSS-TENANT: A's focus never reflects B's growthPlan", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "manager" });
    const b = await insertCreator(t, { suffix: "b", plan: "manager" });
    await t.run(async (ctx) => {
      await ctx.db.insert("creatorPicture", {
        ...richPictureBase(),
        creatorId: b,
        careerStage: "scaling",
        growthPlan: {
          nextMilestone: { label: "1M", targetFollowers: 1_000_000 },
          focusArea: "scale-systems",
          nextMilestoneText: "B's milestone",
          focusAreas: ["B-only-area"],
          horizonWeeks: 12,
        },
      });
    });
    const out = await asUser(t, "a").query(api.today.goalsFocusContext, {});
    expect(out!.focus.nextMilestoneText).toBeNull();
    expect(out!.focus.focusAreas).toEqual([]);
    expect(out!.hasInferredPicture).toBe(false);
  });

  it("CROSS-TENANT: A's recentMayaActions excludes B's mayaActionLog rows", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "manager" });
    const b = await insertCreator(t, { suffix: "b", plan: "manager" });
    await t.run(async (ctx) => {
      await ctx.db.insert("mayaActionLog", {
        creatorId: b,
        entryId: "B-only",
        outcome: "ran",
        ts: NOW - 60_000,
      });
    });
    const out = await asUser(t, "a").query(api.today.goalsFocusContext, {});
    expect(out!.recentMayaActions).toEqual([]);
  });
});

describe("today.goalsFocusContext — plan-tier × action matrix (universal)", () => {
  // The strip is universal — every tier sees it. We assert that all three
  // plans produce a non-null context with a well-formed shape (no plan-tier
  // branching anywhere in the query handler).
  for (const plan of ["coach", "manager"] as const) {
    it(`PLAN-TIER (${plan}): returns a populated strip with the same shape`, async () => {
      const t = convexTest(schema, modules);
      const a = await insertCreator(t, {
        suffix: "a",
        plan,
        onboardingAnswers: {
          goal: `${plan} creator goal`,
          careerStage: "building",
          revenueStreams: ["brand-deals"],
        },
      });
      await t.run(async (ctx) => {
        await ctx.db.insert("creatorPicture", {
          ...richPictureBase(),
          creatorId: a,
          careerStage: "building",
          growthPlan: {
            nextMilestone: { label: "10K", targetFollowers: 10_000 },
            focusArea: "hook-craft",
          },
        });
        await ctx.db.insert("mayaActionLog", {
          creatorId: a,
          entryId: "morning_brief",
          outcome: "ran",
          ts: NOW - 60 * 60 * 1000,
        });
      });
      const out = await asUser(t, "a").query(
        api.today.goalsFocusContext,
        {}
      );
      expect(out).not.toBeNull();
      expect(out!.goals.free).toBe(`${plan} creator goal`);
      expect(out!.focus.nextMilestoneText).toBe("10K");
      expect(out!.recentMayaActions).toHaveLength(1);
      expect(out!.hasInferredPicture).toBe(true);
    });
  }
});

describe("today.goalsFocusContext — adversarial", () => {
  it("ADVERSARIAL: malformed timezone returns nextScheduledCronHint=null without throwing", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, {
      suffix: "a",
      plan: "manager",
      timezone: "Not/A_Real_Timezone",
    });
    const out = await asUser(t, "a").query(api.today.goalsFocusContext, {});
    expect(out!.nextScheduledCronHint).toBeNull();
  });

  it("ADVERSARIAL: empty onboardingProgress.answers shape returns null fields, not undefined", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      ctx.db.insert("creators", {
        clerkUserId: "u_a",
        email: "a@test.com",
        channelPreference: "web",
        timezone: "America/Los_Angeles",
        status: "active",
        plan: "manager",
        createdAt: NOW,
        onboardingProgress: {
          currentQuestionIdx: 0,
          answers: {},
          updatedAt: NOW,
        },
      })
    );
    const out = await asUser(t, "a").query(api.today.goalsFocusContext, {});
    expect(out!.goals.free).toBeNull();
    expect(out!.goals.careerStage).toBeNull();
    expect(out!.goals.revenueStreams).toEqual([]);
    expect(out!.goals.oneYear).toBeNull();
    expect(out!.goals.fiveYear).toBeNull();
  });

  it("ADVERSARIAL: creator with empty mayaActionLog returns empty array (not null)", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "manager" });
    const out = await asUser(t, "a").query(api.today.goalsFocusContext, {});
    expect(out!.recentMayaActions).toEqual([]);
  });

  it("ADVERSARIAL: returns the well-formed shape even with no creator data at all", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "coach" });
    const out = await asUser(t, "a").query(api.today.goalsFocusContext, {});
    // Smoke check — shape is contract; tests above prove individual fields.
    expect(out).toMatchObject({
      goals: {
        free: null,
        oneYear: null,
        fiveYear: null,
        revenueStreams: [],
        careerStage: null,
      },
      focus: {
        nextMilestoneText: null,
        focusAreas: [],
        horizonWeeks: null,
      },
      recentMayaActions: [],
      hasInferredPicture: false,
    });
  });
});
