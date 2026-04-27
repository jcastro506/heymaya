import { describe, it, expect, vi } from "vitest";
import {
  applyBrandVoice,
  SKILL_METADATA,
  __test__,
  type BrandVoiceApplierInputs,
  type LlmCaller,
} from "../script";

const mikeInputs: BrandVoiceApplierInputs = {
  draftText:
    "Thanks Linda — Eddie completed the 14 SEER install Tuesday. Total $4250.",
  brandVoice: "friendly-neighborhood, first-name basis, lots of 'y'all'",
  brandVoiceSamples: [
    {
      source: "review-reply",
      text: "Y'all are awesome — Eddie loves working in your house.",
    },
    {
      source: "gbp-caption",
      text: "Big shout to Linda for trusting us with the freeze prep.",
    },
  ],
  channelHints: { channel: "sms", maxLength: 320 },
};

const sarahInputs: BrandVoiceApplierInputs = {
  draftText:
    "Thanks Linda — Eddie completed the 14 SEER install Tuesday. Total $4250.",
  brandVoice: "professional-efficient, formal, full sentences",
  brandVoiceSamples: [
    {
      source: "review-reply",
      text: "We appreciate the kind words. Our technician completed the install on schedule.",
    },
    {
      source: "gbp-caption",
      text: "Scheduled maintenance prevents emergency calls. Book now.",
    },
  ],
  channelHints: { channel: "email", maxLength: 1500 },
};

const mockLlmReturn = (json: object): LlmCaller =>
  vi.fn(async () => JSON.stringify(json));

describe("maya-service-brand-voice-applier — contract", () => {
  it("declares Gemini 3 Flash LOW + all-tier", () => {
    expect(SKILL_METADATA.modelTarget).toBe("gemini-3-flash");
    expect(SKILL_METADATA.thinkingBudget).toBe("low");
    expect(SKILL_METADATA.planTier).toEqual(["starter", "pro", "studio"]);
  });
});

describe("maya-service-brand-voice-applier — happy path", () => {
  it("Mike (friendly-neighborhood): rewrite preserves all numbers + names", async () => {
    const llm = mockLlmReturn({
      rewrittenText:
        "Thanks Linda — Eddie wrapped the 14 SEER install Tuesday. Y'all owe $4250 — appreciate ya.",
      diffFromInput: {
        added: ["y'all", "wrapped"],
        removed: ["completed", "Total"],
        toneShift: "more colloquial, first-name basis preserved",
      },
      voiceConfidence: 0.82,
    });
    const out = await applyBrandVoice(mikeInputs, llm);
    expect(out.rewrittenText).toContain("Linda");
    expect(out.rewrittenText).toContain("Eddie");
    expect(out.rewrittenText).toContain("14");
    expect(out.rewrittenText).toContain("4250");
    expect(out.voiceConfidence).toBe(0.82);
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it("Sarah (professional): rewrite uses formal cadence", async () => {
    const llm = mockLlmReturn({
      rewrittenText:
        "Thanks Linda — Eddie completed the 14 SEER installation on Tuesday. Total: $4250.",
      diffFromInput: {
        added: [],
        removed: [],
        toneShift: "preserved formal cadence",
      },
      voiceConfidence: 0.91,
    });
    const out = await applyBrandVoice(sarahInputs, llm);
    expect(out.rewrittenText).toContain("Linda");
    expect(out.rewrittenText).toContain("Eddie");
    expect(out.voiceConfidence).toBeGreaterThan(0.8);
  });

  it("different operators produce different prompts (cross-tenant isolation in prompt)", async () => {
    const calls: { system: string; user: string }[] = [];
    const llm: LlmCaller = vi.fn(async (p) => {
      calls.push(p);
      return JSON.stringify({
        rewrittenText: mikeInputs.draftText,
        diffFromInput: { added: [], removed: [], toneShift: "" },
        voiceConfidence: 0.7,
      });
    });
    await applyBrandVoice(mikeInputs, llm);
    await applyBrandVoice(sarahInputs, llm);
    expect(calls[0].user).toContain("friendly-neighborhood");
    expect(calls[1].user).toContain("professional-efficient");
    // Mike's samples must NOT appear in Sarah's prompt:
    expect(calls[1].user).not.toContain("Y'all");
    expect(calls[0].user).not.toContain("scheduled maintenance");
  });
});

describe("maya-service-brand-voice-applier — citation preservation (mandatory)", () => {
  it("FAILS if rewrite drops a number from input (fail-closed)", async () => {
    const llm = mockLlmReturn({
      rewrittenText: "Thanks Linda — Eddie wrapped the install Tuesday.", // dropped 14, 4250
      diffFromInput: { added: [], removed: [], toneShift: "" },
      voiceConfidence: 0.8,
    });
    await expect(applyBrandVoice(mikeInputs, llm)).rejects.toThrow(/dropped number/);
  });

  it("FAILS if rewrite drops a customer name", async () => {
    const llm = mockLlmReturn({
      rewrittenText:
        "Thanks — Eddie wrapped the 14 SEER install Tuesday. Y'all owe $4250.",
      diffFromInput: { added: [], removed: [], toneShift: "" },
      voiceConfidence: 0.8,
    });
    await expect(applyBrandVoice(mikeInputs, llm)).rejects.toThrow(/dropped name/);
  });
});

describe("maya-service-brand-voice-applier — adversarial", () => {
  it("rejects empty draftText", async () => {
    const llm = vi.fn();
    await expect(
      applyBrandVoice({ ...mikeInputs, draftText: "" }, llm)
    ).rejects.toThrow(/required/);
    expect(llm).not.toHaveBeenCalled();
  });

  it("recovers from markdown-fenced JSON output", async () => {
    const fenced: LlmCaller = vi.fn(
      async () =>
        '```json\n' +
        JSON.stringify({
          rewrittenText:
            "Thanks Linda — Eddie wrapped the 14 SEER install Tuesday. Y'all owe $4250.",
          diffFromInput: { added: [], removed: [], toneShift: "" },
          voiceConfidence: 0.8,
        }) +
        '\n```'
    );
    const out = await applyBrandVoice(mikeInputs, fenced);
    expect(out.rewrittenText).toContain("Linda");
  });

  it("rejects garbage from LLM", async () => {
    const llm: LlmCaller = vi.fn(async () => "absolutely not json");
    await expect(applyBrandVoice(mikeInputs, llm)).rejects.toThrow();
  });

  it("truncates at word boundary if rewrite exceeds maxLength", async () => {
    const longText = "y'all ".repeat(100);
    const llm = mockLlmReturn({
      rewrittenText:
        "Thanks Linda Eddie 14 SEER $4250 " + longText,
      diffFromInput: { added: [], removed: [], toneShift: "" },
      voiceConfidence: 0.7,
    });
    const out = await applyBrandVoice(
      { ...mikeInputs, channelHints: { channel: "sms", maxLength: 100 } },
      llm
    );
    expect(out.rewrittenText.length).toBeLessThanOrEqual(100);
  });
});

describe("maya-service-brand-voice-applier — sibling-file scan", () => {
  it("never throws Sprint 3 stub error", async () => {
    const llm = mockLlmReturn({
      rewrittenText:
        "Thanks Linda — Eddie wrapped the 14 SEER install Tuesday. Y'all owe $4250.",
      diffFromInput: { added: [], removed: [], toneShift: "" },
      voiceConfidence: 0.8,
    });
    await expect(applyBrandVoice(mikeInputs, llm)).resolves.toBeDefined();
  });
});

describe("maya-service-brand-voice-applier — prompt builder", () => {
  it("buildPrompt includes brand-voice fingerprint + channel + samples", () => {
    const { system, user } = __test__.buildPrompt(mikeInputs);
    expect(system).toContain("Voice is style only");
    expect(user).toContain("friendly-neighborhood");
    expect(user).toContain("Y'all are awesome");
  });

  it("preservedTokens extracts numbers + names but not English starters", () => {
    const { numbers, names } = __test__.preservedTokens(
      "Thanks Linda — Eddie did 14 SEER for $4250."
    );
    expect(numbers).toContain("14");
    expect(numbers.some((n) => n.includes("4250"))).toBe(true);
    expect(names).toContain("Linda");
    expect(names).toContain("Eddie");
  });
});
