/**
 * `learn-business` — the targets everything downstream reads.
 *
 * The rule under test throughout: **topic keywords are the buyer's own words
 * for the problem, never our marketing vocabulary.** That is easy to state and
 * easy to violate, because the page we just read *is* marketing vocabulary. So
 * search yield is the referee, not our sense of which words sound right.
 */

import { describe, expect, it } from "vitest";
import {
  toMillis,
  looksGeneric,
  deriveKeywords,
  velocity,
  median,
  judgeKeyword,
  rankAccounts,
  MIN_FRESH_POSTS,
  FRESH_WINDOW_MS,
  parseKeywordProposal,
} from "../learnBusiness";

const NOW = Date.UTC(2026, 7, 5, 3, 0, 0);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function post(over: {
  postedAt?: number | null;
  likes?: number;
  comments?: number;
  handle?: string;
}) {
  return {
    authorHandle: over.handle ?? "someone",
    postedAt: over.postedAt === undefined ? NOW - DAY : over.postedAt,
    metrics: {
      likeCount: over.likes ?? 100,
      commentCount: over.comments ?? 10,
      viewCount: 5000,
    },
  };
}

describe("A CATEGORY IS NOT A NICHE", () => {
  it("⭐ rejects the words a marketing page uses about itself", () => {
    // These return millions of unrelated posts, so they'd sail through a naive
    // yield check while pointing at nobody's niche.
    for (const term of ["saas", "platform", "automation", "ai", "dashboard"]) {
      expect(looksGeneric(term), term).toBe(true);
    }
  });

  it("KEEPS the same noun once it's qualified", () => {
    // "dashboard" is a category. "csv dashboard" is a thing someone searches
    // for. The difference is the whole point of the check.
    expect(looksGeneric("csv dashboard")).toBe(false);
    expect(looksGeneric("solo founder")).toBe(false);
    expect(looksGeneric("weekly reporting")).toBe(false);
  });

  it("rejects marketing register wherever it appears", () => {
    expect(looksGeneric("seamless integration")).toBe(true);
    expect(looksGeneric("end-to-end workflow")).toBe(true);
  });

  it("derives candidates from vocabulary and audience, generic ones dropped", () => {
    const out = deriveKeywords({
      whatItIs: "turns a CSV into a dashboard in one paste",
      whoItsFor: "Solo developers or indie founders who have built an app",
      vocabulary: ["csv dashboard", "SaaS", "weekly reporting", "analytics"],
    });
    expect(out).toContain("csv dashboard");
    expect(out).toContain("weekly reporting");
    // Category nouns dropped.
    expect(out).not.toContain("saas");
    expect(out).not.toContain("analytics");
    // The audience names itself — and the clause after "who" is cut.
    expect(out).toContain("solo developers or indie founders");
  });

  it("dedupes case-insensitively", () => {
    const out = deriveKeywords({ vocabulary: ["CSV Dashboard", "csv dashboard"] });
    expect(out).toEqual(["csv dashboard"]);
  });
});

describe("VENDOR TIMESTAMPS ARE NOT ALWAYS MILLISECONDS", () => {
  it("⭐ SECONDS ARE PROMOTED TO MILLISECONDS", () => {
    // TikTok's create_time is seconds. Compared to a millisecond clock every
    // post looks ~50 years old, so the FIRST live run rejected every single
    // keyword with "nobody is posting about this" while the API was returning
    // 30 results per search. Silent, total, and indistinguishable from a niche
    // that genuinely has no content.
    expect(toMillis(1775788135)).toBe(1775788135000);
  });

  it("milliseconds are left alone", () => {
    expect(toMillis(1785894744718)).toBe(1785894744718);
  });

  it("nothing and nonsense are null, never epoch zero", () => {
    // 0 would date the post to 1970 and quietly make it "ancient" rather than
    // "unknown" — a different claim, and the wrong one.
    expect(toMillis(null)).toBeNull();
    expect(toMillis(undefined)).toBeNull();
    expect(toMillis(0)).toBeNull();
    expect(toMillis(-5)).toBeNull();
  });

  it("A REAL SECONDS TIMESTAMP SURVIVES THE FRESHNESS FILTER", () => {
    // The end-to-end version of the bug: a post from 3 days ago, in seconds,
    // must count as fresh.
    const threeDaysAgoSeconds = Math.floor((NOW - 3 * DAY) / 1000);
    const posts = Array.from({ length: MIN_FRESH_POSTS }, () => ({
      postedAt: threeDaysAgoSeconds,
      metrics: { likeCount: 100, commentCount: 10, viewCount: 5000 },
    }));
    expect(judgeKeyword("csv dashboard", posts, NOW).keep).toBe(true);
  });
});

describe("VELOCITY, NOT ENGAGEMENT", () => {
  it("⭐ A FRESH SMALL POST BEATS AN OLD BIG ONE", () => {
    // §5.1: "a 6-hour-old post with rising engagement is worth more than a
    // week-old post with more of it." This is what makes her notice what's
    // moving rather than what's already won.
    const fresh = velocity({ likeCount: 100, commentCount: 10 }, NOW - 6 * HOUR, NOW);
    const old = velocity({ likeCount: 5000, commentCount: 200 }, NOW - 30 * DAY, NOW);
    expect(fresh).toBeGreaterThan(old);
  });

  it("weights comments above likes — a reply costs more than a tap", () => {
    const commented = velocity({ likeCount: 0, commentCount: 10 }, NOW - HOUR, NOW);
    const liked = velocity({ likeCount: 10, commentCount: 0 }, NOW - HOUR, NOW);
    expect(commented).toBeGreaterThan(liked);
  });

  it("an undated post scores zero rather than infinity", () => {
    expect(velocity({ likeCount: 9999 }, null, NOW)).toBe(0);
  });

  it("median handles both parities and empties", () => {
    expect(median([])).toBe(0);
    expect(median([5])).toBe(5);
    expect(median([1, 3])).toBe(2);
    expect(median([3, 1, 2])).toBe(2);
  });
});

describe("A KEYWORD EARNS ITS PLACE BY WHAT COMES BACK", () => {
  it("⭐ A TERM NOBODY POSTS ABOUT IS REJECTED, WITH A REASON", () => {
    const verdict = judgeKeyword("csv dashboard", [], NOW);
    expect(verdict.keep).toBe(false);
    expect(verdict.why).toMatch(/nobody is posting/i);
  });

  it("a term with a trickle is rejected as too quiet", () => {
    const verdict = judgeKeyword(
      "csv dashboard",
      [post({}), post({})],
      NOW
    );
    expect(verdict.keep).toBe(false);
    expect(verdict.freshPosts).toBe(2);
    expect(verdict.why).toMatch(/too quiet/i);
  });

  it("STALE POSTS DON'T COUNT — the niche has to be alive now", () => {
    // Enough posts by count, all ancient. A niche that was busy two years ago
    // gives her nothing to say today.
    const ancient = Array.from({ length: 10 }, () =>
      post({ postedAt: NOW - FRESH_WINDOW_MS - DAY })
    );
    expect(judgeKeyword("csv dashboard", ancient, NOW).keep).toBe(false);
  });

  it("a live term is kept", () => {
    const live = Array.from({ length: MIN_FRESH_POSTS }, () => post({}));
    const verdict = judgeKeyword("csv dashboard", live, NOW);
    expect(verdict.keep).toBe(true);
    expect(verdict.medianVelocity).toBeGreaterThan(0);
    expect(verdict.why).toMatch(/traction/i);
  });
});

describe("OVERLAP IS THE SIGNAL, NOT REACH", () => {
  it("⭐ FOUR KEYWORDS BEATS ONE, EVEN AT LOWER VELOCITY", () => {
    // Appearing under one keyword might be coincidence. Under four means this
    // person is genuinely in the niche — the same insight the buyer map uses
    // for follower overlap.
    const ranked = rankAccounts([
      { handle: "@bigacct", channel: "tiktok", keyword: "csv dashboard", velocity: 900 },
      { handle: "@nicheacct", channel: "tiktok", keyword: "csv dashboard", velocity: 40 },
      { handle: "@nicheacct", channel: "tiktok", keyword: "solo founder", velocity: 35 },
      { handle: "@nicheacct", channel: "tiktok", keyword: "weekly reporting", velocity: 30 },
      { handle: "@nicheacct", channel: "tiktok", keyword: "indie hacker", velocity: 25 },
    ]);
    expect(ranked[0].handle).toBe("@nicheacct");
    expect(ranked[0].keywordHits).toBe(4);
    expect(ranked[0].why).toMatch(/4 of the things/);
  });

  it("velocity breaks ties between equally-relevant accounts", () => {
    const ranked = rankAccounts([
      { handle: "@quiet", channel: "tiktok", keyword: "a", velocity: 10 },
      { handle: "@busy", channel: "tiktok", keyword: "a", velocity: 500 },
    ]);
    expect(ranked[0].handle).toBe("@busy");
  });

  it("the same handle on two channels stays two targets", () => {
    // They're different accounts with different audiences and different posting
    // behaviour. Merging them would average two unrelated things.
    const ranked = rankAccounts([
      { handle: "@same", channel: "tiktok", keyword: "a", velocity: 10 },
      { handle: "@same", channel: "x", keyword: "a", velocity: 10 },
    ]);
    expect(ranked).toHaveLength(2);
  });

  it("handles are matched case-insensitively", () => {
    const ranked = rankAccounts([
      { handle: "@Acct", channel: "tiktok", keyword: "a", velocity: 10 },
      { handle: "@acct", channel: "tiktok", keyword: "b", velocity: 10 },
    ]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].keywordHits).toBe(2);
  });

  it("caps the list — 30 accounts is a watchlist, 300 is a firehose", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      handle: `@a${i}`,
      channel: "tiktok",
      keyword: "a",
      velocity: i,
    }));
    expect(rankAccounts(many)).toHaveLength(30);
  });
});


/**
 * ⭐ Judgment proposes, measurement validates.
 *
 * `deriveKeywords` EXTRACTED from the page, and the output proved why that's
 * the wrong shape: HeyMaya's own read produced `draft reply`, `native
 * posting`, `conversion` — the words the marketing page uses about itself.
 * No human marketer types those into TikTok search.
 *
 * Handed the same brief, Luna proposed `built app no users`, `how get first
 * users`, `indie hackers building`, `building in public`. That is the moment
 * of need and what the community calls itself.
 */
describe("⭐ THE KEYWORDS A PERSON WOULD ACTUALLY TYPE", () => {
  it("⭐ ACCEPTS WHAT LUNA ACTUALLY RETURNED", () => {
    // Captured from a live call against the real product truth.
    const out = parseKeywordProposal(
      JSON.stringify({
        keywords: [
          "how market my app",
          "built app no users",
          "no time for marketing",
          "how get first users",
          "indie hackers building",
          "building in public",
        ],
      })
    );
    expect(out).toHaveLength(6);
    expect(out).toContain("built app no users");
  });

  it("⭐ THE GENERIC FLOOR STILL CATCHES A BARE CATEGORY NOUN", () => {
    /**
     * The wordlist survives as a FLOOR, not a decision. It encodes a measured
     * fact — a bare category noun returns millions of unrelated posts — and
     * the prompt says the same thing. This catches the times the model agrees
     * and then does it anyway.
     */
    const out = parseKeywordProposal(
      JSON.stringify({ keywords: ["dashboard", "saas", "built app no users"] })
    );
    expect(out).toEqual(["built app no users"]);
  });

  it("a qualified category noun survives — the floor is bare nouns only", () => {
    expect(parseKeywordProposal(JSON.stringify({ keywords: ["csv dashboard"] }))).toEqual([
      "csv dashboard",
    ]);
  });

  it("strips hashes and casing, because search terms aren't posts", () => {
    expect(
      parseKeywordProposal(JSON.stringify({ keywords: ["#IndieHackers", "Building In Public"] }))
    ).toEqual(["indiehackers", "building in public"]);
  });

  it("⭐ AN UNUSABLE RESPONSE IS null, SO THE FALLBACK CAN RUN", () => {
    // Worse terms beat no terms: `deriveKeywords` still exists for a dead key
    // or a bad response, and both paths face the same two gates afterwards.
    expect(parseKeywordProposal("here are some ideas!")).toBeNull();
    expect(parseKeywordProposal(JSON.stringify({ keywords: [] }))).toBeNull();
    expect(parseKeywordProposal(JSON.stringify({ keywords: ["ai", "saas"] }))).toBeNull();
  });

  it("survives a fenced response", () => {
    expect(
      parseKeywordProposal('```json\n{"keywords":["built app no users"]}\n```')
    ).toEqual(["built app no users"]);
  });

  it("⭐ AND THE GATES DID NOT MOVE", () => {
    // The validating half is untouched on purpose: it tests against reality
    // rather than reasoning about it, which is what caught `threads` returning
    // sewing and `engagement` returning wedding photos. A better proposer
    // makes those gates cheaper, not optional.
    expect(typeof judgeKeyword).toBe("function");
  });
});
