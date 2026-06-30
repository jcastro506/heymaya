# Maya v2 — The Organic Social Manager (ground-up redesign on OpenClaw)

**Status:** Design locked, build pending. Supersedes the prior GTM agent design.
**Author:** redesign session 2026-06-24+.
**Companion docs:** `docs/AGENT_DEFECTS_V1.md` (the 16 defects this fixes), `docs/DASHBOARD_PRODUCT_SURFACE_V1.md` (UI IA this builds on).

---

## 0. The product, in one sentence

> **One product → one always-on Maya that becomes a native member of the few communities where that product's buyers live, and engages there every day to earn signups — provably.**

Two jobs, only two: **Understand once. Engage forever.** Everything below serves those two.

We keep **OpenClaw** as the foundation — its heartbeat, cron, SOUL/AGENTS `.md` system, dreaming (self-reflection), skills, and persistent memory are exactly the primitives a 24/7 social manager needs. The v1 failure (the ~$30/hr runaway loop) was a contained bug, not a foundation problem. v2 keeps the engine and fixes the **shape of the agent**: small, judgment-only, no subagent fan-out, durable state in Convex, idempotent loops.

---

## 1. The mental model — how a human social media manager actually works

We are recreating a person. A good human SMM runs **four distinct activities**, on different rhythms:

1. **Plans the day** — sits down with coffee, decides "what kind of day is this": what to post, what the niche is talking about, roughly how much to engage.
2. **Posts something deliberate** — the one intentional piece of content. Low frequency, high care.
3. **Engages opportunistically all day** — scrolls, comments, replies, is helpful/funny — *mostly not about the product.* High frequency, scattered, human-paced.
4. **Responds to inbound** — when someone replies to them, they reply back. Because they're a real person.

And on a longer rhythm:

5. **Reflects and learns** — reviews what landed, develops instinct, stays current on the niche.

Maya maps each of these onto an OpenClaw primitive. That's the whole design:

| Human activity | OpenClaw primitive | Cadence |
|---|---|---|
| Plan the day | **cron** (morning) | daily, early, user's TZ |
| Post deliberate content | **cron** (timed) | 1/day or a few/week per channel |
| Engage opportunistically | **heartbeat** | every ~10–20 min, waking hours |
| Respond to inbound | **events** (webhooks) | reactive, batched |
| Reflect & learn | **dreaming** | nightly + weekly |
| Stay current on niche | **cron** (monthly research refresh) | monthly |

**Core principle: the heartbeat WORKS (silently); cron and events TALK; dreaming LEARNS.**

### 1.1 Maya is a growth operator, not a community manager

"Be a helpful member of the community" is the *license to operate*, not the engine. Scattered helpful comments convert terribly. What actually drives signups is **demand interception** — being present at the moment of intent. So every conversation Maya finds sorts into a **funnel**, and the day's budget allocates against the funnel, not against a "helpfulness quota":

- **Tier 1 — Buying intent (the customers).** Someone explicitly asking "what's a good tool for X," "alternatives to [competitor]," or describing the exact pain we solve. Here a product mention is *welcome and converts.* Maya **hunts these relentlessly and strikes fast** — freshness is a ranked priority (a 20-min-old "anyone recommend…" thread is gold; 6h old is half-dead).
- **Tier 2 — Warm / adjacent.** Problem-space discussions where we're relevant but unasked. Soft mention or pure value, to seed presence.
- **Tier 3 — Pure presence (the cover + account-warming).** Helpful/funny engagement, zero product angle. This is *infrastructure* — account age, karma, history, recognizability — that keeps Tier 1 from reading as a single-purpose shill and getting banned. Necessary, never the point.

**Community presence is the license; intent-striking is the revenue.** You build the first in service of the second. The KPI is **qualified conversations struck → clicks → signups**, not interaction count. (See §7.5 for why Tier 3 is also the ban-safety layer, and §14 for why this is the unoccupied lane.)

---

## 2. Architecture — keep OpenClaw, shrink the agent (DECIDED)

> **Decision: we keep OpenClaw and rebuild the *shape of the agent*, not the engine.** Small, judgment-only agent · no subagent fan-out · durable Convex rows as truth · idempotent loops · the `.md` layout in §2.2 · the seven skills in §6. This is locked; §13 builds it.

### 2.1 The non-negotiables (these are what fix v1)

1. **No subagent fan-out.** Research is a bounded, mostly-sequential pass. No 18-worker fleet, no parent-collects-children barrier. *This single change kills the runaway loop.*
2. **Convex rows are truth, never callbacks.** "Research done" = a synthesis row exists in Convex. The heartbeat reads the row. No `subagent_complete` in the critical path.
3. **Every loop is idempotent against durable state.** Check before acting: research row exists → never re-research; today's post done → skip. An idempotent loop cannot run away.
4. **The agent does judgment; deterministic code does I/O.** OpenClaw's brain decides *what is worth saying*. Convex code pulls feeds, posts via Zernio, pulls analytics. Keep the agent's surface small.
5. **Caps throttle, never destroy.** Over-budget → degrade (pause new expensive work, keep monitoring + answering), machine stays alive. Teardown is only for explicit cancellation. (See `feedback_caps_throttle_never_destroy`.)

### 2.2 Shared brain, per-customer soul

Exactly **one** `.md` file varies per customer. Everything else is one version-controlled copy shared by every Maya. This is what makes 1,000 agents maintainable.

| File | Scope | Job |
|---|---|---|
| `IDENTITY.md` | shared | The floor: "I am Maya. I run the organic social for one product. I am a real participant in communities, not a billboard." |
| `SOUL.md` | **per-customer** | Voice spec + product truth + ICP map + bet board. Generated from research at deploy. **The only per-customer file.** Has *stable* sections (identity, product truth) and *living* sections (topic/angle library, "what's working now") that dreaming + monthly research update. |
| `AGENTS.md` | shared | Doctrine: grounded-or-silent, value-first (never shill), ban-safety, approval rules, how to use each skill, when to escalate. |
| `BOOT.md` | shared | First-wake script: run the bounded research pass → write SOUL → send first message → flip to `engaging`. Idempotent — reads Convex, never re-runs. |
| `HEARTBEAT.md` | shared | The opportunistic engagement loop (the "scrolling"). The most-run file in the system. |
| `cron.md` | shared | Wall-clock calendar: morning plan, deliberate post, daily/weekly recap, monthly research refresh, analytics pull. |
| `DREAMS.md` | shared | The reflection loop: read the ledger + attribution, learn what converted, tune the ratio + bets, update SOUL's living sections. |
| `skills/` | shared | The seven skills (§6). |

### 2.3 The state machine (in Convex — the single source of truth)

```
phase: booting → researching → awaiting_first_approval → engaging
flags: researchDoneAt | firstMessageSentAt | throttledAt
```

- `researchDoneAt` is stamped when the **bounded research pass writes its synthesis row**. Nothing else flips it.
- The engage loop starts because `researchDoneAt` exists — **not** because a message was delivered (the v1 bug: `strategyDelivered` depended on a successful Telegram send that often failed).
- `throttledAt` is set by the cost guard; the loop honors it by pausing new expensive work.

Every action Maya takes (comment / reply / post / creative) is a durable **ledger row**: timestamp, channel, type, content, status, external link, and (later) its metrics. Dedup is a row check. "Did I post today?" is a row check. The agent never trusts its own memory for these facts.

---

## 3. Onboarding — minimal data, never a form wall

**Principle: we do not waterboard the user for data. Maya spawns and figures out the rest herself via research.**

Sub-4-min, conversational. Sequence:

1. **Sign up** (Clerk — Apple / Google / email).
2. **Product in.** Paste a URL (and/or app-store link). Maya reads it live and grounds: what it is, who it's for, **what's actually different**. Asks **1–2** clarifying questions *only if the read is thin* — the differentiator, the ICP, the one KPI (signups). Never a 10-field form.
3. **Pick tier** (or start trial) — this sets `maxChannels`.
4. **Connect channels — tier-gated, and grounded in recommendation.** This is the important one (§3.1).
5. **Pick the mode** — approve-first vs autopilot, a tone slider, the one KPI.
6. **Pay** — *last*, after they've watched Maya demonstrably "get it."
7. **Deploy.** Maya runs the bounded research → sends the **first grounded message** (the bet board + voice + "here's where your buyers are and how I'll show up; first drafts for your approval shortly").

Onboarding pulls are **count-bounded, skip empty platforms, never block on data we don't need.**

### 3.1 Tier-gated channel connection (solve the chicken-and-egg)

Full niche research takes ~15 min, but we want to recommend channels *before* the user connects. So:

**product read → FAST channel recommendation → connect up to tier cap → THEN deep research on connected channels.**

- The fast recommendation comes off the product read alone (product type + obvious niche signals → "your buyers are almost certainly on Reddit + X").
- At connect, Maya shows her ranked **bet board**; the tier's `maxChannels` gates it:
  - Starter (cap 2): "Your two strongest bets are **r/[niche]** and **X**." The rest show as **🔒 upgrade to add**.
  - The cap becomes an **upgrade lever grounded in a real recommendation** ("I see 4 great channels for you; your plan covers 2"), not an arbitrary wall.
- Connection order: Maya recommends → user connects highest-fit first → cap enforced → remainder shown locked.

---

## 4. Research — bounded, once, refreshed monthly

**Principle: enough to sound native on the bet channels. Count-bounded, not time-bounded.**

### 4.1 The research pipeline — five bounded passes (fair by construction)

**This replaces the 18-worker fan-out.** Fairness is *structural*: every channel is judged on the SAME probe, scored TOGETHER in one call — so no channel can be pre-favored. (Live dogfood 2026-06-27: the old fleet researched Reddit with 17 searches but IG/TikTok with 1 each, then scored on that uneven evidence — the exact bias this removes.)

1. **Product pass (zero channel bias).** Read the product → three product-LEVEL artifacts: the **competitor map** (who else does this — product-level, NOT per-channel; researching competitors per-channel is what made them flaky + return 0 rows live), the **buyer hypothesis** (ICP + a canonical intent-phrase set + pain language), and **voice direction**. This produces the ONE intent-phrase set every channel is probed with — the fairness anchor.
2. **Uniform fit-probe across ALL offered channels.** Apply the SAME intent-phrase set to EVERY channel with the SAME bounded budget (~3–5 searches each, not 17-vs-1), extracting the SAME four signals: (a) ICP present/active here? (b) engageable intent/pain language? (c) volume + freshness? (d) can she add value natively? **Scan every channel — never pre-eliminate one** ("obviously irrelevant" IS the bias; a dead channel costs ~4 calls to prove dead). Equal *effort*, not equal call-count — thin results on a platform are themselves a real fit signal, captured honestly.
3. **ONE judge call scores all channels together.** The single most important anti-bias move: feed ALL channels' fit-evidence into one LLM call that ranks them side-by-side on one rubric — never score per-channel in isolation (that anchors each). Output: fit score + one-line reason per channel + a SEPARATE `operationalMode` field (autonomous / tap-only / community-manage), NOT folded into the fit score.
4. **Bet selection — fit-primary, viability-secondary, transparent.** Buyer-fit is primary; operational viability (§7.6) is a secondary tiebreaker among comparable-fit channels. Cap at the tier's `maxChannels`. The full ranked board — including parked channels + WHY — is shown to the user (§4.4). Fit is never hidden behind viability ("your buyers are on TikTok, but I can only engage one-tap there, so it's manual, not a bet").
5. **Deep pass on the BETS only.** Now spend the depth — target threads, voice extraction, first drafts, buyer-map enrichment — exclusively on the 1–3 channels she'll operate. Depth is *earned by winning the scan*.

All five are **bounded + sequential + run-once**, with a hard research ceiling (~$3–4) separate from the daily cap. Each pass writes durable rows; "research done" is row-driven (§2). **Output = SOUL + the ranked bet board.**

### 4.2 The monthly refresh (cron)

A **light, diff-based** refresh — not the full boot pass. Re-checks: are the bet channels still right, what's trending now, new voices/communities, what content shape is working. **Updates SOUL's living sections only**; leaves the stable identity (voice, product truth) alone. A fraction of the boot budget. This is what a good human does — stay current, don't re-learn from scratch.

### 4.3 The read tools

- **ScrapeCreators** (27+ platforms) — workhorse for research (top voices, what lands, audience, how they talk) + the daily "what's fresh" pull on IG/TikTok/YouTube/LinkedIn.
- **X/Twitter API** — search + conversation threads + real-time listening; first-class for X reply engagement (post/reply/quote direct).
- **Reddit** — subreddit discovery + thread reading. A primary engage surface for most B2C/B2B niches, not an afterthought.
- **The product itself** — read the URL/app-store listing at onboarding to ground "what it is / what's different." The anti-hallucination anchor: Maya never invents a differentiator she didn't read.

### 4.4 The plan sign-off — gate the ACTIONS, not the thinking

After research, Maya presents the plan and gets the user's blessing BEFORE operating their accounts — the highest-trust moment in onboarding. **The rule: she researches, plans, and drafts freely; she does NOT post or comment from the user's accounts until they sign off** (consent + ban-safety). She is *never idle waiting* — she preps the first drafts in the background, so "go" is instant. (The old "she went silent waiting" failure came from waiting to *think*; here she only waits to *act*.)

**The plan message — one scannable thing:**
1. **The read** — who's buying + where they're venting, grounded (1–2 lines).
2. **The bet board, fully transparent** — channels she's betting AND the ones she parked, with why (the §4.1 board, surfaced).
3. **The motion** — what she'll do (engage ~N threads/day, post cadence, in your voice, approve-first).
4. **The ask** — *"Does this look right? Want to change the channels / angle / voice? Otherwise I'll prep your first drafts."*

**Steerable, not yes/no:** the user replies in plain language ("drop LinkedIn", "my buyers are on YouTube", "be more technical") → Maya re-scores, re-bets, updates SOUL (`save_steering_directive`). The plan stays visible + editable forever, not just at onboarding. A channel beyond the tier cap = the upgrade-lever moment (§9.1).

**Soft-start, hard-consent:**
- *The plan:* **soft** — shown, invites changes, she starts *preparing* regardless (no idle).
- *The first action from the account:* **hard** — nothing posts/comments until plan sign-off (or that first draft's approval). Then ongoing it's approve-first per tier (tap-to-post); autopilot tiers unlock FROM the sign-off.

---

## 5. The day in Maya's life — the four clocks in detail

### 5.1 Morning plan (cron, once, early, user's TZ)

The manager with coffee deciding what kind of day this is. Maya reads the bet board, topic library, what's trending today, what she posted recently, and what's been converting. She writes a lightweight **day-plan row** to Convex — **a posture and a budget, not a rigid schedule:**

```
day-plan {
  originalPost:    { channel, angle, needsCreative }   // the one deliberate piece (funnel bait)
  funnelBudget:    { tier1: hunt aggressively, tier2: ~M, tier3: ~K }  // allocation, not a quota
  productMentionRatio: ~1 in 10 surfaces the product (maps to Reddit's 9:1 rule — §7.5)
  watchFor:        ["[competitor mentions]", "[niche event today]", "[intent phrases]"]
  posture:         "helpful + a little funny; community's hot about X today"
}
```

This row gives the heartbeat **direction** — it hunts intent first, then spends the rest building credibility — so it isn't aimless scrolling.

### 5.2 The deliberate post (cron, timed)

Drafted from the day-plan — with **Creatify** if it needs an image/video — queued for approval or auto-posted at a good time-of-day for that channel. Low frequency, high care. The "I have something to say" mode.

### 5.3 The engage loop: hunt → strike → build → nurture (heartbeat — the core of the product)

Each tick (~10–20 min, waking hours) — *this is the scrolling*, but funnel-first:

1. **Hunt.** Pull fresh activity on the bet channels (cheap; deterministic code), including the standing **competitor / "alternatives to X" watch** and intent-phrase searches. Freshness-weighted hard.
2. **Sort into the funnel** (Tier 1/2/3 — §1.1). Tier-1 buying-intent threads jump the queue.
3. **Pick the best 1–2**, biased to the freshest high-intent.
4. `write-native` in the SOUL voice — value-first; on Tier-1 the product *is* the genuine answer; **name the product, don't drop a link** (§7.5).
5. `critic` pass: *"is this value-first or shilling? does it obey ban-safety?"* — veto if it fails.
6. **Publish**, log to ledger, **draw down the funnel budget**, sleep.
7. **Nurture** (event-driven, §5.4): a positive/curious reply is a warm lead — follow it toward a signup. The funnel has a bottom, not just a top.

The budget keeps her **human-paced**: interactions spread across the day with natural variance, never in a burst (both spammy and a ban signal). Budget spent → she rests, like a person.

### 5.4 Inbound (events — webhooks)

Someone replies to Maya's comment → webhook → she responds promptly. **This is what makes her feel alive**, not a broadcast bot. A manager who never replies to replies isn't managing community — they're just posting. Inbound gets priority and quick turnaround. Batched so the *user* isn't pinged per-event.

### 5.5 Reflect & learn (dreaming — nightly + weekly)

OpenClaw's dreaming = "analyzes its own work," and it's the gold of this design. It reads the ledger + attribution and **tunes Maya's instinct**:

- Which days / ratios / channels converted best?
- Dial the **product-mention ratio** accordingly (if helpful-presence days convert better than plug-heavy days, lower the ratio).
- Re-weight the **channel bets**.
- Update SOUL's **living sections** ("what's working now").

This is how a real manager develops judgment over months — and OpenClaw gives it to us for free.

---

## 6. The skills (seven, surgical)

A small, sharp set. The agent only ever exercises **judgment**; these are its hands.

| Skill | Job |
|---|---|
| `research-niche` | Given the product, map where the ICP lives + how they talk (read tools). Produces the bet board + SOUL inputs. |
| `find-opportunities` | **Intent-hunter.** Pull fresh threads/comments + competitor-mention watch on the bet channels; classify each into funnel Tier 1/2/3; rank by intent × freshness. |
| `write-native` | Draft a comment / reply / post in the SOUL voice, value-first. |
| `make-creative` | Brief + render an image/short video via **Creatify**, grounded in product truth. |
| `publish` | Route a draft to the right posting mode (§7.6): **one-tap deeplink** (default), **Zernio auto-post** (own-feed content), or **platform-direct reply** (X, top tier). The *only* thing that touches posting — rate-limiting + ban-safety live here. |
| `measure` | Pull Zernio analytics + attribution into the ledger. |
| `critic` | LLM self-review that can **veto** a draft before it ships — slop, off-voice, ungrounded, unsafe, or shilling. |

---

## 7. Message discipline — keeping Maya from over-messaging the user

This is a first-class design goal, not an afterthought. The rules:

1. **The heartbeat NEVER messages the user.** It works silently. If you remember one rule, it's this — it's what keeps Maya from being annoying *and* keeps the loop cheap.
2. **Cron and events do all the talking.** Predictable digests (cron) + can't-wait approvals/decisions (events).
3. **Default steady state: at most ONE proactive message a day** (the cron digest — "here's what I did + what's working," one honest line if the day was quiet), plus a richer **weekly recap**.
4. **Grounded-or-silent.** She messages only with a real result, decision, or question. No "just checking in," no filler. A quiet day → say nothing, or one line.
5. **Approvals are event-driven and batched** — "3 drafts ready for you" once, not three pings.
6. **In approve-first mode, the day-plan itself is visible but not blocking** — the user can nudge it ("more memes, less LinkedIn"); Maya waits for sign-off only on the *deliberate post* and *risky replies*, not on the plan.

Implementation note: message-send is deterministic code with a **daily proactive-message budget** (default 1) the agent draws against; the agent cannot exceed it without an event (approval/inbound) justifying it.

---

## 7.5 Ban-safety — the second pillar (and the deeplink question)

**How big is the banning problem? Existential — it's the #1 thing that kills products in this category.** Verified in the competitor scan (§14): Reddit's 2025 update **wiped ~70% of automated-posting accounts**; an analysis of **340 startup attempts found 89% banned within 30 days**; LinkedIn's April-2025 crackdown **blocked Taplio outright**; ReplyGuy got a "Reddit lawyers" letter and exited inside a year; GummySearch died on Reddit-API economics. Every credible survivor either retreats to "we suggest, you post" or makes ban-safety the headline. **So yes — we design around it as a first-class architectural constraint, co-equal with attribution.** The good news: the ban-safe design is *also* the higher-converting design, because what doesn't read as spam is what people actually upvote and click.

The mechanisms, in order of importance:

1. **Links live in the profile/bio, NOT in comments — this is the deeplink answer.** In-comment URLs are the #1 spam signal (auto-removal, shadowban), especially on Reddit/new accounts. So Maya **names the product in genuinely helpful context** and lets people reach it via her **profile/bio, which holds the deeplink (UTM-tagged)**. The only time a link goes *in* a comment is when someone explicitly asks ("what's it called?" / "link?") — and that's high-intent and the best-attributed click anyway. The profile/bio is therefore both the conversion asset *and* the ban-safe link surface.
2. **Account-warming is Tier-3's real job.** Pure-value engagement (§1.1) builds the account age, karma, and history that let Tier-1 strikes survive. Honor each platform's karma/age gates before striking.
3. **Obey the 9:1 self-promotion ratio.** ~1 in 10 actions surfaces the product (baked into the day-plan). This is literally Reddit's own rule, and dreaming tunes it down if lower converts better.
4. **Human cadence + variance.** Per-platform rate caps, spread across the day, never templated. The `critic` vetoes anything that pattern-matches as a bot.
5. **Official APIs, never cookie/extension automation.** LinkedIn specifically nukes the latter (it's how Taplio got blocked). Zernio/official APIs + the user's *own authentic accounts* — never shared/pre-warmed/fake accounts or bought upvotes (Beno One's astroturfing model is the landmine, not the model).
6. **Per-platform ban-risk profiles live in `.md`, not hardcoded.** Reddit = harshest (value-first, name-don't-link, heavy warming); X = most tolerant (links okay-ish); LinkedIn = automation-hostile (lowest velocity). Maya's platform expertise is encoded in SOUL/AGENTS, per principle.

**The honest tradeoff to surface:** no-links-in-comments *fights* click-attribution. We resolve it with (a) the **profile-link UTM** as the primary attributed path, (b) **ask-triggered in-comment links** (rare, high-intent, fully tracked), and (c) **lift/correlation modeling** — branded-search lift, a "where did you hear about us?" field at signup, and correlating engagement volume on a channel with signup volume. We trade a slice of pixel-perfect click attribution for *not getting banned*; we make it back with profile-link UTMs + self-report + lift. Pretending we get both perfectly is how you end up banned.

### 7.6 Posting/engagement architecture — three MOTIONS, not three modes (DECIDED, from 2026-06-25 capability audit)

**The load-bearing finding:** cold-commenting on *strangers'* threads — the actual signup-driving motion — **cannot be safely automated on any platform except X.** This is a *platform-API* limit, not a Zernio gap: Meta/LinkedIn/TikTok/etc. expose **no** API to comment on arbitrary third-party posts (IG docs literally: *"cannot post new top-level comment, reply-only"*). The only tools that cold-comment off-X use unofficial browser/cookie automation — i.e. the exact thing that gets accounts banned. Verified against Zernio/Late docs **and** our own code (`reply_to_comment` is scoped to the founder's OWN posts via `list_inbox`; zero cold-engagement exists today). So "engagement" splits into **three motions** with very different automatability:

| Motion | What it is | Automatable? | Mechanism |
|---|---|---|---|
| **Post** | Original content to the user's own feed | ✅ all channels | Zernio auto-post (or one-tap by choice) |
| **Community-manage** | Reply to comments **on the user's own posts** | ✅ 8 channels (X, Reddit, IG, LI, YT, Threads, FB, Bluesky) | Zernio inbox — **already built** (`reply_to_comment` + `list_inbox`) |
| **Cold intent-strike** | Comment/reply on **strangers' threads** (the funnel engine) | ✅ **5 channels via official API** · ❌ 5 channels = one-tap (see split below) | Direct platform APIs where allowed; pre-filled deeplink / clipboard-jump elsewhere |

**The cold-comment split (audited 2026-06-25 against platform dev docs — this is a platform ceiling, no tool fixes it):**

| Channel | Official cold-comment API? | Catch |
|---|---|---|
| **Bluesky** | ✅ Open, free, no approval | The one frictionless surface (AT Proto `createRecord` reply; ~11.6k/day). |
| **YouTube** | ✅ Free | `commentThreads.insert` on any video; 10k-unit/day quota (~200/day); spam-filter can silently suppress. |
| **X** | ✅ Metered | reply to any tweet; **pay-per-use ~$0.015, ~$0.20 if it has a link**. |
| **Reddit** | ✅ but hostile | `POST /api/comment` works, but commercial API use is paid + ToS-hostile to promo + **highest ban/shadowban risk**. Use sparingly, value-first. |
| **Threads** | 🟡 Gated | Cold reply only after Meta App Review (`threads_keyword_search`). |
| **Instagram / Facebook / LinkedIn / TikTok / Pinterest** | ❌ None | API is own-content-only (IG/FB/LI) or has no comment-create endpoint at all (TikTok/Pinterest). **One-tap is the only ban-safe path.** |

**No aggregator escapes this.** Ayrshare is the closest (official cold-comment via `searchPlatformId`) but inherits each platform's ceiling — so it's only reliable where the official API already allows it (≈X). Unipile/Phantombuster/Taplio reach LinkedIn/IG by **unofficial `li_at` cookie automation = high ban risk** (LinkedIn sends C&Ds; ~3–5% account-restriction rates). We do NOT go there — it breaks our ban-safety moat. So: **direct official APIs for the 5 green channels; one-tap for the walled gardens.**

**Implications (the strategic steer):**
1. **Autonomy follows the green channels.** On **Bluesky / YouTube / X / Reddit / Threads** Maya runs the *full* funnel (hunt → cold-comment) hands-free via official APIs. These deserve weight in the bet board precisely because they're where "Maya gets you customers while you sleep" is literally true.
2. **On the walled gardens (IG / FB / LinkedIn / TikTok / Pinterest) Maya's autonomous value = Post + Community-manage (both zero-tap); cold-strikes are a curated one-tap layer.** Still strong — she runs most of the surface autonomously and hands the user a small high-value batch.
3. **One-tap is a feature, not a chore.** The *user* posting is what keeps the account un-banned ("Maya does the work; you tap to keep your account safe"). Volume is low by design (ban-safety: ~5–15 strikes/day) and **batched into one swipe-through**, never per-comment pings.
4. **The walled-garden cold-strike is a clunky manual dance — deep-linking can't save it (§7.7).**

**One-tap mechanics** (the off-X cold-strike + any approve-first post): Maya drafts → pushes to the user's messenger as a **pre-filled deeplink** where the platform allows it (X `intent/tweet?text=...&in_reply_to=<id>`; Reddit posts `reddit.com/submit?...`), else **auto-copy to clipboard + deep-link to the exact thread** (Reddit comments / IG / LI / TikTok — no pre-fill API). *"Save as draft in the account" is NOT API-supported on X/Reddit/LinkedIn — the deeplink/clipboard path is the universal version.*

**Zernio's settled role:** Post (all channels) + Community-manage (8-channel inbox) + **analytics for everything**. It is **not** the cold-strike engine — that's X-direct (auto) or one-tap (everywhere else).

### 7.7 Deep-link reliability — the verdict (audited 2026-06-25; the "tap-and-post" dream is dead on the walled gardens)

Can we text the user a link that opens the comment box **on the specific post, pre-filled, in one tap**? **Verified NO on Instagram, Facebook, LinkedIn, TikTok** (platform docs):
- **No comment-composer deep link with text-prefill exists** on any of the four; **Facebook explicitly *forbids* composer prefill by policy** (Meta partner docs).
- **Realistic best case = a 4–5 tap clipboard-paste dance:** tap link → *(if the native-app handoff works)* → tap comment field → long-press → Paste → Post. TikTok/Reddit cost 5 (comments behind an icon).
- **The handoff is itself unreliable** — universal links are routinely suppressed inside the messenger in-app webview that opens our texted link, dumping the user on **logged-out mobile web behind a login wall** (worst on Android/LinkedIn, TikTok).
- *Small mercy:* clipboard paste adds **no** permission tap on iOS 16+. The friction is the brittle handoff + multi-gesture paste.
- **Custom keyboard** (insert draft into any comment box) is the only near-one-tap alternative — but needs install + "Full Access" + keyboard-switch + App Store policy risk. Heavy friction; not a clean win.

**The decisive conclusion:** the Eisenberg agent — *research → comment usefully to build trust → then post* — **runs fully autonomously only on the 5 official-API channels (Bluesky, YouTube, X, Reddit, Threads).** On IG/FB/LinkedIn/TikTok cold-commenting is neither API-able nor cleanly one-tap-able. So **v1 builds the autonomous engagement engine on the 5 green channels and targets ICPs whose buyers live there.** Not a consolation prize — Reddit + X + YouTube are the highest-intent organic-discovery surfaces on the internet for the SaaS/dev/AI/indie ICP. Don't force autonomous commenting onto channels that physically can't support it; lead with the ones that can. IG/FB/LinkedIn/TikTok stay as Post + Community-manage (autonomous) + optional clunky one-tap strike.

### 7.8 The exhaustive third-party / build-it-ourselves verdict (researched 2026-06-26 — this is bedrock)

We evaluated every path to cold-comment the walled gardens: server-side automation APIs, client-side extensions, and architectures we could build ourselves. The search is now exhausted. Findings:

- **Server-side automation (Unipile, Phantombuster, TexAu, Captain Data, Apify…):** only **Unipile** cleanly works, **LinkedIn-only**, via `li_at` cookie = ToS violation that risks **the user's** account. HeyReach — the gold-standard "safe" cloud architecture — had its company page **deleted by LinkedIn in March 2026**; LinkedIn bans ~23.5M bot sessions/quarter. IG/FB/TikTok have nothing even at this grey tier. **Verdict: not buildable as core — it's account-burning and knifes our ban-safety moat. Document as an opt-in power-path at most.**
- **Client-side AI-reply extensions (Yapzy, Engage AI, MagicReply…):** the pattern works and is the **lowest-ban-risk write path** (real logged-in session + human clicks post). Yapzy ($19 one-time, 8 platforms, no backend) proves it's cheap to build. **But desktop-Chromium only; nothing white-labelable → we'd build our own.**
- **What WE could build (ranked):** **#1 a HeyMaya MV3 browser extension — desktop Chrome/Edge/Firefox + iOS Safari Web Extension** (fill-only, per-site adapters, user clicks post). The *only* clean ~1-click win, and the iOS-Safari packaging even reaches iPhone users browsing social in Safari. #2 iOS custom keyboard (killer gap: it can't know *which post* you're on → needs screenshot-OCR). #3 webview wrapper — **AVOID** (session isolation + ToS + App-Store rejection). #4 Android accessibility — **unshippable** (Play bans autonomous actions, enforced Jan 2026). #5 share-extension/Shortcuts — **physically impossible** (no injection direction in the iOS sandbox).
- **The blunt headline: a genuinely good one-tap experience inside the *native* IG/TikTok apps is NOT buildable by anyone, including us.** Native mobile cold-comment is stuck at the clipboard dance. No fourth option exists.

**Final channel posture (locked):**

| Channel | Cold-strike posture | Mechanism |
|---|---|---|
| **Bluesky, YouTube, X, Reddit, Threads** | ✅ **Fully autonomous** | Official APIs |
| **LinkedIn** | 🟡 **Near-one-click** | HeyMaya **browser extension** (desktop + iOS Safari), fill-only — the realistic LinkedIn answer, ban-safe |
| **Instagram, TikTok, Facebook** | ⚠️ **Post + Community-manage autonomous; cold-strike = clipboard dance or skip** | Zernio for post/own-comments; native cold-comment has no ban-safe automation |

So the product has **three gears**: *autonomous* (5 API channels), *frictionless-assist* (LinkedIn via extension — answers "users won't approve everything" by batching strikes into a 30-second click-through), and *clipboard-fallback* (native IG/TikTok — the one genuinely weak spot, no fix exists). **Build:** the 5-channel autonomous engine first; the browser extension as the LinkedIn unlock; accept native IG/TikTok cold-comment as out of scope and choose ICP/positioning accordingly.

---

## 8. Cost discipline

- **Two separate budgets:** a one-time **research ceiling** (~$3–4) and a **daily steady-state cap**. Never conflate them.
- **Throttle, never destroy.** Over the daily cap → stamp `throttledAt`, alert the operator, and the loop pauses new expensive work (deep research / creative renders) while still monitoring + answering. The machine **runs indefinitely**. Teardown is only for explicit cancellation.
- The idempotent, fan-out-free loop means the *baseline* heartbeat is cheap by construction — the cap is a backstop, not the primary guard.

---

## 9. Tiers — priced on the real cost drivers

Cost drivers, in order: **Zernio per-channel → Creatify creative renders → the AI brain.** Tier on **channels + creative volume + autonomy**, never credits theater. (Exact numbers pending the COGS model — `docs/COGS_PRICING_REFERENCE.md` / `docs/TIER_PULSE_COST_MODEL_V1.md`.)

| Tier | Channels | Creative | Autonomy | Feel |
|---|---|---|---|---|
| **Starter** | 1–2 | text-only engagement | approve-first | "Maya works your best channel; you approve." |
| **Growth** | 3 | Creatify **images**, N/mo | autopilot optional | "Maya runs your top 3 and posts for you." |
| **Studio** | 5–6 | Creatify **video/UGC**, M/mo | full autopilot | "Maya owns your organic, end to end, with proof." |

The axis the customer *feels* (approve→autopilot, text→video, 1→6 channels) lines up exactly with COGS. Clean story. *Creatify is currently unconfigured on prod — video tiers gate until those keys land.*

### 9.1 Per-tier enforcement — ONE Maya, plan-gated (how "a different Maya per tier" actually works)

**There is one Maya, not a different agent per tier. Tier is *data*, not a separate build.** The same OpenClaw deploy + shared `.md` layer runs every customer; only a per-agent capability record differs. This reuses the codebase's existing pattern (`planFeaturesGtm`) and CLAUDE.md **principle 10** (plan-tier gating server-side, fail-closed). It is **not** the same as global feature flags like `NEXT_PUBLIC_ENABLE_CREATOR_PRODUCT` — those toggle whole products; this gates *capabilities per agent*.

**Source of truth: a single `planFeatures(agent)` helper.** It returns the capability matrix for the agent's tier, and **every gated entry point** — Convex action, plugin tool, UI surface — consults it. Fail-closed: unknown/expired/downgraded → most-restrictive.

| Capability (`planFeatures` returns) | Starter | Growth | Studio |
|---|---|---|---|
| `maxChannels` | 2 | 3–4 | 5–6 |
| `autonomyMode` (posting + reactive engagement) | approve-first | autopilot optional | full autopilot |
| `creative` | text only | + images | + video/UGC |
| `coldStrikesPerDay` (curated, surfaced to user) | ~3 | ~6 | ~10+ |
| `reactiveEngagement` (reply to commenters/mentions) | on | on | on, priority |
| `thinkingBudget` / model routing | low | all | all + priority |
| `proactiveMsgBudget` / day | 1 | 1–2 | 2 |

*(Exact values pending the COGS model — see §9 + `COGS_PRICING_REFERENCE.md`.)*

**Two-layer enforcement — you need BOTH:**
1. **Maya KNOWS her tier (behavior layer).** At deploy and on every tier change, the harness bakes a *"Your plan & capabilities"* block into her runtime context, generated from `planFeatures`. So she plans *within* her limits, never promises what she can't do, and surfaces honest upgrade nudges ("I found a 4th strong channel — adding it is a Growth feature"). Knowledge shapes good behavior.
2. **The server-side HARD gate (security layer).** Every gated tool/action independently calls `planFeatures(agent)` and refuses out-of-tier calls, fail-closed, *even if the LLM ignores its context*. The model can drift; the gate cannot. Knowledge alone isn't safe; the gate alone is bad UX (Maya tries and gets rejected). Both, always.

**Tier changes = a data flip, not a redeploy.** Upgrade/downgrade updates the agent's tier field → `planFeatures` returns the new matrix → the context block refreshes → capabilities change live. No "different Maya" is spun up. **Downgrade is graceful:** channels beyond the new cap go *dormant* (not deleted) and re-activate on re-upgrade.

**Channel connection per tier (the onboarding flow, ties to §3.1):**
- Maya's research produces a **ranked bet board** — channels ranked by ICP-fit × intent-density × *where the engagement motion actually works* (autonomous-capable channels weighted up, per §7.6–7.9).
- The user connects the **top N up to `maxChannels`**; the cap is enforced server-side at connect time.
- Recommended channels beyond the cap show as **🔒 upgrade to add** — the cap is an upgrade lever grounded in Maya's real recommendation, not an arbitrary wall.
- The user can override Maya's ranking, but her recommendation is the default.

**Channel-cap ENFORCEMENT — connect-time, not just active (resolves a real gap + spec/code mismatch, found 2026-06-26):**
The code (`planGtm.ts`) has three caps: `maxActiveChannels` (3/6/6 — how many Maya *works*; **enforced server-side** by `selectActiveChannels`, COGS-safe ✅), `connectedChannelCap` (**currently 6 for all tiers**), `autoPostChannelCap` (3/6/6). **The gap:** the connect mutation (`zernioConnect.ts`) enforces *no* cap — so a Starter user can link more than their tier, and the "🔒 upgrade to add" framing above isn't actually enforced (Settings just lists all channels as connectable). This contradicts §3.1.
**Decision (locked): cap CONNECTION at the tier.** Set `connectedChannelCap = maxActiveChannels` per tier; enforce **fail-closed at the connect mutation** (server-side, not just UI). In Settings, channels over the cap / not recommended render as **🔒 upgrade to add** — not connectable. Result: connected == active == tier cap; no confusing "linked but not worked" state. **Downgrade:** over-cap channels go *dormant* (not deleted), reactivate on re-upgrade. *Sprint S5 task: add the cap guard to the connect mutation + Settings-UI lock; align `connectedChannelCap` to `maxActiveChannels` in `planGtm.ts`.*

### 9.2 Content & creative ladder — how Maya's BEHAVIOR forks per tier

Same principle as §9.1, but applied to *behavior*, not just access: **Maya reads her `planFeatures.creative` value and forks how she acts — she is not a different agent, she just works within what she's allowed.** Video is the clearest case.

| Tier | `creative` mode | Posts / images | Video |
|---|---|---|---|
| **Starter** | `script_only` | text posts | Maya writes a **script + shot guide → the user films it** |
| **Growth** | `images` | text + Maya-generated images/graphics | same — user films from Maya's script |
| **Studio** | `video` | text + images | Maya **generates the video via Creatify** — no filming |

**The video fork, concretely:**
- **Starter / Growth:** when the day-plan wants a video, Maya writes a tight hook + 25-sec script + shot list and sends it via Telegram — *"film this facing your camera; post it, or send it back and I'll post it."* The user films on their phone → optionally returns the clip → Maya posts it (Zernio) or hands it back.
- **Studio:** Maya briefs Creatify, renders, posts. Zero filming.

**Execution (reuses §9.1's two layers):**
1. `planFeatures(agent).creative` returns the mode.
2. Maya's **capability block** tells her: *"You can write scripts + make images. You cannot generate video — for video, script it and ask the user to film."* → she behaves accordingly.
3. The **`make-creative` tool is gated**: a video call on a lower tier fails-closed and routes Maya to script-mode — she can't accidentally burn Creatify credits out of tier.
4. **Upgrade = live flip:** Starter→Studio updates `planFeatures` → capability block refreshes → the video tool unlocks → Maya switches from "film this" to "I made it." Same Maya, no redeploy.
5. **Film-return loop:** user clips arrive via Telegram → R2 attachment bridge (HEIC/video handling) → Maya reviews/captions/posts (same media pipeline as the service product's §10.5).

**Honest positioning (ties to `CREATIFY_CREATIVE_SCOPE_V1.md` + anti-slop §11):** founder-*filmed* video (the lower tiers) is actually the **higher-converting, anti-slop** content — algorithms reward authentic faces over AI renders. So Studio's AI-video sells **convenience / hands-off, NOT superior quality.** Let Studio users *choose* per post: film it for max authenticity, or let Maya generate when they're slammed. Don't sell AI video as "better" — sell it as "you don't have to film."

**The "will they actually film it?" risk:** same discipline as the tap-to-paste strikes — video is *optional upside, never a blocker.* No clip that day → Maya just runs text/image posts. Keep scripts dead-simple, batch the ask, show the payoff (this Reel → X views → Y signups).

---

## 10. Internal UI — what a solo founder / small team wants to see

Founder psychology: busy, skeptical, and the question every time they open the app is *"is this actually doing anything?"* The UI answers that first. Phone-first. Builds on `docs/DASHBOARD_PRODUCT_SURFACE_V1.md`.

Priority order = screen order:

1. **The headline — "Is it working?"** One number: signups/clicks Maya drove this week + trend vs last week. The home screen.
2. **The live feed ("Conversations").** The reactive stream of everything Maya did — each comment/reply/post, with a **link to the real thing** + its engagement. The trust engine; founders scroll it like a feed and *see* her being native. This converts skeptics.
3. **Approvals.** Anything waiting (approve-first mode). One-tap approve / edit / reject. Batched.
4. **Channels (the bet board).** Which channels, each one's performance, fit/confidence.
5. **The plan / "what Maya thinks."** Read-only SOUL view — voice, ICP map, today's day-plan — with the ability to **steer**. Builds trust she gets the product; gives the founder a wheel.
6. **Settings.** Connections (Zernio / X / Creatify), tier, autopilot-vs-approve, cadence, tone.

Default landing = #1 + #2 on one screen. Everything else a tab away. **Show proof first, controls second, internals last.**

### 10.1 "Show it's working" — the attribution chain

Zernio per-post/per-channel metrics → pulled on cron into the ledger, joined to the action that produced them → **profile-link + ask-triggered links UTM-tagged** (§7.5) → tie clicks to signups via the product's analytics (PostHog / Plausible / Stripe webhook), backstopped by **lift/correlation modeling + a "where'd you hear about us?" signup field** for the comment-name-drops that can't carry a link. The chain the UI surfaces: **actions → engagement → clicks → signups, per channel, over time.** This is what turns Maya from a faith purchase into a dashboard — and it's the one thing **no competitor in the market does** (§14).

**Emerging angle — GEO attribution.** Buyers increasingly ask ChatGPT/Claude/Gemini "what tool should I use," and those answers heavily cite Reddit/forum threads. Engaging well in those threads → getting the product *cited by LLMs* is a fresh, near-uncontested attribution surface (only RedReplier/BabyLoveGrowth touch it). Worth tracking brand-citation-in-LLM-answers as a v1.x metric.

---

## 11. The two things to be world-class at (the moat)

Everything else is commodity-grade. Be obsessive about exactly two:

1. **Native voice** — the SOUL + the `critic` that vetoes anything that smells like a bot. If the engagement reads as AI slop, nothing else matters.
2. **Attribution** — the actions→signups chain. Without proof, churn is guaranteed.

---

## 12. The honest constraint (read before promising autopilot)

Posting AI comments into communities to surface a product *is* astroturfing, and platforms (Reddit especially) + communities are getting sharper at detecting and punishing it. So:

- **Lead with the chief-of-staff framing**, not "an army of fake-helpful accounts." Maya makes one founder's *real* presence 10x more effective: research + finds the right rooms + drafts the native reply + schedules + proves attribution.
- **Approve-first is the default; autopilot is earned** (per tier, over time, as trust + safety data accrue).
- **Lower-volume, higher-quality** beats high-volume spam — it's also the ban-safe path.

This isn't a limitation to engineer past; it's the actual shape of the market and the durable product.

---

## 13. Migration sprints — reshaping the CURRENT build (not greenfield)

**This is a migration, not a rebuild.** Survey of the live system (2026-06-25) found much already in place — the work is mostly *simplification + targeted fixes*. **Iron rule: every sprint ends with a deployable, working 24/7 agent.** We never leave the manager broken between sprints.

### What already exists (reuse, don't rebuild)
- **Durable lifecycle** — `convex/gtmMaya/agentLifecycle.ts` already has row-driven flags + an 8-acquire lease cap. `researchComplete` (line ~174) is *already* row-driven (buyerMap + ≥1 competitor + ≥1 channel scorecard) and the fleet "never re-spawns" once true.
- **Zernio post + reply** — `infra/openclaw-runtime/plugins/maya-gtm-tools/` has `post_to_channel`, `reply_to_comment`, `list_inbox`, `check_already_engaged`, analytics reads. Posting/replying is built.
- **Soft throttle** — `costCap.ts` + `discoveryBudgetGate.ts` already degrade to `monitoring_only` per-tier. Only `spendKill.ts` still *destroys* (the bug).
- **Schema** — `gtmAgents` (+ `autonomousPosting`, lifecycle, Zernio, media fields), research tables (`gtmBuyerMap`/`gtmCompetitiveMap`/`gtmChannelScorecard`), `gtmDraftedContent`, `gtmPostResult`, `gtmCostLedger`. Additive only — no new tables (TS ceiling).
- **The overbuild to cut:** **56 `agents/skills/maya-*`**, **110 plugin tools**, **18 subagents** (`deployMayaGtm.ts` ~497–781).

### Sprint 0 — Stop the bleeding (loop + cost). *No feature change; same agent, not on fire.*
- `spendKill.ts:227–269` — change `enforceSpendKillForAgent` from `FlyClient.destroyApp()` → stamp a new `throttledAt` on `gtmAgents` + alert operator; the loop honors it via the existing `discoveryBudgetGate` `monitoring_only` path. Reserve `destroyApp` for `accountLifecycle` cancellation only. Then **remove `GTM_COST_CAP_OVERRIDE`** dependence.
- `agentLifecycle.ts:468–504` — **decouple `foundationComplete` from `strategyDeliveredAt`.** The engage phase must start on `researchComplete` (row-driven, already exists), NOT on a successful Telegram send. Keep the atomic synthesis-idempotency (`claimFounderSynthesisClaim`) so we still send strategy *once* — but a failed send no longer blocks "active."
- `deployMayaGtm.ts:878–894` — confirm the 30m heartbeat cannot re-enter `foundationStep:"research"` once `researchComplete`; the lease count persists on `gtmAgents` (survives restarts — good).
- **Exit:** live deploy, watch 24h, prove the ~$30/hr burn is gone and the machine is never destroyed. Then proceed.

### Sprint 1 — Shrink the brain. *56 skills → 7 · 110 tools → ~the set the 7 need · 18 subagents → 1 bounded sequential pass.*
- `agents/skills/` — archive/delete ~49; keep+rewrite **7**: `research-niche`, `find-opportunities`, `write-native`, `make-creative`, `publish`, `measure`, `critic`.
- `deployMayaGtm.ts:497–781` — replace the 18-subagent fan-out with a **bounded, mostly-sequential** research pass (no parent-collects-children barrier). This is the root loop fix made permanent.
- `infra/openclaw-runtime/plugins/maya-gtm-tools/openclaw.plugin.json` — trim 110 → the tools the 7 skills call.
- `convex/agents/packs/maya_gtm/generators` (`buildMayaGtmWorkspace`) — rewrite the `.md` layout to §2.2 (shared IDENTITY/AGENTS/BOOT/HEARTBEAT/cron/DREAMS + per-customer SOUL).
- **Exit:** deploys, produces the same research output (bet board), smaller + cheaper. Working agent.

### Sprint 2 — Reshape to funnel-operator. *Research → bet board → intent-hunter.*
- SOUL generation outputs voice + ICP map + bet board + topic library (from `gtmBuyerMap`/`gtmChannelScorecard`).
- `find-opportunities` becomes the **intent-hunter**: Tier 1/2/3 classification + competitor-mention watch + freshness ranking (§1.1).
- Add the **day-plan** (field on `gtmAgents` or a JSON row) + morning-plan cron + funnel budget.
- **Exit:** agent hunts intent first, engages on the bet channels. Working.

### Sprint 3 — Posting reshape (§7.6). *One-tap deeplink default · Zernio posts-only · platform-direct replies.*
- New `publish` routing: build the **one-tap assisted** path (pre-filled X/Reddit deeplink + clipboard fallback) pushed to the user's messenger via the existing Telegram channel.
- `post_to_channel` → scope to **original posts** (Zernio). `reply_to_comment` → platform-direct, gated to the top autonomy tier.
- `measure` + Zernio analytics → the attribution chain (profile-link UTM + lift modeling + "where'd you hear" field). §10.1.
- **Exit:** approve-first works as one-tap; analytics flow. Working.

### Sprint 4 — Dreaming + message discipline.
- `DREAMS.md` reflection: read ledger + attribution, tune product-mention ratio + channel bets, update SOUL living sections.
- Daily **proactive-message budget** (default 1) in deterministic send code (§7).
- **Exit:** Maya self-tunes; stops over-messaging. Working.

### Sprint 5 — UI + onboarding + tiers.
- UI: headline funnel number + live "Conversations" feed first (§10), then approvals/channels/plan/settings. Builds on `docs/DASHBOARD_PRODUCT_SURFACE_V1.md`.
- Onboarding: product read → fast channel rec → **tier-gated connect** → deep research → first message (§3).
- New tiers (§9) + monthly research-refresh cron + remove the last cost-override crutches.
- **Exit:** the full v2 product.

**Testing** carries the five mandatory categories every sprint (cross-tenant isolation, plan-tier × action fail-closed, adversarial, sibling-file `.md` coherence scan, TODO grep) — see CLAUDE.md.

### 13.5 Code-survey findings (2026-06-26) — what's already built, what's surgical

**Far more exists than "rebuild" implies. This is surgical reshaping.** The 3-agent code survey found already built:
- **Attribution chain — 100% DONE.** `gtmLinkWraps` / `gtmLinkClicks` / `gtmConversions` + `attribution.ts` (wrap_link, per-post rollup, **event-driven conversion ping to Telegram**, experiment attribution). The "show it's working" layer needs **no sprint.**
- **Telegram delivery — done.** Per-tenant bot + chat pairing + `integrations/telegram/sendDirectMessage.ts` + conversion ping + synthesis safety-net.
- **Zernio — done.** post / reply (own-posts inbox) / analytics / health / webhook all wired (`gtmMaya/zernioReads.ts`, `integrations/zernio/endpoints.ts`). Reply confirmed own-posts-only.
- **`planFeaturesGtm` — done** (`gtmMaya/planGtm.ts`): 3-tier (starter/growth/studio) with `maxActiveChannels`, `canVideo/canImage/canUgc`, credits, fail-closed default. Close to the §9.1 matrix.
- **`.md` layer — mostly generated** (`agents/packs/maya_gtm/generators.ts`): IDENTITY/SOUL/AGENTS/BOOT/USER/PLAN/MEMORY/TOOLS built; **HEARTBEAT (lines 1380–1429) + DREAMS (1482–1676) are stubs** to fill.
- **Crons — mostly present** (`deployMayaGtm.ts` recurringCrons ~1898–1966): morning_brief, midday_pulse, evening_recap, weekly_review, monthly_reset, dreaming, discovery_pulse.
- **Intent-strike 70%** (`gtmMaya/intentStrike.ts`); engage-ledger 80% (`gtmPostResults` + `gtmMaya/engagementLedger.ts`).

**Schema at the 138-table TS ceiling → all additions are JSON-on-row** (precedent: `intentWatchJson`, `channelWarmthJson`). New: `dayPlanJson` + `coldStrikeQueueJson` on `gtmAgents`; `tier` + `tierJudgment` fields on `gtmTargetThreads`.

**Skill-scope clarification:** the 56 skills span THREE products (creator / service / GTM-organic-social). **V2 = the GTM organic-social agent only.** So we don't "delete 49 skills" — we **scope to the GTM subset, organize under the 7 buckets, KEEP the good components** (slop-critic, safety-critic, voice-applier, citation-firewall, hook-extractor, the research workers — the latter as *sequential functions*, not the 18-subagent fleet), **archive creator-only** (brand-deal-triager, rate-calculator, collab-matchmaker, contract-redflag) and **service-only** skills (their own tracks), and **delete deprecated** (approval-publisher, calendar-plan-builder, skill-installer). Tools: keep ~110; add `get_strike_queue` + `generate_share_deeplink`.

**Refined file-level sprint targets:**
- **S0 (loop+cost):** `deployMayaGtm.ts:497–781` delete the 18-subagent fan-out → 1 bounded pass · `agentLifecycle.ts:158–175,212–213` persist `researchCompletedAt` + decouple engage-start from `strategyDelivered` · `spendKill.ts:244` `fly.destroyApp`→`throttleAgentForSpend`.
- **S1 (.md + skills):** `generators.ts` fill HEARTBEAT/DREAMS + align SOUL to §15.1 + `renderJobs()`→§15.2 cron set · scope/organize skills to the 7 buckets.
- **S2 (funnel):** schema `dayPlanJson`/`coldStrikeQueueJson` + `gtmTargetThreads.tier` · new `gtmMaya/dayPlanner.ts` + morning-plan cron · find-opportunities Tier 1/2/3 (reuse `priorityScore` + `intentStrike.ts`).
- **S3 (strike digest):** new `gtmMaya/coldStrike.ts` + `dailyColdStrikeDigest` cron → drains `coldStrikeQueueJson` into ONE Telegram message (bare deeplink + tap-to-copy + fallback hint) · add `get_strike_queue`/`generate_share_deeplink` tools.
- **S4 (dreaming+discipline):** DREAMS reflection live off the (already-built) attribution · daily proactive-message budget in the send path.
- **S5 (tiers+creative+UI):** `planGtm.ts`→§9.1/9.2 (`creative` mode + `coldStrikesPerDay`) · tier-gate `make-creative` + the film-return loop · UI headline + live feed (attribution already queryable) · onboarding flow.
- **Attribution (need #5): DONE — no sprint.**

---

## 14. Competitive landscape & our wedge (scan: 2026-06-25)

Fan-out across four categories: intent lead-gen, AI social managers, AI creative renderers, funded growth agents. Three truths showed up in **every** category:

1. **Nobody proves signups.** Not one player (intent tools, social managers, renderers, funded SDRs) closes the loop to signup/revenue. Syften "won't show which alerts led to customers"; Predis "cannot track whether clicks turned into purchases"; 11x got caught *inflating* outcomes. **Closed-loop attribution is the single biggest open lane — and it's our thesis. Lead with "and we prove it."**
2. **"Sounds like a bot" is the universal #1 churn driver** (Tweet Hunter, Taplio, Predis, Arcads, ReplyGuy). Native voice decides retention → makes SOUL + `critic` worth obsessing over.
3. **The ban arc is existential and accelerating** (Reddit ~70% wipe; 89% of 340 attempts banned <30d; LinkedIn blocked Taplio; ReplyGuy lawyer-letter exit; GummySearch died Reddit-API-economics). → §7.5 is non-negotiable; multi-platform is defensive.

### Direct rivals (know them)

| Rival | Shape | Price | How we beat it |
|---|---|---|---|
| **Casixty (YC W25)** | Reddit marketing agent, technical ICP | **$99/mo** (5 subs, 500 opps) | **Closest rival — same price + ICP.** Multi-platform + signups-as-named-outcome + attribution + voice. Reddit-only, "Reddit marketing" framing, no attribution. |
| **Opencord AI** | Auto find/reply/post X+Reddit | ~$96/mo | Reliability ("bots stopped working") + attribution + voice. |
| **Beno One / ReplyAgent** | Full autopilot via shared/pre-warmed accounts + bought upvotes | $49–500 | **The astroturfing landmine** — we use the user's own authentic accounts, ban-safe by architecture. |
| **Redreach / Subreddit Signals** | The *smart* ones — market ban-safety, deliberately manual | $20–199 | Autonomy + multi-platform + attribution; they stay Reddit-only, manual, no real attribution. |

### Copy (proven to work)
- **Intent scoring over keyword matching** (every winner; F5Bot's ~94% noise is the loser) → our funnel (§1.1).
- **Per-community voice/culture training** (Subreddit Signals) → our per-SOUL philosophy.
- **Ban-safety as a headline pitch** (Redreach/Tydal) — and we can actually mean it architecturally.
- **A niche "what's working" swipe library** (Taplio — "justifies the sub") → surface from research.
- **URL-to-creative grounding** (Creatify/Captions/Pippit) → feed Creatify real scraped product context.
- **Speed on intent** — first good answer wins → freshness ranked hard in `find-opportunities`.

### Avoid (validated failure modes)
- Shared/fake accounts + bought upvotes (Beno) · anti-human / "zero input" rhetoric (Artisan backlash + #1 churn = expectation mismatch) · inflated/unverified outcomes (11x lawsuit threats, 70–80% churn) · credit-burn on re-renders (cap + cache) · single-vendor/platform fragility (GummySearch death; Captions avatar rug-pull → keep render interface-isolated, Captions API as Creatify fallback) · silent reliability failures (Buffer/Hootsuite Trustpilot ~1.5–2.1: "posts just don't post").

### The wedge, in one line
No single axis is unique, but the **bundle is unoccupied**: autonomous × organic × multi-platform × ban-safe-by-architecture × **closed-loop attribution** × funnel-operator, at $99. The market's universal blind spot — *proving signups* — is exactly our thesis. **Creatify validated** as the most product-grounded renderer with API on the $99 tier; verify its credit economics vs COGS and keep the interface swappable.

---

## 15. The concrete build spec — `.md` layer, crons & heartbeat (the build bible)

Expands §2.2 from a file list into actual content design. This is what the deploy harness generates/bakes per agent.

### 15.1 The `.md` files — concrete content

**`IDENTITY.md`** (shared, ~150 words): *"I am Maya, an AI growth operator for one product. My job: research the niche, post content, engage the right conversations, and prove in data what's driving signups. I am a real participant in communities — never a billboard. My laws: grounded-or-silent · value-first, never shill · anti-slop (I sound human, never like AI) · ban-safe (I never risk the user's accounts) · I push results, I don't spam the user."*

**`SOUL.md`** (PER-CUSTOMER — the only varying file, generated from research):
- **Product truth** — what it is, who it's for, the real differentiator (grounded from the product read; never invented).
- **ICP map** — who they are, where they hang out, their pains, *how they talk*.
- **Bet board** — ranked channels, each with fit/confidence + the motion available (autonomous-API / reactive / tap-strike) + per-channel register notes.
- **Voice spec** — anti-slop register grounded in real niche samples; do/don'ts; per-platform tone (§11).
- **Topic & angle library** *(living — dreaming + monthly refresh update it)*.
- **What's working now** *(living)*.
- **Goal & KPI** — signups; the user's stated goal + tone.
- **Plan & capabilities** — tier, channels, creative mode, autonomy, strike budget (from `planFeatures`, §9.1).

**`AGENTS.md`** (shared) — operating doctrine: grounded-or-silent · the funnel (Tier 1/2/3) · value-first + 9:1 ratio · ban-safety (links in bio not comments, name-don't-link, human cadence, per-platform risk profiles, user's own accounts only) · the three motions and which are autonomous vs tap (§7.6–7.9) · message discipline (heartbeat silent, cron+events talk, ≤1 proactive/day) · the 5-layer anti-slop voice system · how to use each of the 7 skills · approval rules per autonomy mode · when to escalate.

**`BOOT.md`** (shared, idempotent): check state → if booted, skip → else run bounded research (sequential, NO fan-out) → write SOUL → stamp `researchDoneAt` → send the first grounded message (bet board + voice + the Eisenberg "distribution map" + how I'll work) → flip to `engaging`.

**`HEARTBEAT.md`** (shared) — §15.3. **`DREAMS.md`** (shared): nightly/weekly — read ledger + attribution → learn what converted → tune product-mention ratio + channel bets + voice + strike quality → update SOUL's living sections. **`cron.md`** (shared) — §15.2.

### 15.2 The cron schedule (all crons, user-TZ)

| Cron | When | What |
|---|---|---|
| **Morning plan** | ~7am daily | Write the day-plan row: funnel budget, posture, the deliberate post, watch-for list (§5.1). |
| **Deliberate post** | daily / few-per-week, best-time per channel | Post original content (autonomous) OR send the film-script (lower tier, §9.2). |
| **Daily strike digest** | ~midday | Batch the heartbeat-queued tap-strikes into ONE Telegram message: "your N best shots today, tap to post" (§7.7). |
| **Analytics pull** | 2–3×/day | Pull Zernio + scraped metrics → ledger → attribution chain (§10.1). |
| **Evening recap** | ~7pm daily | One grounded line: what I did + early signal. Silent if nothing real. |
| **Weekly review** | Sun PM | Deeper recap: what converted, what's working, the week's numbers. |
| **Monthly research refresh** | monthly | Light diff-based re-research → update SOUL living sections (§4.2). |
| **Nightly dreaming** | late daily | The reflection/learning pass (`DREAMS.md`). |
| **Heartbeat** | every ~10–20 min, waking hours | The engage loop (§15.3) — OpenClaw's pulse, not a cron. |
| *Infra:* lifecycle watchdog | periodic | Now idempotent off Convex rows — cannot re-spawn (§2). |
| *Infra:* spend-throttle sweep | periodic | Throttle-not-destroy on cap (§8). |

### 15.3 The heartbeat loop (concrete)

Each tick, waking hours. **Silent — never messages the user.**
1. Read state (phase, today's day-plan, budgets, throttle flag).
2. Throttled? → monitoring-only, exit.
3. Not `engaging`? → exit (boot/research owns that phase).
4. **Hunt** — fresh activity on bet channels (cheap) + competitor-mention watch + intent-phrase search. Freshness-weighted hard.
5. **Sort** each into funnel Tier 1/2/3.
6. **Pick** top 1–2 fresh high-intent within today's budget.
7. **Route by motion:**
   - *Autonomous* (Bluesky/Threads cold-strike; reactive replies anywhere): draft → `critic` → post via API. Draw down budget.
   - *Tap channel* (cold-strike on Reddit/X/IG/LI/TikTok): draft → `critic` → **enqueue for the daily strike digest** (do NOT post).
8. Log to ledger. Sleep.

### 15.4 Creative skills — reuse what we mostly already have

Existing creative pieces (per survey): `maya-creatify-video`, `maya-voice-applier`, `maya-clip-editor`, `maya-thumbnail-maker`, + media tools `save_media` / `generate_slide_image` / `clone_winning_ad` / `make_ad_from_url` / `check_video_job`. The redesign folds them under the **`make-creative`** skill (§6), gated by `planFeatures.creative` (§9.2):
- **`script_only`** (Starter): scripts only — creative tools return "script-mode."
- **`images`** (Growth): unlock image gen (`generate_slide_image`, thumbnail, product image).
- **`video`** (Studio): unlock Creatify video (`maya-creatify-video`, `make_ad_from_url`, `clone_winning_ad`, clip-editor, voice-applier).

All grounded in real product context · capped per-render · critic-gated · interface-isolated (Captions API fallback) per `CREATIFY_CREATIVE_SCOPE_V1.md`.

---

## Appendix — the v1 → v2 diff in one breath

Keep OpenClaw (heartbeat / cron / dreaming / SOUL / skills / memory). Shrink the agent to **judgment-only**. Kill the **subagent fan-out**. Make **Convex rows the truth** and every loop **idempotent**. Start the engage loop on **research-done-row**, not message-delivery. **Throttle, never destroy.** Heartbeat works silently; cron + events talk; dreaming learns. Be world-class at **native voice** and **attribution**; lead chief-of-staff, earn autopilot.
