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

_Updated 2026-09-23 (evening)._

---

## Where we are

| Sprint | Status | Notes |
|---|---|---|
| **M0** Foundation | ✅ Done | Native SwiftUI app, Clerk + Convex, contract tests on real query output, preview mode. Not on TestFlight yet (needs the Apple account). |
| **M1** Design system and screens | ✅ Done (your sign-off pending) | Today, Ideas (swipe stack), idea brief with **moving video**, You, Settings, Deals, Your numbers + post. **Real covers and avatars for both platforms, stored server-side** (`convex/media.ts`). Largest text sizes adapted. |
| **M2** Deep links | ✅ Done | `/o/idea/<id>` and `/o/post/<id>`; Maya's link tool links only her creator's own objects; "this changed" states; web fallback page + AASA (needs `APPLE_TEAM_ID`). |
| **B1** Numbers foundation | ✅ Done | One normal, per platform, settled posts only; view history + shape; "broke out"; detection every 6 h and hourly on Zernio. Live: the 879K post that read "normal" reads "broke out (711×)". |
| **O1** Live COGS | ✅ Done | /ops shows every cost line for real creators only, margin, under-30% list; OpenRouter reconcile daily. |
| **B0** Expert Bench | ✅ Harness + baseline (labels draft) | **8/16 pass, 4 false claims.** Worst: distress read as content fatigue; "why did it pop" got no answer. See audit §7 "B0 baseline". **Needs your label sign-off.** |
| **M4 core** Awareness | ✅ Done | `userActions` + awareness levels; app actions reach her context once; seen only when she speaks. (Block `rev` guards moved to I1.) |
| **B4** Care | ✅ Done, live | Three paths, her judgment picks: content frustration → normal Maya; ambiguous ("i'm giving up") → a light question in her voice, no hotline; clearly about them → a check-in with a crisis line, 24 h pause, your alert. Live: distress passes; "giving up on tiktok" cases added. |
| **B2** Diagnosis brain | 🔄 Built, live bench running | Evidence pack (the post against their own posts), causes that must cite evidence, the ask, after-a-hit; **rejected never means silent** (read → rewrite → cautious → a floor built from real numbers). Live: "why did it pop" went from silence to a grounded read; the flop case passes. |
| **I1** Ideas in chat | ✅ Done (live exit pending) | 5 tools on one shared idea-act path with the app; parity matrix; app "Bring it back". |
| Instagram in the bench | ✅ Added | 5 cases on a real both-platform creator. **First run found a real bug:** her own Instagram links were treated as strangers' ("couldn't open that link"). Fixed. |
| Cadence test failures (pre-existing) | 🔄 In a separate session | Not blocking. |

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
| 10b | **N1**: new ideas reach them in Messages (below) | Brain/app | 8, 10a | — |

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
| 1 | **Every hourly job reads the whole `creators` table** (`.collect()`), full documents with dossier, notes and affinities, to find who's due this hour. | 14 modules (`scout.dueForScout`, `cadence.dueNow`, `review.dueForReview`, `status`, `alerts`, `consolidate`, `formats`, `firstWeek`, `sweep`, `sounds`, `readback`, `taste.profile`, `eval.run`, `ops`) | When the table's bytes pass Convex's per-query read limit, **every** hourly job fails at once (measure the average creator doc to set the number; a 20 KB dossier puts it in the high hundreds). | A small `schedule` row per creator (paired, status, timezone, and the next due time for each touch), indexed by due time. "Who's due" becomes an indexed range read of only the due rows. Weigh against the schema's TS ceiling: one table, not one per touch. |
| 2 | **The scout and the week plan run every due creator one after another inside ONE action.** A scout pass with model calls takes 20–60 s; actions stop at 10 minutes. | `scout.runAll`, `weekPlan.runAll` | Roughly 15 due creators in the same hour: the rest **silently never run**. | Fan out through the scheduler like cadence and review already do, one action per creator, with jitter across the hour to spread vendor load. |
| 3 | The week plan reads `creators.take(500)`. | `weekPlan.due` | Creator 501 never gets a week plan, silently. | Folded into #1. |
| 4 | **The daily text cap is checked by each sender, then counted at send.** Two jobs in the same hour can both read "0 sent" and both send. | 7+ proactive senders; `messages.send` counts but doesn't refuse | Rare now; routine at scale (scout :05 and cadence :55 are the same hour for many creators). | The cap is enforced **inside** the send mutation, transactionally: one function decides send-or-hold (architecture principle 9). Callers get a named "held: daily cap" result, never a silent drop. |
| 5 | Silence on an idea becomes a negative taste event after 72 h, **including ideas that only ever sat in the app** and were never shown to them. | `taste.events.expireIgnored` | Wrong now: with the app, most ideas are never texted, so her taste model learns "they dislike this" from ideas they never saw. | Only an idea they were **shown** (texted, mentioned, or seen in the app) can be "ignored". Lands with N1's seen/surfaced fields. |

**Tests:** a seeded simulation with 2,000 creators across 24 timezones (convex-test): every hourly job's "who's due" reads only due rows (a count assertion on documents read); a fan-out test (a 60 s fake scout × 40 due creators all complete); a cap race (two senders in one transaction window → exactly the cap sent, the other held with its reason); the taste fix (a never-shown idea expires with no taste event).
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

**Exit, live:** on dev with both personas (TikTok-only and both-platform), three ideas land in a day. The scout text carries "+2 more" with the right count. A reply to an unrelated message mentions them once, in her voice. Swiping them in the app makes her stop mentioning them. The badge matches.

---

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

---

## What "next" means right now

Phase 1 is complete (pending your M1 sign-off and B0 labels). Phase 2 so far: **B4 done, I1 done, B2 built** (live bench results being recorded). **Next, in this order:**
1. **S0**: scale the fleet jobs (findings above; #2 and #4 are real risks at a few dozen creators, not thousands).
2. **N1**: new ideas reach them in Messages.
3. B2 follow-ups from the bench; block `rev` guards (moved from M4).
4. **B3** once `TAVILY_API_KEY` is real (dev currently holds a placeholder).
