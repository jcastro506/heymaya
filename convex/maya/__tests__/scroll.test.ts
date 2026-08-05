/**
 * The morning scroll — and remembering what it saw.
 *
 * The invariant: **re-running a sweep costs nothing and duplicates nothing**
 * (§5.2). A climbing post appears in the sweep several days running — that's
 * what climbing means — so without dedupe a week turns one post into seven
 * rows, and every "how often does this come up?" answers itself wrongly.
 */

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { NEWS_WINDOW_MS, OBSERVATIONS_RETURNED, type Observation } from "../scroll";
import type { Doc, Id } from "../../_generated/dataModel";

const NOW = Date.UTC(2026, 7, 5, 7, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

async function seed(t: ReturnType<typeof convexTest>): Promise<Id<"customers">> {
  return await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("creators", {
      clerkUserId: "u_scroll",
      email: "scroll@example.com",
      channelPreference: "telegram",
      timezone: "America/New_York",
      status: "active",
      plan: "manager",
      createdAt: NOW,
    });
    return await ctx.db.insert("customers", {
      accountId,
      agentVersion: "v2",
      plan: "mvp",
      state: "active",
      timezone: "America/New_York",
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
}

function obs(over: Partial<Observation> & { sourceUrl: string }): Observation {
  return {
    channel: "tiktok",
    authorHandle: "@someone",
    text: "a post about the niche",
    postedAt: NOW - DAY,
    metrics: { likes: 100, comments: 10, views: 5000 },
    velocity: 42,
    keyword: "csv dashboard",
    ...over,
  };
}

describe("⭐ RE-RUNNING A SWEEP DUPLICATES NOTHING", () => {
  it("the same post seen three days running is one row", async () => {
    // This is what makes a daily cron safe. A climbing post is SUPPOSED to keep
    // appearing; without dedupe, frequency becomes a count of how long we've
    // been watching rather than how many people care.
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    const post = obs({ sourceUrl: "https://tiktok.com/@a/video/1" });

    for (const day of [0, 1, 2]) {
      const res = await t.mutation(internal.maya.scroll.recordObservations, {
        customerId,
        observationsJson: JSON.stringify([post]),
        now: NOW + day * DAY,
      });
      expect(res.written).toBe(day === 0 ? 1 : 0);
      expect(res.alreadyKnown).toBe(day === 0 ? 0 : 1);
    }

    const rows = await t.run((ctx) => ctx.db.query("observations").collect());
    expect(rows).toHaveLength(1);
  });

  it("VELOCITY IS NOT OVERWRITTEN ON A RE-SIGHTING", async () => {
    // The row records what made it worth noticing THEN. Overwriting loses the
    // history that makes a second sighting interesting at all.
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    const url = "https://tiktok.com/@a/video/1";

    await t.mutation(internal.maya.scroll.recordObservations, {
      customerId,
      observationsJson: JSON.stringify([obs({ sourceUrl: url, velocity: 900 })]),
      now: NOW,
    });
    await t.mutation(internal.maya.scroll.recordObservations, {
      customerId,
      observationsJson: JSON.stringify([obs({ sourceUrl: url, velocity: 3 })]),
      now: NOW + DAY,
    });

    const rows = (await t.run((ctx) =>
      ctx.db.query("observations").collect()
    )) as Doc<"observations">[];
    expect(rows[0].velocity).toBe(900);
  });

  it("different posts are different rows", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    await t.mutation(internal.maya.scroll.recordObservations, {
      customerId,
      observationsJson: JSON.stringify([
        obs({ sourceUrl: "https://tiktok.com/@a/video/1" }),
        obs({ sourceUrl: "https://tiktok.com/@b/video/2" }),
      ]),
      now: NOW,
    });
    const rows = await t.run((ctx) => ctx.db.query("observations").collect());
    expect(rows).toHaveLength(2);
  });

  it("an observation with no URL is skipped, not stored unkeyed", async () => {
    // Without a sourceUrl there's no dedupe key and no receipt — it would
    // duplicate forever and couldn't be checked.
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    const res = await t.mutation(internal.maya.scroll.recordObservations, {
      customerId,
      observationsJson: JSON.stringify([obs({ sourceUrl: "" })]),
      now: NOW,
    });
    expect(res.written).toBe(0);
    expect(await t.run((ctx) => ctx.db.query("observations").collect())).toEqual([]);
  });

  it("OBSERVATIONS ARE PER-CUSTOMER", async () => {
    // Two founders can be watching the same niche. The same URL must be a row
    // for each, or the second one silently sees nothing.
    const t = convexTest(schema, modules);
    const mine = await seed(t);
    const theirs = await t.run(async (ctx) => {
      const accountId = await ctx.db.insert("creators", {
        clerkUserId: "u_other",
        email: "other@example.com",
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

    const shared = obs({ sourceUrl: "https://tiktok.com/@a/video/1" });
    for (const customerId of [mine, theirs]) {
      const res = await t.mutation(internal.maya.scroll.recordObservations, {
        customerId,
        observationsJson: JSON.stringify([shared]),
        now: NOW,
      });
      expect(res.written).toBe(1);
    }

    const forMine = await t.query(internal.maya.scroll.recentObservations, {
      customerId: mine,
    });
    expect(forMine).toHaveLength(1);
  });
});

describe("WHAT SHE'S SEEN LATELY", () => {
  it("returns newest first and honours `since`", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    for (const day of [0, 1, 2]) {
      await t.mutation(internal.maya.scroll.recordObservations, {
        customerId,
        observationsJson: JSON.stringify([
          obs({ sourceUrl: `https://tiktok.com/@a/video/${day}` }),
        ]),
        now: NOW + day * DAY,
      });
    }

    const all = await t.query(internal.maya.scroll.recentObservations, {
      customerId,
    });
    expect(all).toHaveLength(3);
    expect(all[0].capturedAt).toBeGreaterThan(all[2].capturedAt);

    const recent = await t.query(internal.maya.scroll.recentObservations, {
      customerId,
      since: NOW + 2 * DAY,
    });
    expect(recent).toHaveLength(1);
  });
});

describe("THE SHAPE OF A SCROLL", () => {
  it("a scroll is a readable handful, not a firehose", () => {
    // She reads these. Twenty ranked observations is a scroll; two hundred is
    // a database dump nobody acts on.
    expect(OBSERVATIONS_RETURNED).toBeLessThanOrEqual(30);
    expect(OBSERVATIONS_RETURNED).toBeGreaterThanOrEqual(10);
  });

  it("the news window is days, not months", () => {
    // §5.1's freshness rule. A month-old post is not what's moving now,
    // whatever its numbers.
    expect(NEWS_WINDOW_MS).toBeLessThanOrEqual(30 * DAY);
  });
});
