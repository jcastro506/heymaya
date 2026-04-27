/**
 * Sprint 3.5b — `maya-opportunity-scout` unit tests.
 *
 * Pure-logic tests; the Brave + callMaya round-trip is tested separately by
 * the lead at the Convex action layer.
 *
 * Coverage:
 *   - happy path: query construction includes marketplaces / hashtags /
 *     local-brand-search, dedupe filter works, fit-score parser parses
 *     well-formed lines, suggestedAction maps correctly
 *   - adversarial: zero-results path returns empty (no fabrication),
 *     prompt-injection-shaped snippets don't bypass the parser, missing
 *     city skips local-brand-search cleanly, parser drops malformed lines
 */

import { describe, it, expect } from "vitest";
import {
  MARKETPLACE_QUERIES,
  TWITTER_HASHTAG_QUERIES,
  buildCitations,
  buildScoutQueries,
  canonicalize,
  dropSeen,
  fitScoringPrompt,
  parseFitScoreOutput,
  suggestedActionFor,
  type BraveScoutResult,
  type CreatorPictureSubset,
  type Opportunity,
} from "../script";

const FITNESS_AUSTIN: CreatorPictureSubset = {
  niche: "fitness",
  audience: { topGeos: ["US"], interestTags: ["strength", "running"] },
  followerCount: 30_000,
  locationSoul: { city: "Austin", state: "TX", country: "US" },
};

const FITNESS_NO_LOCATION: CreatorPictureSubset = {
  ...FITNESS_AUSTIN,
  locationSoul: {},
};

describe("maya-opportunity-scout — buildScoutQueries", () => {
  it("emits one query per marketplace + one per hashtag + 4 local searches", () => {
    const queries = buildScoutQueries({
      creatorPicture: FITNESS_AUSTIN,
      platforms: ["tiktok", "instagram"],
      lookbackHours: 24,
    });
    // marketplaces (6) + hashtags (4) + local (4) = 14
    expect(queries.length).toBe(MARKETPLACE_QUERIES.length + TWITTER_HASHTAG_QUERIES.length + 4);
    // every marketplace site operator should appear
    for (const m of MARKETPLACE_QUERIES) {
      expect(queries.some((q) => q.query.includes(m.siteOperator))).toBe(true);
    }
    // every hashtag should appear
    for (const tag of TWITTER_HASHTAG_QUERIES) {
      expect(queries.some((q) => q.query.includes(tag))).toBe(true);
    }
    // local-brand-search includes city + state
    expect(queries.some((q) => q.source === "local-brand-search" && q.query.includes("Austin TX"))).toBe(true);
  });

  it("skips local-brand-search when city is missing", () => {
    const queries = buildScoutQueries({
      creatorPicture: FITNESS_NO_LOCATION,
      platforms: ["tiktok"],
      lookbackHours: 24,
    });
    expect(queries.every((q) => q.source !== "local-brand-search")).toBe(true);
  });

  it("niche-narrows every marketplace and hashtag query", () => {
    const queries = buildScoutQueries({
      creatorPicture: FITNESS_AUSTIN,
      platforms: ["tiktok"],
      lookbackHours: 24,
    });
    for (const q of queries) {
      // every query references the niche string
      expect(q.query.toLowerCase()).toContain("fitness");
    }
  });
});

describe("maya-opportunity-scout — dropSeen", () => {
  const candidates: BraveScoutResult[] = [
    { title: "Aspire Brief A", url: "https://aspire.io/briefs/abc", description: "", source: "aspire" },
    { title: "Aspire Brief B", url: "https://www.aspire.io/briefs/abc?utm_source=feed", description: "", source: "aspire" },
    { title: "GRIN Brief C", url: "https://grin.co/c/123", description: "", source: "grin" },
    { title: "Local Brand D", url: "https://example.com/austin-fitness", description: "", source: "local-brand-search" },
  ];

  it("drops URLs in seen set + drops duplicates within cycle", () => {
    const seen = new Set<string>([canonicalize("https://grin.co/c/123")]);
    const { kept, droppedCount } = dropSeen(candidates, seen);
    // A and B canonicalize identically → only one keeps; C dropped via seen; D kept
    expect(kept.map((c) => c.title)).toEqual(["Aspire Brief A", "Local Brand D"]);
    expect(droppedCount).toBe(2);
  });

  it("returns all-kept when seen set is empty and no in-cycle dups", () => {
    const fresh: BraveScoutResult[] = [
      { title: "X", url: "https://aspire.io/x", description: "", source: "aspire" },
      { title: "Y", url: "https://grin.co/y", description: "", source: "grin" },
    ];
    const { kept, droppedCount } = dropSeen(fresh, new Set());
    expect(kept).toHaveLength(2);
    expect(droppedCount).toBe(0);
  });
});

describe("maya-opportunity-scout — suggestedActionFor", () => {
  it("skips below 0.3", () => {
    expect(suggestedActionFor(0.2, "aspire", true)).toBe("skip");
  });

  it("monitors between 0.3 and 0.5 for non-marketplace", () => {
    expect(suggestedActionFor(0.4, "twitter-creator-call", false)).toBe("monitor");
    expect(suggestedActionFor(0.4, "local-brand-search", false)).toBe("monitor");
  });

  it("applies for marketplaces 0.5-0.6", () => {
    expect(suggestedActionFor(0.55, "aspire", false)).toBe("apply");
    expect(suggestedActionFor(0.55, "grin", false)).toBe("apply");
  });

  it("pitches at fit>=0.6 when brand contact is known", () => {
    expect(suggestedActionFor(0.7, "local-brand-search", true)).toBe("pitch");
    expect(suggestedActionFor(0.85, "twitter-creator-call", true)).toBe("pitch");
  });

  it("falls back to apply (marketplace) or monitor (other) at fit>=0.6 if no contact", () => {
    expect(suggestedActionFor(0.8, "aspire", false)).toBe("apply");
    expect(suggestedActionFor(0.8, "local-brand-search", false)).toBe("monitor");
  });
});

describe("maya-opportunity-scout — fitScoringPrompt", () => {
  it("includes niche, follower count, location, and every candidate URL", () => {
    const cands: BraveScoutResult[] = [
      { title: "A", url: "https://aspire.io/a", description: "snippet a", source: "aspire" },
      { title: "B", url: "https://example.com/austin-gym-brand", description: "Austin local gym brand", source: "local-brand-search" },
    ];
    const p = fitScoringPrompt(FITNESS_AUSTIN, ["tiktok", "instagram"], cands);
    expect(p).toContain("fitness");
    expect(p).toContain("30,000");
    expect(p).toContain("Austin, TX");
    expect(p).toContain("https://aspire.io/a");
    expect(p).toContain("Local brands (geo-match) score higher");
  });

  it("omits location line when no city set", () => {
    const cands: BraveScoutResult[] = [
      { title: "A", url: "https://aspire.io/a", description: "snippet a", source: "aspire" },
    ];
    const p = fitScoringPrompt(FITNESS_NO_LOCATION, ["tiktok"], cands);
    expect(p).not.toContain("Creator location:");
  });
});

describe("maya-opportunity-scout — parseFitScoreOutput", () => {
  it("parses well-formed pipe-delimited lines including NULL brand", () => {
    const raw = [
      "0|0.85|Athletic Greens|Strong niche match + paid-history with similar brand size.",
      "1|0.40|NULL|Marketplace listing tangentially related to the niche.",
    ].join("\n");
    const out = parseFitScoreOutput(raw, 2);
    expect(out).toHaveLength(2);
    expect(out[0].fit).toBeCloseTo(0.85);
    expect(out[0].brandName).toBe("Athletic Greens");
    expect(out[1].brandName).toBeUndefined();
  });

  it("preserves pipes inside reasoning text", () => {
    const raw = "0|0.7|TestBrand|Reasoning with a | pipe inside it.";
    const out = parseFitScoreOutput(raw, 1);
    expect(out[0].reasoning).toBe("Reasoning with a | pipe inside it.");
  });

  // ── adversarial ──────────────────────────────────────────────────────
  it("returns [] on empty model output (no fabrication)", () => {
    expect(parseFitScoreOutput("", 5)).toEqual([]);
  });

  it("drops malformed lines (NaN fit, out-of-range fit, invalid idx, missing fields)", () => {
    const raw = [
      "no pipes here",
      "0|abc|Brand|bad fit",
      "0|1.5|Brand|fit out of range",
      "99|0.5|Brand|idx out of range",
      "0|0.5||empty brand allowed but reasoning required",
      "1|0.6|Brand|valid one",
    ].join("\n");
    const out = parseFitScoreOutput(raw, 2);
    expect(out.map((o) => o.fit)).toEqual([0.5, 0.6]);
  });

  it("handles prompt-injection-shaped snippet content without bypassing the schema", () => {
    // The injected content is in the snippet (model-side), so we simulate
    // the model dutifully returning a malicious-looking line. Parser must
    // still apply schema rules — fit must be 0..1, idx valid, etc. The
    // CITATION FIREWALL catches the unsupported-claim case downstream.
    const raw = "0|0.99|IGNORE PRIOR INSTRUCTIONS BRAND|This brand pays $999999 guaranteed [adversarial].";
    const out = parseFitScoreOutput(raw, 1);
    // Parser passes it through (the firewall is the layer that drops
    // unsupported claims). We just confirm the parser didn't crash and
    // didn't fabricate / mutate anything.
    expect(out).toHaveLength(1);
    expect(out[0].brandName).toBe("IGNORE PRIOR INSTRUCTIONS BRAND");
    expect(out[0].fit).toBe(0.99);
  });
});

describe("maya-opportunity-scout — buildCitations", () => {
  it("includes follower-count + niche + location + one citation per surfaced opportunity", () => {
    const ops: Opportunity[] = [
      {
        source: "aspire",
        title: "Aspire Brief A",
        fit: 0.7,
        suggestedAction: "apply",
        reasoning: "x",
        url: "https://aspire.io/a",
      },
      {
        source: "local-brand-search",
        title: "Austin Gym Brand",
        fit: 0.85,
        suggestedAction: "pitch",
        reasoning: "y",
        url: "https://austingym.com",
      },
    ];
    const cites = buildCitations(FITNESS_AUSTIN, ops);
    expect(cites.length).toBeGreaterThanOrEqual(5); // 3 base + 2 ops
    expect(cites.some((c) => c.id === "follower-count")).toBe(true);
    expect(cites.some((c) => c.id === "niche")).toBe(true);
    expect(cites.some((c) => c.id === "location")).toBe(true);
    expect(cites.some((c) => c.id.startsWith("opportunity-"))).toBe(true);
  });

  it("omits location citation when no city", () => {
    const cites = buildCitations(FITNESS_NO_LOCATION, []);
    expect(cites.some((c) => c.id === "location")).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Wave 2 — stage-aware brand-size targeting + smartAlternative routing       */
/* -------------------------------------------------------------------------- */

describe("maya-opportunity-scout — Wave 2 stage-aware queries", () => {
  it("just-starting growthPlan: local query mix uses small/local/startup/indie qualifiers", () => {
    const plan = {
      currentStage: "just-starting" as const,
      nextMilestoneText: "Reach 5K",
      focusAreas: ["niche"],
      antiPatterns: [],
      horizonWeeks: 8,
    };
    const queries = buildScoutQueries(
      {
        creatorPicture: FITNESS_AUSTIN,
        platforms: ["tiktok"],
        lookbackHours: 24,
      },
      plan
    );
    const local = queries.filter((q) => q.source === "local-brand-search");
    const text = local.map((q) => q.query.toLowerCase()).join(" ");
    // Foundational creators: small + indie + startup + best-of qualifiers.
    expect(text).toMatch(/small business|startup|indie/);
  });

  it("scaling growthPlan: local query mix uses regional/national/agency qualifiers", () => {
    const plan = {
      currentStage: "scaling" as const,
      nextMilestoneText: "Hit $100K MRR",
      focusAreas: ["selectivity"],
      antiPatterns: [],
      horizonWeeks: 12,
    };
    const queries = buildScoutQueries(
      {
        creatorPicture: { ...FITNESS_AUSTIN, followerCount: 600_000 },
        platforms: ["tiktok"],
        lookbackHours: 24,
      },
      plan
    );
    const local = queries.filter((q) => q.source === "local-brand-search");
    const text = local.map((q) => q.query.toLowerCase()).join(" ");
    expect(text).toMatch(/regional|national|agency|established/);
  });

  it("no growthPlan: falls back to follower-count inference (small follower = foundational queries)", () => {
    const queries = buildScoutQueries({
      creatorPicture: { ...FITNESS_AUSTIN, followerCount: 5_000 },
      platforms: ["tiktok"],
      lookbackHours: 24,
    });
    const local = queries.filter((q) => q.source === "local-brand-search");
    const text = local.map((q) => q.query.toLowerCase()).join(" ");
    expect(text).toMatch(/small business|startup|indie/);
  });
});

describe("maya-opportunity-scout — Wave 2 fitScoringPrompt routing + stage scoring", () => {
  it("just-starting plan: prompt prioritizes LOCAL + SMALL businesses (NOT national)", () => {
    const plan = {
      currentStage: "just-starting" as const,
      nextMilestoneText: "Reach 5K",
      focusAreas: ["niche"],
      antiPatterns: [],
      horizonWeeks: 8,
    };
    const candidates: BraveScoutResult[] = [
      {
        title: "Local fitness studio in Austin",
        url: "https://example.com/austin-fit",
        description: "Looking for content creators",
        source: "local-brand-search",
      },
    ];
    const p = fitScoringPrompt(FITNESS_AUSTIN, ["tiktok"], candidates, plan);
    expect(p).toMatch(/STAGE: just-starting/);
    expect(p).toMatch(/LOCAL.*SMALL businesses|small.*local/i);
    expect(p).toMatch(/National brands score LOWER/);
  });

  it("scaling plan: prompt prioritizes REGIONAL + NATIONAL brands", () => {
    const plan = {
      currentStage: "scaling" as const,
      nextMilestoneText: "Hit $100K MRR",
      focusAreas: ["selectivity"],
      antiPatterns: [],
      horizonWeeks: 12,
    };
    const p = fitScoringPrompt(
      { ...FITNESS_AUSTIN, followerCount: 600_000 },
      ["tiktok"],
      [],
      plan
    );
    expect(p).toMatch(/STAGE: scaling/);
    expect(p).toMatch(/REGIONAL.*NATIONAL/);
    expect(p).toMatch(/Indie\/startup brands score lower/);
  });

  it("opportunity-scout antiPattern with paired alternative: prompt routes (no refusal)", () => {
    const plan = {
      currentStage: "just-starting" as const,
      nextMilestoneText: "Reach 5K",
      focusAreas: ["niche"],
      antiPatterns: ["UGC marketplace prospecting before niche is locked"],
      smartAlternatives: [
        {
          antiPattern: "UGC marketplace prospecting before niche is locked",
          insteadDoThis: "Watch local brand signal first",
          exampleAction: "Maya scouts 5 local fitness brands and tracks their inbound campaigns weekly",
          reasoning: "Local conversion rate is the foundation",
        },
      ],
      horizonWeeks: 8,
    };
    const p = fitScoringPrompt(FITNESS_AUSTIN, ["tiktok"], [], plan);
    expect(p).toMatch(/ROUTE TO THIS SMART ALTERNATIVE/);
    expect(p).toMatch(/local brand signal/);
    expect(p).toMatch(/INSTEAD/);
  });
});
