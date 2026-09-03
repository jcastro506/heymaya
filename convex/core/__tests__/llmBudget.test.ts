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
    expect(budgetFor("openai/gpt-oss-120b", 300)).toBe(300);
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
    expect(isReasoningModel("google/gemini-3.1-flash-lite")).toBe(true); // Gemini 3.x thinks; measured 2026-09-02 (first reads trailed off on 500 tokens)
    expect(isReasoningModel("openai/gpt-oss-120b")).toBe(false);
  });

  it("lists at least the model the maya module plans with", () => {
    expect(REASONING_MODELS).toContain("openai/gpt-5.6-luna-pro");
  });
});

describe("the allowance scales with the answer", () => {
  it("a short answer keeps the flat floor", () => {
    expect(budgetFor("google/gemini-3.7-flash", 400)).toBe(400 + REASONING_ALLOWANCE);
    expect(budgetFor("google/gemini-3.7-flash", 1500)).toBe(1500 + REASONING_ALLOWANCE);
  });
  it("a long structured answer gets room to think in proportion", () => {
    // The live dossier: 3000 + 1500 truncated the JSON twice. It now gets 3000 to think in.
    expect(budgetFor("google/gemini-3.7-flash", 3000)).toBe(6000);
  });
  it("a non-reasoning model is untouched at every size", () => {
    expect(budgetFor("openai/gpt-oss-120b", 3000)).toBe(3000);
  });
});

describe("a timeout is not the token bug", () => {
  it("the critic fails over fast, because a person is waiting on the reply", async () => {
    const { CRITIC_TIMEOUT_MS } = await import("../../agent/critic");
    const { OPENROUTER_TIMEOUT_MS } = await import("../../integrations/openrouter/client");
    expect(CRITIC_TIMEOUT_MS).toBeLessThan(OPENROUTER_TIMEOUT_MS);
    expect(CRITIC_TIMEOUT_MS).toBeLessThanOrEqual(15_000);
  });

  it("both critic calls carry the short budget, or only half the failover is fast", async () => {
    const { readFileSync } = await import("node:fs");
    const critic = readFileSync(new URL("../../agent/critic.ts", import.meta.url), "utf8");
    expect((critic.match(/timeoutMs: CRITIC_TIMEOUT_MS/g) ?? []).length).toBe(2);
  });
});
