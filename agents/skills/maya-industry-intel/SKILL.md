---
name: maya-industry-intel
version: 0.1.0-sprint3.5
description: Creator-economy news + platform-policy watcher. Surfaces relevant changes (platform shifts, brand-deal market moves, IG monetization rollouts, manager-economy news) into the morning brief — only items relevant to this creator's niche + platforms. Per-creator dedupe via industryIntelSeen prevents repeats.
when-to-use: Cron-driven daily before morning brief assembly (Industry intel program). On-demand from chat returns the same dedupe-cached items by design.
plan-tier: pro+ (Starter morning brief is bare minimum, no industry intel; gated via proactiveCronAll false on Starter).
thinking-budget: medium
metadata:
  openclaw:
    requires:
      env: []
    tags:
      - industry-intel
      - news
      - platform-policy
      - morning-brief
      - creator
---

## Calls

- `maya-citation-firewall` — mandatory; every item must cite source URL + headline + publishedAt

## Delegates to

- Brave Search via `BRAVE_API_KEY` for the raw news layer
- model router `callMaya` for relevance scoring + summary


# maya-industry-intel

## What I do during the morning scan

A creator's job is making content. A manager's job is reading the room. The manager keeps half an eye on Tubefilter, Variety Intelligence, Marketing Brew, Adweek — not because every story matters, but because three or four times a year a story matters enormously: TikTok-ban legislation moves, IG opens Subscriptions, a CMO survey says "we're shifting 30% of influencer budget to long-form YouTube." Those moments shape what THIS creator should be doing for the next quarter.

I run that scan so the creator doesn't have to. Daily, before the morning brief assembles. I read the headlines, score them against this specific creator's niche and platforms, and surface only what actually matters for them.

## What I read THIS creator's lens through

Before I score a single headline, I pull:

- **`creatorPicture.niche`** — fitness, food, finance, beauty, comedy, etc. THIS creator's lane.
- **The platforms they're on** — TikTok / IG / YouTube / LinkedIn / X. Not "creators in general"; the specific platforms where THIS creator has a handle.
- **`industryIntelSeen` for this creator** — what I've already shown them. Same headline twice in a week is noise.

Then headlines are filtered savagely: only items that touch this creator's niche AND their platforms get surfaced. A LinkedIn algorithm shift doesn't surface for a creator with no LinkedIn handle. A Marketing Brew survey on beauty-influencer rates doesn't surface for a fitness creator. If today's news cycle has nothing relevant, I return `items: []` and a one-line summary that says so. I do NOT invent items to fill the slot.

## What surfaces and what doesn't

I'm filtering for the news a manager would actually text the creator about — not "TikTok announced a feature update" (every day), but "TikTok confirmed the US ban legislation passed the House — your Q3 plan should bias to IG Reels." Score threshold of 50/100 to surface daily; threshold 70 to write to the long-lived memory-wiki (see below).

What gets through:

- Platform-policy shifts (algorithm updates, monetization changes, ban legislation) — when they touch a platform this creator uses.
- Brand-deal market moves (CPM trends, category-specific rate surveys) — when the survey covers this creator's niche.
- Format shifts ("YouTube long-form revenue up 35% YoY") — when the creator has a relevant arm or could.
- Manager-economy news ("indie creators landing direct brand deals at higher rates") — when relevant to this creator's posture.

What doesn't:

- Generic creator-economy news that doesn't touch THIS creator's platforms or niche.
- Hot-take pieces with no underlying news.
- Anything not from the curated allowlist.

## What the creator hears

The morning brief consumes my output as one section. Shape, in their voice:

> "Two things worth knowing this morning."
> "Marketing Brew dropped a survey — beauty rates on IG Reels are up 22% YoY for mid-tier creators. Worth pushing back on the brand-deal floor next negotiation."
> "TikTok confirmed the new comment-pinning rollout is live in US. Your March 14 post got 200+ comments — go pin the top one to seed engagement on the next post."

NOT "Industry intel report. Item 1: Marketing Brew. Item 2: TikTok feature update."

The creator hears two specific things, in their voice, with the why-this-matters baked in. No "Sources: [URL]" footer — the citation firewall has already verified the items internally; the creator doesn't see internal citations.

## Inputs

```ts
{
  creatorContext: {
    niche: string;
    platforms: Array<'tiktok' | 'instagram' | 'youtube' | 'linkedin' | 'x'>;
  };
  creatorId: Id<"creators">;
  maxItems?: number;           // default 5; Studio can request up to 10
}
```

## Outputs

```ts
{
  items: Array<{
    headline: string;
    source: string;
    url: string;
    publishedAt: string;       // ISO date
    relevanceToCreator: string; // 1-2 sentence why-this-matters-to-you
    relevanceScore: number;    // 0-100
  }>;
  summary: string;
}
```

## Sources monitored

The same curated allowlist as `maya-platform-algo-researcher`:

- **Tubefilter** (`tubefilter.com`)
- **Variety Intelligence Platform** (`variety.com/vip`)
- **Modern Retail** (`modernretail.com`)
- **Passionfruit** (`thedailydot.com/passionfruit`)
- **The Information** (`theinformation.com`)
- **Marketing Brew** (`morningbrew.com/marketing`)
- **Adweek** (`adweek.com`)
- **Digiday** (`digiday.com`)
- **IPG creator economy reports** (when surfaced via Adweek / Digiday coverage)
- **ColinAndSamir** (YouTube commentary)
- **Hank Green** (Tumblr / posts indexed)

The allowlist is shared with `maya-platform-algo-researcher`; both skills import `ALLOWED_SOURCE_DOMAINS` from there to keep the policy in one place.

## How it works

1. **Pull candidates.** Brave Search query: `(site:tubefilter.com OR ...) creator economy news` filtered to the last 24h. Take the top 20.
2. **Drop seen items.** Look up each candidate URL in `industryIntelSeen` for this `creatorId`. Drop matches.
3. **Score relevance.** Call the model router (`callMaya`, taskTag `niche_scan`, medium thinking) with the surviving candidates + the creator's niche + platforms. Returns relevance score (0-100) + one-sentence why-this-matters per item.
4. **Filter + rank.** Drop items below relevance threshold (default 50); sort descending; cap to `maxItems`.
5. **Citation firewall.** Pass each surviving item through `maya-citation-firewall` with a citation `{ kind: 'event', id: url, fact: headline + publishedAt + relevanceToCreator }`. Items that fail (e.g. relevance text references creator data not in the input) are dropped.
6. **Write dedupe.** For every surfaced item (post-firewall), insert into `industryIntelSeen` so the next cycle skips it.
7. **Emit `wiki_apply` calls.** For each high-relevance item (≥ 70), emit a `wiki_apply` tool call so the industry-intel claim accumulates in OpenClaw's native memory-wiki. Dreaming compiles cross-cycle patterns ("brand-deal market shifting to long-form") into durable `creator/<creatorId>/industry-intel` claims that the morning-brief assembly + content-arc-planner can query via `wiki_get`.
8. **Return.** Morning-brief assembly consumes this output as a section.

## Memory-wiki integration

Two surfaces: `industryIntelSeen` (dedupe cache) and the OpenClaw native memory-wiki (compounding cross-cycle pattern surface). The wiki write happens in Maya's turn output, NOT from a Convex mutation — `wiki_apply` is an agent tool the runtime registers.

For each surfaced item with `relevanceScore >= 70`, emit one `wiki_apply` call shaped:

```json
{
  "topic": "creator/<creatorId>/industry-intel/<topic-slug>",
  "claim": "<headline + 1-sentence relevance to this creator>",
  "provenance": {
    "source": "maya-industry-intel",
    "ts": <ms-since-epoch>,
    "citations": ["<sourceUrl>"]
  }
}
```

The `<topic-slug>` is derived from the headline / source — the model picks something stable and short so claims about the same trend ("subscriptions-rollout", "brand-deal-rate-survey") accumulate to the same wiki page over time.

Relevance threshold of 70 (vs 50 for daily surface) is deliberate: the wiki is the long-lived moat, so we only persist materially-actionable items.

## Plan-tier gating (server-side, fail-closed)

- `starter`: action throws `PlanGateError` at entry. Starter morning brief intentionally does not include industry intel.
- `pro`: enabled, `maxItems` default 5.
- `studio`: enabled, `maxItems` default 10.

## Citation firewall

Every item carries a real URL with a real `publishedAt`. The firewall verifies the relevance text doesn't fabricate creator-specific claims — e.g. "this matters because your audience is 60% female" must trace back to `creatorPicture.audience.genderSplit` if surfaced. Pure platform / niche claims ("matters for fitness creators because the survey covers fitness") are opinion-shaped and skip the firewall.

## Dedupe via `industryIntelSeen`

The dedupe cache is per-creator (different creators see different items relevant to them). The table is indexed `by_creator_and_url` for the lookup + `by_creator` for cleanup. Garbage collection of rows older than 90d is handled by an infra cron.

## What this skill is NOT

- Not a general newsreader. The allowlist is enforced.
- Not a hot-take engine. Items are surfaced with relevance, not commentary.
- Not real-time. Daily cron is sufficient; v0 will not run hourly.
- Not a brand-news watcher (that's the `maya-brand-deal-triager`'s domain for brand-specific context; this one is industry-wide).

## Examples

See `examples/fitness-creator-pro.json` for a fitness creator on Pro tier getting 4 items in a typical morning cycle.

See `examples/empty-day.json` for a low-news day where nothing crosses the relevance threshold — the skill returns `items: []` and a `summary` that says so. I never invent news to fill the gap.

## Sibling-file references

- Folded into `agents/skills/maya-platform/playbook.md` § Morning brief as a Pro+ section.
- Listed in `agents/skills/maya-platform/SKILL.md` § Custom Maya skills.
- Reads `industryIntelSeen` (see `convex/schema.ts` — added in Sprint 3.5).
