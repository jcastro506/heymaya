/**
 * The diagnostic ladder (§14.2).
 *
 * §14.2 calls it "the most differentiated thing in the product" and asks for
 * it "deliberately as a subsystem, not as a fallback". Her Sunday cron already
 * asked which rung was broken — and `history` returned no numbers at all, so
 * the only available answers were "I can't" or a guess.
 */

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { SEEN_FLOOR, ENGAGED_FLOOR } from "../ladder";
import type { Id } from "../../_generated/dataModel";

const NOW = Date.UTC(2026, 7, 5, 14, 0, 0);
const DAY = 86_400_000;

describe("⭐ THE LOWEST BROKEN RUNG IS THE ONE WORTH FIXING", () => {
  it("⭐ L0 — nothing went live, and that is OURS", () =>
    // Reaching for a format or topic verdict here invents a problem to explain
    // a week whose real answer is that we didn't do the work.
    withSeed(async (t, customerId) => {
      const v = await t.query(internal.maya.ladder.diagnose, { customerId, now: NOW });
      expect(v.rung).toBe("L0");
      expect(v.detail).toMatch(/that's on me/i);
    }));

  it("L1 — it went out and nobody saw it: a FORMAT problem", () =>
    withSeed(async (t, customerId) => {
      await placement(t, customerId, { views: 12, likes: 4 });
      const v = await t.query(internal.maya.ladder.diagnose, { customerId, now: NOW });
      expect(v.rung).toBe("L1");
      expect(v.detail).toMatch(/format problem, not a topic one/);
    }));

  it("⭐ L2 — they saw it and scrolled: a TOPIC problem", () =>
    // And crucially NOT L1: a topic verdict on a post nobody saw would be
    // advice about the wrong thing entirely.
    withSeed(async (t, customerId) => {
      await placement(t, customerId, { views: 5_000, likes: 2 });
      const v = await t.query(internal.maya.ladder.diagnose, { customerId, now: NOW });
      expect(v.rung).toBe("L2");
      expect(v.detail).toMatch(/angle is wrong rather than the format/);
    }));

  it("⭐ HEALTHY SAYS WHAT IT CANNOT SEE", () =>
    /**
     * L3 (clicks) and L4 (signups) need the attribution ladder (§14.45).
     * Calling them fine from silence is the exact dishonesty §14.2's worked
     * example is built to prevent.
     */
    withSeed(async (t, customerId) => {
      await placement(t, customerId, { views: 5_000, likes: 400 });
      const v = await t.query(internal.maya.ladder.diagnose, { customerId, now: NOW });
      expect(v.rung).toBe("healthy");
      expect(v.detail).toMatch(/isn't something I can see yet/);
    }));

  it("⭐ NO NUMBERS IS `unknown`, NEVER A GUESSED RUNG", () =>
    // A confident diagnosis with nothing under it is the failure mode this
    // subsystem exists to remove.
    withSeed(async (t, customerId) => {
      await placement(t, customerId, {});
      const v = await t.query(internal.maya.ladder.diagnose, { customerId, now: NOW });
      expect(v.rung).toBe("unknown");
      expect(v.unmeasured).toBe(1);
      expect(v.detail).toMatch(/no numbers back/);
    }));

  it("unmeasured placements are counted, so the verdict can be weighed", () =>
    withSeed(async (t, customerId) => {
      await placement(t, customerId, { views: 5_000, likes: 400 });
      await placement(t, customerId, {});
      const v = await t.query(internal.maya.ladder.diagnose, { customerId, now: NOW });
      expect(v.placements).toBe(2);
      expect(v.unmeasured).toBe(1);
    }));

  it("only live placements inside the window count", () =>
    withSeed(async (t, customerId) => {
      await placement(t, customerId, { views: 9_000, likes: 900, ageDays: 30 });
      await placement(t, customerId, { views: 9_000, likes: 900, linkStatus: "unknown" });
      const v = await t.query(internal.maya.ladder.diagnose, { customerId, now: NOW });
      expect(v.rung).toBe("L0");
    }));

  it("every channel's engagement vocabulary is summed, not one of them", () =>
    // X returns `replies`/`reposts`; Zernio returns `comments`/`shares`/`saves`.
    // Insisting on one vocabulary silently scores the other channel as zero.
    withSeed(async (t, customerId) => {
      await placement(t, customerId, {
        views: 1_000,
        raw: { views: 1_000, replies: 6, reposts: 5, saves: 4 },
      });
      const v = await t.query(internal.maya.ladder.diagnose, { customerId, now: NOW });
      expect(v.engagements).toBe(15);
    }));

  it("the floors are coarse on purpose — §14.3's small-n warning", () => {
    expect(SEEN_FLOOR).toBeGreaterThan(0);
    expect(ENGAGED_FLOOR).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */

async function withSeed(
  fn: (t: ReturnType<typeof convexTest>, id: Id<"customers">) => Promise<void>
) {
  const t = convexTest(schema, modules);
  const customerId = await seed(t);
  await fn(t, customerId);
}

async function placement(
  t: ReturnType<typeof convexTest>,
  customerId: Id<"customers">,
  over: {
    views?: number;
    likes?: number;
    ageDays?: number;
    linkStatus?: "live" | "unknown";
    raw?: Record<string, number>;
  }
) {
  const id = Math.random();
  const metrics =
    over.raw ??
    (over.views !== undefined
      ? { views: over.views, likes: over.likes ?? 0 }
      : undefined);
  await t.run(async (ctx) => {
    await ctx.db.insert("placements", {
      customerId,
      kind: "post",
      channel: "x",
      url: `https://x.com/a/status/${id}`,
      linkStatus: over.linkStatus ?? "live",
      publishedAt: NOW - (over.ageDays ?? 1) * DAY,
      snapshotText: "something",
      idempotencyKey: `k-${id}`,
      metricsJson: metrics ? JSON.stringify(metrics) : undefined,
      metricsAsOf: metrics ? NOW : undefined,
    });
  });
}

async function seed(t: ReturnType<typeof convexTest>): Promise<Id<"customers">> {
  return await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("creators", {
      clerkUserId: "u_ladder",
      email: "ladder@example.com",
      channelPreference: "telegram",
      timezone: "UTC",
      status: "active",
      plan: "manager",
      createdAt: NOW,
    });
    return await ctx.db.insert("customers", {
      accountId,
      agentVersion: "v2",
      plan: "mvp",
      state: "active",
      timezone: "UTC",
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
}
