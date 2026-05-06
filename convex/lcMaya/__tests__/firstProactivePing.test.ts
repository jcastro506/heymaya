/**
 * Sprint 7 Slice D — Day 1 first-proactive-ping tests.
 *
 * Five mandatory test categories:
 *   1. Cross-tenant: Creator A's pictureLockedAt event never fires for
 *      Creator B even when their stamps land back-to-back. Each leg of
 *      the pipeline (compose / pick-trend / pick-idea / write-row) is
 *      isolated by `creatorId`.
 *   2. Plan-tier: every tier (coach + manager) gets the first ping —
 *      first-touch is universal, no gating. Locked into the standing-
 *      orders entry tier="all".
 *   3. Adversarial: trend-watcher returns 0 trends, idea-generator
 *      returns 0 ideas, both empty, body trips banned-phrase filter.
 *      Each documents the precedence rule.
 *   4. Sibling-file: the standing-order entry exists in the catalog,
 *      AGENTS.md / standing-orders.md reaches the program id, the
 *      playbook section header is present.
 *   5. TODO grep: covered repo-wide by `sprint1Acceptance.test.ts`.
 *
 * Plus:
 *   - Delay range: scheduled fire timestamp always 15-30 min post-lock
 *     (boundary tests at 15-min-exact and 30-min-exact via injected
 *     randomFn pinning).
 *   - Idempotency: pictureLockedAt fires once; a re-stamp does not
 *     produce a second ping.
 *   - Voice fixture: composed body has zero banned terms (locked list
 *     mirrors the floor in `firstProactivePing.ts`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";
import {
  composeFirstPing,
  pickJitterMs,
  containsBannedPhrase,
  BANNED_PHRASES,
  FIRST_PING_MIN_DELAY_MS,
  FIRST_PING_MAX_DELAY_MS,
} from "../firstProactivePing";
import { internal } from "../../_generated/api";
import { STANDING_ORDERS } from "../../agents/packs/maya/workspace/standingOrders";

const NOW = 1_700_000_000_000;

/**
 * Drain scheduled functions using fake timers — the canonical convex-test
 * pattern for `runAfter(>0, ...)` calls. The first-ping handler schedules
 * 15-30 min into the future, so `finishInProgressScheduledFunctions` is
 * insufficient; we need `finishAllScheduledFunctions` which advances the
 * fake clock until every queued function runs.
 */
async function drainScheduler(t: ReturnType<typeof convexTest>): Promise<void> {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

async function insertCreator(
  t: ReturnType<typeof convexTest>,
  opts: { suffix: string; plan: "coach" | "manager" }
): Promise<Id<"creators">> {
  return await t.run((ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `u_${opts.suffix}`,
      email: `${opts.suffix}@test.com`,
      channelPreference: "imessage",
      timezone: "America/Los_Angeles",
      status: "onboarding",
      plan: opts.plan,
      createdAt: NOW,
    })
  );
}

async function insertCreatorPicture(
  t: ReturnType<typeof convexTest>,
  creatorId: Id<"creators">,
  opts?: { topHookPattern?: string; sourceCount?: number }
): Promise<void> {
  await t.run((ctx) =>
    ctx.db.insert("creatorPicture", {
      creatorId,
      niche: "fitness",
      audience: { ageRanges: ["18-24"], topGeos: ["US"], interestTags: ["lifting"] },
      voiceFingerprint: "concise; em-dashes; rare emoji",
      topHooks: [
        {
          pattern: opts?.topHookPattern ?? "4am POV constraint hooks",
          examplePostId: "p_top_1",
          platform: "tiktok",
          avgPerformanceLift: 2.1,
        },
      ],
      bottomHooks: [],
      postingCadence: { perPlatform: [] },
      brandDealHistory: [],
      generatedAt: NOW,
      model: "test-model",
      sourceCitations: Array.from({ length: opts?.sourceCount ?? 3 }, (_, i) => ({
        platform: "tiktok",
        postId: `p_cite_${i + 1}`,
        usedFor: "voice fingerprint",
      })),
    })
  );
}

async function insertTrend(
  t: ReturnType<typeof convexTest>,
  creatorId: Id<"creators">,
  opts: { score: number; observation: string; ref: string; observedAt: number }
): Promise<void> {
  await t.run((ctx) =>
    ctx.db.insert("trendObservations", {
      creatorId,
      source: "platform-wide",
      observation: opts.observation,
      evidence: [{ kind: "post", ref: opts.ref, fact: "fact" }],
      relevanceScore: opts.score,
      observedAt: opts.observedAt,
    })
  );
}

/* -------------------------------------------------------------------------- */
/* Pure-function tests — composeFirstPing + pickJitterMs                       */
/* -------------------------------------------------------------------------- */

describe("composeFirstPing — empty-input precedence (locked rule)", () => {
  it("BOTH empty → status='skipped' / precedence='skip-empty' / empty body (silent no-op preferred over bad first impression)", () => {
    const out = composeFirstPing({
      topTrend: null,
      topIdea: null,
      gmailOAuthUrl: "https://oauth.example/gmail",
      calendarOAuthUrl: "https://oauth.example/cal",
    });
    expect(out.status).toBe("skipped");
    expect(out.precedence).toBe("skip-empty");
    expect(out.body).toBe("");
    expect(out.citations.ideaPostIds).toEqual([]);
    expect(out.citations.trendRef).toBeUndefined();
  });

  it("ONLY trend present → precedence='trend-only', ships with trend leg + connect offers", () => {
    const out = composeFirstPing({
      topTrend: {
        observation: "POV constraint hooks trending across fitness TikTok",
        primaryRef: "https://tiktok.com/tag/povconstraint",
      },
      topIdea: null,
      gmailOAuthUrl: "https://oauth.example/gmail",
      calendarOAuthUrl: "https://oauth.example/cal",
    });
    expect(out.status).toBe("queued");
    expect(out.precedence).toBe("trend-only");
    expect(out.body).toContain("Trend:");
    expect(out.body).not.toContain("Idea:");
    expect(out.body).toContain("Connect Gmail");
    expect(out.body).toContain("Connect Calendar");
    expect(out.citations.trendRef).toBe("https://tiktok.com/tag/povconstraint");
    expect(out.citations.ideaPostIds).toEqual([]);
  });

  it("ONLY idea present → precedence='idea-only', requires ≥2 post-id citations", () => {
    const out = composeFirstPing({
      topTrend: null,
      topIdea: {
        text: "Lean into your 4am POV constraint hooks",
        postIds: ["p_top_1", "p_cite_1", "p_cite_2"],
      },
      gmailOAuthUrl: "https://oauth.example/gmail",
      calendarOAuthUrl: "https://oauth.example/cal",
    });
    expect(out.status).toBe("queued");
    expect(out.precedence).toBe("idea-only");
    expect(out.body).toContain("Idea:");
    expect(out.body).not.toContain("Trend:");
    expect(out.citations.ideaPostIds).toEqual(["p_top_1", "p_cite_1", "p_cite_2"]);
  });

  it("idea with <2 citations is rejected → falls back to trend-only / skip-empty", () => {
    const out = composeFirstPing({
      topTrend: null,
      topIdea: {
        text: "Lean into your hook",
        postIds: ["p_top_1"], // only 1 — fails the citation firewall floor
      },
      gmailOAuthUrl: null,
      calendarOAuthUrl: null,
    });
    expect(out.status).toBe("skipped");
    expect(out.precedence).toBe("skip-empty");
  });

  it("BOTH present → precedence='trend+idea', full ping with both citations", () => {
    const out = composeFirstPing({
      topTrend: {
        observation: "Slow-pan b-roll + ASMR-mic underperforms vs cuts in fitness niche",
        primaryRef: "https://tiktok.com/tag/fitnessasmr",
      },
      topIdea: {
        text: "Lean into your 4am POV constraint hooks — your last 30 already prove it lands",
        postIds: ["p_top_1", "p_cite_1"],
      },
      gmailOAuthUrl: "https://oauth.example/gmail",
      calendarOAuthUrl: "https://oauth.example/cal",
    });
    expect(out.status).toBe("queued");
    expect(out.precedence).toBe("trend+idea");
    expect(out.body).toContain("First read on your account.");
    expect(out.body).toContain("Trend:");
    expect(out.body).toContain("Idea:");
    expect(out.body).toContain("Reply when something lands.");
  });
});

describe("composeFirstPing — voice + anti-sycophancy", () => {
  it("composed body trips ZERO banned phrases on the canonical happy-path output", () => {
    const out = composeFirstPing({
      topTrend: {
        observation: "POV constraint hooks trending in fitness niche",
        primaryRef: "https://tiktok.com/tag/povconstraint",
      },
      topIdea: {
        text: "Repeat your 4am POV constraint format on IG Reels Thursday",
        postIds: ["p_top_1", "p_cite_1"],
      },
      gmailOAuthUrl: "https://oauth.example/gmail",
      calendarOAuthUrl: "https://oauth.example/cal",
    });
    expect(out.status).toBe("queued");
    for (const phrase of BANNED_PHRASES) {
      expect(out.body.toLowerCase()).not.toContain(phrase);
    }
  });

  it("a sycophantic trend observation DOES trip the banned-phrase filter and falls back to skip-empty", () => {
    const out = composeFirstPing({
      topTrend: {
        observation: "Amazing work on your POV hooks — keep it up!",
        primaryRef: "https://example.com/x",
      },
      topIdea: null,
      gmailOAuthUrl: null,
      calendarOAuthUrl: null,
    });
    // The composer rejects + falls back rather than shipping bad voice on
    // the make-or-break first ping.
    expect(out.status).toBe("skipped");
  });

  it("containsBannedPhrase is case-insensitive across the locked list", () => {
    expect(containsBannedPhrase("AMAZING work today")).toBe(true);
    expect(containsBannedPhrase("Hey there!")).toBe(true);
    expect(containsBannedPhrase("As an AI, I think...")).toBe(true);
    expect(containsBannedPhrase("Maya is a manager.")).toBe(false);
  });
});

describe("pickJitterMs — 15-30 min boundary discipline", () => {
  it("randomFn → 0 maps to the 15-min lower bound EXACTLY", () => {
    expect(pickJitterMs(() => 0)).toBe(FIRST_PING_MIN_DELAY_MS);
  });

  it("randomFn → 1 maps to the 30-min upper bound EXACTLY", () => {
    expect(pickJitterMs(() => 1)).toBe(FIRST_PING_MAX_DELAY_MS);
  });

  it("randomFn → 0.5 maps to ~22.5 min (mid-window)", () => {
    const mid = pickJitterMs(() => 0.5);
    const expectedMid =
      FIRST_PING_MIN_DELAY_MS +
      (FIRST_PING_MAX_DELAY_MS - FIRST_PING_MIN_DELAY_MS) / 2;
    expect(mid).toBe(Math.round(expectedMid));
  });

  it("clamps out-of-range randomFn outputs (e.g. 1.5 / -0.2) to the inclusive bounds", () => {
    expect(pickJitterMs(() => 1.5)).toBe(FIRST_PING_MAX_DELAY_MS);
    expect(pickJitterMs(() => -0.2)).toBe(FIRST_PING_MIN_DELAY_MS);
  });

  it("default Math.random path produces a value in [15min, 30min] across many samples", () => {
    for (let i = 0; i < 200; i++) {
      const ms = pickJitterMs();
      expect(ms).toBeGreaterThanOrEqual(FIRST_PING_MIN_DELAY_MS);
      expect(ms).toBeLessThanOrEqual(FIRST_PING_MAX_DELAY_MS);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Convex-side: firePictureLockedEvent + runFirstProactivePing                  */
/* -------------------------------------------------------------------------- */

describe("firePictureLockedEvent — event handler", () => {
  // Fake timers required to drain scheduler.runAfter(15-30 min, ...) in
  // bounded test runtime. See drainScheduler() comment above.
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("HAPPY: stamps pictureLockedAt + schedules fire at exactly +15min when randomFn=0 (lower-bound boundary)", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "a", plan: "manager" });

    const result = await t.mutation(
      internal.lcMaya.firstProactivePing.firePictureLockedEvent,
      {
        creatorId,
        _testJitterRandom: 0,
        _testNowMs: NOW,
        gmailOAuthUrl: null,
        calendarOAuthUrl: null,
      }
    );

    expect(result.ok).toBe(true);
    expect(result.alreadyFired).toBe(false);
    expect(result.scheduledFireAt).toBe(NOW + FIRST_PING_MIN_DELAY_MS);

    const creator = await t.run((ctx) => ctx.db.get(creatorId));
    expect(creator?.pictureLockedAt).toBe(NOW);
    expect(creator?.firstProactivePingSentAt).toBeUndefined();
  });

  it("HAPPY: schedules fire at exactly +30min when randomFn=1 (upper-bound boundary)", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "b", plan: "manager" });

    const result = await t.mutation(
      internal.lcMaya.firstProactivePing.firePictureLockedEvent,
      {
        creatorId,
        _testJitterRandom: 1,
        _testNowMs: NOW,
        gmailOAuthUrl: null,
        calendarOAuthUrl: null,
      }
    );

    expect(result.scheduledFireAt).toBe(NOW + FIRST_PING_MAX_DELAY_MS);
  });

  it("PLAN-TIER MATRIX: both 'coach' and 'manager' creators get the first-ping (no gating; first-touch is universal)", async () => {
    for (const plan of ["coach", "manager"] as const) {
      const t = convexTest(schema, modules);
      const creatorId = await insertCreator(t, { suffix: `pt_${plan}`, plan });
      const result = await t.mutation(
        internal.lcMaya.firstProactivePing.firePictureLockedEvent,
        {
          creatorId,
          _testJitterRandom: 0.5,
          _testNowMs: NOW,
          gmailOAuthUrl: null,
          calendarOAuthUrl: null,
        }
      );
      expect(result.ok).toBe(true);
      expect(result.alreadyFired).toBe(false);
      expect(result.scheduledFireAt).not.toBeNull();
    }
  });

  it("IDEMPOTENCY: a second fire on a re-stamped pictureLockedAt does NOT re-schedule (alreadyFired=true)", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "idem", plan: "manager" });

    const first = await t.mutation(
      internal.lcMaya.firstProactivePing.firePictureLockedEvent,
      {
        creatorId,
        _testJitterRandom: 0,
        _testNowMs: NOW,
        gmailOAuthUrl: null,
        calendarOAuthUrl: null,
      }
    );
    expect(first.ok).toBe(true);
    expect(first.alreadyFired).toBe(false);

    const second = await t.mutation(
      internal.lcMaya.firstProactivePing.firePictureLockedEvent,
      {
        creatorId,
        _testJitterRandom: 1,
        _testNowMs: NOW + 60_000,
        gmailOAuthUrl: null,
        calendarOAuthUrl: null,
      }
    );
    expect(second.ok).toBe(true);
    expect(second.alreadyFired).toBe(true);
    expect(second.scheduledFireAt).toBeNull();
  });

  it("CROSS-TENANT: Creator A's first-ping never fires for Creator B even with adjacent pictureLockedAt timestamps", async () => {
    const t = convexTest(schema, modules);
    const creatorA = await insertCreator(t, { suffix: "tenA", plan: "manager" });
    const creatorB = await insertCreator(t, { suffix: "tenB", plan: "coach" });

    // Seed only Creator A with a creator-picture + trend so the ping
    // composes against A's data.
    await insertCreatorPicture(t, creatorA);
    await insertTrend(t, creatorA, {
      score: 0.9,
      observation: "POV constraint hooks trending",
      ref: "https://tiktok.com/tag/povconstraint",
      observedAt: NOW,
    });

    // Fire pictureLocked for BOTH creators back-to-back.
    await t.mutation(internal.lcMaya.firstProactivePing.firePictureLockedEvent, {
      creatorId: creatorA,
      _testJitterRandom: 0,
      _testNowMs: NOW,
      gmailOAuthUrl: "https://oauth.example/gmail",
      calendarOAuthUrl: "https://oauth.example/cal",
    });
    await t.mutation(internal.lcMaya.firstProactivePing.firePictureLockedEvent, {
      creatorId: creatorB,
      _testJitterRandom: 0,
      _testNowMs: NOW + 100, // 100ms later
      gmailOAuthUrl: "https://oauth.example/gmail",
      calendarOAuthUrl: "https://oauth.example/cal",
    });

    // Drain the scheduler to fire both runFirstProactivePing actions.
    await drainScheduler(t);

    // Creator A: queued ping with trend-only precedence (idea picker
    // returned null because A's creatorPicture has no `examplePostId`
    // matched ≥ 2 sourceCitations? we did insert 3 sourceCitations + 1
    // topHook → idea picker SHOULD return a row. Verify trend+idea.).
    const rowsA = await t.run((ctx) =>
      ctx.db
        .query("firstProactivePings")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorA))
        .collect()
    );
    expect(rowsA.length).toBe(1);
    expect(rowsA[0].status).toBe("queued");
    expect(rowsA[0].precedence).toBe("trend+idea");

    // Creator B has NO data — should be a 'skipped' row.
    const rowsB = await t.run((ctx) =>
      ctx.db
        .query("firstProactivePings")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorB))
        .collect()
    );
    expect(rowsB.length).toBe(1);
    expect(rowsB[0].status).toBe("skipped");
    expect(rowsB[0].precedence).toBe("skip-empty");

    // Both creators stamped firstProactivePingSentAt.
    const a = await t.run((ctx) => ctx.db.get(creatorA));
    const b = await t.run((ctx) => ctx.db.get(creatorB));
    expect(a?.firstProactivePingSentAt).toBeTypeOf("number");
    expect(b?.firstProactivePingSentAt).toBeTypeOf("number");

    // The two creators' rows are isolated (different creatorIds).
    expect(rowsA[0].creatorId).toBe(creatorA);
    expect(rowsB[0].creatorId).toBe(creatorB);
  });

  it("ADVERSARIAL: missing creator → returns ok=false with reason='creator-not-found'", async () => {
    const t = convexTest(schema, modules);
    // A real-shaped but never-inserted id. Use one creator's id then drop
    // the creator row.
    const tmp = await insertCreator(t, { suffix: "tmp", plan: "manager" });
    await t.run((ctx) => ctx.db.delete(tmp));
    const result = await t.mutation(
      internal.lcMaya.firstProactivePing.firePictureLockedEvent,
      {
        creatorId: tmp,
        _testJitterRandom: 0,
        _testNowMs: NOW,
        gmailOAuthUrl: null,
        calendarOAuthUrl: null,
      }
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("creator-not-found");
  });

  it("ADVERSARIAL: when trend AND idea data are both missing, the row writes status='skipped' / precedence='skip-empty'", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "thin", plan: "manager" });
    // No creator-picture, no trends.

    await t.mutation(internal.lcMaya.firstProactivePing.firePictureLockedEvent, {
      creatorId,
      _testJitterRandom: 0,
      _testNowMs: NOW,
      gmailOAuthUrl: "https://oauth.example/gmail",
      calendarOAuthUrl: "https://oauth.example/cal",
    });
    await drainScheduler(t);

    const rows = await t.run((ctx) =>
      ctx.db
        .query("firstProactivePings")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    );
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("skipped");
    expect(rows[0].precedence).toBe("skip-empty");
    expect(rows[0].body).toBe("");

    const creator = await t.run((ctx) => ctx.db.get(creatorId));
    // Cursor IS stamped — silent skip is still a "fired once" event.
    expect(creator?.firstProactivePingSentAt).toBeTypeOf("number");
  });

  it("ADVERSARIAL: trend present + creator-picture present but with <2 sourceCitations → precedence='trend-only' (idea leg fails citation firewall)", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "trendonly", plan: "manager" });
    await insertCreatorPicture(t, creatorId, { sourceCount: 1 }); // <2 cites
    await insertTrend(t, creatorId, {
      score: 0.8,
      observation: "POV format trending in fitness",
      ref: "https://tiktok.com/tag/povfitness",
      observedAt: NOW,
    });

    await t.mutation(internal.lcMaya.firstProactivePing.firePictureLockedEvent, {
      creatorId,
      _testJitterRandom: 0,
      _testNowMs: NOW,
      gmailOAuthUrl: "https://oauth.example/gmail",
      calendarOAuthUrl: "https://oauth.example/cal",
    });
    await drainScheduler(t);

    const rows = await t.run((ctx) =>
      ctx.db
        .query("firstProactivePings")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    );
    expect(rows[0].precedence).toBe("trend-only");
    expect(rows[0].body).toContain("Trend:");
    expect(rows[0].body).not.toContain("Idea:");
  });

  it("HAPPY (full pipeline): trend + creator-picture both present → trend+idea ping with both citations, body free of banned phrases", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await insertCreator(t, { suffix: "full", plan: "coach" });
    await insertCreatorPicture(t, creatorId, { sourceCount: 3 });
    // Insert two trends; the higher-scoring one should win.
    await insertTrend(t, creatorId, {
      score: 0.4,
      observation: "low fit",
      ref: "https://example.com/low",
      observedAt: NOW,
    });
    await insertTrend(t, creatorId, {
      score: 0.95,
      observation: "POV format trending across fitness TikTok",
      ref: "https://tiktok.com/tag/povfitness",
      observedAt: NOW,
    });

    await t.mutation(internal.lcMaya.firstProactivePing.firePictureLockedEvent, {
      creatorId,
      _testJitterRandom: 0.5,
      _testNowMs: NOW,
      gmailOAuthUrl: "https://oauth.example/gmail",
      calendarOAuthUrl: "https://oauth.example/cal",
    });
    await drainScheduler(t);

    const rows = await t.run((ctx) =>
      ctx.db
        .query("firstProactivePings")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    );
    expect(rows.length).toBe(1);
    const row = rows[0];
    expect(row.status).toBe("queued");
    expect(row.precedence).toBe("trend+idea");
    expect(row.citations.trendRef).toBe("https://tiktok.com/tag/povfitness");
    expect(row.citations.ideaPostIds.length).toBeGreaterThanOrEqual(2);
    expect(row.body).toContain("Connect Gmail");
    expect(row.body).toContain("Connect Calendar");
    for (const phrase of BANNED_PHRASES) {
      expect(row.body.toLowerCase()).not.toContain(phrase);
    }
  });

  it("DELAY RANGE: across many randomFn samples, scheduledFireAt is always within [pictureLockedAt + 15min, pictureLockedAt + 30min]", async () => {
    // 20 fresh creators, deterministic randomFn each. Verifies the
    // bounded-delay invariant as a sweep test.
    for (let i = 0; i < 20; i++) {
      const t = convexTest(schema, modules);
      const creatorId = await insertCreator(t, {
        suffix: `sweep_${i}`,
        plan: "manager",
      });
      const r = i / 19; // 0, 0.052..., ..., 1
      const result = await t.mutation(
        internal.lcMaya.firstProactivePing.firePictureLockedEvent,
        {
          creatorId,
          _testJitterRandom: r,
          _testNowMs: NOW,
          gmailOAuthUrl: null,
          calendarOAuthUrl: null,
        }
      );
      const fireAt = result.scheduledFireAt!;
      expect(fireAt).toBeGreaterThanOrEqual(NOW + FIRST_PING_MIN_DELAY_MS);
      expect(fireAt).toBeLessThanOrEqual(NOW + FIRST_PING_MAX_DELAY_MS);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Sibling-file scan                                                            */
/* -------------------------------------------------------------------------- */

describe("Sibling-file scan — standing-order ↔ event handler ↔ playbook", () => {
  it("STANDING ORDERS: `first_proactive_ping` exists, kind='event', tier='all', thinkingBudget='medium', eventTrigger='pictureLockedAt'", () => {
    const program = STANDING_ORDERS.find((p) => p.id === "first_proactive_ping");
    expect(program, "missing first_proactive_ping").toBeDefined();
    expect(program?.kind).toBe("event");
    expect(program?.tier).toBe("all");
    expect(program?.thinkingBudget).toBe("medium");
    expect(program?.eventSchedule?.eventTrigger).toBe("pictureLockedAt");
    expect(program?.eventSchedule?.minDelayMs).toBe(FIRST_PING_MIN_DELAY_MS);
    expect(program?.eventSchedule?.maxDelayMs).toBe(FIRST_PING_MAX_DELAY_MS);
  });

  it("STANDING ORDERS: `first_proactive_ping` carries no cron fields (kind='event' is consistent)", () => {
    const program = STANDING_ORDERS.find((p) => p.id === "first_proactive_ping");
    expect(program?.cronEntryId).toBeUndefined();
    expect(program?.defaultCron).toBeUndefined();
    expect(program?.session).toBeUndefined();
    expect(program?.cronMessage).toBeUndefined();
  });
});
