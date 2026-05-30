---
name: maya-linkedin-researcher
description: For B2B / prosumer products where the buyer is a professional, find LinkedIn reply targets + engagement opportunities — posts where the buyer is describing the pain, mined for comment-level buyer intent. Runs AFTER maya-linkedin-fit-researcher clears LinkedIn as a bet; this is the research worker, not the fit gate.
---

# maya-linkedin-researcher

## Purpose

`maya-linkedin-fit-researcher` decides WHETHER LinkedIn is worth the operator's time (it parks LinkedIn for most consumer/indie-dev products). When it clears LinkedIn as a bet — B2B SaaS, prosumer, sales/ops/marketing tooling, founder-audience products — THIS skill does the actual research: finds posts + threads where the professional buyer is describing the pain, mines the comments for buyer intent, and proposes reply + engagement targets. It does NOT re-litigate fit; that gate already passed.

## When to invoke

- IF `maya-linkedin-fit-researcher` returned `fit: "go"` (or secondary) THEN run.
- IF `gtmChannelScorecard` marks LinkedIn `bet: true` THEN run in the Phase-2 discovery sweep.
- NEVER run for a product the fit-researcher parked (consumer/lifestyle/non-professional buyer) — that's wasted spend.

## Required reads

1. `APP.md`, `GTM.md` — product + strategy.
2. `USER.md` — operator voice + whether they'll post in a professional register.
3. The fit-researcher's output (why LinkedIn cleared, which buyer segment).
4. `MEMORY.md` — prior LinkedIn attempts.

## API — posts + comments (ScrapeCreators, `x-api-key: $SCRAPECREATORS_API_KEY`)

- **Company/person posts:** `/v1/linkedin/company/posts` (company feed), `/v1/linkedin/profile` + the person-post endpoints in the `scrapecreators-api` skill tables.
- **Comments are where the buyer intent is** — pull post comments and mine them the same way the Reddit/HN workers mine comment trees. A professional asking "how are you all handling X?" under a relevant post is a higher-intent reply target than the OP.
- Discovery on LinkedIn is thinner than Reddit/X (no open keyword search across all posts) — so lean on: the fit-researcher's named target accounts/companies, the operator's own network/feed, and posts by the trusted voices in the buyer map. Quality over volume; LinkedIn rewards a few real engagements far more than spray.

## Decision rules

1. **Reply-target quality bar.** A post where the professional buyer describes the pain or asks for recommendations, recent enough to still surface, where the operator's product is a credible + non-salesy answer. Skip thought-leadership posts with no purchase signal.
2. **Buyer-intent over reach.** A 40-like post with a buyer asking "what do you use for X" beats a 2,000-like viral post with no intent.
3. **Three-beat reply.** Validate their specific situation → add genuine value (a real insight, not a pitch) → soft mention only if it fits, with the **link in the first comment, not the post body** (LinkedIn suppresses outbound-link posts). Product mention in the opener = regenerate.
4. **Professional register.** LinkedIn voice is plain, specific, credible — NOT hype, NOT emoji-spam, NOT "🚀 thrilled to announce". Founder build-in-public about the actual process outperforms polished brag posts (~3.4x). Text-only often outperforms image; native PDF carousels get strong dwell.
5. **Cadence (when it's also a posting channel):** 3 posts/week is the ceiling of useful (diminishing returns past 5); Tue–Thu 7–8:30am local windows; reply to every comment in the first hour. Surface posting cadence only if LinkedIn is a posting bet, not just a reply venue.

## How you deliver — POST per item, don't just return a report

When invoked as a Phase-2 demand worker, you own each reply target end to end. **"POST" = run a curl via your `exec` tool** (`curl -sS -X POST -H "Authorization: Bearer $HOOK_TOKEN" -H "Content-Type: application/json" -d '{...}' "$CONVEX_SITE_URL/lc_gtm/<endpoint>"` — token + URL are in your shell env). You HAVE `exec` — the ~7 tools removed at startup are spawn/lifecycle tools, not your shell; you CAN curl. Returning "POST-ready data" as text = the work is lost; you run the curl yourself. For EACH post worth engaging, in its own item loop:

1. POST `/lc_gtm/target_thread` (platform="linkedin", url=post permalink, externalId=post id, excerpt verbatim, currentMetrics, recommendedAction, `painQuote` verbatim, priorityScore, `commentTreeSummary.mineableComments[]` from the comments).
2. Compose the three-beat reply in the operator's professional voice (URL → first comment, not the reply body).
3. POST `/lc_gtm/drafted_content` (kind="reply", platform="linkedin", targetThreadId, draftText).
4. Re-POST `/lc_gtm/target_thread` (same externalId) with `draftReply` set.

One self-contained POST sequence per item. Exact sequence: `maya-foundation-research` Phase 2.

## Style-exemplar capture (native-voice fidelity)

Capture **5-10 real, top-performing, HUMAN-written native LinkedIn posts/comments verbatim** from the buyer's professional niche — the founder build-in-public + genuine-insight ones that landed (real engagement, real accounts). These anchor `maya-voice-matcher` + drafting: LinkedIn's register is professional-but-human, specific, no hype. Match cadence/vocab/length/format; **never copy** content. Skip anything that reads templated/AI/corporate. Emit in `styleExemplars[]`.

## LinkedIn caption craft — hook above the fold, link in first comment

The first ~2 lines show before "see more" — they carry the whole open decision: concrete + specific, a real stake or number, no hype-emoji cluster. The **link goes in the first comment**, never the post body (outbound-link posts get throttled). Surface this in `captionCraft` (hook convention + the first-comment link rule + anti-patterns: "thrilled/excited to announce", emoji clusters, engagement-bait "agree? 👇").

## Failure modes

- **Fit-researcher parked LinkedIn.** Don't run — return immediately, note it's parked.
- **Discovery too thin (no open search).** Lean on named target accounts + the operator's feed; if there's genuinely no buyer signal, surface that to channel-judge rather than padding.
- **Only thought-leadership, no buyer intent.** Demote to relationship-building cadence (engage to build presence), not reply-mining for conversion.

## Cost discipline

ScrapeCreators LinkedIn calls bounded by the foundation budget guard. LinkedIn is quality-over-volume — a handful of real engagements beats a wide shallow sweep. 1 main synthesis call.

## Anti-slop check

`painQuote` + mined comment bodies are VERBATIM with exact post/comment URLs (citation precision). The drafted reply passes `maya-slop-critic` and reads like a credible professional peer, not a salesperson. The soft mention is a door left open, not a pitch. `styleExemplars[].verbatim` is a voice reference only — never copy.
