# Zernio Platform Docs — LinkedIn (VERBATIM CAPTURE)

> Source URL: https://docs.zernio.com/platforms/linkedin
> Fetched: 2026-06-02
> Captured via WebFetch (two passes merged: full-page + field-level).

## Content Limits

- Character limit: 3,000
- Images per post: 20
- Videos per post: 1
- Documents per post: 1 (PDF, PPT, PPTX, DOC, DOCX)

## Media Formats & Sizes

- Images: JPEG, PNG, GIF (max 8 MB)
- Videos: MP4, MOV, AVI (max 5 GB; 10 min personal / 30 min company)
- Documents: max 100 MB, 300 pages

## Critical Best Practices / Gotchas

- "LinkedIn actively suppresses posts containing external links" — organic reach can drop 40-50% if a URL is in the caption. Recommended: put URLs in the `firstComment` field instead.
- Duplicate content: LinkedIn rejects identical posts with a 422 error, preventing the same text from being posted across different time periods.
- Media types cannot be mixed — images, videos, and documents must be posted separately.

## Supported Post Types

- Text-only (highest organic reach)
- Single / multi-image (up to 20)
- Video (with platform-specific duration limits)
- Documents (display as swipeable carousels)

## Request Field Names (exact casing)

Post creation:
- `content`
- `mediaItems`
- `platforms`
- `publishNow`

Platform configuration:
- `platform`
- `accountId`
- `platformSpecificData`

`platformSpecificData` (LinkedIn):
- `documentTitle`
- `organizationUrn`
- `firstComment`
- `disableLinkPreview`
- `geoRestriction`

`geoRestriction`:
- `countries`

Media items:
- `type`
- `url`
- `title`
- `filename`

### Field behavior notes (from spec descriptions)

- `documentTitle`: title for document (PDF/carousel) posts. Required by LinkedIn for document posts. Falls back to media item title, then filename.
- `organizationUrn`: target Org URN, e.g. "urn:li:organization:123456789". Omitting uses default org. List via `GET /v1/accounts/{id}/linkedin-organizations`.
- `firstComment`: optional first comment after the post is created.
- `disableLinkPreview`: true disables automatic link previews (default false).

## Multi-organization posting

Post to different company pages using the same account with different `organizationUrn` values, format `urn:li:organization:123456`.

## Geo-restriction

Limits post visibility to specified countries (organization pages only; requires 300+ targeted followers). 44 countries supported; unsupported country codes silently skipped.

## Content Type Support

Supported (✅): Text-only posts, Single image posts, Multi-image posts (up to 20), Video posts (1 per post), Document/carousel posts (PDF, PPT, PPTX, DOC, DOCX), Scheduling, Comments (organization accounts only), Analytics.

Unsupported (❌): Long-form articles, Polls, Events, Direct messages, Newsletters, Mixing media types, Comment likes via API, DMs (LinkedIn blocks third-party access).

## Analytics

- Personal accounts: impressions, reach, likes, comments, shares, saves, sends
- Organization accounts: added clicks and page-view metrics

## Notable Restrictions

DMs cannot be accessed via API. Comment operations limited to listing, replying, deletion (liking comments unsupported).
