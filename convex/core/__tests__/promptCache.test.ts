/**
 * Prompt caching (2026-10-01). Measured on dev: Gemini cached 0 of ~6,700 prompt tokens a reply until the
 * stable part was marked; then ~7,300 of 7,343 from the second call, about half the cost. It only works
 * while the part before the break is byte-identical turn to turn, so that's what these hold.
 */
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { CACHE_BREAK, withCacheBreaks } from "../../integrations/openrouter/client";
import { buildPrefix } from "../../agent/context";

describe("the cache break (pure)", () => {
  const msgs = [{ role: "system" as const, content: `stable part${CACHE_BREAK}live part` }, { role: "user" as const, content: "hi" }];
  it("Gemini gets the stable part marked cacheable and the live part after it", () => {
    expect(withCacheBreaks("google/gemini-3.7-flash", msgs)[0]).toEqual({ role: "system", content: [{ type: "text", text: "stable part", cache_control: { type: "ephemeral" } }, { type: "text", text: "live part" }] });
  });
  it("other models get one plain string: no marker text ever reaches a model", () => {
    for (const model of ["openai/gpt-6.1-sol", "z-ai/glm-5.3-flash", "deepseek/deepseek-v4-flash"]) {
      const sent = withCacheBreaks(model, msgs)[0] as { content: string };
      expect(sent.content).toBe("stable part\n\nlive part");
      expect(sent.content).not.toContain("cache-break");
    }
  });
  it("messages without a break are untouched", () => {
    expect(withCacheBreaks("google/gemini-3.7-flash", [{ role: "user", content: "x" }])).toEqual([{ role: "user", content: "x" }]);
  });
});

describe("her prompt's stable part", () => {
  it("is identical across turns and across paths; the task and the right-now facts come after the break", async () => {
    const t = convexTest(schema, modules);
    const c = await t.run((ctx) => seedCreator(ctx, "cache1"));
    const g1 = (await t.query(internal.agent.context.gather, { creatorId: c }))!;
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 47 * 60_000 });
    try {
      const g2 = (await t.query(internal.agent.context.gather, { creatorId: c }))!;
      const reply = buildPrefix({ creator: g1.creator, directives: g1.directives, skill: "reply skill", personal: g1.personal, voice: g1.voice, history: g1.history });
      const scout = buildPrefix({ creator: g2.creator, directives: g2.directives, skill: "scout skill", personal: g2.personal, voice: g2.voice, history: g2.history });
      const [stableA, liveA] = reply.split(CACHE_BREAK);
      const [stableB, liveB] = scout.split(CACHE_BREAK);
      expect(stableA).toBe(stableB);
      expect(liveA).toMatch(/^# Skill\nreply skill/);
      expect(liveB).toMatch(/^# Skill\nscout skill/);
      expect(stableA).not.toMatch(/# Skill/);
    } finally {
      vi.useRealTimers();
    }
  });
});
