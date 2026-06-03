---
name: maya-publisher
description: Turn a planned post recipe (WHAT to say / LINK / VOICE NOTES from a gtmCalendarEvent) into a correct Zernio post for the channel, then gate it. Encodes per-platform write SHAPE as prose for the 6 offered channels (X, Reddit, LinkedIn, Instagram, TikTok, YouTube). The one place Maya turns a queued event into a live post, with ban-safety + cost + connection-health gates fail-closed before anything ships.
---

# maya-publisher

## Purpose

This is the ONE place Maya turns an approved plan recipe into a live post on a connected channel. The recipe (WHAT to say, the LINK, the VOICE NOTES) comes from a `gtmCalendarEvent` the morning brief or the populator already built. Maya's job here is to shape that recipe into the correct payload for the specific channel, check every gate (ban-safety, cost cap, connection health), and either auto-publish, hand the founder a one-tap confirm card, or fall back to a deep-link draft the founder pastes. The headline promise is "I post for you," and this skill is what keeps that promise honest, never claiming "posted" off an optimistic 200.

Platform differences live in the prose below, not in branches. Maya reasons over them the way a human social manager would, because each channel rewards a different shape.

## When to invoke

- IF a `gtmCalendarEvent` reaches its scheduled time AND it is `status: 'queued'` (auto-postable) THEN shape + publish.
- IF the operator says "post this now" AND the draft is approved and slop-clean THEN publish.
- IF a `needs_confirm` Reddit/TikTok card was tapped by the founder THEN publish that confirmed event.
- NEVER from the heartbeat. NEVER auto-publish a Reddit or TikTok event (those are always confirm-to-post, see the ban-safety gate).
- NEVER for a channel that is not one of the 6 offered (X, Reddit, LinkedIn, Instagram, TikTok, YouTube).

## Required reads

1. **APP.md, GTM.md** — what we sell, the wrapped signup link, the bet channels.
2. **USER.md** — operator voice, and the connected-accounts state (which channels are live, which need a reconnect).
3. **PLAYBOOK.md § 6** — the anti-slop ban list (final pre-publish check).
4. **TOOLS.md** — the typed tools `post_to_channel`, `check_already_engaged`, `list_connected_accounts`, and `get_connection_health`. Never call a raw Zernio endpoint by name. Always go through Maya's typed tools. Which channels are connected + healthy: `list_connected_accounts` / `get_connection_health` (also summarized in USER.md's "Connected accounts" section).

## The gates — fail-closed, in order, before every publish

Maya runs these before shaping anything. If any gate fails, she does not publish.

1. **Connection check.** Confirm the channel is connected + healthy via `get_connection_health` (and `list_connected_accounts`). If it isn't connected or `canPost` is false (token expired/revoked), do NOT auto-publish. Fall back to a deep-link draft the founder pastes by hand, and hand off to maya-connection-health for the reconnect nudge. A silent failure here is the worst outcome, so when in doubt, fall back to the paste-it draft rather than fire into a channel that isn't connected. (The server `outboundFirewall.ts` enforces this independently.)
2. **Plan caps.** Consult `planFeaturesGtm`: respect `autoPostChannelCap` (don't auto-post on a channel beyond the connected cap) and `xUrlPostsSoftCap` for X link-posts. These are fail-closed circuit-breakers, not paywalls. If a corrupt plan reads as caps-of-zero, Maya can still research and draft but cannot publish.
3. **Dedup.** For any reply or comment, call `check_already_engaged({platform, externalId, commentId?})` BEFORE drafting. If Maya already engaged that thread or comment, do not draft a second reply. The server enforces one-reply-per-thread anyway, but checking first avoids wasted work.
4. **Slop re-check.** Drafts drift between approval and publish. Run the final ban-list check (PLAYBOOK § 6). Anything that trips it goes back for revision, not out the door.

## Ban-safety gate (load-bearing)

Reddit and TikTok are ALWAYS confirm-to-post. Maya emits a Telegram one-tap card and NEVER auto-publishes them, for two independent reasons that each stand on their own:

- **Account ban risk.** Both are channels where an autonomous misfire can get the founder's account flagged or banned. The founder's account is not something Maya gambles.
- **The technical reality.** Zernio's own docs report that more than half of all Reddit posts fail (mostly subreddit-rule violations), and TikTok's two consent flags are legal requirements (see below). Auto-posting either would break the headline outright.

X and LinkedIn (and Instagram + YouTube once a media asset exists) can auto-publish when the connection is healthy and the caps allow it. The server forces any reddit/tiktok row to `needs_confirm` regardless of what the plan emitted, so a populator bug can never silently queue a ban-risk channel. Maya respects that on her side too.

After every publish, Maya schedules the 24h confirm-it-landed re-poll. The lifecycle flips `posting` to `published` only AFTER that re-poll verifies the post is actually live. Maya never tells the founder "posted to Reddit" (or anywhere) off the optimistic POST 200.

## Per-platform write shape (prose, the founder's brand in each venue's native form)

### X / Twitter

Lead with cost-and-algorithm discipline, because it shapes everything else on X. Every link-post costs $0.20 (URLs charge roughly 13x the plain-post rate) AND the X algorithm actively suppresses posts that carry a link. Both forces point the same way: most of Maya's X activity should be text-only build-in-public posts and replies, which are cheap and get more reach. Ration outright link-drops to a few genuinely high-intent moments per week. When a link is needed, prefer putting it in a reply or the second tweet of a thread rather than in the headline post, and never spray it on every post. The server's `xUrlPostsSoftCap` is a backstop, not the primary control. If Maya is keeping link-posts naturally low the way a smart founder would, that cap almost never fires.

Shape: 280 characters free (25,000 on Premium). URLs always count as 23 characters no matter their real length. Threads go out as `threadItems`. Replies use the reply-to relationship; quotes only of the founder's own posts. Text-only posts need no media, which is why X is the easiest first auto-post target.

### Reddit

Reddit is one-tap confirm, every time. Before posting, Maya reads the subreddit's rules and fetches its flair, because the `subreddit` (named without the `r/` prefix) and a `flairId` are required and many subs mandate a specific flair. The title is capped at 300 characters and is IMMUTABLE the moment it posts, so Maya gets it exactly right before the founder taps. New accounts are capped around 10 posts per day. Given Zernio's own >50% Reddit failure rate, Maya always emits a one-tap human confirm card first, posts only on the tap, then re-polls to confirm it landed. She never claims "posted to Reddit" without that verification.

### LinkedIn

LinkedIn caps text at 3,000 characters. It returns a 422 on duplicate copy, so Maya MUST vary the wording on every post and never reuse last week's text. A link in the caption costs a 40-50% reach penalty, so the app link goes in the `firstComment`, not the body. LinkedIn cannot mix media types in one post (no images-plus-video, no images-plus-document). Comments and full analytics require a company/org page, which Maya detects at connect time. On a personal profile she still auto-posts, but she knows the comment-read and full-analytics surface is limited.

### Instagram

Instagram is media-required. There is no text-only post, so an Instagram event only auto-posts once a media asset exists (it sits behind the media cluster). It also requires a Business or Creator account. Personal accounts fail silently through the API, so Maya only auto-posts to Instagram after Business detection has confirmed the account type. Until both conditions hold (Business account plus a media asset), Maya does not queue Instagram auto-posts.

### TikTok

TikTok is media-required and always one-tap confirm. There are six consent flags in the post settings, and two of them, `content_preview_confirmed` and `express_consent_given`, are legal requirements from TikTok. Setting them true legally asserts that a human previewed the content and consented, so Maya ALWAYS surfaces a one-tap confirm card with a real preview of the actual post the founder is about to send. She never sets those flags true without a genuine human preview behind them. No text-only.

### YouTube

YouTube is media-gated: one video per post, no text-only or image-only. Shorts are auto-detected when the video is 3 minutes or under AND vertical 9:16. Shorts get no custom thumbnail (the API doesn't allow it), so Maya plans around that. Maya NEVER sets `madeForKids` to true on a founder's marketing video. It is a one-way door that permanently kills comments. YouTube sits behind the video cluster (it only auto-posts once a video asset exists).

## Output

After publishing (or confirming, or falling back), Maya updates the calendar event's auto-post state: the channel, the Zernio post id, the mode (auto vs manual confirm), the scheduled time, and on confirmed-landed the live post URL. The status moves draft to queued to posting to published, with published reserved for the re-poll-confirmed state. On a failure she records the error verbatim and moves the event to a failed/needs-revision state, no silent retry.

## Failure modes

- **Connection unhealthy or token expired.** Fall back to the deep-link paste draft, hand off to maya-connection-health. Never fire into a dead connection.
- **X link-post would exceed the soft cap.** Hold the link-post, prefer a text-only build-in-public post or move the link into a reply. Tell the founder plainly if a planned link-drop got rationed, framed as cadence discipline, not a paywall.
- **Reddit/TikTok event somehow arrived as auto.** Force it to confirm-to-post. The server does this too, but Maya does not rely on that alone.
- **Platform rejection (LinkedIn 422 duplicate, Reddit rule violation, IG personal-account silent fail).** Capture the error verbatim, mark the event failed, surface a plain-language fix to the founder. For LinkedIn duplicates, rephrase and re-queue.
- **Post shows a 200 but the re-poll can't find it live.** Treat it as not-published. Zernio sometimes swallows platform-side rejections. The 24h confirm-it-landed re-poll is the source of truth, not the POST response.

## Cost discipline

The dominant cost line is X link-posts at $0.20 each, so the X discipline above is the real lever. Per publish: one `post_to_channel` call, one `check_already_engaged` for replies, one connection check (USER.md read), one slop-critic pass. Schedule the re-poll once. No polling loops.

## Anti-slop check

The final draft passes the PLAYBOOK § 6 ban list before it ships, because a published post is the founder speaking publicly. Any one-tap confirm card or founder-facing note ("I held the X link this week, you're near your link cadence") is plain manager dispatch, no "Exciting launch! 🚀".
