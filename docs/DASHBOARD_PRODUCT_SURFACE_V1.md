# Dashboard / Product Surface — outsider-advisor redesign

**Status: PLAN (do not build yet).** Written from the POV of an outside advisor who has never seen this codebase — "I run a small business, I hired an AI to do my social media, what do I actually want to open this app and see?" Then mapped to the current 8-tab dashboard, with the specific fixes the operator flagged.

---

## 0. The frame: what job is the dashboard doing?

The product is **the agent in the messenger** (Telegram). The web dashboard is **the receipt + the control room** — it is NOT where the work happens. So the dashboard's only jobs are:

1. **Reassure** — "my agent is alive and doing real work." (The #1 anxiety of paying for an autonomous agent.)
2. **Prove ROI** — "it's actually moving my numbers."
3. **Give control where it matters** — approve posts, connect channels, set guardrails, change the plan.

Everything else is noise. A busy owner opens this for **30 seconds a day**, not to read a reasoning log.

## 1. The five questions a user asks (in priority order)

| # | Question | The screen that answers it |
|---|---|---|
| 1 | **"What did you do for me today / what's going out?"** | **Today** (home) |
| 2 | **"Is it working?"** | **Results** |
| 3 | **"Do I need to do anything?"** | surfaced on **Today** (approvals, connect nudges) |
| 4 | **"What's the plan + what's next?"** | **Plan** |
| 5 | **"What's actually connected + can I trust it to post?"** | **Channels** (+ guardrails) |

Notice what's NOT in the top 5: a raw "Thinking" trace and a separate "Research" tab. More on that in §4.

## 2. Current vs recommended screen set

**Current (8 tabs):** Today · Thinking · Plan · Research · Drafts · Assets · Results · Account.

**Outsider reaction:** that's a *builder's* information architecture (one tab per data table), not an *owner's*. Eight tabs for a 30-second daily check is too many, and four of them (Thinking, Research, Drafts, Assets) are behind-the-scenes surfaces a normal user won't distinguish.

**Recommended (5 primary + 1 settings):**

| Tab | Absorbs | Why |
|---|---|---|
| **Today** | Today + the "what I'm doing now" slice of Thinking | The home. At-a-glance: posted, queued, needs-you, found. |
| **Content** | Drafts + Assets + published posts | One place for "the stuff she made" — approve / edit / see what shipped. A business owner thinks "my posts," not "drafts" vs "assets." |
| **Plan** | Plan (calendar) + the channel strategy | "What's scheduled + the strategy behind it." |
| **Results** | Results | The ROI screen. Make this *strong* — it's the retention driver. |
| **Channels** | the connect surface (today buried in Account) + tier gating + auto-post guardrails | Connecting accounts is a first-class job, not an Account-page afterthought. |
| **Settings** | Account (plan, billing, voice, logout, delete) | The boring-but-necessary drawer. |

**Thinking + Research → demoted from primary nav.** Fold the *useful* part (a plain-language "here's what I did and why" timeline) into **Today**, and keep the deep tool-call trace as an **"Activity log" link inside Today** for the curious / for trust — not a top-level tab. (See §4.)

## 3. Screen-by-screen content spec

### Today (home) — the 30-second check
- **One-line status banner:** "Maya posted 2, queued 3, and found 4 buyer conversations today." (Her plain-language summary, grounded.)
- **Needs you** (only if non-empty): posts awaiting approval, a channel to connect, a question she asked. Zero-state = "Nothing needs you — she's running."
- **Today's posts:** published (with the live engagement) + scheduled-for-today, each with the channel + a thumbnail.
- **What she's working on now:** 1–3 plain lines from her live activity (the *readable* slice of the trace), e.g. "Researching r/SaaS for people complaining about marketing." NOT a tool-call dump.
- **This week so far:** tiny sparkline of reach / clicks / signups.

### Content — "the stuff she made"
- **Needs approval** queue (drafts on manual channels / pre-trust): big approve / edit / skip buttons.
- **Published** feed: what shipped, per channel, with performance.
- **Assets** (images / video / slideshows) as a filterable sub-view, not a separate tab.
- Inline edit + "post now / schedule / send to Telegram for one-tap."

### Plan — "what's scheduled + the strategy"
- **Calendar/agenda** of upcoming posts + recurring cadence.
- **The strategy, in one card:** which channels she's betting on + why (one line each), refreshed from her research. This is where the **channel-activation truth** lives (see §4.1).

### Results — the retention screen (invest here)
- **The North-Star number** big at top (signups / installs / waitlist — whatever they chose), with the trend.
- **What's driving it:** attribution — which posts/channels actually drove clicks → signups (the closed-loop moat). "This Reddit reply drove 12 signups."
- Reach / engagement / follower growth per channel, secondary.
- **Honest about thin data:** early on, "Maya's still gathering signal — here's what she's learned so far," never an empty chart.

### Channels — connections + tier + guardrails (§4.1 + §4.2)
- Per-channel: connected? healthy? **active or paused?** auto-post or approve-first?
- Connect / reconnect / disconnect.
- The **tier-active gating** + upgrade nudge (§4.1).
- The **auto-post guardrail** controls (§4.2).

### Settings — plan, billing, voice, danger zone, logout.

## 3.5 Planned vs reactive — surfacing the "outside the plan" work

There are **two kinds of work** Maya does, and a builder's dashboard tends to only show the first:

1. **Planned** — scheduled posts from the strategy/calendar. Predictable. Lives on **Plan**.
2. **Reactive / opportunistic** — the discovery pulse surfaces a live buyer-intent thread, an unanswered question, a competitor mention, a 5×-velocity comment — and Maya *decides* to engage (reply, comment, drop a helpful answer + soft mention). **This is NOT on any calendar.** It's the most human, highest-value thing she does — and the highest trust-stakes (she's speaking *as the brand*, in public, to a stranger, unprompted).

**Outsider verdict:** this reactive stream deserves **first-class visibility and control**, not a buried log. A real social manager's daily report isn't just "here's what I posted" — it's "here's the conversations I jumped into and why." If the dashboard hides the reactive work, the user can't trust it; if it shows it well, it's the product's best demo.

### How to handle it — a distinct stream: "Conversations" (or "Engagement")

Separate it from **Content** on purpose: Content = *original posts she makes*; Conversations = *replies to other people's threads/comments she opportunistically joins*. Different activity, different trust model, different review flow. The Conversations surface shows each opportunity as a card:

- **The thread she found** — the actual post/comment, the channel, the author, the velocity (e.g. "r/SaaS · 40 upvotes/hr").
- **Why she chose it** — the grounded reason: *"This person is asking exactly what your product solves"* / *"competitor mentioned, you can offer a better answer."* This is what makes it feel intelligent, not spammy — and it's the trust anchor.
- **Her reply** — drafted → pending → sent, with the same **auto-vs-approve guardrail** as posts: Reddit/TikTok always approve-first; X/LinkedIn/IG auto *after* earned trust. So pending reactive replies land in the **same approval queue** as planned drafts (one place to say yes/no), and sent ones show in the feed with the outcome (the conversation, any reply she got, clicks driven).
- **One-tap controls** — Approve / Edit / Skip, and "don't engage threads like this" (a feedback signal that tunes her ICP filter).

### Where it lives in the IA

- **Today** gets a one-liner: *"Maya joined 3 conversations and queued 2 replies for you."* — so the reactive work is visible at the 30-second glance.
- **Conversations** is its own surface (or, if we're keeping tabs minimal, a prominent sub-view of Content) — the full feed of found-threads → replies, filterable by pending/sent/channel.
- The **approval queue is unified** — planned drafts + reactive replies in one "Needs you" list, each tagged *post* vs *reply* so the user isn't approving in two places.

### The control the user needs (ties to the auto-post toggle, §4.2)

The reactive work needs its OWN guardrail dial, because "auto-post my planned content" and "auto-reply to strangers in public" are different risk levels:
- A setting: **"How should Maya engage in conversations? ▸ Ask me before every reply ▸ Auto-reply on safe channels (I can pause)."** Default to **ask-first** for engagement even if planned posts are on auto — replying to a stranger as the brand is higher-stakes than posting your own content.
- Per-channel still applies (Reddit/TikTok approve-only).

**Net:** the reactive stream is the product's heartbeat. Show it as **Conversations** (found-thread + why + reply + outcome), unify its approvals with planned content, and give it its own ask-first-by-default engagement guardrail. That turns "she's doing stuff I can't see" (scary) into "she found my exact buyer and asked me before replying" (the wow).

## 4. The three specific fixes the operator flagged

### 4.1 Channel-tier gating — "what stops a 3-channel user from connecting + running all 6?"

**The good news (already true in code):** `selectActiveChannels` (`convex/gtmMaya/channelSelection.ts`) **already trims the active set to `maxActiveChannels`** (Starter 3 / Growth 6 / Studio 6) server-side — the cap *beats* the channel decision. So even if a Starter user connects all 6, **Maya only actively runs her top-3-fit.** The enforcement exists; the **dashboard just never tells the user.**

**The design (connect freely, activate by tier):** keep the existing two-knob model from `planFeaturesGtm` — `connectedChannelCap` (how many you may *link*) vs `maxActiveChannels` (how many Maya *runs*). Then the Channels screen makes it legible:
- Let them **connect up to the connected cap** (linking is harmless + low-friction).
- Show a clear split: **"Active (3 of 3): X, LinkedIn, Reddit"** (Maya-managed) vs **"Connected · paused: Instagram, YouTube — upgrade to activate."**
- **Which 3 + why:** default to Maya's research-ranked best-fit, let the user **swap** which channels occupy the active slots (their call), and show the one-line reason per channel ("Reddit — your buyers are asking about this problem there weekly").
- **Upgrade nudge** lives exactly here, contextual: "Want Maya on all 6? Growth runs 6 channels." Only when they're actually at the cap.

**Why limit at all (the honest answer for the doc):** every active channel is real COGS (per-channel Zernio fee + posting/monitoring spend) and the tier ladder is breadth (focus on 3 vs full presence on 6). So the cap is both a margin guard and the value ladder — not an arbitrary gate.

### 4.2 Auto-post on/off — make the control explicit

**What exists:** a graduated-trust model (`_PostingControl.tsx`) — "you approve the first few; after you've okayed 3 (or a week passes), I post the auto channels myself," plus per-channel auto (X/LI/IG/YT) vs always-manual (Reddit/TikTok). Good instinct, but it's **implicit and buried in Account.**

**The fix:** make it an **explicit, owner-facing control** in two places:
1. **Onboarding** (one toggle, plain): *"How should Maya post? ▸ Ask me first (I approve every post) ▸ Auto-post (she posts, I can pause anytime)."* Default to **ask-me-first** (trust is earned). This is the toggle the operator wants to confirm — spec it as a real, persisted field surfaced at onboarding + Settings.
2. **Channels screen:** per-channel auto/approve switch + the global default, with the graduated-trust explainer as the *why* ("she earns auto after you approve a few"). Reddit/TikTok stay approve-only and say so.

The principle: **the user always knows whether Maya can post without them, and can flip it instantly.** Never a silent auto-post.

### 4.3 Research vs Thinking look alike → consolidate the transparency surface

**Outsider take:** a normal owner does not want *two* behind-the-scenes tabs, and a raw decision-trace ("Thinking") is a **builder/debug artifact**, not a product surface. Two fixes:
1. **Kill the separate Research + Thinking tabs from primary nav.** Their value (proof she's working) belongs as the **"What she's doing now"** strip on Today + an **"Activity log"** link for the curious.
2. **Reframe the deep view as trust, not debug:** if kept, it should read like a manager's status update ("Spent the morning finding where your buyers complain about X; drafted 3 replies"), with the raw tool-trace one click deeper for anyone who wants receipts. Research findings (buyer map, competitors) surface as **the strategy card on Plan**, not their own tab.

## 5. Build phasing (when we build it)

1. **Phase 1 — IA + Today.** Collapse 8 → 6 tabs; build the new **Today** home (status banner, needs-you, today's posts, what-she's-doing strip). Biggest perceived-quality jump for least work.
2. **Phase 2 — Channels screen.** Pull connect out of Account; build the active/paused tier-gating UI (§4.1) + the explicit auto-post control (§4.2).
3. **Phase 3 — Content.** Merge Drafts + Assets + published into one approve/see-what-shipped surface.
4. **Phase 4 — Results.** Make the ROI/attribution screen strong (retention driver).
5. **Phase 5 — Plan + transparency.** Calendar + strategy card; fold Research/Thinking into Today's activity strip + an Activity log.

**Net:** fewer tabs, owner-language not table-names, the two screens that matter (Today + Results) made excellent, and the three flagged gaps (channel gating, auto-post, thinking/research overlap) closed as explicit, legible controls.
