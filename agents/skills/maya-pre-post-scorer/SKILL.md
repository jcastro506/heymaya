---
name: maya-pre-post-scorer
version: 0.1.0-sprint3.5c
description: Predict draft performance BEFORE the creator hits publish. Reads draft (caption + format + platform + posting time + optional media preview) and scores against creator history (hook match vs topHooks/bottomHooks, format historical performance, posting-time fit, voice consistency, audience fit). Returns predicted-tier, signal breakdown, prioritized recommendations, and goNoGo verdict.
when-to-use: Chat-initiated (Maya score this caption / score this draft) and future /draft route (posts to convex/prePostReview.ts:scoreDraft). Read-only — does NOT persist.
plan-tier: ungated.
thinking-budget: medium
---

## Calls

- `maya-citation-firewall` — mandatory; every recommendation must cite past posts / metrics / soul anchors
- `maya-platform-best-practice` — when format-vs-platform fit matters (e.g. carousel underindexes vs Reels for IG fitness creators)

## Delegates to

- model router `callMaya` for synthesis


# maya-pre-post-scorer

## Why this exists

The single most-requested creator-tool feature in 2025-26 industry
research: "tell me if this is going to flop BEFORE I post it." Most
tools that try this fall into two failure modes — generic checklists
("did you use a hook?") or fake-confident predictions ("this will hit
80K views!"). Both erode trust the moment the creator's actual results
diverge.

This skill is the in-between: a grounded read against the creator's
own history. Maya does not predict from internet best-practices; she
predicts from THIS creator's last 30 posts. When she's uncertain, she
says so. When the data is clear, she's specific.

It is also the skill that delivers the "she's actually watching"
moment. The output should read like a knowledgeable friend, not a
report.

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

- If the hook clearly matches a topHook pattern, surface the match: name
  the example postId + the historical lift ("2.3× baseline"). Cite.
- If the hook matches a bottomHook pattern, say so plainly. This is
  the most useful negative signal in the whole skill.
- If neither, say "neither — this is a new pattern for you" and flag as
  unknown.

### 2. Format historical performance

Maya looks at `recentPosts` filtered to the same platform, and judges
how the same `mediaType` (video / image / carousel / text) has
historically performed for THIS creator. Examples she might surface:

> "Your last 8 IG carousels averaged 0.6× your video baseline — this
> format underindexes for you."

> "You haven't posted a TikTok carousel in 30 days, so I have no
> recent baseline. Treat this as exploratory."

She gives the sample size + a representative metric (median views /
engagement). Small samples (n<3) get a "limited history" note — Maya
is honest about thin evidence.

### 3. Posting-time fit

The draft's `plannedPostingTimeLocal` (e.g. "2026-04-27T18:30:00") is
compared to `creatorPicture.postingCadence.perPlatform[platform].
bestHoursLocal`. Maya does the comparison herself by reading both —
the script does NOT compute hour-of-week. Three buckets:

- `optimal` — inside the documented best-hours window for this platform
- `acceptable` — within 1-2 hours of the window
- `off-peak` — well outside

Maya frames it as data, not law: "Your IG audience peaks 6-8pm; this
posts at 11pm. That's not a death sentence — your Wednesday 11pm last
month did 1.4× — but your Tuesday 7pm averaged 2.1×. Tuesday is the
better bet if you can move it."

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

- `priority: 1 | 2 | 3` — 1 = do before posting; 2 = consider; 3 = note
  for next time
- `change: string` — the specific change ("swap the opener to a
  specific-number lead" not "improve the hook")
- `expectedImpact: string` — honest expected impact, citing prior
  evidence ("similar swap on tt_post_2026_04_15 lifted 1.4×") OR
  framing the upside ("hook is in your top quartile family — likely
  similar lift")

NO false-precision impact claims. "This will hit 100k" is banned. "Hook
strengthens to your top-quartile pattern — past posts in that family
ran 1.8-2.4× baseline" is good.

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

The Convex action returns the structured score. The caller (chat layer
or `/draft` page) renders. The conversational shape Maya uses when the
score arrives in chat:

> **go**: "This hook is in your top-quartile family — last 5 posts using
> a specific-number opener averaged 2.3× baseline (most recent:
> ig_reel_2026_04_19_006). Posting at 7pm local is right in your IG
> window. Send it."

> **tweak-then-go**: "Hook is fine; format underindexes for you —
> carousels averaged 0.6× video for the last 8 (sample posts:
> ig_car_88, ig_car_92, ig_car_97). Want me to suggest a video reframe?"

> **reconsider**: "This opener is in your bottom-five list — 4 of 5
> prior posts using 'story-tease' landed below median (most recent:
> tt_post_2026_04_03_002 at 0.018 engagement vs your 0.046). Want a
> stronger opener? I have three from your hook library."

Honesty over flattery. NEVER inflate predictions. When uncertain, say
so plainly: "audience fit is unclear — this topic isn't in your usual
lane, could go either way." Anti-sycophancy reaffirmed (per `playbook.md
§ 1`).

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

## Sibling-file references

- Invoked from `agents/skills/maya-platform/playbook.md` § Pre-post
  review (NEW — added in this sprint between § Calendar-aware content
  planning and § Free-form chat handling)
- Listed in `agents/skills/maya-platform/skill.md` § Custom Maya skills
- Convex action wrapper: `convex/prePostReview.ts` (`scoreDraft` —
  Clerk-auth-gated, all-tiers, cross-tenant safe)
- Reads: `creatorPicture`, `posts`, `postMetrics`, `hookLibrary`
- Writes: nothing — read-only synthesis
- Output passes through: `maya-citation-firewall` mandatory before
  return
