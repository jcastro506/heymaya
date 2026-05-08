# Sprint 11 — `feature_discovery` Standing Order — Design

A weekly heartbeat-adjacent program where Maya scans the creator's recent surface (posts, inbox, calendar, goals, milestones) and surfaces ONE adjacent skill the creator hasn't been using but would have helped this week. Voice-first, niche-tuned, never a feature dropdown.

## 1. Trigger signal — what counts as "would have helped"

LLM-driven match between recent context and the unused-skill set. Inputs Maya reads at run time:
- Last 30 `posts` (caption + topic + performance) + their `mayaAnnotation`
- `brandDeals` rows from past 14d
- `commitments` + `calendarEvents` 7d back / 14d forward
- `creatorPicture.openingAnswers` (niche, goals, dealsInterest, antiNiches)
- `mayaActionLog` last 30d filtered to `kind:feature_surface` + which skills the creator has actually invoked

Concrete shape (LLM picks ONE, returns null if no fit):
- Wedding-prep video posted → `maya-content-arc-planner` (build-up arc)
- Brand email landed, no `dealsFloorUsd` → `maya-rate-calculator`
- 10K/50K/100K milestone crossed → `maya-packet-generator` (manager-readiness packet) or `maya-monetization-diversifier`
- Recurring character spotted in recent posts → `maya-hook-extractor` library build-out
- Calendar event 14d out unaddressed → `calendar_lookahead` arc proposal
- 3+ Friday flops in `posts` → `maya-underperformance-diagnoser`
- Niche-fit cold-outreach opening (Manager only) → `maya-opportunity-scout`

Hard rule: must be niche-fit. Fitness creator who never asks contracts → never `contract_redflag`. Anti-niche match-up enforced via `creatorPicture.openingAnswers.antiNiches`.

## 2. Cadence

Weekly cron, Sunday 3:00pm local — 1h before `weekly_content_plan` (4pm) and 6h before `weekly_review` (9pm), so the surfaced suggestion can fold into the plan or review naturally rather than landing as its own ping. Once per week max. `kind: "cron"`, `session: "isolated"`, `cronEntryId: "feature_discovery_weekly"`, `defaultCron: "0 15 * * 0"`.

Per-skill cooldown: 30 days from last surface of the same skill. Reset on (a) creator uses the skill or (b) materially new context (LLM judges "this is genuinely a new opening" — e.g. a new milestone, a new niche pivot).

## 3. Suppression (silent no-op + `mayaActionLog skipped_*` row)

Suppress when ANY of:
- Skill invoked in past 14d (`mayaActionLog` lookup by `entryId`)
- `featureSurfaceDeclines` row exists for `(creatorId, skillId)` with no expiry, OR with `cooldownUntilMs > now`
- Skill requires unconnected dependency (Gmail, Calendar, Stripe → check `connectedAccounts.scopeStatus`). Surface the CONNECTION offer as the suggestion instead, but only once per 30d per integration; never recurring connection-nag (matches existing Stripe + Calendar discipline)
- `mayaActionLog` shows ≥2 proactive pushes in past 7d with `pushed:true` (don't pile on)
- Anti-niche match (skill domain ⊂ `antiNiches`)
- `creatorPicture` is missing or `firstBootCompletedAt === undefined` — feature discovery is for established creators, not onboarding
- LLM returns no high-confidence fit — silence > weak suggestion

## 4. Voice

Three-beat structure, ≤320 chars total, single `claw-messenger.sendText`:
1. **Cite the trigger** — "Saw your wedding-prep clip Tuesday."
2. **Name the capability in human words** (NEVER skill slug, NEVER "I have a tool") — "I can plan a 3-post build-up into the day-of — crescendo, day-of, morning-after."
3. **One concrete next step** with tier-aware verb — Manager: "want me to draft it?" / Assistant: "want me to draft it for your approval?"

Banned: "feature", "skill", "capability", "tool", lists of options, "did you know", "by the way", "FYI", emoji clusters, marketing voice. Never enumerate (one suggestion per run, max). If LLM tries to suggest two, it picks the higher-fit one and saves the other for the next eligible run.

Voice-applier pass before send (existing `maya-voice-applier`). Citation firewall pass — the trigger citation must reference real per-post / per-deal data.

## 5. Schema

Extend `mayaActionLog` (no new table for the log) — already carries `entryId`, `outcome`, `pushed`, `engagedAt`. The discovery program uses `entryId: "feature_discovery_weekly"` for the run itself and writes ADDITIONAL rows with `entryId: "feature_surface:<skillId>"` (e.g. `feature_surface:maya-content-arc-planner`) per suggestion sent. `engagedAt` backfill on creator reply or skill invocation lets us measure conversion.

ADD ONE new table:
```
featureSurfaceDeclines: {
  creatorId, skillId, declinedAt, reason?,
  cooldownUntilMs?  // null = permanent decline
} indexed by (creatorId, skillId)
```
Populated via inbound NLU when creator says "stop suggesting that" / "not interested in X" / explicit thumbs-down on a surfaced suggestion. Permanent decline by default; `cooldownUntilMs` only when creator says "not now" / "maybe later".

## 6. Tier behavior

Both tiers run (`tier: "all"`). Difference is in the next-step verb and the candidate skill set:
- **Assistant (`coach`)**: only suggests advisory skills. Next step always "draft for your approval". Manager-only skills (`brand_outreach`, `pitch_strategy`, `hook_library_build` autonomous arm) excluded from candidate pool.
- **Manager**: full skill pool. Next step "want me to draft / run / scout it?" — actual verb depends on skill autonomy class. Auto-action only when `autoSendThreshold` / equivalent gate is set on the target skill.

## 7. Open questions for operator

1. **Sunday 3pm slot** — sandwich between `weekly_content_plan` (4pm) and `weekly_review` (9pm)? Or fold INTO the weekly review as a final beat, no separate ping? Folding saves a message but reduces visibility.
2. **Decline NLU scope** — does "stop suggesting that" parse server-side via a dedicated intent classifier, or via the main agent's heartbeat with a heuristic? Server-side is more reliable; agent-side is faster to ship.
3. **Connection-offer routing** — when the suggestion is gated on Calendar/Gmail, should the surface be a connection offer instead, OR skip silently (since onboarding already covers connections)? Operator preference matters here — leans toward skip since connection-nag is an existing prohibited pattern.
4. **Cold-start window** — how many days post-`firstBootCompletedAt` before the first weekly fire? Recommend ≥14d so the creator has settled in and Maya has enough post + inbox history to ground a real suggestion.
5. **"Genuinely new context" reset** — operator-locked rules or LLM judgment? Recommend LLM judgment with a short rubric in the cron message (milestone crossed, niche pivot, deal-floor change).
6. **Skill candidate set** — explicit allowlist in `STANDING_ORDERS` metadata, or LLM picks freely from the 30+ skills with niche-fit reasoning? Allowlist is safer; free-pick is more flexible. Recommend allowlist for v0 with ~12 high-impact skills, expand based on telemetry.
7. **Telemetry success metric** — surface→engage rate? Surface→skill-invoke rate within 7d? Define the kept-its-keep bar before shipping so we can prune dead suggestions.

## Critical files for implementation

- `convex/agents/packs/maya/workspace/standingOrders.ts` (add the `feature_discovery_weekly` program entry)
- `convex/agents/packs/maya/workspace/buildCronJobsJson.ts` (auto-picks up the new cron-kind program; verify `cronMessage` rendering)
- `convex/schema.ts` (add `featureSurfaceDeclines` table near `mayaActionLog` ~line 1339)
- `agents/skills/maya-platform/cron.md` (add row to § 2 cron table + § 6 conditional gates + § 8 sibling-scan map)
- `agents/skills/maya-platform/playbook.md` (add `### Feature discovery` section with the 3-beat voice template + suppression rules + decline NLU)
