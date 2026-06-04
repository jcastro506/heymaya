---
name: maya-instagram-researcher
description: Find where this product's buyers already live on Instagram and what they actually watch RIGHT NOW. Mine Reels + comments for buyer language, watch representative Reels multimodally for native register, and judge whether IG earns a bet. Instagram is the strongest mobile-app-wedge discovery surface. Judgment-only, signups-not-likes, Brief-only (no UGC creation).
---

# maya-instagram-researcher

## Purpose

Instagram is a first-class, equal-depth research channel — NOT a thin reuse lane off TikTok. For a mobile app it is often **the** discovery surface: Reels reach + a native "save / send to a friend / link-in-bio app" install motion, and the audience skews to exactly the consumer-mobile buyer the wedge targets. This skill finds where this product's buyers already are on IG, in their own words, judges whether IG is worth a slot, and captures the native register so later Briefs read like a real account in this niche.

Like TikTok, IG rewards **format-remix, not content-copy**. The job is buyer-pull: Reels + comments that produce "where do I get this", "does it do X", "finally", "sending this to my whole group" from people who look like the target buyer. Raw views/likes are vanity; **saves + sends + buyer-language in comments** are the convert signal. A Reel that goes viral but pulls the wrong audience is actively harmful.

Grounded in ScrapeCreators (the read layer) + `review_media` (multimodal watch) + PLAYBOOK.md (the launch doctrine). Judgment, not lookup tables. **Brief-only** — Maya hands the founder a Brief (Reel hook + beats + caption + hashtag set), we never film.

## When to invoke

- During the foundation pass when Instagram is a candidate channel (consumer/mobile-app wedge, visual or demo-able product, or the ICP lives on IG).
- IF the channel-strategy judge is weighing Instagram and `formatConfidence`/buyer-presence is unknown THEN run.
- IF `gtmChannelScorecard` marks Instagram `bet: true` THEN run the deep discovery sweep + populate its `icpKnowledge`.
- Monthly refresh, or when results-reviewer detects the operator's current IG format underperforming.
- NEVER from heartbeat; this is a ScrapeCreators- + review_media-intensive skill (cap ~12 scrape calls).

## Required reads

1. `APP.md`, `GTM.md` — product + strategy (is the wedge mobile? is there a visual demo?).
2. `USER.md` — the operator's own IG voice + whether they'll appear on camera.
3. `PLAYBOOK.md` § 3 step 1-3, § 7.
4. `PLATFORM_ALGO.md` — current IG/Reels algorithm state before any format/CTA call.
5. `MEMORY.md` — prior IG attempts.

## Read tools — Reels + comments (via `scrape_creators`, never raw instagram.com)

All public-data, via `scrape_creators({ path: "/v2/instagram/...", query: { ... } })`:

- **Reels discovery:** `scrape_creators({ path: "/v2/instagram/reels/search", query: { query: <keyword>, ... } })` — the primary discovery path. Pull the top batch per candidate keyword; this maps who's already making Reels for this niche and which formats are landing.
- **Comment mining (where the buyer intent lives):** `scrape_creators({ path: "/v2/instagram/post/comments", query: { ... } })` — for the top confirming Reels, descend the comments the same way the Reddit/HN workers mine comment trees. A comment "is there an app that does X" under a relevant Reel is a higher-intent target than the post itself.
- **Account + venue mapping:** profile + hashtag paths in the `scrapecreators-api` skill tables — map the big niche accounts (reach), the small high-intent ones (warmer audience), and the hashtags the niche actually uses.
- Use the operator's own handle (from `USER.md`) to read their existing IG presence + their followers' comments for warm-audience signal.

## Multimodal watch — `review_media` the representative Reels

For 3-5 of the strongest confirming Reels in the candidate format, **watch them** with `review_media({ url: <reel video url> })` — do NOT judge IG video from captions + metrics alone. The watch is how you read what a caption can't: the on-screen-text hook, the pacing/first-second hook, whether it's faceless-screen-record vs founder-on-camera vs photo-carousel, the visual rhythm, and the actual spoken/written register. This multimodal read is what makes the native-style capture honest instead of guessed.

## Decision rules (judgment, deep — not "top 5")

1. **Venue spread (ranked, big→long-tail).** Not one account — a map: big niche accounts (reach) + small high-intent ones (less competition, warmer) + the hashtags + the recurring Reel formats. Be present across the spread.
2. **Format recurrence.** A format is "winning" when it clearly recurs across a meaningful share of the strongest recent Reels from **independent** creators — same hook structure, visual rhythm, CTA pattern playing out across multiple accounts. One viral outlier is noise; convergent behavior across creators is signal.
3. **Saves/sends + buyer-language over raw views.** Prefer Reels showing share/save momentum and buyer-language comments over a single view spike. A 5k-view Reel full of "where can I get this" beats a 2M-view one with none. Views are a soft proxy — say so.
4. **Format taxonomy.** Tag each watched Reel: `faceless_screen_record`, `founder_talking_head`, `photo_carousel`, `mixed`. Aggregate.
5. **Hook taxonomy.** Tag each hook (pattern-interrupt, outcome-promise, question, demo-cold-open, pain-validation, proof-first, POV, contrarian, before/after, comment-bait). The first ~1s / on-screen-text hook does the work.
6. **Recency + drift judgment.** Prefer recent Reels — IG/Reels algorithm drift is real. How recent "recent enough" is depends on niche velocity; use judgment, don't mechanically discard by date.
7. **Diversity check.** If the top results are dominated by 1-2 accounts, flag high creator-concentration — remixing one prolific account is riskier than a format the niche has converged on.
8. **CTA pattern.** IG's native motion: **profile → link-in-bio / app link**, "comment KEYWORD for the link", "save this", "send to a friend". Surface what actually runs in this niche. Refuse a bare "link in bio" recommendation with no hook to drive the profile tap.
9. **No recommendation without clear evidence.** If no format shows clear recurrence across independent creators, set `confidence: insufficient_evidence` and recommend channel-judge demote IG. Do not force a recommendation from thin data.
10. **Honest framing.** There's no IG AI-detector; the penalty for generic Reels + voiceless captions is engagement starvation — the algorithm simply doesn't push them. Match the niche's native register or get buried.

## How you deliver — call the tool per item, don't just return a report

When invoked as a Phase-2 demand worker you own each finding end to end. You HAVE the typed tools (`save_target_thread`, `save_draft`, `scrape_creators`, `review_media`, `save_foundation_channel_scorecard`, `save_style_exemplars`) — call them directly; a finding you describe in text but never save is **lost** (this is the recurring empty-DB failure). For EACH Reel/comment worth engaging, in its own item loop:

1. `save_target_thread({ platform: "instagram", url: <reel/post permalink>, externalId: <post id>, excerpt: <verbatim>, author, whyItFits, recommendedAction, priorityScore, currentMetrics: { views, likes, comments } })`.
2. Compose the operator-voice reply/comment (or the Brief beats for a Reel they'd film) — native register, not a pitch; the install link goes via the profile/bio motion, not a raw URL dumped in a comment.
3. `save_draft({ kind: "comment" | "reply" | "post", platform: "instagram", targetThreadId, draftText })`.

One self-contained tool sequence per item — an `OK ...` return = it landed. Mirrors `maya-foundation-research` Phase 2.

## Save the channel scorecard — `icpKnowledge` is mandatory for a bet

If IG earns a bet, call `save_foundation_channel_scorecard({ channel: "instagram", uniqueUnlock, bet: true, icpKnowledge: {...} })`. **A bet channel with empty `icpKnowledge` is an incomplete scorecard** — the daily morning cron reads this every 7am to build TODAY's IG events, so a thin save means the research decays after onboarding instead of paying off daily. Populate `icpKnowledge` from the real mined data:

- `venues: [{ name, kind: "account" | "hashtag" | "community", url?, whyHere }]` — WHERE the ICP lives on IG: the niche accounts they follow + the hashtags they browse, each with why.
- `watch: string[]` — what this ICP actually watches on IG (the Reel formats / topics that hold them).
- `complaints: [{ quote, sourceUrl }]` — verbatim pain from the comments, with the exact comment/Reel URL.
- `topics: string[]` — the recurring topics/angles the niche engages with.
- `nativeStyle: { exemplars: [{ quote, sourceUrl }], cadenceNotes, vocab: string[] }` — how a real account in this niche actually phrases a hook/caption.

## Style-exemplar capture (native-voice fidelity)

From the confirming Reels in the winning format, capture **5-10 real, top-performing, HUMAN native examples verbatim** — the on-screen-text hook line, the real caption, and the hashtag set — from real creators in this niche (not ads, not one dominant account). These are the few-shot **voice/register anchors** for `maya-voice-matcher` (Anchor B) + caption drafting: they encode how a real creator in *this niche* opens a Reel, how casual/punchy the caption runs, which hashtags actually fire here. Persist them:

- `save_style_exemplars({ channel: "instagram", styleExemplars: [{ platform: "instagram", community, verbatim, why, capturedAt }] })` — the verbatim hook+caption anchors that stop drafts defaulting to generic LLM-tone.

Match cadence/length/format/hashtag-shape; **never copy content.** Skip anything that reads templated/AI/influencer-bait.

## Instagram caption craft — story-shaped hook + clear CTA

Encode this niche's IG conventions in `captionCraft`, drawn from the captured exemplars (not generic advice):

- **Hook:** the first line + the on-screen-text hook carry the open — pattern-interrupt or outcome-promise, never "Hey guys".
- **Caption:** short and **story-shaped** (the IG convention) — a beat of context, then one clear CTA.
- **Hashtags:** the niche's native count + shape (broad + niche + intent), not a wall.
- **CTA:** the IG-native motion — "comment KEYWORD", "save this", "send to a friend", profile → link-in-bio for the app. Refuse "link in bio" with no hook driving the profile tap.
- **Anti-patterns:** "Hey guys", hashtag walls, "follow for more" early, "link in bio" as the whole CTA, AI-flat captions.

## Failure modes

- **Niche has no English-language IG/Reels activity.** `confidence: insufficient_evidence`. Recommend channel-judge demote IG.
- **`/v2/instagram/reels/search` returns zero results.** Check param shape; try adjacent keywords + hashtag paths before concluding empty. If still empty, request operator-narrowed keywords.
- **All top Reels are paid ads / one dominant account.** Flag it — remix risky (you'd be copying one person, not a format the niche converged on). Try a broader keyword.
- **Product isn't visual / wedge isn't mobile.** IG may genuinely not be the channel — say so honestly and park it rather than forcing it.

## Cost discipline

Max ~12 ScrapeCreators calls: 3-5 keywords × `/v2/instagram/reels/search` + 2-3 comment pulls (`/v2/instagram/post/comments`) + 1-2 profile/hashtag maps. Plus 3-5 `review_media` watches of the representative Reels. 1 main synthesis call. Timeout ~20 min. No heartbeat spend.

## Anti-slop check

`save_foundation_channel_scorecard.icpKnowledge.complaints[].quote`, every mined comment, and every `styleExemplars[].verbatim` are **VERBATIM** with the exact Reel/comment `sourceUrl` (citation precision) — do not paraphrase. The `review_media` watch backs the format/hook calls so they're observed, not guessed. Exemplars are voice/register references only — downstream Brief/caption drafting matches their cadence/length/hashtag-shape but NEVER copies an exemplar's content. The drafted comment passes `maya-slop-critic` and reads like a native member of the niche, not a marketer. Drop any exemplar whose caption itself reads templated/AI.
