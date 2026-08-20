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
  advertisersFrom,
  parseDiscovered,
  parseSearchTerms,
  buildDiscoveryPrompt,
  DISCOVERY_KEYWORDS,
  AD_WATCH_SYSTEM,
  PROVEN_DAYS,
  type PageCandidate,
  type RankedAd,
} from "../adIntel";
import { ASSET_RANK } from "../assetFloor";

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
    videoUrl: 'https://video.example/x.mp4',
    thumbUrl: 'https://img.example/x.jpg',
    watchedJson: null,
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

describe("⭐ SHE BRINGS A LIST INSTEAD OF ASKING A QUESTION", () => {
  /**
   * `competitors` is populated only when the founder's own page names rivals,
   * which most don't — so the top rung of the ladder was unreachable for nearly
   * every customer. Discovery finds who pays to reach the same buyers.
   *
   * ⚠️ Candidates below are the REAL ones returned live on 2026-08-19 for
   * "AI video ads" and "UGC ad creative", including the false positives, which
   * are the entire reason a model judges this rather than a rank cutoff.
   */
  const LIVE = [
    { pageId: "1", pageName: "ElevenLabs", liveAds: 8, longestDays: 187 },
    { pageId: "2", pageName: "Alex Mehr, Ph.D.", liveAds: 8, longestDays: 39 },
    { pageId: "3", pageName: "FlyAds.ai", liveAds: 6, longestDays: 104 },
    { pageId: "4", pageName: "Mr. Paid Social", liveAds: 1, longestDays: 182 },
    { pageId: "5", pageName: "Euro Júnior 2", liveAds: 1, longestDays: 169 },
  ];

  function haul(rows: { page: string; days: number; id: string }[]) {
    return {
      searchResults: rows.map((r) => ({
        ad_archive_id: r.id,
        page_id: r.page,
        page_name: r.page,
        is_active: true,
        start_date: Math.floor((NOW - r.days * DAY) / 1000),
        collation_count: 1,
        collation_id: r.id,
        snapshot: { title: "t" },
      })),
    };
  }

  it("groups a keyword haul by advertiser and counts their commitment", () => {
    const out = advertisersFrom(
      [
        haul([
          { page: "FlyAds.ai", days: 104, id: "a" },
          { page: "FlyAds.ai", days: 20, id: "b" },
          { page: "Someone", days: 200, id: "c" },
        ]),
      ],
      NOW
    );
    expect(out[0].pageName).toBe("FlyAds.ai");
    expect(out[0].liveAds).toBe(2);
    // Longevity is kept as conviction, not just presence.
    expect(out[0].longestDays).toBe(104);
  });

  it("merges hauls across keywords rather than double-counting a page", () => {
    const out = advertisersFrom(
      [
        haul([{ page: "ElevenLabs", days: 187, id: "a" }]),
        haul([{ page: "ElevenLabs", days: 133, id: "b" }]),
      ],
      NOW
    );
    expect(out).toHaveLength(1);
    expect(out[0].liveAds).toBe(2);
  });

  it("⭐ AD COUNT ALONE WOULD PICK A COURSE SELLER", () => {
    // `Alex Mehr, Ph.D.` ties ElevenLabs on volume and outranks the real
    // competitor FlyAds.ai. Any "top N by ad count" rule ships him as a rival.
    const byVolume = [...LIVE].sort((a, b) => b.liveAds - a.liveAds);
    expect(byVolume[1].pageName).toBe("Alex Mehr, Ph.D.");
    expect(byVolume.indexOf(LIVE[2])).toBeGreaterThan(1);
  });

  it("keeps only names that were actually offered", () => {
    // A model naming a company that was never in the list has invented it, and
    // an invented name would be searched as though the founder had said it.
    expect(
      parseDiscovered('{"competitors":["FlyAds.ai","Runway"]}', LIVE)
    ).toEqual(["FlyAds.ai"]);
  });

  it("matches names case-insensitively but returns the page's own spelling", () => {
    expect(parseDiscovered('{"competitors":["flyads.ai"]}', LIVE)).toEqual([
      "FlyAds.ai",
    ]);
  });

  it("an empty answer is a real answer, never a fallback to the top row", () => {
    // "None of these compete with you" is correct far more often than a stretch,
    // and a stretch becomes a whole week aimed at the wrong company.
    expect(parseDiscovered('{"competitors":[]}', LIVE)).toEqual([]);
    expect(parseDiscovered("no JSON here at all", LIVE)).toEqual([]);
  });

  it("never returns the same competitor twice", () => {
    expect(
      parseDiscovered('{"competitors":["FlyAds.ai","FlyAds.ai"]}', LIVE)
    ).toEqual(["FlyAds.ai"]);
  });
});

describe("⚠️ SEARCH THE PRODUCT'S WORDS, NOT THE BUYER'S COMPLAINTS", () => {
  /**
   * Discovery originally reused the niche keywords, and that was the wrong
   * vocabulary. Arcads' keywords are buyer PAINS — "ad creative fatigue",
   * "meta ads not converting", "facebook ads low ctr" — and searching them live
   * on 2026-08-19 returned `Meta for Business` (24 ads), `Kong`,
   * `Glitch Studios`, `Hernan Vazquez` and an academy. NOT ONE competitor: a
   * rival product does not buy ads against its buyer's complaints.
   *
   * Derived product terms — "AI video generator", "AI avatar creator",
   * "AI ad maker" — returned Scalio, FlyAds.ai and Impresso on the first try.
   */
  it("parses the derived queries", () => {
    expect(
      parseSearchTerms('{"queries":["AI video generator","AI ad maker"]}')
    ).toEqual(["AI video generator", "AI ad maker"]);
  });

  it("caps the queries, because each one is a paid call", () => {
    expect(
      parseSearchTerms('{"queries":["a one","b two","c three","d four","e five"]}')
    ).toHaveLength(DISCOVERY_KEYWORDS);
  });

  it("no queries means STOP, never fall back to the buyer's pain words", () => {
    // Falling back is what produced a pool with zero competitors in it.
    expect(parseSearchTerms("sorry, I can't")).toEqual([]);
    expect(parseSearchTerms('{"queries":[]}')).toEqual([]);
    expect(parseSearchTerms('{"queries":[1,2]}')).toEqual([]);
  });

  it("drops junk too short to be a query", () => {
    expect(parseSearchTerms('{"queries":["ai","AI ad maker"]}')).toEqual([
      "AI ad maker",
    ]);
  });

  it("the prompt carries the buyer's words so tech-adjacent tools are caught", () => {
    /**
     * ⚠️ Same technology, different buyer is the commonest false positive. With
     * `whoItsFor` empty — which it is for Arcads, the page never says — the
     * model had no buyer to judge against and returned `AutoReel`, an AI video
     * tool for REALTORS.
     */
    const prompt = buildDiscoveryPrompt(
      { name: "Arcads", whatItIs: "generate video ads with AI actors" },
      [{ pageId: "1", pageName: "AutoReel", liveAds: 2, longestDays: 105 }],
      ["ecommerce media buyers", "dropshipping store owners"]
    );
    expect(prompt).toContain("ecommerce media buyers");
    expect(prompt).toContain("AutoReel");
  });

  it("omits the buyer section entirely when we have no buyer words", () => {
    // An empty labelled section invites the model to invent a buyer.
    const prompt = buildDiscoveryPrompt(
      { name: "Arcads", whatItIs: "video ads" },
      [{ pageId: "1", pageName: "X", liveAds: 1, longestDays: 5 }],
      []
    );
    expect(prompt).not.toContain("BUYER");
  });
});

describe("⭐ THE WATCH HAS TO ANSWER 'CAN WE BUILD THIS?'", () => {
  /**
   * The first version returned hook / device / beats / whyItWorks — enough to
   * PITCH an ad and not enough to REBUILD one. Three fields decide whether
   * `make-video` can act on it at all.
   */
  it("asks which ASSET RUNG the shape needs, in the ladder's own words", () => {
    // Verified live on a 105-day FlyAds.ai ad: "screen_recording".
    // Without this, a talking-head ad looks buildable right up until the render
    // needs a founder who never agreed to be on camera.
    for (const rung of ASSET_RANK) {
      expect(AD_WATCH_SYSTEM).toContain(rung);
    }
    expect(AD_WATCH_SYSTEM).toMatch(/EXACTLY ONE of these words/i);
  });

  it("asks for the spoken script, which travels furthest", () => {
    expect(AD_WATCH_SYSTEM).toMatch(/"spokenScript"/);
    expect(AD_WATCH_SYSTEM).toMatch(/travels furthest/i);
  });

  it("asks what is ON SCREEN per beat, not just what it means", () => {
    // "the shot, not the meaning" — a beat you cannot picture is a beat you
    // cannot film.
    expect(AD_WATCH_SYSTEM).toMatch(/"onScreen"/);
    expect(AD_WATCH_SYSTEM).toMatch(/the shot, not the meaning/i);
  });

  it("⚠️ and still refuses to carry their claims across", () => {
    // §7.5.3 — structure travels, claims do not. Their numbers would be a lie
    // in our ad.
    expect(AD_WATCH_SYSTEM).toMatch(/not transferable|are theirs/i);
  });

  it("says so rather than filling a field it cannot see", () => {
    expect(AD_WATCH_SYSTEM).toMatch(/If you cannot tell, say so/i);
  });
});
