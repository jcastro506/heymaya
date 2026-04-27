/**
 * voice-call plugin config generator tests.
 *
 * 5 mandatory categories:
 *   1. Cross-tenant — n/a (pure function); generator is keyed on
 *      businessId, distinct businesses produce distinct webhook URLs.
 *   2. Plan-tier — STRICT Studio-only emission. Pro returns `{}`. Starter
 *      returns `{}`. Studio with missing twilioFromNumber throws fail-fast.
 *   3. Adversarial — non-E.164 entries scrubbed from allowlist.
 *   4. Sibling-file scan — covered repo-wide.
 *   5. TODO grep — covered repo-wide.
 *
 * Voice-specific:
 *   - Latency lock: `responseTimeoutMs === VOICE_INBOUND_RESPONSE_TIMEOUT_MS`.
 *   - Realtime provider switching (elevenlabs ↔ gemini-live → google).
 *   - inboundPolicy always `allowlist`.
 *   - transcripts hook URL contains the businessId.
 */

import { describe, it, expect } from "vitest";
import {
  VOICE_CALL_PLUGIN_KEY,
  VOICE_INBOUND_RESPONSE_TIMEOUT_MS,
  VOICE_INBOUND_THINKING_BUDGET,
  VoiceCallConfigPlanError,
  generateVoiceCallConfig,
  generateVoiceCallPluginEntries,
} from "../voiceCallConfig";

const FAKE_BUSINESS_ID = "btest123abc" as unknown as import(
  "../../../../_generated/dataModel"
).Id<"businesses">;

const BASE = {
  businessId: FAKE_BUSINESS_ID,
  businessName: "Henderson HVAC",
  twilioFromNumber: "+15553334444",
  inboundAllowlist: ["+15551234567", "+15559876543"],
  realtimeProvider: "elevenlabs" as const,
  convexHttpBase: "https://example.convex.site",
};

describe("generateVoiceCallConfig — Studio-only", () => {
  it("emits a plugin block for plan='studio'", () => {
    const cfg = generateVoiceCallConfig({ ...BASE, plan: "studio" });
    expect(cfg.enabled).toBe(true);
    expect(cfg.config.provider).toBe("twilio");
    expect(cfg.config.fromNumber).toBe("+15553334444");
  });

  it("THROWS for plan='pro'", () => {
    expect(() =>
      generateVoiceCallConfig({ ...BASE, plan: "pro" })
    ).toThrow(VoiceCallConfigPlanError);
  });

  it("THROWS for plan='starter'", () => {
    expect(() =>
      generateVoiceCallConfig({ ...BASE, plan: "starter" })
    ).toThrow(VoiceCallConfigPlanError);
  });
});

describe("generateVoiceCallPluginEntries — emission matrix", () => {
  it("Studio → emits voice-call entry", () => {
    const entries = generateVoiceCallPluginEntries({ ...BASE, plan: "studio" });
    expect(entries[VOICE_CALL_PLUGIN_KEY]).toBeDefined();
    expect(entries[VOICE_CALL_PLUGIN_KEY].enabled).toBe(true);
  });

  it("Pro → empty object (plugin omitted entirely)", () => {
    const entries = generateVoiceCallPluginEntries({ ...BASE, plan: "pro" });
    expect(Object.keys(entries)).toHaveLength(0);
    expect(entries[VOICE_CALL_PLUGIN_KEY]).toBeUndefined();
  });

  it("Starter → empty object (plugin omitted entirely)", () => {
    const entries = generateVoiceCallPluginEntries({
      ...BASE,
      plan: "starter",
    });
    expect(Object.keys(entries)).toHaveLength(0);
  });
});

describe("Latency lock — thinkingBudget=0 enforcement", () => {
  it("responseTimeoutMs equals the inbound latency lock constant", () => {
    const cfg = generateVoiceCallConfig({ ...BASE, plan: "studio" });
    expect(cfg.config.responseTimeoutMs).toBe(
      VOICE_INBOUND_RESPONSE_TIMEOUT_MS
    );
  });

  it("VOICE_INBOUND_THINKING_BUDGET is exactly 0 (per § 7 latency lock)", () => {
    expect(VOICE_INBOUND_THINKING_BUDGET).toBe(0);
  });

  it("responseSystemPrompt mentions PIN-gating + brevity (voice mode)", () => {
    const cfg = generateVoiceCallConfig({ ...BASE, plan: "studio" });
    expect(cfg.config.responseSystemPrompt.toLowerCase()).toContain("pin");
    expect(cfg.config.responseSystemPrompt.toLowerCase()).toContain("voice");
  });

  it("Latency timeout is bounded sub-2s (no agent-consult past budget)", () => {
    const cfg = generateVoiceCallConfig({ ...BASE, plan: "studio" });
    expect(cfg.config.responseTimeoutMs).toBeLessThanOrEqual(2000);
  });
});

describe("Realtime provider switching", () => {
  it("elevenlabs → realtime.provider='elevenlabs'", () => {
    const cfg = generateVoiceCallConfig({ ...BASE, plan: "studio" });
    expect(cfg.config.realtime.provider).toBe("elevenlabs");
    expect(cfg.config.realtime.providers.elevenlabs).toBeDefined();
    expect(cfg.config.realtime.providers.google).toBeUndefined();
  });

  it("gemini-live → realtime.provider='google'", () => {
    const cfg = generateVoiceCallConfig({
      ...BASE,
      plan: "studio",
      realtimeProvider: "gemini-live",
    });
    expect(cfg.config.realtime.provider).toBe("google");
    expect(cfg.config.realtime.providers.google).toBeDefined();
    expect(cfg.config.realtime.providers.elevenlabs).toBeUndefined();
  });
});

describe("inboundPolicy + allowlist propagation", () => {
  it("inboundPolicy is always 'allowlist'", () => {
    const cfg = generateVoiceCallConfig({ ...BASE, plan: "studio" });
    expect(cfg.config.inboundPolicy).toBe("allowlist");
  });

  it("allowlist propagates valid E.164 entries", () => {
    const cfg = generateVoiceCallConfig({
      ...BASE,
      plan: "studio",
      inboundAllowlist: ["+15551234567", "+15559876543"],
    });
    expect(cfg.config.allowFrom).toEqual([
      "+15551234567",
      "+15559876543",
    ]);
  });

  it("allowlist deduplicates", () => {
    const cfg = generateVoiceCallConfig({
      ...BASE,
      plan: "studio",
      inboundAllowlist: ["+15551234567", "+15551234567", "+15559876543"],
    });
    expect(cfg.config.allowFrom).toEqual([
      "+15551234567",
      "+15559876543",
    ]);
  });

  it("allowlist filters non-E.164 entries (must start with +)", () => {
    const cfg = generateVoiceCallConfig({
      ...BASE,
      plan: "studio",
      inboundAllowlist: ["15551234567", "+15559876543", "abcd"],
    });
    expect(cfg.config.allowFrom).toEqual(["+15559876543"]);
  });

  it("empty allowlist → empty allowFrom (plugin blocks all)", () => {
    const cfg = generateVoiceCallConfig({
      ...BASE,
      plan: "studio",
      inboundAllowlist: [],
    });
    expect(cfg.config.allowFrom).toEqual([]);
  });
});

describe("Transcripts hook URL", () => {
  it("contains businessId in query string", () => {
    const cfg = generateVoiceCallConfig({ ...BASE, plan: "studio" });
    expect(cfg.config.transcripts.webhookUrl).toContain(
      `businessId=${encodeURIComponent(String(FAKE_BUSINESS_ID))}`
    );
  });

  it("strips trailing slash from convex http base", () => {
    const cfg = generateVoiceCallConfig({
      ...BASE,
      plan: "studio",
      convexHttpBase: "https://example.convex.site/",
    });
    expect(cfg.config.transcripts.webhookUrl).toContain(
      "https://example.convex.site/voice/transcript"
    );
    expect(cfg.config.transcripts.webhookUrl).not.toContain(
      ".site//voice"
    );
  });

  it("includeFinalSummary is true (post-call summary captured)", () => {
    const cfg = generateVoiceCallConfig({ ...BASE, plan: "studio" });
    expect(cfg.config.transcripts.includeFinalSummary).toBe(true);
  });
});

describe("Adversarial / fail-fast inputs", () => {
  it("missing twilioFromNumber throws", () => {
    expect(() =>
      generateVoiceCallConfig({
        ...BASE,
        plan: "studio",
        twilioFromNumber: "",
      })
    ).toThrow(/twilioFromNumber/i);
  });

  it("missing convexHttpBase throws", () => {
    expect(() =>
      generateVoiceCallConfig({
        ...BASE,
        plan: "studio",
        convexHttpBase: "",
      })
    ).toThrow(/convexHttpBase/i);
  });
});

describe("Bounds + ceilings", () => {
  it("maxDurationSeconds caps individual calls (≤30 min)", () => {
    const cfg = generateVoiceCallConfig({ ...BASE, plan: "studio" });
    expect(cfg.config.maxDurationSeconds).toBeLessThanOrEqual(1800);
  });

  it("staleCallReaperSeconds is short enough to prevent zombie calls", () => {
    const cfg = generateVoiceCallConfig({ ...BASE, plan: "studio" });
    expect(cfg.config.staleCallReaperSeconds).toBeLessThanOrEqual(120);
  });

  it("outbound mode defaults to 'notify' (one-shot, not conversation)", () => {
    const cfg = generateVoiceCallConfig({ ...BASE, plan: "studio" });
    expect(cfg.config.outbound.defaultMode).toBe("notify");
  });
});
