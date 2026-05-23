# ClawLaunch GTM MVP Execution Sprint

Date: 2026-05-23
Branch target: `staging` first, then `main`
Production target: `https://clawlaunch.io`
Staging target: `staging.clawlaunch.io` after DNS verification

## Objective

Ship the first production-ready ClawLaunch MVP: a GTM agent for builders who have a product but need real users, feedback, demos, signups, and launch execution.

The MVP must not be a skeleton. It must run real research across Reddit, TikTok, X/Twitter, and Instagram; cite evidence; choose one primary channel and one secondary channel; create concrete first-week actions; and hand the user an executable plan through the app, WhatsApp, and Google Calendar.

## Current Reality

The product shell is in place, but the core research job is still mocked.

- `app/onboarding/gtm/page.tsx` collects product intake, optional walkthrough video, and production constraints.
- `convex/gtmMaya/walkthrough.ts` already analyzes walkthrough videos with Gemini.
- `convex/gtmMaya/appInspector.ts` inspects product pages.
- `convex/gtmMaya/researchLifecycle.ts` has jobs, evidence cards, cost ledger, channel scores, and account isolation.
- `convex/gtmMaya/researchWorker.ts` still calls `runBudgetedResearchSkeleton`, which writes canned evidence and zero-spend ledger rows.
- `convex/agents/packs/maya_gtm/generators.ts` already generates a Maya GTM OpenClaw workspace with custom GTM skills.
- `convex/integrations/scrapeCreators/` already has a real client/cache/audit foundation, but it is creator-profile oriented and does not yet cover the full ClawLaunch GTM research loop.

The blocking product gap is replacing the skeleton research worker with a real, budgeted, cached, cited research pipeline.

## Product Promise

ClawLaunch asks for the product, researches where demand and format-market fit already exist, then gives the builder a first-week GTM operating plan.

The week-one output must include:

- Plain-English product diagnosis.
- Likely ICP hypotheses.
- Platform-specific evidence from Reddit, TikTok, X/Twitter, and Instagram.
- One primary channel.
- One secondary channel if evidence supports it.
- Parked channels with explicit reasons.
- First-week tests with success metrics.
- Reddit reply targets and drafted replies when Reddit is active.
- TikTok scripts, shot lists, or slideshow/carousel outlines when TikTok is active.
- X/Twitter post, reply, or thread drafts when X is active.
- Instagram Reel/carousel briefs when Instagram is active.
- Google Calendar events after approval.
- WhatsApp/web mission-board handoff.

## Non-Goals For MVP

- Autonomous TikTok posting.
- Autonomous Instagram posting.
- Reddit auto-posting.
- Broad social media scheduler.
- UGC marketplace.
- Cold outbound engine.
- Full analytics dashboard.
- LinkedIn or Product Hunt as first-class MVP channels.

LinkedIn and Product Hunt can stay in existing code as parked or later channels, but the MVP focus is Reddit, TikTok, X/Twitter, and Instagram.

## Architecture Decision

Convex owns durable state, cost control, external data calls, caching, evidence storage, approvals, Calendar writes, and safety gates.

OpenClaw/Maya owns bounded reasoning over files, evidence, and task outputs.

ScrapeCreators is the public-data read layer for TikTok, Instagram, X/Twitter, Reddit, and Google/search-style discovery.

Gemini is the multimodal understanding layer for product walkthroughs, screenshots, and video/demo analysis.

Composio is the authenticated action layer after approval. It is not the research brain.

ClawHub skills are reusable execution/playbook helpers. They are not policy authorities and cannot bypass Convex approval gates.

## Data Flow

1. User starts GTM onboarding.
2. User enters product name, URL, founder reason, stage, weekly goal, and content constraints.
3. User optionally uploads a walkthrough video.
4. Convex inspects the app URL and/or analyzes the walkthrough with Gemini.
5. Convex builds a `ResearchRunSpec`.
6. Convex starts a budgeted research job.
7. Platform workers call ScrapeCreators and/or pinned read-only skills.
8. Model classifiers convert raw platform data into normalized evidence cards.
9. Convex stores evidence, costs, task statuses, failures, and raw references.
10. Channel judge chooses primary, secondary, and parked channels.
11. Maya drafts first-week experiments and content/reply assets.
12. User reviews the mission board.
13. On approval, Maya writes Calendar events and sends WhatsApp/web handoff.
14. User executes manually.
15. Results loop records outcomes and updates the next plan.

## Required Schemas

### `ResearchRunSpec`

The orchestrator builds this once per onboarding run.

```ts
type ResearchRunSpec = {
  accountId: Id<"creators">;
  appId: Id<"gtmApps">;
  researchJobId: Id<"gtmResearchJobs">;
  product: {
    name: string;
    url: string;
    stage: "idea" | "live-beta" | "paid" | "unknown";
    weekGoal: "feedback" | "signups" | "demos" | "revenue" | "unknown";
    founderWhy?: string;
    appInspection?: unknown;
    walkthroughDiagnosis?: unknown;
  };
  productionConstraints: {
    canRecordScreen: boolean;
    canShowFace: boolean;
    canRecordVoice: boolean;
    canProvideScreenshots: boolean;
    canPostTikTokManually: boolean;
    canPostInstagramManually: boolean;
    existingTikTokUrl?: string;
    existingInstagramUrl?: string;
    tiktokWarmupState?: string;
    creatorBudgetMonthlyUsd?: number;
    maxWeeklyVisualPosts?: number;
    excludedAudiences: string[];
  };
  budget: {
    maxUsd: number;
    maxScrapeCreatorsCalls: number;
    maxModelCalls: number;
  };
  platforms: Array<"reddit" | "tiktok" | "x" | "instagram">;
  queryPacks: PlatformQueryPack[];
};
```

### `PlatformQueryPack`

Each platform gets different questions. Do not reuse one generic marketing prompt.

```ts
type PlatformQueryPack = {
  platform: "reddit" | "tiktok" | "x" | "instagram";
  painQueries: string[];
  solutionQueries: string[];
  competitorQueries: string[];
  formatQueries: string[];
  exclusionQueries: string[];
  minimumEvidenceCards: number;
};
```

### `PlatformResearchResult`

Each worker returns a bounded result.

```ts
type PlatformResearchResult = {
  platform: "reddit" | "tiktok" | "x" | "instagram";
  status: "succeeded" | "insufficient_evidence" | "failed";
  summary: string;
  evidenceCards: EvidenceCardInput[];
  formatPatterns: FormatPattern[];
  replyOrContentOpportunities: Opportunity[];
  promotionRisks: string[];
  missingCoverage: string[];
  costLedger: CostLedgerInput[];
};
```

## ClawHub Skill Pack

Install or fork only skills that help the MVP without giving them unapproved write power.

### Install/Fork Now

| Skill | Source | Use | Decision |
|---|---|---|---|
| `reddit-readonly` | `https://clawhub.ai/buksan1950/reddit-readonly` | Reddit search, posts, comments, thread bundles | Install or fork. Read-only fits MVP. |
| `search-x` | `https://clawhub.ai/mvanhorn/search-x` | X/Twitter search with citations through xAI | Install if using `XAI_API_KEY`; otherwise keep ScrapeCreators X first. |
| `tiktok` | `https://clawhub.ai/agenticio/tiktok` | TikTok hooks, scripts, retention, content pillars | Install. Already aligned with no posting/no automation. |
| `jk-archivist-tiktok-packager` | `https://clawhub.ai/jk-archivist/jk-archivist-tiktok-packager` | Deterministic 6-slide portrait PNG assets and captions | Install/fork. Good MVP-safe slideshow packager. |
| `instagram` | `https://clawhub.ai/agenticio/instagram` | Instagram hooks, captions, carousel/Reel structure | Install or reference. Local-first and no auto-posting. |
| `market-research` | `https://clawhub.ai/ivangdavila/market-research` | Demand validation, competitors, market framing | Install/reference for research protocol. |
| `in-depth-research` | `https://clawhub.ai/ivangdavila/in-depth-research` | Multi-source research methodology and source evaluation | Install/reference for methodology. |

### Evaluate Later

| Skill | Source | Reason |
|---|---|---|
| `x-search` | `https://clawhub.ai/jaaneek/x-search` | Strong stars/downloads, but audit pending. Compare against `mvanhorn/search-x`. |
| `instagram-search` | `https://clawhub.ai/atyachin/instagram-search` | Useful, audit pass, but adds Xpoz vendor surface. Use ScrapeCreators first. |
| `viral-video-studio` | `https://clawhub.ai/eddieluong/viral-video-studio` | Good reference workflow, but broad and not ClawLaunch-specific. |
| `social-video-analytics` | `https://clawhub.ai/imwyvern/social-video-analytics` | Useful for later results loop, not core onboarding. |

### Avoid Raw Production Install

| Skill | Reason |
|---|---|
| Broad auto-posting skills | They can bypass approval gates. |
| Browser-cookie X/TikTok/Instagram skills | Secrets and platform risk are too high for hosted MVP. |
| TikTok skills requiring `TIKTOK_COOKIES` | Fork the playbook, do not run cookie-based posting. |
| Reddit posting/moderation skills | Use read-only in MVP; drafts should go through approval. |

## Sprint 0: Deployment And Environment Lock

Goal: make sure the app branches and deployment targets are clean before product work.

Steps:

1. Keep active work on `staging`.
2. Merge to `main` only after staging smoke passes.
3. Confirm Vercel production branch is `main`.
4. Confirm `clawlaunch.io` points to the ClawLaunch Vercel project.
5. Confirm `staging.clawlaunch.io` DNS TXT verification is complete.
6. Confirm preview/staging env vars include Convex, Clerk, Gemini, ScrapeCreators, OpenClaw, Fly, WhatsApp, and Calendar settings.
7. Do not expose secrets in docs, logs, or PR comments.

Acceptance:

- `staging` branch push creates a staging deployment.
- `main` branch push creates production deployment.
- Staging and production both run ClawLaunch, not the old Maya for Creators app.

## Sprint 1: Remove Skeleton Research Path

Goal: replace `runBudgetedResearchSkeleton` with a real job runner.

Files:

- `app/onboarding/gtm/page.tsx`
- `convex/gtmMaya/researchWorker.ts`
- `convex/gtmMaya/researchLifecycle.ts`
- `convex/gtmMaya/researchTasks.ts`
- `convex/gtmMaya/researchResults.ts`

Steps:

1. Add `runBudgetedResearchJob` as a Convex action.
2. Keep `runBudgetedResearchSkeleton` only for tests or remove it after replacement tests pass.
3. Update onboarding to call `runBudgetedResearchJob`.
4. Patch job phase as it moves through:
   - `app_inspection`
   - `icp_hypotheses`
   - `channel_research`
   - `strategy_judge`
   - `calendar_build`
   - `complete`
5. Write partial failures into the job rather than throwing away usable evidence.
6. Enforce budget before each external call.

Acceptance:

- No production onboarding route calls the skeleton worker.
- A research job creates real evidence from at least two external sources.
- A failed platform worker does not block other platforms from completing.
- `gtmCostLedger` has real rows for every ScrapeCreators/model call.
- `needs_more_evidence` is returned when evidence minimums are not met.

Tests:

- Unit: budget guard blocks calls after cap.
- Unit: platform failure records partial result.
- Integration: mocked ScrapeCreators responses create evidence cards.
- Regression: cross-account isolation still passes.

## Sprint 2: GTM ScrapeCreators Read Layer

Goal: add product-critical GTM wrappers on top of the existing ScrapeCreators client/cache.

Files:

- `convex/integrations/scrapeCreators/endpoints.ts`
- `convex/integrations/scrapeCreators/client.ts`
- `convex/integrations/scrapeCreators/cache.ts`
- New: `convex/gtmMaya/scrapeCreatorsGtmResearch.ts`
- Tests under `convex/integrations/scrapeCreators/__tests__/` and `convex/gtmMaya/__tests__/`

Required endpoints:

Reddit:

- Search Reddit by query.
- Search/list subreddit posts.
- Fetch subreddit details.
- Fetch post comments.

TikTok:

- Search by keyword.
- Search by hashtag.
- Top search.
- Video details.
- Video comments.
- Video transcript.
- Trending feed.
- Profile videos when a competitor/account is known.

X/Twitter:

- Profile.
- User tweets.
- Tweet details.
- Transcript when available.
- Community and community tweets if useful.
- Optional: `search-x` ClawHub skill for real-time cited search if xAI key is configured.

Instagram:

- Profile/basic profile.
- User posts.
- User reels.
- Post/Reel info.
- Transcript.
- Search Reels.
- Comments.

Google/search:

- Search for competitor/substitute/pain-query discovery when ScrapeCreators Google endpoint is configured.

Steps:

1. Normalize env naming. Canonical value should be `SCRAPE_CREATORS_API_KEY`; support `SCRAPECREATORS_API_KEY` temporarily as fallback.
2. Add typed wrappers only for endpoints needed by ClawLaunch MVP.
3. Add normalized result mappers for `ResearchRawItem`.
4. Cache by account, platform, endpoint, query, and time window.
5. Add `rawRef` values that can trace every evidence card back to provider output.
6. Add live smoke script for operator-run validation, but keep CI mocked.

Acceptance:

- Mock tests prove Reddit/TikTok/X/Instagram calls normalize into usable raw items.
- Live smoke can run one test query per platform outside CI.
- 400/401/402/500 responses produce graceful failures and cost ledger rows.
- Cache hits do not spend again.

## Sprint 3: Query Builder And Product Diagnosis

Goal: generate the right questions before spending platform calls.

Files:

- `convex/gtmMaya/appInspector.ts`
- `convex/gtmMaya/walkthrough.ts`
- New: `convex/gtmMaya/researchQueryBuilder.ts`

Steps:

1. Combine app inspection, founder reason, stage, goal, and walkthrough diagnosis into a `ProductDiagnosis`.
2. Generate three to five ICP hypotheses.
3. Generate platform-specific query packs.
4. Add query dedupe and phrase expansion.
5. Add excluded-audience filter.
6. Add competitor/substitute query generation.

Platform query rules:

Reddit:

- Search for pain language, substitutes, complaints, tool recommendations, and "how do I" threads.
- Prefer communities where helpful replies are allowed.
- Always fetch comments for the best threads.

TikTok:

- Search product-demo language, niche pain language, "I built", "tools for", and competitor terms.
- Pull video details, comments, and transcripts for promising examples.
- Classify format: faceless demo, founder talking head, slideshow/carousel, screenshot sequence, UGC-style, skit, tutorial, comparison.

X/Twitter:

- Search for founders/buyers discussing the pain, substitutes, launches, and complaints.
- Prefer specific conversations over generic build-in-public content.
- Extract people/accounts worth replying to or modeling.

Instagram:

- Search Reels/carousel formats, visual hooks, comment language, and creator-native reuse formats.
- Decide whether Instagram is primary, secondary, or reuse-only.

Acceptance:

- Query packs differ by platform.
- Empty/thin product pages still produce conservative queries from founder intake.
- Walkthrough analysis changes TikTok/Instagram format recommendations.

## Sprint 4: Platform Workers

Goal: each platform has a bounded worker with its own evidence standard.

Files:

- New: `convex/gtmMaya/platformWorkers/reddit.ts`
- New: `convex/gtmMaya/platformWorkers/tiktok.ts`
- New: `convex/gtmMaya/platformWorkers/x.ts`
- New: `convex/gtmMaya/platformWorkers/instagram.ts`
- New: `convex/gtmMaya/platformWorkers/shared.ts`

Reddit worker:

1. Run subreddit and post searches.
2. Fetch comments for the top candidate threads.
3. Score pain intensity, buyer fit, freshness, and promotion risk.
4. Return reply targets and draft angles.

TikTok worker:

1. Run keyword/hashtag/top searches.
2. Fetch video details, comments, and transcripts.
3. Classify working formats.
4. Identify hooks, proof beats, objections, and CTA patterns.
5. Return script/shot-list opportunities.

X/Twitter worker:

1. Run search against ScrapeCreators and/or pinned `search-x`.
2. Identify founder/buyer conversations and complaint language.
3. Score reply opportunities, post angles, and accounts to watch.
4. Return concise drafts or thread outlines.

Instagram worker:

1. Run reels/profile/post searches.
2. Fetch comments/transcripts where available.
3. Classify Reels, carousel, screenshot, and caption patterns.
4. Decide whether IG is active, secondary, or reuse-only.
5. Return carousel/Reel briefs.

Acceptance:

- Every worker can return `insufficient_evidence` without inventing.
- Every worker writes at least the required minimum evidence cards when successful.
- Every worker records raw refs and cost rows.
- Workers are independently testable with fixtures.

## Sprint 5: Evidence Normalization And Quality Gates

Goal: make sure the agent cannot make a confident plan from weak evidence.

Files:

- `convex/gtmMaya/channelScoring.ts`
- `convex/gtmMaya/researchResults.ts`
- `convex/gtmMaya/researchTasks.ts`
- `convex/gtmMaya/platformIntelligence.ts`

Steps:

1. Normalize all worker findings into `gtmEvidenceCards`.
2. Enforce URL citations.
3. Enforce source-platform match.
4. Enforce minimum useful evidence per platform.
5. Reject generic evidence like "people like productivity tools" unless tied to product-specific pain.
6. Record missing coverage and parked-channel reasons.

Acceptance:

- Channel scores cannot reference evidence from another account/job.
- TikTok and Instagram are blocked when user cannot produce visual assets this week.
- Reddit is blocked or draft-only when promotion risk is high.
- X is parked when evidence is generic build-in-public noise.

## Sprint 6: Channel Judge And Week-One Plan

Goal: convert evidence into a narrow execution plan.

Files:

- `convex/gtmMaya/strategyJudge.ts`
- `convex/gtmMaya/experimentPlanner.ts`
- `convex/gtmMaya/distributionMotions.ts`
- `convex/gtmMaya/contentQuality.ts`

Steps:

1. Evaluate only Reddit, TikTok, X/Twitter, and Instagram for MVP.
2. Choose exactly one primary channel.
3. Choose at most one secondary channel.
4. Park the rest with explicit reasons.
5. Generate first-week tests.
6. Generate stop/double-down metrics.
7. Draft execution assets for active channels.

Output examples:

- Reddit primary: 10 reply targets, five drafted replies, subreddit rules, risk notes, daily calendar blocks.
- TikTok primary: three scripts, one slideshow/carousel outline, one faceless demo shot list, posting checklist.
- X primary: five reply targets, three founder posts, one thread, account list.
- Instagram secondary: two carousel briefs and one Reel reuse brief from TikTok.

Acceptance:

- The plan fits the user's stated weekly capacity.
- No plan recommends more than two active channels.
- Every draft references evidence.
- Draft quality gate rejects generic AI marketing language.

## Sprint 7: ClawHub Skill Pinning For GTM Maya

Goal: preinstall useful skills in the GTM OpenClaw workspace with version locks.

Files:

- New: `convex/agents/packs/maya_gtm/pinnedClawhubSkills.ts`
- `convex/agents/packs/maya_gtm/generators.ts`
- Tests under `convex/agents/packs/maya_gtm/`

Steps:

1. Add a GTM-specific pinned ClawHub lock.
2. Pin approved skills with exact versions.
3. Hydrate full skill bodies where possible.
4. Mark any non-hydrated skill as stub and block runtime invocation until hydrated.
5. Add generated workspace files:
   - `.clawhub/lock.json`
   - `CLAW_SKILLS.md`
   - pinned skill directories under `skills/`
6. Update `AGENTS.md` to say ClawHub skills are helpers, not authority.
7. Add tests that every pinned skill is referenced by the GTM workspace and every referenced skill exists.

Initial lock:

```json
{
  "version": 1,
  "skills": {
    "reddit-readonly": {
      "source": "clawhub:buksan1950/reddit-readonly",
      "version": "1.0.0"
    },
    "search-x": {
      "source": "clawhub:mvanhorn/search-x",
      "version": "1.2.1"
    },
    "tiktok": {
      "source": "clawhub:agenticio/tiktok",
      "version": "3.0.0"
    },
    "jk-archivist-tiktok-packager": {
      "source": "clawhub:jk-archivist/jk-archivist-tiktok-packager",
      "version": "1.6.0"
    },
    "instagram": {
      "source": "clawhub:agenticio/instagram",
      "version": "2.1.1"
    },
    "market-research": {
      "source": "clawhub:ivangdavila/market-research",
      "version": "1.0.1"
    },
    "in-depth-research": {
      "source": "clawhub:ivangdavila/in-depth-research",
      "version": "1.0.0"
    }
  }
}
```

Acceptance:

- Deployed Maya workspace includes the curated skill list.
- No third-party skill can post without Convex approval.
- Cookie-based platform automation is not included.
- Skill versions are deterministic.

## Sprint 8: Mission Board And Review Surface

Goal: show the result in a way the user can execute.

Files:

- `convex/gtmMaya/missionBoard.ts`
- App route for the GTM mission board if missing or incomplete.
- Components under the ClawLaunch app surface.

Mission board sections:

- Product diagnosis.
- ICP hypotheses.
- Evidence summary by platform.
- Primary channel.
- Secondary channel.
- Parked channels.
- First-week plan.
- Drafts requiring approval.
- Calendar readiness.
- WhatsApp handoff state.
- Cost and coverage summary.

Acceptance:

- User can understand the plan without reading logs.
- Evidence cards link to sources.
- Drafts can be approved/rejected.
- Missing Calendar/WhatsApp connections are shown as setup blockers.

## Sprint 9: Google Calendar For GTM

Goal: schedule approved execution, not just show strategy.

Files:

- Existing:
  - `app/api/google-calendar/start/route.ts`
  - `app/api/google-calendar/callback/route.ts`
  - `app/api/google-calendar/callback-imessage/route.ts`
- New or refactored GTM-specific routes/helpers.
- `convex/gtmMaya/calendarPlan.ts`

Steps:

1. Refactor Calendar OAuth so GTM users do not redirect into Creator Maya flows.
2. Store GTM Calendar connection scoped to the GTM account.
3. Ask for Calendar connection after research, before scheduling.
4. Create rich Calendar events only after approval.
5. Include source links, scripts, assets needed, and success metrics in event descriptions.
6. Tag Maya-owned events so updates/deletes never touch non-Maya events.

Acceptance:

- No Calendar write before approval.
- Calendar connect works for GTM account.
- Approved plan creates accurate events.
- Re-running plan updates Maya-owned events idempotently.

## Sprint 10: WhatsApp Handoff

Goal: make Maya feel like a teammate who comes back with the plan.

Steps:

1. Send a concise WhatsApp summary when research is ready.
2. Include only:
   - primary channel
   - first next action
   - one evidence-backed reason
   - link to mission board
   - approval prompt
3. Support replies:
   - approve
   - reject
   - revise
   - schedule
   - show evidence
4. Route replies back to Convex state.

Acceptance:

- User can approve or ask for changes from WhatsApp.
- Maya does not claim she scheduled anything before Calendar write succeeds.
- Failed WhatsApp delivery appears in mission board.

## Sprint 11: Results Loop

Goal: make the second week smarter than the first.

Files:

- `convex/gtmMaya/resultsLoop.ts`
- `convex/gtmMaya/privateBeta.ts`

Steps:

1. Track planned actions.
2. Track executed actions.
3. Let user enter results manually for MVP.
4. Pull public metrics through ScrapeCreators only where available and budgeted.
5. Compare results to stop/double-down metrics.
6. Generate next-week plan.

Acceptance:

- Maya can say what worked, what did not, and what changed.
- No metrics are invented.
- Manual results are clearly labeled as user-provided.

## Sprint 12: Production Readiness Gate

Goal: prove this is beta-ready on staging.

Fixture products:

1. Visual SaaS with clear screen-recording potential.
2. Boring B2B tool where Reddit or X should beat TikTok.
3. Consumer-ish app where TikTok/Instagram should be evaluated.

Required staging run:

1. Complete signup.
2. Complete GTM onboarding.
3. Upload or skip walkthrough.
4. Run real research.
5. Confirm evidence cards from Reddit, TikTok, X/Twitter, and Instagram or explicit insufficient-evidence reasons.
6. Confirm primary/secondary/parked decisions.
7. Approve one draft.
8. Connect Calendar.
9. Create Calendar events.
10. Receive WhatsApp handoff.
11. Deploy OpenClaw Maya.
12. Ask Maya why she picked the channel and confirm she cites stored evidence.

Acceptance:

- Full staging run completes without manual database edits.
- Cost stays under configured onboarding cap.
- No unauthorized publishing occurs.
- Mission board is usable.
- Production env vars are present.
- `main` deploy is approved only after staging passes.

## Cost Policy

Default beta research budget:

- `budgetUsd`: 3.00 max per onboarding research run.
- Prefer target spend under 1.50.
- Max ScrapeCreators calls: 40.
- Max model calls after app/walkthrough diagnosis: 12.
- Heartbeat spend: 0.

Call budget sketch:

- Reddit: 8 calls.
- TikTok: 12 calls.
- X/Twitter: 8 calls.
- Instagram: 8 calls.
- Competitor/search: 4 calls.

Every call must write:

- provider
- operation
- reason
- units
- cost estimate
- cache status
- metadata without secrets

## Safety Rules

- No public post without explicit approval.
- No Reddit posting in MVP.
- No TikTok/Instagram direct posting in MVP.
- No browser-cookie or session-cookie skill in hosted runtime.
- No claims without evidence.
- No cross-account evidence access.
- No external spend from heartbeat.
- No Calendar write before approval.
- No generated plan that exceeds user capacity.

## Definition Of Done

The MVP is done when:

- `runBudgetedResearchSkeleton` is not used in production onboarding.
- Live research works across Reddit, TikTok, X/Twitter, and Instagram.
- Every recommendation cites evidence.
- One primary and at most one secondary channel are selected.
- Parked channels have clear reasons.
- User can approve drafts.
- Approved work creates rich Google Calendar events.
- WhatsApp handoff works.
- OpenClaw Maya can explain and continue from stored evidence.
- Staging smoke passes.
- Production deploy on `main` serves the same ClawLaunch code.

## First Implementation Order

Build in this order:

1. Add GTM ScrapeCreators wrappers and fixtures.
2. Add `ResearchRunSpec` and query builder.
3. Add Reddit worker.
4. Add TikTok worker.
5. Add X/Twitter worker.
6. Add Instagram worker.
7. Replace onboarding skeleton call.
8. Update channel judge to four MVP platforms.
9. Add ClawHub GTM pinned skill lock.
10. Update mission board.
11. Add GTM Calendar OAuth/write path.
12. Add WhatsApp ready/approval loop.
13. Run staging E2E.

This order gets the product honest first, then useful, then deployable.
