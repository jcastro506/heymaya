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

---

# Part II — Runtime: From Skeleton to Continuous Executor

Sprints 0-12 above describe building Maya's brain (research, evidence, channel judge, calendar, mission board). They presume the runtime layer (cron firing user-visible messages, agent calling back into Convex, skills doing real work, workspace files updating from completed research) already works. It does not. Every cron currently ticks in silence with mocked data and no callback.

Part II addresses the runtime. It is additive: Sprints 13-22 plus six platform decisions (D1-D6) that lock the channel + image + bridge architecture before any further sprint work begins.

## Platform decisions (lock before sprint work)

These are based on verified-against-docs OpenClaw behavior, captured 2026-05-23. Disagreement must be raised before starting any sprint they affect.

### D1 — Drop WhatsApp from MVP. Lead with Telegram. Defer WhatsApp to operator-mediated beta.

Verified at https://docs.openclaw.ai/channels/whatsapp: WhatsApp pairing is QR-only, no token / API-key path, no programmatic provisioning. Pairing requires SSH access to the Fly machine and physically scanning a QR on the user's phone. Acceptable for one operator-handheld beta user; impossible for self-serve sign-up.

Telegram (https://docs.openclaw.ai/channels/telegram) is token-based, programmatically provisionable, multi-tenant clean. Set `channels.telegram.botToken` or `TELEGRAM_BOT_TOKEN`, then `dmPolicy: "pairing"` and the user types `/start` to a deep link.

Action: Update landing copy and `app/onboarding/gtm/page.tsx` channel default to Telegram. Keep WhatsApp as a Sprint-17+ adjacent path, operator-mediated only.

### D2 — Drop iMessage entirely for ClawLaunch.

Verified: requires macOS host with Full Disk Access and Automation entitlements. Fly machines are Linux. iMessage was a creator-product (HeyMaya) artifact. No path to native iMessage in ClawLaunch production. Strike from all docs and copy.

### D3 — Bump OpenClaw image from v2026.4.23 to v2026.5.20+.

About one month behind upstream. The version diff includes:

- Heartbeat pollution fix (silent no-op messages were leaking into embedded context).
- Cron legacy-store handling fixes.
- Subagent allowlist tightening.
- New bundled Policy plugin for channel conformance and workspace repair.
- xAI device-code OAuth (headless-friendly).
- Breaking: removed legacy `cat SKILL.md && printf...` skill-exec path. Our bundled-skill loader must use the `read` tool.

### D4 — Convex ↔ Maya bridge is OpenClaw native webhook hooks.

The original doc implies a custom HTTP surface. OpenClaw already exposes the canonical bridge at `cron.hooks.{enabled,token,path}`:

| Endpoint | Use |
|---|---|
| `POST /hooks/agent` | Run an isolated agent turn. Body: `{ message, agentId?, deliver?, channel?, to?, model?, thinking?, timeoutSeconds? }`. Returns when queued. |
| `POST /hooks/wake` | Wake heartbeat with a system event. Body: `{ text, mode: "now"\|"next-heartbeat" }`. Lighter than a full agent turn. |
| `POST /hooks/<name>` | Custom hook with `cron.hooks.mappings.<name>` payload transform. |

Auth: `Authorization: Bearer <token>` (per-machine secret in `hooks.token`).

This is also the inverse direction we need: Convex tells Maya "research done, here are the cards" by `POST /hooks/agent` with a prompt that points her at the new evidence. No bespoke wire format.

### D5 — Skills are installed at deploy time, not bundled as 7-line stubs.

Verified at https://docs.openclaw.ai/tools/skills: `openclaw skills install <slug>` pulls from ClawHub registry (clawhub.ai) into `<workspace>/skills/<slug>/`. Multi-file skills (helper scripts, data files, sub-tools) are first-class. Bundling only `SKILL.md` silently drops everything else.

Our current `BUNDLED_SKILLS` pattern (single-file inline) is fine for the 18 GTM stubs while they are locally authored, but as soon as we pin real ClawHub skills (Sprint 7 of the original doc), we MUST install via CLI or ship the full tree. Sprint 17 picks this up.

### D6 — Workspace memory location must be on the same persistent Fly volume as `/data`.

Currently `convex/onboarding/gtm/deployMayaGtm.ts:132` sets `memorySearch.store.path: "/data/openclaw-memory/{agentId}.sqlite"` — the vector index, not canonical memory. Canonical memory is markdown files in `<workspace>/MEMORY.md`, `<workspace>/memory/YYYY-MM-DD.md`, `<workspace>/DREAMS.md`. Confirm the workspace dir is on a mounted Fly volume; otherwise memory dies on machine restart.

---

## Sprint 13 — OpenClaw image bump + persistent workspace volume

Goal: Move to v2026.5.20+ without breaking bundled skills, and confirm workspace persistence. Adds cost-cap kill switch as a foundation safety mechanism.

Files:

- `convex/onboarding/gtm/deployMayaGtm.ts:44` (image constant), `:130-158` (memorySearch config).
- Fly volume config in the machine config block.
- New: `convex/gtmMaya/costCap.ts` (kill-switch helper).
- New: `scripts/gtm-image-smoke.ts` to verify CLI surface unchanged.

Steps:

1. Pull `registry.fly.io/heymaya-openclaw:v2026.5.20`. If we do not have a private build, lift from upstream `ghcr.io/openclaw/openclaw:2026.5.20`.
2. Run `openclaw doctor` and `openclaw security audit --deep` in the new image on a throwaway Fly app. Fix any findings before pinning.
3. Audit our bundled skill loader for the removed `cat SKILL.md && printf...` exec path. Replace any shell-cat with native `read` if present.
4. Add a Fly volume (`fly volumes create gtm_workspace --size 1`) and mount at `/data`. Confirm `OPENCLAW_WORKSPACE_DIR` resolves under `/data` (set explicitly if not).
5. Verify `MEMORY.md`, `memory/`, `DREAMS.md` survive a `fly machine restart`.
6. Implement cost-cap kill switch in Convex. Required per-paid-action pre-flight: query `gtmCostLedger` sums over last hour / day / sprint, abort with 402 if cap exceeded. Caps: $3 per research job, $5/day per RWTC, $1/single smoke runaway. Override env var for emergencies.

Acceptance:

- New image boots, `openclaw doctor` green.
- A test write to `<workspace>/MEMORY.md` persists across machine restart.
- Cost kill switch rejects spend that would cross $1 ceiling on a fake account.
- All existing GTM smoke tests pass on the new image.

---

## Sprint 14 — Native cron delivery (kill `mode: "none"`)

Goal: Every cron job emits something user-visible by default via OpenClaw's native channel delivery, not by Maya having to remember to call the `message` tool.

Files:

- `convex/agents/packs/maya_gtm/generators.ts:342-457` (renderJobs).
- `convex/agents/packs/maya_gtm/__tests__/generators.test.ts` (add delivery assertions).

Steps:

1. For each of the 5 GTM crons, replace `delivery: { mode: "none", bestEffort: true }` with `delivery: { mode: "announce", channel: "telegram", to: "<%= telegramChatId %>", bestEffort: true }`. `telegramChatId` is templated at workspace-build time from the user's pairing record.
2. Boot kickoff (`0001_gtm_boot_kickoff`): keep `mode: "announce"`. Message: "Maya is online and reading your product." Proves the channel works on Day 0.
3. Heartbeat (`gtm_heartbeat`): 30min (OpenClaw default). Use `HEARTBEAT_OK` token convention — replies ≤ 300 chars are silently dropped. `lightContext: true` + `isolatedSession: true` for cost.
4. Calendar check, result refresh, weekly review: same `announce` pattern.
5. Add `delivery.failureDestination` (a Convex HTTP endpoint we own) so undeliverable messages do not vanish silently.

Acceptance:

- Real Telegram delivery on every cron tick, or silent `HEARTBEAT_OK` for heartbeat when nothing new.
- Workspace bundle generator never emits `delivery.mode: "none"` for any GTM cron (regression test).
- A delivery failure writes to `failureDestination` and is visible in mission board.

---

## Sprint 15 — Channel provisioning at signup

Goal: User leaves onboarding with a working Telegram bridge. No SSH-into-Fly required.

Files:

- New: `convex/integrations/telegram/` (botToken, sendStart, polling helpers).
- New: `app/api/telegram/webhook/route.ts` if we use webhook transport.
- `convex/onboarding/gtm/deployMayaGtm.ts` (add `TELEGRAM_BOT_TOKEN` and pairing flow to secrets).
- `convex/agents/packs/maya_gtm/generators.ts` (USER.md gets user's telegram chat ID and bot username).
- `app/onboarding/gtm/page.tsx` (add "Open Maya in Telegram" deep link step).

Steps:

1. Create one Telegram bot per environment: `@ClawLaunchBot`, `@ClawLaunchStagingBot`. Tokens in Vercel env per branch.
2. Per-user pairing: generate one-time `pair_<token>` link → `https://t.me/ClawLaunchBot?start=pair_<token>`. User taps, Telegram delivers `/start pair_<token>` to bot, webhook resolves token → user → records `telegramChatId` on the user's `gtmAgents` row.
3. Workspace bundle reads `telegramChatId` at deploy time and templates it into USER.md and all five cron `delivery.to` fields.
4. Set `channels.telegram.dmPolicy: "pairing"`, `allowFrom: [<chatId>]` on the agent's gateway config so randoms cannot talk to Maya.
5. Future multi-bot: second bot for the operator-mediated WhatsApp path (Sprint 17). One token per environment is fine for v0.

Acceptance:

- A fresh signup gets a Telegram deep link in onboarding.
- Tapping it pairs within 5 seconds; Convex row updated.
- Maya's boot kickoff message arrives in that Telegram thread within 15 min of deploy.
- Replies from the user route back through the gateway as inbound messages and wake an agent turn.

---

## Sprint 16 — Convex ↔ Maya hook bridge

Goal: Convex can wake Maya, push her work, and receive her callbacks without us building a custom HTTP layer.

Files:

- `convex/agents/packs/maya_gtm/generators.ts` (set `cron.hooks.enabled: true` + `token`).
- `convex/onboarding/gtm/deployMayaGtm.ts` (provision `GTM_HOOK_TOKEN` per-agent, expose Fly machine's hook URL).
- New: `convex/gtmMaya/openclaw/hookClient.ts` (typed POST helpers).
- New: `convex/gtmMaya/openclaw/inboundCallback.ts` — Convex HTTP action Maya calls back to.
- `convex/http.ts` (mount `/lc_gtm/research_callback` etc.).

Steps:

1. Per-agent hook token generated at deploy, stored encrypted in `gtmAgents.hookToken`, set as `hooks.token` in workspace `openclaw.json`.
2. Convex → Maya helpers:
   - `hookClient.runAgentTurn(agentId, { message, deliver?, channel?, to?, thinking? })` → `POST /hooks/agent`.
   - `hookClient.wakeHeartbeat(agentId, { text, mode })` → `POST /hooks/wake`.
   - Both signed with the per-agent token.
3. Maya → Convex callbacks (`convex/http.ts`):
   - `POST /lc_gtm/research_callback` — Maya posts research-job progress (status, partial evidence cards, cost).
   - `POST /lc_gtm/approval_decision` — user-approved drafts received via agent turn pipe.
   - `POST /lc_gtm/calendar_proposal` — events Maya wants to write to Google Calendar.
   - Auth: HMAC of the per-agent token + body.
4. Wire `researchWorker.runBudgetedResearchJob` (built in Sprint 1 of original doc) to:
   - Phase-start: `runAgentTurn` to update APP.md and tell Maya research has begun.
   - Phase-complete: `runAgentTurn` to give her the new evidence summary so she updates GTM.md.
   - All idempotent (job-id keyed) so retries are safe.

Acceptance:

- Convex can wake Maya within 1 second.
- Maya can post a callback into `/lc_gtm/*` and have it persist to Convex.
- Hook auth rejects bad tokens.
- A real research job round-trips: Convex starts → Maya reads APP.md → Convex callback writes evidence → Convex pings Maya → Maya summarizes to Telegram.

---

## Sprint 17 — Real skill installation + ClawHub pinning

Goal: Replace the 18 seven-line stubs with real, version-pinned skills installed at deploy time.

Files:

- New: `convex/agents/packs/maya_gtm/pinnedClawhubSkills.ts` (lock file from Sprint 7 of original doc).
- `convex/onboarding/gtm/deployMayaGtm.ts` (add `openclaw skills install` step before machine boot, OR ship pre-installed in image).
- `convex/agents/packs/maya_gtm/generators.ts:500-587` (delete stub `renderSkill()` for non-local skills; keep only for purely-local ones like `maya-channel-strategy-judge`).
- New: `agents/skills/maya-gtm/<slug>/SKILL.md` for any locally-authored skills needing real bodies (channel-strategy-judge, slop-critic, viral-demo-moment-miner, etc.).

Steps:

1. Create `pinnedClawhubSkills.ts` with exact lock from Sprint 7 of original doc (reddit-readonly, search-x, tiktok, jk-archivist-tiktok-packager, instagram, market-research, in-depth-research).
2. At deploy: build a pre-install layer in the workspace bundle that, on first boot, runs `openclaw skills install <slug>@<version>` for each entry. Cache between machine restarts via persistent volume.
3. For 17 locally-authored Maya skills: write real SKILL.md files (200+ lines each) in `agents/skills/maya-gtm/<slug>/` with concrete instructions, evidence schema, failure behaviors. Ship the whole subdirectory in the workspace tarball.
4. Verify the SKILL.md parser caveat: single-line frontmatter only. Lint at build time.
5. `agents.list[].skills` allowlist per-agent to lock down what GTM Maya can call (drop unused ClawHub installs).

Acceptance:

- Deployed workspace has 7 ClawHub skills installed + 17 locally-authored skills, all ≥ 100 lines.
- `openclaw skills list` on the Fly machine shows all 24.
- A test research turn confirms Maya picks the right skill for each platform.

---

## Sprint 18 — Heartbeat tasks block (use the native primitive)

Goal: Stop hand-rolling cron throttle logic; let OpenClaw's native `tasks:` YAML in HEARTBEAT.md do interval gating.

Files:

- `convex/agents/packs/maya_gtm/generators.ts:314-339` (renderHeartbeat).

Steps:

1. Convert HEARTBEAT.md to use the documented `tasks:` block:

```yaml
tasks:
- name: pending-approvals
  interval: 30m
  prompt: "Check gtmDrafts where status='pending_approval' and the user hasn't replied in 24h. Send one nudge if any. Don't repeat the nudge until 48h."
- name: calendar-due
  interval: 1h
  prompt: "Check gtmCalendarEvents in the next 2h. Send a single 'you have <event> in 30m' reminder."
- name: open-loops
  interval: 2h
  prompt: "Scan MEMORY.md for open loops. If anything is stale > 7d, surface it."
- name: hourly-result-scan
  interval: 1h
  prompt: "If any post in the last 24h has no result captured, ask the user one short question to record it."
```

2. Drop redundant cron jobs that overlap with tasks block (calendar_check + result_refresh become tasks; only weekly_review stays as cron).
3. Set `agents.defaults.heartbeat.activeHours.start: "09:00"`, `end: "22:00"`, in user's tz.
4. Set `lightContext: true` + `isolatedSession: true` on heartbeat config (documented cost-savings pattern).
5. Use `HEARTBEAT_OK` token convention: if task reply ≤ 300 chars and prefixed `HEARTBEAT_OK`, silently dropped. No spam on quiet days.

Acceptance:

- HEARTBEAT.md has a valid YAML `tasks:` block; OpenClaw parses it (verify with `openclaw heartbeat --dry-run`).
- Two of the original five crons (`gtm_calendar_check`, `gtm_result_refresh`) deleted; their work now in heartbeat tasks.
- Heartbeat fires every 30 min but silently acks most ticks.
- User gets at most ~3 messages/day on a quiet week.

---

## Sprint 19 — Workspace mutation pipeline (post-research file updates)

Goal: When research completes, APP.md / GTM.md / MEMORY.md actually update; not stay frozen at deploy time.

Files:

- New: `convex/gtmMaya/openclaw/workspaceMutator.ts`.
- `convex/onboarding/gtm/deployMayaGtm.ts` (expose `mutateWorkspace` action that re-tars affected files + uploads).
- New: `convex/agents/packs/maya_gtm/renderers/` (extract per-file renderers from generators.ts so they can be called individually post-deploy).

Steps:

1. After a research job completes, Convex calls `mutateWorkspace({ agentId, files: { "APP.md": <new>, "GTM.md": <new>, "MEMORY.md": <append> } })`.
2. Action SSHs into the Fly machine (or uses `flyctl ssh sftp` via Fly Machines API) to overwrite the files in `<workspace>/`.
3. Then `runAgentTurn({ message: "/new" })` to force session reset so new files are picked up (workspace bootstrap files only re-read at session boundary).
4. Alternatively, schedule the file swap for 3:55am-4:05am local — OpenClaw's documented daily reset at 4am local picks them up automatically without forcing `/new`.
5. MEMORY.md is append-only; never overwrite, only add at end with timestamped sections.
6. Track `lastMutationAt` in `gtmAgents` to rate-limit (no more than 1 mutation per hour outside the 4am window).

Acceptance:

- A research job completing at 2pm updates APP.md/GTM.md/MEMORY.md on the Fly machine by 2:05pm + a `/new`-triggered turn that reads them.
- Or mutations queued through 4am window land without a forced reset.
- MEMORY.md grows over time; never overwritten.
- Pre-mutation backups stored on the volume at `<workspace>/.backup/<timestamp>/`.

---

## Sprint 20 — Subagent lane for paid research

Goal: Heartbeat stays cheap. Real research happens in subagents with their own model/thinking budget.

Files:

- `convex/agents/packs/maya_gtm/generators.ts` (subagent contracts in AGENTS.md, already partially there).
- Workspace gateway config: `agents.defaults.subagents.{maxConcurrent, runTimeoutSeconds, maxChildrenPerAgent, maxSpawnDepth}`.
- New: per-platform subagent definitions in workspace YAML.

Steps:

1. Set workspace-level subagent defaults:

```json5
{
  subagents: {
    maxConcurrent: 4,
    maxChildrenPerAgent: 3,
    maxSpawnDepth: 2,
    runTimeoutSeconds: 900,
    model: "google/gemini-3.5-flash"
  }
}
```

2. For research lanes (`reddit_research`, `tiktok_format_research`, etc.), define them as configured agents (`agents.list[]`) so `sessions_spawn({ agentId: "reddit_research" })` targets the right model/thinking/tool allowlist.
3. Reddit + X + TikTok researcher agents get `tools.allow: ["scrapecreators-api", "web_fetch"]` + `thinking: "high"` (Sonnet 4.5 during beta per existing TOOLS.md).
4. Channel-judge agent gets `tools.deny: ["scrapecreators-api"]` (pure synthesis) + main_maya model.
5. Cron heartbeat at `thinking: 0` spawns research subagents at `thinking: "high"` — budget-banned parent does not block heavy child. Verified pattern via https://docs.openclaw.ai/tools/subagents.

Acceptance:

- Five named subagents (reddit, x, tiktok, instagram, channel-judge) registered as configured agents.
- A real research job spawns 4 subagents in parallel, each with independent cost accounting.
- Subagent timeouts respected (verified via test with a deliberately slow stub).
- Heartbeat at thinking-off cannot inherit the subagent's thinking budget.

---

## Sprint 21 — Standing orders, hooks, and Policy plugin

Goal: Codify operating rules as native OpenClaw primitives, not free-form prose buried in AGENTS.md.

Files:

- `convex/agents/packs/maya_gtm/generators.ts` (AGENTS.md restructured around documented standing-orders schema).
- New: `<workspace>/hooks/<name>/HOOK.md` + `handler.ts` for `message:received` (rate-limit), `session:compact:before` (memory promotion), `command:reset` (sync state with Convex).
- Enable v2026.5.20 Policy plugin (`plugins.policy.enabled: true`).

Steps:

1. Rewrite AGENTS.md to use standing-orders schema: scope / triggers / approval gates / escalation rules / execution steps / "What NOT to do." per program (research / publishing / calendar / results review).
2. Add a `message:received` hook to debounce + queue inbound user messages with documented `messages.queue.mode: "steer"`.
3. Add a `session:compact:before` hook that calls `lc_gtm/promote_to_memory` so important conversation state survives compaction.
4. Enable Policy plugin for channel conformance (auto-rejects messages that violate `dmPolicy`).
5. Add a `command:reset` hook that syncs the post-reset state back to Convex (so we know the session was reset).

Acceptance:

- AGENTS.md is structured per standing-orders convention; each program has its own block.
- Hooks fire on documented events (verified by log).
- Policy plugin enabled and `openclaw security audit --deep` passes.

---

## Sprint 22 — Production guardrails

Goal: Security, observability, version discipline.

Steps:

1. Gateway: `gateway.bind: loopback` confirmed everywhere; `gateway.auth.mode: "token"` for any non-loopback bind.
2. Run `openclaw security audit --deep` in CI on every workspace bundle change. Fail the deploy on findings.
3. Wire OTEL: `OTEL_EXPORTER_OTLP_ENDPOINT` to our observability backend (or stdout structured logs for now).
4. Rate-limit hook endpoints: per-IP, per-token. Reject query-string token attempts (docs confirm OpenClaw already rejects these, but our `/lc_gtm/*` mirror should too).
5. Concurrency: pin `cron.maxConcurrentRuns: 3` per machine. `messages.queue.mode: "steer"` for inbound during active runs.
6. Cron run-log pruning: `cron.runLog.maxBytes: "2mb"`, `keepLines: 2000` (docs defaults).
7. Add a heartbeat that pings Convex with `openclaw doctor --json` output once a day. Convex stores it; mission board surfaces gateway health.
8. Update path: pin v2026.5.20 + document `openclaw update --channel stable` for future bumps.

Acceptance:

- `openclaw security audit --deep` green.
- Doctor output landing in Convex daily.
- Mission board shows gateway-health row per user.
- Concurrency caps enforced under load test (k6 or similar).

---

## Updated implementation order (replaces "First Implementation Order")

Order matters more now. The original ordering put research workers (S1-S6) before runtime wiring. That is backwards — real research output going to `mode: "none"` cron with mocked skills is just better-quality skeleton. New order:

1. D1-D6 (decisions locked in writing — Telegram primary, drop iMessage, bump image, hooks as bridge, install skills, persistent volume).
2. S13 — image bump + persistent volume + cost-cap kill switch (foundation).
3. S15 — Telegram pairing at signup (so we have a real channel).
4. S14 — native cron delivery (kill `mode: "none"` everywhere).
5. S16 — Convex ↔ Maya hook bridge.
6. S2 (original) — GTM ScrapeCreators wrappers + fixtures.
7. S17 — real skill installation + ClawHub pinning.
8. S3 (original) — query builder.
9. S4 (original) — platform workers.
10. S20 — subagent lane.
11. S1 (original) — replace `runBudgetedResearchSkeleton`.
12. S18 — heartbeat tasks block.
13. S19 — workspace mutation pipeline.
14. S5-S6 (original) — evidence gates + channel judge.
15. S9 (original) — calendar OAuth + write.
16. S8 (original) — mission board polish.
17. S10 (original, Telegram-first) — channel handoff.
18. S11 (original) — results loop.
19. S21 — standing orders + hooks + policy.
20. S7 (original) — final skill lock review.
21. S22 — production guardrails.
22. S12 (original) — staging readiness gate.

The product is honest first (S13-S17), useful second (S2 + S20 + S1 + S18), continuous third (S19 + S5-S11), then hardened (S21 + S22 + S12).

---

# Part III — Testing & Real-World Verification

The five mandatory test categories from `CLAUDE.md` (cross-tenant isolation, plan-tier × action, adversarial inputs, sibling-file scan, TODO grep) catch correctness regressions. They do not catch: "Did the Telegram message arrive on the operator's phone?" / "Did the cron fire when expected, in the right timezone?" / "Did Maya read the new APP.md after we pushed the update?" / "Did ScrapeCreators spend stay under cap?" / "Does the message LOOK right to a human?"

Each sprint must end with a real-world verification that proves the deliverable works against real OpenClaw on real Fly with real channels and real APIs — not mocks. This part defines what "done" looks like.

## Testing layers

| Layer | When | What it catches |
|---|---|---|
| L1 — Unit (vitest) | Every PR | Pure function correctness; data-shape regressions |
| L2 — Convex-test (in-process) | Every PR | Mutation/query/action semantics; cross-tenant isolation; plan-tier × action; sibling-file coherence |
| L3 — Fixture corpus | Every PR | 50-product fixture corpus, deterministic, no external calls. Channel-judge / evidence quality / slop critic regression net. |
| L4 — Live smoke (per sprint) | Sprint gate | Single-sprint deliverable against real staging — real Fly, real OpenClaw, real Telegram, real ScrapeCreators. Operator-confirmed via `--live --confirm`. |
| L5 — Sprint-gate E2E (cumulative) | Sprint gate | Full signup → onboarding → research → delivery → callback → mutation, against staging. Grows by one assertion per sprint. |
| L6 — Operator walkthrough | Sprint gate | Human-in-the-loop. Operator's phone, operator's eyes, operator's "does this feel right." Cannot be skipped. |

L1-L3 run in CI. L4 + L5 + L6 are the sprint gate and require operator presence.

## The Mandatory Five — scoped to GTM tables

1. **Cross-tenant isolation.** Every GTM table (`gtmApps`, `gtmAgents`, `gtmResearchJobs`, `gtmEvidenceCards`, `gtmCostLedger`, `gtmChannelScores`, `gtmDrafts`, `gtmCalendarEvents`, `gtmResultSnapshots`, plus any new tables Sprints 13-22 add) MUST be account-guarded in every query/mutation/action. Test: create account A + B, write to A, prove B cannot read or mutate A's rows even via authenticated identity. Use `convex-test` `t.withIdentity()` switching.

2. **Plan-tier × action matrix.** Even with one current tier ($49 beta), enforce server-side. Test: tier=free hits paid action → 402; tier=beta hits research → 200; tier=beta with budget exhausted → 402.

3. **Adversarial inputs.** Fixture corpus at `convex/gtmMaya/__tests__/fixtures/adversarial/`. Required cases: malformed product URL, oversized intake (>50KB), prompt-injection in `founderWhy`, walkthrough video that's actually a PDF, Telegram chat ID for someone else's user, repeated rapid signups, cost-ledger row with negative `costUsd`.

4. **Sibling-file scan.** For the workspace bundle: AGENTS.md / SOUL.md / USER.md / APP.md / GTM.md / TOOLS.md / BOOT.md / HEARTBEAT.md / MEMORY.md / DREAMS.md / jobs.json + 24 SKILL.md files. If you change one, run `npm run scan:workspace-coherence` which asserts: every `name:` referenced in jobs.json exists as a cron entry; every skill referenced in AGENTS.md exists as a SKILL.md; every file in BOOT.md's "Confirm workspace files exist" list is actually generated; every channel referenced in TOOLS.md is allowlisted in the gateway config.

5. **TODO grep.** `rg "TODO|FIXME|// eslint-disable" convex/gtmMaya convex/agents/packs/maya_gtm convex/onboarding/gtm app/clawlaunch app/onboarding/gtm` returns zero unjustified hits. Inline justification format: `// TODO(<sprint>-<owner>): <why>`.

## Sprint Gate definition

A sprint is "done" only when ALL of these are true:

```
L1 + L2 + L3 green in CI ........................................ tests pass
Mandatory Five green ............................................ rules pass
L4 live smoke green with --live --confirm ....................... real-world isolated proof
L5 sprint-gate E2E green ........................................ no regressions
L6 operator walkthrough complete + screenshots .................. human sanity check
Cost ceiling for the sprint not exceeded ........................ no $ surprises
TODO grep clean ................................................. no half-finished work
Telemetry for the sprint deliverable visible in OTEL/Convex logs  observability proven
```

No partial credit. If L6 reveals the message reads as AI slop, the sprint is not done.

## Real-World Test Creator (RWTC)

A long-lived staging account that every sprint exercises. Spec:

- Clerk user: `gtm-rwtc-001@heymaya.test` (single fixed identity).
- App profile: `https://maya-rwtc.vercel.app/` (a small one-page React SaaS we control end-to-end).
- Real Telegram chat: dedicated bot `@ClawLaunchStagingBot`, dedicated personal chat.
- Real Google Calendar: dedicated calendar `Maya RWTC` on the operator's Google account.
- Real Fly machine: `maya-rwtc-staging` — long-lived, redeployed per sprint.
- Real Convex deployment: `precise-canary-781` (existing staging).
- Hard budget: $5/day across all providers; daily Convex job tears down + recreates the account if exceeded.

Why one fixed RWTC instead of throwaway: catches state-over-time bugs (Sprint 19 workspace mutation, Sprint 11 results loop) that ephemeral signups would miss. Schema migrations against RWTC also stress-test against real historical rows.

Reset cadence: full RWTC nuke before each major sprint group (S13-17 = block 1, S18-22 = block 2). Soft reset (clear `gtmResearchJobs` + `gtmEvidenceCards`) before every individual sprint smoke.

## Sprint-gate E2E (L5)

One file: `scripts/gtm-sprint-gate.ts`. Runs `--live --confirm` only. Grows by one section per sprint. By end of S22 it does the full flow:

1. Sign up as RWTC + complete intake (S15 gates Telegram pairing here).
2. Upload walkthrough video; assert Gemini analysis lands (S3-real).
3. Start real research job; assert all 4 platform workers fire (S4-real).
4. Assert cost ledger sums < $3 (S1 budget).
5. Assert evidence cards from ≥3 platforms, each with rawRef (S5).
6. Assert primary + (≤1) secondary chosen, others parked (S6).
7. Assert APP.md + GTM.md on Fly machine got updated (S19).
8. Assert Maya pinged Telegram with boot status (S14 + S15).
9. Approve a draft from the mission board (S8).
10. Assert calendar event created with full brief (S9).
11. Assert Telegram handoff message sent (Sprint 10 of original doc, now Telegram).
12. Wait 35 min; assert heartbeat fired exactly once, sent ≤300-char ack or substantive update (S18).
13. Post a result via the mission board; assert results loop interprets it (S11).
14. Trigger weekly review at 10am simulated; assert next-week plan written to GTM.md (S19).

Total runtime budget: 30 min.

## Per-sprint live verification (L4)

For each of the 10 new sprints. Every script lives at `scripts/gtm-sprint-{N}-smoke.ts`.

### S13 — Image bump + persistent volume + cost cap

- Deploy throwaway Fly app on `v2026.5.20`. Run `openclaw doctor` + `openclaw security audit --deep`. Both green.
- Write `test-string-<ts>` to `<workspace>/MEMORY.md`. `fly machine restart`. SSH back in. Confirm string still present.
- Run `openclaw skills list`. Confirm count matches expected.
- Cost cap rejects spend that would cross $1 ceiling on a fake account.
- L6: operator reads doctor + audit output, confirms no yellow warnings.

### S14 — Native cron delivery

- Deploy RWTC. Wait ≤15 min for boot kickoff Telegram message.
- For each of the 5 (now 3 after S18) crons: `openclaw cron run-now <id>` via SSH. Confirm Telegram delivery within 30s.
- Block test user in Telegram. Trigger heartbeat. Confirm `delivery.failureDestination` writes to Convex.
- Assert workspace bundle generator emits ZERO `delivery.mode: "none"` for any GTM cron (L2 unit test).
- L6: operator opens Telegram, sees 4 distinct messages, screenshots them, attaches to PR.

### S15 — Telegram pairing

- Fresh signup as brand-new Clerk user on staging.
- Tap "Open Maya in Telegram" deep link. Assert pairing token resolves to that user within 5s.
- Reply "hi" from Telegram. Assert inbound lands as agent turn within 10s.
- Adversarial: try same pair token from second Telegram account → rejection. Token after expiry (15 min) → rejection. Two Clerk users to same chat ID → rejection.
- L6: operator pairs from brand-new phone, screenshots Maya's hello-back. Confirms it reads as Maya, not generic bot copy.

### S16 — Convex ↔ Maya hook bridge

- From staging Convex action, `POST /hooks/agent` to RWTC machine. Agent turn runs + Telegram delivery within 60s.
- From Convex, `POST /hooks/wake` with `mode: "now"`. Heartbeat fires immediately.
- From Maya's session (forced agent turn), call `lc_gtm/research_callback`. Convex row written.
- Adversarial: bad token → 401. Tampered body (HMAC mismatch) → 401. Token in query string → 401. Replay same request twice → second is idempotent.
- Burst: 100 hook calls in 60s. Rate limit kicks in around 30/min. All rate-limited responses are 429, not silent drops.
- L6: operator inspects 5 hook payloads + 5 callback payloads in audit log. Confirms no raw secrets leaked.

### S17 — Real skill installation + ClawHub pinning

- Deploy RWTC. `openclaw skills list` shows all 24 skills (7 ClawHub + 17 local).
- Each ClawHub skill probe: 1-result call succeeds (e.g., `reddit-readonly` searches "test").
- Each locally-authored SKILL.md ≥ 100 lines, valid single-line frontmatter, concrete instructions (not boilerplate).
- Adversarial: invoke skill not in agent's allowlist → 403/denied.
- Skill loader regression: zero hits for removed `cat SKILL.md && printf` exec path.
- L6: operator reads 3 random skill bodies cold (no context). Each passes "could a new engineer follow this?"

### S18 — Heartbeat tasks block

- Deploy RWTC with new tasks block. `openclaw heartbeat --dry-run` parses cleanly.
- Trigger heartbeat. Inspect log for `reason=no-tasks-due` for tasks not due; `reason=task-fired` for `pending-approvals`.
- 24-hour run: count Telegram messages. ≤4 messages on quiet day (boot kickoff + at most 3 substantive heartbeat fires).
- Force heartbeat where only update is `HEARTBEAT_OK`. NO Telegram message delivered.
- Drop 2 crons (calendar_check, result_refresh). Their work now via heartbeat tasks. L5 E2E still green.
- L6: operator inspects 24-hour Telegram thread. Messages feel like a teammate, not a spammer.

### S19 — Workspace mutation pipeline

- Complete real research job on RWTC. Within 5 min, SSH to Fly machine and `cat <workspace>/APP.md`. New content reflects research output.
- Same for GTM.md. Primary/secondary channel from channel-judge run now in file.
- `cat <workspace>/MEMORY.md`. New timestamped section appended at end. Previous content NOT overwritten.
- Backup exists at `<workspace>/.backup/<timestamp>/` with old APP.md/GTM.md/MEMORY.md.
- Force `/new` after mutation. Maya's next turn reads new content (ask her "what's our primary channel"; answer matches new GTM.md).
- Schedule mutation for 3:55am. At 4:05am new content reflected without explicit reset.
- Adversarial: 5 concurrent mutations. Only one wins; rest queue. Final state consistent.
- L6: operator visually diffs APP.md/GTM.md/MEMORY.md before/after research run. Changes coherent.

### S20 — Subagent lane

- Trigger real research job. `openclaw sessions list` shows 4 subagent sessions during run.
- Cost ledger: 4 separate rows, one per subagent, with model + token count.
- Kill subagent mid-run via `openclaw sessions stop <id>`. Parent receives failure, partial-result handling fires.
- Model log: heartbeat parent was `thinking: 0` while subagent was `thinking: high`. They didn't share thinking budget.
- Subagent timeout: deliberately set 30s timeout, point at slow stub endpoint. Timeout enforced + cleanup correct.
- L6: operator reads research output and is asked to guess whether it was 1 LLM call or 4 parallel subagents. Should clearly feel like 4.

### S21 — Standing orders + hooks + Policy plugin

- Each documented hook event fires: `message:received`, `session:compact:before`, `command:reset`, `gateway:startup`. Verify via `openclaw logs --filter hooks`.
- Policy plugin: send deliberately bad inbound message (e.g., trying to invoke denied tool). Rejection logged + no agent turn fires.
- `openclaw security audit --deep` exits green.
- Trigger session compaction (`openclaw session compact --session-key <key>`). `lc_gtm/promote_to_memory` callback fires with right summary.
- L6: operator reads AGENTS.md after restructure. Each program has documented standing-orders schema (scope / triggers / etc.) and is not a wall of prose.

### S22 — Production guardrails

- `openclaw security audit --deep` green on every PR (block merge on red).
- OTEL traces visible in our backend. Required spans: `hooks.agent`, `cron.run`, `subagent.spawn`, `workspace.mutate`, `research.start`.
- Attack surface: `/hooks/agent` with no token → 401. Bad token → 401. Query-string token → 401. Expired token → 401. Replay → idempotent reject.
- Load: k6 script — 100 concurrent simulated users, each issuing 3 hook calls/min, for 5 min. p95 hook-response < 2s. No 5xx. No memory leak (Fly memory stays flat).
- Daily `openclaw doctor --json` heartbeat to Convex. Mission board shows gateway-health for RWTC.
- L6: operator reads load test report + security audit + 7-day OTEL dashboard. No unknown unknowns.

## Continuous regression prevention

The growing L5 E2E is the safety net. Every sprint adds ≥1 assertion to `scripts/gtm-sprint-gate.ts`. Before any new sprint can start, E2E must still be green against current staging.

In CI, on every PR to `staging`:

- L1, L2, L3, Mandatory Five → must pass.
- L5 E2E with `--mock-channels --mock-fly` → must pass (cheap mock variant).

Before merging `staging` → `main`:

- Full L5 E2E with `--live --confirm` against staging RWTC → must pass with operator present.
- Cost report for the merge: total $ spent during live E2E recorded in PR description.

## Operator-blocked verifications (L6)

Items only an operator can confirm. Each sprint's L6 list states the operator action explicitly. Format:

> L6 task: operator opens Telegram thread, screenshots the boot kickoff message, attaches to PR description with one-sentence "looks right" or "looks wrong + why."

If operator says "looks wrong," the sprint is not done — fix and re-verify, do not merge.

Tools: SendUserFile for screenshots, Convex dashboard for row inspection, Fly dashboard for machine state, Google Calendar UI for event verification, OpenClaw control UI (`http://<host>:18789/`) for session/cron/skill inspection.

## Cost ceilings (hard caps)

| Scope | Cap |
|---|---|
| One research job (RWTC or real user) | $3.00 (per original doc) |
| One sprint's L4 smoke + L5 E2E | $5.00 total |
| RWTC per day across all sprints | $5.00 |
| Full sprint gate (L4 + L5 + L6) for sprints 13-22 cumulative | $50.00 |
| Any single L4 smoke runaway | $1.00 — kill switch in Convex if exceeded |

Implementation: pre-flight check in every live smoke script that queries `gtmCostLedger` sum for the last hour. If > 80% of cap, abort and require manual override.

## Telemetry & observability

What every sprint must emit, where to find it:

| Event | Where | Verifies |
|---|---|---|
| `hooks.agent` invocation | OTEL + `convex/lib/hookAudit.ts` | S16 wiring |
| `cron.run` start/finish | OpenClaw `cron run history` + Convex callback log | S14, S18 |
| `subagent.spawn` + `subagent.complete` | OTEL spans, parent-child trace | S20 |
| `workspace.mutate` | Convex `gtmWorkspaceMutations` table | S19 |
| `research.start` / `research.complete` / `research.fail` | OTEL + `gtmResearchJobs.phase` | S1 (original), S4 |
| `cost.spend` | `gtmCostLedger` row per provider call | Sprint 2 budget guard |
| `delivery.fail` | `gtmDeliveryFailures` table | S14 failureDestination |
| `policy.reject` | OpenClaw logs + `gtmPolicyRejections` | S21 |
| `gateway.health` (daily) | `gtmGatewayHealth` time series | S22 |

Each sprint's L4 smoke must assert the relevant events are emitted with the expected shape.

## Adversarial corpus

`convex/gtmMaya/__tests__/fixtures/adversarial/` — committed test cases exercised by L2 and L3:

- `prompt-injection-founderWhy.json`
- `oversized-intake.json`
- `malformed-url.json`
- `cross-tenant-evidence.json`
- `cost-negative.json`
- `walkthrough-bait.json`
- `racing-deploys.json`
- `tampered-hook-payload.json`
- `replay-hook.json`
- `expired-pair-token.json`
- `cross-pair-token.json`
- `skill-allowlist-bypass.json`
- `runaway-research.json`

For each, an L2 test asserts correct rejection/handling. Adding new ones is encouraged.

## Failure mode catalog

| Failure | Action |
|---|---|
| L1/L2/L3 red | Fix immediately, do not proceed |
| Mandatory Five red | Fix immediately, do not proceed |
| L4 smoke red | Investigate root cause; if infra outage, retry with note; if code, fix |
| L5 E2E red but L4 green | Regression — earlier sprint's deliverable broken by this sprint. Revert + re-investigate. |
| Cost cap exceeded | Stop, investigate, never bypass the cap "to see what happens." |
| L6 operator "looks wrong" | Code red. Don't ship "fix in follow-up." Re-verify before merge. |
| Telemetry missing | Wire the missing event before declaring sprint done. |

## Updated implementation order (with verification gates)

| Step | Block | What it adds |
|---|---|---|
| D1-D6 | Decisions | Locked + signed off |
| S13 + gate | Foundation | New image alive, volume persistent, cost cap active. L4 + L5 (small) + L6 |
| S15 + gate | Foundation | Telegram pairing real. L4 + L5 + L6 |
| S14 + gate | Foundation | Cron delivery real. L4 + L5 + L6 |
| S16 + gate | Foundation | Hook bridge real. L4 + L5 + L6 |
| Block-1 nuke + reset RWTC | | Clean slate before brain work |
| S2 (orig) + S17 + gate | Brain prep | ScrapeCreators wrappers + real skills installed. L4 + L5 + L6 |
| S3 (orig) + gate | Brain | Query builder. L4 + L5 + L6 |
| S4 (orig) + S20 + gate | Brain | Real workers in subagent lane. L4 + L5 + L6 |
| S1 (orig) + gate | Brain | Replace skeleton. L4 + L5 + L6 |
| S18 + gate | Brain | Heartbeat tasks block. L4 + L5 + L6 |
| S19 + gate | Brain | Workspace mutation. L4 + L5 + L6 |
| S5-S6 (orig) + gate | Decisions | Evidence gates + channel judge. L4 + L5 + L6 |
| S9 (orig) + gate | Decisions | Calendar OAuth + write. L4 + L5 + L6 |
| S8 (orig) + gate | UX | Mission board polish. L4 + L5 + L6 |
| S10 (orig, Telegram-first) + gate | UX | Channel handoff. L4 + L5 + L6 |
| S11 (orig) + gate | UX | Results loop. L4 + L5 + L6 |
| Block-2 nuke + reset RWTC | | Clean slate before hardening |
| S21 + gate | Hardening | Standing orders + hooks + Policy. L4 + L5 + L6 |
| S7 (orig) + gate | Hardening | Final skill lock. L4 + L5 + L6 |
| S22 + gate | Hardening | Guardrails. L4 + L5 + L6 |
| S12 (orig) + gate | Launch | Staging readiness. Full L5 E2E, three fixture products. L4 + L5 + L6 |

---

# Part IV — Maya's Launch Expertise + Multi-Project Architecture

The original doc and Parts II/III give Maya the runtime + testing scaffolding to BE a launch agent. They don't make her a top-tier EXPERT at launching. And they assume one creator → one product, which is wrong for the ICP (vibe-coders ship multiple projects).

Part IV adds two sprints addressing these gaps:

- **S2.5** — Launch playbook research + codification. Maya gets a `PLAYBOOK.md` master + per-platform sub-playbooks grounded in real public launches (Marc Lou, Pieter Levels, Tony Dinh, indie hackers corpus). Inserted between original S2 and S3 so query-builder + workers ground against doctrine, not first-principles.
- **S23** — Multi-project architecture + tier gating. One creator → many `gtmAgents` (each with own workspace, SOUL, MEMORY, cron, Telegram routing). Tier-gated project quotas. Inserted after S22 production guardrails, before S12 staging readiness.

## Sprint 2.5 — Launch playbook research + codification

Goal: Maya stops inventing launch strategy and grounds it in studied playbooks from real indie launches.

Files:

- New: `agents/playbook/PLAYBOOK.md` (master, ~1200-1800 lines).
- New: `agents/playbook/reddit.md`, `agents/playbook/x.md`, `agents/playbook/tiktok.md` (~800-1200 lines each).
- New: `agents/playbook/instagram.md`, `agents/playbook/linkedin.md` (~300-500 lines each).
- `convex/agents/packs/maya_gtm/generators.ts` — ship all playbook files in the workspace tarball under `playbook/`.
- `convex/agents/packs/maya_gtm/generators.ts` — update AGENTS.md to require reading PLAYBOOK.md and the relevant per-platform file BEFORE channel-judge or content-drafting subagent runs.
- New: `convex/gtmMaya/__tests__/launchPlaybook.test.ts` — regression corpus.

Steps:

1. Spawn 4 research subagents in parallel against real public launches. Each writes one or more `.md` files. Citation-required — every claim either has a URL or is prefixed `(unverified, common wisdom):`.
2. Synthesize into playbook files: master `PLAYBOOK.md` + 5 per-platform.
3. Ship to workspace via `buildMayaGtmWorkspace`: paths `playbook/PLAYBOOK.md`, `playbook/reddit.md`, etc.
4. Update AGENTS.md "Operating Contract" — add explicit rule: *"Before recommending a channel or drafting content, I read PLAYBOOK.md and the relevant playbook/<platform>.md. Decision rules from the playbook OVERRIDE general intuition."*
5. Channel-judge subagent gets the playbook in its prompt: *"You have these decision rules in playbook/PLAYBOOK.md. Apply them. If your conclusion contradicts the playbook, surface the contradiction explicitly."*
6. Build a 10-launch regression corpus: 10 known indie launches (with documented primary channel — e.g., Marc Lou → X primary, Nomad List → Reddit primary, etc.). For each, build a synthetic onboarding intake matching the founder's pre-launch context. Run Maya's channel-judge. Assert: the predicted primary is either correct OR is the documented secondary OR is in the doctrine-permitted alternates.
7. Anti-slop checklist: lift the banned-phrase list from PLAYBOOK.md § Anti-Slop and feed it to the slop-critic skill so it has codified failure patterns to grep.

Acceptance:

- All 5 playbook files ship to workspace; total bundle size grows by ~30-50KB.
- AGENTS.md updated; new sibling-file scan rule asserts the playbook section exists.
- Regression corpus: ≥8/10 fixture launches get correct primary channel from channel-judge. Failures explainable (judge cited specific playbook rule it followed).
- Anti-slop critic now flags the codified phrases when present in any draft.

Live verification (L4):

- Ship to RWTC. Trigger a fresh research job. SSH into Fly machine, `cat <workspace>/playbook/PLAYBOOK.md` — present, ≥1000 lines.
- Ask Maya: "Walk me through the launch playbook for my product." Inspect reply. Confirms she references concrete decision rules from the playbook.
- Run channel-judge on 3 fixture products from the corpus. Confirm picks agree with playbook doctrine.

L6 operator follow-ups:

- Read the synthesized PLAYBOOK.md cold. Confirms it reads as an actual launch operator wrote it, not an AI summary.
- Spot-check 5 random source URLs from the citations. Confirms they resolve and back the claim made.
- Read Maya's channel-judge output on one fixture. Confirm the reasoning chain references playbook rules by name.

## Sprint 23 — Multi-project architecture + tier gating

Goal: One creator can run ClawLaunch on multiple projects. Each project gets its own Maya with isolated workspace, SOUL.md, MEMORY.md, cron schedule, and Telegram routing. Project quotas tier-gated.

Decision (per operator conversation 2026-05-23): one creator → many `gtmAgents`, each with its own Fly machine and workspace. NOT one Maya juggling N projects in shared context — that contaminates per-project SOUL/voice and breaks the "Maya actually understands MY product" moat.

Files:

- `convex/schema.ts` — `gtmAgents.label` (user-facing name), `gtmAgents.appId` becomes required (was optional). New table `gtmProjectQuotas` per-creator.
- `convex/gtmMaya/projectQuota.ts` — `canCreateProject(creatorId)` consulted before every new project creation.
- `convex/onboarding/gtm/projectCreate.ts` — new action; provisions a new gtmAgents row + appId + deploy machine for an additional project.
- `app/clawlaunch/projects/page.tsx` — project list + "new project" CTA.
- `app/clawlaunch/projects/[projectId]/page.tsx` — per-project mission board.
- Per-project Telegram: either dedicated bot per project (operator burden) OR shared bot with project-tagged messages ("[ProjectX] Maya here…"). Decision pending operator.

Steps:

1. Schema migration: `gtmAgents.appId` → required. Backfill: every existing row has its appId set already via the deploy path, so backfill is a no-op but still verified.
2. Project-quota table:
   ```
   gtmProjectQuotas:
     accountId, tier ("free" | "starter" | "pro" | "studio"),
     maxProjects, currentProjects, updatedAt
   ```
   With defaults: free=1, starter=1, pro=3, studio=10.
3. `canCreateProject` query — server-side gate, fail-closed.
4. `projectCreate` action — runs the full intake → deploy pipeline for a SECOND project. Reuses the creator's existing Telegram chat (project name templated in messages) unless the operator opts into a per-project bot in S23.5.
5. Per-project workspace separation: each gtmAgents gets its own Fly app (`maya-gtm-<agentId>`), volume (`gtm_workspace_<agentId>`), workspace bundle. NO sharing — separation is the moat.
6. Cross-project insights surface: a `/clawlaunch/insights` view that aggregates results loop data across all of a creator's projects. Studio-tier only.
7. Tier billing wiring: Stripe products for ClawLaunch (starter/pro/studio prices). Pre-Sprint 6 of original doc's billing plan but specifically for ClawLaunch.

Acceptance:

- A creator can create 2nd project on Pro tier. 4th attempt rejected (cap=3).
- Each project has its own Fly machine, own workspace, own MEMORY.md.
- Cross-tenant isolation: project A's evidence cards cannot appear in project B's research job.
- Mission board correctly scopes by `projectId` (no leaking).
- Tier downgrade does NOT delete extra projects; it disables their cron + flags them "over quota — upgrade to reactivate."

Live verification (L4):

- Provision a fresh Pro-tier creator on staging. Create 3 projects sequentially. Confirm 4th throws 402.
- Each project gets its own Fly machine — verify via Fly CLI.
- Run a research job on project 2; assert evidence cards have `projectId = project2._id`. Query project 1's mission board; confirm zero leakage.
- Downgrade creator to Starter. Confirm projects 2 + 3 cron-disabled, project 1 still active.
- Operator's Telegram receives messages tagged `[Project1]`, `[Project2]`, `[Project3]` so they can tell which Maya is talking.

L6 operator follow-ups:

- Visually inspect 3 separate Fly machines, confirm distinct workspace contents per project.
- Read 24h of Telegram traffic across 3 projects; confirm tags are clear, no message ambiguity.
- Downgrade flow user-test: confirm project-disabled state is honest (not silently broken).

## Updated implementation order (with S2.5 + S23 inserted)

Inserted at the correct points relative to the order from Part II:

1. D1-D6 (decisions locked).
2. S13 — image bump + cost cap (foundation).
3. S15 — Telegram pairing.
4. S14 — native cron delivery.
5. S16 — Convex ↔ Maya hook bridge.
6. **S2.5 — launch playbook research + codification (NEW — before research stack, so Maya grounds against doctrine from day one).**
7. S2 (orig) — ScrapeCreators wrappers.
8. S17 — real skill installation + ClawHub pinning.
9. S3 (orig) — query builder (now playbook-grounded).
10. S4 (orig) — platform workers (now playbook-grounded).
11. S20 — subagent lane.
12. S1 (orig) — replace skeleton.
13. S18 — heartbeat tasks block.
14. S19 — workspace mutation pipeline.
15. S5-S6 (orig) — evidence gates + channel judge (playbook-grounded judge).
16. S9 (orig) — calendar OAuth + write.
17. S8 (orig) — mission board polish.
18. S10 (orig) — Telegram handoff.
19. S11 (orig) — results loop.
20. S21 — standing orders + hooks + Policy.
21. S7 (orig) — final skill lock review.
22. S22 — production guardrails.
23. **S23 — multi-project + tier gating (NEW — after the single-project product is real, before staging gate).**
24. S12 (orig) — staging readiness gate (now tests across 3 projects + 3 product types).

Net: 26 sprints, 4-block structure (foundation / brain / continuity / hardening), explicit ordering with playbook insertion at the right point to make every downstream sprint smarter.

