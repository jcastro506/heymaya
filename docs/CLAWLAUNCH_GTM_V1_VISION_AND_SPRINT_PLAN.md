# ClawLaunch — GTM Agent: Vision, Moats & Sprint Plan (v1)

**Status:** Canonical planning doc. Written 2026-05-28 after a full 5-agent audit of the GTM codebase against a first-principles product vision. This is the restart artifact — read it top to bottom to resume work.

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

---

## 5. Current state — consolidated audit (HAVE / PARTIAL / MISSING)

**HAVE (the thinking layers, good):** deep multi-channel research (now deepened — see §8), product digestion → APP.md, ICP hypotheses, channel-strategy judge, drafting + voice-match + slop/output critics, content engine breadth, proactive cadence (morning 7am / evening 8pm / weekly Sun / monthly), anti-sycophancy enforcement (`outboundFirewall.ts` term list exists), approval state machine, `gtmRelationshipTargets` table, `gtmPostResults` engagement snapshots.

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

**Sprint A — Trust & Stability** *(ship first; trust is breaking now)*
- Wire the EXISTING `convex/gtmMaya/outboundFirewall.ts` into the server-side `/lc_gtm/send_update` path → every outbound message validated server-side; no infra term ("Convex", endpoints) or raw tool-error ("Edit failed") ever reaches Telegram. **Fail-closed, not prose** (today the firewall is a utility that's never called at send time — that's the whole leak).
- Fix MEMORY.md write fragility — replace seeded placeholder lines (`hello_sent_at: <set this when…>`) with stable header-anchored / append-only markers + read-before-edit. (Root cause: OpenClaw edit tool requires exact-string match; placeholder drift across heartbeat ticks → "Could not find the exact text in MEMORY.md".)
- One **idempotent** hello, intro guaranteed **before** synthesis — dedupe BOOT.md hello vs the `0001_kickstart` cron (which currently sends unconditionally 300s post-deploy). Use an idempotency marker.
- *(Parallel)* main-brain model A/B: Gemma-4-26B vs a stronger model for operator-facing voice + synthesis quality.

**Sprint B — The Plan, Reframed** *(the founder's actual experience)*
- North Star contract: map goal → concrete target ("first 100 signups by Day 30"); store on `gtmApps` (`northStarMetric`/`northStarDeadlineMs`); render in GTM.md; track.
- Synthesized one-sentence POV at onboarding (promise / problem killed / activation), validated before research.
- Strategy approval loop: propose strategy → "approve / iterate / more research" before execution (`strategyApprovalState` on `gtmResearchJobs`).
- Plan = strategy brief + **rolling 7-day** (today→Sunday); launches proposed, never auto-scheduled.

**Sprint C — Close the Loop + Attribution** *(the moat foundation)*
- Attribution-lite: our own link-wrapper/redirect + UTM on every drafted link → capture clicks; restore **signup capture** (re-add to `gtmPostResults` or a `gtmConversions` table); feed our PostHog (already provisioned).
- Make `weekly_review` **regenerate the rolling 7-day plan + re-weight bet channels/angles from the week's data** (kill the one-way ratchet), with counter-overfitting discipline (≥repeated signal, 2-week rule for big shifts); **move to Sun 7pm**.
- Make T+2h/24h/7d result polls actually fire on a schedule (not just heartbeat read).
- North-Star status (on-track/at-risk) in the weekly review.

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

**Sprint F — Honest Diagnosis**
- Positioning-vs-distribution diagnostic: detect "audience saw it but didn't want it" (messaging/product) vs "never saw it" (distribution); tell the founder the hard truth with evidence; feed weekly-review verdict + strategy reconsideration.

**Sprint G — Moat Infrastructure** *(the data moat; depends on C)*
- App-archetype tagging at onboarding + privacy-safe cross-tenant aggregated-learnings store → per-archetype playbooks that warm-start new customers + benchmarks.

**Parallel / ongoing hygiene**
- Convex→OpenClaw migration (delete-after-verify) of legacy agentic Convex code (`appInspector` regex heuristics, `judgeCardsBatch`, `mineCommentTrees`, `walkthrough` Gemini, etc. — ~13 files; Maya owns reasoning natively).
- Adopt official ScrapeCreators agent-skill.

**Recommended sequence: A → B → C first.** A (a leaking/memory-dropping agent can't be trusted), B (the founder's experience + a goal to optimize), C (attribution = foundation of the loop AND the data moat). D–G = depth/defensibility.

---

## 7. The 3 stability bugs — root causes + fixes (Sprint A)

1. **MEMORY.md edit failures.** OpenClaw's edit tool is exact str-replace. `renderMemory` (generators.ts ~810-832) seeds placeholder lines like `hello_sent_at: <set this when I send the intro>`; across 3+ main sessions (boot + heartbeat ticks) one tick tries to replace text a prior tick already changed → *"Could not find the exact text in MEMORY.md."* **Fix:** header-anchored/append-only markers, read-before-edit.
2. **Infra leaks** ("locked in Convex", "📝 Edit: in MEMORY.md failed" reaching Telegram). `outboundFirewall.ts` has the banned-term list (Convex, endpoints, tool-errors) **but is never called at send time** (it's prose-contract only). **Fix:** call it server-side in `/lc_gtm/send_update` before forwarding to Telegram — fail-closed.
3. **Double / out-of-order hello.** BOTH `BOOT.md` (generators.ts ~729-779) and the `0001_kickstart` cron (~967-1044, fires +300s, sends unconditionally) send the hello; no idempotency. Seeded placeholder marker also makes BOOT misjudge "already sent" and skip the intro → synthesis went out *before* the intro in the live test. **Fix:** one idempotent path; intro before synthesis.

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
