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

## When I run this

- Heartbeat check #5 (cooldown 6h, per `HEARTBEAT.md`). Pro+ only — Assistant/Starter heartbeat is bare-bones.
- On-demand: "what's trending in my niche?" Same path, same dedupe cache.
- NOT every heartbeat tick. The 6h cooldown is intentional — burning ScrapeCreators credits on a 2h loop adds noise without adding signal.

## What I'm actually doing

A creator's job is making content. Spotting a rising trend in their niche six hours before the rest of the world does is a manager's job. So that's what I do: I pull the platform's popular hashtags + trending feed + popular creators in the niche, score each candidate against THIS creator's voice and stated boundaries, drop the noise, and surface the 2–4 items that actually match what this creator could authentically post.

The thing that separates me from every other trend-watching tool: I reject cross-niche virality if it conflicts with the voice fingerprint. A finance creator does not get told to make dance videos because the dance is trending. The voice anchor is non-negotiable.

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

## How I score a candidate

I read four things off `creatorPicture` and judge from there. I do NOT compute a weighted score in code — the model reads the same data and forms the call.

1. **Voice fingerprint.** Does this trend sound like something the creator would say in their own register? A trend pattern that requires a different tone (e.g. high-energy hype voice, when the creator is dry-deadpan) is fit ≤4 even if niche-relevant.
2. **Niche + audience interest tags.** A trend has to land in a niche the creator actually plays in OR an adjacent one their audience already cares about. Cross-niche virality is rejected hard — a finance creator does not get a fitness trend because fitness is trending.
3. **Stated boundaries.** `boundaries.banned_topics` and `boundaries.banned_formats` are floors, not suggestions. Any candidate that touches a banned topic or format gets fit `0` and is dropped. No exceptions.
4. **Authentic-fit check.** Could the creator make this without it feeling like a costume? If the answer is "they'd have to fake it," fit ≤3.

The prompt instructs the model to LOWER scores when these signals conflict. Anti-sycophancy applies here too — I do not inflate fit to surface more items. Empty `observations` is the right answer when the candidate set is genuinely off-niche.

## The pipeline

1. **Build prompt** — `buildScoringPrompt(creatorPicture, candidates)` packages the four signals above + the candidate list.
2. **Score** — model router via `callMaya`, taskTag `niche_scan`, medium thinking.
3. **Parse** — `parseScoringResponse(modelOutput)`. Entries without a citation are dropped. Entries with malformed scores are dropped. The parser never fabricates.
4. **Citation firewall (structural)** — `citationFirewall(observation)` rejects any observation whose `citation.ref` is empty or doesn't resolve to a real ScrapeCreators-shaped URL/id. Hosts allowed: `scrapecreators.com`, `tiktok.com`, `instagram.com`, `youtube.com`, `linkedin.com`, `x.com`/`twitter.com`, `threads.net`, or a bare hashtag/sound id with a recognizable prefix.
5. **Citation firewall (text-level)** — the Convex action passes each observation's `rationale` through `maya-citation-firewall` to verify that the prose claim ("this matches your audience because…") traces back to the citation `fact` and not to fabricated audience-specific detail.
6. **Dedupe against trailing 7d.** `dedupeAgainstBaseline(observations, baseline)` drops observations whose dedupe key matches any row in the trailing 7d of `trendObservations` for this creator. Dedupe key = canonicalized hash of `${platform}:${kind}:${slugified-trendPattern}` joined with the canonicalized citation `ref`. Same hashtag, same platform, two different example posts → collapses to one row. Same hashtag on TikTok vs Instagram → surfaces separately, because the trend mechanics differ per platform.
7. **Cap at 4.** Heartbeat ticks get max 4 observations. I do not pad.

## Plan-tier gating (server-side, fail-closed)

- `starter` (creator product) / Assistant tier: action throws `PlanGateError` at entry. Starter heartbeat skips trend watcher — see SPRINT_PLAN_V0.md pricing matrix.
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
