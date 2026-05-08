---
name: maya-opportunity-scout
version: 0.1.0-sprint3.5b
description: Daily scan of UGC-marketplace listings (Aspire, GRIN, Creator.co, Modash, Backstage, Mavrck), X creator-call hashtags, and operator-requested LOCAL brand search via Brave. Ranks by fit and dedupes via opportunityScoutSeen. Pairs with maya-pitch-strategy + maya-brand-outreach to close the proactive-pitching loop.
when-to-use: Cron-driven daily; on-demand from chat for find me brands in my area / what UGC briefs are out today. Output consumed by morning brief (top 3 highest-fit), Today (full list), and brand-outreach pipeline (creator-confirmed opportunities flow to pitch-strategy then outreach).
plan-tier: ungated (opportunityScoutEnabled true on every tier per W1-A revised matrix). Studio gets larger maxResults + Apollo/Hunter contact discovery on surfaced opportunities.
thinking-budget: medium
metadata:
  openclaw:
    requires:
      env: []
    tags:
      - opportunity-scout
      - ugc-marketplace
      - brand-discovery
      - creator
---

## Calls

- `maya-citation-firewall` — mandatory; every reasoning string cites the source URL + the creator-fit factors

## Delegates to

- Brave Search via `BRAVE_API_KEY` (site-restricted operators per source)
- model router `callMaya` for fit-scoring
- ScrapeCreators X-search if available (for #creatorcall hashtag scan; else Brave fallback)


# maya-opportunity-scout

## How I think about this

The hardest gap between a 50K creator and a working pro creator isn't talent — it's deal flow. Pros have inboxes full of inbound; everyone else has to hunt. UGC marketplaces (Aspire, GRIN, Creator.co), creator-call tweets, and local brand searches are public information, but no single creator has time to scan them daily. I do that scan, filtered to opportunities that fit THIS creator's niche, follower band, and (when relevant) location.

**Local brand search** is the highest-conversion source I surface. Most beginner-to-mid creators massively under-pitch their own city. A small fitness brand in Austin will reply to an Austin-based 30K fitness creator at roughly 10x the rate of a NYC brand they have no geographic anchor to. I surface local brands proactively — that's the conversion edge.

The output of this skill flows into `maya-pitch-strategy` (decides angle + rate) → `maya-brand-outreach` (drafts the email + enforces the 5/day cap). I'm the surface; outreach is the act.

## Workflow — what I actually do

1. **Build the deterministic query set** (`buildScoutQueries` in script.ts) — one per source, parameterized by niche / location / platforms.
2. **Pull candidates** via Brave Search (site-restricted) and ScrapeCreators X-search where available. Top-N per query, dedupe on canonical URL within the cycle.
3. **Drop seen URLs** against `opportunityScoutSeen` for this creator. Same URL never surfaces twice.
4. **Fit-score the survivors** (model router, medium thinking) on niche match, follower-band match, geographic match, platform match.
5. **Firewall every reasoning string** against the source URL + the fit factors named in the score.
6. **Persist seen** so next cycle skips them.
7. **Return ranked-by-fit.** The morning brief takes the top 3; Today shows the full list; outreach pipeline pulls anything tagged `pitch`.

## When I sit out

- **Brave returns 0 results.** Empty return, honest message: *"Quiet day on the boards — no new opportunities to surface."* I do NOT invent listings.
- **All-seen day.** Same empty return: *"Surface is caught up — I'll re-scan tomorrow."*
- **Suspicious-snippet load.** If >50% of returned snippets look like promo/affiliate spam (common on cluttered query days), I drop the cycle and tell the creator: *"Today's scrape was mostly affiliate-spam — sitting out, will re-run tomorrow."*

## Inputs

```ts
{
  creatorPicture: {
    niche: string;
    audience: { topGeos: string[]; interestTags: string[] };
    followerCount: number;
    locationSoul: { city?: string; state?: string; country?: string };
  };
  platforms: Array<'tiktok' | 'instagram' | 'youtube' | 'linkedin' | 'x'>;
  lookbackHours: number;            // default 24
  maxResults?: number;              // Pro default 10, Studio default 20
  creatorId: Id<"creators">;        // for dedupe lookup against opportunityScoutSeen
}
```

## Outputs

```ts
{
  opportunities: Array<{
    source: 'aspire' | 'grin' | 'creator-co' | 'modash' | 'backstage' | 'mavrck' | 'twitter-creator-call' | 'local-brand-search';
    title: string;
    brandName?: string;             // populated when extractable from listing
    fit: number;                    // 0..1
    suggestedAction: 'pitch' | 'apply' | 'monitor' | 'skip';
    reasoning: string;              // 1-2 sentences citing the fit factors
    dueDate?: string;               // ISO date when listing has a deadline
    estimatedRateRange?: { low: number; high: number };
    url: string;
  }>;
  dedupedAgainst: number;           // how many candidates were filtered out as already-seen
  citations: Array<{ kind: 'event' | 'metric'; id: string; fact: string }>;
}
```

## Sources

UGC-marketplace listings via Brave Search with site-restricted operators
(none of these have public read APIs we can rely on for v0; the listings
themselves are HTML pages indexed by Brave):

- Aspire: `site:aspire.io creator OR brand brief`
- GRIN: `site:grin.co creator opportunities`
- Creator.co: `site:creator.co briefs`
- Modash: `site:modash.io campaign listings`
- Backstage: `site:backstage.com (sponsored OR ugc)`
- Mavrck: `site:mavrck.io brand opportunities`

Twitter/X creator-call hashtags via either ScrapeCreators X-search (if
the integration supports search) or Brave fallback:

- `#creatorcall`, `#ugccreator`, `#contentcreatorneeded`,
  `#brandpartnership`

**Local brand search (the operator-requested addition):**

Given `locationSoul.city` + `state`, run Brave queries:

- `"best ${niche} brands ${city} ${state}"`
- `"small business ${city} looking for content creator"`
- `"${niche} startup ${city}"`
- `"${niche} local brand ${city}"`

The local-brand-search source surfaces brands that haven't yet built a
creator pipeline — these have the highest pitch-conversion rate (a cold
email to a local startup beats a cold email to Nike's social team by
orders of magnitude in reply rate).

## How it works

1. **Build queries.** `script.ts:buildScoutQueries` produces the deterministic
   set of queries — one per source, parameterized by niche / location /
   platforms.
2. **Pull candidates.** Convex action runs each query against Brave; takes
   top-N per query. Strip duplicates within the cycle by canonical URL.
3. **Drop seen.** `script.ts:dropSeen` removes URLs the creator has already
   been shown (looked up in `opportunityScoutSeen`).
4. **Fit-score.** Pass surviving candidates + the creator's niche / size /
   platforms / location to the model router (`callMaya`, taskTag `niche_scan`,
   medium thinking) for the `fit` score, `reasoning`, and
   `suggestedAction`.
5. **Citation firewall.** Every reasoning string passes through the firewall
   with citations naming the source URL and the fit factors (niche match,
   follower-band match, geographic match, platform match).
6. **Persist seen.** Insert each surfaced opportunity URL into
   `opportunityScoutSeen` so the next cycle skips it.
7. **Return.** Caller (morning-brief assembly / Today surface / outreach
   pipeline) consumes ranked-by-fit list.

## Fit scoring rubric (encoded in the model prompt)

The prompt instructs the model to score on:

- **Niche match** — does the brand sell into this creator's niche?
  (binary-ish; partial credit for adjacent niches)
- **Follower-band match** — does the brand typically work with creators
  in this size range? (huge brands tend to skip <50K creators)
- **Geographic match** — is this brand local to the creator? (local brands
  pitch-convert at 5-10× the rate of remote)
- **Platform match** — does the brand request a platform the creator
  actively uses?

The output `fit` is the model's holistic 0..1 score; the reasoning string
must cite which factors drove it.

## suggestedAction logic

- `pitch` — fit ≥ 0.6 AND brand contact info findable (Studio with
  Apollo/Hunter, or creator-supplied) — caller routes to pitch-strategy
  → brand-outreach
- `apply` — fit ≥ 0.5 AND source is a marketplace (creator clicks through
  to the marketplace and applies via their flow)
- `monitor` — fit between 0.3-0.5 — Maya keeps watching but doesn't push
- `skip` — fit < 0.3

## Plan-tier gating (server-side, fail-closed)

`opportunityScoutEnabled` is `true` on both Coach and Manager.

- `coach`: enabled. `maxResults` default 10. Local-brand-search runs. Surfaced opportunities can flow to brand-outreach as drafts when the creator manually pastes a contact email — autonomous send is Manager-only.
- `manager`: enabled. `maxResults` default 20. The wrapping action invokes `brandContactDiscoveryEnabled` (Apollo/Hunter) on `pitch`-action opportunities to backfill contact email/name when an Apollo key is configured. Without a key, the manager-tier flow falls back to coach-tier behavior (creator-paste required).

## Adversarial / robustness

- Brave returns 0 results → return `{ opportunities: [], dedupedAgainst: 0,
  citations: [] }`. Maya tells the creator: "Quiet day on the boards — no
  new opportunities to surface." She does NOT invent listings.
- All-seen day → same empty return; Maya tells the creator the surface is
  caught up.
- Adversarial listing content (prompt-injection in a Brave snippet) →
  the firewall is the gate; if the model's reasoning makes a claim not
  supported by the listing snippet itself, it's flagged and dropped.

## What this skill is NOT

- **Not a brand database.** It scans public listings + searches; it does
  not maintain a brand registry.
- **Not a contact-discovery service.** That's `brandContactDiscoveryEnabled`
  (Studio) wired to Apollo/Hunter at the action layer.
- **Not auto-pitch.** This skill surfaces; the creator approves; the
  pitch flows through `maya-pitch-strategy` → `maya-brand-outreach`.

## Examples

- `examples/fitness-30k-austin.json` — fitness creator in Austin gets
  4 surfaced opportunities (2 marketplace + 2 local brand searches)
- `examples/quiet-day-no-results.json` — Brave returns 0; skill emits
  empty opportunities + honest message; no fabrication

## Memory-wiki integration (Sprint 8 Slice B)

Beyond the per-cycle `opportunityScoutSeen` dedupe cache, every surfaced
opportunity at fit ≥ 0.6 also persists to OpenClaw's native memory-wiki
via `wiki_apply`. The compounding signal: which sources / brand
profiles / pitch angles actually convert for THIS creator. Dreaming
compiles those into durable
`creator/<creatorId>/opportunity-pattern/<source>` claims that the
pitch-strategy skill can read via `wiki_get` next cycle.

The `wiki_apply` happens in Maya's turn from the runtime's native
memory-wiki tool — NOT from a Convex mutation.

### Topic schema

```json
{
  "topic": "creator/<creatorId>/opportunity-pattern/<source>",
  "claim": "<brand-name-or-snippet> at fit <fit>: <reasoning>",
  "provenance": {
    "source": "maya-opportunity-scout",
    "ts": <ms-since-epoch>,
    "citations": ["opportunity-<canonicalUrl>"]
  }
}
```

`<source>` is one of: `aspire`, `grin`, `creator-co`, `modash`,
`backstage`, `mavrck`, `twitter-creator-call`, `local-brand-search`.
One wiki page per source so claims accumulate against per-source
patterns (e.g. local-brand-search consistently outperforms
twitter-creator-call for this creator after 8 cycles).

Only fit ≥ 0.6 ('pitch'-actionable) items persist to the wiki. Lower
fits surface to Today / morning brief but do NOT pollute the long-lived
moat surface.

## Sibling-file references

- Invoked from `agents/skills/maya-platform/playbook.md` § Opportunity
  scouting (lead backfills the cron + playbook entries).
- Listed in `agents/skills/maya-platform/SKILL.md` § Custom Maya skills.
- Output consumed by: morning-brief assembly, Today surface,
  `maya-pitch-strategy` (downstream).
- Reads / writes: `opportunityScoutSeen` (request schema add — see
  report). Side-effect: Maya emits `wiki_apply` calls into OpenClaw's
  native memory-wiki for compounding opportunity-pattern learning (see
  § Memory-wiki integration).
