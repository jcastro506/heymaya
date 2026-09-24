# Maya creator onboarding — mobile web sprint

**Status:** approved product direction, ready for implementation planning  
**Date:** 2026-09-14  
**Surfaces:** mobile web first, responsive desktop web, Messages  
**Connected social platforms:** Instagram and TikTok through Zernio OAuth  
**Calendar:** Google Calendar only in this release

This sprint replaces the older onboarding assumptions in `CREATOR_SPRINT_PLAN.md` where they conflict. In particular, YouTube is not a creator connection, Telegram is not part of the user-facing onboarding, and Zernio is present during onboarding rather than added later.

## 1. Product decision

Maya will not have a native app in this release. The complete signup, payment, onboarding, account connection, and Mission Control experience must work in a phone browser and on desktop.

Messages is the everyday interface. Mission Control is the rich visual interface Maya links to when a list, plan, chart, approval, or setting is easier to understand on a screen. A creator must never need a laptop and must never need to install an app.

The canonical acquisition path is:

```text
QR code or campaign link
  -> mobile landing page
  -> account creation
  -> plan and web checkout
  -> Instagram/TikTok connection through Zernio
  -> creator picture and inspiration suggestions
  -> Google Calendar and messaging setup
  -> first useful message from Maya
  <-> mobile Mission Control through secure deep links
```

The QR code points to a normal HTTPS join URL, such as `https://hey-maya.ai/join`, with campaign parameters preserved through account creation and checkout. It does not point to an App Store or require a PWA installation.

## 2. Experience principles

1. **The phone is a primary surface.** Every step is designed at a narrow viewport first and expanded for desktop.
2. **Progress survives every handoff.** OAuth redirects, checkout, refreshes, browser restarts, and switching devices resume the correct step from server state.
3. **Ask only what Maya cannot infer.** Connected posts and analytics establish the initial picture. Maya asks the creator to confirm or correct it.
4. **Show evidence early.** The first useful moment is a specific observation about the creator, not a generic welcome or feature tour.
5. **Conversation continues onboarding.** The web gathers permissions and makes visual selections easy. Maya learns goals and nuance naturally in Messages.
6. **Every visual object has a conversational equivalent.** Maya can summarize it in Messages and link to its exact mobile view.
7. **No false capability.** TikTok metrics are described according to what Zernio actually returns. Missing or delayed analytics are labeled rather than inferred.

## 3. The onboarding flow

### Screen 0 — mobile landing and QR arrival

The landing page recognizes campaign parameters and leads with one action: **Meet Maya**. It previews the real workflow: connect a creator account, let Maya learn the catalogue, and continue in Messages.

Acceptance:

- The page works at 320, 375, 390, 430, 768, and desktop widths without horizontal scrolling.
- QR attribution persists through signup and successful payment.
- A returning authenticated creator resumes instead of seeing the top of the funnel.
- No YouTube, Telegram, native-app, or Apple Calendar promise appears.

### Screen 1 — account creation

Offer Sign in with Apple, Sign in with Google, and email. Keep the creator on the same mobile route after authentication and preserve onboarding state.

Acceptance:

- Autofill, password managers, email verification, and browser back/forward navigation work.
- Duplicate identities resolve to the existing creator rather than creating another Maya.
- Authentication errors retain attribution and progress.

### Screen 2 — plan and checkout

Show the three current plans from the shared tier module. Use hosted Stripe Checkout so Apple Pay, Google Pay, and cards can be used where available. Return to a signed, single-use onboarding continuation URL.

Acceptance:

- Price text is read from the tier source rather than copied into onboarding.
- Refreshing or replaying the success URL cannot provision twice.
- A paid creator can close the browser and resume from another device.
- A failed or abandoned checkout returns to the plan step with a useful state.

### Screen 3 — connect Instagram and TikTok

This is a Zernio connection flow. Do not replace it with pasted handles or public scraping. One account is required to create an evidence-backed first read. The second is offered according to the creator's tier and can be connected now or later.

The screen uses two large platform cards. Each launches Zernio's hosted OAuth and returns to this step. After return, show the real avatar, handle, platform, connection health, and analytics synchronization state.

Zernio is the source for:

- connected-account identity and authorization;
- Instagram post and account analytics made available by Zernio;
- TikTok post and account analytics made available by Zernio;
- connection health, expiry, and reconnect state.

Public discovery APIs may supplement market and inspiration research. They must never masquerade as the creator's authenticated analytics.

Acceptance:

- Only `instagram` and `tiktok` can be requested, stored, or rendered by the creator onboarding contract.
- OAuth `state` is signed, creator-bound, short-lived, single-use, and safe from account swapping.
- Cancel, denial, timeout, duplicate connection, expired state, and reconnect are covered.
- Connection success requires a confirmed Zernio account row; a redirect alone is not success.
- The UI distinguishes **connected**, **syncing**, **needs attention**, and **unavailable**.
- Account limits are enforced on the server, including webhook and reconnect paths.
- A contract test fails if YouTube enters the onboarding platform union or copy.

### Screen 4 — Maya is getting to know you

Start the bounded first-read job as soon as the first Zernio connection is confirmed. The screen explains what Maya is doing in human terms and shows real progress states. It does not claim a fixed completion time.

The first read samples the creator's recent, strongest, and representative posts; builds an initial platform-specific picture; and records evidence for each conclusion. If the creator has very little history, switch to new-creator mode rather than pretending to find patterns.

While the job runs, ask one easy confirmation:

> I’m getting a feel for what you make. Which of these sounds closest?

Maya supplies two or three inferred descriptions plus **Something else**. This is confirmation of her read, not a blank niche questionnaire.

Acceptance:

- Every creator-picture claim cites a source post or authenticated metric.
- Instagram and TikTok can produce different platform pictures.
- Private, empty, partially synchronized, and temporarily unavailable accounts have explicit states.
- A retry is idempotent and does not duplicate jobs or vendor calls.
- The UI can continue to the next useful step while deeper history finishes.

### Screen 5 — inspiration

Title: **A few creators worth keeping an eye on**

Copy: **I found people whose work could be useful for different reasons. Pick any that feel right, add your own, or leave this to me.**

Maya proposes three to six creator cards. Each card includes:

- avatar, display name, handle, and platform;
- a short description of what they make;
- one plain-language reason Maya suggested them;
- a representative post when reliable data is available;
- a selection control.

Actions:

- **Use my picks** selects Maya's recommended mix.
- A creator can select or clear any card.
- Search lets them add a known Instagram or TikTok creator.
- **Find more later** continues with no forced selection.

This step never requires the creator to know three names before moving on.

#### Suggestion algorithm and budget

1. Infer topics, recurring formats, language, production style, and present audience band from the authenticated creator picture.
2. Read the shared public-post and creator cache before making a paid discovery call.
3. Run at most two targeted discovery searches across Instagram and TikTok when the cache is insufficient.
4. Deduplicate authors and reject the creator's own accounts, inactive accounts, private accounts, engagement anomalies, language mismatches, and obvious niche mismatches in code.
5. Inspect only the strongest small candidate set. Do not perform video-model analysis across the full pool.
6. Make one bounded ranking call that selects a useful mix:
   - one credible peer whose scale and production are reachable;
   - one aspirational creator with a transferable pattern;
   - one adjacent creator who can widen the creator's ideas.
7. Store the reason, evidence, discovery source, model/version, and cost for every shown suggestion.

Zernio supplies the user's authenticated picture and performance context. Public creator discovery and cached public posts supply the candidate pool. Popularity alone is not a recommendation.

Planning budget: target **$0.05–$0.15 incremental cost per signup**, with a hard ceiling of **$0.25**, excluding the creator's own first-read cost. These figures are hypotheses until measured on staging.

Acceptance:

- The same account is not shown twice across handles or platforms.
- A reason names a concrete fit and never invents demographics, results, or style.
- Thin results fall back to fewer strong cards rather than filler.
- A provider outage shows manual search and **Find more later**.
- Clicking a suggestion creates the same tracked-account record as telling Maya “watch @handle.”
- Later proactive discovery uses the same add/decline state and never repeatedly offers a declined account without new evidence.
- Cost events demonstrate the hard ceiling under empty-cache fixtures.

### Screen 6 — Google Calendar

Explain the outcome: Maya can see what is coming up, suggest content from the creator's real week, and propose filming or editing time. Google Calendar is optional and is the only calendar connection in this release.

The creator can connect Google Calendar, choose which calendars Maya may use, or continue without it. Calendar writes remain approval-gated: Maya proposes a block and creates or changes it only after the creator agrees.

Acceptance:

- OAuth uses minimum required scopes and returns to the correct onboarding session.
- The user chooses readable calendars and a write destination.
- Denial or skip does not block activation.
- No event is written during onboarding.
- Duplicate approvals cannot create duplicate events.
- The UI and Maya distinguish a proposal, queued write, confirmed event, and failed write.

### Screen 7 — messaging, timezone, and quiet hours

Collect and verify the phone number, obtain proactive-message consent, infer timezone, and offer a simple quiet-hours default. Messaging is presented according to the verified production channel: iMessage where delivered, RCS where delivered, and SMS fallback. Do not promise typing indicators or rich behavior until they pass real-device verification through the selected provider.

Telegram is absent from this flow. The transport remains abstracted behind the shared message-delivery contract so changing providers does not change Maya's memory or behavior.

Acceptance:

- Consent, number verification, timezone, and quiet hours are server records.
- No proactive message can be sent before verified consent.
- STOP, pause, resume, help, and deletion commands bypass the model and are enforced by code.
- Real-device tests cover iPhone/iMessage, Android/RCS when available, and SMS fallback.
- The provider's line model and per-user economics are verified before general release.

### Screen 8 — handoff to Maya

The final screen confirms what is connected, shows any continuing analysis honestly, and tells the creator to expect Maya in Messages. On mobile, the primary action opens the actual conversation when the transport provides a supported deep link. Mission Control remains available as a secondary action.

Do not make the first message wait for the deepest analysis. Send the orientation after messaging is verified, then follow with the evidence-backed first read when it is ready.

Acceptance:

- Exactly one welcome sequence is created per creator.
- The final screen and first message agree about connection and analysis state.
- Time to orientation is under one minute after phone verification.
- First useful read targets p50 under 10 minutes and p95 under 20 minutes under the documented staging load.

## 4. Maya's opening conversation

Maya may introduce herself once. After that she uses **I**, **me**, and **we**, never “Maya” as a substitute for herself.

### Message 1 — orientation

> hey Josh — i’m Maya. i’m going through your posts now so i can get a feel for what you make, what sounds like you, and what’s actually been working.

### Message 2 — how to use her

> text me like you’d text someone on your team. send me a half-formed idea, ask what to post, tell me to remember something, or ask me to make room to film it. i’ll also message you when i find something in your world worth trying.

### Message 3 — remove pressure

> you don’t need to figure everything out today. i’ll share what i notice first, then we can work out what you’d like me to help with most.

The first read follows as soon as it has real evidence. It leads with one specific observation, cites the relevant post naturally, states its confidence when evidence is thin, and gives the creator something easy to respond to.

After delivering proof, Maya asks:

> what should we focus on first—posting more consistently, growing your audience, improving what you’re making, landing partnerships, or something else?

This is an open conversation, not a fixed funnel. “Something else” is first-class. Maya can support a new creator trying to post twice a week, an established creator seeking partnerships, a launch, a creative transition, revenue, community, or a goal we did not anticipate.

The runtime extracts structured goals from the conversation without forcing the creator to repeat them in a form. Follow-up questions depend on the answer and stop when Maya knows enough to act. She should reflect her understanding before treating a goal as settled.

Tone rules:

- warm, clear, specific, and concise;
- no feature dump, therapy language, forced intimacy, or exaggerated certainty;
- no “What would make Maya useful?” or vague blank-page questions;
- no third-person self-reference after the introduction;
- no claim that she watched, measured, remembered, scheduled, or contacted something unless a record proves it;
- questions arise from what the creator said or what Maya observed.

## 5. Memory and continuity created by onboarding

Onboarding writes to the same durable memory system used later. It must not create a separate profile that drifts away from the agent.

Persist:

- connected platform identities and connection health;
- platform-specific creator pictures with evidence and version;
- selected, added, and declined inspiration accounts;
- stated goals, time horizon, priority, and confidence;
- corrections to Maya's initial read;
- calendar permissions and selected calendars;
- timezone, quiet hours, consent, and channel capability;
- the complete conversation and source links for extracted memories.

When a creator later says “watch this person,” “that isn’t my style,” “I’m launching in October,” or “stop suggesting talking-head videos,” Maya updates the same records. Mission Control immediately reads those revisions. Generated recommendations check the current revision before delivery so stale work is dropped or rebuilt.

Memory acceptance scenarios:

- A day-one preference changes a day-thirty idea.
- An inspiration account added in Messages appears in Mission Control without refresh races.
- Removing an account in Mission Control stops future watches and is visible to Maya on her next turn.
- A corrected goal supersedes the earlier goal while preserving an audit trail.
- “Forget that” tombstones the memory and excludes it from retrieval.
- No creator's onboarding, analytics, memories, or suggestions can enter another creator's context.

## 6. Mobile Mission Control contract

The web UI is not a desktop dashboard squeezed onto a phone. The first mobile release needs these views:

- **Today:** what Maya found, open decisions, and the next useful action;
- **Ideas:** saved ideas, hooks, evidence links, feedback, and status;
- **Week:** content plan and approved calendar blocks;
- **Inspiration:** watched accounts, why they matter, add/remove controls;
- **You:** goals, preferences, memories, connected accounts, calendar, messaging, and plan;
- **Partnerships:** opportunities, fit explanations, outreach, and follow-ups for entitled creators.

Every Maya link targets the exact authenticated object and returns gracefully if it was deleted or superseded. Every mutation records actor/source, timestamp, and revision. Maya acknowledges changes only when doing so helps; she does not send a message for every tap.

Mobile acceptance:

- All primary actions are reachable with one thumb and have at least 44-by-44-point targets.
- Sticky actions do not cover content or browser controls.
- OAuth, checkout, keyboard, safe-area, reduced-motion, screen-reader, text-size, and slow-network states are verified on real devices.
- Core content remains usable at 200% text size.
- A creator can complete onboarding and approve an idea without desktop access.
- Lighthouse and Web Vitals budgets are established from staging measurements, then enforced in CI for regressions.

## 7. Delivery plan

### Sprint A — contracts and observability (2–3 days)

- Define the server-owned onboarding state machine and resumable step contract.
- Restrict creator platforms to Instagram and TikTok at the onboarding boundary.
- Define Zernio connection, synchronization, and failure states.
- Add funnel, latency, vendor-cost, and failure events without storing sensitive OAuth material.
- Add a content inventory that prohibits YouTube, Telegram, app-download, and Apple Calendar onboarding copy.

**Exit:** state-machine tests, platform contract tests, event schema, and measured baseline for the current flow.

### Sprint B — mobile shell, identity, and checkout (3–5 days)

- Build the QR/campaign join route and server-side attribution.
- Rebuild auth, plan selection, checkout return, resume, and error states mobile first.
- Create the shared onboarding shell, progress behavior, animations, and accessibility patterns.

**Exit:** a creator can scan, authenticate, pay, close the browser, and resume correctly on phone and desktop.

### Sprint C — Zernio connections and first read (4–6 days)

- Build Instagram and TikTok Zernio OAuth cards and callback reconciliation.
- Start the bounded first-read pipeline after the first confirmed account.
- Render honest synchronization and partial-data states.
- Build the inferred creator-description confirmation.

**Exit:** real staging Instagram and TikTok accounts connect, produce authenticated analytics where supported, and generate an evidence-backed initial picture.

### Sprint D — inspiration selection (4–6 days)

- Implement the cache-first candidate funnel and hard spend ceiling.
- Build responsive recommendation cards, selection, search, fallback, and tracked-account mutations.
- Connect onboarding choices to Maya's ongoing discovery and memory.

**Exit:** the adversarial recommendation suite passes and staging reports cost, latency, acceptance, and evidence for every shown card.

### Sprint E — Google Calendar and messaging (4–6 days)

- Build Google OAuth, calendar selection, skip/reconnect, and approval-gated write states.
- Complete phone verification, consent, timezone, quiet hours, and transport-neutral delivery.
- Remove Telegram from the user-facing creator onboarding.
- Certify the selected messaging provider on real iPhone and Android devices.

**Exit:** Maya can read an authorized week, propose a relevant filming block, create it only after approval, and deliver the correct welcome sequence through the verified messaging route.

### Sprint F — conversation, memory, and handoff (4–6 days)

- Ship the opening sequence and adaptive goal conversation.
- Add structured goal extraction, confirmation, revision, and retrieval.
- Add the first-read follow-up and exact Mission Control links.
- Verify consistency across Messages and web mutations.

**Exit:** the conversation and month-long memory simulations pass; no message claims an unrecorded action or observation.

### Sprint G — end-to-end gauntlet and staged release (3–5 days)

- Run the full journey on current iPhone Safari, Android Chrome, and desktop Safari/Chrome.
- Exercise OAuth cancellation, expired sessions, duplicate callbacks, provider outages, sparse accounts, large accounts, two-platform personas, quiet hours, calendar denial, and interrupted checkout.
- Run 50 concurrent recorded-fixture onboardings and a smaller live-vendor staging probe.
- Review every Maya message as a human conversation, including proactive usefulness and unnecessary interruption.
- Release to a small staging cohort, inspect funnel recordings and support issues, then widen.

**Exit:** no critical or high defects; service and cost budgets pass; the staged cohort completes the journey without operator intervention.

## 8. Evaluation scorecard

Product metrics:

- QR arrival to account creation;
- account creation to successful checkout;
- checkout to first confirmed Zernio connection;
- connection to first useful observation;
- completion and abandonment by onboarding step;
- suggestion selection and later retention rate;
- calendar connection and approved-event rate;
- verified phone to successful first delivery;
- seven-day activation: at least one useful exchange plus one saved/acted-on idea;
- thirty-day retention and creator-reported trust.

Quality rubric for every evaluated Maya message, scored 1–5:

- grounded in real creator or market evidence;
- specific to this creator rather than reusable boilerplate;
- useful now;
- sounds clear, warm, and human;
- asks only a necessary question;
- accurately represents capability and action state;
- respects goals, corrections, quiet hours, and prior decisions.

An outbound proactive message needs no score below 4 in the release golden set. A hallucinated action, metric, memory, or source is an automatic failure regardless of average score.

## 9. Explicitly deferred

- Native iOS or Android app;
- Apple Calendar and iCloud CalDAV;
- YouTube account connections, analytics, or onboarding copy;
- Telegram in the creator-facing experience;
- image generation;
- social publishing beyond the separately approved product scope;
- forcing installation of a PWA;
- a native share sheet, widgets, Live Activities, or offline mode.

These are deferred until observed creator behavior demonstrates a problem that mobile web and Messages cannot solve.

## 10. Launch gates and operator dependencies

Engineering can complete recorded-fixture flows without production credentials. The real staging certification needs:

- working Zernio Instagram and TikTok OAuth configuration and webhook secrets;
- one consenting test Instagram account and one consenting test TikTok account with usable history;
- Google OAuth staging credentials and a test calendar;
- production-like messaging provider credentials, a verified sending line, and real iPhone/Android recipients;
- Stripe test prices for all tiers.

No provider is declared production-ready from a mocked test. Each live probe records the provider response, normalized record, cost event, latency, and resulting user-visible state.

## 11. Definition of done

This initiative is done when a creator can scan a QR code on either phone platform, create and pay for an account, connect Instagram or TikTok through Zernio, receive strong inspiration suggestions, optionally connect Google Calendar, verify Messages, and get a specific useful message from Maya without using a laptop or installing an app.

Maya must then remember the creator's choices, continue the goal conversation in first person, use Zernio analytics accurately, update the same state from Messages and Mission Control, and link the creator back to a polished mobile view whenever a richer interface helps.
