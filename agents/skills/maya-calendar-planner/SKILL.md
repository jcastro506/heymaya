---
name: maya-calendar-planner
version: 0.1.0-sprint-c1
description: >-
  Populate the creator's connected Google Calendar with rich, cited,
  voice-applied events that drive proactive nudges. Nine event kinds —
  trend-strike / content-block / edit-block / post-publish / niche-scroll /
  comment-window / brand-outbox / weekly-review / brain-break — each with
  a structured body that pulls from real surfaced data (a trend URL, a
  peer post, a drafted caption, a brand email thread). Maya is the
  author; the calendar is the receipt. Heartbeat (Sprint C.3) scans the
  table and pings 30 min before each actionable block.
when-to-use: >-
  Driven from standing orders + heartbeat ticks (Sprint C.2 owns the
  trend / weekly / post-publish entries; Sprint C.3 owns the morning_brief
  entry). The creator NEVER asks for a calendar event directly via this
  skill — that path stays on `maya-calendar-write`. This skill is Maya's
  own proactive populate path.
plan-tier: ungated to surface; per-tier weekly caps enforced server-side
  via `weeklyCalendarEventCapPerKind(planTier, kind)` at insert time.
thinking-budget: medium (structured prose generation + cap check + Google
  reminder defaults; no live model-routed multi-step reasoning here).
metadata:
  openclaw:
    emoji: "🗓️"
    requires:
      env:
        - GOOGLE_CLIENT_ID
        - GOOGLE_CLIENT_SECRET
    primaryEnv: GOOGLE_CLIENT_ID
    tags:
      - calendar
      - google
      - proactive
      - planner
      - creator
---

## Calls

- `/lc_maya/calendar_list_events` — read the creator's calendar for the
  target day BEFORE picking a slot. Never book over an existing event.
- `/lc_maya/calendar_create_event` — the actual Google Calendar write.
  Returns `{ id, htmlLink }`. I record the `id` as `googleEventId` in the
  `mayaCalendarEvents` Convex table immediately after.
- `/lc_maya/calendar_update_event` — re-render an event when the underlying
  context shifts (trend cools, draft caption changes). Increments
  `bodyVersion`.
- `/lc_maya/calendar_delete_event` — withdraw an event the creator no longer
  needs (e.g. weekly review they opted out of for this week).
- `claw-messenger.sendMedia` — the channel handoff for the 30-min pre-event
  popup nudge (Sprint C.3 owns the heartbeat hook; this skill just sets
  the data up).
- `maya-voice-applier` — MANDATORY. Every rendered body runs through voice
  apply before the calendar write fires. The raw template I emit is a
  starting shape, NOT final prose.
- `maya-citation-firewall` — MANDATORY. Every named entity in the body
  (peer handle, trend name, post URL, email subject) must have a matching
  citedRef. The firewall returns a verdict before the create endpoint
  is invoked.
- `skills/proactive-agent` — the WAL / Working Buffer / Verify-
  Implementation patterns. Every event I create gets a WAL line "created
  trend-strike googleEventId=evt_xxx kind=trend-strike actionable=true"
  so a crash mid-create can recover without orphan rows.

# maya-calendar-planner

## What I do when the creator's day still has air in it

A real manager doesn't text "hey think about filming today." She walks
in, opens the calendar, says "you're free 2-4, here's the trend that
landed at 11 this morning, here's the hook, film it on the couch." The
specific block, the specific reason, the specific shape — all inside the
calendar where the creator already lives.

That's the entire frame. I read the existing calendar, find a real gap,
pick the right kind of block for that gap, write a richly-cited event
body in the creator's voice, and ship it with a 30-min popup reminder.
The popup is the call to action; the body is why it exists.

## The 9 event kinds

Every event I write is one of these nine kinds. Each has its own body
template (rendered by `renderEventBody` in
`convex/creatorMayaV0/mayaCalendarEvents.ts`) and its own per-tier
weekly cap. The kind is load-bearing — the heartbeat scan in Sprint C.3
fires different nudges depending on the kind.

### 1. `trend-strike` (30-60 min)

"Hop on this trend before it cools." Cited refs: at least one `trend`
(the source URL) and usually one `peer` (the breakout example).

Reference body shape:

> Trend strike — bodega lighting "where I'm from" voice-over
>
> Hop on this before it cools. @soundsofbk hit 412,000 views with this
> format 14h ago.
>
> Source: https://www.tiktok.com/@soundsofbk/video/7355…
>
> Hook to try: "places only kids who grew up here would recognize" → cut
> to your specific spot.
>
> 30-60 min: open the source, watch it twice, draft your own hook, film
> one take.

### 2. `content-block` (1-2 hours)

A filming session. Cited refs: each of the 3-5 idea cards points back to
a peer post or trend the idea came from.

Reference body shape:

> Content block — Saturday morning filming
>
> 1-2 hour filming session. 4 idea cards ready.
>
> 1. The "what I bring to set" pull-out (peer ref: @nyc.creator.mom got
>    1.2M with hers).
> 2. POV: walking into your favorite bagel spot at 6am (your last walk-
>    in POV did 8K — 3x your average).
> 3. The transition you tried last Tuesday that landed at 11k saves —
>    one more variant.
> 4. Q&A reading 3 comments from this week's top post.
>
> Light + outfit + B-roll go on the prep checklist in chat — ping me 15
> before and I'll walk it through.

### 3. `post-publish` (10-20 min)

A specific publish window. Cited refs: at minimum a `post` ref (the
drafted post URL or id) and an optional `peer` ref if optimal-time
derives from peer pattern.

Reference body shape:

> Post: TikTok — 6:42 PM ET
>
> 10-20 min publish window. Hit 6:42 PM ET for TikTok (your 3 best posts
> all landed between 6:30-7:00 PM weekdays).
>
> Caption: "places only kids who grew up here would recognize 🥯"
>
> First comment: "bonus points if you spot the train sign in the back —
> tell me where you grew up below"
>
> Draft: https://app.heymaya.app/drafts/d_72ab…

### 4. `niche-scroll` (15-30 min)

A focused FYP scroll with specific peers + hashtags. Cited refs: at
least 2 `peer` refs and/or `trend` refs.

Reference body shape:

> Niche scroll — Brooklyn food creators
>
> 15-30 min focused scroll. Specific peers + hashtags to dig:
>
> Peers: @soundsofbk, @nycfoodguy, @bagels.of.brooklyn
> Hashtags: #brooklynfood, #bedstuy, #bodega
>
> What I want from you: 3 hooks worth screenshotting + 1 format you'd
> never try (so I know your edges).

### 5. `comment-window` (20-30 min)

Engage on the creator's own post + 5 peer accounts. Cited refs: 1
`post` (own) + 5 `peer` refs.

Reference body shape:

> Comment window — own post + 5 peers
>
> 20-30 min engagement burst.
>
> 1. Reply to every comment on:
>    https://www.tiktok.com/@you/video/73…
>
> 2. Drop one substantive comment on each:
>    - @soundsofbk
>    - @nycfoodguy
>    - @bagels.of.brooklyn
>    - @bedstuyeats
>    - @nyc.creator.mom
>
> Substantive = a sentence that proves you watched, not a fire emoji.

### 6. `brand-outbox` (20-30 min)

Brand email block. Cited refs: each open `email` thread (Gmail thread
id or Composio thread ref).

Reference body shape:

> Brand outbox — 3 drafts waiting
>
> 20-30 min brand-email block. 3 drafts ready for your review.
>
> 1. Ceremonia hair oil — gifted-only ask → soft decline draft.
> 2. Brooklyn Bagel — $1,800 paid promo → counter at $2,400 draft.
> 3. Drinkmate seltzer — first-touch reply → polite hold ("send rate
>    card and I'll get back this week").
>
> Approve / edit / decline — I won't send anything you haven't seen on
> Coach. On Manager, I'll send the firm-decline + accept variants under
> your threshold once you greenlight the policy.

### 7. `weekly-review` (30 min, Sun 7pm creator-local)

Sit-with-Maya block. Cited refs: at minimum 1 `post` (top post of the
week) and the follower delta needs a numeric source. Always at the same
local time so it becomes a ritual.

Reference body shape:

> Weekly review with Maya
>
> 30 min. Sunday 7pm local. Sit-with-me block — not on your phone, on
> the couch.
>
> What we'll cover for the week of 2026-05-05:
> - Follower delta: +1,247
> - Top post:
>   https://www.tiktok.com/@you/video/73…
> - 3 things that worked, 1 thing that didn't, the call for next week
>
> Bring questions. I bring the data.

### 8. `brain-break` (full day, opt-in, rare)

Explicit non-content day. The ONLY kind that may have an empty
`citedRefs` array — the creator opting in IS the reason, not a data
citation. `actionable: false`.

Reference body shape:

> Brain break — content off
>
> Explicit non-content day. You booked Saturday off after the wedding
> shoot.
>
> I won't ping with ideas or trends today. I'll still triage urgent
> inbound brand emails so nothing time-sensitive falls through. Back to
> the regular cadence tomorrow.

### 9. `edit-block` (1-2 hours)

The cut-down session after a filming block. Editing is the #1 stated
creator pain, so it gets its own protected slot instead of "find time
somehow" — it pairs with a `content-block`, never floats alone. Cited
refs: at minimum a `post` ref for the footage or the planned post the
edit feeds.

Reference body shape:

> Edit block — Saturday shoot cut-down
>
> 1-2 hour edit session. 3 clips from the filming block to cut down.
>
> Cutting toward: the bagel-spot POV for Wednesday's slot.
>
> Keep it in your edit voice: fast jump cuts, no intro, text-on-screen
> hook (your last 3 over-indexers all opened cold).
>
> Footage: https://app.heymaya.app/footage/f_91…
>
> Get a rough cut done in one sitting — perfect is the enemy of posted.
> Ping me when it's close and I'll do a hook + first-3-seconds pass.

## Voice rules — non-negotiable

1. **Always voice-applied.** Every body I emit from `renderEventBody`
   is RAW. The wrapping action MUST pipe it through `maya-voice-applier`
   with the creator's `voiceFingerprint` + current `toneSlider` BEFORE
   the calendar create endpoint is invoked. The reference bodies above
   are post-voice — Sprint A.2's editing fingerprint is the same shape
   for prose.

2. **Citations are mandatory on actionable events.** `actionable=true`
   with an empty `citedRefs` array is rejected at the insert mutation
   (architectural principle: grounded or silent). The citation firewall
   runs BEFORE the calendar write — if it fails, I bounce back to the
   creator with what's missing, I don't ship a calendar event with a
   handwave.

3. **First-person, Maya's voice, no corporate hedging.** "Hop on this"
   not "We recommend hopping on this." "Bring questions, I bring the
   data" not "Please prepare any questions in advance."

4. **No format markdown the creator won't see.** Google Calendar's
   description field renders plain text + URLs. No `**bold**`, no
   numbered-list markdown — just numbers and dashes if I want a list.
   The voice-applier strips markdown for iMessage anyway; same rule
   here.

## Gap-finder rules — read before write

Before I pick a slot:

1. **Read the day first.** `/lc_maya/calendar_list_events` for the
   target day in the creator's tz. I see every existing event (Maya-
   authored + external).

2. **Never overlap an existing event.** Strict. Even a soft conflict
   ("brunch 10-12" overlapping "content-block 11-1") gets rejected at
   the planner — pick a different slot, don't double-book.

3. **Default to the creator's stated film day.** If
   `creatorPicture.scheduleConstraints` says "I film Saturdays," I pick
   Saturday for content-block by default. If they said "I don't film
   weekdays," I never pick Mon-Fri unless they explicitly asked.

4. **Real gaps, not crumbs.** A 35-min gap between two existing events
   is NOT a content-block slot (needs 1-2hr). It might still be a
   comment-window or post-publish slot. Match the kind's duration to
   the gap or pick a different day.

5. **One kind per slot.** If today already has a `niche-scroll` on the
   calendar, I don't stack another one in the next gap — I move on to
   tomorrow.

## Timezone rules — always the creator's local

1. Read `creators.timezone` (IANA — e.g. `America/New_York`).
2. Every `startTimeMs` / `endTimeMs` in the calendar create payload is
   wall-clock-correct for that tz. Google's API takes both `dateTime`
   and `timeZone`; I always pass both.
3. The `weekly-review` event MUST land at Sun 7pm in the creator's tz.
   Not in UTC, not in my server's tz, in their tz.
4. The 30-min popup reminder fires on the device — Google handles the
   timezone math from the event's `timeZone` field automatically.

## Plan-tier caps — fail-closed server-side

The per-week cap matrix lives in
`convex/creatorMayaV0/mayaCalendarEvents.ts` as
`weeklyCalendarEventCapPerKind(planTier, kind)`. The insert mutation
counts existing Maya-authored events of the same kind in the running
week and throws `CalendarCapError` at-or-over cap.

The runtime is 2-tier (`coach` | `manager`). The cap helper maps:

- `coach` → starter row (1 trend-strike/wk, 1 content-block/wk, 1
  edit-block/wk, 3 post-publish/wk, 2 niche-scroll/wk, 1
  comment-window/wk, 1 weekly-review/wk; brand-outbox + brain-break
  unlimited).
- `manager` → studio row (everything unlimited).

The middle "pro" row in the matrix is preserved for forward-compat —
the helper signature accepts it, but the deployed `calendarTierFromPlan`
mapping never returns it today.

When I hit a cap mid-plan ("you're at 3/3 trend-strikes this week"), I
quote it back verbatim to the creator instead of silently dropping —
that's the conversational integrity move.

## Google reminder defaults

EVERY actionable event gets:

```json
"reminders": {
  "useDefault": false,
  "overrides": [
    { "method": "popup", "minutes": 30 }
  ]
}
```

The 30-min lead time is the load-bearing detail — long enough to wrap
what they're doing, short enough that they don't forget. `brain-break`
is the one kind with `actionable: false` and so it skips the popup; the
heartbeat scan in Sprint C.3 also short-circuits on `actionable=false`.

## Failure modes I handle plainly

- **OAuth not valid.** The calendar HTTP wrapper returns a 401 with a
  reason. I bounce: "I can't see your calendar right now — your Google
  connection expired. Reconnect via Today screen and I'll re-plan."
- **Create endpoint fails (5xx).** Retry once with the same payload
  (idempotent on Maya's side because we dedupe on
  `(creatorId, googleEventId)` — though Google doesn't have an idem key
  on its create, so retry only on 5xx, never on 4xx).
- **Cap exceeded mid-plan.** Quote the `CalendarCapError` reason
  verbatim. Do not silently drop the event.
- **Gap-finder finds nothing.** Tell the creator: "your week is full —
  what should bump?"
- **Citation firewall verdict = fail.** Refuse to write. Show the
  creator the missing citations.

## Inputs / outputs contract (TS-flavored pseudo)

```ts
type MayaCalendarEventKind =
  | "trend-strike"
  | "content-block"
  | "edit-block"
  | "post-publish"
  | "niche-scroll"
  | "comment-window"
  | "brand-outbox"
  | "weekly-review"
  | "brain-break";

interface CitedRef {
  kind: "trend" | "post" | "peer" | "email" | "brand-deal";
  ref: string;    // URL or stable id
  label: string;  // human-readable
}

interface PlanCalendarEventInput {
  kind: MayaCalendarEventKind;
  // creator-local wall-clock; the action layer attaches timeZone
  startTimeMs: number;
  endTimeMs: number;
  context: Record<string, unknown>;  // per-kind structured fields
  citedRefs: CitedRef[];             // REQUIRED if actionable
  actionable: boolean;
  sourceStandingOrderId?: string;
}

interface PlanCalendarEventResult {
  mayaCalendarEventId: Id<"mayaCalendarEvents">;
  googleEventId: string;
  htmlLink: string;
  bodyVersion: number;
}
```

## Sibling files

- Schema: `convex/schema.ts` → `mayaCalendarEvents` table
- Backend: `convex/creatorMayaV0/mayaCalendarEvents.ts` (insert mutation
  + body templater + per-tier cap helper)
- Heartbeat consumer: `HEARTBEAT.md` (Sprint C.3 owns the scan hook)
- Standing orders that author events: Sprint C.2's trend / weekly /
  post-publish entries plus Sprint C.3's morning_brief entry
- Voice apply: `maya-voice-applier` (mandatory pre-write)
- Citation gate: `maya-citation-firewall` (mandatory pre-write)
- Proactive runbook: `skills/proactive-agent` (WAL + verify-
  implementation patterns)
