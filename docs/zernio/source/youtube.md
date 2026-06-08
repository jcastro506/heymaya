# Zernio Platform Docs — YouTube (VERBATIM CAPTURE)

> Source URL: https://docs.zernio.com/platforms/youtube
> Fetched: 2026-06-02
> Captured via WebFetch (two passes merged: full-page + field-level).

## Content Limits

- Title: 100 characters max
- Description: 5,000 characters max
- Tags: 500 characters total
- Videos per post: 1 only
- `firstComment`: max 10,000 chars (YouTube's comment limit)

## Video Requirements

- Formats: MP4, MOV, AVI, WMV, FLV, 3GP, WebM
- Max size: 256 GB
- Duration: 15 min (unverified), 12 hours (verified)
- Shorts: ≤3 min, 9:16 aspect ratio; Regular videos: 16:9 aspect ratio

## Thumbnail Support

- Formats: JPEG, PNG, GIF
- Max size: 2 MB
- Resolution: 1280 x 720 px recommended
- Shorts: Not supported via API

## Post Types

Videos and Shorts (auto-detected by duration/aspect ratio).

## Request Field Names (exact casing)

From JSON examples:
- `content`
- `mediaItems` (`type`, `url`, `thumbnail`)
- `platforms` (`platform`, `accountId`, `platformSpecificData`)
- `publishNow`
- `title`
- `visibility`
- `categoryId`
- `madeForKids`
- `containsSyntheticMedia`
- `playlistId`
- `firstComment`
- `defaultPlaylistId`
- `defaultPlaylistName`
- (raw-request helpers) `method`, `path`, `body`

### Platform-Specific Fields Table

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `title` | string | First line of content or "Untitled Video" | Max 100 characters |
| `visibility` | "public" \| "private" \| "unlisted" | "public" | Access control |
| `madeForKids` | boolean | false | Disables comments, notifications, personalized ads |
| `containsSyntheticMedia` | boolean | false | AI-generated content flag |
| `categoryId` | string | "22" | Video category identifier |
| `playlistId` | string | -- | Optional playlist assignment |
| `firstComment` | string | -- | Auto-posted pinned comment (max 10,000 chars) |

### Field behavior notes (from spec descriptions)

- `visibility`: public (default), unlisted (link only), private (invite only).
- `madeForKids`: COPPA flag; "YouTube may block views if not explicitly set."
- `containsSyntheticMedia`: AI disclosure; YouTube may add a label.
- `categoryId`: default 22 (People & Blogs). Common: 1 Film, 2 Autos, 10 Music, 15 Pets, 17 Sports, 20 Gaming, 23 Comedy, 24 Entertainment, 25 News, 26 Howto, 27 Education, 28 Science & Tech.
- `playlistId`: list via `GET /v1/accounts/{id}/youtube-playlists`. Quota cost: 50 YouTube API units per call.

## Critical Note on COPPA (one-way door)

Setting `madeForKids` to true "permanently disables comments, notification bell, personalized ads, end screens, and cards."

## Scheduling

Videos upload immediately as private, then change visibility at scheduled time.

## Features Matrix

Available (✅): Video uploads and scheduling, Custom thumbnails (regular videos only), Playlist management (add to existing, list, set defaults), Comments (read, reply, delete), Analytics (views, likes, shares, comments, demographics), Daily views and channel insights APIs.

Comments: List ✅, Reply ✅, Delete ✅, Like ❌ (no API available).

Unsupported (❌): Community posts, Live/Premieres, captions/subtitles, monetization settings, DMs (platform doesn't support them), End screens, cards, chapters (via API), Create or delete playlists, Like/dislike videos.

## Analytics

Bundled with paid accounts; includes daily views with 2-3 day delay.
