import { describe, it, expect, vi } from "vitest";
import {
  scoreCardsBatch,
  scoreAllCardsForProduct,
  BATCH_SIZE,
  type CardForScoring,
  type ProductContextForScoring,
} from "../judgeCardsBatch";

/**
 * Sprint 2.13a — LLM batched card scorer. Covers the 5 mandatory
 * test categories from CLAUDE.md:
 * 1. Cross-tenant — N/A (pure function over passed inputs)
 * 2. Auth — apiKey missing throws cleanly
 * 3. Adversarial — malformed LLM responses (markdown fences, leading
 *    prose, non-array, missing IDs, non-numeric scores)
 * 4. Sibling-file scan — researchWorker.ts wires patchEvidenceCardScores
 *    after scoreAllCardsForProduct returns (verified by tsc, not
 *    explicit here)
 * 5. TODO grep — zero offenders in judgeCardsBatch.ts
 */

const PRODUCT: ProductContextForScoring = {
  productName: "ModelHub",
  productUrl: "https://studio.consciousengines.com/model-hub",
  founderWhy: "local LLM workflows on Mac feel disjointed",
  icpPainPhrases: ["I am tired of using the terminal for local llms"],
  productCategoryKeywords: ["local llm desktop app mac"],
};

const CARDS: CardForScoring[] = [
  {
    id: "card1",
    source: "reddit",
    title: "Best Mac GUI for ollama?",
    snippet: "I'm tired of CLI for local LLMs on my M3 — what's the best free desktop wrapper for ollama these days?",
    author: "machead",
    engagement: { upvotes: 45, comments: 12 },
  },
  {
    id: "card2",
    source: "reddit",
    title: "From 2019 Dell to MacBook Pro M5",
    snippet: "Just switched to Mac, here's my unboxing experience.",
    author: "newmacuser",
    engagement: { upvotes: 803, comments: 50 },
  },
];

function mockFetch(responseContent: string): typeof fetch {
  return vi.fn(async () =>
    new Response(
      JSON.stringify({
        id: "test",
        model: "google/gemini-3-flash-lite",
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

describe("scoreCardsBatch — single batch", () => {
  it("returns empty result for empty input", async () => {
    const r = await scoreCardsBatch([], PRODUCT, { apiKey: "k" });
    expect(r.scores).toEqual([]);
    expect(r.missingIds).toEqual([]);
  });

  it("throws when OPENROUTER_API_KEY is not set", async () => {
    const orig = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try {
      await expect(scoreCardsBatch(CARDS, PRODUCT)).rejects.toThrow(
        /OPENROUTER_API_KEY/
      );
    } finally {
      if (orig) process.env.OPENROUTER_API_KEY = orig;
    }
  });

  it("parses a clean JSON-array response", async () => {
    const fetchImpl = mockFetch(
      `[
        {"id":"card1","painMatch":0.9,"buyerMatch":0.8,"channelFit":0.85,"reason":"asks specifically about Mac GUI for ollama, exact ModelHub buyer"},
        {"id":"card2","painMatch":0.05,"buyerMatch":0.2,"channelFit":0.4,"reason":"off-topic Mac switch story, no LLM mention"}
      ]`
    );
    const r = await scoreCardsBatch(CARDS, PRODUCT, {
      apiKey: "k",
      fetchImpl,
    });
    expect(r.scores).toHaveLength(2);
    expect(r.scores[0]!.painMatch).toBe(0.9);
    expect(r.scores[0]!.reason).toContain("ollama");
    expect(r.scores[1]!.painMatch).toBe(0.05);
    expect(r.missingIds).toEqual([]);
  });

  it("strips markdown code fences from response", async () => {
    const fetchImpl = mockFetch(
      '```json\n[{"id":"card1","painMatch":0.7,"buyerMatch":0.6,"channelFit":0.5,"reason":"ok"}]\n```'
    );
    const r = await scoreCardsBatch([CARDS[0]!], PRODUCT, {
      apiKey: "k",
      fetchImpl,
    });
    expect(r.scores).toHaveLength(1);
    expect(r.scores[0]!.painMatch).toBe(0.7);
  });

  it("strips leading prose before the JSON array", async () => {
    const fetchImpl = mockFetch(
      'Sure! Here are the scores:\n\n[{"id":"card1","painMatch":0.5,"buyerMatch":0.5,"channelFit":0.5,"reason":"x"}]'
    );
    const r = await scoreCardsBatch([CARDS[0]!], PRODUCT, {
      apiKey: "k",
      fetchImpl,
    });
    expect(r.scores).toHaveLength(1);
    expect(r.scores[0]!.painMatch).toBe(0.5);
  });

  it("clamps out-of-range scores to [0, 1]", async () => {
    const fetchImpl = mockFetch(
      '[{"id":"card1","painMatch":1.5,"buyerMatch":-0.3,"channelFit":"bad","reason":"x"}]'
    );
    const r = await scoreCardsBatch([CARDS[0]!], PRODUCT, {
      apiKey: "k",
      fetchImpl,
    });
    expect(r.scores[0]!.painMatch).toBe(1);
    expect(r.scores[0]!.buyerMatch).toBe(0);
    expect(r.scores[0]!.channelFit).toBe(0);
  });

  it("reports missing IDs when LLM drops cards from the response", async () => {
    const fetchImpl = mockFetch(
      '[{"id":"card1","painMatch":0.5,"buyerMatch":0.5,"channelFit":0.5,"reason":"x"}]'
    );
    const r = await scoreCardsBatch(CARDS, PRODUCT, {
      apiKey: "k",
      fetchImpl,
    });
    expect(r.scores).toHaveLength(1);
    expect(r.missingIds).toEqual(["card2"]);
  });

  it("drops rows missing an id field", async () => {
    const fetchImpl = mockFetch(
      '[{"painMatch":0.5,"buyerMatch":0.5,"channelFit":0.5,"reason":"no id"},{"id":"card1","painMatch":0.7,"buyerMatch":0.7,"channelFit":0.7,"reason":"ok"}]'
    );
    const r = await scoreCardsBatch([CARDS[0]!], PRODUCT, {
      apiKey: "k",
      fetchImpl,
    });
    expect(r.scores).toHaveLength(1);
    expect(r.scores[0]!.id).toBe("card1");
  });

  it("throws on non-JSON response", async () => {
    const fetchImpl = mockFetch("Sorry, I cannot do that.");
    await expect(
      scoreCardsBatch([CARDS[0]!], PRODUCT, { apiKey: "k", fetchImpl })
    ).rejects.toThrow(/failed to parse/);
  });

  it("throws on JSON object with no array (no [ in response)", async () => {
    // Parser strips any [ ... ] window it finds. A response with NO
    // brackets at all is the real "non-array" case.
    const fetchImpl = mockFetch('{"scores":"empty"}');
    await expect(
      scoreCardsBatch([CARDS[0]!], PRODUCT, { apiKey: "k", fetchImpl })
    ).rejects.toThrow();
  });

  it("truncates long reasons to 240 chars", async () => {
    const longReason = "a".repeat(500);
    const fetchImpl = mockFetch(
      `[{"id":"card1","painMatch":0.5,"buyerMatch":0.5,"channelFit":0.5,"reason":"${longReason}"}]`
    );
    const r = await scoreCardsBatch([CARDS[0]!], PRODUCT, {
      apiKey: "k",
      fetchImpl,
    });
    expect(r.scores[0]!.reason.length).toBe(240);
  });
});

describe("scoreAllCardsForProduct — batched + bounded concurrency", () => {
  it("splits large input into BATCH_SIZE chunks", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      calls += 1;
      const body = JSON.parse(init!.body as string);
      const userMsg = (body.messages as Array<{ role: string; content: string }>)
        .find((m) => m.role === "user")!.content;
      const ids = [...userMsg.matchAll(/id=(card\d+)/g)].map((m) => m[1]);
      const scores = ids.map((id) => ({
        id,
        painMatch: 0.5,
        buyerMatch: 0.5,
        channelFit: 0.5,
        reason: "x",
      }));
      return new Response(
        JSON.stringify({
          choices: [
            { message: { role: "assistant", content: JSON.stringify(scores) }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    const cards: CardForScoring[] = Array.from({ length: 60 }, (_, i) => ({
      id: `card${i}`,
      source: "reddit",
      title: `Title ${i}`,
      snippet: `Snippet ${i}`,
    }));
    const r = await scoreAllCardsForProduct(cards, PRODUCT, {
      apiKey: "k",
      fetchImpl,
      concurrency: 5,
    });
    expect(r.batchCount).toBe(Math.ceil(60 / BATCH_SIZE));
    expect(calls).toBe(r.batchCount);
    expect(r.scores).toHaveLength(60);
  });

  it("one batch failure does not kill the rest (parse-error path)", async () => {
    // Inspect the request body to detect which batch this is — if the
    // batch contains card0..card24, return garbage so the parser
    // throws; otherwise return valid scores. This way every call
    // for batch 1 fails (no retry can save it) but batch 2 succeeds.
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string);
      const userMsg = (body.messages as Array<{ role: string; content: string }>)
        .find((m) => m.role === "user")!.content;
      const ids = [...userMsg.matchAll(/id=(card\d+)/g)].map((m) => m[1]!);
      const isBatch1 = ids.includes("card0");
      if (isBatch1) {
        return new Response(
          JSON.stringify({
            choices: [
              { message: { role: "assistant", content: "not json at all" }, finish_reason: "stop" },
            ],
            usage: { prompt_tokens: 100, completion_tokens: 50 },
          }),
          { status: 200 }
        );
      }
      const scores = ids.map((id) => ({
        id,
        painMatch: 0.5,
        buyerMatch: 0.5,
        channelFit: 0.5,
        reason: "x",
      }));
      return new Response(
        JSON.stringify({
          choices: [
            { message: { role: "assistant", content: JSON.stringify(scores) }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    const cards: CardForScoring[] = Array.from({ length: 50 }, (_, i) => ({
      id: `card${i}`,
      source: "reddit",
      title: `Title ${i}`,
      snippet: `Snippet ${i}`,
    }));
    const r = await scoreAllCardsForProduct(cards, PRODUCT, {
      apiKey: "k",
      fetchImpl,
      concurrency: 2,
    });
    expect(r.scores.length).toBe(25);
    expect(r.missingIds.length).toBe(25);
  });
});
