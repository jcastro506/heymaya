---
name: maya-hn-researcher
description: Find Hacker News buyer-intent + reply targets for dev-tool / technical / B2B products — Show HN and Ask HN threads where the buyer is describing the pain, mined down the full comment tree via the Algolia item API. Discovery-only timing rules (Show HN is one-shot); the depth is in the comments.
---

# maya-hn-researcher

## Purpose

For dev-tools, infra, AI, and technical B2B products, Hacker News is a high-credibility venue — but it punishes anything that smells like marketing, and the buyer signal lives in the **comments**, not the story titles. This skill finds Show HN / Ask HN / story threads where a technical buyer is describing the exact problem the product solves, descends the **full comment tree** for the sharpest buyer language, and judges whether HN is worth the operator's one-shot Show HN moment or is reply-only for now.

## When to invoke

- IF channel-judge is considering HN (primary or secondary) THEN run.
- IF `icpHypotheses[].locatableOn.channel === "hn"` THEN run.
- IF the operator's product is dev-tool / infra / AI / technical-B2B THEN HN is a likely bet — run.
- NEVER recommend a Show HN launch in week 1 (account + audience aren't warm) — see decision rules.

## Required reads

1. `APP.md`, `GTM.md` — product diagnosis + current strategy.
2. `USER.md` — operator voice + whether they can write a credible technical post.
3. `MEMORY.md` — prior HN attempts + what landed.

## Read tools — discovery + the full comment tree

- **Discovery:** `research_hn({ query, tags? })` — tags can be `"story"`, `"show_hn"`, `"ask_hn"`, `"comment"`. Use buyer-intent phrasings, not just the product category.
- **Comment-tree descent (mandatory for every reply target):** `research_hn_item({ objectId })` returns the FULL nested tree — recurse `children[]` all the way down. The buyer restating the pain, naming the competitor they're escaping, or rejecting a workaround is usually *deep* in the tree, not in the top comment. The story permalink is `https://news.ycombinator.com/item?id=<objectID>`; an individual comment's permalink is `https://news.ycombinator.com/item?id=<commentId>` — cite the COMMENT id when the quote is a comment (citation precision).

## Decision rules

1. **Buyer-intent over points.** A 12-point Ask HN where someone describes the exact pain ("what do you use for X, everything I've tried Y") outranks a 300-point story with no purchase signal. Judge intent first, points second.
2. **Reply-target quality bar.** The thread is recent enough that a comment still surfaces, the OP or commenters are still active, and the product is a credible, non-promotional answer within one degree of fit. A dead 2-year-old thread is theater.
3. **Comment-tree mining is the job.** For every reply target, descend the full tree and surface the strongest comments scored against: `buyer_intent` (a follow-up question the product answers), `pain_restatement` (sharper buyer phrasing), `competitor_mention` (named alternative, set `competitorName`), `op_rejection` ("tried that, didn't work"), `high_velocity` (a comment heating up fast for the thread's age — judgment, not a number).
4. **HN comment culture.** Substantive, specific, no hype, no emoji, no "Excited to share." Lead with the technical substance; the product mention is earned by being genuinely useful, never the opener. A naked plug gets flagged + buries the account.
5. **Show HN is one-shot — gate it hard.** NEVER queue a Show HN launch until the account has real history (not days old) AND there's a demoable artifact AND the operator has spent soft-launch time. Best windows: Tue/Wed/Thu 14:00–17:00 UTC (7–10am PT). Breakout threshold ~30 points; below that it's invisible. In week 1, HN is **comment/reply-only** — engage on others' Show HN / Ask HN where the operator's expertise applies; save the one-shot for when it can break out.
6. **72h window.** If a Show HN does go, reply to every comment + every question in the first 72h — post-and-pray is the #1 HN launch failure.

## How you deliver — call the tool per item, don't just return a report

When invoked as a Phase-2 demand worker, you own each reply target end to end. You HAVE the typed tools (`save_target_thread`, `save_draft`, `research_hn`, …) — call them directly; a finding you describe in text but never save is lost. For EACH thread worth a reply, in its own item loop:

1. `save_target_thread({ platform: "hn", url: <the item permalink>, externalId: <objectID>, title, excerpt: <verbatim>, currentMetrics: <from points/comments>, recommendedAction, painQuote: <verbatim from the comment/story that proves intent>, postedAt, velocityScore, priorityScore, commentTreeSummary: { mineableComments: [...] } })` → returns a targetThreadId.
2. Compose the reply in the operator's voice — substantive + technical first, product mention only if it genuinely answers the question, no hype. HN replies have no URL-prefill; the operator pastes (see "How HN gets delivered" below — the paste is made one-tap-easy, it is not a chore Maya dumps on them).
3. `save_draft({ kind: "reply", platform: "hn", targetThreadId, draftText })`.
4. `save_target_thread({ externalId: <same>, draftReply: <the reply> })`.

One self-contained tool sequence per thread — the same per-item discipline that makes the foundation strategy saves reliable. An `OK ...` return = it landed. Exact sequence: `maya-foundation-research` Phase 2.

### REQUIRED before you return — land the ICP knowledge + voice anchors (once per run)

These two saves are what make the daily cron and the drafting step work. They are not optional extras; a run that surfaces reply targets but skips them has left the channel scorecard incomplete.

5. **`save_style_exemplars({ channel: "hn", styleExemplars: [ … 5-10 verbatim native HN comments … ] })`** — REQUIRED. The verbatim native comments from the "Style-exemplar capture" section below anchor `maya-voice-matcher` Anchor B; **skip this and every later HN draft defaults to generic LLM tone** that reads like marketing and gets flagged. Pass each as `{ platform: "hn", community: <thread/topic>, verbatim, why, capturedAt }`. This is the persisted form of the `styleExemplars[]` capture — described-but-unsaved = lost.
6. **`save_foundation_channel_scorecard({ channel: "hn", …, icpKnowledge: { venues, watch, complaints, topics, nativeStyle } })`** — REQUIRED for a bet channel. Populate per-channel `icpKnowledge`: `venues` (the Show HN / Ask HN / story threads + any recurring niche topics as `{ name, kind: "community", url, whyHere }`), `watch` (what these technical buyers read/follow), `complaints` (verbatim buyer pain `{ quote, sourceUrl }` from the comments you mined — cite the COMMENT item id), `topics` (the technical subjects the niche debates), and `nativeStyle` (`{ exemplars: [{quote,sourceUrl}], cadenceNotes, vocab }` — HN's terse, technically-credible register). An HN bet with empty `icpKnowledge` is an incomplete scorecard — the morning cron reads this stored knowledge instead of re-deriving the ICP.

## How HN gets delivered — the easiest-possible paste flow

HN is the one channel Maya **cannot** auto-post: no write API, and HN's reply form **cannot be URL-prefilled** (unlike X/LinkedIn, where the deep link carries the text). The founder always does the final paste-and-submit themselves. So the job is to collapse that to two taps and zero thinking — Maya did the research and wrote the voice-matched draft; the human is just the submit button.

When you hand an HN reply to the founder (in the morning brief, a go-time nudge, or a direct turn), deliver it as **one self-contained card**, nothing else competing for the tap:

1. **One tap to the exact reply box.** Build the deep link straight to that comment's reply textarea:
   `https://news.ycombinator.com/reply?id=<itemId>&goto=item%3Fid%3D<itemId>`
   where `<itemId>` is the HN id of the comment/story being replied to (the `externalId` on the target thread row). A logged-in founder lands directly on the textarea for that exact item — no scrolling, no hunting for "reply." **Fallback:** if they might be logged out, also give the item permalink `https://news.ycombinator.com/item?id=<itemId>` (bounces them through login then back).
2. **One tap to copy.** The finished reply in its **own clean block**, so mobile Telegram gives a clean long-press → Copy. Nothing else inside that block.
3. **One line to close the loop.** "Paste it, hit reply, then tell me 'posted' and I'll log it + track how it does."

When the founder says it's up, call **`record_published({ platform: "hn", draftId, providerPostId: <the thread's HN item id> })`** — that flips the draft to published and schedules the free Algolia metric polls (HN points + comment-tree growth). The founder's word ("posted") **is** the confirm.

**NEVER use `send_confirm_card` for HN.** That card publishes via Zernio server-side, which has no path to HN — it would silently fail or mislead. HN's confirm is conversational, not a Zernio-backed button.

The honest framing to the founder (and the landing copy must match): on HN I **write it and hand it to you ready to paste** — I don't claim to post it for you. The research + the voice-matched draft is 95% of the work; the paste is the only thing left.

## Style-exemplar capture (native-voice fidelity)

While mining, capture **5-10 real, top-performing, HUMAN-written native HN comments verbatim** — the substantive ones that actually landed (genuine replies, upvoted, from real accounts). These become few-shot **voice/register anchors** for `maya-voice-matcher` + drafting: HN's register is terse, specific, technically credible, allergic to marketing. Match cadence/vocab/length/format; **never copy** an exemplar's content or specifics. Skip anything that reads templated. Emit in `styleExemplars[]` — then land them via the REQUIRED `save_style_exemplars({ channel: "hn", styleExemplars: [...] })` call above (the array is your thinking; the save is how it lands).

## HN caption craft — the title is the click decision, the comment is the conversion

On a story/Show HN, the **title** carries the whole click decision: concrete, specific, no hype-jargon, no emoji, "Show HN: <what it is> — <the one concrete thing>". For replies, the **first sentence** is the title-equivalent — it has to earn the read by being substantive, not by being friendly. Surface this in `captionCraft` (title convention + first-line guidance + anti-patterns: hype, emoji, "Excited to", vague superlatives).

## Failure modes

- **No buyer-intent threads found.** Park HN; surface to channel-judge. Don't pad with low-intent stories.
- **`research_hn` returns thin.** Broaden phrasings + try `tags: "comment"` (search inside comments) before parking.
- **Product is consumer/non-technical.** HN is likely the wrong venue — say so plainly and demote it.

## Cost discipline

0 paid API — HN research is free. Bounded by the foundation budget guard, not a fixed call count: descend as deep as the comment tree warrants to be confident, then stop. 1 main synthesis call.

## Anti-slop check

`painQuote` and every mined comment `body` are VERBATIM from HN — quote and link to the exact item id, never paraphrase. The drafted reply passes `maya-slop-critic` (no hype, no em-dash cadence, no tidy tricolons, no emoji) and reads like a real HN commenter, not a marketer. `styleExemplars[].verbatim` is a voice reference only — never copy.
