---
name: maya-content-arc-planner
version: 0.1.0-sprint3.5
description: Multi-day content arc generator. Given a seed event (calendar life-event) or theme, plus creator picture and platform mix, produces per-platform per-day post outlines (hook options, format, caption draft, posting time, rationale). Calendar arcs follow build-up → day-of → morning-after → evergreen; theme arcs adapt to niche cadence.
when-to-use: Fired by Weekly content plan (Sun 4pm) and Calendar-aware planning (daily 8am, Pro+) programs, once per theme or classified life-event. Also from chat when creator asks plan a 3-post arc around X.
plan-tier: ungated (Starter constrained to single-platform variants by 1-handle cap; Pro/Studio get full multi-platform arcs).
metadata:
  openclaw:
    requires:
      env: []
    tags:
      - content-planning
      - arc
      - multi-platform
      - creator
---

## Calls

- `maya-platform-best-practice` — for each platform variant: format choice + posting time
- `maya-citation-firewall` — mandatory; every arc draft cites either the calendar event ID or the theme rationale


# maya-content-arc-planner

## When I run this

- Sunday 4pm `weekly_content_plan` whenever a theme is locked.
- Daily 8am calendar look-ahead (Pro+) when `maya-calendar-classifier` flags a real life-event 1–14 days out.
- On-demand: "Maya, plan me a 3-post arc around X."
- NOT on the heartbeat. Arcs are weekly-cadence work.

## What I'm actually doing

The hardest question for a creator is not "what should I post." It's "I have this thing happening — a wedding, a trip, a launch, a kid's milestone, a conference talk. How do I turn that one moment into a week of content without it feeling like spam?"

That's the job. I take one seed (a calendar event or a theme) and I drop it onto a multi-day, multi-platform plan that respects the creator's actual posting rhythm and platform mix.

There are two shapes I pick from depending on the seed:

- **Calendar life-event** → `build-up → day-of → morning-after → evergreen`. The natural rhythm of an event the audience can anticipate, witness, and remember.
- **Theme** (e.g. "recovery week," "shipping mode," "summer cooking") → `flexible-theme`. No anchor date, so I follow the creator's posting cadence and let the theme thread through.

## How I shape a calendar arc

For a seed event on day 0:

| dayOffset | beat | what fits here | what does NOT |
|---|---|---|---|
| -7 to -1 | build-up | anticipation, behind-the-scenes, "what I'm packing" | the actual event content (it hasn't happened) |
| 0 | day-of | live capture, real-time post | over-edited recap (too soon) |
| +1 | morning-after recap | synthesis, lessons, the one moment that landed | live-feel content (the moment is gone) |
| +7 to +14 | evergreen variant | the same event told as a durable how-to | another version of the day-of (audience saw it) |

Then I match each beat to platforms and formats, because not every beat fits every platform:

- **Build-up** → TikTok hook-tease, IG carousel preview. (No IG Stories in v0 — out of scope.)
- **Day-of** → TikTok live-capture, IG Reel. Short-form, immediate.
- **Recap** → TikTok narrative, IG carousel, YT Short, LinkedIn post. The reflective beat.
- **Evergreen** → YT long, LinkedIn carousel, IG carousel. Things that retain value past the moment.

Not every day gets every platform. A creator who posts 4×/week on TikTok and 2×/week on IG should not suddenly get a 7-platform-variant carpet bomb because there's a wedding coming. I read `creatorPicture.postingCadence.perPlatform` and respect their actual rhythm.

## How I shape a theme arc

No event date. I produce `lookAheadDays` (default 7) post slots, paced to the creator's actual posting cadence per platform. The theme string threads each post — but I do not force connection. If the theme is "recovery week" and the creator's strongest content is gym hooks, I lean gym-hooks-with-a-recovery-frame, not "what foam roller I bought." Voice anchor wins over theme anchor.

## What goes in each arc day

Every `ArcDay` carries:

- `dayOffset` — relative to the seed (calendar) or 0..N-1 (theme)
- `platform` and `format` — chosen from the table above based on the beat
- `hookOptions[3]` — three real options, not one. The creator picks at draft time.
- `captionDraft` — voice-applied at the action layer via `maya-voice-applier` before render
- `postingTimeLocal` — pulled from `postingCadence.bestHoursLocal`, refined by `maya-platform-best-practice`
- `rationale` — one line: why this slot, why this platform, why this format
- `citation` — points to `seedEvent.id` (calendar) or `theme:${slug}` (theme)

## The hard gate

Every arc day must cite either the calendar event ID (and the day-offset has to math against the event date) or the theme synthetic ID. The `rationale` text — both per-day and the bundle-level summary — gets firewalled against the seed and the top-3 most-cited posts in the arc. If a rationale leaks creator-data claims I cannot ground (e.g. "your audience loves Italian food" without that being in `creatorPicture.audience.interestTags`), the firewall rewrites or drops it.

## Tier behavior

- **Assistant / Starter** — `maxPlatformVariantsPerDay = 1`. The single platform is the creator's primary (`creatorHandles[0].platform`), resolved upstream and passed in via a length-1 `platforms` array. The 1-handle cap is the gating mechanism, not a special branch in this skill.
- **Manager / Pro / Studio** — full multi-platform spread.

The skill itself is plan-aware via the input shape, not by reading `planFeatures` directly. Plan-tier enforcement is at the entry-point action.

## Hand-offs

- `maya-platform-best-practice` — for each platform variant, I consult it for format choice + posting time refinement.
- `maya-citation-firewall` — mandatory on every per-day rationale and the bundle rationale.
- `maya-voice-applier` — runs at the action layer on `captionDraft` before persist.
- I get my seed from either `maya-calendar-classifier` (event) or `maya-idea-generator` (theme/candidate).

## Model routing

`weekly_content_plan` task tag, medium thinking. Sunday weekly plans run weekly — the creator has a full week to react and edit. This is not a high-stakes one-shot. High thinking is wasted here.

## Examples

- `examples/calendar-arc-wedding.json` — wedding 5 days out, multi-platform.
- `examples/theme-arc-recovery.json` — fitness creator, "recovery week," 7-day theme arc.
- `examples/starter-single-platform.json` — Starter, 1 platform, 3-day theme arc.
