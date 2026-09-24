# Maya partnership pilot — implementation and activation

Implemented September 11, 2026. This is a bounded, approval-based pilot. It does not change Stripe prices or silently give every existing subscription the proposed premium feature.

## What Maya can do

- Read and update partnership goals, paid-only preferences, excluded brands, deal types, region, availability and user-provided minimum rates through the conversation.
- Search public brand/program terms and extract official pages through Tavily. No Apollo, Hunter, email guessing, or contact-database integration.
- Save an opportunity with an explainable **recommend / investigate / pass** assessment: goal alignment, content alignment, audience fit, commercial fit, concerns, unknowns and creator evidence. Personal evidence requires an owned source and a verbatim quote. Website evidence must match a recent tool result; the official website must have been extracted, not merely found in a search snippet.
- Prefer a known official application route, preserve visible application questions, prepare answers for user review/submission, or give a social-profile link and copyable DM. A published email must occur literally in official evidence or a representative page linked by the brand. This is source verification, **not deliverability verification**.
- Prepare an immutable email revision using the stored recipient and connected sender. The code displays the exact message, recipient and sender. The user types its unique `SEND …` command; conversational agreement and tool output cannot authorize sending. An approval is accepted only after the review exists in web chat or has been delivered to the phone channel.
- Send the approved email through the user's Gmail account, with one transactional send claim. Edits, preference changes, reports, new replies and mailbox changes invalidate pending approval. An uncertain send is reconciled using its deterministic RFC Message-ID, never retried blindly.
- Read replies from tracked partnership email threads, answer questions from the event ledger, retain explicit user-reported DM/application status separately from provider-confirmed email acceptance, and distinguish interest from an agreed deal.
- Ask whether the user wants a follow-up when a tracked email has no later reply, or revisit a manual handoff on a date the user explicitly requested. Remind about recorded application deadlines and agreed deliverables. Each follow-up email needs another exact review.
- Stop on explicit opt-out/bounce phrases; any new inbound message stops the unanswered-email follow-up. Opt-out detection is conservative, not a complete natural-language classifier. Other rejection/negotiation details remain evidence for Maya and the user to interpret.
- Search older relationships by domain and paginate relationship/event history. Reconnecting the same verified Gmail address preserves historical threads while canceling old consent.

## Main modules

`convex/partnerships/contracts.ts` defines validation and the judgment skill; `store.ts` owns profiles, sourced opportunities, user reports and allowances; `research.ts` wraps Tavily; `drafts.ts` owns revisions and approvals; `mailbox.ts` owns OAuth and encrypted credentials; `delivery.ts` owns sending, reconciliation, thread polling and reminders; `tools.ts` connects the workflow to Maya's conversation loop; `privacy.ts` invalidates forgotten personal evidence.

Private tables: `partnershipProfiles`, `partnershipOpportunities`, `partnershipDrafts`, `partnershipEvents`, `partnershipResearch`, `partnershipMailboxes`. Every table is creator-scoped and included in account deletion. Exports omit mailbox credentials. Forgetting removes matching derived personal prose and cancels pending approvals while retaining minimal operational history, so forgetting does not accidentally authorize another cold pitch.

The existing chat delivery writer resolves Telegram versus Claw/iMessage. This feature does not introduce a new messaging provider. The 30-minute cron schedules bounded per-opportunity workers; proactive reminders use the existing quiet-hours, outstanding-question and spending rails. It checks tracked threads, not the whole inbox.

## Limits and intentional boundaries

- Per creator per UTC calendar month: **40 basic research requests, 10 new brand relationships, 30 draft revisions**. Failed research attempts consume an allowance reservation. A research request has a 15-second network timeout; response size and stored excerpts are capped. A conservative $0.008 reservation reaches the existing cost ledger for each request (up to $0.32/month for research, excluding model and messaging costs). [Tavily's published credit pricing](https://docs.tavily.com/documentation/api-credits).
- No attachments, CC/BCC, automatic form submission, direct social DM sending, automatic contract acceptance, payment collection, or inbox-wide opportunity discovery. Forms/DMs are user handoffs. Deliverables and outcomes are user-reported, not inferred from a draft or email reply.
- Discovery is requested in chat; the recurring worker monitors saved relationships. An autonomous weekly discovery subscription is not enabled.
- No guarantee that a public email is deliverable, that a brand will respond, or that a fit judgment is correct. Models still need real-user evaluation for recommendation quality and resistance to misleading prose. Structural tests are not proof that every model-generated sentence will be grounded.
- The provider can accept an email after a timeout. A missing reconciliation result remains `unknown` and blocks replacement outreach; it is not interpreted as failure. A message already being handed to the provider cannot be recalled by a later pause.
- Canonical-domain deduplication catches the same brand across campaigns and `www` aliases. It does not automatically know every parent-company, agency or alternate-domain relationship. Maya should check these in the ledger and research before outreach.
- Historical personal-evidence sources must still exist to support a new pitch; if a source was forgotten or changed, the assessment needs refreshing. Existing general conversation retention still applies.

## Activation

Set backend secrets/configuration in the intended environment:

1. `PARTNERSHIP_PILOT_CREATOR_IDS`: comma-separated creator IDs allowed into the pilot. Empty means access denied. Replace this pilot gate with the finalized subscription entitlement mapping when launching the new paid tiers; no prices were created or changed here.
2. `TAVILY_API_KEY` for public research.
3. `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GMAIL_REDIRECT_URI`, registered exactly as the app's `/api/gmail/callback` URL. Gmail uses its own single-use OAuth state audience, bound to the signed-in creator, separate from Google Calendar.
4. `ENCRYPTION_KEY`, the existing encryption module's deployment-specific base64 encoding of 32 random bytes. Preserve an existing deployment key; do not replace it casually, since Calendar may already use it.
5. Leave `PARTNERSHIP_EMAIL_SEND_ENABLED=false` until the controlled mailbox flow has been verified. Connect through Settings, create a fresh draft and approve it only with a test recipient you control before enabling the pilot for others.

The Gmail integration requests `gmail.send` and `gmail.readonly`. Google classifies these as sensitive and restricted respectively; its documentation calls for verification and, when restricted data is stored or transmitted on servers, a security assessment. Complete the applicable Google process before public launch. [Official Gmail scope requirements](https://developers.google.com/workspace/gmail/api/auth/scopes).

Local inspection found Google client settings, but no local Tavily key, Gmail redirect, encryption key or send-enable flag. Backend environment configuration was not assumed from that local check. No live brand email was sent; no live OAuth/reply round trip was claimed.

## Verification

Local result: **653 tests passed, 2 existing tests skipped, across 91 files**, including **43 partnership tests**. Production build, explicit typecheck, changed backend lint, build guards and whitespace checks passed. The Settings file still has its existing unrelated internal-navigation lint warning.

The partnership suite tests tenant isolation, missing access, real versus fabricated source quotes, official-page requirements, email-source validation, personal fit, paid-only/excluded preferences, relationship deduplication, transactional research caps, unsafe URLs, exact/delivered approvals, revision invalidation, expiry, pauses, sender changes, application handoffs, header injection, Unicode MIME, opt-outs, out-of-order and duplicate replies, manual follow-up dates, reconnect behavior, forgotten evidence, credential-free exports, concurrent provider workers, and timeout-after-acceptance reconciliation.

Run:

```sh
npx vitest run
npm run typecheck
npm run guards
npm run build
```

Live acceptance still requires a configured test mailbox: connect, approve an email to an address you control, reply to it, verify the reply reaches the ledger, disconnect/reconnect, and confirm pending approval is invalidated. Keep actual brand outreach out of that test.
