/**
 * Sprint 3.5 — `maya-industry-intel` unit tests.
 *
 * Pure-logic tests. Convex action wiring tested separately by the lead.
 *
 * Coverage:
 *   - happy path: query assembly, dedupe filter, threshold + ranking,
 *     model-output parser
 *   - adversarial: malformed model output (extra pipes, missing fields,
 *     wrong index, score out of range) is silently dropped, never crashes,
 *     never produces fake items
 */

import { describe, it, expect } from "vitest";
import {
  ALLOWED_SOURCE_DOMAINS,
  buildNewsQuery,
  canonicalize,
  defaultMaxItems,
  dropSeen,
  filterAndRank,
  parseScoredLines,
  scoringPrompt,
  type BraveNewsResult,
  type ScoredItem,
} from "../script";

describe("maya-industry-intel — buildNewsQuery", () => {
  it("composes site filter + creator economy + year", () => {
    const q = buildNewsQuery(2026);
    for (const d of ALLOWED_SOURCE_DOMAINS) {
      expect(q).toContain(`site:${d}`);
    }
    expect(q).toContain('"creator economy"');
    expect(q).toContain("2026");
  });
});

describe("maya-industry-intel — defaultMaxItems", () => {
  it("Studio surfaces strictly more than Pro; Starter is gated to 0", () => {
    expect(defaultMaxItems("starter")).toBe(0);
    expect(defaultMaxItems("studio")).toBeGreaterThan(defaultMaxItems("pro"));
  });
});

describe("maya-industry-intel — dropSeen", () => {
  it("drops URLs in the seen set, keeps fresh ones", () => {
    const candidates: BraveNewsResult[] = [
      { title: "A", url: "https://www.tubefilter.com/2026/04/15/a", description: "", publishedAt: "2026-04-15", source: "Tubefilter" },
      { title: "B", url: "https://www.morningbrew.com/marketing/2026/04/14/b", description: "", publishedAt: "2026-04-14", source: "Marketing Brew" },
    ];
    const seen = new Set<string>([
      canonicalize("https://www.tubefilter.com/2026/04/15/a"),
    ]);
    const out = dropSeen(candidates, seen);
    expect(out.map((c) => c.title)).toEqual(["B"]);
  });

  it("drops non-allowlisted candidates regardless of seen", () => {
    const candidates: BraveNewsResult[] = [
      { title: "Reddit", url: "https://www.reddit.com/r/x/1", description: "", publishedAt: "2026-04-15", source: "Reddit" },
    ];
    expect(dropSeen(candidates, new Set())).toHaveLength(0);
  });

  // ── adversarial ──────────────────────────────────────────────────────
  it("dedupes URLs that differ only in query params / trailing slash", () => {
    const candidates: BraveNewsResult[] = [
      { title: "A", url: "https://www.tubefilter.com/2026/04/15/a", description: "", publishedAt: "2026-04-15", source: "Tubefilter" },
      { title: "A again", url: "https://www.tubefilter.com/2026/04/15/a/?utm_source=brief", description: "", publishedAt: "2026-04-15", source: "Tubefilter" },
    ];
    const seen = new Set<string>([
      canonicalize("https://www.tubefilter.com/2026/04/15/a"),
    ]);
    const out = dropSeen(candidates, seen);
    expect(out).toHaveLength(0); // both forms canonicalize identically
  });
});

describe("maya-industry-intel — filterAndRank", () => {
  it("filters by threshold, sorts descending, caps to maxItems", () => {
    const scored: ScoredItem[] = [
      { headline: "low", source: "x", url: "https://tubefilter.com/1", publishedAt: "2026-04-15", relevanceToCreator: "", relevanceScore: 30 },
      { headline: "high", source: "x", url: "https://tubefilter.com/2", publishedAt: "2026-04-15", relevanceToCreator: "", relevanceScore: 92 },
      { headline: "mid", source: "x", url: "https://tubefilter.com/3", publishedAt: "2026-04-15", relevanceToCreator: "", relevanceScore: 65 },
      { headline: "tophit", source: "x", url: "https://tubefilter.com/4", publishedAt: "2026-04-15", relevanceToCreator: "", relevanceScore: 99 },
    ];
    const out = filterAndRank(scored, { relevanceThreshold: 50, maxItems: 2 });
    expect(out.map((s) => s.headline)).toEqual(["tophit", "high"]);
  });

  it("returns [] when nothing crosses threshold", () => {
    const scored: ScoredItem[] = [
      { headline: "low", source: "x", url: "https://tubefilter.com/1", publishedAt: "2026-04-15", relevanceToCreator: "", relevanceScore: 10 },
    ];
    expect(filterAndRank(scored, { relevanceThreshold: 50, maxItems: 5 })).toEqual([]);
  });
});

describe("maya-industry-intel — parseScoredLines", () => {
  const candidates: BraveNewsResult[] = [
    { title: "Headline A", url: "https://tubefilter.com/1", description: "", publishedAt: "2026-04-15", source: "Tubefilter" },
    { title: "Headline B", url: "https://tubefilter.com/2", description: "", publishedAt: "2026-04-14", source: "Tubefilter" },
  ];

  it("parses well-formed pipe-delimited lines", () => {
    const raw = [
      "0|85|Big deal for your niche.",
      "1|45|Tangentially related.",
    ].join("\n");
    const out = parseScoredLines(raw, candidates);
    expect(out).toHaveLength(2);
    expect(out[0].relevanceScore).toBe(85);
    expect(out[0].headline).toBe("Headline A");
    expect(out[1].relevanceToCreator).toBe("Tangentially related.");
  });

  it("preserves pipes inside the relevance text (rejoins parts after [2])", () => {
    const raw = "0|70|This matters because A | B and also C.";
    const out = parseScoredLines(raw, candidates);
    expect(out[0].relevanceToCreator).toBe("This matters because A | B and also C.");
  });

  // ── adversarial ──────────────────────────────────────────────────────
  it("silently drops malformed lines (missing fields, NaN score, out-of-range idx)", () => {
    const raw = [
      "garbage line with no pipes",
      "0|notanumber|whoops",
      "99|50|index out of range",
      "0|150|score over 100",
      "1|55|valid one",
      "", // empty
    ].join("\n");
    const out = parseScoredLines(raw, candidates);
    expect(out).toHaveLength(1);
    expect(out[0].headline).toBe("Headline B");
  });

  it("returns [] on completely empty model output (no fabrication)", () => {
    expect(parseScoredLines("", candidates)).toEqual([]);
  });
});

describe("maya-industry-intel — scoringPrompt", () => {
  it("includes niche, platforms, and every candidate's URL", () => {
    const prompt = scoringPrompt(
      "fitness",
      ["tiktok", "instagram"],
      [
        { title: "A", url: "https://tubefilter.com/1", description: "snippet a", publishedAt: "2026-04-15", source: "Tubefilter" },
      ]
    );
    expect(prompt).toContain("fitness");
    expect(prompt).toContain("tiktok");
    expect(prompt).toContain("instagram");
    expect(prompt).toContain("https://tubefilter.com/1");
    expect(prompt).toContain("pipe-delimited");
  });
});
