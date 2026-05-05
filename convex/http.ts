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
import {
  submitOpeningAnswersHttp,
  startOAuthHttp,
} from "./lcMaya/lcMayaHttp";

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

// `lc_maya.*` first-boot iMessage flow — see `convex/lcMaya/lcMayaHttp.ts`.
// Both endpoints are gated by `WEBHOOK_INTERNAL_SECRET` (constant-time
// compare in `convex/lib/webhookSecret.ts`). Maya posts to these from the
// OpenClaw runtime; the bodies carry the secret, the creatorId, and the
// task-specific payload.
http.route({
  path: "/lc_maya/submit_opening_answers",
  method: "POST",
  handler: submitOpeningAnswersHttp,
});
http.route({
  path: "/lc_maya/start_oauth",
  method: "POST",
  handler: startOAuthHttp,
});

export default http;
