/**
 * Convex HTTP router — top-level dispatcher for `httpAction`s.
 *
 * Per Convex's runtime contract, every `httpAction` we want exposed via the
 * Convex deployment's `*.convex.site` HTTP surface must be registered on the
 * default-exported `httpRouter` instance here. Only one `convex/http.ts`
 * file is allowed per project; all routes funnel through it.
 *
 * Wave D — service plan § 13 Sprint 6 — registers the voice-call plugin's
 * transcript hook endpoint. As other waves bring their httpActions online
 * (Nango CRM webhook, Stripe webhook, Composio Gmail webhook, etc.), they
 * register here too.
 */

import { httpRouter } from "convex/server";
import { voiceTranscriptHttp } from "./voice/transcriptHttp";
import { openClawMediaIngestHttp } from "./creatorMayaV0/openClawMediaIngestHttp";

const http = httpRouter();

// Voice-call plugin transcript hook. The OpenClaw `voice-call` plugin POSTs
// per-chunk + post-call-finalize events here with HMAC-SHA256 signature in
// the `X-Voice-Call-Signature` header. See
// `convex/voice/transcriptHttp.ts` for the full contract.
http.route({
  path: "/voice/transcript",
  method: "POST",
  handler: voiceTranscriptHttp,
});

// Native iMessage/OpenClaw media bridge. The gateway POSTs transient
// attachments here so Convex can store durable creator-owned media assets
// before Maya analyzes, edits, or reuses them.
http.route({
  path: "/creator-maya-v0/openclaw/media",
  method: "POST",
  handler: openClawMediaIngestHttp,
});

export default http;
