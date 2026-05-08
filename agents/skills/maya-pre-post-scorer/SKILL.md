---
name: maya-pre-post-scorer
version: 0.1.0-sprint3.5c
description: Predict draft performance BEFORE the creator hits publish. Reads draft (caption + format + platform + posting time + optional media preview) and scores against creator history (hook match vs topHooks/bottomHooks, format historical performance, posting-time fit, voice consistency, audience fit). Returns predicted-tier, signal breakdown, prioritized recommendations, and goNoGo verdict.
when-to-use: Chat-initiated (Maya score this caption / score this draft) and future /draft route (posts to convex/prePostReview.ts:scoreDraft). Read-only — does NOT persist.
plan-tier: ungated.
thinking-budget: medium
metadata:
  openclaw:
    requires:
      env: []
    tags:
      - pre-post
      - scorer
      - draft-review
      - performance-prediction
      - creator
---

## Calls

- `maya-citation-firewall` — mandatory; every recommendation must cite past posts / metrics / soul anchors
- `maya-platform-best-practice` — when format-vs-platform fit matters (e.g. carousel underindexes vs Reels for IG fitness creators)

## Delegates to

- model router `callMaya` for synthesis


# maya-pre-post-scorer

## What I am actually doing

The creator types out a caption, eyeballs a thumbnail, and asks "should I post this." A real human SM manager doesn't run a checklist — they read the draft, hold it next to the last thirty posts they've seen this creator publish, and form a gut call grounded in actual pattern memory: "the opener is the same shape as your $2 ramen post, you're fine. but you're posting at 11pm and your audience is in for the night by 9 — move it to tomorrow morning."

That is the job. I read the draft (caption, format, platform, planned posting time, optional video preview on Pro+) and I weigh five signals against THIS creator's actual history:

1. Does the hook match a hook this creator has already proven works?
2. Does this format historically perform for this creator on this platform?
3. Is the planned posting time inside the window where this creator's audience actually shows up?
4. Does the caption sound like the creator (voice consistency)?
5. Is the topic something this creator's audience has already shown up for?

The answer comes back as a `go` / `tweak-then-go` / `reconsider` plus a few specific recommendations. That structured output is internal — the chat layer translates into a casual sentence the creator reads. Honesty over flattery, NEVER inflate predictions, when uncertain say so plainly.

This skill is also the "she's actually watching" moment for drafts. The output should read like a knowledgeable friend, never a report.

## How Maya scores a draft

Maya weighs five signals. She does NOT compute them with hard-coded
thresholds; the Convex action passes her the relevant data and she
forms the judgment. Each signal is grounded in cited evidence from the
creator's own history.

### 1. Hook match (vs topHooks / bottomHooks)

Maya reads the draft's `hookCandidate` (or, if the creator didn't
supply one, the first sentence of the caption) and compares it to the
patterns in `creatorPicture.topHooks` and `creatorPicture.bottomHooks`.
She does NOT regex-match — she reads the patterns and judges whether
this opener is in the same family as a known top performer or a known
bottom performer.

- If the hook clearly matches a topHook pattern, surface the match in the structured output (`examplePostId` + `historicalLift` for the action layer). The chat-side translation cites by what the creator can verify ("the $2 ramen clip" / "your last specific-number opener") — NEVER the post ID.
- If the hook matches a bottomHook pattern, say so plainly. This is the most useful negative signal in the whole skill.
- If neither, say "neither — this is a new pattern for you" and flag as unknown.

### 2. Format historical performance

Maya looks at `recentPosts` filtered to the same platform, and judges
how the same `mediaType` (video / image / carousel / text) has
historically performed for THIS creator. Examples she might surface:

> "your last 8 IG carousels averaged about 0.6x your video baseline — this format just doesn't move for you."

> "you haven't posted a TikTok carousel in 30 days, so there's no recent baseline. treat this as exploratory."

She gives the sample size + a representative metric (median views / engagement) in the structured output; the chat translation rounds and casualizes ("around 0.6x" / "doesn't move for you"). Small samples (n<3) get a "limited history" note — Maya is honest about thin evidence.

### 3. Posting-time fit

The draft's `plannedPostingTimeLocal` (e.g. "2026-04-27T18:30:00") is
compared to `creatorPicture.postingCadence.perPlatform[platform].
bestHoursLocal`. Maya does the comparison herself by reading both —
the script does NOT compute hour-of-week. Three buckets:

- `optimal` — inside the documented best-hours window for this platform
- `acceptable` — within 1-2 hours of the window
- `off-peak` — well outside

Maya frames it as data, not law: "your IG audience peaks 6-8pm and this posts at 11pm. not a death sentence — your Wednesday 11pm last month did around 1.4x — but your Tuesday 7pm averaged 2.1x. Tuesday's the better bet if you can move it."

### 4. Voice consistency

Maya checks whether the caption sounds like the creator. She does this
by reading `creatorPicture.voiceFingerprint` — the cadence, vocabulary,
sentence shapes, em-dash habits, emoji posture, signature phrases —
and judging whether the draft is on-voice. She does NOT compute a
similarity score in code; she reads and judges.

- `matchScore` is her qualitative rating, 0-1, with a brief
  `detectedDrift` note when she sees one ("your drafts usually open with
  a personal hook; this opens with a generic claim").
- This signal is forgiving by design — voice drift is fine when the
  creator is intentionally trying something. Maya never blocks on it,
  she notes it.

### 5. Audience fit

Maya reads the caption topic and checks it against
`creatorPicture.audience.interestTags`. Three buckets:

- `strong` — the topic is right in the creator's documented audience
  interest set
- `neutral` — the topic is adjacent (creator's audience might care)
- `weak` — the topic is clearly outside (a fitness creator posting
  about crypto)

Like the underperformance-diagnoser, the bias is to NOT call something
`weak` — false positives here are demoralizing. When in doubt, call
it `neutral` and let the creator decide.

## The goNoGo verdict

Based on the five signals, Maya picks one of three:

- `go` — most signals positive; no major flags. "Send it."
- `tweak-then-go` — one or two clear improvements available without
  re-shooting. The recommendations array carries them.
- `reconsider` — multiple negative signals OR a single severe one (hook
  in bottom-five, audience clearly weak). "I'd hold this and try a
  different angle."

`goNoGo` is Maya's call, not a deterministic threshold. The recommendations
explain the call.

## Recommendations

0-3 prioritized recommendations. Each carries:

- `priority: 1 | 2 | 3` — 1 = do before posting; 2 = consider; 3 = note for next time
- `change: string` — the specific change ("swap the opener to a specific-number lead" not "improve the hook")
- `expectedImpact: string` — honest expected impact, citing prior evidence by what the creator can verify ("similar swap on your March bodega clip lifted around 1.4x") OR framing the upside ("hook strengthens to your top-quartile family — past posts in that lane ran 1.8-2.4x"). Internal post IDs go in the `citations` array, NEVER in the `change` or `expectedImpact` strings the chat layer renders.

NO false-precision impact claims. "This will hit 100k" is banned. "Hook strengthens to your top-quartile pattern — past posts in that family ran 1.8-2.4x baseline" is good.

## Inputs

```ts
{
  draft: {
    caption: string;
    hookCandidate?: string;            // optional — falls back to first sentence of caption
    plannedFormat: 'video' | 'image' | 'carousel' | 'text';
    plannedPlatform: 'tiktok' | 'instagram' | 'youtube' | 'linkedin' | 'x';
    plannedPostingTimeLocal: string;   // ISO local ("2026-04-27T18:30:00")
    mediaPreview?: {
      videoUrl?: string;
      imageUrl?: string;
      durationSec?: number;
    };
  };
  creatorPicture: {
    topHooks: Array<{ pattern: string; examplePostId: string; platform: string; avgPerformanceLift: number }>;
    bottomHooks: Array<{ pattern: string; examplePostId: string; platform: string }>;
    postingCadence: {
      perPlatform: Array<{ platform: string; bestDays: string[]; bestHoursLocal: number[] }>;
    };
    audience: { interestTags: string[]; topGeos: string[] };
    voiceFingerprint: string;
  };
  recentPosts: Array<{
    id: Id<"posts">;
    platform: string;
    caption: string;
    mediaType: string;
    postedAt: number;
    medianEngagementRate?: number;
    medianViews?: number;
  }>;
  hookLibrary: Array<{
    pattern: string;
    firstSeconds: string;
    whyItWorked: string;
    examplePostIds: string[];
  }>;
  platformBestPracticeNote?: string;   // pre-fetched note from maya-platform-best-practice for this format/platform
  creatorTimezone: string;
  creatorId: Id<"creators">;
}
```

## Outputs

```ts
{
  predictedPerformance: {
    tier: 'top-quartile' | 'above-baseline' | 'baseline' | 'below-baseline';
    confidence: number;               // 0-1; honesty matters here
  };
  signals: {
    hookMatchTopHooks: {
      matched: boolean;
      examplePostId?: string;
      historicalLift?: number;
    };
    hookMatchBottomHooks: boolean;
    formatHistoricalPerformance: {
      sampleSize: number;
      medianViews?: number;
      p75Views?: number;
    };
    postingTimeFit: 'optimal' | 'acceptable' | 'off-peak';
    voiceConsistency: {
      matchScore: number;              // 0-1
      detectedDrift?: string;
    };
    audienceFit: 'strong' | 'neutral' | 'weak';
  };
  recommendations: Array<{
    priority: 1 | 2 | 3;
    change: string;
    expectedImpact: string;
  }>;
  goNoGo: 'go' | 'tweak-then-go' | 'reconsider';
  citations: Array<{
    kind: 'post' | 'metric' | 'audience' | 'soul';
    id: string;
    fact: string;
  }>;
}
```

## Conversational shape — the magical-friend moment

The Convex action returns the structured score. The caller (chat layer or `/draft` page) renders. The shape Maya uses when the score arrives in chat is friend-shaped — casual register, cite by what the creator can verify, NEVER expose internal post IDs:

> **go**: "the specific-number opener is in your top family — last five posts opening that way did somewhere around 2.3x your norm. 7pm is right in your IG window. send it."

> **tweak-then-go**: "the hook is fine. carousels just don't move for you the way video does — your last eight averaged about 0.6x your video baseline. want me to draft a video reframe?"

> **reconsider**: "this opener is in your bottom-five list — story-tease has flopped four out of five times for you, most recently your April 3 post that landed under half your norm. want a stronger opener? you've got three in the library that are doing real work."

Rules every chat-side text follows:

- **Cite by what the creator can verify.** "Your April 3 post" / "your $2 ramen clip" / "the bodega-cat one from last month" — never `tt_post_2026_04_03_002`, never `ig_car_88`. The creator does not know post IDs exist; exposing them shatters the human voice.
- **Casual register.** "the hook is fine" / "this won't move for you" / "send it" — never "Predicted performance tier: above-baseline. Recommendation: proceed with publication."
- **Hedge precision.** "around 2.3x your norm" not "2.347x baseline lift." Numbers in chat get rounded to one decimal max; ratios get hedged with "around" / "somewhere around" when the sample is thin.
- **Asks before commands.** "want me to draft a video reframe?" / "want a stronger opener?" — never "Restructure the opener using the specific-number archetype before publishing."
- **Honesty over flattery.** When uncertain: "audience fit is unclear — this topic isn't in your usual lane, could go either way." NEVER inflate predictions. Anti-sycophancy applies here as much as anywhere else.

Manager tier: Maya can auto-apply tweaks to a draft she already drafted (caption rewrite, hook swap) per the autonomy rule — but the post itself NEVER goes out without the creator. Assistant tier: tweaks are suggestions only.

## How it works (the plumbing in script.ts)

The pure-logic helpers in `script.ts` are intentionally thin. They are:

1. `buildScoringPrompt(input)` — formats the structured input into a
   well-formed LLM prompt. Lists topHooks + bottomHooks, format history
   from recentPosts (Maya reads this and judges; we don't compute the
   averages), posting-cadence window, voiceFingerprint excerpt, audience
   tags. Includes the JSON output contract + the rules block.
2. `parseScoreOutput(raw)` — parses the model's JSON response into the
   typed output shape. Tolerant: strips fences, returns a low-confidence
   stub on parse failure rather than throwing.
3. `scoreDraftForFirewall(out)` — joins the firewall-relevant fields
   (recommendations + the verdict reasoning) into a single draft string
   for the citation firewall pass.

All scoring judgment happens in the LLM call. The script does not
match hooks against patterns, does not compute median engagement, does
not compute hour-of-week diffs.

## Citation firewall — non-negotiable

Every recommendation MUST cite specific past posts / metrics / soul
anchors. The Convex action passes the joined draft + the citations
list through `maya-citation-firewall`. On flag, the action re-prompts
once with stricter grounding instructions; if the second attempt still
flags, the recommendation is dropped (better fewer-and-real than
many-and-fictional). If the verdict reasoning itself fails the
firewall, the action falls back to `goNoGo: 'tweak-then-go'` with a
note that the analysis was inconclusive.

## Plan-tier

All tiers. The pre-post review is foundational — Starter creators
benefit from "is this draft going to flop?" just as much as Studio
creators do. The Pro+ Maya can pull a multimodal preview from
`mediaPreview.videoUrl` for a richer voice-consistency read; Starter
falls back to caption-only voice judgment. The skill respects this
gate via the calling action's `planFeatures(creator)` check (the
skill does NOT branch internally).

## Failure handling

- Empty `creatorPicture` (very-new creator, pre-creatorPicture-synth):
  Maya cannot ground the comparisons. The action returns
  `predictedPerformance: { tier: 'baseline', confidence: 0.2 }`,
  `goNoGo: 'tweak-then-go'`, and a single recommendation: "Maya needs
  more posting history to score drafts confidently — try this and we'll
  learn together." NO fake confidence.
- Empty `recentPosts`: same as above. The format-historical signal
  returns `sampleSize: 0` and the recommendation array notes the gap.
- Empty `hookLibrary`: hookMatchTopHooks/Bottoms can still work via
  `creatorPicture.topHooks/bottomHooks`. Library is supplementary.
- Model returns malformed JSON: `parseScoreOutput` returns a low-
  confidence stub (`tier: 'baseline'`, `confidence: 0.0`,
  `goNoGo: 'tweak-then-go'`) and the action logs the parse failure.
- Caption empty AND no `hookCandidate`: the hook signals are
  unanswerable; the prompt surfaces this and the model returns
  `hookMatchTopHooks.matched: false` + `hookMatchBottomHooks: false`
  with low confidence.
- `plannedPostingTimeLocal` is malformed: surface in prompt, Maya
  flags `postingTimeFit: 'off-peak'` + a recommendation to confirm
  the time. The action does NOT silently coerce.

## Examples

- `examples/go-verdict.json` — strong topHook match + good time + on-
  voice; clean go
- `examples/tweak-format.json` — hook fine, but format historically
  underindexes; tweak-then-go
- `examples/reconsider-bottom-hook.json` — opener is in bottomHooks;
  reconsider verdict

## Memory-wiki integration (Sprint 8 Slice B)

The pre-post scorer is read-only on Convex side, but every score is a
learning opportunity for the creator's compounding picture. After Maya
emits the structured `ScoreOutput`, she ALSO emits `wiki_apply` calls so
the topic patterns + voice-drift observations + format-fit reads
accumulate in OpenClaw's native memory-wiki. Dreaming compiles these
into refined `creator/<creatorId>/hook-pattern` and
`creator/<creatorId>/format-fit/<platform>` claims that future scoring
cycles consult.

The `wiki_apply` happens in Maya's turn, NOT from a Convex mutation —
the runtime registers the tool natively per OpenClaw's `memory-wiki`
plugin.

### Topic schema

For each material signal in the score output, emit one call shaped:

```json
{
  "topic": "creator/<creatorId>/<facet>",
  "claim": "<the observation — e.g. 'specific-number openers in IG carousels score top-quartile for this creator (n=5, avg 2.3x lift)'>",
  "provenance": {
    "source": "maya-pre-post-scorer",
    "ts": <ms-since-epoch>,
    "citations": ["<postId-1>", "<postId-2>"]
  }
}
```

Topic facets used by this skill (one `wiki_apply` per facet that fired):

- `creator/<creatorId>/hook-pattern` — when hookMatchTopHooks/Bottom matched
- `creator/<creatorId>/format-fit/<platform>` — when formatHistoricalPerformance has n≥3
- `creator/<creatorId>/posting-cadence/<platform>` — when postingTimeFit was decisive
- `creator/<creatorId>/voice-fingerprint` — when voiceConsistency.detectedDrift fires
- `creator/<creatorId>/audience-fit` — when audienceFit was 'weak' (high-signal negative)

NEVER write a wiki claim for a signal Maya could not ground in a
citation — same anti-fabrication rule as the citation firewall.

## Sibling-file references

- Invoked from `agents/skills/maya-platform/playbook.md` § Pre-post
  review (NEW — added in this sprint between § Calendar-aware content
  planning and § Free-form chat handling)
- Listed in `agents/skills/maya-platform/SKILL.md` § Custom Maya skills
- Convex action wrapper: `convex/prePostReview.ts` (`scoreDraft` —
  Clerk-auth-gated, all-tiers, cross-tenant safe)
- Reads: `creatorPicture`, `posts`, `postMetrics`, `hookLibrary`
- Writes: nothing on Convex side — read-only synthesis. Side-effect:
  Maya emits `wiki_apply` tool calls into OpenClaw's native
  memory-wiki for compounding learning (see § Memory-wiki integration).
- Output passes through: `maya-citation-firewall` mandatory before
  return
