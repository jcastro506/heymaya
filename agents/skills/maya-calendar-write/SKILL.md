---
name: maya-calendar-write
version: 0.1.0-sprint7
description: >-
  Create new events on a connected Google Calendar via direct OAuth.
  Triggered when the creator says things like "block 3pm Tuesday for
  filming" or "put a hold on Saturday morning for the wedding shoot." The
  skill parses the natural-language phrasing, validates the resulting
  event spec against creator-side guards (no past start times, sane
  duration cap, banned-topic gate), and returns the created event's id +
  htmlLink for Maya to confirm in chat.
when-to-use: >-
  Creator-initiated. Maya only writes to the calendar when the creator
  explicitly asks her to ("block X for Y") — never on her own. The
  orchestrator confirms ambiguous parses ("next Tuesday vs this Tuesday")
  before the write happens.
plan-tier: Pro+ only. Calendar is not in Starter's allowedProviders.
thinking-budget: low (deterministic NL parsing + guard checks)
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
      - write
      - creator
---

# maya-calendar-write

## What I actually do when the creator says "block X for Y"

The creator texts: "block 3pm Tuesday for filming." That's the whole input. My job is to turn those nine words into an actual event in their Google Calendar — and to push back if anything's ambiguous before I touch the calendar.

The chat shape works like this:

> Creator: "block 3pm Tuesday for filming"
>
> Me (parsing — it's Friday): "this Tuesday or next Tuesday?"
>
> Creator: "next"
>
> Me: "Done — Tuesday 3-5pm, 'Filming.' [link]"

If the parse is unambiguous, I just confirm:

> Creator: "block Saturday morning for the wedding shoot"
>
> Me: "Done — Saturday 9am-1pm, 'Wedding shoot.' [link]"

The link is what the creator can tap to verify the block actually landed in their calendar.

## Cadence — strictly creator-initiated

I never run on cron. I never run on heartbeat. I run only when the creator explicitly tells Maya to block time:

- "block 3pm Tuesday for filming"
- "put a hold on Saturday morning for the wedding shoot"
- "schedule batch recording 9–11am Wednesday"

Maya does not write to the calendar on her own. Not "I noticed you have free time, I added a content block" — never. Calendar writes are a permission boundary; the creator owns it, I execute on request.

## Inputs

The skill is structured around a 3-stage call sequence:

1. `parseEventIntent(text, nowMs, tz)` →
   ```ts
   { ok: true, event: ProposedEvent }
   | { ok: false, ambiguous: true, reason: string }
   | { ok: false, reason: string }
   ```
2. `validateEventBeforeWrite(event, picture)` →
   ```ts
   { ok: true } | { ok: false, reasons: string[] }
   ```
3. `buildEventCreatePayload(event)` →
   ```ts
   GoogleCalendarEventCreate
   ```

`ProposedEvent` shape:

```ts
{
  title: string;
  startMs: number;
  endMs: number;
  description?: string;
  location?: string;
  timeZone: string;     // IANA — used to set Google's `timeZone` field
}
```

## Outputs (orchestrator-side)

```ts
{
  id: string;        // Google Calendar event id
  htmlLink: string;  // creator-tappable URL to view the event in Calendar
}
```

Maya texts the `htmlLink` back so the creator can verify the block landed.

## Guards — the three things I will not write

The validate-before-write step is where I hold the line. If any of these fire, the action MUST NOT issue the Google API call:

1. **No past start times.** Anything whose `startMs` is before `Date.now()` gets refused. Maya should not be backfilling yesterday's events; if she's putting a hold on the calendar, it's forward-looking. Sanity check, not policy.
2. **Duration cap of 8 hours.** Anything longer is a parse error bouncing back. Real filming days that genuinely run 12 hours can be split into morning + afternoon holds; one block longer than a workday is almost always a misparse ("Saturday for the wedding shoot" doesn't mean 24h on Saturday).
3. **Banned-topic title.** If the creator's `boundaries.banned_topics` list (read from the picture / intake) matches the event title, I refuse. The creator told Maya not to surface this topic; she should not be able to ask Maya to write the topic to her own calendar by accident.

A guard refusal is surfaced verbatim by the orchestrator — Maya quotes the reason back so the creator knows exactly what bounced and why ("I won't write a 12-hour block — split into morning/afternoon?").

## Failure handling

- Ambiguous date phrasing ("next Tuesday" two days into the week is
  ambiguous; this skill flags `ambiguous: true` so the orchestrator can
  text a confirm question).
- Parse failure (no time mentioned) returns `ok: false` with a reason
  Maya can quote back.
- Past-time, over-cap, banned-topic → guard refusal at validation, not at
  parse — these are clear errors the orchestrator surfaces verbatim.

## Sibling files

- Sister skill `maya-calendar-read` covers the read path
- Backend helper: `convex/creatorMayaV0/backend.ts:createGoogleCalendarEvent`
- Convex tables touched (write): `creatorMayaV0CalendarEvents` is patched
  by the orchestrator AFTER the Google API call succeeds (so we never
  store a hold the calendar API rejected)

## Plan tier

Pro+ only. The orchestrating action MUST verify `providerAllowed(creator,
'calendar')` before invoking. Starter creators trying to write to
Calendar get refused at the action layer — this skill is never called for
them.
