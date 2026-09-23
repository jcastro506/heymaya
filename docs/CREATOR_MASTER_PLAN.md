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

_Updated 2026-09-23._

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

Phase 1 is complete (pending your M1 sign-off and B0 labels). **Next: Phase 2**, in this order:
1. **B4 first** (moved up): the distress case failed the baseline, and nothing ships to creators until crisis language is handled 100%.
2. **B2**, including a fallback so a critic-rejected read never becomes silence.
3. **I1** (Maya's chat control of ideas, plus `rev` guards).
4. **B3** once `TAVILY_API_KEY` is real (dev currently holds a placeholder).
