/**
 * ⭐ The worker model must not be a reasoning model.
 *
 * Live from her machine, 2026-08-13:
 *
 *   reasoning-only assistant turn detected ... retrying 2/2
 *   reasoning-only retries exhausted ... surfacing incomplete-turn error
 *   model fallback decision: candidate_failed reason=format next=none
 *   [hooks] before_prompt_build handler from active-memory failed:
 *     timed out after 15000ms
 *
 * ⚠️ ONE cause, two symptoms. A reasoning-capable model asked for fast
 * structured recall spends its budget thinking: it returns reasoning with no
 * visible answer — killing the turn, with `next=none` meaning nothing caught it
 * — and it blows the 15s active-memory budget.
 *
 * Six days of byte-identical memory checkpoints, a founder approving a draft
 * that never published, and "I don't yet know why" all trace back to this.
 */

import { describe, expect, it } from "vitest";
import {
  WORKER_MODEL,
  WORKER_FALLBACK_MODEL,
  openclawModelRef,
} from "../convex/agents/packs/maya/generators";

describe("the worker model", () => {
  it("⚠️ is not the model that broke her", () => {
    // Named explicitly. A revert to this reintroduces both failures.
    expect(WORKER_MODEL).not.toContain("gpt-oss");
    expect(WORKER_FALLBACK_MODEL).not.toContain("gpt-oss");
  });

  it("⭐ is instruct-tuned, which cannot emit a reasoning-only turn", () => {
    /**
     * The structural property, not a preference. An instruct model has no
     * reasoning mode to get stuck in — which is why this is a model choice
     * rather than a retry-count tweak.
     */
    expect(WORKER_MODEL).toContain("instruct");
    expect(WORKER_FALLBACK_MODEL).toContain("instruct");
  });

  it("⚠️ falls back to a DIFFERENT vendor family", () => {
    /**
     * The only property that makes a fallback worth having. Two models from
     * one family share failure modes, so a format failure in the first would
     * repeat in the second and the fallback would buy nothing.
     */
    const family = (slug: string) => slug.split("/")[0];
    expect(family(WORKER_MODEL)).not.toBe(family(WORKER_FALLBACK_MODEL));
  });

  it("names the provider, because a bare slug means something else", () => {
    /**
     * OpenClaw reads a model ref as `provider/model`, so shipping a bare
     * OpenRouter slug tells it provider `qwen` — which does not exist, and the
     * machine answers every message with "Unknown model". v1 learned this live
     * on 2026-07-12.
     */
    expect(openclawModelRef(WORKER_MODEL)).toBe(`openrouter/${WORKER_MODEL}`);
    expect(openclawModelRef(WORKER_MODEL).startsWith("openrouter/")).toBe(true);
  });
});
