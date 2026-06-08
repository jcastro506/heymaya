# TikTok (Zernio slug `tiktok`)

Spec: `docs/zernio_openapi_1.0.4.yaml`. TikTok requires a creator-info pre-fetch and explicit consent flags.

## Connect

- `GET /v1/connect/tiktok?profileId=...` -> `{authUrl, state}` (`platform` enum includes `tiktok`). `profileId` required.
- Callback: `POST /v1/connect/tiktok` body `{code, state, profileId}`.
- No selection sub-flow at connect time. (`/v1/connect/tiktok-ads` PATCH is ads-only, out of scope.)

### Required pre-post fetch

- `GET /v1/accounts/{accountId}/tiktok/creator-info?mediaType=video|photo`. "Returns TikTok creator details, available privacy levels, posting limits, and commercial content options." `privacyLevel` in the post MUST be one of the values this returns (per `TikTokPlatformData`: "privacyLevel must match creator_info options"). Pull this before every post.

## Posting (`POST /v1/posts`)

Target: `{platform:"tiktok", accountId, platformSpecificData: TikTokPlatformData}`. Top-level `tiktokSettings` (`TikTokPlatformData`) is also accepted on the post body.

`TikTokPlatformData` description highlights:
- "Photo carousels up to 35 images. Video titles up to 2200 chars, photo titles truncated to 90 chars."
- **Creator Inbox (draft mode):** `draft:true` sends to the TikTok Creator Inbox instead of publishing; maps to TikTok `post_mode: MEDIA_UPLOAD` (photos) or the dedicated inbox endpoint (videos). Creator completes the post in TikTok's editing flow. "TikTok app version must be 31.8 or higher."
- "The field `publish_type` is NOT supported. Use `draft: true` for Creator Inbox flow."
- Scopes: `draft:true` requires `video.upload` scope; direct post (`draft` false/omitted) requires `video.publish` scope.
- "Both camelCase and snake_case accepted."

### `TikTokPlatformData`

| Field | Type | Req | Notes |
|---|---|---|---|
| `draft` | boolean | opt | true = Creator Inbox draft (`MEDIA_UPLOAD`); false/omit = direct post (`DIRECT_POST`). |
| `privacyLevel` | string | opt* | "One of the values returned by the TikTok creator info API." Effectively required for direct posts. |
| `allowComment` | boolean | opt | |
| `allowDuet` | boolean | opt | "required for video posts" |
| `allowStitch` | boolean | opt | "required for video posts" |
| `commercialContentType` | enum `none \| brand_organic \| brand_content` | opt | Commercial disclosure. |
| `brandPartnerPromote` | boolean | opt | |
| `isBrandOrganicPost` | boolean | opt | |
| `contentPreviewConfirmed` | boolean | opt* | "User has confirmed they previewed the content." Required by TikTok consent flow. |
| `expressConsentGiven` | boolean | opt* | "User has given express consent for posting." Required by TikTok consent flow. |
| `mediaType` | enum `video \| photo` | opt | "Defaults based on provided media items." |
| `videoCoverTimestampMs` | integer | opt | Cover frame for video (default 1000ms). Ignored if `videoCoverImageUrl` set. |
| `videoCoverImageUrl` | string (uri) | opt | Custom video thumbnail (JPG/PNG/WebP, max 20MB). |
| `photoCoverIndex` | integer | opt | Cover image index for photo carousels (default 0). |
| `autoAddMusic` | boolean | opt | "TikTok may add recommended music (photos only)." |
| `videoMadeWithAi` | boolean | opt | "Set true to disclose AI-generated content." |
| `description` | string (max 4000) | opt | Long-form description for photo posts. "Recommended when content exceeds 90 chars, as photo titles are auto-truncated." |

Direct-post example (spec) includes: `privacyLevel`, `allowComment`, `allowDuet`, `allowStitch`, `commercialContentType`, `contentPreviewConfirmed:true`, `expressConsentGiven:true`. Video drafts use a dedicated TikTok endpoint that only accepts source_info, so `privacyLevel`/`allowComment`/etc. are set by the creator during editing, not via the API.

`MediaItem.altText` is **ignored** on TikTok.

## Read / analytics

| Endpoint | Query params | Notes |
|---|---|---|
| `GET /v1/analytics/tiktok/account-insights` | `accountId`(req), `metrics`, `since`, `until`, `metricType` | Live from `/v2/user/info/` (requires `user.info.stats` scope): follower_count, following_count, likes_count, video_count (all cumulative). Synthesized: followers_gained, followers_lost. |
| `GET /v1/analytics` | `platform=tiktok`, `accountId`, ... | Shared post analytics. |
| `GET /v1/analytics/daily-metrics`, `/best-time`, `/content-decay` | `platform=tiktok` | Analytics add-on. |
| `GET /v1/accounts/follower-stats` | `accountIds`, `granularity` | Analytics add-on. |

## Inbox

- **NONE.** TikTok is absent from every inbox enum:
  - `/v1/inbox/comments` `platform` enum: facebook, instagram, twitter, bluesky, threads, youtube, linkedin, reddit, metaads. **No tiktok.**
  - `/v1/inbox/conversations` enum: facebook, instagram, twitter, bluesky, reddit, telegram. **No tiktok.**
  - `comment.received` / `message.received` / `conversation.started` webhook payload enums do **not** include tiktok.
- Do not invent a TikTok inbox surface. Maya cannot read or reply to TikTok comments/DMs through Zernio.

## Gotchas

- Must call `tiktok/creator-info` first; `privacyLevel` has to match a returned option or the post is rejected.
- Direct posts need `video.publish` scope + `contentPreviewConfirmed` + `expressConsentGiven`; drafts need `video.upload` scope and Creator Inbox (TikTok app >= 31.8).
- `publish_type` is NOT a field. Use `draft`.
- `allowDuet`/`allowStitch` are required for video posts.
- Photo titles truncate to 90 chars; put long copy in `description`.
- No inbox at all. Comment triage and DM features are not available for TikTok.
