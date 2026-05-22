# Maya GTM Agent Sprint Plan

Last updated: 2026-05-22

## Product Contract

Maya GTM is an OpenClaw-powered go-to-market teammate for people who shipped
or vibe-coded an app and do not know how to get users.

The promise:

> Give Maya your app. She will research who might care, choose the best first
> channels, create the daily GTM work, put it on your calendar, ask for
> approval, publish where safe, and learn from results.

This is not a Twitter bot, not a generic social scheduler, and not a ClawGTM
clone. ClawGTM is outbound-sales led. Maya GTM is founder-led content,
community, and launch execution for early app builders.

After reviewing Nicole's consumer-app growth playbook, add one sharper product
principle:

> Maya does not help the founder "post more." Maya turns distribution into an
> experiment system: try formats, measure signal, double down, train repeatable
> execution, and scale only after a channel/format proves it can create users.

That matters because consumer app growth often requires very high output and
structured iteration. A single good TikTok script is not the product. The
product is the operating system that finds a viable distribution format, keeps
testing variants, converts learning into the next batch, and eventually helps
the founder recruit/train other people if UGC becomes the winning motion.

## Target User

The starting ICP is:

- Solo app builders, vibe coders, indie hackers, and AI-app builders.
- They already have an app URL, demo, waitlist, or usable beta.
- They do not clearly know their ICP.
- They do not have a repeatable distribution motion.
- They are willing to approve content and record screen/face clips when needed.
- They are willing to answer production-reality questions so Maya can choose
  channels they can actually execute.
- They are already paying for developer tools, so a $49-$99/month product is
  plausible if Maya drives real user signal.

Avoid building for pure idea-stage users. Maya can help them, but the product
is most valuable when there is something real to inspect and promote.

## Non-Goals

Do not build these in V1:

- A full cold-email/outbound sales product.
- LinkedIn lead-gen automation with connection requests and DM blasting.
- Fully autonomous social posting.
- Instagram or Facebook direct posting.
- TikTok direct posting as a launch requirement.
- A large dashboard that the user must maintain.
- A brand-voice workshop.
- A content generator that posts generic advice without evidence.
- A full UGC creator recruiting/management platform.
- Paid influencer marketplace workflows.
- Internal creator training courses, quizzes, payout logic, or referral systems.

Cold outbound, deliverability, CRM, LinkedIn DMs, and booked-call workflows are
their own product. If we build them too early, Maya becomes a worse ClawGTM
instead of a distinct GTM teammate.

UGC creator operations are a likely V2 module, not a V1 dependency. V1 should
learn which channels and content formats work for the app. Only after that
should Maya help the founder systemize a creator bench, because recruiting
people before knowing the winning content system creates expensive noise.

## Current Repo Fit

The current repo contains three useful but mismatched product lines:

- Creator Maya: creator/TikTok/brand/calendar focused.
- Service Maya: local-service business operations and marketing.
- Riley Growth: a single-user internal growth agent for Josh.

Relevant reusable assets:

- Clerk auth and user rows.
- Convex backend, tests, env/deploy conventions.
- Google Calendar integration.
- Composio OAuth and action wrappers.
- ScrapeCreators client/cache/audit patterns.
- OpenClaw workspace generation patterns.
- Fly/OpenClaw machine deployment patterns.
- Existing model router and AI call logging.
- Existing approval and audit instincts from creator/service code.

Important mismatch:

- Riley is single-user and Josh-specific.
- Riley requires LinkedIn/X connection first.
- Riley asks for voice samples.
- Riley does not deeply inspect an app, form ICP hypotheses, gather evidence,
  score channels, or generate an evidence-backed GTM plan.
- Creator Maya data tables and skills are too creator-specific to be renamed
  into this product.

Recommendation:

Keep the same monorepo and shared infrastructure, but create a clean product
namespace:

- Convex modules under `convex/gtmMaya/`.
- OpenClaw pack under `convex/agents/packs/maya_gtm/`.
- App routes under `app/gtm` and `app/onboarding/gtm`.
- New tables prefixed `gtm`.
- New smoke scripts prefixed `gtm`.

Use a separate Convex deployment/project for production GTM Maya if this becomes
the main product. During implementation, the existing staging deployment is fine
as long as tables are additive and feature-flagged. Do not mutate creator Maya
to fit this. Do not build a completely separate repo yet unless the existing
repo slows iteration; the shared infra is valuable.

## Product Deployment and Environment Strategy

Use this repository as a shared platform repo, but deploy ClawLaunch as a
separate product target.

Current Vercel state checked 2026-05-22:

- Existing HeyMaya Vercel project:
  - project name: `hey-ava-web`
  - project id: `prj_9MIAgVnqio6Ya6NuazO8nvmozxs6`
  - org id: `team_9ZVYQ37YZ2jhxk2izDzzP4gZ`
  - production URL: `https://www.hey-maya.ai`
- Existing ClawLaunch Vercel project:
  - project name: `clawlaunch`
  - project id: `prj_hkfPcIe5XeZx8NvUjbxYYFuQIUdV`
  - org id: `team_9ZVYQ37YZ2jhxk2izDzzP4gZ`
  - current production URL: `https://clawlaunch-jcastro506s-projects.vercel.app`
  - current env vars: none configured at time of check

Deployment model:

- Same GitHub repo.
- Separate Vercel projects.
- Separate Vercel env vars.
- Separate product mode.
- Prefer separate local worktree/checkout for ClawLaunch deploys so
  `.vercel/project.json` does not get accidentally switched for HeyMaya work.

Recommended local layout:

```text
/Users/joshcastro/Desktop/heymaya          -> linked to hey-ava-web
/Users/joshcastro/Desktop/clawlaunch-app   -> same repo/branch, linked to clawlaunch
```

Product mode:

```text
PRODUCT_MODE=heymaya
PRODUCT_MODE=clawlaunch
```

Behavior:

- `PRODUCT_MODE=heymaya`
  - `/` renders current HeyMaya/creator public surface.
  - Existing creator routes remain available as configured.
  - Existing callback URLs remain unchanged.
- `PRODUCT_MODE=clawlaunch`
  - `/` renders the ClawLaunch landing page.
  - `/onboarding/gtm` is the primary onboarding.
  - Creator/service routes are hidden, disabled, or redirected.
  - Public copy, metadata, CTAs, and waitlist/onboarding all point to
    ClawLaunch.

Environment separation:

- Do not share production callback URLs across HeyMaya and ClawLaunch.
- Each Vercel project gets its own `NEXT_PUBLIC_APP_URL` / site URL.
- Each product gets explicit Google OAuth redirect URIs.
- Each product gets explicit Composio callback URLs/auth config IDs.
- Each product gets its own Stripe products/prices when billing starts.
- ClawLaunch can use the existing staging Convex deployment during build, but
  production beta should strongly consider its own Convex project/deployment.

Required ClawLaunch env categories:

- Clerk publishable/secret keys and webhook secret.
- Convex URL/deployment.
- Google Calendar OAuth redirect URLs.
- Messaging channel config: WhatsApp/OpenClaw and/or ClawMessenger.
- Composio API key and auth config IDs.
- ScrapeCreators API key/base URL.
- Gemini/OpenRouter/model provider keys.
- Fly/OpenClaw deploy token/image/org/app config.
- Stripe products/prices when charging.
- `PRODUCT_MODE=clawlaunch`.

Callback discipline:

- Google Calendar:
  - HeyMaya callback remains tied to HeyMaya domain.
  - ClawLaunch callback must use ClawLaunch domain.
- Composio:
  - Create separate auth configs for ClawLaunch where callback URL or displayed
    app branding differs.
  - X/Twitter and TikTok do not have Composio managed apps; use our own app
    credentials when those features are enabled.
- Messaging:
  - WhatsApp/iMessage channel routing must be product/account scoped.
  - Do not reuse single-tenant ClawMessenger assumptions.

Branch/deploy discipline:

- Do not deploy ClawLaunch from the HeyMaya-linked `.vercel/project.json`.
- Do not deploy HeyMaya from the ClawLaunch-linked worktree.
- Add smoke checks that assert `PRODUCT_MODE=clawlaunch` before deploying to the
  ClawLaunch Vercel project.
- Add smoke checks that assert `/` renders ClawLaunch landing copy in the
  ClawLaunch deployment.
- Add smoke checks that assert creator onboarding is not the primary CTA in the
  ClawLaunch deployment.

## Verified External Capabilities

### OpenClaw

Use OpenClaw for the agent runtime, not custom orchestration where OpenClaw
already has primitives.

Verified capabilities:

- Subagents run in isolated background sessions via `sessions_spawn`, announce
  results back to the requester, and can be given model/thinking/timeouts.
  Source: https://docs.openclaw.ai/tools/subagents
- Subagents are intended for parallel research and long-running work.
  Source: https://docs.openclaw.ai/tools/subagents
- Subagent costs are separate; cheaper models can be configured for children.
  Source: https://docs.openclaw.ai/tools/subagents
- OpenClaw supports background tasks, scheduled tasks, taskflow, standing
  orders, skills, memory/wiki, cron, heartbeat, and channels.
  Sources:
  - https://docs.openclaw.ai/automation/tasks
  - https://docs.openclaw.ai/automation/taskflow
  - https://docs.openclaw.ai/tools/skills
- WhatsApp can be connected through OpenClaw channel login / linked-device QR.
  High-volume chatty behavior can trigger WhatsApp blocking, so message volume
  must stay concise.
  Source: https://openclaw.im/docs/channels/whatsapp

OpenClaw ownership:

- Per-user Maya runtime.
- Workspace files.
- Memory and dreaming.
- Subagent execution.
- Long-running onboarding taskflow.
- Cron and heartbeat.
- Messaging channel delivery.
- Tool/skill instructions.

### ScrapeCreators

Use ScrapeCreators as the public-data research layer. It is for reading public
signals, not posting.

Verified capabilities:

- Supports public scraping across TikTok, Instagram, YouTube, LinkedIn,
  Facebook, X/Twitter, Reddit, Pinterest, Threads, Google and other surfaces.
  Source: https://scrapecreators.com/
- Reddit search endpoint supports query, sort, timeframe, pagination, trim.
  Source: https://docs.scrapecreators.com/v1/reddit/search/
- TikTok endpoints include profile, profile videos, video info, transcript,
  comments, search users, search by hashtag, search by keyword, popular
  creators, popular videos, popular hashtags, song details, song videos, and
  trending feed.
  Source: https://docs.scrapecreators.com/integrations/overview
- The machine-readable API spec is available at:
  https://docs.scrapecreators.com/openapi.json

ScrapeCreators ownership:

- Google/public search result collection when appropriate.
- Reddit pain search and subreddit discovery.
- TikTok examples, competitor profiles, videos, transcripts, and comments.
- X/LinkedIn public research where endpoint coverage is sufficient.
- Competitor social evidence.
- Cost-audited cached research.

### ScrapeCreators Access Pattern

ScrapeCreators provides two different things and Maya GTM should use both in
different places:

1. **Agent skill**
   - Install/source: `npx skills add scrapecreators/agent-skills`, or vendor the
     `SKILL.md` into the OpenClaw workspace.
   - Purpose: teaches the agent endpoint selection, parameters, pagination,
     credit costs, and platform-specific quirks.
   - Source: https://docs.scrapecreators.com/integrations/agent-skill/
2. **API wrappers**
   - Purpose: product-controlled, cost-audited, typed calls from Convex actions.
   - Used for repeatable research jobs, cache keys, retries, cost ledger rows,
     and testable endpoint behavior.

Decision:

- Ship the ScrapeCreators agent skill inside every `maya_gtm` OpenClaw workspace
  so Maya and her subagents understand the API surface.
- Do not let arbitrary agent calls become the only integration path.
- Production research jobs call our own Convex ScrapeCreators wrappers so every
  request is cached, audited, budgeted, and testable.
- The agent skill is for judgment and endpoint choice; Convex wrappers are for
  execution, persistence, and cost control.
- If OpenClaw later has the ScrapeCreators MCP server available in the runtime,
  it can be added behind the same budget gate, but still not from heartbeat.

Rules:

- Never call ScrapeCreators from every heartbeat.
- Every live call writes a credit-audit row.
- Cache public evidence by query/platform/source.
- Prefer batched onboarding research and scheduled refreshes.
- Treat endpoint coverage as verified per endpoint before promising UX.

### Composio

Use Composio as an OAuth/tool execution layer where it saves engineering time.
Do not let it become the product brain.

Verified capabilities:

- Connected accounts are authenticated connections between users and toolkits.
  Composio handles token refresh and credential management.
  Source: https://docs.composio.dev/docs/auth-configuration/connected-accounts
- Sessions can select connected accounts and expose enabled toolkits/tools to
  agents.
  Source: https://docs.composio.dev/docs/configuring-sessions
- Triggers can deliver webhook or polling-based events; managed auth polling can
  have a 15-minute minimum interval.
  Source: https://docs.composio.dev/docs/triggers
- Custom auth configs allow white-labeled OAuth with our own app credentials.
  Source: https://docs.composio.dev/docs/custom-auth-configs

Composio ownership:

- User-scoped OAuth.
- X posting and light reads if supported by toolkit.
- LinkedIn posting and light reads if supported by toolkit.
- Gmail later.
- Optional Google Calendar if we decide to unify all auth through Composio,
  though current Google integration may be reused.

Current Composio platform coverage checked 2026-05-22:

| Platform | Composio toolkit status | Useful tools verified | V1 decision |
|---|---|---|---|
| X / Twitter | Toolkit exists, 79 tools. Composio Managed App is not available, so we need our own X OAuth/app credentials and X API credits. | `TWITTER_CREATION_OF_A_POST`, `TWITTER_RECENT_SEARCH`, `TWITTER_POST_LOOKUP_BY_POST_ID`, `TWITTER_LIST_POST_LIKERS`, `TWITTER_USER_LOOKUP_ME`, `TWITTER_USER_LOOKUP_BY_USERNAME`, media upload tools, timeline tools. Source: https://docs.composio.dev/toolkits/twitter | Use for approval-based posting and light own-account reads after custom OAuth is configured. Budget official X reads/writes. |
| LinkedIn | Toolkit exists, 22 tools. Composio Managed App is available. | `LINKEDIN_CREATE_LINKED_IN_POST`, `LINKEDIN_CREATE_COMMENT_ON_POST`, `LINKEDIN_GET_MY_INFO`, `LINKEDIN_GET_SHARE_STATS`, `LINKEDIN_LIST_REACTIONS`, image upload tools. Source: https://docs.composio.dev/toolkits/linkedin | Use for approval-based personal-feed posting and metrics. Do not promise LinkedIn DMs, lead search, connection requests, or full outbound. |
| Reddit | Toolkit exists, 23 tools. Composio Managed App is available. | `REDDIT_CREATE_REDDIT_POST`, `REDDIT_POST_REDDIT_COMMENT`, `REDDIT_GET_SUBREDDIT_RULES`, `REDDIT_SEARCH_ACROSS_SUBREDDITS`, `REDDIT_RETRIEVE_POST_COMMENTS`, subreddit listing tools. Source: https://docs.composio.dev/toolkits/reddit | Use read/rules/drafts first. Approval-based posting is possible technically, but V1 should keep Reddit publishing disabled until beta safety checks pass. |
| TikTok | Toolkit exists, 10 tools. Composio Managed App is not available, so we need our own TikTok OAuth app and Content Posting API approval. | `TIKTOK_UPLOAD_VIDEO`, `TIKTOK_UPLOAD_VIDEOS`, `TIKTOK_PUBLISH_VIDEO`, `TIKTOK_POST_PHOTO`, `TIKTOK_FETCH_PUBLISH_STATUS`, `TIKTOK_LIST_VIDEOS`. Source: https://docs.composio.dev/toolkits/tiktok | Do not make direct TikTok publishing a V1 dependency. Use scripts, shot lists, recording prompts, and manual posting first. |

Rules:

- Wrap Composio behind our own `publishDraft()` / `executeConnectedTool()`
  interfaces.
- Store Composio connected account IDs encrypted.
- Never let OpenClaw directly publish without a Convex approval record.
- Use custom auth configs for production so users see HeyMaya/Maya GTM branding.

### X / Twitter

X posting is feasible but must be cost-controlled.

Verified capabilities:

- X API can create and delete posts on behalf of authenticated users.
  Source: https://docs.x.com/x-api/posts/manage-tweets/introduction
- `POST /2/tweets` creates posts. OAuth user access is required.
  Source: https://docs.x.com/x-api/posts/manage-tweets/quickstart
- X API uses pay-per-use pricing. Reads are charged per returned resource and
  writes/actions per request. As of the docs read, content create is listed at
  $0.015/request, and content create with URL at $0.200/request.
  Source: https://docs.x.com/x-api/getting-started/pricing

V1 stance:

- Approval-based X posting is in scope.
- Reply drafting is in scope.
- Reply posting is approval-only and risk-gated.
- Broad X search through official API should be budgeted carefully; use
  ScrapeCreators/public search where cheaper and sufficient.

### LinkedIn

LinkedIn personal-feed posting is feasible with OAuth and `w_member_social`.

Verified capabilities:

- LinkedIn posting requires OAuth and the `w_member_social` scope.
  Source: https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin
- UGC posts are created via `POST https://api.linkedin.com/v2/ugcPosts`.
  Source: https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin
- Text posts, URL shares, image/video shares are supported, but media upload is
  multi-step.
  Source: https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin
- Member rate limit shown in docs is 150 requests/day.
  Source: https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin

V1 stance:

- Approval-based personal LinkedIn posting is in scope.
- LinkedIn is recommended only when the app is B2B/professional enough.
- LinkedIn DMs/connection requests/outbound are out of V1.

### Reddit

Reddit is strongest as a research and helpful-reply channel. Posting/commenting
should be conservative.

Verified capabilities:

- Reddit API supports submit/comment operations through OAuth scopes.
  Source: https://www.reddit.com/dev/api/
- ScrapeCreators Reddit search can find public posts by query/sort/timeframe.
  Source: https://docs.scrapecreators.com/v1/reddit/search/

V1 stance:

- Reddit discovery and reply drafts are in scope.
- Reddit auto-posting is out of scope.
- Reddit comment posting may be added after approval-only guardrails and
  subreddit-rule checks pass beta.
- Maya must warn when direct promotion is unsafe.

### TikTok

TikTok is important for app demos but direct posting should not block V1.

Verified capabilities:

- TikTok Content Posting API supports direct post for video/photo.
  Source: https://developers.tiktok.com/doc/content-posting-api-get-started
- Direct posting requires a registered app, Content Posting API product,
  `video.publish` scope approval, user authorization, and app audit to lift
  private visibility restrictions.
  Source: https://developers.tiktok.com/doc/content-posting-api-get-started
- Direct video posting can use file upload or pull-from-URL.
  Source: https://developers.tiktok.com/doc/content-posting-api-get-started
- TikTok requires querying creator info before direct post.
  Source: https://developers.tiktok.com/doc/content-posting-api-get-started

V1 stance:

- TikTok strategy, scripts, shot lists, screen-recording plans, captions, and
  calendar events are in scope.
- TikTok format strategy must include more than video. Maya should evaluate
  short videos, native Photo Mode/carousel/slideshow posts, screenshot-style
  slides, text-on-image explainers, founder talking-head clips, faceless app
  demos, and UGC-style patterns based on what the research shows for the app's
  niche.
- User records or provides clips.
- TikTok direct publishing is V2+ after app audit and media workflow are stable.

### Instagram

Instagram should be planned in V1 as a visual-content reuse and validation
channel, not as a separate automation surface.

V1 stance:

- Instagram Reels, carousels, Stories, and static screenshot posts are in scope
  for planning when the user's app is visual/consumer/prosumer or the user
  already has Instagram distribution.
- Maya may adapt TikTok-first scripts, slideshow outlines, screenshot
  sequences, captions, and visual briefs into Instagram variants.
- Instagram direct posting is out of scope for V1.
- Maya should not create a separate Instagram workload unless there is evidence
  and production capacity. Default behavior is "create assets that can be used
  on TikTok and Instagram," not "double the founder's posting burden."
- If the founder has no visual assets, no willingness to create screenshots or
  recordings, and no UGC/content budget, Maya parks TikTok/Instagram and
  chooses a lower-production channel.

Production-fit rule:

> TikTok and Instagram require both market evidence and production capacity.
> Maya cannot recommend them simply because they are popular.

Research note:

- TikTok Photo Mode/carousel posts are a real format, not a fallback. They can
  be the best week-one recommendation for apps where a crisp visual sequence,
  screenshots, before/after comparison, listicle, or story works better than a
  recorded video. Maya should research whether carousels/slideshows are working
  in the app's niche instead of assuming TikTok means video only.
- TikTok's business docs also treat carousel/image ads as a first-class format,
  including reuse of creative assets, multi-image sequences, and conversion
  objectives. Sources:
  - https://ads.tiktok.com/help/article/about-carousel-in-creative-library
  - https://ads.tiktok.com/help/article/specifications-for-carousel-ads

## Product Surfaces

## Consumer-App Virality Lessons

Nicole's interview adds several requirements for ClawLaunch when the user's app
is consumer or visually demoable:

1. **Distribution strategy is part of product design.**
   - Maya should inspect the app for viral moments, not only buyer pain.
   - App diagnosis should include "what is innately showable in 3-10 seconds?"
   - If the app has no visual/demo hook, Maya should say so and recommend a
     different first channel.
2. **Test categories, not single posts.**
   - Maya should test a small number of distribution motions for 2-3 weeks:
     Reddit helpful replies, TikTok/Instagram-style faceless demos,
     slideshow/carousel posts, founder talking head, face/reaction UGC,
     X founder-led posts, LinkedIn professional posts.
   - Within each motion, Maya should produce variants: hooks, CTAs, proof
     frames, demo sequences, and audience angles.
3. **Scale only after a format wins.**
   - Maya should not tell a founder to hire creators on day one.
   - If a TikTok/short-form format repeatedly creates qualified signal, Maya can
     propose a "UGC systemization" plan: creator profile, sample briefs,
     training module outline, content bank, feedback cadence, and dashboard
     needs.
4. **Train the system, not just the post.**
   - Winning assets become a content bank.
   - Maya should keep examples of what worked, what failed, and why.
   - Future drafts should come from the tested content bank, not generic prompt
     generation.
5. **Measure user signal, not vanity reach.**
   - For consumer apps, views matter only when paired with installs, trial
     starts, waitlist joins, comments from likely users, or creator applicants.
   - If a format gets views but no app action, Maya should revise the CTA,
     landing path, or app onboarding before scaling it.

Add these concepts to the GTM object model:

```ts
type DistributionMotion =
  | "reddit_helpful_reply"
  | "x_founder_led"
  | "linkedin_founder_led"
  | "tiktok_faceless_demo"
  | "tiktok_founder_talking_head"
  | "ugc_creator_test"
  | "paid_ads_later"
  | "influencer_later";

type FormatExperiment = {
  motion: DistributionMotion;
  hypothesis: string;
  variants: Array<{
    hook: string;
    demoMoment?: string;
    cta: string;
    formatSkeleton: string;
  }>;
  successMetric: "qualified_replies" | "signups" | "installs" | "trials" | "creator_applicants";
  scaleDecision: "keep_testing" | "double_down" | "revise" | "park";
};
```

V1 implementation stance:

- Build the experiment system now.
- Build the content bank now.
- Build TikTok scripts/shot lists now.
- Build "UGC readiness recommendation" now.
- Do not build the full UGC recruiting/training/creator-management system until
  beta evidence shows it is the winning path for consumer-app users.

### Public Landing Page

The current `/vibecoders` page is a useful positioning scaffold, but it reflects
the older "same creator Maya, reframed for builders" idea. The GTM product needs
a fresh landing page that sells the new operating loop:

> You built the app. Maya gets you users.

Route:

- `/gtm` or `/builders` for the new public product page.
- `/onboarding/gtm` for signup/intake.
- Do not point the CTA to creator onboarding.

Landing page job:

- Make the user feel the exact pain: "I shipped something and nobody knows it
  exists."
- Explain that Maya goes away, researches the app/market, chooses channels, and
  returns with an evidence-backed 7-day GTM plan.
- Show the operating surfaces: messaging, calendar, and optional Mission Board.
- Make clear Maya optimizes for users/feedback, not likes.
- Make clear TikTok is included as directed recording/scripts, not fake
  auto-generated founder videos.
- Avoid sounding like a generic social media scheduler.

Hero:

- H1 direction: "Maya gets your app its first real users."
- Supporting copy: "Send her your app URL. She researches who might care,
  chooses the first channels, writes the posts/replies/scripts, schedules the
  work, asks approval, and learns from results."
- Primary CTA: "Start with your app URL" or "Join the builder beta."
- Secondary CTA: "See how Maya works."

Required sections:

1. Pain: "You shipped the app. Distribution is the part nobody built for you."
2. How Maya works:
   - inspect app
   - research public demand
   - choose 1-2 channels
   - create 7-day calendar
   - text approvals/reminders
   - learn from responses
3. Example output:
   - one message thread
   - one rich calendar event
   - one evidence-backed channel decision
4. Platform strategy:
   - Reddit for pain discovery/reply drafts
   - X for founder-led posts and replies
   - LinkedIn for professional/B2B products
   - TikTok for app-demo scripts and recording instructions
5. What Maya will not do:
   - no cold-email automation in V1
   - no autonomous posting without approval
   - no generic content calendar
   - no fake TikTok avatar/content
6. Pricing/beta:
   - likely $49/month beta or waitlist while customer evidence is collected.
7. FAQ:
   - Does Maya post for me?
   - Does Maya support TikTok?
   - What if I do not know my ICP?
   - Do I need followers?
   - What accounts do I connect?
   - What does Maya need from me?

Design rules:

- The first screen should be the product story, not a generic waitlist splash.
- Use real UI/message/calendar mockups, not abstract gradients.
- Avoid broad "AI marketing" language.
- Avoid "same Maya as creators" copy.
- CTA should collect app URL early; the app URL is the psychological anchor.
- The page must match the eventual onboarding flow, especially "Maya researches
  and texts you when the plan is ready."

### Messaging

Primary relationship/control surface:

- WhatsApp first if QR pairing and multi-tenant channel routing are stable.
- iMessage via ClawMessenger remains useful for iOS-heavy users.
- Keep messages concise to avoid WhatsApp blocking and user fatigue.

Messaging handles:

- Onboarding status.
- Approval requests.
- Edits.
- Reminders.
- "Did you post this?" check-ins.
- Daily/weekly summaries.

### Google Calendar

Primary execution surface.

Every concrete GTM action becomes a rich calendar event:

- Platform.
- Objective.
- Draft text.
- Links/threads/examples.
- Recording instructions.
- Assets needed.
- Reason Maya chose it.
- Success metric.
- Approval status.
- Follow-up instruction.

Calendar event is not approval. It is the planned work. Publishing requires a
stored approval record.

### Mission Board

Thin UI, not a dashboard graveyard.

It shows:

- Research job progress.
- App diagnosis.
- ICP hypotheses.
- Evidence cards.
- Channel decisions.
- This week plan.
- Today tasks.
- Pending approvals.
- Published links and early results.

The user should not maintain this. Maya updates it.

## Onboarding Experience

### User-Facing Flow

1. User signs up.
2. User connects WhatsApp or iMessage.
3. User connects Google Calendar.
4. User gives app URL.
5. User chooses app inspection path:
   - Web app: URL, optional test login, optional product docs.
   - Mobile app: App Store/Play Store URL if live, plus uploaded screen
     recording walkthrough.
   - Not yet public: uploaded walkthrough video, screenshots, landing page, or
     demo build notes.
6. User answers only a few questions:
   - Why did you build this?
   - Is it live/usable now?
   - What counts as a win this week: feedback, signups, demos, revenue?
   - Are you willing to record your screen?
   - Are you willing to show your face?
   - Are you willing to record your voice?
   - Can you provide screenshots or product images for slideshow/carousel posts?
   - Are you willing to post on TikTok or Instagram manually?
   - Do you already have TikTok or Instagram accounts Maya can inspect?
   - Are you open to hiring UGC creators later if a format proves itself?
   - What is your monthly creator/content budget, if any?
   - Any audience or topic you definitely do not want Maya to target?
7. Optional:
   - test login
   - analytics
   - X/LinkedIn OAuth
   - existing social profiles
8. Maya says she is going away to research.
9. Mission Board shows progress.
10. Maya texts when the plan is ready.
11. User approves the first 7-day plan and calendar write.

Do not ask:

- "Who is your ICP?"
- "Where do your customers hang out?"
- "What is your content strategy?"
- "Describe your brand voice."

Those are Maya's job.

### Mobile Walkthrough Upload

Mobile app inspection is first-class. Maya should not pretend she can inspect a
private mobile app unless the user gives her something visual.

Required build:

- Upload control during onboarding for `.mp4`, `.mov`, and common mobile screen
  recording formats.
- Store the original file in the existing media/object storage layer.
- Create a Gemini video-analysis job with the app URL/listing context and the
  founder's few onboarding answers.
- Return structured app diagnosis:
  - core workflow
  - user problem
  - strongest demo moments
  - before/after contrast
  - visually confusing moments
  - app screens/assets worth using in content
  - whether faceless screen recording is enough
  - whether founder-face or UGC-style content might help
  - TikTok/short-form format candidates, including video and slideshow/carousel
  - unsupported claims or missing context
- Write the diagnosis into Convex and `APP.md`.

Testing:

- Use fixture walkthrough videos.
- Assert Gemini output validates against schema.
- Assert large/unsupported files fail gracefully.
- Assert diagnosis can be generated without asking the user for ICP.
- Browser smoke the upload path on localhost and staging.

### Production Reality Gate

Maya must map every visual-channel recommendation to a production path the user
can actually execute.

Inputs:

- face-camera willingness
- voiceover willingness
- screen-recording willingness
- screenshot/slideshow willingness
- ability to post manually
- existing TikTok/Instagram accounts
- content cadence the founder can realistically sustain
- UGC/creator budget and openness
- channels the founder refuses to use
- TikTok account warm-up state:
  - no account / new account / currently warming / ready / restricted
  - account age in days
  - whether the user checked TikTok Studio Account Check

Decision ladder for TikTok/Instagram:

1. If the user can only provide screenshots, start with slideshow/carousel,
   screenshot sequence, and text-on-image concepts.
2. If the user can screen-record, add faceless demo clips and screen-recorded
   Reels/TikToks.
3. If the user can record voice, add voiceover variants.
4. If the user can show face, test founder talking-head only when research
   supports it.
5. If visual formats show customer signal and the user does not want to keep
   producing them, Maya may recommend UGC systemization.
6. If the user cannot provide visual assets and has no creator budget, Maya
   parks TikTok/Instagram and chooses Reddit, X, LinkedIn, or community/search
   motions where written execution can work.

TikTok warm-up rule:

- TikTok does not publish an official warm-up timeline. Maya should not present
  warm-up as a guaranteed algorithm hack.
- Maya should use warm-up as an account-integrity and normal-use readiness gate:
  profile basics, normal niche consumption, saving reference posts, no bulk
  liking/commenting/fake engagement, no high-volume commercial posting, and
  TikTok Studio Account Check before a real launch cadence.
- If the account is new, unknown, warming, under 7 days old, or Account Check
  has not been reviewed, TikTok can be researched but cannot be the immediate
  posting cadence. Maya schedules warm-up tasks first and caps first-week
  posting at 1-2 low-pressure tests.
- If the account is restricted, TikTok is blocked until the user resolves the
  account status.

### Web App Inspection

Web apps use browser/headless inspection:

- Fetch landing page, pricing, docs/blog if available.
- Capture screenshots of important pages.
- Use browser automation for interactive pages when allowed.
- Use Gemini vision/text for screenshots and page summaries.
- Extract demo moments and content assets the same way mobile walkthroughs do.

If the app cannot be reached, Maya should ask for a walkthrough upload rather
than inventing a plan from the landing page alone.

### Async Research UX

Maya should explicitly take time:

> I am going to inspect the app, research where this problem shows up online,
> compare channels, and build your first 7-day GTM plan. I will text you when
> it is ready.

Target duration:

- Fast happy path: 10-15 minutes.
- Normal deep onboarding: 20-45 minutes.
- Max beta budget: 60 minutes.

The user should see progress states:

- Inspecting app.
- Building ICP hypotheses.
- Searching Reddit.
- Searching X/LinkedIn/TikTok examples.
- Checking competitors.
- Scoring channels.
- Building calendar.
- Quality checking plan.
- Ready for approval.

## OpenClaw Workspace Design

Generate a new workspace pack:

`convex/agents/packs/maya_gtm/`

Files:

- `AGENTS.md`: operating rules and approval boundaries.
- `SOUL.md`: Maya GTM persona, anti-slop writing posture.
- `USER.md`: founder/app context.
- `APP.md`: app diagnosis and current positioning.
- `GTM.md`: ICP hypotheses, channel strategy, open questions.
- `TOOLS.md`: allowed tools and tool rules.
- `HEARTBEAT.md`: cheap trigger checks only.
- `BOOT.md`: startup checklist and connection checks.
- `MEMORY.md`: durable learned preferences/results.
- `DREAMING.md`: nightly learning rules.
- `skills/*/SKILL.md`: custom GTM skills.
- `.clawhub/lock.json`: pinned external skills if any.

Skills shipped out of the box:

- `scrapecreators-api`: vendored ScrapeCreators agent skill, so Maya knows
  endpoint selection, pagination, credit costs, and platform quirks.
- `maya-app-inspector`: app audit and demo-moment extraction.
- `maya-icp-hypothesis`: forms likely ICP/pain hypotheses from app evidence.
- `maya-reddit-demand-researcher`: Reddit pain search and promotion-risk review.
- `maya-x-founder-led-researcher`: X post/reply format research and opportunity
  selection.
- `maya-tiktok-demo-strategist`: TikTok app-demo format, script, and shot-list
  generation.
- `maya-tiktok-format-researcher`: studies which TikTok formats are working for
  the app's niche, including faceless videos, founder talking-head clips,
  Photo Mode/carousel/slideshow posts, screenshot sequences, text-on-image
  explainers, UGC-style hooks, sounds, comments, and CTAs.
- `maya-linkedin-fit-researcher`: LinkedIn/B2B channel fit and founder-post
  angles.
- `maya-competitor-researcher`: competitor/alternative positioning evidence.
- `maya-channel-strategy-judge`: final channel scoring and gatekeeping.
- `maya-content-format-miner`: extracts reusable structures without copying
  wording or claims.
- `maya-distribution-motion-tester`: chooses and tracks distribution motions,
  variants, and 2-3 week test windows.
- `maya-viral-demo-moment-miner`: finds showable app moments, before/after
  contrasts, screen-recording beats, and short-form hooks.
- `maya-slop-critic`: rejects generic/unsupported content.
- `maya-calendar-plan-builder`: converts strategy into rich calendar events.
- `maya-approval-publisher`: approval-first publishing rules and tool routing.
- `maya-results-reviewer`: metrics, feedback, and weekly learning loop.
- `maya-ugc-system-advisor`: V1 advisory-only skill that decides whether the
  app has enough proof to start recruiting UGC creators and, if so, drafts the
  creator profile, brief template, training outline, and management cadence.

Skill deployment:

- We write/vend these skills in the repo.
- `assembleWorkspaceBundle` for `maya_gtm` emits them into
  `skills/<slug>/SKILL.md`.
- OpenClaw machine receives them at deploy time as part of the workspace bundle.
- Every skill has a narrow contract, allowed inputs, required outputs, and
  failure behavior.
- Shared skills are pinned/versioned. Updating a skill is a deliberate deploy,
  not a live mutable prompt edit.

Rules:

- Keep current strategy in `GTM.md`.
- Keep source-of-truth data in Convex.
- Promote durable lessons to memory/wiki only after evidence or explicit user
  feedback.
- Do not store secrets in workspace files.
- Do not let workspace memory replace Convex approvals/audit logs.

Custom file note:

- `APP.md` and `GTM.md` are product-specific working files. Do not assume
  OpenClaw automatically injects them into every subagent context.
- `AGENTS.md` and `BOOT.md` must explicitly tell Maya when to read `APP.md`,
  `GTM.md`, `MEMORY.md`, and daily notes.
- Subagent spawn prompts must pass the relevant app diagnosis, current
  strategy, and research contract directly, or instruct the subagent to read the
  exact file paths it needs.
- Convex remains the source of truth. Workspace files are Maya's working memory
  and operating context.

### Workspace File Responsibilities

The workspace files are Maya's operating system for a multi-month GTM
relationship. They are not just prompts.

| File | Responsibility |
|---|---|
| `AGENTS.md` | Core operating rules: Maya's mission is users and useful feedback, not vanity content. Approval boundaries, channel rules, anti-spam rules, and "no generic posts" live here. |
| `SOUL.md` | Maya's working personality: direct GTM teammate, low hype, evidence-led, concise, willing to push back once when a founder is about to waste effort. |
| `USER.md` | Founder profile: timezone, app stage, willingness to record screen/face, connected channels, constraints, preferred working rhythm. |
| `APP.md` | Current app diagnosis: what it does, strongest demo moments, pricing, onboarding gaps, positioning issues, screenshots/assets, and unresolved product questions. |
| `GTM.md` | Current GTM strategy: ICP hypotheses, active channel bets, parked channels, active experiments, weekly objective, and open assumptions. |
| `MEMORY.md` | Durable lessons only: what worked, what failed, user preferences, strong/rejected content patterns. No one-off guesses. |
| `DREAMING.md` | Nightly/weekly reflection rules: promote real lessons only after evidence, avoid overfitting to single posts, update `GTM.md` when strategy changes. |
| `HEARTBEAT.md` | Cheap live checks only: user replies, approvals, overdue tasks, upcoming calendar blocks, pending publish results, and open loops. |
| `BOOT.md` | Startup checklist: verify tools/accounts, read strategy files, register crons, check pending approvals/tasks, avoid duplicate scheduled jobs. |
| `TOOLS.md` | Tool rules and budgets: ScrapeCreators costs, Composio/platform limits, Calendar rules, model routing, publishing approval requirements. |
| `Operations/Daily Notes/*` | Append-only operational notes: what Maya did today, what is waiting, what needs follow-up, why a decision was made. |

The most important state split:

- Convex is source of truth for records, approvals, posts, metrics, costs, and
  audit.
- Workspace files are Maya's working context and durable judgment.
- Memory/wiki stores lessons after evidence, not raw data dumps.

### Long-Term Operating Goal

Maya's objective is not "post consistently." Her objective is to get real users
and useful feedback for the founder's app.

Optimize for:

- beta signups
- replies from likely users
- demo requests
- feedback from target users
- waitlist joins
- product-qualified conversations
- conversion from post/reply to user
- evidence that a pain is real

Do not optimize for:

- likes alone
- views alone
- impressions alone
- posting streaks
- generic engagement from other builders when the buyer is not builders

Every daily/weekly recap should distinguish:

- "This got attention."
- "This got useful user signal."

If a channel gets attention but no useful signal, Maya should lower its score or
change the angle.

### Experiment Manager Brain

Every GTM action should belong to an experiment:

```ts
{
  hypothesis: "Freelance bookkeepers have acute CSV cleanup pain",
  channel: "Reddit",
  action: "reply to 8 pain threads",
  expectedSignal: "2 replies or 1 beta tester",
  result: "...",
  decision: "double_down" | "revise" | "park"
}
```

Maya is valuable over months because she runs this loop:

```text
research -> choose channel -> create action -> get approval -> execute
-> measure response -> learn -> update strategy -> repeat
```

The calendar is the execution surface for this loop. Messaging is the control
surface. The Mission Board is the receipt/source-of-truth surface. OpenClaw
memory/wiki is the durable learning layer.

## Subagent Architecture

Use OpenClaw `sessions_spawn` for parallel research. The main Maya orchestrator
owns the plan. Subagents collect evidence and return structured results.

Default subagent constraints:

- `runTimeoutSeconds`: 600-900.
- Model selected by task class, not one universal model.
- No session-spawning from leaf agents in V1.
- Return JSON plus short summary.
- Every claim needs source/evidence.
- No user-facing prose from subagents.
- Coverage checklist in every task.
- Max tool calls and max ScrapeCreators calls in every task.
- Quality gate before result acceptance.
- Retry once with a targeted follow-up or stronger model when evidence is weak.

Subagents must be agentic but bounded. "Keep going until satisfied" is not an
acceptable production contract. Instead, each subagent gets:

```ts
{
  task: "TikTok niche research",
  model: "openrouter/google/gemini-3-flash-preview",
  maxRuntimeSeconds: 900,
  maxScrapeCreatorsCalls: 12,
  coverage: [
    "consider at least 20 candidate posts unless fewer exist",
    "return at least 6 evidence cards",
    "identify at least 3 distinct format patterns",
    "include whether video, slideshow/carousel, face, faceless, or UGC-style formats are working",
    "state exactly what evidence is weak"
  ],
  failBehavior: "return insufficient_evidence with missing coverage list"
}
```

If a subagent fails coverage:

1. Run one targeted follow-up using the missing evidence list.
2. Escalate to Claude Sonnet or Gemini 3.5 Flash only if the follow-up still
   fails and the channel/motion matters for the plan.
3. If evidence is still weak, park the motion and tell the user why.

OpenClaw model rule:

- Subagents do not need to use the same model as the main Maya. Use
  `sessions_spawn` model overrides for research cost/quality routing.

Subagents:

### App Inspector

Tools:

- OpenClaw browser.
- Screenshot/page extraction.
- Gemini vision/text model.
- Gemini video model for uploaded mobile walkthroughs.

Inputs:

- App URL.
- App Store/Play Store URL if mobile.
- Uploaded mobile walkthrough video when the app is mobile/private/not easily
  inspectable by browser.
- Optional login/test credentials.
- Founder note.

Outputs:

- Product summary.
- Features.
- Core workflow.
- Viral/demo moments: what can be shown fast, what before/after exists, what
  visual proof is available, and what is not visually compelling yet.
- Strongest demo moments.
- Pricing/onboarding friction.
- Landing page gaps.
- Likely pain statements.
- Screenshots/assets.
- Unsupported claims.

### ICP Hypothesis Agent

Tools:

- Gemini text model.
- App Inspector output.

Outputs:

- 3-5 ICP hypotheses.
- Pain for each.
- Why likely.
- Why maybe wrong.
- Channels to investigate.
- Query packs for each hypothesis.

### Reddit Demand Agent

Tools:

- ScrapeCreators Reddit search.
- ScrapeCreators subreddit/posts/comments where verified.
- Google search fallback.

Outputs:

- Pain threads.
- Subreddit candidates.
- Subreddit rule summary.
- Promotion risk.
- Reply opportunities.
- Evidence cards.

### X Founder-Led Agent

Tools:

- X API or Composio for connected-account reads when connected.
- ScrapeCreators/public X endpoints where available.
- Google search fallback.

Outputs:

- Similar builder posts.
- Competitor launch posts.
- Reply opportunities.
- Content formats.
- Cost/risk notes for X reads.

### TikTok Demo Agent

Tools:

- ScrapeCreators TikTok profile/videos/search endpoints where verified.
- ScrapeCreators TikTok video detail, transcript, comments, hashtag/search,
  popular/trending surfaces where verified and cost-approved.
- Google search fallback.
- App Inspector screenshots.
- Mobile walkthrough video analysis.

Outputs:

- Is the app visually demoable?
- Best demo angle.
- 3-5 TikTok format recommendations, which may include:
  - faceless video demo
  - founder talking-head demo
  - Photo Mode/carousel/slideshow
  - screenshot sequence with text overlays
  - listicle/problem story
  - UGC-style script for future generation/recruiting
- Shot-list templates.
- Distribution-motion recommendation:
  - faceless screen recording
  - founder talking head
  - slideshow/carousel
  - reaction/face UGC later
  - slideshow/static proof
  - park TikTok for now
- Recording burden.
- Whether TikTok should be primary/secondary/parked.

### Distribution Motion Agent

Tools:

- App Inspector output.
- Evidence cards.
- Content format miner.
- Results snapshots.

Outputs:

- 2-3 motions to test first.
- Variants per motion.
- Minimum viable cadence for each motion.
- Stop/double-down criteria.
- Calendar tasks for the next test window.
- Whether a UGC creator system is premature, useful soon, or ready to start.

Rules:

- Do not recommend scaling creator operations until at least one motion has
  repeated signal.
- Do not confuse "creator content" with "UGC operations." The founder can
  record early tests manually; UGC is a scale layer after proof.
- Consumer/visual apps may deserve TikTok/short-form earlier.
- B2B workflow apps still need proof before TikTok becomes primary.

### LinkedIn Fit Agent

Tools:

- ScrapeCreators LinkedIn/public endpoints where verified.
- Google search fallback.
- Composio LinkedIn only for connected user's own account/posting.

Outputs:

- B2B/professional buyer fit.
- Founder-post angles.
- Credibility gaps.
- Whether LinkedIn is worth week-one effort.

### Competitor and Alternatives Agent

Tools:

- Google search.
- ScrapeCreators social profiles/posts.
- App store/directories if useful.

Outputs:

- Direct competitors.
- Alternatives users mention.
- Pricing clues.
- Complaints.
- Positioning gaps.

### Channel Strategy Judge

Tools:

- Stronger model.
- All evidence cards.

Outputs:

- Primary channel.
- Secondary channel.
- Parked channels.
- Scores.
- Risks.
- First-week tests.
- What not to do.

### Plan Builder

Tools:

- Gemini.
- Calendar integration.
- Content quality skills.

Outputs:

- 7-day plan.
- Calendar event payloads.
- First-day tasks.
- Drafts.
- Approval requests.

## Evidence Card Contract

Every research output becomes an evidence card:

```ts
{
  accountId: Id<"users">,
  researchJobId: Id<"gtmResearchJobs">,
  source: "reddit" | "x" | "linkedin" | "tiktok" | "google" | "app" | "competitor",
  url: string,
  title?: string,
  snippet: string,
  authorOrCommunity?: string,
  observedAt: number,
  recency?: "fresh" | "recent" | "old" | "unknown",
  engagement?: {
    likes?: number,
    comments?: number,
    shares?: number,
    views?: number
  },
  painMatch: number,
  buyerMatch: number,
  channelFit: number,
  promotionRisk: "low" | "medium" | "high" | "unknown",
  recommendedUse: "strategy" | "reply" | "content_format" | "avoid" | "competitor",
  extractedClaims: string[],
  rawRef?: string
}
```

Evidence rules:

- Primary channel needs at least 3 useful evidence cards.
- Secondary channel needs at least 2 useful evidence cards.
- Parked channels need a concrete reason.
- No final plan can cite a platform generically without evidence.
- If evidence is weak, Maya must say so.

## Channel Scoring

Score each channel 0-100:

- Audience density.
- Pain evidence.
- Product/demo fit.
- Founder burden.
- Time-to-signal.
- Posting/publishing feasibility.
- Cost.
- Account/reputation risk.
- Available research depth.
- Content quality confidence.

Decision labels:

- `primary`: use this week.
- `secondary`: use lightly or as backup.
- `parked`: intentionally ignore for now.
- `blocked`: cannot use due to missing connection/API/risk.

Maya should usually choose one primary and one secondary channel.

## Content Quality System

Prompting alone is not enough.

Draft pipeline:

```text
evidence -> angle -> platform format -> draft variants -> slop critic
-> rewrite -> approval -> publish/log
```

### Default Voice

Do not ask the user to define a brand voice. Start with default founder-native
voice:

- Plain.
- Specific.
- Low hype.
- First-person when useful.
- Builder-native.
- Honest about being early.
- Clear ask.
- No fake authority.
- No corporate polish.

Banned by default:

- "game-changing"
- "revolutionary"
- "unlock"
- "leverage AI"
- "streamline your workflow"
- "excited to announce"
- vague "AI is changing everything" takes

### Voice Adaptation

Maya adapts from:

- The app copy.
- User's messages to Maya.
- Existing posts if connected.
- User edits.
- User approvals/rejections.
- Platform examples.

Store a lightweight writing profile, not a brand workshop:

```ts
{
  directness: "low" | "medium" | "high",
  technicalDepth: "low" | "medium" | "high",
  hypeTolerance: "low" | "medium" | "high",
  sentenceStyle: "short" | "mixed" | "long",
  firstPersonComfort: "low" | "medium" | "high",
  tabooPhrases: string[],
  preferredPatterns: string[],
  rejectedPatterns: string[]
}
```

### Format Mining

Maya may copy winning structures, not wording or claims.

For each platform/niche, extract:

- Format name.
- Skeleton.
- Why it works.
- When to use.
- When not to use.
- Evidence examples.

No plagiarism. No borrowed metrics. No fake proof.

### Slop Critic

Every draft gets scored:

- Specificity.
- Evidence grounding.
- Platform fit.
- Founder-native tone.
- Cringe risk.
- AI-slop risk.
- Claim safety.
- Clear ask.

Rewrite if:

- AI-slop risk > 2/5.
- Specificity < 4/5.
- Evidence grounding < 4/5.
- Unsupported claim exists.
- It sounds like a brand account instead of a human.

## Publishing and Approval

Universal workflow:

```text
draft created
-> stored in Convex
-> calendar event created
-> Maya asks approval in messaging
-> user approves/edits/skips
-> approval stored
-> publish tool called if supported
-> result stored
-> metric check scheduled
```

Publishing rules:

- Calendar event is not approval.
- Explicit approval is required for every post/comment in V1.
- Approval stores exact approved content, platform, connected account, user,
  timestamp, and message id.
- If user edits the draft, publish only the edited/approved text.
- If platform publish fails, calendar and message state must show failure.

V1 platforms:

- X: approval-based create post. Replies require stricter risk gate.
- LinkedIn: approval-based personal feed post.
- Reddit: draft and approval only; publishing deferred until beta confidence.
- TikTok: script/shot list/calendar only; user records/posts manually.

## Model Strategy and Cost Controls

Use a model ladder.

Default model routing:

- `gemini-3.5-flash` for the main Maya judgment surfaces:
  - final onboarding strategy
  - channel strategy judge
  - first 7-day GTM plan
  - weekly strategy review
  - ambiguous "why is this not working?" diagnosis
  - final user-facing summaries when nuance matters
- `openrouter/google/gemini-3-flash-preview` or equivalent mid-cost agentic
  model for default future research subagents:
  - Reddit/X/TikTok/LinkedIn research subagents after beta-quality examples are
    established
  - competitor mapping
  - query-pack iteration
  - low/medium-risk follow-up research
- `openrouter/~anthropic/claude-sonnet-latest` for beta/hard research:
  - first 5-10 beta users
  - weak or conflicting evidence
  - subagents that failed coverage on a cheaper model
  - high-value/complex apps where a bad first plan would damage trust
- `gemini-3.1-flash-lite`, `deepseek`, `qwen`, or equivalent cheap models for
  extraction and normalization:
  - App Inspector first-pass text extraction
  - ICP Hypothesis Agent rough hypotheses
  - evidence-card normalization
  - query-pack generation
  - slop critic first pass
  - low-risk transformations
- Gemini multimodal/video models for:
  - uploaded mobile walkthrough analysis
  - selected TikTok/video analysis
  - screenshot/app flow diagnosis
- `gemini-3.1-pro-preview` only as a rare escalation:
  - high-stakes repositioning
  - beta user "this plan feels wrong" re-analysis
  - complex conflicting evidence where 3.5 Flash fails the quality gate
- Claude Opus / Gemini Pro only as human-review-level escalation, not default.
- Image/video models only for specific asset jobs.

Onboarding model split:

1. Web App Inspector: browser + Gemini Flash/Lite extraction, with Gemini 3.5
   Flash if diagnosis is ambiguous.
2. Mobile walkthrough: Gemini multimodal/video.
3. Beta research subagents: Claude Sonnet for quality, then evaluate cheaper
   defaults.
4. Future default research subagents: Gemini 3 Flash or equivalent mid-cost
   model, with Sonnet escalation on failed gates.
5. Evidence normalization: Flash-Lite / DeepSeek / Qwen class model.
6. Content format mining: cheap first pass, with escalation to Gemini 3.5 Flash
   or Sonnet if nuanced.
5. Channel Strategy Judge: `gemini-3.5-flash`
6. First 7-day GTM plan: `gemini-3.5-flash`
7. Slop critic: `gemini-3.1-flash-lite`
8. Final user-facing summary: `gemini-3.5-flash`

Current public pricing basis:

- Gemini 3.5 Flash paid tier: $1.50 per 1M input tokens, $9.00 per 1M
  output tokens including thinking.
- Gemini 3.1 Flash-Lite paid tier: $0.25 per 1M input tokens for text/image/video,
  $1.50 per 1M output tokens including thinking.
- Gemini 3.1 Pro Preview paid tier: $2.00 per 1M input tokens and $12.00 per
  1M output tokens for prompts <=200k tokens.
  Source: https://ai.google.dev/gemini-api/docs/pricing
- Claude Sonnet via OpenRouter should be budgeted around the current Sonnet
  class price, roughly $3 per 1M input tokens and $15 per 1M output tokens at
  the time checked. Use current OpenRouter pricing at runtime, not this doc, as
  the source of truth.
- X API is pay-per-use with per-resource reads and per-request writes.
  Source: https://docs.x.com/x-api/getting-started/pricing
- ScrapeCreators pricing and credits must be tracked by plan; every call is
  audited.
  Source: https://scrapecreators.com/

Budget targets:

- Onboarding research model spend: $0.50-$3.00 per user.
- ScrapeCreators onboarding research: $0.25-$1.50 per user depending depth.
- Fly/OpenClaw machine: assume about $5/month per user if one machine per user.
- Ongoing model spend: target $5-$15/month depending usage.
- Ongoing ScrapeCreators: target $1-$3/month.

Hard rules:

- Heartbeat does not call ScrapeCreators.
- Heartbeat does not run expensive model work without a real trigger.
- Research jobs have per-user budget caps.
- X reads are budgeted because official reads are metered.
- A cost ledger row is written for every model/tool/public API call.
- Model routing and escalation decisions are logged.
- Subagent runs record model, timeout, tool-call counts, evidence count, and
  quality-gate result.

Beta policy:

- Spend a few extra dollars on Sonnet-class research for the first beta users to
  learn what excellent research output looks like.
- After beta, run model evals on the same research fixtures and switch default
  subagents to the cheapest model that passes quality gates.

## Convex Data Model

New tables:

- `gtmAgents`
- `gtmApps`
- `gtmResearchJobs`
- `gtmEvidenceCards`
- `gtmIcpHypotheses`
- `gtmChannelScores`
- `gtmChannelDecisions`
- `gtmContentFormats`
- `gtmDistributionMotions`
- `gtmFormatExperiments`
- `gtmContentBankItems`
- `gtmDrafts`
- `gtmApprovals`
- `gtmPublishedPosts`
- `gtmCalendarEvents`
- `gtmMetricSnapshots`
- `gtmUserFeedback`
- `gtmWritingProfiles`
- `gtmUgcReadinessReports`
- `gtmCostLedger`
- `gtmToolCallLog`
- `gtmResearchFixtures`

Reuse or wrap existing tables:

- `creators` or create neutral `accounts` later. For speed, reuse current user
  identity shape but do not expose creator-specific semantics.
- `connectedAccounts` for Composio.
- `aiCallLog` if generalized enough; otherwise write GTM-specific cost ledger
  and mirror to global usage events.
- `scrapeCreatorsCache` and `scrapeCreatorsCreditAudit` if platform-agnostic
  enough; otherwise add GTM query metadata around cache rows.

Indexes:

- by account.
- by research job.
- by account/status.
- by account/platform.
- by account/scheduled time.
- by account/source/query hash.
- by account/published post.

Retention:

- Raw public payloads: 30-90 days unless pinned as evidence.
- Evidence cards: keep while strategy references them.
- Approvals/published posts: keep indefinitely for audit.
- Cost ledger: keep indefinitely.

## Cron and Heartbeat

Cron jobs:

- `gtm_morning_brief`: daily plan/check-in.
- `gtm_calendar_check`: detects overdue tasks and upcoming recording/posting
  blocks.
- `gtm_research_refresh`: refreshes selected channels 2-3x/week, not hourly.
- `gtm_post_metric_refresh`: runs after published posts at 2h/24h/72h.
- `gtm_weekly_review`: summarizes results and adjusts strategy.
- `gtm_dreaming`: nightly memory/wiki promotion.

Heartbeat:

- Reads cached Convex/OpenClaw state only.
- Responds to user replies.
- Handles pending approval reminders.
- Handles event-start nudges.
- Handles new publish result completion.
- Schedules heavier work; does not do it inline.

### Heartbeat Checks

Each heartbeat follows this order and stays cheap:

1. User replied since last beat?
   - Resolve approvals, edits, skips, reschedules, questions, or uploaded
     recording assets.
   - Store durable preference only if user feedback is clear.
2. Pending approval close to scheduled window?
   - Nudge once with the smallest useful message.
   - Do not repeatedly nag.
3. GTM calendar event starting soon?
   - Send the event-specific instruction: reply draft, X/LinkedIn approval,
     TikTok recording shot list, Reddit thread link, or review block.
4. GTM calendar event overdue?
   - Ask whether it was done, skipped, or should be moved.
   - If the user reports a result, store it.
5. Publish job finished or failed?
   - Store result and inform user only when action is needed.
6. Fresh metric/result row already exists in Convex?
   - Summarize if it changes today's decision; otherwise let the next brief use
     it.
7. Open loop needs follow-up?
   - Examples: someone replied asking for the app link, user sent TikTok clips,
     a draft is waiting on edit, or a planned experiment has no result.

Heartbeat must not:

- perform broad research
- call ScrapeCreators directly
- run deep strategy synthesis
- run expensive X reads
- replan the whole calendar
- diagnose a channel from one datapoint

Heartbeat may schedule or enqueue those jobs when needed.

### Daily Operating Rhythm

Morning brief:

- Read `GTM.md`, `MEMORY.md`, current calendar, pending approvals, and latest
  results.
- Pick 1-3 highest-leverage actions.
- Tie every action to user acquisition or useful feedback.
- Avoid a long menu of ideas.

Midday/calendar checks:

- Nudge only around actual tasks or pending approvals.
- If the founder is blocked, offer to simplify the task.

Evening recap:

- Ask for missing URLs/results.
- Summarize only what changes the strategy.
- Separate attention metrics from useful signal.

Weekly strategy review:

- Compare experiments, channels, and ICP hypotheses.
- Double down, revise, or park.
- Update `GTM.md`.
- Promote durable lessons to `MEMORY.md` / memory-wiki.
- Build the next week's calendar from the updated strategy.

### Example Monthly Evolution

Week 1:

- Maya tests Reddit and TikTok because the app is visually demoable and public
  pain threads exist.

Week 2:

- Reddit produces 3 beta testers. TikTok gets views but no qualified comments.
  Maya lowers TikTok frequency and increases Reddit reply experiments.

Week 3:

- Feedback shows bookkeepers care more than generic freelancers. Maya updates
  the ICP, changes the language, and searches for bookkeeping-specific threads.

Week 4:

- LinkedIn becomes worth testing because the ICP is now a professional services
  buyer. Maya adds two LinkedIn posts and parks generic X build-in-public.

## Sprint Plan

This is the canonical execution plan. It replaces the earlier 14-slice list
with 8 end-to-end sprints that each produce a customer-visible or deployable
piece of the product.

## Sprint Acceptance Standard

Every sprint must exit through the same quality gate:

1. Unit tests for the new/changed pure logic pass.
2. Convex tests for data, auth scoping, and lifecycle pass.
3. Existing creator/service/Riley tests that cover shared infra still pass, or
   any failure is explicitly triaged as unrelated.
4. The current `maya_gtm` OpenClaw workspace bundle renders without secrets,
   missing files, or schema drift.
5. A real or staged GTM Maya OpenClaw deployment boots on Fly with the latest
   workspace pack.
6. The sprint-specific smoke path passes against that deployment or a documented
   test-mode equivalent when a provider account is not yet available.
7. Cost/audit logging is verified for any new external/model call path.
8. Rollback or disable path exists for any new user-facing behavior.

No sprint is complete if Maya only works in local mocks. Mocks are allowed for
unit/integration coverage, but each sprint must also prove the current product
can still deploy as an OpenClaw-backed Maya.

### Sprint 1: Foundation and Data Model

Goal:

- Create the ClawLaunch/GTM product foundation without mutating Creator Maya,
  Service Maya, or Riley.

Build:

- Product contract and decision log.
- Feature flags and product-mode guards.
- `convex/gtmMaya/` module folder.
- GTM schema tables for agents, apps, research jobs, evidence, channels,
  distribution motions, format experiments, content bank, drafts, approvals,
  published posts, calendar events, metrics, feedback, writing profiles, UGC
  readiness, costs, tool calls, safety, and beta instrumentation.
- Shared account resolver.
- Cost ledger and tool-call log.
- Validators for evidence cards, channels, motions, format experiments,
  approvals, and result snapshots.

Tests:

- Unit tests for validators and scoring.
- Cross-tenant isolation tests.
- Research lifecycle tests through Convex mutations and queries.
- Cost ledger required for external/model calls.
- Approval records cannot publish without explicit approval.

Smoke:

- Create test account, app, research job, evidence card, channel score,
  distribution motion, format experiment, content bank item, approval, result,
  and cost ledger entry.

Exit:

- GTM module tests pass.
- No existing creator/service tests broken.

### Sprint 2: OpenClaw Runtime and Workspace

Goal:

- Generate and deploy a new OpenClaw-backed Maya GTM runtime.

Build:

- `convex/agents/packs/maya_gtm/`.
- Render `AGENTS.md`, `SOUL.md`, `USER.md`, `APP.md`, `GTM.md`,
  `TOOLS.md`, `BOOT.md`, `HEARTBEAT.md`, `MEMORY.md`, `DREAMING.md`.
- Add skill manifest and GTM skills.
- Add per-user Fly deploy action modeled after existing deploy code.
- Upgrade OpenClaw image/version if current pinned runtime is stale.
- Add model-routing config:
  - main Maya / strategy: Gemini 3.5 Flash
  - beta hard research: Claude Sonnet via OpenRouter
  - future default research: Gemini 3 Flash or equivalent
  - extraction: cheap worker model
- Make `AGENTS.md` / `BOOT.md` explicitly read custom `APP.md` and `GTM.md`
  when needed.

Tests:

- Workspace file snapshot tests.
- Required file existence tests.
- No secret leakage tests.
- Size budget tests.
- Boot/heartbeat instructions mention no ScrapeCreators spend in heartbeat.
- Subagent spawn templates include model, timeout, budget, coverage checklist,
  and failure behavior.

Smoke:

- Deploy one GTM Maya to staging Fly.
- Gateway boots.
- Workspace files present.
- OpenClaw can receive a direct local/gateway message.

Exit:

- One test GTM Maya boots on Fly.

### Sprint 3: Onboarding and App Understanding

Goal:

- The user can connect required surfaces and Maya can understand web and mobile
  apps before strategy starts.

Build:

- `/onboarding/gtm` route.
- WhatsApp/iMessage pairing status flow.
- Calendar OAuth reuse or Composio calendar decision.
- App inspection path picker:
  - web URL
  - mobile App Store/Play Store URL
  - uploaded walkthrough video
  - private/not-live app with screenshots/demo notes
- Walkthrough upload and storage.
- Gemini video-analysis job.
- Web app browser/headless inspection.
- Production reality capture for visual channels:
  - face-camera willingness
  - voiceover willingness
  - screen-recording willingness
  - screenshot/slideshow willingness
  - manual TikTok/Instagram posting willingness
  - existing TikTok/Instagram accounts
  - TikTok warm-up state, account age, and Account Check confirmation
  - UGC/creator budget and openness
- App diagnosis schema and `APP.md` write.
- Minimal questions.
- Research job creation.
- Mission Board progress UI.

Tests:

- Onboarding state machine.
- Calendar OAuth success/failure.
- Messaging channel status.
- App URL validation.
- Upload file validation.
- Gemini walkthrough output schema.
- Web inspector broken URL/paywall/login behavior.
- Visual channel recommendations fail when production capacity is missing.
- TikTok launch cadence fails when the account is new/unwarmed/restricted.
- Onboarding captures TikTok Account Check status.

Smoke:

- Sign in, connect calendar/messaging, inspect one web app, upload one mobile
  walkthrough fixture, create research job.
- Maya sends "I am researching" message.

Exit:

- End-to-end intake and app diagnosis work in staging.

### Sprint 4: Deep Research Engine

Goal:

- Maya can run bounded, agentic research across platforms and store auditable
  evidence.

Build:

- OpenClaw `sessions_spawn` task templates.
- Subagent task specs with coverage checklists and retry/escalation policy.
- Convex result ingestion.
- ScrapeCreators query runner with cache and cost audit.
- Reddit Demand Agent.
- TikTok Format Researcher:
  - video
  - slideshow/carousel/Photo Mode
  - screenshot sequences
  - comments/transcripts where available
- Instagram Format Planner:
  - Reels adaptation when TikTok-style assets exist
  - carousel/static screenshot adaptation
  - Stories/manual handoff when useful
  - no direct posting in V1
- X Founder-Led Agent.
- LinkedIn Fit Agent.
- Competitor/Search Agent.
- ICP Hypothesis Agent.
- Google/web fallback discovery.

Tests:

- Subagent prompt/output schema tests.
- Evidence card validation.
- Cost audit required.
- No final strategy without evidence.
- Subagent fails when coverage checklist is not met.
- TikTok research does not assume video only.

Smoke:

- Run full research for 2 fixture apps and 1 live test app.
- Evidence cards appear with URLs/snippets/metrics.

Exit:

- Research depth is visible, auditable, and cost-bounded.

### Sprint 5: Strategy and Experiment Planning

Goal:

- Maya creates an evidence-backed 7-14 day experiment plan only when gates pass.

Build:

- Channel Strategy Judge.
- Distribution Motion Agent.
- Viral Demo Moment Miner.
- UGC System Advisor in advisory-only mode.
- Content format miner.
- Strong model route for final strategy.
- Plan confidence levels.
- Re-research fallback when evidence is weak.
- First 7-14 day experiment plan.
- Calendar-ready task plan.

Tests:

- Fails when evidence count too low.
- Fails generic advice.
- Fails unsupported claims.
- Active motions have stop/double-down criteria.
- B2B app does not blindly recommend TikTok.
- Visual consumer app can recommend TikTok video or slideshow/carousel when
  evidence supports it.
- Reddit recommendations include risk.
- LinkedIn recommendations require B2B/professional fit.
- UGC recommendation is blocked until a motion has evidence or the app already
  has strong proof/examples.

Smoke:

- Research job completes into primary/secondary/parked motions.
- Maya produces first 7-14 day plan with evidence references.

Exit:

- Final plan is grounded with evidence references and experiment criteria.

### Sprint 6: Execution Loop

Goal:

- Maya turns strategy into executable work across calendar, messaging, drafts,
  and approval-based publishing.

Build:

- Content format library.
- Format mining.
- Content bank with winning/losing examples and reusable skeletons.
- Platform writers for X, LinkedIn, Reddit, TikTok.
- Slop critic.
- Claim checker/citation firewall.
- Writing profile adaptation from feedback.
- Distribution-motion variants: hook, body, CTA, demo moment, and success
  metric.
- 7-14 day calendar builder.
- Rich event payloads per platform.
- Event update/delete for Maya-owned events.
- Timezone and availability handling.
- "First action under 30 minutes" rule.
- Approval message parser.
- Approval records.
- X publish adapter through Composio/direct wrapper.
- LinkedIn publish adapter through Composio/direct wrapper.
- Reddit drafts and safety warning.
- TikTok manual tasks:
  - account warm-up tasks when the account is new/unchecked/restricted
  - scripts
  - shot lists
  - slideshow/carousel outlines
  - screenshot sequence instructions
  - captions and CTAs
- Publish failure handling.
- Published URL storage.

Tests:

- Banned phrase tests.
- Specificity scoring tests.
- Unsupported claim rejection.
- Platform-fit tests.
- Event descriptions include draft/instructions/evidence/success metric.
- Maya only mutates Maya-owned events.
- Calendar collision handling.
- TikTok event includes recording/slideshow instructions, not fake auto-post.
- TikTok warm-up event appears before launch cadence when Account Check/warm-up
  is not ready.
- Cannot publish without approval.
- Exact approved content is published.
- User edit changes final body.
- X/LinkedIn tool errors become failed states.
- Cross-tenant publish isolation.
- Future drafts cite the content-bank pattern they are using.

Smoke:

- Research job writes first 7-14 day calendar for test user.
- Publish to test/sandbox X and LinkedIn accounts if available.
- Otherwise use mocked Composio + one staging manual live publish.
- TikTok manual task is executable from calendar alone.

Exit:

- User can execute from calendar and messaging alone.

### Sprint 7: Learning Loop and Mission Board

Goal:

- Maya learns from what happened and shows the user what she is doing.

Build:

- Metric refresh jobs.
- Manual result capture when metrics unavailable.
- Post-performance summaries.
- Weekly review.
- Writing profile updates.
- Channel score updates.
- Format experiment updates.
- Content bank promotion/demotion.
- UGC readiness report updates when a short-form motion wins.
- Memory/wiki promotion rules.
- Mission Board:
  - progress
  - app diagnosis
  - evidence cards
  - channel decisions
  - distribution motions and active experiments
  - week plan
  - today tasks
  - pending approvals
  - results
  - what Maya learned
  - what she will test next

Tests:

- Metric refresh writes snapshots.
- Weak signal does not overfit.
- User rejection lowers pattern confidence.
- Weekly plan changes based on evidence.
- A high-view/low-signal post does not get marked as a winner.
- Repeated useful signal promotes a motion to `double_down`.
- UI handles loading/empty/error states.
- No user-maintained required fields after onboarding.
- Mobile responsive.

Smoke:

- Publish/dummy post, refresh metrics, produce weekly review.
- Mission Board reflects plan, results, and next decision.

Exit:

- Maya visibly improves over time.

### Sprint 8: Hardening and Private Beta

Goal:

- Make the product safe for real users and validate value.

Build:

- Rate limits.
- Cost limits.
- Error handling.
- Admin kill switch.
- Per-user machine health.
- Channel reconnect flows.
- Privacy/export/delete.
- Audit log surfaces.
- Gemini Omni / AI creative generation remains feature-flagged off unless API,
  price, quality, and disclosure gates are met.

Tests:

- Cost cap tests.
- API failure tests.
- WhatsApp/iMessage disconnect tests.
- Calendar OAuth revoke tests.
- OpenClaw machine restart tests.
- Subagent timeout tests.
- Model malformed output tests.
- Real-account OAuth revoke tests.

Smoke:

- Full staging beta run with 3 internal apps.
- Simulate one failed platform connection.
- Simulate one model malformed output.
- Real Fly/OpenClaw deploy proof.
- Real Calendar write proof.
- Messaging send/receive proof.

Run:

- 5 users.
- 14 days.
- Required app URL/live beta or walkthrough.
- Weekly human review of every final plan.
- Track time-to-first-plan, approval rate, posts shipped, user-reported signal,
  cost/user, retention intent, format experiments run, winning motions found,
  and whether Maya created at least one concrete user-acquisition signal.

Success criteria:

- 80% of users approve the first channel/motion strategy.
- 70% execute at least 3 Maya-scheduled actions in week one.
- 60% run at least one complete distribution-motion experiment in the first 14
  days.
- Average COGS below target for selected price.
- Human reviewer rates plans >= 4/5 on specificity and usefulness.
- No unauthorized publishing.

Exit:

- Ready to decide pricing, Pro/creative scope, and broader beta rollout.

## Legacy Expanded Sprint Checklist

The list below is retained as a historical checklist from the earlier
14-sprint plan. It is not the canonical execution order. Fold any useful detail
from these legacy slices into the 8 sprints above.

### Legacy Slice 0: Product Lock and Research Freeze

Goal:

- Lock the GTM Maya product contract and stop mixing it with creator/service/Riley.

Build:

- Add this sprint doc.
- Create decision log.
- Create feature flag names.
- Mark Riley as salvage/reference only.

Tests:

- Static doc checklist: every feature maps to OpenClaw, ScrapeCreators,
  Composio, Convex, Calendar, or platform API.
- No V1 feature depends on unapproved TikTok direct posting.

Exit:

- Product scope approved.
- V1 non-goals approved.

### Legacy Slice 1: New Namespace and Data Model

Goal:

- Create clean GTM product storage without mutating creator Maya.

Build:

- `convex/gtmMaya/` module folder.
- New schema tables listed above.
- Shared account resolver.
- Cost ledger.
- Research job lifecycle.
- Evidence card CRUD.
- Channel score storage for the first research strategy review.
- Draft/approval/published-post lifecycle stays in Sprint 10, after the
  channel strategy and workspace agent are working.

Tests:

- Unit tests for validators.
- Cross-tenant isolation tests.
- Channel scoring and quality-gate tests.
- Research lifecycle tests through Convex mutations and queries.
- Cost ledger required for external calls.

Smoke:

- `npm run smoke:gtm-sprint1`
- Create test account, app, research job, evidence card, channel score, and
  cost ledger entry.

Exit:

- `pnpm/npm test` passes for GTM modules.
- No existing creator/service tests broken.

### Legacy Slice 2: OpenClaw GTM Workspace Pack

Goal:

- Generate a new OpenClaw workspace for Maya GTM.

Build:

- `convex/agents/packs/maya_gtm/`.
- Render `AGENTS.md`, `SOUL.md`, `USER.md`, `APP.md`, `GTM.md`,
  `TOOLS.md`, `BOOT.md`, `HEARTBEAT.md`, `MEMORY.md`, `DREAMING.md`.
- Add skill manifest.
- Add per-user Fly deploy action modeled after existing deploy code.
- Upgrade OpenClaw image/version if current pinned runtime is stale.

Tests:

- Workspace file snapshot tests.
- Required file existence tests.
- No secret leakage tests.
- Size budget tests.
- Boot/heartbeat instructions mention no ScrapeCreators spend in heartbeat.

Smoke:

- Deploy one GTM Maya to staging Fly.
- Gateway boots.
- Workspace files present.
- Channel not yet required.

Exit:

- One test GTM Maya boots on Fly.

### Legacy Slice 3: Messaging and Calendar Onboarding

Goal:

- The user can connect messaging/calendar and start async research.

Build:

- `/onboarding/gtm` route.
- WhatsApp/iMessage pairing status flow.
- Calendar OAuth reuse or Composio calendar decision.
- App URL intake.
- Minimal questions.
- Research job creation.
- Mission Board progress UI.

Tests:

- Onboarding state machine.
- Calendar OAuth success/failure.
- Messaging channel status.
- App URL validation.

Smoke:

- Sign in, connect calendar, enter app URL, create research job.
- Maya sends "I am researching" message.

Exit:

- End-to-end intake works in staging.

### Legacy Slice 4: App Inspector

Goal:

- Maya can inspect an app and produce a grounded diagnosis.

Build:

- Browser inspection action.
- Screenshot capture.
- Page crawler for homepage/pricing/docs/blog.
- Optional test-login support.
- App Inspector skill.
- `gtmApps` diagnosis fields.

Tests:

- Fixture apps produce structured diagnosis.
- Broken URL handling.
- Paywall/login handling.
- Screenshot metadata stored.

Smoke:

- Inspect 3 real test app URLs.
- Mission Board shows diagnosis.

Exit:

- App diagnosis is useful without user ICP input.

### Legacy Slice 5: Research Subagents and Evidence Cards

Goal:

- Maya can spawn research agents and store evidence.

Build:

- OpenClaw `sessions_spawn` task templates.
- Subagent task specs.
- Convex result ingestion.
- ScrapeCreators query runner with cost audit.
- Reddit Demand Agent.
- Competitor/Search Agent.
- ICP Hypothesis Agent.

Tests:

- Subagent prompt/output schema tests.
- Evidence card validation.
- Cost audit required.
- No final strategy without evidence.

Smoke:

- Run full research for 2 fixture apps.
- Evidence cards appear with URLs/snippets.

Exit:

- Research depth is visible and auditable.

### Legacy Slice 6: Channel Agents

Goal:

- Maya can evaluate X, LinkedIn, TikTok, Reddit, and distribution motions
  separately.

Build:

- X Founder-Led Agent.
- TikTok Demo Agent.
- LinkedIn Fit Agent.
- Reddit Demand Agent v2 with subreddit-risk checks.
- Content format mining.
- Distribution Motion Agent.
- Viral Demo Moment Miner.
- UGC System Advisor in advisory-only mode.

Tests:

- B2B app does not blindly recommend TikTok.
- Visual consumer app can recommend TikTok.
- Visual consumer app identifies specific short-form motions and demo moments.
- Reddit recommendations include risk.
- LinkedIn recommendations require B2B/professional fit.
- UGC recommendation is blocked until a motion has evidence or the app already
  has strong proof/examples.

Smoke:

- Run on 5 app fixtures.
- Channel scores are explainable.

Exit:

- Channel selection is opinionated, not "post everywhere."

### Legacy Slice 7: Strategy Judge and Quality Gates

Goal:

- Maya creates an evidence-backed plan only when gates pass.

Build:

- Channel Strategy Judge skill.
- Strong-model route.
- Quality gate validator.
- Re-research fallback when evidence is weak.
- Plan confidence levels.

Tests:

- Fails when evidence count too low.
- Fails when plan lacks parked channels.
- Fails generic advice.
- Fails unsupported claims.

Smoke:

- Research job completes into primary/secondary/parked channel decisions.

Exit:

- Final plan is grounded with evidence references.

### Legacy Slice 8: Content Quality and Anti-Slop System

Goal:

- Maya drafts human-quality content and rejects generic slop.

Build:

- Content format library.
- Format mining.
- Content bank with winning/losing examples and reusable skeletons.
- Platform writers for X, LinkedIn, Reddit, TikTok.
- Slop critic.
- Claim checker/citation firewall.
- Writing profile adaptation from feedback.
- Distribution-motion variants: hook, body, CTA, demo moment, and success
  metric.

Tests:

- Banned phrase tests.
- Specificity scoring tests.
- Unsupported claim rejection.
- Platform-fit tests.
- User feedback updates writing profile.
- Winning content examples become content-bank items.
- Future drafts cite the content-bank pattern they are using.

Smoke:

- Generate drafts for 10 fixture app/channel combinations.
- Human review rubric run before beta.

Exit:

- Drafts are specific, grounded, and platform-native.

### Legacy Slice 9: Calendar Plan Builder

Goal:

- Maya turns strategy into executable calendar events.

Build:

- 7-day GTM calendar builder.
- Rich event payloads per platform.
- Event update/delete for Maya-owned events.
- Timezone and availability handling.
- "First action under 30 minutes" rule.

Tests:

- Event descriptions include draft/instructions/evidence/success metric.
- Maya only mutates Maya-owned events.
- Calendar collision handling.
- TikTok event includes recording instructions, not fake auto-post.

Smoke:

- Research job writes first 7-day calendar for test user.

Exit:

- User can execute from calendar alone.

### Legacy Slice 10: Approval and Publishing

Goal:

- Maya can ask approval and publish text posts where safe.

Build:

- Approval message parser.
- Approval records.
- X publish adapter through Composio/direct wrapper.
- LinkedIn publish adapter through Composio/direct wrapper.
- Publish failure handling.
- Published URL storage.

Tests:

- Cannot publish without approval.
- Exact approved content is published.
- User edit changes final body.
- X/LinkedIn tool errors become failed states.
- Cross-tenant publish isolation.

Smoke:

- Publish to test/sandbox X and LinkedIn accounts if available.
- Otherwise use mocked Composio + one staging manual live publish.

Exit:

- Approval-based X/LinkedIn publishing works.

### Legacy Slice 11: Results and Learning Loop

Goal:

- Maya learns from what happened.

Build:

- Metric refresh jobs.
- Manual result capture when metrics unavailable.
- Post-performance summaries.
- Weekly review.
- Writing profile updates.
- Channel score updates.
- Format experiment updates.
- Content bank promotion/demotion.
- UGC readiness report updates when a short-form motion wins.
- Memory/wiki promotion rules.

Tests:

- Metric refresh writes snapshots.
- Weak signal does not overfit.
- User rejection lowers pattern confidence.
- Weekly plan changes based on evidence.
- A high-view/low-signal post does not get marked as a winner.
- Repeated useful signal promotes a motion to `double_down`.

Smoke:

- Publish/dummy post, refresh metrics, produce weekly review.

Exit:

- Maya improves over time.

### Legacy Slice 12: Mission Board

Goal:

- Provide a thin source-of-truth UI without becoming a dashboard project.

Build:

- Progress board.
- App diagnosis.
- Evidence cards.
- Channel decisions.
- Week plan.
- Today tasks.
- Pending approvals.
- Results.

Tests:

- UI handles loading/empty/error states.
- No user-maintained required fields after onboarding.
- Mobile responsive.

Smoke:

- Complete onboarding from UI and message channel.

Exit:

- User can understand what Maya is doing and why.

### Legacy Slice 13: Beta Hardening

Goal:

- Make the product safe for real users.

Build:

- Rate limits.
- Cost limits.
- Error handling.
- Admin kill switch.
- Per-user machine health.
- Channel reconnect flows.
- Privacy/export/delete.
- Audit log surfaces.

Tests:

- Cost cap tests.
- API failure tests.
- WhatsApp/iMessage disconnect tests.
- Calendar OAuth revoke tests.
- OpenClaw machine restart tests.
- Subagent timeout tests.

Smoke:

- Full staging beta run with 3 internal apps.
- Simulate one failed platform connection.
- Simulate one model malformed output.

Exit:

- Ready for 5-user private beta.

### Legacy Slice 14: Private Beta

Goal:

- Validate product value and quality with real users.

Run:

- 5 users.
- 14 days.
- Required app URL/live beta.
- Weekly human review of every final plan.
- Track time-to-first-plan, approval rate, posts shipped, user-reported signal,
  cost/user, retention intent, format experiments run, winning motions found,
  and whether Maya created at least one concrete user-acquisition signal.

Success criteria:

- 80% of users approve the first channel strategy.
- 70% execute at least 3 Maya-scheduled actions in week one.
- 60% run at least one complete distribution-motion experiment in the first 14
  days.
- Average COGS below target for selected price.
- Human reviewer rates plans >= 4/5 on specificity and usefulness.
- No unauthorized publishing.

Exit:

- Decide pricing and V2 scope.

## Smoke Test Matrix

Minimum smoke tests before customer handoff:

- Signup and onboarding creates GTM account.
- WhatsApp/iMessage channel can receive/send.
- Calendar connects and writes Maya-owned event.
- Mobile walkthrough upload stores video and produces Gemini diagnosis.
- App URL inspection completes.
- Research job spawns subagents and returns evidence.
- Channel/motion judge picks primary/secondary/parked motions.
- 7-day plan writes rich calendar events.
- Approval request sent through messaging.
- X draft approved and published in test mode.
- LinkedIn draft approved and published in test mode.
- Reddit draft generated with promotion-risk warning.
- TikTok task includes the right format for the app: recording instructions,
  slideshow/carousel outline, screenshot sequence, or a clear reason TikTok is
  parked.
- Metrics refresh handles missing platform metrics.
- Weekly review updates strategy.
- Content bank updates from winning/losing formats.
- Cost ledger shows every external/model call.
- Admin can pause a user's Maya.

## Real-Account Test Setup

Do not paste raw passwords into chat, commits, docs, or env files. Real-account
testing should use OAuth, browser login, Composio connected accounts, test
accounts, and revocable API keys.

Needed for full staging smoke:

- Test Gmail/Google account:
  - Google Calendar enabled.
  - Calendar OAuth consent approved.
  - Empty or disposable calendar for Maya-owned GTM events.
- Messaging channel:
  - WhatsApp test number/account if using WhatsApp QR.
  - iMessage/ClawMessenger test identity if using iMessage.
- X/Twitter test account:
  - Used for OAuth and approval-based test publishing.
  - No real brand/account reputation attached.
  - Test posts may be public unless account is locked/private.
- LinkedIn test account:
  - Used for OAuth and approval-based test publishing.
  - Prefer a disposable/sandbox profile if possible.
  - If LinkedIn test accounts are not allowed/available, keep live publish
    manual and use mocked Composio for automated smoke.
- Composio:
  - Workspace/API key configured in environment.
  - Auth config IDs for X/Twitter, LinkedIn, Reddit if used, Gmail/Calendar if
    we route those through Composio.
  - Custom app credentials where Composio managed app is unavailable.
- ScrapeCreators:
  - API key configured in environment.
  - Credit budget set for staging.
- Model provider:
  - Gemini/OpenRouter keys configured in environment.
  - Model router budget limits enabled.
- Fly/OpenClaw:
  - Fly token and org/app permissions.
  - Runtime image pinned.
  - Per-user test machine can be created and destroyed.

Real-account smoke procedure:

1. Create a fresh staging user.
2. Connect Calendar and messaging.
3. Enter a real test app URL.
4. Let Maya run async research.
5. Review evidence cards and channel decision.
6. Approve calendar write.
7. Approve one X test post if test account is safe.
8. Approve one LinkedIn test post only if test account is safe.
9. For TikTok, verify script/shot-list/calendar only. No TikTok API/posting.
10. Verify result URLs/metric refresh where available.
11. Revoke OAuth connections after test if account was disposable.
12. Destroy or pause the test OpenClaw/Fly machine.

## Evals

Create 20 app fixtures:

- AI CSV cleaner.
- Invoice workflow app.
- Devtool.
- Meeting notes app.
- Chrome extension.
- Design generator.
- Resume tool.
- Shopify helper.
- Local-services booking app.
- Fitness tracker.
- Creator tool.
- B2B workflow tool.
- Consumer photo app.
- Education app.
- Real-estate lead tool.
- SaaS analytics helper.
- PDF summarizer.
- Legal template tool.
- Habit app.
- AI chatbot wrapper.

For each fixture, define:

- Expected likely ICPs.
- Channels likely useful.
- Channels likely parked.
- Bad generic advice to reject.
- Minimum useful evidence.
- One good first-week plan shape.

Run evals on:

- App diagnosis.
- ICP hypotheses.
- Evidence quality.
- Channel scoring.
- Draft quality.
- Calendar richness.
- Approval safety.

## Future Pro Creative Engine

Gemini Omni / Gemini Omni Flash is a future watch item for ClawLaunch Pro, not
an MVP dependency.

Current stance:

- Do not depend on Gemini Omni for V1 readiness because API access, pricing,
  latency, quality, and disclosure workflow are not yet stable enough to plan
  against.
- Do design the product so Maya can later generate short-form creative from app
  screenshots, mobile walkthroughs, scripts, reference formats, and content-bank
  winners.
- Treat AI-generated UGC-style video as an add-on or Pro-tier capability only
  after Maya has selected a short-form motion worth scaling.

Potential Pro flow:

1. Maya researches TikTok/short-form and chooses a motion.
2. User approves the script and product assets.
3. Maya calls Gemini Omni or another approved creative-generation provider.
4. Generated videos/slides are returned for review.
5. User approves and posts manually where required.
6. Maya tracks performance and updates the content bank.

Gates before shipping:

- API access available.
- Cost per generated asset known.
- Watermark/disclosure/commercial-use requirements documented.
- Per-user quotas and admin kill switch.
- Generated asset quality evals.
- No automatic posting of generated realistic/synthetic media without explicit
  user review and platform-required disclosure.

Pricing implication:

- $49 beta/core plan should not include unlimited generated UGC content.
- A future Pro plan around $99/month may include a small quota if unit costs are
  low enough.
- If generation costs are high, sell generated creative as metered credits or
  add-on packs.

## Pricing Assumption

Keep pricing simple at MVP launch: one paid plan plus a small private beta
cohort.

Recommended public price:

- **$49/month** for ClawLaunch Beta.

Why:

- The buyer is not a casual wannabe creator; they are already paying for
  development tools and need users.
- One Fly/OpenClaw machine per user makes sub-$20 pricing unattractive.
- The product's value is tied to user acquisition and feedback, not content
  volume.
- Multiple public tiers would complicate positioning before we know the usage
  curve.

Internal budgets can still vary by usage:

- bounded onboarding research budget
- bounded ScrapeCreators calls
- bounded model spend
- approval-based posting
- weekly strategy review cadence

Do not expose credits or "deep analysis" to users in V1. Maya simply works
within an internal budget and escalates only when the product needs it.

Future tiers only after beta data:

- **ClawLaunch Pro** around $99/month if users need higher posting volume,
  deeper weekly research, more connected accounts, or more frequent strategy
  refresh.
- **ClawLaunch Pro Creative** around $99/month or usage-based if Gemini
  Omni/creative-generation costs make AI UGC-style videos viable.
- **Agency / multi-app** custom pricing if one user manages several apps.

Do not price like consumer creator Maya. This ICP already pays for development
tools and can connect Maya's value to users/revenue.

The one-Fly-machine-per-user model is acceptable at $49-$99 if model/API usage
is disciplined. It is not acceptable at $9.99.

## Open Questions

1. Is WhatsApp stable enough for first beta, or should iMessage be the first
   production channel?
2. Do we use direct Google Calendar OAuth or consolidate Calendar through
   Composio sessions?
3. What is the exact per-user onboarding research budget for beta and for
   production?
4. Do we include X/LinkedIn OAuth during onboarding or after the first plan?
5. Should the first beta include publishing, or start with approval/draft only
   for one week?
6. Do we provision a new Convex project before beta or keep additive tables on
   current staging?
7. Do we rename Riley artifacts or leave them as internal reference only?
8. When Gemini Omni API access/pricing is public, does Pro Creative become a
   tier, a metered add-on, or stay out of product?
9. Which model wins the first research-subagent eval: Claude Sonnet, Gemini 3
   Flash, Gemini 3.5 Flash, or another OpenRouter model?
