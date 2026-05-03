/**
 * Voice latency-budget regression test (Wave D — service plan § 13 Sprint 6
 * + § 14 service-specific category #6: voice latency budget).
 *
 * What this asserts: the **plugin config** that we ship to OpenClaw embeds
 * the per-task latency lock for inbound voice. Real first-token latency is
 * dominated by the realtime provider's round-trip + Fly machine cold start
 * — neither is measurable in a unit test. What IS measurable is whether
 * the config we emit forces the agent-consult fallback to obey the
 * sub-1s p95 budget regardless of what the model would otherwise do.
 *
 * Per `feedback_openclaw_native_first.md`: we don't measure the realtime
 * loop's latency in CI because that's the plugin's job. We only assert the
 * config-level invariants that prevent us from accidentally regressing the
 * latency floor:
 *
 *   - VOICE_INBOUND_THINKING_BUDGET === 0 (per § 7 routing matrix lock)
 *   - responseTimeoutMs ≤ 2000ms (so any agent-consult turn stays inside
 *     the realtime audio loop's tolerance window)
 *   - responseSystemPrompt instructs the model to keep replies brief
 *
 * Real latency tests live in the Sprint 6 latency benchmark spike (operator-
 * driven, on-Fly, real Twilio + ElevenLabs); see plan § 13 Sprint 6 task
 * "Latency benchmark spike".
 */

import { describe, it, expect } from "vitest";
import {
  VOICE_INBOUND_RESPONSE_TIMEOUT_MS,
  VOICE_INBOUND_THINKING_BUDGET,
  generateVoiceCallConfig,
} from "../../agents/packs/maya_service/voiceCallConfig";

const FAKE_BUSINESS_ID = "btestlat" as unknown as import(
  "../../_generated/dataModel"
).Id<"businesses">;

const STUDIO_INPUT = {
  businessId: FAKE_BUSINESS_ID,
  businessName: "Latency Test HVAC",
  plan: "studio" as const,
  twilioFromNumber: "+15553334444",
  inboundAllowlist: ["+15551234567"],
  realtimeProvider: "elevenlabs" as const,
  convexHttpBase: "https://example.convex.site",
};

describe("Voice latency budget — config-level invariants", () => {
  it("inbound thinking budget is exactly 0 (per-task latency lock)", () => {
    expect(VOICE_INBOUND_THINKING_BUDGET).toBe(0);
  });

  it("response timeout is 1500ms (sub-2s budget)", () => {
    expect(VOICE_INBOUND_RESPONSE_TIMEOUT_MS).toBe(1500);
  });

  it("emitted plugin config carries the timeout verbatim", () => {
    const cfg = generateVoiceCallConfig(STUDIO_INPUT);
    expect(cfg.config.responseTimeoutMs).toBe(
      VOICE_INBOUND_RESPONSE_TIMEOUT_MS
    );
  });

  it("emitted config caps single-call duration to bound runaway billing", () => {
    const cfg = generateVoiceCallConfig(STUDIO_INPUT);
    expect(cfg.config.maxDurationSeconds).toBeGreaterThan(0);
    expect(cfg.config.maxDurationSeconds).toBeLessThanOrEqual(1800);
  });

  it("stale-call reaper is short enough to drop zombie calls inside one billing cycle minute", () => {
    const cfg = generateVoiceCallConfig(STUDIO_INPUT);
    // 90s is the locked default; <=120s is the regression ceiling.
    expect(cfg.config.staleCallReaperSeconds).toBeLessThanOrEqual(120);
  });

  it("response prompt enforces brevity (no multi-sentence rambling on voice)", () => {
    const cfg = generateVoiceCallConfig(STUDIO_INPUT);
    const prompt = cfg.config.responseSystemPrompt.toLowerCase();
    // The brevity contract uses "two sentences" as the cap; this is the
    // documentary phrase that must stay in the prompt or the latency
    // budget regressions silently.
    expect(prompt).toContain("two sentence");
  });

  it("response prompt forbids reading URLs aloud (latency + UX)", () => {
    const cfg = generateVoiceCallConfig(STUDIO_INPUT);
    const prompt = cfg.config.responseSystemPrompt.toLowerCase();
    expect(prompt).toContain("never read urls");
  });

  it("realtime provider is configured (audio loop owned by plugin, NOT us)", () => {
    const cfg = generateVoiceCallConfig(STUDIO_INPUT);
    expect(cfg.config.realtime.enabled).toBe(true);
    expect(["elevenlabs", "google", "openai"]).toContain(
      cfg.config.realtime.provider
    );
  });

  it("realtime toolPolicy is 'safe-read-only' (sensitive ops route through agent-consult + PIN)", () => {
    const cfg = generateVoiceCallConfig(STUDIO_INPUT);
    expect(cfg.config.realtime.toolPolicy).toBe("safe-read-only");
  });
});

describe("Latency budget regression guard — locked constants", () => {
  it("VOICE_INBOUND_RESPONSE_TIMEOUT_MS cannot drift past 2000ms", () => {
    // Hard ceiling — any change to the constant must update this test
    // intentionally. The comment in voiceCallConfig.ts pins this number.
    expect(VOICE_INBOUND_RESPONSE_TIMEOUT_MS).toBeLessThanOrEqual(2000);
  });

  it("VOICE_INBOUND_THINKING_BUDGET cannot creep above 0", () => {
    // Per § 7 + audit decision 2026-04-27: inbound voice thinkingBudget=0.
    // Any drift here breaks the sub-300ms first-token contract.
    expect(VOICE_INBOUND_THINKING_BUDGET).toBeLessThanOrEqual(0);
  });
});
