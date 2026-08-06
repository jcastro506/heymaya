import { describe, expect, it } from "vitest";
import {
  BUYER_MAP_MAX_AGE_MS,
  complaintToContentRate,
  computeAudienceOverlap,
  discoverGathering,
  isStale,
  rankComplaints,
} from "../buyerMap";

const NOW = Date.UTC(2026, 6, 31, 12, 0, 0);
const DAY = 86_400_000;

describe("computeAudienceOverlap — who follows the competitors IS the ICP", () => {
  const competitors = [
    { handle: "rival_a", followers: ["dana", "sam", "kim", "bot1"] },
    { handle: "rival_b", followers: ["dana", "sam", "kim"] },
    { handle: "rival_c", followers: ["dana", "sam"] },
    { handle: "rival_d", followers: ["dana"] },
  ];

  it("ranks by how many competitors each person follows", () => {
    // Following ONE competitor might make you a customer, a rival, or a bot.
    // Following four means you're in the market. The overlap is the signal.
    const result = computeAudienceOverlap({ competitors });
    expect(result.map((r) => r.handle)).toEqual(["dana", "sam", "kim"]);
    expect(result[0].overlapScore).toBe(1);
    expect(result[1].overlapScore).toBe(0.75);
    expect(result[2].overlapScore).toBe(0.5);
  });

  it("drops single-competitor followers — they carry almost no information", () => {
    // `bot1` follows exactly one competitor. Including people like that buries
    // the real ICP under noise.
    const result = computeAudienceOverlap({ competitors });
    expect(result.map((r) => r.handle)).not.toContain("bot1");
  });

  it("the threshold is tunable when the competitor set is tiny", () => {
    const result = computeAudienceOverlap({ competitors, minCompetitors: 1 });
    expect(result.map((r) => r.handle)).toContain("bot1");
  });

  it("every score is explainable — it names which competitors", () => {
    const result = computeAudienceOverlap({ competitors });
    expect(result[0].followsCompetitors).toEqual([
      "rival_a",
      "rival_b",
      "rival_c",
      "rival_d",
    ]);
  });

  it("a handle repeated in one paginated pull doesn't inflate its score", () => {
    // The bug this prevents: a follower appearing twice across pages of the
    // same competitor's list scoring as if they followed two competitors.
    const result = computeAudienceOverlap({
      competitors: [
        { handle: "rival_a", followers: ["dana", "dana", "dana"] },
        { handle: "rival_b", followers: ["dana"] },
      ],
      minCompetitors: 2,
    });
    expect(result).toHaveLength(1);
    expect(result[0].overlapScore).toBe(1);
    expect(result[0].followsCompetitors).toEqual(["rival_a", "rival_b"]);
  });

  it("ordering is stable across runs, so week-over-week diffs mean something", () => {
    const tied = [
      { handle: "r1", followers: ["zoe", "amy"] },
      { handle: "r2", followers: ["zoe", "amy"] },
    ];
    expect(computeAudienceOverlap({ competitors: tied }).map((r) => r.handle)).toEqual(
      ["amy", "zoe"]
    );
  });

  it("no competitors is an empty map, not a crash", () => {
    expect(computeAudienceOverlap({ competitors: [] })).toEqual([]);
  });

  it("competitors with empty follower lists yield nothing", () => {
    expect(
      computeAudienceOverlap({
        competitors: [
          { handle: "a", followers: [] },
          { handle: "b", followers: [] },
        ],
      })
    ).toEqual([]);
  });
});

describe("discoverGathering — what ELSE the ICP follows", () => {
  const icpHandles = ["dana", "sam", "kim", "lee"];
  const followingByHandle = {
    dana: ["rival_a", "pg_weekly", "dbconf", "randomcat"],
    sam: ["rival_a", "pg_weekly", "dbconf"],
    kim: ["pg_weekly", "dbconf"],
    lee: ["pg_weekly", "somethingelse"],
  };
  const competitorHandles = ["rival_a", "rival_b"];

  it("finds where the niche actually gathers, ranked by share", () => {
    const places = discoverGathering({
      icpHandles,
      followingByHandle,
      competitorHandles,
    });
    expect(places[0]).toMatchObject({ handle: "pg_weekly", icpFollowers: 4, share: 1 });
    expect(places[1]).toMatchObject({ handle: "dbconf", icpFollowers: 3 });
  });

  it("excludes the competitors — otherwise it just rediscovers the input", () => {
    const places = discoverGathering({
      icpHandles,
      followingByHandle,
      competitorHandles,
    });
    expect(places.map((p) => p.handle)).not.toContain("rival_a");
  });

  it("excludes the ICP members themselves", () => {
    const places = discoverGathering({
      icpHandles: ["dana", "sam"],
      followingByHandle: { dana: ["sam", "pg_weekly"], sam: ["dana", "pg_weekly"] },
      competitorHandles: [],
    });
    expect(places.map((p) => p.handle)).toEqual(["pg_weekly"]);
  });

  it("a long tail followed by one person is filtered out", () => {
    // `randomcat` is one person's unrelated interest, not a gathering place.
    const places = discoverGathering({
      icpHandles,
      followingByHandle,
      competitorHandles,
    });
    expect(places.map((p) => p.handle)).not.toContain("randomcat");
  });

  it("the thresholds are tunable when you really do want the long tail", () => {
    const places = discoverGathering({
      icpHandles,
      followingByHandle,
      competitorHandles,
      minShare: 0.25,
      minIcpFollowers: 1,
    });
    expect(places.map((p) => p.handle)).toContain("randomcat");
  });

  it("a single follower is never a gathering place, whatever the share works out to", () => {
    // 1 of 4 is 25% and clears any sensible share bar. A ratio alone is too
    // weak at small N — the same trap the monoculture gate hit.
    const places = discoverGathering({
      icpHandles: ["a", "b", "c", "d"],
      followingByHandle: { a: ["lonely_account"] },
      competitorHandles: [],
    });
    expect(places).toEqual([]);
  });

  it("an ICP member we have no following data for is skipped, not fatal", () => {
    const places = discoverGathering({
      icpHandles: ["dana", "sam", "ghost"],
      followingByHandle: { dana: ["pg_weekly"], sam: ["pg_weekly"] },
      competitorHandles: [],
    });
    expect(places[0].handle).toBe("pg_weekly");
    // `ghost` still counts toward the denominator — we asked about them and
    // got nothing, which is different from not having asked.
    expect(places[0].share).toBeCloseTo(2 / 3, 5);
  });

  it("no ICP is an empty result, not a division by zero", () => {
    expect(
      discoverGathering({
        icpHandles: [],
        followingByHandle: {},
        competitorHandles: [],
      })
    ).toEqual([]);
  });
});

describe("rankComplaints — the ranked list IS the content plan", () => {
  const sources = [
    {
      text: "pricing page is confusing, cant tell what tier I need",
      sourceUrl: "https://x.com/a/1",
      postedAt: NOW - 3 * DAY,
    },
    {
      text: "the pricing page is really confusing, no idea which tier I need",
      sourceUrl: "https://x.com/b/2",
      postedAt: NOW - DAY,
    },
    {
      text: "confusing pricing page — which tier do I actually need?",
      sourceUrl: "https://x.com/c/3",
      postedAt: NOW - 2 * DAY,
    },
    {
      text: "migrations keep timing out on large tables",
      sourceUrl: "https://x.com/d/4",
      postedAt: NOW - 5 * DAY,
    },
  ];

  it("clusters the same complaint said differently and ranks by frequency", () => {
    const ranked = rankComplaints(sources);
    expect(ranked[0].frequency).toBe(3);
    expect(ranked[0].text).toMatch(/pricing/);
    expect(ranked[1].frequency).toBe(1);
  });

  it("the representative is a REAL QUOTE, never a synthesis", () => {
    // §5.0.0: `language` must be THEIR words for the problem, never our
    // marketing vocabulary. So the text has to be one of the inputs verbatim.
    const ranked = rankComplaints(sources);
    const originals = sources.map((s) => s.text);
    expect(originals).toContain(ranked[0].text);
  });

  it("keeps the receipts — every complaint is quotable back to source", () => {
    const ranked = rankComplaints(sources);
    expect(ranked[0].sourceUrls).toHaveLength(3);
    expect(ranked[0].sourceUrls).toContain("https://x.com/a/1");
  });

  it("dedupes receipts — one thread quoted twice is one receipt", () => {
    const ranked = rankComplaints([
      { text: "pricing is confusing", sourceUrl: "https://x.com/a/1", postedAt: NOW },
      { text: "pricing is confusing", sourceUrl: "https://x.com/a/1", postedAt: NOW },
    ]);
    expect(ranked[0].frequency).toBe(2);
    expect(ranked[0].sourceUrls).toHaveLength(1);
  });

  it("lastSeen is the most recent mention, not the first", () => {
    const ranked = rankComplaints(sources);
    expect(ranked[0].lastSeen).toBe(NOW - DAY);
  });

  it("genuinely different complaints stay separate", () => {
    const ranked = rankComplaints(sources);
    expect(ranked.map((r) => r.frequency)).toEqual([3, 1]);
    expect(ranked[1].text).toMatch(/timing out/);
  });

  it("an empty input is an empty list", () => {
    expect(rankComplaints([])).toEqual([]);
  });

  it("ties break on recency, so the fresher complaint leads", () => {
    const ranked = rankComplaints([
      { text: "alpha problem here", sourceUrl: "u1", postedAt: NOW - 10 * DAY },
      { text: "totally separate beta issue", sourceUrl: "u2", postedAt: NOW },
    ]);
    expect(ranked[0].text).toMatch(/beta/);
  });
});

describe("complaintToContentRate — the tracked number", () => {
  it("states it plainly for the weekly review", () => {
    const result = complaintToContentRate([
      { tracesToComplaint: true },
      { tracesToComplaint: true },
      { tracesToComplaint: true },
      { tracesToComplaint: true },
      { tracesToComplaint: false },
      { tracesToComplaint: false },
    ]);
    expect(result.sentence).toBe(
      "4 of 6 posts this week came from something your buyers actually said."
    );
    expect(result.rate).toBeCloseTo(0.667, 2);
  });

  it("a week with no posts is 0, never NaN", () => {
    const result = complaintToContentRate([]);
    expect(result.rate).toBe(0);
    expect(Number.isNaN(result.rate)).toBe(false);
    expect(result.sentence).toBe("Nothing went out this week.");
  });

  it("zero traced is admitted, not hidden behind a percentage", () => {
    const result = complaintToContentRate([
      { tracesToComplaint: false },
      { tracesToComplaint: false },
    ]);
    expect(result.sentence).toMatch(/None of this week's 2 posts/);
    expect(result.sentence).toMatch(/I'll fix that/);
  });

  it("singular reads correctly", () => {
    expect(
      complaintToContentRate([{ tracesToComplaint: true }]).sentence
    ).toBe("1 of 1 post this week came from something your buyers actually said.");
  });

  it("the sentence carries no percent sign — plain language, not a dashboard", () => {
    for (const posts of [
      [{ tracesToComplaint: true }],
      [{ tracesToComplaint: false }],
      [],
    ]) {
      expect(complaintToContentRate(posts).sentence).not.toContain("%");
    }
  });
});

describe("isStale — a stale map poisons everything downstream, silently", () => {
  it("a never-refreshed map is stale", () => {
    expect(isStale(undefined, NOW)).toBe(true);
  });

  it("fresh within the month", () => {
    expect(isStale(NOW - 10 * DAY, NOW)).toBe(false);
  });

  it("past a month it's stale", () => {
    expect(isStale(NOW - BUYER_MAP_MAX_AGE_MS - 1, NOW)).toBe(true);
  });

  it("exactly at the boundary is still fresh", () => {
    expect(isStale(NOW - BUYER_MAP_MAX_AGE_MS, NOW)).toBe(false);
  });
});

/**
 * ⭐ The staleness check that nothing called.
 *
 * §5.0.0: the buyer map is "refreshed monthly, because a stale buyer map
 * silently poisons the idea bank, the format library, and the benchmarks all
 * at once."
 *
 * `isStale` and `BUYER_MAP_MAX_AGE_MS` were written for exactly that, and the
 * WHOLE MODULE was unimported — so nothing ever checked, and a niche learned
 * in July would still be driving every keyword in December.
 */
describe("⭐ STALENESS — the check nothing ran", () => {
  const now = Date.UTC(2026, 7, 6);

  it("a map inside the window is fine", () => {
    expect(isStale(now - 5 * 86_400_000, now)).toBe(false);
  });

  it("⭐ PAST A MONTH IT IS STALE — and stale never announces itself", () => {
    /**
     * The word "silently" in §5.0.0 is the whole problem. Stale keywords do
     * not fail; they return posts. They return the WRONG posts, and every
     * sweep downstream reports success.
     */
    expect(isStale(now - BUYER_MAP_MAX_AGE_MS - 1, now)).toBe(true);
  });

  it("⭐ NEVER REFRESHED IS STALE — and the CALLER decides what that means", () => {
    /**
     * `isStale(undefined)` is `true`, which is the right answer to the
     * question it was asked: a map with no refresh date is not fresh.
     *
     * But "never learned" and "learned in July" are different problems with
     * different owners — onboarding builds the first map, and re-learning for
     * a customer who may not be set up yet spends twelve searches on nobody.
     * So `relearnIfStale` checks for a map at ALL before consulting this, and
     * the split is deliberate rather than a gap.
     */
    expect(isStale(undefined, now)).toBe(true);
  });
});
