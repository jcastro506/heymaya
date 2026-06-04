# Creator Maya Capability-Locked Sprint Plan

Status: Draft for operator review, 2026-05-22

This document is the execution plan for building Creator Maya into a real
beta-ready product. It is intentionally capability-locked: every planned
feature must be owned by either OpenClaw, ScrapeCreators, Convex, or a narrowly
scoped Maya skill. Anything that cannot be proven through one of those layers is
not in scope.

## Product Contract

Creator Maya is a TikTok-first creator teammate that studies a creator's
content, watches their TikTok niche, understands their schedule and constraints,
and proactively plans what they should make next.

The first product promise:

> Maya plans your TikTok calendar and texts you the highest-fit thing to make
> next, with the script, filming details, reference post, and calendar block
> already worked out.

The v0 product is not a generic content idea generator, trend dashboard,
multi-platform social manager, auto-poster, brand outreach machine, or
second-brain app.

## Non-Negotiables

1. Do not plan features we cannot execute with verified capabilities.
2. Do not rebuild OpenClaw-native runtime primitives.
3. Do not let Maya make creator-facing claims without evidence.
4. Do not auto-post, auto-DM brands, or auto-send sensitive messages.
5. Do not ship dashboard theater before the agent loop works in chat.
6. Do not hide capability gaps behind prompts.
7. Every sprint must end with a real-world bar, not only unit tests.
8. TikTok is the only content platform in v0.
9. Calendar planning is core product behavior, not a productivity add-on.

## Verified Capability Sources

### OpenClaw

Current repo pin:

- Runtime image: `openclaw@2026.4.23`
- Current npm stable observed: `2026.5.20`
- `2026.5.19` exists and is behind current stable.

OpenClaw capabilities verified from current docs:

- Agent workspace with `AGENTS.md`, `SOUL.md`, `TOOLS.md`, `IDENTITY.md`,
  `USER.md`, `HEARTBEAT.md`, optional `MEMORY.md`, `memory/YYYY-MM-DD.md`,
  `DREAMS.md`, and `BOOT.md`.
  Source: https://docs.openclaw.ai/agent-workspace
- Bootstrap file injection into agent sessions.
  Source: https://docs.openclaw.ai/agent
- Plain Markdown memory: `MEMORY.md`, daily notes, and dreaming promotion.
  Source: https://docs.openclaw.ai/concepts/memory
- Dreaming: opt-in memory consolidation, writes durable promotions to
  `MEMORY.md`, diary/report output to `DREAMS.md` and `memory/dreaming/*`.
  Source: https://docs.openclaw.ai/concepts/dreaming
- Memory wiki: deterministic wiki vault, provenance-rich claims, `wiki_search`,
  `wiki_get`, `wiki_apply`, `wiki_lint`.
  Source: https://docs.openclaw.ai/plugins/memory-wiki
- Heartbeat: periodic main-session turns, `HEARTBEAT.md`, `tasks:` due-only
  checks, `HEARTBEAT_OK` response contract, channel targeting, active context.
  Source: https://docs.openclaw.ai/gateway/heartbeat
- Cron: built-in Gateway scheduler, persisted `cron/jobs.json`, one-shot and
  recurring jobs, isolated/main sessions, retry/backoff, run logs.
  Source: https://docs.openclaw.ai/cron/
- Cron vs heartbeat guidance: cron for precise timing and isolated runs;
  heartbeat for approximate monitoring with full session context.
  Source: https://docs.openclaw.ai/cron-vs-heartbeat
- Task Flow: durable multi-step workflow tracking above individual tasks.
  Source: https://docs.openclaw.ai/automation/taskflow
- Hooks and webhooks: lifecycle/message/tool hooks plus external HTTP-triggered
  work.
  Source: https://docs.openclaw.ai/automation/hooks
- Skills: runtime-discovered `SKILL.md` instructions and tool conventions.
  Source: https://docs.openclaw.ai/tools/skills
- Managed browser: isolated browser profile plus optional existing-session
  profile, click/type/snapshot/screenshot/PDF tooling.
  Source: https://docs.openclaw.ai/tools/browser

OpenClaw ownership:

- Runtime process
- Channel routing and sessions
- Workspace context files
- Native memory files
- Dreaming
- Memory wiki
- Cron
- Heartbeat
- Task records
- Task Flow
- Hooks and webhooks
- Browser automation
- Skill loading

HeyMaya must not reimplement those. We configure them, feed them data, and
write Maya-specific skills and Convex endpoints around them.

### ScrapeCreators

ScrapeCreators capabilities verified from docs and local skill:

- 110+ API endpoints across 27+ social platforms.
- Public profile, posts, reels/videos/shorts, comments, transcripts, search,
  ad libraries, trending/popular TikTok endpoints, TikTok Shop, followers and
  following where supported.
- Agent skill supports endpoint selection, params, pagination, credit costs,
  and platform quirks.

Sources:

- https://docs.scrapecreators.com/
- https://docs.scrapecreators.com/integrations/agent-skill/
- https://docs.scrapecreators.com/openapi.json

Key TikTok endpoints for v0:

- TikTok profile: `/v1/tiktok/profile`
- TikTok profile videos: `/v3/tiktok/profile/videos`
- TikTok video details: `/v2/tiktok/video`
- TikTok comments: `/v1/tiktok/video/comments`
- TikTok transcript: `/v1/tiktok/video/transcript`
- TikTok keyword search: `/v1/tiktok/search/keyword`
- TikTok hashtag search: `/v1/tiktok/search/hashtag`
- TikTok top search: `/v1/tiktok/search/top`
- TikTok trending feed: `/v1/tiktok/get-trending-feed`
- TikTok popular videos: `/v1/tiktok/videos/popular`
- TikTok popular creators: `/v1/tiktok/creators/popular`
- TikTok popular hashtags: `/v1/tiktok/hashtags/popular`
- TikTok popular songs: `/v1/tiktok/songs/popular`
- TikTok song videos: `/v1/tiktok/song/videos`
- TikTok following: `/v1/tiktok/user/following`
- TikTok audience demographics: `/v1/tiktok/user/audience` at 26 credits
Later endpoints, explicitly out of TikTok-only v0 unless a sprint reopens
scope:

- Instagram profile/posts/reels/search/comments/transcripts
- YouTube channel/videos/shorts/search/hashtag/comments/transcripts
- Reddit subreddit/search/posts/comments
- Facebook, Google, LinkedIn, Reddit ad library endpoints
- TikTok Shop search/products/details/reviews/user showcase

ScrapeCreators ownership:

- Public social read layer
- Platform search and trend signal collection
- Post/comment/transcript source data
- Ad library and TikTok Shop public signal collection

HeyMaya ownership:

- Normalization
- Caching
- Credit gating
- Cross-tenant isolation
- Trend fit judgment
- Creator-facing synthesis
- Evidence/citation enforcement

## Current Repo Reality

Useful existing pieces:

- OpenClaw runtime image under `infra/openclaw-runtime/`
- Fly deploy path and real Fly smoke history
- `scrapecreators-api` skill under `agents/skills/scrapecreators-api/SKILL.md`
- Typed ScrapeCreators client and endpoint wrappers under
  `convex/integrations/scrapeCreators/`
- Bulk scrape pull action:
  `convex/integrations/scrapeCreators/runFullScrapePull.ts`
- Trend cache/live endpoints:
  `/lc_maya/get_recent_trends`
  `/lc_maya/fetch_trends_live`
- Existing Maya skills for citation firewall, trend watcher, calendar, captions,
  idea generation, underperformance diagnosis, hook extraction, and more
- Workspace bundle generator and bundled skills registry
- Existing tests around trend endpoints, voice rules, plan gates, and deploy

Risky or likely stale pieces:

- OpenClaw runtime pin is behind current stable.
- Some docs/plans describe old product scopes.
- Some skills are too broad for the first sellable loop.
- Some UI surfaces may be demo-heavy rather than agent-loop critical.
- Existing patches against OpenClaw internals may break on upgrade and must be
  re-audited before bumping runtime.
- ClawMessenger multi-tenancy is not treated as shipped until the new setup is
  delivered and verified. Until then, beta can use a single-tenant/operator
  path or a temporary fallback channel for testing.

## Ownership Matrix

| Product need | Owner | Build or configure | Notes |
|---|---|---|---|
| Agent identity and operating rules | OpenClaw workspace files | Configure/generate | `SOUL.md`, `AGENTS.md`, `USER.md`, `IDENTITY.md` |
| Long-term memory | OpenClaw memory-core | Configure | Use `MEMORY.md` and daily notes; do not invent parallel markdown memory |
| Structured durable learnings | OpenClaw memory-wiki | Configure/use tools | Use `wiki_apply`, `wiki_search`, `wiki_get` |
| Memory consolidation | OpenClaw dreaming | Configure/test | Opt-in after proving memory quality |
| Proactive checks | OpenClaw heartbeat | Configure | `HEARTBEAT.md` owns due checks; Convex only supplies data |
| Precise schedules | OpenClaw cron | Configure | Morning brief, weekly plan, weekly review |
| Multi-step workflows | OpenClaw Task Flow | Configure/use | For onboarding/deploy and complex recurring research |
| Event-driven wakeups | OpenClaw hooks/webhooks | Configure | Convex can emit wake events when external data changes |
| iMessage/SMS/WhatsApp sessions | OpenClaw channels | Configure | HeyMaya stores pairing state and plan gates |
| Public creator data | ScrapeCreators | Use API | No raw scraping from scratch |
| Trend source collection | ScrapeCreators | Use API | TikTok first, expand only after endpoint wrappers exist |
| Trend fit judgment | Maya skill + model | Build | This is the product brain |
| Citation enforcement | Maya skill + Convex gate | Build/use existing | No cited source, no creator-facing claim |
| Credit/cost gating | Convex | Build/use existing | Especially audience endpoint and transcripts |
| Cross-tenant isolation | Convex | Build/test | Every endpoint requires exact creator id and secret/auth |
| Google Calendar read/write | Provider integration + Convex + OpenClaw skill | Build/configure | Core workflow. Events must be rich, specific, and approval-gated |
| Browser-only tasks | OpenClaw browser | Configure/use | Do not write custom browser automation runtime |
| UI control center | Next.js/Convex | Build | Minimal onboarding/settings/receipt surfaces |

## Product Surface V0

Primary experience: iMessage through OpenClaw/ClawMessenger once the
multi-tenant path is verified. The fallback for early testing can be a
single-tenant ClawMessenger setup or another OpenClaw channel, but the intended
product experience is Maya in the creator's iMessage thread.

Web app responsibilities:

- Signup/login
- Creator onboarding
- TikTok handle connection/verification
- Google Calendar connection and calendar planning controls
- Plan and billing later
- Settings/revoke controls
- Debug/receipt views for operator and beta users

Maya responsibilities:

- Ask onboarding questions
- Study content
- Watch trends
- Score fit
- Text opportunities
- Turn approved opportunities into content plans
- Turn approved content plans into rich Google Calendar events
- Maintain the creator's near-term content calendar, not just one-off post ideas
- Learn from performance
- Maintain memory

## Feature Capability Matrix

| Feature | Feasible now? | Required capabilities | Scope decision |
|---|---:|---|---|
| TikTok handle verification | Yes | ScrapeCreators `/v1/tiktok/profile` | Sprint 3 |
| Recent TikTok post pull | Yes | `/v3/tiktok/profile/videos` | Sprint 3 |
| Top/bottom performer analysis | Yes | Post metrics from profile videos | Sprint 4 |
| Comments for selected posts | Yes | `/v1/tiktok/video/comments` | Sprint 4 |
| Transcripts for selected posts | Yes with limits | `/v1/tiktok/video/transcript`; under 2 min, possible extra credits | Sprint 4 |
| Audience demographics | Yes, expensive | `/v1/tiktok/user/audience`, 26 credits | Gated, not required for v0 value |
| TikTok trend feed | Yes | `/v1/tiktok/get-trending-feed` | Sprint 5 |
| Niche keyword/hashtag search | Yes | `/v1/tiktok/search/keyword`, `/hashtag`, `/top` | Sprint 5 |
| Popular creators/hashtags/songs | Yes | TikTok popular endpoints | Sprint 5 |
| Song trend expansion | Yes | Song details + song videos | Sprint 5 |
| Creator watchlist | Yes | Profile videos for named peers | Sprint 5 |
| Instagram trend expansion | Yes in API, not v0 | IG reels/search/profile/posts/comments/transcripts | Later only |
| YouTube Shorts expansion | Yes in API, not v0 | YouTube channel shorts/search/trending shorts | Later only |
| Reddit niche discussion scan | Yes in API, not v0 | Reddit search/subreddit posts/comments | Later only |
| TikTok Shop content ideas | Yes, not v0 core | TikTok Shop endpoints | Later monetization layer |
| Ad signal watcher | Yes, not v0 core | Meta/Google/LinkedIn/Reddit ad library endpoints | Later only |
| Daily proactive texting | Yes | OpenClaw heartbeat/channel delivery | Sprint 8 |
| Morning brief | Yes | OpenClaw cron or heartbeat | Sprint 8 |
| Weekly plan | Yes | OpenClaw cron + Maya skill | Sprint 11 |
| Long-term learning | Yes | OpenClaw memory/dreaming/wiki | Sprint 10-11 |
| Full TikTok content calendar planning | Yes for Google Calendar | Calendar read/write + Convex + Maya planning skills | Sprint 7 |
| Rich filming/editing/posting events | Yes for Google Calendar | Event create/update/delete with detailed descriptions | Sprint 7 and Sprint 9 |
| Apple Calendar direct server sync | No | Requires native iOS EventKit bridge | Explicitly out of v0 |
| Auto-posting | Technically possible later | Platform APIs/browser | Out of v0 by product rule |
| Autonomous brand outreach | Possible but risky | Gmail/contacts/browser | Out of v0 |
| Real-time viral prediction | Not honestly provable | Trend velocity can be estimated, not guaranteed | Do not promise |

## Cost-Aware Ingestion Rules

ScrapeCreators and Gemini calls are product costs, not free background noise.
Maya must be smart about when she spends them.

ScrapeCreators rules:

1. Never call ScrapeCreators on every heartbeat.
2. Heartbeat reads cached Convex rows first.
3. Live ScrapeCreators pulls happen from cron, explicit creator requests, or
   a narrowly approved fallback when cache is empty/stale.
4. Profile and recent-post pulls are cheap enough for onboarding and scheduled
   post detection, but still cached.
5. Comments, transcripts, audience demographics, TikTok Shop, and ad-library
   detail calls are gated by value and plan.
6. The TikTok audience endpoint costs 26 credits and is never required for v0
   personalization.
7. Every external call writes a credit-audit row with creator id, endpoint,
   reason, source job, and whether it was cache-hit, called, skipped, or failed.

Gemini video rules:

1. Gemini video analysis is not run from heartbeat.
2. Onboarding can analyze more videos, but only as a bounded background job.
3. The default onboarding path analyzes a small representative sample first:
   top performers, bottom performers, newest posts, and outlier formats.
4. If we choose to analyze all 30 onboarding posts, the job must be chunked and
   resumable. Do not send all videos in one prompt.
5. Use the Gemini Files API or supported URL/file input path for meaningful
   video inputs. Google's docs recommend Files API when total request size is
   larger than 20 MB, duration is significant, or the same media will be reused.
   Source: https://ai.google.dev/gemini-api/docs/video-understanding
6. Do not assume a hard "10 videos per prompt" API contract unless verified for
   the specific model/version. Use smaller batches or one-video calls based on
   reliability, latency, and cost.
7. Store structured video annotations so the same post is not re-analyzed unless
   the analyzer version changes.
8. New-post analysis is triggered by detected new posts or planned-post matching,
   not by blind polling of Gemini.

Onboarding tiers:

- Tier 1: metadata-only picture from 30 posts.
- Tier 2: Gemini watch sample of 6-8 selected posts.
- Tier 3: optional full onboarding watch of up to 30 posts, chunked into
  parallel/resumable jobs, only when the beta budget allows it.

Heartbeat can only decide using cached rows, OpenClaw memory/wiki, and calendar
state. If it needs fresh data, it schedules or requests a pull; it does not
spend directly inside the heartbeat loop.

## Sprint Validation Rules

Every sprint must pass:

1. Unit tests for touched logic.
2. Typecheck.
3. Cross-tenant isolation tests for any creator data endpoint.
4. Plan-tier and cost-gate tests where relevant.
5. Adversarial input tests for user-provided handles, niches, and prompts.
6. Sibling-file scan when changing skills/workspace instructions.
7. Citation-firewall checks for any creator-facing recommendation.
8. Smoke test with fake data.
9. Real-world operator smoke where the sprint touches OpenClaw, Fly,
   ScrapeCreators, channels, or cron/heartbeat.
10. A written "capability proof" entry for any newly introduced feature.

## Sprint 0 - Maya V2 Workflow Lock

Goal: design the best TikTok-only Maya from first principles before adapting
the existing code.

Scope:

- Lock the TikTok-only product promise.
- Define the daily, weekly, and on-demand Maya experience.
- Define the full calendar workflow:
  - how Maya reads existing events
  - how she finds filming/editing/posting windows
  - how she proposes a week of content
  - how the creator approves or edits it
  - what goes into each Google Calendar event
  - how Maya updates or deletes events when plans change
- Define the message shape for:
  - first readback
  - daily opportunity
  - calendar-plan proposal
  - script/shot-list delivery
  - postmortem
  - weekly review
- Define what Maya never sends.
- Pick 1-2 real beta creator archetypes and write concrete fixtures for them.

Acceptance bar:

- A product bible exists that is not written around the current code.
- Every workflow has a user-visible example.
- Calendar event examples include enough detail that the creator could open
  the event and film from it.
- TikTok-only scope is explicit.

Tests:

- None required beyond doc review, but the sprint is not done until the
  operator can read the examples and say "this is the Maya I want."

## Sprint 1 - Capability Baseline And Upgrade Decision

Goal: lock the runtime surface before building product features.

Scope:

- Build a current OpenClaw capability matrix from docs and local `openclaw`
  CLI probes.
- Compare `2026.4.23` against `2026.5.20`.
- Rebuild runtime image with candidate version in a non-prod tag.
- Run one creator fixture deploy on the candidate image.
- Re-audit custom patch file:
  `infra/openclaw-runtime/patch-claw-messenger-plugin.mjs`.
- Decide whether to upgrade now or stay pinned for Sprint 1-3.

Do not build:

- Product features beyond probes/smokes
- UI polish
- New skills

Acceptance bar:

- `npm view openclaw version` recorded in doc.
- Candidate runtime image builds.
- `openclaw --version` reports expected version inside image.
- Real Fly smoke proves gateway ready, cron ready, skills visible, and
  messenger bridge still works.
- Any broken patch is either removed because upstream fixed it or updated with
  a test.

Tests:

- Runtime image build smoke.
- `npm run smoke:creator-maya-v0 -- --live --confirm` or successor command.
- Gateway log asserts `cron: started`.
- Workspace grep asserts required files exist.
- Skill list asserts `scrapecreators-api` and Maya skills loaded.

Exit decision:

- Upgrade to `2026.5.20` only if real Fly smoke is green.
- Otherwise stay on `2026.4.23` and open a tracked upgrade sprint.

## Sprint 2 - Product Spine And Dead-Code Audit

Goal: cut the product to the first sellable loop and map code to that loop.

Scope:

- Lock v0 ICP: serious TikTok creators who want help planning and executing
  consistent content.
- Lock v0 promise: "Maya plans your TikTok calendar and tells you exactly what
  to make next."
- Produce keep/rebuild/delete map for current repo.
- Identify all fake/demo surfaces.
- Identify every existing skill that remains in v0.
- Identify every existing Convex endpoint that the agent may call.

Acceptance bar:

- One checked-in audit doc maps code to product spine.
- No feature in the sprint plan lacks an owner.
- No OpenClaw-native function is marked for custom rebuild.

Tests:

- Static search for duplicate memory/cron/heartbeat/browser implementations.
- Static search for demo/fake/test-only strings in user-facing surfaces.
- Existing test suite baseline recorded.

## Sprint 2A - Data Model And Environment Baseline

Goal: lock the V2 data contract and environment separation before building
TikTok onboarding, calendar planning, or OpenClaw deployment work on top of it.

Scope:

- Decide whether V2 uses new clean tables beside the current creator tables or
  a carefully documented additive extension of existing tables.
- Define the canonical data model for:
  - creator account
  - TikTok profile
  - TikTok posts
  - TikTok post metric snapshots
  - selected comments
  - selected transcripts
  - trend candidates
  - trend observations surfaced to Maya
  - content plans
  - content plan items
  - Maya-owned Google Calendar events
  - creator approvals
  - OpenClaw deployment records
  - ClawMessenger/channel pairing records
  - ScrapeCreators credit audit
  - model/tool call logs
  - integration account health
- Define indexes for every read path before implementation:
  - by creator
  - by creator and platform
  - by creator and observed/posted time
  - by creator and plan status
  - by creator and calendar event ownership tag
  - by deployment app id
  - by channel pairing id
- Define retention rules:
  - raw ScrapeCreators payload TTL
  - normalized post/metric retention
  - logs and credit audit retention
  - account deletion cleanup
- Validate environment separation:
  - local dev Convex deployment
  - staging Convex deployment
  - production Convex deployment/guardrail
  - Vercel preview and production env vars
  - Fly OpenClaw runtime image/app names
  - per-creator Fly app naming
  - Google OAuth redirect URLs for local/staging/prod
  - Clerk issuer/JWT configuration per environment
  - ScrapeCreators/OpenRouter/Google/Fly secrets per environment
- Produce an environment checklist that says exactly where each variable lives:
  - `.env.local`
  - Convex env
  - Vercel env
  - Fly secrets

Acceptance bar:

- The V2 schema is documented before feature code depends on it.
- Every planned feature has a table/index or explicitly uses OpenClaw native
  memory/wiki instead of Convex.
- Local, staging, and production environments are named with URLs and deploy
  commands.
- We can answer "where does this secret live?" for every required integration.
- Production deploy cannot be accidentally triggered from a feature branch.

Tests:

- Schema typecheck.
- Unit tests for table ownership helpers and calendar event ownership tags.
- Cross-tenant tests for each new query/mutation/action.
- Env smoke:
  - `npx convex dev --once` against personal dev
  - `CONVEX_DEPLOYMENT=dev:precise-canary-781 npx convex dev --once`
  - `npx convex env list --deployment dev/staging`
  - Vercel env check for staging branch public Convex URLs
- Static check that no server secret is exposed through `NEXT_PUBLIC_*`.
- Account deletion test removes or revokes V2-owned records and integrations.

## Sprint 3 - Creator Identity And TikTok Connection

Goal: Maya can verify and understand one TikTok creator.

Scope:

- Onboarding collects TikTok handle.
- ScrapeCreators verifies profile.
- Store normalized profile and handle row.
- Pull latest 30 TikTok posts.
- Store post rows and metric snapshots.
- Ask the minimum creator questions:
  - location/timezone
  - niche in creator's words
  - three-month goal
  - target posting cadence
  - content boundaries/no-go topics
  - current monetization interest
- Ask calendar-planning preferences:
  - preferred filming days
  - preferred editing/posting days
  - content batch tolerance
  - quiet hours
  - whether Maya may create tentative events after approval
- Generate `USER.md`, `SOUL.md`, `AGENTS.md`, `HEARTBEAT.md`, `TOOLS.md`,
  `MEMORY.md` seed from verified data and answers.

OpenClaw native usage:

- Workspace files are generated and loaded by OpenClaw.
- Do not build separate prompt injection outside the workspace contract.

ScrapeCreators usage:

- `/v1/tiktok/profile`
- `/v3/tiktok/profile/videos`

Acceptance bar:

- Given a real TikTok handle, the system verifies the profile and stores recent
  posts in Convex.
- Generated workspace contains only grounded creator facts.
- No raw secrets or API keys appear in workspace files.
- Creator can see a plain-language readback of what Maya thinks she knows.

Tests:

- Unit: profile parser handles ScrapeCreators shapes.
- Unit: post parser handles missing metrics and missing duration.
- Cross-tenant: creator A cannot read creator B profile/posts.
- Adversarial: handle normalization strips `@`, rejects URLs when not allowed,
  rejects empty/overlong input.
- Snapshot: workspace files contain required sections and no banned voice terms.
- Real smoke: one real handle pull under defined time budget.

## Sprint 4 - Content DNA And Baseline

Goal: Maya knows what has worked and failed for this creator.

Scope:

- Select top, bottom, and recent posts from latest 30.
- Pull comments and transcripts only for selected posts.
- Build first creator picture:
  - content pillars
  - hook patterns
  - recurring formats
  - top/bottom posts
  - likely audience interests
  - best posting windows when evidence supports it
  - unknowns and verification questions
- Write durable facts to OpenClaw memory/wiki through agent tools where
  runtime supports it; keep source rows in Convex.

OpenClaw native usage:

- Use memory and memory-wiki for durable creator learnings.
- Do not create a second custom markdown memory system.

ScrapeCreators usage:

- `/v1/tiktok/video/comments`
- `/v1/tiktok/video/transcript`
- Optional `/v1/tiktok/user/audience` only above credit gate.

Acceptance bar:

- Maya can explain the creator's content DNA with citations to specific posts.
- Maya explicitly marks uncertain assumptions.
- No transcript/comment calls are made for all 30 posts by default.

Tests:

- Unit: sampler picks top/bottom/recent without duplicates.
- Unit: credit audit records expensive/skipped calls.
- Unit: audience endpoint skipped below threshold.
- Citation firewall: no content-DNA claim without a post/comment/transcript
  citation.
- Real smoke: selected-post enrichment completes with partial failure tolerated.

## Sprint 5 - TikTok Signal Collection

Goal: Maya can collect candidate trends/signals from TikTok without judging yet.

Scope:

- Implement/verify wrappers for:
  - trending feed
  - keyword search
  - hashtag search
  - top search
  - popular videos
  - popular creators
  - popular hashtags
  - popular songs
  - song videos
- Normalize each candidate to:
  - platform
  - URL or stable source id
  - caption/title
  - metrics
  - creator handle if present
  - source kind
  - pulledAt
- Cache candidates.
- Deduplicate exact URLs/source ids.

OpenClaw native usage:

- Scheduled collection can be cron or heartbeat depending on timing:
  - exact daily broad pull: cron
  - opportunistic niche checks: heartbeat `tasks:`

ScrapeCreators usage:

- TikTok search/trending/popular/song endpoints.

Acceptance bar:

- For a niche keyword/hashtag, system returns 20-50 raw candidates with real
  source evidence.
- Empty results are valid and do not cause hallucinated trends.
- Cache prevents repeated credit burn for same query window.

Tests:

- Unit: endpoint params strip `#` and `@`.
- Unit: keyword/hashtag mutual exclusion is deterministic.
- Unit: dedupe canonicalizes TikTok URLs.
- Cross-tenant: cached results are creator-scoped unless intentionally global.
- Real smoke: one niche search and one trending feed pull.

## Sprint 6 - Trend Fit Engine

Goal: Maya can decide which signals are worth sending to this creator.

Scope:

- Build `maya-trend-fit-scorer` as the product brain.
- Inputs:
  - creator picture
  - content boundaries
  - recent performance baseline
  - candidate trends
  - calendar constraints if available
  - prior surfaced trends from memory/wiki and Convex
- Outputs:
  - fit score
  - effort score
  - why this fits this creator
  - why now
  - source citation
  - suggested content angle
  - reject reason for dropped items
- Persist only survivors and rejections needed for learning.

OpenClaw native usage:

- Use memory-wiki to avoid repeat suggestions and accumulate patterns.
- Use heartbeat to surface only due/high-fit observations.

Acceptance bar:

- Given 30 raw candidates, Maya selects at most 3 high-fit ideas.
- Each selected idea has a real source URL/id and creator-specific rationale.
- At least one beta/operator review marks a selected idea as filmable.

Tests:

- Unit: banned topics drop to zero.
- Unit: no citation means drop.
- Unit: repeated trend inside cooldown drops.
- Adversarial: prompt-injected captions cannot override Maya rules.
- Golden fixtures: scorer ranks known good/bad candidate sets correctly enough
  to catch regressions.

## Sprint 7 - Google Calendar Planning Core

Goal: Maya can plan the creator's TikTok work around their real calendar.

Scope:

- Connect Google Calendar through the existing OAuth path.
- Read next 14-30 days of events.
- Classify availability:
  - hard busy
  - soft busy
  - possible filming window
  - editing/admin window
  - posting/review window
  - life-event content opportunity
- Build the initial 7-14 day TikTok content calendar.
- Every proposed content item includes:
  - content title
  - TikTok format
  - hook
  - concept
  - filming instructions
  - shot list
  - caption draft or caption angle
  - reference trend/post URL
  - why Maya chose it
  - source/citation
  - required props/locations/people
  - estimated effort
  - planned filming block
  - planned editing block where needed
  - planned post/review block
- Maya asks for approval before creating calendar events.
- On approval, Maya creates rich Google Calendar events.
- Maya-owned events are tagged so she can update/delete only her own events.

OpenClaw native usage:

- Maya uses OpenClaw skills and workspace instructions for the planning
  behavior.
- OpenClaw channel carries the approval conversation.
- Cron/heartbeat later remind against Maya-owned events.

HeyMaya ownership:

- OAuth token handling.
- Calendar read/write endpoints.
- Event ownership tags.
- Approval gates.
- Conflict detection.

Acceptance bar:

- Given a connected Google Calendar and TikTok creator profile, Maya proposes a
  7-day content calendar with rich event details.
- On approval, the calendar contains separate, useful events for filming,
  editing if needed, posting, and post-review.
- Opening any Maya-created event gives enough detail to execute without
  searching the chat thread.
- Maya never writes over non-Maya events.

Tests:

- Unit: event description renderer includes reference URL, script/shot details,
  citations, and approval metadata.
- Unit: event ownership tags prevent updating/deleting non-Maya events.
- Unit: conflict detector avoids hard-busy windows.
- Unit: no calendar write before creator approval.
- Adversarial: creator prompt cannot force editing/deleting external events.
- Real smoke: OAuth connect, read, create, update, and delete one Maya-owned
  event.

## Sprint 8 - Proactive Messaging Loop

Goal: Maya texts only when she has a grounded next move.

Scope:

- Configure OpenClaw heartbeat for creator Maya.
- Configure exact cron jobs:
  - morning brief
  - evening recap
  - weekly content plan
  - weekly review
- HEARTBEAT.md defines ordered checks:
  - unread creator reply
  - approved pending plan
  - high-fit trend opportunity
  - post outlier
  - missed filming block
  - stale plan
  - calendar gap that needs a plan
  - nothing to do -> `HEARTBEAT_OK`
- Enforce outbound rate limit in Convex.
- Enforce quiet hours.
- All creator-facing trend messages pass citation firewall.

OpenClaw native usage:

- Heartbeat owns periodic checks.
- Cron owns precise schedule.
- Channel delivery is OpenClaw-owned.

Acceptance bar:

- Deployed Maya sends a real iMessage/SMS/Telegram test message with one
  grounded opportunity.
- Silent tick returns `HEARTBEAT_OK` and sends nothing.
- Max outbound/day cap cannot be bypassed by model text.

Tests:

- Unit: heartbeat content under budget.
- Unit: cron jobs count and schedule.
- Unit: outbound limiter fail-closed.
- Real Fly smoke: heartbeat fires, silent ack suppressed, alert delivered.
- Log check: each push has reason, citation, and cooldown stamp.

## Sprint 9 - Calendar-Aware Execution Plans

Goal: Maya turns an approved idea into something the creator can film.

Scope:

- Reuse Sprint 7 Google Calendar connection.
- For an individual opportunity, suggest filming/editing/posting windows.
- Create/update rich calendar events only after approval.
- Generate:
  - hook
  - short script
  - shot list
  - filming checklist
  - caption
  - posting suggestion
  - rich event body
- No Apple Calendar server-side claim in v0.

OpenClaw native usage:

- Agent skill handles planner behavior.
- Cron/heartbeat can remind on approved holds.

Acceptance bar:

- Creator taps/answers approval and gets a complete filming plan.
- If calendar is connected, Maya proposes a real free window.
- If calendar is missing, Maya gracefully gives chat-only date suggestions.
- If approved, the event details are rich enough to execute from calendar.

Tests:

- Unit: no calendar write before approval.
- Unit: conflicting event prevents slot suggestion.
- Unit: OAuth failure does not trap onboarding.
- Citation/firewall: script claims only use creator profile/trend evidence.
- Real smoke: Google Calendar read and Maya-owned event creation/update/delete.

## Sprint 10 - Post-Publish Learning

Goal: Maya learns from what happened after the creator posts.

Scope:

- Detect new posts from ScrapeCreators delta pull.
- Pull metrics over time.
- Compare against creator baseline.
- Detect outliers:
  - overperforming
  - underperforming
  - noisy/normal
- Pull comments/transcript for meaningful outliers.
- Run postmortem.
- Write learnings to memory/wiki and Convex.
- Fold learnings into evening recap and future trend scoring.

OpenClaw native usage:

- Use memory-wiki for durable "what works" pages.
- Dreaming can promote repeated patterns to `MEMORY.md`.

Acceptance bar:

- Maya gives one specific postmortem for a new post.
- The next trend recommendation can use the learning.
- Maya can say "unknown" when data is inconclusive.

Tests:

- Unit: baseline thresholds handle low sample sizes.
- Unit: underperformance diagnosis can output unknown.
- Unit: overperformance writes reusable pattern.
- Citation firewall: no postmortem without metric/post citation.
- Real smoke: post delta simulation plus one live pull.

## Sprint 11 - Weekly Operating Rhythm

Goal: Maya becomes useful for a full week, not just a single alert.

Scope:

- Weekly TikTok content plan with calendar events.
- Weekly performance review.
- Resurface parked ideas.
- Update creator picture.
- Compile memory-wiki pages:
  - content pillars
  - hooks that work
  - hooks to avoid
  - recurring formats
  - audience questions
  - niche trend patterns
- Operator/beta debug view showing why Maya suggested what she suggested.

OpenClaw native usage:

- Cron for weekly plan/review.
- Memory-wiki/dreaming for compounding learning.

Acceptance bar:

- A beta creator uses Maya for 7 days and receives:
  - at least 3 daily useful suggestions or plans
  - one weekly plan
  - one weekly review
  - at least one memory-backed recommendation
- Their Google Calendar contains an accurate content schedule for the week.
- Creator says whether they would keep using it.

Tests:

- Time-travel cron simulation.
- Memory-wiki write/read/lint flow.
- No duplicate weekly suggestions.
- Real-world 7-day beta run log.

## Sprint 12 - Monetization Hooks Without Brand Outreach

Goal: make Maya more obviously tied to revenue without adding risky outreach.

Scope:

- TikTok Shop content ideas for relevant TikTok niches.
- Affiliate/product content suggestions.
- Product trend monitoring.
- Optional ad-library signal watcher for "brands spending in this niche."
- No outbound brand email.

ScrapeCreators usage:

- TikTok Shop search/products/details/reviews/user showcase.
- Public ad library endpoints.

Acceptance bar:

- Maya can suggest one content idea tied to a product/category trend with real
  evidence.
- Maya does not make income guarantees.

Tests:

- Revenue claim firewall.
- Product endpoint normalization.
- Cost gate for ad details endpoints.
- Real smoke: one TikTok Shop search.

## Sprint 13 - Beta Hardening

Goal: make the product safe enough for real users.

Scope:

- Settings/revoke controls.
- Data deletion path.
- Error handling and partial failure UX.
- Cost dashboards for ScrapeCreators and model calls.
- OpenClaw deployment health dashboard.
- ClawMessenger multi-tenant setup verified for multiple creators, or a
  documented fallback beta channel is chosen.
- On-call/runbook docs.
- Beta cohort admin tools.

Acceptance bar:

- Operator can onboard, deploy, inspect, pause, resume, and delete multiple
  creators.
- A failed ScrapeCreators call, model call, calendar OAuth, or OpenClaw deploy
  produces a clear state and retry path.
- No tenant can see another tenant's data.

Tests:

- Full journey test from signup to deployed Maya.
- Failure-mode tests for external APIs.
- Delete/export tests.
- Billing/plan-gate tests if Stripe is enabled.
- Live deploy/undeploy smoke.

## Sprint 14 - Real-World Beta

Goal: two real creators use Maya for a week.

Scope:

- Onboard two creators.
- Run Maya for 7 days.
- Collect qualitative feedback.
- Measure:
  - suggestions sent
  - suggestions accepted
  - plans generated
  - posts made
  - postmortems delivered
  - repeat-use behavior
  - "would keep this" answer
- Fix blockers only.

Acceptance bar:

- Both creators complete onboarding.
- Both receive at least three grounded suggestions.
- At least one creator films/posts from a Maya plan.
- At least one creator uses a Maya-created Google Calendar event to film.
- Both answer whether they would keep using Maya.
- Operator can explain every Maya suggestion from logs/evidence.

## Explicitly Out Of Scope Until Later

- Autonomous posting
- Autonomous brand outreach
- Gmail sending on behalf of creators
- Auto-negotiation
- Contract redlining as v0 core loop
- Apple Calendar direct sync before native app/EventKit
- Instagram, YouTube, Reddit, and other multi-platform trend intelligence before
  the TikTok loop works
- "Predict virality" claims
- Fully autonomous browser operation on logged-in user accounts without explicit
  consent and narrow task scope

## Open Questions Before Implementation

1. Do we upgrade OpenClaw immediately to `2026.5.20`, or run one sprint on
   `2026.4.23` while testing the upgrade in parallel?
2. Does the new ClawMessenger multi-tenant setup land in time for beta, or do
   we use a single-tenant/fallback channel during early tests?
3. Which two real beta creators are we building the first fixtures around?
4. What is the outbound text cap per day for beta: 2, 3, or 4?
5. Do we enable OpenClaw dreaming in v0, or start with memory-wiki only and add
   dreaming after week-one beta?
6. What ScrapeCreators monthly credit budget should each beta creator get?
7. What default calendar planning window should Maya own: 7 days, 14 days, or
   rolling 30 days?

## Engineering Rule

If a feature is not backed by one of the verified capabilities above, it does
not enter the sprint plan. If OpenClaw already owns the primitive, HeyMaya only
configures it or writes domain-specific instructions/skills around it.
