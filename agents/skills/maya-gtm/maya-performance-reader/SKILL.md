---
name: maya-performance-reader
description: Read Zernio post analytics + follower stats and fold them into attribution as the slower ground-truth, WITHOUT ever overriding the faster wrapped-link click signal. Encodes staleness windows and the uneven read coverage across the 6 offered channels (X, Reddit, LinkedIn, Instagram, TikTok, YouTube). Grounded-or-silent: stale or empty numbers get said plainly, never fabricated.
---

# maya-performance-reader

## Purpose

Maya now reads real post performance from Zernio, but the read layer is for confirmation, not for the same-day call. The wrapped-link click signal is fast and tells Maya within the day that something drove signups. Zernio analytics arrive slower (anywhere from an hour to a few days depending on the channel) and answer a different question: which CHANNEL and which FORMAT actually drove the reach behind those clicks. This skill folds the Zernio numbers in as the slower ground-truth, joined alongside the click signal, never replacing it. It also feeds best-time and posting-frequency learnings back into the cadence.

## When to invoke

- IF a post Maya published has crossed its analytics staleness window (see below) THEN read its performance and fold it into the post's results row.
- IF the weekly review or the results-reviewer is assembling "what worked" THEN pull the read layer for the period.
- IF follower-stats refresh is due (daily) THEN read follower growth for the connected channels.
- NEVER read inside a staleness window and present the numbers as final. An IG post read at 2 hours is not yet meaningful.

## Required reads

1. **APP.md, GTM.md** — the bet channels and what conversion means.
2. **TOOLS.md** — `get_account_analytics`, `get_follower_stats`, and the attribution tools. Go through the typed tools, never a raw Zernio endpoint.
3. **The post's results row** — to join the Zernio read against the wrapped-link click signal already recorded for that post.
4. **The wrapped-link attribution** — `get_my_attribution` (windowDays, untiedSignups, revenue). This is the primary signal Maya is confirming against, not overwriting.

## The hard rule — clicks are primary, Zernio is the slower ground-truth

Wrapped-link clicks (same-day, low-latency) stay Maya's PRIMARY attribution signal. They are what tells her, today, that a post moved someone toward signup. Zernio's per-post impressions, reach, and engagement are the slower ground-truth that says which channel and format produced the reach behind those clicks. Maya JOINS the two, she does not let one displace the other. If a post got few clicks but Zernio later shows it had real reach, that's a format/message problem worth noting, not a reason to rewrite the click attribution. If the Zernio read is stale or empty, Maya says so plainly and leans on the click signal. She never fabricates a number to fill the gap (grounded-or-silent).

## Staleness windows (how long before a read means anything)

These windows are how long Maya waits before treating a number as real:

- **Per-post analytics: roughly 60 minutes.** Most channels need about an hour before the post's impressions and engagement settle. A read inside that window is provisional.
- **Instagram: roughly 48 hours.** IG analytics cache up to two days. An IG post is not fully readable until then.
- **YouTube: 2 to 3 days.** The slowest channel by far. YouTube's daily-views and watch-time metrics lag two to three days, so YouTube is the last channel to confirm and the weakest near-term signal.
- **Follower stats: daily.** Follower counts and gained/lost series refresh on a daily cadence, so Maya reads them once a day, not per-post.

When Maya surfaces a number, she carries its freshness honestly: "your YouTube post is still settling, the real numbers land in a couple days" beats a confident figure that's about to move.

## Uneven coverage across the 6 offered channels

The read layer is deep on some channels and nearly empty on others. Maya weights what she reports accordingly and never implies a channel gives more than it does:

- **Instagram (deepest).** Account insights (reach, views, accounts-engaged, profile-link-taps), demographics, and follower history. Caveat: demographics need 100+ followers, and cold-start indie founders usually won't have them, so the richest surface is often empty for exactly the founders who'd most want it. Don't promise IG demographics Maya can't deliver.
- **YouTube (deep but slowest).** Per-post views/likes/comments/shares plus watch-time and channel insights, all on the 2-3 day delay. Strong once it arrives, weakest in the moment.
- **X (thin and metered).** Per-post impressions/likes/comments/shares/clicks exist but are shallow, and reads cost money. Pull them sparingly and treat them as a light confirmation, not a rich picture.
- **TikTok (account-stats only).** Follower counts and gained/lost series via account stats. Per-post likes/comments/shares exist but the deep FYP/watch-time metrics are not on the public API. TikTok tells Maya about the account, not much about the individual post.
- **Reddit (upvotes + comments only).** No impressions, no reach, no shares. Reddit attribution stays wrapped-link-only. Zernio adds almost nothing on the Reddit read side, so Maya doesn't pretend it does.
- **LinkedIn (own/org posts only).** LinkedIn returns metrics only for the authenticated user's own posts, and full analytics plus comment-reading need a company/org page. Reading a founder's pre-existing, manually-posted LinkedIn history largely FAILS without an org page, so Maya doesn't promise a backfill of their old posts.

## Feeding learnings back into cadence

Once a read is settled, Maya folds the durable lessons into the cadence: which channel converted best this period (tilt the deeper research/posting there), which format drove reach (favor it in upcoming drafts), and which posting time correlated with reach (snap the pulse windows toward it). These are channel-priority and format learnings, not same-day attribution rewrites. The click signal still owns the "what converted today" question.

## Output

Maya joins the settled Zernio read into the post's results row alongside the existing click signal (the read keys to the post Maya actually published). She records channel-level and format-level learnings where they belong, so the next plan is sharper. She never overwrites the wrapped-link attribution with a Zernio number.

## Failure modes

- **Read inside the staleness window.** Mark it provisional, don't present it as final, re-read after the window.
- **Zernio returns empty or errors.** Say so plainly, lean on the click signal, don't fabricate. Schedule a re-read.
- **Channel gives almost nothing (Reddit, thin X).** Don't manufacture depth. Report the click signal and the upvotes/comments Reddit does give, and stop there.
- **IG demographics empty (under 100 followers).** Expected for cold-start founders. Note it once, don't keep surfacing the gap.
- **LinkedIn historical read fails (no org page).** Explain it once at connect-adjacent time, scope reads to the founder's own go-forward posts.

## Cost discipline

X reads are metered, so Maya pulls them sparingly. Reads are batched per staleness window rather than polled, one `get_account_analytics` per due post and one daily `get_follower_stats` per connected channel. No tight polling loops. Most of the work is structured-output joining, low thinking.

## Anti-slop check

Any founder-facing summary of performance is plain manager language ("your Tuesday X thread drove the most clicks this week, the LinkedIn carousel got reach but few clicks"), never "engagement skyrocketed" or "the metrics are off the charts." Freshness caveats stay honest, no false precision.
