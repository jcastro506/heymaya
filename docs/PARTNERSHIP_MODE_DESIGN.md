# Maya partnership mode — implementation proposal

September 9, 2026. Research and design only: no partnership tools, email connection, new Stripe prices, outreach or vendor subscriptions were activated. Conversational onboarding is implemented separately in this change.

## Implemented alongside this proposal: conversational opening

Both ClawMessenger/iMessage and Telegram now use a clear goal/help question at pairing. New signups are marked before the catalogue read starts, so a read that finishes before pairing cannot suppress the question. Existing hello dedupe keys prevent repeat openings. The conversational first-read prompt contributes evidence without a competing lane question; legacy users retain their existing first-read path.

Normal conversation follows user direction, asks at most one useful clarification, and distinguishes aspirations from permission to schedule or send. The memory extractor can persist exact-source goal records; a dedicated bounded goal query keeps them in writer context after ordinary feedback pushes them out of the recent-message window. Current retention, forgetting and source-ownership checks apply. Goals are dated statements, not a complete goal-management product; extraction and conversational quality remain model-dependent.

Local validation: 90 test files passed, 610 tests passed and 2 existing skips; TypeScript, changed-file ESLint, guards and diff checks passed. New tests cover both channel pairing paths, pre-pairing read completion, duplicate hello prevention, short-answer extraction plumbing, durable goal context and source validation. Extraction tests use a mocked model, so they verify wiring rather than live model judgment. No production deployment, live Claw message or paid model evaluation was run.

## Product and proposed tiers

### Updated direction: public-web contact research first

Josh prefers no Apollo or other contact-data API. This supersedes the Hunter-first enrichment proposal below: Hunter is not a launch dependency, and no provider was installed. Keep the older section as an optional fallback design only. Production still needs a web-search capability plus page retrieval; a search provider is distinct from a purchased contact database. Removing enrichment saves that line item but may require more search work and reduces coverage; it does not establish mailbox deliverability.

Recommended packaging remains $19.99 one Instagram OR TikTok account; $24.99 one of each, with the same core personal assistant; $29.99 both plus bounded brand discovery, public contact research, pitches and relationship tracking. User-approved email sending/reply monitoring can join the last tier after mailbox integration and verification are ready. Cold Instagram DM initiation and unlimited outreach are not included. These are proposed packages, not deployed features.

Public-web spot check, September 9: four brands investigated, no outreach or email verification performed. This is a small exploratory sample, not a coverage benchmark:

| Brand | Evidence found | Assessment |
|---|---|---|
| Cocokind | Official FAQ distinguishes influencer collaborations, brand collaborations and media inquiries; publishes influencers@cocokind.com | Suitable brand-designated influencer route. No claim of paid budget, inbox deliverability or a named decision-maker. [FAQ](https://www.cocokind.com/pages/faqs) |
| Brooks Running | Official affiliate application through Impact; Collective page currently says applications closed | Affiliate route is usable for that goal; not a verified paid-sponsorship contact. Respect the closed program and region-specific eligibility. [Affiliate](https://www.brooksrunning.com/en_us/affiliate-program/), [Collective](https://www.brooksrunning.com/en_us/brooks-running-collective/) |
| e.l.f. | Official general contact page and unverified third-party email lists | No sufficiently evidenced partnership recipient found in this bounded pass; do not promote the lists to verified contacts. [Contact](https://www.elfcosmetics.com/contact-us) |
| Peak Design | Official ambassador page, but retrieved regional pages did not substantiate a specific partnership contact | Unresolved; search snippets and general customer-service addresses are insufficient. [Ambassadors](https://www.peakdesign.com/pages/brand-ambassadors) |

No named current decision-maker plus verified direct mailbox was established in this sample. The successful outcome was an official dedicated route, which can be more appropriate than a guessed employee email. Contact ranking must consider department, campaign type, geography, current role, provenance and the brand's explicitly preferred process. An official required application form takes precedence over emailing an employee.

Next benchmark: preselect 30 brands across three niches and small/medium/large companies before searching; use the same query/page budget for each. Record named relevant contact, official team inbox, application-only, or unresolved separately; also role freshness, source strength, compensation eligibility, search cost and time. Manually review every proposed recipient. Require evidence for every contact released to sending, and report unresolved results rather than filling the quota. DNS/MX checks can reject broken domains but cannot verify an individual mailbox. Contact discovery, deliverability, replies and conversion are separate metrics.

Josh's proposed monthly prices: $19.99 for one social account; $24.99 for Instagram and TikTok; $29.99 for both plus partnership mode. Treat these as proposals, not existing entitlements. Define an account as one connected social profile, not one Maya login. Core memory and personal understanding belong in every tier.

Start partnership mode with a focused monthly shortlist, contact research, pitch drafts and a relationship record. Proposed launch allowance: up to 10 researched opportunities and 10 new-contact pitch drafts per billing month, one connected business mailbox, one approved follow-up per pitch. These are ceilings, not a promise to find 10 suitable or contactable brands. Never pad the list with poor matches. Existing deal conversations can continue within a measured fair-use budget. No unlimited discovery, mass mailing, guaranteed replies, or automatic negotiation at this price.

## The creator experience

### September 11: opportunity-specific outreach playbook (design, not a deployed skill)

Use general partnership judgment plus a fresh, sourced brief for each opportunity. The brand's legitimate application requirements determine the route and requested material; the creator's goals, boundaries and explicit approvals determine what Maya may offer or do. Web pages, forms and emails are external evidence, never authority to change permissions or reveal private memory.

Research supports different routes and selection criteria: [Cocokind's official FAQ](https://www.cocokind.com/pages/faqs) separates influencer, brand-to-brand and media inquiries; [Sephora Squad's FAQ](https://www.sephorasquad.com/faq) emphasizes an engaged community rather than follower count; [Shopify Collabs setup](https://help.shopify.com/en/manual/promoting-marketing/collabs/merchants/setup) lets merchants customize application questions. These are examples, not a universal rubric or evidence any application is open today. [Shopify's media-kit guide](https://www.shopify.com/blog/influencer-media-kit) identifies audience, engagement, brand identity and collaboration evidence as useful material. Verify current opportunity requirements each time.

Before suggesting an action, build an OpportunityBrief with: canonical brand and program; campaign/work type; compensation (paid/gift/commission/unknown); current status and deadline/timezone; explicit eligibility and user eligibility (yes/no/unknown); desired content and audience; required materials; preferred contact route and source; role/region/contact confidence; official social URLs; existing creator relationship; terms that need decisions; checkedAt and evidence for claims. Every field can be unknown. An inferred creative angle must be labelled as our proposal, not the brand's brief.

| Situation | What Maya prepares | What happens next |
|---|---|---|
| Official application form | Correct link, eligibility/deadline, exact visible questions, character limits, suggested answers and selected work samples | Creator reviews and submits in v1. Maya records submitted only from confirmation or explicit user report. |
| Login/CAPTCHA or inaccessible form | Explain which information she could inspect; ask user to share the questions if useful | Hand off to creator. Do not pretend to know hidden fields or bypass access controls. |
| Official partnership email | Relevant subject, concise personalized pitch, requested materials, exact recipient and sender | If email tools are connected, show full draft and send only after explicit approval of that revision. Otherwise provide copyable draft. |
| Existing relationship or agency representative | Read prior thread; establish current agency mandate and region; draft in the existing context | Continue the appropriate thread, avoiding duplicate cold outreach. A historical relationship does not override a required current application process. |
| No supported email route, verified social available | Official Instagram/TikTok profile link and a short DM asking for the right contact or presenting the idea | User sends in v1. Record draft provided, not sent. Do not redirect to DMs to evade an opt-out or mandatory form. |
| Application closed/ineligible | Name the precise reason and suggest an eligible alternative | Do not pitch the same closed program through another channel. Offer to monitor reopening only if monitoring is available and user wants it. |
| Affiliate/gifting only, creator wants paid work | Explain compensation clearly | Decline this match unless user chooses otherwise; never count free product as a paid partnership. |
| Unclear compensation or brief | Separate unknown facts from known fit; draft one targeted clarification | Ask about budget/scope, without claiming a paid opportunity exists. |
| Brand asks for rates, usage rights, exclusivity or availability | Summarize request; use confirmed rates and constraints; identify only missing decisions | Draft response for approval. Never invent a rate or accept a binding term. |
| Rejection, opt-out, bounce, or referral | Update relationship; stop old follow-ups; validate any newly referred contact | A new recipient/message requires a new approval. |
| No reply | Check thread, applicable requested waiting period and suppression | At most the planned approved follow-up. Silence is not rejection or permission for repeated cross-channel contact. |

Pitch emphasis depends on the work. Sponsored distribution: actual audience fit, dated reach/engagement and a relevant concept. UGC production: relevant portfolio, craft, deliverables and usage scope; a large audience is not automatically necessary. Affiliate: audience purchase intent and suitable formats; do not invent conversion results. Ambassador: authentic connection, community and ongoing capacity. General outreach: concise introduction, specific reason for this brand, one concept, one or two strong evidence links, one clear next step. Avoid attaching an unsolicited large deck by default; include a kit if useful or requested. Do not claim the creator uses or loves a product without evidence from the creator.

Form assistance must be useful beyond a link: map exact fields to creator-approved facts and draft answers in their voice, respect word limits, select relevant posts, and batch only the essential unknown questions. Unknown demographics, residence, age, availability or product experience must be asked when required, not inferred. Addresses, identification, banking/tax details and legal attestations are entered/reviewed by the creator. Do not auto-check marketing consents. If approved browser/API form submission is added later, review the exact answers, attachments, destination and attestations before submission; retain the confirmation and reconcile uncertain outcomes before retrying.

Proposed skill decision sequence:

1. Understand current user intent and check existing relationship/approvals.
2. Fetch official opportunity instructions within the research budget.
3. Classify opportunity type, fit, eligibility and preferred route from sources.
4. Select the matching branch above. Missing evidence leads to clarification or a handoff, not guessed data.
5. Draft the appropriate artifact from approved creator facts; explain fit and one next action in chat.
6. Ask only for essential missing information, then approval of the final external action where supported.
7. Execute through a restricted tool; update state only from the tool result or a labelled user report.
8. Handle reply/confirmation through the same process; close or pause when appropriate.

This requires both a reasoning skill and code-level checks. Proposed tools: research_opportunity, inspect_application, draft_application_answers, draft_pitch, prepare_dm_handoff, request_outreach_approval, send_approved_email and sync_relationship. Tools return source-backed structured results plus supported actions. The sending tool validates creator ownership, exact approved revision/recipient, connection, entitlement and suppression. The model alone cannot authorize sending.

Maintain discovery state separately from outreach state. Example outreach states: drafting, needs_user_info, ready_for_review, approved, sending, sent, submission_reported_by_user, submitted_confirmed, replied, declined, failed, unknown. Opening a link is not submission; preparing a DM is not sending; a send acceptance is not delivery; interest is not a signed deal. Store source IDs and timestamps for outcomes.

Evaluate the workflow with fixtures for each route and failure branch: customized form vs generic pitch, required missing field, inaccessible form, closed program, incompatible compensation, wrong region, irrelevant PR address, new referral, edited approval, missing mailbox, opt-out, duplicate send, uncertain send/submission and malicious instructions in a page/email. Separately review draft quality across beginner/established creators and UGC/sponsorship/affiliate goals. No live brand messages or submissions are needed for this design validation.

Activation happens when the creator asks for help with partnerships, not in everyone's initial setup. Learn only missing details through chat: previous partnerships, brands they use, work they want (sponsored distribution, UGC production, affiliate, gifting, events), regions, exclusions, paid-only preference and capacity. UGC and sponsorship are distinct: a small audience does not imply low production value. Do not quietly substitute unpaid offers for a paid-work goal.

Example: Maya surfaces two actual sourced candidates, explains why each fits this creator, and proposes a content angle. The user chooses one. Maya researches the best available business contact and drafts a short specific pitch. The creator sees recipient, sender, subject, full text, links and any attachments before approving. "Looks interesting" approves continued research, not sending. "Send that pitch to this contact" approves the displayed immutable revision. The user can manage the relationship through Messages; secure OAuth still happens on the web.

## Discovery: web search is needed

The model should rank evidence, not invent a directory of brands. Use a search API from server-side Convex actions. My starting choice is Tavily Search plus Extract, behind a replaceable client. Enable an account/API key, store TAVILY_API_KEY as a backend secret, register budgeted tools, and test on fixtures before live queries. Codex browsing access does not give the deployed Maya app web search.

For each research run:

1. Load creator-owned goals, preferences, posts, dated performance, existing partnerships and exclusions. Separate public facts used in search from private context used only in ranking. Never send the user's inbox, rates, phone number or full personal memory to a search provider.
2. Seed candidates from products the creator explicitly uses, user-supplied dream brands, actual prior collaborators, and category/region searches. Discover additional candidates from public creator programs and credible campaign evidence. Examples: `trail running brands creator program US`, `site:brand.example partnerships`, `brand.example influencer marketing contact`. A sponsored post is evidence of past activity, not an open budget.
3. Resolve each brand to its canonical website/domain; deduplicate aliases, parent companies and agencies. Fetch official program/contact pages. Store source URL, excerpt, retrievedAt, stated campaign dates, compensation type and confidence for each factual claim. Search snippets alone cannot substantiate an opportunity.
4. Apply hard exclusions first: geography, expired application windows, prohibited categories, incompatible terms, existing exclusivity, explicit no-contact, or unpaid-only when the creator requires payment.
5. Rank remaining candidates with a proposed rubric: authentic creator fit 30%, specific content concept 25%, audience/region fit 20%, dated evidence of creator activity 15%, reachable contact 10%. Unknown demographics remain unknown; follower count alone never rejects a creator. These weights are hypotheses to tune against user acceptance.
6. Return two or three strong candidates at a time, each with why-this-creator, evidence, missing information and the next action. Cache reusable public brand research separately from each creator's private ranking. Refresh contact validity before sending and time-sensitive campaign evidence before recommending.

A bounded run might use five basic searches and ten page extractions; contact enrichment happens only for shortlisted brands. Use hard call, token, time and dollar limits with a checkpoint per step. Do not let the writer recursively browse without a budget.

Tavily currently lists $0.008 per pay-as-you-go credit: basic search costs one credit, advanced two, basic extraction one per five successful URLs. The example run therefore uses seven credits, or $0.056 before model work. [Tavily pricing](https://docs.tavily.com/documentation/api-credits).

## Finding an actual contact email

Use a sequence, stopping as soon as we have an appropriate route:

1. An existing creator-owned email conversation with that brand, if connected and within the chosen business-mail scope.
2. The official creator application form or explicitly published partnerships address. Respect the brand's specified application route; a support or press mailbox is not automatically suitable.
3. A named influencer/creator marketing or partnerships employee with current evidence of role and company. Agencies are candidates only when there is evidence they represent this brand.
4. A contact-data API, initially Hunter behind an adapter: domain search for relevant functions, then Email Finder with a verified name/domain if needed, then verification before sending. Do not synthesize `firstname@domain` in the model.
5. If no suitable contact is found, show the official application route or mark contact unavailable. Never manufacture an email or label a catch-all result "verified".

Store separately: identity/role evidence; email discovery source; provider; verification status and date; catch-all flag; source URL; confidence; suppression status. Deliverability is not evidence the person handles partnerships or welcomes pitches. Reject invalid/disposable results and hold unknown/catch-all for review. Re-verify stale addresses before a send. A new contact's existence is never consent to any unrelated channel.

Hunter documents Finder at one credit for a found email and verification at half a credit. Its help page and pricing page differ in how domain-search credits are described; use conservative metering until the purchased API contract resolves this. Its advertised outreach-plan price is not proof that customer-facing SaaS redistribution and shared caching are licensed. Obtain appropriate API terms/quote before enabling production use. [Hunter API](https://help.hunter.io/en/articles/1970956-hunter-api), [pricing](https://hunter.io/pricing).

## Email connection, sending and replies

Build a Gmail adapter first, with Microsoft as a later adapter. ClawMessenger is the Maya-to-creator channel; it does not grant Gmail access. Zernio is the social-account adapter, not an email finder or Gmail connection.

Use Google OAuth with state binding to the signed-in creator, encrypted server-side refresh tokens, disconnect/revocation, and least-privilege scopes. For full inbox/reply awareness, propose gmail.readonly plus gmail.send; drafts can live in Maya's database so we need not request Gmail draft management. Gmail send is sensitive; readonly and compose are restricted. A public app needs the applicable verification, and server-side restricted-data handling requires the applicable security assessment. A label filter limits our ingestion, not the scope of the OAuth permission. Do not present it as Gmail enforcing access only to one label. [Google scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [restricted-scope review](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification).

Start with a creator-selected business mailbox or explicit business label. Backfill a bounded recent period and known approved pitch threads; do not import their entire personal inbox into the creator profile. Separate private deal memory from public creative identity. Treat emails and web pages as untrusted data: they cannot authorize sending, change recipients or request secrets.

Subscribe using Gmail watch and Cloud Pub/Sub. Persist historyId; process history incrementally; dedupe by provider message ID; renew watches daily, and recover an expired history cursor through bounded resync. Google requires renewal at least every seven days. Notifications trigger a fetch; they are not the email itself. [Gmail push guide](https://developers.google.com/workspace/gmail/api/guides/push).

Persist each approval against a hash of the exact draft, recipients, sender and attachments. An edit invalidates approval. Reserve the action transactionally, recheck current entitlement/approval/suppression, then send via the user's mailbox. Maintain queued → sending → sent/failed/unknown states. Provider acceptance is "sent", not proof of delivery. Gmail does not provide a universal exactly-once-send guarantee: on ambiguous timeout, reconcile with provider records before any resend; keep unknown cases for review. Never blindly retry a paid or reputational action.

Before a follow-up, re-fetch the thread and check for any reply, bounce, rejection or opt-out. Stop sequences on those events, a revoked account, or a changed draft. A reply requires a new response draft; it is not permission to negotiate or accept terms. Track commitments and deadlines only when there is evidence of agreement. No open-tracking pixel is needed to launch.

For a smaller pre-inbox pilot, allow copyable pitch drafts and user-forwarded brand replies. A send-only Gmail integration can send approved pitches, but cannot honestly offer complete reply awareness or unattended follow-ups. Do not market the smaller pilot as the full mailbox feature.

## Social DMs

Discover capabilities per connected account and validate before each action. Zernio's create-conversation endpoint currently supports X, Bluesky, Reddit and WhatsApp; this is not a cold-Instagram-DM endpoint. Existing conversations and eligible replies are a separate operation with platform constraints. For unsupported initiation, provide a copyable draft or email/application route. [Start conversation](https://docs.zernio.com/messages/create-inbox-conversation), [send in an existing conversation](https://docs.zernio.com/messages/send-inbox-message).

## Fit with the existing codebase

Reuse Convex jobs/scheduler for durable steps, core costEvents/budgets for spend, core messages/deliverMessage for creator notifications through Claw, and the current memory/source-validation patterns. Proposed modules: partnerships/discover, qualify, contacts, drafts, approvals, send, sync, followups; integrations/tavily, hunter and gmail. No separate OpenClaw runtime is needed.

Proposed records:

| Record | Important fields |
|---|---|
| brandResearch | canonical domain, public evidence, expiry; shared only where vendor terms allow |
| opportunities | creatorId, brand, fit evidence, goal sources, compensation type, status |
| businessContacts | appropriate role, verified email, evidence, freshness, suppression |
| outreachDrafts | creatorId, exact content, recipients, revision/hash, approval source |
| outreachActions | idempotency key, state, provider IDs, timestamps, failure/unknown reason |
| dealThreads | creatorId, mailbox/thread IDs, participants, outcome, agreed terms, next action |
| mailboxConnections | creatorId, encrypted credential reference, scopes, cursor, watch expiration |

Every private query/mutation validates creator ownership. Keep credentials out of writer context and logs. Account deletion/export must cover new private records and provider disconnection; forgetting must invalidate derived relationship summaries. Suppression records need an explicit minimal-retention policy so deletion does not accidentally re-enable unwanted contact.

Before cold outreach launch, implement truthful sender/subject, the applicable commercial-message disclosures, postal-address and opt-out handling, and suppression. US CAN-SPAM covers B2B messages too; geography-specific requirements need review before enabling other markets. Finding a public email is not a universal permission to market to it. [FTC business guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business).

## Costs and the proposed $29.99 price

The existing sprint plan §3.6 estimates $3.70 core cost at 200 creators before Zernio and the later phone/image additions. It is a planning estimate, not measured production cost. The later log adds about $1.60 for frames at the cap. Keep both visible instead of treating the old $6.40 total as all-in.

Current Zernio graduated rates produce $418/month for 200 connections, $618 for 400, and $2,218 for 2,000: respectively $2.09 per creator at 200 one-account users, $3.09 at 200 two-account users, and $2.218 at 1,000 two-account users. Counts aggregate across our team, not a fresh free allowance per creator. These differ from the old 200-user estimate. Confirm the actual account's legacy/contract terms before changing financial forecasts. [Zernio pricing](https://docs.zernio.com/pricing).

Claw agency is $199/month per subtenant/sending line with 1,000 included messages and $0.005 overage. Our implementation uses a central relay and creator-owned phone routing. IF one approved line can serve 200 creators sending/receiving six billable messages each per day for 30 days, the allocation is ($199 + (36,000 - 1,000) × $0.005) / 200 = $1.87. This is conditional on vendor permission, routing limits and the actual billing unit; split bubbles/retries and chat volume matter. One dedicated subtenant per creator is $199 before usage and cannot fit these retail prices. Do not provision it that way. [Claw agency terms](https://www.clawmessenger.com/agency-docs).

Illustrative 200-creator base cost: $3.70 core + $1.60 frames + $1.87 conditional shared phone + $2.09/$3.09 social = $9.26 single / $10.26 dual. This excludes payment fees, support, tax, acquisition, compliance and any missing infrastructure. At the proposed retail prices that is roughly 54% / 59% contribution before those exclusions. It is not a validated gross-margin forecast.

Target partnership increment: at most $2.50/user/month initially. Example explicit budget: 50 basic searches + 100 extracted pages = $0.56 at Tavily PAYG; 20 Hunter credits budgeted at an ASSUMED $0.025 each = $0.50 (not a verified API quote); $0.75 reserved model spend; $0.40 extra Claw traffic (80 messages at marginal $0.005); $0.25 storage/jobs = $2.46. Verification retries, subscription minimums and mailbox/security costs can exceed this. The $5 upgrade adds only $2.54 before payment/support/compliance at that usage. With the illustrative $10.26 dual base, partnership mode reaches $12.72 cost and about 58% contribution at $29.99 before exclusions.

Conclusion: $29.99 is plausible for tightly bounded discovery and outreach assistance, subject to contracts and measured pilot spend. It is not yet validated for an unlimited autonomous business manager. Enforce vendor budgets before calls, record usage and reconcile invoices. Evaluate the 95th-percentile active user, not just blended averages. Amortize fixed security/vendor minimums over partnership subscribers, not every core subscriber.

## Delivery sequence and acceptance

1. Offline evidence fixtures and discovery only: test expired campaigns, no relevant candidates, UGC vs distribution, paid-only, wrong agency and duplicate brands. Manually evaluate 30 creator/brand matches across audience sizes.
2. Contact research and drafts: test wrong roles, stale contacts, catch-all/unknown, no contact, unsupported DMs and invented metrics. Confirm API licensing and actual unit cost.
3. Approved email pilot after OAuth readiness: test two creators with the same brand, cross-account access refusal, duplicate approval/replayed jobs, changed draft, timeout reconciliation and disconnect-before-send. Do not send real brand pitches during engineering tests.
4. Reply sync and follow-ups: test reply arriving just before send, opt-out, bounce, expired watch, revoked token, corrupted cursor, provider outage and recovery.
5. Only then enable the entitlement/prices and a measured pilot. Review accepted matches, useful drafts, correct-contact rate, bounces, replies, positive replies, actual deals and spend. Do not attribute a deal to Maya without thread/user evidence.

Open commercial dependencies: shared Claw line approval/capacity; actual Zernio contract; contact-data API licensing/quote; Gmail verification/security-assessment scope and cost. These need resolution before promising the complete $29.99 offering.
