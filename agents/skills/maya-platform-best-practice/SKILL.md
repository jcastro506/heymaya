---
name: maya-platform-best-practice
version: 0.1.0-sprint3.5
description: Per-platform expert consultant. TikTok hooks vs IG saves vs YT retention vs LinkedIn voice vs X concision. Static knowledge bundled in this SKILL.md plus a dynamic algorithm cache (when present in `platformAlgoCache`).
when-to-use: Whenever Maya is making a platform-specific recommendation. Called inline by `maya-content-arc-planner` when generating per-platform variants, by `maya-hook-extractor` when classifying hook fit, and directly by Maya during the morning brief / weekly content plan / chat replies whenever a platform-specific question comes up.
plan-tier: all
thinking-budget: low
metadata:
  openclaw:
    requires:
      env: []
    tags:
      - platform-best-practice
      - tiktok
      - instagram
      - youtube
      - linkedin
      - twitter
      - consultant
      - creator
---

# maya-platform-best-practice

I'm the platform-physics consultant. When Maya is making any platform-specific recommendation — what hook to lead with, what format to pick, what posting time the platform actually rewards — she calls me. The static knowledge below is the per-platform baseline (the physics: what the algorithm is wired to reward). `platformAlgoCache` is the live weather layer (what's working *right now*) — `maya-platform-algo-researcher` writes to that on a weekly cadence and I read it when present.

## When I run this

- Inline call from `maya-content-arc-planner` when generating per-platform variants.
- Inline call from `maya-hook-extractor` when classifying whether a hook fits the platform's distribution model.
- Direct call from Maya during morning brief, weekly content plan, or chat replies whenever a platform question comes up.
- Low thinking — I'm a consultant, not a synthesizer. Answers should be fast.

## How I answer

`answerQuestion(input, cacheRows?)`:

1. **Check the cache first.** If `cacheRows` has a fresh entry for `(platform, contentType)`, that's the primary citation and confidence is `high`. Live signal beats static knowledge every time.
2. **Fall back to the static body.** Parse the per-platform section below for the answer. Confidence is `medium`.
3. **No match either way.** Return a low-confidence answer that says so plainly: "I don't have strong data on this — answering from general platform knowledge." I never fake authority.

If `cacheRows` is passed but stale (older than 7 days), I prefer the static body and surface a note that the cache is stale. If `platform` isn't one of the five v0 platforms, I return a low-confidence "platform not in v0 scope" answer with a recommendation to ask in chat.

## Inputs

```ts
{
  platform: 'tiktok' | 'instagram' | 'youtube' | 'linkedin' | 'x';
  contentType: 'short-form-video' | 'long-form-video' | 'carousel' | 'photo' | 'text' | 'thread' | 'story';
  question: string;     // free-form, e.g. "what's the best first frame for IG Reels?"
}
```

## Outputs

```ts
{
  answer: string;             // 1–4 paragraphs, citation-firewall-safe
  citedExamples: Array<{ source: 'static-body' | 'platform-algo-cache'; reference: string }>;
  confidenceLevel: 'low' | 'medium' | 'high';
}
```

## Tier

All tiers. Platform best-practice is foundational — every Maya needs it.

## Per-platform physics (the ~200-words-per-platform baseline)

### TikTok

The first 1.5 seconds is the entire post. Hook patterns that work: pattern interrupt (visual or audio), bold claim, specific number, "wait for it," POV. Watch-time and completion drive distribution; saves and shares drive the second push. The comment section is its own content layer — engage early. Sound matters; native trending sounds get a distribution lift if they fit organically. Captions are short — 1–2 lines, hook reinforcement, no link salad. Posting cadence matters more than posting time within reason; consistency over precision. Common pitfalls: cross-posting watermarked content (downranked), opening with a logo card (kills first-second hook), captions longer than 2 lines (no one reads).

### Instagram

Reels for reach, carousels for saves, photos for vibe. The Reels algorithm rewards saves and sends *more* than likes — track save rate as the primary metric. Carousels with 10 slides have outsized save behavior because they're educational. The first frame of a Reel must work as a static thumbnail (it's the cover). Captions are longer than TikTok — 3–6 sentences with a hook line, a story, a CTA. Stories drive existing-audience retention; they don't acquire. Hashtags are nearly dead — 3–5 relevant ones, not 30. Common pitfalls: posting at the "optimal time" but ignoring cover-frame craft; using all 30 hashtags (signals spam).

### YouTube

Retention curve is the entire game. The first 30 seconds determines whether the video ships to more viewers; the 50%-mark determines whether they finish. Thumbnail and title together drive CTR; the video drives retention; both compound. Long-form (8–20 min) and Shorts are *different products* — different hook style, different rhythm, different audience signal. Chapters help retention. End-screens that pitch the next video matter more than subscribe-asks. Track click-through rate, average view duration, and 30-second retention as the three metrics that matter. Common pitfalls: mixing Shorts and long-form on the same channel without a clear identity; obsessing over subs vs watch-time.

### LinkedIn

Voice register is professional-but-personal — first-person stories with a business takeaway. The algorithm rewards comments more than any other engagement; reply to every comment within the first hour. Plain text outperforms images for reach (counterintuitive but persistent). Posts under 1,300 characters fit without "see more"; consider whether the cut helps or hurts. PDF carousels (documents) get strong dwell time. Hashtags work, 3–5 niche. Don't post on weekends. Common pitfalls: corporate-press-release tone (kills reach); posting at 8am ET (oversaturated window); auto-cross-posting from Twitter (downranked).

### X

Threads beat single posts for non-newsy content; single posts beat threads for hot-take or news. The first post of a thread has to function as a standalone. Replies in your own thread within the first 5 minutes signal "this is alive" to the algorithm. Quote-tweet engagement compounds. Avoid links in the original post — put them in a reply (the platform downranks outbound links). Image and video posts outperform text-only by ~40% on engagement. Don't autopost from other platforms — the cross-post signature gets downranked. Common pitfalls: thread-leading post that requires the next tweet for context (won't get the algo lift); links in the OP.

## Examples

- `examples/tiktok-first-frame.json` — TikTok hook question
- `examples/ig-reels-vs-carousels.json` — IG content-type comparison
- `examples/unknown-platform.json` — adversarial: snapchat (not v0)

## Sibling files

- Referenced in: `agents/skills/maya-platform/playbook.md` § 3 (Platform expertise), § Weekly content plan, § Post-publish reaction
- Inventory entry: `agents/skills/maya-platform/SKILL.md` § Custom Maya skills → `maya-platform-best-practice`
- Convex tables touched (read): `platformAlgoCache` (added in Sprint 4 by `maya-platform-algo-researcher`; this skill is cache-tolerant — works with or without it)
- Output passes through: `maya-citation-firewall` if Maya is going to surface the answer to the creator (internal-only invocations may skip)
