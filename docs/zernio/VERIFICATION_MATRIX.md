# Zernio verification matrix (HeyMaya's 6 channels)

At-a-glance "does every call work for every channel" answer. Every cell is traceable to `docs/zernio_openapi_1.0.4.yaml`. Base URL `https://zernio.com/api`; auth `Bearer $ZERNIO_API_KEY`.

Legend: ✅ supported · ❌ not available · ⚠️ conditional.

| Operation | X (`twitter`) | Reddit (`reddit`) | LinkedIn (`linkedin`) | Instagram (`instagram`) | TikTok (`tiktok`) | YouTube (`youtube`) |
|---|---|---|---|---|---|---|
| **Connect** | ✅ `GET /v1/connect/twitter?profileId=` -> POST callback | ✅ `GET /v1/connect/reddit` -> POST callback | ✅ `GET /v1/connect/linkedin` + org sub-flow (`/connect/linkedin/organizations`, `/select-organization`, `accountType` personal\|organization) | ✅ `GET /v1/connect/instagram` -> POST callback | ✅ `GET /v1/connect/tiktok` -> POST callback (pre-fetch `tiktok/creator-info`) | ✅ `GET /v1/connect/youtube` -> POST callback |
| **Post text** | ✅ `POST /v1/posts` (text-only allowed) | ✅ self/text post (no URL/media or `forceSelf`) | ✅ `POST /v1/posts` | ❌ media-required (Stories/feed/Reels need media) | ❌ media-required (video/photo) | ❌ video-required |
| **Post media** | ✅ images/video/gif; `longVideo` needs Premium | ✅ link / native video / image (`nativeVideo`) | ✅ up to 20 images, 1 PDF (100MB); ⚠️ no multi-video | ✅ feed/Reels/Story/carousel(<=10) | ✅ video + photo carousel (<=35) | ✅ video upload |
| **Schedule** | ✅ `scheduledFor`+`timezone` or queue | ✅ | ✅ | ✅ | ✅ | ✅ (uploaded immediately at chosen visibility) |
| **Analytics** | ✅ shared `/v1/analytics` (no channel-specific endpoint) | ✅ shared `/v1/analytics` (no channel-specific endpoint) | ✅ `/linkedin-post-analytics`, `/linkedin-aggregate-analytics`, `/analytics/linkedin/org-aggregate-analytics`; ⚠️ personal-account post analytics only for posts published via Zernio | ✅ `/analytics/instagram/account-insights`, `/demographics`, `/follower-history`, `/instagram/stories`; ⚠️ Business/Creator account only | ✅ `/analytics/tiktok/account-insights` (needs `user.info.stats` scope) | ✅ `/analytics/youtube/channel-insights`, `/daily-views`, `/demographics`; ⚠️ 2-3 day data lag |
| **Follower-stats** | ⚠️ `/v1/accounts/follower-stats` (needs Analytics add-on) | ⚠️ same (Analytics add-on) | ⚠️ same | ⚠️ same | ⚠️ same | ⚠️ same (subscriber counts) |
| **Health** | ✅ `/v1/accounts/health?platform=twitter` | ✅ `platform=reddit` | ✅ `platform=linkedin` | ✅ `platform=instagram` | ✅ `platform=tiktok` | ✅ `platform=youtube` |
| **Inbox comments** | ✅ `/v1/inbox/comments?platform=twitter` | ✅ `platform=reddit` (+`subreddit`/`commentId` params) | ✅ `platform=linkedin` (URN or numeric ID) | ✅ `platform=instagram` (organic only; +private-reply) | ❌ not in any comments enum | ✅ `platform=youtube` |
| **Inbox DMs** | ⚠️ `/v1/inbox/conversations?platform=twitter` (encrypted X Chat invisible to API) | ✅ `platform=reddit` | ❌ LinkedIn absent from conversations enum | ✅ `platform=instagram` (full message CRUD) | ❌ not in conversations enum | ❌ YouTube absent from conversations enum |
| **Reply** | ✅ comment reply `POST /v1/inbox/comments/{postId}`; ⚠️ DM reply limited by X Chat | ✅ comment reply; ✅ DM reply | ✅ comment reply; ❌ no DM reply | ✅ comment reply (+private-reply); ✅ DM reply | ❌ no comment or DM reply (no inbox) | ✅ comment reply; ❌ no DM reply |

## Notes / conditionals

- **Analytics add-on:** `/v1/accounts/follower-stats`, `/v1/analytics/daily-metrics`, `/v1/analytics/best-time`, `/v1/analytics/content-decay` all require the Analytics add-on subscription (return `403` without it). `GET /v1/accounts` exposes `hasAnalyticsAccess`. Base `/v1/analytics` (post analytics) does not require the add-on.
- **LinkedIn personal vs org:** personal-account post analytics only cover posts published through Zernio. Org/company-page analytics cover all posts. Org posting needs `organizationUrn` (resolve via `/v1/accounts/{id}/linkedin-organizations`).
- **Instagram Business requirement:** posting + IG insights run on the Graph API and require a Business/Creator account. Check `accounts/health` `canPost` / `canFetchAnalytics` before relying on it.
- **TikTok has no inbox at all.** Absent from comments, conversations, and the comment/message webhook payload enums. Comment-triage and DM features are unavailable for TikTok via Zernio.
- **X DMs:** encrypted "X Chat" is not exposed by X's API; `/v1/inbox/conversations` may show only outgoing or empty for many X accounts.
- **Webhook coverage (push):** `comment.received` fires for X / YouTube / LinkedIn / Reddit / Instagram (not TikTok). `message.received` fires for Instagram only (of the 6). `conversation.started` fires for X / Reddit / Instagram. `post.*`, `post.platform.*`, `account.connected/disconnected` fire for all 6. `review.new/updated` covers none of the 6 (Facebook + Google Business only).
- **Media required:** Instagram, TikTok, and YouTube cannot publish text-only. X, Reddit, and LinkedIn can.
- **Idempotency on `POST /v1/posts`:** `x-request-id` header (5-min retry window, returns 200) + content-hash dedup (24h, returns 409). Applies to all channels.
