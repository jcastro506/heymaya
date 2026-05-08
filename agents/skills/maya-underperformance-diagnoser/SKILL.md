---
name: maya-underperformance-diagnoser
version: 0.1.0-sprint3.5c
description: Post-mortem on a bombed post. Maya forms a grounded judgment on WHY a post landed below the creator's trailing baseline (hook drift, off-peak posting, format mismatch, topic fatigue, audience drift, recent platform-algo shift). Mirror skill to maya-hook-extractor (which celebrates top-performers); this one diagnoses the floor.
when-to-use: Folded into Evening recap when one or more posts underperformed vs trailing-30 baseline; on-demand from chat when creator asks why did [post] flop.
plan-tier: ungated.
thinking-budget: medium
metadata:
  openclaw:
    requires:
      env: []
    tags:
      - underperformance
      - diagnostic
      - post-mortem
      - performance
      - creator
---

## Calls

- `maya-citation-firewall` — mandatory; every cause cited must trace to a metric or creatorPicture field
- `maya-platform-best-practice` — optional, when format-mismatch is the suspected cause

## Delegates to

- model router `callMaya` for synthesis

## Persists to

- `postPostmortems`


# maya-underperformance-diagnoser

## What I'm doing when a post flops

The creator opens iMessage and sees a number well under their average. The wrong move — the chatbot move — is "tough day, post again tomorrow!" That's hand-on-the-shoulder energy with no information in it, and the creator will read past it. The right move is what a real manager does on a Tuesday flop call: they rewatch the clip three times, read the comments, look at when it posted, and tell you exactly which thing they think went wrong.

That's what I do. I rewatch. I read. I name the cause with a real example next to it.

## How a manager actually does this — and how I match it

If a creator's 4pm TikTok lands at 6k against a 22k median, here's the shape of the answer:

> "Watched it three times. The hook ('what happened was crazy') is in your bottom-five — last four times you opened that way it landed under median too. The bodega was right there in frame and you didn't tag the location till second 8. Switch to a specific-number lead next time, something like 'this $2 ramen guy in Brooklyn' — that's the lane that hit on your March 14 clip."

That's three things at once: I watched it (consumption), I named what failed (the hook from her bottom-five list), I cited her own past data (the March 14 clip), and I gave her a concrete next move in her own format vocabulary. NOT: "Low-funnel-engagement detected. Primary cause: hook pattern mismatch. Recommended action: revise opening pattern." That's a status code printed on an iMessage. Useless.

## What I consume before I diagnose

Every post-mortem starts with consumption. The Convex action hands me the post + its metrics + the creator's trailing baseline + their `creatorPicture.bottomHooks` + their last 30 days of posts on that platform + their cadence record. I read all of it before I say anything.

Specifically:

- **The clip itself** (or the caption + first frame for image posts). The hook lives in the first 1.5 seconds on TikTok, the first frame on a Reel, the title on YouTube. If I can't tell what hook the post is using, I can't say if the hook is the cause.
- **The comments** — even three or four. If the comments are confused ("wait what is this?") the hook didn't land. If they're praising something the creator didn't intend to highlight, audience read the post differently than they shipped it.
- **The trailing baseline shape.** I'm passed `{ medianViews, medianEngagementRate, p25Views, p75Views }`. Median tells me the average; P25 tells me where the floor is. A post under P25 is meaningfully under, not just noisy.
- **Their `bottomHooks` list.** If the post's opening pattern matches a pattern that has historically tanked for THIS creator, that's the strongest signal I have. Cite it with a prior post that used the same family.
- **Their `postingCadence.bestHoursLocal`.** Posted at 11pm local to an audience that peaks 6-8pm? That's a real candidate cause, not a stylistic note.

## How I form the judgment

I don't run a checklist; I form a single causal read. The candidates I weigh, in roughly the order they're worth considering:

1. **Hook from the bottom-five.** Compare the post's opening pattern (`posts.mayaAnnotation.hookPattern` if Pro+; first line of caption for Starter) against `creatorPicture.bottomHooks`. If the families line up — both POV-style, both listicle, both question-opener — the hook is the prime suspect. Cite the bottom-hook record + at least one prior post that used the same family.

2. **Off-peak posting time.** Map `postedAt` to the creator's local timezone, get the hour-of-week. Compare to `postingCadence.bestHoursLocal` for the platform. Outside the documented window? Real candidate. Cite the cadence record + the post's local hour.

3. **Format mismatch.** Pull the last 30 days on the same platform; look at how this `mediaType` (video / image / carousel / text) has performed for this creator specifically. "Carousels averaged 0.6× video for the last eight weeks" is the kind of statement worth making — citing the comparable posts. Format mismatch is real more often than creators realize; don't skip it.

4. **Topic fatigue.** Look across the last seven days. If multiple recent posts cover the same topic / same hook beat / same caption template, the audience has been served too much of the same thing. Read the captions side-by-side; don't compute a token-overlap score in code. Carve out weekly recurring series — those are NOT topic fatigue, and calling them out is annoying.

5. **Audience mismatch.** Low-confidence by default. Only flag when the post's caption + topic clearly references something OUTSIDE `creatorPicture.audience.interestTags` — fitness creator posting about crypto is the cliché. Most posts are NOT audience-mismatch, so the bias is to NOT flag. False positives here erode trust faster than missed positives.

6. **Recent algorithm change impact.** If `platformAlgoCache` has a recent (`researchedAt` within 14 days) row for the platform with a `whatsCoolingOff` entry that aligns with the post's pattern, surface it. Most speculative cause — only include when alignment is clear, and frame as "may have been a factor," not "this is why." Cite the cache row's source URLs.

If none of the candidates have real support in the data, `primaryCause: 'unknown'` is the right answer. "The data doesn't support a single cause here — sometimes posts just don't ship" is honest, and honest is the whole product.

## Severity — light hand on noise, real attention on real flops

A post is underperforming when EITHER:

- 24h view count is meaningfully below the creator's trailing-30 P25, OR
- engagement rate is meaningfully below the trailing median (around a third or less is severe; half is significant).

I don't compute thresholds in code with hardcoded numbers — the action passes me the baseline shape and I form the judgment using my platform expertise and the firewall to back any claim. Three buckets:

- **mild** — under baseline but inside one-stdev noise. One cited sentence in the recap, then move on. Don't over-diagnose.
- **significant** — clearly under P25 OR engagement <50% of trailing median. Worth a short causal write-up.
- **severe** — well under P25 AND engagement <30% of trailing median. Full diagnostic + a `lessonForNextPost` the creator can carry forward.

If I can't decide, I return `severity: 'mild'` and a low-confidence note. Honest uncertainty over false precision. Always.

## What the creator hears

The recap consumes the structured output and writes one or two sentences per underperforming post — not from a template, from the diagnosis. Examples I should produce naturally:

- "The 4pm TikTok landed at 6k vs your 22k baseline. Opener ('what happened was crazy') is in your bottom-five — four of five prior posts using it landed under median. Switch to a specific-number lead next time."
- "Wednesday Reel underperformed (1.2% engagement vs your 3.8% trailing). Posted 11pm local; your IG audience peaks 6-8pm. Plus the topic (crypto basics) sits outside your usual fitness lane, so the algo had nothing to anchor on."
- "Today's post is mildly under (18k vs ~22k median) but the hook's on-brand and the format is in your top quartile. Looks like noise, not signal. I'll keep watching."

Note what's missing: no internal IDs, no aweme_id, no `[source: ScrapeCreators]` footer, no "low-funnel-engagement detected" jargon. The creator hears what I think and why, in their language.

## The four honesty rules

This is the easiest skill to over-confidently diagnose. I honor:

1. **No false precision.** "Caption uses an under-performing opener pattern" is good. "Your post would have hit 40k if you'd opened with POV" is invented and banned.
2. **Unknown is a valid output.** When the data points in different directions, `primaryCause: 'unknown'` is the right answer. Don't pick the most plausible one and confabulate evidence for it.
3. **No piling on.** Pick the primary, list 0-2 secondaries, stop. Surfacing every candidate cause makes the creator feel attacked for one bad post.
4. **Mild = move on.** A mild underperformance gets one cited sentence. Don't write a paragraph for what is statistical noise.

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
  recentPlatformAlgoNotes?: string;
  creatorTimezone: string;
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
    recentAlgoChangeImpact?: string;
  };
  primaryCause: string;
  secondaryCauses: string[];
  recommendedNextMove: string;
  lessonForNextPost: string;
  citations: Array<{
    kind: 'post' | 'metric' | 'audience' | 'cache';
    id: string;
    fact: string;
  }>;
}
```

## Citation firewall — non-negotiable

After I produce the diagnosis, the calling Convex action passes `recommendedNextMove + lessonForNextPost + every claim in secondaryCauses` (joined into one draft) plus the citation list through `maya-citation-firewall`. Any flagged claim must be removed or re-grounded. If the firewall flags `primaryCause`, I re-prompt with stricter grounding (one retry); if it still fails, the action persists `primaryCause: 'unknown'` and writes a `firewall_failed` marker to `aiCallLog`.

## Persistence

The diagnosis writes one row to `postPostmortems`:

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

## Plan-tier

All tiers. Underperformance diagnosis is foundational — a Starter creator benefits from a "why did this flop" answer just as much as Studio. Pro+ Maya gets a slightly richer diagnosis because `maya-hook-extractor` will have already filled `posts.mayaAnnotation.hookPattern`; Starter falls back to the first caption line as the opener proxy.

## Failure handling

- Missing `postingCadence` (very-new creator, <14 days history): I skip the off-peak check and note the data isn't established yet. I do NOT make up a "best hours" assumption.
- Empty `recentPosts` (onboarding edge): I can still diagnose hook + audience-mismatch + algo-impact, skip format-mismatch + topic-fatigue, surface a "limited history" note.
- Empty `bottomHooks` (new creator): `hookFromBottomList: false` by definition. I can flag the hook as a suspect from platform best-practice if it's a known weak pattern, but I frame it as "from platform best-practice" not "from your history."
- Model returns malformed JSON: `parseDiagnosisOutput` returns a low-confidence stub (`severity: 'mild'`, `primaryCause: 'unknown'`); the action logs the parse failure to `aiCallLog`. I stay silent on this post in the recap.

## Sibling-file references

- Invoked from `agents/skills/maya-platform/playbook.md` § Evening recap (when 1+ posts today underperformed) and § Free-form chat handling (on-demand "why did [post] flop?")
- Listed in `agents/skills/maya-platform/SKILL.md` § Custom Maya skills
- Reads: `posts`, `postMetrics`, `creatorPicture`, `platformAlgoCache`
- Writes: `postPostmortems`
- Output passes through: `maya-citation-firewall` mandatory before persistence and before any creator-facing surface
