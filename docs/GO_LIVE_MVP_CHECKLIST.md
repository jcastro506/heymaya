# HeyMaya — Go-Live MVP Checklist

**Goal:** the smallest set of things that must be *tested and seen working* before we put the GTM product (Maya) in front of paying users at MVP.

**Status legend:** ✅ verified working · 🟡 built, not yet live-verified · 🔴 not built / broken · ⛔ operator-blocked (needs an account/key/decision, not code)

**MVP scope (what "live" means):** a real founder signs up → Maya onboards, researches their product, delivers a grounded plan → they connect ≥1 social account → Maya posts for them on a daily cadence → they can see what's happening and what converted. One $99 tier.

---

## 1. Onboarding & first run (the make-or-break funnel)
- 🟡 Signup → onboarding form captures product URL / handles / goal (web)
- ✅ Agent deploys to Fly on signup (deploy harness; destroys old machine on redeploy)
- ✅ Clean boot — 98 tools load, K2 brain, Telegram webhook live
- ✅ **Grounded hello fires** (beat 1) — specific to their product, not a template
- 🟡 **Foundation research completes** end-to-end (buyer map + competitors + scorecards + angles + threads + drafts + voice) — *was stalling on K2 latency; `:nitro` fix should resolve — RE-VERIFY*
- 🔴 **Synthesis (the plan) reliably DELIVERS to the user** — who's buying, WHERE I'll post (bet channels + why), WHAT kind of posts, and the connect ask. *Composed but didn't deliver on the slow run; deterministic safety-net not yet built.*
- 🟡 **Connect link** sent one-tap in Telegram (bet-channel order), not "go to the dashboard" (`get_connect_links` built, not live-verified)
- 🟡 Operator taps link → OAuth → account ties to THEIR agent (callback)
- Target: hello within ~1–2 min, full plan within ~10 min.

## 2. Agent reliability (it can't burn money or fabricate)
- ✅ **No re-spawn / cost loop** — workers terminate (`subagent_complete` tolerant); measured bounded
- ✅ **Heartbeat quiet** (30m, mostly `HEARTBEAT_OK`)
- ✅ **K2 fast** — `:nitro` throughput routing (Groq, 0.3s vs 18.4s budget provider)
- 🟡 **No fabrication** — grounded-or-silent; no invented threads/numbers (citation firewall)
- 🔴 **Grounds the RIGHT product** — must build the buyer map from the real landing page + `founderWhy`, NEVER hallucinate the product premise. *Observed 2026-06-04: on one run the agent invented a fictional "memory-augmented CLI tool" (described its own OpenClaw runtime) instead of the actual product, despite a correct founderWhy + landing. Confounded by testing with HeyMaya (an AI-agent product), but a hard go-live gate regardless.* Fix: force a landing-page read first, ground the premise there, add "you are not the product; never describe your own runtime."
- 🟡 **Grounded status answers** — "how's it going?" mid-onboarding reports real state, never a fake "quiet week / no clicks" (prompt fixed, RE-VERIFY)
- 🔴 **Deterministic synthesis safety-net** — plan delivers even if the LLM turn flakes (assemble from stored foundation data)
- 🟡 K2 path-guessing quirk (`~/workspace` vs `/data/workspace`) — harmless now, tighten

## 3. Posting — the core value (Track B, per connected channel)
- 🟡 Auto-post **X / LinkedIn / IG / YouTube** actually publishes via Zernio (account connected)
- 🟡 **first-comment link-drop** works on LinkedIn/IG/YT (link out of caption)
- 🟡 **Reddit / TikTok one-tap-confirm** card fires + posts on tap; ban-safety FORCE gate holds
- 🟡 **Spread across the day** (Zernio scheduling / best-time slots) — not 15 posts at 9am
- 🟡 **Cross-tenant isolation** — a founder can only post through THEIR own connected account
- ⛔ X connect needs a payment method on the Zernio account (now added ✅)

## 4. Research quality (the moat)
- ✅ **Depth-parity** — every bet channel has a first-class deep-research tool (not Reddit-only); endpoints live-verified
- ✅ **Competitor ad intelligence** (`competitor_ads`) — verified live
- 🟡 Grounded citations (real URLs/quotes) across all channels, not just Reddit
- 🟡 Bet-gate — a channel can't be a "bet" without real evidence (no inferred bets like the earlier newsletters case)

## 5. Daily cadence (the retention engine)
- 🟡 **Morning brief (7am)** builds a grounded day plan from stored ICP ∩ live-hot; replies-heavy; turn-key items
- 🟡 **Midday pulse (1pm)** adds only genuinely-hot threads
- 🟡 **Evening recap** conditional / skip-when-empty
- ✅ Crons fire deterministically (no self-scheduling); native missed-run handling
- 🟡 No duplicate/fabricated brief (the "14 threads overnight" regression) — RE-VERIFY over a full day

## 6. Attribution & closed loop (proves value)
- 🟡 `wrap_link` → clicks tracked at `/p/...`
- 🟡 Conversion tracking (signups) — pixel/self-report
- 🟡 `get_my_attribution` (post → clicks → signups)
- 🟡 `get_post_timeline` — per-post daily evolution (Zernio add-on; needs connected account)

## 7. Web app — the receipt
- ✅ Mission Control tabs exist (Today / Plan / Research / Drafts / Results / Account)
- 🟡 Research tab renders buyer map + competitors (live-subscribed)
- 🔴 Per-channel "where your buyers are" scorecard view (data exists, not rendered) — S6
- 🟡 Connect-accounts flow usable in the web app too (not just Telegram)
- 🔴 **Landing page**: staging still shows the retired "Tap, paste, post / Google Calendar" section — clean up before public

## 8. Billing & plan gating (can't charge without it)
- 🔴 **Stripe $99 checkout** + subscription lifecycle (trial → active → cancel)
- 🔴 **`planFeaturesGtm` server-side gating** — GTM is currently UNGATED; needs fail-closed entitlement checks before any paid feature
- 🔴 Trial logic + downgrade behavior

## 9. Multi-tenancy & infra (real users, not one test bot)
- 🔴 **Per-user Telegram bot / routing** — today it's ONE shared test bot (Tommy). Real users each need their own bot token or a shared bot with per-user routing (the S8 "multi-tenant Telegram" launch prereq)
- ✅ Cross-tenant data isolation in Convex (mandatory test category) — keep enforced
- 🟡 Founder God-view dashboard (ops visibility) — exists
- 🟡 Telemetry (PostHog, cost ledger, turn telemetry)
- 🟡 Error handling / graceful degradation (no account connected, add-on off, channel disconnected, API failure)

## 10. Operator-blocked prerequisites (not code)
- ⛔ **Production infra**: Convex prod, Clerk prod keys, Fly prod, Stripe products created
- ⛔ **Domain**: `www.hey-maya.ai` prod is on an 11-day-old `main` — promote current code before launch
- ⛔ **Zernio**: account + payment method (✅ added) + any required add-ons (Analytics, Inbox) for the features that need them
- ⛔ **API keys** at production scale: ScrapeCreators tier, twitterapi.io, DataForSEO, OpenRouter spend cap/alerts
- ⛔ Legal: ToS/Privacy, "Maya posts under your name" consent, X/TikTok platform compliance

---

## The honest MVP-blocker shortlist (what actually stops launch)
1. 🔴 **Synthesis reliably delivers the plan** (+ deterministic safety-net) — the #1 onboarding deliverable.
2. 🔴 **Stripe + `planFeaturesGtm` gating** — can't take money without it.
3. 🔴 **Per-user Telegram** — can't onboard real users on one shared test bot.
4. 🟡 **Live posting verified** end-to-end on a connected account (first-comment, one-tap, spread).
5. 🟡 **A full-day cadence run** clean (morning/midday/evening, no fabrication, no loop).
6. 🔴 **Landing page** cleaned of retired messaging.

Everything in §4 (research) and §2 (reliability) is largely ✅ — the gaps are **delivery reliability, billing, multi-tenant onboarding, and a live posting + full-day cadence verification.**

> Maintained alongside `docs/CLAWLAUNCH_API_DEPTH_SPRINT_PLAN.md`. Update statuses as each is live-verified on a connected-account deploy.
