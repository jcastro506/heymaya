# Reddit (Zernio slug `reddit`)

Spec: `docs/zernio_openapi_1.0.4.yaml`.

## Connect

- `GET /v1/connect/reddit?profileId=...` -> `{authUrl, state}` (`platform` enum includes `reddit`). `profileId` required.
- Callback: `POST /v1/connect/reddit` body `{code, state, profileId}`.
- No headless selection sub-flow (no subreddit picker at connect time). Subreddit/flair are chosen per-post via the account-config endpoints below.

### Post-time account-config endpoints

- `GET /v1/accounts/{accountId}/reddit-subreddits`. "Returns the subreddits the connected Reddit account can post to." `PUT` sets the account's default subreddit. Use to resolve a `subreddit` name before posting.
- `GET /v1/accounts/{accountId}/reddit-flairs?subreddit=name` (required query `subreddit`). "Returns available post flairs ... Some subreddits require a flair when posting." Resolve the `flairId` here.

## Posting (`POST /v1/posts`)

Target: `{platform:"reddit", accountId, platformSpecificData: RedditPlatformData}`.

Post kind is decided by fields: link (URL/media) vs native video (`nativeVideo`) vs self/text (`forceSelf` or no URL/media). Spec: "Posts are either link (with URL/media), native video (via nativeVideo), or self (text-only)."

### `RedditPlatformData`

| Field | Type | Req | Notes |
|---|---|---|---|
| `subreddit` | string | opt | Without "r/" prefix. "Overrides the default." List via `reddit-subreddits`. |
| `title` | string (max 300) | opt | "Defaults to the first line of content, truncated to 300 characters." |
| `url` | string (uri) | opt | "If provided (and forceSelf is not true), creates a link post instead of a text post." |
| `forceSelf` | boolean | opt | "When true, creates a text/self post even when a URL or media is provided." |
| `flairId` | string | opt | "Flair ID for the post. Required by some subreddits." List via `reddit-flairs?subreddit=name`. |
| `nativeVideo` | boolean (default true for video media) | opt | "video uploaded to Reddit's CDN ... kind=video ... Reddit transcodes server-side (1080p/30fps cap). Set false to fall back to a legacy link post. If the subreddit blocks video posts, the upload falls back to a link post automatically." |
| `videogif` | boolean | opt | "When true (and nativeVideo is active), submits the video as a silent videogif (kind=videogif)." |
| `videoPosterUrl` | string (uri) | opt | "Optional poster/thumbnail image URL for native video posts. If omitted, the first frame ... is extracted and used automatically." |

`MediaItem.altText` is **ignored** on Reddit (per `MediaItem` description).

## Read / analytics

| Endpoint | Query | Notes |
|---|---|---|
| `GET /v1/analytics` | `platform=reddit`, `accountId`, ... | Shared post analytics. |
| `GET /v1/analytics/daily-metrics` | `platform=reddit`, `accountId` | Analytics add-on. |
| `GET /v1/analytics/best-time` | `platform=reddit`, `accountId` | Analytics add-on. |
| `GET /v1/analytics/content-decay` | `platform=reddit`, `accountId` | Analytics add-on. |
| `GET /v1/accounts/follower-stats` | `accountIds`, `granularity`, ... | Analytics add-on. |

No Reddit-specific analytics endpoint in the spec.

### Reddit read/discovery (not analytics)

- `GET /v1/reddit/feed` returns a subreddit feed. Query: `accountId`(req), `subreddit`, `sort`(hot/new/top/rising, default hot), `limit`(<=100), `after`, `t`(hour/day/week/month/year/all).
- `GET /v1/reddit/search`. Query: `accountId`(req), `q`(req), `subreddit`, `restrict_sr`(0/1), `sort`(relevance/hot/top/new/comments, default new), `limit`(<=100), `after`. Useful for Maya's ICP-thread discovery.

## Inbox

- **Comments:** `GET /v1/inbox/comments?platform=reddit` supported (enum includes `reddit`). Thread: `GET /v1/inbox/comments/{postId}?accountId=...&subreddit=...` (note Reddit-only query params `subreddit` and `commentId`, "Get replies to a specific comment"). Reply: `POST /v1/inbox/comments/{postId}` body `{accountId, message, commentId?}`.
- **DMs:** `GET /v1/inbox/conversations?platform=reddit` supported (enum includes `reddit`). `conversation.started` webhook payload enum includes `reddit`; `message.received` payload enum does NOT.

## Gotchas

- `flairId` is required by some subreddits. Resolve via `reddit-flairs` first or the post can be rejected.
- `title` auto-derives from first line of `content` (max 300) if omitted.
- Native video falls back to a link post automatically if the subreddit blocks video.
- `subreddit` name must omit the `r/` prefix.
