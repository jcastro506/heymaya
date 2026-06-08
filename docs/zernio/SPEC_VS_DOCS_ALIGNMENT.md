# Zernio: Prose Docs vs OpenAPI Spec Alignment

> Cross-check date: 2026-06-02
> Prose source: docs.zernio.com/platforms/{twitter,instagram,linkedin,tiktok,youtube,reddit} (captured verbatim in `docs/zernio/source/`)
> Wire contract: `docs/zernio_openapi_1.0.4.yaml` — `components.schemas.{Twitter,Reddit,LinkedIn,Instagram,TikTok,YouTube}PlatformData`, `MediaItem`, and the inline `platforms[]` object in `POST /v1/posts`.
> Scope: only the 6 platforms Maya offers (X, Instagram, LinkedIn, TikTok, YouTube, Reddit). Bluesky/Threads/Pinterest/Facebook/Discord/Snapchat/Telegram/WhatsApp/GoogleBusiness deliberately excluded.

## Default rule for what to trust at the wire

**The OpenAPI spec is the wire contract.** When the prose doc and the spec disagree on a field NAME or CASING, send the spec's name. The biggest live risk is TikTok: the prose teaches snake_case (`privacy_level`), but the spec body field is camelCase (`privacyLevel`). One exception confirmed below where the snake_case in the prose is ALSO in the spec (`poll.duration_minutes`) — there, the prose is correct.

No evidence was found that the prose should be trusted over the spec for any wire field. Where the prose mentions a field the spec lacks (e.g. Reddit `sr` alias, IG `reels` contentType value), treat those as documentation-layer conveniences/aliases that are NOT guaranteed by the spec — prefer the spec's canonical form.

---

## X / Twitter

### (a) DIVERGENCES — name/casing

| Field (prose) | Field (spec, `TwitterPlatformData`) | Verdict |
|---|---|---|
| `poll.duration_minutes` | `poll.duration_minutes` | NOT a divergence — snake_case in BOTH. This is the one place the snake_case prose is also the wire contract. Send `duration_minutes`. |
| `poll.options` | `poll.options` | Match. |
| `replySettings` values: "following" / "mentionedUsers" / "subscribers" / "verified" | enum identical | Match. |
| `skipDmCheck` | `skipDmCheck` (top-of-platform-entry in prose; not present in `TwitterPlatformData` schema in spec) | MINOR: prose lists `skipDmCheck` as a Twitter platformSpecificData field; the spec's `TwitterPlatformData` does not declare it. Likely accepted-but-undocumented. Treat as optional; do not depend on it. |

All other Twitter fields (`replyToTweetId`, `quoteTweetId`, `threadItems[].content`, `threadItems[].mediaItems`, `longVideo`, `geoRestriction.countries`) match exactly between prose and spec.

---

## Instagram

### (a) DIVERGENCES — name/casing

| Field (prose) | Field (spec, `InstagramPlatformData`) | Verdict |
|---|---|---|
| `contentType: 'reels'` (prose Reel example) | `contentType` enum = `['story']` only | DIVERGENCE (value, not casing). Prose Reel example passes `contentType: 'reels'`; spec only enumerates `'story'`. Per spec descriptions, default media auto-becomes Reels/feed, so `'reels'` may be tolerated but is NOT in the enum. **Trust the spec: only `'story'` is a guaranteed value.** Do not rely on `'reels'`; omit `contentType` to get a Reel. |
| `reelCover` (alias of `instagramThumbnail`) | `reelCover` present in spec (alias) | Match — spec documents `reelCover` as alias; `instagramThumbnail` wins if both sent. No divergence; the field-level prose pass omitted it but the full prose mentions the alias. |
| `userTags[].x` / `.y` (0.0-1.0 coords) | `userTags[].x` / `.y` (number) | Match (casing identical). |
| `userTags[].mediaIndex` | `userTags[].mediaIndex` | Match. |
| `trialParams.graduationStrategy` ('MANUAL'/'SS_PERFORMANCE') | identical enum | Match. |

No casing mismatches. The only real divergence is the `contentType` enum VALUE (`'reels'` in a prose example vs spec enum of `['story']`).

---

## LinkedIn

### (a) DIVERGENCES — name/casing

No name or casing divergences found. Every prose field maps 1:1 to `LinkedInPlatformData`:
`documentTitle`, `organizationUrn`, `firstComment`, `disableLinkPreview`, `geoRestriction.countries`. Casing identical (camelCase in both). Clean.

---

## TikTok

### (a) DIVERGENCES — name/casing  (THE BIG ONE)

The prose docs wrap TikTok fields in a `tiktokSettings` object using **snake_case**. The spec uses `platformSpecificData` → `TikTokPlatformData` in **camelCase**. This is a wholesale casing divergence across nearly every field.

| Field (PROSE, snake_case, `tiktokSettings`) | Field (SPEC, camelCase, `TikTokPlatformData`) | Verdict |
|---|---|---|
| `privacy_level` | `privacyLevel` | DIVERGENCE — send `privacyLevel`. |
| `content_preview_confirmed` | `contentPreviewConfirmed` | DIVERGENCE — send `contentPreviewConfirmed`. (Legal consent flag — getting the name wrong = silent drop of consent.) |
| `express_consent_given` | `expressConsentGiven` | DIVERGENCE — send `expressConsentGiven`. (Legal consent flag.) |
| `allow_comment` | `allowComment` | DIVERGENCE — send `allowComment`. |
| `allow_duet` | `allowDuet` | DIVERGENCE — send `allowDuet`. |
| `allow_stitch` | `allowStitch` | DIVERGENCE — send `allowStitch`. |
| `video_cover_timestamp_ms` | `videoCoverTimestampMs` | DIVERGENCE — send `videoCoverTimestampMs`. |
| `video_cover_image_url` | `videoCoverImageUrl` | DIVERGENCE — send `videoCoverImageUrl`. |
| `media_type` | `mediaType` (enum 'video'/'photo') | DIVERGENCE — send `mediaType`. |
| `photo_cover_index` | `photoCoverIndex` | DIVERGENCE — send `photoCoverIndex`. |
| `auto_add_music` | `autoAddMusic` | DIVERGENCE — send `autoAddMusic`. |
| `video_made_with_ai` | `videoMadeWithAi` | DIVERGENCE — send `videoMadeWithAi`. |
| `description` | `description` | Match (single word). |
| `draft` | `draft` | Match. |
| `commercialContentType` | `commercialContentType` (enum 'none'/'brand_organic'/'brand_content') | Match — already camelCase in prose. |
| (wrapper) `tiktokSettings` | (wrapper) `platformSpecificData` | DIVERGENCE in the WRAPPER KEY itself. Prose nests under `tiktokSettings`; the wire contract nests TikTok fields under `platformSpecificData` like every other platform. **Send `platformSpecificData`.** |
| not in prose field list | `brandPartnerPromote` (spec only) | Spec-only field; not taught in prose. |
| not in prose field list | `isBrandOrganicPost` (spec only) | Spec-only field; not taught in prose. |

**TRUST: the OpenAPI spec in all cases.** Send camelCase under `platformSpecificData`. The known example in the brief is confirmed: `content_preview_confirmed`/`express_consent_given`/`privacy_level` (prose) → `contentPreviewConfirmed`/`expressConsentGiven`/`privacyLevel` (spec). Because two of these are legal-consent flags, a snake_case payload that the API silently ignores would mean posting without recorded consent — highest-severity divergence in the whole set.

---

## YouTube

### (a) DIVERGENCES — name/casing

No name or casing divergences in the `YouTubePlatformData` fields:
`title`, `visibility`, `madeForKids`, `firstComment`, `containsSyntheticMedia`, `categoryId`, `playlistId` — all camelCase in both prose and spec; `visibility` enum (`public`/`private`/`unlisted`) matches.

Notes (not wire divergences):
- Prose mentions `defaultPlaylistId` / `defaultPlaylistName` — these belong to account/default config, not the per-post `YouTubePlatformData` schema. Not a divergence, different scope.
- Prose references `thumbnail` on a media item; the spec puts `thumbnail` on `MediaItem` (matches).

---

## Reddit

### (a) DIVERGENCES — name/casing

| Field (prose) | Field (spec, `RedditPlatformData`) | Verdict |
|---|---|---|
| `subreddit` (+ aliases `subredditName`, `sr`) | `subreddit` only | Aliases `subredditName` / `sr` are prose-only conveniences; spec declares only `subreddit`. **Send `subreddit`.** Not a casing conflict — the canonical name matches. |
| `flairId` (+ alias `redditFlairId`) | `flairId` only | Alias `redditFlairId` is prose-only; spec declares only `flairId`. **Send `flairId`.** Canonical name matches. |
| `forceSelf`, `nativeVideo`, `videogif`, `videoPosterUrl`, `title`, `url` | identical | Match. |

No casing mismatches. The only deltas are documentation aliases the prose lists (`subredditName`, `sr`, `redditFlairId`) that the spec does not guarantee — prefer the canonical spec names.

---

## (b) Features in the docs — "available, are we using it?" checklist

Per channel, capabilities the prose advertises that Maya may be under-using. (Audit-only; this doc does not assert current usage.)

### X / Twitter
- [ ] Polls (`poll.options` + `poll.duration_minutes`)
- [ ] Threads (`threadItems[]`)
- [ ] Quote tweets (`quoteTweetId`) — cheaper ($0.015) than URL-in-text ($0.20)
- [ ] Replies / `replyToTweetId`
- [ ] `replySettings` (following / mentionedUsers / subscribers / verified)
- [ ] Long video (`longVideo`, Premium + allowlist)
- [ ] Media alt text (`MediaItem.altText`)
- [ ] Retweet / Bookmark / Follow actions
- [ ] DM send (requires X API Pro $5k/mo — likely out of scope)

### Instagram
- [ ] Stories (`contentType: 'story'`)
- [ ] Reels + `shareToFeed`
- [ ] Carousels (up to 10 items)
- [ ] Collaborators (`collaborators`, up to 3)
- [ ] User tags (`userTags`, photos only)
- [ ] Trial Reels (`trialParams.graduationStrategy`)
- [ ] First comment (`firstComment`)
- [ ] Custom Reel cover (`instagramThumbnail` / `reelCover` / `thumbOffset`)
- [ ] Custom audio name (`audioName`)
- [ ] Comment-to-DM / story-reply automations, Ice breakers (max 4)

### LinkedIn
- [ ] PDF/document carousel posts (`documentTitle` + document MediaItem)
- [ ] First comment for link placement (`firstComment`) — reach-penalty mitigation
- [ ] Multi-image (up to 20)
- [ ] Multi-org posting (`organizationUrn`)
- [ ] Geo-restriction (`geoRestriction.countries`, org pages, 300+ followers)
- [ ] `disableLinkPreview`

### TikTok
- [ ] Photo carousels (up to 35, `mediaType: 'photo'`)
- [ ] Auto-add music for photos (`autoAddMusic`)
- [ ] Custom video cover (`videoCoverImageUrl` / `videoCoverTimestampMs`)
- [ ] Draft-to-inbox mode (`draft`)
- [ ] Duet/stitch toggles (`allowDuet` / `allowStitch`)
- [ ] Commercial-content disclosure (`commercialContentType`, `brandPartnerPromote`, `isBrandOrganicPost`)
- [ ] AI disclosure (`videoMadeWithAi`)

### YouTube
- [ ] Shorts (auto-detected by duration/aspect)
- [ ] Playlists (`playlistId`, +50 quota units/call)
- [ ] Custom thumbnail (regular videos only)
- [ ] First comment (`firstComment`, up to 10k chars)
- [ ] Category targeting (`categoryId`)
- [ ] AI disclosure (`containsSyntheticMedia`)
- [ ] Comment read/reply/delete

### Reddit
- [ ] Flair (`flairId`) — required by many subs (failure cause)
- [ ] Gallery / multi-image
- [ ] Native video (`nativeVideo`) + videogif (`videogif`) + poster (`videoPosterUrl`)
- [ ] Link vs text vs image post selection (`url` / `forceSelf`)
- [ ] DMs (text only) + comments
- [ ] Subreddit + flair discovery endpoints (`reddit-subreddits`, `reddit-flairs`)

---

## (c) Hard gates / gotchas the prose emphasizes

### X / Twitter
- **$0.20 per URL-containing post** vs $0.015 plain create. Use `quoteTweetId` (billed $0.015) instead of pasting a tweet URL into text (billed $0.20).
- Duplicate content rejected.
- URLs count as 23 chars; emojis count as 2 chars each — budget the 280-char limit accordingly.
- Editing needs Premium, within 1 hour, max 5 edits, text-only.
- DM writing needs X API Pro ($5,000/mo) or Enterprise.
- `quoteTweetId`: can only quote your own posts or posts you're mentioned in; arbitrary accounts rejected by X.
- `poll` mutually exclusive with media and threads; `quoteTweetId` mutually exclusive with media and poll.

### Instagram
- **Business or Creator account REQUIRED.** Personal accounts cannot post via API. (Hard gate.)
- **Google Drive / Dropbox / OneDrive / iCloud links do NOT work as media URLs** — use direct CDN URLs or Zernio media endpoint.
- Rate limit: 100 posts / 24h rolling window.
- No top-level comments (reply-only); cannot like comments.
- Can't add music to Reels, story stickers, location tags, go live, tag products.
- `userTags` silently skipped on video items; not supported on stories/videos.

### LinkedIn
- **Link-reach penalty: 40-50% organic reach drop** if a URL is in the caption. Put URLs in `firstComment`.
- **422 on duplicate content** — identical text rejected, even across different times.
- Media types CANNOT be mixed (images / videos / documents posted separately).
- DMs blocked by LinkedIn for third parties.
- Geo-restriction: org pages only, requires 300+ targeted followers; 44 countries; unsupported codes silently skipped.

### TikTok
- **Consent is a legal requirement:** `contentPreviewConfirmed: true` + `expressConsentGiven: true` mandatory on every post. (And the prose teaches the WRONG casing — see section (a). Send camelCase or consent is silently dropped.)
- `privacyLevel` must match a value from the creator info API for that account.
- Strict daily posting limit for third-party API posts.
- No text-only posts (media required), no editing after publish, **no inbox / no comments / no DMs**, no FYP analytics, no music library (except `autoAddMusic` for photos).
- Photo titles auto-truncated at 90 chars (hashtags stripped) — use `description` for >90 chars.

### YouTube
- **`madeForKids` is a one-way door:** setting true PERMANENTLY disables comments, notification bell, personalized ads, end screens, and cards. Also: "YouTube may block views if not explicitly set."
- Scheduling = upload private now, flip visibility later.
- `playlistId` costs 50 API quota units per call.
- Shorts: no custom thumbnail via API.
- No captions/subtitles upload, no community posts, no live/premieres, no monetization, no playlist create/delete.

### Reddit
- **>50% (53.9%) of posts fail** — almost always preventable by reading subreddit rules (flair required, karma/age thresholds, no-self rules, third-party posting bans, AI-content bans).
- **Title is immutable** — cannot edit after posting. (300-char cap, defaults to first line of content.)
- New / low-karma accounts blocked by most subreddits.
- Video auto-falls-back to a link post if the subreddit blocks video.
- No polls, no crossposts, no title edit, no collections, no awards, no vote counts, DM attachments unsupported.
- Error codes to handle: `SUBREDDIT_NOTALLOWED`, `NO_SELFS`, `SUBMIT_VALIDATION_FLAIR_REQUIRED`, `SUBREDDIT_NOEXIST`.
