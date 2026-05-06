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
  completeGoogleCalendarOAuthHttp,
  cronHeartbeatHttp,
  lockPictureHttp,
  logTrendHttp,
  submitOpeningAnswersHttp,
  startGoogleCalendarOAuthHttp,
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
// Sprint 6 — Maya commits the synthesized picture after the post-synth
// verify round-trip. Stamps `creators.pictureLockedAt`, which is what the
// `first_weekly_plan` standing order keys off (replaces the prior trigger
// on `openingAnswersAt`). Body: { secret, creatorId, corrections? }.
http.route({
  path: "/lc_maya/lock_picture",
  method: "POST",
  handler: lockPictureHttp,
});
http.route({
  path: "/lc_maya/start_oauth",
  method: "POST",
  handler: startOAuthHttp,
});
http.route({
  path: "/lc_maya/log_trend",
  method: "POST",
  handler: logTrendHttp,
});
// Wave 0b — append-only cron heartbeat receipt. Maya hits this from a
// `cron.heartbeat` standing order so we have ground-truth that OpenClaw
// cron is firing in production. Read-back lives in the smoke harness +
// admin queries; never exposed to browser clients.
http.route({
  path: "/lc_maya/cron_heartbeat",
  method: "POST",
  handler: cronHeartbeatHttp,
});

// Wave 0b smoke harness routes — gated by WEBHOOK_INTERNAL_SECRET in the
// body. Used ONLY by `scripts/cron-fly-smoke.ts` to insert + tear down
// the smoke creator and read back its heartbeat rows. Never used by the
// production web client.
import {
  cronHeartbeatsForCreatorHttp,
  deleteSmokeCreatorHttp,
  insertSmokeCreatorHttp,
} from "./smokeFixtures/cronHeartbeat";
http.route({
  path: "/smoke/cron_heartbeat/insert_creator",
  method: "POST",
  handler: insertSmokeCreatorHttp,
});
http.route({
  path: "/smoke/cron_heartbeat/delete_creator",
  method: "POST",
  handler: deleteSmokeCreatorHttp,
});
http.route({
  path: "/smoke/cron_heartbeat/list",
  method: "POST",
  handler: cronHeartbeatsForCreatorHttp,
});

// Sprint 7 Slice B — iMessage-tap Google Calendar OAuth handoff.
// Maya texts the creator a connect link, the operator taps it on their
// phone (no Clerk session in that browser). This endpoint mints a UUID
// state token that the iMessage callback uses to re-resolve which
// creator just authorized.
http.route({
  path: "/lc_maya/start_google_calendar_oauth",
  method: "POST",
  handler: startGoogleCalendarOAuthHttp,
});

// Sprint 7 Slice B — completion sister-endpoint of
// `/lc_maya/start_google_calendar_oauth`. The Next.js iMessage callback
// POSTs the resolved tokens + lookahead events here; we atomically
// consume the single-use state token (lazy TTL check) and write the
// connection to the creator's row.
http.route({
  path: "/lc_maya/complete_google_calendar_oauth",
  method: "POST",
  handler: completeGoogleCalendarOAuthHttp,
});

export default http;
