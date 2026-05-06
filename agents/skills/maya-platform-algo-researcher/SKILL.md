---
name: maya-platform-algo-researcher
version: 0.1.0-sprint3.5
description: Researches each platform's current algorithm — what is being rewarded, suppressed, and what changed in last N days. Distinct from maya-platform-best-practice (static consultant); this skill watches the live conversation in creator-economy publications and feeds the platformAlgoCache that the consultant reads so its consultations stay fresh.
when-to-use: Cron-driven weekly per platform (Pro+ Platform algorithm research programs); twice-weekly for Studio. Pro+ on-demand when cache is older than ttlDays for a platform. Do NOT invoke freeform during a chat reply; defer to the cache.
plan-tier: pro+ (Starter read-only on whatever cache exists; never triggers research). Studio gets twice-weekly cron.
thinking-budget: high
metadata:
  openclaw:
    requires:
      env: []
    tags:
      - platform-algo
      - research
      - tiktok
      - instagram
      - youtube
      - linkedin
      - twitter
      - creator
---

## Calls

- `maya-citation-firewall` — mandatory; every signal must cite its source

## Delegates to

- Brave Search via `BRAVE_API_KEY` for the raw web layer
- model router `callMaya` for synthesis (taskTag chat_reply at high budget)


# maya-platform-algo-researcher

## Why this exists

Algorithms change. TikTok's For You re-weights every few months. Instagram
sometimes ships features that shift the entire saves-vs-likes economy in a
single quarter. A static "platform best practice" document goes stale; a
creator who follows last quarter's playbook will be wrong.

This skill closes the gap. It runs on a cadence, queries a curated set of
creator-economy publications via web search, synthesizes what is being
rewarded right now vs what is cooling off, and writes the result into
`platformAlgoCache`. Every other skill that asks "what does TikTok reward in
2026 Q2?" reads from that cache.

The static layer (`maya-platform-best-practice`) is the platform's *physics*
(saves matter on IG, retention matters on YouTube). The dynamic layer (this
skill) is the platform's *weather* (right now, IG is rewarding longer Reels;
right now, TikTok is suppressing reposted content). The two compose.

## Inputs

```ts
{
  platform: 'tiktok' | 'instagram' | 'youtube' | 'linkedin' | 'x';
  topic?: string;     // optional narrowing — e.g. "hooks", "carousels", "shorts retention"
  creatorId?: Id<"creators">; // present on on-demand invocations; null on cron
}
```

## Outputs

```ts
{
  algoSignals: Array<{
    signal: string;        // "Instagram is favoring Reels >90s as of April 2026"
    evidence: string;      // 1-2 sentence quote/paraphrase from a cited source
    dateLearned: string;   // ISO date — when the source published this
  }>;
  whatsHotNow: string;     // 1-paragraph summary
  whatsCoolingOff: string; // 1-paragraph summary
  sourcesUsed: string[];   // canonical URLs, deduplicated
  cachedAt: number;        // ms since epoch
  ttlDays: number;         // 7 for Pro, 3 for Studio (see cadence above)
}
```

## Sources monitored

A curated allowlist passed as the search-domain filter. Any source not on
this list is dropped from the synthesis (no random Reddit threads, no Tumblr
takes). The allowlist:

- **Tubefilter** (`tubefilter.com`) — daily creator-economy news
- **Variety Intelligence Platform** (`variety.com/vip`) — industry research
- **Modern Retail** (`modernretail.com`) — creator commerce angle
- **Passionfruit** (`thedailydot.com/passionfruit`) — creator labor
- **The Information** (`theinformation.com`) — platform-internal scoops
- **Marketing Brew** (`morningbrew.com/marketing`) — algorithm shifts
- **Adweek** (`adweek.com`) — platform partnership angle
- **Digiday** (`digiday.com`) — programmatic + creator angle
- **ColinAndSamir** (YouTube channel transcripts via brave search) — creator-economist commentary
- **Hank Green** (his Tumblr / posts indexed) — creator economics theory

If Brave Search returns results from outside this allowlist they are not used
in the synthesis. The allowlist is locked here in SKILL.md and copied into
`script.ts`'s `ALLOWED_SOURCE_DOMAINS` constant — keep them in sync (sibling
scan enforces).

## How it works

1. **Build query.** For each platform, construct a Brave query like
   `site:(tubefilter.com OR variety.com OR ...) "tiktok algorithm" 2026`,
   narrowed by `topic` if provided.
2. **Fetch.** Call Brave Search Web API with `BRAVE_API_KEY`. Take the top 20
   results, drop anything not on the allowlist, dedupe by canonical URL.
3. **Read.** For the surviving 5-8 results, fetch the page bodies (Maya's
   workspace already has a generic web fetcher). Extract the relevant
   paragraphs (the ones that mention the platform name + an algorithm
   signal — heuristic match, no LLM yet).
4. **Synthesize.** Call the model router (`callMaya`, taskTag
   `creator_picture_synthesis` clamped to high thinking) with the extracted
   passages + the fixed prompt: "Summarize what is being rewarded vs cooled
   off on {platform} as of {today}. Output JSON matching the schema in
   SKILL.md. Every signal must cite its source URL."
5. **Citation firewall.** Pass the synthesis output through
   `maya-citation-firewall` with one citation per signal. If any signal lacks
   a verifiable URL, drop it (do NOT hallucinate the citation).
6. **Write cache.** Insert into `platformAlgoCache` with
   `researchedAt = Date.now()`, `ttlDays = 7` (Pro) or `3` (Studio), and the
   list of source URLs.
7. **Emit `wiki_apply` calls.** For each high-confidence signal, emit a
   `wiki_apply` tool call (see § Memory-wiki integration below) so the
   compiled platform-algo claim accumulates in OpenClaw's native
   memory-wiki. The signals compound across cycles via dreaming and become
   queryable via `wiki_get` from any other skill that asks "what does
   TikTok reward right now for THIS creator's niche?"
8. **Return.** Skill's caller is usually the cron, which doesn't consume the
   return — but on-demand invocations consume it directly to answer a chat.

## Memory-wiki integration (Sprint 8 Slice B)

This skill writes its compiled signals to two surfaces: `platformAlgoCache`
(fast read-projection for skills that need a short-TTL lookup) and the
OpenClaw native memory-wiki (long-lived, dream-compiled, provenance-traced
moat). The wiki write happens in Maya's turn output, NOT from a Convex
mutation — `wiki_apply` is an agent tool the runtime registers.

### Topic schema

Each signal becomes one `wiki_apply` call shaped:

```json
{
  "topic": "platform/<platform>/algo-signal",
  "claim": "<the signal text — e.g. 'IG is favoring Reels >90s as of 2026-04'>",
  "provenance": {
    "source": "maya-platform-algo-researcher",
    "ts": <ms-since-epoch>,
    "citations": ["<sourceUrl-1>", "<sourceUrl-2>"]
  }
}
```

Topic key shape: `platform/<platform>/algo-signal` — one wiki page per
platform; claims accumulate. A second optional topic-narrowing pattern
when `topic` input is set: `platform/<platform>/algo-signal/<topic-slug>`.

### Why two surfaces (cache + wiki)

`platformAlgoCache` is a Convex table (TTL'd, indexed by platform + niche)
that supports fast per-request lookups when a chat skill needs "what's
hot on IG right now?". The wiki is the compounding learning surface —
older claims age out of the cache but stay in the wiki with full
provenance. Other skills (`maya-pre-post-scorer`, `maya-content-arc-planner`)
can query the wiki via `wiki_get('platform/instagram/algo-signal')` for
a richer evidence chain when they want to weight a recommendation.

## Plan-tier gating (server-side, fail-closed)

Enforced in the Convex action that wraps this skill, via
`planFeatures(creator)`:

- `starter`: invoking the skill (cron OR on-demand) throws `PlanGateError`.
  Starter Mayas read whatever is already in `platformAlgoCache` (which is
  global by default) but never trigger fresh research. This keeps Starter's
  COGS in line.
- `pro`: weekly cron + on-demand. `ttlDays` defaults to 7.
- `studio`: twice-weekly cron + on-demand. `ttlDays` defaults to 3 — the
  Studio cron always runs ahead of Pro's, so Studio creators effectively
  consume fresher cache.

The gate is checked at action entry, BEFORE the Brave call, so we never
spend the Brave credits or the OpenRouter tokens on a Starter creator.

## Citation firewall

Every signal in the output must carry a source URL that resolves to a
fetched-and-parsed allowlisted page. The firewall runs on the synthesis
output with one `{ kind: 'event', id: url, fact: extractedParagraph }`
citation per signal. On fail, the signal is dropped. If all signals get
dropped, the skill returns `algoSignals: []` and `whatsHotNow`/`whatsCoolingOff`
strings that say "no high-confidence signals found this cycle" — never
fabricate filler.

## Sibling skill: `maya-platform-best-practice`

That skill's "current algo signals" section reads from `platformAlgoCache`.
Without this skill running on cadence, that consultation goes stale. The
sibling-file scan (`tests/sprint1Acceptance.test.ts` + the equivalent S3.5
gate) asserts both directions: `maya-platform-best-practice` references
`platformAlgoCache`, and `platformAlgoCache` is written only by this skill.

## What this skill is NOT

- Not real-time. Cache freshness is days, not minutes. A creator who needs
  "right now" platform info should ask the platform's official channels;
  Maya is not their newswire.
- Not a hashtag tracker. That's `scrapecreators` agent skill territory.
- Not a competitor watcher. That's the `competitor_watch` cron behavior with
  `scrapecreators` as the read layer.
- Not a freeform web search. The allowlist is enforced — we will not surface
  algorithm "tips" from random YouTubers or Twitter threads.

## Examples

See `examples/tiktok-weekly-cron.json` for a sample cron-triggered output
(no creatorId, no topic).

See `examples/instagram-on-demand-pro.json` for an on-demand Pro invocation
with `topic: "carousels"`.

## Sprint 3.5 dependency on env

Requires `BRAVE_API_KEY` in the Convex environment. Already in
`.env.local` per operator setup; the operator must `npx convex env set
BRAVE_API_KEY <value>` before deploying this skill so the Convex action
can reach Brave at runtime.
