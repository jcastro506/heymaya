/**
 * HTTP webhook entry for the OpenClaw `voice-call` plugin's transcript hook.
 *
 * Wave D — service plan § 13 Sprint 6. Plugin POSTs to
 * `POST /voice/transcript?businessId=<id>` with HMAC-SHA256 in the
 * `X-Voice-Call-Signature: sha256=<hex>` header. We verify, parse, and
 * dispatch to either `recordTranscriptChunk` (per chunk) or
 * `finalizeTranscript` (post-call).
 *
 * Cross-tenant: `businessId` must appear in BOTH the URL and the body, and
 * they MUST match. The body's `businessId` is what we trust for DB writes
 * (the URL exists for log-friendliness + plugin-side routing).
 *
 * Failure modes:
 *   - Missing/invalid HMAC → 401
 *   - Body parse fail → 400
 *   - URL/body businessId mismatch → 403
 *   - Internal mutation throw → 500 + plugin retries
 *
 * Per `feedback_openclaw_native_first.md`: the plugin owns retries + ack
 * semantics. Convex returns 200 on success, 4xx on permanent failures
 * (HMAC, parse), 5xx on transient failures (DB unreachable). Plugin will
 * retry the 5xx path.
 */

import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  parseTranscriptHookPayload,
  verifyTranscriptHmac,
} from "./transcripts";
import type { Id } from "../_generated/dataModel";

const SIGNATURE_HEADER = "X-Voice-Call-Signature";

export const voiceTranscriptHttp = httpAction(async (ctx, request) => {
  const secret = process.env.VOICE_TRANSCRIPT_HMAC_SECRET;
  if (!secret) {
    return new Response(
      JSON.stringify({ error: "VOICE_TRANSCRIPT_HMAC_SECRET not configured" }),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      }
    );
  }

  const rawBody = await request.text();
  const sig = request.headers.get(SIGNATURE_HEADER);
  const ok = await verifyTranscriptHmac(rawBody, sig, secret);
  if (!ok) {
    return new Response(
      JSON.stringify({ error: "Signature verification failed" }),
      { status: 401, headers: { "content-type": "application/json" } }
    );
  }

  let parsed;
  try {
    parsed = parseTranscriptHookPayload(JSON.parse(rawBody));
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  // URL-vs-body cross-check. Both fields exist defense-in-depth.
  const url = new URL(request.url);
  const urlBusinessId = url.searchParams.get("businessId");
  if (urlBusinessId && urlBusinessId !== parsed.businessId) {
    return new Response(
      JSON.stringify({ error: "businessId mismatch (url vs body)" }),
      { status: 403, headers: { "content-type": "application/json" } }
    );
  }

  const businessId = parsed.businessId as Id<"businesses">;

  try {
    if (parsed.chunk) {
      const result = await ctx.runMutation(
        internal.voice.transcripts.recordTranscriptChunk,
        {
          businessId,
          callId: parsed.callId,
          direction: parsed.direction,
          fromNumber: parsed.fromNumber,
          toNumber: parsed.toNumber,
          startedAt: parsed.startedAt,
          chunk: parsed.chunk,
        }
      );
      return new Response(
        JSON.stringify({
          ok: true,
          duplicate: result.duplicate,
          transcriptId: result.transcriptId,
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    if (parsed.finalize) {
      await ctx.runMutation(internal.voice.transcripts.finalizeTranscript, {
        businessId,
        callId: parsed.callId,
        endedAt: parsed.finalize.endedAt,
        durationSec: parsed.finalize.durationSec,
        summary: parsed.finalize.summary,
        escalatedToOperator: parsed.finalize.escalatedToOperator,
        costCents: parsed.finalize.costCents,
      });
      // Wave D coordination: hand off to Stripe voice metering after the
      // transcript is finalized. Fire-and-forget per the contract documented
      // in `convex/integrations/stripe/voiceMetering.ts`.
      await ctx.runAction(
        internal.integrations.stripe.voiceMetering.recordVoiceMinutes,
        {
          businessId,
          callId: parsed.callId,
          durationSec: parsed.finalize.durationSec,
        }
      );
      return new Response(JSON.stringify({ ok: true, finalized: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    // parser would have rejected this, but defense-in-depth.
    return new Response(
      JSON.stringify({ error: "no chunk or finalize in payload" }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
});
