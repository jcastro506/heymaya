# MVP Platform Sprint Plan: Creator Maya + For Builders

Date: 2026-05-05

This is the single source of truth for the MVP platform sprint. `docs/CREATOR_MAYA_STARTUPS_PLAN.md` is background strategy. This document owns the execution scope, test plan, and definition of done.

## Goal

Ship HeyMaya into a working end-to-end platform state by making three things true:

1. ScrapeCreators works as the public social data layer across every endpoint we depend on, including OpenClaw skill usage.
2. Creator Maya works end to end for TikTok only: onboarding -> handle verification -> scrape pull -> OpenClaw workspace -> iMessage/chat behavior -> stored metrics -> brief/recommendation loop.
3. Builder Maya, publicly framed as **For Builders**, works as the next vertical using Composio for X/Twitter and LinkedIn. TikTok is optional public-data inspiration through ScrapeCreators, not a core Builder execution channel.

The sprint should not depend on TikTok Developer approval. Official TikTok OAuth remains an upgrade path. The MVP product should rely on public TikTok performance data from ScrapeCreators plus stored metric snapshots.

## Current Facts

- ScrapeCreators exposes TikTok profile, audience, profile videos, video info, transcript, live, comments, replies, following, followers, search users, search hashtag, search keyword, top search, popular creators, popular videos, popular hashtags, song details, TikToks using song, and trending feed.
- ScrapeCreators TikTok profile videos return `statistics.play_count`, `statistics.digg_count`, `statistics.comment_count`, `statistics.share_count`, and `statistics.collect_count`.
- The repo already has typed ScrapeCreators wrappers in `convex/integrations/scrapeCreators/endpoints.ts`.
- The typed Convex TikTok wrappers are newer than the OpenClaw agent-skill manifest. The Convex wrapper uses current paths like `/v3/tiktok/profile/videos`, `/v2/tiktok/video`, `/v1/tiktok/video/comments`, and `/v1/tiktok/video/transcript`.
- The checked-in OpenClaw manifest at `convex/integrations/scrapeCreators/agentSkill/manifest.json` still has stale TikTok paths like `/v1/tiktok/user/posts`, `/v1/tiktok/post`, `/v1/tiktok/comments`, and `/v1/tiktok/transcript`.
- `agents/skills/scrapecreators-api/SKILL.md` is broader and closer to current docs than the manifest, but still needs endpoint parity checks.
- `runFullScrapePull` already pulls profiles and recent posts for TikTok, Instagram, YouTube, LinkedIn, and X. TikTok also deep-dives top posts for transcript and comments.
- Existing tests already cover ScrapeCreators client/endpoints/cache/full-pull behavior, user journeys, cron simulation, OpenClaw deploy/channel seams, and failure modes.
- `docs/CREATOR_MAYA_STARTUPS_PLAN.md` defines the older Startup direction. Its useful scope is folded into this document under the public name **For Builders**.
- Public copy should say Builder/Builders, not Startup/Startups. Internal table names may temporarily keep `startup*` if that avoids risky schema churn, but product surfaces, docs, prompts, skills, and onboarding labels should use Builder language.

## Source References

- ScrapeCreators agent skill docs: https://docs.scrapecreators.com/integrations/agent-skill
- ScrapeCreators TikTok profile videos: https://docs.scrapecreators.com/v3/tiktok/profile/videos/
- ScrapeCreators TikTok video info: https://docs.scrapecreators.com/v2/tiktok/video/
- ScrapeCreators TikTok comments: https://docs.scrapecreators.com/v1/tiktok/video/comments/
- ScrapeCreators TikTok transcript: https://docs.scrapecreators.com/v1/tiktok/video/transcript/
- Ayrshare pricing and analytics research from prior thread is useful later, but not an overnight dependency.

## Architecture Decision

Use both layers:

- **OpenClaw skill layer:** Maya can call ScrapeCreators tools on demand, like Composio tools. This powers real-world chat behavior: "check my latest TikTok," "what is trending in my niche," "pull comments on this video."
- **Convex source-of-truth layer:** Every important scrape result must be persisted into Convex. This powers product memory, baselines, metric deltas, dashboards, retries, and tests.

Do not rely on OpenClaw chat memory as the system of record. OpenClaw can read live data and reason, but Convex owns durable state.

## Real-World Creator Flow

1. Creator signs up and gives a TikTok handle.
2. HeyMaya verifies the handle through ScrapeCreators.
3. Bulk pull fetches profile, latest videos, metrics, transcripts, and comments for top posts.
4. Convex stores creator handle, raw cache payloads, normalized posts, and metric snapshots.
5. OpenClaw workspace is provisioned with Maya instructions, ScrapeCreators skill, Composio where configured, and channel setup.
6. Maya texts the creator with one specific data point from their actual account.
7. Scheduled jobs refresh latest post metrics.
8. Maya compares current metrics against stored baselines.
9. Maya sends only useful observations, for example: "Your noon TikTok is at 8k views after 2h vs your usual 4.5k."
10. If data is stale or ScrapeCreators fails, Maya says so and triggers/awaits the next pull instead of inventing numbers.

## Real-World Builder Flow

The Builder vertical is for people who can build apps but do not know how to get an audience, distribute their product, or turn launches into repeatable growth. The MVP promise is not "Maya runs every social platform." The MVP promise is:

> Bring Maya your app. She builds and runs your X + LinkedIn distribution loop: strategy, drafts, experiments, approvals, and learning from results.

The Builder MVP flow:

1. Builder signs up through the For Builders entry point.
2. Builder provides product context, stage, 90-day goal, target user, CTA, website/app URL, X handle, LinkedIn profile or company URL, optional TikTok handle, and approval preferences.
3. Builder connects X/Twitter and LinkedIn through Composio when authenticated actions are needed.
4. Maya ingests voice sources, product pages, pasted strategy material, uploaded assets, and public social signals.
5. If the builder has no strategy, Maya creates a first working distribution strategy and marks it pending until approved.
6. Convex stores the approved strategy, product profile, social accounts, media assets, experiments, approvals, and action logs.
7. OpenClaw workspace is provisioned with Builder standing orders, ScrapeCreators read-only skill, Composio action tools, and approval gates.
8. Maya texts the builder a readback of the strategy and the first concrete next action.
9. Maya produces a 7-day X + LinkedIn distribution plan with drafts and experiments tied to the approved strategy.
10. Maya can execute approved X/LinkedIn actions, but public posting, replies, DMs, and materially risky claims require explicit approval.
11. Scheduled jobs refresh public performance data and authenticated account data where available.
12. Maya updates plans based on results, but proposes strategy changes instead of silently changing the approved source of truth.

## Product Lines

### Creator Maya

Creator Maya is the TikTok-only social media manager in iMessages for MVP. The MVP depends on public TikTok data through ScrapeCreators, not TikTok OAuth.

MVP surfaces:

- Onboarding and handle verification.
- Creator picture synthesis.
- Scrape pull and persisted metrics.
- OpenClaw workspace and messaging channel.
- Today, Plan, Performance, and recommendation loop.
- Latest-video and specific-video performance reads.
- Trend/comment/transcript analysis when useful.

### For Builders

For Builders is the distribution manager for app builders, vibe coders, indie hackers, and tiny teams. The MVP primary channels are X/Twitter and LinkedIn through Composio. TikTok can be used as public market intelligence, carousel planning, and creative inspiration, but not as a required execution channel.

MVP surfaces:

- Builder landing or entry point.
- Builder onboarding.
- Strategy intake and approval.
- X + LinkedIn connection flow.
- OpenClaw Builder workspace.
- First 7-day distribution plan.
- Draft generation, approval queue, and action log.
- Experiment loop and weekly learning review.
- Media asset catalog for product screenshots, demos, clips, proof, and launch materials.

## Builder Product Scope

### Public Positioning

Use this language family:

- "For Builders"
- "Hire Maya as your app's social media manager."
- "Text Maya your app. She turns it into an X + LinkedIn distribution engine."
- "Maya builds your distribution strategy, drafts posts, runs experiments, and learns from results."

Avoid this language for MVP:

- "For Startups"
- "Fully automates TikTok"
- "Makes TikTok videos for you"
- "Posts without approval"
- "Guaranteed growth"
- "Replaces your marketing team"

Pricing can be one plan for MVP:

- Beta: $149/mo, or
- Production: $199/mo.

Keep one Builder tier. Internally it can reuse Manager-level autonomy, but approval-first defaults stay on.

### Builder Stage Model

Every Builder account has one current stage. The stage drives priorities, weekly plans, content arcs, and what Maya asks for next.

- `idea_or_validation`: validate ICP pain, problem angles, founder credibility, and useful comment/question loops.
- `pre_launch`: build waitlist, market education, positioning, why-now posts, early demos, and objection handling.
- `launching`: create launch campaign assets, daily launch posts, demo posts, social proof, founder asks, and launch retrospectives.
- `early_traction`: turn feedback into proof, tutorials, customer stories, comparison posts, and repeatable acquisition loops.
- `growth`: produce category POV, partner/customer stories, hiring/funding narratives, launch expansions, and scaled experiments.

Tests must assert that stage affects generated plans. A pre-launch builder should not get a growth-stage enterprise case-study plan unless the provided strategy explicitly asks for it.

### Builder Onboarding Inputs

Required:

- Builder, company, or app name.
- Website, product URL, app URL, or landing page.
- One-line product description.
- Current stage.
- Current 90-day goal.
- Primary CTA: waitlist, demo booked, trial start, install, purchase, community join, hire, fundraise awareness, or custom.
- CTA URL.
- Target ICP or user.
- Category and competitors/alternatives.
- X/Twitter account to read or operate.
- LinkedIn profile or company page to read or operate.
- Approval preference: draft-only, approve-to-post, trusted replies later.

Optional but strongly preferred:

- Founder X handle.
- Company X handle.
- Founder LinkedIn profile.
- LinkedIn company page.
- TikTok, Instagram, YouTube, blog, docs, changelog, GitHub, Product Hunt, or community links.
- Existing GTM, marketing, social, launch, positioning, or campaign docs.
- Product screenshots, demo clips, launch media kit, logo, customer quotes, changelog screenshots, founder clips, and proof assets.
- Brand constraints: claims not to make, regulated topics, words to avoid, tone preferences, privacy restrictions.

### Strategy Source Rules

The approved strategy is a source of truth. Maya may draft strategy, summarize pasted docs, identify gaps, and propose changes, but she cannot silently mutate the approved strategy.

Store strategy sources with:

- `creatorId`
- `type`: gtm, marketing, social, launch, positioning, campaign, or other.
- `source`: paste, upload, url, or chat.
- `title`
- `rawText`, `storageId`, or `url`
- `summary`
- `goals`
- `targetAudience`
- `channels`
- `positioning`
- `constraints`
- `assumptions`
- `gaps`
- `approvedAsSourceOfTruth`
- `supersededBy`
- `createdByUserId`
- timestamps

Only one small approved set should be active at a time. Weekly plans, experiments, approvals, and performance reviews must reference the active strategy source IDs. If observed data contradicts strategy, Maya proposes a strategy update and asks for approval.

### Builder Data Model

Prefer Builder naming in new code where low risk. If existing code already expects `startup*` names, it is acceptable for the first MVP pass to keep those internal table names and expose Builder labels in UI/prompts. If we keep `startup*`, add a short code comment near schema definitions that these are legacy internal names for the Builder product.

Required profile/account fields:

- `creatorKind`: `individual` or `builder`
- `billingProduct`: `creator_coach`, `creator_manager`, or `builder_distribution_manager`
- `builderStage`
- `productName`
- `productUrl`
- `oneLineDescription`
- `targetIcp`
- `category`
- `competitors`
- `primaryGoal`
- `primaryCta`
- `ctaUrl`
- `approvalPreference`
- `brandConstraints`

Builder-specific tables or equivalents:

- Builder profile.
- Builder social accounts.
- Builder strategy sources.
- Builder content sources.
- Builder media assets.
- Builder experiments.
- Builder conversion events.
- Builder approvals.
- Builder team members.
- Builder message threads.
- Builder thread events.

Reuse existing shared tables where possible:

- `posts`
- `postMetrics`
- `dailyBriefs`
- `weeklyReviews`
- `contentPlans`
- `hookLibrary`
- `trendObservations`
- `competitorObservations`
- `mayaActionLog`

### Builder Media And Asset Scope

Media is part of the MVP because builders need product screenshots, demos, proof, and launch assets to make distribution useful.

Supported MVP inputs:

- iMessage attachments.
- Web uploads.
- Product screenshots.
- App store screenshots.
- Demo clips and screen recordings.
- Founder clips.
- Customer quote screenshots.
- Press kits.
- Logos and brand files.
- Launch visuals.
- Links to docs, landing pages, changelogs, and customer stories.

Catalog every asset with:

- immutable original reference.
- content hash for dedupe.
- uploader, source thread, and source message where applicable.
- consent/restriction notes.
- dimensions, duration, and MIME type.
- OCR and transcript when available.
- visual summary.
- product surface or feature shown.
- people/faces detected when available.
- brand elements.
- sensitive-data risk.
- suggested uses.
- tags: demo, feature, proof, objection, launch, founder, customer, announcement, tutorial, comparison, meme, evergreen.
- platform fit.
- lineage for derived assets.

Maya may automatically catalog assets and propose uses. Maya may draft edit plans. Maya may not publish customer proof, private screens, unreleased features, regulated claims, or likeness-based content without approval.

MVP media actions:

- Select best existing asset for a draft.
- Ask for missing raw material.
- Plan a video edit: trim, crop 9:16, add captions, add hook text, cut dead air, add product inserts, add outro, export.
- Plan an image edit: crop, annotate, clean up, resize, add CTA.
- Queue generated static images only behind approval and cost tracking if provider credentials exist.
- Treat generated video as V1 unless credentials, costs, and review gates are already configured.

### Builder OpenClaw Workspace

Builder needs a dedicated OpenClaw workspace manifest. Do not stretch the TikTok-first Creator workspace until behavior becomes ambiguous.

Implementation options:

- Parameterize the canonical generator with `mode: "creator" | "builder"`.
- Or add a separate Builder manifest/prompt pack.

Required workspace files:

- `AGENTS.md`
- `SOUL.md`
- `USER.md`
- `TOOLS.md`
- `HEARTBEAT.md`
- `DREAMING.md`
- `MEMORY.md`
- `jobs.json`

Required Builder standing orders:

- Morning social brief.
- Daily trend/conversation scan.
- Daily reply/opportunity triage.
- Weekly experiment plan.
- Weekly content plan.
- Post-performance check.
- Weekly learning review.
- Content source mining.
- Launch mode when launch date is near.

Tool policy:

- ScrapeCreators is read-only and can be called without approval.
- Composio read actions can run after account connection.
- Composio write actions require approval unless explicitly upgraded later.
- Public posting, comments, DMs, profile changes, and destructive actions are never silent.

### Builder Team Messaging

Support founder DM first and optional team group after the solo flow works.

Rules:

- Founder DM remains the control channel for billing, secrets, destructive account changes, and legal or risky approvals.
- Team group can receive plans, drafts, summaries, and non-sensitive questions.
- Only approved team members can trigger Maya.
- Unmentioned group chatter should be ignored unless explicitly configured.
- Group replies should use stable chat IDs, not guessed recipients.
- Session keys should separate founder DM and team group context.

Runtime tests must verify:

- inbound group messages include group metadata.
- Maya can reply by `chatId`.
- unapproved senders are ignored.
- founder DM and team group do not leak state.
- approval records include who approved and from which thread.

Security task:

- Audit and remove any hardcoded Claw Messenger fallback API key from scripts before live use. Rotate if a real key was committed or logged.

### Builder Skill Pack

The Builder OpenClaw workspace should include or generate a focused skill pack instead of relying on generic social skills.

Required MVP skills:

- `builder-stage-strategist`
- `builder-positioning-synthesizer`
- `builder-voice-fingerprint`
- `builder-platform-strategist`
- `builder-content-arc-planner`
- `builder-hook-angle-generator`
- `builder-draft-writer`
- `builder-performance-analyst`
- `builder-experiment-loop-manager`
- `builder-conversion-attribution`
- `builder-reply-community-triage`
- `builder-trend-market-scanner`
- `builder-proof-bank-librarian`
- `builder-launch-campaign-manager`
- `builder-approval-safety-guard`
- `builder-media-cataloger`
- `builder-media-edit-planner`
- `builder-visual-generator`
- `builder-asset-rights-guard`

V1 skills:

- founder content miner.
- customer proof synthesizer.
- demo scriptwriter.
- media remix planner.
- competitor positioning analyst.
- community distribution planner.
- recruiting social assistant.
- investor narrative assistant.
- paid social brief maker.

Avoid importing generic ClawHub posting skills that encourage silent cross-platform posting. If a third-party skill is useful, fork it and constrain it through HeyMaya approval policy.

### Builder UI And HQ

Public UI:

- Rename any Startup public surface to Builder.
- Add or align the entry point with "For Builders."
- Do not overload service-business routes.
- Prefer `/builders`, `/creator-maya-builders`, or `/maya-for-builders` if a new route is needed.

Builder HQ should reuse Creator HQ patterns where possible, with labels adjusted:

- Today.
- Plan.
- Performance.
- Strategy.
- Experiments.
- Media.
- Approvals.

Label changes from service-business concepts:

- Deals -> Leads or Launch.
- Revenue -> Conversions.
- Creator stage -> Builder stage.
- Hooks -> Angles/hooks.
- Brand opportunities -> Conversations/opportunities.

Strategy surface requirements:

- Show current approved strategy.
- Show pending strategy suggestions.
- Show source docs and timestamps.
- Show gaps Maya has identified.
- Require approval to promote a draft strategy to source-of-truth.

Media surface requirements:

- Show uploaded/generated assets.
- Show edit requests.
- Show approval status.
- Show provider/model metadata where generation is used.
- Link assets to posts, experiments, and strategy sources.

### Builder Integrations

MVP authenticated actions:

- X/Twitter through Composio, assuming our X developer credentials are configured.
- LinkedIn through Composio, using managed LinkedIn where available or our configured auth where required.

MVP public data:

- ScrapeCreators for public X, LinkedIn, TikTok, Instagram, YouTube, and competitor signals where available.
- TikTok public profile/videos/video/comments/transcript/trends through ScrapeCreators.
- Builder TikTok output is limited to ideas, scripts, carousel concepts, and manual handoff unless a later approved video-generation pipeline is added.

Do not block Builder MVP on:

- TikTok Developer app approval.
- TikTok OAuth.
- private TikTok Studio analytics.
- generated video providers.

If credentials are missing, tests must still pass in mocked mode and live smoke should report the exact missing environment variable or provider setup.

## Sprint 0: Safety, Branch, And Baseline

Objective: start from a known-good repo state and avoid trampling current local edits.

Tasks:

- Check branch and working tree.
- Preserve the existing local `docs/CREATOR_MAYA_STARTUPS_PLAN.md` change unless intentionally editing it.
- Pull latest `staging`.
- Run baseline tests before edits.

Commands:

```bash
git status --short --branch
git pull --ff-only origin staging
npm test
npx tsc --noEmit
npm run build
```

Acceptance:

- Baseline status is documented.
- Existing unrelated local changes are not reverted.
- Any failing baseline is recorded before implementation.

## Sprint 1: ScrapeCreators Endpoint Parity

Objective: make our ScrapeCreators wrappers and OpenClaw-facing skill match the current ScrapeCreators docs.

Tasks:

- Generate an endpoint inventory from `https://docs.scrapecreators.com/openapi.json` or per-endpoint OpenAPI specs.
- Update `convex/integrations/scrapeCreators/agentSkill/manifest.json` so every tool path is current.
- Update `agents/skills/scrapecreators-api/SKILL.md` where paths, env names, params, or endpoint descriptions are stale.
- Resolve environment variable naming so the app, skill docs, tests, and deployment agree on one canonical key. If both `SCRAPE_CREATORS_API_KEY` and `SCRAPECREATORS_API_KEY` exist today, support one alias temporarily and document the canonical value.
- Add missing TikTok endpoints to the manifest and skill:
  - profile
  - audience demographics
  - profile videos
  - video info
  - transcript
  - live
  - comments
  - comment replies
  - following
  - followers
  - search users
  - search hashtag
  - search keyword
  - top search
  - popular songs
  - popular creators
  - popular videos
  - popular hashtags
  - song details
  - TikToks using song
  - trending feed
- Decide whether "every single endpoint" means every platform in ScrapeCreators or every endpoint HeyMaya can use. Recommendation: define parity as all endpoints listed in `agents/skills/scrapecreators-api/SKILL.md`, then mark non-MVP endpoints as read-only optional.

Tests:

- Add a manifest parity test that fails if known stale TikTok paths reappear.
- Add a schema/inventory test that checks required TikTok tools exist.
- Add a docs link/path test for OpenClaw skill files.

Acceptance:

- Manifest and `SKILL.md` agree on TikTok paths.
- TikTok video metrics endpoints are represented with URL-based params where required.
- `npm test -- convex/integrations/scrapeCreators` passes.

## Sprint 2: ScrapeCreators Typed Wrappers And Normalizers

Objective: make Convex able to call and normalize the ScrapeCreators endpoints Maya actually needs.

Tasks:

- Keep existing wrappers for:
  - `tiktok.profile`
  - `tiktok.lastPosts`
  - `tiktok.post`
  - `tiktok.comments`
  - `tiktok.transcript`
- Add wrappers for missing MVP trend and research endpoints:
  - TikTok audience demographics
  - TikTok search by hashtag
  - TikTok search by keyword
  - TikTok popular videos
  - TikTok popular creators
  - TikTok popular hashtags
  - TikTok song details
  - TikToks using song
  - TikTok trending feed
- Normalize common output into stable internal shapes:
  - profile stats
  - post metrics
  - trend observation candidates
  - creator discovery candidates
  - comments
  - transcript
- Do not over-model every raw field. Keep raw payloads cached, normalize only what product code consumes.

Tests:

- Unit tests for each new normalizer using fixtures.
- Mock endpoint tests for each wrapper path and query param.
- Regression tests for TikTok metric mapping:
  - `play_count -> viewCount`
  - `digg_count -> likeCount`
  - `comment_count -> commentCount`
  - `share_count -> shareCount`
  - `collect_count -> saveCount`

Acceptance:

- All MVP TikTok wrappers are typed and tested.
- ScrapeCreators 400/401/402/429/500 handling remains graceful.
- No agent-facing code needs to parse raw nested TikTok payloads directly.

## Sprint 3: Durable Metrics And Deltas

Objective: make Maya able to reason about change over time, not just current counts.

Tasks:

- Confirm current `posts` and `postMetrics` persistence behavior.
- Ensure every scrape refresh writes a metric snapshot with timestamp.
- Add a helper for "latest non-pinned TikTok video."
- Add helpers for baseline comparisons:
  - trailing median views at matched age
  - 2-hour performance ratio
  - 24-hour performance ratio
  - comment velocity
  - share/save signal where available
- Add staleness rules:
  - "fresh" for current-day posts if pulled in last 30-60 minutes
  - "stale" if older, triggering refresh
  - "unknown" if no scrape exists

Tests:

- Run two pulls with different counts and assert two `postMetrics` rows.
- Assert latest-video selection skips pinned videos if upstream exposes `is_top`.
- Assert metric delta math is deterministic.
- Assert stale data triggers refresh in workflow tests.

Acceptance:

- Maya can answer "how did my latest TikTok do?" with current counts and deltas.
- Maya can answer "how is this doing compared to normal?" using stored baseline.
- Maya cannot answer with made-up numbers when data is missing.

## Sprint 4: OpenClaw Workflow And Tool Rules

Objective: make Maya use ScrapeCreators correctly in the real world.

Tasks:

- Update Maya platform playbook/workflow rules:
  - Use stored data first.
  - Refresh via ScrapeCreators if stale.
  - Cite exact post and metric snapshot.
  - Never invent metrics.
  - Use transcript/comments only when needed for qualitative analysis.
  - Batch trend observations into briefs unless unusually urgent.
- Add OpenClaw tool policy:
  - ScrapeCreators is read-only and can be used without creator approval.
  - Composio write actions require approval gates.
  - Public posting is never silent.
- Confirm OpenClaw deploy copies ScrapeCreators skill into each Maya workspace and injects the API key.
- If deploy copy is not implemented, wire it or explicitly document the gap.

Tests:

- Workspace manifest generation includes ScrapeCreators skill files.
- OpenClaw bootstrap JSON includes the skill registry entry.
- Fly machine secret set includes ScrapeCreators API key.
- A simulated OpenClaw prompt "check latest TikTok" routes to stored data or refresh action.

Acceptance:

- Maya has both instructions and tools.
- Runtime cannot accidentally use stale endpoint paths.
- Read-only social data calls are auditable.

## Sprint 5: Creator End-To-End Platform

Objective: prove the creator product works from onboarding through Maya response.

Tasks:

- Run and harden the existing creator user journey:
  - account creation
  - handle verification
  - bulk scrape
  - creator picture synthesis
  - OpenClaw deploy
  - channel pairing or mocked channel handoff
  - HQ Today/Plan/Performance state
  - first Maya response
- Add missing end-to-end assertions for:
  - ScrapeCreators current endpoint paths
  - post metric snapshots
  - Maya first message cites a real pulled data point
  - OpenClaw workspace receives ScrapeCreators skill
- Keep TikTok official OAuth out of the critical path.

Tests:

```bash
npm test -- tests/userJourney.test.ts
npm test -- tests/cronSimulator.test.ts
npm test -- tests/failureModes.test.ts
npm run smoke:creator-maya-v0
```

Acceptance:

- A fake creator can complete the journey with mocked ScrapeCreators data.
- A real public TikTok handle can be smoke-tested without UI dependency.
- HQ surfaces are populated from real persisted data.

## Sprint 6: Live Scrape Smoke

Objective: prove ScrapeCreators works against real public accounts before trusting it overnight.

Tasks:

- Add or run a script that accepts:
  - TikTok handle
  - optional video URL
  - optional hashtag/keyword
- It should call:
  - profile
  - profile videos
  - video info for latest video
  - comments for latest video
  - transcript for latest video
  - one trend/search endpoint
- It should print a compact summary and avoid storing secrets in logs.

Tests:

```bash
SCRAPE_CREATORS_API_KEY=... tsx scripts/scrapecreators-live-smoke.ts --tiktok HANDLE
```

Acceptance:

- Live smoke returns profile, latest videos, video metrics, and at least one comment/transcript or a graceful unavailable reason.
- Failures produce actionable messages.

## Sprint 7: Builder Maya Foundation

Objective: implement the "For Builders" vertical without blocking creator stability.

Tasks:

- Add or confirm Builder account mode:
  - public labels say Builder/For Builders.
  - internal records can keep legacy `startup*` names only if schema churn would slow MVP.
  - creator and builder records must be distinguishable by `creatorKind` or equivalent.
- Build Builder onboarding:
  - product/app URL.
  - product name.
  - one-line product description.
  - builder stage.
  - 90-day goal.
  - primary CTA and CTA URL.
  - target ICP.
  - category and competitors.
  - X handle/account.
  - LinkedIn profile or company URL/account.
  - optional TikTok handle for public signal only.
  - existing strategy paste/upload/link.
  - assets upload or links.
  - approval preference.
  - brand constraints.
- Implement strategy source storage:
  - pasted/uploaded/linked strategy material.
  - Maya-generated strategy draft.
  - approved source-of-truth flag.
  - supersession.
  - plan/experiment references to active strategy IDs.
- Add Builder workspace manifest:
  - distribution operator posture.
  - X + LinkedIn first.
  - TikTok public intelligence only.
  - approved strategy is source-of-truth.
  - approval-first public posting.
  - no silent DMs, public replies, or posts.
  - required standing orders and jobs.
- Add Builder skill-pack bootstrap:
  - stage strategist.
  - positioning synthesizer.
  - voice fingerprint.
  - platform strategist.
  - content arc planner.
  - hook/angle generator.
  - draft writer.
  - performance analyst.
  - experiment loop manager.
  - approval safety guard.
- Add Builder media catalog foundation:
  - accept screenshots/clips/proof/logos/launch assets.
  - dedupe by hash.
  - store metadata, tags, restrictions, and lineage.
  - allow Maya to suggest uses but require approval for risky proof, private screens, claims, and likeness.
- Add Builder UI/landing entry point only after backend and tests are green:
  - nav copy says For Builders.
  - no Startup public label.
  - route should not reuse service-business concepts.

Tests:

- Unit tests for Builder onboarding validation.
- Unit tests for stage-specific plan priorities.
- Unit tests for strategy source approval/supersession.
- Unit tests for media catalog metadata and restrictions.
- Workspace manifest snapshot test for Builder Maya.
- Cross-tenant test: creator and builder records do not leak.
- No Builder flow references service-business lead/review pipeline.
- Snapshot or text tests ensure public copy says Builder, not Startup.

Acceptance:

- A builder can onboard with fake app/social data.
- A Builder Maya workspace can be generated.
- Maya can produce a 7-day X + LinkedIn distribution plan from approved product context.
- Maya can ingest or draft a strategy and wait for approval before treating it as source-of-truth.
- Maya can catalog at least one screenshot or demo asset and attach it to a draft idea.
- No live TikTok OAuth is required.

## Sprint 8: Composio For X And LinkedIn

Objective: make Builder Maya able to use authenticated X and LinkedIn where feasible.

Tasks:

- Treat Composio as the write/action layer for Builder Maya.
- Prefer LinkedIn first because Composio currently documents a managed LinkedIn app.
- X likely requires our own X developer credentials because Composio removed managed Twitter credentials in February 2026.
- Add provider config/env support:
  - `COMPOSIO_AUTH_CONFIG_LINKEDIN`
  - `COMPOSIO_AUTH_CONFIG_TWITTER`
- For the existing ClawLaunch Twitter auth config, the Twitter auth config id is the `ac_...` value. Store it as `COMPOSIO_AUTH_CONFIG_TWITTER` in Convex/Vercel/local env. Do not commit Twitter bearer tokens, client secrets, or Composio API keys to the repo.
- Extend provider allowlists and UI connection surfaces for Builder mode.
- Add approval gates:
  - create X post
  - create LinkedIn post
  - comment/reply
  - like/repost
  - DM or message actions
- Destructive actions remain blocked or require explicit action-time confirmation.
- Add action logs for every Composio read/write:
  - provider.
  - connected account.
  - requested action.
  - approval ID if required.
  - result.
  - error/reconnect state.
- Add reconnect prompts for expired or missing auth.
- Add account capability detection:
  - connected but read-only.
  - posting available.
  - company page posting available.
  - profile posting available.
  - missing scope.

Tests:

- Mock Composio tools for LinkedIn and X.
- Verify connect-link generation.
- Verify approved-send creates action log before execution.
- Verify unapproved public posting fails.
- Verify expired OAuth produces a reconnect prompt.
- Verify Builder plan generation does not require connected accounts.
- Verify approved post execution references the strategy, draft, and approval record.
- Verify missing X credentials do not fail the whole Builder flow.

Live smoke, only if credentials exist:

- LinkedIn: authenticate test account, get my info, create draft/test post if safe.
- X: use `COMPOSIO_AUTH_CONFIG_TWITTER`, authenticate a test account, get me, recent search, create/delete a throwaway post only with explicit approval.

Acceptance:

- Builder Maya can ask for account connection.
- Builder Maya can draft X and LinkedIn content.
- Builder Maya can execute approved X/LinkedIn actions in test mode or mocked mode.
- Builder Maya can continue in draft-only mode if one or both integrations are not connected.

## Sprint 9: Builder Team Messaging And Approval Flow

Objective: make the real-world text loop safe enough for founder and team collaboration.

Tasks:

- Confirm Claw Messenger runtime paths for the current OpenClaw version.
- Add founder DM as the default Builder control channel.
- Add optional team group support:
  - allowlist by stable chat ID.
  - approved team member list.
  - mention or command policy for group threads.
  - separate session state for group and founder DM.
- Add approval records:
  - draft ID.
  - action type.
  - approver user/team member.
  - thread/channel.
  - exact content approved.
  - expiration.
  - executed action result.
- Route sensitive requests back to founder DM:
  - billing.
  - secrets.
  - destructive account changes.
  - legal/compliance/regulated claims.
  - external publishing if team approval policy does not allow group approvals.
- Remove hardcoded Claw Messenger fallback secrets from scripts and rotate if needed.

Tests:

- Unit test group allowlist and sender authorization.
- Unit test unmentioned group chatter is ignored.
- Unit test founder DM and team group session separation.
- Unit test approval records capture exact content.
- Integration smoke with mocked Claw Messenger inbound events:
  - founder asks for a plan.
  - Maya creates drafts.
  - founder approves one draft.
  - mocked Composio executes it.
  - action log is written.

Acceptance:

- Solo founder text flow works in mocked mode.
- Team group flow is safe by default.
- Approval and action logs are durable and auditable.
- No hardcoded messaging secret remains in live scripts.

## Sprint 10: Overnight End-To-End Smoke Matrix

Objective: prove the platform works as a system.

Creator smoke:

- Fake creator with mocked ScrapeCreators data.
- Real public TikTok handle live smoke.
- Onboarding -> scrape -> metric snapshots -> Maya first response -> HQ data.

Builder smoke:

- Fake builder with product URL and fake X/LinkedIn handles.
- Onboarding -> strategy intake -> strategy approval -> asset catalog -> OpenClaw workspace -> 7-day plan -> drafts -> approval queue.
- Mock Composio connect and approved-send.
- Founder text asks Maya what to do today.
- Maya responds with one plan item tied to the approved strategy.

Failure smoke:

- ScrapeCreators 500.
- ScrapeCreators 402 credits exhausted.
- Missing TikTok comments/transcript.
- Composio missing auth.
- OpenClaw deploy failure.
- Channel pairing not complete.
- Strategy not approved.
- Builder asset marked restricted.
- Unapproved team member message.

Commands:

```bash
npm test
npx tsc --noEmit
npm run build
npm run smoke
npm run smoke:cron
npm run smoke:creator-maya-v0
```

Acceptance:

- All core tests pass.
- Any skipped live tests are documented with exact missing env/credential.
- No critical journey depends on TikTok Developer approval.
- No critical Builder journey depends on live Composio credentials when running mocked tests.
- There is one clear manual checklist for the user to test with their real data.

## Sprint 11: Deployment And Release Alignment

Objective: get the tested MVP path live through the intended GitHub -> Vercel deployment flow.

Tasks:

- Pull latest `staging` before final edits.
- Keep local UI aligned with `staging`.
- Commit focused changes.
- Push to GitHub.
- Confirm Vercel deployment from the pushed branch.
- Run production or preview smoke checks:
  - public page loads.
  - Clerk sign-in/sign-up buttons are visible with neutral white/black treatment.
  - Builder entry point loads.
  - Creator onboarding loads.
  - protected dashboard redirects/signs in correctly.
  - critical API routes do not 500.
- Merge/promote `staging` to `main` only after smoke passes.

Tests:

- `npm test`
- `npx tsc --noEmit`
- `npm run build`
- browser smoke on local dev.
- Vercel preview smoke.
- production smoke after promotion.

Acceptance:

- GitHub has the final commits.
- Vercel has a successful deployment.
- Staging and main UI are intentionally aligned.
- The user can run a real-data test without local-only code.

## Overnight Work Order

Recommended order if working unattended:

1. Sprint 1: endpoint parity and stale manifest fix.
2. Sprint 2: missing TikTok trend wrappers and tests.
3. Sprint 3: metric snapshots/deltas if gaps exist.
4. Sprint 4: OpenClaw workflow/skill deployment hardening.
5. Sprint 5: creator end-to-end test hardening.
6. Sprint 6: live ScrapeCreators smoke script.
7. Sprint 7: Builder Maya workspace/onboarding foundation.
8. Sprint 8: mocked Composio X/LinkedIn plan/actions.
9. Sprint 9: Builder team messaging and approval flow.
10. Sprint 10: full system smoke matrix.
11. Sprint 11: deploy, smoke staging, then promote to main only after validation.

If time runs short, do not start UI polish before the data/tool/test loop works.

## Definition Of Done

This sprint is done when:

- ScrapeCreators skill files and Convex wrappers agree on endpoint paths.
- Every ScrapeCreators endpoint Maya is allowed to use has either a typed wrapper or an explicit agent-skill route.
- ScrapeCreators environment variable naming is consistent across local, OpenClaw, and Vercel.
- TikTok latest-video and specific-video performance can be refreshed and stored.
- Maya can answer latest-performance questions with real counts and citations.
- The creator journey passes under mocked data and has a live ScrapeCreators smoke path.
- Creator Maya can complete onboarding -> scrape -> workspace -> text/chat response -> dashboard state without TikTok OAuth.
- Builder Maya has a tested onboarding, strategy, workspace, media catalog, approval, and draft loop.
- Builder public surfaces use Builder/For Builders language instead of Startup/Startups.
- Builder plans are stage-aware and tied to an approved strategy source.
- Builder Maya uses Composio only for X/LinkedIn authenticated actions, behind approval gates.
- Builder Maya works in draft-only mocked mode without live Composio credentials.
- Builder team/founder messaging is safe by default and auditable.
- Local, staging, and main are aligned through GitHub -> Vercel deployment after tests pass.
- The user has a clear real-data manual smoke checklist.
- TikTok official OAuth is non-blocking.

## Manual Real-Data Smoke Checklist

Use this after mocked tests and staging deployment pass.

Creator path:

1. Sign up or sign in through Clerk.
2. Start Creator Maya onboarding.
3. Enter a real public TikTok handle.
4. Verify the handle resolves.
5. Trigger scrape pull.
6. Confirm latest videos and metrics appear in persisted state.
7. Ask Maya: "How did my latest TikTok do?"
8. Confirm Maya cites a real post and real metric timestamp.
9. Confirm no TikTok OAuth prompt blocks the flow.

Builder path:

1. Start For Builders onboarding.
2. Enter real app/product URL, stage, goal, CTA, ICP, X, and LinkedIn.
3. Paste a short real strategy or positioning note.
4. Approve Maya's strategy readback.
5. Upload or link one product screenshot/demo asset.
6. Generate a 7-day X + LinkedIn plan.
7. Confirm plan references the approved strategy and current stage.
8. Connect LinkedIn through Composio if credentials exist.
9. Connect X through Composio if credentials exist.
10. Approve one draft in test mode.
11. Confirm action log records the approval and either mocked send or live send result.
12. Confirm Maya can still operate in draft-only mode if either account is not connected.

Deployment path:

1. Push to GitHub.
2. Wait for Vercel preview/staging deployment.
3. Smoke public routes, auth routes, Creator onboarding, Builder onboarding, and protected dashboard.
4. Promote or merge to main only after staging is correct.
5. Smoke production once after promotion.

## Risks

- "Every single ScrapeCreators endpoint" is large. Full typed wrappers for all 100+ endpoints are not necessary overnight. Agent-skill inventory can cover broad access; typed Convex wrappers should cover product-critical endpoints.
- Live ScrapeCreators calls may fail because of credits, upstream shape drift, or transient platform scraping issues.
- OpenClaw runtime may not yet consume our placeholder manifest format exactly as expected. Verify the actual runtime install path before assuming the skill is callable.
- Composio X requires our own X developer credentials. Do not block Builder Maya on live X posting if credentials are absent.
- LinkedIn managed auth may still have scope limitations. Mock first, then live smoke when credentials are available.
- Strategy ingestion can become too broad. Keep the MVP source-of-truth model small: one approved strategy and referenced experiments.
- Media generation can burn time and credits. Cataloging, selection, and edit planning are MVP; generated video is V1 unless already wired safely.
- Team messaging can create approval ambiguity. Founder DM is the default control channel until group approvals are proven.

## Morning Report Template

When the overnight work ends, report:

- Branch and commits.
- Tests run and pass/fail.
- Live smokes run and pass/fail.
- What works end to end.
- What is mocked.
- What is live.
- What still needs user credentials or approval.
- Whether staging and main are aligned.
- Exact next manual action for the user, if any.
