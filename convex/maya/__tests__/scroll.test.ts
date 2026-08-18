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
import {
  NEWS_WINDOW_MS,
  OBSERVATIONS_RETURNED,
  KEYWORDS_PER_SCROLL,
  MAX_SEARCHES_PER_SCROLL,
  SCROLLABLE_CHANNELS,
  interleave,
  normalizeInstagramReels,
  normalizeYouTubeVideos,
  normalizeXSearch,
  type Observation,
  epochMs,
  instagramDropReasons,
} from "../scroll";
import { rawResult } from "../../integrations/scrapeCreators/deps";
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

/**
 * ⭐ Multi-channel (Sprint 5, §5.2 sweep 2).
 *
 * The shapes below were read off LIVE responses on 2026-08-05, not from docs —
 * which is how `create_time`-in-seconds got in and made every post look fifty
 * years old.
 */
describe("⭐ THE CHANNELS DON'T REPORT THE SAME THINGS", () => {
  it("⭐ NOTHING SORTS ACROSS CHANNELS — it interleaves", () => {
    // `velocity()` scores likes + 3×comments and ignores views, on purpose.
    // YouTube search returns NEITHER likes nor comments, so every YouTube row
    // scores 0 on that scale and a global sort buries the channel forever —
    // we'd pay for credits that can never surface anything.
    //
    // YouTube is therefore scored on views ÷ age, which is an order of
    // magnitude larger. Sorting THAT globally would bury the other two. There
    // is no single scale; interleaving is the only honest merge.
    const tiktok = [ranked("tiktok", 100), ranked("tiktok", 90), ranked("tiktok", 80)];
    const youtube = [ranked("youtube", 5000), ranked("youtube", 4000)];
    const merged = interleave([tiktok, youtube], 4);
    expect(merged.map((o) => o.channel)).toEqual([
      "tiktok",
      "youtube",
      "tiktok",
      "youtube",
    ]);
  });

  it("a channel with fewer results doesn't hold up the rest", () => {
    const many = [ranked("tiktok", 9), ranked("tiktok", 8), ranked("tiktok", 7)];
    const one = [ranked("instagram", 5)];
    const merged = interleave([many, one], 10);
    expect(merged).toHaveLength(4);
    expect(merged.filter((o) => o.channel === "instagram")).toHaveLength(1);
  });

  it("each list is still ranked internally before interleaving", () => {
    const unsorted = [ranked("tiktok", 1), ranked("tiktok", 99), ranked("tiktok", 50)];
    const merged = interleave([unsorted], 3);
    expect(merged.map((o) => o.velocity)).toEqual([99, 50, 1]);
  });

  it("the search cap is real — keywords × channels multiplies", () => {
    // This runs every morning for every customer forever. Without a ceiling a
    // third connected channel silently triples the daily bill.
    expect(MAX_SEARCHES_PER_SCROLL).toBeLessThanOrEqual(
      KEYWORDS_PER_SCROLL * SCROLLABLE_CHANNELS.length
    );
    expect(MAX_SEARCHES_PER_SCROLL).toBeGreaterThanOrEqual(
      SCROLLABLE_CHANNELS.length
    );
  });

  it("⭐ THE VENDOR ENVELOPE FIELD IS `raw`, NOT `payload`", () => {
    // Pinned because guessing it wrong fails SILENTLY: `undefined?.reels ?? []`
    // is an empty list, so every morning would report "nothing new in the
    // niche today" and look exactly like a quiet niche. The readers destructure
    // this field, so a vendor-layer rename must break here rather than there.
    const shape = rawResult("instagram_reels_search", { query: "x" }, { reels: [] });
    expect(Object.keys(shape).sort()).toEqual(["query", "raw", "source"]);
    expect(shape).not.toHaveProperty("payload");
  });

  it("⭐ X IS SCROLLABLE — and was wrongly left out", () => {
    // An earlier pass excluded X believing its search wasn't wrapped.
    // `twitterApiIoSearch` has wrapped `advanced_search` all along; its only
    // callers were in frozen v1. Since X is the launch channel and often the
    // ONLY connected one, that omission mattered more than any of the rest.
    expect([...SCROLLABLE_CHANNELS].sort()).toEqual([
      "instagram",
      "tiktok",
      "x",
      "youtube",
    ]);
  });
});

/**
 * ⭐ Normalisation, against payloads CAPTURED FROM LIVE RESPONSES.
 *
 * Trimmed to the fields the readers touch, values untouched. Every one of
 * these was read off a real call on 2026-08-05 — the repo already paid once
 * for trusting a doc about `create_time`.
 */
describe("⭐ REAL VENDOR PAYLOADS", () => {
  const NOW_LIVE = Date.parse("2026-08-06T00:00:00.000Z");

  it("⭐ INSTAGRAM: ISO date, and PLAYS not VIEWS", () => {
    // Live sample carried BOTH counts, differing 5×: video_view_count 1191 vs
    // video_play_count 5850. Plays is what Instagram surfaces as "views" now.
    const out = normalizeInstagramReels(
      [
        {
          id: "3905780388681551190",
          shortcode: "DY0HpHeDQ1W",
          url: "https://www.instagram.com/reel/DY0HpHeDQ1W/",
          caption: "From SUNY Oswego to founder and CEO",
          taken_at: "2026-08-05T20:00:25.000Z",
          like_count: 89,
          comment_count: 1,
          video_view_count: 1191,
          video_play_count: 5850,
          owner: { username: "sunyoswego" },
        },
      ],
      "founder",
      NOW_LIVE
    );
    expect(out).toHaveLength(1);
    // ⚠️ ISO string, NOT unix seconds like TikTok. Feeding one to the other's
    // parser is the bug that made every post look fifty years old.
    expect(out[0].postedAt).toBe(Date.parse("2026-08-05T20:00:25.000Z"));
    expect(out[0].authorHandle).toBe("sunyoswego");
    expect(out[0].metrics).toEqual({ likes: 89, comments: 1, views: 5850 });
    expect(out[0].velocity).toBeGreaterThan(0);
  });

  it("⭐ YOUTUBE: no likes, no comments — zeroes are ABSENCES", () => {
    // The endpoint simply doesn't return them, which is why YouTube is scored
    // on views ÷ age and why nothing sorts across channels.
    const out = normalizeYouTubeVideos(
      [
        {
          id: "oWqwZ7hAFfs",
          url: "https://www.youtube.com/watch?v=oWqwZ7hAFfs",
          title: "Indie Founder Podcast Trailer",
          publishedTime: "2026-08-05T19:58:29.927Z",
          viewCountInt: 9,
          lengthSeconds: 81,
          channel: { handle: "indiefounderpodcast" },
        },
      ],
      "founder",
      NOW_LIVE
    );
    expect(out).toHaveLength(1);
    expect(out[0].metrics.likes).toBe(0);
    expect(out[0].metrics.comments).toBe(0);
    expect(out[0].metrics.views).toBe(9);
    // The TITLE is the text — YouTube search returns no caption.
    expect(out[0].text).toBe("Indie Founder Podcast Trailer");
    expect(out[0].authorHandle).toBe("indiefounderpodcast");
    // Scored on views ÷ age, so it is NOT zero the way likes+comments would be.
    expect(out[0].velocity).toBeGreaterThan(0);
  });

  it("⭐ A YOUTUBE SHORT WOULD HAVE NO DATE AT ALL", () => {
    // The live response carried MORE shorts than videos (25 vs 18), and a
    // short comes back with only {id, title, type, url, viewCountInt,
    // viewCountText} — no date. It cannot answer "what's moving today", so
    // shorts are not read. If one ever leaks into `videos`, it drops out here
    // rather than being ranked on an invented recency.
    const out = normalizeYouTubeVideos(
      [
        {
          id: "-RjCl_uYSmw",
          title: "What are indie hackers?",
          type: "short",
          url: "https://www.youtube.com/watch?v=-RjCl_uYSmw",
          viewCountInt: 4900,
        },
      ],
      "founder",
      NOW_LIVE
    );
    expect(out).toHaveLength(0);
  });

  it("⭐ X: the shape the WRAPPER returns, not the raw tweet", () => {
    /**
     * The bug this pins. `twitterApiIoSearch` normalises tweets into a
     * `ResearchRawItem` before returning them — `excerpt` not `text`, `author`
     * a plain string, `createdAtMs` already in milliseconds, metrics under
     * `engagement`. Written against the RAW tweet shape it returned zero every
     * time, which reads exactly like "X was quiet today".
     *
     * Second shape-assumption in this file after `payload`/`raw`. Both failed
     * silently; both were found by RUNNING it, not reading it.
     */
    const out = normalizeXSearch(
      [
        {
          platform: "twitter",
          externalId: "2084994652990742563",
          url: "https://x.com/shivamexi/status/2084994652990742563",
          title: null,
          excerpt: "I'd lean the same way. High-quality realistic beats a logo",
          author: "shivamexi",
          createdAtMs: Date.UTC(2026, 7, 5, 13, 27, 17),
          engagement: {
            likes: 1,
            comments: 1,
            shares: 0,
            views: 8,
            upvotes: null,
            downvotes: null,
          },
        },
      ],
      "founder",
      Date.parse("2026-08-06T00:00:00.000Z")
    );
    expect(out).toHaveLength(1);
    expect(out[0].channel).toBe("x");
    expect(out[0].authorHandle).toBe("shivamexi");
    expect(out[0].text).toMatch(/lean the same way/);
    // Already milliseconds — X is the one channel needing no date parsing.
    expect(out[0].postedAt).toBe(Date.UTC(2026, 7, 5, 13, 27, 17));
    // Replies ARE the comments on X, weighed 3× by velocity.
    expect(out[0].metrics).toEqual({ likes: 1, comments: 1, views: 8 });
    expect(out[0].velocity).toBeGreaterThan(0);
  });

  it("⭐ THE RAW TWEET SHAPE YIELDS NOTHING — which is the point", () => {
    // If the wrapper ever stops normalising, this must fail loudly here rather
    // than silently reporting a quiet channel every morning.
    const out = normalizeXSearch(
      [
        {
          id: "1",
          text: "hello",
          createdAt: "Wed Aug 05 13:27:17 +0000 2026",
          likeCount: 5,
          author: { userName: "someone" },
        },
      ],
      "k",
      Date.parse("2026-08-06T00:00:00.000Z")
    );
    expect(out).toHaveLength(0);
  });

  it("anything older than the news window drops out", () => {
    const out = normalizeInstagramReels(
      [
        {
          id: "old",
          url: "https://www.instagram.com/reel/old/",
          caption: "last month",
          taken_at: new Date(NOW_LIVE - NEWS_WINDOW_MS - 86_400_000).toISOString(),
          like_count: 9999,
          comment_count: 9999,
          owner: { username: "someone" },
        },
      ],
      "founder",
      NOW_LIVE
    );
    expect(out).toHaveLength(0);
  });

  it("a malformed date is dropped, never treated as now", () => {
    // A NaN timestamp sorts unpredictably and would put junk at the top of
    // what she reads first thing in the morning.
    const out = normalizeInstagramReels(
      [{ id: "x", url: "u", caption: "c", taken_at: "not a date", owner: {} }],
      "founder",
      NOW_LIVE
    );
    expect(out).toHaveLength(0);
  });
});

function ranked(channel: string, velocity: number) {
  return {
    channel,
    sourceUrl: `https://example.com/${channel}/${velocity}`,
    authorHandle: null,
    text: "something",
    postedAt: Date.UTC(2026, 7, 5),
    metrics: { likes: 0, comments: 0, views: 0 },
    velocity,
    keyword: "k",
  };
}

describe("a timestamp, whatever shape the vendor sends", () => {
  /**
   * ⚠️ THE PRIME SUSPECT FOR INSTAGRAM'S SILENCE. `normalizeInstagramReels`
   * required `typeof taken_at === "string"`. Instagram APIs classically send
   * `taken_at` as a Unix INTEGER — every reel would fail the type test, yield
   * NaN, and be skipped. Result: zero observations, no exception, ok:true, for
   * as long as nobody counted rows per channel.
   *
   * The codebase already proved shapes differ per platform: `normalizeXSearch`
   * reads a NUMBER, `normalizeYouTube` reads a STRING. Instagram accepting only
   * one of the two was the outlier, not the rule.
   */
  it("⭐ accepts Unix seconds — the shape that was being dropped", () => {
    expect(epochMs(1787000000)).toBe(1787000000_000);
  });

  it("⭐ accepts milliseconds unchanged", () => {
    expect(epochMs(1787000000000)).toBe(1787000000000);
  });

  it("⭐ still accepts an ISO string", () => {
    expect(epochMs("2026-08-18T00:00:00.000Z")).toBe(
      Date.parse("2026-08-18T00:00:00.000Z")
    );
  });

  it("⭐ accepts a numeric string, which JSON APIs send for big ints", () => {
    expect(epochMs("1787000000")).toBe(1787000000_000);
  });

  it("⚠️ seconds vs ms is decided by magnitude, not by trust", () => {
    // 1e12 ms is 2001, and no reel predates Instagram — so anything smaller is
    // seconds. Guessing wrong by 1000x puts every post outside the 14-day
    // window, which drops them just as silently as a NaN did.
    expect(epochMs(999_999_999_999)).toBe(999_999_999_999 * 1000);
    expect(epochMs(1_000_000_000_000)).toBe(1_000_000_000_000);
  });

  it("⚠️ returns null rather than a plausible-looking wrong date", () => {
    for (const bad of [undefined, null, "", "not a date", {}, []]) {
      expect(epochMs(bad)).toBeNull();
    }
  });
});

describe("Instagram: nothing returned vs everything dropped", () => {
  /**
   * ⚠️ `found: 0` conflated two failures needing opposite fixes — the API
   * returned nothing, and the API returned reels of which we dropped every one.
   * Indistinguishable, which is how Instagram sat at ZERO while TikTok had 50.
   */
  it("⭐ counts what arrived, not just what survived", () => {
    const now = Date.UTC(2026, 7, 18);
    const reels = [
      { taken_at: Math.floor(now / 1000) - 86_400, caption: "fresh", owner: { username: "a" } },
      { taken_at: Math.floor(now / 1000) - 60 * 86_400, caption: "stale", owner: { username: "b" } },
      { taken_at: "gibberish", caption: "broken", owner: { username: "c" } },
    ];
    const out = normalizeInstagramReels(reels as never, "kw", now);
    expect(out).toHaveLength(1);
    expect(instagramDropReasons.received).toBe(3);
    expect(instagramDropReasons.tooOld).toBe(1);
    expect(instagramDropReasons.unparseableDate).toBe(1);
  });
});
