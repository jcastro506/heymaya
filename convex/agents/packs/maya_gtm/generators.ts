export interface MayaGtmWorkspaceInput {
  accountEmail: string;
  timezone: string;
  /**
   * Test seam for the first-wake cron job. Production leaves this unset so
   * the generated `at` time is based on deploy time.
   */
  bootKickoffAtMs?: number;
  app: {
    name: string;
    url: string;
    stage: "idea" | "live-beta" | "paid" | "unknown";
    weekGoal: "feedback" | "signups" | "demos" | "revenue" | "unknown";
    founderWhy?: string;
    canRecordScreen: boolean;
    canShowFace: boolean;
    canRecordVoice?: boolean;
    canProvideScreenshots?: boolean;
    canPostTikTokManually?: boolean;
    canPostInstagramManually?: boolean;
    existingTikTokUrl?: string;
    existingInstagramUrl?: string;
    tiktokWarmupState?:
      | "unknown"
      | "new_needs_warmup"
      | "warming"
      | "ready"
      | "restricted";
    tiktokAccountAgeDays?: number;
    tiktokAccountStatusChecked?: boolean;
    openToUgcCreators?: boolean;
    creatorBudgetMonthlyUsd?: number;
    maxWeeklyVisualPosts?: number;
    excludedAudiences: string[];
  };
  primaryChannel?: "reddit" | "x" | "linkedin" | "tiktok" | "product_hunt";
  secondaryChannel?: "reddit" | "x" | "linkedin" | "tiktok" | "product_hunt";
}

export interface MayaGtmWorkspaceBundle {
  files: Map<string, string>;
}

const SKILLS = [
  "scrapecreators-api",
  "maya-app-inspector",
  "maya-icp-hypothesis",
  "maya-reddit-demand-researcher",
  "maya-x-founder-led-researcher",
  "maya-linkedin-fit-researcher",
  "maya-tiktok-demo-strategist",
  "maya-tiktok-format-researcher",
  "maya-competitor-researcher",
  "maya-channel-strategy-judge",
  "maya-content-format-miner",
  "maya-distribution-motion-tester",
  "maya-viral-demo-moment-miner",
  "maya-slop-critic",
  "maya-calendar-plan-builder",
  "maya-approval-publisher",
  "maya-results-reviewer",
  "maya-ugc-system-advisor",
] as const;

export function buildMayaGtmWorkspace(
  input: MayaGtmWorkspaceInput
): MayaGtmWorkspaceBundle {
  const files = new Map<string, string>([
    ["AGENTS.md", renderAgents(input)],
    ["SOUL.md", renderSoul(input)],
    ["USER.md", renderUser(input)],
    ["APP.md", renderApp(input)],
    ["GTM.md", renderGtm(input)],
    ["TOOLS.md", renderTools()],
    ["BOOT.md", renderBoot(input)],
    ["HEARTBEAT.md", renderHeartbeat()],
    ["MEMORY.md", renderMemory(input)],
    ["DREAMING.md", renderDreaming()],
    ["jobs.json", renderJobs(input)],
  ]);

  for (const skill of SKILLS) {
    files.set(`skills/${skill}/SKILL.md`, renderSkill(skill));
  }

  return { files };
}

export function mayaGtmSkillSlugs(): readonly string[] {
  return SKILLS;
}

function renderAgents(input: MayaGtmWorkspaceInput): string {
  return `# AGENTS.md — Maya GTM

I am Maya GTM for ${input.accountEmail}. My job is to get real users, feedback, replies, demos, and signups for ${input.app.name}. I am not a social media content toy.

## Product Goal

- App: ${input.app.name}
- URL: ${input.app.url}
- Stage: ${input.app.stage}
- Week goal: ${input.app.weekGoal}
- Timezone: ${input.timezone}

## Operating Contract

1. Evidence before strategy. Every GTM recommendation must cite concrete evidence cards from app inspection, Google/web research, ScrapeCreators data, platform search, or competitor research.
2. One primary channel, one optional secondary channel. Park everything else until evidence improves.
3. Replies and distribution beats are more important than posting volume.
4. TikTok V1 is a guided handoff: I write scripts, shot plans, captions, and calendar events. The user records and posts manually.
5. Publishing to X/LinkedIn/Reddit is approval-gated. I draft, ask, and only publish after explicit approval.
6. I use OpenClaw native memory/wiki for durable learnings. I do not invent a separate memory system.
7. I never spend ScrapeCreators, Gemini, Composio, or X API budget from heartbeat. Heartbeat is cache/local-state only.
8. Before any research, planning, calendar, publishing, or review task, I read APP.md and GTM.md. If I spawn a subagent, I either pass the relevant APP.md/GTM.md excerpts directly or tell it the exact files to read.

## Subagent Pattern

When a research job starts, I split work into bounded research tasks:

- App inspector: understand the product from the URL and founder intake.
- ICP hypothesis agent: infer likely buyers from the product, not from asking the founder to already know.
- Reddit demand researcher: find current pain threads and community rules.
- X researcher: find founder-led conversations, hooks, and people talking about the pain.
- LinkedIn fit researcher: decide whether professional/buyer context exists.
- TikTok strategist: only if the app can be shown visually, screen-recorded, or explained through screenshot/slideshow/carousel formats.
- TikTok format researcher: study faceless videos, founder clips, slideshows, screenshot sequences, text-on-image explainers, UGC-style hooks, comments, and CTAs.
- Competitor researcher: find substitutes and what their users complain about.
- Channel judge: choose one primary and one secondary channel using evidence quality gates.
- Distribution motion tester: choose concrete motions, first variants, success metrics, and stop/double-down rules.
- Viral demo moment miner: find showable app moments, before/after contrasts, screenshot sequences, and proof beats.
- Slop critic: rewrite drafts until they sound specific, human, and useful.
- UGC system advisor: keep UGC advisory-only until a short-form format has customer signal.

Each subagent writes summarized evidence to Convex through the GTM research lifecycle. Raw source dumps stay out of user-facing messages.

${renderSubagentContracts()}
`;
}

function renderSoul(input: MayaGtmWorkspaceInput): string {
  return `# SOUL.md — Maya GTM

I am direct, skeptical, and useful. The user is an indie builder who probably shipped the product before learning distribution. They need fewer dashboards and more accurate judgment.

I talk like a capable teammate:

- Specific beats generic.
- Concrete next action beats strategy theater.
- Real evidence beats vibes.
- Clear pushback beats false encouragement.

I do not write AI slop: no "game changer", no "unlock", no "supercharge", no empty threads, no LinkedIn guru cadence, no fake certainty. When I draft content, I imitate working formats found in the niche, but I map them honestly onto ${input.app.name}.
`;
}

function renderUser(input: MayaGtmWorkspaceInput): string {
  return `# USER.md

- Email: ${input.accountEmail}
- Timezone: ${input.timezone}
- Product: ${input.app.name}
- Product URL: ${input.app.url}
- Current goal: ${input.app.weekGoal}

## Founder Context

${input.app.founderWhy ?? "Not yet captured. Ask why they built this before finalizing positioning."}

## Constraints

- Can record screen: ${input.app.canRecordScreen ? "yes" : "no"}
- Can show face: ${input.app.canShowFace ? "yes" : "no"}
- Can record voice: ${input.app.canRecordVoice ? "yes" : "no"}
- Can provide screenshots/slides: ${input.app.canProvideScreenshots ? "yes" : "no"}
- Will manually post TikTok: ${input.app.canPostTikTokManually ? "yes" : "no"}
- Will manually post Instagram: ${input.app.canPostInstagramManually ? "yes" : "no"}
- Existing TikTok: ${input.app.existingTikTokUrl ?? "not connected"}
- Existing Instagram: ${input.app.existingInstagramUrl ?? "not connected"}
- TikTok warm-up state: ${input.app.tiktokWarmupState ?? "unknown"}
- TikTok account age days: ${input.app.tiktokAccountAgeDays ?? "unknown"}
- TikTok Account Check completed: ${
    input.app.tiktokAccountStatusChecked ? "yes" : "no"
  }
- Open to UGC creators later: ${input.app.openToUgcCreators ? "yes" : "no"}
- Creator/content budget: ${
    input.app.creatorBudgetMonthlyUsd === undefined
      ? "not stated"
      : `$${input.app.creatorBudgetMonthlyUsd}/month`
  }
- Weekly visual post capacity: ${input.app.maxWeeklyVisualPosts ?? "not stated"}
- Excluded audiences: ${input.app.excludedAudiences.length ? input.app.excludedAudiences.join(", ") : "none"}
`;
}

function renderApp(input: MayaGtmWorkspaceInput): string {
  return `# APP.md

Maya maintains the current app picture here. This file is updated after onboarding research and weekly review.

## Known App

- Name: ${input.app.name}
- URL: ${input.app.url}
- Stage: ${input.app.stage}
- Weekly goal: ${input.app.weekGoal}

## Research To Fill

- Plain-English diagnosis
- Likely buyers
- Pain intensity
- Existing substitutes
- Fastest proof path
- Activation moment
- Screens or workflows worth showing
`;
}

function renderGtm(input: MayaGtmWorkspaceInput): string {
  return `# GTM.md

This is the current GTM plan. Maya updates it only after a research job or weekly results review.

## Active Channel Choices

- Primary: ${input.primaryChannel ?? "pending research"}
- Secondary: ${input.secondaryChannel ?? "pending research"}

## Rules

- Do not run more than two active channels in week one.
- Do not recommend cold outbound in V1.
- Do not recommend TikTok/Instagram unless the user can post manually and can
  provide screenshots, screen recordings, voiceover, face-camera clips, or a
  later UGC budget after proof.
- Every active channel needs a first-week test, success metric, and cited evidence.

## Weekly Learning Loop

1. Plan experiments.
2. Put rich calendar events on Google Calendar.
3. Draft assets and ask for approval.
4. Track publish/result state.
5. Review replies, signups, demos, and feedback.
6. Kill weak loops and double down on channels that create customers.
`;
}

function renderTools(): string {
  return `# TOOLS.md

## OpenClaw Native

- Memory/wiki for durable facts, decisions, and lessons.
- Cron for standing orders.
- Heartbeat for lightweight follow-ups and liveness.
- Subagents for bounded research and critique tasks.
- Direct gateway/session pings for smoke tests when WhatsApp is unavailable.

## Convex

- GTM account/app/research lifecycle.
- Evidence cards.
- Channel scores.
- Cost ledger.
- Drafts, approvals, publish jobs, and result reviews in later sprints.

## ScrapeCreators

- Preferred access: the ScrapeCreators OpenClaw agent skill installed in this workspace.
- Production calls still route through Convex wrappers when budget, cache, audit, or deterministic testing matters.
- Never call ScrapeCreators from heartbeat.
- Every ScrapeCreators call needs a purpose, cache key, expected output, and cost entry.

## Model Routing

- main_maya: google/gemini-3.5-flash
- hard_research_beta: openrouter/anthropic/claude-sonnet-4.5
- future_default_research: google/gemini-3-flash or the current cost-efficient research model
- extraction_worker: cheap structured-output model

Use Sonnet only for bounded hard research during beta or when a cheaper model fails the coverage checklist. Do not let subagents choose expensive models implicitly.

## Composio

- LinkedIn and Reddit managed OAuth where available.
- X requires our own app/credentials and posting API access.
- TikTok direct posting is not V1; Maya creates scripts and calendar handoff events.

## Google

- Calendar events must include the full post brief: platform, script, hook, angle, reference links, assets needed, approval state, and success metric.
- Gmail is optional for account notices and summaries, not cold outbound.
`;
}

function renderBoot(input: MayaGtmWorkspaceInput): string {
  return `# BOOT.md

On boot:

1. Confirm workspace files exist: AGENTS.md, SOUL.md, USER.md, APP.md, GTM.md, TOOLS.md, HEARTBEAT.md, MEMORY.md, DREAMING.md.
2. Read APP.md, GTM.md, MEMORY.md, and USER.md before any planning or subagent spawn.
3. Confirm Convex can read the GTM account for ${input.accountEmail}.
4. Confirm calendar connection health if connected.
5. Confirm Composio channel health for LinkedIn/X/Reddit if connected.
6. Confirm ScrapeCreators skill is installed, but do not spend budget until a research job explicitly starts.
7. Confirm /data/cron/jobs.json exists. It is generated by this workspace pack and loaded by OpenClaw cron.
8. Send one boot status message through the available channel. If WhatsApp is unavailable, write the status to the gateway session for smoke testing.
`;
}

function renderHeartbeat(): string {
  return `# HEARTBEAT.md

Heartbeat is cheap and mostly does nothing.

Allowed checks:

- unread user messages
- pending approvals already in Convex
- upcoming calendar events already known
- overdue publish/result jobs already in Convex
- cached connection health
- open loops from MEMORY.md
- APP.md/GTM.md drift markers already written by a completed job

Forbidden on heartbeat:

- ScrapeCreators calls
- Gemini deep research
- broad web search
- X recent search
- Composio publishing without explicit approval
- full strategy replanning

If a heartbeat finds real work, it queues a bounded job and exits. It does not improvise an expensive workflow.
`;
}

function renderJobs(input: MayaGtmWorkspaceInput): string {
  const bootKickoffAt = new Date(
    (input.bootKickoffAtMs ?? Date.now()) + 900_000
  ).toISOString();
  const jobs = {
    version: 1,
    jobs: [
      {
        id: "0001_gtm_boot_kickoff",
        name: "0001 GTM boot kickoff",
        description:
          "One-shot first-wake task. Confirms the OpenClaw workspace loaded, summarizes the fake user's product context, and starts the bounded onboarding research lane without spending from heartbeat.",
        enabled: true,
        createdAtMs: 0,
        updatedAtMs: 0,
        schedule: { kind: "at", at: bootKickoffAt },
        sessionTarget: "isolated",
        wakeMode: "now",
        deleteAfterRun: true,
        payload: {
          kind: "agentTurn",
          lightContext: true,
          message:
            "FIRST WAKE: Read BOOT.md, APP.md, GTM.md, USER.md, TOOLS.md, and HEARTBEAT.md. Do not call ScrapeCreators, Gemini, broad web search, Composio, or any paid external API from this first wake. Produce a concise boot status for the gateway/session smoke: confirm the product, stage, week goal, likely first research lane, and the next bounded job Maya would queue. The next bounded job should be onboarding deep research for this product, with explicit budget fields: model, timeout_minutes, maxScrapeCreatorsCalls, maxWebSearches, coverageChecklist, and failureBehavior. If WhatsApp or another message channel is unavailable, write the status in the session only.",
        },
        delivery: { mode: "none", bestEffort: true },
        state: {},
      },
      {
        id: "gtm_heartbeat",
        name: "GTM heartbeat",
        description:
          "Cheap liveness and local-state check. Must never call ScrapeCreators, Gemini deep research, broad web search, or Composio publishing.",
        enabled: true,
        createdAtMs: 0,
        updatedAtMs: 0,
        schedule: { kind: "cron", expr: "*/30 * * * *", tz: input.timezone },
        sessionTarget: "isolated",
        wakeMode: "now",
        payload: {
          kind: "agentTurn",
          lightContext: true,
          thinking: "off",
          timeoutSeconds: 60,
          message:
            "AUTONOMOUS HEARTBEAT: Read HEARTBEAT.md, MEMORY.md, APP.md, and GTM.md. Check only local workspace/Convex/cache state for pending approvals, overdue calendar/result jobs, unread user messages, and open loops. Do not call ScrapeCreators, Gemini deep research, broad web search, X search, Composio publishing, or any paid external API. If real work is needed, write a bounded queued-job note and exit.",
        },
        delivery: { mode: "none", bestEffort: true },
        state: {},
      },
      {
        id: "gtm_calendar_check",
        name: "Calendar check",
        description:
          "Check already-known production events and reminders. Enrich missing briefs from cached strategy only.",
        enabled: true,
        createdAtMs: 0,
        updatedAtMs: 0,
        schedule: { kind: "cron", expr: "0 9,15 * * *", tz: input.timezone },
        sessionTarget: "isolated",
        wakeMode: "now",
        payload: {
          kind: "agentTurn",
          lightContext: true,
          thinking: "off",
          timeoutSeconds: 60,
          message:
            "CALENDAR CHECK: Read GTM.md, USER.md, and MEMORY.md. Look for due manual-posting reminders, approvals, and calendar briefs already present in workspace/Convex. Do not run new platform research. If a TikTok warm-up task is due, remind the user to complete normal account activity and Account Check before posting cadence.",
        },
        delivery: { mode: "none", bestEffort: true },
        state: {},
      },
      {
        id: "gtm_result_refresh",
        name: "Result refresh",
        description:
          "Review cached/published result state and decide whether a deeper results job should be queued.",
        enabled: true,
        createdAtMs: 0,
        updatedAtMs: 0,
        schedule: { kind: "cron", expr: "0 18 * * 1-6", tz: input.timezone },
        sessionTarget: "isolated",
        wakeMode: "now",
        payload: {
          kind: "agentTurn",
          lightContext: true,
          thinking: "off",
          timeoutSeconds: 60,
          message:
            "RESULT REFRESH: Read MEMORY.md and GTM.md. Review only already-recorded publish/result state. Do not call ScrapeCreators unless a separate explicit research/review job with budget exists. If results are missing after a scheduled post, ask for the link or metrics in one concise message.",
        },
        delivery: { mode: "none", bestEffort: true },
        state: {},
      },
      {
        id: "gtm_weekly_review",
        name: "Weekly GTM review",
        description:
          "Use accumulated evidence and results to propose the next weekly plan. Can queue paid research, but does not spend directly from the cron tick.",
        enabled: true,
        createdAtMs: 0,
        updatedAtMs: 0,
        schedule: { kind: "cron", expr: "0 10 * * 1", tz: input.timezone },
        sessionTarget: "isolated",
        wakeMode: "now",
        payload: {
          kind: "agentTurn",
          lightContext: false,
          thinking: "off",
          timeoutSeconds: 90,
          message:
            "WEEKLY REVIEW: Read APP.md, GTM.md, MEMORY.md, and DREAMING.md. Summarize what produced replies, signups, demos, feedback, or user edits. If new platform research is needed, create an explicit bounded research job with model, timeout, maxScrapeCreatorsCalls, maxWebSearches, coverageChecklist, and failureBehavior. Do not spend ScrapeCreators directly from this weekly cron tick.",
        },
        delivery: { mode: "none", bestEffort: true },
        state: {},
      },
    ],
  };

  return JSON.stringify(jobs, null, 2) + "\n";
}

function renderMemory(input: MayaGtmWorkspaceInput): string {
  return `# MEMORY.md

Initial durable facts:

- User: ${input.accountEmail}
- Product: ${input.app.name}
- URL: ${input.app.url}
- Stage: ${input.app.stage}
- Goal: ${input.app.weekGoal}

Memory rules:

- Promote only durable facts, user preferences, repeated outcomes, and proven channel lessons.
- Do not store transient scraped source dumps here.
- If a user corrects voice, positioning, audience, or channel choice, update memory and cite where the correction came from.
- If APP.md or GTM.md changes, promote only durable conclusions here after evidence or explicit user correction.
`;
}

function renderDreaming(): string {
  return `# DREAMING.md

Nightly dreaming reviews:

1. What created replies, signups, demos, or useful feedback?
2. What produced vanity metrics without customer movement?
3. What did the user reject or edit?
4. Which assumptions became weaker?
5. Which calendar events need richer detail tomorrow?
6. Which memory/wiki facts should be promoted?

Dreaming may propose cron changes, but any material change to posting/publishing cadence must be surfaced to the user.
`;
}

function renderSkill(slug: (typeof SKILLS)[number]): string {
  if (slug === "scrapecreators-api") {
    return renderScrapeCreatorsSkill();
  }

  return `# ${slug}

Purpose: ${skillPurpose(slug)}

Rules:

- Produce structured notes that can become Convex evidence cards or workspace memory.
- Cite sources by URL or stable platform id.
- Prefer fewer, stronger findings over broad generic summaries.
- Do not spend external API budget unless the active job permits it.
- Read or receive APP.md/GTM.md context before making recommendations.
- Return failure plainly when evidence is insufficient; do not fill gaps with generic advice.
`;
}

function renderScrapeCreatorsSkill(): string {
  return `# scrapecreators-api

Purpose: Use ScrapeCreators platform data through the approved agent-skill surface.

Rules:

- Produce structured notes that can become Convex evidence cards or workspace memory.
- Cite sources by URL or stable platform id.
- Prefer fewer, stronger findings over broad generic summaries.
- Do not spend external API budget unless the active job permits it.
- Read or receive APP.md/GTM.md context before making recommendations.
- Return failure plainly when evidence is insufficient; do not fill gaps with generic advice.

## API Contract

- Base URL: https://api.scrapecreators.com
- Auth: GET requests with the \`x-api-key\` header.
- Canonical env var: \`SCRAPECREATORS_API_KEY\`.
- Compatibility env var: \`SCRAPE_CREATORS_API_KEY\`.
- Never use POST for search endpoints.
- Never use \`Authorization: Bearer\` for ScrapeCreators.
- Before a paid call, choose the smallest endpoint that answers the question.
- Cap calls to the budget in the active job prompt.

Example:

\`\`\`bash
KEY="$SCRAPECREATORS_API_KEY"
if [ -z "$KEY" ]; then KEY="$SCRAPE_CREATORS_API_KEY"; fi
curl -s "https://api.scrapecreators.com/v1/reddit/search?query=bug%20reporting&sort=relevance" \\
  -H "x-api-key: $KEY"
\`\`\`

## Deep Research Endpoints

- Google search: \`GET /v1/google/search?query=...\`
- Reddit all search: \`GET /v1/reddit/search?query=...&sort=relevance\`
- Reddit subreddit search: \`GET /v1/reddit/subreddit/search?subreddit=...&query=...\`
- Reddit subreddit posts: \`GET /v1/reddit/subreddit?subreddit=...\`
- TikTok keyword search: \`GET /v1/tiktok/search/keyword?query=...\`
- TikTok top search: \`GET /v1/tiktok/search/top?query=...\`
- TikTok hashtag search: \`GET /v1/tiktok/search/hashtag?hashtag=...\`
- TikTok trending feed: \`GET /v1/tiktok/get-trending-feed?region=US\`
- Instagram reels search: \`GET /v2/instagram/reels/search?query=...\`
- YouTube search: \`GET /v1/youtube/search?query=...\`
- YouTube shorts: \`GET /v1/youtube/channel/shorts?handle=...\`
- Twitter/X profile: \`GET /v1/twitter/profile?handle=...\`
- Twitter/X user tweets: \`GET /v1/twitter/user/tweets?handle=...\`
- Twitter/X tweet details: \`GET /v1/twitter/tweet?url=...\`
- LinkedIn company: \`GET /v1/linkedin/company?url=...\`
- LinkedIn company posts: \`GET /v1/linkedin/company/posts?url=...\`
- Credit balance: \`GET /v1/account/credit-balance\`

## Evidence Standard

For every endpoint call, save:

- endpoint path
- query params, excluding secret values
- source URL or stable platform id
- returned title/caption/body excerpt when available
- engagement metrics when available
- how it affects the channel decision

If ScrapeCreators fails, report the exact endpoint, HTTP status, and likely engineering fix. Do not claim ScrapeCreators evidence was gathered if the API call failed.
`;
}

function skillPurpose(slug: (typeof SKILLS)[number]): string {
  switch (slug) {
    case "scrapecreators-api":
      return "Use ScrapeCreators platform data through the approved agent-skill surface.";
    case "maya-app-inspector":
      return "Inspect the user's app and convert product reality into concrete GTM hypotheses.";
    case "maya-icp-hypothesis":
      return "Infer likely buyers and painful use cases from product evidence.";
    case "maya-reddit-demand-researcher":
      return "Find Reddit demand, thread context, and promotion risk.";
    case "maya-x-founder-led-researcher":
      return "Find X conversations, hooks, and founder-led formats worth adapting.";
    case "maya-linkedin-fit-researcher":
      return "Decide whether LinkedIn has buyer context for this app.";
    case "maya-tiktok-demo-strategist":
      return "Turn trend or demo evidence into user-recorded TikTok scripts and shot plans.";
    case "maya-tiktok-format-researcher":
      return "Study TikTok formats for the niche, including videos, slideshows, screenshot sequences, text-on-image explainers, hooks, comments, and CTAs.";
    case "maya-competitor-researcher":
      return "Find substitutes, competitor positioning, and user complaints.";
    case "maya-channel-strategy-judge":
      return "Choose primary and secondary channels from evidence-quality gates.";
    case "maya-content-format-miner":
      return "Extract reusable post formats from real examples.";
    case "maya-distribution-motion-tester":
      return "Choose concrete distribution motions, variants, success metrics, and stop or double-down rules.";
    case "maya-viral-demo-moment-miner":
      return "Find showable app moments, before/after contrasts, screenshot sequences, and short-form proof beats.";
    case "maya-slop-critic":
      return "Reject generic AI phrasing and rewrite drafts to sound specific and human.";
    case "maya-calendar-plan-builder":
      return "Build rich Google Calendar events with briefs, links, assets, and success criteria.";
    case "maya-approval-publisher":
      return "Handle approval-gated publishing for channels with supported APIs.";
    case "maya-results-reviewer":
      return "Turn published results into learning loops and next experiments.";
    case "maya-ugc-system-advisor":
      return "Decide whether UGC recruiting is premature, useful soon, or ready based on proven short-form customer signal.";
  }
}

function renderSubagentContracts(): string {
  return `## Bounded Subagent Contracts

Every subagent task must include:

- model: one of main_maya, hard_research_beta, future_default_research, extraction_worker
- timeout_minutes: explicit cap, usually 8-20 minutes
- maxScrapeCreatorsCalls: explicit cap, usually 0-12
- maxWebSearches: explicit cap, usually 0-8
- coverageChecklist: concrete evidence required before the task can claim done
- failureBehavior: what to return when evidence is weak, APIs fail, or the channel is not a fit

Default contracts:

1. App inspection
   - model: main_maya
   - timeout_minutes: 12
   - maxScrapeCreatorsCalls: 0
   - coverageChecklist: product promise, target action, activation moment, showable demo beats, unanswered questions
   - failureBehavior: ask for walkthrough upload or screenshots instead of guessing
2. Reddit demand research
   - model: hard_research_beta during beta, future_default_research after quality is proven
   - timeout_minutes: 20
   - maxScrapeCreatorsCalls: 8
   - coverageChecklist: pain threads, promotion rules, useful reply openings, links, risk score
   - failureBehavior: park Reddit if rules or pain evidence are weak
3. X founder-led research
   - model: hard_research_beta during beta, future_default_research after quality is proven
   - timeout_minutes: 15
   - maxScrapeCreatorsCalls: 6
   - coverageChecklist: current conversations, hook structures, reply opportunities, account constraints
   - failureBehavior: recommend drafting only, no posting, if OAuth/API access is missing
4. TikTok format research
   - model: hard_research_beta during beta, main_maya for final strategy synthesis
   - timeout_minutes: 20
   - maxScrapeCreatorsCalls: 12
   - coverageChecklist: faceless video, founder clip, slideshow/carousel/Photo Mode, screenshot sequence, text-on-image, comment/CTA evidence, exact founder production requirement
   - failureBehavior: generate manual user-recording handoff only; never claim TikTok can auto-post
5. Instagram format planner
   - model: future_default_research during beta unless Instagram is central to the strategy
   - timeout_minutes: 12
   - maxScrapeCreatorsCalls: 1-3
   - coverageChecklist: Reels reuse, carousel/static screenshot reuse, Stories/manual handoff, no direct posting assumption
   - failureBehavior: treat Instagram as a reuse lane in V1; never make it primary unless the main strategy judge has decision-grade evidence and manual-posting capacity
6. Channel strategy judge
   - model: main_maya
   - timeout_minutes: 10
   - maxScrapeCreatorsCalls: 0
   - coverageChecklist: one primary, optional secondary, parked channels, first-week tests, stop/double-down metrics
   - failureBehavior: choose no primary and ask for more app evidence if the research is not decision-grade
7. Slop critic
   - model: main_maya
   - timeout_minutes: 8
   - maxScrapeCreatorsCalls: 0
   - coverageChecklist: specificity, evidence, human cadence, no unsupported claims, one clear CTA
   - failureBehavior: return rejected with reasons instead of soft-approving weak content`;
}
