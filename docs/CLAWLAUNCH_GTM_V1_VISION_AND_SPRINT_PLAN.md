# ClawLaunch — GTM Agent: Vision, Moats & Sprint Plan (v1)

**Status:** Canonical planning doc. Written 2026-05-28 after a full 5-agent audit of the GTM codebase against a first-principles product vision. This is the restart artifact — read it top to bottom to resume work.

**Revised 2026-05-28 (later session):** Sprint A ✅ + Sprint B ✅ DONE. (A: firewall already shipped 2.28; MEMORY append-only + idempotent hello. B: rolling-7-day plan, North Star contract + setter, journey-stage/manager-mode fork + existing-account ingestion + onboarding tab, first-synthesis quality bar + Q&A-readiness, strategy approval gate. ~24 commits, all tested.) **Sprint C ✅ + Sprint I ✅ DONE.** (C: attribution stack [gtmLinkWraps/Clicks/Conversions + /r/ redirect + wrap_link + record_conversion], killed the one-way ratchet [weekly review regenerates + re-weights from conversions, North-Star on-track/at-risk, Sun 7pm], content-attribute learning [attributes→outcome correlation], and confirmed T+2h/24h/7d result polls already fire on the real scheduler. I: Native Voice Fidelity — AI-tell critic + dual-anchor voice-match + per-channel style exemplars + caption craft, built in parallel by a worktree agent.) **Sprint D (launch orchestration) in progress next; then E, F, G, H, J.** Added scope from operator working-session: **Sprint H — YouTube** (ScrapeCreators), **Sprint I — Native Voice Fidelity** (anti-AI-slop), **Sprint J — Self-Improving Skills** (two-layered), **content-attribute learning** + **research-depth verification checkpoint** folded into Sprint C, and an **analytics-tiering** locked decision (MVP = public scrape + own attribution, no OAuth; deep platform analytics = post-MVP per-platform upgrade — *operator to confirm OAuth direction*). See §4 + §6.

**Product:** ClawLaunch — an OpenClaw-run autonomous GTM agent ("Maya") for **non-technical "vibe coder" founders** (shipped on Lovable/Bolt/Replit/v0/Cursor, have a 9-5, zero marketing instinct, can't get users). Active code: `convex/gtmMaya/*`, `convex/agents/packs/maya_gtm/*`, `convex/onboarding/gtm/*`, `agents/skills/maya-gtm/*`, `app/onboarding/gtm/*`, `gtm*` tables in `convex/schema.ts`. **The creator-product and service-product code are LEGACY — ignore them.**

---

## 1. Vision (first principles)

**The job:** Get a non-technical founder their first real users — and keep them growing — without making them learn marketing or spend hours they don't have. Not "grow a following." **The first 100 people who actually use the thing.** Everything bends toward that.

**The mental model: a fractional Head of Growth, not a content tool.** A hundred "AI writes your posts" tools exist; they're commodity and deletable because they produce *activity*, not *outcomes*. The thing worth building is an **autonomous growth operator with judgment** — the person a funded startup hires at $150k, living in a text thread for $40/mo.

**Why founders fail at GTM (and a real manager solves all three):**
1. **Judgment** — they don't know *where* to play, *what* to say, *when* to launch.
2. **Consistency** — GTM is daily showing-up for weeks; founders quit after 4 days. The agent never stops.
3. **A starting point** — "go market your app" is paralyzing. The agent removes the blank page.

If it nails those three it's a growth manager. If it just writes posts, it's a toy.

---

## 2. What it should do (the 6 capability areas)

1. **Understand the product & founder deeply** — ingest site + walkthrough video + the "why"; form a sharp POV (one-sentence promise, the problem it kills, the **activation moment**, the buyer *inferred from the product* because the founder usually can't articulate it); capture constraints (time, on-camera comfort, channels) and a **North Star** ("first 100 signups").
2. **Set strategy — propose, don't dump** — where to play / what to ignore (focus is the value), the wedge, the audience-building arc (warm up → earn credibility → build-in-public → launch → compound). Founder approves and can redirect.
3. **Run the daily growth engine** — find live buyer conversations (continuous, deep), draft in the founder's voice with a non-spammy path to the product, build relationships, run a content engine, keep the founder's account *present* daily — and stay a current **expert on each platform's algorithm + what's working right now** (TikTok vs X vs IG vs LinkedIn vs Reddit/HN) so format/timing/draft choices reflect *this month's* reality.
4. **Orchestrate launch moments** — Show HN / Product Hunt / big threads, timed *after* warm-up, coordinated assets + follow-through. Proposed + approved, never cold-auto-scheduled.
5. **Measure outcomes, learn, compound** — track **signups, not likes**; attribute them; weekly re-decide from data (keep/adjust/pivot with discipline); accumulate learnings, audience, relationships as an asset.
6. **Be a manager, not a yes-bot** — proactive, honest (distinguishes a *distribution* problem from a *positioning/product* problem), respects the founder's time (approve-and-go), holds them accountable.

---

## 3. The moats (MVP-first) — these keep the app alive

| Moat | What it is | When |
|---|---|---|
| **Attribution → outcomes** | Tie posts → clicks → signups. The substrate everything compounds on. Without it, "learnings" are vanity. | **MVP (foundational)** |
| **Switching-cost / embedding** | Audience, relationships, voice profile, accumulated learnings build up per customer → painful to lose. The "hard to delete." | **MVP (emerges from B/E)** |
| **Data moat — archetype GTM playbook** | Across thousands of agents, a proprietary, *outcome-grounded* playbook indexed by **app archetype** ("for a dev tool like yours: HN + r/LocalLLaMA, founder-story angle converts 3×, Show HN week 3"). Warm-starts new customers; competitors can't buy it. Flywheel: more customers → more outcome data → better playbooks → better results → more customers. | Start archetype-tagging at **MVP**; cross-tenant aggregation **post-MVP** (needs corpus + attribution) |
| **Benchmarking** | "For apps like yours, X converts; you're below median." Sellable slice of the data moat. | Post-MVP |
| **Community-coordination at scale** | Only a platform at scale can coordinate its agents to NOT flood the same subreddits/HN (a *negative* network effect if unmanaged). Coordination = moat + table-stakes against mass bans. | Post-MVP (matters at scale; design-aware now) |
| **Judgment / honest diagnosis** | Telling the founder "your messaging, not the channel, is the problem" — a yes-bot can't. | Near-MVP (Sprint F) |

**Prerequisites for the data moat (build these so outcomes compound across the business, not just one customer):** attribution (Sprint C) + app-archetype tagging at onboarding (cheap, start at MVP) + privacy-safe cross-tenant aggregated-learnings store (post-MVP).

---

## 4. Locked decisions

- **SEO: socials + community first; dedicated SEO is post-MVP.** Speed-to-first-users beats months-long SEO, and most vibe-coder apps lack a content site. We capture *indirect* SEO for free (Reddit/HN/forum answers rank for "best X / alternative to Y"); include cheap directory/launch listings (Product Hunt, AlternativeTo, "awesome" lists). A dedicated blog/programmatic-SEO content engine is a later phase.
- **Per-channel venue breadth (research requirement).** For each chosen channel, discover a **ranked venue map** — big → long-tail niche — not a single venue. Reddit → multiple subreddits (big + niche); TikTok → multiple hashtags/sounds/sub-niches; X → multiple communities/lists/topics; HN → multiple thread types; LinkedIn → multiple groups/hashtags. Big = reach, small = higher intent + less competition. Be present across the spread. Feeds the data moat (which venues convert per archetype). Bake into the deepened research skills + channel strategy (pick primary *channels*, but a breadth of *venues* within each).
- **Plan structure:** strategy brief (proposed, invite pivot) + **rolling 7-day** plan (today→Sunday), NOT a 14-day dump; launches **proposed + approved**, never auto-scheduled; anchored to a **North Star**.
- **No hardcoded heuristics** — no regex/keyword tables/weighted formulas/fixed thresholds for *judgment*. Express as LLM judgment. Only true contracts/limits may be numeric (API caps, real platform account-age gates). 
- **Convex = DB/plumbing; OpenClaw owns ALL reasoning** (product digestion, thread scoring, channel choice, comment mining). Full migration is delete-AFTER-verify (never delete the working pipeline before a live deploy proves the replacement).
- **twitterapi.io + ScrapeCreators = curl/exec, not MCP** (deep digs need arbitrary query composition + cursor pagination; `claude mcp add` only wires Claude Code, not OpenClaw). Adopt ScrapeCreators' **official agent-skill** (richer pagination/comment/quirk docs).
- **Platform algorithm intelligence is SHARED + monthly-refreshed (out-of-the-box).** Ship a baseline of each platform's current algorithm + what's working; refresh ~monthly via native `web_search` (rides the existing `monthly_reset` cron) into a shared platform-knowledge file the per-channel skills reference for format/timing/draft decisions. This is **shared infra** (same for all agents) — NOT per-customer niche research. The per-app venue/niche discovery (above) stays per-customer; the *algorithm/best-practice state* is shared.
- **Voice/tone:** manager texting a founder; anti-sycophantic; never leaks infra; signups-not-likes orientation in every drafted reply (non-spammy, earn trust on Reddit/HN).
- **Dual entry path — launch mode AND manager mode (co-equal; manager mode likely the bigger market).** Not every user is pre-launch. Most paying users will have *already shipped and stalled* and just want "take over my social + tell me exactly what to post and when." So the product serves two first-class modes, forked at onboarding by `entryMode`: **launch mode** (pre-launch → full 30-day GTM arc, North Star = first 100 signups) and **manager mode** (already-launched → skip launch theater, ingest their existing accounts, open straight into the ongoing daily engine with this-week's post schedule, North Star = growth/cadence). Manager mode is treated as co-equal — arguably primary — NOT an edge case. Requires existing-account ingestion + posture fork (Sprint B). The launch-narrative-only framing under-serves the larger market.
- **Posting model — MVP = one-tap-assisted, NO OAuth / NO paid third party.** True auto-posting requires account authorization (build per-platform OAuth = brutal, or pay an aggregator — Composio/Late/Ayrshare). MVP doesn't need it: video (TikTok/IG/YT) is Brief-only (founder posts — locked no-UGC), and for text (Reddit/X/LinkedIn/HN) Maya writes the exact draft and the founder **one-taps/pastes to publish**. Zero OAuth, zero vendor spend, and *safer* (founder's account stays in their hands → no ban risk to them). This is also already where we are (Composio unwired). **"We post for you" is honored at MVP as "we do everything, one tap."** True hands-off auto-posting on text platforms = **post-MVP paid-aggregator upgrade** (buy, don't build) that justifies a higher tier. *Landing-promise reconciliation (soften to "one tap" vs budget the aggregator) is an operator call.*
  - **Deep-link / intent-URL layer (MVP, first-class — added 2026-05-28).** The thing that makes one-tap feel almost-auto with ZERO OAuth: the calendar event deep-links straight to the exact thread/composer with the draft **pre-filled**. **X:** `intent/tweet?text=…` opens the composer pre-filled → one tap to publish (≈90% of auto-post, none of the risk). **Reddit:** deep-link to the exact thread for comments (draft to clipboard) + `/submit?title=&text=` pre-fill for posts. **LinkedIn:** share-intent pre-fill. **TikTok/IG:** no useful web intent → stays Brief-only. Build this as the core "how the user acts on the plan" UX — it collapses the real friction (finding the thread + blank page), not the trivial 10-second tap.
  - **Auto-post / auto-respond tiering (added 2026-05-28).** **Auto-RESPOND (replies in threads/comments) = hold longest / human-approve-each even at higher tiers** — highest ban + founder-reputation risk (LLM auto-replying on Reddit gets accounts banned). **Auto-POST (own feed) = post-MVP paid upgrade, X-first** (safe; own feed), **Reddit cautiously with guardrails** (subreddit rules, account-age, rate limits). MVP ships neither — one-tap + deep-link is enough and safer.
- **Mode fork = content fork on ONE runtime, NOT a separate deployment.** Launch vs manager mode is expressed as different *generated workspace content* (`entryMode` branches BOOT/APP/GTM/hello/emphasized-skills in the generators) on the **same shared OpenClaw runtime + deploy pipeline** — never a second deployment (which would mean two runtimes to maintain + divergence + COGS for zero benefit). Onboarding presents an explicit **tab/choice** ("haven't launched" vs "live, take over my social"), then confirms/enriches it via existing-account ingestion. (Sprint B.)
- **Analytics tiering — MVP needs NO platform OAuth.** Three tiers of "what's working": **Tier 1 public engagement** (likes/comments/views/upvotes — scraped, no OAuth; near-complete on Reddit/HN, vanity-surface on TikTok/IG/YT/X/LI), **Tier 2 owner-only platform analytics** (reach/impressions/watch-time/retention/CTR/traffic-source/followers-per-post — genuinely impossible without per-platform OAuth), **Tier 3 our own attribution** (UTM + our redirect → click → signup — OURS, no OAuth, Sprint C). The North Star (signups) rides Tier 3, so **MVP = Tier 1 + Tier 3, no OAuth.** Tier 2 (deep diagnostics, esp. video retention/CTR) is a **post-MVP, optional, per-platform "connect your account" upgrade** (friendliest first: YouTube/X; hardest: TikTok/IG app-review). Tier 2's absence softens Sprint F's positioning-vs-distribution call (reach is owner-only — proxy with public views). **✅ LOCKED (2026-05-28): no separate analytics-OAuth vendor — we do NOT take on a new OAuth layer for analytics.** Today there is no live user-account OAuth at all; ScrapeCreators/twitterapi.io use our key on public data, and Tier-3 attribution is our own infra — both need zero user OAuth. The only planned account connection is **Composio for *posting*** (the write layer, parked — NOT analytics; its action-connectors don't surface platform analytics APIs anyway). If deep analytics is ever needed, extend the posting connection users already grant — never stand up a second OAuth stack speculatively. **Add analytics testing to Sprint C**: ScrapeCreators public-metric fetch per platform + click→signup attribution capture, both end-to-end, zero OAuth.
- **"Non-AI" content = native-voice fidelity, NOT detector-dodging.** There is no reliable platform AI-detector demoting text as a ranking signal (detectors are noisy; platforms don't run them at scale). The real penalties: Reddit/HN **community + mod rejection** (also a founder-account ban risk), and TikTok/IG/YT **engagement starvation** of generic content. So the target is content that reads as a real person from the niche wrote it — via grounding in specifics, founder voice-match, **style-exemplar few-shot from real top-performing native posts in the exact venue**, and a structural+lexical AI-tell critic. Never promise "undetectable"; promise native + grounded. (Sprint I.)
- **Captions are not a separate system** — produced by the per-channel drafting stack. Each per-channel skill must encode that platform's caption craft (TikTok hook-line + hashtags; IG story + CTA; YouTube title=CTR lever + description SEO; Reddit title-is-everything; X = the post; LinkedIn hook + "link in first comment"). Kept current by platform-algo-intelligence; learned by content-attribute learning. Folded into Sprint I.
- **Self-improving skills are two-layered with a hard safety boundary.** Shared `playbook.md`/`skill.md` must NOT be autonomously rewritten by a single agent (one bad self-edit poisons the whole fleet). **Layer 1 (autonomous, per-tenant, safe):** DREAMS.md = the nursery for proposed improvements/hypotheses → validated against THIS customer's outcomes → promoted to MEMORY.md durable learnings → fed forward (Sprint C loop). **Layer 2 (governed, cross-tenant):** agents emit *proposed* improvements → aggregate cross-tenant (Sprint G) → A/B-verified against outcomes → **gated merge** into shared skills. **Core contracts (firewall, evidence/grounding rules, safety gates) are NEVER self-editable.** (Sprint J.)

---

## 5. Current state — consolidated audit (HAVE / PARTIAL / MISSING)

**HAVE (the thinking layers, good):** deep multi-channel research (now deepened — see §8), product digestion → APP.md, ICP hypotheses, channel-strategy judge, drafting + voice-match + slop/output critics, content engine breadth, proactive cadence (morning 7am / evening 8pm / weekly Sun / monthly), anti-sycophancy enforcement (`outboundFirewall.ts` wired server-side fail-closed at send time, Sprint 2.28), approval state machine, `gtmRelationshipTargets` table, `gtmPostResults` engagement snapshots.

**PARTIAL / MISSING (the operating-system layers — the work):**
- **Attribution: ENTIRELY MISSING** — no UTM, no link-wrap/redirect, no click/signup capture, no PostHog. `gtmPostResults` even *dropped* the `signups` field the legacy table had. The loop optimizes vanity.
- **Weekly loop: one-way ratchet** — `weekly_review` extracts learnings + queues drafts but never regenerates the calendar or re-weights bet channels; learnings don't feed forward. Cron is **Sun 6pm** (want 7pm).
- **North Star: MISSING** — `weekGoal` is a dropdown, never mapped to a tracked target; no on-track/at-risk reporting.
- **Strategy approval loop: MISSING** — no "propose → approve/iterate" before calendar/draft execution.
- **One-sentence POV: deferred to agent**, not synthesized + validated at onboarding.
- **Launch timing: not gated at generation** — the 48h-cold-launch bug (no `accountCreatedAt`+audience-floor+days-in-phase check before emitting `hard_launch`/Show HN). Launch preconditions (5-piece kit, first-50 DMs) documented but unenforced. No 72h post-launch engagement auto-seed.
- **Publishing: X + LinkedIn auto only** (`SUPPORTED_PLATFORMS=["x","linkedin"]`); Reddit/TikTok/IG manual; no batch "reply queue" middle ground; Twitter action-slug mismatch bug (`TWITTER_CREATION_OF_A_POST` vs `TWITTER_CREATE_A_POST`).
- **Continuous inbound polling: MISSING** — replies to owned posts only triaged if a webhook fires (not implemented).
- **Relationship motion: static** — table populated but no cadence engine; `lastTouchAt` never auto-updates; no proactive engagement.
- **Daily presence integrity: MISSING** — no planned-vs-done tally / silence flag.
- **Honest diagnosis: PARTIAL** — only diagnoses *distribution* failures; no positioning/product diagnostic ("your messaging is the problem").
- **3 stability bugs** (see §7): MEMORY.md edit failures, infra leaks, double/out-of-order hello.

---

## 6. The sprint plan

**Sprint A — Trust & Stability** *(ship first; trust is breaking now)* — ✅ **DONE (2026-05-28, commits `572fd15`+`3e76569`)**
- ~~Wire the firewall server-side into `/lc_gtm/send_update`~~ → **ALREADY SHIPPED in Sprint 2.28** (this doc was stale): `sendUpdateHttp` (`convex/gtmMaya/openclaw/inboundCallback.ts:1159`) calls `validateOutbound` fail-closed before relaying to Telegram, after a critic gate + evidence guard. No action needed.
- ✅ MEMORY.md write fragility — replaced the seeded `<set this when…>` / `<updated by … cron>` placeholders with a single **APPEND-ONLY lifecycle log** (read = last line with `key:` prefix; record = append; no in-place marker edit ever fails again).
- ✅ One **idempotent** hello — `0001_kickstart` cron now does an idempotency check FIRST (reads MEMORY.md, no-ops if a `hello_sent_at:` line exists) and only sends otherwise; reconciled the two hello specs to short + rolling-week (dropped the stale "14-day" spec).
- *(Parallel, still open)* main-brain model A/B: Gemma-4-26B vs a stronger model for operator-facing voice + synthesis quality.
- *(Carry-forward from the test-realignment pass)* the slimmed `HEARTBEAT.md` dropped some recovery/maintenance tasks — **restore `missed-cadence` recovery in Sprint C, `published-results-scan` in Sprint C/E** rather than treat as silent regressions.

**Sprint B — The Plan, Reframed** *(the founder's actual experience — meet them where they are)*
- **Journey-stage fork + manager mode (added 2026-05-28 — see §4 dual-entry decision).** Detect `entryMode: "launch" | "manager"` at onboarding from `gtmApps.stage` (idea/live-beta/paid — operator-declared, not a heuristic) + whether their ingested accounts show real audience/post history. **Pre-launch → launch arc** (warmup→launch→compound, North Star "first 100 signups"). **Already-launched → manager mode**: skip the launch theater, open with "here's what's working on your accounts + this week's exact post schedule," straight into the daily engine; North Star = growth rate / signups-per-week. The first hello + plan shape branch on `entryMode` (template fork in `generators.ts`).
- **Existing-account ingestion** (the "take the ball from where they are" piece). At onboarding, ScrapeCreators-pull the founder's OWN `existingTikTokUrl`/`existingInstagramUrl` (+ any handles) → profile, followers, recent posts, engagement → thread into APP.md/USER.md as their current footprint, so Maya picks up mid-stream and the content-attribute learning (Sprint C) starts from their real history, not a cold start. Same read layer as niche research, pointed at their own handles.
- North Star contract: map goal → concrete target, **adaptive to `entryMode`** (launch: "first 100 signups by Day 30"; manager: a growth/cadence target); store on `gtmApps` (`northStarMetric`/`northStarTarget`/`northStarDeadlineMs`); render in GTM.md; track.
- Synthesized one-sentence POV at onboarding (promise / problem killed / activation), validated before research.
- Strategy approval loop: propose strategy → "approve / iterate / more research" before execution (`strategyApprovalState` on `gtmResearchJobs`).
- **First-synthesis quality bar (founder-POV; added 2026-05-28).** The first plan reveal is the make-or-break "holy shit she gets my product" moment — make it a first-class designed artifact, not a generic brief. It MUST: (a) prove she understood THIS product with a specific cited detail (activation moment / a real demo observation), (b) deliver a **decision, not a menu** ("betting Reddit + X, here's why"), (c) name **one concrete thing to do this week**, (d) be honest + grounded (credibility over hype), (e) scan on a phone, (f) invite pushback. Enforced via `maya-output-critic` (extend its gates for the first synthesis specifically).
- **Q&A-readiness contract (founder-POV; added 2026-05-28).** After the reveal the founder will interrogate her ("why Reddit not TikTok?", "I don't want video", "how do you know?", "no time", "will this get me banned?"). Maya must: defend every recommendation with the **actual stored evidence**, **adapt** when the founder disagrees (don't dig in), say **"I don't know / let me check"** honestly (never confabulate), and hold voice throughout. Depends on research depth + inbound handling (Sprint E). **Validated by the verification deploy** — grade the synthesis against the bar + throw real founder questions at her.
- Plan = strategy brief + **rolling 7-day** (today→Sunday); launches proposed, never auto-scheduled.

**Sprint C — Close the Loop + Attribution** *(the moat foundation)*
- Attribution-lite: our own link-wrapper/redirect + UTM on every drafted link → capture clicks; restore **signup capture** (re-add to `gtmPostResults` or a `gtmConversions` table); feed our PostHog (already provisioned).
- Make `weekly_review` **regenerate the rolling 7-day plan + re-weight bet channels/angles from the week's data** (kill the one-way ratchet), with counter-overfitting discipline (≥repeated signal, 2-week rule for big shifts); **move to Sun 7pm**.
- Make T+2h/24h/7d result polls actually fire on a schedule (not just heartbeat read).
- **Analytics testing (added 2026-05-28).** Test what we can actually pull with zero OAuth: ScrapeCreators public-metric fetch **per platform** (likes/comments/views/upvotes round-trip into `gtmPostResults`) + the **click→signup attribution capture** end-to-end (UTM/redirect → click → `gtmConversions`/signup). This is the proof the no-OAuth analytics stance holds up in practice.
  - **Mechanism (how it actually works):** post goes live → record `providerPostId`/URL (`/lc_gtm/record_published`, also the manual/one-tap tracking hook) → scheduled poll at T+2h/+24h/+7d hits the scraping API *for that post* → snapshot. Sources per platform: **Reddit** (ScrapeCreators: upvotes/comments/awards), **X** (twitterapi.io: likes/reposts/replies/quotes/public views), **LinkedIn** (ScrapeCreators: reactions/comments/reposts), **TikTok** (ScrapeCreators: views/likes/comments/shares/saves), **Instagram** (ScrapeCreators: likes/comments/reel views), **YouTube** (ScrapeCreators `/v1/youtube/video` + `/video/comments`: views/likes/comments), **HN** (Algolia: points/comments). **`web_search` is NOT a post-analytics source** — it powers the shared platform-algo-intelligence + research grounding only. Outcome (Tier 3) is platform-agnostic via our own UTM/redirect.
- North-Star status (on-track/at-risk) in the weekly review.
- **Content-attribute learning (the "grow with the user" mechanism).** Today the results-reviewer only correlates a coarse `formatPatternId` → engagement. Add **structured attribute tags on every draft/post** (hook type, format, tone, length, face/no-face, caption style, posting time — Maya's own tags, no extra API) so the reviewer correlates *attributes → outcomes* ("punchy 0-3s hooks convert 4x explainer intros"), not just format. Same table work as attribution; this is what makes the closed loop genuinely adaptive + feeds the data moat.
- **Research-depth verification checkpoint (gated on operator spend approval).** Before building D+ on top, run ONE real ClawLaunch deploy graded purely on research breadth + depth — does it actually fill `buyerJourneyStages` + `mineableComments`, or leave them empty like the last live run? Catches the capacity-≠-fill gap early.

**Sprint D — Launch Orchestration**
- Warm-up gating at calendar-generation → kills the 48h-cold-launch bug (`accountCreatedAt`+audience-floor+days-in-phase before emitting `hard_launch`/Show HN).
- Launch bundle: 5-piece kit + first-50 DMs + staggered multi-channel as one approval-gated unit; enforce preconditions at publish (`publishApprovedDraft`).
- Auto-seed 72h post-launch engagement window; `<1%` engagement → auto-trigger reposition/replan.

**Sprint E — Execution Depth** *(daily presence that compounds + venue breadth)*
- Continuous inbound-reply polling (the missing webhook/poller) → real-time triage of replies to owned posts.
- Relationship cadence engine: enforce `lastTouchAt`+cadence, auto-draft engagement, auto-update touch → turn the static list into a motion.
- **Per-channel venue breadth** (the multi-niche requirement): research surfaces a ranked venue map (big→long-tail) per channel; agent posts across the spread.
- Publishing reliability: batch "reply queue" (one-tap-post-all) for Reddit; Twitter slug-bug fix; IG/FB where feasible.
- Daily presence integrity: evening recap tallies planned-vs-done, flags silence, bumps missed priorities.
- **Platform algorithm intelligence (shared, out-of-box + monthly refresh):** ship a baseline of each platform's algorithm/best-practices; monthly `web_search` pass (on `monthly_reset`) keeps it current in a shared platform-knowledge file the per-channel skills consult. Cheap, high-leverage freshness — drafts/format/timing reflect current algos, not stale ones.
- **Daily niche/competitor/creator watch cron (added 2026-05-28).** Mostly already designed — `gtmCompetitiveMap` (competitors) + `gtmTargetAccounts` (creators/key people, populated at foundation) + `gtmNichePulse` + `/lc_gtm/competitor_move` + `/lc_gtm/niche_pulse_signal` all exist. Gap = the daily cron that re-pulls those stored handles + scans the niche, has Maya **judge what's actually vital** (anti-spam: rare, batched, operator-worthy only), and pings only then. *Selective* YTDL→Gemini video-watch — Maya watches a competitor/creator video ONLY when judgment says it matters (it's blowing up, a format question), never indiscriminately; bounded by count. **COST GATE: this is always-on per-user daily spend — bound frequency + selectivity or it torches COGS (see §Go-Live shell).**
- **Dynamic mid-week plan adjustment (added 2026-05-28; the "real manager" magic).** The weekly plan must be MUTABLE: spike detected (velocityScore) → Maya drafts the comment → pings the operator with a **deep link** ("this thread's blowing up / this is a great thread to engage — tap to go, here's exactly what to say"). Add-don't-replace (locked rule). Plugs into the deep-link/intent layer (§4 posting model) + the Sprint C loop. Risk = calibrating "vital" so it's not notification spam — validate via the verification deploy.

**Sprint F — Honest Diagnosis**
- Positioning-vs-distribution diagnostic: detect "audience saw it but didn't want it" (messaging/product) vs "never saw it" (distribution); tell the founder the hard truth with evidence; feed weekly-review verdict + strategy reconsideration.

**Sprint G — Moat Infrastructure** *(the data moat; depends on C)*
- App-archetype tagging at onboarding + privacy-safe cross-tenant aggregated-learnings store → per-archetype playbooks that warm-start new customers + benchmarks.

**Sprint H — YouTube as a first-class platform** *(added 2026-05-28)*
- Read layer: ScrapeCreators YouTube API (`/v1/youtube/channel`, `/channel-videos`, `/channel/shorts`, `/video`, `/video/transcript`, `/video/comments` ~1k top + ~7k newer, `/comment/replies`, `/search`, `/search/hashtag`, `/shorts/trending`) — all public-data (Tier 1; no Studio analytics without OAuth). Transcripts are gold for buyer-language mining.
- Schema: add `"youtube"` to platform/channel enums on `gtmTargetThreads`, `gtmDraftedContent`, `gtmPostResults`, `gtmResultSnapshots`, `gtmChannelScores` (additive, back-compat).
- `maya-youtube-researcher` skill (mirrors the deepened per-channel researchers: comment+transcript mining, venue spread, judgment-only, signups-not-likes); add YT endpoints to `scrapecreators-api` skill + re-sync bundle.
- Strategy/planning: YouTube in channel-scoring; lane = **Brief only, no UGC** (Shorts = video-Brief like TikTok; long-form = founder-led outline). 5 mandatory test categories + enum round-trip.

**Sprint I — Native Voice Fidelity** *(added 2026-05-28; the anti-"AI slop" sprint — see §4 decision)*
- **Style-exemplar grounding (the big lever):** research captures top-performing *human* native posts per venue → fed into drafting as few-shot voice/register anchors (match cadence/vocab/length/format; never copy content). Compounds with content-attribute learning + feeds the data moat.
- **Deepen slop-critic → AI-tell critic:** beyond banned phrases, catch *structural* tells (em-dash overuse, tidy tricolons, "it's not X it's Y," uniform rhythm, over-hedging, zero opinion, suspicious tidiness, no specifics). LLM-judgment, not regex.
- **Voice-match strengthening:** condition on the founder's own real posts where they exist + venue exemplars.
- **Final human-pass critic + rewrite loop:** "would a real person in this community have written this?" → rewrite until it passes.
- **Explicit per-channel caption craft** (TikTok/IG/YouTube-title/Reddit-title/X/LinkedIn conventions — see §4).
- *(Optional, signal-only)* AI-detector as an A/B *signal*, never a gate.

**Sprint J — Self-Improving Skills** *(added 2026-05-28; two-layered, see §4 safety boundary)*
- **Layer 1 (autonomous, per-tenant):** DREAMS.md as the nursery for proposed improvements/hypotheses → validated against THIS customer's outcomes → promoted to MEMORY.md durable learnings → fed forward (overlaps the Sprint C loop). This is the "grow with the user" mechanism.
- **Layer 2 (governed, cross-tenant; depends on G):** agents emit *proposed* shared-skill improvements grounded in outcomes → aggregate cross-tenant → **A/B-verified** → **gated merge** into shared skills.
- **Core contracts (firewall, evidence/grounding, safety gates) are NEVER self-editable.** No autonomous per-agent rewriting of shared skills.

**Parallel / ongoing hygiene**
- Convex→OpenClaw migration (delete-after-verify) of legacy agentic Convex code (`appInspector` regex heuristics, `judgeCardsBatch`, `mineCommentTrees`, `walkthrough` Gemini, etc. — ~13 files; Maya owns reasoning natively).
- Adopt official ScrapeCreators agent-skill.

**Recommended sequence: A ✅ → B → C first.** A done (trust restored). B (the founder's experience + a goal to optimize), C (attribution + content-attribute learning = foundation of the loop AND the data moat). **D–G = depth/defensibility. H (YouTube), I (Native Voice), J (Self-Improving Skills) are added scope** — I is high-leverage and can come early (it sharpens every draft from day one); H slots wherever platform priority dictates; J Layer 2 depends on G. The per-user compounding loop the operator cares about ("doubles down on what works, learns the founder's voice/posting/on-camera style") = Sprint C close-the-loop + content-attribute learning + Sprint J Layer 1 (DREAMS→MEMORY feed-forward), all per-tenant and safe.

### ⚠️ Go-Live Shell — what's PARKED but required before a stranger can pay (added 2026-05-28)

**Brutal-honesty note: "sprint doc done" = a top-tier AGENT, NOT a sellable product.** Sprints A–J deliver the hard, differentiated agent. They deliberately do NOT cover the boring-but-fatal commercial shell, which is parked (operator chose to build the agent first). Do not mistake "doc done" for "launchable":

- **Multi-tenant provisioning — HARD BLOCKER.** Per-user Telegram bot token is a known TODO (shared bot today → can't onboard customer #2). No paying stranger until this exists.
- **Billing** — Stripe signup→pay→provision→cancel→dunning. Absent.
- **Signup-attribution instrumentation** — Sprint C wraps clicks (ours, free) but a *click→signup* needs the user's APP to report the conversion (a snippet / connect-their-analytics / structured self-report). NOT social OAuth, NOT free. Without it the loop optimizes clicks+engagement (closer to "likes" than the "signups" thesis). **This is the real hard part of the moat — rank the three capture options in Sprint C, don't hand-wave "feed PostHog."**
- **COGS / unit economics** — per-user Fly + daily LLM judgment passes + daily scraping (×handles×platforms) + selective Gemini video-watch. **Operator decision (2026-05-28): COGS parked for now.** Working mitigation stance: cheaper models, **30-min heartbeat** (not every-tick), **don't hit ScrapeCreators every heartbeat** (only on needed crons), only-needed crons. The **operator's own week of dogfooding is the first real COGS measurement.** Formal un-park + tier-pricing analysis comes after the dogfood week, before public launch. Still: bound frequency + selectivity on all always-on crons as we build them.
- **Consumer onboarding + account-connection UX** — a non-technical vibe-coder completing it alone.

The shell is mostly *known* work (Stripe, Clerk, per-user bot provisioning) — not the risky part — but it's a real sprint that must happen between "agent done" and "launch."

---

## 7. The 3 stability bugs — root causes + fixes (Sprint A) — ✅ ALL RESOLVED (2026-05-28)

1. ✅ **MEMORY.md edit failures.** OpenClaw's edit tool is exact str-replace. `renderMemory` seeded placeholder lines like `hello_sent_at: <set this when I send the intro>`; across boot + heartbeat ticks one tick tries to replace text a prior tick already changed → *"Could not find the exact text in MEMORY.md."* **Fixed:** replaced placeholders with a single **APPEND-ONLY lifecycle log** (read = last line with `key:` prefix; record = append). No in-place marker edit ever again.
2. ✅ **Infra leaks.** `outboundFirewall.ts` has the banned-term list but the doc claimed it was never called at send time. **Already shipped (Sprint 2.28):** `sendUpdateHttp` (`inboundCallback.ts:1159`) calls `validateOutbound` fail-closed before forwarding to Telegram. No action was needed.
3. ✅ **Double / out-of-order hello.** BOTH `BOOT.md` and the `0001_kickstart` cron (fired +300s, sent **unconditionally**) sent the hello; no idempotency. **Fixed:** kickstart now does an idempotency check FIRST (no-ops if a `hello_sent_at:` line exists); BOOT routes hello-before-foundation; specs reconciled to short + rolling-week.

---

## 8. Infra / ops notes (for the next session)

- **Deploy + test harness:** `convex/_admin/realWorldDeployGtm.ts`. Deploy a real ClawLaunch: `arch -arm64 npx convex run _admin/realWorldDeployGtm:run '{"productName":"…","productUrl":"…","founderWhy":"…","weekGoal":"signups","stage":"live-beta","budgetUsd":1.0,"deployFly":true,"telegramChatId":"8376373926"}'`. Verify: `inspectLatestSynth`, `peekFoundationState`, `peekResearchLanded`, `inspectLatestFlyMachine`. Telegram smoke: `pingLatestSynthOnTelegram`. **Cleanup surgically** (only the app you created) via `flyctl apps destroy <app> -y` — do NOT blanket-destroy.
- **esbuild/Rosetta blocker:** prefix ALL convex CLI with `arch -arm64` (e.g. `arch -arm64 npx convex dev --once`). `npx convex` otherwise spawns x64 needing `@esbuild/darwin-x64` while only arm64 is installed.
- **GTM skills are AUTO-GENERATED into the bundle.** Edit `agents/skills/maya-gtm/<slug>/SKILL.md`, then `npx tsx scripts/sync-bundled-local-skills.ts` (regenerates `convex/agents/packs/maya_gtm/bundledLocalSkills.ts`), then `arch -arm64 npx convex dev --once`, then redeploy. Never hand-edit bundledLocalSkills.ts.
- **Log access:** harness `tailLatestMaya` is BROKEN (uses dead Fly GraphQL `vmLogs`). Use `flyctl logs -a <app>` directly with `FLY_API_TOKEN` from `.env.local` (flyctl runs x64; no `arch` prefix). SSH: `flyctl ssh console -a <app> -C "…"`. OpenClaw session transcripts on the machine: `/data/agents/<id>/sessions/*.jsonl`.
- **Model config (OpenRouter):** main `google/gemma-4-26b-a4b-it` (reasoning hidden); workers `google/gemini-3-flash-preview` (thinking medium); extraction `google/gemini-3.1-flash-lite`. Subagent `runTimeoutSeconds` raised 900→1500 this session.
- **API keys (set on staging Convex this session):** `TWITTERAPI_IO_KEY`, `GEMINI_API_KEY`, `SCRAPE_CREATORS_API_KEY`, `OPENROUTER_API_KEY`. `collectDeploySecrets` (deployMayaGtm.ts:1312) forwards them to the Fly machine.
- **Deployments:** `dev:precise-canary` = **staging** (CONVEX_DEPLOYMENT + all CLI work). `vibrant-platypus` is in `NEXT_PUBLIC_CONVEX_URL`. **Confirm with operator which is prod before touching prod.** Branch `staging`.
- **Telegram:** staging bot = **@Tommymmymmymm_bot** (token on staging Convex). Operator chatId = `8376373926`. (Local `.env.local` has a different bot, @mayatesstteest_bot — ignore for deploys.)
- **Multi-channel test matrix idea:** to exercise ALL channels, deploy contrasting products (dev tool → Reddit/HN/X; consumer visual → TikTok/IG; B2B → LinkedIn) and grade per-channel returned depth.

---

## 9. Uncommitted work from the 2026-05-28 session (on `staging`, NOT committed)

- **Onboarding digestion handoff:** `gtmApps.diagnosis` now threaded into APP.md (was dropped); URL inspected AND walkthrough analyzed (was either/or); walkthrough video URL threaded so Maya digests herself. (`generators.ts renderApp` + input type, `deployMayaGtm.ts`, `app/onboarding/gtm/page.tsx`.) Regression test added to `generators.test.ts` ("renders digested onboarding diagnosis"). tsc clean; 4 pre-existing generators.test failures are stale drift (not from this work).
- **Deepened ALL per-channel research skills** (judgment-only, signups-not-likes, full comment-tree/pagination/engagement-window/buyer-language): `maya-continuous-research`, `maya-reddit-demand-researcher`, `maya-x-founder-led-researcher`, `maya-linkedin-fit-researcher`, `maya-tiktok-format-researcher`, `maya-tiktok-demo-strategist`, `maya-viral-demo-moment-miner`, `maya-competitor-researcher`, `maya-content-format-miner`, `maya-foundation-research` (closes buyer-journey + relationship-target gaps). Synced into `bundledLocalSkills.ts` + pushed to staging Convex.
- **Runtime:** `runTimeoutSeconds` 900→1500 in `deployMayaGtm.ts buildGatewayConfig`.
- **Landing (separate track):** Sprint 2.31 landing committed earlier (`dacdb9c`); a later "A normal week" rewrite + first-pane spacing may be uncommitted — check `git status`.
- **Recommendation:** commit this before/after clearing context so it's not lost. See [[project_gtm_ideal_agent_build_2026_05_28]] for finer detail.
