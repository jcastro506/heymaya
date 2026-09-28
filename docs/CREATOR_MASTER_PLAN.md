# Maya — master build plan

**The one ordered list.** Every sprint from the three planning docs, sequenced by dependency, with status and the operator blockers each one waits on. When this and a detail doc disagree about **order**, this wins; for **what a sprint contains**, the detail doc wins.

- App: `CREATOR_COMPANION_APP_SPEC.md` (M-, C-, P-, I- sprints, decisions §0)
- Brain: `CREATOR_MAYA_EXPERTISE_AUDIT.md` (B-sprints, opportunity engine §8)
- Money: `CREATOR_COGS_MODEL.md` (costs, levers, live COGS §7)

**Code:** the app and backend changes are on branch `codex/creator-ios-app` (off `creator`), deployed to the creator dev deployment `impressive-roadrunner-997`. Docs are on `codex/creator-sprint-plan`.

**Standing rules that shape every sprint:**
- Messages is the only place she talks.
- Trust her judgment: code gathers facts and enforces promises, the model judges.
- Grounded or silent, including about the real world.
- Every app action has a chat equivalent.
- Every exit is shown live, not in a harness.
- The five mandatory test categories run in every sprint.

_Updated 2026-09-24._

---

## Where we are

_Status 2026-09-24. Code: `codex/creator-ios-app`, released to `staging` (#361, #362). Docs live with the code now._

| Sprint | Status | Notes |
|---|---|---|
| **M0** Foundation | ✅ Done | Native SwiftUI app, Clerk + Convex, contract tests on real query output, preview mode (`-MayaFixtures`). |
| **M1** Design system and screens | ✅ Done (your sign-off pending) | Today, Ideas, idea brief with moving video, You, Settings, Deals, numbers; real covers for both platforms. |
| **M2** Deep links | ✅ Done | `/o/idea/<id>`, `/o/post/<id>`, "this changed" states, fallback page, AASA (needs `APPLE_TEAM_ID`). |
| **M4 core** Awareness | ✅ Done | App actions reach her context once; block revisions refuse a stale move ("that block just changed"). |
| **M5** Share + Ask Maya | ✅ Done, live | "Send to Maya" in the iOS share sheet: a real TikTok shared from Safari reached dev with its note. Ask Maya on ideas and posts. |
| **M6** Widgets + a11y | ✅ Widgets live · push waits | Next shoot + best idea widgets fetch their own data (no push needed); verified with real dev data on the simulator home screen. VoiceOver reads real values. System push waits on APNs (Apple account). |
| **B0** Expert Bench | ✅ Harness, 23 cases, both platforms | Labels are drafts: **needs your sign-off.** The judge now sees tool results, what she watched, her memory and every post. |
| **B1** Numbers foundation | ✅ Done | One normal per platform; view history + shape; "broke out". |
| **B2** Diagnosis brain | ✅ Done | Evidence pack, causes that must cite evidence, the ask, after-a-hit, cross-posts, never-silent critic ladder. **Bench: 21/23 on merit** (baseline 8/16); the 2 left are judge errors or wait on B3. |
| **B3** World knowledge + search | ✅ Built · live exit waits on `TAVILY_API_KEY` | `web_search` / `web_read` on every skill (scrubbed of their identity, 2 a turn), 10 dated platform facts with sources, critic grounding check, stale-fact alert. |
| **B4** Care | ✅ Done, live | Content frustration → normal Maya; ambiguous → a light check-in in her voice (bench f6 passes); clearly about them → a crisis line, 24 h pause, your alert. |
| **B6** Opportunity engine | 🟡 Built, exit needs pilots | Lifecycle (≤2 follow-ups at 5/7/7 days then closed; one brand = one relationship; no credit on a known brand or a repeated search). Signals: 1 brands paying your lane, 2 accounts they tag in their own posts, 5 TikTok One + Instagram creator marketplace (from their own help pages, dated). Media kit from their rows + a **public media-kit page** (`/k/<slug>`, public numbers only, off kills the link; app card + chat tool). Weekly offer (partner tier), **one partnerships text a day** (the rest wait; not merged into one text). Applications: answers with Copy, "I submitted it", one check-in before + one after. **Bio email** only from a profile the brand's own site links. Bench: 14 opportunities cases. **Not built:** signal 3 (comment demand: her `post_comments` tool on ask), 4 (ad library), 6 (local). **Exit:** 3 partner-tier pilots. |
| **I1** Ideas in chat | ✅ Done | Five tools on one shared idea-act path with the app. |
| **N1** Ideas reach Messages | ✅ Done | One "unseen"; "+N more" on her idea text; offered once on a reply. |
| **O1** Live COGS | ✅ Done | Every cost line on /ops, real creators only. |
| **P1** Plans + billing | ✅ Built · phone exit waits on you | Plan screen, Switch via Stripe's plan-change confirmation (prorated), return to the app, gate matrix (5 tiers × 8 statuses). Test-mode prices for every tier × interval set on dev + staging. |
| **S0** Fleet scale | ✅ Done, live | Slim schedule rows + triggers; fan-out; cap inside `send`; parallel turns in order per creator. **Load test on dev, 500 extra creators across 24 zones:** scout dispatched 312 due creators in 5.8 s; every hourly job under 6 s; nightly repair 4.1 s with zero drift. Over the next ~70 min, 488 staggered scout passes ran (two hourly rounds) with **0 failures**; passes left queued for deleted creators no-op cleanly. |
| **Product sim** (zero credits) | 🟡 Built, live run pending | `replay` answers every public read from the dev read cache (a miss is named, never a paid call; 1-credit ceiling) and `script: "product"` adds 15 checked moments to the first-week week: settings and a rule by chat, booking a shoot, prep + check-in, one creator films and posts while one flakes (asked, "didn't get to it" understood, rebooked), the missed-shoot morning, app vs chat idea acts, Send to Maya, Ask Maya, care, pause/resume, memory, and a cap / rule / quiet-hours audit. See `docs/PRODUCT_SIM.md`. |
| **R1** Release to staging | ✅ Done | The creator product runs on `staging.hey-maya.ai` + `precise-canary-781`. Founder product's history and data kept. **Production (`main`) not touched.** |
| **C1** Copy | 🔄 Groundwork | Copy check on every app string; "why it's for you" written to them. **Needs the session with you.** |
| **D9, X1, M3, W1, M7, B5** | ⏳ Waiting | See "Your blockers". |

## The order

Three tracks run side by side where they don't depend on each other: **Brain** (her intelligence), **App** (the phone), and **Platform** (money, channel, ops). Durations are working days.

### Phase 1 — Truth and foundations (≈ 2 weeks)

| # | Sprint | Track | Depends on | Blocked on you |
|---|---|---|---|---|
| 1 | **M1 finish**: covers + avatars stored server-side for TikTok **and** Instagram; Dynamic Type; motion and loading pass; moving video in the idea hero (§M1 additions) | App | — | Sign-off on your phone |
| 2 | **B0**: Expert Bench (~40 cases), today's Maya scored as-is | Brain | — | ~2 h labelling the cases |
| 3 | **M2**: object routes `/o/<kind>/<id>`, "this changed" states, legacy `/app/*` link mapping, universal links | App | 1 | One sign-in on the simulator (to verify signed-in flows) |
| 4 | **B1**: one age-adjusted "normal", post snapshots, diagnosis v2 incl. "broke out", hourly detection | Brain | 2 | — |
| 5 | **O1**: live COGS on /ops (exclude eval spend; messaging, Zernio, Stripe, fixed costs; per-creator margin) (COGS §7) | Platform | — | — |

### Phase 2 — Her brain and her hands (≈ 3 weeks)

| # | Sprint | Track | Depends on | Blocked on you |
|---|---|---|---|---|
| 6 | **B2**: diagnosis brain (evidence pack, ranked causes she judges, ask when unsure, after-a-hit playbook) | Brain | 4 | 3 pilot creators' real posts for the live exit |
| 7 | **M4 core**: `act()` + `userActions` + awareness v1 (State/Noticed; Reacted only for share, Ask Maya, upgrade) + `rev` guards | App/backend | 3 | — |
| 8 | **I1**: Maya's full chat control of ideas, equal to the app; she resolves "the humidity one" by judgment | Brain/app | 7 | — |
| 9 | **B3**: world knowledge + **web search on every skill**; location in memory; critic grounding check | Brain | 6 | `TAVILY_API_KEY` on dev/staging |
| 10 | **B4**: health, safety, business playbooks (crisis → resources + your alert) | Brain | 6 | Run the safety scenarios by text |
| 10a | **S0**: scale the fleet jobs (below) | Platform | — | — |
| 10b | **N1**: new ideas reach them in Messages (below) — ✅ built | Brain/app | 8, 10a | — |

### Phase 3 — Money and words (≈ 2 weeks)

| # | Sprint | Track | Depends on | Blocked on you |
|---|---|---|---|---|
| 11 | **D9 decision**: pricing shape (one plan ~$29 + money upgrade, or current tiers) | You | — | **The decision** |
| 12 | **P1**: plans, billing and gating proven end to end on a phone; entitlements matrix; in-app upgrade/manage/downgrade | Platform | 7, 11 | Stripe test prices for every tier × interval |
| 13 | **B6**: opportunity engine ("Maya finds you money": TikTok Shop, UGC, gifting, then pitches); lifecycle with ≤2 follow-ups; no Gmail send in v1 | Brain | 6, 9, 12 | 3 partner-tier pilots |
| 14 | **C1**: copy — how Maya explains herself (starts with a working session) | App | 1 | **The brainstorm session** |

**Gate:** until B6 ships, the Deals **Unlock** button is hidden on TestFlight, or the ladder lists only what works today (D2 honesty gate). Your call, before the cohort.

### Phase 4 — Channel and onboarding (≈ 2 weeks)

| # | Sprint | Track | Depends on | Blocked on you |
|---|---|---|---|---|
| 15 | **X1**: messaging: the vCard contact card live test; move to Linq direct (or confirm Claw) with recipients-per-line in writing; Twilio SMS/RCS failover; outbound:inbound ratio rail; start the Apple Messages for Business application | Platform | — | **Linq/Claw quotes** |
| 16 | **M3**: onboarding and login in the app (Welcome → plan → connect → "here's what I see" → watch picks → calendar → text START → opening texts §5.5) | App | 12, 14, 15 | Clerk dashboard: register the iOS app, enable Sign in with Apple |
| 17 | **B5**: re-bench, model decision for diagnosis, sign-off on the scorecard | Brain | 6–10, 13 | Sign the scorecard |
| 17a | **R1**: the creator product's release path (below) | Platform | 10a | **Go/no-go on replacing the product on staging, then prod** |
| 17b | **W1**: the landing page for an app (below). **Built 2026-09-25**: the page, `/join` → App Store/TestFlight, QR, smart app banner, tests. Open: real Simulator captures, Lighthouse | App/web | 11, 14, R1 | The C1 copy pass; set `NEXT_PUBLIC_TESTFLIGHT_URL` now, `NEXT_PUBLIC_APP_STORE_URL` once live |
| 17c | **K1**: the media kit and the pitch, done properly (below). Partner tier only. **Built 2026-09-26**: kit v2, the page, per-brand links, pitch rules and send window, the app card, the sims. Open: the live sim runs, the Swift build, 10 bench cases | Brain/app | 13 (B6) | Run the sims (docs/DEALS_WORLD_SIM.md). Live exit: 3 partner-tier pilots |

### Phase 5 — Native surfaces (≈ 1.5 weeks)

| # | Sprint | Track | Depends on | Blocked on you |
|---|---|---|---|---|
| 18 | **M5**: Ask Maya handoff + share extension ("send her a post" from TikTok/Instagram) | App | 7, 9 | — |
| 19 | **M6**: widgets, system-only push, full accessibility and polish pass | App | 16 | — |

### Phase 6 — Ship (≈ 1 week, then the cohort)

| # | Sprint | Track | Depends on | Blocked on you |
|---|---|---|---|---|
| 20 | **M7**: App Review, 5-creator TestFlight cohort for 7 days, retire the web UI | App | everything above | Apple Developer account, App Store Connect record, the 5 creators |

**After:** Android (Kotlin, same spec), Apple Messages for Business, StoreKit if the US link-out commission changes or we launch abroad.

**Rough total:** ~12–14 weeks with the three tracks in parallel. The long poles are the Brain track (B0→B2→B3) and your decisions (D9, the Linq quote, C1).

---

## S0 — Scale the fleet jobs (research, 2026-09-23)

N1 lives inside the hourly jobs, so first a look at all of them. **29 crons** in `convex/crons.ts`; the ones that text a creator: scout (hourly :05), human cadence (hourly :55), weekly review and week plan (hourly, Sunday on their clock), first week (hourly), creator status (hourly), calendar reminders, roster offers. What breaks as the creator count grows:

| # | Finding | Where | Breaks at | Fix |
|---|---|---|---|---|
| 1 | **Every hourly job reads the whole `creators` table** (`.collect()`), full documents with dossier, notes and affinities, to find who's due this hour. | 14 modules (`scout.dueForScout`, `cadence.dueNow`, `review.dueForReview`, `status`, `alerts`, `consolidate`, `formats`, `firstWeek`, `sweep`, `sounds`, `readback`, `taste.profile`, `eval.run`, `ops`) | **Measured:** creator docs are 12.7 KB median, 17 KB p90 on dev, and grow with tenure (dossier, previous dossier, notes). Convex stops a query at **16 MiB** read, so every hourly job fails at once at roughly **1,000 creators**. An operator alert now fires daily from 40% of the limit. | A small `schedule` row per creator (paired, status, timezone, and the next due time for each touch), indexed by due time. "Who's due" becomes an indexed range read of only the due rows. Weigh against the schema's TS ceiling: one table, not one per touch. |
| 2 | **The scout and the week plan run every due creator one after another inside ONE action.** A scout pass with model calls takes 20–60 s; actions stop at 10 minutes (Node) or 30 (Convex runtime). | `scout.runAll`, `weekPlan.runAll` | Roughly 15 due creators in the same hour: the rest **silently never run**. | Fan out through the scheduler like cadence and review already do, one action per creator, with jitter across the hour to spread vendor load. |
| 3 | The week plan reads `creators.take(500)`. | `weekPlan.due` | Creator 501 never gets a week plan, silently. | Folded into #1. |
| 4 | **The daily text cap is checked by each sender, then counted at send.** Two jobs in the same hour can both read "0 sent" and both send. | 7+ proactive senders; `messages.send` counts but doesn't refuse | Rare now; routine at scale (scout :05 and cadence :55 are the same hour for many creators). | The cap is enforced **inside** the send mutation, transactionally: one function decides send-or-hold (architecture principle 9). Callers get a named "held: daily cap" result, never a silent drop. |
| 5 | ~~Never-shown ideas teach her "they dislike this"~~ **Checked and wrong:** `expireIgnored` already skips ideas that were never texted (it requires `sentAt`). The real problem there: it finds stale ideas with an **unindexed filter over every creator's ideas**, so its cost grows with the whole fleet's history. | `taste.events.expireIgnored` | Grows with total ideas ever written, not with today's work. | An index on `[status, createdAt]` (or per-creator through the schedule rows in #1). |

**Tests:** a seeded simulation with 2,000 creators across 24 timezones (convex-test): every hourly job's "who's due" reads only due rows (a count assertion on documents read); a fan-out test (a 60 s fake scout × 40 due creators all complete); a cap race (two senders in one transaction window → exactly the cap sent, the other held with its reason).

**Progress (2026-09-23):** #1 has an alarm (daily operator alert from 40% of the read limit), with the refactor due before ~500 creators; #2 fixed (scout and week plan fan out, one action per creator, spread over 40 min); #4 fixed (the cap holds inside `send`; one `countsTowardCap` definition for the rails, the counter and the hold). #1, #3, #5 open.
**Exit, live:** on dev, 500 seeded (unpaired-safe) creators; one full day of crons runs with no job over 10% of its limit, and /ops shows per-job duration and rows read.

## N1 — New ideas reach them in Messages

**The rule: the text is the delivery; the app is the closet.** Nobody should need to open the app to get value. Operator, 2026-09-23: "we can't just rely on the user to come into the app all the time to swipe."

**Design:**
1. **No "you have new ideas!" text, ever.** Every text is worth reading by itself; a nudge-to-open trains people to mute her.
2. **The best idea travels; the rest ride along.** Her one proactive idea text leads with the best new idea, complete, and ends with a clause code appends: "+2 more in your ideas" with a link. The count is computed by the **same function** as the app's "N new" badge, so they can never disagree.
3. **She mentions them when they come to her.** Unseen ideas appear as a small context section on her reply turns ("3 new since tuesday; best: the chipotle one"). She decides whether the moment is right: not mid-problem, never in a care moment, never on a check-in. Once shown to her on a reply that went out, that batch is marked offered: **each batch is offered once**.
4. **Swiping by text.** "what else you got" / "send me more" → she sends the next best unseen idea with the I1 tools; "save it", "nah", "plan it for thursday" work on it.
5. **The app counts as seeing.** A card on screen for a beat marks it seen; she never brings up an idea they already swiped. Urgent ideas (a breakout that goes stale in days) are the ones she texts first.
6. **Silent badge.** The app icon shows the unseen count. It's system UI, not her voice, so it respects "push is never Maya" (ships with M6's push).

**How it's built so it holds at scale (after S0):**
- **No new cron and no new sender.** The ride-along rides the scout's existing text; the mention rides replies (which aren't proactive and don't spend the cap); "seen" rides app mutations. N1 adds zero fleet scans.
- **Fields, not a table** (schema ceiling): `ideas.surfacedAt` (texted or offered) and `ideas.seenAt` (on screen in the app), plus an index `by_creator_unseen` so the count is an indexed read, never a scan.
- **One definition of "unseen"** (pure function, unit-tested): open status, no `seenAt`, no `surfacedAt`, not expired, produced in the last 7 days. The app badge, the ride-along count and her context section all call it.
- **Seen marking is batched and idempotent:** the app sends ids in one mutation as cards appear (debounced); replays are no-ops.

**Tests (five categories plus):**
- sibling coherence: the app's "N new", the ride-along count, and her context section agree on one fixture (one function, three callers);
- mention-once: a batch offered on a reply is never offered again; a new idea starts a new batch;
- never during care, a check-in, or an open question;
- an idea seen in the app is never mentioned or ridden along;
- no new proactive sends: a grep test that N1 adds no `proactive: true` path;
- cross-tenant: counts and sections never include another creator's ideas;
- adversarial: idea text in the section is quoted data;
- scale: the unseen count on a creator with 500 ideas is one indexed read.

**Built (2026-09-23):** `core/unseen` (one definition, indexed per creator), the scout's exact "+N more" line, her reply-turn section with offered-once marking, `ui.markIdeasSeen` and the app's "new" chip. 9 tests incl. coherence, cross-tenant, and "no new sender".
**What I found building it:** today **every idea Maya writes is texted** (the scout writes an idea only when it sends one). The app holds untexted ideas only when the new daily cap holds a scout text. So N1's machinery matters most once the app carries more ideas than she texts, which is the open product question: should the scout keep its strong runner-up as an app-only idea? That costs one more writer call per scout pass.

**Exit, live:** on dev with both personas (TikTok-only and both-platform), three ideas land in a day. The scout text carries "+2 more" with the right count. A reply to an unrelated message mentions them once, in her voice. Swiping them in the app makes her stop mentioning them. The badge matches.

## R1 — The creator product's release path (found 2026-09-23)

**Finding:** nothing of the creator product has shipped. `creator` is **282 commits** ahead of `staging` and has never been merged; this app's branch sits on top of it. Staging (`precise-canary-781` + Vercel preview) and production (`hey-maya.ai`, Vercel project `clawlaunch`) still serve the **previous product**. Everything verified so far was verified on the creator dev deployment (`impressive-roadrunner-997`). Pushes to `staging`/`main` deploy through Vercel on PR merge; `codex/*` branches don't deploy.

**Build:**
- A written cutover plan: what replaces what on staging, data on staging (keep, migrate, or start clean), env vars the creator product needs on staging and prod (Zernio, ScrapeCreators, OpenRouter, Gemini, Claw/Linq, Stripe prices per tier, Tavily, `APPLE_TEAM_ID`, `APP_URL`), the Clerk instance for each environment, and the rollback.
- Merge `creator` (with this branch) → `staging` by PR; `npm run convex:staging` (never bare `npx convex deploy`); Vercel preview up.
- The same for `main` only after staging holds for a week with pilot creators, using `npm run convex:prod` (it refuses unless on a clean `main`).
- CI: typecheck + tests green on the merge (the 4 cadence failures fixed first; they're being fixed in another session).

**Tests:** the full suite on the merge commit; a staging smoke run (sign in, connect, text START, first read, an idea, the app on staging data); the AASA and `/o/*` fallback served from the staging domain.
**Exit, live:** the app on TestFlight talks to staging; a pilot creator completes onboarding on staging with no operator help.

## W1 — The landing page for an app

**Finding:** `app/landing/Landing.tsx` (637 lines) sells the previous shape: **Telegram** (7 mentions, "open Telegram and tap Start") and a **web dashboard** ("the dashboard is there when you want a bigger view"). Both are gone in the new design: she lives in Messages, and the web dashboard is retired for the app.

**Build (after C1, which sets the words, and D9, which sets the price):**
- The story in one screen: "she texts you" (Messages) + "everything she's found, in one place" (the app), with real screens from the app, not mockups (§ grounded or silent applies to marketing too).
- The CTA becomes **Get the app** (App Store badge + a QR on desktop), with `/join` attribution carried through the install (campaign token → first open), per M3.
- Both platforms in every example: a TikTok and an Instagram post, side by side.
- Pricing from `billing/tiers.ts` (one source; the page never hardcodes a number).
- Removed: Telegram, the dashboard, and any "AI" wording (standing rule). The web keeps only the landing, legal pages, `/o/*` fallbacks and the AASA.
- A smart app banner on mobile Safari; the desktop page explains the QR.

**Built (2026-09-25):** `app/landing/Landing.tsx` + `Screens.tsx`. The app's screens (Today, Ideas, Your numbers, the Sunday review) and a Messages thread are drawn in HTML from the SwiftUI source (same palette, cards, chips, tab bar), for a sample runner who posts on both platforms. They scale with the phone and use no stock images or real creator's posts. `lib/appLink.ts` is the one answer to "where does Get the app go": the App Store with `ct`/`pt` when `NEXT_PUBLIC_APP_STORE_URL` is set, the TestFlight link from `NEXT_PUBLIC_TESTFLIGHT_URL` before that, and the web sign-up while neither exists (so the Telegram pilot path still works). `/join` redirects there and keeps the attribution cookie. A QR code for desktop; the smart app banner turns on with the store link (`NEXT_PUBLIC_APP_STORE_ID` optional). Tests: `lib/__tests__/appLink.test.ts` and `app/landing/__tests__/landing.test.ts` (copy inventory, prices only from tiers, every CTA through `/join`). Checked at 1440 and 390 px, with no horizontal scroll.
**Open:** `scripts/app-screens.sh` (Mac) captures the real screens from the Simulator with `-MayaFixtures` into `public/app-screens/`, for the App Store listing, or to replace the drawn screens once the operator picks. Lighthouse run on the Vercel preview. First-open attribution (M3).

**Tests:** a content-inventory test (no "Telegram", "dashboard", vendor names or "AI" in the rendered page); prices on the page equal `billing/tiers.ts`; every CTA carries attribution; Lighthouse ≥ 90 on mobile; the page renders at phone width with no horizontal scroll.
**Exit, live:** on staging, a phone visitor taps Get the app, installs from TestFlight/App Store, and the first open is attributed to the campaign.

---

## B7 — Finish this one: caption + sound for a filmed draft (2026-09-24, built)

**Why:** the ideal user (operator's partner) films first and then gets stuck on the caption and the sound. That's the moment to help.

**Built:** a camera-roll video sent to Maya is watched AND listened to, then she sends three captions of different kinds in their voice and one to three sounds, each looked up this turn, with how to use it and a business-account warning where needed. Code drops any sound no lookup backed. Her reasons go on a `finishes` row (`finish_notes` answers "why?"). When they post, a daily job compares what went out with what she offered and keeps one caption habit as a preference.

**Found while building it:**
- sound lookups served from the cache came back empty;
- Instagram single-post reads never found the video, so no Instagram link was ever watched;
- drafts over 19 MB couldn't be watched, so they now upload to the watcher as files;
- the bench judge cut off her reply once the facts grew.

**Left:** real phone videos over 20 MB can't arrive by text (Telegram's bot limit; our iMessage intake cap). "Send to Maya" from Photos, uploading straight to storage, is the fix (M5 extension).

## K1 — The media kit and the pitch, done properly (planned 2026-09-26)

**Why:** the landing sells "she builds your media kit and writes the outreach", and B6 has a v1 of both, but the kit is thin (handle, niche, followers, typical views, top 3 posts, no photo, no audience, no engagement) and has never run for a real creator, and the pitch skill has honesty rules but no craft (structure, length, subject, deal type). **Partner tier only**, like the rest of B6: every tool, page and cron below checks `partnershipsOpen`.

**What the research agrees on** (vendor-blog statistics ignored; sources in the session notes):
- **The kit is one page**, read in 30–60 s. In order: photo, name, one line, handles · per platform: followers, engagement, growth · **audience** (age, gender, top countries/cities), which brands check first · 4–6 best posts from the last ~6 months, as thumbnails · services (sponsored post, UGC, affiliate, gifting) · past brand work · contact. Live and dated beats a stale PDF.
- **One base kit, tailored per pitch**: which posts lead, plus one idea for that brand. Never a rebuilt kit per brand.
- **The pitch**: under ~150 words · a specific subject (brand + idea or deliverable, never "Collaboration opportunity") · who you are + one real number · **why this brand** (a real reason) · **one concrete idea** · 2–3 relevant links · **one ask** · the kit as a **link, not an attachment** · sent weekday mornings. By deal type: sponsorship sells audience fit; **UGC sells the work and usage rights, not followers**; gifting is a small ask; affiliate shows the audience buys.
- **Follow-ups**: first after 5–7 days, one more, then stop (B6 already enforces two at most).
- **After a yes**: FTC disclosure: "#ad" (or "paid partnership with X") up front, and the platform toggle alone is not enough.

**Decisions (operator: "whatever you think is best", 2026-09-26):**
- **Rates never go on the kit.** They go in a reply, only with their OK.
- **Audience demographics on the public kit are opt-in**, asked once when the kit is first turned on.
- **"They opened your kit"**: yes, told once per brand, inside the one-partnerships-text-a-day rail. Only per-brand links are tracked; the base kit is not.
- **Her photo** (below).

### The photo

1. **Default: their own profile picture**, already mirrored to storage for both platforms (`media`, kind `avatar`); Instagram first, TikTok second.
2. **Their choice, any time, both doors:** text her a photo ("use this for my media kit") or pick one in the app (Deals → Your media kit → Photo). It's stored as `kitPhoto` (their upload, never a platform's). The same shared function serves both doors.
3. **She suggests an upgrade** when the default is weak: too small (under 300 px), or not a face. She checks with one Gemini look when the kit is first built ("your IG picture is your logo. want to send me one of you?"). She asks once, never nags.
4. **Never generated or edited.** No AI headshot, no touch-up, no background swap (grounded or silent, applied to their face). Crop to a circle or square only.
5. **Off switch:** "no photo on my kit" is kept as a rule.

### Build

**Phase 1: kit v2 (data and page)**
1. `readKit` v2, every field a stored row with its source and date: engagement per platform (median of the last 90 days, defined on the page: interactions ÷ views, and ÷ followers where brands expect it) · 30-day follower growth · Instagram audience (A1 rows) · reach · 6 best posts of the last 6 months with stored covers · past brand work (their own #ad/paid posts + closed-won deals) · services (from `dealTypes`) · region · contact email (their connected mailbox, or none).
2. **The one line:** she drafts it from the dossier and their posts, and they approve it by text or edit it in the app (stored in `partnershipProfiles`, never live-generated on the page).
3. **TikTok audience from a TikTok Studio screenshot** (the platform doesn't share it). The screenshot reader extracts age, gender and top countries, rejects numbers that don't add up, and stores them labelled "from your TikTok Studio, <date>". It goes stale after 60 days (hidden, and she asks for a fresh one when a pitch needs it).
4. **Page redesign** (`/k/<slug>`): one page, phone-first, thumbnails, the photo, a print stylesheet ("Save as PDF" for forms that want a file), and `as of` on every number. Public numbers plus opted-in audience only; never rates, preferences, excluded brands or email beyond the contact they chose.
5. **App:** the kit preview in Deals (M1 kit), sections on/off, photo, the one line, all by chat too (principle 7).

**Phase 2: tailored per brand**
6. **Per-opportunity link** `/k/<slug>/<variant>`: the same kit, leading with the 3 posts she judges most relevant to that brand (she picks from their rows, and a code check keeps them their own), plus "An idea for <Brand>", taken from the draft. It dies when the relationship closes.
7. **She decides when the kit goes in:** always linked in a first email pitch · pasted into an application only when the form asks for it (a kit, portfolio or link field) · in a DM, only when they asked for one · in a reply when the brand asks ("send your media kit"). The rates in that same reply are theirs to give.
8. **Opened notice:** a variant's first view by anyone other than them → one line, "stride lab opened your kit", within the daily partnerships rail.

**Phase 3: pitch writer v2**
9. **A playbook by deal type** (sponsorship, UGC, gifting, affiliate, ambassador, application) in `PARTNERSHIP_SKILL`, from the research above.
10. **Code checks on every draft (refused with the reason, and she retries within budget):**
    - body ≤ 150 words for a first pitch;
    - subject ≤ 60 characters and names the brand, never "collaboration opportunity";
    - exactly one ask;
    - the kit link is present in a first email pitch;
    - at most 3 links, no attachments;
    - every number in it equals a kit row (extends the existing grounding check).
11. **Send timing:** an approved first pitch goes out the next weekday morning, 9–11 their time, unless they say "send now". Replies go at once.
12. **After a yes:** the disclosure reminder on the post they make for it, and rates, usage rights and exclusivity always go to them (as B6).

### Simulations (all of them run on the real model and the real code, with fakes at the edges)

**KW: the kit world**, new steps on the deals world (`eval/dealsWorld`, same fake market, fake Gmail, fake profile reads). Rows first, then words, then the judge:

| Step | Proves |
|---|---|
| kit_first_build | "make me a media kit": built from rows, the default photo, every number equal to a row, no rates, and ONE question (the one line or the audience opt-in) |
| photo_weak | a logo avatar: she offers once to use a real photo; she never nags again |
| photo_upload | Sam texts a photo, "use this one": the kit shows the upload; the avatar is gone from the page |
| tiktok_screenshot | a TikTok Studio screenshot becomes a labelled, dated audience; a screenshot whose shares don't add up is refused |
| opt_out | "take my audience off" and "no photo" are removed from the page at once; rates never appear even with `minimumRate` set |
| stale_refresh | 35 days later: numbers and best posts change, `as of` moves, posts older than 6 months drop |
| variant_sponsorship | Northline: the per-brand link leads with running posts that are Sam's own; its idea equals the draft's idea; the email links it |
| variant_ugc | Cadence UGC: leads with the best-made posts, not follower counts; usage rights go to Sam as a question |
| variant_affiliate | TrailFuel: leads with the posts where Sam already tagged it ("you already use it") |
| kit_decision | a form with no kit field gets no kit; a first DM gets no kit; a brand asking "send your media kit and rates" gets the link and a question to Sam about rates, never a rate |
| opened | the brand opens its link: Sam hears it once, inside the daily rail; Sam's own views never count |
| variant_expires | after Arcadia declines, its link is a 404; the base kit is unaffected |
| pitch_rules | a first pitch that runs long, has a vague subject or two asks is refused by code and redrafted within the budget |

**E2E: the whole job, from nothing to a draft**, three personas so one world doesn't fit all: **Sam** (running, sponsorship), **Priya** (skincare, UGC-first) and **Leo** (home cooking, gifting and affiliate). Each starts with no deals rows. Steps: the sampler's observations of the lane's paid posts → the weekly offer → "yes, look into the first one" → research and a recommend/investigate/pass verdict → save → kit check (ask for what's missing) → per-brand link → pitch **saved as a draft awaiting the exact SEND code** → nothing sent. Checked: every step's row, the draft's code checks, and the judge's craft score (why-this-brand is real, the idea is specific, the ask is one, the deal-type framing is right).

**RW: the real world, drafts only.** The same E2E on the dev deployment against **real** lane data (the replay cache) and **real** brand research (Tavily, needs `TAVILY_API_KEY`; about a dollar a run). Gmail is the fake, so sending is impossible by construction. The output is a report of real brands, verdicts, kits and drafts for the operator to read. That is the honest test of "would I send this".

**Bench:** 10 new Expert Bench cases (kit questions, pitch craft by deal type, "send your rates", disclosure).

**Tests (the five categories):** cross-tenant (A's variant never shows B's posts; A can't read B's kit photo) · fail-closed (below partner tier every kit and variant tool refuses; a revoked slug is a 404) · adversarial (a brand name with markup, a screenshot with injected text, a photo that isn't a person) · sibling coherence (kit numbers equal the numbers she texts; the app and the page read one `readKit`) · TODO grep.

**Exit, live:** 3 partner-tier pilots each have a kit they'd send, and one real pitch draft each that the operator reads and would send unchanged.

**Built (2026-09-26):**
- `partnerships/kitData.ts` (kit v2, every number a dated row; the public view), `kitSettings.ts` (the one shared function for the one line, audience opt-in, photo, TikTok audience; per-brand links; opens), `kitImage.ts` (a texted photo or TikTok Studio screenshot, one Gemini look; the default photo's one check), `kitTools.ts` (`media_kit` v2 with its one `next:` question, `media_kit_edit`, `kit_for_brand`; partner tier only, like the partnership belt), `pitch.ts` (the playbook, the code checks, the weekday-morning window, the disclosure line). Schema: `mediaKits`, `kitVariants` (both in deletion, export and the sim ageing map).
- The page `/k/<slug>` (base and per-brand; prints to PDF; views reported after the response).
- The app: `ui:kit`, `kitSettings:appUpdate`, `photoUploadUrl`; the Deals tab's kit card (photo picker, the one line with Use this / Edit, the audience switch, the link, the per-brand links with "opened"). The Swift is written to the existing patterns but hasn't been compiled here (no Xcode in this container).
- Sims: 11 deals-world steps, `eval/dealsE2E` (three personas, fakes and real modes), and the same story deterministically in `dealsE2E.test.ts`. Run commands: `docs/DEALS_WORLD_SIM.md`.
- Not built: the 10 Expert Bench cases; "learn which pitch shapes get replies" (needs real replies first).

## A1 — Account setup + analytics depth (planned 2026-09-24)

**Research (Zernio docs):**
- **Instagram requires a professional account**; personal accounts can't connect. Creator beats Business (Business gets a limited music library).
- **TikTok: stay personal.** Business accounts lose trending sounds and the Creator Rewards Program. Zernio ties the richer TikTok metrics to its TikTok for Business connection, not to account type. Whether a personal account gets them is **unverified until a real account connects**.

**Unused today:**
- TikTok per post: completion rate, where views came from (For You, Following, Search, Profile, Sound), follower vs non-follower and new vs returning viewers, profile views, audience countries;
- Instagram account: follows and unfollows, profile link taps, demographics (100+ followers);
- follower history on both.

**Build:**
1. an onboarding check with a step-by-step sheet to switch Instagram to a Creator account (no nudge on TikTok);
2. pull the unused metrics;
3. app cards: "where your views came from" and "who's watching", plus follower growth;
4. Maya cites them in "why did this do that";
5. tests.

**Exit, live:** a real TikTok and Instagram connected on dev (yours).

## L1 — The living simulation: months of a creator, compressed (planned 2026-09-24)

**Why:** operator: "watch her grow and change with the user … everything our Maya can do, sim it." One long-running check that the whole product holds over months, not one turn at a time.

**Design:**
- **Real history, replayed.** A persona starts N months back in her real timeline. Each simulated week, her real posts from that week go live with their real numbers, and so do the real posts of the accounts she watches.
- **The clock moves by ageing the world.** Maya's code reads the real clock, so each simulated day shifts every one of that creator's rows a day into the past. Her real crons and turns run unchanged: scout, cadence, weekly review, week plan, finish lessons, deals.
- **A creator actor.** A model plays the creator from her real captions plus a hidden script of life events (a race, a trip, a slump, a brand DM). She replies or ignores, taps ideas, films or misses blocks, and asks for captions. Before a real video goes live, she sends it as a camera-roll draft; then it posts with its real caption, so B7's lesson loop runs on what she really wrote.
- **Deals** (partner tier): the weekly offer, research against the fakes, drafts approved by SEND, the fake Gmail send, follow-ups, a brand reply, a negotiation, a rejection, and "no response" closing.
- **Measured weekly:**
  - memory (records, notes, the dossier's lane);
  - taste shifts;
  - ideas sent, taken and passed;
  - prediction accuracy;
  - course changes when things aren't working;
  - caps and quiet hours;
  - cost.

  Probes at months 1, 3 and 6 ask what only a real memory can answer.
- **Output:** a timeline report.

**Cost:** about 2 credits a simulated day for the watched accounts' replay, plus model turns. A 6-month run is a few hours in the background.

## Your blockers, in the order they're needed

1. **Apple Developer account** (team id into `apps/ios/Config/Local.xcconfig`): lets me put builds on TestFlight from M1 on.
2. **Sign in once on the simulator**, and **connect your own TikTok + Instagram on the dev web app**, so signed-in and Zernio-connected screens run on live data (M2, B1).
3. **Label the ~40 bench cases** (B0), about 2 hours.
4. **`TAVILY_API_KEY`** on dev/staging (B3).
5. **D9 pricing decision** and **Stripe test prices** (P1).
6. **Linq and Claw quotes**, with recipients-per-line in writing (X1).
7. **The C1 copy session** (before M3).
8. **Clerk dashboard:** register the iOS app, enable Sign in with Apple, confirm the Convex integration (M3).
9. **Pilot creators:** 3 for the brain exits (B2, B6), 5 for the cohort (M7).
10. **Deals unlock** on TestFlight: hide it, or trim the ladder (before M7).
11. **Buy the 500k ScrapeCreators pack** when the pilot starts spending (cost lever, COGS §6).
12. **R1 go/no-go:** the creator product replaces the previous one on staging (then prod). Nothing of it has shipped yet.

---

## What "next" means right now

Everything buildable without you is built or in B6. **What's left needs you**, in this order:
1. **Which Apple team publishes the app** (Zackat Labs Inc. `2AZM4M4JFR`, or your personal team `GFR22H29TJ`). Unblocks TestFlight, universal links (`APPLE_TEAM_ID`) and the share/widget keychain group.
2. **`TAVILY_API_KEY`** on dev + staging → B3's live exit (and the bench's two remaining cases).
3. **Sign the B0 labels** (23 draft cases) so the bench scores against your call.
4. **D9 pricing** (the test prices use the current $19 / $24.99 / $29.99), then P1's phone exit (subscribe → upgrade → Deals unlocks).
5. **X1 messaging** (Linq/Claw quotes) and **the C1 copy session** → M3 onboarding in the app → W1 landing.
6. **R1 part 2:** staging → `main` when staging has held with pilot creators.
7. **`staging.hey-maya.ai` serves an old deployment** (the domain sits in your personal Vercel team, not ClawLaunch; `/o/billing` and `/k/*` 404 there while `clawlaunch-git-staging-claw-launch.vercel.app` serves the new build). Point the domain at project `clawlaunch`, branch `staging`. Until then Stripe returns and Maya's links on staging land on a 404, because staging Convex `APP_URL` is that domain.

**What I build next:** nothing on the buildable list is left that doesn't need you. B6 signals 3/4/6 wait on pilot evidence that they'd be worth the credits.
