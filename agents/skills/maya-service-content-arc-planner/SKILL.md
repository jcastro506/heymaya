---
name: maya-service-content-arc-planner
version: 0.1.0-sprint3
description: Plan a multi-day content arc around a seed event (storm, season, milestone, weather promo). Hyperlocal by default — every post in the arc references named neighborhoods, local landmarks, named competitors, or operator-supplied local hooks. National-scope copy is rejected.
when-to-use: Fired by `seasonal_nudge` (Mondays 9am Pro+), `local_event_watch` (6pm Pro+), `weather_triggered_promo` (event Pro+), and on-demand from chat ("plan a 5-day arc around the heat wave").
plan-tier: pro+.
model-routing: Gemini 3 Flash, HIGH thinking. Per § 3 routing matrix — multi-day, multi-platform, multi-stakeholder synthesis.
---

# maya-service-content-arc-planner

## Purpose

A storm forecast becomes 3 posts. A heat wave becomes a 7-day arc. A neighborhood block party becomes a 4-day local-presence arc. The skill produces per-platform per-day post outlines (hook + caption draft + posting time + rationale) tied to the seed event.

## LOCAL-HOOK HARD RULE (verbatim from § 7)

**The arc MUST be hyperlocal — every post in the arc references named neighborhoods, local landmarks, named local competitors (where contrast is helpful), or operator-supplied local hooks from `businessPicture.localPositioning`. National-scope copy is rejected.**

The output's `localHooksWoven[]` field names which hooks each post draws from, for audit + the citation firewall's local-hook-density assertion (≥80% of posts in an arc reference at least one local hook from `localPositioning`).

## Inputs

```ts
{
  seedEvent: {
    kind: "weather" | "season" | "local-event" | "milestone" | "competitor-move";
    description: string;
    startDate: number;                   // unix ms
    endDate?: number;
  };
  businessPicture: {
    serviceType: string;
    brandVoice: string;
    localPositioning: {
      servedZips: string[];
      servedNeighborhoods: string[];
      namedCompetitors: Array<{ name: string; reputationalNote?: string }>;
      recurringLocalHooks: Array<{
        kind: "weather" | "event" | "landmark" | "sport" | "season" | "community";
        text: string;
      }>;
    };
  };
  platforms: Array<"gbp" | "facebook" | "instagram" | "tiktok">;
  lookAheadDays: number;                 // 3-14
}
```

## Outputs

```ts
{
  arc: Array<{
    dayOffset: number;
    platform: "gbp" | "facebook" | "instagram" | "tiktok";
    hookOptions: string[];
    captionDraft: string;
    postingTimeLocal: string;            // "HH:MM"
    rationale: string;
    localHookUsed: { kind: string; text: string; sourcedFrom: string } | null;
  }>;
  rationale: string;
  localHooksWoven: Array<{ dayOffset: number; hook: string }>;
  localHookDensity: number;              // 0..1, must be >=0.8
  citationFirewall: { passed: true } | never;
}
```

## Memory-wiki integration (§ 9.5)

- **Arc-theme seeding**: before generating the arc, call `wiki_get("concepts/recurring-local-hooks")` to load the operator's volunteered seasonal / event / landmark / community hooks with their evidence chains. These become the candidate `localHookUsed` values for each post in the arc.
- **Per-day grounding**: each post's `localHookUsed.sourcedFrom` must trace to a wiki claim — either a `concepts/recurring-local-hooks` entry, a `concepts/local-positioning` entry, or a specific `entities/neighborhoods/<slug>` page. The citation firewall (which runs with `requireLocalHook=true` AND the local-hook-density ≥0.8 check) verifies via `wiki_get` and rejects arcs where any claimed hook source is unreachable.
- **Competitor-contrast hooks**: when an arc uses competitor contrast, call `wiki_get("entities/competitors/<slug>")` for each named competitor — only operator-named competitors with wiki pages may appear (regression guard against phantom-name leaks per § 9.5 + the citation firewall's no-phantom-name rule).
- HIGH-thinking budget applies to the LLM draft pass; `wiki_get` calls are direct plugin reads (no thinking budget consumed).

## Plan-tier

Pro and Studio. Starter does not get this skill.

## Test categories

- Cross-tenant: Business A's localPositioning never bleeds into Business B's arc.
- Citations: every `localHookUsed.sourcedFrom` resolves to a real entry in input localPositioning.
- **Local-hook-density** (THE test, § 7 hard rule) — `localHookDensity >= 0.8` always; arcs below threshold fail the firewall.
- Adversarial: empty `localPositioning` rejected (skill cannot run without local context).

## Sibling files

Standing orders: `seasonal_nudge`, `local_event_watch`, `weather_triggered_promo`. Calls: `maya-service-citation-firewall` (with `requireLocalHook=true`), `maya-service-brand-voice-applier`. Writes via callers to `gbpPosts.suggestions[]` + `contentPlans`.
