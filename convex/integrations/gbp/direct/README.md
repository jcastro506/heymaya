# Direct Google Business Profile API integration — PARKED

**Status:** Not used in v0. Parked pending operator-provided GBP API partner
access (2–8 week wait, no SLA from Google).

**Decision date:** 2026-04-27 (operator pivot mid-Sprint 1).

## Why this exists

Sprint 1 originally specified a direct Google Business Profile API client as
the v0 review-reply path (review-reply being Maya's most-differentiated
feature). The plan called this out as the "locked" path because Zernio's
review-reply depth was unverified.

Mid-Sprint, the operator confirmed the partner-access wait is incompatible
with v0 timelines. **Zernio becomes the v0 path** for GBP read + write +
review-reply. The direct path is the **post-partner-access upgrade** (Sprint
8+) when keys land.

## When to re-activate

Re-activate when ALL of the following are true:

1. Operator has been granted GBP API partner access (`business.manage` scope
   approved, OAuth client allowlisted).
2. Cloud Pub/Sub topic provisioned at the operator's GBP-account level for
   `NEW_REVIEW` / `UPDATED_REVIEW` / `NEW_QUESTION` notifications.
3. `GBP_OAUTH_CLIENT_ID`, `GBP_OAUTH_CLIENT_SECRET`, `GBP_PUBSUB_TOPIC`,
   `GBP_PUBSUB_VERIFICATION_AUDIENCE` set in Convex env.
4. The Zernio-GBP path (`convex/integrations/zernio/`) has been observed to
   be the bottleneck (e.g., review-reply latency, missing `ReviewReplyState`
   surface, or dropped notification types).

## Migration plan when keys land

The Zernio path and the direct path expose the same logical surface to
behaviors #4 (review reply) and #5 (GBP cadence watch). The swap should be
config-driven via a `business.gbpProvider: "zernio" | "direct"` field
(additive schema change at swap-time) so individual operators can be
flipped to the direct path without a global cutover.

Behaviors that depend on real-time review notifications (#4) need the
Pub/Sub subscriber + JWT verification + idempotency-on-`messageId`
spec'd in `pubsub.ts` (skeleton present, body not implemented).

## Files in this directory

- `client.ts` — partial OAuth + retry skeleton (NOT IMPLEMENTED). Spec
  lives in `docs/SPRINT_PLAN_SERVICE_V0.md` § 13 Sprint 1 (lines ~1184-1212).
- `README.md` (this file).

## Files NOT yet written (recovery list for the post-partner-access agent)

The original Sprint 1 brief specified the following deliverables. None
were committed before the pivot — pick up from the spec when re-activating:

- `endpoints.ts` — Locations, LocalPosts, Reviews, Insights wrappers
  - `listLocations(accessToken)` → `GET https://mybusinessbusinessinformation.googleapis.com/v1/accounts/{account}/locations`
  - `getLocation(accessToken, locationName)` → single location detail
  - `listLocalPosts(accessToken, locationName)` → `GET .../locations/{location}/localPosts`
  - `createLocalPost(accessToken, locationName, post)` → `POST .../locations/{location}/localPosts` (STANDARD/EVENT/OFFER)
  - `updateLocalPost(accessToken, postName, patch)` → `PATCH .../localPosts/{post}` with field mask
  - `deleteLocalPost(accessToken, postName)` → `DELETE .../localPosts/{post}`
  - `listReviews(accessToken, locationName)` → `GET .../locations/{location}/reviews`
  - `replyToReview(accessToken, reviewName, comment)` → `PUT .../reviews/{review}/reply` — must throw `GbpModerationRejectedError` on `ReviewReplyState: REJECTED` so behavior #4 can re-prompt operator
  - `getInsights(accessToken, locationName, request)` → `POST .../locations/{location}:reportInsights` for behavior #14
- `pubsub.ts` — Cloud Pub/Sub subscriber
  - HTTP push delivery (Convex `httpAction`) at `/api/webhooks/gbp/pubsub`
  - Verify Google's signed JWT (`iss=accounts.google.com`, `aud=` Convex deployment URL)
  - Idempotent on `webhookEvents` (provider=`gbp`, externalEventId=Pub/Sub `messageId`)
  - On `NEW_REVIEW`: enqueue draft-reply task via `convex/agents/wakeMaya.ts` → `mayaTaskQueue` table (additive schema, requires `by_business` index)
- `oauth.ts` — Convex actions
  - `gbpStartOAuth(redirectUri)` → returns Google authorization URL with `business.manage` scope
  - `gbpHandleCallback(code, state)` → exchanges code for tokens, stores in new `connectedBusinessAccounts` table (creator-side `connectedAccounts` is creator-scoped — must NOT reuse for businesses)
  - `gbpRefreshIfExpired(businessId, locationId)` — pre-request refresh helper
- `__tests__/` — full test matrix (PARKED until keys land):
  - `client.test.ts` — token refresh, retry on 429/5xx, max-retries, Retry-After
  - `endpoints.test.ts` — each endpoint shape + error-class throwing
  - `pubsub.test.ts` — JWT verify (valid/forged), idempotency, NEW_REVIEW triggers wake, malformed payload rejected
  - `oauth.test.ts` — start/callback flow, encrypted token storage, refresh-before-expiry

## Plan-tier gating points (preserve when re-activating)

Every endpoint that mutates GBP state must check
`planFeaturesService(business).maxGbpLocations > 0` AND respect the per-tier
location count. Read-only endpoints (`listReviews`, `getInsights`) gated on
`accountType === 'service-business'` only.

Error-class hierarchy to preserve:
- `GbpAuthError` — missing keys, invalid tokens, scope revoked
- `GbpRateLimitError` — 429, surfaces Retry-After
- `GbpModerationRejectedError` — `ReviewReplyState: REJECTED` (CRITICAL: behavior #4 re-prompts operator on this)
- `GbpApiError` — generic 4xx/5xx fall-through

## Live-smoke gate (when keys land)

Per plan § 13 Sprint 1 acceptance: "GBP OAuth works against a real test
GBP, posts a LocalPost, reads reviews." The gate cannot be validated
without operator-provided keys. When re-activating, the gate sequence is:

1. Operator runs OAuth flow against a real test GBP location.
2. `listLocations` returns the test location.
3. `createLocalPost` of a STANDARD post round-trips through GBP and appears
   on the live profile.
4. `listReviews` returns the seeded test reviews.
5. `replyToReview` against a test review either succeeds (`ReviewReplyState:
   PUBLISHED`) or fails with `GbpModerationRejectedError` (both are valid
   outcomes — the path is verified either way).
6. Pub/Sub topic delivers a synthetic `NEW_REVIEW` to the Convex `httpAction`
   endpoint; idempotency check against `webhookEvents` rejects a duplicate
   `messageId`.

## Cross-reference

- v0 Zernio-mediated path: `convex/integrations/zernio/` (separate agent)
- Spec source of truth: `docs/SPRINT_PLAN_SERVICE_V0.md` § 13 Sprint 1
  (lines ~1184-1212) + § 3 layer table + § 6 behaviors #4 / #5
- Plan-tier matrix: `convex/planService.ts`
- Encryption helper: `convex/lib/encryption.ts`
- Webhook idempotency table: `convex/schema.ts` `webhookEvents`
