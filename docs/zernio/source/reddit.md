# Zernio Platform Docs — Reddit (VERBATIM CAPTURE)

> Source URL: https://docs.zernio.com/platforms/reddit
> Fetched: 2026-06-02
> Captured via WebFetch (two passes merged: full-page + field-level).

## Content Limits

- Title: 300 characters (required, immutable after posting)
- Body text: 40,000 characters
- Images: 1 per post, or multiple for galleries
- Videos: 1 per post
- Formats: JPEG, PNG, GIF
- Max image size: 20 MB

## Supported Post Types

Text, Link, Image, Gallery, and Native Video posts — with scheduling.

## Critical Pre-Posting Requirements / Gotchas

- "More than half of all Reddit posts via Zernio fail." (Stated 53.9% failure rate.) Almost every failure is preventable by reading the target subreddit's rules first.
- Verify: subreddit allows the post type; flair requirements (many auto-remove posts without it); third-party/automated posting permissions; karma and account age thresholds.
- Titles are permanent — cannot be edited after posting.
- New accounts face restrictions — low karma blocks most subreddits.
- Video rules vary — blocked videos auto-fallback to link posts.
- Each subreddit has independent rules.

## Request Field Names (exact casing)

From JSON examples and field tables:
- `subreddit`  (aliases: `subredditName`, `sr`)
- `title`
- `content`  (becomes title for text posts; body for text posts)
- `url`
- `nativeVideo`
- `videogif`
- `videoPosterUrl`
- `flairId`  (alias: `redditFlairId`)
- `forceSelf`
- `mediaItems`
- `platforms`
- `accountId`
- `platformSpecificData`
- `publishNow`

### Field behavior notes (from spec descriptions)

- `subreddit`: without "r/" prefix. List via `GET /v1/accounts/{id}/reddit-subreddits`.
- `title`: defaults to first line of content, truncated to 300 chars.
- `url`: if provided (and forceSelf not true), creates a link post instead of text post.
- `forceSelf`: true forces a text/self post even when URL or media provided.
- `flairId`: required by some subreddits. List via `GET /v1/accounts/{id}/reddit-flairs?subreddit=name`.
- `nativeVideo`: default true for video mediaItems; uploads to Reddit CDN (kind=video), server-side transcode 1080p/30fps cap. false = legacy link post. Auto-falls-back to link post if subreddit blocks video.
- `videogif`: true (with nativeVideo active) submits as silent videogif (kind=videogif).
- `videoPosterUrl`: optional poster/thumbnail; first frame used if omitted.

## Features Matrix

Supported (✅): Scheduling, Native video uploads, Flairs, DMs (text only), Comments, Analytics (upvotes + comments only), Subreddit targeting.

Unsupported (❌): Polls, Crossposts, Title editing, Collections, Live chat, Awards, Vote counts, DM attachments (API limitation).

## Common Error Codes

- `SUBREDDIT_NOTALLOWED`
- `NO_SELFS`
- `SUBMIT_VALIDATION_FLAIR_REQUIRED`
- `SUBREDDIT_NOEXIST`
- Plus: "AI-generated content not allowed" rejections and rate limiting.
