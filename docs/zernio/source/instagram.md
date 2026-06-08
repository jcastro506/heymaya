# Zernio Platform Docs — Instagram (VERBATIM CAPTURE)

> Source URL: https://docs.zernio.com/platforms/instagram
> Fetched: 2026-06-02
> Captured via WebFetch (two passes merged: full-page + field-level).

## Character & Media Limits

- Caption: 2,200 characters (first 125 visible before "more" fold)
- Feed posts: 1 image; carousel: up to 10 items
- Video: 1 per post
- Images: JPEG/PNG, max 8 MB (auto-compressed)
- Videos: MP4/MOV, max 300 MB (feed/reels), 100 MB (stories)
- Video duration: 90 seconds (reels), 60 minutes (feed), 60 seconds (stories)
- Rate limit: 100 posts per 24-hour rolling window

## Account Requirement (HARD GATE)

"Instagram requires a Business or Creator account. Personal accounts cannot post via API."

## Supported Content Types

1. Feed Posts — single image/video (4:5, 1:1, or 1.91:1 aspect ratio)
2. Carousels — up to 10 mixed items with matching aspect ratios
3. Stories — 24-hour disappearing content (no captions displayed)
4. Reels — vertical videos (9:16), max 90 seconds; optional `shareToFeed` parameter

## Request Field Names (exact casing)

Post creation:
- `content`
- `mediaItems`
- `platforms`
- `publishNow`
- `platformSpecificData`

`platformSpecificData` (Instagram):
- `contentType`     (prose says values 'story' / 'reels'; spec enum is only ['story'])
- `shareToFeed`
- `collaborators`
- `userTags`
- `trialParams`
- `thumbOffset`
- `instagramThumbnail`
- `audioName`
- `firstComment`
- `reelCover`   (alias for `instagramThumbnail`; spec only)

`userTags[]` sub-fields:
- `username`
- `x`
- `y`
- `mediaIndex`

`trialParams`:
- `graduationStrategy`   (values: 'MANUAL', 'SS_PERFORMANCE')

Instagram profile data (read):
- `isFollower`
- `isFollowing`
- `followerCount`
- `isVerified`
- `fetchedAt`

### Field behavior notes (from spec descriptions)

- `contentType`: "Set to 'story' to publish as a Story. Default posts become Reels or feed depending on media." (Spec enum = only `['story']`.)
- `shareToFeed`: Reels only. true (default) = Reels tab + main feed; false = Reels tab only.
- `collaborators`: up to 3 Instagram usernames (feed/Reels only).
- `firstComment`: not applied to Stories.
- `trialParams`: Trial Reels config; Reels only.
- `userTags`: photos only. Not for stories or videos. For carousels use `mediaIndex` (default 0). Tags on video items silently skipped.
- `audioName`: Reels only; can only be set once.
- `thumbOffset`: ms offset for Reel cover; ignored when `instagramThumbnail` or `reelCover` provided.
- `instagramThumbnail`: custom cover URL (JPG/PNG). Overrides `thumbOffset`. Also accepted as `reelCover`.

## Code Examples (verbatim)

Feed Post (Node.js):
```javascript
const { post } = await zernio.posts.createPost({
  content: 'Beautiful sunset today #photography',
  mediaItems: [
    { type: 'image', url: 'https://cdn.example.com/sunset.jpg' }
  ],
  platforms: [
    { platform: 'instagram', accountId: 'YOUR_ACCOUNT_ID' }
  ],
  publishNow: true
});
```

Story Post:
```javascript
const { post } = await zernio.posts.createPost({
  mediaItems: [
    { type: 'image', url: 'https://cdn.example.com/story.jpg' }
  ],
  platforms: [{
    platform: 'instagram',
    accountId: 'YOUR_ACCOUNT_ID',
    platformSpecificData: {
      contentType: 'story'
    }
  }],
  publishNow: true
});
```

Reel Post:
```javascript
const { post } = await zernio.posts.createPost({
  content: 'New tutorial is up!',
  mediaItems: [
    { type: 'video', url: 'https://cdn.example.com/reel.mp4' }
  ],
  platforms: [{
    platform: 'instagram',
    accountId: 'YOUR_ACCOUNT_ID',
    platformSpecificData: {
      contentType: 'reels',
      shareToFeed: true
    }
  }],
  publishNow: true
});
```

## Features Matrix

Direct Messages: ✅ List conversations, ✅ Fetch messages, ✅ Send text messages, ✅ Send attachments, ✅ Quick replies, ✅ Buttons, ✅ Carousels, ✅ Message tags, ✅ Archive/unarchive

Comments: ✅ List comments on posts, ❌ Post new top-level comment, ✅ Reply to comments, ✅ Delete comments, ❌ Like comments, ✅ Hide/unhide comments, ✅ Send private reply

Automations: ✅ Comment-to-DM automations, ✅ Story-reply automations, ✅ Ice breakers (max 4)

Analytics: ✅ Impressions, ✅ Reach, ✅ Likes, ✅ Comments, ✅ Shares, ✅ Saves, ✅ Views. Specialized endpoints: account insights, follower history, demographic breakdowns.

Unavailable (❌): Add music to Reels, story stickers, story location tags, go live, create guides, apply filters, tag products, post to personal accounts, create top-level comments.

## Critical Warning

"Google Drive, Dropbox, OneDrive, and iCloud links do not work as media URLs." Use direct CDN URLs or Zernio's media endpoint.
