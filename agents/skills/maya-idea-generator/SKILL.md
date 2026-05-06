---
name: maya-idea-generator
description: >-
  Generate concrete, voice-anchored content ideas for the upcoming week.
  Composes against the creator's voiceFingerprint, last 30 days of posts,
  top hooks from hookLibrary, and trend candidates from
  maya-trend-watcher. Every idea cites at least two specific recent posts;
  uncited ideas are dropped before they reach the creator. Used by the
  weekly content plan (Sunday 4pm cron) and on-demand from chat
  ("give me ideas for next week").
allowed-tools: Read, Write
metadata:
  openclaw:
    emoji: "💡"
    requires:
      env: []
    tags:
      - content
      - ideation
      - creator
---

# maya-idea-generator

## Why this exists

The weekly content plan (Sunday 4pm) and on-demand chat requests both
need the same shape: a small set of concrete ideas that fit *this*
creator's voice and recent traction, not internet best-practice. The
dangerous failure mode is hallucinated specificity — Maya saying "this
is like your viral X post" when X doesn't exist or wasn't viral. The
citation rule (≥2 real recent posts cited per idea) is the mechanical
gate that keeps the ideas grounded.

## Inputs

```ts
{
  picture: CreatorPicture;            // niche, voiceFingerprint, antiPatterns, audience
  recentPosts: Post[];                // last 30 days, source-of-truth for citation IDs
  topHooks: HookEntry[];              // proven openers from hookLibrary
  trendCandidates: TrendObservation[]; // optional — empty array on slow trend weeks
}
```

## Outputs

```ts
Array<{
  idea: string;                  // one-line idea, in the creator's voice
  hook: string;                  // proposed opener
  format: PostFormat;            // platform-aware format suggestion
  citationToVoiceAnchor: {
    postIds: string[];           // ≥2 real IDs from recentPosts
    fact: string;                // why these anchor the voice claim
  };
  citationToTrend: {
    trendId: string | null;      // null if idea is voice-only, not trend-driven
    fact: string;
  };
  antiPatternFlag: string[];     // surfaces patterns the creator's voice says they avoid
  sortKey: string;               // stable identifier for determinism
}>
```

## Citation rule (the hard gate)

Every idea MUST cite ≥2 real recent posts (post IDs verified against the
`recentPosts` input array). Ideas that cite <2 posts, or cite IDs not
present in `recentPosts`, are dropped before the array is returned. The
parsing layer (`parseIdeasResponse`) does this filtering; the action
layer never sees an idea that fails the gate. This is the only
mechanical gate — fit-scoring, novelty, and creator-relevance are all
the model's judgment, framed by the prompt.

## Anti-pattern flagging

`flagAntiPatterns(idea, picture)` reads `picture.antiPatterns` (a list
of tactics the voiceFingerprint records the creator as deliberately
avoiding — e.g., "never uses cliffhangers", "never starts with a rhetorical
question", "no exclamation points") and surfaces any matches in the idea
or hook text. A flagged idea is NOT dropped — it's returned with the flag
so the upstream action can warn or filter at its discretion. The model
sees the same antiPatterns list in the prompt, so most flags should be
caught at generation time; the flagger is a backstop.

## How it works

`script.ts` exposes pure-logic helpers:

1. `buildIdeationPrompt(picture, recentPosts, topHooks, trendCandidates)` —
   composes the prompt the calling Convex action sends to the model
   router (with `taskTag: "weekly_content_plan"`, high thinking). The
   prompt instructs the model to:
   - cite ≥2 specific real recent posts per idea (by ID)
   - anchor every idea to the voiceFingerprint
   - flag any anti-patterns it considered using
   - never invent post IDs

2. `parseIdeasResponse(modelOutput)` — parses the model's JSON output,
   tolerates code-fence wrappers, drops entries with <2 citations.

3. `validateCitations(idea, recentPosts)` — verifies every cited
   `postId` exists in the `recentPosts` array. Catches hallucinated
   IDs the model invented.

4. `flagAntiPatterns(idea, picture)` — surfaces anti-patterns the
   creator's voiceFingerprint says they avoid.

## Plan-tier behavior

Ungated at the skill level. The calling Convex action MAY trim the
output set (e.g., Starter sees 3 ideas, Pro+ sees 7) but the skill
itself returns whatever survives the citation gate. Plan-tier gating is
enforced by the action's `planFeatures(creator)` check, never by this
skill.

## Failure handling

- Empty `recentPosts` → return `[]` and a one-sentence rationale at the
  action layer ("not enough recent posts to ground ideas yet — post
  three more times this week and I'll have ground to work from").
  Citation gate would fail every idea anyway.
- Empty `trendCandidates` → fine. Ideas can be voice-only with
  `citationToTrend.trendId = null`.
- Model returns malformed JSON → return `[]`, never throw. The action
  layer surfaces a "couldn't draft this round" message.
- Model returns ideas citing unknown post IDs → all such ideas dropped
  silently. Better to return fewer real ideas than ship a fictional one.

## Determinism

Idea structure is sortable by `sortKey` (stable across same-input
re-runs in the parser). The model's creative output is non-deterministic
by nature, but the parsed-output ordering is. This lets the weekly plan
diff stably across re-runs.

## Sibling files

- Referenced in: `agents/skills/maya-platform/playbook.md`
  § Weekly content plan, § Daily niche scan
- Referenced in: `agents/skills/maya-platform/cron.md`
  → `weekly_content_plan`
- Inputs sourced from: `creatorPicture`, `posts`, `hookLibrary`,
  `trendObservations` (Convex schema § Sprint 5)
- Output passes through: `maya-citation-firewall` before persistence
- Companion: `maya-content-arc-planner` (multi-day arc generation
  around a single seed) — this skill produces the candidate set
  arc-planner picks seeds from.
