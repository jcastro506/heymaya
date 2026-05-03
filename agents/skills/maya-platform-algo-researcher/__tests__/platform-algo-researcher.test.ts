/**
 * Sprint 3.5 — `maya-platform-algo-researcher` unit tests.
 *
 * Pure-logic tests for the helper module. The Convex action that wires
 * Brave + callMaya + platformAlgoCache is tested separately (lead pushes
 * `convex/agents/skills/__tests__/algoResearcher.test.ts`).
 *
 * Coverage:
 *   - happy path: query string assembly, allowlist filter, dedupe, TTL
 *   - adversarial: drive-by Reddit / Twitter / random-tumblr URLs do NOT
 *     pass `isAllowedSource` even when Brave returns them in the top 20
 */

import { describe, it, expect } from "vitest";
import {
  ALLOWED_SOURCE_DOMAINS,
  buildBraveQuery,
  filterAndDedupeResults,
  isAllowedSource,
  pickTtlDays,
  synthesisPrompt,
  type BraveSearchResult,
} from "../script";

describe("maya-platform-algo-researcher — buildBraveQuery", () => {
  it("composes site filter + platform phrase + year (no topic)", () => {
    const q = buildBraveQuery("tiktok", undefined, 2026);
    expect(q).toContain('"tiktok algorithm"');
    expect(q).toContain("2026");
    for (const d of ALLOWED_SOURCE_DOMAINS) {
      expect(q).toContain(`site:${d}`);
    }
  });

  it("appends a quoted topic when provided", () => {
    const q = buildBraveQuery("instagram", "carousels", 2026);
    expect(q).toContain('"carousels"');
    expect(q).toContain('"instagram algorithm"');
  });

  it("is deterministic for the same inputs", () => {
    const a = buildBraveQuery("youtube", "shorts", 2026);
    const b = buildBraveQuery("youtube", "shorts", 2026);
    expect(a).toBe(b);
  });
});

describe("maya-platform-algo-researcher — isAllowedSource", () => {
  it("accepts every allowlisted domain (with and without subdomain)", () => {
    for (const d of ALLOWED_SOURCE_DOMAINS) {
      expect(isAllowedSource(`https://${d}/some-path`)).toBe(true);
      expect(isAllowedSource(`https://www.${d}/path`)).toBe(true);
      expect(isAllowedSource(`https://blog.${d}/x`)).toBe(true);
    }
  });

  it("accepts youtube.com only when path matches an allowlisted channel", () => {
    expect(
      isAllowedSource("https://www.youtube.com/@colinandsamir/videos")
    ).toBe(true);
    expect(isAllowedSource("https://www.youtube.com/watch?v=xyz")).toBe(false);
  });

  it("accepts tumblr.com only for Hank Green's blog", () => {
    expect(isAllowedSource("https://hankgreen.tumblr.com/post/123")).toBe(true);
    expect(isAllowedSource("https://random.tumblr.com/post/456")).toBe(false);
  });

  // ── adversarial ──────────────────────────────────────────────────────
  it("rejects drive-by sources Brave often returns: Reddit, X.com, Medium, random blogs", () => {
    const adversarial = [
      "https://www.reddit.com/r/socialmedia/comments/abc/tiktok_algo_tips",
      "https://x.com/randomuser/status/12345",
      "https://medium.com/@guru/the-tiktok-algorithm-explained",
      "https://wordpress.com/some-blog/tiktok",
      "https://substack.com/@anyone/post",
      "https://news.ycombinator.com/item?id=999",
      "not-even-a-url",
      "",
    ];
    for (const url of adversarial) {
      expect(isAllowedSource(url), `should reject: ${url}`).toBe(false);
    }
  });
});

describe("maya-platform-algo-researcher — filterAndDedupeResults", () => {
  it("happy path: drops non-allowlisted, dedupes, preserves rank order", () => {
    const results: BraveSearchResult[] = [
      { title: "TT algo update", url: "https://tubefilter.com/2026/04/15/tt-update", description: "" },
      { title: "Adversarial reddit", url: "https://www.reddit.com/r/x/1", description: "" },
      // Duplicate of #1 with tracking params + trailing slash
      { title: "TT algo (cached)", url: "https://tubefilter.com/2026/04/15/tt-update/?utm_source=x", description: "" },
      { title: "Variety analysis", url: "https://variety.com/vip/article-123", description: "" },
      { title: "Random sub", url: "https://blog.tubefilter.com/another-post", description: "" },
    ];
    const out = filterAndDedupeResults(results, 10);
    expect(out.map((r) => r.title)).toEqual([
      "TT algo update",
      "Variety analysis",
      "Random sub",
    ]);
  });

  it("respects the limit", () => {
    const lots: BraveSearchResult[] = Array.from({ length: 25 }, (_, i) => ({
      title: `t${i}`,
      url: `https://tubefilter.com/${i}`,
      description: "",
    }));
    expect(filterAndDedupeResults(lots, 5)).toHaveLength(5);
  });
});

describe("maya-platform-algo-researcher — pickTtlDays", () => {
  it("studio gets the freshest cache, starter the stalest", () => {
    expect(pickTtlDays("studio")).toBeLessThan(pickTtlDays("pro"));
    expect(pickTtlDays("pro")).toBeLessThan(pickTtlDays("starter"));
  });
});

describe("maya-platform-algo-researcher — synthesisPrompt", () => {
  it("includes every passage URL and the strict-JSON instruction", () => {
    const prompt = synthesisPrompt(
      "tiktok",
      undefined,
      [
        { url: "https://tubefilter.com/a", text: "Post A says X.", publishedAt: "2026-04-15" },
        { url: "https://variety.com/b", text: "Post B says Y.", publishedAt: "2026-04-12" },
      ]
    );
    expect(prompt).toContain("https://tubefilter.com/a");
    expect(prompt).toContain("https://variety.com/b");
    expect(prompt).toContain("STRICTLY a JSON object");
    expect(prompt).toContain("No fabrication");
  });

  it("notes the topic when provided", () => {
    const prompt = synthesisPrompt("instagram", "carousels", []);
    expect(prompt).toContain("Topic narrowing: carousels");
  });
});
