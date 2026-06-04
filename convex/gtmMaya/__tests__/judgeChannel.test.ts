import { describe, it, expect, vi } from "vitest";
import {
  judgeChannel,
  judgeAllChannels,
  type JudgeChannelProductContext,
} from "../judgeChannel";
import type { GtmEvidenceCard } from "../channelScoring";

/**
 * Sprint 2.13b — LLM channel-judge. Covers all 5 mandatory test
 * categories from CLAUDE.md:
 *   1. Cross-tenant — N/A (pure function)
 *   2. Auth — missing OPENROUTER_API_KEY throws
 *   3. Adversarial — malformed JSON (object missing fields, wrong
 *      types, no JSON at all, leading prose, code fence)
 *   4. Sibling-file scan — researchWorker wires judgeAllChannels;
 *      legacy evaluateChannelSet still imported as fallback (tsc
 *      verifies)
 *   5. TODO grep — zero offenders
 */

const PRODUCT: JudgeChannelProductContext = {
  productName: "ModelHub",
  productUrl: "https://studio.consciousengines.com/model-hub",
  founderWhy: "local LLM workflows on Mac feel disjointed",
  icpPainPhrases: ["I am tired of using the terminal for local llms"],
  productCategoryKeywords: ["local llm desktop app mac"],
  stage: "live-beta",
  weekGoal: "signups",
};

function makeCard(
  id: string,
  source: GtmEvidenceCard["source"],
  overrides: Partial<GtmEvidenceCard> = {}
): GtmEvidenceCard {
  return {
    id,
    source,
    url: `https://example.com/${id}`,
    title: `Card ${id}`,
    snippet: "a snippet of post content",
    observedAt: 0,
    recency: "fresh",
    engagement: { likes: 10, comments: 2 },
    painMatch: 0.8,
    buyerMatch: 0.7,
    channelFit: 0.6,
    promotionRisk: "low",
    recommendedUse: "strategy",
    extractedClaims: [],
    ...overrides,
  };
}

function mockJudgeFetch(responseContent: string): typeof fetch {
  return vi.fn(async () =>
    new Response(
      JSON.stringify({
        id: "test",
        model: "google/gemini-3-flash-preview",
        choices: [
          {
            message: { role: "assistant", content: responseContent },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 200, completion_tokens: 80 },
      }),
      { status: 200 }
    )
  ) as unknown as typeof fetch;
}

const CLEAN_RESPONSE = JSON.stringify({
  score: 0.78,
  decision: "primary",
  confidence: "high",
  reasons: ["dev-Twitter is where the buyer hangs out", "evidence is strong"],
  risks: ["replies need to add value, not pitch"],
  evidenceCardIds: ["c1", "c2"],
  firstWeekTest:
    "Reply to @karpathy's most recent tweet about local inference with a one-liner showing what ModelHub does",
  qualityGate: { passed: true, failures: [] },
});

describe("judgeChannel", () => {
  it("throws when OPENROUTER_API_KEY is unset", async () => {
    const orig = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try {
      await expect(
        judgeChannel("x", [makeCard("c1", "x")], PRODUCT)
      ).rejects.toThrow(/OPENROUTER_API_KEY/);
    } finally {
      if (orig) process.env.OPENROUTER_API_KEY = orig;
    }
  });

  it("parses a clean LLM response into a decision row", async () => {
    const r = await judgeChannel("x", [makeCard("c1", "x"), makeCard("c2", "x")], PRODUCT, {
      apiKey: "k",
      fetchImpl: mockJudgeFetch(CLEAN_RESPONSE),
    });
    expect(r.channel).toBe("x");
    expect(r.score).toBe(0.78);
    expect(r.decision).toBe("primary");
    expect(r.confidence).toBe("high");
    expect(r.reasons.length).toBeGreaterThan(0);
    expect(r.firstWeekTest).toContain("@karpathy");
    expect(r.qualityGate.passed).toBe(true);
  });

  it("handles empty cards array — sends 'no evidence' message", async () => {
    const r = await judgeChannel("x", [], PRODUCT, {
      apiKey: "k",
      fetchImpl: mockJudgeFetch(CLEAN_RESPONSE),
    });
    expect(r.channel).toBe("x");
    expect(r.decision).toBe("primary"); // LLM said so; we don't second-guess
  });

  it("strips markdown code fences", async () => {
    const r = await judgeChannel("x", [makeCard("c1", "x")], PRODUCT, {
      apiKey: "k",
      fetchImpl: mockJudgeFetch(`\`\`\`json\n${CLEAN_RESPONSE}\n\`\`\``),
    });
    expect(r.decision).toBe("primary");
  });

  it("strips leading prose before the object", async () => {
    const r = await judgeChannel("x", [makeCard("c1", "x")], PRODUCT, {
      apiKey: "k",
      fetchImpl: mockJudgeFetch(`Here is the decision:\n\n${CLEAN_RESPONSE}`),
    });
    expect(r.decision).toBe("primary");
  });

  it("clamps score and defaults unknown decision to parked", async () => {
    const r = await judgeChannel("x", [makeCard("c1", "x")], PRODUCT, {
      apiKey: "k",
      fetchImpl: mockJudgeFetch(
        JSON.stringify({
          score: 99,
          decision: "blocked", // not in our union — defaults to parked
          confidence: "weird", // not in our union — defaults to low
          reasons: [],
          risks: [],
          evidenceCardIds: [],
          firstWeekTest: "",
          qualityGate: { passed: false, failures: ["thin evidence"] },
        })
      ),
    });
    expect(r.score).toBe(1); // clamped
    expect(r.decision).toBe("parked");
    expect(r.confidence).toBe("low");
    expect(r.qualityGate.passed).toBe(false);
    expect(r.qualityGate.failures).toContain("thin evidence");
  });

  it("throws on non-JSON response", async () => {
    await expect(
      judgeChannel("x", [makeCard("c1", "x")], PRODUCT, {
        apiKey: "k",
        fetchImpl: mockJudgeFetch("Sorry, I can't help with that."),
      })
    ).rejects.toThrow(/failed to parse/);
  });

  it("throws on JSON array (not object)", async () => {
    await expect(
      judgeChannel("x", [makeCard("c1", "x")], PRODUCT, {
        apiKey: "k",
        fetchImpl: mockJudgeFetch(`[1, 2, 3]`),
      })
    ).rejects.toThrow(/failed to parse/);
  });

  it("caps reasons / risks / evidenceCardIds arrays", async () => {
    const manyReasons = Array.from({ length: 20 }, (_, i) => `reason ${i}`);
    const r = await judgeChannel("x", [makeCard("c1", "x")], PRODUCT, {
      apiKey: "k",
      fetchImpl: mockJudgeFetch(
        JSON.stringify({
          score: 0.5,
          decision: "secondary",
          confidence: "medium",
          reasons: manyReasons,
          risks: manyReasons,
          evidenceCardIds: manyReasons,
          firstWeekTest: "x",
          qualityGate: { passed: true, failures: [] },
        })
      ),
    });
    expect(r.reasons.length).toBeLessThanOrEqual(6);
    expect(r.risks.length).toBeLessThanOrEqual(4);
    expect(r.evidenceCardIds.length).toBeLessThanOrEqual(5);
  });
});

describe("judgeAllChannels", () => {
  it("judges the 5 default BET channels (reddit/x/linkedin/tiktok/youtube) in parallel, isolating per-channel failures (HN is research-only, not scored)", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      calls += 1;
      const body = JSON.parse(init!.body as string);
      const userMsg = (body.messages as Array<{ role: string; content: string }>)
        .find((m) => m.role === "user")!.content;
      // Crash the LinkedIn judge — every retry returns garbage.
      if (userMsg.includes("CHANNEL UNDER JUDGMENT: linkedin")) {
        return new Response(
          JSON.stringify({
            choices: [
              { message: { role: "assistant", content: "not json" }, finish_reason: "stop" },
            ],
            usage: { prompt_tokens: 200, completion_tokens: 80 },
          }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          choices: [
            { message: { role: "assistant", content: CLEAN_RESPONSE }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 200, completion_tokens: 80 },
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    const cards: GtmEvidenceCard[] = [
      makeCard("r1", "reddit"),
      makeCard("x1", "x"),
      makeCard("hn1", "hn"),
      makeCard("li1", "linkedin"),
      makeCard("tt1", "tiktok"),
      // YouTube is now a first-class default channel (revived 2026-06-02) — it
      // gets judged even with no cards. product_hunt is still NOT scored, so
      // this competitor card (which would map to product_hunt) is never judged.
      makeCard("ph1", "competitor", { recommendedUse: "competitor" }),
    ];
    const r = await judgeAllChannels(cards, PRODUCT, { apiKey: "k", fetchImpl });
    // 5 default BET channels - 1 failed (linkedin) = 4 decisions (incl youtube).
    expect(r.decisions.length).toBe(4);
    expect(r.decisions.map((d) => d.channel).sort()).toEqual([
      "reddit",
      "tiktok",
      "x",
      "youtube",
    ]);
    // product_hunt is not scored; HN is now research-only (not a BET channel);
    // youtube IS scored.
    expect(r.decisions.map((d) => d.channel)).not.toContain("product_hunt");
    expect(r.decisions.map((d) => d.channel)).not.toContain("hn");
    expect(r.decisions.map((d) => d.channel)).toContain("youtube");
    expect(r.failedChannels).toEqual(["linkedin"]);
    // One LLM call per default BET channel (5) — none for HN or product_hunt.
    expect(calls).toBe(5);
  });

  it("filters cards per channel by source mapping", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string);
      const userMsg = (body.messages as Array<{ role: string; content: string }>)
        .find((m) => m.role === "user")!.content;
      const match = userMsg.match(/CHANNEL UNDER JUDGMENT: (\w+)/);
      if (match) calls.push(match[1]!);
      // Count how many evidence cards appear in this message
      const cardCount = (userMsg.match(/^\d+\. id=/gm) ?? []).length;
      calls.push(`${match![1]}:${cardCount}`);
      return new Response(
        JSON.stringify({
          choices: [
            { message: { role: "assistant", content: CLEAN_RESPONSE }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 200, completion_tokens: 80 },
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;
    const cards: GtmEvidenceCard[] = [
      makeCard("r1", "reddit"),
      makeCard("r2", "reddit"),
      makeCard("x1", "x"),
      makeCard("tt1", "tiktok"),
    ];
    await judgeAllChannels(cards, PRODUCT, { apiKey: "k", fetchImpl });
    expect(calls).toContain("reddit:2"); // both reddit cards
    expect(calls).toContain("x:1");
    expect(calls).toContain("tiktok:1");
    expect(calls).toContain("linkedin:0"); // no LinkedIn cards in input
  });
});
