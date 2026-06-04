# X / Twitter (Zernio slug `twitter`)

Spec: `docs/zernio_openapi_1.0.4.yaml`. Connect slug is **`twitter`** (NOT `x`), confirmed live.

## Connect

- `GET /v1/connect/twitter?profileId=...` -> `{authUrl, state}` (`GET /v1/connect/{platform}`, `platform` enum includes `twitter`). `profileId` is a **required** query param. `state` encodes `userId-profileId-timestamp-redirectUrl`.
- Callback: `POST /v1/connect/twitter` body `{code, state, profileId}` (all required).
- Optional `redirect_url` and `headless` query params on the GET (see README). No multi-step selection sub-flow for X (no org/page/board picker in the spec).

## Posting (`POST /v1/posts`)

Target with a `platforms[]` entry: `{platform:"twitter", accountId, customContent?, customMedia?, scheduledFor?, platformSpecificData: TwitterPlatformData}`.

Media optional (text-only tweets allowed; `content` then required).

### `TwitterPlatformData`

| Field | Type | Req | Notes (from spec descriptions) |
|---|---|---|---|
| `replyToTweetId` | string | opt | "ID of an existing tweet to reply to ... For threads, only the first tweet replies to the target; subsequent tweets chain normally." Cannot be combined with `replySettings`. |
| `quoteTweetId` | string | opt | ID or full status URL to quote-repost. "Mutually exclusive with media and poll. X only permits quoting your own posts or posts you are mentioned in ... quoting an arbitrary other account's post is rejected by X." Billed at create rate ($0.015) vs URL-in-text rate ($0.20). Threads: first tweet only. |
| `replySettings` | enum `following \| mentionedUsers \| subscribers \| verified` | opt | Controls who can reply. "Omit for default (everyone can reply). For threads, applies to the first tweet only. Cannot be combined with replyToTweetId." |
| `threadItems` | array of `{content, mediaItems: MediaItem[]}` | opt | "The first item becomes the root tweet, subsequent items are chained as replies. When threadItems is provided, the top-level content field is used only for display and search purposes, it is NOT published. You must include your first tweet as threadItems[0]." |
| `poll` | object `{options[2-4, max 25 chars each], duration_minutes(5-10080)}` | opt | Both `options` and `duration_minutes` required if `poll` present. "Mutually exclusive with media attachments and threads." Duration 5 min to 7 days. |
| `longVideo` | boolean (default false) | opt | amplify_video category for videos >140s. "Requires the connected X account to have an active X Premium subscription ... up to 10 minutes via API ... X may require separate allowlisting." |
| `geoRestriction` | `GeoRestriction` | opt | Applies at the media level; hides media for users outside specified countries, text stays global. "Requires media to be attached (ignored for text-only tweets)." |

Mutual-exclusion summary: `poll` XOR media XOR `threadItems`; `quoteTweetId` excludes media and poll; `replySettings` excludes `replyToTweetId`.

`MediaItem.altText` supported on X (max 1000 chars).

## Read / analytics

| Endpoint | Query params | Notes |
|---|---|---|
| `GET /v1/analytics` | `postId`/`platform=twitter`/`accountId`/`source`/`fromDate`/`toDate`/`sortBy`/`order`/`limit`/`page` | Cross-platform post analytics. |
| `GET /v1/analytics/daily-metrics` | `platform=twitter`, `accountId`, `fromDate`, `toDate`, `source` | Analytics add-on. |
| `GET /v1/analytics/best-time` | `platform=twitter`, `accountId`, `source` | Analytics add-on. |
| `GET /v1/analytics/content-decay` | `platform=twitter`, `accountId`, `source` | Analytics add-on. |
| `GET /v1/accounts/follower-stats` | `accountIds`, `fromDate`, `toDate`, `granularity` | Analytics add-on; daily refresh. |

No X-specific analytics endpoint exists in the spec (no `/v1/analytics/twitter/...`). X data flows through the shared analytics endpoints only.

## Inbox

- **Comments:** `GET /v1/inbox/comments?platform=twitter` is supported (`platform` enum on `/v1/inbox/comments` includes `twitter`). Thread: `GET /v1/inbox/comments/{postId}?accountId=...`. Reply: `POST /v1/inbox/comments/{postId}` body `{accountId, message, commentId?}`.
- **DMs:** `GET /v1/inbox/conversations?platform=twitter` is supported (enum includes `twitter`). **Caveat (spec):** "X has replaced traditional DMs with encrypted 'X Chat' for many accounts. Messages sent or received through encrypted X Chat are not accessible via X's API ... some Twitter/X conversations may show only outgoing messages or appear empty." DM webhooks: `message.received` payload enum does NOT include twitter; `conversation.started` payload enum DOES include twitter.

## X-only action endpoints (not posting)

From dedicated `/v1/twitter/*` paths:
- `POST /v1/twitter/follow` / `DELETE`. Body `{accountId, targetUserId}`.
- `POST /v1/twitter/retweet` / `DELETE`. Body `{accountId, tweetId}`.
- `POST /v1/twitter/bookmark` / `DELETE`. Bookmark a tweet by ID.

## Gotchas

- Slug is `twitter`, not `x`.
- Threads: `threadItems[0]` IS your first tweet; top-level `content` is display/search only when `threadItems` present.
- Quote tweets only work for your own / mentioned posts (X rejects arbitrary quotes).
- `longVideo` needs X Premium and possibly extra allowlisting.
- Encrypted X Chat is invisible to the API. Do not assume `/v1/inbox/conversations` returns complete X DM history.
- Pasting a tweet URL into text is billed at $0.20 vs $0.015 for `quoteTweetId`.
