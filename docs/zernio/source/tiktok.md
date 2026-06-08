# Zernio Platform Docs — TikTok (VERBATIM CAPTURE)

> Source URL: https://docs.zernio.com/platforms/tiktok
> Fetched: 2026-06-02
> Captured via WebFetch (two passes merged: full-page + field-level).
> NOTE: the human prose docs use snake_case for the tiktokSettings/consent fields; the OpenAPI spec uses camelCase. See SPEC_VS_DOCS_ALIGNMENT.md.

## Content Limits

- Video captions: 2,200 characters
- Photo descriptions: 4,000 characters
- Photo titles: 90 characters (auto-truncated, hashtags stripped)
- Maximum photos per carousel: 35
- Videos per post: 1

## Media Requirements

- Photos: JPEG, PNG, WebP; max 20 MB; 9:16 aspect ratio recommended
- Videos: MP4, MOV, WebM; max 4 GB; 3 seconds to 10 minutes; H.264 codec; 30 fps recommended

## Critical Requirements (LEGAL / HARD GATE)

All posts require two mandatory consent flags (PROSE casing, snake_case):
- `content_preview_confirmed: true`
- `express_consent_given: true`

Privacy levels must match creator's account settings. The API supports:
`PUBLIC_TO_EVERYONE`, `MUTUAL_FOLLOW_FRIENDS`, `FOLLOWER_OF_CREATOR`, `SELF_ONLY`.
(Prose field name: `privacy_level`. Spec field name: `privacyLevel`.)

## Post Types

- Video Posts: single video only, 9:16 vertical preferred. Custom thumbnails via `video_cover_image_url` (prose) / `videoCoverImageUrl` (spec) or `video_cover_timestamp_ms` (prose) / `videoCoverTimestampMs` (spec).
- Photo Carousels: up to 35 images. Uses `content` field for title and `description` field (in tiktokSettings) for full caption.

## Request Field Names

Top-level:
- `content`
- `mediaItems`
- `platforms`
- `publishNow`
- `tiktokSettings`   (prose wrapper name)

`tiktokSettings` (PROSE, snake_case):
- `privacy_level`
- `allow_comment`
- `allow_duet`
- `allow_stitch`
- `content_preview_confirmed`
- `express_consent_given`
- `video_cover_timestamp_ms`
- `video_cover_image_url`
- `media_type`
- `photo_cover_index`
- `description`
- `auto_add_music`
- `video_made_with_ai`
- `draft`
- `commercialContentType`   (already camelCase in prose)

### Spec mapping (camelCase, `platformSpecificData` / TikTokPlatformData)

- `draft`, `privacyLevel`, `allowComment`, `allowDuet`, `allowStitch`,
  `commercialContentType` (enum: 'none','brand_organic','brand_content'),
  `brandPartnerPromote`, `isBrandOrganicPost`,
  `contentPreviewConfirmed`, `expressConsentGiven`,
  `mediaType` (enum: 'video','photo'),
  `videoCoverTimestampMs`, `videoCoverImageUrl`, `photoCoverIndex`,
  `autoAddMusic`, `videoMadeWithAi`, `description`

### Field behavior notes (from spec descriptions)

- `draft`: true sends post to TikTok Creator Inbox as a draft (post_mode MEDIA_UPLOAD for photos / inbox endpoint for videos). False/omitted = DIRECT_POST. "publish_type is not a supported field. Use this field instead."
- `privacyLevel`: one of the values returned by the TikTok creator info API for the account.
- `allowDuet` / `allowStitch`: required for video posts.
- `videoCoverTimestampMs`: defaults 1000ms; ignored when videoCoverImageUrl provided.
- `videoCoverImageUrl`: JPG/PNG/WebP, max 20MB; overrides timestamp.
- `photoCoverIndex`: 0-based, default 0.
- `autoAddMusic`: photos only.
- `videoMadeWithAi`: AI disclosure.
- `description`: long-form for photo posts (max 4000 chars), recommended when >90 chars.

## Notable Limitations / Gotchas

- "TikTok has a strict daily posting limit for posts created via third-party APIs."
- No text-only posts; media required.
- Cannot access TikTok's sound/music library (except `auto_add_music` for photo carousels).
- No comments or DMs support.
- No post editing after publishing.
- No For You Page analytics available.

## Features Matrix

Supported (✅): Basic analytics (likes, comments, shares, views), Account-level insights, Post scheduling, Creator info endpoint for privacy levels, Video posts with custom thumbnails, Photo carousels with music.

Unsupported (❌): Comments support (list/post/reply/delete), DM functionality, Live streaming, Effects/filters, Post editing.
