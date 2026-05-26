import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import { FlyClient, FlyError, type FlyMachineConfig } from "../../lib/flyClient";
import { buildMayaGtmWorkspace } from "../../agents/packs/maya_gtm/generators";
import { mintHookToken } from "../../gtmMaya/openclaw/hookClient";
import {
  buildDeployTimeHelloText,
  sendDirectTelegramMessage,
} from "../../integrations/telegram/sendDirectMessage";

export type DeployMayaGtmStage =
  | "load-agent"
  | "generate-workspace"
  | "upload-bundle"
  | "create-app"
  | "set-secrets"
  | "create-machine"
  | "wait-for-state"
  | "patch-agent"
  | "complete";

export type DeployMayaGtmResult =
  | {
      ok: true;
      stage: "complete";
      flyAppId: string;
      machineId: string;
      durationMs: number;
    }
  | {
      ok: false;
      stage: DeployMayaGtmStage;
      message: string;
      retryable: boolean;
      durationMs: number;
    };

/**
 * OpenClaw runtime image.
 *
 * Sprint 13 (Part II of CLAWLAUNCH_GTM_MVP_EXECUTION_SPRINT.md) targets
 * `v2026.5.20` for the heartbeat-pollution fix, cron legacy-store fix, and
 * subagent allowlist tightening. The upgrade target is documented below as
 * `OPENCLAW_IMAGE_TARGET` so smoke scripts can verify the canonical value
 * without grepping. The default stays pinned to `v2026.4.23` until the
 * operator has pulled v2026.5.20 into the private registry AND run
 * `openclaw doctor` + `openclaw security audit --deep` on a throwaway Fly
 * app. To flip, set `MAYA_GTM_OPENCLAW_IMAGE=registry.fly.io/heymaya-openclaw:v2026.5.20`
 * on the Convex deployment. Roll back by clearing the env var.
 */
export const OPENCLAW_IMAGE_TARGET = "registry.fly.io/heymaya-openclaw:v2026.5.20";
export const OPENCLAW_IMAGE_PINNED = "registry.fly.io/heymaya-openclaw:v2026.4.23";

const OPENCLAW_IMAGE =
  process.env.MAYA_GTM_OPENCLAW_IMAGE ??
  process.env.MAYA_OPENCLAW_IMAGE ??
  OPENCLAW_IMAGE_PINNED;

export function resolveOpenClawImage(
  env: Partial<Record<string, string | undefined>> = process.env
): string {
  return (
    env.MAYA_GTM_OPENCLAW_IMAGE ??
    env.MAYA_OPENCLAW_IMAGE ??
    OPENCLAW_IMAGE_PINNED
  );
}

/**
 * Sprint 14 — resolve the Convex .convex.site URL OpenClaw posts to when a
 * cron's announce delivery fails. Pulls from MAYA_GTM_FAILURE_DESTINATION_URL
 * if explicitly set; otherwise derives from CONVEX_SITE_URL +
 * /lc_gtm/delivery_failure. Returns undefined if neither is set (in which
 * case OpenClaw silently drops failures, which is bad but not blocking).
 */
export function resolveDeliveryFailureUrl(
  env: Partial<Record<string, string | undefined>> = process.env
): string | undefined {
  if (env.MAYA_GTM_FAILURE_DESTINATION_URL) {
    return env.MAYA_GTM_FAILURE_DESTINATION_URL;
  }
  const siteUrl = env.CONVEX_SITE_URL ?? env.NEXT_PUBLIC_CONVEX_SITE_URL;
  if (!siteUrl) return undefined;
  return `${siteUrl.replace(/\/$/, "")}/lc_gtm/delivery_failure`;
}

/**
 * Sprint 16 — base URL Maya uses when POSTing /lc_gtm/{research_callback,
 * approval_decision, calendar_proposal}. Pulls from CONVEX_SITE_URL or
 * the explicit override env. Always returns a trailing-slash-stripped URL
 * so workspace generator can concatenate `/lc_gtm/<route>` cleanly.
 */
export function resolveConvexHookCallbackBaseUrl(
  env: Partial<Record<string, string | undefined>> = process.env
): string | undefined {
  if (env.MAYA_GTM_CONVEX_CALLBACK_BASE_URL) {
    return env.MAYA_GTM_CONVEX_CALLBACK_BASE_URL.replace(/\/$/, "");
  }
  const siteUrl = env.CONVEX_SITE_URL ?? env.NEXT_PUBLIC_CONVEX_SITE_URL;
  if (!siteUrl) return undefined;
  return siteUrl.replace(/\/$/, "");
}

const MODEL_ROUTING = {
  // Sprint 2.16a — Maya's brain. Gemini 3.5 Flash is the strategist
  // model: reads subagent outputs, judges quality, decides whether
  // to spawn refinement waves or ship the plan. Was 3-flash-preview;
  // operator-flagged 2026-05-25 that 3.5 is the right brain for the
  // iterative-research-loop architecture.
  // Sprint 2.16p — operator floor: minimum Gemini 3. `gemini-3-flash`
  // (no -preview) doesn't exist on OpenRouter — the real Gemini 3
  // Flash ID is `google/gemini-3-flash-preview`. If this still hits
  // the "reasoning is mandatory" gate that 3.5-flash has, the next
  // move is anthropic/claude-sonnet-4.5 (no reasoning gate, $3/M in,
  // $15/M out, 1M ctx). Per-cron-payload thinking is set to "medium"
  // in generators.ts boot cron.
  //
  // Operator-approved alternatives (set via env var override):
  //   MAYA_GTM_MODEL=anthropic/claude-sonnet-4.5  (premium, no gate)
  //   MAYA_GTM_MODEL=anthropic/claude-sonnet-4.6  (newer Sonnet)
  //   MAYA_GTM_MODEL=anthropic/claude-haiku-4.5   (cheaper Claude)
  mainMaya: process.env.MAYA_GTM_MODEL ?? "google/gemini-3-flash-preview",
  // Sprint 2.16a — channel-research subagents. Gemini 3 Flash (NOT
  // 3.5 — that's main's brain). Subagents do focused platform work
  // (scrape, score, draft) — they don't need 3.5's strategic judgment.
  // Cheaper, faster, plenty of headroom with thinking:medium budget
  // injected via their prompt. Replaces the prior mix of Claude
  // Sonnet 4.5 (10x more expensive) + scattered Gemini configs.
  // Sprint 2.16p — same model as main brain. Both research and main
  // get the same baseline capability.
  subagent: process.env.MAYA_GTM_SUBAGENT_MODEL ?? "google/gemini-3-flash-preview",
  hardResearchBeta:
    process.env.MAYA_GTM_HARD_RESEARCH_MODEL ??
    "openrouter/anthropic/claude-sonnet-4.5",
  futureDefaultResearch:
    process.env.MAYA_GTM_RESEARCH_MODEL ?? "google/gemini-3-flash",
  extractionWorker:
    process.env.MAYA_GTM_EXTRACTION_MODEL ?? "google/gemini-3.1-flash-lite",
};

const MACHINE_GUEST: NonNullable<FlyMachineConfig["guest"]> = {
  cpu_kind: "shared",
  cpus: 1,
  memory_mb: 1024,
};

const WAIT_TIMEOUT_MS = 180_000;
const WAIT_INTERVAL_MS = 3_000;

export interface BuildGatewayConfigInput {
  /**
   * Sprint 1.3 — when set, the Telegram channel adapter is enabled with a
   * dmPolicy allowlist scoped to this user ID. Without this, OpenClaw boots
   * with 0 channels and the orchestrator's `delivery: { channel: telegram }`
   * silently drops. The bot token is read from the TELEGRAM_BOT_TOKEN env
   * var (must be present in Fly secrets via collectDeploySecrets).
   *
   * Pre-pairing creators get no Telegram channel — keeps the gateway config
   * valid in test fixtures and during onboarding. The orchestrator's handoff
   * + heartbeat tasks check for telegramChatId presence before scheduling
   * delivery, so an unset channel just means messages are deferred until
   * the user pairs.
   */
  telegramChatId?: string;
}

export function buildGatewayConfig(
  input: BuildGatewayConfigInput = {}
): Record<string, unknown> {
  const mainModel = toOpenClawModelRef(MODEL_ROUTING.mainMaya);
  const subagentModel = toOpenClawModelRef(MODEL_ROUTING.subagent);
  const hardModel = toOpenClawModelRef(MODEL_ROUTING.hardResearchBeta);
  const extractionModel = toOpenClawModelRef(MODEL_ROUTING.extractionWorker);
  const memorySearch = buildMemorySearchConfig();

  // Sprint 20 — Maya-side subagent lane. Registers per-platform research
  // subagents Maya can spawn via sessions_spawn({ agentId: "<id>" }). Each
  // subagent has its own context + token budget; cron-heartbeat-at-
  // thinking-0 can still spawn a thinking:high subagent for heavy work
  // without inheriting the cron's budget ban.
  //
  // Naming convention matches the AGENTS.md "Subagent Pattern" section
  // so Maya already knows the slugs by the time she reads them.
  // Sprint 2.16a — all channel-research subagents unify on
  // gemini-3-flash (the cheaper Gemini, NOT 3.5). Subagents do
  // focused platform work — they don't need 3.5's strategic
  // judgment. Was Claude Sonnet 4.5 on the heavy ones which is
  // 10x more expensive + slower for no quality lift on focused
  // tasks. With operator-approved `thinking: medium` budget in
  // the subagent prompts, Gemini 3 Flash has enough headroom to
  // do multi-step research per channel.
  // Sprint 2.16l — research subagents get the FULL coding profile by
  // omitting `tools.allow` (which is RESTRICTIVE in OpenClaw, not
  // additive). Prior config `allow: ["scrapecreators-api", "web_fetch"]`
  // restricted the subagent to only web_fetch (the fake "scrapecreators-
  // api"/"search-x"/"tiktok"/"instagram" entries got stripped silently
  // with a warning — they're not real tool IDs). That meant subagents
  // had NO tool that could POST with Bearer auth to /lc_gtm/* callbacks
  // — they tried web_fetch (GET-only) on POST endpoints, got 404s, gave
  // up, returned empty. Six deploys deep, that was the real bug.
  //
  // Full coding profile gives them: read, write, edit, exec, process,
  // web_fetch, web_search, x_search, memory_*, sessions_*. With `exec`
  // they can curl with auth headers; with web_fetch they can do GETs
  // (e.g. HN Algolia search, ScrapeCreators GET endpoints).
  const SUBAGENTS = [
    {
      id: "reddit_research",
      name: "Reddit Demand Researcher",
      model: subagentModel,
      tools: { profile: "coding" as const },
      // Allow no further spawning — depth-1 max from main.
      subagents: { allowAgents: [] as string[] },
    },
    {
      id: "x_research",
      name: "X Founder-Led Researcher",
      model: subagentModel,
      tools: { profile: "coding" as const },
      subagents: { allowAgents: [] as string[] },
    },
    {
      id: "tiktok_research",
      name: "TikTok Format Researcher",
      model: subagentModel,
      tools: { profile: "coding" as const },
      subagents: { allowAgents: [] as string[] },
    },
    {
      id: "instagram_research",
      name: "Instagram Reuse Researcher",
      model: subagentModel,
      tools: { profile: "coding" as const },
      subagents: { allowAgents: [] as string[] },
    },
    {
      id: "linkedin_research",
      name: "LinkedIn Fit Researcher",
      model: subagentModel,
      tools: { profile: "coding" as const },
      subagents: { allowAgents: [] as string[] },
    },
    {
      // HN via Algolia search — no API key required, GET-only.
      // Full coding profile here too so subagent can choose web_fetch
      // for the GET or curl-via-exec if needed.
      id: "hn_research",
      name: "Hacker News Demand Researcher",
      model: subagentModel,
      tools: { profile: "coding" as const },
      subagents: { allowAgents: [] as string[] },
    },
    {
      id: "channel_judge",
      name: "Channel Strategy Judge",
      model: mainModel,
      // Pure synthesis — deny network-egress tools so the judge can't
      // burn external API budget mid-decision. (Removed fake
      // "scrapecreators-api"/"tiktok"/"search-x" entries which were
      // stripped silently anyway.)
      tools: { profile: "coding" as const, deny: ["web_fetch", "web_search", "exec", "process"] },
      subagents: { allowAgents: [] as string[] },
    },
    {
      id: "slop_critic",
      name: "Slop Critic",
      model: mainModel,
      // Local-only — banned-phrase scan + voice match. Deny network
      // and exec so it can't accidentally make HTTP/shell calls.
      tools: { profile: "coding" as const, deny: ["web_fetch", "web_search", "exec", "process"] },
      subagents: { allowAgents: [] as string[] },
    },
    {
      id: "extraction_worker",
      name: "Extraction Worker",
      // Cheap structured-output model for normalizing multimodal walkthrough
      // analysis output into ResearchRawItem-shaped data. Per TOOLS.md.
      model: extractionModel,
      tools: { profile: "coding" as const },
      subagents: { allowAgents: [] as string[] },
    },
  ];

  // The set of subagent IDs main can spawn. hard_research_beta retained
  // for backward compatibility with any existing standing orders that
  // reference it.
  const allowFromMain = [
    "main",
    "hard_research_beta",
    ...SUBAGENTS.map((s) => s.id),
  ];

  return {
    gateway: { mode: "local" },
    agents: {
      defaults: {
        workspace: "/data/workspace",
        model: {
          primary: mainModel,
        },
        memorySearch,
        // Sprint 2.16h — extend LLM idle-watchdog from default ~120s to 300s.
        // Gemini 3.5 Flash with high thinking on multi-step prompts can pause
        // mid-stream past 120s; pi-coding-agent then aborts and the agent
        // surfaces "LLM request timed out" to the user. OpenClaw runtime
        // error message names this exact key as the fix.
        llm: { idleTimeoutSeconds: 300 },
        // Sprint 2.16l — attempted `thinking: "minimal"` at this level
        // to avoid OpenRouter's "Reasoning is mandatory" 400 + auto-retry
        // round-trip on every LLM call with gemini-3.5-flash. But the
        // OpenClaw schema rejected it: "agents.defaults: Unrecognized
        // key: thinking". `thinking` is a per-payload field, not a
        // global default. Each cron's payload already sets it correctly.
        // The 400-then-auto-retry-with-minimal is annoying-but-not-fatal:
        // OpenClaw self-heals.
        subagents: {
          // Sprint 2.16j — bumped 4 → 8 per external-architect review.
          // We cap research lanes at 3 in the boot prompt, so 8 leaves
          // headroom for refinement waves + parallel weekly-review fans
          // without queuing.
          maxConcurrent: 8,
          maxChildrenPerAgent: 4,
          maxSpawnDepth: 1,
          runTimeoutSeconds: 900,
          archiveAfterMinutes: 60,
        },
        // Sprint 18 — heartbeat config. Documented cost-savings pattern
        // from OpenClaw docs: lightContext (only HEARTBEAT.md) + an
        // isolated fresh session per fire. Active hours respect operator
        // tz; OpenClaw natively skips fires outside the window.
        // tasks: YAML block lives in HEARTBEAT.md so the per-task
        // interval gating is owned by OpenClaw, not by us.
        heartbeat: {
          every: "30m",
          lightContext: true,
          isolatedSession: true,
          activeHours: {
            start: "09:00",
            end: "22:00",
            timezone: "operator", // generators.ts templates the user's tz
          },
        },
      },
      list: [
        {
          id: "main",
          default: true,
          name: "Maya",
          workspace: "/data/workspace",
          model: mainModel,
          subagents: { allowAgents: allowFromMain },
          tools: { profile: "coding" },
        },
        {
          id: "hard_research_beta",
          name: "Hard Research Beta",
          workspace: "/data/workspace",
          model: hardModel,
          subagents: { allowAgents: [] },
          tools: { profile: "coding" },
        },
        ...SUBAGENTS.map((s) => ({
          ...s,
          workspace: "/data/workspace",
        })),
      ],
    },
    plugins: {
      // Sprint 2.16j — restrictive allowlist per external-architect
      // recommendation. `plugins.allow` is deny-by-default: any plugin
      // not listed here cannot load (and therefore cannot install
      // runtime deps). This is the canonical OpenClaw way to skip
      // unused channel/voice/microsoft-style plugins entirely.
      //
      // Why not just plugins.entries.<id>.enabled: false? Known
      // OpenClaw bug (issue against 2026.4.22): doctor-bundled-plugin-
      // runtime-deps still installed disabled-channel dependencies via
      // a health path that forced includeConfiguredChannels: true.
      //
      // Plugin IDs verified against /tmp/openclaw-source plugin
      // registry (grep "pluginId:") — only the ones actually
      // registered as plugins. cron/taskflow/hooks/run/openrouter
      // are built-in subsystems, NOT plugins, so don't need allowing.
      // (openrouter auto-enables via model config; verified by reading
      // /data/openclaw.json after gateway start.)
      allow: ["telegram"],
      entries: {
        // Keep telegram explicitly enabled. Channel-config in
        // `channels.telegram` (lower in this config) does the actual
        // dmPolicy + allowFrom wiring; this just confirms enablement.
        telegram: { enabled: true },
      },
    },
    // Sprint 2.16j — enable internal hook runtime so BOOT.md fires
    // on gateway startup as a real native primitive (not just a
    // workspace file Maya happens to read). BOOT.md owns the hello;
    // the 0001_gtm_first_research cron owns the research dispatch.
    // Splitting the two stops the model from satisficing after STEP 1
    // of a single dense 6-step prompt.
    //
    // `hooks` is a TOP-LEVEL config key per OpenClaw 2026.4.23 zod
    // schema (sibling of `gateway`, `agents`, `plugins`) — NOT a key
    // under `agents.defaults`. The first 2.16j deploy attempt placed
    // it under `agents.defaults` and the gateway rejected the config
    // with "agents.defaults: Unrecognized key: hooks".
    hooks: {
      internal: {
        enabled: true,
      },
    },
    // Sprint 1.3 — native OpenClaw Telegram channel. Without this block
    // OpenClaw boots with 0 channels and `delivery: { channel: telegram }`
    // is a no-op. With it, cron jobs that fire `mode: announce, channel:
    // telegram, to: <chatId>` deliver via the bot token (read from
    // TELEGRAM_BOT_TOKEN env). dmPolicy allowlist scoped to the paired
    // user means inbound DMs from any other Telegram user are dropped —
    // critical when multiple Mayas share the same staging bot token.
    // Pre-pairing creators (no telegramChatId yet) get the channel
    // OMITTED — cleanest behavior since handoff/heartbeat code already
    // checks for telegramChatId presence before scheduling delivery.
    ...(input.telegramChatId
      ? {
          channels: {
            telegram: {
              enabled: true,
              dmPolicy: "allowlist" as const,
              allowFrom: [Number(input.telegramChatId)].filter(Number.isFinite),
            },
          },
        }
      : {}),
    discovery: { mdns: { mode: "off" } },
    skills: { load: { watch: true } },
  };
}

function buildMemorySearchConfig(): Record<string, unknown> {
  const geminiKey =
    process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!geminiKey) {
    return { enabled: false };
  }

  return {
    enabled: true,
    provider: "gemini",
    model: "gemini-embedding-001",
    outputDimensionality: 768,
    fallback: "none",
    store: {
      path: "/data/openclaw-memory/{agentId}.sqlite",
      vector: { enabled: true },
      fts: { tokenizer: "unicode61" },
    },
    query: {
      maxResults: 8,
      minScore: 0.25,
      hybrid: {
        enabled: true,
        vectorWeight: 0.65,
        textWeight: 0.35,
        temporalDecay: { enabled: true, halfLifeDays: 45 },
      },
    },
    sync: {
      onSessionStart: true,
      onSearch: true,
      watch: true,
      intervalMinutes: 30,
      sessions: {
        deltaBytes: 100000,
        deltaMessages: 50,
        postCompactionForce: true,
      },
    },
  };
}

export const getGtmAgentForDeploy = internalQuery({
  args: { agentId: v.id("gtmAgents") },
  handler: async (
    ctx,
    args
  ): Promise<{
    agent: Doc<"gtmAgents">;
    creator: Pick<Doc<"creators">, "_id" | "email">;
    app: Doc<"gtmApps">;
    channelScores: Doc<"gtmChannelScores">[];
  } | null> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return null;
    const creator = await ctx.db.get(agent.accountId);
    if (!creator || creator.accountType !== "gtm-agent") return null;
    if (!agent.appId) return null;
    const app = await ctx.db.get(agent.appId);
    if (!app || app.accountId !== creator._id) return null;
    const latestJob = await ctx.db
      .query("gtmResearchJobs")
      .withIndex("by_app", (q) => q.eq("appId", app._id))
      .collect()
      .then((jobs) => jobs.sort((a, b) => b.createdAt - a.createdAt)[0]);
    const channelScores = latestJob
      ? await ctx.db
          .query("gtmChannelScores")
          .withIndex("by_research_job", (q) =>
            q.eq("researchJobId", latestJob._id)
          )
          .collect()
      : [];
    return {
      agent,
      creator: { _id: creator._id, email: creator.email },
      app,
      channelScores,
    };
  },
});

export const patchGtmAgentOnDeploySuccess = internalMutation({
  args: {
    agentId: v.id("gtmAgents"),
    openClawFlyAppId: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const now = Date.now();
    await ctx.db.patch(args.agentId, {
      openClawFlyAppId: args.openClawFlyAppId,
      deployedAt: now,
      onboardingStep: "active",
      updatedAt: now,
    });
  },
});

/**
 * Sprint 2.14a.6 — trace Sprint 2.11 deploy-time hello attempts.
 * Always called after sendDirectTelegramMessage so we know:
 *   - was the code path reached (attemptedAt set)
 *   - what was the result (sent / firewall_blocked / etc)
 *   - what was the Telegram message_id on success
 */
export const recordDeployTimeHelloResult = internalMutation({
  args: {
    agentId: v.id("gtmAgents"),
    result: v.string(),
    messageId: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<void> => {
    const now = Date.now();
    await ctx.db.patch(args.agentId, {
      deployTimeHelloAttemptedAt: now,
      deployTimeHelloResult: args.result.slice(0, 200),
      deployTimeHelloMessageId: args.messageId,
      updatedAt: now,
    });
  },
});

/**
 * Sprint 16 — provision (or rotate) the per-agent hookToken before the
 * workspace bundle is built. The token is the shared secret between the
 * Convex deployment and the agent's OpenClaw gateway. Returns the freshly
 * provisioned token so the caller can template it into the workspace
 * config; subsequent re-builds read it from the gtmAgents row.
 */
export const ensureGtmAgentHookToken = internalMutation({
  args: { agentId: v.id("gtmAgents") },
  handler: async (ctx, args): Promise<string> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) throw new Error(`gtmAgent ${args.agentId} not found`);
    if (agent.hookToken && agent.hookToken.length >= 32) {
      return agent.hookToken;
    }
    const token = mintHookToken();
    await ctx.db.patch(args.agentId, {
      hookToken: token,
      updatedAt: Date.now(),
    });
    return token;
  },
});

export const buildAndUploadGtmWorkspace = internalAction({
  args: { agentId: v.id("gtmAgents") },
  handler: async (
    ctx,
    args
  ): Promise<{ flyAppName: string; workspaceBundleUrl: string }> => {
    const row = await ctx.runQuery(
      internal.onboarding.gtm.deployMayaGtm.getGtmAgentForDeploy,
      { agentId: args.agentId }
    );
    if (!row) throw new Error(`GTM agent ${args.agentId} not deployable.`);

    // Sprint 16 — provision hookToken before bundling so cron.hooks.token
    // can be templated into openclaw.json. Idempotent — re-builds keep
    // the same token.
    const hookToken = await ctx.runMutation(
      internal.onboarding.gtm.deployMayaGtm.ensureGtmAgentHookToken,
      { agentId: args.agentId }
    );

    const { files } = buildMayaGtmWorkspace({
      accountEmail: row.creator.email,
      timezone: row.agent.timezone,
      app: {
        name: row.app.name ?? "Untitled app",
        url: row.app.url,
        stage: row.app.stage,
        weekGoal: row.app.weekGoal,
        founderWhy: row.app.founderWhy,
        canRecordScreen: row.app.canRecordScreen,
        canShowFace: row.app.canShowFace,
        canRecordVoice: row.app.canRecordVoice,
        canProvideScreenshots: row.app.canProvideScreenshots,
        canPostTikTokManually: row.app.canPostTikTokManually,
        canPostInstagramManually: row.app.canPostInstagramManually,
        existingTikTokUrl: row.app.existingTikTokUrl,
        existingInstagramUrl: row.app.existingInstagramUrl,
        tiktokWarmupState: row.app.tiktokWarmupState,
        tiktokAccountAgeDays: row.app.tiktokAccountAgeDays,
        tiktokAccountStatusChecked: row.app.tiktokAccountStatusChecked,
        openToUgcCreators: row.app.openToUgcCreators,
        creatorBudgetMonthlyUsd: row.app.creatorBudgetMonthlyUsd,
        maxWeeklyVisualPosts: row.app.maxWeeklyVisualPosts,
        excludedAudiences: row.app.excludedAudiences,
      },
      primaryChannel: row.channelScores.find((s) => s.decision === "primary")
        ?.channel,
      secondaryChannel: row.channelScores.find((s) => s.decision === "secondary")
        ?.channel,
      // Sprint 14 — native cron delivery target. When the user has paired
      // Telegram (Sprint 15), every cron's delivery envelope becomes
      // `mode: "announce", channel: "telegram", to: <chatId>`. Pre-pairing
      // falls back to mode:none so the workspace bundle is still
      // generatable mid-onboarding.
      telegramChatId: row.agent.telegramChatId,
      channelPreference: row.agent.channelPreference,
      deliveryFailureDestination: resolveDeliveryFailureUrl(),
      // Sprint 16 — Convex ↔ Maya hook bridge configuration. The
      // workspace generator templates these into openclaw.json so the
      // gateway exposes /hooks/{agent,wake} and Maya's TOOLS.md knows
      // where to POST /lc_gtm/* callbacks.
      hookToken,
      convexHookCallbackUrl: resolveConvexHookCallbackBaseUrl(),
    });
    const tarBytes = buildPosixTar(files);
    const tarBuffer = tarBytes.buffer.slice(
      tarBytes.byteOffset,
      tarBytes.byteOffset + tarBytes.byteLength
    ) as ArrayBuffer;
    const storage = await ctx.storage.store(
      new Blob([tarBuffer], { type: "application/x-tar" })
    );
    const url = (await ctx.storage.getUrl(storage)) ?? "";
    if (!url) throw new Error("Convex storage returned empty workspace URL.");
    return {
      flyAppName: flyAppNameForGtmAgent(args.agentId),
      workspaceBundleUrl: url,
    };
  },
});

export const deployMayaGtm = internalAction({
  args: { agentId: v.id("gtmAgents") },
  handler: async (ctx, args): Promise<DeployMayaGtmResult> => {
    const startedAt = Date.now();
    const fail = (
      stage: DeployMayaGtmStage,
      message: string,
      retryable = false
    ): DeployMayaGtmResult => ({
      ok: false,
      stage,
      message,
      retryable,
      durationMs: Date.now() - startedAt,
    });

    const row = await ctx.runQuery(
      internal.onboarding.gtm.deployMayaGtm.getGtmAgentForDeploy,
      { agentId: args.agentId }
    );
    if (!row) return fail("load-agent", `GTM agent ${args.agentId} not deployable.`);

    let bundle: { flyAppName: string; workspaceBundleUrl: string };
    try {
      bundle = await ctx.runAction(
        internal.onboarding.gtm.deployMayaGtm.buildAndUploadGtmWorkspace,
        { agentId: args.agentId }
      );
    } catch (err) {
      return fail("upload-bundle", (err as Error).message);
    }

    const fly = newFlyClient();
    try {
      await fly.createApp({ appName: bundle.flyAppName });
    } catch (err) {
      if (!isAlreadyExists(err)) {
        return fail("create-app", (err as Error).message, isRetryable(err));
      }
    }

    try {
      await fly.setAppSecrets(bundle.flyAppName, collectDeploySecrets());
    } catch (err) {
      return fail("set-secrets", (err as Error).message, isRetryable(err));
    }

    let machine;
    try {
      machine = await fly.createMachine({
        appName: bundle.flyAppName,
        name: bundle.flyAppName,
        config: buildGtmMachineConfig({
          agentId: args.agentId,
          flyAppName: bundle.flyAppName,
          workspaceBundleUrl: bundle.workspaceBundleUrl,
          telegramChatId: row.agent.telegramChatId,
        }),
      });
    } catch (err) {
      return fail("create-machine", (err as Error).message, isRetryable(err));
    }

    let final = machine;
    if (machine.state !== "started") {
      try {
        final = await fly.waitForState(
          bundle.flyAppName,
          machine.id,
          "started",
          { timeoutMs: WAIT_TIMEOUT_MS, intervalMs: WAIT_INTERVAL_MS }
        );
      } catch (err) {
        return fail("wait-for-state", (err as Error).message, isRetryable(err));
      }
    }

    // Sprint 2.15.4 — RESTORED Sprint 2.11 deploy-time hello.
    //
    // Live 2026-05-25 testing: the Sprint 2.15 architecture (Maya's
    // boot_phase_1 cron sends the first message instead of Convex)
    // is blocked by preseed-loading bugs we haven't fully diagnosed
    // — boot_phase_1 hangs for 15+ min in some deploys. Pro product
    // needs sub-30-sec confirmation that Maya is alive.
    //
    // For now: send the hardcoded Convex-side hello AT deploy time.
    // Maya's boot cron still fires + sends her own research-backed
    // message later, but operator gets immediate confirmation. The
    // dual-message pattern is acceptable as a temporary fix until
    // Sprint 2.16 (event-driven Maya-authored fast hello).
    //
    // recordDeployTimeHelloResult is still called for the trace
    // breadcrumb (Sprint 2.14a.6).
    // Sprint 2.16f — deploy-time Telegram hello deleted. Maya now owns
    // her own greeting via STEP 1 of the boot prompt — within ~2 min of
    // wake she POSTs an introductory voice-clean message to
    // /lc_gtm/send_update. Having Convex send a hardcoded hello AND
    // Maya send hers led to duplicate "Hey Josh" messages + confused
    // expectations. Maya's hello is also research-aware (says what
    // she's about to do), so it's strictly better.
    await ctx.runMutation(
      internal.onboarding.gtm.deployMayaGtm.recordDeployTimeHelloResult,
      { agentId: args.agentId, result: "skipped:maya_owns_hello_in_boot_prompt" }
    );

    try {
      await ctx.runMutation(
        internal.onboarding.gtm.deployMayaGtm.patchGtmAgentOnDeploySuccess,
        {
          agentId: args.agentId,
          openClawFlyAppId: bundle.flyAppName,
        }
      );
    } catch (err) {
      return fail("patch-agent", (err as Error).message, true);
    }

    return {
      ok: true,
      stage: "complete",
      flyAppId: bundle.flyAppName,
      machineId: final.id,
      durationMs: Date.now() - startedAt,
    };
  },
});

export const runMyGtmDeploy = action({
  args: {},
  handler: async (ctx: ActionCtx): Promise<DeployMayaGtmResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return {
        ok: false,
        stage: "load-agent",
        message: "runMyGtmDeploy: signed-in Clerk user required.",
        retryable: false,
        durationMs: 0,
      };
    }
    const creator = await ctx.runQuery(internal.gtmMaya.researchLifecycle.getGtmCreatorForDeploy, {
      clerkUserId: identity.subject,
    });
    if (!creator?.agentId) {
      return {
        ok: false,
        stage: "load-agent",
        message: "runMyGtmDeploy: no GTM agent row for signed-in user.",
        retryable: false,
        durationMs: 0,
      };
    }
    return await ctx.runAction(internal.onboarding.gtm.deployMayaGtm.deployMayaGtm, {
      agentId: creator.agentId,
    });
  },
});

export function buildGtmMachineConfig(input: {
  agentId: Id<"gtmAgents"> | string;
  flyAppName: string;
  workspaceBundleUrl: string;
  /** Sprint 1.3 — passed through to buildGatewayConfig so the OpenClaw
   *  channels.telegram adapter is enabled with allowlist scoped to this
   *  user. Pre-pairing agents pass undefined; the channel is omitted. */
  telegramChatId?: string;
}): FlyMachineConfig {
  return {
    image: OPENCLAW_IMAGE,
    env: {
      OPENCLAW_STATE_DIR: "/data",
      OPENCLAW_CONFIG_PATH: "/data/openclaw.json",
      // Sprint 2.14a.8 — point OpenClaw at the pre-installed
      // pi-coding-agent + Bedrock SDK + companions baked into the
      // Docker image at /opt/openclaw-runtime-preseed (Dockerfile
      // lines 62-80). Without this, OpenClaw npm-installs the deps
      // on first agent turn — observed ~28 min cold-start latency
      // live on 2026-05-25 that triggered the 12-min LLM timeout.
      // The creator-product deployMaya.ts uses the same env var
      // (line 295).
      OPENCLAW_PLUGIN_STAGE_DIR: "/opt/openclaw-runtime-preseed/plugin-runtime-deps",
      // Sprint 2.15.5 — REVERTED OPENCLAW_PREFER_PNPM. Operator
      // verified live 2026-05-25 that the prior deploys (before this
      // env var) worked. Adding PREFER_PNPM correlates with Fly
      // machine getting stuck in "created" state and never reaching
      // "started" within the deployMayaGtm 180s wait window. Best
      // guess: the env var changes OpenClaw's package-manager
      // selection in a way that affects gateway bind/startup timing.
      // Diagnostic deferred to Sprint 2.16; for now stick with what
      // works.
      MAYA_GTM_AGENT_ID: String(input.agentId),
      MAYA_GTM_APP_NAME: input.flyAppName,
      MAYA_WORKSPACE_BUNDLE_URL: input.workspaceBundleUrl,
      OPENCLAW_MODEL: toOpenClawModelRef(MODEL_ROUTING.mainMaya),
      OPENCLAW_DISABLE_BONJOUR: "1",
      MAYA_GTM_MODEL_ROUTING_JSON: JSON.stringify(MODEL_ROUTING),
      MAYA_BOOTSTRAP_JSON: JSON.stringify({
        agentId: String(input.agentId),
        product: "clawlaunch-gtm",
        flyAppName: input.flyAppName,
        workspaceBundleUrl: input.workspaceBundleUrl,
        modelRouting: MODEL_ROUTING,
        directPingSmoke: true,
        gatewayConfig: buildGatewayConfig({
          telegramChatId: input.telegramChatId,
        }),
      }),
    },
    guest: MACHINE_GUEST,
    restart: { policy: "always" },
    // Sprint 1.3 follow-up — services block intentionally omitted. OpenClaw
    // gateway binds to 127.0.0.1:18789 by default (per creator-product
    // deployMaya.ts:353-361); enabling public Fly routing requires both
    // `--bind lan` AND `gateway.controlUi.allowedOrigins` in the config.
    // The creator team deferred that to a follow-up wave. We do the same
    // here — the days-on-days test uses the cron + heartbeat path (Maya
    // fires from inside her own machine via OpenClaw cron daemon, then
    // delivers via channels.telegram). Convex → Maya HTTP push remains
    // a known-broken path until --bind lan + allowedOrigins land.
    metadata: {
      agent_id: String(input.agentId),
      kind: "maya-gtm",
      schema_version: "1",
    },
    init: {
      cmd: ["/bin/sh", "-c", buildBootstrapShell()],
    },
  };
}

export function flyAppNameForGtmAgent(agentId: Id<"gtmAgents"> | string): string {
  const short = String(agentId)
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase()
    .slice(0, 18);
  return `clawlaunch-${short}`;
}

function buildBootstrapShell(): string {
  return [
    "mkdir -p /data/workspace /data/cron",
    'curl -fsSL "$MAYA_WORKSPACE_BUNDLE_URL" -o /tmp/workspace.tar',
    // Sprint 1.4 diagnostic — capture workspace state at every stage so we
    // can see when files vanish. Bug observed 2026-05-24: 6 of 12 root .md
    // files (AGENTS, APP, GTM, BOOT, HEARTBEAT, DREAMING) disappear between
    // tar-extract and openclaw startup; manually re-extracting after gateway
    // is up restores them. Hypothesis: race between tar-extract and
    // openclaw's own workspace initialization.
    'echo "[bootstrap] tar size: $(wc -c < /tmp/workspace.tar)"',
    "tar -xf /tmp/workspace.tar -C /data/workspace",
    'echo "[bootstrap] post-tar root files:" && ls /data/workspace/ | sort | tr "\\n" " " && echo',
    // Sprint 1.4 defensive — re-extract a second time after a 1s pause to
    // overwrite any files that vanished. tar's default is to overwrite, so
    // this is safe if all 12 files survived the first extract.
    "sleep 1",
    "tar -xf /tmp/workspace.tar -C /data/workspace",
    'echo "[bootstrap] post-reextract root files:" && ls /data/workspace/ | sort | tr "\\n" " " && echo',
    "if [ -f /data/workspace/jobs.json ]; then cp /data/workspace/jobs.json /data/cron/jobs.json; fi",
    "chmod 700 /data/cron",
    "chmod 600 /data/cron/jobs.json",
    'echo "$MAYA_BOOTSTRAP_JSON" | jq .gatewayConfig > /data/openclaw.json',
    'echo "[bootstrap] launching openclaw gateway..."',
    "exec openclaw gateway --allow-unconfigured",
  ].join(" && ");
}

function collectDeploySecrets(): Record<string, string> {
  const secrets: Record<string, string> = {};
  for (const key of [
    "CONVEX_URL",
    "CONVEX_SITE_URL",
    "COMPOSIO_API_KEY",
    "SCRAPE_CREATORS_API_KEY",
    "SCRAPECREATORS_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "OPENROUTER_API_KEY",
    "ENCRYPTION_KEY",
    // Sprint 1.3 — without TELEGRAM_BOT_TOKEN reaching the Fly machine,
    // OpenClaw's native channels.telegram adapter can't authenticate and
    // delivery silently fails (cron's `delivery.mode: announce, channel:
    // telegram` drops with no recipient). Verified live 2026-05-24:
    // synth Maya booted with 0 channels because token wasn't propagated.
    "TELEGRAM_BOT_TOKEN",
    // Sprint 1.1 — TwitterAPI.io is now the X keyword-search backend (the
    // Convex-side wrapper calls it from researchWorker, but Maya's runtime
    // skills may also reference it via the kaitoInfra/twitterapi-io skill
    // once pinned, so secret needs to be available on the machine too).
    "TWITTERAPI_IO_KEY",
    "APIFY_API_TOKEN",
  ]) {
    const value = process.env[key];
    if (value) secrets[key] = value;
  }
  if (!secrets.SCRAPE_CREATORS_API_KEY && process.env.SCRAPECREATORS_API_KEY) {
    secrets.SCRAPE_CREATORS_API_KEY = process.env.SCRAPECREATORS_API_KEY;
  }
  if (!secrets.SCRAPECREATORS_API_KEY && process.env.SCRAPE_CREATORS_API_KEY) {
    secrets.SCRAPECREATORS_API_KEY = process.env.SCRAPE_CREATORS_API_KEY;
  }
  if (!secrets.GEMINI_API_KEY && process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    secrets.GEMINI_API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  }
  if (!secrets.GOOGLE_GENERATIVE_AI_API_KEY && process.env.GEMINI_API_KEY) {
    secrets.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GEMINI_API_KEY;
  }
  return secrets;
}

function toOpenClawModelRef(model: string): string {
  if (model.includes("/")) {
    return model.startsWith("openrouter/") ? model : `openrouter/${model}`;
  }
  return model;
}

function buildPosixTar(files: Map<string, string>): Uint8Array {
  const enc = new TextEncoder();
  const blocks: Uint8Array[] = [];
  for (const [name, content] of files) {
    const data = enc.encode(content);
    blocks.push(buildTarHeader(name, data.length));
    blocks.push(data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad > 0) blocks.push(new Uint8Array(pad));
  }
  blocks.push(new Uint8Array(1024));
  let total = 0;
  for (const block of blocks) total += block.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const block of blocks) {
    out.set(block, offset);
    offset += block.length;
  }
  return out;
}

function buildTarHeader(name: string, size: number): Uint8Array {
  const buf = new Uint8Array(512);
  const enc = new TextEncoder();
  const writeAscii = (value: string, offset: number, len: number): void => {
    const bytes = enc.encode(value);
    buf.set(bytes.subarray(0, Math.min(bytes.length, len)), offset);
  };
  if (name.length > 100) {
    throw new Error(`filename too long for USTAR: ${name}`);
  }
  writeAscii(name, 0, 100);
  writeAscii("0000644", 100, 7);
  writeAscii("0000000", 108, 7);
  writeAscii("0000000", 116, 7);
  writeAscii(size.toString(8).padStart(11, "0"), 124, 11);
  writeAscii("00000000000", 136, 11);
  for (let i = 148; i < 156; i++) buf[i] = 0x20;
  writeAscii("0", 156, 1);
  writeAscii("ustar", 257, 5);
  writeAscii("00", 263, 2);
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += buf[i];
  writeAscii(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
  return buf;
}

let __injectedFlyClient: FlyClient | null = null;
export function __setMayaGtmFlyClient(client: FlyClient | null): void {
  __injectedFlyClient = client;
}

function newFlyClient(): FlyClient {
  if (__injectedFlyClient) return __injectedFlyClient;
  return new FlyClient();
}

function isAlreadyExists(err: unknown): boolean {
  if (!(err instanceof FlyError)) return false;
  if (err.status !== 422 && err.status !== 409) return false;
  const text = (err.body ?? "").toLowerCase();
  return text.includes("already") || text.includes("exists") || text.includes("taken");
}

function isRetryable(err: unknown): boolean {
  if (err instanceof FlyError) return err.retryable;
  return false;
}
