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

Reads the creator's connected Google Calendar and hands the rows back as
shape-stable `NormalizedEvent` objects. Defensive-by-construction — if the
upstream payload drifts, individual events are dropped silently rather than
poisoning the whole pull.

## Triggers

- **Heartbeat tick** `calendar_lookahead` — runs on the cadence defined in
  `agents/skills/maya-platform/cron.md`. Pulls 14 days ahead by default.
  The lookahead window is bounded by the caller, not by this skill.
- **On-demand** — creator asks Maya "what's next week look like?" Maya
  resolves the window from the natural-language phrase, then calls this
  skill.
- **Pre-plan hook** — runs before the Sunday weekly content plan is drafted
  so the planner sees fresh life-event signal.

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

## How it works

`script.ts` exposes four pure-logic functions:

1. `buildEventsQuery({ calendarId, sinceMs, untilMs, q? })` — returns the
   request shape that `fetchGoogleCalendarEvents` (in
   `convex/creatorMayaV0/backend.ts`) expects. Only the orchestrating
   action issues the actual HTTP call; this skill never touches the
   network so it stays deterministic and unit-testable.
2. `parseGoogleEvents(raw)` — defensive zod parse. Each entry that fails
   the shape contract is dropped silently. Malformed events MUST NOT
   crash the whole pull — Maya keeps a partial calendar over a blank one.
3. `extractContentSignals(events)` — heuristic-only pass that flags
   `lifeEvents` (mentions of wedding / trip / launch / etc.) and
   `potentialFilmingDays` (mentions of shoot day / filming / b-roll).
   The classifier in `maya-calendar-classifier` decides what's actually
   noise vs content fuel — this just nominates candidates upstream.
4. `dedupeAcrossPulls(events, previousIds)` — set-difference dedupe by
   event id. Keeps consecutive heartbeat ticks from re-surfacing the same
   row to the content arc planner.

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
