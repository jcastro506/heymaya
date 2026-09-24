/**
 * Sprint 4e, the pure half, against the REAL recorded responses (2026-09-05, the throwaway
 * profile with one TikTok and one Instagram). The zero-means-unavailable convention is the
 * thing that would bite first, so it is the first thing asserted.
 */
import { describe, expect, it } from "vitest";
import recorded from "../../integrations/zernio/fixtures.recorded.json";
import { citeable, derive, EXPOSES, normalizeConnected, postIdFromUrl, type Connected, type ZernioPostRow } from "../analytics";

const R = recorded as unknown as Record<string, { posts?: ZernioPostRow[] }>;
const igKey = Object.keys(R).find((k) => k.includes("6a9c9de477555aae01e25d5b"))!;
const ttKey = Object.keys(R).find((k) => k.includes("6a9c9dd377555aae01e25d16"))!;
const igPost = R[igKey].posts![0];
const ttPost = R[ttKey].posts![0];

describe("normalizing the recorded rows", () => {
  it("instagram: reach and impressions come through; Reels retention is null on a non-video", () => {
    const c = normalizeConnected(igPost)!;
    expect(c.platform).toBe("instagram");
    expect(c.postId, "the shortcode from the platform url, not Zernio's id").toBe("DbrZ8lIlxma");
    expect(c.reach).toBe(3);
    expect(c.impressions).toBe(3);
    expect(c.views).toBe(3);
    expect(c.asOf).toBeTypeOf("number");
    expect(c.publishedAt).toBeTypeOf("number");
    // videoDurationSeconds was null on the recording: no duration, no retention, whatever the raw zeros say.
    expect(c.avgWatchMs).toBeNull();
    expect(c.skipRatePct).toBeNull();
    expect(c.durationSec).toBeNull();
  });

  it("tiktok: views come through; the raw zeros on reach, impressions and every Reels field become null", () => {
    const c = normalizeConnected(ttPost)!;
    expect(c.platform).toBe("tiktok");
    expect(c.postId).toBe("7670709537535544590");
    expect(c.views).toBe(107);
    expect(c.likes).toBe(1);
    expect(c.shares).toBe(1);
    // 107 views and reach 0 is a sync gap, not an audience of nobody.
    expect(c.reach, "0 while views > 0 is not zero").toBeNull();
    expect(c.impressions).toBeNull();
    // TikTok never exposes these; null by construction, not by value.
    expect(c.avgWatchMs).toBeNull();
    expect(c.totalWatchMs).toBeNull();
    expect(c.skipRatePct).toBeNull();
    expect(c.follows).toBeNull();
    expect(EXPOSES.tiktok.has("avgWatchMs")).toBe(false);
  });

  it("an unknown platform is refused, and a native id is parsed from either platform's url", () => {
    expect(normalizeConnected({ ...igPost, platform: "linkedin" })).toBeNull();
    expect(postIdFromUrl("https://www.tiktok.com/@a/video/123?x=1")).toBe("123");
    expect(postIdFromUrl("https://www.instagram.com/reel/AbC_d-1/")).toBe("AbC_d-1");
    expect(postIdFromUrl("https://example.com")).toBeNull();
  });

  it("a genuine zero on a metric the platform exposes is kept when there are no views to contradict it", () => {
    // The per-platform block wins over the top-level one, so override both.
    const zeros = { ...igPost.analytics, views: 0, reach: 0, impressions: 0, likes: 0 };
    const c = normalizeConnected({ ...igPost, analytics: zeros, platforms: igPost.platforms?.map((x) => ({ ...x, analytics: zeros })) })!;
    expect(c.reach).toBe(0);
    expect(c.views).toBe(0);
  });
});

describe("the four-way read", () => {
  const base: Connected = { platform: "instagram", postId: "x", url: null, publishedAt: null, asOf: null, syncStatus: "synced", views: 10_000, likes: 200, comments: 20, shares: 30, saves: 50, impressions: 12_000, reach: 8_000, clicks: 0, follows: null, avgWatchMs: null, totalWatchMs: null, skipRatePct: null, durationSec: null };

  it("not distributed: reach far under their normal", () => {
    const d = derive({ ...base, reach: 800 }, { reach: 8_000, engagementPerReach: 0.03 });
    expect(d.diagnosis).toBe("not_distributed");
    expect(d.basis).toBe("reach");
    expect(d.reachMultiple).toBe(0.1);
  });

  it("distributed but scrolled: normal reach, almost nobody did anything", () => {
    const d = derive({ ...base, likes: 5, comments: 0, shares: 0, saves: 0 }, { reach: 8_000, engagementPerReach: 0.03 });
    expect(d.diagnosis).toBe("distributed_scrolled");
    expect(d.engagementPerReach).toBeLessThan(0.01);
  });

  it("retention outranks reach when it exists: hook lost them, or held them", () => {
    const lost = derive({ ...base, durationSec: 30, avgWatchMs: 4_000, skipRatePct: 62 }, { reach: 8_000, engagementPerReach: 0.03 });
    expect(lost.diagnosis).toBe("hook_lost_them");
    expect(lost.basis).toBe("retention");
    const held = derive({ ...base, durationSec: 30, avgWatchMs: 21_000, skipRatePct: 20 }, { reach: 8_000, engagementPerReach: 0.03 });
    expect(held.diagnosis).toBe("held_them");
    expect(held.retention).toBe(0.7);
  });

  it("with nothing but views, no diagnosis is invented", () => {
    const d = derive({ ...base, reach: null, impressions: null }, { reach: null, engagementPerReach: null });
    expect(d.diagnosis).toBe("unknown");
    expect(d.basis).toBe("views");
    expect(d.distribution).toBeNull();
  });

  it("every citeable line carries its basis, and a TikTok row cites no retention", () => {
    const ig = citeable({ ...base, durationSec: 30, avgWatchMs: 21_000, skipRatePct: 20 });
    expect(ig.map((x) => x.line)).toEqual(expect.arrayContaining([expect.stringMatching(/reached 8,000 people/), expect.stringMatching(/watched 70%/), expect.stringMatching(/Meta's estimate/)]));
    expect(ig.every((x) => x.basis === "connected")).toBe(true);
    const tt = citeable(normalizeConnected(ttPost)!);
    expect(tt).toHaveLength(0);
  });
});

describe("the accounts call", () => {
  it("sends page and limit together — limit alone is a 400 on the live API", async () => {
    const { listAccounts } = await import("../../integrations/zernio/index");
    let seen: Record<string, unknown> | undefined;
    const client = { request: async (_p: string, opts?: { query?: Record<string, unknown> }) => { seen = opts?.query; return { accounts: [] }; } } as never;
    await listAccounts(client, "prof");
    expect(seen).toMatchObject({ profileId: "prof", page: 1, limit: 50 });
  });
});
