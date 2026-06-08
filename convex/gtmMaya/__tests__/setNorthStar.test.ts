/**
 * Sprint B — /lc_gtm/set_north_star endpoint + setNorthStarAndMode mutation.
 *
 * Covers the mandatory categories for this surface:
 *   - happy path: persists entryMode + North Star onto the agent's gtmApps
 *   - cross-tenant isolation: agent A's write never lands on agent B's app
 *   - idempotency: same key replays without double-applying
 *   - adversarial/validation: missing key, nothing-to-set, bad entryMode → 4xx
 */

import { convexTest } from "convex-test";
import { beforeAll, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = btoa("\0".repeat(32));
});

async function setupAgent(t: ReturnType<typeof convexTest>, subject: string) {
  const authed = t.withIdentity({
    subject,
    email: `${subject}@clawlaunch.test`,
  });
  const started = await authed.mutation(
    api.gtmMaya.researchLifecycle.startGtmOnboarding,
    {}
  );
  const appId = await authed.mutation(
    api.gtmMaya.researchLifecycle.setAppProfile,
    {
      name: `App for ${subject}`,
      url: `https://${subject}.test`,
      stage: "live-beta",
      weekGoal: "signups",
      canRecordScreen: true,
      canShowFace: false,
      excludedAudiences: [],
    }
  );
  const hookToken = "fake-hook-" + Math.random().toString(36).slice(2);
  await t.run(async (ctx) => {
    await ctx.db.patch(started.agentId, { hookToken });
  });
  return { agentId: started.agentId, appId, hookToken };
}

async function callSetNorthStar(
  t: ReturnType<typeof convexTest>,
  hookToken: string,
  body: Record<string, unknown>
): Promise<{ status: number; text: string }> {
  const res = await t.fetch("/lc_gtm/set_north_star", {
    method: "POST",
    headers: {
      authorization: `Bearer ${hookToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

describe("Sprint B — set_north_star", () => {
  it("persists entryMode + North Star onto the agent's app", async () => {
    const t = convexTest(schema, modules);
    const { appId, hookToken } = await setupAgent(t, "u_ns_happy");

    const res = await callSetNorthStar(t, hookToken, {
      idempotencyKey: "k1",
      entryMode: "manager",
      northStarMetric: "signups/week",
      northStarTarget: 50,
      northStarDeadlineMs: Date.UTC(2026, 5, 30),
    });
    expect(res.status).toBe(200);

    const app = await t.run(async (ctx) => ctx.db.get(appId));
    expect(app?.entryMode).toBe("manager");
    expect(app?.northStarMetric).toBe("signups/week");
    expect(app?.northStarTarget).toBe(50);
    expect(app?.northStarDeadlineMs).toBe(Date.UTC(2026, 5, 30));
  });

  it("never lets one agent's write land on another agent's app", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "u_ns_a");
    const b = await setupAgent(t, "u_ns_b");

    // Agent A sets its North Star with A's token.
    const res = await callSetNorthStar(t, a.hookToken, {
      idempotencyKey: "ka",
      northStarMetric: "A-only-metric",
    });
    expect(res.status).toBe(200);

    const appA = await t.run(async (ctx) => ctx.db.get(a.appId));
    const appB = await t.run(async (ctx) => ctx.db.get(b.appId));
    expect(appA?.northStarMetric).toBe("A-only-metric");
    // B is untouched — the write is scoped to the token's own agent/app.
    expect(appB?.northStarMetric).toBeUndefined();
  });

  it("idempotency: same key replays without re-applying", async () => {
    const t = convexTest(schema, modules);
    const { appId, hookToken } = await setupAgent(t, "u_ns_idem");

    await callSetNorthStar(t, hookToken, {
      idempotencyKey: "dup",
      northStarMetric: "first",
    });
    // Replay same key with a different value → treated as duplicate, no-op.
    const replay = await callSetNorthStar(t, hookToken, {
      idempotencyKey: "dup",
      northStarMetric: "second-should-not-apply",
    });
    expect(replay.status).toBe(200);
    expect(replay.text).toContain("replay");

    const app = await t.run(async (ctx) => ctx.db.get(appId));
    expect(app?.northStarMetric).toBe("first");
  });

  it("rejects missing key, empty payload, and bad entryMode", async () => {
    const t = convexTest(schema, modules);
    const { hookToken } = await setupAgent(t, "u_ns_bad");

    const noKey = await callSetNorthStar(t, hookToken, {
      northStarMetric: "x",
    });
    expect(noKey.status).toBe(400);

    const empty = await callSetNorthStar(t, hookToken, { idempotencyKey: "e" });
    expect(empty.status).toBe(400);

    const badMode = await callSetNorthStar(t, hookToken, {
      idempotencyKey: "bm",
      entryMode: "bogus",
    });
    expect(badMode.status).toBe(400);
  });

  it("rejects unauthenticated calls", async () => {
    const t = convexTest(schema, modules);
    await setupAgent(t, "u_ns_auth");
    const res = await callSetNorthStar(t, "not-a-real-token", {
      idempotencyKey: "z",
      northStarMetric: "x",
    });
    expect(res.status).toBe(401);
  });

  // Sprint G — archetype tag (the cross-tenant moat index).
  it("persists the archetype tag", async () => {
    const t = convexTest(schema, modules);
    const { appId, hookToken } = await setupAgent(t, "u_ns_arch");
    const res = await callSetNorthStar(t, hookToken, {
      idempotencyKey: "a1",
      archetype: "dev-tool",
    });
    expect(res.status).toBe(200);
    const app = await t.run(async (ctx) => ctx.db.get(appId));
    expect(app?.archetype).toBe("dev-tool");
  });

  // Sprint G — cross-tenant archetype playbook read (warm-start), privacy-safe.
  it("reads aggregated archetype learnings by archetype only (no tenant scope)", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("gtmArchetypeLearnings", {
        archetype: "dev-tool",
        kind: "channel",
        learning: "HN + r/LocalLLaMA convert; Show HN week 3 not week 1",
        supportingTenantCount: 12,
        evidenceCount: 240,
        confidence: 0.8,
        updatedAt: Date.now(),
      });
    });
    const { internal } = await import("../../_generated/api");
    const learnings = await t.query(
      internal.gtmMaya.managerStore.getArchetypeLearnings,
      { archetype: "dev-tool" }
    );
    expect(learnings.length).toBe(1);
    expect(learnings[0].learning).toContain("Show HN week 3");
    // privacy-safe: no creatorId / accountId on the row at all.
    expect(
      Object.prototype.hasOwnProperty.call(learnings[0], "accountId")
    ).toBe(false);
  });
});
