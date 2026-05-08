# Sprint 11 — Maya Memory Architecture

## 1. Memory surfaces

Maya's working memory decomposes into five categories, ordered by rate-of-change:

- **Creator profile** (slow). Niche, audience composition, voice fingerprint, stated goals, brand-deal floor, named peers, plan tier. Changes weekly at most; mostly written once at onboarding and edited rarely from Profile.
- **Brand-deal history** (medium). Inbound brand emails, outbound pitches, replies, declines, current threads, contract red-flags, paid amounts. Updated daily during active deal flow.
- **Performance memory** (fast). Last 30 posts' metrics, top/bottom hooks, posting cadence, hook patterns that work, weekly learnings deltas. Refreshed every heartbeat tick (~6h) and on every post-publish event.
- **Conversation recall** (cross-session creator preferences). "No recap before 9am", "prefers tough-love tone", "doesn't want pitch suggestions on weekends", "calls them Riley not Riley-Beth". Accumulates message-by-message over the relationship.
- **Skill-specific working memory.** Per-skill bookkeeping: trend-watcher's seen-URL dedupe, opportunity-scout's `opportunityScoutSeen` cache, peer-watcher's per-peer last-observed-post-id, contract-redflag's already-scanned-PDF set, hook-extractor's ingested-post set.

## 2. Routing — wiki vs. Convex

Two-line rule: **structured + queryable + UI-rendered → Convex; flexible prose + "stuff Maya wrote down" → wiki**. Both surfaces are cheap to read; wiki appends are atomic and migration-free, Convex rows are reactive and joinable.

| Surface | Convex (rows) | memory-wiki (`memory/wiki/<topic>.md`) |
|---|---|---|
| Creator profile | `creators`, `creatorPicture` | `creator-voice.md` (voice nuances Maya picks up post-onboarding) |
| Brand-deal history | `brandDeals`, `pitchOutreach`, `mayaActionLog` | `brand-deal-history.md`, `decline-log.md` (qualitative "why declined") |
| Performance memory | `posts`, `weeklyLearningsCreator` | `concepts/what-works/<platform>.md` (compounded patterns) |
| Conversation recall | `chatMessages` (raw transcript) | `commitments.md`, `creator-preferences.md` |
| Skill working memory | `opportunityScoutSeen`, `trendObservations`, `competitorObservations` | `peer-watch.md`, `niche/<niche>/trend-pattern.md` |

The pattern is consistent: Convex carries every claim the HQ web UI must render reactively or the citation firewall must validate; the wiki carries the durable prose substrate that compounds and that Maya reads back as context next turn.

## 3. Wiki layout

`memory/wiki/<topic>.md`, append-only, one bullet per fact, citation-anchored. Topic names are stable so dreaming and skills can find them by convention, not search.

Concrete topics for v0:

- `creator-voice.md` — voice nuances beyond `voiceFingerprint`: phrases they use, words they hate, swearing tolerance, emoji policy.
- `brand-deal-history.md` — chronological log of every brand interaction: pitched / replied / declined / signed, with citation back to `brandDeals._id` or `pitchOutreach._id`.
- `peer-watch.md` — per-peer accumulated observations (Maya's compounding peer model; mirrors `competitor/<creatorId>/<peerHandle>/observation` topic from playbook).
- `commitments.md` — what the creator said they'd do ("I'll film 3 videos this weekend"), with timestamp + outcome on follow-up.
- `decline-log.md` — every brand declined + the reason, so Maya doesn't re-pitch.
- `creator-preferences.md` — durable conversation preferences: quiet-hours, tone overrides, channel-of-the-day rules.
- `concepts/what-works/<platform>.md` — weekly-learnings-derived patterns (hook formats, posting times, formats), `sampleSize ≥ 3`.

Bullet shape: `- <YYYY-MM-DD> · <one-sentence claim> · cite:<sourceId>:<path>` — same provenance shape as `wikiProjections.provenance`.

## 4. Convex projection mirror (`wikiProjections`)

`wikiProjections` already exists in schema (line 3333) and is the read-optimized mirror of selected wiki pages. It stores `vaultPath`, `kind` (entity / concept / synthesis / source / report), the materialized `claim` text, `provenance[]`, `confidence`, and soft-delete `archivedAt`.

Maya updates the projection by emitting a `wiki_apply` call inside her turn (which writes the wiki append) AND a paired Convex mutation (`upsertWikiProjection`) that mirrors the compiled claim + provenance for HQ. The wiki is source-of-truth for the prose; the projection is read-optimized for the Today / Performance / Plan / Trends / Deals screens, which subscribe via Convex queries instead of round-tripping to the agent runtime. Citation firewall validates `provenance.length ≥ 1` for non-report kinds at projection-write time, regardless of what the wiki accepted.

## 5. Cross-session boot

Order of operations on every fresh Maya turn:

1. OpenClaw loads the workspace root files: `AGENTS.md`, `SOUL.md`, `USER.md`, `HEARTBEAT.md`, `IDENTITY.md`. These are the deploy-time bundle (per `templateBudget.test.ts` cap of 150K combined with USER.md headroom).
2. Per-skill triggers execute targeted `wiki_get` calls on top — trend-watcher reads `niche/<niche>/trend-pattern.md`, opportunity-scout reads `creator/<creatorId>/opportunity-pattern/<source>.md`, brand-deal-triager reads `brand-deal-history.md` + `decline-log.md`.
3. Convex `chatMessages` last-20-turns + last-24h context comes in via the per-message handler (already specified in playbook line 343).

`USER.md` is the public face — "what Maya knows about you" surfaced in Profile and editable by the creator. The wiki is the deeper substrate — "what Maya has noticed about you" — and is Maya-write, not creator-edit. This separation matters: USER.md is the contract with the creator; the wiki is Maya's notebook.

## 6. Explicitly NOT in v0

- **No vector DB.** No Pinecone, Weaviate, Chroma, or pgvector. At <100 active creators, retrieval cost from `wiki_get(<known-topic>)` + structured Convex queries is bounded and fast.
- **No semantic search.** Topic naming convention does the routing work. If Maya doesn't know which topic to read, that's a playbook bug, not a retrieval bug.
- **No memory consolidation cron.** Dreaming already compiles per-cycle observations into durable claims; we do not yet need a cross-cycle GC pass.
- **Reasoning.** Good prose-naming + structured rows + citation firewall is enough at this scale. We revisit when (a) per-creator wiki pages exceed ~50 topics, (b) a skill needs cross-topic semantic recall, or (c) retrieval latency materially affects turn time.

## 7. Open questions for the operator

- **Consistency model.** Maya writes the wiki append AND the Convex projection in the same turn. If the projection mutation fails after the wiki append succeeds, do we (a) retry from a queue, (b) accept eventual consistency, (c) make the projection a derived sync from the wiki on a cron? Recommend (b) with an idempotent re-mirror cron as backstop.
- **Per-creator wiki size.** At what topic-count or byte-count do we paginate or archive? Suggest a soft cap of 50 topics / 500KB before splitting `<topic>.md` into `<topic>/<year-quarter>.md` shards.
- **PII sanitization.** What stays out of the wiki entirely? Payment info, exact contract dollar amounts, audience PII, brand-side contact emails — these stay in Convex with row-level access only. The wiki may reference brand deals by `brandDeals._id` and characterize qualitatively ("declined — paid scope was too low"), but never persists raw email bodies, phone numbers, or contract terms in cleartext.

## Critical files for implementation

- `convex/schema.ts` (existing `wikiProjections`, `weeklyLearningsCreator`, `weeklyLearnings` — additive mutations + indexes for projection upserts)
- `agents/skills/maya-platform/playbook.md` (per-skill `wiki_apply` triggers + topic conventions — extend with the seven canonical topics)
- `agents/skills/maya-service-platform/BOOT.md` (boot-order template for wiki rehydration; mirror to a creator-side BOOT.md when one is added)
- `convex/agents/packs/maya/configGeneratorMaya.ts` (wire wiki topic list into per-skill cron context so heartbeat ticks know which `wiki_get` calls to make)
- `agents/skills/maya-opportunity-scout/SKILL.md` (reference implementation of the wiki-apply + Convex-projection pattern; replicate shape for trend-watcher / peer-watch / brand-deal-triager)
