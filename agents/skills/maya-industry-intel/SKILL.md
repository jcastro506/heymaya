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

## When I run this

- Daily cron, before morning brief assembly. Pro+ only — Assistant/Starter morning brief is bare-bones, no industry intel.
- On-demand from chat: same path, same dedupe cache. I will not re-surface items the creator has already seen.
- NOT real-time. Daily is enough. Hourly would be noise theater.

## What I'm actually doing

A creator's job is making content. A manager's job is reading the room. The manager keeps half an eye on Tubefilter, Variety Intelligence, Marketing Brew, Adweek — not because every story matters, but because three or four times a year, a story matters enormously: TikTok-ban legislation moves, IG opens Subscriptions, a CMO survey says "we're shifting 30% of our influencer budget to long-form YouTube." Those moments shape what the creator should be doing for the next quarter.

I run that scan so the creator doesn't have to. I filter savagely: only items that actually touch *this* creator's niche and platforms get surfaced. Everything else is noise. If today's news cycle has nothing relevant to this creator, I return `items: []` and a summary that says so. I do NOT invent items to fill the slot.

## Inputs

```ts
{
  creatorContext: {
    niche: string;             // from creatorPicture.niche
    platforms: Array<'tiktok' | 'instagram' | 'youtube' | 'linkedin' | 'x'>;
  };
  creatorId: Id<"creators">;   // for dedupe lookup against industryIntelSeen
  maxItems?: number;           // default 5; Studio can request up to 10
}
```

## Outputs

```ts
{
  items: Array<{
    headline: string;
    source: string;            // publication name ("Tubefilter", "Marketing Brew")
    url: string;
    publishedAt: string;       // ISO date
    relevanceToCreator: string; // 1-2 sentence why-this-matters-to-you
    relevanceScore: number;    // 0-100, higher = more relevant
  }>;
  summary: string;             // 2-3 sentence digest of the cycle
}
```

## Sources monitored

The same curated allowlist as `maya-platform-algo-researcher` — these are
the publications that consistently produce creator-economy reporting worth
the creator's attention:

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

The allowlist is shared with `maya-platform-algo-researcher`; both skills
import `ALLOWED_SOURCE_DOMAINS` from there to keep the policy in one place.

## How it works

1. **Pull candidates.** Brave Search query: `(site:tubefilter.com OR ...) creator economy news` filtered to the last 24h. Take the top 20.
2. **Drop seen items.** Look up each candidate URL in `industryIntelSeen`
   for this `creatorId`. Drop matches.
3. **Score relevance.** Call the model router (`callMaya`, taskTag `niche_scan`
   clamped to medium thinking) with the surviving candidates + the creator's
   niche + platforms. The model returns a relevance score (0-100) and a
   one-sentence why-this-matters per item.
4. **Filter + rank.** Drop items below a relevance threshold (default 50);
   sort by relevance descending; cap to `maxItems`.
5. **Citation firewall.** Pass each surviving item through
   `maya-citation-firewall` with a citation `{ kind: 'event', id: url, fact: headline + publishedAt + relevanceToCreator }`. Items that fail the firewall (e.g. relevance text references creator data not in the input) are dropped.
6. **Write dedupe.** For every surfaced item (post-firewall), insert into
   `industryIntelSeen` so the next cycle skips it.
7. **Emit `wiki_apply` calls.** For each high-relevance item (≥ 70), emit
   a `wiki_apply` tool call (see § Memory-wiki integration below) so the
   industry-intel claim accumulates in OpenClaw's native memory-wiki.
   Dreaming compiles cross-cycle patterns ("brand-deal market shifting
   to long-form") into durable `creator/<creatorId>/industry-intel`
   claims that the morning-brief assembly + content-arc-planner can
   query via `wiki_get`.
8. **Return.** The morning-brief assembly consumes this output as a section.

## Memory-wiki integration (Sprint 8 Slice B)

The industry-intel skill writes to two surfaces: `industryIntelSeen`
(dedupe cache, prevents repeats) and the OpenClaw native memory-wiki
(compounding cross-cycle pattern surface). The wiki write happens in
Maya's turn output, NOT from a Convex mutation — `wiki_apply` is an
agent tool the runtime registers.

### Topic schema

For each surfaced item with `relevanceScore >= 70`, emit one
`wiki_apply` call shaped:

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

The `<topic-slug>` is derived from the headline / source — the model
picks something stable and short so claims about the same trend
("subscriptions-rollout", "brand-deal-rate-survey") accumulate to the
same wiki page over time.

Relevance threshold of 70 (vs the surface-threshold of 50) is
deliberate: the wiki is the long-lived moat, so we only persist
materially-actionable items. The lower-relevance daily surface still
helps the creator without polluting the wiki with noise.

## Plan-tier gating (server-side, fail-closed)

- `starter`: action throws `PlanGateError` at entry. Starter morning brief
  intentionally does not include industry intel — see SPRINT_PLAN_V0.md
  pricing matrix ("Starter doesn't get morning brief beyond bare minimum").
- `pro`: enabled, `maxItems` default 5.
- `studio`: enabled, `maxItems` default 10.

## Citation firewall

Every item carries a real URL with a real `publishedAt`. The firewall
verifies the relevance text doesn't fabricate creator-specific claims —
e.g. "this matters because your audience is 60% female" must trace back to
`creatorPicture.audience.genderSplit` if surfaced. Pure platform / niche
claims ("matters for fitness creators because the survey covers fitness")
are opinion-shaped and skip the firewall.

## Dedupe via `industryIntelSeen`

The dedupe cache is per-creator (different creators see different items
relevant to them; we don't want creator A's "seen" to suppress creator B's
surface). The table is indexed `by_creator_and_url` for the lookup +
`by_creator` for cleanup. Garbage collection of rows older than 90d is
handled by an infra cron (Sprint 3 has the cleanup job; until then, table
growth is bounded by the volume of distinct surfaced URLs per creator,
which empirically is <100/year).

## What this skill is NOT

- Not a general newsreader. The allowlist is enforced.
- Not a hot-take engine. Items are surfaced with relevance, not commentary.
- Not real-time. Daily cron is sufficient; v0 will not run hourly.
- Not a brand-news watcher (that's the `maya-brand-deal-triager`'s domain
  for brand-specific context; this one is industry-wide).

## Examples

See `examples/fitness-creator-pro.json` for a fitness creator on Pro tier
getting 4 items in a typical morning cycle.

See `examples/empty-day.json` for a low-news day where nothing crosses the
relevance threshold — the skill returns `items: []` and a `summary` that
says so. Maya never invents news to fill the gap.

## Sibling-file references

- Folded into `agents/skills/maya-platform/playbook.md` § Morning brief as
  a Pro+ section. The lead is backfilling that reference per the parent
  agent brief.
- Listed in `agents/skills/maya-platform/SKILL.md` § Custom Maya skills.
- Reads `industryIntelSeen` (see `convex/schema.ts` — added in Sprint 3.5).
