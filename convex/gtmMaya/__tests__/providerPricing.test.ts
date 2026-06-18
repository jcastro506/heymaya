import { describe, it, expect } from "vitest";
import {
  priceUsd,
  SCRAPECREATORS_PER_CALL_USD,
  X_API_PER_TWEET_USD,
  X_API_CALL_FLOOR_USD,
  DATAFORSEO_SERP_PER_REQ_USD,
  DATAFORSEO_LABS_PER_REQ_USD,
  DATAFORSEO_LABS_PER_KEYWORD_USD,
} from "../providerPricing";

describe("providerPricing.priceUsd", () => {
  describe("scrapecreators — flat per call", () => {
    it("defaults to 1 call when units omitted", () => {
      expect(priceUsd("scrapecreators")).toBeCloseTo(SCRAPECREATORS_PER_CALL_USD, 10);
      expect(priceUsd("scrapecreators")).toBeCloseTo(0.00188, 10);
    });

    it("scales linearly with call count", () => {
      expect(priceUsd("scrapecreators", 1)).toBeCloseTo(0.00188, 10);
      expect(priceUsd("scrapecreators", 3)).toBeCloseTo(0.00188 * 3, 10);
      expect(priceUsd("scrapecreators", 10)).toBeCloseTo(0.0188, 10);
    });

    it("zero calls → zero cost (a failed/unbilled call)", () => {
      expect(priceUsd("scrapecreators", 0)).toBe(0);
    });

    it("is case-insensitive on provider", () => {
      expect(priceUsd("ScrapeCreators", 1)).toBeCloseTo(0.00188, 10);
    });
  });

  describe("x_api (TwitterAPI.io) — per returned tweet with floor", () => {
    it("prices per returned tweet above the floor", () => {
      expect(priceUsd("x_api", 100)).toBeCloseTo(100 * X_API_PER_TWEET_USD, 10);
      expect(priceUsd("x_api", 100)).toBeCloseTo(0.015, 10);
    });

    it("0 tweets returned → 15-credit floor, NOT 0", () => {
      expect(priceUsd("x_api", 0)).toBeCloseTo(X_API_CALL_FLOOR_USD, 10);
      expect(priceUsd("x_api", 0)).toBeCloseTo(0.00015, 10);
      expect(priceUsd("x_api", 0)).not.toBe(0);
    });

    it("1 tweet equals exactly the floor (boundary)", () => {
      expect(priceUsd("x_api", 1)).toBeCloseTo(0.00015, 10);
    });

    it("undefined units falls back to the floor", () => {
      expect(priceUsd("x_api")).toBeCloseTo(X_API_CALL_FLOOR_USD, 10);
    });
  });

  describe("dataforseo — SERP vs Labs", () => {
    it("defaults to SERP flat per-request when operation is plain", () => {
      expect(priceUsd("dataforseo", undefined, "google.serp.organic")).toBeCloseTo(
        DATAFORSEO_SERP_PER_REQ_USD,
        10
      );
      expect(priceUsd("dataforseo", 50, "serp_organic")).toBeCloseTo(0.0006, 10);
    });

    it("Labs operation adds per-keyword cost on top of the base", () => {
      const keywords = 20;
      const expected =
        DATAFORSEO_LABS_PER_REQ_USD + DATAFORSEO_LABS_PER_KEYWORD_USD * keywords;
      expect(priceUsd("dataforseo", keywords, "dataforseo_labs_keyword_ideas")).toBeCloseTo(
        expected,
        10
      );
      expect(priceUsd("dataforseo", 20, "labs.keywords")).toBeCloseTo(0.01 + 0.002, 10);
    });

    it("Labs with 0 keywords is just the base per-request", () => {
      expect(priceUsd("dataforseo", 0, "labs.keyword_ideas")).toBeCloseTo(0.01, 10);
    });

    it("detects DataForSEO via operation even when mislabeled as another provider", () => {
      // search_demand reads historically logged under 'scrapecreators'/'other'.
      expect(priceUsd("scrapecreators", undefined, "search_demand.volume")).toBeCloseTo(
        0.0006,
        10
      );
      expect(priceUsd("other", 12, "dataforseo_labs.ideas")).toBeCloseTo(
        0.01 + 0.0001 * 12,
        10
      );
    });
  });

  describe("token providers — pass-through / 0 (already metered upstream)", () => {
    it("gemini returns 0 (never re-priced here)", () => {
      expect(priceUsd("gemini")).toBe(0);
      expect(priceUsd("gemini", 50000)).toBe(0);
    });

    it("openrouter returns 0 (never re-priced here)", () => {
      expect(priceUsd("openrouter")).toBe(0);
      expect(priceUsd("openrouter", 12345, "research.judge")).toBe(0);
    });
  });

  describe("unknown / unmetered providers → 0", () => {
    it("unknown provider returns 0", () => {
      expect(priceUsd("totally_made_up", 999)).toBe(0);
      expect(priceUsd("")).toBe(0);
    });

    it("composio / openclaw / other return 0 (no read rate)", () => {
      expect(priceUsd("composio", 5)).toBe(0);
      expect(priceUsd("openclaw", 5)).toBe(0);
      expect(priceUsd("other", 5)).toBe(0);
    });
  });
});
