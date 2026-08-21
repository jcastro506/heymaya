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
  STAGE_DIR,
  stagedPath,
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
  // Without it the gateway exits 78: "Set OPENCLAW_GATEWAY_TOKEN ... to start
  // with auth." Observed live 2026-08-04.
  "OPENCLAW_GATEWAY_TOKEN",
  /**
   * ⭐ SEMANTIC MEMORY DOESN'T WORK WITHOUT THIS.
   *
   * `memorySearch` embeds through `provider: "gemini"`, so a machine without a
   * Google key logs
   *
   *   [memory] sync failed (search-bootstrap): No API key found for provider
   *   "google"
   *
   * once at boot and then behaves like an agent that simply doesn't remember
   * much — no error surfaces at recall time, the search just returns nothing.
   * It was set in Convex the whole time and the deploy never carried it across.
   * Observed live 2026-08-04, the same shape as the Telegram identity bug.
   */
  "GEMINI_API_KEY",
] as const;

/* -------------------------------------------------------------------------- */
/* The machine config                                                          */
/* -------------------------------------------------------------------------- */

export interface MachineConfigInput {
  image: string;
  /** Non-secret settings only. Anything sensitive goes through app secrets. */
  publicEnv?: Record<string, string>;
  customerId: string;
  /**
   * The founder's IANA timezone, e.g. `America/Los_Angeles`.
   *
   * Load-bearing, not cosmetic: the heartbeat's waking-hours window resolves
   * `timezone: "local"` against this. v1 once shipped the literal string
   * `"operator"` here, OpenClaw failed closed, and EVERY heartbeat tick was
   * suppressed — an agent that looked alive and never woke up.
   */
  timezone: string;
}

/**
 * ⚠️ STAGING AND PRODUCTION SHARE ONE FLY ORG.
 *
 * Verified 2026-08-04: both Convex deployments carry `FLY_ORG_SLUG=personal`
 * and `FLY_REGION=sjc`. So a Fly app list from staging returns PRODUCTION'S
 * customer machines too, and any teardown matching on a bare `maya-` prefix
 * would destroy them.
 *
 * That is not hypothetical — `destroyAllClawlaunchApps` matches exactly that
 * prefix and was run twice against staging today. It only did no harm because
 * production has no customers yet.
 *
 * So the deployment is part of the app NAME, not merely metadata. Metadata
 * would need a per-app machine lookup to read; a name is visible in the same
 * list call that could destroy it, which makes the dangerous operation the one
 * that has to opt in.
 */
export function deploymentSlug(siteUrl: string | undefined): string {
  // https://precise-canary-781.convex.site -> precisecanary781
  const host = (siteUrl ?? "").replace(/^https?:\/\//, "").split(".")[0] ?? "";
  const slug = host
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase()
    .slice(0, 20);
  // Deliberately no fallback to a shared default: an unknown deployment must
  // not silently share a namespace with a known one.
  return slug || "unknown";
}

/** Fly app name for one customer, scoped to this Convex deployment. */
export function flyAppName(
  customerId: string,
  siteUrl: string | undefined,
): string {
  return `maya-${deploymentSlug(siteUrl)}-${customerId.toLowerCase().slice(-10)}`;
}

/** Where the plugin tarball lands, and where the bootstrap installs it from. */
export const PLUGIN_TGZ_PATH = `${STAGE_DIR}/${BUNDLED_MAYA_PLUGIN_TGZ_NAME}`;

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

    // ⭐ COPY FROM THE STAGE ONTO THE VOLUME — this is the whole fix.
    //
    // Fly writes `config.files` BEFORE mounting the volume, so anything written
    // under /data is shadowed by the mount and Fly's chown-after-mount then
    // fails with ENOENT, killing init. Observed live 2026-08-04: two reboots,
    // then a stopped machine. Staging in the image and copying after the mount
    // is what makes the files actually exist where OpenClaw looks.
    `cp -R ${STAGE_DIR}/data/workspace/. ${WORKSPACE_DIR}/`,
    `cp ${STAGE_DIR}/data/openclaw.json /data/openclaw.json`,
    `cp ${STAGE_DIR}/data/cron/jobs.json /data/cron/jobs.json`,

    // Copied TWICE, one second apart. v1 documents a live race where 6 of 12
    // root .md files vanished between writing the workspace and OpenClaw's own
    // workspace initialisation — re-copying restored them. `cp` overwrites, so
    // this is free when the first pass held.
    "sleep 1",
    `cp -R ${STAGE_DIR}/data/workspace/. ${WORKSPACE_DIR}/`,
    `echo "[boot] workspace: $(ls ${WORKSPACE_DIR} | tr '\\n' ' ')"`,

    // Seed-if-absent. `cp -n` would be shorter but is not portable; the
    // explicit test says what it means.
    `if [ ! -f ${WORKSPACE_DIR}/MEMORY.md ] && [ -f ${SEED_DIR}/MEMORY.md ]; then cp ${SEED_DIR}/MEMORY.md ${WORKSPACE_DIR}/MEMORY.md; fi`,
    "chmod 700 /data/cron",
    "chmod 600 /data/cron/jobs.json",

    /**
     * ⭐ THE CRITIC STARTS FRESH EVERY BOOT. TWO REASONS.
     *
     * **Config changes don't reach an existing session.** An agent's session
     * pins the model it was created with, and that state lives on the VOLUME,
     * which survives redeploys. Verified live 2026-08-05: `openclaw.json` on
     * disk said `openrouter/qwen/qwen3.7-flash` while the running critic was
     * still calling `moonshotai/kimi-k2-0905` — and still failing the way the
     * old config failed. Two model changes and a tool-profile fix had all
     * silently not applied.
     *
     * **A critic should be stateless anyway.** Each verdict is independent;
     * remembering the last draft it vetoed is not context, it's contamination.
     *
     * ⛔ ONLY `critique`. `main`'s session is the durable one — clearing it is
     * exactly the amnesia this whole architecture exists to prevent.
     */
    "rm -rf /data/agents/critique/sessions",

    // Survivable: an already-installed plugin re-installs fine, and a failure
    // here should surface as missing tools rather than a machine that won't
    // boot at all. HOME=/data is set in the image, so npm-pack's install root
    // lands on the volume and survives a restart.
    `openclaw plugins install npm-pack:${PLUGIN_TGZ_PATH} --force 2>&1 | tail -20 || echo "[boot] WARN maya-tools install failed — gateway starts without typed tools"`,

    // `--allow-unconfigured` is REQUIRED: OpenClaw 5.x refuses to start with
    // "Refusing to bind gateway to auto without auth". No `--port` — the image
    // sets PORT=3000 and its healthcheck probes that; passing a different one
    // starts a gateway the healthcheck can never reach.
    'echo "[boot] launching gateway"',
    "exec openclaw gateway --bind lan --allow-unconfigured",
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
export function buildMachineConfig(
  input: MachineConfigInput,
): FlyMachineConfig {
  // `publicEnv` is the one hole in "this function is given no secrets": a
  // caller can pass anything. Strip the known secret names rather than trust
  // every future caller to remember — the cost of being wrong here is a
  // credential readable by anyone who can read the machine, and the cost of
  // the filter is nothing.
  const publicEnv = Object.fromEntries(
    Object.entries(input.publicEnv ?? {}).filter(
      ([key]) => !(REQUIRED_SECRET_NAMES as readonly string[]).includes(key),
    ),
  );

  return {
    image: input.image,
    env: {
      ...publicEnv,
      // Non-secret. Tells the bootstrap where to install the plugin from.
      MAYA_PLUGIN_ID: BUNDLED_MAYA_PLUGIN_ID,
      MAYA_PLUGIN_TGZ: BUNDLED_MAYA_PLUGIN_TGZ_NAME,
      OPENCLAW_STATE_DIR: VOLUME_MOUNT_PATH,
      // What `activeHours: { timezone: "local" }` resolves against. A bad value
      // here doesn't degrade the heartbeat — it silences it.
      TZ: input.timezone,
    },
    mounts: [{ volume: "maya_data", path: VOLUME_MOUNT_PATH }],
    services: [
      {
        protocol: "tcp",
        /**
         * ⭐ 18789 — OpenClaw's OWN default gateway port. Verified live by
         * probing the machine: 3000 and 8080 refuse, 18789 answers 200.
         *
         * The image sets `PORT=3000`, EXPOSEs 3000, and health-checks 3000 —
         * all of which is a red herring, because those describe the image's
         * default CMD (`--port 3000`). Our boot script deliberately omits
         * `--port` (v1 does too), so the gateway binds its own default instead
         * and the image's own healthcheck can never pass.
         *
         * v1 has `internal_port: 18789` and I overrode it with 3000 after
         * reading the Dockerfile — reasoning from the image instead of from
         * what the process actually does. Fly then routed :443 to a port
         * nothing listened on, and every health probe returned 503 while the
         * gateway sat there perfectly healthy on another port.
         */
        internal_port: 18789,
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
    metadata: {
      product: "maya",
      agentVersion: "v2",
      customerId: input.customerId,
    },
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
  args: {
    customerId: v.id("customers"),
    tokenHash: v.string(),
    gatewayToken: v.optional(v.string()),
    machineUrl: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ stored: boolean }> => {
    const customer = (await ctx.db.get(
      args.customerId,
    )) as Doc<"customers"> | null;
    if (!customer) return { stored: false };
    await ctx.db.patch(args.customerId, {
      agentTokenHash: args.tokenHash,
      ...(args.gatewayToken ? { gatewayToken: args.gatewayToken } : {}),
      ...(args.machineUrl ? { machineUrl: args.machineUrl } : {}),
      // A redeploy re-mints credentials, so the old readiness is stale until
      // the new machine says otherwise.
      machineReadyAt: undefined,
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
    const customer = (await ctx.db.get(
      args.customerId,
    )) as Doc<"customers"> | null;
    if (!customer) return null;
    const account = (await ctx.db.get(
      customer.accountId,
    )) as Doc<"creators"> | null;

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
    /**
     * The founder's standing rules, carried onto the machine.
     *
     * Without this they existed only in the ledger and the publish gate — she
     * could break one, get held, and learn the rule from the hold. Sprint 6's
     * "house-rules block" is this.
     */
    const rules = await ctx.runQuery(internal.maya.directives.activeRules, {
      customerId: args.customerId,
    });
    const houseRules = rules.map((r) => {
      let meaning: string | undefined;
      try {
        const parsed = r.interpretationJson
          ? (JSON.parse(r.interpretationJson) as { meaning?: unknown })
          : {};
        meaning =
          typeof parsed.meaning === "string" ? parsed.meaning : undefined;
      } catch {
        /* the verbatim rule is what matters; a bad interpretation is dropped */
      }
      return { verbatim: r.verbatim, meaning };
    });

    const rejections = await ctx.runQuery(
      internal.maya.voiceCorpus.rejectionsFor,
      { customerId: args.customerId },
    );
    const editPairs = await ctx.runQuery(
      internal.maya.voiceCorpus.editPairsFor,
      { customerId: args.customerId },
    );

    return {
      founder: {
        email: account?.email ?? "unknown",
        name:
          typeof product.founderName === "string"
            ? product.founderName
            : undefined,
        timezone: customer.timezone,
      },
      /**
       * ⭐ FIELD NAMES MUST MATCH `ProductTruth` (Sprint 2.95).
       *
       * The reader writes `whatItIs` / `whatsDifferent` / `whoItsFor`; this
       * query used to look only for `truth` / `differentiator`. A mismatch here
       * is silent in the worst way: the read succeeds, the row fills, the
       * deploy succeeds — and APP.md renders "product truth not captured yet"
       * forever, so she keeps refusing to make claims she now has grounds for.
       *
       * Legacy names are still read as a fallback for rows written before the
       * reader existed.
       */
      product: {
        name: typeof product.name === "string" ? product.name : "the product",
        url: typeof product.url === "string" ? product.url : "",
        truth:
          typeof product.whatItIs === "string" && product.whatItIs
            ? product.whatItIs
            : typeof product.truth === "string"
              ? product.truth
              : undefined,
        differentiator:
          typeof product.whatsDifferent === "string" && product.whatsDifferent
            ? product.whatsDifferent
            : typeof product.differentiator === "string"
              ? product.differentiator
              : undefined,
        audience:
          typeof product.whoItsFor === "string" && product.whoItsFor
            ? product.whoItsFor
            : undefined,
        gaps: Array.isArray(product.gaps)
          ? product.gaps.filter((g): g is string => typeof g === "string")
          : undefined,
        // Outranks everything scraped — a page goes stale, their words don't.
        founderSays: Array.isArray(product.founderSays)
          ? product.founderSays.filter(
              (f): f is string => typeof f === "string",
            )
          : undefined,
      },
      channels: live.map((c) => ({
        channel: c.channel,
        postingMode: c.postingMode,
      })),
      voiceExcerpts: Array.isArray(voice.excerpts)
        ? voice.excerpts.filter((e): e is string => typeof e === "string")
        : undefined,
      // §7.5.2 layer 2 — what they changed is stronger signal than what they
      // wrote, because an edit says what was WRONG.
      editPairs: editPairs.length > 0 ? editPairs : undefined,
      rejections: rejections.length > 0 ? rejections : undefined,
      houseRules: houseRules.length > 0 ? houseRules : undefined,
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
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
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
    args,
  ): Promise<
    | { ok: true; appName: string; machineId: string; started: boolean }
    | { ok: false; error: string }
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
    // Scoped to this Convex deployment — staging and prod share a Fly org, so
    // an unscoped name lets one environment's teardown reach the other's
    // machines.
    const appName = flyAppName(args.customerId, siteUrl);

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

    // ⭐ PUBLIC ADDRESS. Fly apps created through the Machines API get NO DNS,
    // so without this Convex cannot reach the gateway at all — and reaching the
    // gateway is the only way her session ever hears from the founder. v1 has
    // this as its own deploy stage; the first v2 attempt simply omitted it.
    //
    // Both calls are idempotent-ish: an app that already has an address errors
    // in a way we can safely ignore, and failing the whole deploy over a
    // re-allocation would make redeploys one-shot.
    try {
      await fly.allocateSharedV4(appName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/already|allocated|exists/i.test(message)) {
        return { ok: false, error: `could not allocate an IPv4: ${message}` };
      }
    }
    try {
      await fly.allocateV6(appName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/already|allocated|exists/i.test(message)) {
        return { ok: false, error: `could not allocate an IPv6: ${message}` };
      }
    }

    /**
     * ⭐ DESTROY ANY EXISTING MACHINE FIRST. The deploy has to be idempotent.
     *
     * Two reasons, and the second is worse than the first:
     *
     * 1. **The volume.** One volume attaches to one machine. A redeploy that
     *    creates a second machine gets `volume not found` from Fly — meaning
     *    no FREE volume by that name, because the old machine still holds it.
     *    Observed live 2026-08-04 on the first redeploy.
     *
     * 2. **Two machines = two heartbeats = two cron sets.** v1 documents this
     *    as a direct cause of its re-doing loop: doubled foundation passes,
     *    doubled spend, and an agent apparently doing everything twice. The
     *    volume error is loud; this one is silent and expensive.
     *
     * Best-effort and never fatal: a teardown failure must not block a fresh
     * deploy, since the new machine is the thing that actually matters. The
     * VOLUME survives — that is the whole point, and it is what carries her
     * memory across the redeploy.
     */
    try {
      for (const stale of await fly.listMachines(appName)) {
        try {
          await fly.destroyMachine(appName, stale.id, { force: true });
        } catch {
          // Named in the deploy result rather than thrown — see above.
        }
      }
    } catch {
      // listMachines failing is not a reason to refuse to deploy.
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

      // ⭐ A SECOND, DIFFERENT TOKEN. OpenClaw refuses to start the gateway
      // without auth (`exit 78`), and it refuses to boot at all when the hook
      // and gateway tokens are equal — v1 hit that as a live crash-loop. So
      // this is minted separately, never derived from the first.
      //
      // Stored in plaintext because we PRESENT it to the machine; the agent
      // token is hashed because the machine presents it to us. Different
      // direction, different storage.
      const gatewayToken = generateAgentToken();
      const machineUrl = `https://${appName}.fly.dev`;

      const stored = await ctx.runMutation(
        internal.maya.deploy.storeAgentTokenHash,
        {
          customerId: args.customerId,
          tokenHash: await hashToken(token),
          gatewayToken,
          machineUrl,
        },
      );
      if (!stored.stored)
        return { ok: false, error: "customer vanished mid-deploy" };

      /**
       * ⭐ This customer's OWN OpenRouter key, so the bill is attributable.
       *
       * Measured 2026-08-07: `costEvents` covers **2% of the LLM spend** — it
       * only sees calls made from Convex. The other 98% is the agent loop on
       * Fly calling OpenRouter directly, where nothing of ours can see it.
       * OpenRouter reports usage per key, so one key per machine is the only
       * thing that makes the number both complete AND per-customer.
       *
       * ⚠️ INSTRUMENTATION, NEVER A BLOCKER. If minting fails the deploy
       * continues on the shared fleet key: a machine that cannot think is a
       * far worse outcome than a spend figure we cannot split.
       *
       * ⚠️ Minted on every deploy rather than once. OpenRouter never shows a
       * key twice, so a redeploy cannot re-set an existing one — and skipping
       * the secret would leave a RECREATED app with no key at all, which is an
       * unbootable machine. Duplicate keys at the vendor are labelled and
       * harmless; an agent that can't answer is not. (Deleting the superseded
       * key is worth doing and is not done here.)
       */
      let modelKey = openrouterKey;
      const minted = await ctx.runAction(internal.maya.cogs.provisionKey, {
        customerId: args.customerId,
        label: appName,
      });
      if (minted.ok) {
        modelKey = minted.key;
      } else {
        console.error(
          `[deploy] per-customer OpenRouter key unavailable for ${appName}, ` +
            `falling back to the shared key: ${minted.error}`,
        );
      }

      await fly.setAppSecrets(appName, {
        MAYA_AGENT_TOKEN: token,
        OPENROUTER_API_KEY: modelKey,
        OPENCLAW_GATEWAY_TOKEN: gatewayToken,
        // Empty is tolerated — the gateway still boots and everything except
        // semantic recall works. A missing key must not block a deploy.
        GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? "",
      });

      const config = buildMachineConfig({
        image: args.image,
        customerId: args.customerId,
        // From the customer row, same source as the cron expressions — so the
        // heartbeat's waking hours and the morning brief agree about what
        // "morning" means.
        timezone: workspace.timezone,
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
            // Staged in the IMAGE's filesystem, never under /data — see
            // buildBootScript. A file written under the mount point is a boot
            // loop, not a misplaced file.
            ...Object.entries(workspace.files).map(([path, body]) => ({
              guest_path: stagedPath(
                path.startsWith("/") ? path : `${WORKSPACE_DIR}/${path}`,
              ),
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

      /**
       * ⭐ WAIT FOR IT TO ACTUALLY START.
       *
       * Returning the moment Fly accepts the create is what made the button
       * lie: the founder saw "deployed", paired, texted — and the machine was
       * busy dying in a boot loop the whole time. `started` and "Fly said ok"
       * are ~90 seconds apart, and the entire product lives in that gap.
       *
       * A timeout is NOT a failed deploy. The machine exists and may well come
       * up a moment later; what is false is calling it ready. So this reports
       * `started: false` and the pairing screen stays closed until a health
       * check says otherwise.
       */
      let started = false;
      try {
        await fly.waitForState(appName, machine.id, "started", {
          timeoutMs: 120_000,
        });
        started = true;
      } catch {
        started = false;
      }

      return { ok: true, appName, machineId: machine.id, started };
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
    args,
  ): Promise<{
    files: Record<string, string>;
    seedFiles: Record<string, string>;
    alwaysLoadedChars: number;
    /** Carried out so the machine's TZ and the cron expressions agree. */
    timezone: string;
  } | null> => {
    /**
     * ⭐ Rebuild the voice corpus first, so the machine ships with how they
     * actually write rather than the "no writing samples yet" fallback.
     *
     * Free — it re-reads the message log, which already exists. §6 calls this
     * source 2 and notes that nobody uses it; SOUL.md has rendered
     * `voiceExcerpts` since Sprint 2 with nothing ever filling it.
     */
    // ⭐ The JUDGED refresh. The heuristic version selected four instructions
    // out of five excerpts on the live account — "do the daily placement now"
    // reads as writing to a length rule and as a command to anyone else.
    await ctx.runAction(internal.maya.voiceCorpus.refreshVoiceCorpusJudged, {
      customerId: args.customerId,
    });

    const input = await ctx.runQuery(internal.maya.deploy.workspaceInput, {
      customerId: args.customerId,
    });
    if (!input) return null;
    const bundle = buildMayaWorkspace(input);

    /**
     * ⭐ SHE COMES BACK REMEMBERING. The checkpoint had no reader.
     *
     * ⚠️ `checkpoint.record` has written a full copy of `MEMORY.md` into
     * `memorySnapshots` every day since Sprint 2.9, retained 30 deep, and
     * `checkpoint.latest` is even documented as *"Restore point: what her
     * memory said at a given time."* NOTHING EVER READ IT. A machine that lost
     * its volume came back amnesiac while a month of her memory sat in Convex.
     *
     * The same defect class as `dailyReport` reading a `metricsJson` nothing
     * wrote, pointed the other way: a write with no reader looks exactly like a
     * working backup right up to the moment you need it.
     *
     * ⚠️ It rides the SEED slot, not the workspace slot, which is what makes it
     * safe. The boot script copies a seed only when the destination is absent
     * (`if [ ! -f .../MEMORY.md ]`), so a machine whose volume survived keeps
     * the live file and this is inert. It restores only into genuine emptiness
     * — it can never overwrite memory that is newer than the snapshot.
     */
    const snapshot = await ctx.runQuery(internal.maya.checkpoint.latest, {
      customerId: args.customerId,
    });
    const seedFiles = new Map(bundle.seedFiles);
    if (snapshot?.markdown && snapshot.markdown.trim().length > 0) {
      seedFiles.set("MEMORY.md", snapshot.markdown);
    }

    return {
      files: Object.fromEntries(bundle.files),
      seedFiles: Object.fromEntries(seedFiles),
      alwaysLoadedChars: bundle.alwaysLoadedChars,
      timezone: input.founder.timezone,
    };
  },
});

/**
 * Tear down every v2 machine belonging to THIS Convex deployment.
 *
 * Deliberately not "all maya apps". Staging and production share a Fly org, so
 * a prefix match on `maya-` reaches across environments — the existing
 * `_admin/realWorldDeployGtm:destroyAllClawlaunchApps` does exactly that, and
 * it was run twice against staging on 2026-08-04. No harm done only because
 * production had no customers.
 *
 * The scoping is by NAME rather than metadata on purpose: the name is visible
 * in the same `listApps` call that would destroy it, so nothing has to fetch
 * extra state to be safe. Safety that depends on a second lookup is safety that
 * gets skipped.
 */
export const destroyMyDeploymentMachines = internalAction({
  args: { confirm: v.literal("yes-destroy-this-deployments-machines") },
  handler: async (): Promise<{
    scope: string;
    destroyed: string[];
    skippedOtherDeployments: string[];
    refused?: string;
  }> => {
    /**
     * ⛔ FAIL CLOSED. Bulk teardown is a TESTING tool and must be impossible in
     * production.
     *
     * The only legitimate way a customer's machine dies in production is that
     * customer deleting their account — which goes through `accountDeletion`,
     * per-customer, on their own instruction. A fleet sweep is a developer
     * convenience, and a developer convenience that can reach paying customers
     * is a loaded gun.
     *
     * An explicit opt-in env var rather than a deployment-name check: a name
     * check is a guess about which deployment is which, and this must be wrong
     * only in the safe direction. Absent → refuse, on every deployment,
     * including new ones nobody has thought about yet.
     */
    if (process.env.ALLOW_BULK_TEARDOWN !== "true") {
      return {
        scope: "refused",
        destroyed: [],
        skippedOtherDeployments: [],
        refused:
          "bulk teardown is disabled here — set ALLOW_BULK_TEARDOWN=true on a testing deployment, never on production. To remove ONE customer, use account deletion.",
      };
    }

    const siteUrl = process.env.CONVEX_SITE_URL;
    const scope = `maya-${deploymentSlug(siteUrl)}-`;

    const { FlyClient } = await import("../lib/flyClient");
    const fly = new FlyClient();
    const all = await fly.listApps({ first: 500 });

    const destroyed: string[] = [];
    const skippedOtherDeployments: string[] = [];
    for (const app of all) {
      if (app.name.startsWith(scope)) {
        await fly.destroyApp(app.name);
        destroyed.push(app.name);
      } else if (app.name.startsWith("maya-")) {
        // Another deployment's machine. Recorded rather than ignored, so a
        // teardown that quietly did nothing is distinguishable from one that
        // found nothing.
        skippedOtherDeployments.push(app.name);
      }
    }
    return { scope, destroyed, skippedOtherDeployments };
  },
});

/* -------------------------------------------------------------------------- */
/* Keeping the workspace true                                                  */
/* -------------------------------------------------------------------------- */

/**
 * How long to wait before rebuilding, so a burst of changes is one redeploy.
 *
 * A founder connecting TikTok, Instagram and YouTube does it in under a minute;
 * rebuilding on each would take her machine down three times during the hour
 * she is most likely to be talking to it.
 */
export const WORKSPACE_REFRESH_DELAY_MS = 5 * 60_000;

/**
 * Mark the workspace out of date, and schedule one rebuild.
 *
 * ⚠️ Idempotent by design: if a refresh is already pending, this does nothing
 * but leave the marker set. The debounce IS the marker, so callers can be
 * enthusiastic without coordinating.
 */
export const markWorkspaceStale = internalMutation({
  args: { customerId: v.id("customers"), reason: v.string() },
  handler: async (ctx, args): Promise<{ scheduled: boolean }> => {
    const customer = (await ctx.db.get(args.customerId)) as Doc<"customers"> | null;
    if (!customer) return { scheduled: false };

    // Nothing to refresh until there is a machine to refresh.
    if (!customer.flyAppName) return { scheduled: false };
    if (customer.workspaceStaleAt !== undefined) return { scheduled: false };

    await ctx.db.patch(args.customerId, { workspaceStaleAt: Date.now() });
    await ctx.scheduler.runAfter(
      WORKSPACE_REFRESH_DELAY_MS,
      internal.maya.deploy.refreshWorkspace,
      { customerId: args.customerId, reason: args.reason }
    );
    return { scheduled: true };
  },
});

/** Clears the marker. Separate so the action can run it before the rebuild. */
export const clearWorkspaceStale = internalMutation({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args): Promise<null> => {
    await ctx.db.patch(args.customerId, { workspaceStaleAt: undefined });
    return null;
  },
});

/**
 * Rebuild her workspace from current rows.
 *
 * ⭐ This is a REDEPLOY, and that is the point rather than a shortcut: the
 * deploy path already find-or-creates the app and reuses the existing VOLUME,
 * so `MEMORY.md`, her memory store and her dreams all survive. What changes is
 * the doctrine — platform norms, the plan, the product truth — which is exactly
 * the half that was frozen.
 *
 * ⚠️ The marker is cleared BEFORE the rebuild, not after. A rebuild that throws
 * must leave the customer able to be marked stale again; clearing afterwards
 * would strand them with a permanently pending refresh that never re-arms.
 */
export const refreshWorkspace = internalAction({
  args: { customerId: v.id("customers"), reason: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ ok: boolean; detail: string }> => {
    await ctx.runMutation(internal.maya.deploy.clearWorkspaceStale, {
      customerId: args.customerId,
    });

    const result = await ctx.runAction(internal.maya.deploy.deployMachine, {
      customerId: args.customerId,
      image: (await import("./setup")).DEFAULT_IMAGE,
    });

    if (!result.ok) {
      /**
       * ⚠️ Named, not silent (§5). A machine still running the old doctrine is
       * a working agent with stale beliefs — the least visible failure there is.
       */
      console.error(
        `[deploy] workspace refresh failed for ${args.customerId} (${args.reason ?? "unspecified"}): ${result.error}`
      );
      return { ok: false, detail: result.error };
    }

    return { ok: true, detail: `rebuilt after ${args.reason ?? "a change"}` };
  },
});
