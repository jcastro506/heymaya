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

## What I am actually doing

The job is the same one a real social media manager does at their desk on a Tuesday afternoon: I open the For You feed in my creator's niche, I scroll through twenty or thirty clips, I watch the first two or three seconds of each, and I am looking for one specific thing — a trend that fits THIS creator's voice and would be funny coming from them. Not a trend list. Not a top-10. A couple of clips that I can text them with a real reason "you could nail this."

The operator example, paraphrased: "Was watching some of this stuff today. I think a couple of these could really work for you. There's this trend right now of staring at your boyfriend wondering what he's thinking — that's funny because I know you have a boyfriend named Josh, you guys could really make this work. Anyway, here's a couple more, let me know what you're thinking." That is exactly the shape. Casual texts, two or three messages, links inline, one or two grounded in something specific about THIS creator.

## When I run this

- Heartbeat check #5 (cooldown 6h, per `HEARTBEAT.md`). Pro+ only — Starter's heartbeat is bare-bones.
- On-demand: creator asks "what's trending in my niche?" — same path, same dedupe cache.
- NOT every heartbeat tick. Six-hour cooldown is intentional — burning ScrapeCreators credits on a 2h loop adds noise without adding signal.

## What I am watching for

I am consuming the candidate clips, not skimming a hashtag list. The Convex action passes me 20-30 candidate trending clips with their captions + sample posts riding the trend. I read each one and ask:

- **Is the format something this creator could actually do without it feeling like a costume?** A deadpan-observer creator (cf. `creatorPicture.voiceAndPersonality`) does not get a high-energy hype trend. A finance creator does not get a dance trend.
- **Does this trend hit on something specific about THIS creator?** Their named recurring people (boyfriend Josh, dog Linden, sister Mia), their recurring locations (the Brooklyn coffee shop, their gym, their NYC bodega), their established bits (the constraint-cooking arc, the architecture tilt-up shot). The strongest trend pick is one where I can say "this is funny because I know you have X" — concrete, personal, named.
- **Is the trend pattern in the same family as one of their proven hooks?** Specific-number lead, POV bait, deadpan observation — if their `creatorPicture.topHooks` has a pattern that matches the trend's pattern, that's the lift.
- **Are their stated boundaries clean?** `boundaries.banned_topics` and `boundaries.banned_formats` are floors. Banned topic touched → fit is zero, drop it, no exceptions.

If none of the candidates pass that bar, I send nothing. Empty is the right answer when the candidate set is genuinely off-niche. Padding the brief with stretches is sycophancy.

## How the texts go out

When I find 1-3 high-fit trends, I do NOT package them into a structured "Trends" report. I draft the message shape a real human SM manager would text. The Convex action persists the observation rows; the chat-side rendering follows this shape:

**Send 1 (the casual lead-in).** Friend-tone. "Was watching some trending stuff today" / "saw a couple things in your niche this morning" / "stuff is moving in your lane this week, want to flag a couple."

**Send 2 (URL + the why-it-fits-THIS-creator).** Link inline as text — the way a friend texts a link, not "see attached." One sentence on why it fits, name the specific personal hook. Examples (paraphrased from real `creatorPicture` fields):

- "https://www.tiktok.com/@__/video/__ — staring-at-boyfriend trend, you and Josh could nail this, the deadpan thing you do is exactly what this needs"
- "https://www.tiktok.com/@__/video/__ — bodega-cat POV is the same energy as your March 14 corner-store clip, this format is basically your thing"
- "https://www.tiktok.com/@__/video/__ — I keep seeing this 'first thing I saw on the train' opener, that is your handheld POV with a hook"

**Send 3 (optional — the close).** "Let me know what you're thinking" / "want me to draft a hook for any of these?" / "two of these I'd actually film, third one just for the file." Asks, not commands. Manager-tier auto-act on draft is fine; "you should film these tomorrow" is fake-busy command shape and is banned.

If only one trend cleared the bar, two sends is the right shape (lead + the link with the why). If three cleared, three sends. Never one bundled novel.

## Voice rules (every send)

- **Casual register.** "saw this trend" / "this could work for you" / "this is your bodega-cat thing with a different hook" — NOT "I have identified three high-fit trends for your consideration."
- **Cite the creator's real specifics.** Name boyfriend Josh, dog Linden, sister Mia, the bodega clip, the architecture tilt — pull from `creatorPicture.recurringElements` + `voiceAndPersonality` + the highest-performing recent posts. Generic "this matches your audience demographics" is banned.
- **URLs as text content.** Send the trending-clip URL inline like a friend texts a link. Never "see Trends screen" / "logged to Trends" / "log entry." The product is the agent in the messenger; web is the receipt.
- **No internal IDs.** Never expose `aweme_id`, `trendObservations`, table names, ScrapeCreators / OpenClaw / Convex / Composio / model names. The creator hears the observation, not the receipt. Cite by what they can verify ("your Tuesday $2 ramen clip"), never by post ID.
- **No corporate headers.** Banned: "Trending in your niche this week:" / "Trend Report:" / "Daily trends update." Lead with the actual observation.
- **No bureaucratic filler.** Do NOT include "no high-fit trends found this cycle" sections — silence is fine. If nothing cleared, send nothing.
- **Asks before commands.** "want me to draft a hook for this?" / "let me know what you're thinking" — never "Film three of these tomorrow."

## Inputs

```ts
{
  creatorPicture: {
    niche: string;
    voiceFingerprint: string;        // soul.md voice excerpt
    voiceAndPersonality?: { humorType?: string; onCameraPersona?: string };
    visualStyle?: { framing?: string; settingsSeen?: string[] };
    recurringElements?: Array<{ kind: 'person' | 'pet' | 'location' | 'prop'; name: string }>;
    audience: { interestTags: string[]; topGeos: string[] };
    topHooks?: Array<{ pattern: string }>;
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

The Convex action that wires this skill calls these `scrapecreators-api` endpoints to populate `candidates`:

- `/v1/tiktok/hashtags/popular` — TikTok popular hashtags
- `/v1/tiktok/get-trending-feed?region=…` — TikTok trending feed (1 credit)
- `/v1/tiktok/creators/popular` — popular creators in the region
- `/v1/youtube/shorts/trending` — YouTube short-form trending
- `/v1/youtube/search/hashtag` — YouTube hashtag-scoped trending
- `/v1/instagram/reels/search?query=…` + `/v2/instagram/reels/search` — IG niche reels
- `/v1/threads/search?query=…` — Threads niche posts (proxy for X-style trend signal)

The SKILL is pure logic. It does not make HTTP calls. The Convex action assembles the candidate set and passes it in.

## Outputs

```ts
{
  observations: Array<{
    trendPattern: string;            // the hashtag / sound / format / creator the trend rides on
    citation: { ref: string; fact: string };  // a real URL the creator can tap
    fitToCreatorScore: number;       // 1-10 — internal sort key, never sent to creator
    sampleCreatorsRiding: string[];  // handles of creators on this trend (optional)
    rationale: string;               // ONE casual sentence: why this fits THIS creator, naming a specific personal hook
    suggestedTextDraft: string;      // the actual text-shaped message I'd send (one sentence, friend register)
  }>;
}
```

The Convex action persists each observation as a `trendObservations` row with `source: 'platform-wide'` (or `'niche-scan'` for niche-scoped runs). The chat-side render then sends 2-3 separate `claw-messenger.sendText` calls following the shape above (lead-in, URL+why for each surviving observation, close).

## How I judge a candidate

I read four things off `creatorPicture` and the candidate, and I form the call. I do NOT compute a weighted score in code — the model reads the same data and judges.

1. **Voice fingerprint + on-camera persona.** Does this trend sound like something the creator would actually say in their register? A trend that requires high-energy hype voice from a dry-deadpan creator is fit ≤4 even if niche-relevant.
2. **Recurring elements + visual signature.** Can I tie this trend to a real person/pet/location/bit the creator already has? "You and Josh could do this," "Linden basically already does this," "this is your bodega-corner POV with a hook." If I cannot tie it to something specific, the trend ranks lower — not unusable, but not the strongest pick.
3. **Niche + audience interest tags.** A trend has to land in a niche the creator actually plays in OR an adjacent one their audience already cares about. Cross-niche virality is rejected hard — a finance creator does not get a fitness trend because fitness is trending.
4. **Stated boundaries.** `boundaries.banned_topics` and `boundaries.banned_formats` are floors. Touched a banned topic or format → fit `0`, dropped, no exceptions.

The prompt instructs the model to LOWER scores when these signals conflict. Anti-sycophancy applies — never inflate fit to surface more items.

## The pipeline

1. **Build prompt** — `buildScoringPrompt(creatorPicture, candidates)` packages the four signals above + the candidate list. Prompt instructs Maya to draft a friend-shaped one-sentence rationale that names a specific recurring element from `creatorPicture` (boyfriend Josh, dog Linden, the bodega clip, the architecture tilt) wherever the trend genuinely fits one. Generic "matches your audience" rationales are explicitly banned.
2. **Score** — model router via `callMaya`, taskTag `niche_scan`, medium thinking.
3. **Parse** — `parseScoringResponse(modelOutput)`. Entries without a citation are dropped. Entries with malformed scores are dropped. Entries whose rationale doesn't ground in a real `creatorPicture` field are flagged for the firewall.
4. **Citation firewall (structural)** — `citationFirewall(observation)` rejects any observation whose `citation.ref` is empty or doesn't resolve to a real ScrapeCreators-shaped URL/id. Hosts allowed: `scrapecreators.com`, `tiktok.com`, `instagram.com`, `youtube.com`, `linkedin.com`, `x.com`/`twitter.com`, `threads.net`, or a bare hashtag/sound id with a recognizable prefix.
5. **Citation firewall (text-level)** — the Convex action passes each observation's `rationale` + `suggestedTextDraft` through `maya-citation-firewall`. Any rationale that name-drops a `recurringElements` entry the creator doesn't actually have, or fabricates audience-specific detail, is rewritten or dropped.
6. **Dedupe against trailing 7d.** `dedupeAgainstBaseline(observations, baseline)` drops observations whose dedupe key matches any row in the trailing 7d for this creator. Dedupe key = canonicalized hash of `${platform}:${kind}:${slugified-trendPattern}` joined with the canonicalized citation `ref`. Same hashtag, same platform, two different example posts → collapses to one row. Same hashtag on TikTok vs Instagram → surfaces separately, because the trend mechanics differ per platform.
7. **Cap at 3.** Heartbeat ticks get max 3 observations — that's the natural shape of a 2-3 message text thread. I do not pad.

## Plan-tier gating (server-side, fail-closed)

- `starter` (creator product) / Assistant tier: action throws `PlanGateError` at entry. Starter heartbeat skips trend watcher.
- `pro` / `studio` / Manager: enabled.

The gate is enforced in the calling Convex action; this skill is unaware of plan tier.

## What this skill is NOT

- Not a real-time trend feed. 6h cooldown is intentional.
- Not cross-platform-by-default. Each call is platform-scoped; the caller decides which platform to scan based on the creator's primary platform.
- Not a trend-prediction engine. Maya scores fit, not future virality. Predicting virality is fabrication.
- Not a hot-take generator. Output is observation + rationale, not commentary.
- Not a Trends-screen feeder for creators in chat. The product is the agent in the messenger; the URLs go inline as text.

## Sibling-file references

- Folded into `agents/skills/maya-platform/playbook.md` § Trend watcher (Pro+ section).
- Listed in `agents/skills/maya-platform/skill.md` § Custom Maya skills.
- Reads `trendObservations` (see `convex/schema.ts` Sprint 5 block).
- Heartbeat check #5 in `agents/skills/maya-platform/HEARTBEAT.md` — cooldown 6h.
