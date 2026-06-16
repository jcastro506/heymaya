import { describe, expect, it } from "vitest";
import {
  coerceProductPicture,
  generateProductPicture,
} from "../productPicture";

/** Fake an OpenRouter chat-completion HTTP response carrying `content`. */
function fakeOpenRouter(content: string): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({
        model: "google/gemini-3-flash",
        choices: [{ message: { content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 120, completion_tokens: 60, cost: 0.0004 },
      }),
      { status: 200 }
    )) as typeof fetch;
}

const VALID_PICTURE = JSON.stringify({
  promise: "Privacy-friendly web analytics without cookies.",
  whatItDoes: "A lightweight script that reports site traffic in one dashboard.",
  whoItsFor: "Indie founders and small teams who care about privacy.",
  differentiator: "GDPR-friendly, no cookie banner, simple dashboard.",
  category: "Web analytics",
  competitors: ["Google Analytics", "Fathom"],
  pricing: "$9/mo",
  proofPoints: ["10k+ sites tracked"],
  confidence: "high",
  gaps: ["exact pricing tiers above the entry plan"],
  sources: ["plausible.io"],
});

describe("generateProductPicture", () => {
  it("synthesizes a structured picture from a valid model response", async () => {
    const result = await generateProductPicture({
      productName: "Plausible",
      productUrl: "https://plausible.io",
      founderDifferentiator: "No cookies, no banner.",
      apiKey: "test-key",
      fetchImpl: fakeOpenRouter(VALID_PICTURE),
    });
    expect(result.picture.promise).toContain("Privacy-friendly");
    expect(result.picture.category).toBe("Web analytics");
    expect(result.picture.competitors).toContain("Fathom");
    expect(result.picture.confidence).toBe("high");
    expect(result.picture.gaps.length).toBeGreaterThan(0);
    expect(result.model).toBe("google/gemini-3-flash");
    expect(result.usage.costUsd).toBe(0.0004);
  });

  it("parses JSON wrapped in code fences", async () => {
    const fenced = "```json\n" + VALID_PICTURE + "\n```";
    const result = await generateProductPicture({
      productName: "Plausible",
      apiKey: "test-key",
      fetchImpl: fakeOpenRouter(fenced),
    });
    expect(result.picture.category).toBe("Web analytics");
  });

  it("parses JSON with leading model prose before the object", async () => {
    const noisy = "Here is the picture you asked for:\n" + VALID_PICTURE;
    const result = await generateProductPicture({
      productName: "Plausible",
      apiKey: "test-key",
      fetchImpl: fakeOpenRouter(noisy),
    });
    expect(result.picture.differentiator).toContain("cookie");
  });

  it("throws on missing apiKey", async () => {
    await expect(
      generateProductPicture({ productName: "X", apiKey: "" })
    ).rejects.toThrow(/apiKey is required/);
  });

  it("throws a clear error on unparseable output", async () => {
    await expect(
      generateProductPicture({
        productName: "X",
        apiKey: "test-key",
        fetchImpl: fakeOpenRouter("not json at all"),
      })
    ).rejects.toThrow(/not valid JSON/);
  });
});

describe("coerceProductPicture", () => {
  it("clamps arrays, defaults confidence to low, and nulls blank pricing", () => {
    const picture = coerceProductPicture({
      promise: "p",
      competitors: Array.from({ length: 30 }, (_, i) => `c${i}`),
      pricing: "   ",
      confidence: "bogus",
      gaps: ["only this"],
      proofPoints: [1, 2, "real"], // non-strings dropped
    });
    expect(picture.competitors).toHaveLength(12);
    expect(picture.pricing).toBeNull();
    expect(picture.confidence).toBe("low");
    expect(picture.proofPoints).toEqual(["real"]);
    expect(picture.whoItsFor).toBe(""); // missing field → empty string, not crash
  });

  it("handles a completely empty / garbage object without throwing", () => {
    expect(() => coerceProductPicture(null)).not.toThrow();
    const p = coerceProductPicture("nonsense");
    expect(p.confidence).toBe("low");
    expect(p.competitors).toEqual([]);
  });
});
