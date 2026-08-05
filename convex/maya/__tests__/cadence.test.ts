/**
 * The instrument for Sprint 3's exit criterion.
 *
 * §18 calls Sprint 3 "the gamble" and says nothing past it is worth building
 * until it holds. The criterion is *"a placement a day for seven straight
 * days, verified"* — and until this module there was no query that could
 * answer it, so the gate the whole plan hangs on was going to be evaluated by
 * counting rows in a table by eye.
 *
 * These tests are mostly about the ways a streak can be WRONG while looking
 * right, because a number that reports a broken run as clean is worse than no
 * number at all.
 */

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { dayKeyInZone, EXIT_STREAK_DAYS } from "../cadence";
import type { Id } from "../../_generated/dataModel";

/** Wednesday 2026-08-05, 14:00 UTC = 10:00 in New York. */
const NOW = Date.UTC(2026, 7, 5, 14, 0, 0);
const DAY = 86_400_000;

describe("⭐ THE FOUNDER'S DAY, NOT UTC", () => {
  it("⭐ AN 8PM NEW YORK POST IS NOT TOMORROW", () => {
    // The evening recap posts at 20:00. In America/New_York that is 01:00 UTC
    // the NEXT day — so counting in UTC files a Tuesday-evening placement as
    // Wednesday, inventing two on one day and a gap on another.
    //
    // A seven-day streak evaluated in the wrong zone doesn't wobble; it
    // reports a broken run as clean, or kills a clean one.
    const tuesday8pmET = Date.UTC(2026, 7, 5, 0, 30, 0); // 2026-08-04 20:30 ET
    expect(dayKeyInZone(tuesday8pmET, "America/New_York")).toBe("2026-08-04");
    expect(dayKeyInZone(tuesday8pmET, "UTC")).toBe("2026-08-05");
  });

  it("a streak counted in the founder's zone stays unbroken across the UTC boundary", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "America/New_York");
    // Three consecutive ET evenings, each of which is the NEXT day in UTC.
    for (let i = 0; i < 3; i += 1) {
      await addPlacement(t, customerId, {
        publishedAt: Date.UTC(2026, 7, 5, 0, 30, 0) - i * DAY,
      });
    }
    const r = await t.query(internal.maya.cadence.cadence, { customerId, now: NOW });
    // Aug 4, 3 and 2 in ET. Today (Aug 5 ET) is still open, so the streak runs
    // back from yesterday.
    expect(r.streak).toBe(3);
    expect(r.todayDone).toBe(false);
  });
});

describe("⭐ WHAT COUNTS AS A PLACEMENT", () => {
  it("⭐ AN UNCONFIRMED PUBLISH DOES NOT COUNT", () => {
    // §2.6 — the unit of work is something LIVE, with a URL. The criterion
    // says "verified"; a publish we can't open is exactly what a seven-day
    // claim must not rest on.
    return withSeed(async (t, customerId) => {
      await addPlacement(t, customerId, { publishedAt: NOW, linkStatus: "unknown" });
      const r = await t.query(internal.maya.cadence.cadence, { customerId, now: NOW });
      expect(r.streak).toBe(0);
      expect(r.todayDone).toBe(false);
    });
  });

  it("a dead link breaks the run rather than being papered over", () =>
    withSeed(async (t, customerId) => {
      await addPlacement(t, customerId, { publishedAt: NOW, linkStatus: "gone" });
      const r = await t.query(internal.maya.cadence.cadence, { customerId, now: NOW });
      expect(r.streak).toBe(0);
    }));

  it("⭐ SEVEN DAYS OF REPLIES IS NOT THE EXIT CRITERION", () =>
    // Replies are real work and they are not what "a placement a day" means.
    // One number would hide the difference, so posts and replies are counted
    // separately as well as together.
    withSeed(async (t, customerId) => {
      for (let i = 0; i < 8; i += 1) {
        await addPlacement(t, customerId, { publishedAt: NOW - i * DAY, kind: "reply" });
      }
      const r = await t.query(internal.maya.cadence.cadence, { customerId, now: NOW });
      expect(r.streak).toBeGreaterThanOrEqual(EXIT_STREAK_DAYS);
      expect(r.postDays).toBe(0);
      expect(r.exitCriterionMet).toBe(false);
    }));

  it("seven days with at least one real post meets it", () =>
    withSeed(async (t, customerId) => {
      for (let i = 0; i < 7; i += 1) {
        await addPlacement(t, customerId, {
          publishedAt: NOW - i * DAY,
          kind: i === 3 ? "post" : "reply",
        });
      }
      const r = await t.query(internal.maya.cadence.cadence, { customerId, now: NOW });
      expect(r.streak).toBe(7);
      expect(r.postDays).toBe(1);
      expect(r.exitCriterionMet).toBe(true);
      expect(r.detail).toMatch(/seven-day bar is met/);
    }));

  it("two placements in one day is still one day", () =>
    withSeed(async (t, customerId) => {
      await addPlacement(t, customerId, { publishedAt: NOW });
      await addPlacement(t, customerId, { publishedAt: NOW - 3600_000 });
      const r = await t.query(internal.maya.cadence.cadence, { customerId, now: NOW });
      expect(r.streak).toBe(1);
    }));
});

describe("⭐ THE MORNING PROBLEM", () => {
  it("⭐ AT 10AM WITH NOTHING POSTED YET, THE STREAK IS INTACT", () =>
    // A report that says "streak: 0" every morning until she posts is a report
    // nobody trusts by Wednesday. She hasn't missed the day at 10am.
    withSeed(async (t, customerId) => {
      for (let i = 1; i <= 4; i += 1) {
        await addPlacement(t, customerId, { publishedAt: NOW - i * DAY });
      }
      const r = await t.query(internal.maya.cadence.cadence, { customerId, now: NOW });
      expect(r.todayDone).toBe(false);
      expect(r.streak).toBe(4);
      expect(r.detail).toMatch(/today still open/);
    }));

  it("a genuinely missed day breaks it, and says so", () =>
    withSeed(async (t, customerId) => {
      // Nothing yesterday; the last one was the day before.
      await addPlacement(t, customerId, { publishedAt: NOW - 2 * DAY });
      const r = await t.query(internal.maya.cadence.cadence, { customerId, now: NOW });
      expect(r.streak).toBe(0);
      expect(r.detail).toMatch(/run is broken/);
    }));

  it("the best run ever survives a break — evidence isn't erased by one miss", () =>
    withSeed(async (t, customerId) => {
      for (let i = 10; i <= 16; i += 1) {
        await addPlacement(t, customerId, { publishedAt: NOW - i * DAY });
      }
      const r = await t.query(internal.maya.cadence.cadence, { customerId, now: NOW });
      expect(r.streak).toBe(0);
      expect(r.longestStreak).toBe(7);
    }));

  it("nothing live yet says exactly that", () =>
    withSeed(async (t, customerId) => {
      const r = await t.query(internal.maya.cadence.cadence, { customerId, now: NOW });
      expect(r.streak).toBe(0);
      expect(r.exitCriterionMet).toBe(false);
      expect(r.detail).toMatch(/nothing has gone live yet/);
    }));

  it("the days list is the receipt behind the number", () =>
    withSeed(async (t, customerId) => {
      await addPlacement(t, customerId, { publishedAt: NOW, kind: "post" });
      await addPlacement(t, customerId, { publishedAt: NOW - DAY, kind: "reply" });
      const r = await t.query(internal.maya.cadence.cadence, { customerId, now: NOW });
      expect(r.days[0].posts).toBe(1);
      expect(r.days[1].replies).toBe(1);
    }));
});

describe("⭐ CROSS-TENANT", () => {
  it("one founder's streak is never another's", async () => {
    const t = convexTest(schema, modules);
    const a = await seed(t, "UTC", "a");
    const b = await seed(t, "UTC", "b");
    for (let i = 0; i < 5; i += 1) {
      await addPlacement(t, a, { publishedAt: NOW - i * DAY });
    }
    const rb = await t.query(internal.maya.cadence.cadence, { customerId: b, now: NOW });
    expect(rb.streak).toBe(0);

    const fleet = await t.query(internal.maya.cadence.fleetCadence, { now: NOW });
    expect(fleet).toHaveLength(2);
    expect(fleet.find((r) => r.customerId === a)?.streak).toBe(5);
    expect(fleet.find((r) => r.customerId === b)?.streak).toBe(0);
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

async function seed(
  t: ReturnType<typeof convexTest>,
  timezone = "UTC",
  tag = "cadence"
): Promise<Id<"customers">> {
  return await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("creators", {
      clerkUserId: `u_${tag}${timezone}`,
      email: `${tag}@example.com`,
      channelPreference: "telegram",
      timezone,
      status: "active",
      plan: "manager",
      createdAt: NOW,
    });
    return await ctx.db.insert("customers", {
      accountId,
      agentVersion: "v2",
      plan: "mvp",
      state: "active",
      timezone,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
}

async function addPlacement(
  t: ReturnType<typeof convexTest>,
  customerId: Id<"customers">,
  over: {
    publishedAt: number;
    kind?: "post" | "reply";
    linkStatus?: "live" | "gone" | "unknown";
  }
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("placements", {
      customerId,
      kind: over.kind ?? "post",
      channel: "x",
      url: `https://x.com/w/status/${over.publishedAt}${Math.random()}`,
      linkStatus: over.linkStatus ?? "live",
      publishedAt: over.publishedAt,
      snapshotText: "something",
      idempotencyKey: `k-${over.publishedAt}-${Math.random()}`,
    });
  });
}
