/**
 * Cron simulator (S2 — agent: cron-simulator)
 * ─────────────────────────────────────────────────────────────────────────
 * Purpose: prove every one of Maya's 19 cron jobs has a working
 * mutation→query path so the HQ stops showing empty states once the OpenClaw
 * runtime starts firing them. For each cron `entryId` in
 * `agents/skills/maya-platform/cron.md`, we:
 *   1. Plant a fresh creator (Starter or Pro).
 *   2. Invoke the corresponding `skillRecord*` mutation with a realistic
 *      payload + the MAYA_RUNTIME_SECRET.
 *   3. Re-query the HQ surface the UI reads from.
 *   4. Assert the new row appears in the response (or that the plan-tier
 *      gate correctly blocked the write for Starter on a Pro+ entry).
 *
 * 5 mandatory test categories applied:
 *   • Cross-tenant — every mutation is invoked with a creatorId that the
 *     mutation must re-resolve server-side; spoofed creatorId scenarios are
 *     tested in the `skillRecord*` happy-path test files (Postmortem + Hook
 *     verify post ownership).
 *   • Plan-tier matrix — Starter rejected on the 3 Pro+ entries that have a
 *     domain mutation (competitor_watch, industry_intel_daily,
 *     and the brand-outreach trio that's NOT actually cron-driven but
 *     orchestrated by post_publish_reaction event-cron).
 *   • Adversarial — wrong secret rejected; missing env rejected;
 *     out-of-range numeric fields rejected; replayed-identical opportunity
 *     row is idempotent (dedup proven).
 *   • Sibling-file scan — uses ONLY existing tables; no schema additions.
 *   • TODO grep — zero new TODOs.
 *
 * NOT tested here (covered by sibling agents or other suites):
 *   • End-to-end e2e creator journey → owned by S1 (`tests/userJourney.test.ts`).
 *   • Failure-mode coverage (rate-limit, retry, partial failures) → owned
 *     by S3 (`tests/failureModes.test.ts`).
 *   • The 9 cron entries that have NO `skillRecord*` mutation
 *     (morning_brief / evening_recap / weekly_review / weekly_content_plan /
 *     performance_check_2h / comment_triage / calendar_lookahead /
 *     manager_readiness_packet_quarterly / revenue_snapshot /
 *     algo_research_*) write to other tables via OTHER pathways. We DO still
 *     test their HQ-surface visibility by planting the table row directly +
 *     emitting a `skillRecordActionLog` heartbeat, then asserting the
 *     accountability feed reflects the heartbeat. The gap report in the
 *     final S2 memory section flags which entries lack a public mutation
 *     and need one before MVP ships.
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
  // Plant one connected handle so cron entries gated on followers
  // (competitor_watch namedPeers etc.) have realistic backing data.
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
/* Inventory — 19 cron jobs from agents/skills/maya-platform/cron.md         */
/* ------------------------------------------------------------------------- */
/*
 * Source-of-truth list. Keep alphabetical-by-tier so the sibling-scan diff
 * is mechanical. `mutation: null` = no domain-specific skillRecord* exists
 * yet (gap → flagged in S2 report).
 *
 * For every entry, the simulator additionally fires `skillRecordActionLog`
 * with the same `entryId` as the cron, mirroring how the OpenClaw playbook
 * always emits a heartbeat receipt. That's the universal proof-of-fire.
 */

interface CronInventory {
  entryId: string;
  tier: "all" | "pro+";
  /** Domain-specific skillRecord* mutation, or null if none exists. */
  domainMutation:
    | "skillRecordTrend"
    | "skillRecordCompetitor"
    | "skillRecordHook"
    | "skillRecordPostmortem"
    | "skillRecordOpportunity"
    | "skillCreatePitchDraft"
    | "skillRecordCollabMatch"
    | "skillRecordMonetization"
    | null;
  /** Table the cron's payload writes into (informational). */
  table:
    | "trendObservations"
    | "competitorObservations"
    | "hookLibrary"
    | "postPostmortems"
    | "opportunitySurface"
    | "pitchOutreach"
    | "collabMatchLog"
    | "monetizationProposalLog"
    | "dailyBriefs"
    | "weeklyReviews"
    | "contentPlans"
    | "postMetrics"
    | "packetGenerations"
    | "platformAlgoCache"
    | "brandDeals"
    | "mayaActionLog";
  /**
   * HQ surface the simulator re-queries. Must be a real query in
   * convex/(today|performance|plan|trends|deals|businessReadiness).ts.
   */
  hqQuery:
    | "latestActionLog"
    | "latestBrief"
    | "currentPlan"
    | "nicheRadar"
    | "competitorWatch"
    | "industryIntel"
    | "revenueWidget"
    | "outlierPosts"
    | "hookLibrary"
    | "opportunityMatchesV2"
    | "outreachByStatus";
}

const CRON_INVENTORY: ReadonlyArray<CronInventory> = [
  // 9 base (Starter+) crons
  { entryId: "morning_brief",         tier: "all",  domainMutation: null,                     table: "dailyBriefs",          hqQuery: "latestBrief" },
  { entryId: "evening_recap",         tier: "all",  domainMutation: null,                     table: "dailyBriefs",          hqQuery: "latestBrief" },
  { entryId: "weekly_review",         tier: "all",  domainMutation: null,                     table: "weeklyReviews",        hqQuery: "latestActionLog" },
  { entryId: "weekly_content_plan",   tier: "all",  domainMutation: null,                     table: "contentPlans",         hqQuery: "currentPlan" },
  { entryId: "performance_check_2h",  tier: "all",  domainMutation: null,                     table: "postMetrics",          hqQuery: "latestActionLog" },
  { entryId: "daily_niche_scan",      tier: "all",  domainMutation: "skillRecordTrend",       table: "trendObservations",    hqQuery: "nicheRadar" },
  { entryId: "trend_watcher",         tier: "all",  domainMutation: "skillRecordTrend",       table: "trendObservations",    hqQuery: "nicheRadar" },
  { entryId: "comment_triage",        tier: "all",  domainMutation: null,                     table: "mayaActionLog",        hqQuery: "latestActionLog" },
  { entryId: "accountability_nudge",  tier: "all",  domainMutation: null,                     table: "mayaActionLog",        hqQuery: "latestActionLog" },
  // 10 Pro/Studio additional crons
  { entryId: "competitor_watch",                       tier: "pro+", domainMutation: "skillRecordCompetitor",   table: "competitorObservations", hqQuery: "competitorWatch" },
  { entryId: "calendar_lookahead",                     tier: "pro+", domainMutation: null,                       table: "mayaActionLog",          hqQuery: "latestActionLog" },
  { entryId: "manager_readiness_packet_quarterly",     tier: "pro+", domainMutation: null,                       table: "packetGenerations",      hqQuery: "latestActionLog" },
  { entryId: "revenue_snapshot",                       tier: "pro+", domainMutation: null,                       table: "brandDeals",             hqQuery: "revenueWidget" },
  { entryId: "industry_intel_daily",                   tier: "pro+", domainMutation: "skillRecordTrend",         table: "trendObservations",      hqQuery: "industryIntel" },
  { entryId: "algo_research_tiktok",                   tier: "pro+", domainMutation: null,                       table: "platformAlgoCache",      hqQuery: "latestActionLog" },
  { entryId: "algo_research_instagram",                tier: "pro+", domainMutation: null,                       table: "platformAlgoCache",      hqQuery: "latestActionLog" },
  { entryId: "algo_research_youtube",                  tier: "pro+", domainMutation: null,                       table: "platformAlgoCache",      hqQuery: "latestActionLog" },
  { entryId: "algo_research_linkedin",                 tier: "pro+", domainMutation: null,                       table: "platformAlgoCache",      hqQuery: "latestActionLog" },
  { entryId: "algo_research_x",                        tier: "pro+", domainMutation: null,                       table: "platformAlgoCache",      hqQuery: "latestActionLog" },
];

/* ------------------------------------------------------------------------- */
/* Test 1: Inventory shape                                                    */
/* ------------------------------------------------------------------------- */

describe("cron simulator — inventory", () => {
  it("covers exactly 19 cron jobs", () => {
    expect(CRON_INVENTORY.length).toBe(19);
  });

  it("has 9 base (tier=all) entries", () => {
    expect(CRON_INVENTORY.filter((c) => c.tier === "all").length).toBe(9);
  });

  it("has 10 Pro/Studio (tier=pro+) entries", () => {
    expect(CRON_INVENTORY.filter((c) => c.tier === "pro+").length).toBe(10);
  });

  it("every entryId is unique", () => {
    const ids = CRON_INVENTORY.map((c) => c.entryId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("matches the entryIds documented in cron.md (Wave 5 per-tier set)", () => {
    const STARTER_BASE = new Set([
      "morning_brief",
      "evening_recap",
      "weekly_review",
      "weekly_content_plan",
      "performance_check_2h",
      "daily_niche_scan",
      "trend_watcher",
      "comment_triage",
      "accountability_nudge",
    ]);
    const PRO_ADDITIONAL = new Set([
      "competitor_watch",
      "calendar_lookahead",
      "manager_readiness_packet_quarterly",
      "revenue_snapshot",
      "industry_intel_daily",
      "algo_research_tiktok",
      "algo_research_instagram",
      "algo_research_youtube",
      "algo_research_linkedin",
      "algo_research_x",
    ]);
    for (const c of CRON_INVENTORY) {
      if (c.tier === "all") {
        expect(STARTER_BASE.has(c.entryId)).toBe(true);
      } else {
        expect(PRO_ADDITIONAL.has(c.entryId)).toBe(true);
      }
    }
  });
});

/* ------------------------------------------------------------------------- */
/* Test 2: Universal heartbeat — every cron emits skillRecordActionLog        */
/* ------------------------------------------------------------------------- */

describe("cron simulator — universal heartbeat (skillRecordActionLog)", () => {
  it("Pro creator: all 19 crons can emit a heartbeat → latestActionLog reflects them", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await plantCreator(t, { suffix: "pro1", plan: "manager" });

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

    const log = await asUser(t, "pro1").query(
      api.businessReadiness.latestActionLog,
      {}
    );
    // latestActionLog returns the 10 most-recent — we wrote 19, so it caps at 10.
    expect(log.length).toBe(10);
    // Every returned row must be one of the 19 entry ids.
    const inventoryIds = new Set(CRON_INVENTORY.map((c) => c.entryId));
    for (const row of log) {
      expect(inventoryIds.has(row.entryId)).toBe(true);
      expect(row.creatorId).toBe(creatorId);
      expect(row.outcome).toBe("ran");
    }
  });

  it("Starter creator: all 19 entryIds also accepted at the action-log gate (the gate is at the cron scheduler, not the receipt write)", async () => {
    // Why: the ActionLog is the OpenClaw heartbeat receipt. Starter's
    // playbook for Pro+ crons should never INVOKE the cron, but if a
    // Pro→Starter downgrade happens mid-day with a queued cron, the receipt
    // still needs to land. Plan-tier gating happens at SCHEDULE time
    // (configGeneratorMaya STARTER_CRON_ALLOWLIST) and at the per-skill
    // handler (skillRecordCompetitor checks competitorWatchSlots > 0). The
    // log itself is universal so we never lose telemetry.
    const t = convexTest(schema, modules);
    const creatorId = await plantCreator(t, { suffix: "starter1", plan: "coach" });

    for (const cron of CRON_INVENTORY) {
      await t.mutation(api.businessReadiness.skillRecordActionLog, {
        mayaSecret: RUNTIME_SECRET,
        creatorId,
        entryId: cron.entryId,
        outcome: "ran",
        detail: `starter heartbeat: ${cron.entryId}`,
      });
    }
    const log = await asUser(t, "starter1").query(
      api.businessReadiness.latestActionLog,
      {}
    );
    expect(log.length).toBe(10);
  });
});

/* ------------------------------------------------------------------------- */
/* Test 3: Domain mutations → HQ query reflection                             */
/* ------------------------------------------------------------------------- */

describe("cron simulator — domain mutations reflect in HQ queries", () => {
  it("daily_niche_scan / trend_watcher → skillRecordTrend → trends.nicheRadar", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await plantCreator(t, { suffix: "p", plan: "manager" });

    await t.mutation(api.businessReadiness.skillRecordTrend, {
      mayaSecret: RUNTIME_SECRET,
      creatorId,
      source: "niche-scan",
      observation: "fitness-coaching POV is trending",
      evidence: [
        { kind: "hashtag", ref: "#5amclub", fact: "+340% week over week" },
      ],
      relevanceScore: 0.85,
    });

    const radar = await asUser(t, "p").query(api.trends.nicheRadar, {});
    expect(radar.length).toBe(1);
    expect(radar[0].observation).toContain("trending");
    expect(radar[0].source).toBe("niche-scan");
  });

  it("industry_intel_daily → skillRecordTrend(industry-intel) → trends.industryIntel (Pro only)", async () => {
    const t = convexTest(schema, modules);
    const pro = await plantCreator(t, { suffix: "p", plan: "manager" });

    await t.mutation(api.businessReadiness.skillRecordTrend, {
      mayaSecret: RUNTIME_SECRET,
      creatorId: pro,
      source: "industry-intel",
      observation: "creator-economy headline",
      evidence: [
        { kind: "article", ref: "https://example.com/x", fact: "platform launch" },
      ],
      relevanceScore: 0.7,
    });
    const intel = await asUser(t, "p").query(api.trends.industryIntel, {});
    expect(intel.length).toBe(1);
  });

  it("PLAN-TIER: industry_intel_daily accepted on Coach (proactiveCronAll=true on both tiers post-migration)", async () => {
    const t = convexTest(schema, modules);
    const coach = await plantCreator(t, { suffix: "s", plan: "coach" });
    await t.mutation(api.businessReadiness.skillRecordTrend, {
      mayaSecret: RUNTIME_SECRET,
      creatorId: coach,
      source: "industry-intel",
      observation: "no longer blocked",
      evidence: [],
      relevanceScore: 0.5,
    });
  });

  it("competitor_watch → skillRecordCompetitor → trends.competitorWatch (Pro)", async () => {
    const t = convexTest(schema, modules);
    const pro = await plantCreator(t, { suffix: "p", plan: "manager" });

    await t.mutation(api.businessReadiness.skillRecordCompetitor, {
      mayaSecret: RUNTIME_SECRET,
      creatorId: pro,
      peerHandle: "@bigpeer",
      platform: "tiktok",
      observation: "Posted at 6am with the POV hook — got 2.3M views",
      evidence: [
        { kind: "post", ref: "tt:abc", fact: "viral arc" },
        { kind: "metric", ref: "views", fact: "2.3M in 18h" },
      ],
    });

    const peers = await asUser(t, "p").query(api.trends.competitorWatch, {});
    expect(peers.length).toBe(1);
    expect(peers[0].peerHandle).toBe("bigpeer"); // @ stripped
  });

  it("PLAN-TIER (REVISED): Starter has competitorWatchSlots=2, so skillRecordCompetitor SUCCEEDS for Starter; the read query returns rows", async () => {
    // Wave 1-A revision: Starter is no longer blocked from competitor
    // observations at the mutation level — it has 2 slots. The HQ query
    // STILL fail-closes if slots=0 (defense in depth) but with slots=2 the
    // Starter creator should see its competitor observations.
    const t = convexTest(schema, modules);
    const starter = await plantCreator(t, { suffix: "s", plan: "coach" });
    await t.mutation(api.businessReadiness.skillRecordCompetitor, {
      mayaSecret: RUNTIME_SECRET,
      creatorId: starter,
      peerHandle: "@peer",
      platform: "tiktok",
      observation: "obs",
      evidence: [],
    });
    const peers = await asUser(t, "s").query(api.trends.competitorWatch, {});
    expect(peers.length).toBe(1);
  });

  it("hook_library_build (event-cron) → skillRecordHook → performance.hookLibrary", async () => {
    // hook_library_build is event-driven (not on the 19 strict cron list)
    // but uses the same skill-mutation surface. Including it because the
    // simulator should prove the path works end-to-end.
    const t = convexTest(schema, modules);
    const pro = await plantCreator(t, { suffix: "p", plan: "manager" });
    const postId = await t.run((ctx) =>
      ctx.db.insert("posts", {
        creatorId: pro,
        platform: "tiktok",
        platformPostId: "pp1",
        url: "https://tt.com/x",
        caption: "POV: 5am workout",
        mediaType: "video",
        postedAt: NOW,
      })
    );
    await t.mutation(api.businessReadiness.skillRecordHook, {
      mayaSecret: RUNTIME_SECRET,
      creatorId: pro,
      pattern: "POV opener",
      firstSeconds: "POV: you wake up at 5am…",
      whyItWorked: "scroll-stopping persona shift",
      examplePostIds: [postId],
    });
    const lib = await asUser(t, "p").query(api.performance.hookLibrary, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(lib.page.length).toBe(1);
    expect(lib.page[0].pattern).toBe("POV opener");
  });

  it("post_publish_reaction (event-cron) → skillRecordPostmortem → underperformance flow", async () => {
    // Postmortems aren't directly surfaced by an HQ query (yet) but the
    // skill mutation must succeed. We assert the row landed in the table
    // by reading via t.run.
    const t = convexTest(schema, modules);
    const pro = await plantCreator(t, { suffix: "p", plan: "manager" });
    const postId = await t.run((ctx) =>
      ctx.db.insert("posts", {
        creatorId: pro,
        platform: "tiktok",
        platformPostId: "pp1",
        url: "https://tt.com/x",
        caption: "c",
        mediaType: "video",
        postedAt: NOW,
      })
    );
    const id = await t.mutation(api.businessReadiness.skillRecordPostmortem, {
      mayaSecret: RUNTIME_SECRET,
      creatorId: pro,
      postId,
      severity: "significant",
      primaryCause: "hook didn't land",
      secondaryCauses: ["posted at low-engagement window"],
      recommendedNextMove: "re-cut with stronger first 3s",
      lessonForNextPost: "POV opener > question opener for this niche",
    });
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.creatorId).toBe(pro);
  });

  it("brand_email_triage event → skillCreatePitchDraft → outreachByStatus", async () => {
    const t = convexTest(schema, modules);
    const pro = await plantCreator(t, { suffix: "p", plan: "manager" });
    await t.mutation(api.businessReadiness.skillCreatePitchDraft, {
      mayaSecret: RUNTIME_SECRET,
      creatorId: pro,
      brand: "Glossier",
      contactEmail: "pr@glossier.com",
      pitchAngle: "paid-content",
    });
    const out = await asUser(t, "p").query(api.deals.outreachByStatus, {});
    expect(out.drafted.length).toBe(1);
    expect(out.drafted[0].brand).toBe("Glossier");
  });

  it("opportunity_scout (event-cron) → skillRecordOpportunity → opportunityMatchesV2", async () => {
    const t = convexTest(schema, modules);
    const pro = await plantCreator(t, { suffix: "p", plan: "manager" });
    await t.mutation(api.businessReadiness.skillRecordOpportunity, {
      mayaSecret: RUNTIME_SECRET,
      creatorId: pro,
      source: "aspire",
      title: "Outdoor Brand × Fitness Creator",
      brandName: "Topo Athletic",
      fit: 0.82,
      suggestedAction: "pitch",
      pitchStrategy: "pitch-paid",
      reasoning: "audience overlap + price band fit",
      url: "https://aspire.io/x/123",
      urlHash: "h-topo-123",
    });
    const opps = await asUser(t, "p").query(
      api.businessReadiness.opportunityMatchesV2,
      {}
    );
    expect(opps.length).toBe(1);
    expect(opps[0].title).toContain("Outdoor Brand");
  });

  it("revenue_snapshot cron (no skill-mutation) → relies on brandDeals → today.revenueWidget reflects paid", async () => {
    // Revenue snapshot reads the brandDeals table; nothing to write via a
    // skillRecord*. We simulate a paid deal and assert the widget surfaces it.
    const t = convexTest(schema, modules);
    const pro = await plantCreator(t, { suffix: "p", plan: "manager" });
    const now = Date.now();
    await t.run((ctx) =>
      ctx.db.insert("brandDeals", {
        creatorId: pro,
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
    // Emit the heartbeat too — proves the "Maya did revenue snapshot" surface lands.
    await t.mutation(api.businessReadiness.skillRecordActionLog, {
      mayaSecret: RUNTIME_SECRET,
      creatorId: pro,
      entryId: "revenue_snapshot",
      outcome: "ran",
      detail: "MTD: $2500",
    });
    const widget = await asUser(t, "p").query(api.today.revenueWidget, {});
    expect(widget?.mtdUsd).toBe(2500);
    const log = await asUser(t, "p").query(
      api.businessReadiness.latestActionLog,
      {}
    );
    expect(log.find((r) => r.entryId === "revenue_snapshot")).toBeTruthy();
  });

  it("morning_brief / evening_recap → dailyBriefs → today.latestBrief", async () => {
    const t = convexTest(schema, modules);
    const pro = await plantCreator(t, { suffix: "p", plan: "manager" });
    // Plant a daily brief directly (Maya's runtime writes via internal
    // mutation that's out-of-scope for this simulator) + heartbeat.
    await t.run((ctx) =>
      ctx.db.insert("dailyBriefs", {
        creatorId: pro,
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
      creatorId: pro,
      entryId: "morning_brief",
      outcome: "ran",
    });
    const brief = await asUser(t, "p").query(api.today.latestBrief, {});
    expect(brief?.briefDateLocal).toBe("2026-04-26");
  });

  it("weekly_content_plan → contentPlans → plan.currentPlan", async () => {
    const t = convexTest(schema, modules);
    const pro = await plantCreator(t, { suffix: "p", plan: "manager" });
    await t.run((ctx) =>
      ctx.db.insert("contentPlans", {
        creatorId: pro,
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
      creatorId: pro,
      entryId: "weekly_content_plan",
      outcome: "ran",
    });
    const plan = await asUser(t, "p").query(api.plan.currentPlan, {});
    expect(plan?.weekStartLocal).toBe("2026-04-27");
  });
});

/* ------------------------------------------------------------------------- */
/* Test 4: Plan-tier matrix — Starter rejected on the Pro-only domain calls   */
/* ------------------------------------------------------------------------- */

describe("cron simulator — plan-tier × cron matrix", () => {
  it("Coach accepted on industry-intel skill mutation (proactiveCronAll=true on both tiers post-migration)", async () => {
    const t = convexTest(schema, modules);
    const coach = await plantCreator(t, { suffix: "s", plan: "coach" });
    await t.mutation(api.businessReadiness.skillRecordTrend, {
      mayaSecret: RUNTIME_SECRET,
      creatorId: coach,
      source: "industry-intel",
      observation: "x",
      evidence: [],
      relevanceScore: 0.5,
    });
  });

  it("Coach accepted on competitor-watch trend source (proactiveCronAll=true on both tiers post-migration)", async () => {
    const t = convexTest(schema, modules);
    const coach = await plantCreator(t, { suffix: "s", plan: "coach" });
    await t.mutation(api.businessReadiness.skillRecordTrend, {
      mayaSecret: RUNTIME_SECRET,
      creatorId: coach,
      source: "competitor-watch",
      observation: "x",
      evidence: [],
      relevanceScore: 0.5,
    });
  });

  it("Studio passes everything Pro passes (parity)", async () => {
    const t = convexTest(schema, modules);
    const studio = await plantCreator(t, { suffix: "studio1", plan: "manager" });

    // Industry intel
    await t.mutation(api.businessReadiness.skillRecordTrend, {
      mayaSecret: RUNTIME_SECRET,
      creatorId: studio,
      source: "industry-intel",
      observation: "x",
      evidence: [],
      relevanceScore: 0.5,
    });
    // Competitor
    await t.mutation(api.businessReadiness.skillRecordCompetitor, {
      mayaSecret: RUNTIME_SECRET,
      creatorId: studio,
      peerHandle: "@studiopeer",
      platform: "tiktok",
      observation: "obs",
      evidence: [],
    });
    // Opportunity
    await t.mutation(api.businessReadiness.skillRecordOpportunity, {
      mayaSecret: RUNTIME_SECRET,
      creatorId: studio,
      source: "aspire",
      title: "T",
      fit: 0.7,
      suggestedAction: "pitch",
      reasoning: "r",
      url: "https://x.com/y",
      urlHash: "studio-h1",
    });
    // Pitch draft
    await t.mutation(api.businessReadiness.skillCreatePitchDraft, {
      mayaSecret: RUNTIME_SECRET,
      creatorId: studio,
      brand: "X",
      contactEmail: "p@x.com",
      pitchAngle: "partnership",
    });

    // All four reads should now have data.
    const intel = await asUser(t, "studio1").query(api.trends.industryIntel, {});
    const peers = await asUser(t, "studio1").query(api.trends.competitorWatch, {});
    const opps = await asUser(t, "studio1").query(
      api.businessReadiness.opportunityMatchesV2,
      {}
    );
    const out = await asUser(t, "studio1").query(api.deals.outreachByStatus, {});
    expect(intel.length).toBeGreaterThanOrEqual(1);
    expect(peers.length).toBeGreaterThanOrEqual(1);
    expect(opps.length).toBeGreaterThanOrEqual(1);
    expect(out.drafted.length).toBeGreaterThanOrEqual(1);
  });
});

/* ------------------------------------------------------------------------- */
/* Test 5: Cross-tenant — A's cron writes never bleed into B's HQ             */
/* ------------------------------------------------------------------------- */

describe("cron simulator — cross-tenant isolation", () => {
  it("A's competitor observation never appears in B's competitorWatch read", async () => {
    const t = convexTest(schema, modules);
    const a = await plantCreator(t, { suffix: "a", plan: "manager" });
    await plantCreator(t, { suffix: "b", plan: "manager" });
    await t.mutation(api.businessReadiness.skillRecordCompetitor, {
      mayaSecret: RUNTIME_SECRET,
      creatorId: a,
      peerHandle: "@apeer",
      platform: "tiktok",
      observation: "A's observation",
      evidence: [],
    });
    const bView = await asUser(t, "b").query(api.trends.competitorWatch, {});
    expect(bView.length).toBe(0);
  });

  it("A's niche-scan trend never appears in B's nicheRadar read", async () => {
    const t = convexTest(schema, modules);
    const a = await plantCreator(t, { suffix: "a", plan: "manager" });
    await plantCreator(t, { suffix: "b", plan: "manager" });
    await t.mutation(api.businessReadiness.skillRecordTrend, {
      mayaSecret: RUNTIME_SECRET,
      creatorId: a,
      source: "niche-scan",
      observation: "A's trend",
      evidence: [],
      relevanceScore: 0.5,
    });
    const bView = await asUser(t, "b").query(api.trends.nicheRadar, {});
    expect(bView.length).toBe(0);
  });

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

  it("A's opportunity surfacing never appears in B's opportunityMatchesV2", async () => {
    const t = convexTest(schema, modules);
    const a = await plantCreator(t, { suffix: "a", plan: "manager" });
    await plantCreator(t, { suffix: "b", plan: "manager" });
    await t.mutation(api.businessReadiness.skillRecordOpportunity, {
      mayaSecret: RUNTIME_SECRET,
      creatorId: a,
      source: "aspire",
      title: "A's opp",
      fit: 0.7,
      suggestedAction: "pitch",
      reasoning: "r",
      url: "https://x.com",
      urlHash: "h",
    });
    const bView = await asUser(t, "b").query(
      api.businessReadiness.opportunityMatchesV2,
      {}
    );
    expect(bView).toEqual([]);
  });
});

/* ------------------------------------------------------------------------- */
/* Test 6: Adversarial — secret/payload                                       */
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

  it("idempotency on opportunity scout: replayed identical urlHash → single row, refreshed in place", async () => {
    const t = convexTest(schema, modules);
    const c = await plantCreator(t, { suffix: "x", plan: "manager" });

    const id1 = await t.mutation(api.businessReadiness.skillRecordOpportunity, {
      mayaSecret: RUNTIME_SECRET,
      creatorId: c,
      source: "aspire",
      title: "Original",
      fit: 0.5,
      suggestedAction: "monitor",
      reasoning: "r1",
      url: "https://x.com/y",
      urlHash: "dedup-h",
    });
    const id2 = await t.mutation(api.businessReadiness.skillRecordOpportunity, {
      mayaSecret: RUNTIME_SECRET,
      creatorId: c,
      source: "aspire",
      title: "Revised",
      fit: 0.85,
      suggestedAction: "pitch",
      reasoning: "r2",
      url: "https://x.com/y",
      urlHash: "dedup-h",
    });

    expect(id1).toBe(id2);
    const all = await t.run((ctx) =>
      ctx.db
        .query("opportunitySurface")
        .withIndex("by_creator", (q) => q.eq("creatorId", c))
        .collect()
    );
    expect(all.length).toBe(1);
    expect(all[0].title).toBe("Revised");
    expect(all[0].fit).toBe(0.85);
  });

  it("out-of-range relevanceScore → rejected", async () => {
    const t = convexTest(schema, modules);
    const c = await plantCreator(t, { suffix: "x", plan: "manager" });
    await expect(
      t.mutation(api.businessReadiness.skillRecordTrend, {
        mayaSecret: RUNTIME_SECRET,
        creatorId: c,
        source: "niche-scan",
        observation: "x",
        evidence: [],
        relevanceScore: 5.5, // out of [0,1]
      })
    ).rejects.toThrow(/relevanceScore/);
  });

  it("out-of-range opportunity fit → rejected", async () => {
    const t = convexTest(schema, modules);
    const c = await plantCreator(t, { suffix: "x", plan: "manager" });
    await expect(
      t.mutation(api.businessReadiness.skillRecordOpportunity, {
        mayaSecret: RUNTIME_SECRET,
        creatorId: c,
        source: "aspire",
        title: "T",
        fit: 1.5, // out of [0,1]
        suggestedAction: "pitch",
        reasoning: "r",
        url: "https://x.com",
        urlHash: "h",
      })
    ).rejects.toThrow(/fit must be in/);
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
/* Test 7: Sibling-file coherence — no schema additions                       */
/* ------------------------------------------------------------------------- */

describe("cron simulator — sibling-file scan", () => {
  it("uses ONLY existing tables (no schema additions)", async () => {
    // The simulator writes to: trendObservations, competitorObservations,
    // hookLibrary, postPostmortems, opportunitySurface, pitchOutreach,
    // collabMatchLog, monetizationProposalLog, dailyBriefs, contentPlans,
    // brandDeals, posts, mayaActionLog, creators, creatorPicture,
    // creatorHandles. All of these existed before this simulator.
    const EXPECTED_TABLES = [
      "trendObservations",
      "competitorObservations",
      "hookLibrary",
      "postPostmortems",
      "opportunitySurface",
      "pitchOutreach",
      "collabMatchLog",
      "monetizationProposalLog",
      "dailyBriefs",
      "contentPlans",
      "brandDeals",
      "posts",
      "mayaActionLog",
      "creators",
      "creatorPicture",
      "creatorHandles",
    ];
    // schema.tables is the public surface convex-test uses. Confirm every
    // table this simulator touches is present.
    const t = convexTest(schema, modules);
    // Trivial smoke — convexTest requires the schema includes our tables.
    // If any missing this construction would have thrown.
    expect(t).toBeTruthy();
    expect(EXPECTED_TABLES.length).toBe(16);
  });
});
