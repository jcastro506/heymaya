# Creator Maya for Consumer App Distribution Plan

Date: 2026-05-04

## Summary

The sharpest first wedge is not broad "startups." It is consumer app builders who can now build quickly but have no distribution. They are often indie builders, vibe coders, tiny teams, AI app makers, or early consumer/prosumer SaaS founders. Their pain is specific: they can ship a product, but they do not know how to get the first audience, users, comments, waitlist signups, installs, or launch momentum.

Creator Maya for this segment should be a single product, not a two-tier Coach/Manager decision. The buyer is not trying to buy "advice" versus "autonomy"; they are trying to hire a distribution operator who lives in iMessage, learns the product, turns raw demos/screenshots into social assets, runs TikTok + X experiments, and keeps improving based on what is working.

Recommended public shape:

- Product: Maya for Consumer App Distribution
- Landing-page category: "For builders" or "For app builders" is sharper than "For startups." Use "startups" in supporting copy, not as the top nav label.
- Tiering: one startup tier
- Internal behavior: use Manager-level autonomy gates with stricter approval defaults
- Initial price posture: one flat monthly price, likely beta-priced at $149/mo or production-priced at $199/mo
- First-platform scope: TikTok + X
- V0 publishing posture: visible, approval-first automation. Maya can plan, draft, edit, generate, queue, and report automatically, but she should not post publicly "without them knowing." X can graduate first to approved-send through Composio. TikTok should start as draft/edit/handoff until direct auth/API behavior is fully verified.

The existing Creator Maya backend already contains most of the learning loop: posts, metrics, hook library, content plans, trend observations, competitor observations, daily briefs, weekly reviews, and action logs. The consumer-app work should add a startup/app-builder mode and tables around product context, launch stage, distribution experiments, conversion goals, and app/product content sources. It should not reuse the service-business pipeline.

## Landing Page Flow Recommendation

Top-level public framing:

- Primary nav/card label: "For app builders" or "For consumer apps"
- Avoid making "For startups" the first label unless we intentionally want a broader buyer. Many of these users may call themselves builders, indie hackers, vibe coders, or founders before they call themselves startups.
- Supporting line can still say "for consumer startups, indie builders, and tiny teams."

Recommended hero/flow:

- "Text Maya your app. She turns it into a TikTok + X distribution engine."
- "Built something useful but have no audience? Maya learns your product, writes the hooks, turns demos into posts, tests angles, reads the signal, and tells you what she is doubling down on."
- Flow: connect app/site + handles -> text Maya screenshots/demo -> approve the weekly experiment plan -> Maya creates TikTok scripts/assets and X posts/replies -> light UI shows drafts, approvals, experiments, and results.

Landing page should show one concrete loop, not a generic social manager:

1. "Send Maya your app link and a demo clip."
2. "She studies your product, users, competitors, TikTok/X examples, and your voice."
3. "She proposes this week's distribution experiments."
4. "She drafts TikToks, edits clips, writes X posts/replies, and asks for approvals in iMessage."
5. "She tracks what worked and doubles down next week."

This is the first marketable flow. Creator Maya can still have "For creators" beside it, but the second card should probably become "For app builders" rather than "For businesses" or generic "For startups."

## Research Inputs

External sources reviewed:

- Hootsuite's 2026 social media management guide frames the job as strategy, brand voice, analytics, community, content, trend monitoring, and business-goal alignment. Source: https://blog.hootsuite.com/social-media-management/
- Hootsuite's social media tool guide lists the core tool surface as scheduling, publishing, collaboration, analytics, social listening, AI help, unified inbox, integrations, and media library. Source: https://blog.hootsuite.com/social-media-management-tools/
- Buffer's 2026 feature matrix shows the practical expectations for a modern social manager tool: scheduling, calendar, campaign tags, UTM parameters, AI assistant, analytics, reports, approvals, and engagement. Source: https://support.buffer.com/article/595-features-available-on-each-buffer-plan
- Sprout's pricing/features show that serious social management products charge per seat/profile and push advanced value into reporting, listening, UTMs, approvals, and social intelligence. Source: https://sproutsocial.com/de/pricing/
- YC advice emphasizes early launch, analytics, knowing where first users come from, and learning from a minimal v0 instead of overbuilding. Sources: https://www.ycombinator.com/blog/the-biggest-mistakes-first-time-founders-make/ and https://www.ycombinator.com/blog/tips-ship-early-and-often
- YC launch/funding PR guidance highlights the launch assets startups need: hard news, traction, credibility, uniqueness, media kit, screenshots, logos, founder context, demo videos. Source: https://www.ycombinator.com/blog/a-guide-to-pitching-funding-and-launch-stories/
- OpenClaw docs confirm that workspace files such as `AGENTS.md`, `SOUL.md`, `TOOLS.md`, `HEARTBEAT.md`, and `MEMORY.md` are the durable agent context, and standing orders should define scope, triggers, approval gates, and escalation rules. Sources: https://docs.openclaw.ai/concepts/agent-workspace and https://docs.openclaw.ai/automation/standing-orders
- Composio docs confirm tools execute with connected user credentials, sessions can discover/manage/auth/execute tools, and Twitter/Instagram/TikTok toolkits exist with different auth maturity. Sources: https://docs.composio.dev/docs/tools-and-toolkits, https://docs.composio.dev/toolkits/twitter, https://docs.composio.dev/toolkits/instagram, https://docs.composio.dev/toolkits/tiktok
- ScrapeCreators supports public-data scraping across TikTok, Instagram, Twitter/X, LinkedIn, YouTube, Reddit, Threads, and more; it exposes profiles/posts/metrics/comments/transcripts depending on platform. Sources: https://scrapecreators.com/, https://docs.scrapecreators.com/v3/tiktok/profile/videos/, https://scrapecreators.com/instagram-api, https://scrapecreators.com/twitter-api

## Codebase Findings

The current creator pricing UI is explicitly two-tier:

- `app/creators/_components/Pricing.tsx` defines `Coach` at $19.99/mo and `Manager` at $49.99/mo.
- The copy says: "One social media manager. Two pricing tiers, set by how much autonomy you want her to have."
- That split works for individual creators, but it is the wrong mental model for startups.

The Convex plan model already treats Coach versus Manager as an autonomy boundary:

- `convex/lib/planFeatures.ts` says the boundary is autonomy, not platform breadth or thinking budget.
- Both creator tiers already reach all five social platforms.
- Manager unlocks autonomous brand email/outreach/pitching behaviors.

The canonical creator schema already has much of the startup social loop:

- `posts` supports TikTok, Instagram, YouTube, LinkedIn, and X.
- `postMetrics` stores time-series performance.
- `dailyBriefs` and `weeklyReviews` store ongoing reads.
- `hookLibrary` stores extracted patterns.
- `contentPlans` stores the weekly content arc.
- `trendObservations` and `competitorObservations` support social listening and peer tracking.
- `mayaActionLog` gives an audit trail.

The current v0 onboarding and OpenClaw deployment are TikTok-first:

- `components/creatorMayaV0/MvpConsole.tsx` has setup steps: account, TikTok, calendar, creator picture, phone, handoff.
- `convex/creatorMayaV0/backend.ts` creates Creator Maya accounts with `accountType: "creator"` and defaults to `tier: "coach"`.
- `convex/creatorMayaV0/workspaceManifest.ts` writes a workspace that says Maya is a TikTok-first social media manager, iMessage-only, never auto-posting.
- The v0 manifest has useful files and jobs, but needs a startup-specific variant.

The ScrapeCreators pipeline is a strong fit:

- `convex/integrations/scrapeCreators/runFullScrapePull.ts` already accepts handles for TikTok, Instagram, YouTube, LinkedIn, and X.
- It pulls profile plus recent posts in parallel.
- TikTok gets deeper transcript/comment analysis on top posts.
- For startups, we should collect X, Instagram, and TikTok handles, then use the same pipeline with startup-specific synthesis.

The Composio layer is partly ready:

- Existing wrappers already cover Twitter/X and LinkedIn for the internal Riley growth agent.
- Composio's current OpenClaw toolkit pages for Twitter/X and TikTok advertise managed OAuth, API key handling, token refresh, and scopes.
- The OpenClaw plugin path is `@composio/openclaw-plugin`, configured with `plugins.entries.composio.config.consumerKey`.
- Our deploy code conditionally installs and configures that plugin when `COMPOSIO_CONSUMER_KEY` is present.
- Our Convex typed wrapper layer currently has X/Twitter action wrappers, but no TikTok typed wrappers yet.
- Our existing Composio OAuth helper currently allows Gmail, Stripe, Calendar, Apollo, and Hunter; it does not yet allow Twitter or TikTok as first-class app OAuth providers.
- Startup Maya should not assume full direct posting across all three platforms until auth and API behavior is proved in the app.

For the TikTok + X consumer-app wedge:

- X is closer to automation-ready because the repo has Composio wrapper functions for posting, recent search, tweet lookup, liker lookup, user lookup, liking, retweeting, and timeline reads.
- TikTok is available through Composio's OpenClaw plugin docs for upload, publish, list videos, user info, user stats, and publish-status checks, but this repo has not wrapped or tested those actions yet.
- TikTok is currently strongest in our repo as intelligence/editing/handoff: ScrapeCreators TikTok profile/video/comment/transcript pulls plus Creator Maya media/edit request tables.
- The V0 product should promise "Maya runs the distribution loop" rather than "Maya silently posts everywhere." The loop can be highly automated while still showing plans, approval prompts, drafts, edits, and results.

Composio keys/accounts needed:

- `COMPOSIO_API_KEY`: required for our Convex HTTP action runner.
- `COMPOSIO_BASE_URL`: optional override; defaults in code if absent.
- `COMPOSIO_CONSUMER_KEY`: required for OpenClaw runtime plugin registration. Without it, the Maya machine skips installing/configuring `@composio/openclaw-plugin`.
- Provider auth config ids if we use our hosted OAuth flow: add `COMPOSIO_AUTH_CONFIG_TWITTER` and `COMPOSIO_AUTH_CONFIG_TIKTOK`, then extend the provider validator, plan feature allowlist, connected-account schema, and frontend connect buttons.
- Connected user accounts: each builder must connect their own X/Twitter and TikTok accounts in Composio before Maya can act with those credentials.

Composio smoke tests required before launch:

- OpenClaw boot with `COMPOSIO_CONSUMER_KEY` set and verify the plugin registers Twitter and TikTok tools.
- X: authenticate a test account, get authenticated user, search recent tweets, create a private/test post, lookup post metrics, like/unlike or reply behind an approval gate.
- TikTok: authenticate a test account, get user basic/profile/stats, list videos, upload a test video, fetch publish status, and only then test publish on a throwaway account.
- Confirm failed auth returns an actionable connect prompt in iMessage/UI, not a raw tool error.
- Confirm Maya's approval layer blocks direct post/publish calls unless a specific draft/action was approved.

The Creator HQ can mostly be reused with new labels:

- Today already shows brief, top move, pending items, revenue/outliers, and stage-aware context.
- Plan already renders a weekly content arc across platforms.
- Performance already filters by TikTok, Instagram, YouTube, LinkedIn, and X.
- For startups, "revenue/deals" should become conversion, leads, launch, or learnings depending on stage.

Do not reuse the service-business pipeline:

- `app/business`, `app/onboarding/business`, and `(business)` routes are service-business/trades oriented.
- Startup Creator Maya should remain in the creator product family because the user explicitly means Creator Maya and wants social manager behavior, not local-business lead/review management.

## Readiness Assessment

Maya is not ready to launch this consumer-app distribution product today, but the codebase has unusually strong building blocks. The missing work is productizing the loop for this audience, not inventing it from zero.

Already present:

- TikTok-first Creator Maya onboarding, workspace generation, iMessage posture, and OpenClaw deploy path.
- ScrapeCreators public-data pull for TikTok, Instagram, YouTube, LinkedIn, and X.
- Deeper TikTok analysis through recent videos, comments, and transcript support.
- Core Convex tables for posts, metrics, content plans, hook library, trend observations, competitor observations, daily briefs, weekly reviews, and action logs.
- Creator media asset and edit-request tables for images/videos, consent, cataloging, derived assets, render state, and TikTok handoff.
- Existing Maya skills for platform best practice, content arc planning, hook extraction, pre-post scoring, voice application, citation firewall, cross-posting, and platform algorithm research.
- Composio X wrappers for read/search/post/reply-like actions.
- A light Creator HQ surface that can be adapted into Today, Plan, Drafts, Experiments, Assets, Approvals, and Results.

Not ready yet:

- No app-builder-specific onboarding flow.
- No consumer-app/startup profile schema wired into Convex.
- No startup/app-builder OpenClaw workspace manifest.
- No TikTok + X distribution playbook specialized for zero-audience consumer apps.
- No startup/app-builder crons/jobs file wired to OpenClaw.
- No approved-send policy layer for X posts/replies.
- No verified direct TikTok publishing path; use draft/edit/handoff first.
- No team iMessage group thread setup for app teams.
- No app-builder asset rights/claims guard implemented as runtime policy.
- No landing-page flow or UI copy for this wedge.

Launch readiness bar:

- Onboard one app with app link, goal, audience, demo/screenshot assets, TikTok handle, X handle, and approval mode.
- Maya produces a startup/app readback in iMessage.
- Maya creates a 7-day TikTok + X experiment plan.
- Maya stores the plan, drafts, source assets, approvals, and action log in Convex.
- Maya can produce TikTok scripts/edit plans and X posts/replies.
- Maya can ingest user-sent assets, catalog them, and create edit/generation requests.
- Maya sends approval prompts in iMessage and shows them in the light UI.
- Maya reads public post performance and updates weekly learnings.
- X approved-send is smoke-tested behind a strict approval gate.
- TikTok remains handoff-only until direct publishing is proven.

## Product Recommendation

Ship one startup tier.

Reasoning:

- Startups do not want to choose between an advisor and a manager. They want "hire Maya to run social."
- The two-tier creator split is about personal autonomy comfort and cost. Startup buyer psychology is simpler: "Will this make our product story and social execution better?"
- A single plan reduces onboarding and pricing friction.
- Internally, the startup tier can still use usage controls, approval gates, and feature flags without exposing tiers.

Recommended product copy:

- "Hire Maya as your consumer app distribution agent."
- "She learns your app, founder voice, target user, competitors, and launch goal. Then she plans, drafts, edits, tests, reports, and doubles down on what works across TikTok and X."
- "Approval-first by default. More autonomy once she earns it."

Pricing recommendation:

- Beta: $149/mo, 14-day trial, limited cohort.
- Production: $199/mo, 7-day trial.
- Keep annual later; early startup users are better validated monthly.

This is intentionally above Creator Manager ($49.99/mo) because startup accounts require more context, more platforms, more reporting, more business-goal reasoning, and potentially more API usage. It is still far below serious social-management seats like Sprout/Hootsuite and below hiring a human SMM.

## Startup Stage Model

Add startup-specific stages instead of reusing creator career stages.

Recommended enum:

- `idea_or_validation`: has thesis, no public product yet
- `pre_launch`: product in progress, building audience/waitlist
- `launching`: active launch window, Product Hunt/YC/press/community push, high need for cadence
- `early_traction`: has users/customers and needs proof/case studies/use cases
- `growth`: scaling channels, hiring, fundraising, partnerships, category leadership

Stage drives Maya's goal hierarchy:

- Idea/validation: learn ICP pain, test problem angles, gather comments/questions, build founder credibility.
- Pre-launch: build waitlist, educate the market, test positioning, build "why now" narrative.
- Launching: coordinate campaign assets, daily launch posts, demos, objections, social proof, founder asks.
- Early traction: turn customer feedback and product usage into proof, tutorials, case studies, comparison posts.
- Growth: amplify wins, hiring/funding narratives, category POV, partner/customer stories, repeatable campaigns.

## Onboarding

Keep onboarding short enough to complete in one sitting, but structured enough that Maya can operate.

Required fields:

- Startup name
- Website or product URL
- Stage
- Current 90-day goal
- Primary CTA: waitlist signup, demo booked, trial start, install, purchase, community join, hire, fundraise awareness
- CTA URL
- Target ICP
- Category and competitors/alternatives
- Founder/company voice sources: founder X handle, company X handle, Instagram, TikTok, LinkedIn optional, website/blog/docs
- Platforms to operate first: X, Instagram, TikTok
- Existing assets: screenshots, demos, customer quotes, changelog, blog posts, launch media kit
- Brand constraints: claims not to make, regulated topics, words to avoid, tone preference
- Approval preference: draft-only, approve-to-post, or trusted replies later

Nice-to-have fields:

- Launch date or milestone date
- Product Hunt/YC/press plans
- Top communities: Hacker News, Reddit, Discord, LinkedIn groups, Slack communities, etc.
- Weekly founder availability for recording or reviewing content
- Competitor handles
- Customer proof bank

Onboarding flow:

1. Account and plan: one startup tier.
2. Company context: name, website, stage, 90-day goal, CTA.
3. Audience and positioning: ICP, category, alternatives, core promise.
4. Platforms: X, Instagram, TikTok handles; connect OAuth only where needed.
5. Voice pull: founder/company handles plus website/blog copy.
6. Proof/assets: upload or link demo, screenshots, customer quotes, launch kit.
7. Readback: Maya summarizes stage, voice, ICP, goal, content pillars, risks.
8. Approval rules: what Maya can draft, queue, send, reply to, or never do.
9. Deploy OpenClaw workspace.

## Backend Plan

Do not replace the current creator `plan` enum immediately. Add a product/use-case layer.

Recommended schema additions:

### `creators`

Add optional fields:

- `creatorKind`: `"individual" | "startup"`
- `billingProduct`: `"creator_coach" | "creator_manager" | "startup_social_manager"`

For startup accounts:

- `accountType` remains `"creator"` or a new `"startup"` only if the codebase can absorb the enum safely.
- `plan` can be set to `"manager"` internally so existing autonomy helpers remain compatible.
- `billingProduct` controls Stripe/product UI.

### `startupProfiles`

New table keyed by `creatorId`:

- startupName
- websiteUrl
- stage
- category
- oneLinePitch
- productSummary
- targetIcp
- primaryGoal
- primaryCta
- ctaUrl
- competitors
- alternatives
- positioningNotes
- launchDate
- brandConstraints
- approvalMode
- createdAt, updatedAt

### `startupSocialAccounts`

Either extend `creatorHandles` or add a startup-flavored table:

- creatorId
- platform: x, instagram, tiktok
- handle
- role: company, founder, competitor
- source: manual, scrape, oauth
- connectedAccountId if applicable
- verifiedAt

### `startupExperiments`

This is the core learning-loop table:

- creatorId
- goal
- hypothesis
- stage
- platform
- angle
- format
- hookPattern
- cta
- plannedPostIds
- publishedPostIds
- metricWindow
- successMetric: signup, demo, click, reply, follower, engagement, save, share
- baseline
- result
- decision: double_down, iterate, stop, inconclusive
- lesson
- createdAt, reviewedAt

### `startupConversionEvents`

V0 can be manual or UTM/webhook-based:

- creatorId
- eventType: waitlist_signup, demo_booked, trial_start, install, purchase, reply, application, custom
- sourcePlatform
- postId optional
- campaignId or experimentId optional
- utmSource, utmMedium, utmCampaign
- occurredAt
- metadata

### `startupContentSources`

Maya needs raw material:

- creatorId
- kind: screenshot, demo_video, changelog, customer_quote, support_ticket, blog_post, docs_url, founder_note, press_asset, product_asset, generated_asset, edited_asset
- title
- url/storageId
- text
- sourceAssetIds optional
- tags
- usableClaims
- restrictions
- consent: unknown, approved_for_this_request, approved_for_reuse, rejected
- generatedBy optional
- generationPrompt optional
- editRequestId optional
- createdAt

### Startup media asset plan

Creator Maya already has a useful media foundation:

- `creatorMayaV0MediaAssets` stores image/video/audio/other assets, source, bytes, mime type, dimensions, duration, hash, consent, catalog metadata, derived asset links, usage history, and archive state.
- `creatorMayaV0EditRequests` stores source assets, rendered output asset, request text, target platform, edit plan, TikTok handoff, status, and review state.
- The current sources include `imessage`, `web_upload`, `openclaw_attachment`, `rendered_variant`, and `seedance_reference`.

For startup Maya, reuse this machinery at first rather than creating a separate media stack. The table names can stay v0-specific in the first implementation, but the product layer should treat them as a shared Maya asset library. Later, rename or wrap them behind generic APIs like `mayaMediaAssets` and `mayaMediaEditRequests`.

Media inputs Maya should support:

- iMessage attachments from founder DMs and team group threads.
- Web uploads during onboarding and the startup console.
- Product screenshots, app store screenshots, landing page screenshots, demo clips, screen recordings, founder talking-head clips, customer quote screenshots, press kit assets, logo/brand kit files, and launch visuals.
- Links to docs, landing pages, changelogs, launch pages, and customer stories that Maya can turn into asset briefs.
- Generated assets created by Maya.
- Edited variants derived from user-provided or generated assets.

Asset cataloging requirements:

- Store the original asset immutably.
- Compute content hash and dedupe when possible.
- Capture uploader/team member, source thread, source message id, and consent state.
- Extract dimensions, duration, mime type, detected text/OCR, transcript for videos when available, visual summary, product surface, people/faces presence, brand elements, sensitive data risk, and suggested uses.
- Tag by startup use case: demo, feature, proof, objection, launch, founder, customer, announcement, tutorial, comparison, meme/reference, evergreen.
- Track platform fit: TikTok, Instagram Reels, Instagram carousel, X image/video, website/press, internal-only.
- Track restrictions: do not reuse, blur customer data, do not show pricing, do not show unreleased feature, do not use customer name, no paid ads, no generated likeness.

Maya media actions:

- Select the best asset for a planned post.
- Ask for missing raw material when a content plan needs a demo, screenshot, founder clip, or proof point.
- Edit user-provided video: trim, crop to 9:16, add captions, add hook text, cut dead air, combine clips, add b-roll/product screen inserts, add safe outro/CTA, export platform-ready variants.
- Edit images: crop, resize, annotate, redact sensitive information, compose carousel frames, turn quotes into branded cards, make launch graphics, create thumbnails/cover frames.
- Generate images when source assets are missing: product concept visuals, explainer graphics, meme/reference-style concepts, launch countdown graphics, carousel backgrounds, thumbnail options, and visual metaphors.
- Generate video only with strong constraints: scripts, storyboards, shot lists, text-motion explainers, product-demo assemblies, generated b-roll, and simple animated assets. Do not generate a founder/customer likeness or testimonial-style video without explicit approval and source consent.
- Create derivative variants for testing: hook A/B, cover A/B, caption overlay A/B, CTA A/B, first-three-seconds variants, and platform crops.

Approval rules:

- Maya can catalog and suggest usage automatically.
- Maya can draft edit plans automatically.
- Maya should not publish or externally send generated/edited media without explicit approval.
- Any asset using customer proof, private product surfaces, unreleased features, claims, or a person's likeness requires owner approval.
- Generated media should be labeled internally as generated, with prompt/model metadata preserved.
- Any edited media should preserve lineage through `derivedFromAssetIds`.

Backend additions for startup media:

- Add startup/team metadata fields or a wrapper table around `creatorMayaV0MediaAssets`: `uploadedByTeamMemberId`, `sourceThreadId`, `assetRole`, `platformFit`, `restrictions`, `approvalStatus`, `brandKitId`, `generationMetadata`, `editLineage`.
- Add a `sourceAssetIds` relationship from content plans, experiments, and approval requests.
- Add status fields for render jobs: queued, rendering, rendered, failed, approved, sent.
- Add a media audit trail for who uploaded, who approved reuse, what Maya generated, what Maya edited, where it was used, and which experiment/post it supported.
- Extend supported target platforms from the current creator editor set to include TikTok first, then Instagram and X.

TikTok-first V0 scope:

- Focus on startup demo clips, screen recordings, founder clips, and product screenshots.
- Let Maya create scripts, shot lists, captions, hook overlays, cuts, crops, captions, and TikTok-ready export variants.
- Let Maya generate supporting stills and cover frames.
- Defer fully autonomous generated video campaigns until the edit/approval loop is proven.
- Keep all publishing approval-first.

### Existing tables to reuse

- `posts`
- `postMetrics`
- `dailyBriefs`
- `weeklyReviews`
- `contentPlans`
- `hookLibrary`
- `trendObservations`
- `competitorObservations`
- `mayaActionLog`

Prefer reusing these where semantics match. Add optional references like `experimentId`, `ctaUrl`, or `businessGoal` to content-plan entries only if needed after the first implementation pass.

## OpenClaw Workspace Plan

Create a startup-specific workspace manifest instead of trying to stretch the TikTok-first v0 manifest.

Options:

1. `convex/creatorMayaV0/startupWorkspaceManifest.ts`
2. `convex/agents/packs/maya_startup/workspace/*`
3. Parameterize the canonical Maya workspace generator with `mode: "creator" | "startup"`

Recommendation: start with option 1 for speed, then migrate to a canonical `maya_startup` pack if it sticks.

Required workspace files:

- `AGENTS.md`: Maya is the startup's social media manager; approval-first; operates across X, Instagram, TikTok; optimizes for the startup's current stage and goal.
- `SOUL.md`: company voice, founder voice, ICP, category, narrative, proof bank, constraints.
- `USER.md`: startup owner/founder contact, timezone, approval rules, CTA, launch dates.
- `TOOLS.md`: ScrapeCreators public reads, Composio social tools, Convex startup tables, media/assets, calendar.
- `HEARTBEAT.md`: daily/weekly operating schedule.
- `DREAMING.md`: learning loop: what worked, what failed, what to test next, what not to repeat.
- `MEMORY.md`: long-term lessons and positioning decisions.
- `jobs.json`: startup social standing orders.

Startup standing orders:

- Morning social brief: current goal, yesterday signal, one move, pending approvals.
- Daily trend and conversation scan: market/category/competitors/ICP language.
- Daily reply/opportunity triage: questions, objections, prospects, partnerships, feature requests.
- Weekly experiment plan: 3 to 5 experiments tied to stage and CTA.
- Weekly content plan: X, Instagram, TikTok variants with platform-native formats.
- Post-performance check: 2h/24h/7d reads versus baseline.
- Weekly learning review: what worked, what did not, why, double-down/iterate/stop.
- Content source mining: turn changelogs, demo clips, customer quotes, support tickets, and founder notes into drafts.
- Launch mode: date-driven campaign if `launchDate` is within active window.

## Startup Team iMessage Plan

Maya should still live in iMessage for startups. The difference is that a startup is a team account, so the messaging surface has to support both founder DMs and a shared team thread.

Current repo state:

- Creator Maya v0 deploys OpenClaw `2026.4.23`.
- The Fly runtime image installs global `openclaw@2026.4.23`.
- The repo package is `@emotion-machine/claw-messenger@0.1.8`.
- The generated OpenClaw config enables `channels["claw-messenger"]` with `preferredService: "iMessage"` and `dmPolicy: "open"`.
- The generated config does not set `groupPolicy`, `groupAllowFrom`, or any per-group mention behavior.
- `npm view openclaw version` currently reports `2026.5.3-1` as the latest stable OpenClaw release, so our runtime is behind the current stable package.
- The installed Claw Messenger package schema defaults `groupPolicy` to `"open"`, while current OpenClaw group docs describe the safer default as allowlisted groups with mention-gated replies. Do not rely on implicit defaults here.
- The standalone `scripts/maya-claw-messenger-bridge.ts` can see inbound `isGroup`, `chatId`, and `participants`, but it replies with `to: from`, so it should not be treated as the startup team path.

OpenClaw and Claw Messenger capability:

- OpenClaw docs say groups are supported across iMessage and other chat surfaces, with separate group sessions.
- OpenClaw docs define group access via `groupPolicy`, group allowlists, and mention gating.
- For iMessage, OpenClaw recommends routing and allowlisting by `chat_id:<id>`, and group replies go back to the same `chat_id`.
- Claw Messenger docs say an existing group is addressed by `chatId`, while a new group can be created by sending to multiple phone numbers.
- The local Claw Messenger package has group support in its schema and compiled channel code: group inbound routes by `chatId`, sets `ChatType: "group"`, and sends replies via `sendToGroup`.

Recommendation:

Keep Claw Messenger as the main iMessage driver. It is the right abstraction for a hosted Maya because it avoids requiring the customer or us to operate a Mac relay. Do not build the startup product on the standalone bridge script.

However, the current Creator Maya v0 config is not enough for startup teams. Before shipping startup Maya, add explicit group configuration and upgrade/smoke-test the OpenClaw runtime:

- Bump the runtime from `openclaw@2026.4.23` to the current stable release if group policy or mention gating is only fully enforced there.
- Keep `@emotion-machine/claw-messenger@0.1.8` unless a newer package exists; as of this plan it is the latest npm package.
- Set `groupPolicy` explicitly instead of relying on defaults.
- In production, use `groupPolicy: "allowlist"` with group allowlist entries once the canonical team `chatId` is known.
- Require mention-style behavior in team groups by default. Maya should listen for context, but only answer when addressed or when sending scheduled briefs/approval prompts.
- Keep founder/owner DMs separate from the team group for billing, secrets, destructive account changes, credential setup, and legal/claims approvals.

Startup team data model:

- `startupTeamMembers`: `creatorId`, `name`, `phone`, `email`, `role`, `canApprove`, `canConnectAccounts`, `canChangeBilling`, `createdAt`, `updatedAt`.
- `startupMessageThreads`: `creatorId`, `channel`, `service`, `chatType`, `chatId`, `displayName`, `purpose`, `status`, `participants`, `createdByUserId`, `createdAt`, `updatedAt`.
- `startupThreadEvents`: durable audit log for group creation, participant changes, policy changes, failed sends, and owner approvals.
- `startupApprovals`: if not already covered by `mayaActionLog`, track pending content, claim-sensitive actions, platform account changes, and who approved them.

Onboarding changes:

- Ask whether the startup wants Maya in a team iMessage group, founder-only DM, or both.
- Collect the founder/owner phone first, then optional team member names, roles, and phone numbers.
- Create or join the team thread through the OpenClaw/Claw Messenger path.
- Persist the returned `chatId`.
- Regenerate OpenClaw channel config with a specific group allowlist once the `chatId` exists.
- Send a team intro that states Maya's operating mode: listens, summarizes, drafts, asks for approvals, and only acts when addressed or on scheduled operating loops.

Runtime checks before shipping:

- Verify a real iMessage group can be created from multiple phone numbers.
- Verify inbound group messages include `isGroup: true`, `chatId`, `from`, and `participants`.
- Verify Maya replies into the group by `chatId`, not the sender phone.
- Verify unmentioned group chatter does not trigger unsolicited replies when mention gating is configured.
- Verify only approved team members can trigger Maya in the group.
- Verify direct founder DM and team group use separate OpenClaw session keys and do not leak instructions, approvals, or private context across surfaces.

Security note:

- Remove the hardcoded fallback Claw Messenger API key from `scripts/maya-claw-messenger-bridge.ts` and rotate it if it has ever been real. All Claw Messenger credentials should come from environment variables or the deployment secret path only.

## Startup Maya Skill Inventory

Startup Maya needs a real social media manager's skill set, not just generic caption writing. These skills can be a combination of:

- Custom HeyMaya skills: startup-specific reasoning, data contracts, approval gates, Convex writes, citation policy, and product-specific workflows.
- ClawHub skills: reusable platform, media, research, editing, scheduling, and operational skills that do not need to be owned by HeyMaya as long as they are pinned, reviewed, and wrapped by our approval/citation rules.
- Convex-backed tools: the durable state layer Maya calls to read/write profiles, plans, experiments, conversions, approval queues, and audit logs.

The rule: anything that defines Maya's startup-manager judgment, data model, safety boundary, or business loop should be custom. Anything that is generic execution machinery can be ClawHub if it is stable enough and pinned in the workspace lockfile.

### Custom vs ClawHub split

Custom HeyMaya skills should own:

- Startup stage strategy
- Positioning synthesis
- Voice fingerprint synthesis
- Platform strategy across X/Instagram/TikTok
- Weekly content arc planning
- Startup hook/angle generation
- Startup media cataloging, asset selection, and edit planning
- Startup visual generation rules
- Draft writing against approved claims
- Performance interpretation against startup goals
- Experiment loop management
- Conversion attribution rules
- Reply/community triage classifications
- Proof bank and claims policy
- Launch campaign logic
- Approval and safety gating

ClawHub/reference skills can support:

- Video clipping, captions, and rendering
- Image generation and image editing execution
- Video generation and animation execution
- Short-form platform best practices
- Calendar/scheduling helper workflows
- Media asset processing
- Generic web/social research helpers
- Screenshot/demo asset handling
- File/transcript summarization
- Platform-specific upload/draft-handoff utilities once vetted

ClawHub usage requirements:

- Pin versions in `.clawhub/lock.json`, like the current Creator Maya v0 manifest does.
- Treat ClawHub skills as implementation helpers, not policy authorities.
- Route any durable write through Convex-backed tools.
- Do not let a third-party skill bypass approval gates or publish directly.
- Keep startup memory in workspace files and Convex, not inside an opaque external skill state.
- Review each skill for secrets handling, file writes, network behavior, and platform-auth assumptions before including it in the startup pack.

### V0 required skills

These are required for the first useful startup product.

#### `startup-stage-strategist`

Purpose:

- Classify the startup stage from onboarding, website, social history, launch dates, and stated goals.
- Turn the stage into the right social strategy.

Startup-specific behavior:

- Idea/validation: prioritize problem education, ICP language discovery, and early-believer conversations.
- Pre-launch: prioritize waitlist growth, founder credibility, build-in-public, and positioning tests.
- Launching: prioritize launch cadence, demo assets, social proof, CTAs, and objection handling.
- Early traction: prioritize use cases, customer proof, tutorials, founder lessons, and retention stories.
- Growth: prioritize category POV, recruiting/fundraising credibility, partner/customer stories, and repeatable campaigns.

Reads:

- `startupProfiles`, startup website copy, creator/founder/company handles, onboarding answers.

Writes:

- `startupProfiles.stage`, `startupProfiles.primaryGoal`, startup picture/readback, `mayaActionLog`.

#### `startup-positioning-synthesizer`

Purpose:

- Synthesize the startup's narrative: category, ICP, problem, alternative, wedge, promise, proof, and "why now."

Startup-specific behavior:

- Distinguish what the product does from why the target customer should care.
- Identify unclear positioning and ask for clarification before generating confident content.
- Keep a "claims allowed" and "claims not allowed" list.

Reads:

- Website, docs, founder notes, social bios, competitor sites/handles, onboarding answers.

Writes:

- Startup picture, `startupProfiles.positioningNotes`, `startupContentSources.usableClaims`, `MEMORY.md`.

#### `startup-voice-fingerprint`

Purpose:

- Learn founder/company voice from public posts, website copy, founder notes, and uploaded examples.

Startup-specific behavior:

- Separate founder voice from company voice.
- Preserve credible founder tone without making the company sound like a generic SaaS account.
- Detect whether X should be founder-led, company-led, or both.

Reads:

- ScrapeCreators posts for founder/company handles, website/blog/docs, manual examples.

Writes:

- Startup picture voice section, `SOUL.md`, draft-generation constraints.

#### `startup-platform-strategist`

Purpose:

- Convert one startup goal into platform-native execution across X, Instagram, and TikTok.

Startup-specific behavior:

- X: founder POV, sharp observations, build-in-public, launch threads, customer/user proof, replies.
- Instagram: visual product proof, founder moments, carousel explainers, Reels, social proof.
- TikTok: demos, problem/solution hooks, founder storytelling, behind-the-scenes, objection handling.
- Avoid identical cross-posting unless the format truly fits.

Reads:

- `startupProfiles`, `posts`, `postMetrics`, platform handles, stage.

Writes:

- `contentPlans`, platform-specific draft metadata, `startupExperiments`.

#### `startup-content-arc-planner`

Purpose:

- Build weekly content plans tied to the startup's stage, CTA, and experiments.

Startup-specific behavior:

- Plans should include a mix of education, proof, product demo, founder POV, objection handling, and CTA posts.
- Every planned post gets a reason, hypothesis, platform, format, CTA, and expected learning.
- Launch weeks get campaign density; normal weeks get sustainable cadence.

Reads:

- `startupProfiles`, `startupExperiments`, `startupContentSources`, `postMetrics`, `weeklyReviews`.

Writes:

- `contentPlans`, `startupExperiments`, calendar holds if enabled.

#### `startup-hook-angle-generator`

Purpose:

- Generate startup-specific hooks and angles, not generic creator hooks.

Startup-specific behavior:

- Problem hooks: "the painful thing ICP already recognizes."
- Contrarian hooks: "the old way is broken because..."
- Demo hooks: "watch this workflow go from A to B."
- Proof hooks: "what changed after using this."
- Founder hooks: "what we learned building this."
- Objection hooks: "you might think X, but..."

Reads:

- `hookLibrary`, top posts, competitor posts, startup positioning, ICP pains.

Writes:

- `hookLibrary`, `contentPlans.arc`, `startupExperiments.angle`.

#### `startup-draft-writer`

Purpose:

- Write platform-native drafts in the startup's approved voice.

Startup-specific behavior:

- Include CTA only when the post's job calls for it.
- Keep claims grounded in approved proof.
- Produce multiple variants when the risk/angle is uncertain.
- Preserve founder credibility; do not over-market early products.

Reads:

- Startup picture, `SOUL.md`, `startupContentSources`, `startupExperiments`, platform constraints.

Writes:

- Draft objects in `contentPlans` or a new draft table if needed, approval queue entries, `mayaActionLog`.

#### `startup-media-cataloger`

Purpose:

- Understand and store the images, videos, audio, and files a startup sends Maya.

Startup-specific behavior:

- Treat demos, screenshots, customer quotes, founder clips, launch visuals, and product assets as reusable social raw material.
- Extract visual summary, OCR, transcript where available, sensitive-data risks, people/likeness presence, brand elements, suggested uses, and platform fit.
- Ask for permission when an asset is useful but consent is unknown.

Reads:

- `creatorMayaV0MediaAssets`, iMessage/OpenClaw attachment metadata, startup profile, team member records.

Writes:

- Asset catalog fields, retrieval tags, consent status, restrictions, `startupContentSources`.

#### `startup-media-edit-planner`

Purpose:

- Convert source assets into a concrete edit plan before rendering.

Startup-specific behavior:

- Plan TikTok-first cuts: trim, crop 9:16, captions, hook text, first-three-seconds variants, product inserts, safe CTA, and cover frame.
- Plan image edits: crop, resize, annotate, redact, quote card, launch graphic, carousel frame, and thumbnail/cover options.
- Preserve derived asset lineage and approval state.

Reads:

- Source assets, `startupContentSources`, brand constraints, target platform, hook/angle, approval settings.

Writes:

- `creatorMayaV0EditRequests`, edit plan, render status, approval checklist.

#### `startup-visual-generator`

Purpose:

- Generate missing visuals when the startup does not have the asset Maya needs.

Startup-specific behavior:

- Generate product concept visuals, explainer graphics, launch countdown graphics, carousel backgrounds, thumbnail options, and simple video/storyboard assets.
- Generate video only within explicit constraints: scripts, storyboards, text-motion explainers, product-demo assemblies, generated b-roll, or simple animation.
- Avoid fake UI, fake testimonials, unapproved founder/customer likenesses, or unsupported product claims.

Reads:

- Startup brand kit, approved claims, reference assets, content plan, target platform.

Writes:

- Generated asset records, generation metadata, prompt/model data, approval queue entries.

#### `startup-asset-rights-guard`

Purpose:

- Keep Maya from using assets in ways the startup has not approved.

Startup-specific behavior:

- Block or escalate assets with customer names, private data, unreleased features, unapproved people/likenesses, fake proof, or unclear rights.
- Decide whether an asset is allowed, needs owner approval, or is blocked.

Reads:

- Asset consent, restrictions, source team member, detected text/transcript, approval settings.

Writes:

- Approval queue, blocked-action reasons, `mayaActionLog`.

#### `startup-performance-analyst`

Purpose:

- Read post performance and explain what worked, what did not, and what to do next.

Startup-specific behavior:

- Evaluate by stage goal, not vanity metrics alone.
- Pre-launch: replies, profile clicks, waitlist clicks/signups, saves, shares, ICP comments.
- Launching: CTA clicks, demo views, conversion events, qualified replies, social proof.
- Early traction/growth: trials, demos, customer proof amplification, recruiting/fundraising signals.

Reads:

- `posts`, `postMetrics`, `startupConversionEvents`, `startupExperiments`.

Writes:

- `weeklyReviews`, `dailyBriefs`, `startupExperiments.result`, `startupExperiments.decision`.

#### `startup-experiment-loop-manager`

Purpose:

- Maintain the "what is working / what is not / double down" loop.

Startup-specific behavior:

- Every week, choose a small number of explicit content experiments.
- After enough signal, mark each as double down, iterate, stop, or inconclusive.
- Convert winning experiments into repeatable content pillars.
- Prevent Maya from randomly changing strategy every day.

Reads:

- `startupExperiments`, `postMetrics`, `startupConversionEvents`, `weeklyReviews`.

Writes:

- `startupExperiments`, `weeklyReviews.nextWeekRecommendations`, `MEMORY.md`, `DREAMING.md`.

#### `startup-conversion-attribution`

Purpose:

- Connect social activity to business outcomes.

Startup-specific behavior:

- Generate UTMs for posts and campaigns.
- Attribute waitlist/demo/trial/install/purchase/reply events when possible.
- Clearly separate known attribution from inferred attribution.
- Surface low-sample warnings.

Reads:

- `startupConversionEvents`, `posts`, planned CTAs, campaign UTMs.

Writes:

- `startupConversionEvents`, `startupExperiments.result`, reporting summaries.

#### `startup-reply-community-triage`

Purpose:

- Turn comments/replies/mentions into useful action.

Startup-specific behavior:

- Classify replies as question, objection, praise, bug, feature request, prospect, partner, investor, press, hiring, troll/spam.
- Draft replies for approval.
- Escalate real customer/prospect opportunities.
- Feed repeated objections into future content experiments.

Reads:

- Platform comments/replies where available, ScrapeCreators comments, Composio X/Instagram actions if connected.

Writes:

- Pending approval items, `startupExperiments`, `startupContentSources`, `mayaActionLog`.

#### `startup-trend-market-scanner`

Purpose:

- Watch the startup's market, competitors, category conversations, and ICP language.

Startup-specific behavior:

- Search for conversations the startup can credibly join.
- Track competitor post formats and claims.
- Detect repeated pain language from ICPs.
- Convert trends into startup-specific ideas only when high-fit.

Reads:

- ScrapeCreators public data, competitor handles, X search via Composio where connected, `startupProfiles.category`.

Writes:

- `trendObservations`, `competitorObservations`, `contentPlans`, `startupExperiments`.

#### `startup-proof-bank-librarian`

Purpose:

- Maintain the material Maya is allowed to use as proof.

Startup-specific behavior:

- Store screenshots, demo clips, customer quotes, launch assets, metrics, testimonials, founder notes, and changelog items.
- Mark what can be public, anonymized, private, or approval-required.
- Prevent unsupported claims from leaking into drafts.

Reads:

- Uploads, links, founder notes, website/docs, manual entries.

Writes:

- `startupContentSources`, `SOUL.md`, proof sections in startup picture.

#### `startup-launch-campaign-manager`

Purpose:

- Plan and run a launch/funding/major-announcement social campaign.

Startup-specific behavior:

- Build a launch sequence before, during, and after launch day.
- Prepare founder posts, product demos, objection posts, proof posts, media kit/social assets, and follow-up posts.
- Coordinate CTAs and UTMs.
- Switch to launch-mode cadence when `launchDate` is near.

Reads:

- `startupProfiles.launchDate`, `startupContentSources`, media kit assets, YC/Product Hunt/press fields if supplied.

Writes:

- `contentPlans`, `startupExperiments`, `startupConversionEvents` campaign tags, `dailyBriefs`.

#### `startup-approval-safety-guard`

Purpose:

- Enforce approval gates, claims policy, platform risk, and brand constraints.

Startup-specific behavior:

- Block unsupported traction/customer/security/legal claims.
- Require approval for posting, public replies, competitor callouts, customer names, investor/funding references, pricing claims, roadmap commitments, and regulated claims.
- Keep a clear audit trail of what Maya drafted, sent, skipped, or escalated.

Reads:

- `startupProfiles.brandConstraints`, approval settings, connected account permissions.

Writes:

- Approval queue, `mayaActionLog`, blocked-action reasons.

### V1 skills

These are important, but should follow the first shipped product once the core loop works.

#### `startup-founder-content-miner`

- Mine founder calls, notes, Slack snippets, customer conversations, and internal docs for raw content.
- Needs careful permissions and privacy controls.

#### `startup-customer-proof-synthesizer`

- Turn customer calls, testimonials, support wins, and use cases into public-safe proof.
- Requires source tracking and customer-name approval.

#### `startup-demo-scriptwriter`

- Create short video scripts and shot lists for TikTok/Reels.
- Convert product workflows into screen-recordable narratives.

#### `startup-media-remix-planner`

- Repurpose one demo, customer quote, or founder note into platform-native variants.
- Should integrate with existing Creator Maya media asset tooling.

#### `startup-competitor-positioning-analyst`

- Compare competitor claims, content strategy, and category framing.
- Must be careful not to produce legally risky claims or misleading comparisons.

#### `startup-community-distribution-planner`

- Recommend where a post belongs beyond X/IG/TikTok: Reddit, Hacker News, Indie Hackers, Discord, Slack communities, LinkedIn groups.
- V0 can record suggestions; later versions can support execution after approval.

#### `startup-recruiting-social-assistant`

- Support hiring-stage startups with role-specific founder/company content.
- Useful at growth stage, not required for first startup social manager.

#### `startup-investor-narrative-assistant`

- Help fundraising-stage startups turn traction, market insight, and founder POV into credible social content.
- Must avoid confidential fundraising claims and misleading securities-adjacent language.

#### `startup-paid-social-brief-maker`

- Convert organic winners into paid creative briefs.
- Later if the product expands beyond organic social management.

### V2 / optional skills

These are not needed for the first product, but are natural expansion paths.

- `startup-crm-loop-connector`: connect social replies and demo requests to CRM.
- `startup-product-analytics-connector`: ingest PostHog/Amplitude events for deeper attribution.
- `startup-support-insight-miner`: turn support tickets into objection/content ideas.
- `startup-newsroom-pr-assistant`: prepare launch/funding media kits and journalist-specific pitches.
- `startup-employee-advocacy-manager`: create share packs for employees/founders/investors.
- `startup-influencer-collab-scout`: find creators relevant to the startup's ICP.
- `startup-partner-co-marketing-planner`: identify partner posts/campaigns.
- `startup-content-compliance-reviewer`: domain-specific review for fintech, health, legal, education, etc.

### Minimum V0 skill pack

For the first implementation, ship this pack:

- `startup-stage-strategist`
- `startup-positioning-synthesizer`
- `startup-voice-fingerprint`
- `startup-platform-strategist`
- `startup-content-arc-planner`
- `startup-hook-angle-generator`
- `startup-draft-writer`
- `startup-performance-analyst`
- `startup-experiment-loop-manager`
- `startup-conversion-attribution`
- `startup-reply-community-triage`
- `startup-trend-market-scanner`
- `startup-proof-bank-librarian`
- `startup-launch-campaign-manager`
- `startup-approval-safety-guard`

Do not ship all V1/V2 skills on day one. The V0 pack is enough to make Maya feel like a real startup social media manager: learn the company, plan the week, draft posts, monitor response, read performance, manage experiments, protect claims, and double down on what works.

Approval gates:

- V0: no auto-posting without explicit approval.
- X: approve-to-send can ship first if Composio credentials and rate limits are stable.
- Instagram/TikTok: draft handoff until upload/publish flow is tested with Business/Creator accounts and app permissions.
- Never make unsupported product claims, revenue claims, customer names, investor names, legal/security claims, or competitor claims without cited source or user approval.

## UI Plan

Public surface:

- Rename Creator landing toggle from "For businesses" to "For startups".
- Link to a new startup landing page, not `/business`.
- Keep service-business routes separate.

Startup landing page:

- One tier.
- "Hire Maya as your startup social media manager."
- Emphasize startup stages, X/Instagram/TikTok, learning loop, launch support, approval-first operation.
- Avoid service-business/trades language.

Onboarding:

- Create `/creator-maya-startups` or `/startups`.
- Do not overload `/business-maya-v0`.
- Reuse Creator Maya visual language, but ask startup questions.

HQ:

- Reuse creator Today/Plan/Performance where possible.
- Change labels:
  - Deals -> Leads or Launch
  - Revenue -> Conversions
  - Creator stage -> Startup stage
  - Hooks -> Angles/hooks
  - Brand opportunities -> Conversations/opportunities
- Add a Learnings/Experiments surface if not too much scope. Otherwise start by adding experiment cards into Today and Weekly Review.

## Integrations Plan

ScrapeCreators:

- Use for public data pull on startup/founder/company accounts.
- Pull X, Instagram, TikTok profiles and recent posts.
- Pull competitor handles if supplied.
- Use TikTok transcripts/comments where available.
- Store normalized data in existing `posts`/`postMetrics` plus startup-specific synthesis rows.

Composio:

- Use for authenticated action when the startup connects accounts.
- X has broad tool coverage but no Composio-managed app credentials today, so expect user-owned OAuth/config work.
- Instagram supports managed OAuth but only Business/Creator accounts.
- TikTok toolkit supports creation/publish tools but no managed app credentials today.
- V0 should treat Composio as an execution layer after explicit connection, not as the primary source of public data.

OpenClaw:

- Use workspace memory and standing orders as the operating system.
- Keep startup-specific authority narrow at first, following OpenClaw's recommendation to define scope, triggers, approval gates, and escalation rules.

## Build Sequence

### Phase 1: Product shell

- Add startup landing page.
- Update audience toggle to "For startups".
- Add one startup pricing SKU.
- Decide final beta price.
- Preserve existing Creator Coach/Manager tiers.

### Phase 2: Convex data model

- Add `creatorKind` and `billingProduct` fields.
- Add `startupProfiles`.
- Add `startupExperiments`.
- Add `startupConversionEvents`.
- Add `startupContentSources`.
- Add startup query/mutation helpers with strict creator ownership checks.

### Phase 3: Startup onboarding

- Build startup onboarding flow.
- Collect startup stage, goal, CTA, platforms, ICP, competitors, assets, approval mode.
- Run ScrapeCreators pull for X/Instagram/TikTok handles.
- Generate startup readback.

### Phase 4: Startup picture synthesis

- Create a startup picture object:
  - stage
  - ICP
  - category
  - voice fingerprint
  - product narrative
  - content pillars
  - working angles
  - weak angles
  - proof bank
  - constraints
- Save to `startupProfiles` or a separate `startupPictures` table if it becomes too large.

### Phase 5: Startup OpenClaw deployment

- Add startup workspace manifest.
- Add startup skills/standing orders.
- Deploy OpenClaw with startup-specific `AGENTS.md`, `SOUL.md`, `TOOLS.md`, and `jobs.json`.
- Log deployment in existing or startup-specific deployment table.

### Phase 6: HQ adaptation

- Add startup-aware copy/data mapping to Today, Plan, Performance.
- Add experiment/learning components.
- Replace creator-specific revenue/deal framing for startup accounts.

### Phase 7: Posting and approval

- V0: draft-only plus handoff.
- X: approve-to-send via Composio after connection reliability tests.
- Instagram/TikTok: upload/publish only after a focused capability audit and account-type validation.

### Phase 8: Attribution loop

- Add UTM generation for planned posts.
- Support manual conversion event import first.
- Add webhook/API import later for waitlist, Calendly, Stripe, PostHog, or product analytics.

## Risks

- Platform publishing APIs are uneven. Do not promise full autoposting across X/Instagram/TikTok until OAuth and account requirements are verified.
- The existing v0 Creator Maya path is TikTok-first. Forking it too casually could leave startup Maya with TikTok assumptions in prompts, tables, and UI.
- Creator `plan` currently has only `coach | manager`; adding a new public plan directly could cause broad type churn. Use `billingProduct` first.
- Startup claims need stricter citation rules than creator content. Maya must not invent traction, customer proof, integrations, security posture, pricing, or competitor comparisons.
- Conversion attribution can get overbuilt. Start with UTM/manual event capture and only integrate deeper once users demand it.

## Open Decisions

- Final startup beta price: $149/mo versus $199/mo.
- Public route: `/startups`, `/creator-maya-startups`, or `/maya-for-startups`.
- Whether startup accounts should keep `accountType: "creator"` plus `creatorKind: "startup"` or add a new `accountType: "startup"`.
- Whether first release includes X approve-to-send or all platforms stay draft-only.
- Whether to build a dedicated Experiments page immediately or surface experiments inside Today/Plan/Weekly Review first.

## Recommended First Implementation PR

Scope the first PR to the product shell and schema foundation:

1. Add `creatorKind` and `billingProduct`.
2. Add `startupProfiles`, `startupExperiments`, `startupConversionEvents`, and `startupContentSources`.
3. Add startup landing page and update "For businesses" to "For startups".
4. Add one startup pricing component/SKU placeholder.
5. Add startup onboarding state types, but do not wire publishing yet.

This keeps the first change reviewable and avoids entangling landing copy, schema, OpenClaw deployment, and social posting in one risky patch.
