---
name: maya-trend-watcher
version: 0.1.0-sprint5
description: Heartbeat-driven trend watcher. Pulls cross-niche + niche-specific trend signal from ScrapeCreators (popular_hashtags, trendingFeed, popular_creators) for the creator's primary platform, scores each candidate against the creator's voice fingerprint and stated boundaries, and writes high-fit observations to `trendObservations` for the next morning brief. Drops items already seen in the trailing 7-day baseline.
when-to-use: Heartbeat check #5 (cooldown 6h, per HEARTBEAT.md). Also on-demand from chat when the creator asks "what's trending in my niche?" — same path, same dedupe cache.
plan-tier: pro+ (Starter heartbeat is bare minimum and skips trend watcher; gated server-side via `planFeatures.proactiveCronAll`)
thinking-budget: medium
metadata:
  openclaw:
    emoji: "📈"
    requires:
      env:
        - SCRAPECREATORS_API_KEY
    primaryEnv: SCRAPECREATORS_API_KEY
    homepage: https://scrapecreators.com
    tags:
      - trends
      - scraping
      - tiktok
      - instagram
      - youtube
      - linkedin
      - x
      - heartbeat
      - niche-scan
---

## Calls

- `maya-citation-firewall` — mandatory; every observation must cite a real ScrapeCreators URL or trending-feed entry
- `scrapecreators-api` — read layer for the candidate set (`popular_hashtags`, `get-trending-feed`, `creators/popular`)

## Delegates to

- model router `callMaya` for the fit-to-creator scoring pass (medium thinking, `taskTag: "niche_scan"`)


# maya-trend-watcher

## Why this exists

A creator's job is making content. Spotting a rising trend in your niche
six hours before everyone else does is a manager's job. Maya runs the
scan: she pulls the platform's popular hashtags + trending feed +
popular creators in the niche, scores each candidate against THIS
creator's voice and boundaries, drops the noise, and surfaces the 2-4
items that actually match what this creator could authentically post.

This is the skill that prevents Maya from sounding like every other
trend-watching tool: cross-niche virality is rejected if it conflicts
with the creator's voice fingerprint. A finance creator does not get
told to make dance videos because the dance is trending.

## Inputs

```ts
{
  creatorPicture: {
    niche: string;
    voiceFingerprint: string;        // soul.md voice excerpt
    audience: { interestTags: string[]; topGeos: string[] };
    boundaries?: {
      banned_topics?: string[];      // creator-stated no-go topics
      banned_formats?: string[];     // e.g. "shirtless thirst-traps"
    };
  };
  platform: 'tiktok' | 'instagram' | 'youtube' | 'linkedin' | 'x';
  candidates: Array<{
    kind: 'hashtag' | 'sound' | 'video' | 'creator';
    pattern: string;                 // hashtag name, sound title, video title, creator handle
    citation: { ref: string; fact: string };  // real ScrapeCreators URL/id + descriptive fact
    sampleCreatorsRiding?: string[]; // handles of creators already on the trend
    momentum?: string;               // raw momentum hint ("3.2× 24h growth"), kept verbatim
  }>;
  baseline: TrendObservation[];      // trailing 7d of trendObservations for this creator
}
```

The Convex action that wires this skill calls these `scrapecreators-api`
endpoints to populate `candidates`:

- `/v1/tiktok/hashtags/popular` — TikTok popular hashtags
- `/v1/tiktok/get-trending-feed?region=…` — TikTok trending feed (1 credit)
- `/v1/tiktok/creators/popular` — popular creators in the region
- `/v1/youtube/shorts/trending` — YouTube short-form trending
- `/v1/youtube/search/hashtag` — YouTube hashtag-scoped trending
- `/v1/instagram/reels/search?query=…` + `/v2/instagram/reels/search` — IG niche reels
- `/v1/threads/search?query=…` — Threads niche posts (proxy for X-style trend signal)

Per the principal architecture decision: the SKILL is pure logic. It
does not make HTTP calls. The Convex action assembles the candidate set
and passes it in.

## Outputs

```ts
{
  observations: Array<{
    trendPattern: string;            // the hashtag / sound / format / creator the trend rides on
    citation: { ref: string; fact: string };  // a real ScrapeCreators URL/id + the fact it grounds
    fitToCreatorScore: number;       // 1-10
    sampleCreatorsRiding: string[];  // handles of creators on this trend (optional)
    rationale: string;               // one sentence: why this fits THIS creator
  }>;
}
```

The Convex action takes this output and writes a row per observation to
`trendObservations` with `source: 'platform-wide'` (or `'niche-scan'`
for niche-scoped runs).

## How it works

1. **Build the scoring prompt.** `buildScoringPrompt(creatorPicture, candidates)` composes a deterministic prompt that gives Maya the creator's niche, voice fingerprint, audience interest tags, and stated boundaries, plus the candidate list. The prompt instructs Maya to score 1-10 fit-to-creator and to LOWER the score when a candidate conflicts with the voice fingerprint or with `boundaries.banned_topics` / `boundaries.banned_formats`.
2. **Score.** Convex action calls `callMaya` with `taskTag: "niche_scan"` (medium thinking). The model returns structured JSON.
3. **Parse.** `parseScoringResponse(modelOutput)` parses the JSON. Entries without a citation are dropped. Entries with malformed scores are dropped. The parser is strict and never fabricates.
4. **Citation firewall.** Each surviving observation runs through `citationFirewall(observation)`. The firewall checks that `citation.ref` is a non-empty string that looks like a ScrapeCreators URL/id (host on `scrapecreators.com`, `tiktok.com`, `instagram.com`, `youtube.com`, `linkedin.com`, `x.com`/`twitter.com`, `threads.net`, or a bare hashtag/sound id with a recognizable prefix). Hallucinated citations are rejected. The Convex action then layers `maya-citation-firewall` on the rationale text for full grounding.
5. **Dedupe against baseline.** `dedupeAgainstBaseline(observations, baseline)` drops observations whose dedupe key matches any row in the trailing 7d of `trendObservations` for this creator. **Dedupe key = canonicalized hash of `${platform}:${kind}:${slugified-trendPattern}` joined with the canonicalized citation `ref`** — this makes the same hashtag on the same platform cited via two different example posts collapse to one row, but the same hashtag on TikTok vs Instagram surface separately (correctly, because the trend mechanics differ per platform).
6. **Cap.** Caller caps to 4 observations max per heartbeat tick. Maya does not pad.
7. **Return.**

## Plan-tier gating (server-side, fail-closed)

- `starter` (creator product) / Coach tier: action throws `PlanGateError` at entry. Starter heartbeat skips trend watcher — see SPRINT_PLAN_V0.md pricing matrix.
- `pro` / `studio` / Manager: enabled.

The gate is enforced in the calling Convex action; this skill is unaware of plan tier.

## Citation firewall

Two layers:

1. **Skill-level (this file).** `citationFirewall` rejects any observation whose `citation.ref` is empty, malformed, or doesn't look like a real ScrapeCreators-shaped URL/id. This is the cheap structural gate.
2. **Output text-level.** The Convex action passes each observation's `rationale` through `maya-citation-firewall` to verify that the prose claim ("this matches your audience because…") is grounded in the citation `fact`. Any rationale that fabricates audience-specific claims is rewritten or dropped.

Hallucination rate target: 0% on the 50-creator fixture corpus. The dedupe + firewall combination is what hits that.

## Voice rules (locked)

- Anti-sycophancy: never inflate fit scores to surface more items. Empty `observations` is the right answer when the candidate set is genuinely off-niche.
- Trust the model's judgment on fit; do not bolt on hardcoded thresholds in TypeScript. The prompt instructs Maya to score, the parser passes the score through.
- No "AI" in any prose this skill emits. Maya is a manager.
- No marketing-speak ("game-changing", "revolutionary", "incredible"). The rationale is one specific sentence.

## Dedupe via the trailing-7d baseline

The dedupe cache is per-creator and source-scoped (`source: 'platform-wide'` from this skill, `source: 'niche-scan'` from a niche-narrow variant). The baseline is read by the Convex action with `by_creator_and_observedAt` index, scoped to the trailing 7d window. Different creators see different items; we don't want creator A's "seen" to suppress creator B's surface.

## What this skill is NOT

- Not a real-time trend feed. 6h cooldown is intentional — heartbeat shouldn't burn ScrapeCreators credits on tight loops.
- Not cross-platform-by-default. Each call is platform-scoped; the caller decides which platform to scan based on the creator's primary platform.
- Not a trend-prediction engine. Maya scores fit, not future virality. Predicting virality is fabrication.
- Not a hot-take generator. Output is observation + rationale, not commentary.

## Examples

See `examples/` (added by the action lead in a follow-up).

## Sibling-file references

- Folded into `agents/skills/maya-platform/playbook.md` § Trend watcher (Pro+ section).
- Listed in `agents/skills/maya-platform/skill.md` § Custom Maya skills.
- Reads `trendObservations` (see `convex/schema.ts` Sprint 5 block).
- Heartbeat check #5 in `agents/skills/maya-platform/HEARTBEAT.md` — cooldown 6h.
