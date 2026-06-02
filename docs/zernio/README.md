# Zernio API contract reference (HeyMaya)

NO-GUESS reference. Every claim below is traceable to `docs/zernio_openapi_1.0.4.yaml` (`Zernio API 1.0.4`, OpenAPI 3.1). Schema names and endpoint paths are cited inline. Nothing here is invented; if the spec is silent, this doc says so.

Scope: the 6 channels Maya offers. **X** (spec slug `twitter`), **Reddit** (`reddit`), **LinkedIn** (`linkedin`), **Instagram** (`instagram`), **TikTok** (`tiktok`), **YouTube** (`youtube`). Zernio also supports bluesky / discord / snapchat / telegram / whatsapp / threads / pinterest / facebook / googlebusiness. Those are deliberately undocumented here.

## Base URL + auth

- Base URL: `https://zernio.com/api` (`servers[0].url`). Every path starts `/v1/...`, so full URLs resolve as `https://zernio.com/api/v1/...`.
- Auth: `Authorization: Bearer $ZERNIO_API_KEY` on every request.
- Content type for JSON bodies: `application/json`. `POST /v1/media/upload-direct` uses `multipart/form-data`.

## Lifecycle: connect -> post -> read -> monitor

1. **Profile.** `POST /v1/profiles` (body `{name}` required, optional `description`, `color`). Returns `{message, profile:{_id,...}}` (`ProfileCreateResponse`). A profile is the container that connected accounts attach to. `GET /v1/profiles` lists them.
2. **Connect.** `GET /v1/connect/{platform}?profileId=...` returns `{authUrl, state}`. Redirect the user to `authUrl`; `state` encodes `userId-profileId-timestamp-redirectUrl`. The OAuth callback is completed by `POST /v1/connect/{platform}` body `{code, state, profileId}` (all three required) OR, in headless mode, by the per-channel selection endpoint. See each channel file for the exact sub-flow. The X/Twitter connect slug is **`twitter`**, never `x`.
3. **Discover accounts.** `GET /v1/accounts?profileId=...` returns `{accounts:[SocialAccount], hasAnalyticsAccess}`. Each `accountId` (24-char hex ObjectId) is what you pass into post `platforms[].accountId` and into every read endpoint.
4. **Post.** `POST /v1/posts`. See "Posting" below and the per-channel files.
5. **Read / analytics.** `GET /v1/analytics`, `/v1/analytics/daily-metrics`, `/v1/analytics/best-time`, `/v1/analytics/content-decay`, `/v1/accounts/follower-stats`, plus channel-specific analytics endpoints. See per-channel files.
6. **Monitor.** Webhooks (`POST /v1/webhooks/settings`) for push, or poll `/v1/inbox/comments`, `/v1/inbox/conversations`.

## Posting model (`POST /v1/posts`)

Top-level request body fields (from the `POST /v1/posts` requestBody schema):

| Field | Type | Notes |
|---|---|---|
| `content` | string | Post caption/text. "Optional when media is attached or all platforms have customContent. Required for text-only posts." |
| `title` | string | Optional. |
| `mediaItems` | `MediaItem[]` | Shared media for all targets (per-target override via `platforms[].customMedia`). |
| `platforms` | `PlatformTarget[]` | "Required for non-draft posts (returns 400 if empty). Drafts can omit platforms." |
| `scheduledFor` | string (date-time) | Schedule time. |
| `publishNow` | boolean (default false) | Immediate publish. Response includes `platformPostUrl`. |
| `isDraft` | boolean (default false) | "When true, saves the post as a draft. When none of scheduledFor, publishNow, or queuedFromProfile are provided, the post defaults to draft automatically." |
| `timezone` | string (default `UTC`) | Pairs with `scheduledFor`. |
| `tags` | string[] | "YouTube constraints: each tag max 100 chars, combined max 500 chars, duplicates auto-removed." |
| `hashtags` | string[] | |
| `mentions` | string[] | "Stored for reference only. Does NOT automatically create @mentions." LinkedIn @mentions must be resolved via `/v1/accounts/{accountId}/linkedin-mentions` and embedded in `content`. |
| `crosspostingEnabled` | boolean (default true) | |
| `queuedFromProfile` | string | Profile ID to schedule via queue. "When provided without scheduledFor, the post is auto-assigned to the next available slot. Do not call /v1/queue/next-slot and use that time in scheduledFor." |
| `queueId` | string | Specific queue, only with `queuedFromProfile`. |
| `recycling` | `RecyclingConfig` | Evergreen re-posting. |
| `metadata` | object | Free-form. |

**Publish-mode resolution:** `publishNow:true` = immediate; `scheduledFor`+`timezone` = scheduled; `isDraft:true` (or none of publishNow/scheduledFor/queuedFromProfile) = draft.

### `PlatformTarget` object (one per channel)

From `PlatformTarget` schema:

| Field | Type | Notes |
|---|---|---|
| `platform` | string | One of `twitter / threads / instagram / youtube / facebook / linkedin / pinterest / reddit / tiktok / bluesky / googlebusiness / telegram`. Maya uses only `twitter / reddit / linkedin / instagram / tiktok / youtube`. |
| `accountId` | string \| `SocialAccount` | The connected account ID. |
| `customContent` | string | Per-platform text override (e.g. trimmed tweet). |
| `customMedia` | `MediaItem[]` | Per-platform media override. |
| `scheduledFor` | string (date-time) | Per-platform schedule override; falls back to top-level. |
| `platformSpecificData` | one-of `<Channel>PlatformData` | The per-channel options object. `additionalProperties:true`. See per-channel files. |

Read-back fields populated after publish: `status` (pending/publishing/published/failed), `platformPostId`, `platformPostUrl` ("Included in the response for immediate posts; for scheduled posts, fetch via GET /v1/posts/{postId} after publish time"), `publishedAt`, `errorMessage`, `errorCategory` (enum: auth_expired / user_content / user_abuse / account_issue / platform_rejected / platform_error / system_error / unknown), `errorSource` (user / platform / system).

### `MediaItem` schema

| Field | Type | Notes |
|---|---|---|
| `type` | enum `image \| video \| gif \| document` | |
| `url` | string (uri) | "URLs must be publicly reachable over HTTPS." |
| `title` | string | "Used as the document title for LinkedIn PDF/carousel posts." |
| `altText` | string | Applied on IG (feed images only), FB, Threads, X (max 1000 chars), LinkedIn, Bluesky, Pinterest (max 500). "Ignored on platforms without alt-text support (TikTok, YouTube, Snapchat, Telegram, Reddit, Google Business, WhatsApp)." |
| `filename`, `size`, `mimeType` | | Optional metadata. |
| `thumbnail` | string (uri) | Custom video cover (FB video/Reels + regular video uploads). Max 10MB. |
| `instagramThumbnail` | string (uri) | IG Reels cover. |
| `tiktokProcessed` | boolean | Internal flag. |

Media note (`MediaItem` description): "Use POST /v1/media/presign for uploads up to 5GB. Zernio auto-compresses images and videos that exceed platform limits (videos over 200 MB may not be compressed)."

### Idempotency (`POST /v1/posts`)

Two layers, both from the endpoint description:
- **Same-request (5-min window):** pass `x-request-id` header (UUIDv4). A duplicate `x-request-id` returns **HTTP 200** with the original post in `existingPost`. Pitfall: do not reuse one execution-level ID across multiple platform calls; generate a fresh ID per logical call.
- **Content-hash dedup (24-hour window):** hashes `(platform, accountId, content + media URLs)`; duplicates return **HTTP 409** with `existingPostId`. To re-post identical content within 24h, change the caption/media/account.

`POST /v1/posts` responses: `201` (`PostCreateResponse`), `400`, `401`, `403`, `409` (dedup), `429`.

## Shared endpoints

| Endpoint | Method | Purpose | Needs connected account? | Notes |
|---|---|---|---|---|
| `/v1/profiles` | GET, POST | Profile container CRUD | No | `POST` body `{name}` required. |
| `/v1/profiles/{profileId}` | GET, PUT, DELETE | Single profile | No | |
| `/v1/accounts` | GET | List connected accounts | Returns empty if none | Query: `profileId`, `platform`, `includeOverLimit`, `page`, `limit`. Response carries `hasAnalyticsAccess`. |
| `/v1/accounts/health` | GET | Token validity / reconnect status | Yes (rows only for connected) | Query: `profileId`, `platform`, `status`(healthy/warning/error). Returns `summary` + per-account `canPost`, `canFetchAnalytics`, `tokenValid`, `needsReconnect`, `issues[]`. |
| `/v1/accounts/follower-stats` | GET | Follower history + growth | Yes | **Requires analytics add-on.** "Follower counts are refreshed once per day." Query: `accountIds`(csv), `profileId`, `fromDate`, `toDate`, `granularity`(daily/weekly/monthly). `403` without add-on. |
| `/v1/analytics` | GET | Post analytics (list or single) | Yes | Query: `postId`, `platform`, `profileId`, `accountId`, `source`(all/late/external), `fromDate`(default 90d ago), `toDate`, `limit`, `page`, `sortBy`, `order`. Single-post may return `202` (sync pending) or `424` (all platforms failed). |
| `/v1/analytics/daily-metrics` | GET | Daily aggregated metrics + per-platform breakdown | Yes | **Analytics add-on.** Defaults to last 180 days. Query: `platform`, `profileId`, `accountId`, `fromDate`, `toDate`, `source`. |
| `/v1/analytics/best-time` | GET | Best post times by engagement | Yes | **Analytics add-on.** Returns `slots[]` with `day_of_week`(0=Mon..6=Sun), `hour`(UTC 0-23), `avg_engagement`, `post_count`. Query: `platform`, `profileId`, `accountId`, `source`. |
| `/v1/analytics/content-decay` | GET | Engagement accumulation over time | Yes | **Analytics add-on.** Returns `buckets[]` with `avg_pct_of_final`. Query: `platform`, `profileId`, `accountId`, `source`. |
| `/v1/media/presign` | POST | Presigned upload URL (up to 5GB) | No | Body `{filename, contentType, size?}`. `contentType` enum: image/jpeg, image/jpg, image/png, image/webp, image/gif, video/mp4, video/mpeg, video/quicktime, video/avi, video/x-msvideo, video/webm, video/x-m4v, application/pdf. Returns `{uploadUrl, publicUrl, key, type}`. PUT file to `uploadUrl` (expires 1h), then use `publicUrl`. |
| `/v1/media/upload-direct` | POST | Direct multipart upload (max 25MB) | No | `multipart/form-data` `{file, contentType?}`. "Files auto-delete after 7 days." Returns `{url, filename, contentType, size}`. |
| `/v1/webhooks/settings` | GET, POST, PUT, DELETE | Webhook config (max 10/user) | No | POST body `{name(1-50), url, events[>=1], secret?, isActive?, customHeaders?}`. "Webhooks are automatically disabled after 10 consecutive delivery failures." HMAC-SHA256 via `secret`. |
| `/v1/webhooks/test` | POST | Send test delivery | No | Body `{webhookId}`. Test payload event = `webhook.test`. |
| `/v1/inbox/comments` | GET | List posts with comment counts | Yes | Channel support below. |
| `/v1/inbox/comments/{postId}` | GET / POST / DELETE | Read thread / reply / delete | Yes | GET requires `accountId` query; POST reply requires body `{accountId, message}`. |
| `/v1/inbox/conversations` | GET, POST | List DMs / start new | Yes | Channel support below. |
| `/v1/inbox/reviews` | GET | List reviews | Yes | Supported platforms = Facebook, Google Business **only** (out of Maya scope). |

### Validation helpers (optional pre-flight)

- `POST /v1/tools/validate/post` (validate full post content), `POST /v1/tools/validate/post-length` (char count), `POST /v1/tools/validate/media` (media URL reachability), `GET /v1/tools/validate/subreddit` (subreddit existence). Useful as a NO-GUESS pre-check before live posting.

## Webhook event types

From the `events` enum in `POST /v1/webhooks/settings` requestBody:

`post.scheduled`, `post.published`, `post.failed`, `post.partial`, `post.cancelled`, `post.recycled`, `post.platform.published`, `post.platform.failed`, `account.connected`, `account.disconnected`, `account.ads.initial_sync_completed`, `message.received`, `message.sent`, `message.edited`, `message.deleted`, `message.delivered`, `message.read`, `message.failed`, `reaction.received`, `comment.received`, `review.new`, `review.updated`, `ad.status_changed`, `whatsapp.template.status_updated`, `whatsapp.number.activated`, `whatsapp.number.declined`, `whatsapp.number.verification_required`.

### Which events fire for Maya's 6 channels

Per-channel applicability is pinned by the `platform` enum inside each WebhookPayload schema:

| Event group | Payload schema | `platform` enum in payload | Maya channels covered |
|---|---|---|---|
| `comment.received` | `WebhookPayloadComment` | instagram, facebook, twitter, youtube, linkedin, bluesky, reddit | X, YouTube, LinkedIn, Reddit, Instagram (NOT TikTok) |
| `message.received` (+ sent/edited/deleted/delivered/read/failed) | `WebhookPayloadMessage` | instagram, facebook, telegram, whatsapp | Instagram only |
| `conversation.started` | `WebhookPayloadConversationStarted` | instagram, facebook, telegram, whatsapp, twitter, reddit, bluesky | X, Reddit, Instagram |
| `post.*` (post-level) | `WebhookPayloadPost` | (post-level, all channels) | all 6 |
| `post.platform.published` / `post.platform.failed` | `WebhookPayloadPostPlatform` | per-platform terminal state | all 6 |
| `review.new` / `review.updated` | `WebhookPayloadReviewNew` | facebook, googlebusiness | none of Maya's 6 |
| `account.connected` / `account.disconnected` | `WebhookPayloadAccountConnected` | account-level | all 6 |

Note: `message.received` webhook payloads list only instagram/facebook/telegram/whatsapp. X/Reddit DMs surface via `conversation.started` and via the `/v1/inbox/conversations` poll, but are not in the `message.received` payload enum.

## Cross-references

- Per-channel contracts: `twitter.md`, `reddit.md`, `linkedin.md`, `instagram.md`, `tiktok.md`, `youtube.md`.
- At-a-glance support matrix: `VERIFICATION_MATRIX.md`.
