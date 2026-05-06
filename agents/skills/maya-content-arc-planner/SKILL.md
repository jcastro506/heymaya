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

## Purpose

A creator's hardest question is not "what should I post" — it is "how do I
turn one moment into a week of posts." Calendar life-events (a wedding, a
trip, a launch, a kid's milestone, a conference talk) are gold: they are
specific, dated, audience-relevant, and they generate natural build-up /
day-of / recap rhythm. Theme-based arcs (e.g., "this week is about
recovery") are softer but still benefit from structure.

This skill produces the per-platform per-day plan that the Plan screen
renders.

## Inputs

```ts
{
  seedEvent?: CalendarEvent;       // Composio Calendar event, classified as creator-relevant-life-event
  theme?: string;                  // alternative seed when there is no calendar anchor
  creatorPicture: CreatorPicture;  // niche, audience, voice, top hooks, posting cadence
  platforms: Array<"tiktok" | "instagram" | "youtube" | "linkedin" | "x">;
  lookAheadDays: number;           // typically 7; can be 3–14
  // Plan-tier features (resolved upstream from `planFeatures(creator)`):
  maxPlatformVariantsPerDay: number; // 1 for Starter, len(platforms) for Pro+
}
```

Exactly one of `seedEvent` or `theme` must be present.

## Outputs

```ts
{
  arc: ArcDay[];
  rationale: string;            // ≤ 4 sentences, citation-firewalled against the seed
  shape: "build-up-day-of-recap" | "flexible-theme";
  citationFirewall: { passed: true } | never;
}

interface ArcDay {
  dayOffset: number;            // -7..0..+7 relative to seed event date (0 = day-of); for theme arcs, 0..lookAheadDays-1
  platform: Platform;
  format: PostFormat;           // "tiktok-post" | "ig-reel" | "ig-carousel" | "yt-short" | "yt-long" | "linkedin-post" | "x-thread" | "x-single"
  hookOptions: string[];        // 3 hook options
  captionDraft: string;
  postingTimeLocal: string;     // "HH:MM" in creator's tz, from cadence + best-practice
  rationale: string;            // why this slot, this platform, this format
  citation: { sourceKind: "calendar-event" | "theme"; sourceId: string };
}
```

## Build-up / day-of / recap shape (calendar life-events)

- `dayOffset = -7..-1` — build-up (anticipation, behind-the-scenes,
  context-setting).
- `dayOffset = 0` — day-of (live capture, real-time post).
- `dayOffset = +1` — morning-after recap (synthesis, lessons, gratitude).
- `dayOffset = +7..+14` — evergreen variant (the same event told as a
  durable how-to or carousel that retains value beyond the moment).

Not every offset gets every platform. The skill picks platform-format
combinations that match each beat:
- Build-up: TikTok hook-tease, IG Story (not in v0 — story is out of scope),
  IG carousel preview.
- Day-of: TikTok live-capture, IG Reel.
- Recap: TikTok narrative, IG carousel, YT Short, LinkedIn post.
- Evergreen: YT long, LinkedIn carousel, IG carousel.

## Theme arcs

When `theme` is the seed, the arc is flexible. The skill produces
`lookAheadDays` of post slots (default 7). The cadence pulls from
`creatorPicture.postingCadence.perPlatform` (so a creator who posts 4×/week
on TT and 2×/week on IG gets a plan that respects their actual rhythm).

## Plan-tier behavior

Starter is capped at `maxPlatformVariantsPerDay = 1`. The skill picks the
creator's primary platform from `creatorHandles[0].platform` (resolved
upstream and passed in via `platforms` length 1). Pro and Studio receive
all connected platforms.

Plan-tier enforcement is server-side at the entry point; this skill is
plan-aware via the input shape rather than reading `planFeatures` directly.
This keeps the skill pure and testable.

## Model routing

The skill calls the model router with task tag `weekly_content_plan`
(medium thinking). The hooks + caption drafts benefit from reasoning, but
this is not a high-stakes one-shot — Sunday weekly plans run weekly and the
creator has a full week to react.

## Citation firewall

Every arc day's `citation` field points to either:
- the `seedEvent.id` (calendar) — the firewall confirms the event is in
  the creator's calendar and the day-offset matches the event date.
- a synthetic `theme:${slug}` ID — the firewall verifies the rationale
  references the theme string and not creator-data claims.

The `rationale` synthesized at the bundle level is firewalled against the
top-3 most-cited posts in the arc + the seed.

## Examples

- `examples/calendar-arc-wedding.json` — life-event arc for a creator with a
  wedding 5 days out, multi-platform.
- `examples/theme-arc-recovery.json` — theme arc for a fitness creator with
  a "recovery week" theme, 7-day plan.
- `examples/starter-single-platform.json` — Starter creator, 1 platform,
  3-day theme arc.
