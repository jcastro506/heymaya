/**
 * deployRiley — growth-product OpenClaw deploy orchestrator.
 *
 * Mirror of `convex/onboarding/business/deployServiceMaya.ts` adapted for
 * the riley_growth pack. Single-user product, so simpler — no plan-tier
 * gating, no voice-call plugin, no GBP-specific config. One Riley per
 * `growthAgents` row, one Fly machine.
 *
 * Reuses everything that's already shared infra:
 *   - `convex/lib/flyClient.ts`         — Fly machines API + GraphQL secrets
 *   - `registry.fly.io/heymaya-openclaw:v2026.4.23` — same OpenClaw image
 *   - POSIX USTAR tar generator         — duplicated inline (small + stable)
 *   - Bootstrap shell shape             — same OPENCLAW_STATE_DIR=/data layout
 *
 * Cross-tenant: every read + write filters by `growthAgentId`. Fly app
 * name derives deterministically from the agent id.
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  action,
  type ActionCtx,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import { FlyClient, FlyError, type FlyMachineConfig } from "../../lib/flyClient";
import { decrypt } from "../../lib/encryption";
import { buildRileyWorkspace } from "../../agents/packs/riley_growth/generators";

/* -------------------------------------------------------------------------- */
/* Result + stage types                                                        */
/* -------------------------------------------------------------------------- */

export type DeployRileyStage =
  | "load-agent"
  | "generate-workspace"
  | "upload-bundle"
  | "create-app"
  | "set-secrets"
  | "create-machine"
  | "wait-for-state"
  | "patch-agent"
  | "complete";

export type DeployRileyResult =
  | {
      ok: true;
      stage: "complete";
      flyAppId: string;
      machineId: string;
      durationMs: number;
    }
  | {
      ok: false;
      stage: DeployRileyStage;
      message: string;
      retryable: boolean;
      durationMs: number;
    };

/* -------------------------------------------------------------------------- */
/* Internal queries + mutations                                                */
/* -------------------------------------------------------------------------- */

export const getAgentForDeploy = internalQuery({
  args: { agentId: v.id("growthAgents") },
  handler: async (
    ctx,
    args
  ): Promise<{
    agent: Doc<"growthAgents">;
    creator: Pick<Doc<"creators">, "_id" | "email">;
  } | null> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return null;
    const creator = await ctx.db.get(agent.accountId);
    if (!creator) return null;
    return {
      agent,
      creator: { _id: creator._id, email: creator.email },
    };
  },
});

export const patchAgentOnSuccess = internalMutation({
  args: {
    agentId: v.id("growthAgents"),
    rileyFlyAppId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.agentId, {
      rileyFlyAppId: args.rileyFlyAppId,
      deployedAt: Date.now(),
      onboardingStep: "complete",
      updatedAt: Date.now(),
    });
  },
});

/* -------------------------------------------------------------------------- */
/* Fly + machine config                                                        */
/* -------------------------------------------------------------------------- */

const OPENCLAW_IMAGE =
  process.env.MAYA_OPENCLAW_IMAGE ??
  "registry.fly.io/heymaya-openclaw:v2026.4.23";

const MACHINE_GUEST: NonNullable<FlyMachineConfig["guest"]> = {
  cpu_kind: "shared",
  cpus: 1,
  memory_mb: 1024,
};

const WAIT_TIMEOUT_MS = 90_000;
const WAIT_INTERVAL_MS = 3_000;

function flyAppNameForAgent(agentId: Id<"growthAgents">): string {
  const short = String(agentId)
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase()
    .slice(0, 16);
  return `riley-${short}`;
}

function buildBootstrapShell(): string {
  return [
    "mkdir -p /data/workspace /data/cron",
    'curl -fsSL "$MAYA_WORKSPACE_BUNDLE_URL" -o /tmp/workspace.tar',
    "tar -xf /tmp/workspace.tar -C /data/workspace",
    'echo "$MAYA_BOOTSTRAP_JSON" | jq .gatewayConfig > /data/openclaw.json',
    "exec openclaw gateway --allow-unconfigured",
  ].join(" && ");
}

async function decryptComposioAccountId(value: string): Promise<string> {
  try {
    return await decrypt(value);
  } catch {
    // Legacy single-user rows briefly stored the plaintext id directly.
    // Preserve deploy compatibility; all new writes are encrypted.
    return value;
  }
}

/* -------------------------------------------------------------------------- */
/* POSIX USTAR tar generator (duplicated from deployServiceMaya — small + stable) */
/* -------------------------------------------------------------------------- */

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
  for (const b of blocks) total += b.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const b of blocks) {
    out.set(b, off);
    off += b.length;
  }
  return out;
}

function buildTarHeader(name: string, size: number): Uint8Array {
  const buf = new Uint8Array(512);
  const enc = new TextEncoder();
  const writeAscii = (s: string, off: number, len: number): void => {
    const b = enc.encode(s);
    buf.set(b.subarray(0, Math.min(b.length, len)), off);
  };
  if (name.length > 100) {
    throw new Error(`buildTarHeader: filename too long for USTAR: ${name}`);
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

/* -------------------------------------------------------------------------- */
/* Workspace upload                                                            */
/* -------------------------------------------------------------------------- */

interface DeployBundleArtifact {
  flyAppName: string;
  workspaceBundleUrl: string;
}

export const buildAndUploadWorkspace = internalAction({
  args: { agentId: v.id("growthAgents") },
  handler: async (ctx, args): Promise<DeployBundleArtifact> => {
    const ctxRow = await ctx.runQuery(
      internal.onboarding.growth.deployRiley.getAgentForDeploy,
      { agentId: args.agentId }
    );
    if (!ctxRow) {
      throw new Error(
        `buildAndUploadWorkspace: agent ${args.agentId} not found.`
      );
    }
    const { files } = buildRileyWorkspace({
      agent: ctxRow.agent,
      creator: ctxRow.creator,
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
    if (!url) {
      throw new Error(
        "buildAndUploadWorkspace: Convex storage returned empty URL."
      );
    }
    return {
      flyAppName: flyAppNameForAgent(args.agentId),
      workspaceBundleUrl: url,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Public action — deploy Riley                                                */
/* -------------------------------------------------------------------------- */

export const deployRiley = internalAction({
  args: { agentId: v.id("growthAgents") },
  handler: async (ctx, args): Promise<DeployRileyResult> => {
    const startedAt = Date.now();
    const fail = (
      stage: DeployRileyStage,
      message: string,
      retryable = false
    ): DeployRileyResult => ({
      ok: false,
      stage,
      message,
      retryable,
      durationMs: Date.now() - startedAt,
    });

    // Stage: load-agent.
    const ctxRow = await ctx.runQuery(
      internal.onboarding.growth.deployRiley.getAgentForDeploy,
      { agentId: args.agentId }
    );
    if (!ctxRow) {
      return fail("load-agent", `agent ${args.agentId} not found`);
    }
    const { agent } = ctxRow;

    // Two valid auth shapes per platform:
    //   1. Composio managed-OAuth — `linkedinConnection` / `twitterConnection`
    //      objects with composioAccountId, populated by the onboarding flow.
    //   2. Cookie-based — env vars set on the Convex deployment, passed
    //      through to Fly as secrets for the linkedin-cli / bird-twitter
    //      ClawHub skills (see clawhubManifest.ts).
    // Riley needs at least one path per platform, otherwise she has no way
    // to read or write that platform.
    const liReady =
      Boolean(agent.linkedinConnection) ||
      Boolean(process.env.LINKEDIN_LI_AT && process.env.LINKEDIN_JSESSIONID);
    const twReady =
      Boolean(agent.twitterConnection) ||
      Boolean(process.env.AUTH_TOKEN && process.env.CT0);
    if (!liReady) {
      return fail(
        "load-agent",
        "LinkedIn unconfigured — set Composio connection or LINKEDIN_LI_AT + LINKEDIN_JSESSIONID."
      );
    }
    if (!twReady) {
      return fail(
        "load-agent",
        "X unconfigured — set Composio connection or AUTH_TOKEN + CT0."
      );
    }
    if (!agent.productContext?.productName) {
      return fail("load-agent", "Product context missing — set it first.");
    }

    // Stage: generate-workspace + upload-bundle.
    let bundle: DeployBundleArtifact;
    try {
      bundle = await ctx.runAction(
        internal.onboarding.growth.deployRiley.buildAndUploadWorkspace,
        { agentId: args.agentId }
      );
    } catch (err) {
      return fail("upload-bundle", (err as Error).message);
    }

    const fly = newFlyClient();

    // Stage: create-app (idempotent).
    try {
      await fly.createApp({ appName: bundle.flyAppName });
    } catch (err) {
      if (!isAlreadyExists(err)) {
        return fail(
          "create-app",
          (err as Error).message,
          isRetryable(err)
        );
      }
    }

    // Stage: set-secrets — gateway config + per-platform connection ids
    // + Composio API key + OpenRouter + Brave.
    try {
      const mayaBootstrapJson = JSON.stringify({
        agentId: String(args.agentId),
        flyAppName: bundle.flyAppName,
        gatewayConfig: {
          // Empty for v0. OpenClaw 2026.4.23 rejects unknown top-level
          // keys; expand once we run `openclaw doctor` against a live
          // Riley to discover the canonical schema.
        },
        workspaceBundleUrl: bundle.workspaceBundleUrl,
      });

      const secrets: Record<string, string> = {};
      // Composio connection ids — only set when the operator went through
      // the Composio dashboard flow. Cookie-only deploys leave these empty
      // and Riley uses the ClawHub cookie skills instead.
      if (agent.linkedinConnection) {
        secrets.RILEY_LINKEDIN_CONNECTED_ACCOUNT_ID =
          await decryptComposioAccountId(agent.linkedinConnection.composioAccountId);
      }
      if (agent.twitterConnection) {
        secrets.RILEY_TWITTER_CONNECTED_ACCOUNT_ID =
          await decryptComposioAccountId(agent.twitterConnection.composioAccountId);
      }
      for (const k of [
        "COMPOSIO_API_KEY",
        "OPENROUTER_API_KEY",
        "ANTHROPIC_API_KEY",
        "BRAVE_API_KEY",
        "ENCRYPTION_KEY",
        // ClawHub cookie-auth skills — see clawhubManifest.ts.
        // linkedin-cli reads:
        "LINKEDIN_LI_AT",
        "LINKEDIN_JSESSIONID",
        // bird-twitter (X) full surface:
        "AUTH_TOKEN",
        "CT0",
      ]) {
        const v = process.env[k];
        if (v) secrets[k] = v;
      }
      await fly.setAppSecrets(bundle.flyAppName, secrets);
      // MAYA_BOOTSTRAP_JSON is config (not secret) — pass via machine env.
      void mayaBootstrapJson;
    } catch (err) {
      return fail(
        "set-secrets",
        (err as Error).message,
        isRetryable(err)
      );
    }

    // Stage: create-machine. Idempotent — reuse existing machine on 409.
    let machine;
    try {
      machine = await fly.createMachine({
        appName: bundle.flyAppName,
        name: bundle.flyAppName,
        config: {
          image: OPENCLAW_IMAGE,
          env: {
            OPENCLAW_STATE_DIR: "/data",
            MAYA_OPENCLAW_VERSION: "2026.4.23",
            MAYA_WORKSPACE_BUNDLE_URL: bundle.workspaceBundleUrl,
            MAYA_APP_NAME: bundle.flyAppName,
            // Pin Riley's brain. Sonnet 4.6 is the right tier for the
            // single-user volume: capable enough for voice fitting +
            // outreach judgment, much cheaper than Opus 4.7. Opus 4.7
            // would be overkill cost for ~100 calls/day. Override-able
            // via the RILEY_MODEL env var on the Convex deployment.
            OPENCLAW_MODEL:
              process.env.RILEY_MODEL ?? "anthropic/claude-sonnet-4-6",
            MAYA_BOOTSTRAP_JSON: JSON.stringify({
              agentId: String(args.agentId),
              flyAppName: bundle.flyAppName,
              gatewayConfig: {},
              workspaceBundleUrl: bundle.workspaceBundleUrl,
            }),
          },
          guest: MACHINE_GUEST,
          restart: { policy: "always" },
          metadata: {
            agent_id: String(args.agentId),
            kind: "riley-growth",
            schema_version: "1",
          },
          init: {
            cmd: ["/bin/sh", "-c", buildBootstrapShell()],
          },
        },
      });
    } catch (err) {
      if (isAlreadyExists(err)) {
        const existing = await fly.listMachines(bundle.flyAppName);
        const reuse = existing.find((m) => m.name === bundle.flyAppName);
        if (reuse) {
          machine = reuse;
        } else {
          return fail(
            "create-machine",
            `409 unique-name violation but no machine named ${bundle.flyAppName} found`
          );
        }
      } else {
        return fail(
          "create-machine",
          (err as Error).message,
          isRetryable(err)
        );
      }
    }

    // Stage: wait-for-state.
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
        return fail(
          "wait-for-state",
          (err as Error).message,
          isRetryable(err)
        );
      }
    }

    // Stage: patch-agent.
    try {
      await ctx.runMutation(
        internal.onboarding.growth.deployRiley.patchAgentOnSuccess,
        {
          agentId: args.agentId,
          rileyFlyAppId: bundle.flyAppName,
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

/* -------------------------------------------------------------------------- */
/* Public wrapper — UI button calls this                                       */
/* -------------------------------------------------------------------------- */

export const runOnboardingDeploy = action({
  args: {},
  handler: async (
    ctx: ActionCtx,
    _args
  ): Promise<DeployRileyResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return {
        ok: false,
        stage: "load-agent",
        message: "runOnboardingDeploy: signed-in Clerk user required.",
        retryable: false,
        durationMs: 0,
      };
    }
    const me = await ctx.runQuery(
      internal.onboarding.growth.pipeline.getMyGrowthAgentInternal,
      { clerkUserId: identity.subject }
    );
    if (!me?.agent) {
      return {
        ok: false,
        stage: "load-agent",
        message: "runOnboardingDeploy: no growth-agent row for signed-in user.",
        retryable: false,
        durationMs: 0,
      };
    }
    return await ctx.runAction(
      internal.onboarding.growth.deployRiley.deployRiley,
      { agentId: me.agent._id }
    );
  },
});

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

let __injectedFlyClient: FlyClient | null = null;
export function __setRileyFlyClient(c: FlyClient | null): void {
  __injectedFlyClient = c;
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
