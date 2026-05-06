---
name: maya-calendar-classifier
version: 0.1.0-sprint3.5
description: Calendar event → content-arc classification. Filters noise (recurring meetings, dentist appointments) from real life events worth planning content around (weddings, trips, launches, conference talks, kid milestones). Privacy-protective by design.
when-to-use: Daily 8am cron `calendar_lookahead` (Pro+ only, see playbook.md § Calendar-aware content planning) on every event 1–14 days out. Also folded into Sunday weekly_content_plan generation when the upcoming week includes events. Output feeds `maya-content-arc-planner`.
plan-tier: Pro+ only. Calendar is not in Starter's `allowedProviders` (see `convex/lib/planFeatures.ts`).
thinking-budget: medium (LLM call required for context inference; cannot ship as pure logic)
metadata:
  openclaw:
    requires:
      env: []
    tags:
      - calendar
      - content-planning
      - classifier
      - google-calendar
      - creator
---

# maya-calendar-classifier

The classifier that turns a creator's calendar into content fuel without becoming a privacy violation.

## Inputs

```ts
{
  event: {
    title: string;
    start: number;            // unix ms
    end: number;
    attendees: number;        // COUNT only — never email addresses (see Privacy below)
    description: string;      // may be truncated by caller if `isPrivate`
    isPrivate: boolean;       // mirrors Calendar event privacy flag
  };
}
```

## Outputs

```ts
{
  classification: 'creator-relevant-life-event' | 'creator-shoot' | 'work-meeting' | 'recurring-noise' | 'personal-private';
  contentArcShape?: 'build-up-day-of-recap' | 'day-of-only' | 'recap-only' | 'none';
  confidence: number;         // 0–1
  reasoningRedacted: string;  // citation-firewall-safe; never quotes attendee emails
}
```

## Privacy contract — non-negotiable

This skill is the privacy chokepoint for Maya's calendar integration. The calling Convex action MUST enforce these constraints; this skill assumes they are enforced and will throw on violation:

1. **`isPrivate=true` events:** the skill sees ONLY the event title. The calling action MUST blank the `description` field and the `attendees` count (set to 0) before invoking. If a `description` is non-empty on a private event, the skill throws `PrivacyViolationError`.
2. **Attendee emails are never passed.** The input only includes a count. If the calling action ever resolves attendees to identities (e.g., for de-duplication), it MUST drop the identities before calling this skill.
3. **No persistent storage of event content beyond the classification.** The calling action writes only the classification + arc shape to `contentPlans` (with a citation by event ID). The full event title/description must NOT be persisted in any HeyMaya table; it lives only in the Composio cache, which expires per Composio's TTL.
4. **24h post-event drop.** The calling action's daily cleanup mutation removes calendar event references from cache 24h after the event passes. (This skill doesn't enforce that — it's a cron concern — but it's documented here so the contract is co-located.)
5. **Per-creator opt-out memory.** The calling action checks `calendarEventOptOuts` for `(creatorId, eventId)` BEFORE invoking this skill. Opted-out events are skipped entirely; this skill is never called for them.

If the creator replies "don't plan around this" in chat, the calling action writes a row to `calendarEventOptOuts`; this skill is not invoked again for that event series.

## How it works

`script.ts` exposes:

1. `classifyByHeuristic(event)` — pure-logic first-pass that catches the obvious cases:
   - Title matches `recurring-noise` patterns (standup, 1:1, dentist, doctor, gym, lunch with X) → `recurring-noise`, confidence 0.9
   - Title matches `creator-shoot` patterns (shoot, filming, content day, recording) → `creator-shoot`, confidence 0.85
   - `isPrivate=true` AND title is generic (1–3 words, no proper nouns) → `personal-private`, confidence 0.95
2. `buildClassifierPrompt(event)` — for ambiguous events, assembles a prompt for the calling action to send to Maya at medium thinking. The prompt explicitly prohibits the model from reasoning about attendee identities (it doesn't have them anyway, but defense-in-depth).

The skill exports `dispatch(event)` which returns either `{ kind: 'heuristic', result }` or `{ kind: 'needs-llm', prompt }`.

## Plan-tier

Pro+ only. The calling action MUST check `providerAllowed(creator, 'calendar')` before invoking. If a Starter creator's calendar is somehow connected (legacy data), the action refuses to invoke this skill — fail-closed.

## Failure handling

- If the LLM returns a classification not in the enum (e.g., model hallucinates `'maybe-relevant'`), the calling action falls back to `personal-private` with low confidence. Maya does NOT propose content around it. (Treating unknowns as private is the privacy-safe default.)
- If the heuristic returns conflicting signals (e.g., title matches both `recurring-noise` and `creator-shoot`), the heuristic returns `unknown` and forces the LLM path.

## Examples

- `examples/wedding-build-up-arc.json` — a wedding 10 days out → life-event, build-up-day-of-recap arc
- `examples/recurring-standup.json` — daily standup → recurring-noise, no arc
- `examples/private-event-title-only.json` — private event with just a title → personal-private, no arc
- `examples/private-event-with-description-throws.json` — caller forgot to redact → throws

## Sibling files

- Referenced in: `agents/skills/maya-platform/playbook.md` § Calendar-aware content planning
- Inventory entry: `agents/skills/maya-platform/SKILL.md` § Custom Maya skills → `maya-calendar-classifier`
- Convex tables touched (read): `calendarEventOptOuts` (caller filters BEFORE invoking — see schema.ts; live as of Sprint 3)
- Convex tables touched (write): none directly (caller writes classification result to `contentPlans`)
- Output passes through: `maya-citation-firewall` if the classification surfaces in a creator-facing message; internal-only invocations may skip
