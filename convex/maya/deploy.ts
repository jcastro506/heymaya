/**
 * Deploying a `convex/maya` machine (§17.36, §18 Sprint 3).
 *
 * The v1 equivalent is `_admin/realWorldDeployGtm.ts`. This is deliberately a
 * separate path rather than a branch inside it: `gtmMaya` is frozen, and a
 * shared deploy would make every v2 change a v1 risk.
 *
 * ## The shape, and why it's the shape
 *
 * **One machine per customer, auto-stop, persistent volume** (§17.36.1). Shared
 * multi-tenant is cheaper and is ruled out — one crash would take out N
 * customers, and session isolation is the whole premise of "an employee."
 *
 * Auto-stop is the largest cost lever in the model: **~$100–400/mo at 200
 * customers instead of $1,400–3,000.** A machine thinks for roughly 45 minutes
 * a day; always-on bills for 24 hours of idle to serve it.
 *
 * That only works because she is event-driven. A machine that schedules itself
 * never goes idle — which is why the v2 workspace ships no `jobs.json`.
 *
 * ## Secrets never enter the machine config
 *
 * A Fly machine config is readable back through the API, so anything in
 * `config.env` is retrievable by anyone who can read the machine. Credentials
 * go through `setAppSecrets` and are referenced by name. `buildMachineConfig`
 * takes no secret values at all — it can't leak what it was never given, and a
 * test asserts the config contains none.
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { FlyMachineConfig } from "../lib/flyClient";
import { hashToken } from "./hooks";
import { buildMayaWorkspace, type MayaWorkspaceInput } from "../agents/packs/maya/generators";
import {
  BUNDLED_MAYA_PLUGIN_ID,
  BUNDLED_MAYA_PLUGIN_TGZ_NAME,
} from "../agents/packs/maya/bundledPlugin";

/** Where the persistent volume mounts. OpenClaw's session state lives here. */
export const VOLUME_MOUNT_PATH = "/data";
export const VOLUME_SIZE_GB = 1;

/**
 * Secrets the machine needs, by name. Values are set via `setAppSecrets` and
 * never appear in the machine config.
 */
export const REQUIRED_SECRET_NAMES = [
  "MAYA_AGENT_TOKEN",
  "OPENROUTER_API_KEY",
] as const;

/* -------------------------------------------------------------------------- */
/* The machine config                                                          */
/* -------------------------------------------------------------------------- */

export interface MachineConfigInput {
  image: string;
  /** Non-secret settings only. Anything sensitive goes through app secrets. */
  publicEnv?: Record<string, string>;
  customerId: string;
}

/**
 * Build the Fly machine config. Pure, so the cost-critical settings are
 * testable without a Fly account.
 *
 * ⚠️ **The 30-minute warm window (§17.36.2) is NOT expressible here.** Fly's
 * `autostop` fires on idle; there is no configurable grace period in the
 * machine config. So the warm window needs a different mechanism — most likely
 * Convex holding the machine open after an interaction — and until that exists,
 * a back-and-forth conversation may pay a cold start more than once.
 *
 * Recorded rather than quietly approximated: the spec promises the warm window,
 * and half of it shipping as a comment is how a promise becomes a bug report.
 */
export function buildMachineConfig(input: MachineConfigInput): FlyMachineConfig {
  // `publicEnv` is the one hole in "this function is given no secrets": a
  // caller can pass anything. Strip the known secret names rather than trust
  // every future caller to remember — the cost of being wrong here is a
  // credential readable by anyone who can read the machine, and the cost of
  // the filter is nothing.
  const publicEnv = Object.fromEntries(
    Object.entries(input.publicEnv ?? {}).filter(
      ([key]) => !(REQUIRED_SECRET_NAMES as readonly string[]).includes(key)
    )
  );

  return {
    image: input.image,
    env: {
      ...publicEnv,
      // Non-secret. Tells the bootstrap where to install the plugin from.
      MAYA_PLUGIN_ID: BUNDLED_MAYA_PLUGIN_ID,
      MAYA_PLUGIN_TGZ: BUNDLED_MAYA_PLUGIN_TGZ_NAME,
      OPENCLAW_STATE_DIR: VOLUME_MOUNT_PATH,
    },
    mounts: [{ volume: "maya_data", path: VOLUME_MOUNT_PATH }],
    services: [
      {
        protocol: "tcp",
        internal_port: 8080,
        ports: [{ port: 443, handlers: ["tls", "http"] }],
        // THE COST LEVER. See §17.36.1.
        autostop: "stop",
        autostart: true,
        // Zero is the point — any other value reinstates always-on billing.
        min_machines_running: 0,
      },
    ],
    guest: { cpu_kind: "shared", cpus: 1, memory_mb: 1024 },
    // `on-failure`, not `always`: `always` fights auto-stop by restarting a
    // machine Fly deliberately stopped, which silently converts this back into
    // an always-on machine at ten times the price.
    restart: { policy: "on-failure", max_retries: 3 },
    metadata: { product: "maya", agentVersion: "v2", customerId: input.customerId },
  };
}

/* -------------------------------------------------------------------------- */
/* The agent credential                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Mint a fresh agent token.
 *
 * Returned once, in memory, to be handed straight to `setAppSecrets`. Only the
 * hash is stored, so a database read can't yield the ability to act as
 * somebody's agent — and nothing, including us, can recover the token later. A
 * lost token is re-minted, never looked up.
 */
export function generateAgentToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const storeAgentTokenHash = internalMutation({
  args: { customerId: v.id("customers"), tokenHash: v.string() },
  handler: async (ctx, args): Promise<{ stored: boolean }> => {
    const customer = (await ctx.db.get(args.customerId)) as Doc<"customers"> | null;
    if (!customer) return { stored: false };
    await ctx.db.patch(args.customerId, {
      agentTokenHash: args.tokenHash,
      updatedAt: Date.now(),
    });
    return { stored: true };
  },
});

/* -------------------------------------------------------------------------- */
/* The workspace                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Assemble the workspace for one customer from their rows.
 *
 * Reads rather than accepts: a deploy that took the founder's product truth as
 * an argument could ship a machine that disagrees with the database, and the
 * database is the truth.
 */
export const workspaceInput = internalQuery({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args): Promise<MayaWorkspaceInput | null> => {
    const customer = (await ctx.db.get(args.customerId)) as Doc<"customers"> | null;
    if (!customer) return null;
    const account = (await ctx.db.get(customer.accountId)) as Doc<"creators"> | null;

    const channels = (await ctx.db
      .query("channels")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .collect()) as Doc<"channels">[];

    // `dormant` and `disconnected` channels ship no norms. Carrying context for
    // a channel she cannot post to spends budget to make her worse — she plans
    // around something with no live grant.
    const live = channels.filter((c) => c.status === "connected");

    const product = safeJson(customer.productTruthJson);
    const voice = safeJson(customer.voiceProfileJson);

    return {
      founder: {
        email: account?.email ?? "unknown",
        name: typeof product.founderName === "string" ? product.founderName : undefined,
        timezone: customer.timezone,
      },
      product: {
        name: typeof product.name === "string" ? product.name : "the product",
        url: typeof product.url === "string" ? product.url : "",
        truth: typeof product.truth === "string" ? product.truth : undefined,
        differentiator:
          typeof product.differentiator === "string"
            ? product.differentiator
            : undefined,
      },
      channels: live.map((c) => ({
        channel: c.channel,
        postingMode: c.postingMode,
      })),
      voiceExcerpts: Array.isArray(voice.excerpts)
        ? voice.excerpts.filter((e): e is string => typeof e === "string")
        : undefined,
    };
  },
});

/**
 * Parse a JSON column without letting a malformed one take down a deploy.
 *
 * These are operator- and model-written blobs. A truncated write shouldn't mean
 * the machine can't be deployed at all — it should mean the machine deploys
 * with that section empty, which the workspace already renders honestly.
 */
function safeJson(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export const recordMachine = internalMutation({
  args: {
    customerId: v.id("customers"),
    flyAppName: v.string(),
    flyMachineId: v.string(),
  },
  handler: async (ctx, args): Promise<null> => {
    await ctx.db.patch(args.customerId, {
      flyAppName: args.flyAppName,
      flyMachineId: args.flyMachineId,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Deploy one customer's machine.
 *
 * Deliberately thin. Every step here is an external call, so none of it can be
 * meaningfully unit-tested — which is an argument for keeping the *judgment* out
 * of it, not for skipping it. All the decidable parts (the machine shape, the
 * credential, the workspace) are pure functions tested elsewhere; this is the
 * order they happen in.
 *
 * **The deploy is the test.** Nothing below has run against Fly.
 *
 * Ordering is not arbitrary:
 * - the token is minted and STORED before the machine exists, so a machine can
 *   never boot holding a credential the server doesn't recognise;
 * - the volume is created before the machine, because a machine referencing a
 *   missing volume fails to start rather than starting without persistence —
 *   the loud failure is the one you want;
 * - secrets are set before create, so the first boot has them.
 */
export const deployMachine = internalAction({
  args: {
    customerId: v.id("customers"),
    image: v.string(),
    region: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args
  ): Promise<
    { ok: true; appName: string; machineId: string } | { ok: false; error: string }
  > => {
    const workspace = await ctx.runAction(internal.maya.deploy.workspaceFor, {
      customerId: args.customerId,
    });
    if (!workspace) return { ok: false, error: "no such customer" };

    const openrouterKey = process.env.OPENROUTER_API_KEY;
    if (!openrouterKey) {
      return { ok: false, error: "OPENROUTER_API_KEY is not configured" };
    }
    const siteUrl = process.env.CONVEX_SITE_URL;
    if (!siteUrl) {
      return { ok: false, error: "CONVEX_SITE_URL is not configured" };
    }

    const { FlyClient } = await import("../lib/flyClient");
    const fly = new FlyClient();
    const appName = `maya-${args.customerId.toLowerCase().slice(-12)}`;

    try {
      await fly.createApp({ appName });
    } catch (error) {
      // Find-or-create: an existing app is the normal case on redeploy, and
      // treating it as an error would make deploys one-shot.
      const message = error instanceof Error ? error.message : String(error);
      if (!/already|taken|exists/i.test(message)) {
        return { ok: false, error: `could not create the app: ${message}` };
      }
    }

    try {
      await fly.findOrCreateVolume(appName, {
        name: "maya_data",
        sizeGb: VOLUME_SIZE_GB,
        region: args.region,
      });

      // Minted and stored BEFORE the machine exists. A machine holding a
      // credential the server doesn't recognise would fail every tool call
      // with a 401 that looks like a code bug rather than a deploy ordering
      // bug.
      const token = generateAgentToken();
      const stored = await ctx.runMutation(
        internal.maya.deploy.storeAgentTokenHash,
        { customerId: args.customerId, tokenHash: await hashToken(token) }
      );
      if (!stored.stored) return { ok: false, error: "customer vanished mid-deploy" };

      await fly.setAppSecrets(appName, {
        MAYA_AGENT_TOKEN: token,
        OPENROUTER_API_KEY: openrouterKey,
      });

      const config = buildMachineConfig({
        image: args.image,
        customerId: args.customerId,
        publicEnv: { CONVEX_SITE_URL: siteUrl },
      });

      const machine = await fly.createMachine({
        appName,
        name: appName,
        region: args.region,
        config: {
          ...config,
          files: Object.entries(workspace.files).map(([path, body]) => ({
            guest_path: `/workspace/${path}`,
            raw_value: btoa(unescape(encodeURIComponent(body))),
          })),
        },
      });

      await ctx.runMutation(internal.maya.deploy.recordMachine, {
        customerId: args.customerId,
        flyAppName: appName,
        flyMachineId: machine.id,
      });

      return { ok: true, appName, machineId: machine.id };
    } catch (error) {
      // Named, never silent. A half-deployed machine that reports success is
      // how you get a founder texting a thing that isn't there.
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});

/** Assemble the workspace for one customer from their rows. */
export const workspaceFor = internalAction({
  args: { customerId: v.id("customers") },
  handler: async (
    ctx,
    args
  ): Promise<{
    files: Record<string, string>;
    alwaysLoadedChars: number;
  } | null> => {
    const input = await ctx.runQuery(internal.maya.deploy.workspaceInput, {
      customerId: args.customerId,
    });
    if (!input) return null;
    const bundle = buildMayaWorkspace(input);
    return {
      files: Object.fromEntries(bundle.files),
      alwaysLoadedChars: bundle.alwaysLoadedChars,
    };
  },
});
