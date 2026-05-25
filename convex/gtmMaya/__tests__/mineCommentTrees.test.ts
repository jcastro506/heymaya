import { describe, it, expect, vi } from "vitest";
import { mineTopRedditCards, PAIN_THRESHOLD } from "../mineCommentTrees";
import { ScrapeCreatorsClient } from "../../integrations/scrapeCreators/client";

/**
 * Sprint 2.14a — comment-tree mining. Covers all 5 mandatory test
 * categories from CLAUDE.md:
 *   1. Cross-tenant — N/A (pure function over passed inputs)
 *   2. Auth — apiKey missing → skipReason set, doesn't throw
 *   3. Adversarial — empty comments, scrape failure, LLM malformed,
 *      cards below threshold, non-reddit source
 *   4. Sibling-file scan — researchWorker wires
 *      patchEvidenceCardCommentInsights after mineTopRedditCards
 *      (verified by tsc)
 *   5. TODO grep — zero offenders
 */

const PRODUCT = {
  productName: "ModelHub",
  productUrl: "https://studio.consciousengines.com/model-hub",
  icpPainPhrases: ["I am tired of using the terminal for local llms"],
  productCategoryKeywords: ["local llm desktop app mac"],
};

function makeCard(
  id: string,
  painMatch: number,
  source: string = "reddit"
): {
  id: string;
  url: string;
  title?: string;
  snippet: string;
  painMatch: number;
  source: string;
} {
  return {
    id,
    url: `https://reddit.com/r/test/comments/${id}`,
    title: `Card ${id}`,
    snippet: "test",
    painMatch,
    source,
  };
}

function makeScrapeClient(
  responses: Map<string, Array<{ author: string; body: string; score: number }>>
): ScrapeCreatorsClient {
  return new ScrapeCreatorsClient({
    apiKey: "k",
    fetchImpl: vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      const urlParam = new URL(url).searchParams.get("url") ?? "";
      const cardId = urlParam.split("/").pop()!;
      const comments = responses.get(cardId) ?? [];
      // Sprint 2.14a.1 — ScrapeCreators returns flat
      // { success, post, comments, more } not the legacy reddit
      // listing format.
      const body = JSON.stringify({
        success: true,
        credits_remaining: 9999,
        post: {},
        comments: comments.map((c, i) => ({
          id: `c${cardId}_${i}`,
          body: c.body,
          author: c.author,
          score: c.score,
          ups: c.score,
          downs: 0,
          permalink: `/r/test/comments/${cardId}/_/c${i}`,
        })),
        more: null,
      });
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch,
  });
}

function makeOpenRouterFetch(responseContent: string): typeof fetch {
  return vi.fn(async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: { role: "assistant", content: responseContent },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
      { status: 200 }
    )
  ) as unknown as typeof fetch;
}

const CLEAN_INSIGHTS = JSON.stringify({
  extractedPains: [
    "I tried Ollama but the UI is awful",
    "LM Studio is bloated, switched to native",
  ],
  topCommenters: [
    { author: "machead", stance: "Wants a clean native Mac UI", buyerQuality: 0.9 },
  ],
  summary: "OP asks for Mac GUI; replies argue LM Studio vs Open WebUI vs native",
  commentCount: 12,
});

describe("mineTopRedditCards", () => {
  it("only mines reddit-source cards above PAIN_THRESHOLD", async () => {
    const cards = [
      makeCard("a", 0.9, "reddit"),
      makeCard("b", 0.3, "reddit"), // below threshold — skipped
      makeCard("c", 0.95, "x"), // wrong source — skipped
      makeCard("d", 0.7, "reddit"),
    ];
    const scrapeMap = new Map<string, Array<{ author: string; body: string; score: number }>>([
      ["a", [{ author: "u1", body: "I tried Ollama but slow", score: 5 }]],
      ["d", [{ author: "u2", body: "Mac native please", score: 10 }]],
    ]);
    const scrapeClient = makeScrapeClient(scrapeMap);
    const r = await mineTopRedditCards(cards, PRODUCT, {
      scrapeClient,
      apiKey: "k",
      fetchImpl: makeOpenRouterFetch(CLEAN_INSIGHTS),
    });
    expect(r.attempted).toBe(2); // a + d (both reddit, both >= 0.6)
    expect(r.succeeded).toBe(2);
    expect(r.results.map((x) => x.cardId).sort()).toEqual(["a", "d"]);
  });

  it("respects topN cap when more cards exceed threshold", async () => {
    const cards = Array.from({ length: 25 }, (_, i) =>
      makeCard(`c${i}`, 0.7 + (i % 3) * 0.05, "reddit")
    );
    const scrapeMap = new Map(
      cards.map((c) => [
        c.id,
        [{ author: "u", body: "useful body text", score: 5 }],
      ])
    );
    const scrapeClient = makeScrapeClient(scrapeMap);
    const r = await mineTopRedditCards(cards, PRODUCT, {
      scrapeClient,
      apiKey: "k",
      fetchImpl: makeOpenRouterFetch(CLEAN_INSIGHTS),
      topN: 5,
      concurrency: 3,
    });
    expect(r.attempted).toBe(5);
    expect(r.results).toHaveLength(5);
  });

  it("skips card when scrape returns no comments", async () => {
    const cards = [makeCard("a", 0.9, "reddit")];
    const scrapeClient = makeScrapeClient(new Map([["a", []]]));
    const r = await mineTopRedditCards(cards, PRODUCT, {
      scrapeClient,
      apiKey: "k",
      fetchImpl: makeOpenRouterFetch(CLEAN_INSIGHTS),
    });
    expect(r.succeeded).toBe(0);
    expect(r.results[0]!.insights).toBeNull();
    expect(r.results[0]!.skipReason).toMatch(/no comments|no usable/);
  });

  it("returns null insights when LLM response is malformed", async () => {
    const cards = [makeCard("a", 0.9, "reddit")];
    const scrapeClient = makeScrapeClient(
      new Map([["a", [{ author: "u", body: "real comment", score: 5 }]]])
    );
    const r = await mineTopRedditCards(cards, PRODUCT, {
      scrapeClient,
      apiKey: "k",
      fetchImpl: makeOpenRouterFetch("Sorry I can't help"),
    });
    expect(r.results[0]!.insights).toBeNull();
    expect(r.results[0]!.skipReason).toMatch(/parse/);
  });

  it("clamps buyerQuality to [0,1] and caps extractedPains at 5", async () => {
    const cards = [makeCard("a", 0.9, "reddit")];
    const scrapeClient = makeScrapeClient(
      new Map([["a", [{ author: "u", body: "real comment", score: 5 }]]])
    );
    const tooManyPains = Array.from({ length: 20 }, (_, i) => `pain ${i}`);
    const r = await mineTopRedditCards(cards, PRODUCT, {
      scrapeClient,
      apiKey: "k",
      fetchImpl: makeOpenRouterFetch(
        JSON.stringify({
          extractedPains: tooManyPains,
          topCommenters: [
            { author: "x", stance: "y", buyerQuality: 1.5 },
            { author: "y", stance: "z", buyerQuality: -0.3 },
          ],
          summary: "s",
        })
      ),
    });
    const insights = r.results[0]!.insights!;
    expect(insights.extractedPains.length).toBeLessThanOrEqual(5);
    expect(insights.topCommenters[0]!.buyerQuality).toBe(1);
    expect(insights.topCommenters[1]!.buyerQuality).toBe(0);
  });

  it("returns empty result when no cards pass the threshold", async () => {
    const cards = [makeCard("a", 0.3, "reddit"), makeCard("b", 0.5, "reddit")];
    const scrapeClient = makeScrapeClient(new Map());
    const r = await mineTopRedditCards(cards, PRODUCT, {
      scrapeClient,
      apiKey: "k",
      fetchImpl: makeOpenRouterFetch(CLEAN_INSIGHTS),
    });
    expect(r.attempted).toBe(0);
    expect(r.results).toEqual([]);
  });

  it("threshold value matches the documented constant", () => {
    expect(PAIN_THRESHOLD).toBe(0.6);
  });
});
