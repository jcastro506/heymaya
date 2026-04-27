/**
 * maya-voice-applier — unit tests.
 *
 * Coverage:
 *  - happy path: stub model proposes diffs, applyVoice rewrites the draft + records surviving diffs
 *  - idempotency: applyVoice on the just-adjusted output returns unchanged: true (no model round-trip)
 *  - fact preservation: a diff that mutates a number is rejected
 *  - adversarial: empty draft / empty fingerprint rejected
 *  - cache hit: a second call with identical inputs returns the cached result
 */

import { describe, it, expect, vi } from "vitest";
import {
  applyDiffs,
  applyVoice,
  computeDraftHash,
  diffPreservesFacts,
  inMemoryCache,
  type VoiceDiff,
  type VoicingModel,
  type VoiceApplyInputs,
} from "../script";

const FINGERPRINT =
  "lowercase only, em-dash heavy, no exclamation marks, conversational";

describe("maya-voice-applier — fact preservation", () => {
  it("diff with same facts is preserved", () => {
    const d: VoiceDiff = {
      original: "Your Tuesday Reel hit 47000 views.",
      adjusted: "your tuesday reel hit 47000 views.",
      reason: "capitalization",
    };
    expect(diffPreservesFacts(d)).toBe(true);
  });
  it("diff that mutates a number is rejected", () => {
    const d: VoiceDiff = {
      original: "Your Tuesday Reel hit 47000 views.",
      adjusted: "your tuesday reel hit 50000 views.",
      reason: "vocab",
    };
    expect(diffPreservesFacts(d)).toBe(false);
  });
  it("diff that drops a multi-word brand name is rejected", () => {
    const d: VoiceDiff = {
      original: "Lululemon Partnerships reached out about the Reel.",
      adjusted: "they reached out about the reel.",
      reason: "vocab",
    };
    expect(diffPreservesFacts(d)).toBe(false);
  });
  it("diff that drops an all-caps acronym (FTC, IG) is rejected", () => {
    const d: VoiceDiff = {
      original: "FTC disclosure required on the IG post.",
      adjusted: "disclosure required on the post.",
      reason: "vocab",
    };
    expect(diffPreservesFacts(d)).toBe(false);
  });
  it("diff that adds a fact (number) is rejected", () => {
    const d: VoiceDiff = {
      original: "your reel did well.",
      adjusted: "your reel hit 100000 views.",
      reason: "vocab",
    };
    expect(diffPreservesFacts(d)).toBe(false);
  });
});

describe("maya-voice-applier — applyDiffs", () => {
  it("applies a single diff in document order", () => {
    const out = applyDiffs("Hello world!", [
      { original: "Hello", adjusted: "hello", reason: "capitalization" },
    ]);
    expect(out.adjusted).toBe("hello world!");
    expect(out.surviving).toHaveLength(1);
  });
  it("drops a fact-mutating diff", () => {
    const out = applyDiffs("47000 views", [
      { original: "47000 views", adjusted: "50000 views", reason: "vocab" },
    ]);
    expect(out.adjusted).toBe("47000 views");
    expect(out.surviving).toHaveLength(0);
  });
  it("skips a diff whose original is missing", () => {
    const out = applyDiffs("Hello world", [
      { original: "Goodbye", adjusted: "bye", reason: "vocab" },
    ]);
    expect(out.adjusted).toBe("Hello world");
    expect(out.surviving).toHaveLength(0);
  });
});

describe("maya-voice-applier — applyVoice happy path", () => {
  it("rewrites a draft via the stub model", async () => {
    const model: VoicingModel = {
      proposeDiffs: vi.fn(async () => [
        {
          original: "Good morning! Your",
          adjusted: "your",
          reason: "capitalization",
        } satisfies VoiceDiff,
      ]),
    };
    const cache = inMemoryCache();
    const inputs: VoiceApplyInputs = {
      draft: "Good morning! Your Tuesday Reel hit 47000 views.",
      soulVoiceFingerprint: FINGERPRINT,
      toneSlider: "supportive",
    };
    const result = await applyVoice(inputs, { model, cache });
    expect(result.adjustedDraft).toBe("your Tuesday Reel hit 47000 views.");
    expect(result.unchanged).toBe(false);
    expect(result.diff).toHaveLength(1);
    expect(model.proposeDiffs).toHaveBeenCalledTimes(1);
  });
});

describe("maya-voice-applier — idempotency", () => {
  it("applyVoice on the adjusted output is a no-op (cache short-circuit)", async () => {
    const model: VoicingModel = {
      proposeDiffs: vi.fn(async () => [
        {
          original: "Good morning! Your",
          adjusted: "your",
          reason: "capitalization",
        } satisfies VoiceDiff,
      ]),
    };
    const cache = inMemoryCache();
    const inputs: VoiceApplyInputs = {
      draft: "Good morning! Your Tuesday Reel hit 47000 views.",
      soulVoiceFingerprint: FINGERPRINT,
      toneSlider: "supportive",
    };
    const r1 = await applyVoice(inputs, { model, cache });
    expect(r1.unchanged).toBe(false);

    // Second call — feed the *adjusted* draft back in. Cache should serve it.
    const r2 = await applyVoice(
      {
        draft: r1.adjustedDraft,
        soulVoiceFingerprint: FINGERPRINT,
        toneSlider: "supportive",
      },
      { model, cache }
    );
    expect(r2.unchanged).toBe(true);
    expect(r2.diff).toHaveLength(0);
    expect(r2.adjustedDraft).toBe(r1.adjustedDraft);
    // Model should NOT have been called a second time.
    expect(model.proposeDiffs).toHaveBeenCalledTimes(1);
  });

  it("identical inputs hit the cache on the second call", async () => {
    const model: VoicingModel = {
      proposeDiffs: vi.fn(async () => []),
    };
    const cache = inMemoryCache();
    const inputs: VoiceApplyInputs = {
      draft: "your reel did 47000 views.",
      soulVoiceFingerprint: FINGERPRINT,
      toneSlider: "supportive",
    };
    await applyVoice(inputs, { model, cache });
    await applyVoice(inputs, { model, cache });
    expect(model.proposeDiffs).toHaveBeenCalledTimes(1);
  });
});

describe("maya-voice-applier — adversarial", () => {
  it("rejects empty draft", async () => {
    await expect(
      applyVoice(
        { draft: "   ", soulVoiceFingerprint: FINGERPRINT, toneSlider: "supportive" },
        { model: { proposeDiffs: async () => [] }, cache: inMemoryCache() }
      )
    ).rejects.toThrow(/draft is empty/);
  });
  it("rejects empty fingerprint", async () => {
    await expect(
      applyVoice(
        { draft: "hi", soulVoiceFingerprint: "", toneSlider: "supportive" },
        { model: { proposeDiffs: async () => [] }, cache: inMemoryCache() }
      )
    ).rejects.toThrow(/[fF]ingerprint is empty/);
  });
  it("model returns a fact-mutating diff: dropped, draft unchanged, no LLM round-trip on retry", async () => {
    const model: VoicingModel = {
      proposeDiffs: vi.fn(async (): Promise<VoiceDiff[]> => [
        { original: "47000 views", adjusted: "50000 views", reason: "vocab" },
      ]),
    };
    const cache = inMemoryCache();
    const inputs: VoiceApplyInputs = {
      draft: "your reel hit 47000 views.",
      soulVoiceFingerprint: FINGERPRINT,
      toneSlider: "supportive",
    };
    const result = await applyVoice(inputs, { model, cache });
    expect(result.adjustedDraft).toBe("your reel hit 47000 views.");
    expect(result.diff).toHaveLength(0);
    expect(result.unchanged).toBe(true);
  });
});

describe("maya-voice-applier — draft hash determinism", () => {
  it("same inputs produce the same hash", () => {
    const inputs: VoiceApplyInputs = {
      draft: "hello",
      soulVoiceFingerprint: "x",
      toneSlider: "supportive",
    };
    expect(computeDraftHash(inputs)).toBe(computeDraftHash(inputs));
  });
  it("different slider produces different hash", () => {
    const a = computeDraftHash({
      draft: "x",
      soulVoiceFingerprint: "y",
      toneSlider: "supportive",
    });
    const b = computeDraftHash({
      draft: "x",
      soulVoiceFingerprint: "y",
      toneSlider: "tough-love",
    });
    expect(a).not.toBe(b);
  });
});
