# Zernio Platform Docs — Twitter / X (VERBATIM CAPTURE)

> Source URL: https://docs.zernio.com/platforms/twitter
> Fetched: 2026-06-02
> Captured via WebFetch (two passes merged: full-page + field-level).

## Character & Media Limits

- Free accounts: 280 characters; Premium: 25,000 characters
- Images: 4 per tweet (5 MB max each)
- GIFs: 1 per tweet (15 MB max)
- Videos: 1 per tweet (512 MB, 140 seconds standard; longer with Premium)
- URLs always count as 23 characters regardless of actual length
- Emojis count as 2 characters each

## Supported Content Types

Text tweets, images (JPEG, PNG, WebP, GIF), videos (MP4, MOV), threads, polls, quote tweets, replies, and long-form video (Premium).

## Pricing / Metering (passthrough, zero markup)

"X API costs are passed through at exact rate, with zero markup." Metered operations:
- posts read: $0.005
- content creation: $0.015
- content with URLs: $0.20
- DMs: $0.010-$0.015

Note: pasting a tweet URL into the text body is billed at the URL rate ($0.20); using `quoteTweetId` is billed at the standard create rate ($0.015).

## Editing

Requires X Premium subscription, must occur within 1 hour, max 5 edits per tweet, text-only.

## DM writing

Requires X API Pro tier ($5,000/month) or Enterprise access.

## Request Field Names (exact casing)

Top-level (`POST /v1/posts`):
- `content`
- `mediaItems`
- `platforms`
- `publishNow`
- `customContent`
- `postId`

Platform entry:
- `platform`
- `accountId`
- `platformSpecificData`

`platformSpecificData` (Twitter):
- `replyToTweetId`
- `quoteTweetId`
- `replySettings`  (values: "following", "mentionedUsers", "subscribers", "verified")
- `threadItems`
- `poll`
- `longVideo`
- `geoRestriction`
- `skipDmCheck`

Nested:
- `poll.options` (string array)
- `poll.duration_minutes` (number)   ← snake_case in prose
- `threadItems[].content`
- `threadItems[].mediaItems`
- `geoRestriction.countries`
- `mediaItems[].type`
- `mediaItems[].url`

### Field behavior notes (from spec descriptions, corroborated)

- `replyToTweetId`: published tweet appears as a reply. For threads, only first tweet replies to the target.
- `quoteTweetId`: ID or full status URL. Mutually exclusive with media and poll. X only permits quoting your own posts or posts you are mentioned in. Billed at $0.015 (vs $0.20 for URL-in-text).
- `replySettings`: cannot be combined with `replyToTweetId`. For threads, applies to first tweet only.
- `threadItems`: first item is root tweet. When provided, top-level `content` is NOT published (display/search only). First tweet must be `threadItems[0]`.
- `poll`: mutually exclusive with media attachments and threads.
- `longVideo`: enables amplify_video (over 140s, up to 10 min). Requires active X Premium; X may require separate allowlisting.

## Code Examples (verbatim)

Quick Start (Node.js):
```javascript
const { post } = await zernio.posts.createPost({
  content: 'Hello from Zernio API!',
  platforms: [
    { platform: 'twitter', accountId: 'YOUR_ACCOUNT_ID' }
  ],
  publishNow: true
});
```

Quote Tweet (curl):
```bash
curl -X POST https://zernio.com/api/v1/posts \
  -d '{"content":"Adding context via quote tweet","platforms":[{"platform":"twitter","accountId":"YOUR_ACCOUNT_ID","platformSpecificData":{"quoteTweetId":"1748391029384756102"}}],"publishNow":true}'
```

Poll (Node.js):
```javascript
const { post } = await zernio.posts.createPost({
  content: 'Which feature should we ship next?',
  platforms: [{
    platform: 'twitter',
    accountId: 'YOUR_ACCOUNT_ID',
    platformSpecificData: {
      poll: {
        options: ['Dark mode', 'New analytics', 'More integrations'],
        duration_minutes: 1440
      }
    }
  }],
  publishNow: true
});
```

## Features Matrix

Supported (✅):
- Analytics: Impressions, Likes, Comments, Shares, Clicks, Views
- Inbox: List conversations, Fetch messages, Send text messages, Send attachments
- Comments: List comments on posts, Post new comment, Reply to comments, Delete comments, Like/unlike comments, Hide/unhide comments
- Retweet, Bookmark, Follow

Unsupported (❌):
- Create Spaces
- Post to Communities
- Pin tweets to profile
- Add Twitter Cards
- Post as personal DM broadcast
- Archive/unarchive conversations

## Other constraints

- Duplicate content is rejected.
- Encrypted X Chat conversations are not retrievable via API (platform limitation).
