# Ideal Onboarding — Locked Plan (2026-06-09)

**North star:** *"Tell Maya about your product. She does the rest."* The web form collects ONLY what Maya needs to start research, then hands off to Maya in Telegram. Channel / capability / warmth decisions are **Maya's job**, gathered conversationally after research — not a form the founder fills out.

## The flow — 3 thin web steps, then Maya

### Web Step 1 — Give Maya your product (~6 fields)
1. Product name
2. Product link — web URL **or** App/Play Store (don't force a web URL on mobile-only)
3. **What does it do, and what makes it different?** ← critical NEW field. Fixes the dogfood "she pitched generic" gap. Pipes into `APP.md`.
4. What counts as a customer? + the URL they land on (attribution)
5. Why did you build it? (grounding + voice)
6. Where are you? — pre-launch vs live/traction (forks strategy)

Optional/collapsed: existing socials (one field, voice extraction) · 60-sec walkthrough video.

### Web Step 2 — Start trial (Stripe) [DECISION PENDING: card-upfront vs no-card]
Recommended: card-upfront, 7-day free, charge day 7, cancel anytime. Rationale: the always-on machine (~$14/mo) + research costs real money per trial; card-upfront recoups + filters + lifts conversion.

### Web Step 3 — Connect Telegram via QR / tap (NO "download Telegram" copy, NO BotFather)
Built on one deep link with a pairing token: `https://t.me/HeyMaya_bot?start=pair_<token>`.
- **Desktop → QR code** (rendered client-side from the deep link). "Scan with your phone." Camera → opens Telegram to @HeyMaya → Start → paired. Page watches the pairing token via Convex subscription → auto-advances.
- **Mobile → tap button** ("Open Telegram") → pairs directly.
- **No Telegram installed** → the `t.me` link's own page offers install. We don't instruct.

### Then — Maya takes over (web onboarding DONE)
"She's researching (~10-15 min), will text you the plan." Conversational in Telegram: synthesis → asks only the capability Qs relevant to the channels she picked → walks them through connecting each bet channel (the connection-night phase) → detects/confirms warmth → "I post tomorrow at 7am."

## Data model — where everything is saved

| Data | Collected | Saved to | Renders into |
|---|---|---|---|
| name/url/type | Web form | gtmApps + gtmAgents (`setAppProfile`) | APP.md |
| **what-it-does + differentiator** *(NEW)* | Web form | gtmApps (new field) | **APP.md** |
| conversion kind + signup URL | Web form | gtmApps | APP.md + attribution wrap |
| founderWhy / entry mode / stage | Web form | gtmApps/gtmAgents | APP.md/GTM.md |
| existing socials (optional) | Web form | gtmAgents | voice profile → USER.md |
| Telegram chat | QR/deep-link pairing | gtmAgents.telegramChatId (`telegramPairing`) | routing |
| trial/plan | Stripe Checkout | gtmPlanJson | planFeaturesGtm gating |
| **capabilities** | **Maya, post-research, Telegram** | gtmAgents via her tools | GTM.md (scoped to chosen channels) |
| **channel warmth** | **Maya** (detect/ask) | channelWarmthJson | ban-safety |
| **channel selection** | **Maya's Telegram synthesis** (not a web screen) | channelStrategy/GTM.md | daily plan |

**Three data-model changes:** (1) ADD `differentiator`/productDescription field (form→setAppProfile→gtmApps→APP.md). (2) REMOVE from form+setAppProfile: capability toggles, warmth, creator budget, visual-posts, UGC, 3 of 4 channel-handle fields. (3) Capabilities+warmth still land in the DB — gathered by Maya post-research via her tools, scoped to chosen channels.

Deletes the web "Research complete / pick channels" screen — channel confirmation moves to Maya's Telegram synthesis (the approval gate).

## Build plan (phased by risk)
- **Phase 0 (quick, safe):** kill the onboarding sign-in button; delete dead fields (UGC / creator budget / visual-posts); **add the differentiator field** end-to-end. + dashboard de-lime (slate accent via `[data-surface="mission"]`).
- **Phase 1:** cut capability toggles + warmth + handle fields; `setAppProfile` args down; channel-judge prompt ASKS for capabilities post-research; Maya's post-research capability/warmth capture.
- **Phase 2 (the big one):** single @HeyMaya bot + QR/deep-link pairing; Convex inbound-router (shared webhook → route to machine via `/hooks/wake`). **This IS the durable bug-1 reply-delivery fix** (Convex gets inbound visibility). One project, three wins: simple Telegram connect + reliable replies + no per-tenant bot tokens.
- **Phase 3 (if card-upfront):** Stripe Checkout before deploy; gate machine spin on trial start.

## Open decisions
1. Card-upfront vs no-card trial? (rec: card-upfront, given COGS)
2. Channel confirmation: kill web screen, do it in Telegram? (rec: yes)
3. Commit to single-bot migration? (rec: yes — it's also the bug-1 durable fix)
