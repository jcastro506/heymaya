/**
 * Sprint 4e: one rule in one place. Connected wins and is labelled; stale falls back and
 * says so; TikTok's missing retention is said, not guessed; and a TikTok number with a
 * retention figure in one claim is a category error the check catches.
 */
import { describe, expect, it } from "vitest";
import type { Doc } from "../../_generated/dataModel";
import { DIAGNOSIS_WORDS, numbersFor, STALE_AFTER_MS } from "../numbers";
import { runChecks } from "../../eval/checks";

const NOW = Date.UTC(2026, 8, 6, 12, 0);
const post = (over: Partial<Doc<"ownPosts">> & { connected?: Doc<"ownPosts">["connected"] }): Doc<"ownPosts"> => ({
  _id: "p1" as never, _creationTime: 0, creatorId: "c1" as never, platform: "instagram", postId: "X", url: "https://www.instagram.com/p/X/",
  createTime: NOW - 3 * 86_400_000, contentType: "video", caption: "", hashtags: [], metrics: { views: 9_000, likes: 300, comments: 20, shares: 40 },
  metricsAsOf: NOW - 3_600_000, source: "zernio", multiple: 1.2, ...over,
} as Doc<"ownPosts">);
const fresh = { asOf: NOW - 3_600_000, syncStatus: "synced", views: 10_000, likes: 300, comments: 20, shares: 40, saves: 50, impressions: 12_000, reach: 8_000, clicks: 0, follows: 4, avgWatchMs: 21_000, totalWatchMs: 400_000, skipRatePct: 20, durationSec: 30 };
const siblings = [1000, 2000, 3000].map((reach, i) => post({ _id: `s${i}` as never, postId: `S${i}`, connected: { ...fresh, reach, impressions: reach, avgWatchMs: null, totalWatchMs: null, skipRatePct: null, durationSec: null } }));

describe("numbersFor", () => {
  it("leads with reach when connected and fresh, labels it, and carries the reach multiple", () => {
    const n = numbersFor(post({ connected: fresh, reachMultiple: 4 }), siblings, NOW);
    expect(n.headline).toMatchObject({ what: "reach", value: 8_000, basis: "connected", asOfHours: 1 });
    expect(n.multiple).toEqual({ value: 4, basis: "reach" });
    expect(n.lines.join(" ")).toMatch(/reached 8,000 people \(connected/);
    expect(n.lines.join(" ")).toMatch(/watched 70%/);
    expect(n.lines.join(" ")).toMatch(/20% left in the first 3 seconds/);
    expect(n.lines.join(" "), "the public count is still there, labelled").toMatch(/9,000 views \(public count/);
    expect(n.derived?.diagnosis).toBe("held_them");
    expect(n.cannotKnow).toHaveLength(0);
  });

  it("falls back to the public count and says so when the connected read is stale", () => {
    const n = numbersFor(post({ connected: { ...fresh, asOf: NOW - STALE_AFTER_MS - 3_600_000 }, reachMultiple: 4 }), siblings, NOW);
    expect(n.headline).toMatchObject({ what: "views", value: 9_000, basis: "public" });
    expect(n.multiple).toEqual({ value: 1.2, basis: "views" });
    expect(n.lines[0]).toMatch(/connected numbers are 49h old; judging on the public count/);
    expect(n.derived).toBeNull();
  });

  it("on TikTok it says what cannot be known instead of guessing", () => {
    const n = numbersFor(post({ platform: "tiktok", connected: { ...fresh, avgWatchMs: null, totalWatchMs: null, skipRatePct: null, durationSec: null, follows: null } }), siblings, NOW);
    expect(n.cannotKnow.join(" ")).toMatch(/TikTok does not expose/);
    expect(n.lines.join(" ")).not.toMatch(/watched/);
  });

  it("with no connection at all, only the public count, and it says why", () => {
    const n = numbersFor(post({ source: "scrape" }), [], NOW);
    expect(n.headline.basis).toBe("public");
    expect(n.cannotKnow.join(" ")).toMatch(/no account connected/);
    expect(DIAGNOSIS_WORDS.unknown).toMatch(/only the public count/);
  });
});

describe("the mixed-basis check", () => {
  const run = (text: string) => runChecks({ text, evidence: {}, kind: "explain" } as never).find((c) => c.name === "mixed_basis");
  it("fails a TikTok number next to a retention figure with no cross-post named", () => {
    expect(run("your tiktok did 12k views and 61% left in the first 3 seconds")?.pass).toBe(false);
  });
  it("passes retention on its own platform, and passes a transfer that names the same video", () => {
    expect(run("the reel held them: they watched 70% of it")?.pass).toBe(true);
    expect(run("on the reel of the same video 61% left in the first 3 seconds, so the tiktok has the same problem")?.pass).toBe(true);
  });
  it("is silent when no retention is claimed", () => {
    expect(run("your tiktok did 12k views, 3x your normal")).toBeUndefined();
  });
});
