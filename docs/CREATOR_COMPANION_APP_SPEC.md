# Maya companion app — spec and sprint plan

**Status:** direction decided by the operator (2026-09-23); ready for M0
**Supersedes:** `CREATOR_MOBILE_WEB_ONBOARDING_SPRINT.md` §1 (no native app), §6 (web Mission Control), and the native items in §9. Everything else in that doc — the onboarding state machine, Zernio connection contract, inspiration funnel, goal conversation, memory continuity, tone rules, scorecard — carries over unchanged. Only the shell it runs in changes.
**Platforms:** iOS first, Android from the same codebase once iOS holds. US only at launch.
**Built from:** a read of the `creator` branch at `3519c9b` — every agent tool, skill, cron, vendor endpoint, UI query and mutation, and the five-step web onboarding. Appendix A is that inventory. When code changes, the appendix is updated in the same PR, and a test enforces it (§15.4).

---

## 1. The decision, and the line that doesn't move

Maya gets a native App Store app. The web Mission Control (`/app/*`) and the web onboarding (`/start`) are retired.

**You still only talk to Maya in Messages.** The app has no chat box. It is where her work *lives*: every idea, plan, number, account she watches, and thing she knows about you. Messages is where she *speaks*. When a user wants to say something to her about an object in the app, the app hands them to Messages, already pointed at that object (§7.4).

This follows the Muse pattern (Meta, launched 2026-09-08): a persona you employ, with an app as her home. We differ on one point on purpose: Muse's app is chat-first, and ours is not, because Maya's voice arriving as a text from a person is the product.

Two rules keep the app from turning Maya into a tool:

1. **Nothing in the app requires the app.** Every control has an equivalent in chat (§8). A creator who never opens the app still gets all of Maya.
2. **The app never speaks in Maya's voice.** No push notifications that read like her. She texts; the app shows. (§10.3)

## 2. What "retire the web" means

| Surface | Fate |
|---|---|
| `/app/today`, `/ideas`, `/lane`, `/results`, `/plan`, `/settings` | **Retired.** Replaced by app screens. The paths stay live as universal-link targets. |
| `/start`, `/onboarding/*`, `/sign-in`, `/sign-up`, `/telegram`, `/onboarding-preview`, `/mission-control-preview` | **Retired.** Onboarding moves into the app (§5). |
| `/app/*` and new `/o/*` URLs | **Kept as universal links.** App installed → opens the exact object. Not installed, or tapped on a Mac or iPad where iMessage syncs → a one-screen "Open in the Maya app" page with the App Store badge and a plain-text summary of the object. That fallback page is the one piece of product UI the web keeps. |
| Landing `/`, `/privacy`, `/terms` | **Kept.** App Store review requires the privacy and terms URLs. The landing CTA becomes the App Store link. |
| `/join` (QR target) | **Kept, repointed.** Records attribution, then redirects to the App Store (§5.4). |
| `/api/google-calendar/*`, `/api/gmail/*` OAuth callbacks | **Kept or moved** to Convex HTTP actions. They are server endpoints, not UI. They finish by redirecting into the app by universal link. |
| `/api/account/delete`, `/api/account/export` | **Moved** into Convex actions called from the app (Apple requires deletion *in* the app). |
| Stripe webhook, `/api/health` | **Kept.** |
| `/ops` | **Kept.** Operator-only, not product. |
| `/.well-known/apple-app-site-association` | **New.** |

The old code is removed in M7, after the app is approved and the cohort is through. It isn't removed before, because it is the fallback while the app is in review.

## 3. React Native or native? → **Expo (React Native), with Swift for the extension targets**

Recommendation: **one Expo app for iOS and Android. The share extension, widgets, and (maybe) App Clip are written in Swift as extension targets inside it.** Not two native apps, and not Flutter.

Why:

| Factor | Expo / RN | Swift + Kotlin |
|---|---|---|
| **Types end to end** | The Convex `api` types, `billing/tiers.ts`, and the envelope shape are imported directly. A renamed field fails the app's typecheck in CI. | Hand-written models in two more languages, and drift between them. Convex's Swift and Kotlin clients exist but are younger. |
| **Reactivity** | `useQuery` from `convex/react` works unchanged. Every screen is live over the rows Maya writes, exactly like the web today. | Rebuilt twice. |
| **Shipping speed** | **EAS Update** ships JS/UI fixes over the air in minutes, without a review cycle (allowed for bug fixes and non-material changes). The product changes weekly, and review cycles would throttle it. | Every change is a review cycle, per platform. |
| **Who builds it** | One codebase, in the language the whole repo, its tests, and its tooling already use. | Three codebases for a solo founder. |
| **Android** | The same app. The marginal cost is testing plus Android extension targets. | A second app. |
| **Feel** | With the New Architecture, Reanimated 3, Gesture Handler, native stack navigation, `expo-image`, and FlashList, lists, gestures, and transitions run on the UI thread at 60/120 fps. The gap to native is real only in platform surfaces (widgets, share sheet, App Clip), and those are Swift here anyway. | Best possible, at 3× the cost. |

What would change this answer: if the app became mostly platform surfaces (widgets, Live Activities, App Intents) rather than screens. It won't. The core of the app is lists, detail screens, and forms over live data, which is RN's strongest ground.

**Stack:**
- Expo (latest SDK, New Architecture), `expo-router` (typed routes, native stacks), TypeScript strict
- Monorepo: `apps/mobile/`, sharing `convex/` with the web; npm workspaces
- `convex/react` client, **Clerk Expo** (native Sign in with Apple + Google + email code)
- Styling: **NativeWind** over our own component kit (§12). No third-party UI kit, since generic kits are how apps end up looking generic
- Motion: Reanimated 3 + Gesture Handler; `expo-haptics`
- Lists: FlashList; images: `expo-image` with blurhash placeholders for evidence thumbnails
- OAuth: `expo-web-browser.openAuthSessionAsync` (ASWebAuthenticationSession). Google blocks embedded webviews, so this is mandatory
- Push: `expo-notifications` (APNs/FCM); builds: **EAS Build**; OTA: **EAS Update** with channels `staging` / `production`
- Extensions: `@bacons/apple-targets` (or equivalent config plugin) for the Swift share extension, WidgetKit widgets, and App Clip
- Errors and performance: Sentry for React Native, with source maps uploaded by EAS

## 4. Login and session

| Case | Behaviour |
|---|---|
| New user | Sign in with Apple (default, top), Google, or email code. No passwords. |
| Returning user, new device | Same sign-in. The server resolves the existing creator from the Clerk identity (`me()` in `convex/ui.ts`, unchanged). Duplicate identities (Apple on one device, Google on another, same email) are resolved by Clerk account linking, never by creating a second Maya. |
| Web-era users (the pilot) | Sign in with the same Clerk identity. Their creator row, ideas, and history appear. There is nothing to migrate: the data was always in Convex. |
| Session expiry | Clerk refreshes silently. A hard expiry lands on sign-in, and after sign-in the app returns to the exact object the user was opening (a deep link survives login, as the old §6 already required). |
| Sign out | Available in You. It clears the local cache, App Group token, and widget data, and unregisters the push token. Signing out is never deletion. |
| Delete account | In You → confirm by typing DELETE → runs the existing nine-step deletion procedure (§16.5, `account/deletion.ts`) as a Convex action. It is never triggered from a text alone (already the chat rule in `agent/commands.ts`). |
| Extensions | Share extension and widget use a short-lived, creator-scoped token written by the app into the App Group keychain. They never see the Clerk session and never carry a tenant id. |

## 5. Onboarding, mapped to the app

### 5.1 Screen map: web step → app screen

The web flow is `/start?step=1..5` plus `/telegram` for pairing. The app keeps the order and the server functions, and changes the container, the sign-in, and one step.

| # | App screen | Was (web) | Server functions (existing unless 🆕) | What changes |
|---|---|---|---|---|
| 0 | **Welcome** — Maya's face, one line, **Continue with Apple** | landing + `/sign-up` | Clerk; `onboarding.start.ensureCreator` | Sign-in is the first screen. There is no landing inside the app. |
| 1 | **Plan** — three tiers from `billing/tiers.ts`, 7 days free | step 1 | `billing.checkout.createCheckout` → Stripe hosted Checkout in an auth session; webhook provisions tier | The checkout opens in an in-app browser sheet and returns via universal link to step 2. Apple Pay works there. |
| 2 | **Connect your work** — Instagram / TikTok cards | step 2 | `connections.zernio.startConnect` → auth session → `reconcile` | The return is a universal link, not `?connect=back`. The first read starts on the first confirmed account (unchanged). |
| 3 | **Here's what I see** — the creator picture to confirm or correct | *(was folded into Messages)* | `onboarding.start.describe`, dossier from `onboarding.ingest.writeDossier`; corrections → `act("record.correct")` 🆕 | **New as a screen**, per the old spec §3 "show evidence early". A "still reading" state appears if the read isn't done. It never blocks: the user can skip and Maya picks it up in Messages. |
| 4 | **Worth watching** — suggestion cards, add your own | step 3 | `onboarding.admired.suggest` / `validate` / `add` | Native cards with evidence thumbnails and haptic select. |
| 5 | **Your real week** — Google Calendar, optional | step 4 | `/api/google-calendar/start` → callback → `calendar.oauth.selectCalendars` | Auth session plus calendar picker. Skipping is first class. |
| 6 | **Meet Maya** — "Text her START" | step 5 + `/telegram` | `onboarding.start.setPhone`, `core.pairing.createPairingLink` (iMessage kind) | One button opens Messages with START prefilled to her number. The screen flips to **Connected** live from the pairing row, the same as the web. Telegram does not appear. |
| 7 | **You're in** — what's connected, what she's doing now, "watch for her text" | *(done state)* | `onboarding.start.progress` | Then lands on Today. The first thing in Messages is her (unchanged). |

**Resumability is server-owned** (`onboarding.start.progress`, unchanged). Kill the app at any step, reinstall, or sign in on another phone, and it resumes at the right screen. Permissions (notifications) are asked **after** screen 7, at the first moment one matters (§10.3), never up front.

### 5.2 Onboarding acceptance (M3)

- Every screen works at iPhone SE (375 pt) through Pro Max, and at the largest accessibility text size without clipping the primary action.
- Cancelling any auth session (Stripe, Zernio, Google) returns to the same screen with a useful state, never a dead end.
- Checkout replay or double return cannot provision twice (existing webhook idempotency, re-proven through the app).
- Kill the app between every pair of screens → it resumes correctly. Scripted in Maestro (§14).
- Reinstall mid-onboarding → resumes from server state.
- No Telegram, YouTube, Apple Calendar, or vendor names in any copy (content inventory test).

### 5.3 App Clip (spike in M3, not committed)
A QR code can open an App Clip without a full install. The Clip could do screens 0–2 and then ask for the install. It would lift event conversion and make attribution deterministic, but it's a separate target with a size cap. The decision comes from the spike, not in advance.

### 5.4 Attribution across the App Store gap
Query parameters don't survive an install, and since ATT there is no clean deterministic per-user match. Three layers:
1. **Per campaign, free:** `/join` redirects to an App Store link with Apple's campaign token (`ct=<campaign>`). App Store Connect reports installs and proceeds per campaign. That answers "which QR code works".
2. **Per user, when they self-identify:** `/join` offers "text me the link", which captures a phone number. The phone verified at screen 6 matches it deterministically.
3. **Per user, generally:** the App Clip invocation URL (deterministic), or a vendor (Branch/AppsFlyer, probabilistic) as the fallback.

The loss is measured in the M3 exit, not guessed.

## 6. Information architecture

Five tabs. They consolidate the six web tabs and the six views in the old §6.

```
Today · Ideas · Week · Watching · You
```

### 6.1 Today — "is she working, and what needs me"

| Block | Data (source) | Actions |
|---|---|---|
| Status line | `ui.today.statusLine` (from `core.status`, hourly) | — |
| **Needs you** — open decisions: proposed blocks, partnership drafts, a broken connection | `calendarBlocks.status=proposed`, `partnershipDrafts`, `connections.status≠connected` | approve / decline inline; fix connection |
| What she sent today — her texts as cards, each linking to its object | `messages` (out, 24 h) | tap → object; "Reply in Messages" |
| Next filming block | `calendarBlocks` | → Week |
| Your recent posts with multiples and "as of" | `ownPosts` | → post detail |

### 6.2 Ideas — the swipe file

Filters: **New · Saved · Planned · Posted · Passed**.

**Idea detail** (the most important screen in the app):
- Her pitch (`ideas.messageText`); the version (hook, on-screen text, length, sound); why it fits (`fitWhy`); "not your usual" when `newForYou`
- **Evidence**: source posts rendered as cards with thumbnail, account, views, and multiple. Not bare URLs. Tapping one opens TikTok or Instagram.
- Shot list, once generated; the linked block if planned; the linked post and its numbers if posted

Actions: **Save · Heart · Not for me** (optional reason chips) **· Plan it · I posted it** (optionally paste the link) **· Add a note · Ask Maya**. Generating a shot list is a *request* to Maya that goes through the server budget gate, exactly like the chat path.

### 6.3 Week — forward and backward

Segmented: **Coming up | Last week**.
- **Coming up** = `ui.plan`: her blocks plus the calendar events she means to use, by day, with best posting hours. Actions: confirm, move (native picker), drop, add, mark filmed or missed. A block opens its idea.
- **Last week** = `ui.results`: the rung in plain words, posts with multiples and engagement, her track record, experiments, and the Sunday review text. Read-only, plus "Ask Maya about this week".

### 6.4 Watching — who she watches and what moved

= `ui.lane` plus suggestions: accounts (handle, platform, last look, normal baseline, last breakout, **why** it's watched: added by you, suggested by her, from your share), "Rising in your lane" with evidence cards, suggestions, and lane keywords. Actions: add (validated search), stop, pause, dismiss a suggestion, edit keywords.

### 6.5 You — what she knows, and the account

- **What Maya knows**: persona summary, what works and what doesn't (dossier), `personalRecords` by goal, preference, decision, commitment, and style, each with its source ("you said this on Sep 3"). Actions: **correct, forget, add**.
- **Your taste**: taste note and top affinities. Read-only, since it's computed from behaviour.
- **House rules**: directives, verbatim. Add or revoke.
- **How she texts you**: her number, quiet hours, tone, timezone.
- **Connected**: Instagram and TikTok (Zernio), Google Calendar with calendar selection, partnership mailbox.
- **Partnerships** (tier-gated): opportunities, fit, drafts to approve or edit, follow-ups.
- **Plan and billing** (Stripe portal in an auth session), **Export my data**, **Sign out**, **Delete my account**.

### 6.6 Global

- Every object has a stable route: `/o/idea/<id>`, `/o/block/<id>`, `/o/post/<id>`, `/o/account/<id>`, `/o/record/<id>`, `/o/partnership/<id>`, `/o/week`, `/o/review/<isoWeek>`.
- Deleted or superseded objects render "this changed" with a link to the replacement. Never a blank screen or a 404.
- Every number shows `metricsAsOf`. Every screen has a designed day-one empty state.
- Legacy `/app/<tab>` links in old messages map to the matching tab.

## 7. How Maya updates the app, and how she learns what the user did

### 7.1 Maya → app
Mostly she already does, because the app reads rows and Maya writes rows. Convex pushes every change to every open screen. What's new:
1. **Object-level links.** `mission_control_link({tab})` (`agent/missionControl.ts`) becomes `app_link({object:{kind,id} | tab, why})` and emits `https://hey-maya.ai/o/<kind>/<id>`. The URL carries no tenant id. The Clerk session resolves the creator, and another creator's id resolves to not-found.
2. **Revisions.** `ideas`, `calendarBlocks`, `trackedAccounts`, `personalRecords`, and `partnershipDrafts` gain `rev`, bumped by every write from any source. App writes send `expectedRev`. A stale write returns `{ok:false, reason:"changed", current}`, and the app re-renders the current object instead of clobbering her newer write. Generated work checks `rev` before delivery.
3. **"Needs you" is derived from row state**, so it can't drift.

### 7.2 App → Maya: one write path per action, `act()`
Today, a web change leaves Maya the **new state** but never tells her **that it changed or who changed it**. Every user-initiated change — from the app, chat tools, the share extension, or a widget — goes through one function per action kind:

```ts
act(ctx, creator, {
  kind: "idea.pass",                     // stable id, the ledger's vocabulary
  object: { table: "ideas", id },
  source: "app" | "chat" | "share_ext" | "widget",
  input: { reason?: "not_my_style" | ... },
  expectedRev?: number,
}) -> { ok, data, next, why }            // principle 8's envelope
```

It does four things in one transaction: it validates ownership and `rev`; applies the change (reusing the existing internal mutations); records the **taste event** with the same weight whatever the source; and writes one **`userActions`** row `{creatorId, kind, object, source, before, after, at, seenByAgentAt?}`. App mutations and chat tools both become thin callers of the same kinds. That's one new table, and the only one the app adds.

### 7.3 Three levels of awareness
Each kind has exactly one level, in one table (`agent/awareness.ts`):

| Level | What happens | Examples |
|---|---|---|
| **State** | Nothing extra. She sees the rows next time she looks. | quiet hours, tone, tz, calendar selection, heart, save |
| **Noticed** | Unseen actions go into her prefix as `# Since you last spoke, in the app`, collapsed ("passed 4 ideas, 3 talking-head"), then marked `seenByAgentAt` once that turn is delivered. She mentions them only when it changes her answer. | pass, move or drop block, add or stop watching, posted it, correct or forget, rules, notes, keywords |
| **Reacted** | Also enqueues `consider_reaction`. **The model decides** whether to text. **The code decides** whether she may: quiet hours, cadence rails, the outbound:inbound ratio rail, and a 30-minute debounce so a burst of taps is one consideration. | share-extension send, Ask Maya, new goal, week cleared, ≥3 passes on one format in a day, connection lost |

**Maya does not text in response to taps.** She texts when a tap changes what she'd do next, and the rails allow it. `source` and `before`/`after` mean she says "you moved it to 6:30", not "it's at 6:30 now", and she never claims or apologises for a change the user made.

### 7.4 Ask Maya — the handoff to Messages
Every object screen has **Ask Maya**. Tapping it calls `act({kind:"ask", object})`, which is Reacted with a 10-minute window. It then opens Messages to her number with a prefilled draft via `sms:<number>&body=…`. Her next turn's prefix carries "they tapped Ask Maya on idea X 40 s ago", so "this" resolves without a code in the message. If they don't send within 10 minutes, it expires silently. She never follows up an abandoned tap.

## 8. CRUD inventory

✅ exists · 🆕 new · ⚠️ exists with a gap (§9)

| Object | Action | App | Chat equivalent | Taste event | Awareness |
|---|---|---|---|---|---|
| Idea | save / unsave | 🆕 | "save that" ✅ | `save` | State |
| Idea | heart | 🆕 | tapback ✅ | `heart` | State |
| Idea | not for me (+reason) | ⚠️ `ui.passIdea` | ✅ | `notme` | Noticed; pattern → Reacted |
| Idea | I posted it (+link) | ✅ `taste.events.markPosted` | ✅ | `posted` | Noticed |
| Idea | plan it | 🆕 | `block_add` ✅ | `blocked` | Noticed |
| Idea | add a note | 🆕 | "remember…" ✅ | — | Noticed |
| Idea | shot list | 🆕 (request) | ✅ | `shotlist` | Reacted |
| Block | confirm / move / drop | ⚠️ `ui.blockControl` | `block_move` / `block_drop` ✅ | — | Noticed |
| Block | add | 🆕 | `block_add` ✅ | — | Noticed |
| Block | filmed / missed | 🆕 | ✅ | — | Noticed |
| Week | clear / replan | 🆕 | `week_replan` ✅ | — | Reacted |
| Watched account | add / stop / pause | ⚠️ `admired.add` / `remove` | ✅ | `account:@x` | Noticed |
| Suggestion | dismiss | 🆕 | 🆕 add | — | State |
| Lane keywords, growth plan | edit | 🆕 | `growth_plan` ✅ | — | Noticed |
| Memory record | correct | ⚠️ `ui.correct` | ✅ | — | Noticed |
| Memory record | forget | 🆕 in UI | "forget that" ✅ | — | Noticed |
| Memory record | add goal / preference | 🆕 | ✅ | — | goal → Reacted |
| House rule | add / revoke | ⚠️ `ui.revokeRule` | ✅ | — | Noticed |
| Settings | quiet hours, tone, tz, niche | ⚠️ `ui.updateSettings` | ✅ | — | State |
| Connection | connect / disconnect / reconnect | ✅ | link only | — | lost → Reacted |
| Calendar | select calendars | ✅ | — | — | State |
| Partnership draft | approve / edit / decline | 🆕 in UI | `partnership_update` ✅ | — | Noticed |
| Share item | send a post (+note) | 🆕 | paste a link ✅ | `source:share` | Reacted |
| Account | export / sign out / delete | ⚠️ web routes | delete never by text | — | — |

Every 🆕 app action without a chat equivalent gets one, or a written exemption. A test enforces this (§15.4).

## 9. Gaps in current code (fixed in M4 whether or not the app ships)

1. **The web "not for me" teaches nothing.** `ui.passIdea` patches `status:"passed"` with no taste event, while the chat path records `notme`. The same act trains the taste model differently depending on the surface.
2. **"Stop watching" teaches nothing.** `admired.remove` patches `status:"removed"` with no event.
3. **No UI change is attributed.** `updateSettings`, `revokeRule`, `blockControl`, and `admired.*` record no actor or source. Maya sees the state but not the change.
4. **Links are tab-level.** `missionControlUrl(appUrl, tab)` can't target an object.
5. **No concurrency guard.** A user's stale move overwrites a block Maya just moved.

## 10. Native-only surfaces

### 10.1 Share extension — "Send to Maya"
The best reason to go native: creators live in TikTok and Instagram, and the share sheet is where inspiration happens. It accepts a TikTok or Instagram URL plus an optional one-line note. The server resolves it (`post_info` through the budget gate), files a swipe `memories` row plus an idea seed if the note asks, and offers "watch @author?" in the extension. **Reacted**: Maya texts her read, within the rails. Signed out, it queues until the app next authenticates. It never attributes to the wrong account.

### 10.2 Widgets
Small: next filming block with its hook. Medium: today's best idea plus "Needs you" count. Read-only, refreshed by silent push. A tap deep-links to the object.

### 10.3 Push policy
**Never** Maya's content. She texts, and a push repeating it is a double notification. **Only** system state Messages shouldn't carry: a connection broke, payment failed, export ready. Silent pushes refresh widgets. Badge = "Needs you" count. Permission is requested the first time one of those matters, with a one-line reason, never on first launch.

## 11. Billing

**Recommendation: keep Stripe, link out to hosted Checkout from the app. US only.**
- Since May 2025, US apps may link to external purchase with no entitlement and, for now, **0% commission**. The Ninth Circuit (Dec 2025) held Apple may charge *some* commission on link-outs, and the district court is still setting it. Budget for a nonzero fee arriving in 2027.
- This reuses `billing/tiers.ts`, the Stripe prices, the webhook, and the portal. Apple Pay works in the auth-session browser.
- **Fallback, not built:** StoreKit via RevenueCat at the 15% Small Business rate, mapped to the same tiers. Build it if the link-out commission makes IAP competitive, or before launching outside the US.

## 12. How we get a beautiful, seamless app

"Beautiful" doesn't come from taste at the end. It comes from a design system decided first, design review built into every sprint, and budgets that fail CI.

### 12.1 Design principles (the review rubric)
1. **Her work, not a dashboard.** Screens read like Maya's notes to you, with a named author, a reason, and evidence. No tables of metrics, no chart walls.
2. **One primary action per screen**, in the thumb zone. Secondary actions go in a sheet.
3. **Evidence is visual.** A source post is a thumbnail card with its number, never a URL.
4. **Instant, then true.** Every write is optimistic with haptic confirmation. On `{ok:false}` it rolls back with a plain-language reason. Nothing spins while the user waits for their own tap.
5. **Honest states.** Loading uses skeletons shaped like the content. "As of" appears on every number. Every empty state tells a day-one user what will appear and when.
6. **Calm.** No badges except "Needs you", no red except real failure, no confetti. She's a professional.
7. **Plain language** (standing rule). No vendor names, no "AI" in product copy, no plumbing.

### 12.2 Design system, built before screens (M1)
- **Tokens** in one file shared by NativeWind and the Swift extensions: colour (dark by default, light supported, both AA-contrast validated), type scale mapped to Dynamic Type, spacing on a 4-pt grid, radii, elevation, motion durations and springs.
- **Typography:** one characterful display face for Maya's voice and headings, and SF Pro for UI text and numbers (tabular figures).
- **Maya's presence:** her avatar and the flower mark appear wherever she is the author (idea cards, the review, "what she sent"). This is the Muse lesson: the persona is visible, not implied.
- **Component kit** (in-house): Screen, Header, Card (idea, evidence, post, account, block, record), Chip, Segmented, Sheet, ActionBar, EmptyState, Skeleton, Toast, NumberWithAsOf, DeepLinkError. Every component has light, dark, largest Dynamic Type, reduced-motion, and VoiceOver states.
- **Motion:** shared-element transitions from card to detail, spring sheet presentations, 200–300 ms, all disabled or reduced under Reduce Motion.
- **Haptics:** light on select, success on commit, warning on rollback. Nothing else.
- **Gallery screen** (dev builds only) renders every component in every state. It is the visual-regression baseline (§14).

### 12.3 Process gates, every sprint
- **Design before build.** Each screen gets a hi-fi mock rendered with the real kit on the gallery before its data wiring. The operator approves on a real phone (TestFlight or a dev build), not a desktop screenshot.
- **Design QA pass** at each sprint's end against the §12.1 rubric and a checklist: safe areas, keyboard avoidance, the smallest and largest phone, largest text, dark and light, VoiceOver order, one-thumb reach, 44 pt targets, and no layout shift when data arrives.
- **Performance budgets (CI-enforced where measurable):** cold start to first meaningful paint ≤ 1.5 s on iPhone 12, measured from a cached session; tab switch ≤ 100 ms; lists hold 60 fps on iPhone 12 with 200 ideas; JS bundle growth > 10% per PR needs a written reason; no network waterfall on screen open (one query per screen where possible).
- **Copy review:** every user-visible string lives in one strings module, so the content-inventory tests grep one place.

## 13. Sprints

Each exit criterion is demonstrated on **TestFlight against staging**, not in a harness. Every sprint also runs the testing gates in §14.

### M0 — Foundation spike (3–4 d)
**Build:** Expo app in the monorepo; Convex + Clerk (Apple sign-in) working; one reactive screen over `ui.today`; AASA plus one universal link; EAS Build and EAS Update channels; Sentry; CI job (typecheck + Jest + a Maestro smoke on the iOS simulator).
**Tests:** typecheck shares Convex types (a deliberate field rename breaks the app build); Maestro smoke launches, signs in with the test user, and renders Today.
**Exit, live:** a TestFlight build shows Today for a real staging creator, and a link Maya texts opens it on a real phone.

### M1 — Design system (5–7 d)
**Build:** tokens, type, the component kit, motion and haptics primitives, the gallery screen; hi-fi mocks of all five tabs, idea detail, and every onboarding screen, built with the kit on static data.
**Tests:** a component test per kit component (Jest + React Native Testing Library) for states and accessibility props; gallery visual baselines; contrast validator on the tokens; the largest Dynamic Type renders without truncating primary actions.
**Exit, live:** the operator walks every screen mock on their own phone and signs off the look. **No data wiring starts before this sign-off.**

### M2 — Read the world (5–7 d)
**Build:** five tabs over the existing queries; object routes; "this changed" states; empty states; skeletons; legacy `/app/*` link mapping; post, account, and evidence detail.
**Tests:** Maestro flows for every tab with a seeded day-one creator and a 30-day creator; cross-tenant route test (another creator's `/o/idea/<id>` → not-found); a replay of every Maya link sent on staging in the last 30 days, all of which must resolve; performance budgets measured on device.
**Exit, live:** the operator uses the app for a week against their own staging creator, with no web Mission Control, and nothing they wanted was missing.

### M3 — Onboarding and login in the app (7–9 d)
**Build:** §4 and §5 in full: sign-in, plan and Stripe link-out, Zernio and Google auth sessions, creator-picture screen, watch picks, her-number pairing, done state, resumability, `/join` attribution with campaign tokens; App Clip spike.
**Tests:** Maestro kill-and-resume at every step; auth-session cancel at every provider; checkout replay idempotency; duplicate-identity linking; content-inventory test (no Telegram, YouTube, vendor names, or "AI"); the old doc's onboarding acceptance list, re-run.
**Exit, live:** a person who has never seen Maya scans a QR, installs, pays with Apple Pay, connects a real TikTok, gets her first text, and attribution is recorded end to end, with no operator help.

### M4 — Write path and awareness (6–8 d)
**Build:** `userActions`, `act()` for every §8 kind, `rev` guards, the awareness table, the prefix section, `consider_reaction` with rails, the §9 fixes, chat tools refactored onto `act()`; every app write optimistic with rollback.
**Tests:** a coherence test (every kind has an app caller *and* a chat tool or an exemption, and exactly one awareness level); taste parity (the same act from app and chat writes an identical taste event); a concurrency test (stale `expectedRev` → `changed`, no clobber); fail-closed tests (shot-list request with budget exhausted → named reason shown in the app); a month-long row-level simulation of mixed app and chat actions (the prefix never repeats a seen action and never drops a Noticed one); the real-model gauntlet re-run from the memory architecture work.
**Exit, live:** pass three talking-head ideas in the app → her next reply accounts for it unprompted. Move a block while she's moving it → no clobber, and the app shows her version.

### M5 — Handoff and share (5–7 d)
**Build:** Ask Maya; the Swift share extension; "watch @author?"; the extension token in the App Group.
**Tests:** adversarial share input (non-TikTok or IG URLs, private posts, a note carrying instructions, which reaches the model only as quoted data); a cross-tenant token test; budget fail-closed on the share path; an abandoned Ask Maya expires with no text.
**Exit, live:** share a real TikTok from the TikTok app → Maya texts her read within the rails. Ask Maya on an idea → her reply is about that idea.

### M6 — Widgets, push, polish (4–6 d)
**Build:** two widgets, the system-only push policy, badge, notification permission timing; the full design QA pass across the app; animation polish; performance fixes.
**Tests:** a revoked Zernio token → exactly one push, one "Needs you" item, one Reacted consideration; the widget updates after she books a block; no push ever contains Maya-authored text (an assertion on the push payload builder); full accessibility audit (VoiceOver through every flow, Accessibility Inspector clean).
**Exit, live:** the widget shows tomorrow's block after she books it by text; the design QA checklist passes on the smallest and largest supported phones.

### M7 — Review, cohort, retire the web (5–7 d)
**Build:** store listing, screenshots, review notes and demo account, privacy label, 5.1.2(i) consent screen, export and delete in-app; the universal-link fallback page; retired routes redirected; `/app/*` and `/start` UI code removed; docs and appendix updated.
**Tests:** a deletion end-to-end test through the app (all nine steps verified in rows); a fallback page test for every object kind signed out and on desktop; a TODO grep; a full Maestro suite on the release build.
**Exit, live:** the app is approved; a 5-creator TestFlight → App Store cohort completes onboarding with no operator help and uses the app for 7 days; the old web routes serve only fallbacks.

**Total:** roughly 8–10 weeks of build. Android follows M7: the same code, plus Play review, the Android share target, and Glance widgets (about 2 weeks).

## 14. Testing stack

| Layer | Tool | Runs |
|---|---|---|
| Backend (Convex) | existing Vitest + convex-test | every PR (existing CI) |
| Types | `tsc` across web, mobile, and convex | every PR |
| Components | Jest + React Native Testing Library | every PR |
| Flows (E2E) | **Maestro** YAML flows on the iOS simulator, with seeded staging creators | every PR (smoke) and nightly (full) |
| Visual regression | Maestro screenshots of the gallery and key screens, diffed against approved baselines | every PR touching UI |
| Performance | on-device measurement script (cold start, list FPS) on a real iPhone 12 | end of each sprint |
| Accessibility | RNTL a11y assertions, VoiceOver walkthrough script, Accessibility Inspector | per sprint (manual script, recorded) |
| Live | TestFlight against staging, real vendors | each sprint's exit |
| Crash and performance in the field | Sentry, with release health gating EAS Update rollouts (halt if crash-free sessions < 99.5%) | continuous |

### 14.1 The five mandatory categories, for this project
- **Cross-tenant isolation:** object routes, every `act()` kind, and extension tokens.
- **Budget × action fail-closed:** shot list, share-extension reads, and any app request that spends. The reason is always shown, never silent.
- **Adversarial input:** share URLs and notes, handle search, free-text corrections and notes (prompt-injection content reaches the model only as quoted data), `expectedRev` storms.
- **Sibling-file coherence:** app/chat parity (§8), awareness completeness, legacy link mapping, Appendix A vs code (§15.4), strings module vs content rules.
- **TODO grep.**

## 15. Operator decisions and dependencies

1. **Billing:** Stripe link-out (recommended) vs IAP from day one.
2. **Android at launch:** recommended no. It follows M7 from the same code.
3. **Push:** confirm "system-only, never her voice" (recommended).
4. **Mac/iPad link fallback page** (recommended) vs also allowing the iOS app on Apple Silicon Macs.
5. **Apple Developer Program** in the business's legal name, plus a D-U-N-S number if it's an organisation account. **This blocks M0's TestFlight build.**
6. A display typeface licence that permits app embedding (M1).
7. An iPhone 12-class test device for performance budgets.

### 15.4 Keeping this doc true
Appendix A is enforced by a coherence test: every tool name in `agent/tools.ts` and `partnerships/tools.ts`, every cron in `crons.ts`, and every public query and mutation in `ui.ts` must appear in the appendix with an app surface or "backend only". A new tool without a row fails CI.

---

## Appendix A — Capability inventory (creator @ `3519c9b`)

### A.1 Agent tools → where they surface in the app

| Tool | What it does | App surface |
|---|---|---|
| `post_info`, `post_transcript`, `post_comments` | read one post, its words, its comments | evidence cards (idea detail); share extension resolves via `post_info` |
| `profile`, `account_posts` | an account's size, normal, feed | Watching → account detail (baseline, last breakout) |
| `sound_info`, `sound_videos`, `sound_reels` | is the sound the reason | idea detail "sound" row, evidence card |
| `search_keyword`, `search_hashtag`, `search_reels`, `search_ig_hashtag`, `ig_popular`, `suggestions` | is this shape a wave, demand | idea detail "why now" evidence |
| `trending_tiktok`, `trending_reels` | platform-wide check | backend only |
| `discover_creators`, `discover_profiles` | who else is in this lane | Watching → suggestions |
| `own_rhymes` | their own posts that rhyme | idea detail "you've done this: 2.3×" |
| `own_post_numbers`, `post_diagnosis` | their post's owner numbers and the four-way read | post detail |
| `lane_benchmark` | lane median / top quarter | Week → Last week; post detail |
| `recall` | memory search | backend only (You shows the records themselves) |
| `calendar_upcoming`, `calendar_free` | their week, free windows | Week → Coming up; "Plan it" slot picker uses `calendar_free`'s query |
| `week_plan`, `block_move`, `block_drop`, `block_add`, `week_replan` | manage the plan by text | Week actions → the same `act()` kinds |
| `growth_plan` | lane, keywords, formats, cadence, hypothesis | Watching → keywords; You → growth plan |
| `mission_control_link` | link to a tab | **replaced by `app_link`** (object-level) |
| `partnership_read`, `partnership_research`, `partnership_draft`, `partnership_update`, `partnership_sync` | partnerships | You → Partnerships; drafts in Needs you |
| show frames (`agent/frames.ts`) | storyboard frames | **suppressed** (cap 0); no surface until re-enabled |

### A.2 Skills and outbound kinds
Skills: **scout**, **opinion**, **profile**, **review**, **reply** (converse), with lookup playbooks in `agent/playbooks.ts` and the SOUL (`agent/soul.ts`, `SOUL_VERSION 2026-09-13.3`). Her human-cadence outbound kinds (`morning`, how'd-it-go, `missed`/`unfilmed`, `saw_it`, `for_you`, `quiet`, `milestone`, `streak`, `win`, `shoot_today`) stay **Messages-only**. In the app they appear only as cards in "What she sent today", never as push.

### A.3 Crons (26) → what the app reflects
| Cron | App reflects it in |
|---|---|
| drain jobs (1 min) | — |
| sample tracked accounts (6 h), grow the roster (daily), sweep lane keywords (daily), format watch, sound signals | Watching: "looked 3 h ago", rising, suggestions |
| scout (hourly), first week (hourly) | Ideas (new) + Today |
| readback own posts (daily), zernio delta (hourly), zernio followers (daily) | posts + "as of" everywhere |
| sync calendars (30 min), week plan (hourly) | Week → Coming up; Needs you |
| weekly review (hourly, fires Sunday local) | Week → Last week |
| expire ignored ideas, learn from outcomes, taste profiles | Ideas status; You → taste |
| expire stale questions, human cadence, consolidate, retention | — (Messages / memory) |
| creator status (hourly) | Today status line |
| partnership reply sync (30 min) | Partnerships, Needs you |
| operator alerts, eval recent outbound, cost reconcile | — (ops) |

### A.4 Vendors
- **ScrapeCreators** (≈45 endpoints across TikTok, Instagram, Reddit, X; `integrations/scrapeCreators`): the perception layer, backend only.
- **Zernio** (`/api/v1/connect/{platform}`, accounts, profiles): connection cards and own-post numbers.
- **Google Calendar** and **Gmail** (partnerships): OAuth through auth sessions.
- **Claw** (iMessage/RCS/SMS relay, `services/claw-relay`): her number; pairing on onboarding screen 6.
- **OpenRouter**, with models in use `google/gemini-3.7-flash`, `openai/gpt-oss-120b`, `openai/gpt-5.6-luna-pro`, `deepseek/deepseek-v4-flash`: backend only. ⚠️ Any model routing change still follows the price-first rule.
- **Telegram** (`integrations/telegram`): kept for the operator and legacy only. It never appears in the creator app.
- **Stripe**, **Clerk**: §11, §4.

### A.5 UI read/write surface being replaced
Queries: `ui.today`, `ui.ideas`, `ui.lane`, `ui.results`, `ui.plan`, `ui.settings`, `connections.zernio.status`, `calendar.oauth.status`, `partnerships.mailbox.status`, `onboarding.start.progress`.
Writes: `ui.updateSettings`, `ui.correct`, `ui.revokeRule`, `ui.passIdea`, `ui.blockControl`, `taste.events.markPosted`, `onboarding.admired.{validate,add,remove,suggest}`, `calendar.oauth.{selectCalendars,disconnect}`, `connections.zernio.{startConnect,reconcile,disconnect}`, `billing.checkout.{createCheckout,openPortal}`, `partnerships.mailbox.disconnect`, `onboarding.start.{ensureCreator,start,describe,setPhone}`, `core.pairing.createPairingLink`. All reads port unchanged. All writes move behind `act()` in M4.
