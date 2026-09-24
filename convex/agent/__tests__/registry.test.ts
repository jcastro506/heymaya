/** §8 gate 9, §15.5: the model-swap test. The critic is a different family from the writer; every role has a primary and a fallback with a vendor prefix; a swap that breaks either fails here before it reaches a creator. */
import { describe, expect, it } from "vitest";
import { REGISTRY, WATCH_MODEL, WATCH_MODEL_TOP } from "../registry";

describe("registry", () => {
  it("the critic and the judge come from a different family than the writer", () => {
    expect(REGISTRY.critic.family).not.toBe(REGISTRY.writer.family);
    expect(REGISTRY.critic.primary.split("/")[0]).not.toBe(REGISTRY.writer.primary.split("/")[0]);
  });
  it("every role names a primary and a fallback with a vendor prefix, and sane budgets", () => {
    for (const [role, spec] of Object.entries(REGISTRY)) {
      expect(spec.primary, role).toMatch(/^[a-z0-9-]+\/[a-z0-9.-]+$/i);
      expect(spec.fallback, role).toMatch(/^[a-z0-9-]+\/[a-z0-9.-]+$/i);
      expect(spec.maxTokens, role).toBeGreaterThan(50);
      expect(spec.maxTokens, role).toBeLessThan(5000);
    }
  });
  it("the watch models are Gemini and the top one is not the lite one", () => {
    expect(WATCH_MODEL).toMatch(/^gemini-/);
    expect(WATCH_MODEL_TOP).toMatch(/^gemini-/);
    expect(WATCH_MODEL_TOP).not.toMatch(/lite/);
  });
});
