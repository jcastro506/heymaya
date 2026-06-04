# Instagram (Zernio slug `instagram`)

Spec: `docs/zernio_openapi_1.0.4.yaml`. IG requires a Business/Creator account (Graph API) for analytics and posting.

## Connect

- `GET /v1/connect/instagram?profileId=...` -> `{authUrl, state}` (`platform` enum includes `instagram`). `profileId` required.
- Callback: `POST /v1/connect/instagram` body `{code, state, profileId}`.
- No IG-specific selection sub-flow in the spec (FB Page selection `/v1/connect/facebook/select-page` is FB-only and out of scope).

## Posting (`POST /v1/posts`)

Target: `{platform:"instagram", accountId, platformSpecificData: InstagramPlatformData}`.

`InstagramPlatformData` description: "Feed aspect ratio 0.8-1.91, carousels up to 10 items, stories require media (no captions). User tag coordinates 0.0-1.0 from top-left. Images over 8 MB and videos over platform limits are auto-compressed." **Media-required** (Stories require media; feed/Reels need media).

### `InstagramPlatformData`

| Field | Type | Req | Notes |
|---|---|---|---|
| `contentType` | enum `story` | opt | "Set to 'story' to publish as a Story. Default posts become Reels or feed depending on media." |
| `shareToFeed` | boolean (default true) | opt | "For Reels only. When true ... appears on both the Reels tab and your main profile feed. Set to false to post to the Reels tab only." |
| `collaborators` | string[] (max 3) | opt | "Up to 3 Instagram usernames to invite as collaborators (feed/Reels only)." |
| `firstComment` | string | opt | "Optional first comment ... (not applied to Stories)." |
| `trialParams` | object `{graduationStrategy: MANUAL \| SS_PERFORMANCE}` | opt | Trial Reels. "shared to non-followers first ... Only applies to Reels." |
| `userTags` | array of `{username, x(0-1), y(0-1), mediaIndex?}` | opt | "Tag Instagram users in photos by username and position. Not supported for stories or videos. For carousels, use mediaIndex ... Tags on video items are silently skipped." `username`/`x`/`y` required per tag. |
| `audioName` | string | opt | "Custom name for original audio in Reels ... Can only be set once." |
| `thumbOffset` | integer (ms) | opt | Reel cover frame offset. "Ignored when instagramThumbnail or reelCover is provided. Defaults to 0." |
| `instagramThumbnail` | string (uri) | opt | "Custom cover image URL for Instagram Reels (JPG or PNG, publicly accessible). Overrides thumbOffset." |
| `reelCover` | string (uri) | opt | "Alias for instagramThumbnail. If both are provided, instagramThumbnail takes priority." |

`MediaItem.altText` supported on IG **feed images only** (not Reels/Stories). `MediaItem.instagramThumbnail` also sets the Reels cover (resolution order documented in `MediaItem`).

## Read / analytics (IG-specific endpoints exist)

| Endpoint | Query params | Notes |
|---|---|---|
| `GET /v1/analytics/instagram/account-insights` | `accountId`(req), `metrics`, `since`, `until`, `metricType`(time_series/total_value), `breakdown` | Metrics: reach, views, accounts_engaged, total_interactions, comments, likes, saves, shares, replies, reposts, follows_and_unfollows, profile_links_taps. "only 'reach' supports metricType=time_series. All others are total_value only (IG Graph API limit)." Breakdown: media_product_type, follow_type, follower_type, contact_button_type. |
| `GET /v1/analytics/instagram/demographics` | `accountId`(req), `metric`(follower_demographics/engaged_audience_demographics), `breakdown`(age,city,country,gender), `timeframe`(this_week/this_month) | Audience demographics. |
| `GET /v1/analytics/instagram/follower-history` | `accountId`(req), `metrics`(follower_count,followers_gained,followers_lost), `since`, `until`, `metricType` | Daily running follower count. |
| `GET /v1/accounts/{accountId}/instagram/stories` | path `accountId` | "List active Instagram stories." |
| `GET /v1/accounts/{accountId}/instagram/stories/{storyId}/insights` | path | Per-story insights. |
| `GET /v1/analytics` | `platform=instagram`, `accountId`, ... | Shared post analytics. |
| `GET /v1/analytics/daily-metrics`, `/best-time`, `/content-decay` | `platform=instagram` | Analytics add-on. |
| `GET /v1/accounts/follower-stats` | `accountIds`, `granularity` | Analytics add-on. |

## Inbox

- **Comments:** `GET /v1/inbox/comments?platform=instagram` supported (enum includes `instagram`). Note: `platform=instagram` returns **organic posts only** (the `metaads` synthetic value is for ad rows). Thread + reply via `GET`/`POST /v1/inbox/comments/{postId}`. Private reply available: `POST /v1/inbox/comments/{postId}/{commentId}/private-reply`. Hide/like: `.../hide`, `.../like`.
- **DMs:** `GET /v1/inbox/conversations?platform=instagram` supported (enum includes `instagram`). Full message CRUD under `/v1/inbox/conversations/{conversationId}/messages`. IG is in BOTH the `message.received` and `conversation.started` webhook payload enums.
- IG ice-breakers / messenger menu config: `GET/PUT/DELETE /v1/accounts/{accountId}/instagram-ice-breakers`.

## Gotchas

- **Conditional:** IG posting + insights require a Business/Creator account connected via the Graph API. Personal accounts cannot post or pull insights. (Implied by the Graph-API-only metrics; verify `accounts/health` `canPost`/`canFetchAnalytics` before relying on it.)
- Stories require media and ignore captions; `firstComment` not applied to Stories.
- `userTags` work on photos only (silently skipped on video; not supported for Stories/videos).
- Most IG account-insight metrics are total_value only; only `reach` supports time_series.
- Feed aspect ratio must be 0.8-1.91; carousels max 10 items.
