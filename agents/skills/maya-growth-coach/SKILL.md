---
name: maya-growth-coach
version: 0.1.0-sprint3.5
description: Generates do-this-next tactical moves from performance data + creator goals. Not analysis (that's weekly recap) or planning (that's content arc planner) — this is the strategic-thinking skill that turns observations into prioritized actions, every word grounded in cited evidence.
when-to-use: When creator asks what should I do / what's next / I'm stuck in chat; folded into Sun-night weekly review push; folded after accountability-nudge cron detects a missed commitment. Not used inside morning brief (stays light) or content planning (the planner makes posts; this skill makes moves).
plan-tier: pro+ (Starter gets lighter coaching folded into evening recap; folded into morning brief on Pro+ via Growth coaching standing order). Studio adds optional cross-creator anchors when peer benchmarks opt-in.
thinking-budget: high
---

## Calls

- `maya-citation-firewall` — mandatory on every move; must cite specific posts / metrics / soul anchors

## Delegates to

- model router `callMaya` for synthesis


# maya-growth-coach

## Why this exists

Most creator-tools advice falls into one of two failure modes: glib
("post more!") or analytical ("here are your retention curves"). The job
is in the middle: read the data, weigh it against the creator's actual
goals, and produce 2-5 specific moves the creator can do this week — with
the evidence right next to each move so they trust it.

Examples of the kind of moves this skill produces:

> "Your followers want longer cooking content but you stopped doing
> 8-minute videos 3 weeks ago — resume one this week. Your last 8-min
> video (post tt_938) hit 2.4× your trailing-30 average."

> "Your hook variance is too high — 7 different opening patterns in 14
> posts. Double down on the 'POV' hook (3.1× baseline; example:
> ig_reel_402)."

> "You haven't posted Sunday in 6 weeks. Your audience indexes 2.0× on
> Sunday based on your IG insights. Try one Sunday post this week."

Each move carries: the move itself, the evidence behind it, the expected
outcome, and a timeframe. Each must pass the citation firewall — moves
without grounding don't ship.

## Inputs

```ts
{
  creatorPicture: { /* from Convex `creatorPicture` table */ };
  recentMetrics: Array<{ /* from `posts` + `postMetrics` — last 30-60 days */ }>;
  goalsFromSoul: {
    /* extracted from soul.md — "grow to 100K", "land 4 brand deals
       this quarter", "build a YouTube long-form arm" */
  };
  currentStruggle?: string; // optional creator-supplied context: "I'm tired", "I lost a deal", "I missed posting twice this week"
  creatorId: Id<"creators">;
}
```

## Outputs

```ts
{
  moves: Array<{
    priority: 1 | 2 | 3;        // 1 = do this week; 2 = do this month; 3 = consider
    move: string;                // the action, plain-language
    evidence: string;            // citation-grounded reason — the firewall verifies this
    expectedOutcome: string;     // honest expected outcome, no overpromise
    timeframe: '1d' | '1w' | '1mo';
  }>;
  antiPatterns: string[];        // patterns to STOP doing (cited, optional)
}
```

## Honest expected-outcome rule

`expectedOutcome` carries a hypothesized lift, never a promise. Maya writes:

✓ "Likely lift: similar to your last 8-min posts (~2× baseline)"
✗ "This will hit 100K views" — banned, unfalsifiable promise

The model prompt enforces this. The firewall double-checks: any expected-outcome
text that asserts a specific number must trace to a cited prior post.

## Anti-patterns (the second output)

The skill also surfaces 0-3 anti-patterns — things the creator should STOP
doing — with citations. Examples:

> "Stop posting on Mondays. Last 4 Monday posts averaged 0.4× baseline; your
> Monday audience is in work mode, not scroll mode."

> "Stop the 'Hey guys, today we're going to talk about...' opening. Last 6
> posts that opened that way had completion rate <30% (your trailing avg is
> 52%)."

Anti-patterns are optional — if there is no high-confidence pattern to call
out, the skill returns `antiPatterns: []`.

## How it works

1. **Build the evidence corpus.** Pull the creator's `creatorPicture`,
   `recentMetrics`, `goalsFromSoul`, and (optional) `currentStruggle`.
   Aggregate `postMetrics` into per-format / per-day-of-week / per-hook /
   per-length buckets so the model can reason across them.
2. **Call the model router.** `callMaya` with taskTag `weekly_review_synth`
   (high thinking, clamped per plan tier — Pro and Studio both unlock high;
   Starter is gated upstream and cannot reach this skill). The prompt asks
   for 2-5 prioritized moves + 0-3 anti-patterns, each with explicit
   citations to specific post IDs / metric values / soul anchors.
3. **Citation firewall.** Pass each move's `evidence` field through
   `maya-citation-firewall` with the cited post IDs / metrics as the
   evidence list. Any move that fails is dropped. Same for anti-patterns.
4. **If too many drop, retry once.** If <2 moves survive the firewall,
   re-prompt the model with the dropped-citations as feedback and ask for
   replacements. Cap to one retry; if the second attempt still produces
   <2 surviving moves, return what we have (better few-and-real than many-
   and-fictional).
5. **Return.** Caller (chat reply / weekly review fold-in / accountability
   redirect) shapes the surface format.

## Plan-tier gating (server-side, fail-closed)

- `starter`: action throws `PlanGateError` at entry. Coaching for Starter
  lives in the lightweight evening-recap behavior; the dedicated coach
  skill is Pro+.
- `pro`: enabled. High thinking permitted (Pro's max is high).
- `studio`: enabled. May optionally include anonymized peer-benchmark
  context when the creator has opted in (Studio-only flag in
  `connectedAccounts`-adjacent settings — Sprint 6 settings UI). v0 ships
  without the peer-benchmark layer; the field is reserved.

## Citation firewall — non-negotiable here

This skill is the highest-stakes "what should I do" surface in v0. A move
with no citation is fiction. The firewall is the gate. The two-pass design
(score → drop → retry → ship-what-survives) is the operational pattern that
hits the 0% hallucination target on this skill. The firewall failure rate
on this skill is a Sprint 7 telemetry gate — if >5% of moves get dropped,
the prompt is wrong and we re-tune.

## What this skill is NOT

- **Not weekly recap.** Recap explains what happened. This skill says what
  to do next.
- **Not content planning.** The arc planner produces specific posts; this
  skill produces moves at the strategy layer ("post more long-form on
  Sundays") that the planner then materializes.
- **Not motivational.** No "you got this!" — moves stand on their evidence.
  The tone slider in `soul.md` modulates delivery, not honesty (per
  `playbook.md § 1`).
- **Not real-time.** Heavy synthesis; minimum 5-10s latency. Maya invokes
  this when the moment calls for it, not on every chat turn.

## Examples

See `examples/fitness-creator-moves.json` for a typical 4-move output for a
mid-sized fitness creator.

See `examples/stuck-creator.json` for the `currentStruggle: "I'm tired and
falling behind"` variant — the moves bias toward smaller, lower-cost
re-entry actions.

## Sibling-file references

- Invoked from `agents/skills/maya-platform/playbook.md` § Free-form chat
  handling (when creator asks "what should I do?"), § Weekly review
  (folded into the synthesis push), § Accountability nudge (when the
  re-direct is more useful than the nudge). Lead is backfilling per the
  parent agent brief.
- Listed in `agents/skills/maya-platform/SKILL.md` § Custom Maya skills.
- Reads no new tables; relies on existing `creatorPicture`, `posts` (Sprint 4
  schema add), `postMetrics` (Sprint 4), and the `soul.md` workspace file.
