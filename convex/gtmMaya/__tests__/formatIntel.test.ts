import { describe, expect, it, vi } from "vitest";
import {
  extractWorkingFormatsForChannel,
  extractWorkingFormats,
  type FormatExtractionInput,
} from "../formatIntel";

/** A fake fetch that returns one OpenRouter chat completion whose content is
 * the given JSON string, and records the user message it was called with. */
function mockOpenRouter(contentJson: string) {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (_url: string, init?: { body?: string }) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    const userMsg = (body.messages ?? []).find(
      (m: { role: string }) => m.role === "user"
    );
    calls.push(userMsg?.content ?? "");
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: contentJson } }],
        usage: { prompt_tokens: 100, completion_tokens: 50, cost: 0.0002 },
      }),
    } as unknown as Response;
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

function card(
  source: string,
  views: number,
  overrides: Partial<FormatExtractionInput> = {}
): FormatExtractionInput {
  return {
    id: `${source}-${views}`,
    source,
    url: `https://${source}.test/video/${views}`,
    snippet: `a ${source} post`,
    engagement: { views, likes: Math.round(views / 10) },
    ...overrides,
  };
}

const FORMATS_JSON = JSON.stringify({
  formats: [
    {
      formatName: "Plant-death confession → rescue POV",
      description: "Hook with a dying plant, reveal the app saves it.",
      whyItWorks: "Confession hooks + payoff drive saves.",
      exemplarUrl: "https://tiktok.test/video/281000",
      exemplarHook: "I killed 12 plants this year. Then this happened.",
      engagementSignal: "281k views",
    },
  ],
});

describe("extractWorkingFormatsForChannel", () => {
  it("ranks by engagement and feeds the top performer to the LLM", async () => {
    const { fetchImpl, calls } = mockOpenRouter(FORMATS_JSON);
    const cards = [
      card("tiktok", 5_000),
      card("tiktok", 281_000), // the winner — must be #1 in the prompt
      card("tiktok", 40_000),
    ];
    const res = await extractWorkingFormatsForChannel(
      "tiktok",
      cards,
      { productName: "Greg", productUrl: "https://greg.app" },
      { apiKey: "test-key", fetchImpl }
    );
    expect(res.formats).toHaveLength(1);
    expect(res.formats[0].formatName).toContain("rescue POV");
    expect(res.costUsd).toBeCloseTo(0.0002, 6);
    // The highest-engagement post is presented first (ranking works).
    expect(calls[0].indexOf("281k views")).toBeLessThan(
      calls[0].indexOf("5k views")
    );
  });

  it("skips a channel with too few cards", async () => {
    const { fetchImpl } = mockOpenRouter(FORMATS_JSON);
    const res = await extractWorkingFormatsForChannel(
      "youtube",
      [card("youtube", 1000)],
      { productName: "Greg", productUrl: "https://greg.app" },
      { apiKey: "test-key", fetchImpl }
    );
    expect(res.formats).toEqual([]);
    expect(res.skipReason).toContain("only 1");
  });

  it("returns [] without an API key (never throws)", async () => {
    const res = await extractWorkingFormatsForChannel(
      "tiktok",
      [card("tiktok", 100), card("tiktok", 200)],
      { productName: "Greg", productUrl: "https://greg.app" },
      { apiKey: "" }
    );
    expect(res.formats).toEqual([]);
    expect(res.skipReason).toContain("OPENROUTER");
  });

  it("survives malformed LLM output (returns [])", async () => {
    const { fetchImpl } = mockOpenRouter("not json at all");
    const res = await extractWorkingFormatsForChannel(
      "tiktok",
      [card("tiktok", 100), card("tiktok", 200)],
      { productName: "Greg", productUrl: "https://greg.app" },
      { apiKey: "test-key", fetchImpl }
    );
    expect(res.formats).toEqual([]);
  });
});

describe("extractWorkingFormats (all channels)", () => {
  it("only returns channels that yielded formats; ignores non-video sources", async () => {
    const { fetchImpl } = mockOpenRouter(FORMATS_JSON);
    const cards = [
      card("tiktok", 100_000),
      card("tiktok", 50_000),
      card("reddit", 9_999), // not a video channel — never extracted
      card("x", 8_000),
    ];
    const res = await extractWorkingFormats(
      cards,
      { productName: "Greg", productUrl: "https://greg.app" },
      { apiKey: "test-key", fetchImpl }
    );
    expect(Object.keys(res.byChannel)).toEqual(["tiktok"]);
    expect(res.byChannel.tiktok).toHaveLength(1);
    expect(res.costUsd).toBeGreaterThan(0);
  });
});
