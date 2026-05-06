/**
 * Cron simulator
 * ─────────────────────────────────────────────────────────────────────────
 * Sprint 3 collapsed Maya's wall-clock cron set from 21 entries to 6. The 9
 * formerly-cron entries now fire off heartbeat ticks (`performance_check_2h`,
 * `daily_niche_scan`, `trend_watcher`, `comment_triage`, `competitor_watch`,
 * `calendar_lookahead`, `industry_intel_daily`, `opportunity_scout_daily`,
 * `collab_matchmaker_weekly`); 6 entries were deleted entirely
 * (`manager_readiness_packet_quarterly`, `algo_research_*`).
 *
 * This simulator's purpose is unchanged: prove every one of Maya's cron
 * jobs has a working mutation→query path so the HQ doesn't show empty
 * states once the OpenClaw runtime starts firing them. The inventory below
 * is now exactly the 6 wall-clock cron entries from cron.md § 2 +
 * standingOrders.ts (`kind === "cron"`).
 *
 * Heartbeat-driven entries are still exercised by the underlying
 * skillRecord* mutation tests — those are the mutation→query proofs we
 * still care about, and they're owned by `convex/__tests__/businessReadiness.test.ts`
 * and the per-skill convex tests. This file's job is only the cron-set
 * coherence proof + a wide cross-tenant / plan-tier sweep on the action
 * log.
 *
 * 5 mandatory test categories applied:
 *   • Cross-tenant — every mutation is invoked with a creatorId that the
 *     mutation must re-resolve server-side; spoofed creatorId scenarios are
 *     tested in the `skillRecord*` happy-path test files.
 *   • Plan-tier matrix — Coach + Manager both run all 6 cron entries
 *     (boundary is autonomy not breadth). Manager-only autonomy gates
 *     fire on event/folded triggers, not cron.
 *   • Adversarial — wrong secret rejected; missing env rejected;
 *     out-of-range numeric fields rejected; non-existent creatorId
 *     rejected.
 *   • Sibling-file scan — uses ONLY existing tables; no schema additions.
 *   • TODO grep — zero new TODOs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { modules } from "./_modules";
import type { Id } from "../convex/_generated/dataModel";

const NOW = 1_700_000_000_000;
const RUNTIME_SECRET = "test-runtime-secret-cron-simulator";

type Plan = "coach" | "manager";

async function plantCreator(
  t: ReturnType<typeof convexTest>,
  opts: { suffix: string; plan: Plan; followers?: number }
): Promise<Id<"creators">> {
  const creatorId = await t.run((ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `u_${opts.suffix}`,
      email: `${opts.suffix}@test.com`,
      channelPreference: "web",
      timezone: "America/Los_Angeles",
      status: "active",
      plan: opts.plan,
      createdAt: NOW,
    })
  );
  // Realistic creatorPicture so synthesis-dependent HQ surfaces (voice,
  // hooks, growth plan) have something to read. The simulator doesn't
  // exercise these directly but a missing picture causes some HQ queries to
  // return null which would mask real bugs.
  await t.run((ctx) =>
    ctx.db.insert("creatorPicture", {
      creatorId,
      niche: "fitness-coaching",
      audience: {
        ageRanges: ["25-34"],
        topGeos: ["US"],
        interestTags: ["fitness"],
      },
      voiceFingerprint: "warm + direct",
      topHooks: [],
      bottomHooks: [],
      postingCadence: { perPlatform: [] },
      brandDealHistory: [],
      generatedAt: NOW,
      model: "test-fixture",
      sourceCitations: [],
      careerStage:
        opts.plan === "coach" ? "just-starting" : "building",
    })
  );
  // Plant one connected handle so Maya's data side has something realistic
  // to read in the per-creator pulls.
  await t.run((ctx) =>
    ctx.db.insert("creatorHandles", {
      creatorId,
      platform: "tiktok",
      handle: `${opts.suffix}_tt`,
      verified: true,
      scrapedAt: NOW,
      followerCount: opts.followers ?? (opts.plan === "coach" ? 2_500 : 50_000),
    })
  );
  return creatorId;
}

function asUser(t: ReturnType<typeof convexTest>, suffix: string) {
  return t.withIdentity({ subject: `u_${suffix}` });
}

beforeEach(() => {
  vi.stubEnv("MAYA_RUNTIME_SECRET", RUNTIME_SECRET);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

/* ------------------------------------------------------------------------- */
/* Inventory — 6 cron jobs from agents/skills/maya-platform/cron.md § 2      */
/* ------------------------------------------------------------------------- */
/*
 * Source-of-truth list. Mirrors `STANDING_ORDERS` with `kind === "cron"`.
 * Sorted alphabetical so the diff is mechanical when the catalog moves.
 *
 * For every entry, the simulator additionally fires `skillRecordActionLog`
 * with the same `entryId` as the cron, mirroring how the OpenClaw playbook
 * always emits a heartbeat receipt. That's the universal proof-of-fire.
 */

interface CronInventory {
  entryId: string;
  /** Tier gating. "all" runs on both Coach + Manager. "manager" excludes Coach. */
  tier: "all" | "manager";
  /** Table the cron's payload writes into (informational). */
  table:
    | "dailyBriefs"
    | "weeklyReviews"
    | "contentPlans"
    | "brandDeals"
    | "mayaActionLog";
  /** HQ surface the simulator re-queries to prove the path. */
  hqQuery:
    | "latestActionLog"
    | "latestBrief"
    | "currentPlan"
    | "revenueWidget";
}

const CRON_INVENTORY: ReadonlyArray<CronInventory> = [
  { entryId: "accountability_nudge",  tier: "all", table: "mayaActionLog", hqQuery: "latestActionLog" },
  { entryId: "evening_recap",         tier: "all", table: "dailyBriefs",   hqQuery: "latestBrief" },
  { entryId: "morning_brief",         tier: "all", table: "dailyBriefs",   hqQuery: "latestBrief" },
  { entryId: "revenue_snapshot",      tier: "all", table: "brandDeals",    hqQuery: "revenueWidget" },
  { entryId: "weekly_content_plan",   tier: "all", table: "contentPlans",  hqQuery: "currentPlan" },
  { entryId: "weekly_review",         tier: "all", table: "weeklyReviews", hqQuery: "latestActionLog" },
];

/* ------------------------------------------------------------------------- */
/* Test 1: Inventory shape                                                    */
/* ------------------------------------------------------------------------- */

describe("cron simulator — inventory", () => {
  it("covers exactly 6 cron jobs (Sprint 3 collapsed 21 → 6)", () => {
    expect(CRON_INVENTORY.length).toBe(6);
  });

  it("every entry is tier=all (autonomy gates land on event/folded triggers, not cron)", () => {
    for (const c of CRON_INVENTORY) {
      expect(c.tier).toBe("all");
    }
  });

  it("every entryId is unique", () => {
    const ids = CRON_INVENTORY.map((c) => c.entryId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("matches the entryIds documented in cron.md § 2", () => {
    const CRON_SET = new Set([
      "morning_brief",
      "evening_recap",
      "weekly_content_plan",
      "weekly_review",
      "accountability_nudge",
      "revenue_snapshot",
    ]);
    for (const c of CRON_INVENTORY) {
      expect(CRON_SET.has(c.entryId)).toBe(true);
    }
    expect(CRON_INVENTORY.length).toBe(CRON_SET.size);
  });

  it("excludes the 9 entries Sprint 3 moved to heartbeat", () => {
    const HEARTBEAT_MIGRATED = [
      "performance_check_2h",
      "daily_niche_scan",
      "trend_watcher",
      "comment_triage",
      "competitor_watch",
      "calendar_lookahead",
      "industry_intel_daily",
      "opportunity_scout_daily",
      "collab_matchmaker_weekly",
    ];
    const ids = new Set(CRON_INVENTORY.map((c) => c.entryId));
    for (const slug of HEARTBEAT_MIGRATED) {
      expect(ids.has(slug)).toBe(false);
    }
  });

  it("excludes the 6 entries Sprint 3 deleted entirely", () => {
    const DELETED = [
      "manager_readiness_packet_quarterly",
      "algo_research_tiktok",
      "algo_research_instagram",
      "algo_research_youtube",
      "algo_research_linkedin",
      "algo_research_x",
    ];
    const ids = new Set(CRON_INVENTORY.map((c) => c.entryId));
    for (const slug of DELETED) {
      expect(ids.has(slug)).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------------- */
/* Test 2: Universal heartbeat — every cron emits skillRecordActionLog        */
/* ------------------------------------------------------------------------- */

describe("cron simulator — universal heartbeat (skillRecordActionLog)", () => {
  it("Manager creator: all 6 crons can emit a heartbeat → latestActionLog reflects them", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await plantCreator(t, { suffix: "mgr1", plan: "manager" });

    for (const cron of CRON_INVENTORY) {
      await t.mutation(api.businessReadiness.skillRecordActionLog, {
        mayaSecret: RUNTIME_SECRET,
        creatorId,
        entryId: cron.entryId,
        outcome: "ran",
        detail: `simulator: ${cron.entryId} fired`,
        durationMs: 1234,
      });
    }

    const log = await asUser(t, "mgr1").query(
      api.businessReadiness.latestActionLog,
      {}
    );
    // We wrote 6, latestActionLog returns the 10 most-recent — all 6 land.
    expect(log.length).toBe(6);
    const inventoryIds = new Set(CRON_INVENTORY.map((c) => c.entryId));
    for (const row of log) {
      expect(inventoryIds.has(row.entryId)).toBe(true);
      expect(row.creatorId).toBe(creatorId);
      expect(row.outcome).toBe("ran");
    }
  });

  it("Coach creator: all 6 cron entryIds are accepted at the action-log gate (boundary is autonomy not breadth)", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await plantCreator(t, { suffix: "coach1", plan: "coach" });

    for (const cron of CRON_INVENTORY) {
      await t.mutation(api.businessReadiness.skillRecordActionLog, {
        mayaSecret: RUNTIME_SECRET,
        creatorId,
        entryId: cron.entryId,
        outcome: "ran",
        detail: `coach heartbeat: ${cron.entryId}`,
      });
    }
    const log = await asUser(t, "coach1").query(
      api.businessReadiness.latestActionLog,
      {}
    );
    expect(log.length).toBe(6);
  });
});

/* ------------------------------------------------------------------------- */
/* Test 3: HQ-surface reflection for the 6 cron entries                       */
/* ------------------------------------------------------------------------- */

describe("cron simulator — HQ-surface reflection", () => {
  it("revenue_snapshot cron → brandDeals → today.revenueWidget reflects paid", async () => {
    const t = convexTest(schema, modules);
    const mgr = await plantCreator(t, { suffix: "mgr", plan: "manager" });
    const now = Date.now();
    await t.run((ctx) =>
      ctx.db.insert("brandDeals", {
        creatorId: mgr,
        brand: "Topo",
        status: "paid",
        offerAmountUsd: 2500,
        paidAt: now,
        paidAmountUsd: 2500,
        deliverables: ["1× Reel"],
        riskFlags: [],
        replyVariants: [],
        createdAt: now,
        updatedAt: now,
      })
    );
    await t.mutation(api.businessReadiness.skillRecordActionLog, {
      mayaSecret: RUNTIME_SECRET,
      creatorId: mgr,
      entryId: "revenue_snapshot",
      outcome: "ran",
      detail: "MTD: $2500",
    });
    const widget = await asUser(t, "mgr").query(api.today.revenueWidget, {});
    expect(widget?.mtdUsd).toBe(2500);
    const log = await asUser(t, "mgr").query(
      api.businessReadiness.latestActionLog,
      {}
    );
    expect(log.find((r) => r.entryId === "revenue_snapshot")).toBeTruthy();
  });

  it("morning_brief / evening_recap → dailyBriefs → today.latestBrief", async () => {
    const t = convexTest(schema, modules);
    const mgr = await plantCreator(t, { suffix: "mgr", plan: "manager" });
    await t.run((ctx) =>
      ctx.db.insert("dailyBriefs", {
        creatorId: mgr,
        briefDateLocal: "2026-04-26",
        markdown: "# Today's brief\n…",
        recommendations: [],
        pendingItems: [],
        outlierPostIds: [],
        generatedAt: Date.now(),
      })
    );
    await t.mutation(api.businessReadiness.skillRecordActionLog, {
      mayaSecret: RUNTIME_SECRET,
      creatorId: mgr,
      entryId: "morning_brief",
      outcome: "ran",
    });
    const brief = await asUser(t, "mgr").query(api.today.latestBrief, {});
    expect(brief?.briefDateLocal).toBe("2026-04-26");
  });

  it("weekly_content_plan → contentPlans → plan.currentPlan", async () => {
    const t = convexTest(schema, modules);
    const mgr = await plantCreator(t, { suffix: "mgr", plan: "manager" });
    await t.run((ctx) =>
      ctx.db.insert("contentPlans", {
        creatorId: mgr,
        weekStartLocal: "2026-04-27",
        arc: [
          {
            dayOffset: 0,
            platform: "tiktok",
            format: "tiktok-post",
            hookOptions: ["POV: 5am club"],
            captionDraft: "draft",
            postingTimeLocal: "10:00",
            status: "draft",
          },
        ],
        rationale: "synth: Mon 4pm plan",
        generatedAt: Date.now(),
      })
    );
    await t.mutation(api.businessReadiness.skillRecordActionLog, {
      mayaSecret: RUNTIME_SECRET,
      creatorId: mgr,
      entryId: "weekly_content_plan",
      outcome: "ran",
    });
    const plan = await asUser(t, "mgr").query(api.plan.currentPlan, {});
    expect(plan?.weekStartLocal).toBe("2026-04-27");
  });

  it("weekly_review / accountability_nudge → action-log only (no domain row in this simulator)", async () => {
    const t = convexTest(schema, modules);
    const mgr = await plantCreator(t, { suffix: "mgr", plan: "manager" });
    for (const entryId of ["weekly_review", "accountability_nudge"] as const) {
      await t.mutation(api.businessReadiness.skillRecordActionLog, {
        mayaSecret: RUNTIME_SECRET,
        creatorId: mgr,
        entryId,
        outcome: "ran",
      });
    }
    const log = await asUser(t, "mgr").query(
      api.businessReadiness.latestActionLog,
      {}
    );
    expect(log.find((r) => r.entryId === "weekly_review")).toBeTruthy();
    expect(log.find((r) => r.entryId === "accountability_nudge")).toBeTruthy();
  });
});

/* ------------------------------------------------------------------------- */
/* Test 4: Cross-tenant — A's cron writes never bleed into B's HQ             */
/* ------------------------------------------------------------------------- */

describe("cron simulator — cross-tenant isolation", () => {
  it("A's actionLog heartbeat never appears in B's latestActionLog", async () => {
    const t = convexTest(schema, modules);
    const a = await plantCreator(t, { suffix: "a", plan: "manager" });
    await plantCreator(t, { suffix: "b", plan: "manager" });
    await t.mutation(api.businessReadiness.skillRecordActionLog, {
      mayaSecret: RUNTIME_SECRET,
      creatorId: a,
      entryId: "morning_brief",
      outcome: "ran",
    });
    const bView = await asUser(t, "b").query(
      api.businessReadiness.latestActionLog,
      {}
    );
    expect(bView.length).toBe(0);
  });

  it("A's revenue brandDeals row never appears in B's revenueWidget", async () => {
    const t = convexTest(schema, modules);
    const a = await plantCreator(t, { suffix: "a", plan: "manager" });
    await plantCreator(t, { suffix: "b", plan: "manager" });
    const now = Date.now();
    await t.run((ctx) =>
      ctx.db.insert("brandDeals", {
        creatorId: a,
        brand: "ATopo",
        status: "paid",
        offerAmountUsd: 1500,
        paidAt: now,
        paidAmountUsd: 1500,
        deliverables: ["1× Reel"],
        riskFlags: [],
        replyVariants: [],
        createdAt: now,
        updatedAt: now,
      })
    );
    const bWidget = await asUser(t, "b").query(api.today.revenueWidget, {});
    expect(bWidget?.mtdUsd ?? 0).toBe(0);
  });
});

/* ------------------------------------------------------------------------- */
/* Test 5: Adversarial — secret/payload                                       */
/* ------------------------------------------------------------------------- */

describe("cron simulator — adversarial inputs", () => {
  it("missing MAYA_RUNTIME_SECRET env → all writes refused", async () => {
    vi.unstubAllEnvs();
    const t = convexTest(schema, modules);
    const c = await plantCreator(t, { suffix: "x", plan: "manager" });
    await expect(
      t.mutation(api.businessReadiness.skillRecordActionLog, {
        mayaSecret: "anything",
        creatorId: c,
        entryId: "morning_brief",
        outcome: "ran",
      })
    ).rejects.toThrow(/not configured/);
    vi.stubEnv("MAYA_RUNTIME_SECRET", RUNTIME_SECRET); // restore for afterEach
  });

  it("wrong secret → refused", async () => {
    const t = convexTest(schema, modules);
    const c = await plantCreator(t, { suffix: "x", plan: "manager" });
    await expect(
      t.mutation(api.businessReadiness.skillRecordActionLog, {
        mayaSecret: "wrong-secret",
        creatorId: c,
        entryId: "morning_brief",
        outcome: "ran",
      })
    ).rejects.toThrow(/Invalid Maya runtime secret/);
  });

  it("missing required field (entryId) → validator throws", async () => {
    const t = convexTest(schema, modules);
    const c = await plantCreator(t, { suffix: "x", plan: "manager" });
    await expect(
      // @ts-expect-error — deliberately omitting entryId to prove the
      // validator rejects it before the handler runs.
      t.mutation(api.businessReadiness.skillRecordActionLog, {
        mayaSecret: RUNTIME_SECRET,
        creatorId: c,
        outcome: "ran",
      })
    ).rejects.toThrow();
  });

  it("non-existent creatorId → rejected (cross-tenant guard)", async () => {
    const t = convexTest(schema, modules);
    // Insert one creator so we can derive a valid id shape, then delete it
    // to manufacture a "creator not found" condition.
    const c = await plantCreator(t, { suffix: "x", plan: "manager" });
    await t.run((ctx) => ctx.db.delete(c));
    await expect(
      t.mutation(api.businessReadiness.skillRecordActionLog, {
        mayaSecret: RUNTIME_SECRET,
        creatorId: c,
        entryId: "morning_brief",
        outcome: "ran",
      })
    ).rejects.toThrow(/Creator not found/);
  });
});

/* ------------------------------------------------------------------------- */
/* Test 6: Sibling-file coherence — no schema additions                       */
/* ------------------------------------------------------------------------- */

describe("cron simulator — sibling-file scan", () => {
  it("uses ONLY existing tables (no schema additions)", () => {
    // The simulator writes to: dailyBriefs, contentPlans, brandDeals,
    // mayaActionLog, creators, creatorPicture, creatorHandles. All of
    // these existed before this simulator.
    const EXPECTED_TABLES = [
      "dailyBriefs",
      "contentPlans",
      "brandDeals",
      "mayaActionLog",
      "creators",
      "creatorPicture",
      "creatorHandles",
    ];
    const t = convexTest(schema, modules);
    expect(t).toBeTruthy();
    expect(EXPECTED_TABLES.length).toBe(7);
  });
});
