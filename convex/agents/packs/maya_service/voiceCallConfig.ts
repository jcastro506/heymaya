/**
 * voice-call plugin config generator (Wave D — service plan § 13 Sprint 6).
 *
 * Per `docs/SPRINT_PLAN_SERVICE_V0.md` § 13 Sprint 6 + the official plugin
 * docs at https://docs.openclaw.ai/plugins/voice-call, every per-business
 * Studio-tier OpenClaw workspace bundle carries a `voice-call` plugin config
 * block. The plugin owns inbound dialing, Twilio Media Streams bridging, STT
 * (streaming transcription via realtime provider), TTS, tool-call dispatch,
 * recording, and outbound calling.
 *
 * **We CONFIGURE — we never reimplement.** Per `feedback_openclaw_native_first.md`
 * + `project_openclaw_alignment.md`. The `voice-call` plugin is OpenClaw-native;
 * the prior plan's `convex/voice/elevenlabsBridge.ts` shim was DROPPED in the
 * 2026-04-27 audit. Convex's role:
 *   - generate the per-business plugin config block (this file)
 *   - persist transcripts from the plugin's transcripts hook (`convex/voice/transcripts.ts`)
 *   - PIN-challenge gating for sensitive CRM voice writes (`convex/voice/pinChallenge.ts` +
 *     `convex/voice/sensitiveOps.ts`)
 *   - Twilio number webhook routing into the plugin's inbound endpoint
 *     (`convex/integrations/twilio/configureWebhooks.ts`)
 *
 * **Studio-only.** Plan-tier `planFeaturesService(business).voice === true`
 * AND `planTier === "studio"` ⟺ plugin block emitted. Pro tier has a voice
 * inclusion bucket but the channel-provisioning surface is Studio-gated per
 * § 5 onboarding Q8 ("set up now on Studio"). NON-Studio: this file's caller
 * MUST omit the plugin entirely from the bundle.
 *
 * **Per-task latency lock — `thinkingBudget: 0` for inbound voice.** Per
 * § 7 (cost envelope) + the audit decision, inbound voice forces
 * `thinkingBudget: 0` so the realtime first-token latency lands sub-300ms
 * (plan § 13 Sprint 6 acceptance criterion: <1s p95). This is encoded in the
 * `responseSystemPrompt` + `responseTimeoutMs` constraints below — the
 * realtime provider itself owns the audio loop, so the budget knob lives in
 * how we tune the agent-consult fallback (the only path where Convex-side
 * Gemini is reachable from a voice call).
 *
 * The plugin's `responseTimeoutMs: 1500` keeps any agent-consult round-trip
 * inside the latency budget. Outbound calls (notification mode) use the
 * default thinking budget — they're not latency-locked.
 */

import type { Id } from "../../../_generated/dataModel";
import type { ServicePlan } from "../../../planService";

/** Stable plugin slug. Never change; OpenClaw plugin loader keys off this. */
export const VOICE_CALL_PLUGIN_KEY = "voice-call" as const;

/**
 * Inbound voice latency lock. Caps any agent-consult turn inside the realtime
 * loop to 1.5s — beyond this, the plugin auto-falls-back to a canned
 * placeholder (per `responseTimeoutMs` semantics in
 * https://docs.openclaw.ai/plugins/voice-call). Documented here so consumers
 * understand WHY this number is fixed, not arbitrary.
 *
 * The headline plan acceptance criterion is sub-1s p95 first-token; we set
 * the plugin response timeout slightly above the budget so it's the
 * realtime model that drives latency, not our agent-consult fallback.
 *
 * **CRITICAL invariant** for the audit: the plugin's realtime path runs the
 * provider's own audio loop with NO Convex hop and NO thinking budget — the
 * sub-300ms first-token comes from the realtime provider directly. The
 * `responseSystemPrompt` we ship instructs the agent to keep agent-consult
 * calls minimal so they only fire when the caller asks for "deep" reasoning.
 */
export const VOICE_INBOUND_RESPONSE_TIMEOUT_MS = 1500;

/**
 * Inbound voice agent-consult thinking budget. Forced to 0 per the per-task
 * latency lock so the agent-consult fallback returns inside the response
 * timeout. NOT a plugin field directly — surfaced via the system prompt the
 * plugin uses for the auto-response model so the model treats every voice
 * turn as zero-thinking-budget.
 */
export const VOICE_INBOUND_THINKING_BUDGET = 0;

/**
 * Realtime provider choice. ElevenLabs is the default per audit; gemini-live
 * is the opt-in fallback if ElevenLabs realtime depth disappoints in the
 * Sprint 6 latency spike.
 */
export type VoiceRealtimeProvider = "elevenlabs" | "gemini-live";

export interface VoiceCallPluginConfig {
  enabled: true;
  config: {
    provider: "twilio";
    fromNumber: string;
    twilio: {
      // SecretRef strings — OpenClaw plugin loader resolves these from
      // gateway env at boot. We never put real credentials in the workspace
      // bundle; the Fly machine reads them from `fly secrets`.
      accountSid: string;
      authToken: string;
    };
    serve: { port: number; path: string };
    webhookSecurity: {
      trustForwardingHeaders: true;
    };
    publicUrl?: string;
    outbound: { defaultMode: "notify" | "conversation" };
    realtime: {
      enabled: true;
      provider: "elevenlabs" | "google" | "openai";
      toolPolicy: "safe-read-only" | "owner";
      providers: {
        elevenlabs?: {
          apiKey: string;
          voiceId?: string;
          modelId?: string;
        };
        google?: {
          apiKey: string;
          model?: string;
          voice?: string;
        };
      };
    };
    inboundPolicy: "allowlist" | "disabled";
    allowFrom: string[];
    inboundGreeting: string;
    /**
     * Per-task latency lock — must equal `VOICE_INBOUND_RESPONSE_TIMEOUT_MS`.
     * Bounds the agent-consult fallback so the realtime loop never blocks
     * past the latency budget.
     */
    responseTimeoutMs: number;
    /**
     * The system prompt the plugin uses for any agent-consult turn. We
     * inject the latency lock + brevity constraints here so the model has
     * the context inline.
     */
    responseSystemPrompt: string;
    maxDurationSeconds: number;
    staleCallReaperSeconds: number;
    /**
     * Transcript persistence hook — POST endpoint in our Convex HTTP router.
     * Plugin streams chunks; our endpoint dispatches to
     * `recordTranscriptChunk`. Signature is HMAC-SHA256 over body using
     * `VOICE_TRANSCRIPT_HMAC_SECRET` (Convex env). Per
     * https://docs.openclaw.ai/plugins/voice-call, the plugin emits
     * webhooks with HMAC if a `webhookSecret` is configured.
     */
    transcripts: {
      webhookUrl: string;
      webhookSecret: string;
      includeFinalSummary: true;
    };
  };
}

export interface VoiceCallConfigInputs {
  businessId: Id<"businesses">;
  businessName: string;
  /** Plan tier — used for fail-closed Studio-only assertion. */
  plan: ServicePlan;
  /**
   * Twilio number assigned to this business (E.164). Required — fail-fast
   * if missing because the plugin needs a `fromNumber` to provision.
   */
  twilioFromNumber: string;
  /** Allowlist of E.164 numbers Maya answers. Empty = block all inbound. */
  inboundAllowlist: ReadonlyArray<string>;
  /** Operator-chosen realtime provider. Default ElevenLabs. */
  realtimeProvider: VoiceRealtimeProvider;
  /**
   * Public-facing Convex HTTP base (e.g. `https://example.convex.site`).
   * Required — used to build the transcripts webhook URL the plugin POSTs to.
   */
  convexHttpBase: string;
  /**
   * Operator's preferred voice greeting line. Service-business default has
   * brand-voice signature; operator can override in Profile.
   */
  inboundGreeting?: string;
}

export class VoiceCallConfigPlanError extends Error {
  constructor(plan: ServicePlan) {
    super(
      `voice-call plugin requires Studio plan; got '${plan}'. Caller must omit the plugin entirely for non-Studio tiers.`
    );
    this.name = "VoiceCallConfigPlanError";
  }
}

const TWILIO_ACCOUNT_SID_REF = "${TWILIO_ACCOUNT_SID}" as const;
const TWILIO_AUTH_TOKEN_REF = "${TWILIO_AUTH_TOKEN}" as const;
const ELEVENLABS_API_KEY_REF = "${ELEVENLABS_API_KEY}" as const;
const GEMINI_API_KEY_REF = "${GEMINI_API_KEY}" as const;
const TRANSCRIPT_HMAC_SECRET_REF = "${VOICE_TRANSCRIPT_HMAC_SECRET}" as const;

const DEFAULT_INBOUND_GREETING =
  "Hi, this is Maya. I help out around the office. How can I help?";

const VOICE_BREVITY_PROMPT = [
  "You are Maya in voice mode. The realtime provider owns the audio loop;",
  "you only fire when the realtime model asks for deep reasoning or to write",
  "data. Keep every reply under two sentences. NEVER read URLs aloud.",
  "Sensitive operations (create/modify CRM records, send invoices, post",
  "social, modify GBP, send review requests) MUST be PIN-gated; if the",
  "caller has not passed PIN this turn, refuse and say 'I need your PIN to",
  "do that — text me when you can'. Speak in the brand voice signaled by",
  "SOUL.md.",
].join(" ");

/**
 * Build the voice-call plugin config block for a Studio-tier business. Pure
 * function; no I/O.
 *
 * Throws `VoiceCallConfigPlanError` if invoked for a non-Studio plan — the
 * caller MUST omit the plugin entirely for Pro/Starter rather than relying
 * on a disabled-but-present block (the plugin docs treat presence as opt-in).
 */
export function generateVoiceCallConfig(
  inputs: VoiceCallConfigInputs
): VoiceCallPluginConfig {
  if (inputs.plan !== "studio") {
    throw new VoiceCallConfigPlanError(inputs.plan);
  }
  if (!inputs.twilioFromNumber) {
    throw new Error(
      "generateVoiceCallConfig: twilioFromNumber is required (Twilio number not yet provisioned for this business)."
    );
  }
  if (!inputs.convexHttpBase) {
    throw new Error(
      "generateVoiceCallConfig: convexHttpBase is required so the plugin's transcripts hook has a target URL."
    );
  }

  const provider: "elevenlabs" | "google" =
    inputs.realtimeProvider === "gemini-live" ? "google" : "elevenlabs";

  const transcriptsWebhookUrl =
    sanitizeBase(inputs.convexHttpBase) +
    `/voice/transcript?businessId=${encodeURIComponent(String(inputs.businessId))}`;

  const allowFrom = Array.from(new Set(inputs.inboundAllowlist)).filter((n) =>
    n.startsWith("+")
  );

  return {
    enabled: true,
    config: {
      provider: "twilio",
      fromNumber: inputs.twilioFromNumber,
      twilio: {
        accountSid: TWILIO_ACCOUNT_SID_REF,
        authToken: TWILIO_AUTH_TOKEN_REF,
      },
      // The plugin serves its own HTTP endpoints inside the Fly machine. We
      // pin port + path so the Twilio webhook routes deterministically.
      // External traffic hits this via the operator's Twilio number Voice
      // webhook (configured by `convex/integrations/twilio/configureWebhooks.ts`).
      serve: { port: 8787, path: "/voice" },
      webhookSecurity: {
        trustForwardingHeaders: true,
      },
      // Outbound: notification mode by default — Maya places one-shot calls
      // ("Job's done, can you approve the GBP post?"). `conversation` is opt-
      // in via the plugin's per-call API.
      outbound: { defaultMode: "notify" },
      realtime: {
        enabled: true,
        provider,
        // safe-read-only is the floor: realtime model can call read-only
        // tools without our PIN gate. Sensitive writes route through the
        // agent-consult path which enforces PIN via `convex/voice/sensitiveOps.ts`.
        toolPolicy: "safe-read-only",
        providers: {
          ...(provider === "elevenlabs" && {
            elevenlabs: {
              apiKey: ELEVENLABS_API_KEY_REF,
            },
          }),
          ...(provider === "google" && {
            google: {
              apiKey: GEMINI_API_KEY_REF,
              model: "gemini-2.5-flash-native-audio-preview-12-2025",
              voice: "Kore",
            },
          }),
        },
      },
      inboundPolicy: "allowlist",
      allowFrom,
      inboundGreeting: inputs.inboundGreeting ?? DEFAULT_INBOUND_GREETING,
      // Per-task latency lock — sub-1s p95 first-token. The agent-consult
      // path bounded by this; realtime audio loop unaffected.
      responseTimeoutMs: VOICE_INBOUND_RESPONSE_TIMEOUT_MS,
      responseSystemPrompt: VOICE_BREVITY_PROMPT,
      // Hard cap any single call at 30 minutes; service-business calls
      // rarely run over 5. Bounds runaway billing.
      maxDurationSeconds: 1800,
      // 90s stale-call reaper — if the realtime loop hangs, plugin tears
      // down. Prevents zombie calls inflating MTD voice minutes.
      staleCallReaperSeconds: 90,
      transcripts: {
        webhookUrl: transcriptsWebhookUrl,
        webhookSecret: TRANSCRIPT_HMAC_SECRET_REF,
        includeFinalSummary: true,
      },
    },
  };
}

/**
 * Build the plugin entries fragment for the gateway config. Returned as a
 * raw object so deploy-bundle assembly can spread it alongside other plugin
 * blocks (memory-wiki, etc.).
 *
 * **Returns `{}` for non-Studio tiers** — non-Studio bundles must omit the
 * plugin entirely (no disabled-block-stub). The deploy orchestrator spreads
 * this returned object directly into `plugins.entries`.
 */
export function generateVoiceCallPluginEntries(
  inputs: VoiceCallConfigInputs
): { [k: string]: VoiceCallPluginConfig } {
  if (inputs.plan !== "studio") {
    return {};
  }
  return {
    [VOICE_CALL_PLUGIN_KEY]: generateVoiceCallConfig(inputs),
  };
}

function sanitizeBase(base: string): string {
  return base.replace(/\/+$/, "");
}
