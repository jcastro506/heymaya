# LinkedIn (Zernio slug `linkedin`)

Spec: `docs/zernio_openapi_1.0.4.yaml`. LinkedIn has a real org-selection sub-flow.

## Connect

- `GET /v1/connect/linkedin?profileId=...` -> `{authUrl, state}` (`platform` enum includes `linkedin`). `profileId` required.
- Standard callback: `POST /v1/connect/linkedin` body `{code, state, profileId}`.
- **Org-selection sub-flow (headless / custom UI):**
  1. `GET /v1/connect/linkedin/organizations?tempToken=...&orgIds=12345678,87654321`. "Fetch full LinkedIn organization details (logos, vanity names, websites) for custom UI. No authentication required, just the tempToken from OAuth." `orgIds` is a required comma-separated list (max 100). Returns `{organizations:[{id, logoUrl, vanityName, website, industry, description}]}`.
  2. `GET /v1/connect/pending-data?token=...` for headless LinkedIn flows where the org list is too large for URL params. Returns `selectionType:"organizations"` + `organizations[]`. One-time token, expires 10 min.
  3. `POST /v1/connect/linkedin/select-organization`. Body required `{profileId, tempToken, userProfile, accountType}` where `accountType` enum is `personal | organization`. For org pages include `selectedOrganization:{id, urn, name}`. Optional `redirect_url`. Use `X-Connect-Token` header if connecting via API key. Returns `{message, account:{accountId, platform:"linkedin", username, displayName, accountType}, bulkRefresh}`.

### Post-time account-config endpoints

- `GET /v1/accounts/{accountId}/linkedin-organizations`. "Returns LinkedIn organizations (company pages) the connected account has admin access to." Resolve `organizationUrn` here.
- `GET /v1/accounts/{accountId}/linkedin-mentions?url=...&displayName=...` resolves a profile/company URL to a URN. Returns `mentionFormat` (e.g. `@[Vincent Jong](urn:li:person:xxx)`) to embed directly in post `content`. Person mentions require the account be admin of >=1 org (LinkedIn API limit on resolution, not publishing). Org mentions work without that.

## Posting (`POST /v1/posts`)

Target: `{platform:"linkedin", accountId, platformSpecificData: LinkedInPlatformData}`.

`LinkedInPlatformData` description: "Up to 20 images, no multi-video. Single PDF supported (max 100MB). Link previews auto-generated when no media attached. Use organizationUrn for multi-org posting. Geo-restriction only works for organization pages (not personal profiles) and requires the targeted audience to exceed 300 followers."

### `LinkedInPlatformData`

| Field | Type | Req | Notes |
|---|---|---|---|
| `documentTitle` | string | opt* | "Title displayed on LinkedIn document (PDF/carousel) posts. Required by LinkedIn for document posts. If omitted, falls back to the media item title, then the filename." (Effectively required for PDF/carousel.) |
| `organizationUrn` | string | opt | e.g. `urn:li:organization:123456789`. "If omitted, uses the default org." List via `linkedin-organizations`. |
| `firstComment` | string | opt | First comment added after post creation. |
| `disableLinkPreview` | boolean | opt (default false) | Disable auto link previews for URLs in content. |
| `geoRestriction` | `GeoRestriction` | opt | "only works for organization pages (not personal profiles) and requires the targeted audience to exceed 300 followers." |

@mentions: top-level `mentions[]` is reference-only. To make a clickable mention, resolve via `linkedin-mentions` and embed `mentionFormat` in `content`.

`MediaItem.altText` supported on LinkedIn. `MediaItem.title` becomes the LinkedIn document title for PDF/carousel.

## Read / analytics

| Endpoint | Query params | Notes |
|---|---|---|
| `GET /v1/analytics` | `platform=linkedin`, `accountId`, ... | **"LinkedIn personal accounts: Analytics are only available for posts published through Zernio ... Organization/company page analytics work for all posts."** |
| `GET /v1/accounts/{accountId}/linkedin-post-analytics` | `urn`(req, e.g. `urn:li:share:712...`) | Single-post stats. |
| `GET /v1/accounts/{accountId}/linkedin-aggregate-analytics` | `aggregation`(TOTAL/DAILY), `startDate`, `endDate`, `metrics` | Personal account aggregate. Metrics: IMPRESSION, MEMBERS_REACHED, REACTION, COMMENT, RESHARE, POST_SAVE, POST_SEND. "MEMBERS_REACHED not available with DAILY." |
| `GET /v1/analytics/linkedin/org-aggregate-analytics` | `accountId`(req, org account), `metrics`, `since`, `until`, `metricType`(time_series/total_value) | Org page aggregate. Share stats (impressions/clicks/likes/comments/shares/engagement_rate), follower-gain (organic/paid), page-view stats (total_value only). |
| `GET /v1/accounts/{accountId}/linkedin-post-reactions` | per-post | Individual reactions + reactor profiles. |
| `GET /v1/analytics/daily-metrics`, `/best-time`, `/content-decay` | `platform=linkedin`, `accountId` | Analytics add-on. |
| `GET /v1/accounts/follower-stats` | `accountIds`, `granularity` | Analytics add-on. |

## Inbox

- **Comments:** `GET /v1/inbox/comments?platform=linkedin` supported (enum includes `linkedin`). Thread: `GET /v1/inbox/comments/{postId}?accountId=...` ("LinkedIn third-party posts accept full activity URN or numeric ID"). Reply: `POST /v1/inbox/comments/{postId}` body `{accountId, message, commentId?}`.
- **DMs:** NOT supported. The `/v1/inbox/conversations` `platform` enum is `facebook, instagram, twitter, bluesky, reddit, telegram`. **LinkedIn is absent.** No LinkedIn DM surface in the spec.

## Gotchas

- No multi-video; up to 20 images; single PDF max 100MB.
- Personal-account post analytics only cover posts published through Zernio (LinkedIn API limit). Org pages cover all posts.
- @mentions require the 2-step resolve-then-embed workflow; `mentions[]` alone does nothing.
- Geo-restriction is org-pages-only and needs >300 followers.
- LinkedIn DMs are not exposed by Zernio.
