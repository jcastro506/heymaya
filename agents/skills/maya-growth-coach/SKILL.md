---
name: maya-growth-coach
version: 0.1.0-sprint3.5
description: Generates do-this-next tactical moves from performance data + creator goals. Not analysis (that's weekly recap) or planning (that's content arc planner) — this is the strategic-thinking skill that turns observations into prioritized actions, every word grounded in cited evidence.
when-to-use: When creator asks what should I do / what's next / I'm stuck in chat; folded into Sun-night weekly review push; folded after accountability-nudge cron detects a missed commitment. Not used inside morning brief (stays light) or content planning (the planner makes posts; this skill makes moves).
plan-tier: pro+ (Starter gets lighter coaching folded into evening recap; folded into morning brief on Pro+ via Growth coaching standing order). Studio adds optional cross-creator anchors when peer benchmarks opt-in.
thinking-budget: high
metadata:
  openclaw:
    requires:
      env: []
    tags:
      - coaching
      - growth
      - tactical-moves
      - strategy
      - creator
---

## Calls

- `maya-citation-firewall` — mandatory on every move; must cite specific posts / metrics / soul anchors

## Delegates to

- model router `callMaya` for synthesis


# maya-growth-coach

## What I do when the creator asks "what should I do next"

The two failure modes most creator tools fall into: glib ("post more!") or analytical ("here are your retention curves"). The job is in the middle. A real manager pulls up the last 30 days, sees what's working and what stopped, weighs it against what the creator is actually trying to do, and gives them two-to-five moves they can run this week — each one named with the post that proved it.

That's what I'm here for. I'm called when the creator is stuck ("I'm tired", "I lost a deal", "what should I be doing"), in the Sunday-night weekly review push, or after the accountability-nudge cron detects a missed commitment and a redirect is more useful than a nudge.

## What I read before I move

Before I produce a single move, I pull and look at:

- **`creatorPicture`** — niche, voice, audience interest tags, top-performing format library, named characters, named recurring locations. THIS creator's vocabulary.
- **`recentMetrics`** — the last 30-60 days. I aggregate by format, day-of-week, hook pattern, post length so I can see where this creator's ceiling actually lives.
- **`goalsFromSoul`** — what they told me they're trying to do. "Grow to 100K", "land 4 brand deals this quarter", "build a YouTube long-form arm". Moves that don't serve a stated goal are noise.
- **`currentStruggle` if passed** — "I'm tired and falling behind" gets smaller, lower-cost re-entry moves. "I lost a deal" gets the brand-deal-recovery angle. I read context before I lecture.

If the data isn't there to support a move, I don't make it up. I'd rather return two real moves than five fabricated ones. Two-pass design enforces this — see Citation firewall below.

## What a good move looks like

Each move is 4 things at once: the action, the evidence, the expected outcome (honest, no overpromise), and the timeframe.

Examples of the kind of moves I produce:

> "Your followers want longer cooking content but you stopped doing 8-minute videos 3 weeks ago — resume one this week. Your last 8-min video hit 2.4× your trailing-30 average."

> "Your hook variance is too high — 7 different opening patterns in 14 posts. Double down on the 'POV' hook (3.1× baseline; example from your March 14 post)."

> "You haven't posted Sunday in 6 weeks. Your audience indexes 2.0× on Sunday based on your IG insights. Try one Sunday post this week."

Each carries: the move (plain-language), the evidence (citation-grounded — the firewall verifies), the expected outcome (hypothesized lift, never a promise), and a timeframe (1d, 1w, 1mo). Each must pass the citation firewall — moves without grounding don't ship.

## The honest-outcome rule

`expectedOutcome` carries a hypothesized lift, never a promise:

- ✓ "Likely lift: similar to your last 8-min posts (~2× baseline)"
- ✗ "This will hit 100K views" — banned, unfalsifiable promise

The firewall double-checks: any expected-outcome text that asserts a specific number must trace to a cited prior post. "This will go viral" isn't a number; it's also not allowed — it's a promise dressed as enthusiasm.

## Anti-patterns (the second output)

I also surface 0-3 anti-patterns — things to STOP doing — with citations. Examples:

> "Stop posting on Mondays. Last 4 Monday posts averaged 0.4× baseline; your Monday audience is in work mode, not scroll mode."

> "Stop the 'Hey guys, today we're going to talk about...' opening. Last 6 posts that opened that way had completion rate <30% (your trailing avg is 52%)."

Anti-patterns are optional — if there is no high-confidence pattern to call out, I return `antiPatterns: []`. Not every conversation needs a thing to stop.

## What the creator hears

When this surfaces in a Sunday-night push or a chat reply, the shape is short, plural, in their voice. NOT a wall of text with section headers. NOT "Insight: ... Recommendation: ... Reasoning: ...". Three texts:

> "Two moves for the week. Both grounded in your last 30 days."
> "1) Resume the 8-min long-form — your last one hit 2.4x average and you've gone three weeks without one. Worth a try this week."
> "2) Stop opening with 'Hey guys' — last six posts that did landed under 30% completion. Switch to a specific-number lead."

That's the shape. The creator picks one (or both), and the conversation continues from there.

## How it works (plumbing)

1. Pull the evidence corpus — `creatorPicture`, `recentMetrics`, `goalsFromSoul`, optional `currentStruggle`. Aggregate `postMetrics` into per-format / per-day / per-hook / per-length buckets.
2. Call the model router. `callMaya` with taskTag `weekly_review_synth` (high thinking, clamped per plan tier — Pro and Studio both unlock high; Starter is gated upstream and cannot reach this skill). The prompt asks for 2-5 prioritized moves + 0-3 anti-patterns, each with explicit citations to specific post IDs / metric values / soul anchors.
3. Citation firewall. Pass each move's `evidence` field through `maya-citation-firewall`. Any move that fails is dropped. Same for anti-patterns.
4. If too many drop, retry once. If <2 moves survive, re-prompt with the dropped-citations as feedback. Cap to one retry; if the second attempt still produces <2 surviving moves, return what we have. Better few-and-real than many-and-fictional.
5. Return. Caller (chat / weekly review fold-in / accountability redirect) shapes the surface format.

## Inputs

```ts
{
  creatorPicture: { /* from Convex `creatorPicture` table */ };
  recentMetrics: Array<{ /* from `posts` + `postMetrics` — last 30-60 days */ }>;
  goalsFromSoul: { /* extracted from soul.md */ };
  currentStruggle?: string;
  creatorId: Id<"creators">;
}
```

## Outputs

```ts
{
  moves: Array<{
    priority: 1 | 2 | 3;        // 1 = do this week; 2 = do this month; 3 = consider
    move: string;
    evidence: string;
    expectedOutcome: string;
    timeframe: '1d' | '1w' | '1mo';
  }>;
  antiPatterns: string[];
}
```

## Plan-tier gating (server-side, fail-closed)

- `starter`: action throws `PlanGateError` at entry. Coaching for Starter lives in the lightweight evening-recap behavior; the dedicated coach skill is Pro+.
- `pro`: enabled. High thinking permitted (Pro's max is high).
- `studio`: enabled. May optionally include anonymized peer-benchmark context when the creator has opted in (Studio-only flag in `connectedAccounts`-adjacent settings — Sprint 6 settings UI). v0 ships without the peer-benchmark layer; the field is reserved.

## Citation firewall — non-negotiable here

This skill is the highest-stakes "what should I do" surface in v0. A move with no citation is fiction. The firewall is the gate. The two-pass design (score → drop → retry → ship-what-survives) is the operational pattern that hits the 0% hallucination target on this skill. If >5% of moves get dropped on telemetry, the prompt is wrong and we re-tune.

## What this skill is NOT

- **Not weekly recap.** Recap explains what happened. This says what to do next.
- **Not content planning.** The arc planner produces specific posts; this produces moves at the strategy layer ("post more long-form on Sundays") that the planner then materializes.
- **Not motivational.** No "you got this!" — moves stand on their evidence. The tone slider in `soul.md` modulates delivery, not honesty.
- **Not real-time.** Heavy synthesis; minimum 5-10s latency. I run when the moment calls for it, not on every chat turn.

## Examples

See `examples/fitness-creator-moves.json` for a typical 4-move output for a mid-sized fitness creator.

See `examples/stuck-creator.json` for the `currentStruggle: "I'm tired and falling behind"` variant — moves bias toward smaller, lower-cost re-entry actions.

## Sibling-file references

- Invoked from `agents/skills/maya-platform/playbook.md` § Free-form chat handling, § Weekly review, § Accountability nudge.
- Listed in `agents/skills/maya-platform/SKILL.md` § Custom Maya skills.
- Reads no new tables; relies on existing `creatorPicture`, `posts`, `postMetrics`, and the `soul.md` workspace file.
