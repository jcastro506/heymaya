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
  mainMaya: process.env.MAYA_GTM_MODEL ?? "google/gemini-3-flash-preview",
  hardResearchBeta:
    process.env.MAYA_GTM_HARD_RESEARCH_MODEL ??
    "openrouter/anthropic/claude-sonnet-4.5",
  futureDefaultResearch:
    process.env.MAYA_GTM_RESEARCH_MODEL ?? "google/gemini-3-flash",
  extractionWorker:
    process.env.MAYA_GTM_EXTRACTION_MODEL ?? "google/gemini-3-flash-lite",
};

const MACHINE_GUEST: NonNullable<FlyMachineConfig["guest"]> = {
  cpu_kind: "shared",
  cpus: 1,
  memory_mb: 1024,
};

const WAIT_TIMEOUT_MS = 90_000;
const WAIT_INTERVAL_MS = 3_000;

function buildGatewayConfig(): Record<string, unknown> {
  const mainModel = toOpenClawModelRef(MODEL_ROUTING.mainMaya);
  const memorySearch = buildMemorySearchConfig();
  return {
    gateway: { mode: "local" },
    agents: {
      defaults: {
        workspace: "/data/workspace",
        model: {
          primary: mainModel,
        },
        memorySearch,
        subagents: {
          maxConcurrent: 4,
          maxChildrenPerAgent: 4,
          runTimeoutSeconds: 900,
          archiveAfterMinutes: 60,
        },
      },
      list: [
        {
          id: "main",
          default: true,
          name: "Maya",
          workspace: "/data/workspace",
          model: mainModel,
          subagents: { allowAgents: ["main", "hard_research_beta"] },
          tools: { profile: "coding" },
        },
        {
          id: "hard_research_beta",
          name: "Hard Research Beta",
          workspace: "/data/workspace",
          model: toOpenClawModelRef(MODEL_ROUTING.hardResearchBeta),
          tools: { profile: "coding" },
        },
      ],
    },
    plugins: {
      entries: {
        acpx: { enabled: false },
        browser: { enabled: false },
        "device-pair": { enabled: false },
        "phone-control": { enabled: false },
        "talk-voice": { enabled: false },
      },
    },
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
}): FlyMachineConfig {
  return {
    image: OPENCLAW_IMAGE,
    env: {
      OPENCLAW_STATE_DIR: "/data",
      OPENCLAW_CONFIG_PATH: "/data/openclaw.json",
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
        gatewayConfig: buildGatewayConfig(),
      }),
    },
    guest: MACHINE_GUEST,
    restart: { policy: "always" },
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
    "tar -xf /tmp/workspace.tar -C /data/workspace",
    "if [ -f /data/workspace/jobs.json ]; then cp /data/workspace/jobs.json /data/cron/jobs.json; fi",
    "chmod 700 /data/cron",
    "chmod 600 /data/cron/jobs.json",
    'echo "$MAYA_BOOTSTRAP_JSON" | jq .gatewayConfig > /data/openclaw.json',
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
