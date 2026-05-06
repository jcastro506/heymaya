/**
 * deployMaya — Sprint 3.7 phase C single-agent OpenClaw deploy variant.
 *
 * Pipeline:
 *   1. Generate the bootstrap config (configGeneratorMaya). The workspace
 *      tarball is uploaded to Convex storage INSIDE that action and the URL
 *      is already patched onto `config.workspaceBundleUrl` on return — no
 *      `Uint8Array` ever crosses the action boundary (Convex's value
 *      serializer rejects it).
 *   2. Ensure the Fly app exists (createApp on first deploy; ignored on
 *      re-deploy).
 *   3. Push secrets (per-creator + shared platform secrets) — including the
 *      MAYA_BOOTSTRAP_JSON secret carrying the full config.
 *   4. Create the machine with the OpenClaw image and a one-liner
 *      `init.cmd` that downloads the workspace, installs jobs.json, and
 *      starts the gateway.
 *   5. Poll for `started` state up to 60s.
 *   6. On success: patch `creators.{mayaFlyAppId, mayaConfigVersion, status:"active"}`.
 *   7. On failure: patch `creators.status` to a failure state and return a
 *      structured error. Never throw — the onboarding UX needs to render the
 *      failure inline.
 *
 * Cross-tenant safety:
 *   - All reads / writes filter by `creatorId`.
 *   - The Fly app name is derived from the creator id only (`maya-{shortId}`).
 *   - We never reuse another creator's machine.
 *
 * Plan-tier enforcement:
 *   - configGeneratorMaya does the gating. By the time deployMaya runs, the
 *     gateway channel allowlist + composio accounts + jobs.json are already
 *     plan-correct.
 *   - We additionally verify the gateway config we ship reflects only allowed
 *     channels (belt-and-suspenders).
 */

import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import {
  FlyClient,
  FlyError,
  type FlyMachine,
  type FlyMachineConfig,
} from "../../lib/flyClient";
import type {
  MayaConfig,
  MayaConfigDeployBundle,
} from "../../agents/packs/maya/configGeneratorMaya";
import { planFeatures } from "../../lib/planFeatures";
import type { Channel } from "../../lib/planFeatures";

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

export type DeployMayaResult =
  | {
      ok: true;
      flyAppId: string;
      machineId: string;
      configVersion: string;
      machineState: string;
      durationMs: number;
    }
  | {
      ok: false;
      stage: DeployStage;
      message: string;
      retryable: boolean;
      durationMs: number;
    };

export type DeployStage =
  | "scrape-pull"
  | "synthesize-picture"
  | "generate-config"
  | "create-app"
  | "set-secrets"
  | "create-machine"
  | "wait-for-state"
  | "patch-creator";

export interface DeployMayaArgs {
  creatorId: Id<"creators">;
}

/* -------------------------------------------------------------------------- */
/* Internal mutations                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Patch the creator row with deploy success metadata. Bumps `mayaConfigVersion`
 * via a small counter (we bucket by hash → small int). The full hash lives in
 * the deploy log (Sprint 7).
 */
export const patchCreatorOnSuccess = internalMutation({
  args: {
    creatorId: v.id("creators"),
    mayaFlyAppId: v.string(),
  },
  handler: async (ctx, args) => {
    const creator = await ctx.db.get(args.creatorId);
    if (!creator) {
      throw new Error(
        `patchCreatorOnSuccess: creator ${args.creatorId} not found.`
      );
    }
    const next = (creator.mayaConfigVersion ?? 0) + 1;
    await ctx.db.patch(args.creatorId, {
      mayaFlyAppId: args.mayaFlyAppId,
      mayaConfigVersion: next,
      status: "active",
    });
    return { mayaConfigVersion: next };
  },
});

/**
 * Internal query — return verified creator handles in a shape
 * `runFullScrapePull` consumes. Filters to the 5 platforms ScrapeCreators
 * supports (the broader handle table includes threads / reddit / pinterest
 * for future use, but the scraper doesn't have endpoints for them yet).
 *
 * Determinism: sorted by platform for stable test snapshots.
 */
export const listScrapableHandles = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (
    ctx,
    args
  ): Promise<
    Array<{
      platform: "tiktok" | "instagram" | "youtube" | "linkedin" | "x";
      handle: string;
    }>
  > => {
    const rows = await ctx.db
      .query("creatorHandles")
      .withIndex("by_creator", (q) => q.eq("creatorId", args.creatorId))
      .collect();
    type ScrapablePlatform =
      | "tiktok"
      | "instagram"
      | "youtube"
      | "linkedin"
      | "x";
    const scrapable: ReadonlySet<ScrapablePlatform> = new Set([
      "tiktok",
      "instagram",
      "youtube",
      "linkedin",
      "x",
    ]);
    const out: Array<{ platform: ScrapablePlatform; handle: string }> = [];
    for (const r of rows) {
      if (!scrapable.has(r.platform as ScrapablePlatform)) continue;
      out.push({ platform: r.platform as ScrapablePlatform, handle: r.handle });
    }
    out.sort((a, b) => a.platform.localeCompare(b.platform));
    return out;
  },
});

export const patchCreatorOnFailure = internalMutation({
  args: {
    creatorId: v.id("creators"),
  },
  handler: async (ctx, args) => {
    const creator = await ctx.db.get(args.creatorId);
    if (!creator) return; // idempotent — caller may already have advanced state
    if (creator.status !== "onboarding") {
      await ctx.db.patch(args.creatorId, { status: "onboarding" });
    }
  },
});

/* -------------------------------------------------------------------------- */
/* Bootstrap shape                                                             */
/* -------------------------------------------------------------------------- */

const OPENCLAW_IMAGE =
  process.env.MAYA_OPENCLAW_IMAGE ??
  "registry.fly.io/heymaya-openclaw@sha256:fc3cf7390174c94ae8aea2f31d24a5a6c2458d7226d05196adc35df47d990057";

const MACHINE_GUEST: NonNullable<FlyMachineConfig["guest"]> = {
  cpu_kind: "shared",
  cpus: 2,
  memory_mb: 2048,
};

/**
 * Render the OpenClaw bootstrap config into a Fly machine config.
 *
 * Maya's runtime reads:
 *   - MAYA_BOOTSTRAP_JSON env — the entire MayaConfig as JSON. Set as a Fly
 *     secret (not a plain env) because it contains decrypted Composio
 *     account ids.
 *   - MAYA_WORKSPACE_BUNDLE_URL env — Convex-storage URL of the workspace tarball.
 *   - MAYA_JOBS_JSON_BASE64 env — base64 of the jobs.json blob, so the
 *     bootstrap script can install crons without a second HTTP round-trip.
 *   - SCRAPE_CREATORS_API_KEY / OPENROUTER_API_KEY / COMPOSIO_API_KEY /
 *     ENCRYPTION_KEY — Fly secrets, set via setAppSecrets.
 *
 * The machine's `init.cmd` is a single bash one-liner that:
 *   1. Downloads the workspace tarball.
 *   2. Extracts to /data/workspace-${appName}/.
 *   3. Symlinks to ~/.openclaw/workspace-default/.
 *   4. Writes ~/.openclaw/cron/jobs.json from MAYA_JOBS_JSON_BASE64.
 *   5. Writes /data/openclaw.json from MAYA_BOOTSTRAP_JSON's `gatewayConfig`
 *      key.
 *   6. Starts the gateway.
 *
 * We picked an inlined init.cmd (no `bootstrap.sh` file) because the existing
 * FlyClient already supports `init.cmd` and adding a script-template-and-base64
 * round-trip would add complexity for no upside at our scale.
 */
export function machineConfigFor(
  config: MayaConfig,
  jobsJsonBase64: string
): FlyMachineConfig {
  const env: Record<string, string> = {
    OPENCLAW_DISABLE_BONJOUR: "1",
    OPENCLAW_CONFIG_PATH: "/data/openclaw.json",
    OPENCLAW_PREFER_PNPM: "1",
    OPENCLAW_PLUGIN_STAGE_DIR: "/opt/openclaw-runtime-preseed/plugin-runtime-deps",
    OPENCLAW_SKIP_CRON: "1",
    OPENCLAW_STATE_DIR: "/data",
    NODE_OPTIONS: "--max-old-space-size=1536 --dns-result-order=ipv4first",
    MAYA_PLAN: config.plan,
    MAYA_TIMEZONE: config.timezone,
    MAYA_OPENCLAW_VERSION: config.openclawVersion,
    MAYA_CONVEX_HTTP_BASE: config.modelRouter.convexHttpBase,
    MAYA_WORKSPACE_BUNDLE_URL: config.workspaceBundleUrl,
    MAYA_JOBS_JSON_BASE64: jobsJsonBase64,
    MAYA_APP_NAME: config.appName,
  };

  return {
    image: OPENCLAW_IMAGE,
    env,
    guest: MACHINE_GUEST,
    restart: { policy: "always" },
    metadata: {
      creator_id: config.creatorId,
      plan: config.plan,
      schema_version: String(config.schemaVersion),
    },
    init: {
      cmd: ["/bin/sh", "-c", buildBootstrapShell()],
    },
  };
}

/**
 * The one-liner `init.cmd` shell pipeline. Single string so the lead can
 * eyeball + copy/paste into a Fly machine for ad-hoc verification.
 *
 * Assumes `tar`, `curl`, `base64`, `jq`, `mkdir`, `ln` are present (standard
 * Alpine/Debian base; the OpenClaw image ships them).
 *
 * Steps run sequentially via `&&` — any failure aborts the boot, Fly retries
 * per `restart.policy = "always"`.
 */
function buildBootstrapShell(): string {
  return [
    // 0. Ignore stale app-level Telegram secrets on redeployed creator apps.
    // Creator Maya is iMessage-only for this flow; OpenClaw auto-enables
    // Telegram when these env vars exist.
    "unset TELEGRAM_BOT_TOKEN TELEGRAM_BOT_USERNAME",
    // 1. Make persistent state, workspace, plugin, and cron dirs.
    "mkdir -p /data/workspace /data/extensions /data/cron /data/identity",
    // 2. Seed image-bundled channel plugins onto the mounted volume.
    "if [ -d /opt/openclaw-seed/extensions/claw-messenger ]; then rm -rf /data/extensions/claw-messenger && cp -a /opt/openclaw-seed/extensions/claw-messenger /data/extensions/claw-messenger; fi",
    // 2a. Provider runtime deps are preseeded in the image and read via
    // OPENCLAW_PLUGIN_STAGE_DIR, so boot avoids a large persistent-volume copy.
    // 2b. Compatibility fallback for @emotion-machine/claw-messenger 0.1.8
    // on OpenClaw 2026.4.23. The runtime image already applies this patch;
    // this guard keeps existing machines correct until every image is rebuilt.
    'node -e \'const fs=require("fs");const p="/data/extensions/claw-messenger/dist/channel.js";if(fs.existsSync(p)){let s=fs.readFileSync(p,"utf8");s=s.replace("import { buildChannelConfigSchema, DEFAULT_ACCOUNT_ID, formatPairingApproveHint, PAIRING_APPROVED_MESSAGE, } from \\"openclaw/plugin-sdk\\";","import { buildChannelConfigSchema, formatPairingApproveHint, PAIRING_APPROVED_MESSAGE, } from \\"openclaw/plugin-sdk\\";\\nconst DEFAULT_ACCOUNT_ID = \\"default\\";").replace("            const resolvedAccountId = account.accountId;","            const resolvedAccountId = account.accountId ?? DEFAULT_ACCOUNT_ID;\\n            account.accountId = resolvedAccountId;");fs.writeFileSync(p,s);}\'',
    // 3. Download + extract the workspace tarball.
    'curl -fsSL "$MAYA_WORKSPACE_BUNDLE_URL" -o /tmp/workspace.tar',
    "tar -xf /tmp/workspace.tar -C /data/workspace",
    // 4. Install cron jobs from base64-encoded env.
    'echo "$MAYA_JOBS_JSON_BASE64" | base64 -d > /data/cron/jobs.json',
    // 5. Materialize the gateway config from MAYA_BOOTSTRAP_JSON.
    'echo "$MAYA_BOOTSTRAP_JSON" | jq .gatewayConfig > /data/openclaw.json',
    // 6. Add runtime-only gateway auth from Fly secrets when configured.
    'if [ -n "${OPENCLAW_GATEWAY_TOKEN:-${MAYA_RUNTIME_SECRET:-}}" ]; then token="${OPENCLAW_GATEWAY_TOKEN:-$MAYA_RUNTIME_SECRET}"; jq --arg token "$token" \'.gateway.auth = { mode: "token", token: $token }\' /data/openclaw.json > /tmp/openclaw.json && mv /tmp/openclaw.json /data/openclaw.json; fi',
    // 7. Start the gateway from our generated config and isolated state dir.
    "exec openclaw gateway --bind lan --tailscale off --port 3000",
  ].join(" && ");
}

/**
 * Shared infra secrets that every Maya machine needs. Per-creator secrets
 * (composio account ids) ride inside MAYA_BOOTSTRAP_JSON, decrypted at
 * config-generation time. We add MAYA_BOOTSTRAP_JSON itself as a secret here
 * so it never leaks into Fly's plain env (which is observable via the API).
 *
 * Channel-specific credentials are only forwarded when that channel is enabled
 * in the generated gateway config. Creator Maya currently uses Claw Messenger
 * for iMessage; Telegram is intentionally not enabled for this flow.
 */
function buildSecretsBundle(config: MayaConfig): Record<string, string> {
  const out: Record<string, string> = {
    MAYA_BOOTSTRAP_JSON: JSON.stringify(config),
  };
  for (const k of [
    "SCRAPE_CREATORS_API_KEY",
    "OPENROUTER_API_KEY",
    "COMPOSIO_API_KEY",
    "ENCRYPTION_KEY",
    "MAYA_RUNTIME_SECRET",
    "CLAW_MESSENGER_API_KEY",
    "OPENCLAW_GATEWAY_TOKEN",
  ]) {
    const v = process.env[k];
    if (v) out[k] = v;
  }
  if (!out.OPENCLAW_GATEWAY_TOKEN && process.env.MAYA_RUNTIME_SECRET) {
    out.OPENCLAW_GATEWAY_TOKEN = process.env.MAYA_RUNTIME_SECRET;
  }
  return out;
}

/**
 * Base64-encode a UTF-8 string. Convex actions run on V8; we use the standard
 * `btoa` after explicit UTF-8 encoding (since `btoa` is latin-1-only).
 */
function base64UtfEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/* -------------------------------------------------------------------------- */
/* Main action                                                                 */
/* -------------------------------------------------------------------------- */

const WAIT_TIMEOUT_MS = 120_000;
const WAIT_INTERVAL_MS = 1_500;

export const deployMaya = internalAction({
  args: {
    creatorId: v.id("creators"),
  },
  handler: async (ctx, args): Promise<DeployMayaResult> => {
    const startedAt = Date.now();

    // Stage: scrape-pull — bulk-fetch profile + last 30 posts per platform
    // for every verified creatorHandle. Idempotent: if the cache is fresh
    // (TTLs in convex/integrations/scrapeCreators/cache.ts) the call short-
    // circuits per-row. The synthesizer below reads from that cache.
    //
    // Wave 3 (2026-04-26): the bulk pull is typically pre-fired during
    // onboarding from HandlesStep via `kickoffBulkPullJob`. By the time
    // deploy runs, the cache is already warm and the corresponding
    // onboardingJobs row is `done`. We check for that here and SKIP the
    // inline pull when it's done. When it's still running we wait briefly;
    // when there's no pre-fired job (legacy / redeploy / no handles) we
    // fall back to the inline pull just like before.
    //
    // Empty handles → skip silently and let the synthesizer surface "no
    // scraped data" — happens for redeploys where the handle list shifted.
    let handlesForPull: Array<{
      platform: "tiktok" | "instagram" | "youtube" | "linkedin" | "x";
      handle: string;
    }> = [];
    try {
      handlesForPull = await ctx.runQuery(
        internal.onboarding.maya.deployMaya.listScrapableHandles,
        { creatorId: args.creatorId }
      );
    } catch (err) {
      await ctx.runMutation(
        internal.onboarding.maya.deployMaya.patchCreatorOnFailure,
        { creatorId: args.creatorId }
      );
      return failure(
        "scrape-pull",
        `deployMaya: failed to list handles: ${(err as Error).message}`,
        false,
        startedAt
      );
    }
    if (handlesForPull.length > 0) {
      const skipPull = await isPreDoneJob(
        ctx,
        args.creatorId,
        "bulk-pull",
        startedAt
      );
      if (skipPull.kind === "abort") {
        await ctx.runMutation(
          internal.onboarding.maya.deployMaya.patchCreatorOnFailure,
          { creatorId: args.creatorId }
        );
        return failure(
          "scrape-pull",
          skipPull.message,
          skipPull.retryable,
          startedAt
        );
      }
      if (skipPull.kind === "run-inline") {
        try {
          await ctx.runAction(
            internal.integrations.scrapeCreators.runFullScrapePull
              .runFullScrapePull,
            { creatorId: args.creatorId, handles: handlesForPull }
          );
        } catch (err) {
          await ctx.runMutation(
            internal.onboarding.maya.deployMaya.patchCreatorOnFailure,
            { creatorId: args.creatorId }
          );
          return failure(
            "scrape-pull",
            (err as Error).message,
            true,
            startedAt
          );
        }
      }
    }

    // Stage: synthesize-picture — multimodal Gemini 3 Flash @ HIGH thinking
    // produces the cited creator picture (niche / voice / hooks / cadence /
    // brand-deal history). The picture is what every workspace generator
    // (USER.md / AGENTS.md / etc.) reads to make Maya feel specific. Without
    // this, every deployed Maya gets a stub picture and feels generic.
    //
    // Wave 3: same skip/await/retry pattern as scrape-pull. If the synth job
    // was pre-fired during onboarding (typical happy path), the creatorPicture
    // row is already populated and we skip the inline call entirely. If the
    // job is still running we wait briefly. If it failed we retry inline.
    //
    // Synthesis MUST succeed before we generate the workspace bundle.
    if (handlesForPull.length > 0) {
      const skipSynth = await isPreDoneJob(
        ctx,
        args.creatorId,
        "synth-picture",
        startedAt
      );
      if (skipSynth.kind === "abort") {
        await ctx.runMutation(
          internal.onboarding.maya.deployMaya.patchCreatorOnFailure,
          { creatorId: args.creatorId }
        );
        return failure(
          "synthesize-picture",
          skipSynth.message,
          skipSynth.retryable,
          startedAt
        );
      }
      if (skipSynth.kind === "run-inline") {
        const synthResult = await ctx.runAction(
          internal.onboarding.maya.synthesizeCreatorPicture
            .synthesizeCreatorPicture,
          { creatorId: args.creatorId }
        );
        if (!synthResult.ok) {
          await ctx.runMutation(
            internal.onboarding.maya.deployMaya.patchCreatorOnFailure,
            { creatorId: args.creatorId }
          );
          return failure(
            "synthesize-picture",
            `synthesis failed at stage '${synthResult.stage}': ${synthResult.message}`,
            synthResult.retryable,
            startedAt
          );
        }
      }
    }

    // Stage: generate-config — also uploads the workspace tarball to Convex
    // storage internally and returns a config with `workspaceBundleUrl`
    // already populated. Bytes never cross the action boundary.
    let bundle: MayaConfigDeployBundle;
    try {
      bundle = await ctx.runAction(
        internal.agents.packs.maya.configGeneratorMaya.generateMayaConfig,
        { creatorId: args.creatorId }
      );
    } catch (err) {
      await ctx.runMutation(
        internal.onboarding.maya.deployMaya.patchCreatorOnFailure,
        { creatorId: args.creatorId }
      );
      return failure(
        "generate-config",
        (err as Error).message,
        false,
        startedAt
      );
    }

    // Belt-and-suspenders cross-check on plan-tier channel gating. The config
    // generator already enforces this; if a future refactor broke it, we'd
    // ship a Maya whose gateway thinks she has WhatsApp. Fail-closed.
    {
      const enabled = Object.entries(bundle.config.gatewayConfig.channels)
        .filter(([, cfg]) => cfg?.enabled)
        .map((entry): Channel => {
          const [channel] = entry;
          return channel === "claw-messenger" ? "imessage" : (channel as Channel);
        });
      const allowed = new Set(
        planFeatures({ plan: bundle.config.plan }).allowedChannels
      );
      for (const ch of enabled) {
        if (!allowed.has(ch)) {
          await ctx.runMutation(
            internal.onboarding.maya.deployMaya.patchCreatorOnFailure,
            { creatorId: args.creatorId }
          );
          return failure(
            "generate-config",
            `deployMaya: channel '${ch}' not in allowed channels for plan '${bundle.config.plan}'`,
            false,
            startedAt
          );
        }
      }
    }

    const config: MayaConfig = bundle.config;

    const fly = newFlyClient();

    // Stage: create-app (idempotent — ignore "already exists" 4xx)
    try {
      await fly.createApp({ appName: config.appName });
    } catch (err) {
      if (!isAlreadyExistsError(err)) {
        await ctx.runMutation(
          internal.onboarding.maya.deployMaya.patchCreatorOnFailure,
          { creatorId: args.creatorId }
        );
        return failure(
          "create-app",
          (err as Error).message,
          isRetryable(err),
          startedAt
        );
      }
    }

    // Stage: set-secrets — includes MAYA_BOOTSTRAP_JSON (per-creator) and
    // shared infra keys.
    try {
      const secrets = buildSecretsBundle(config);
      await fly.setAppSecrets(config.appName, secrets);
    } catch (err) {
      await ctx.runMutation(
        internal.onboarding.maya.deployMaya.patchCreatorOnFailure,
        { creatorId: args.creatorId }
      );
      return failure(
        "set-secrets",
        (err as Error).message,
        isRetryable(err),
        startedAt
      );
    }

    // Stage: create-machine
    let machine: FlyMachine;
    try {
      const jobsJsonBase64 = base64UtfEncode(JSON.stringify(config.jobsJson));
      machine = await fly.createMachine({
        appName: config.appName,
        name: config.appName,
        config: machineConfigFor(config, jobsJsonBase64),
      });
    } catch (err) {
      await ctx.runMutation(
        internal.onboarding.maya.deployMaya.patchCreatorOnFailure,
        { creatorId: args.creatorId }
      );
      return failure(
        "create-machine",
        (err as Error).message,
        isRetryable(err),
        startedAt
      );
    }

    // Stage: wait-for-state
    let final: FlyMachine = machine;
    if (machine.state !== "started") {
      try {
        final = await fly.waitForState(config.appName, machine.id, "started", {
          timeoutMs: WAIT_TIMEOUT_MS,
          intervalMs: WAIT_INTERVAL_MS,
        });
      } catch (err) {
        await ctx.runMutation(
          internal.onboarding.maya.deployMaya.patchCreatorOnFailure,
          { creatorId: args.creatorId }
        );
        return failure(
          "wait-for-state",
          (err as Error).message,
          isRetryable(err),
          startedAt
        );
      }
    }

    // Stage: patch-creator
    try {
      await ctx.runMutation(
        internal.onboarding.maya.deployMaya.patchCreatorOnSuccess,
        {
          creatorId: args.creatorId,
          mayaFlyAppId: config.appName,
        }
      );
    } catch (err) {
      // Machine is up but DB write failed — surface as failure but mark retryable.
      return failure("patch-creator", (err as Error).message, true, startedAt);
    }

    return {
      ok: true,
      flyAppId: config.appName,
      machineId: final.id,
      configVersion: bundle.version,
      machineState: final.state,
      durationMs: Date.now() - startedAt,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Public action wrapper — invoked by the onboarding UI                        */
/* -------------------------------------------------------------------------- */

/**
 * Public wrapper around `deployMaya`. Re-resolves the creator from the Clerk
 * identity inside the handler so the client cannot deploy somebody else's
 * Maya. Mirrors the cross-tenant pattern used by `verifyHandle`.
 *
 * The DeployStep onboarding UI calls this. It returns the same
 * `DeployMayaResult` discriminated union as the internal action.
 */
export const runOnboardingDeploy = action({
  args: {},
  handler: async (ctx, _args): Promise<DeployMayaResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return {
        ok: false,
        stage: "patch-creator",
        message: "runOnboardingDeploy: signed-in Clerk user required.",
        retryable: false,
        durationMs: 0,
      };
    }
    const me = await ctx.runQuery(
      internal.onboarding.maya.deployMaya.findCreatorByClerkUser,
      { clerkUserId: identity.subject }
    );
    if (!me) {
      return {
        ok: false,
        stage: "patch-creator",
        message: "runOnboardingDeploy: creators row not found for signed-in user.",
        retryable: false,
        durationMs: 0,
      };
    }
    return await ctx.runAction(
      internal.onboarding.maya.deployMaya.deployMaya,
      { creatorId: me._id }
    );
  },
});

export const findCreatorByClerkUser = internalQuery({
  args: { clerkUserId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", args.clerkUserId))
      .first();
  },
});

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

let __injectedFlyClient: FlyClient | null = null;

export function __setDeployMayaFlyClient(client: FlyClient | null): void {
  __injectedFlyClient = client;
}

function newFlyClient(): FlyClient {
  if (__injectedFlyClient) return __injectedFlyClient;
  return new FlyClient();
}

function isAlreadyExistsError(err: unknown): boolean {
  if (!(err instanceof FlyError)) return false;
  if (err.status !== 422 && err.status !== 409) return false;
  const text = (err.body ?? "").toLowerCase();
  return text.includes("already") || text.includes("exists") || text.includes("taken");
}

function isRetryable(err: unknown): boolean {
  if (err instanceof FlyError) return err.retryable;
  return false;
}

function failure(
  stage: DeployStage,
  message: string,
  retryable: boolean,
  startedAt: number
): DeployMayaResult {
  return {
    ok: false,
    stage,
    message,
    retryable,
    durationMs: Date.now() - startedAt,
  };
}

/* -------------------------------------------------------------------------- */
/* Wave 3 — pre-done job skip/wait helper                                      */
/* -------------------------------------------------------------------------- */

/**
 * Result type of `isPreDoneJob`. Drives whether deploy:
 *   - "skip"        → the pre-fired job is `done`; deploy reuses cached output
 *   - "run-inline"  → no pre-fired job exists OR it failed; deploy does the
 *                     work itself (fallback / retry path)
 *   - "abort"       → tried to wait for a running job and timed out; surface
 *                     the failure to the caller
 */
type PreDoneJobDecision =
  | { kind: "skip" }
  | { kind: "run-inline" }
  | { kind: "abort"; message: string; retryable: boolean };

/**
 * How long we're willing to block deploy waiting for a pre-fired job that
 * isn't done yet. Generous because the user might race ahead and click
 * "Deploy" 2 sec after submitting the final question.
 *
 * Bulk pull is bounded by ScrapeCreators; synth is bounded by Gemini's
 * thinking budget. Both finish in <90s in production. 5 min is a hard
 * upper bound that should never trip.
 */
const JOB_WAIT_TIMEOUT_MS = 5 * 60_000;
const JOB_WAIT_INTERVAL_MS = 1_500;

/**
 * Decide what to do with a pre-fired onboarding job at deploy time.
 *
 * Three states map to the three return shapes:
 *
 *   - No job row OR `failed` row → "run-inline". Deploy executes the stage
 *     itself (legacy / no Wave 3 / retry-after-failure path).
 *   - `done` row → "skip". Deploy reuses the cached output (creatorPicture
 *     row for synth; scrapeCreatorsCache rows for bulk-pull).
 *   - `pending` / `running` row → poll until `done`/`failed` or
 *     JOB_WAIT_TIMEOUT_MS elapses. On timeout → "abort"; on success → "skip"
 *     or "run-inline" per the final state.
 *
 * The `_startedAt` arg is the deploy's overall startedAt — we cap the wait
 * by min(remaining-from-overall-budget, JOB_WAIT_TIMEOUT_MS) so a slow
 * pre-fired job can't make deploy stall past the user's expectations.
 */
async function isPreDoneJob(
  ctx: ActionCtx,
  creatorId: Id<"creators">,
  jobType: "bulk-pull" | "synth-picture",
  _startedAt: number
): Promise<PreDoneJobDecision> {
  const initial = await ctx.runQuery(
    internal.onboarding.maya.jobs.getLatestJobForCreatorInternal,
    { creatorId, jobType }
  );
  if (!initial) return { kind: "run-inline" };
  if (initial.status === "done") return { kind: "skip" };
  if (initial.status === "failed") return { kind: "run-inline" };

  // pending / running → poll. Cap by JOB_WAIT_TIMEOUT_MS.
  const waitStart = Date.now();
  while (Date.now() - waitStart < JOB_WAIT_TIMEOUT_MS) {
    await sleep(JOB_WAIT_INTERVAL_MS);
    const latest = await ctx.runQuery(
      internal.onboarding.maya.jobs.getLatestJobForCreatorInternal,
      { creatorId, jobType }
    );
    if (!latest) return { kind: "run-inline" };
    if (latest.status === "done") return { kind: "skip" };
    if (latest.status === "failed") return { kind: "run-inline" };
  }
  return {
    kind: "abort",
    message: `deployMaya: timed out waiting for pre-fired ${jobType} job to finish (>${JOB_WAIT_TIMEOUT_MS}ms).`,
    retryable: true,
  };
}

/**
 * Tiny sleep helper — Convex actions can use plain setTimeout because they
 * run in their own request lifecycle (unlike mutations). Using await on a
 * Promise.resolve here would not actually wait.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
