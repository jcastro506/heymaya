# Zernio (Late, getlate.dev) integration — service product Sprint 1

**Status:** v0 routing layer for ALL service-side social platforms — GBP,
FB Pages, IG Business, TikTok, LinkedIn, X, Pinterest, Threads.

**Locked by:** operator decision 2026-04-27, `docs/SPRINT_PLAN_SERVICE_V0.md`
§ 3 layer table + § 13 Sprint 1.

## Why Zernio (and why interface-isolated)

Per `docs/research/R1_UNIFIED_SOCIAL_APIS.md` § Verdict:

- Zernio gives one OAuth flow, one billing line, one normalized API across
  GBP / FB / IG / TikTok / LinkedIn / X / YouTube / Pinterest / Threads /
  Reddit / Bluesky / WhatsApp at $19–$49/mo flat.
- Operator does NOT have GBP API partner access (2-8 wk wait, no SLA),
  Meta App Review, or other direct platform credentials. Zernio is the
  only path that ships v0.
- Lock-in risk is **HIGH** (Zernio is a 5-person bootstrapped company).
  Mitigation: the code is interface-isolated so swapping to Ayrshare or
  another aggregator takes <2 weeks.

## Interface-isolation contract

**Skill code, behaviors, Convex actions, and UI MUST NOT import from
`convex/integrations/zernio/` directly.** They go through stable wrappers:

| Surface | Import path | Implementation now | Implementation later |
|---|---|---|---|
| GBP   | `convex/integrations/gbp/index.ts`    | `./zernio.ts` | `./direct/` (post-partner-access) |
| FB    | `convex/integrations/fb/`*            | `./zernio.ts`* | direct Meta Graph |
| IG    | `convex/integrations/ig/`*            | `./zernio.ts`* | direct Meta Graph |
| TT    | `convex/integrations/tt/`*            | `./zernio.ts`* | direct TikTok Content Posting |
| Multi | `convex/integrations/social/`*        | `./zernio.ts`* | per-platform direct |

*\* The non-GBP wrapper barrels land in Sprint 3 alongside the skills that
consume them. The per-platform endpoint functions are already implemented
in `endpoints.ts` — Sprint 3 just adds the thin re-export modules.*

If we have to swap to Ayrshare in <2 weeks (R1 § Verdict — lock-in
mitigation), the swap path is:

1. Replace `convex/integrations/zernio/client.ts` with an Ayrshare client.
2. Replace `convex/integrations/zernio/endpoints.ts` with Ayrshare endpoint
   wrappers that produce IDENTICAL return types from `types.ts`.
3. Replace `convex/integrations/zernio/webhooks.ts` with Ayrshare's webhook
   shape. The downstream `mayaTaskQueue` schema is provider-agnostic.
4. Update `convex/integrations/zernio/oauth.ts` for Ayrshare's connect
   flow.
5. **No changes anywhere else in the codebase.**

## Files

- `client.ts` — Bearer-token auth, retry+backoff, HMAC-SHA256 webhook
  signature verifier. The transport.
- `types.ts` — OUR types, not Zernio's. The interface contract.
- `endpoints.ts` — every endpoint wrapper. GBP (locations / reviews /
  reply / posts / insights), FB (post / messages), IG (post / reel /
  comments), generic multi-platform post, lighter-weight platforms.
- `oauth.ts` — Convex actions: `zernioStartConnect`,
  `zernioHandleCallback`, `zernioRevoke`. Plus internal helpers.
- `webhooks.ts` — Convex mutation + action that the Next.js
  `app/api/webhooks/zernio/route.ts` calls after signature verification.
  Routes events → `mayaTaskQueue` (Sprint 3 skills consume).
- `__tests__/` — full test matrix: client, endpoints, webhooks, oauth.

## Schema additions (this sprint)

- `zernioConnections` (per-business): zernio account id + encrypted API key
  + encrypted webhook secret + `connectedPlatforms[]`.
- `mayaTaskQueue` (per-business): inbound work queue. Producer = webhook
  receivers + polling actions. Consumer = Sprint 3 skill orchestrator.

Cross-tenant tests in `__tests__/` cover both tables.

## Live-smoke gate

Per `docs/SPRINT_PLAN_SERVICE_V0.md` § 13 Sprint 1 acceptance:

> Zernio scaffold handles a test FB post end-to-end.

This CANNOT be validated locally without operator's Zernio Build-tier
subscription. The live-smoke gate sequence (when keys land):

1. Operator creates a Zernio Build-tier account, copies workspace API key
   into Convex env: `ZERNIO_PROVISIONING_API_KEY`.
2. Operator runs the OAuth flow against a real test GBP + a test FB Page
   through `zernioStartConnect` → `zernioHandleCallback`.
3. `gbp/index.ts` `listLocations()` returns the test location.
4. `gbp/index.ts` `createLocalPost()` posts a STANDARD post; round-trips
   through Zernio → Google → live profile.
5. `gbp/index.ts` `listReviews()` returns the seeded test reviews.
6. `gbp/index.ts` `replyToReview()` against a test review either succeeds
   or fails with a `GbpModerationError` (both are valid — path is
   verified either way).
7. Direct `endpoints.ts.fbCreatePost()` posts to the test FB Page.
8. Zernio fires a `post.published` webhook. The Next.js
   `app/api/webhooks/zernio/route.ts` route verifies HMAC, calls
   `processVerifiedWebhookPublic`, and the gbpPosts row flips status.

## Open `[unverified]` items (operator should validate during Zernio onboarding)

- **Exact endpoint paths** — `endpoints.ts` cites
  `/api/v1/{posts,reviews,locations,insights,messages,comments,connect/*}`
  but Zernio's public docs are partial. The live-smoke gate confirms.
- **`ReviewReplyState` surface** — Zernio's docs do not currently pin
  whether they expose Google's `ReviewReplyState` enum verbatim.
  `endpoints.ts:gbpReplyToReview` assumes either `state: "REJECTED"` on
  the response OR `errorCode: "REVIEW_REPLY_REJECTED"`. If neither
  surfaces in real responses, behavior #4 falls back to operator-
  approval-only (per service plan § 3 row escalation note).
- **Webhook signature header name** — confirmed `X-Late-Signature` from
  https://docs.getlate.dev/core/webhooks (legacy "Late" branding retained).
- **Webhook event ID field** — assumed `id` or `eventId`; live-smoke
  confirms the canonical name.
- **`webhook.test` event recognition** — assumed Zernio uses the literal
  string `webhook.test` per docs. Confirm.
- **Per-platform connection account ID field names** — `pageId` for FB,
  `igAccountId` for IG, etc. Live-smoke confirms.
- **Insights metric names** — assumed `VIEWS_SEARCH` / `VIEWS_MAPS` etc.
  per Google's surface, but Zernio may normalize. Confirm and
  re-narrow `GbpInsightsRequest.metrics` enum.

## Plan-tier gating (per `convex/planService.ts`)

- GBP read (listReviews, getInsights, listLocations): all tiers.
- GBP write (post, reply, update, delete):
  - Reply: ALWAYS operator-approval-gated (Google `ReviewReplyState`
    lock — never auto-publish). The skill layer enforces.
  - Post: auto-publish gated on `approvalRules.gbp-post-auto-publish`
    enabled (Pro+ only).
- FB / IG / TikTok / LinkedIn / X / Pinterest / Threads write: Pro+
  (Starter `maxSocialPlatforms === 0`).
- TikTok / LinkedIn / X / Pinterest / Threads: Studio-only
  (Pro `maxSocialPlatforms` is bounded; Studio is `unlimited`).
- `multiPlatformPost`: enforces per-platform tier check on each target;
  rejects entire call if any target is gated.

## Operator-required env vars

| Var | Purpose | When |
|---|---|---|
| `ZERNIO_PROVISIONING_API_KEY` | Workspace key used to bootstrap per-business connections | Sprint 1 |
| `ZERNIO_BASE_URL` (optional)  | Override Zernio API base URL (defaults to `https://getlate.dev`) | Sprint 1 |
| `ZERNIO_OAUTH_REDIRECT_BASE_URL` (optional) | Default redirect base URL — frontend can supply per-call | Sprint 2 |
| `WEBHOOK_INTERNAL_SECRET` | Shared secret for the public webhook bridge | Sprint 1 (already in env from Composio sprint) |

Per-business secrets (Zernio API key + webhook signing secret) are stored
encrypted in `zernioConnections` via `convex/lib/encryption.ts`.

## Cross-reference

- v0 spec: `docs/SPRINT_PLAN_SERVICE_V0.md` § 3 layer table + § 13 Sprint 1
- Research: `docs/research/R1_UNIFIED_SOCIAL_APIS.md` § Zernio
- Parked direct GBP path: `convex/integrations/gbp/direct/README.md`
- Plan-tier matrix: `convex/planService.ts`
- Webhook idempotency table: `convex/schema.ts` `webhookEvents`
- Encryption helper: `convex/lib/encryption.ts`
