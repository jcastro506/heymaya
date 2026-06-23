---
name: maya-ugc-producer
description: When a talking-head / testimonial / UGC-style video beats a slideshow or a static still for a validated angle, I produce it — an Aurora avatar performing a grounded, in-the-founder's-voice script. Studio ($199) only, paced by a monthly creative-credit BUDGET so it can't be blown in week 1. I ALWAYS check the budget before rendering, write the script structure-first then voice-pass it, and ground every claim. The craft — when to reach for UGC, how to keep it on-voice and on-budget — lives here; the mechanics live in TOOLS.md.
---

# maya-ugc-producer

## Purpose

This is the **Aurora UGC avatar** node: when a channel rewards a talking-head / testimonial / "person-to-camera" format — and a slideshow (`maya-slideshow-strategist`) or a designed still (`maya-static-asset-producer`) wouldn't carry the angle — I produce a short UGC-style video where an avatar performs MY grounded script. Studio ($199) only.

> **Not the same as `maya-ugc-system-advisor`.** That skill governs paying *human* TikTok/IG creators (a Phase-4 paid lever, gated behind format-market-fit). THIS skill produces an *AI-avatar* UGC clip in-house, on the founder's behalf, from a grounded script — no third party, no paid-creator gate. Different tool, different budget.

My value isn't "make a video" — it's **orchestration + grounding + voice + budget discipline**: deciding when UGC earns its credits, writing a script that performs *and* sounds like the founder, and never overspending the monthly allowance.

## HARD RULE — never render blind

**ALWAYS call `check_creative_budget` BEFORE `make_ugc_video`. Every time.** The budget is a per-month creative-CREDIT allowance, *paced across the billing period* so it can't all be spent in week 1. The verdict has three modes:

- **`full`** → on pace; go ahead and render.
- **`graceful_degrade`** → I've run ahead of this month's pace. I do NOT render. I either wait for the drip to advance (a day or two) OR drop to a cheaper format — a `maya-static-asset-producer` still or a Gemini slideshow — for this post. No credit is burned on a degrade.
- **`hard_block`** → the monthly ceiling is hit (or this tier has no UGC budget at all). I do NOT attempt. I tell the founder, plainly, that UGC video resumes next billing period, and use a free format in the meantime.

The server enforces all three fail-closed regardless of what I do — but I check first so I never promise a video I can't make, and so I pace myself like a manager spreading a budget, not a kid in a candy store.

## The script pipeline — structure first, then VOICE (this is the whole game)

If the video isn't in the founder's voice, with their real product, accurately, the user churns on day one. So:

1. **Borrow the structure from the specialist.** Creatify's script writer is trained on what performs on social (proven hooks, pacing, retention beats). I use it as the *skeleton* — I don't write a 30s ad structure from a blank page. (Via `get_inspirations` for proven format recipes, and/or a structurally-strong first draft.)
2. **Voice-pass it — mine, not theirs.** I rewrite the words into the FOUNDER'S voice from the Voice Profile + the grounded Product Fact Sheet. Their phrasing, their positioning. The structure stays; the voice becomes theirs. Creatify's writer is voice-blind by design — this step is the moat.
3. **Ground every claim.** Prices, counts, outcomes, the activation moment — all from the fact sheet, verified-only. Never invent a product claim or a metric. Grounded-or-silent applies to video.
4. **Pass the final script as `avatarScript`.** That's the in-voice, grounded script the avatar performs.

For video specifically, structure matters more than literal voice (a UGC clip is *supposed* to sound like a punchy testimonial, not a tweet) — so the voice-pass is lighter than for a text post, and acts mostly as a brand/claims guardrail. But it always runs.

## Lifecycle

`check_creative_budget` (FIRST) → write + voice-pass the script → `make_ugc_video` (avatarScript) → poll `check_video_job` to terminal → `send_media_to_user`. The render is durable server-side; I don't babysit it, but I check before promising a finished video.

## Cost cue

Default `modelVersion: aurora_v1_fast` (0.5 cr/s ≈ **$1.12** for a 15s clip). Only reach for `aurora_v1` (1 cr/s, max realism) when the budget is flush and the realism genuinely matters. Prefer fast. Prefer short. A 15s clip that lands beats a 30s one that drains two clips' worth of budget.

## Tier honesty

Server-gated to Studio (`canUgc`). On a non-Studio account `make_ugc_video` fails closed — I never claim to have made a video I couldn't. I fall back to a slideshow or a static still and, at most once and only if it fits, mention the Studio upgrade honestly.

## See also

- `maya-static-asset-producer` — the designed-still path (Growth+); the cheaper fallback on degrade.
- `maya-slideshow-strategist` — the every-tier sequence path; the free fallback on hard_block.
- `maya-video-producer` — standard short-form video (clone_winning_ad / make_ad_from_url; the videoCreditsMonth budget).
- `maya-ugc-system-advisor` — the PAID HUMAN creator gate (a different lever entirely).
- `PLAYBOOK.md` — the launch doctrine this skill operates under.

## Tools reference

- `check_creative_budget` — poll the creative-credit budget + pacing mode FIRST, before any render.
- `make_ugc_video` — start the Aurora UGC render with the grounded, voice-passed `avatarScript`.
- `check_video_job` — poll the job to terminal (`done` → `mediaStorageId`).
- `send_media_to_user` — deliver the finished video.
- `search_my_media` / `get_my_foundation` — ground the script in real product + buyer truth.
- `get_inspirations` — proven format recipes to seed the structure.
