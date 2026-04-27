/**
 * Voice-call transcript persistence (Wave D — service plan § 13 Sprint 6).
 *
 * The OpenClaw `voice-call` plugin owns the live audio loop, STT, TTS, and
 * tool dispatch. As chunks finalize during the call, the plugin POSTs them
 * to our Convex HTTP endpoint (`POST /voice/transcript?businessId=...`)
 * with HMAC-SHA256 signature. The endpoint dispatches to the internal
 * mutations here.
 *
 * Cross-tenant: every read + write filters by `businessId`. The HTTP entry
 * verifies the businessId-from-URL matches the businessId-from-payload
 * before dispatching.
 *
 * Idempotency: chunks are keyed by `(callId, chunkIdx)`. Replays of the
 * same chunkIdx are dropped silently. Finalization is one-shot — second
 * `finalizeTranscript` call is a no-op.
 *
 * Per `feedback_openclaw_native_first.md`: we do NOT bridge Twilio Media
 * Streams or run a STT loop. The plugin owns those. We only persist what
 * the plugin emits.
 */

import { v } from "convex/values";
import {
  internalMutation,
  query,
  action,
  type ActionCtx,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { getCurrentBusinessSession } from "../queries/business/_session";
import {
  planFeaturesService,
  PlanServiceGateError,
} from "../planService";
import { hashPin } from "./pinChallenge";

/* -------------------------------------------------------------------------- */
/* HMAC verification helpers                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Verify HMAC-SHA256 signature on the raw transcript-hook body. Returns
 * true if the signature matches the body under
 * `VOICE_TRANSCRIPT_HMAC_SECRET`. Constant-time comparison via SubtleCrypto.
 *
 * Header format: `sha256=<hex>`. Same scheme as GitHub webhooks; the
 * voice-call plugin's `webhookSecret` config emits this format per
 * https://docs.openclaw.ai/plugins/voice-call.
 */
export async function verifyTranscriptHmac(
  rawBody: string,
  signatureHeader: string | null,
  secret: string
): Promise<boolean> {
  if (!signatureHeader || !secret) return false;
  const prefix = "sha256=";
  if (!signatureHeader.startsWith(prefix)) return false;
  const provided = signatureHeader.slice(prefix.length).toLowerCase();
  if (!/^[0-9a-f]+$/.test(provided)) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  const sigBytes = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(rawBody)
  );
  const computed = bytesToHex(new Uint8Array(sigBytes));
  if (computed.length !== provided.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return diff === 0;
}

function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}

/* -------------------------------------------------------------------------- */
/* Transcript hook payload                                                     */
/* -------------------------------------------------------------------------- */

export interface TranscriptHookPayload {
  callId: string;
  businessId: string;
  direction: "inbound" | "outbound";
  fromNumber: string;
  toNumber: string;
  startedAt: number;
  /** Optional — present on chunk events. */
  chunk?: {
    role: "caller" | "agent" | "system";
    ts: number;
    text: string;
    chunkIdx: number;
  };
  /** Optional — present on the final-summary event. */
  finalize?: {
    endedAt: number;
    durationSec: number;
    summary?: string;
    escalatedToOperator?: boolean;
    costCents?: number;
  };
}

export function parseTranscriptHookPayload(
  raw: unknown
): TranscriptHookPayload {
  if (!raw || typeof raw !== "object") {
    throw new Error("transcripts: payload must be an object.");
  }
  const o = raw as Record<string, unknown>;
  const callId = stringField(o.callId, "callId");
  const businessId = stringField(o.businessId, "businessId");
  const direction = enumField(
    o.direction,
    ["inbound", "outbound"] as const,
    "direction"
  );
  const fromNumber = stringField(o.fromNumber, "fromNumber");
  const toNumber = stringField(o.toNumber, "toNumber");
  const startedAt = numberField(o.startedAt, "startedAt");

  let chunk: TranscriptHookPayload["chunk"];
  if (o.chunk && typeof o.chunk === "object") {
    const c = o.chunk as Record<string, unknown>;
    chunk = {
      role: enumField(c.role, ["caller", "agent", "system"] as const, "chunk.role"),
      ts: numberField(c.ts, "chunk.ts"),
      text: stringField(c.text, "chunk.text"),
      chunkIdx: numberField(c.chunkIdx, "chunk.chunkIdx"),
    };
  }

  let finalize: TranscriptHookPayload["finalize"];
  if (o.finalize && typeof o.finalize === "object") {
    const f = o.finalize as Record<string, unknown>;
    finalize = {
      endedAt: numberField(f.endedAt, "finalize.endedAt"),
      durationSec: numberField(f.durationSec, "finalize.durationSec"),
      summary:
        typeof f.summary === "string" ? f.summary : undefined,
      escalatedToOperator:
        typeof f.escalatedToOperator === "boolean"
          ? f.escalatedToOperator
          : undefined,
      costCents:
        typeof f.costCents === "number" ? f.costCents : undefined,
    };
  }

  if (!chunk && !finalize) {
    throw new Error(
      "transcripts: payload must contain either `chunk` or `finalize`."
    );
  }

  return {
    callId,
    businessId,
    direction,
    fromNumber,
    toNumber,
    startedAt,
    chunk,
    finalize,
  };
}

function stringField(v: unknown, name: string): string {
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`transcripts: '${name}' must be a non-empty string.`);
  }
  return v;
}

function numberField(v: unknown, name: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error(`transcripts: '${name}' must be a finite number.`);
  }
  return v;
}

function enumField<T extends string>(
  v: unknown,
  allowed: ReadonlyArray<T>,
  name: string
): T {
  if (typeof v !== "string" || !(allowed as ReadonlyArray<string>).includes(v)) {
    throw new Error(
      `transcripts: '${name}' must be one of ${allowed.join("|")}; got ${String(v)}.`
    );
  }
  return v as T;
}

/* -------------------------------------------------------------------------- */
/* Internal mutations                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Append a transcript chunk to an existing call OR create the row on the
 * first chunk. Idempotent: a chunk whose `chunkIdx` is already present is
 * dropped silently.
 *
 * Cross-tenant guard: businessId must match the row if it exists.
 */
export const recordTranscriptChunk = internalMutation({
  args: {
    businessId: v.id("businesses"),
    callId: v.string(),
    direction: v.union(v.literal("inbound"), v.literal("outbound")),
    fromNumber: v.string(),
    toNumber: v.string(),
    startedAt: v.number(),
    chunk: v.object({
      role: v.union(
        v.literal("caller"),
        v.literal("agent"),
        v.literal("system")
      ),
      ts: v.number(),
      text: v.string(),
      chunkIdx: v.number(),
    }),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    transcriptId: Id<"voiceCallTranscripts">;
    duplicate: boolean;
  }> => {
    const existing = await ctx.db
      .query("voiceCallTranscripts")
      .withIndex("by_callId", (q) => q.eq("callId", args.callId))
      .first();

    if (existing) {
      if (existing.businessId !== args.businessId) {
        throw new Error(
          `recordTranscriptChunk: cross-tenant violation — call ${args.callId} belongs to a different business.`
        );
      }
      const isDup = existing.transcript.some(
        (c) => c.chunkIdx === args.chunk.chunkIdx
      );
      if (isDup) {
        return { transcriptId: existing._id, duplicate: true };
      }
      const next = [...existing.transcript, args.chunk].sort(
        (a, b) => a.chunkIdx - b.chunkIdx
      );
      await ctx.db.patch(existing._id, { transcript: next });
      return { transcriptId: existing._id, duplicate: false };
    }

    const transcriptId = await ctx.db.insert("voiceCallTranscripts", {
      businessId: args.businessId,
      callId: args.callId,
      direction: args.direction,
      fromNumber: args.fromNumber,
      toNumber: args.toNumber,
      startedAt: args.startedAt,
      transcript: [args.chunk],
      escalatedToOperator: false,
      pinChallengePassed: null,
    });
    return { transcriptId, duplicate: false };
  },
});

/**
 * One-shot finalization — sets endedAt + durationSec + summary. Second
 * call is a no-op.
 *
 * Wave D telemetry: when `voiceRating` is provided (1-5), emit a
 * `voice-satisfaction` row. The plugin can optionally collect a
 * post-call rating via SMS or in-call IVR; when absent, no signal emits.
 */
export const finalizeTranscript = internalMutation({
  args: {
    businessId: v.id("businesses"),
    callId: v.string(),
    endedAt: v.number(),
    durationSec: v.number(),
    summary: v.optional(v.string()),
    escalatedToOperator: v.optional(v.boolean()),
    costCents: v.optional(v.number()),
    /**
     * Optional 1-5 post-call rating. Omitted = no signal emitted (the
     * common path; rating is collected out-of-band on operator opt-in).
     */
    voiceRating: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<void> => {
    const existing = await ctx.db
      .query("voiceCallTranscripts")
      .withIndex("by_callId", (q) => q.eq("callId", args.callId))
      .first();
    if (!existing) {
      throw new Error(
        `finalizeTranscript: no transcript row for call ${args.callId}; chunks missing.`
      );
    }
    if (existing.businessId !== args.businessId) {
      throw new Error(
        `finalizeTranscript: cross-tenant violation — call ${args.callId} belongs to a different business.`
      );
    }
    if (existing.endedAt !== undefined) {
      // Already finalized — no-op (idempotent).
      return;
    }
    await ctx.db.patch(existing._id, {
      endedAt: args.endedAt,
      durationSec: args.durationSec,
      summary: args.summary,
      escalatedToOperator: args.escalatedToOperator ?? false,
      costCents: args.costCents,
    });

    // Wave D — voice-satisfaction emit (Studio-only signal in practice;
    // gated by the fact that only Studio businesses provision voice).
    if (
      args.voiceRating !== undefined &&
      Number.isFinite(args.voiceRating) &&
      args.voiceRating >= 1 &&
      args.voiceRating <= 5
    ) {
      const outcome =
        args.voiceRating >= 4
          ? "positive"
          : args.voiceRating <= 2
            ? "negative"
            : "neutral";
      await ctx.db.insert("serviceTelemetry", {
        businessId: args.businessId,
        signal: "voice-satisfaction",
        outcome,
        numericValue: args.voiceRating,
        metadata: { callId: args.callId, durationSec: args.durationSec },
        ts: Date.now(),
      });
    }
  },
});

/* -------------------------------------------------------------------------- */
/* Public read surface — Profile + Today screen support                        */
/* -------------------------------------------------------------------------- */

export const getTranscript = query({
  args: { transcriptId: v.id("voiceCallTranscripts") },
  handler: async (
    ctx,
    args
  ): Promise<Doc<"voiceCallTranscripts"> | null> => {
    const session = await getCurrentBusinessSession(ctx);
    if (!session) return null;
    const row = await ctx.db.get(args.transcriptId);
    if (!row) return null;
    // Cross-tenant: only return if caller's business matches.
    if (row.businessId !== session.business._id) return null;
    return row;
  },
});

export const listTranscripts = query({
  args: {
    rangeStart: v.optional(v.number()),
    rangeEnd: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<Doc<"voiceCallTranscripts">[]> => {
    const session = await getCurrentBusinessSession(ctx);
    if (!session) return [];
    const limit = Math.min(args.limit ?? 50, 200);
    const rangeStart = args.rangeStart ?? 0;
    const rangeEnd = args.rangeEnd ?? Date.now() + 1;
    const rows = await ctx.db
      .query("voiceCallTranscripts")
      .withIndex("by_business_and_started_at", (q) =>
        q
          .eq("businessId", session.business._id)
          .gte("startedAt", rangeStart)
          .lte("startedAt", rangeEnd)
      )
      .order("desc")
      .take(limit);
    return rows;
  },
});

/* -------------------------------------------------------------------------- */
/* Operator-driven PIN setup — public action wrapper                          */
/* -------------------------------------------------------------------------- */

/**
 * Operator sets/rotates their voice PIN. Studio-only — gated server-side.
 *
 * Design note: this is an `action` (not mutation) because PBKDF2 derivation
 * via `crypto.subtle.deriveBits` runs a 600k-iteration loop that exceeds
 * the mutation CPU budget (~1s). Actions can run longer.
 */
export const setMyVoicePin = action({
  args: { pin: v.string() },
  handler: async (ctx: ActionCtx, args): Promise<{ ok: true }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("setMyVoicePin: not authenticated.");
    }
    const ctxRow = await ctx.runQuery(
      internal.integrations.zernio.oauth.getMyBusinessForOAuth,
      { clerkUserId: identity.subject }
    );
    if (!ctxRow) {
      throw new Error("setMyVoicePin: no service-business row.");
    }
    const features = planFeaturesService(ctxRow.business);
    if (!features.voice || features.plan !== "studio") {
      throw new PlanServiceGateError(features.plan, "voice:set-pin", "studio");
    }
    const hash = await hashPin(args.pin);
    await ctx.runMutation(
      internal.voice.pinChallenge.setPinForBusinessInternal,
      { businessId: ctxRow.business._id, pinHash: hash }
    );
    return { ok: true };
  },
});

/**
 * Operator clears their voice PIN.
 */
export const clearMyVoicePin = action({
  args: {},
  handler: async (ctx: ActionCtx): Promise<{ ok: true }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("clearMyVoicePin: not authenticated.");
    }
    const ctxRow = await ctx.runQuery(
      internal.integrations.zernio.oauth.getMyBusinessForOAuth,
      { clerkUserId: identity.subject }
    );
    if (!ctxRow) {
      throw new Error("clearMyVoicePin: no service-business row.");
    }
    await ctx.runMutation(
      internal.voice.pinChallenge.clearPinForBusinessInternal,
      { businessId: ctxRow.business._id }
    );
    return { ok: true };
  },
});

/**
 * Update inbound allowlist + realtime provider preference. Studio-only.
 * Voice-call plugin re-reads this on next bundle re-deploy; live-update is
 * out of scope for v0 (operator opens a Profile setting, redeploys via
 * "Apply changes" button — wired by HQ UI agent's stub).
 */
export const updateMyVoiceSettings = action({
  args: {
    allowlist: v.optional(v.array(v.string())),
    realtimeProvider: v.optional(
      v.union(v.literal("elevenlabs"), v.literal("gemini-live"))
    ),
  },
  handler: async (ctx: ActionCtx, args): Promise<{ ok: true }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("updateMyVoiceSettings: not authenticated.");
    }
    const ctxRow = await ctx.runQuery(
      internal.integrations.zernio.oauth.getMyBusinessForOAuth,
      { clerkUserId: identity.subject }
    );
    if (!ctxRow) {
      throw new Error("updateMyVoiceSettings: no service-business row.");
    }
    const features = planFeaturesService(ctxRow.business);
    if (!features.voice || features.plan !== "studio") {
      throw new PlanServiceGateError(
        features.plan,
        "voice:update-settings",
        "studio"
      );
    }
    if (args.allowlist) {
      // Sanitize: E.164 only; deduplicate; cap at 50 entries.
      const cleaned = Array.from(
        new Set(
          args.allowlist
            .map((n) => String(n).trim())
            .filter((n) => /^\+[1-9][0-9]{6,14}$/.test(n))
        )
      ).slice(0, 50);
      await ctx.runMutation(
        internal.voice.transcripts.patchVoiceChannelInternal,
        {
          businessId: ctxRow.business._id,
          inboundAllowlist: cleaned,
        }
      );
    }
    if (args.realtimeProvider) {
      await ctx.runMutation(
        internal.voice.transcripts.patchVoiceChannelInternal,
        {
          businessId: ctxRow.business._id,
          realtimeProvider: args.realtimeProvider,
        }
      );
    }
    return { ok: true };
  },
});

export const patchVoiceChannelInternal = internalMutation({
  args: {
    businessId: v.id("businesses"),
    inboundAllowlist: v.optional(v.array(v.string())),
    realtimeProvider: v.optional(
      v.union(v.literal("elevenlabs"), v.literal("gemini-live"))
    ),
  },
  handler: async (ctx, args): Promise<void> => {
    const channel = await ctx.db
      .query("voiceChannels")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .first();
    if (!channel) {
      throw new Error(
        `patchVoiceChannelInternal: voiceChannels row missing for business ${args.businessId}.`
      );
    }
    const patch: Record<string, unknown> = {};
    if (args.inboundAllowlist !== undefined) {
      patch.inboundAllowlist = args.inboundAllowlist;
    }
    if (args.realtimeProvider !== undefined) {
      patch.realtimeProvider = args.realtimeProvider;
    }
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(channel._id, patch);
    }
  },
});
