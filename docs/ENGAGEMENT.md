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
- **Her text** (`sendText`, on the hourly cadence at midday their time): up to three of those posts with their links, written by code from rows. At most once a day and four a week; only with two or more she hasn't sent; not when they've already commented today; counted toward the daily cap, and held by quiet hours, pause and the back-off when they aren't replying.
- **New to you, in her lane.** Besides the accounts they watch, the round takes fresh posts her daily keyword sweep already saved for THEIR lane keywords (from her read of them), from creators they don't watch and that aren't them, minus repost and meme pages. Their accounts come first; up to two lane finds in the app and one in a text (more only when their accounts run short). Labelled "New to you". No extra reads.
- **The text only goes into a live conversation** (they texted her in the last 48 hours). The phone back-off counts every proactive text since their last reply, and nobody replies to a list of links, so a text into silence would slow her idea texts and cost the line. Otherwise the round waits in the app.
- **Never the same post twice.** `creators.engage` remembers the newest 200 posts she has texted (`sent`) and the newest 200 they commented on (`commented`). A texted post is never texted again; a commented post never returns, in a text or in the app.

## Built: an opinion on a draft has her full tools (2026-09-30)
"Will this do well?" on a draft file now runs her lookup step (their history with the structure, the lane's benchmark, what they've said before) and carries `theirCraft`: how their best and weakest watched posts open and pace. She still gives a read and three fixes, never a score or a predicted view count.

## Next
1. **Their own comments, through the connection they already have** (Zernio's inbox API: reading is unmetered and included; webhooks for new comments). Today we read comments through the scraper at 15 credits a post on Instagram. Surface the few worth answering (a real question, a collab, a complaint) and the questions that are video ideas. Replies are theirs to write; if she ever drafts one, it is approved one at a time.
   - Instagram: read, reply, hide are supported. Liking comments is restricted to Zernio's own testers.
   - TikTok: reading needs the TikTok for Business connection; whether replying works is unclear in their docs and must be tested against a real account before it is promised. DMs only for TikTok Business accounts.
2. **Time the text to right after they post** (when engaging helps most) instead of midday.
3. **A "check a draft" screen in the app** with her notes pinned to the moments they're about, and the track record of her calls.
