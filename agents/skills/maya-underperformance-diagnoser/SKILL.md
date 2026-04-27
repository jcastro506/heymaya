---
name: maya-underperformance-diagnoser
version: 0.1.0-sprint3.5c
description: Post-mortem on a bombed post. Maya forms a grounded judgment on WHY a post landed below the creator's trailing baseline (hook drift, off-peak posting, format mismatch, topic fatigue, audience drift, recent platform-algo shift). Mirror skill to maya-hook-extractor (which celebrates top-performers); this one diagnoses the floor.
when-to-use: Folded into Evening recap when one or more posts underperformed vs trailing-30 baseline; on-demand from chat when creator asks why did [post] flop.
plan-tier: ungated.
thinking-budget: medium
---

## Calls

- `maya-citation-firewall` — mandatory; every cause cited must trace to a metric or creatorPicture field
- `maya-platform-best-practice` — optional, when format-mismatch is the suspected cause

## Delegates to

- model router `callMaya` for synthesis

## Persists to

- `postPostmortems`


# maya-underperformance-diagnoser

## Why this exists

Top-performer analysis is well covered (`maya-hook-extractor`, `maya-growth-coach`).
What was missing: when a post underperforms, Maya needs to give the creator
a grounded answer — not "tough day, post again tomorrow." A specific cause
("you used an opener that's in your bottom-five list") is far more useful
than a vague pep-talk, and it's the difference between Maya feeling like a
manager and Maya feeling like a chatbot.

This skill produces that diagnosis. It is post-mortem, not real-time —
runs once a post has had at least one full pull cycle of metrics so the
under-performance is measurable, not just early-window noise.

## Underperformance — how Maya thinks about the threshold

A post is "underperforming" when EITHER of these is true:

- 24h view count is meaningfully below the creator's trailing-30
  P25 (roughly: lower-quartile of the last month's posts on the same
  platform), OR
- engagement rate is meaningfully below the creator's trailing-median
  engagement (around a third or less is severe; half is significant).

Maya does NOT compute these thresholds with hard-coded numbers in code.
The Convex action passes Maya the post's metrics + the trailing baseline
shape (`{ medianViews, medianEngagementRate, p25Views, p75Views }`) and
Maya forms the judgment using her platform expertise + the citation
firewall to back any claim. Severity buckets she uses:

- `mild` — under baseline but inside one standard-deviation noise band; cite
  this and move on, don't over-diagnose
- `significant` — clearly under P25 OR engagement <50% of trailing median;
  worth a short causal write-up
- `severe` — well under P25 AND engagement <30% of trailing median;
  warrants the full diagnostic + a "lessonForNextPost" the creator can
  carry forward

If Maya cannot decide from the data she's given, she returns
`severity: 'mild'` and a low-confidence note rather than confabulating.
Honest uncertainty over false precision.

## How Maya diagnoses the cause

For each underperforming post, Maya weighs these candidate causes in
this rough order. She is not running a checklist — she is forming a
single causal judgment and deciding which of these candidates the data
actually supports. If none are supported, she returns
`primaryCause: 'unknown'` and explains what evidence would be needed.

1. **Hook from the bottom-five list.** Compare the post's hook pattern
   (already extracted into `posts.mayaAnnotation.hookPattern` by
   `maya-hook-extractor` if Pro+; for Starter, Maya reads the first line
   of the caption) against the patterns Maya's
   `creatorPicture.bottomHooks` already records as historical losers
   for this creator. If the patterns line up (same family — POV, listicle,
   question opener, etc.), the hook is the prime suspect. Cite the
   bottomHooks entry and at least one prior post that used the same
   pattern.

2. **Off-peak posting time.** The post's `postedAt` mapped to the
   creator's local timezone gives an hour-of-week. Compare to
   `creatorPicture.postingCadence.perPlatform[platform].bestHoursLocal`.
   If the post landed outside the creator's documented best window for
   this platform, that's a candidate cause. Cite the cadence record + the
   post's local hour.

3. **Format mismatch.** Pull the creator's last 30 days of posts on the
   same platform from `recentPosts`, look at how the same `mediaType`
   (video / image / carousel / text) has historically performed, and
   judge whether this format consistently underperforms for this
   creator. ("Carousels averaged 0.6× video for the last 8" is the kind
   of statement Maya makes — citing the comparable posts.) Format
   mismatch is a real cause far more often than creators realize; do not
   skip it.

4. **Topic fatigue.** Look across the creator's last 7 days of posts.
   If multiple recent posts cover the same topic / used the same hook
   beat / shipped the same caption template, the audience has been
   served too much of the same thing. Maya forms the judgment by reading
   the captions side-by-side; she does NOT compute a token-overlap score
   in code. Surface the count of similar posts in the last 7 days
   (`topicFatigue.similarPostsLast7d`) and cite them by ID. Be careful:
   weekly recurring series are NOT topic fatigue (call them out and
   exclude).

5. **Audience mismatch.** Low-confidence by default; only flag when the
   post's caption + topic clearly references something OUTSIDE
   `creatorPicture.audience.interestTags`. (A fitness creator posting
   about crypto is the cliché example.) Most posts are NOT audience-
   mismatch, so the bias is to NOT flag — false positives here erode
   creator trust.

6. **Recent algorithm change impact.** If `platformAlgoCache` has a
   recent (`researchedAt` within 14 days) row for this platform with a
   `whatsCoolingOff` entry that aligns with this post's pattern (e.g.
   "TikTok is cooling on talking-head intros"), surface it. This is the
   most speculative cause — only include when the alignment is clear,
   and always frame as "may have been a factor" not "this is why." Cite
   the cache row's source URLs.

## Inputs

```ts
{
  post: {
    id: Id<"posts">;
    platform: 'tiktok' | 'instagram' | 'youtube' | 'linkedin' | 'x';
    caption: string;
    mediaType: 'video' | 'image' | 'carousel' | 'text';
    postedAt: number;        // unix ms (UTC) — Maya converts to local using timezone
    hookPattern?: string;    // present when maya-hook-extractor already ran
  };
  postMetrics: Array<{
    ts: number;
    viewCount?: number;
    likeCount?: number;
    commentCount?: number;
    shareCount?: number;
    saveCount?: number;
  }>;
  creatorTrailingBaseline: {
    medianViews: number;
    medianEngagementRate: number;
    p25Views: number;
    p75Views: number;
  };
  creatorPicture: {
    bottomHooks: Array<{ pattern: string; examplePostId: string; platform: string }>;
    postingCadence: {
      perPlatform: Array<{
        platform: string;
        bestDays: string[];
        bestHoursLocal: number[];
      }>;
    };
    audience: { interestTags: string[]; topGeos: string[] };
  };
  recentPosts: Array<{
    id: Id<"posts">;
    platform: string;
    caption: string;
    mediaType: string;
    postedAt: number;
    medianEngagementRate?: number;
  }>;
  recentPlatformAlgoNotes?: string;  // pre-formatted summary of platformAlgoCache.whatsCoolingOff for this platform
  creatorTimezone: string;           // e.g. "America/Los_Angeles"
  creatorId: Id<"creators">;
}
```

## Outputs

```ts
{
  severity: 'mild' | 'significant' | 'severe';
  diagnosis: {
    hookFromBottomList: boolean;
    offPeakPostingTime: boolean;
    formatMismatch: boolean;
    topicFatigue: { detected: boolean; similarPostsLast7d: number };
    audienceMismatch: boolean;
    recentAlgoChangeImpact?: string;   // present only when surfaced; 1-sentence
  };
  primaryCause: string;                // plain-language; one of the six candidates above OR 'unknown'
  secondaryCauses: string[];           // 0-2 contributing factors
  recommendedNextMove: string;         // what to do on the next post — must cite something
  lessonForNextPost: string;           // one-line takeaway the creator can act on
  citations: Array<{
    kind: 'post' | 'metric' | 'audience' | 'cache';
    id: string;
    fact: string;
  }>;
}
```

## Conversational shape (when Maya delivers this in chat or evening recap)

The evening recap consumes the structured output and produces one or two
sentences per underperforming post. Examples Maya should produce
naturally — not from a template, from the diagnosis object:

> "The 4pm TikTok landed at 6k views vs your 22k baseline. The opener
> ('what happened was crazy') is in your bottom-five hook list — 4 of 5
> prior posts using it landed below median. Switch to a specific-number
> lead next time."

> "The Wednesday Reel underperformed (1.2% engagement vs your 3.8%
> trailing). It posted at 11pm local — your IG audience peaks 6-8pm.
> Plus the topic (crypto basics) sits outside your usual fitness lane,
> so the algo had nothing to anchor on."

> "Today's post is mildly under baseline (18k vs ~22k median) but the
> hook is on-brand and the format is in your top quartile — looks like
> noise more than signal. I'll keep watching."

## Honesty rule

This is the easiest skill to over-confidently diagnose. Maya MUST honor:

1. **No false precision.** "Caption uses an under-performing opener
   pattern" is good; "your post would have hit 40k if you'd opened with
   POV" is invented and banned.
2. **Unknown is a valid output.** When the data points all in different
   directions, `primaryCause: 'unknown'` + a frank "the data doesn't
   support a single cause here — sometimes posts just don't ship" is
   the right answer.
3. **No piling on.** Do not surface every candidate cause when one is
   clearly dominant. Pick the primary, list 0-2 secondaries, stop.
4. **Mild = move on.** A `mild` underperformance gets one cited
   sentence. Don't write a paragraph for what is statistical noise.

## How it works (the plumbing in script.ts)

The pure-logic helpers in `script.ts` are intentionally thin. They are:

1. `buildDiagnosisPrompt(input)` — turns the structured input into a
   well-formed LLM prompt. Formats baselines, cadence, recent posts, and
   bottom-hooks into LLM-readable lists. Does NOT pre-decide any cause.
2. `parseDiagnosisOutput(raw)` — parses the model's JSON response into
   the typed output shape. Tolerant to small format drift (strips code
   fences, returns a low-confidence stub on parse failure rather than
   throwing).
3. `formatBaselineHint(baseline, postMetrics)` — produces a one-line
   string Maya can read like "post landed at 6k views in 24h vs trailing
   median 22k / P25 12k" so she doesn't have to do arithmetic in the
   prompt.

All causal reasoning happens in the prompt + Maya's read of the data.
The script does not match hooks against bottomHooks with regex, does
not compute topic-fatigue overlap, does not compute hour-of-week —
those are reasoning Maya does, citing the data she's given.

## Citation firewall — non-negotiable

After Maya produces the diagnosis, the calling Convex action passes
`recommendedNextMove + lessonForNextPost + every claim in
secondaryCauses` (joined into a single draft) plus the citation list
through `maya-citation-firewall`. Any flagged claim must be removed or
re-grounded. If the firewall flags the `primaryCause`, Maya MUST
re-prompt with stricter grounding instructions (one retry); if the
second attempt still fails, the action persists `primaryCause:
'unknown'` and writes a `firewall_failed` marker to `aiCallLog`.

## Persistence

The diagnosis writes one row to the `postPostmortems` table per post.
Schema:

```ts
postPostmortems: defineTable({
  creatorId: v.id("creators"),
  postId: v.id("posts"),
  severity: v.union(v.literal("mild"), v.literal("significant"), v.literal("severe")),
  primaryCause: v.string(),
  secondaryCauses: v.array(v.string()),
  recommendedNextMove: v.string(),
  lessonForNextPost: v.string(),
  diagnosedAt: v.number(),
})
  .index("by_creator", ["creatorId"])
  .index("by_creator_and_post", ["creatorId", "postId"])
```

(Lead authors the schema — flagged in the skill agent's report.)

## Plan-tier

All tiers. Underperformance diagnosis is foundational — Starter creators
benefit from a "why did this flop" answer just as much as Studio
creators do. The Pro+ Maya gets a slightly richer diagnosis because
`maya-hook-extractor` will have already filled `posts.mayaAnnotation.
hookPattern` for her (Starter falls back to the first line of the
caption as the opener proxy).

## Failure handling

- Missing `postingCadence` (rare — happens for very-new creators with
  <14 days of history): Maya skips the off-peak-posting check and notes
  in the output that posting-time data isn't established yet. She does
  NOT make up a "best hours" assumption.
- Empty `recentPosts` (rare — onboarding edge case): Maya can still
  diagnose hook + audience-mismatch + algo-impact, but skips
  format-mismatch and topic-fatigue, surfacing a "limited history" note.
- Empty `bottomHooks` (new creator): the hook check returns
  `hookFromBottomList: false` by definition; Maya can still flag the
  hook as a suspect from platform-best-practice if it is a known weak
  pattern (e.g. opening with a logo card on TikTok), but she frames it
  as "from platform best-practice" not "from your history."
- Model returns malformed JSON: `parseDiagnosisOutput` returns a
  low-confidence stub (`severity: 'mild'`, `primaryCause: 'unknown'`)
  and the action logs the parse failure to `aiCallLog`. Maya stays
  silent on this post in the recap.

## Examples

- `examples/severe-hook-and-time.json` — the textbook severe case:
  bottom-list hook + off-peak time + format mismatch
- `examples/mild-noise.json` — mildly under baseline, no clear cause,
  Maya stays brief
- `examples/topic-fatigue.json` — five posts in seven days about the
  same topic; sixth one tanks

## Sibling-file references

- Invoked from `agents/skills/maya-platform/playbook.md` § Evening
  recap (when 1+ posts today underperformed) and § Free-form chat
  handling (on-demand "why did [post] flop?")
- Listed in `agents/skills/maya-platform/skill.md` § Custom Maya skills
- Reads: `posts`, `postMetrics`, `creatorPicture`, `platformAlgoCache`
- Writes: `postPostmortems` (NEW — schema add flagged in skill report)
- Output passes through: `maya-citation-firewall` mandatory before
  persistence and before any creator-facing surface
