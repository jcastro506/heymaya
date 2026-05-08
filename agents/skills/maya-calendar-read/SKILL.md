---
name: maya-calendar-read
version: 0.1.0-sprint7
description: >-
  Read upcoming events from a connected Google Calendar via direct OAuth.
  Used by the heartbeat lookahead tick and on-demand "what's next week look
  like" prompts. Pure-logic glue around the calendar HTTP helpers in
  convex/creatorMayaV0/backend.ts — composes the request shape, parses the
  response into NormalizedEvent rows, and surfaces content-arc signals
  (life events, potential filming days) for the content arc planner.
when-to-use: >-
  Heartbeat tick `calendar_lookahead` (Pro+ only — Calendar is gated by
  planFeatures.ts). Also fired on demand when the creator asks "what does
  next week look like?" or before the Sunday weekly plan is drafted.
plan-tier: Pro+ only. Calendar is not in Starter's allowedProviders.
thinking-budget: low (pure deterministic parsing; no model call here)
allowed-tools: Read, Write
metadata:
  openclaw:
    emoji: "📅"
    requires:
      env:
        - GOOGLE_CLIENT_ID
        - GOOGLE_CLIENT_SECRET
    primaryEnv: GOOGLE_CLIENT_ID
    tags:
      - calendar
      - google
      - read
      - creator
---

# maya-calendar-read

## What I'm doing when I look at the creator's calendar

I'm the eyes-on-the-week skill. When the heartbeat fires the `calendar_lookahead` tick (Pro+ only — Calendar isn't in Assistant's provider set), I pull the next ~14 days from the creator's connected Google Calendar and hand the rows back to the planner as stable `NormalizedEvent` objects.

Two things I'm scanning for, the way a manager skims a client's week on Sunday night:

- **Life events worth planning content around.** A wedding 10 days out. A trip Wednesday-Friday. A product launch next Tuesday. A conference talk Thursday. Birthdays of close family. These are the events that should drive a build-up / day-of / recap content arc. I flag candidates as `lifeEvents`; the classifier downstream decides which ones are real signal vs noise.
- **Filming days the creator has already blocked.** "Shoot day", "filming", "b-roll", "content day". These tell the planner the creator has capacity to capture — so the plan can lean on those days instead of asking her to film when she's at her kid's recital.

I am NOT making the noise / signal call. That's `maya-calendar-classifier`. I'm the candidate-nominator; the classifier is the gatekeeper. I am also defensive by construction: if the upstream Google payload drifts, individual events get dropped silently rather than poisoning the whole pull. A partial calendar is better than a blank one.

## Cadence — when I run

I am NOT proactive on my own. Three triggers, all caller-bounded:

- **Heartbeat tick** `calendar_lookahead` — runs on the cadence defined in `agents/skills/maya-platform/cron.md`. Pulls 14 days ahead by default. The lookahead window is set by the caller; I don't decide it.
- **On-demand from the creator.** "What's next week look like?" The Convex action resolves "next week" to a window, then calls me.
- **Pre-plan hook.** Runs before the Sunday weekly content plan is drafted, so the planner has fresh life-event signal in front of it.

## Inputs

```ts
{
  calendarId: string;   // Google calendar id, e.g. "primary"
  sinceMs: number;      // unix ms, inclusive lower bound
  untilMs: number;      // unix ms, exclusive upper bound
  q?: string;           // optional Google Calendar full-text filter
}
```

## Outputs

```ts
NormalizedEvent[]
// where:
NormalizedEvent = {
  id: string;
  title: string;
  startMs: number;
  endMs: number;
  location?: string;
  description?: string;
  attendees?: number;   // COUNT only — never email addresses
}
```

## How I work — step by step

`script.ts` exposes four pure-logic functions, each doing one job the orchestrating Convex action chains together:

1. **`buildEventsQuery({ calendarId, sinceMs, untilMs, q? })`** — I shape the request the way `fetchGoogleCalendarEvents` (in `convex/creatorMayaV0/backend.ts`) expects it. I never touch the network myself; the action issues the HTTP call so I stay deterministic and unit-testable.
2. **`parseGoogleEvents(raw)`** — I defensively zod-parse each row. If an event fails the shape contract (missing id, missing start/end, payload not an object with `items`), I drop it silently. Malformed events do NOT crash the whole pull — a partial calendar is better than a blank one.
3. **`extractContentSignals(events)`** — heuristic pass. I scan titles + descriptions for `lifeEvents` candidates (wedding / trip / launch / birthday / anniversary / talk) and `potentialFilmingDays` candidates (shoot day / filming / b-roll / content day). I nominate; the classifier decides.
4. **`dedupeAcrossPulls(events, previousIds)`** — set-difference dedupe by event id. Stops consecutive heartbeat ticks from re-surfacing the same wedding to the content arc planner three mornings in a row.

Hand-off: I run, then `maya-calendar-classifier` reads my `extractContentSignals` output and makes the noise-vs-fuel call, then `maya-content-arc-planner` builds the actual arc around the events that survived classification.

## Privacy

The same redaction contract that `maya-calendar-classifier` enforces
applies here at the input boundary. The caller MUST:

- Strip attendee email addresses BEFORE invoking this skill — only a
  count is acceptable.
- Honor the per-creator `calendarEventOptOuts` table — do not pass
  opted-out events into this skill at all.
- Never persist event titles or descriptions in HeyMaya tables beyond
  the 24h post-event window.

This skill itself does not enforce these (the input is shape-validated,
not policy-validated) — they're caller-side because they require Convex
DB access this skill does not have.

## Sibling files

- Referenced in `agents/skills/maya-platform/playbook.md` § Calendar-aware
  content planning
- Sister skill `maya-calendar-classifier` consumes `extractContentSignals`
  output and decides arc shape
- Backend helper: `convex/creatorMayaV0/backend.ts:fetchGoogleCalendarEvents`
- Convex tables touched: `creatorMayaV0CalendarConnections` (read-only —
  the orchestrator looks up the connection row before invoking this skill)

## Plan tier

Pro+ only. The orchestrating action MUST verify `providerAllowed(creator,
'calendar')` before invoking. Starter creators trying to round-trip a
Calendar pull get refused at the action layer — this skill is never
called for them.

## Failure handling

- Missing event id → row dropped, no error surfaced.
- Missing `start` / `end` → row dropped (we cannot place it on a timeline).
- Whole response not an object with `items` → returns `[]`.
- All-day events (date-only, no `dateTime`) → coerced to start/end-of-day
  in UTC. The classifier handles them downstream.
