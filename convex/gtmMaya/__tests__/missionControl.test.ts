/**
 * Mission Control — public read queries + the /lc_gtm/post_activity feed.
 *
 * Mandatory categories: auth-scoping (signed-in operator only), cross-tenant
 * isolation (A never sees B), idempotency, validation, auth, live round-trip
 * (post via endpoint → read via query).
 */

import { convexTest } from "convex-test";
import { beforeAll, describe, expect, it } from "vitest";
import { api, internal } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = btoa("\0".repeat(32));
});

/** Set up a gtm-agent operator. Returns the identity subject (for useQuery
 *  auth), the agent/account ids, and a hookToken (for the HTTP endpoint). */
async function setupOperator(t: ReturnType<typeof convexTest>, subject: string) {
  const authed = t.withIdentity({ subject, email: `${subject}@cl.test` });
  const started = await authed.mutation(
    api.gtmMaya.researchLifecycle.startGtmOnboarding,
    {}
  );
  const hookToken = "hook-" + Math.random().toString(36).slice(2);
  await t.run(async (ctx) => {
    await ctx.db.patch(started.agentId, { hookToken });
  });
  return {
    subject,
    authed,
    agentId: started.agentId,
    accountId: started.accountId,
    hookToken,
  };
}

function postActivity(
  t: ReturnType<typeof convexTest>,
  hookToken: string,
  body: Record<string, unknown>
) {
  return t.fetch("/lc_gtm/post_activity", {
    method: "POST",
    headers: {
      authorization: `Bearer ${hookToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("Mission Control — read queries", () => {
  it("returns empty for an unauthenticated / non-gtm caller", async () => {
    const t = convexTest(schema, modules);
    await setupOperator(t, "u_mc_anon");
    // No identity at all:
    expect(await t.query(api.gtmMaya.missionControl.getMyConversions, {})).toEqual(
      []
    );
    expect(await t.query(api.gtmMaya.missionControl.getMyBuyerMap, {})).toBeNull();
  });

  it("auth-scopes buyer map + competitive map + conversions to the caller", async () => {
    const t = convexTest(schema, modules);
    const a = await setupOperator(t, "u_mc_a");
    await t.run(async (ctx) => {
      await ctx.db.insert("gtmBuyerMap", {
        accountId: a.accountId,
        agentId: a.agentId,
        icpDescription: "Mac devs making demos",
        buyerJourneyStages: [],
        intentPhrases: ["best screen recorder"],
        trustedVoices: [],
        synthesizedAt: Date.now(),
      });
      await ctx.db.insert("gtmConversions", {
        accountId: a.accountId,
        agentId: a.agentId,
        kind: "signup",
        count: 3,
        source: "self_report",
        occurredAt: Date.now(),
      });
    });
    const map = await a.authed.query(
      api.gtmMaya.missionControl.getMyBuyerMap,
      {}
    );
    expect(map?.icpDescription).toContain("Mac devs");
    const conv = await a.authed.query(
      api.gtmMaya.missionControl.getMyConversions,
      {}
    );
    expect(conv.length).toBe(1);
    expect(conv[0].count).toBe(3);
  });

  it("cross-tenant: operator B never sees operator A's data", async () => {
    const t = convexTest(schema, modules);
    const a = await setupOperator(t, "u_mc_iso_a");
    const b = await setupOperator(t, "u_mc_iso_b");
    await t.run(async (ctx) => {
      await ctx.db.insert("gtmBuyerMap", {
        accountId: a.accountId,
        agentId: a.agentId,
        icpDescription: "A-only ICP",
        buyerJourneyStages: [],
        intentPhrases: [],
        trustedVoices: [],
        synthesizedAt: Date.now(),
      });
    });
    expect(
      (await a.authed.query(api.gtmMaya.missionControl.getMyBuyerMap, {}))
        ?.icpDescription
    ).toBe("A-only ICP");
    // B sees nothing of A's.
    expect(
      await b.authed.query(api.gtmMaya.missionControl.getMyBuyerMap, {})
    ).toBeNull();
  });

  it("niche learnings hide retired unless asked", async () => {
    const t = convexTest(schema, modules);
    const a = await setupOperator(t, "u_mc_learn");
    await t.run(async (ctx) => {
      const now = Date.now();
      const base = {
        accountId: a.accountId,
        agentId: a.agentId,
        learningKind: "timing" as const,
        learning: "Tue 9am best",
        evidenceCount: 3,
        confidenceScore: 0.7,
        firstObservedAt: now,
        lastReinforcedAt: now,
        createdAt: now,
        updatedAt: now,
      };
      await ctx.db.insert("gtmNicheLearnings", {
        ...base,
        learningKey: "timing-tue-9am",
        retired: false,
      });
      await ctx.db.insert("gtmNicheLearnings", {
        ...base,
        learningKey: "timing-old",
        learning: "old",
        retired: true,
      });
    });
    expect(
      (await a.authed.query(api.gtmMaya.missionControl.getMyNicheLearnings, {}))
        .length
    ).toBe(1);
    expect(
      (
        await a.authed.query(api.gtmMaya.missionControl.getMyNicheLearnings, {
          includeRetired: true,
        })
      ).length
    ).toBe(2);
  });
});

describe("Mission Control — activity feed (autonomous update)", () => {
  it("post_activity → getMyAgentActivity round-trip (live update path)", async () => {
    const t = convexTest(schema, modules);
    const a = await setupOperator(t, "u_act_rt");
    const res = await postActivity(t, a.hookToken, {
      idempotencyKey: "a1",
      kind: "researching",
      summary: "digging r/macapps for Loom-fatigue threads",
    });
    expect(res.status).toBe(200);
    const feed = await a.authed.query(
      api.gtmMaya.missionControl.getMyAgentActivity,
      {}
    );
    expect(feed.length).toBe(1);
    expect(feed[0].kind).toBe("researching");
    expect(feed[0].summary).toContain("Loom-fatigue");
  });

  it("activity feed is cross-tenant isolated", async () => {
    const t = convexTest(schema, modules);
    const a = await setupOperator(t, "u_act_a");
    const b = await setupOperator(t, "u_act_b");
    await postActivity(t, a.hookToken, {
      idempotencyKey: "x",
      kind: "found",
      summary: "A's hot thread",
    });
    expect(
      (await b.authed.query(api.gtmMaya.missionControl.getMyAgentActivity, {}))
        .length
    ).toBe(0);
  });

  it("post_activity: idempotency + validation + auth", async () => {
    const t = convexTest(schema, modules);
    const a = await setupOperator(t, "u_act_bad");
    await postActivity(t, a.hookToken, {
      idempotencyKey: "dup",
      kind: "status",
      summary: "first",
    });
    const replay = await postActivity(t, a.hookToken, {
      idempotencyKey: "dup",
      kind: "status",
      summary: "second",
    });
    expect(await replay.text()).toContain("replay");
    // only one row
    expect(
      (await a.authed.query(api.gtmMaya.missionControl.getMyAgentActivity, {}))
        .length
    ).toBe(1);

    expect(
      (await postActivity(t, a.hookToken, { kind: "status", summary: "x" }))
        .status
    ).toBe(400); // missing key
    expect(
      (
        await postActivity(t, a.hookToken, {
          idempotencyKey: "k",
          kind: "bogus",
          summary: "x",
        })
      ).status
    ).toBe(400); // bad kind
    expect(
      (
        await postActivity(t, "bad-token", {
          idempotencyKey: "z",
          kind: "status",
          summary: "x",
        })
      ).status
    ).toBe(401); // auth
  });

  it("recordAgentActivity keeps recent entries (no longer 200-capped)", async () => {
    const t = convexTest(schema, modules);
    const a = await setupOperator(t, "u_act_prune");
    // 205 recent entries — all within 30 days and under the 1500 hard cap,
    // so the durable-retention policy keeps every one (the Week view needs
    // more than the old 200-row window).
    for (let i = 0; i < 205; i++) {
      await t.mutation(internal.gtmMaya.missionControl.recordAgentActivity, {
        accountId: a.accountId as Id<"creators">,
        agentId: a.agentId as Id<"gtmAgents">,
        kind: "status",
        summary: `entry ${i}`,
      });
    }
    const total = await t.run(async (ctx) =>
      ctx.db
        .query("gtmAgentActivity")
        .withIndex("by_agent", (q) => q.eq("agentId", a.agentId))
        .collect()
    );
    expect(total.length).toBe(205);
  });

  it("recordAgentActivity prunes entries older than the 30-day retention", async () => {
    const t = convexTest(schema, modules);
    const a = await setupOperator(t, "u_act_retain");
    // Seed one ancient row (31 days old) directly.
    const ancientId = await t.run(async (ctx) =>
      ctx.db.insert("gtmAgentActivity", {
        accountId: a.accountId as Id<"creators">,
        agentId: a.agentId as Id<"gtmAgents">,
        kind: "thinking",
        summary: "old hunch",
        createdAt: Date.now() - 31 * 24 * 60 * 60 * 1000,
      })
    );
    // A fresh write triggers the prune pass.
    await t.mutation(internal.gtmMaya.missionControl.recordAgentActivity, {
      accountId: a.accountId as Id<"creators">,
      agentId: a.agentId as Id<"gtmAgents">,
      kind: "found",
      summary: "fresh signal",
    });
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("gtmAgentActivity")
        .withIndex("by_agent", (q) => q.eq("agentId", a.agentId))
        .collect()
    );
    expect(rows.find((r) => r._id === ancientId)).toBeUndefined();
    expect(rows.some((r) => r.summary === "fresh signal")).toBe(true);
  });

  it("getMyAgentActivity scopes to the sinceMs window for the Hour/Day/Week filter", async () => {
    const t = convexTest(schema, modules);
    const a = await setupOperator(t, "u_act_range");
    const now = Date.now();
    const seed = (summary: string, ageMs: number, kind: string) =>
      t.run(async (ctx) =>
        ctx.db.insert("gtmAgentActivity", {
          accountId: a.accountId as Id<"creators">,
          agentId: a.agentId as Id<"gtmAgents">,
          kind: kind as "thinking",
          summary,
          createdAt: now - ageMs,
        })
      );
    await seed("90 min ago", 90 * 60 * 1000, "thinking");
    await seed("30 min ago", 30 * 60 * 1000, "researching");
    await seed("2 min ago", 2 * 60 * 1000, "found");

    // sinceMs = last hour → only the 30-min + 2-min rows.
    const lastHour = await a.authed.query(
      api.gtmMaya.missionControl.getMyAgentActivity,
      { sinceMs: now - 60 * 60 * 1000, limit: 500 }
    );
    expect(lastHour.map((r) => r.summary).sort()).toEqual([
      "2 min ago",
      "30 min ago",
    ]);

    // No sinceMs → all three (within the default cap).
    const all = await a.authed.query(
      api.gtmMaya.missionControl.getMyAgentActivity,
      {}
    );
    expect(all.length).toBe(3);
  });
});
