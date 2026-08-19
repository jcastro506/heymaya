/**
 * Competitor ad intelligence — the rung-1 evidence.
 *
 * Every fixture here is SHAPED FROM A REAL VENDOR PAYLOAD captured live on
 * 2026-08-19, not invented. The two defects these guard against were both found
 * by running the thing against real advertisers, and neither would have been
 * caught by a fixture I made up — because I would have made up a payload that
 * matched my assumptions, which is exactly what was wrong.
 */
import { describe, it, expect } from "vitest";
import {
  daysRunning,
  rankAds,
  candidatesFrom,
  parseIdentified,
  buildShortlist,
  PROVEN_DAYS,
  type PageCandidate,
  type RankedAd,
} from "../adIntel";

const NOW = 1_787_200_000_000;
const DAY = 86_400_000;

function ad(over: Record<string, unknown> = {}) {
  return {
    ad_archive_id: "1",
    page_id: "p1",
    page_name: "Synthesia",
    is_active: true,
    start_date: Math.floor((NOW - 58 * DAY) / 1000),
    collation_count: 5,
    collation_id: "c1",
    total_active_time: null,
    spend: null,
    snapshot: { title: "Create a FREE AI video now", videos: [{}] },
    ...over,
  };
}

describe("LONGEVITY IS DERIVED, BECAUSE THE VENDOR'S OWN FIELD IS EMPTY", () => {
  it("⭐ reads start_date as SECONDS, not milliseconds", () => {
    // Treating it as ms dates every ad to 1970 and makes all of them look
    // maximally proven — a wrong answer that looks like a very confident one.
    expect(daysRunning(Math.floor((NOW - 58 * DAY) / 1000), NOW)).toBe(58);
  });

  it("⭐ IGNORES total_active_time, which is null on every real ad", () => {
    // Measured: populated 0 of 30 on a live advertiser. Ranking on it yields a
    // uniform zero, so the order silently becomes the vendor's return order.
    const ranked = rankAds({ results: [ad({ total_active_time: 0 })] }, NOW);
    expect(ranked[0].daysRunning).toBe(58);
  });

  it("an undated ad is dropped, never treated as brand new", () => {
    // 0 and "unknown" must not sort together: ranking unknown as 0 buries it
    // permanently rather than admitting we don't know.
    expect(daysRunning(undefined, NOW)).toBeNull();
    expect(daysRunning("2026-07-01", NOW)).toBeNull();
    expect(rankAds({ results: [ad({ start_date: null })] }, NOW)).toHaveLength(0);
  });

  it("a future start date is not trusted", () => {
    expect(daysRunning(Math.floor((NOW + 10 * DAY) / 1000), NOW)).toBeNull();
  });

  it("⭐ INACTIVE ADS ARE DROPPED, not ranked lower", () => {
    // A dead ad that ran 200 days is history, and the question this answers is
    // what is working RIGHT NOW.
    expect(rankAds({ results: [ad({ is_active: false })] }, NOW)).toHaveLength(0);
  });

  it("⚠️ accepts BOTH root keys, because the vendor uses both", () => {
    // company/ads returns `results`; search/ads returns `searchResults`. Not
    // defensiveness — the actual measured contract.
    expect(rankAds({ results: [ad()] }, NOW)).toHaveLength(1);
    expect(rankAds({ searchResults: [ad()] }, NOW)).toHaveLength(1);
    expect(rankAds({ ads: [ad()] }, NOW)).toHaveLength(0);
  });

  it("longest-running first, variants breaking the tie", () => {
    const ranked = rankAds(
      {
        results: [
          ad({ ad_archive_id: "a", start_date: Math.floor((NOW - 10 * DAY) / 1000), collation_id: "x" }),
          ad({ ad_archive_id: "b", start_date: Math.floor((NOW - 90 * DAY) / 1000), collation_id: "y" }),
          ad({ ad_archive_id: "c", start_date: Math.floor((NOW - 90 * DAY) / 1000), collation_count: 9, collation_id: "z" }),
        ],
      },
      NOW
    );
    expect(ranked.map((r) => r.adArchiveId)).toEqual(["c", "b", "a"]);
  });

  it("PROVEN_DAYS is the three weeks the skill promises", () => {
    expect(PROVEN_DAYS).toBe(21);
  });
});

describe("⭐ THE WRONG COMPANY IS WORSE THAN NO COMPANY", () => {
  /**
   * The live failure: searching "Creatify" for a customer competing with
   * creatify.ai returned an advertising agency with 3× the followers, and the
   * first heuristic picked it. Ten Spanish-language holographic-sticker ads
   * would have become a founder's week.
   */
  const CREATIFY = {
    searchResults: [
      { page_id: "145266828662281", name: "Creatify AI", category: "Internet Company", likes: 14269 },
      { page_id: "633738589825906", name: "Creatify", category: "Textile Company", likes: 154 },
      { page_id: "260016067688368", name: "CREATIFY", category: "Advertising Agency", likes: 43600 },
    ],
  };

  it("collects every candidate rather than pre-judging one", () => {
    const c = candidatesFrom(CREATIFY);
    expect(c).toHaveLength(3);
    expect(c.map((x) => x.category)).toContain("Internet Company");
  });

  it("⚠️ the real competitor is NOT the exact name match", () => {
    // "Creatify AI" is the company; "Creatify" and "CREATIFY" are other
    // businesses. Any exact-match rule prefers the wrong one.
    const c = candidatesFrom(CREATIFY);
    const truth = c.find((x) => x.pageId === "145266828662281")!;
    expect(truth.name).not.toBe("Creatify");
  });

  it("⚠️ and it does NOT have the most followers", () => {
    const c = candidatesFrom(CREATIFY);
    const most = [...c].sort((a, b) => b.likes - a.likes)[0];
    expect(most.pageId).not.toBe("145266828662281");
  });

  it("an invented pageId is dropped, never looked up", () => {
    // A model naming an id that was never offered has hallucinated it, and an
    // invented id would be queried as though it were real.
    const groups = [{ competitor: "Creatify", candidates: candidatesFrom(CREATIFY) }];
    const out = parseIdentified('{"matches":[{"competitor":"Creatify","pageId":"999"}]}', groups);
    expect(out.size).toBe(0);
  });

  it("a real choice is kept", () => {
    const groups = [{ competitor: "Creatify", candidates: candidatesFrom(CREATIFY) }];
    const out = parseIdentified(
      'Sure!\n{"matches":[{"competitor":"Creatify","pageId":"145266828662281"}]}',
      groups
    );
    expect(out.get("Creatify")?.name).toBe("Creatify AI");
  });

  it("null and unparseable both mean NO MATCH, never a guess", () => {
    const groups = [{ competitor: "Creatify", candidates: candidatesFrom(CREATIFY) }];
    expect(parseIdentified('{"matches":[{"competitor":"Creatify","pageId":null}]}', groups).size).toBe(0);
    expect(parseIdentified("the model was chatty today", groups).size).toBe(0);
  });
});

describe("⭐ ONE COMPETITOR MUST NOT EAT THE SHORTLIST", () => {
  /**
   * The second live failure: 12 rows, all Synthesia, five of them the same
   * creative. Every Synthesia ad started the same day, so a pure longevity sort
   * buried every competitor whose ads happened to be newer.
   */
  const mk = (page: string, days: number, concept: string, variants = 1): RankedAd => ({
    adArchiveId: `${page}-${concept}-${days}`,
    pageId: page,
    pageName: page,
    daysRunning: days,
    startedAtMs: NOW - days * DAY,
    isActive: true,
    variants,
    collationId: `${page}-${concept}`,
    hasVideo: true,
    title: concept,
    body: "",
    ctaText: "",
    linkUrl: "",
    url: `https://www.facebook.com/ads/library?id=${page}-${concept}-${days}`,
    transcript: null,
  });

  it("collapses variants of ONE concept to a single row", () => {
    // Five cuts of one creative are one piece of evidence, not five.
    const out = buildShortlist(
      [mk("A", 58, "free-video"), mk("A", 58, "free-video"), mk("A", 58, "free-video")],
      12
    );
    expect(out).toHaveLength(1);
  });

  it("keeps the variant COUNT, which is its own signal", () => {
    const out = buildShortlist([mk("A", 58, "c1", 2), mk("A", 58, "c1", 7)], 12);
    expect(out[0].variants).toBe(7);
  });

  it("⭐ SPREADS ACROSS COMPETITORS instead of ranking by longevity alone", () => {
    // Synthesia's ads are all older, so a pure sort returns nothing else.
    const ads = [
      ...Array.from({ length: 8 }, (_, i) => mk("Synthesia", 58, `s${i}`)),
      ...Array.from({ length: 8 }, (_, i) => mk("HeyGen", 40, `h${i}`)),
      ...Array.from({ length: 8 }, (_, i) => mk("Creatify AI", 30, `c${i}`)),
    ];
    const out = buildShortlist(ads, 12);
    const perPage = new Map<string, number>();
    for (const a of out) perPage.set(a.pageName, (perPage.get(a.pageName) ?? 0) + 1);
    expect(out).toHaveLength(12);
    expect([...perPage.keys()].sort()).toEqual(["Creatify AI", "HeyGen", "Synthesia"]);
    // Live run after the fix: exactly 4/4/4.
    expect([...perPage.values()]).toEqual([4, 4, 4]);
  });

  it("one competitor alone still fills the list", () => {
    const ads = Array.from({ length: 20 }, (_, i) => mk("Synthesia", 58 - i, `s${i}`));
    expect(buildShortlist(ads, 12)).toHaveLength(12);
  });

  it("the strongest ad still leads", () => {
    const out = buildShortlist([mk("A", 10, "a"), mk("B", 99, "b")], 12);
    expect(out[0].daysRunning).toBe(99);
  });
});
