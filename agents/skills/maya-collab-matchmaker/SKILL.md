---
name: maya-collab-matchmaker
version: 0.1.0-sprint3.5b
description: Proposes peer creators to DM for collabs. Expands from soul.md namedPeers via ScrapeCreators creator-search by niche tag + similar follower band, scores audience overlap, proposes a collab format per match (duet / guest-podcast / video-collab / IG takeover / cross-shoutout / co-created product), drafts a first-message DM via maya-voice-applier. Excludes direct competitors (overlap > 0.85) and recent same-format collabs.
when-to-use: Weekly Sunday companion to weekly review (cron); on-demand from chat. Output flows to Today as tap-to-DM cards; writes collabMatchLog with creatorActedOn=pending.
plan-tier: ungated (collabMatchEnabled true on every tier per W1-A revised matrix). Studio gets larger maxResults + richer overlap scoring.
thinking-budget: medium
metadata:
  openclaw:
    requires:
      env: []
    tags:
      - collab
      - matchmaker
      - peers
      - scrapecreators
      - creator
---

## Calls

- `maya-citation-firewall` — mandatory; every reasoning string cites peer audience overlap, recent momentum, or creator-supplied namedPeers
- `maya-voice-applier` — mandatory on the first-message draft

## Delegates to

- ScrapeCreators creator-search by niche tag + audience-fingerprint
- model router `callMaya` for match reasoning + first-message draft


# maya-collab-matchmaker

## Why this exists

Collabs are the cheapest, most-undervalued growth lever in the creator
economy. A single well-executed cross-shoutout with a peer of similar
size can deliver more sustained subscribers than a month of organic
posting. But finding the right peer is hard — too small and the trade is
asymmetric; too big and the peer ignores you; too overlapped and you're
fighting for the same attention; too divergent and the audience won't
care.

A good manager keeps a running list of "who could you collab with right
now," weighted by audience overlap and recent momentum. Maya does the
same job, weekly, with citations.

## Inputs

```ts
{
  creatorPicture: {
    niche: string;
    audience: { topGeos: string[]; interestTags: string[]; ageRanges: string[] };
    followerCount: number;
    namedPeers: Array<{ handle: string; platform: string; relationship: 'mutual' | 'follower' | 'admired' }>;
    platforms: Array<'tiktok' | 'instagram' | 'youtube' | 'linkedin' | 'x'>;
    voiceFingerprint: string;
  };
  recentMomentum: 'rising' | 'flat' | 'declining';
  collabHistory: Array<{
    peerHandle: string;
    format: 'duet' | 'guest-podcast' | 'video-collab' | 'instagram-takeover' | 'cross-shoutout' | 'co-created-product';
    outcome: 'great' | 'okay' | 'flop';
    happenedAt: string;        // ISO date
  }>;
  creatorId: Id<"creators">;   // for collabMatchLog dedupe + persistence
  maxMatches?: number;         // Pro default 5, Studio default 10
}
```

## Outputs

```ts
{
  matches: Array<{
    peerHandle: string;
    platform: string;
    followerCount: number;
    niche: string;
    audienceOverlapScore: number;  // 0..1
    recentMomentum: 'rising' | 'flat' | 'declining';
    suggestedFormat: 'duet' | 'guest-podcast' | 'video-collab' | 'instagram-takeover' | 'cross-shoutout' | 'co-created-product';
    reasoning: string;             // 1-2 sentences, citation-grounded
    firstMessageDraft: string;     // voice-applied 2-3 sentence DM opener
  }>;
  antiPatterns: string[];          // 'avoid-direct-competitor' | 'avoid-mismatched-audience-size' | etc.
  citations: Array<{ kind: 'peer' | 'metric'; id: string; fact: string }>;
}
```

## Match search & filtering rules

### Seed
Start from `creatorPicture.namedPeers`. These are the creator's
explicitly-listed peers (collected during onboarding + refreshed on
soul.md updates).

### Expand
For each named-peer's platform + niche, query ScrapeCreators
`creator-search` (or the cached creator-graph if populated) for creators
with:
- Same niche tag
- Follower count within 0.5×–2.0× of the creator's own follower count
  (the "comfortable trade" band — too far outside is asymmetric)
- Recent activity within last 30 days

### Filter
1. **Drop direct competitors.** Audience overlap > 0.85 = saturation;
   you're fighting for the same eyeballs, the collab compounds nothing.
2. **Drop mismatched-audience-size.** Peers > 5× larger or < 0.2× smaller
   than the creator are dropped.
3. **Drop recent same-format collab.** If `collabHistory` shows a collab
   with the same peer in the same format within 90 days, drop. (Repeating
   the same format with the same peer cannibalizes attention.)
4. **Drop flopped peers.** If `collabHistory` shows a `flop` outcome with
   the same peer ever, drop. (Maya doesn't push the creator back into a
   known-bad collab.)

### Score
- **audienceOverlapScore** = ScrapeCreators audience-fingerprint overlap
  (Studio: real fingerprint; Pro: heuristic based on niche tags + geo
  match — Sprint 4 wires the fingerprint cache fully)
- High-value range: **0.30–0.60** (worthwhile)
- Premium range: **0.30–0.50** (high-value collab — overlap exists but
  isn't saturated)
- Drop range: **<0.20** (audiences too divergent) and **>0.85** (saturation)

## Format selection rules

The model picks `suggestedFormat` from the peer's primary platform +
the creator's recent format performance:

- **Same platform + similar size** → `cross-shoutout` or `duet` (TikTok)
  — low-cost, high-frequency option
- **Same platform + 1.5–2.0× size differential** → `video-collab` or
  `instagram-takeover` (the smaller creator gets more value, but it's
  still a worthwhile trade)
- **Different platforms (creator is primarily TikTok, peer is YouTube)**
  → `guest-podcast` (YouTube long-form host invites TikTok-native creator)
- **Strong shared product alignment + 6-month relationship history** →
  `co-created-product` — rare, high-trust path

## Anti-patterns (returned in `antiPatterns` array)

- `avoid-direct-competitor` — when the search surfaced direct competitors
  and dropped them; Maya tells the creator she filtered these out
- `avoid-mismatched-audience-size` — when the search surfaced too-big or
  too-small peers and dropped them
- `avoid-recent-same-format-repeat` — when collab history showed a recent
  same-format collab with a peer that would otherwise have been suggested
- `prioritize-rising-peers` — surfaced as a hint when 2+ rising peers are
  in the matches list; rising peers compound returns

## First-message draft

The first-message draft is a 2-3 sentence DM opener tuned to the
creator's voice. Pattern:

1. Specific opening hook — reference a peer's recent post or pattern
   (cited from ScrapeCreators recent-post pull)
2. Concrete proposal — name the format and a low-friction starting point
3. Out — leave room for the peer to say no without losing face

Maya runs this draft through `maya-voice-applier` so it sounds like the
creator (not like Maya). The fact-preservation guard in voice-applier
ensures the peer's name + the cited post reference are not mutated.

## Plan-tier gating (server-side, fail-closed)

- `starter`: action throws `PlanGateError` at entry.
  `planFeatures(creator).collabMatchEnabled === false` for Starter.
- `pro`: enabled. `maxMatches` default 5. Audience overlap is
  heuristic-based (niche-tag overlap + geo overlap).
- `studio`: enabled. `maxMatches` default 10. Audience overlap uses
  ScrapeCreators audience-fingerprint cache when populated.

## What this skill is NOT

- **Not a peer crawler.** ScrapeCreators is the data source; this skill
  doesn't independently scrape.
- **Not an auto-DM sender.** Maya proposes; the creator taps to send.
  Auto-DM is not in v0 scope (cross-platform DM APIs are too brittle).
- **Not a CRM for tracking collab outcomes.** Persistence to
  `collabMatchLog` is the action layer's job; outcome-marking happens
  on the Today screen.

## Examples

- `examples/fitness-creator-rising-momentum.json` — 30K fitness creator
  with rising momentum gets 4 matches: 2 cross-shoutout candidates + 1
  guest-podcast slot + 1 video-collab
- `examples/declining-creator-prioritize-rising-peers.json` — declining-
  momentum creator gets matches with the `prioritize-rising-peers`
  anti-pattern surfaced as a guidance hint

## Sibling-file references

- Invoked from `agents/skills/maya-platform/playbook.md` § Collab
  matchmaking (lead backfills the cron + playbook entries — Sunday
  companion to `weekly_review_synth`).
- Listed in `agents/skills/maya-platform/skill.md` § Custom Maya skills.
- Reads input from: `creatorPicture.namedPeers` (soul.md), ScrapeCreators
  creator-search (action layer).
- Writes to: `collabMatchLog` (request schema add — see report).
