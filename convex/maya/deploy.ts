/**
 * Deploying a `convex/maya` machine (§17.36, §18 Sprint 3).
 *
 * The v1 equivalent is `_admin/realWorldDeployGtm.ts`. This is deliberately a
 * separate path rather than a branch inside it: `gtmMaya` is frozen, and a
 * shared deploy would make every v2 change a v1 risk.
 *
 * ## The shape, and why it's the shape
 *
 * **One machine per customer, ALWAYS ON, persistent volume** (§18 Sprint 2.9).
 * Shared multi-tenant is ruled out — one crash would take out N customers, and
 * session isolation is the whole premise of "an employee."
 *
 * Always-on because **a heartbeat cannot run on a machine Fly is allowed to
 * stop.** It generates no inbound request to keep the machine alive, and once
 * stopped there is no process to fire it. Auto-stop doesn't coexist with the
 * agent loop; it removes it, silently — along with memory consolidation and
 * commitment follow-through, which both ride the heartbeat.
 *
 * The saving forgone is ~5–8 gross-margin points on a business already at
 * ~72–80%. Deferred, not abandoned (§17.36 is marked superseded).
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
import {
  buildMayaWorkspace,
  SEED_DIR,
  WORKSPACE_DIR,
  type MayaWorkspaceInput,
} from "../agents/packs/maya/generators";
import {
  BUNDLED_MAYA_PLUGIN_ID,
  BUNDLED_MAYA_PLUGIN_TGZ_BASE64,
  BUNDLED_MAYA_PLUGIN_TGZ_NAME,
} from "../agents/packs/maya/bundledPlugin";

/** UTF-8 safe base64 — Fly's `raw_value` is base64 of the file bytes. */
function b64(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}

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

/** Where the plugin tarball lands, and where the bootstrap installs it from. */
export const PLUGIN_TGZ_PATH = `${VOLUME_MOUNT_PATH}/${BUNDLED_MAYA_PLUGIN_TGZ_NAME}`;

/**
 * The boot script. Replaces the image CMD via Fly's `init.cmd`.
 *
 * Three jobs, and the first version of this deploy did none of them — it wrote
 * files and started nothing, so the machine would have booted with no tools at
 * all and no way to notice.
 *
 * 1. **Seed without clobbering.** Doctrine files are written directly by Fly's
 *    `config.files` and are meant to be overwritten. `MEMORY.md` is not: it is
 *    hers, dreaming appends promoted memories to it, and rewriting it every
 *    deploy is a silent total memory wipe. So it is staged under /data/seed and
 *    copied ONLY when the destination is absent.
 * 2. **Install the plugin.** Without this the typed tools don't exist and she
 *    falls back to improvising with `exec` — which is how research workers
 *    fabricated results on the live v1 machine.
 * 3. **Exec the gateway.** `exec` so the gateway is PID 1 and Fly's restart
 *    policy sees its exit code rather than the shell's.
 *
 * `set -e` everywhere except the two steps where failure is survivable, which
 * are marked. A bootstrap that silently half-runs is worse than one that dies.
 */
export function buildBootScript(): string {
  return [
    "set -e",
    `mkdir -p ${WORKSPACE_DIR} /data/cron /data/openclaw-memory`,
    // Seed-if-absent. `cp -n` would be shorter but is not portable; the
    // explicit test says what it means.
    `if [ ! -f ${WORKSPACE_DIR}/MEMORY.md ] && [ -f ${SEED_DIR}/MEMORY.md ]; then cp ${SEED_DIR}/MEMORY.md ${WORKSPACE_DIR}/MEMORY.md; fi`,
    "chmod 600 /data/cron/jobs.json 2>/dev/null || true",
    // Survivable: an already-installed plugin re-installs fine, and a failure
    // here should surface as missing tools rather than a machine that won't
    // boot at all.
    `openclaw plugins install npm-pack:${PLUGIN_TGZ_PATH} --force || echo "WARN: maya-tools install failed"`,
    "exec openclaw gateway --bind lan --port 8080",
  ].join("\n");
}

/**
 * Build the Fly machine config. Pure, so the cost-critical settings are
 * testable without a Fly account.
 *
 * The 30-minute warm window (§17.36.2) is moot while the machine is always on —
 * there is no cold start to hide. It becomes live again the day auto-stop is
 * revisited, and it has no mechanism in a Fly machine config, so that day needs
 * a plan rather than a flag.
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
        // ⭐ ALWAYS-ON (§18 Sprint 2.9). Auto-stop is deferred, not abandoned.
        //
        // A heartbeat cannot run on a machine Fly is allowed to stop: it
        // generates no inbound request to keep the machine alive, and once
        // stopped there is no process to fire it. So auto-stop doesn't coexist
        // with the agent loop — it removes it, silently.
        //
        // The lever it buys is ~5–8 gross-margin points at $149, on a business
        // already at ~72–80%. That is a cheap price for the behaviour that
        // makes her an employee rather than a scheduler. Revisit when the line
        // is material and there's real wake-frequency data — which can only be
        // gathered by running this way first.
        autostop: "off",
        autostart: false,
        min_machines_running: 1,
      },
    ],
    // 2GB, not 1: the gateway plus a workspace plus the memory sqlite plus
    // embedding work. Being OOM-killed hourly would look exactly like an agent
    // that ignores its heartbeat.
    guest: { cpu_kind: "shared", cpus: 1, memory_mb: 2048 },
    // `always` now that the machine is meant to stay up — the previous
    // `on-failure` existed to avoid fighting auto-stop, which no longer
    // applies. A crashed agent that stays crashed is silence, and silence is
    // the failure mode this product exists to eliminate.
    restart: { policy: "always" },
    // Replaces the image CMD. Without this the plugin is never installed and
    // the seed-if-absent copy never happens.
    init: { cmd: ["/bin/sh", "-lc", buildBootScript()] },
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
          // Absolute paths (the config) are written where they say; everything
          // else is a workspace-relative file.
          //
          // This previously wrote to `/workspace/…`, which OpenClaw never reads
          // — its workspace is `~/.openclaw/workspace` unless configured, and
          // we configure it onto the persistent volume. A machine would have
          // booted with no doctrine, no skills, and no tools documentation,
          // and the only symptom would have been an agent that ignored
          // everything.
          files: [
            ...Object.entries(workspace.files).map(([path, body]) => ({
              guest_path: path.startsWith("/") ? path : `${WORKSPACE_DIR}/${path}`,
              raw_value: b64(body),
            })),
            // Staged, not placed. The boot script copies these only when the
            // destination is absent — see buildBootScript.
            ...Object.entries(workspace.seedFiles).map(([name, body]) => ({
              guest_path: `${SEED_DIR}/${name}`,
              raw_value: b64(body),
            })),
            // The plugin tarball rides as a machine file rather than being
            // fetched at boot: it's 4.5KB, and a network dependency in the
            // bootstrap is a way for a machine to come up tool-less because a
            // URL was briefly unreachable.
            {
              guest_path: PLUGIN_TGZ_PATH,
              raw_value: BUNDLED_MAYA_PLUGIN_TGZ_BASE64,
            },
          ],
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
    seedFiles: Record<string, string>;
    alwaysLoadedChars: number;
  } | null> => {
    const input = await ctx.runQuery(internal.maya.deploy.workspaceInput, {
      customerId: args.customerId,
    });
    if (!input) return null;
    const bundle = buildMayaWorkspace(input);
    return {
      files: Object.fromEntries(bundle.files),
      seedFiles: Object.fromEntries(bundle.seedFiles),
      alwaysLoadedChars: bundle.alwaysLoadedChars,
    };
  },
});
