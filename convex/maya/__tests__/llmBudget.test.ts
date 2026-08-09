/**
 * ⭐ Reasoning models bill their thinking to `max_tokens`.
 *
 * This trap has been found twice. `outbound.ts` records the first — "maxTokens:
 * 300 against 188 reasoning tokens" — and fixed it by raising one number, which
 * left the trap set everywhere else.
 *
 * The second, measured 2026-08-09 on `make-carousel`: 1200 requested, 892 spent
 * reasoning, ~300 left for the answer. Add a few lines to the prompt and the
 * content budget reaches zero — which surfaces as an EMPTY COMPLETION, not an
 * error, so the failure names the wrong thing entirely.
 */

import { describe, expect, it } from "vitest";
import {
  REASONING_ALLOWANCE,
  REASONING_MODELS,
  budgetFor,
  isReasoningModel,
} from "../llm";

describe("budgetFor", () => {
  it("adds room to think for a reasoning model", () => {
    expect(budgetFor("openai/gpt-5.6-luna-pro", 1200)).toBe(1200 + REASONING_ALLOWANCE);
  });

  it("leaves a non-reasoning model's budget exactly as asked", () => {
    // Paying for headroom nothing uses is a silent cost increase.
    expect(budgetFor("google/gemini-3.1-flash-lite", 300)).toBe(300);
    expect(budgetFor("openai/gpt-oss-120b", 600)).toBe(600);
  });

  it("passes undefined through rather than inventing a cap", () => {
    // A caller that set no limit meant it. Adding one would truncate.
    expect(budgetFor("openai/gpt-5.6-luna-pro", undefined)).toBeUndefined();
  });

  /**
   * The measured case, as a regression: 1200 was NOT enough for 892 reasoning
   * tokens plus a six-slide plan. With the allowance it is.
   */
  it("clears the budget that actually failed", () => {
    const sent = budgetFor("openai/gpt-5.6-luna-pro", 1200)!;
    const observedReasoning = 892;
    expect(sent - observedReasoning).toBeGreaterThan(1200);
  });
});

describe("isReasoningModel", () => {
  it("matches a versioned variant of a listed model", () => {
    // Model ids gain suffixes; a bare equality check would silently stop
    // applying the allowance the day one appears.
    expect(isReasoningModel("openai/gpt-5.6-luna-pro:extended")).toBe(true);
  });

  it("does not match the cheap judge tiers", () => {
    expect(isReasoningModel("google/gemini-3.1-flash-lite")).toBe(false);
    expect(isReasoningModel("openai/gpt-oss-120b")).toBe(false);
  });

  it("lists at least the model the maya module plans with", () => {
    expect(REASONING_MODELS).toContain("openai/gpt-5.6-luna-pro");
  });
});
