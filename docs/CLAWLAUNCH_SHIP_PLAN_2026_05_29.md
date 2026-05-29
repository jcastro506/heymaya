# ClawLaunch — Build & Ship Plan (locked 2026-05-29)

**Canonical execution doc.** Vision/context lives in `CLAWLAUNCH_GTM_V1_VISION_AND_SPRINT_PLAN.md` (§12 points here). ICP lives in memory `project-clawlaunch-icp-locked-replyguy-customer`.

## North star
Ship a **ReplyGuy-killer** to paying pilots: ReplyGuy's job (find buyer conversations → reply), but **more platforms + in the founder's voice + ban-safe + with attribution**, run by an OpenClaw agent that *understands the product, not just keywords.* Path: build on `staging` → operator runs onboarding → multi-day live test → push to `main` → first paying customers (Calacanis/Founder-University cohort).

## Locked decisions
- **ICP:** ReplyGuy's customer — B2B/SaaS/dev/prosumer indie makers, solo founders, small teams, early startups w/o a marketing team. Persona "Sofia." Validate via 3–5 **paid pilots**.
- **Positioning:** "The GTM cofounder for solo builders — the growth hire you can't afford yet." Win on quality + ban-safety + strategy + full-loop, not raw capability.
- **Pricing:** single tier **$99/mo** (test mode first). Margins ~73%. `planFeaturesGtm` server-side/fail-closed, structured so a $49 tier drops in later. (No $49 / no annual yet.)
- **Models:** main brain **`moonshotai/kimi-k2-0905`** (agentic, 262K ctx; replaced Gemma-4 which was too weak). Workers **`google/gemini-3-flash-preview`** ($0.50/$3). Multimodal **watcher** worker (Gemini Flash) handles video/image — main brain need not be multimodal. Pin exact model IDs (never silently route to 3.5-flash). Same brain quality for all tiers (voice = the moat).
- **Infra:** per-user OpenClaw Fly machine **always-on** for v1 (~$15/mo COGS floor; scale-to-zero unreliable for our cron+slow-boot case — verified). COGS ≈ **$22/customer/mo**.
- **HN:** read via **Algolia HN API** (free). Posting = hand-off only (no API).
- **Funnel:** **cheap grounded teaser → pay to unlock + activate.** No free-full-research, no 7-day trial. ~$0.50–1 teaser pass → "I found where your buyers are + a plan, unlock + put me to work, $99/mo" → pay → full deep research + deploy. Bounds free COGS <$1/signup; gates the $15 machine.

## Channel-selection design (locked 2026-05-29)
Neither "user picks" (they don't know) nor "agent black-box picks" (no trust). **Maya proposes with evidence, user decides.**
- **Criteria (scored from real evidence):** buyer presence × buyer intent × format fit × founder capability × ban-risk × effort-to-payoff.
- **Cold-start = evidence-driven:** don't even start on channels where research shows no buyers (no spraying a dev tool onto TikTok).
- **Ongoing = performance-driven:** among started channels, real results decide double-down vs drop.
- **Flow:** product + 3 capability Qs → teaser research across candidates → **ranked, evidence-backed recommendation with reasoning shown** → user confirms/overrides → engage → re-evaluate. **All platforms always available + ungated;** Maya focuses the relevant set. Self-correcting (evidence upfront + results ongoing + user override) — so it can't drift catastrophically wrong silently.
- **OPEN QUESTION (not doctrine):** "focus 1 channel" is shaky for us (agent removes the attention constraint; reply-motion means buyers span 2–3 venues; ReplyGuy monitors all). Validate single- vs multi-venue speed-to-first-users in the pilots.

## Research-depth audit (2026-05-29) — drives S0
HONEST verdict: **deep on Reddit, thin/missing elsewhere.** Deep: Reddit posts + comment-tree mining, LLM pain/buyer scoring, citation-firewall (grounded-or-silent), 6-phase orchestration. **Gaps:** X = keyword search only, 1 page, NO reply/thread mining · TikTok/IG = search only (comment endpoints exist, unwired) · HN = Algolia search only, no comment-tree · LinkedIn = NO worker · **open web (`web_search`/`web_fetch`) NOT wired into the orchestrator** (product-positioning/competitor-strategy/G2/blogs barely researched) · workers single-pass (stop at call cap, no adaptive deepening) · no cross-platform triangulation · LLM-scorer fallback silent · a hardcoded "skeleton" mode exists (test fallback risk). **This is a prerequisite — Maya's channel recommendation is only as good as how deeply she looks per channel.**

## Research output + handoff spec (locked 2026-05-29)
**Principle: show, don't tell — research returns receipts, never generic text.** ("Reddit is good for you" = worthless; "here are 4 live threads where your buyers say *this* [links+quotes] + a reply I'd post [draft]" = the wow + the sale.)
- **Per recommended channel → a "channel verdict card":** verdict + why · **3–5 real source links + verbatim quotes** (a *pattern*, not one example) · the play (what we'll do here) · **≥1 real voice-matched sample draft** (the killer proof of the deliverable). Per-channel shaped: Reddit thread deep-links, X tweet links, TikTok example-video links + the recurring winning format, HN thread links, LinkedIn posts.
- **Delivery, two surfaces:** **Telegram** = tight cited summary + one killer sample draft + link to Mission Control (never a wall of research in chat). **Mission Control → Research tab** = the full rich, browsable breakdown (all links/quotes + buyer/competitive maps).
- **"Give me an example" always works** — research is stored as **cited evidence cards** (url + verbatim snippet); the citation-firewall guarantees grounding; Maya pulls a real thread + quote + draft on demand.
- **On approval → a rolling 7-day calendar** (NOT a 14-day dump): the approved **target threads become reply-events**, **content angles become posts**; **effort-tiered** (text replies = daily ⚡10-min loop; video = spaced-ahead 🎬 Briefs); each event = **link-first → ready content → why → success metric**; regenerated weekly by what converts.
- **Go-time:** the event sits in Google Calendar at the optimal minute **+** Maya texts the Telegram nudge with the link + ready text. One tap.

## Working-updates spec (what she texts WHILE working — locked 2026-05-29)
The two bookends were designed (hello + final synthesis); the **middle — the progress pings during the 10–15 min wait — was not.** It's what turns the wait into "watching an expert work" instead of a black box.
- **The arc (first-wake):** hello → **~3 min** first real signal (*"Already seeing it — r/devops + r/macapps have founders venting about exactly this; pulling the best threads, checking X + HN too"*) → **~7 min** substance (*"~6 live threads asking for alternatives + mapped your top 3 competitors' weak spots; working out which 1–2 channels to bet on"*) → **~11 min** almost-there (*"drafting your first replies in your voice + laying out the week"*) → the plan (synthesis).
- **Rules:** plain language, **zero internal terms** (never "workers / subagents / foundation pass / scorecard / phase / scanning"); every update carries a **real specific finding + what's next**; paced ~1 per 3–5 min (not silence, not spam); honest ("~15 min," "almost there"), never probe-speak ("40% complete").
- **Daily/ongoing:** ping only when there's something worth saying ("your 9:30 reply is at 18 upvotes, OP just replied — worth a follow-up"); silent (HEARTBEAT_OK) otherwise.
- **CRITICAL — grounded in real state (same gate as S4):** an update must reflect what *actually landed*. She cannot say "found 6 threads" if 1 POSTed, or "building your calendar" before `calendar_proposal` returned events. The progress pings obey the **same output-critic enforcement** as the synthesis — say only what's real in the database. This is why working-updates ship *with* S4.
- **`post_activity`** stays the granular Mission Control feed; the **Telegram updates are the curated milestones** (only the wow-worthy beats).

## Architecture decision — the research engine (use the better path, not just what exists)
Two research paths exist today: (a) the **Convex `runBudgetedResearchJob`** orchestrator — deterministic, budget-capped, but **single-pass and shallow** (stops at an 8-call cap, no looping, Reddit-only depth); and (b) the **OpenClaw-native skill orchestration** (the agent spawns per-channel research subagents with judgment). **Decision: make OpenClaw-native the canonical deep-research engine.** The agent orchestrates per-channel deep research — multi-source pulls + comment-tree descent + **`web_search`/`web_fetch`** for product/competitor/niche/G2/blogs — and **loops until the evidence is genuinely deep** ("that's thin, go get more"), with NO rigid call cap. It reports structured, **cited** evidence back to Convex via the hook callbacks. **Convex's job = store evidence + enforce the cost-cap budget guardrails + serve UI/gating — NOT orchestrate the research.** Retire/demote the Convex single-pass orchestrator *after verifying* the native path is deeper (delete-after-verify). Judgment-driven depth bounded by Convex cost guards is what makes "genuinely deep on every channel" real — a fixed 8-call cap never will be. **S0 builds to this.**

---

## Architecture decision — video-watch / multimodal (locked 2026-05-29)
**All TEXT LLM goes through OpenRouter (K2 brain + Gemini workers). But OpenRouter is text-only — it cannot proxy video multimodal.** So watching a video is the ONE exception: it routes to the **shared `services/video-synth-worker`** (yt-dlp download → **direct** Gemini Files API watch), NOT through OpenRouter, NOT per-machine yt-dlp. The GTM agent (or a Convex action) calls the worker `POST {videoUrl, what-to-analyze}` → gets back a **structured analysis** `{ transcript, hook, pacing, key visual beats, format pattern, why-it-works }`. One worker + one direct-Gemini key serves all users; the agent stays text-only. **Today this worker is wired to the *creator* product, not GTM — wiring it into GTM (for visual format-mining + S13 user-submitted-video feedback) is S0/S13.** Capability pieces verified 2026-05-29: data APIs 6/6 (local harness), `GOOGLE_API_KEY` is a valid Gemini key, yt-dlp installs+runs, worker shipped. Remaining = wiring + a `maya-video-watcher` skill (when/what/how), no Fly deploy needed to build.

# Sprints (ordered for build → ship → customers)

### S1 — Live agent reliability (FIRST; nothing works if the agent can't talk)
- Fix `No session found: current` — Maya's Telegram reply path fails to resolve, so she can't answer DMs.
- Verify **Kimi K2 0905** live on real hello + synthesis (deploy test Maya, judge voice + agentic reliability vs old Gemma output). Confirms the model A/B.
- **Done =** deployed Maya gives a specific grounded hello + reliably answers DMs.

### S0 — Research-depth parity (THE core-value sprint; gates channel-selection credibility)
Bring every channel up to Reddit's depth + wire open-web research:
- **X:** mine reply threads / quote chains / conversation context (TwitterAPI.io tweet-relations + user tweets), >1 page. (X's value is the replies.)
- **HN:** comment-tree descent via HN `/item/<id>` recursion (Algolia for discovery, item API for trees).
- **TikTok/IG:** wire the existing comment endpoints into the research path (buyer language in comments).
- **⚠️ VERIFY the never-tested paths (as of 2026-05-29 these APIs had NEVER been called):** confirm the **TikTok + Instagram ScrapeCreators endpoints actually return data**, and that the **download → Gemini multimodal-watch flow works end-to-end** — pull a real video/image and confirm the Gemini watcher actually processes it (the `geminiCalled` proof). Today only Reddit/HN/X/LinkedIn have been exercised; TikTok/IG + the multimodal watch are unproven.
- **`web_search` is DISABLED on the deployed agent** (every call failed in the live test) — enable/wire a provider. Secondary (the paid APIs carry the real research), but it's the open-web/competitor-positioning lane (G2, blogs, competitor sites), currently dead.
- **LinkedIn:** add a real research worker (comment-mining on relevant posts).
- **Open web:** wire `web_search`/`web_fetch` into the orchestrator — research the product, competitors' own sites/positioning/pricing, G2/Trustpilot, niche blogs. (Currently social-proof-rich, positioning-thin.)
- **Citation precision:** every cited URL+quote must match its actually-fetched source (live test had one real HN item ID stapled to the wrong quote). A customer clicks these — they must land on the real source.
- **Iterative deepening:** workers re-query / broaden when a pass is thin (don't just stop at the call cap); cross-platform triangulation (thin platform → targeted second pass).
- Surface LLM-scorer degradation instead of silently falling back; confirm no path can silently use the hardcoded "skeleton."
- **Done =** a research run produces grounded, cited buyer evidence + competitor-positioning context across the *relevant* channels, deep enough that the channel recommendation is trustworthy.

### S2 — Billing + teaser-paywall + gating ($99/mo)
- **M0 (operator):** Stripe product + $99/mo price (test), keys in Convex env, webhook registered.
- `planFeaturesGtm(creator)` + `"clawlaunch"` plan value + `subscriptionStatus`/`currentPeriodEnd`.
- Reuse `convex/billing/{checkout,portal,webhook,priceIds,stripeClient}.ts`: GTM checkout, webhook → plan/status (idempotent, signature-verified), portal link.
- **Gate `runMyGtmDeploy` on active sub** (no machine without payment). Paywall = "subscribe to activate" after the teaser.
- Cancel/past-due → **stop the Fly machine** (stop-not-destroy) + gate endpoints; reactivate → restart.
- Billing UI in Mission Control Account tab (white/black themed).
- **5 mandatory tests:** cross-tenant · plan×action fail-closed (incl. reads) · adversarial (forged webhook/tampered price) · idempotency (Stripe replay) · sibling coherence.

### S3 — Fast onboarding teaser hook + channel-selection UX
- ~$0.50–1 teaser research pass (relevant candidates, real threads, one-line plan) shown in minutes + texted.
- **Channel-selection UX:** ranked, evidence-backed recommendation with reasoning + user confirm/override (toggle candidates). All platforms available.
- "Unlock + activate" paywall before the full deep research/deploy. (Couples with S2.)

### S4 — Actionable layer: the research→thread→draft→calendar chain (THE blocker — diagnosed live 2026-05-29)
**Root cause (from the live test):** first-wake runs the foundation (5 *strategy* workers → 53 reliable POSTs) but **none of them surface reply-target threads.** So `maya-calendar-populator` (trigger: `target_threads > 0`) never fires → **0 calendar events, 0 drafts, 1 thread** — while Maya *narrates* "building your calendar." The actionable POSTs lack the per-item discipline the foundation workers have (each foundation worker *is* a POST; thread-surfacing returns text to Maya, who improvises the POST and mostly doesn't).
**Fix — make the chain a structured first-wake step, BEFORE synthesis, with foundation-grade POST discipline:**
- After foundation → spawn per-channel **demand-research workers** whose job *is* to **POST each surfaced thread to `/lc_gtm/target_thread` with a `draftReply`** + **POST the draft to `/lc_gtm/drafted_content`** (one POST per item — not "return to Maya").
- Then **`calendar-populator` fires** (now it has threads + drafts) → POSTs `calendar_proposal` → events land.
- **Then synthesis** — calendar + drafts already written (matches BOOT.md line 274: "the plan that lands with synthesis is the plan ready to act on").
- **Output-critic gate:** never claim "calendar built / N threads ready" unless the POSTs actually returned events/threads (no narrating undone work — the agent must not say it did something it didn't).
**Plus the one-tap execution layer:** `buildDeepLink(platform, action, target, text)` — Tier-1 pre-fill (X / Reddit-post / HN / Threads); Tier-2 direct+paste (Reddit-comment / LinkedIn / IG / YT). Each calendar event = link-first → platform-shaped ready content (text = paste-ready w/ tracked link; video = Brief) → why → success. **Effort-tiered:** text = daily ⚡10-min loop; video = spaced 🎬 events. `validateCalendarEvent` fails a text event with no link/ready-copy. Telegram go-time nudge reuses the payload.
**Done =** approve the plan → real threads + drafts + a populated Week-1 calendar land, each one-tap. (This is the single highest-leverage fix — everything upstream already works.)

### S5 — Multi-day live test (validate the assembled product over DAYS)
- Deploy a real Maya (real product) and **let it run for several days.** Observe across days: daily cron/heartbeat fires, research stays grounded + deep, drafts pass slop+voice gates, calendar/hand-off works, attribution records, COGS stays in band, no crashes/leaks.
- **Explicitly exercise EVERY channel — incl. TikTok + Instagram (never called) + the multimodal download→Gemini-watch path.** Pick a product where video channels matter (or force all-platform). Confirm each pipeline returns real data, not a silent skip.
- **Test user-submitted content (S13):** founder sends a finished post/video → confirm ingest → watch → feedback works.
- Judge from the user's POV daily: specific not generic, posts AND replies, can answer DMs, channel recommendation holds up, **she's fun to talk to (S12) without being cheesy.**
- **Done =** several consecutive good days with no manual intervention — proof it's a product, not a demo.

### S6 — Legacy purge (hygiene)
Delete creator + service UI/routes/components (`app/(creator)/`, `app/creators/`, `app/onboarding/maya/`, `app/(business)/`, `app/onboarding/business|growth/`, `components/creator|business*/`); simplify middleware; drop `NEXT_PUBLIC_ENABLE_CREATOR_PRODUCT`. UI/routes first; Convex tables later. (Overrides CLAUDE.md "creator preserved behind flag" — git retains it.)

### S7 — Delete-account done right (before public launch)
Add ~47 `gtm*` tables to `accountDeletion.ts` cascade + collect `gtmAgents.openClawFlyAppId` for Fly destroy; wire `deleteMyGtmAccount` to real purge; Clerk sign-in/out + custom delete UI; add `user.deleted` Clerk webhook backstop; **exempt** cross-tenant learnings; stop-answering = destroy/stop Fly (inbound Telegram → Fly directly, so a Convex flag alone won't silence her).

### S8 — Indispensability depth
Port TikTok format-recurrence rigor to text channels (drafts match the format provably converting this week); velocity-ranked "trending in your niche today" surface that pre-drafts the twist; the "their product" twist = app-inspector ProductDiagnosis × mined format, required in every draft.

### S9 — Reposition / landing as ReplyGuy-killer
Marketing copy + capability grid vs ReplyGuy/Devi; the cohort paid-pilot pitch (written to Sofia).

### S12 — Personality (make her fun to talk to)
Right now she's competent but dull. Give her a voice with character — a sharp, warm, slightly-dry growth-savvy friend who has opinions, celebrates wins, and is genuinely fun to text. **Crucially: personality from VOICE, not decoration** — word choice, stance, specificity, warmth, dry wit — NOT exclamation spam, emoji vomit, hype, or forced jokes (the slop-critic still bans those, and should). The bar: *fun to talk to, never cheesy/cringe.* Work: tune SOUL.md persona + capture voice exemplars of the target tone; then verify the slop-critic/voice-matcher **lets the warmth through** (tune the gate so "human + warm + opinionated" passes while "cheesy/hype" still fails) — today the gate may be flattening her into corporate-neutral.

### S13 — User-submitted content review (founder sends a finished post/video)
Founders WILL send Maya an edited, ready-to-post video/image/caption — we must handle it: (a) **ingest** the Telegram attachment → storage (R2/Convex; HEIC→JPEG, debounce — the attachment-bridge pattern), (b) **watch it** (multimodal Gemini watcher — actually view the video/image), (c) **give real, specific feedback** ("strong hook; cut to the demo by 0:02; caption's buried — front-load the keyword"), (d) **approve → post (or one-tap hand off)**. Depends on the multimodal watcher + the attachment bridge. This is also part of what S5 must exercise.

### Later (post-validation)
- **S10 — Convex-as-waker scale-to-zero:** route Telegram + cron through always-up Convex → per-user machine scales to zero → cuts machine COGS ~$15→$3 → makes a profitable $49 tier viable.
- **S11 — $49 "Launch" tier:** add second tier + server-side gating (Engage vs Operate: gate volume/cadence/#products/operate-layer; never platforms/voice).

---

## Build → ship sequence
1. **S4** (actionable chain → calendar) + **S1** (agent reliability) — the core loop must actually *write the plan*, not narrate it, and she must reliably reply. *(S1 reply path already verified live 2026-05-29.)*
2. **S0** (research depth — incl. verifying TikTok/IG + the multimodal download→Gemini-watch path that's never been tested; enable web_search; citation precision).
3. **S3 + S2** (teaser onboarding + channel-selection UX + billing/paywall) — the funnel + the way to charge. **Add Google Calendar connect to onboarding** (so "add to your calendar" works; in-app plan is the no-OAuth fallback).
4. **S12** (personality — fun to talk to) + **S13** (user-submitted-content review) — what makes it delightful + complete.
5. **S5** (multi-day live test) — validate the assembled product over days, **exercising every channel incl. TikTok/IG + multimodal + user-submitted content.**
6. **Destroy test machine → operator deploys from web (localhost fine for now) → connects Google Calendar → full end-to-end run** (signup → onboarding → research → approve → calendar populates → one-tap execute).
7. **S6 + S7** (legacy purge + delete-account) — pre-launch hardening. Then **push to `main`** → first paying pilots from the cohort.
8. **S8 + S9** (depth + repositioning); **S10/S11** when opening the $49 tier.

**MVP-ready (does everything we claim) = S4 + S1 + S0 + S2 + S3 + S12 + S13, validated by S5.** That's: a founder signs up → sees real grounded research with receipts → a plain-language, *fun* plan → approves → their Week-1 calendar fills with one-tap replies + posts (+ video Briefs) across the right channels → they can send Maya their own content for feedback → and it's all ban-safe, in their voice, with proven ROI. That's the whole promise, end to end.
