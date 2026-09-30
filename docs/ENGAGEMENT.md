# Engagement

Growing means showing up on other people's posts and answering your own comments. What Maya does about it, and what she will never do.

## The rule
**She never comments, likes or replies as them on her own.** Instagram and TikTok give no API for commenting on someone else's post; the only way to automate it is a bot acting as the user, which is how accounts get banned. And a reply "in their voice" that she posts is a reply they didn't write. So: she finds, they act.

## Built: the engagement round (2026-09-30)
`convex/engage/round.ts`, the Today card in the app (`EngageCard`).
- Each day, up to five fresh posts (under 72 h) from the accounts she already watches for them: no extra reads, no model call. Fresh and quiet first ("new and still quiet: an early comment gets seen"), at most two per account.
- Tap a post to open it in TikTok or Instagram; tick it when they've commented. Three a day is the goal; days at the goal in a row are the streak (their timezone).
- Each tick is a `userActions` row (`engage.commented`), so she knows what they did.
- `markEngaged` is the one writer; a chat tool can call the same function.

## Built: an opinion on a draft has her full tools (2026-09-30)
"Will this do well?" on a draft file now runs her lookup step (their history with the structure, the lane's benchmark, what they've said before) and carries `theirCraft`: how their best and weakest watched posts open and pace. She still gives a read and three fixes, never a score or a predicted view count.

## Next
1. **Their own comments, through the connection they already have** (Zernio's inbox API: reading is unmetered and included; webhooks for new comments). Today we read comments through the scraper at 15 credits a post on Instagram. Surface the few worth answering (a real question, a collab, a complaint) and the questions that are video ideas. Replies are theirs to write; if she ever drafts one, it is approved one at a time.
   - Instagram: read, reply, hide are supported. Liking comments is restricted to Zernio's own testers.
   - TikTok: reading needs the TikTok for Business connection; whether replying works is unclear in their docs and must be tested against a real account before it is promised. DMs only for TikTok Business accounts.
2. **A nudge by text right after they post** (when engaging helps most), inside the daily cap.
3. **A "check a draft" screen in the app** with her notes pinned to the moments they're about, and the track record of her calls.
