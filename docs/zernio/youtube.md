# YouTube (Zernio slug `youtube`)

Spec: `docs/zernio_openapi_1.0.4.yaml`. Video-only channel; analytics carry a 2-3 day latency.

## Connect

- `GET /v1/connect/youtube?profileId=...` -> `{authUrl, state}` (`platform` enum includes `youtube`). `profileId` required.
- Callback: `POST /v1/connect/youtube` body `{code, state, profileId}`.
- No selection sub-flow at connect time.

### Post-time account-config endpoint

- `GET /v1/accounts/{accountId}/youtube-playlists`. "Returns the playlists available for a connected YouTube account. Use this to get a playlist ID when creating a YouTube post with the playlistId field." `PUT` available too.

## Posting (`POST /v1/posts`)

Target: `{platform:"youtube", accountId, platformSpecificData: YouTubePlatformData}`. **Media-required** (video upload). `YouTubePlatformData` description: "Videos under 3 min auto-detected as Shorts. Custom thumbnails for regular videos only. Scheduled videos are uploaded immediately with the specified visibility."

### `YouTubePlatformData`

| Field | Type | Req | Notes |
|---|---|---|---|
| `title` | string (max 100) | opt | "Defaults to first line of content or 'Untitled Video'. Must be <= 100 characters." |
| `visibility` | enum `public \| private \| unlisted` (default public) | opt | public / unlisted (link only) / private (invite only). |
| `madeForKids` | boolean (default false) | opt | "COPPA compliance flag ... restricts comments, notifications, ad targeting ... YouTube may block views if not explicitly set." |
| `firstComment` | string (max 10000) | opt | "Optional first comment to post immediately after video upload." |
| `containsSyntheticMedia` | boolean (default false) | opt | "AI-generated content disclosure ... YouTube may add a label." |
| `categoryId` | string (default `22`) | opt | "Defaults to 22 (People & Blogs). Common: 1 Film, 2 Autos, 10 Music, 15 Pets, 17 Sports, 20 Gaming, 23 Comedy, 24 Entertainment, 25 News, 26 Howto, 27 Education, 28 Science & Tech." |
| `playlistId` | string | opt | e.g. `PLxxxxxxxxxxxxx`. List via `youtube-playlists`. "Works for both immediate and scheduled uploads. Quota cost: 50 YouTube API units per call." |

Top-level `tags[]` apply to YouTube with constraints: each tag max 100 chars, combined max 500 chars, duplicates auto-removed.

`MediaItem.altText` is **ignored** on YouTube. `MediaItem.thumbnail` supported for regular video uploads (custom thumbnails for regular videos only, not Shorts).

## Read / analytics (YouTube-specific endpoints exist)

| Endpoint | Query params | Notes |
|---|---|---|
| `GET /v1/analytics/youtube/channel-insights` | `accountId`(req), `metrics`, `since`, `until`, `metricType` | YouTube Analytics v2: views, estimatedMinutesWatched, averageViewDuration, subscribersGained, subscribersLost. Synthesized: followers_gained/lost. "YouTube Analytics has a 2-3 day delay ... fetch internally clamped to 3 days ago." |
| `GET /v1/analytics/youtube/daily-views` | `videoId`(req), `accountId`(req), `startDate`, `endDate`(default 3 days ago) | Per-video daily views. |
| `GET /v1/analytics/youtube/demographics` | `accountId`(req), `breakdown`(age,gender,country), `startDate`(default 90d ago), `endDate`(default 3 days ago) | Audience demographics. |
| `GET /v1/analytics` | `platform=youtube`, `accountId`, ... | Shared post analytics. |
| `GET /v1/analytics/daily-metrics`, `/best-time`, `/content-decay` | `platform=youtube` | Analytics add-on. |
| `GET /v1/accounts/follower-stats` | `accountIds`, `granularity` | Analytics add-on (subscriber counts). |

## Inbox

- **Comments:** `GET /v1/inbox/comments?platform=youtube` supported (`/v1/inbox/comments` enum includes `youtube`). Thread: `GET /v1/inbox/comments/{postId}?accountId=...`. Reply: `POST /v1/inbox/comments/{postId}` body `{accountId, message, commentId?}`. `comment.received` webhook payload enum includes `youtube`.
- **DMs:** NOT supported. YouTube is absent from the `/v1/inbox/conversations` enum (facebook, instagram, twitter, bluesky, reddit, telegram). YouTube has no DM concept; no DM surface in the spec.

## Gotchas

- Video-only; `title` max 100 chars (defaults from first line of `content`).
- Analytics lag 2-3 days; `endDate` is clamped to ~3 days ago, so recent-day metrics return zero.
- Set `madeForKids` explicitly; "YouTube may block views if not explicitly set."
- `playlistId` costs 50 API units per call.
- Videos under 3 min are auto-classified as Shorts; custom thumbnails only on regular (non-Short) videos.
- Comments yes, DMs no.
