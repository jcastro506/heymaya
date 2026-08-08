/**
 * The read-back that never existed.
 *
 * §13.5's evening recap promises "what went live, with links, and what came
 * back". `dailyReport` reads `metricsJson` to build that second half — and
 * nothing ever wrote it, so the recap has been half-empty since Sprint 2 and
 * every morning's idea pick has been blind.
 */

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import {
  tweetIdFromUrl,
  canonicalUrl,
  REFRESH_WINDOW_MS,
  BATCH_SIZE,
} from "../metrics";
import type { Doc, Id } from "../../_generated/dataModel";

const NOW = Date.UTC(2026, 7, 5, 14, 0, 0);
const DAY = 86_400_000;

describe("⭐ THE ID COMES FROM THE URL WE ALREADY HAVE", () => {
  it("reads both hosts — Zernio writes one, the app writes the other", () => {
    // Zernio returns twitter.com/i/web/status/…; the app and twitterapi.io use
    // x.com/<handle>/status/…. Both are real and both must resolve.
    expect(tweetIdFromUrl("https://twitter.com/i/web/status/2084980380495405156"))
      .toBe("2084980380495405156");
    expect(tweetIdFromUrl("https://x.com/shivamexi/status/2084994652990742563"))
      .toBe("2084994652990742563");
  });

  it("⭐ WORKS ON PLACEMENTS THAT ALREADY EXIST", () => {
    // The reason this is derived rather than stored in a new column: a new
    // field is only ever populated going forward, so the first thing the
    // feature would do is fail to explain the posts the founder can see.
    const existing = "https://twitter.com/i/web/status/2084785607121715542";
    expect(tweetIdFromUrl(existing)).toBe("2084785607121715542");
  });

  it("a non-X or malformed url yields null rather than a guess", () => {
    expect(tweetIdFromUrl("https://www.tiktok.com/@a/video/7653138621985230102")).toBeNull();
    expect(tweetIdFromUrl("https://x.com/someone")).toBeNull();
    expect(tweetIdFromUrl(undefined)).toBeNull();
  });
});

describe("⭐ WHAT GETS REFRESHED, AND WHAT DOESN'T", () => {
  it("⭐ ONLY X — a confident zero on TikTok would be a lie", () => {
    // Nothing here can read TikTok, Instagram or YouTube numbers. Writing a 0
    // is worse than an honest gap, because a zero looks measured.
    return withSeed(async (t, customerId) => {
      await placement(t, customerId, { channel: "tiktok" });
      await placement(t, customerId, { channel: "x" });
      const due = await t.query(internal.maya.metrics.dueForRefresh, {
        customerId,
        now: NOW,
      });
      expect(due).toHaveLength(1);
      expect(due[0].channel).toBe("x");
    });
  });

  it("a post older than the window stops being refreshed", () =>
    // A tweet's numbers move for a few days then stop. Re-reading a month of
    // history every night pays repeatedly for the same answer.
    withSeed(async (t, customerId) => {
      await placement(t, customerId, { publishedAt: NOW - REFRESH_WINDOW_MS - DAY });
      const due = await t.query(internal.maya.metrics.dueForRefresh, {
        customerId,
        now: NOW,
      });
      expect(due).toHaveLength(0);
    }));

  it("an unconfirmed placement is not refreshed", () =>
    withSeed(async (t, customerId) => {
      await placement(t, customerId, { linkStatus: "unknown" });
      expect(
        await t.query(internal.maya.metrics.dueForRefresh, { customerId, now: NOW })
      ).toHaveLength(0);
    }));

  it("the batch size is real — the endpoint takes a list", () => {
    // Verified live: tweet_ids is comma-separated, so refreshing 30 placements
    // is one request rather than 30.
    expect(BATCH_SIZE).toBeGreaterThan(1);
  });
});

describe("⭐ THE SAME POST, SPELLED TWO WAYS", () => {
  it("⭐ TRACKING PARAMS DON'T MAKE IT A DIFFERENT POST", () => {
    /**
     * Found against a real placement. TikTok's ANALYTICS payload returns the
     * URL with tracking params attached, while `/posts/{id}` returns it bare:
     *
     *   analytics  .../video/7670709537535544590?utm_campaign=tt4d_open_api&...
     *   post       .../video/7670709537535544590
     *
     * Exact-string matching found nothing, so a post sitting at 38 views
     * showed no metrics at all — and silently, because "no match" and "no
     * numbers yet" are the same empty result.
     */
    const bare = "https://www.tiktok.com/@kevin.castro9996/video/7670709537535544590";
    const tagged = `${bare}?utm_campaign=tt4d_open_api&utm_source=aw4smjxfftapkprm`;
    expect(canonicalUrl(tagged)).toBe(canonicalUrl(bare));
  });

  it("a trailing slash and casing don't either", () => {
    expect(canonicalUrl("https://X.com/a/status/1/")).toBe(
      canonicalUrl("https://x.com/a/status/1")
    );
  });

  it("⭐ BUT TWO GENUINELY DIFFERENT POSTS STAY DIFFERENT", () => {
    // The failure that would matter more: collapsing distinct posts onto one
    // placement, so one post's numbers get written over another's.
    expect(canonicalUrl("https://x.com/a/status/1")).not.toBe(
      canonicalUrl("https://x.com/a/status/2")
    );
  });
});

describe("⭐ THE OTHER THREE CHANNELS COME FROM ZERNIO", () => {
  it("X is excluded from that path on purpose", () =>
    // `xCapabilities.analytics` is false on the X account — X is billed
    // pass-through, and §2.15.17 leaves it off at 33× twitterapi.io's price.
    // So the two paths are complementary, not redundant, and an X placement
    // must not be picked up here.
    withSeed(async (t, customerId) => {
      await placement(t, customerId, { channel: "x" });
      await placement(t, customerId, { channel: "tiktok" });
      const due = await t.query(internal.maya.metrics.awaitingMetrics, {
        customerId,
        now: NOW,
      });
      expect(due).toHaveLength(1);
      expect(due[0].channel).toBe("tiktok");
    }));

  it("a placement with no link is not eligible — there is nothing to match on", () =>
    withSeed(async (t, customerId) => {
      await placement(t, customerId, { channel: "tiktok", linkStatus: "unknown" });
      expect(
        await t.query(internal.maya.metrics.awaitingMetrics, { customerId, now: NOW })
      ).toHaveLength(0);
    }));
});

describe("⭐ A NUMBER WITHOUT A DATE IS HOW DASHBOARDS START LYING", () => {
  it("metricsAsOf is stamped with every write", () =>
    withSeed(async (t, customerId) => {
      const id = await placement(t, customerId, {});
      await t.mutation(internal.maya.metrics.recordMetrics, {
        placementId: id,
        metricsJson: JSON.stringify({ likes: 0, replies: 1, views: 1 }),
        now: NOW,
      });
      const row = (await t.run((ctx) => ctx.db.get(id))) as Doc<"placements">;
      expect(row.metricsAsOf).toBe(NOW);
      expect(JSON.parse(row.metricsJson!).replies).toBe(1);
    }));

  it("⭐ A REAL ZERO IS RECORDED, NOT SKIPPED", () =>
    // One view is a finding — arguably the most useful one there is. The recap
    // has to be able to say it plainly rather than going quiet.
    withSeed(async (t, customerId) => {
      const id = await placement(t, customerId, {});
      await t.mutation(internal.maya.metrics.recordMetrics, {
        placementId: id,
        metricsJson: JSON.stringify({ likes: 0, replies: 0, views: 1 }),
        now: NOW,
      });
      const row = (await t.run((ctx) => ctx.db.get(id))) as Doc<"placements">;
      expect(JSON.parse(row.metricsJson!)).toEqual({ likes: 0, replies: 0, views: 1 });
    }));

  it("no key is a named failure, not an empty result", () =>
    withSeed(async (t, customerId) => {
      await placement(t, customerId, {});
      const prev = process.env.TWITTERAPI_IO_KEY;
      delete process.env.TWITTERAPI_IO_KEY;
      try {
        const r = await t.action(internal.maya.metrics.refresh, { customerId, now: NOW });
        expect(r.ok).toBe(false);
        // Plain language — no vendor name reaches the founder.
        expect(r.detail).not.toMatch(/twitterapi|zernio/i);
      } finally {
        if (prev !== undefined) process.env.TWITTERAPI_IO_KEY = prev;
      }
    }));
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
  over: { channel?: string; publishedAt?: number; linkStatus?: "live" | "unknown" }
): Promise<Id<"placements">> {
  const id = `${Math.floor(Math.random() * 1e18)}`;
  return await t.run(async (ctx) =>
    ctx.db.insert("placements", {
      customerId,
      kind: "post",
      channel: over.channel ?? "x",
      url:
        (over.channel ?? "x") === "x"
          ? `https://twitter.com/i/web/status/${id}`
          : `https://www.tiktok.com/@a/video/${id}`,
      linkStatus: over.linkStatus ?? "live",
      publishedAt: over.publishedAt ?? NOW - DAY,
      snapshotText: "something",
      idempotencyKey: `k-${id}`,
    })
  );
}

async function seed(t: ReturnType<typeof convexTest>): Promise<Id<"customers">> {
  return await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("creators", {
      clerkUserId: "u_metrics",
      email: "metrics@example.com",
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

/**
 * ⭐ A DELETED POST MUST STOP COUNTING.
 *
 * `linkStatus: "gone"` was a value **nothing in `convex/maya` ever wrote** —
 * only the frozen v1 did. Found 2026-08-07 by sweeping for terminal states with
 * no writer, after the same shape had already cost a stalled day (#291,
 * published drafts stuck `pending`) and four duplicate posts (#295, banked
 * ideas stuck `bank`).
 *
 * ⚠️ This one corrupts the gate the whole plan hangs on. `cadence.ts` counts
 * only `live` and says so itself: a dead link *"counts as having happened and
 * then stopped being true, which the streak should notice rather than paper
 * over."* It could not notice. Delete a post and it still counted toward the
 * seven days, permanently.
 */
describe("a post that was taken down stops counting", () => {
  it("markGone flips a live placement", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "gone_one");
    const placementId = await t.run((ctx) =>
      ctx.db.insert("placements", {
        customerId,
        kind: "post",
        channel: "x",
        linkStatus: "live",
        url: "https://x.com/w/status/1",
        publishedAt: NOW,
        snapshotText: "a post that will be deleted",
        idempotencyKey: "g1",
      })
    );

    const res = await t.mutation(internal.maya.metrics.markGone, {
      placementId,
      now: NOW,
    });
    expect(res.marked).toBe(true);
    const row = (await t.run((ctx) => ctx.db.get(placementId))) as {
      linkStatus: string;
    };
    expect(row.linkStatus).toBe("gone");
  });

  it("never resurrects — a flapping API can't toggle the streak", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "gone_twice");
    const placementId = await t.run((ctx) =>
      ctx.db.insert("placements", {
        customerId,
        kind: "post",
        channel: "x",
        linkStatus: "gone",
        publishedAt: NOW,
        snapshotText: "already gone",
        idempotencyKey: "g2",
      })
    );
    const res = await t.mutation(internal.maya.metrics.markGone, {
      placementId,
      now: NOW,
    });
    expect(res.marked).toBe(false);
  });

  it("⭐ and the streak drops when it happens", async () => {
    // The whole reason this matters: Sprint 3's exit criterion is derived from
    // live placements, so a deleted post must move the number.
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "gone_streak");
    const placementId = await t.run((ctx) =>
      ctx.db.insert("placements", {
        customerId,
        kind: "post",
        channel: "x",
        linkStatus: "live",
        publishedAt: NOW,
        snapshotText: "the only post of the day",
        idempotencyKey: "g3",
      })
    );

    const before = await t.query(internal.maya.cadence.cadence, {
      customerId,
      now: NOW,
    });
    expect(before.todayDone).toBe(true);

    await t.mutation(internal.maya.metrics.markGone, { placementId, now: NOW });

    const after = await t.query(internal.maya.cadence.cadence, {
      customerId,
      now: NOW,
    });
    expect(after.todayDone).toBe(false);
  });
});
