# ClawLaunch / Maya — Roadmap & Parking Lot

Future ideas and deliberately-deferred work. The **sequenced, active** sprints live in
`docs/CLAWLAUNCH_TOP_TIER_BUILD_PLAN.md`. This file is the parking lot: things we've
decided are worth doing *eventually*, each with a **"build when"** trigger so we don't
build them before they earn it.

> Rule: nothing here is a commitment. When an item earns its trigger, it graduates into
> a numbered sprint in the build plan. Keep entries short — enough to resurrect the idea,
> not a spec.

---

## Attribution / proof

### Automatic verified web pixel  *(deferred from Sprint 3.5)*
The hands-off version of conversion proof for web founders.
- **Why deferred:** the client snippet has never run in a real browser (only the server
  endpoint is tested); it's web-only (useless for mobile-app founders); and at pilot scale
  "did anyone sign up?" is a natural question, not friction. MVP = clicks (auto) + self-report.
- **Shape (already designed):** a public per-founder **`pixelKey`** baked into the snippet
  (self-identifying — no click needed) → a **`hello`-on-load ping** stamps "tracker live" →
  a **3-state machine** Maya narrates (not installed → live-unconfirmed → confirmed by one
  test signup) → organic signups recorded as theirs-but-untied. Install line:
  **"hand this to your coding agent (Claude Code / Cursor / Lovable)."**
- **Must include before shipping:** a happy-dom test that actually *executes* the snippet JS
  (localStorage → `window.lcMaya.signup()` → beacon), plus one real-browser live fire.
- **Build when:** a pilot founder's signup volume makes a daily "any signups?" genuinely
  annoying, OR we want "automatically proves organic conversions" as a marketing line.

### Server-side conversion call as a first-class method
For technical founders / mobile apps: their backend pings `record_conversion` on a real
signup. More reliable than the browser pixel (no ad-blockers, works for mobile). The endpoint
already exists (`/lc_gtm/record_conversion`, token-auth) — this is packaging + a copy-paste
`curl`/snippet + skill coaching, not new infra.
- **Build when:** a pilot is mobile-first or explicitly asks for automatic tracking.

### `read_reviews` (DataForSEO Business Data)  *(Sprint 2.1 follow-on)*
Pull Trustpilot / App Store / Play / Google reviews for a named competitor → real objections
appended to `save_foundation_competitor.complaints[]`. G2/Capterra NOT covered — don't promise.
- **Build when:** demand-intel (S2.5) is in use and competitor-complaint angles prove valuable.

---

## Maya's strategic depth  *(sequenced in the build plan; listed here for the big picture)*

- **S4 — Bayesian win/loss math.** Replace hand-weighted conversion scoring with real Beta
  posteriors; let Maya say "not enough data to call this yet — here's how many more I need."
- **S5 — Systematic experiments.** Experiment registry + Thompson-sampling allocator + honest
  confidence re-weight (confidence = computed `pBest`, not vibes).
- **S6 — Hard-truths strategic partner.** Extend honesty from "your post flopped" to
  "your positioning / pricing / PMF is the problem" — grounded, humble, evidence-required,
  PMF/pricing capped at "lean" + always paired with a survey to run.
- **S7 — Real-time intent strike.** Catch a high-intent thread while it's hot and strike fast.
  Spike first: can OpenClaw low-latency-wake one focused turn, or do we need a tighter cron?
- **S8 — Compounding cross-customer brain.** Privacy-safe, outcome-grounded playbooks indexed
  by app archetype ("for a dev tool like yours: HN + founder-story angle converts 3x"). The
  `gtmArchetypeLearnings` table exists; the aggregation job pays off at customer density.

---

## Video  *(deferred — decided NOT now)*
Maya making TikTok-style videos for founders. Generative models garble UI text → slop for SaaS
demos; the reliable path is deterministic slideshow → video (JSON2Video / Shotstack), not a
generative video model.
- **Build when:** the text + attribution core is proven with paying customers and video is the
  clear next done-for-you lever. (Gemini omni / future models may change the reliability math —
  re-evaluate then.)

---

## Platform / product surface

- **Multi-tenant Telegram** (per-founder bot tokens, not the shared test bot) — launch prereq.
- **Multi-project tier** ($149) — one founder running GTM for multiple apps.
- **Server-side / no-code form webhooks** (Tally / Typeform / Framer) as conversion sources.

---

## Explicitly NOT doing (decided against)
- **Multi-agent crew.** Single agent only.
- **Generic CRO tool.** `search_web` reads the landing page; the S6 diagnostician interprets.
- **Mobile attribution SDKs (AppsFlyer / Adjust / Branch).** Overkill for an indie solo builder.
- **ClawGTM-style cold LinkedIn outbound.** Keep Maya organic.
- **Credits-metered pricing.** Flat tiers, capped chat, unlimited proactive.
