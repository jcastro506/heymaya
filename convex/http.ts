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
import { uploadRenderedMediaHttp } from "./creatorMayaV0/uploadRenderedMediaHttp";
import {
  applyObservationsToFingerprintHttp,
  completeGoogleCalendarOAuthHttp,
  connectedAccountsHealthHttp,
  cronHeartbeatHttp,
  fetchTrendsLiveHttp,
  getRecentTrendsHttp,
  lockPictureHttp,
  logTrendHttp,
  observePublishedEditHttp,
  submitOpeningAnswersHttp,
  startGoogleCalendarOAuthHttp,
  startOAuthHttp,
  updateCreatorHttp,
  validateOutboundSendHttp,
  validateTrendCitationHttp,
} from "./lcMaya/lcMayaHttp";
import { produceEditHttp } from "./lcMaya/produceEdit";
import { syncWikiObservationsHttp } from "./lcMaya/wikiMirrorSync";
import { appleCalendarConnectHttp } from "./lcMaya/appleCalendarConnect";
import {
  gmailDraftHttp,
  gmailGetMessageHttp,
  gmailListInboxHttp,
  gmailSendHttp,
} from "./lcMaya/gmailHttp";
import {
  appleCalendarCreateEventHttp,
  appleCalendarDeleteEventHttp,
  appleCalendarListCalendarsHttp,
  appleCalendarListEventsHttp,
  appleCalendarUpdateEventHttp,
  calendarCreateEventHttp,
  calendarDeleteEventHttp,
  calendarListEventsHttp,
  calendarUpdateEventHttp,
} from "./lcMaya/calendarHttp";

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

// Sprint A.1 — outbound media bridge. After `maya-clip-editor` renders an
// mp4 onto the Fly machine's local volume, Maya POSTs the bytes here
// (multipart/form-data) to land them in Convex storage and get back a
// publicly fetchable signed URL. She then passes THAT URL to
// `claw-messenger.sendMedia` — local volume paths can't reach the relay.
// Sibling: `convex/creatorMayaV0/uploadRenderedMediaHttp.ts`.
http.route({
  path: "/lc_maya/upload_rendered_media",
  method: "POST",
  handler: uploadRenderedMediaHttp,
});

// C1 — produce_edit: creator's raw clips + brief → one fused Gemini watch+
// decide call (conditioned on their picture) → validated EDL the
// maya-tiktok-director skill compiles to ffmpeg. Reuses the generic
// video-synth-worker `/synthesize` transport. See `lcMaya/produceEdit.ts`.
http.route({
  path: "/lc_maya/produce_edit",
  method: "POST",
  handler: produceEditHttp,
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
// Sprint 9.7+ — minimal write surface for first-boot arc-complete cursors
// (firstBootCompletedAt, firstWeeklyPlanSentAt). Per-flag idempotency in the
// internal mutation; first stamp wins.
http.route({
  path: "/lc_maya/update_creator",
  method: "POST",
  handler: updateCreatorHttp,
});
http.route({
  path: "/lc_maya/log_trend",
  method: "POST",
  handler: logTrendHttp,
});
// Sprint 12.7 Phase 1 — cache-read + live-fetch for trend grounding.
// `get_recent_trends` is the integrated-read pre-check Maya runs before
// claiming any trend; `fetch_trends_live` is the fallback when the cache is
// empty or stale. Maya combines them with `log_trend` (above) to ground every
// chat-time trend pitch in real ScrapeCreators URLs.
http.route({
  path: "/lc_maya/get_recent_trends",
  method: "POST",
  handler: getRecentTrendsHttp,
});
http.route({
  path: "/lc_maya/fetch_trends_live",
  method: "POST",
  handler: fetchTrendsLiveHttp,
});
// Sprint 12.7 Phase 2 — pre-send citation firewall. Maya invokes this before
// any outbound message that mentions trends. Returns ok=false when the draft
// talks about trends without citing a real platform-post URL. Stateless.
http.route({
  path: "/lc_maya/validate_trend_citation",
  method: "POST",
  handler: validateTrendCitationHttp,
});
// Sprint 12.7.3 — pre-send firewall. The claw-messenger plugin invokes this
// before every outbound message leaves the Fly machine. ok=false → the plugin
// throws so Maya's LLM loop sees the failure and redrafts. Catches both
// trend-shape confabulation (no citation) and markdown that iMessage cannot
// render (bold, headers, bullets, numbered lists, code fences).
http.route({
  path: "/lc_maya/validate_outbound_send",
  method: "POST",
  handler: validateOutboundSendHttp,
});
// Sprint 12.7.1 — canonical "is the OAuth landed?" check. Pre-12.7.1 Maya was
// forced to call gmail_list_inbox or calendar_list_events (which both require
// extra args) as a proxy; on the Kevin re-onboard she confabulated an endpoint
// at this exact path. This is the endpoint she was reaching for.
http.route({
  path: "/lc_maya/connected_accounts_health",
  method: "POST",
  handler: connectedAccountsHealthHttp,
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

// Sprint 9.8 Workstream A — Gmail HTTP endpoints. Token resolution +
// scope assertion happens in the resolver (`resolveGoogleAccessTokenForCreator`);
// these handlers are thin wrappers around `convex/integrations/google/gmail.ts`.
http.route({
  path: "/lc_maya/gmail_list_inbox",
  method: "POST",
  handler: gmailListInboxHttp,
});
http.route({
  path: "/lc_maya/gmail_get_message",
  method: "POST",
  handler: gmailGetMessageHttp,
});
http.route({
  path: "/lc_maya/gmail_draft",
  method: "POST",
  handler: gmailDraftHttp,
});
http.route({
  path: "/lc_maya/gmail_send",
  method: "POST",
  handler: gmailSendHttp,
});

// Sprint 9.8 Workstream B — Apple iCloud Calendar via CalDAV + app-specific
// password. Maya posts here after the creator pastes the app password back
// into iMessage; the endpoint validates by listing calendars and stores the
// encrypted password in `appleCalendarConnections`. Body:
//   { secret, creatorId, appleId, appPassword, defaultCalendarHint? }
http.route({
  path: "/lc_maya/apple_calendar_connect",
  method: "POST",
  handler: appleCalendarConnectHttp,
});

// Sprint 12 Phase 1C — calendar CRUD HTTP endpoints (Google + Apple).
// Phase 2's content-plan flow writes events here; verified end-to-end
// before that lands. Token resolution + scope assertion handled inside
// the handlers (mirrors the gmail HTTP pattern).
http.route({
  path: "/lc_maya/calendar_list_events",
  method: "POST",
  handler: calendarListEventsHttp,
});
http.route({
  path: "/lc_maya/calendar_create_event",
  method: "POST",
  handler: calendarCreateEventHttp,
});
http.route({
  path: "/lc_maya/calendar_update_event",
  method: "POST",
  handler: calendarUpdateEventHttp,
});
http.route({
  path: "/lc_maya/calendar_delete_event",
  method: "POST",
  handler: calendarDeleteEventHttp,
});
http.route({
  path: "/lc_maya/apple_calendar_list_calendars",
  method: "POST",
  handler: appleCalendarListCalendarsHttp,
});
http.route({
  path: "/lc_maya/apple_calendar_list_events",
  method: "POST",
  handler: appleCalendarListEventsHttp,
});
http.route({
  path: "/lc_maya/apple_calendar_create_event",
  method: "POST",
  handler: appleCalendarCreateEventHttp,
});
http.route({
  path: "/lc_maya/apple_calendar_update_event",
  method: "POST",
  handler: appleCalendarUpdateEventHttp,
});
http.route({
  path: "/lc_maya/apple_calendar_delete_event",
  method: "POST",
  handler: appleCalendarDeleteEventHttp,
});

// Sprint 8.5 — wiki → Convex projection mirror sync. Heartbeat-driven,
// batched, idempotent on (creatorId, wikiVaultPath). See
// `convex/lcMaya/wikiMirrorSync.ts` for the full contract.
http.route({
  path: "/lc_maya/sync_wiki_observations",
  method: "POST",
  handler: syncWikiObservationsHttp,
});

// Sprint B.2 — continuous-learning loop. Maya POSTs here from the
// `post_publish_reaction` standing order after analyzing performance:
// watch the published video, diff against the rendered variant + the
// current `editingFingerprint`, persist the structured observation.
// `apply_observations_to_fingerprint` runs the rolling synthesis that
// folds unapplied observations back into the creator's fingerprint.
// See `convex/creatorMayaV0/editingFingerprintObservations.ts` for the
// full contract.
http.route({
  path: "/lc_maya/observe_published_edit",
  method: "POST",
  handler: observePublishedEditHttp,
});
http.route({
  path: "/lc_maya/apply_observations_to_fingerprint",
  method: "POST",
  handler: applyObservationsToFingerprintHttp,
});

export default http;
