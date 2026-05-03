/**
 * configGeneratorMaya — single-agent OpenClaw bootstrap config builder.
 *
 * Sprint 3.7 phase C deliverable. Strips everything OpenClaw 2026.4.23 handles
 * natively (channels routing, heartbeat cadence, cron enablement table,
 * per-task thinking-budget map) and emits the minimal envelope OpenClaw
 * expects at machine boot:
 *
 *   - identity:        creatorId, plan, timezone, appName
 *   - gateway config:  the OpenClaw gateway YAML/JSON (channels, model,
 *                      bootstrapMaxChars override)
 *   - jobs.json:       the runtime cron config (per-creator, plan-tier-gated)
 *   - workspace:       a Convex-storage URL pointing at the tarball of
 *                      AGENTS.md / USER.md / HEARTBEAT.md / etc that the
 *                      Fly bootstrap script downloads + extracts
 *   - composio:        decrypted account credentials, kept as-is
 *   - model router:    Convex HTTP base so Maya proxies model calls back
 *
 * Channels:        OpenClaw gateway routes by `gatewayConfig.channels.enabled`;
 *                  no `channels.primary/fallbacks` — the gateway picks the
 *                  preferred channel from the enabled set per-message.
 * Heartbeat:       Cadence prose lives in `HEARTBEAT.md`. OpenClaw owns the
 *                  tick. We don't ship `intervalSec`.
 * Cron enablement: Replaced by `jobsJson` from `buildCronJobsJson`. The Fly
 *                  bootstrap installs jobs by writing
 *                  `~/.openclaw/cron/jobs.json` directly.
 * Thinking budget: Per-task defaults live in standing-orders prose. The
 *                  Convex model router still consults `taskTags.ts` for
 *                  per-call defaults; that's an internal concern Maya never
 *                  sees.
 *
 * Determinism:
 *   - Reads sort by stable id / platform.
 *   - No `Math.random`. No `Date.now()` except a single `generatedAt` field
 *     captured at the top of the call.
 *   - `version` = SHA-256-style FNV-1a 128-bit hex of canonical JSON of the
 *     config WITHOUT `generatedAt` and WITHOUT `workspaceBundleUrl` (the URL
 *     changes per upload but the underlying file set is deterministic, so we
 *     don't want it to churn the version).
 *
 * Plan-tier enforcement:
 *   - `planFeatures(creator)` is consulted server-side, fail-closed. Starter
 *     creators get web+sms only; Stripe-only providers; cron jobs are
 *     filtered by `buildCronJobsJson`.
 *
 * Cross-tenant safety:
 *   - Every read is `creatorId`-scoped. The function never reads another
 *     creator's data.
 */

import { v } from "convex/values";
import {
  internalAction,
  internalQuery,
  type QueryCtx,
} from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import type { Doc, Id } from "../../../_generated/dataModel";
import {
  planFeatures,
  type Channel,
  type Plan,
  type Provider,
} from "../../../lib/planFeatures";
import { decrypt } from "../../../lib/encryption";
import { assembleWorkspaceBundle } from "./workspace/assembleWorkspaceBundle";
import type { JobsJson } from "./workspace/buildCronJobsJson";
import { serializeWorkspaceBundle } from "./serializeWorkspaceBundle";

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A Composio account credential bundle. The `composioAccountId` is decrypted
 * from `connectedAccounts.composioAccountId` (which we store encrypted at
 * rest). Composio's universal runner takes the full id and negotiates
 * per-call.
 */
export interface ComposioAccountConfig {
  provider: Provider;
  composioAccountId: string;
  scopes: ReadonlyArray<string>;
  autoSendThreshold: number | null;
}

/**
 * Subset of OpenClaw's gateway configuration we control from this Convex
 * action. The full schema is defined upstream by OpenClaw; we only emit the
 * fields v0 needs to override.
 *
 * Reference: `https://docs.openclaw.ai/gateway/configuration-reference.md`.
 */
export interface GatewayConfig {
  agents: {
    defaults: {
      /**
       * Char cap for the AGENTS.md bootstrap blob. OpenClaw default is 12,000;
       * Maya overrides to 20,000 because our standing-orders inventory legitimately
       * needs more room (25+ programs × ~600 chars in the canonical
       * Scope/Triggers/Approval/Escalation format). See
       * `convex/agents/packs/maya/workspace/__tests__/assembleWorkspaceBundle.test.ts`
       * for the size-cap proof.
       */
      bootstrapMaxChars: number;
    };
  };
  channels: {
    /** Channel adapters the gateway should boot. Plan-tier-gated upstream. */
    enabled: ReadonlyArray<Channel>;
  };
  model: {
    provider: "openrouter";
    /** Model id the gateway uses for default-thinking calls. */
    id: string;
  };
}

export interface MayaConfig {
  schemaVersion: 1;
  openclawVersion: "2026.4.23";
  /** Used as the Fly app name. Stable per creator. */
  appName: string;
  creatorId: Id<"creators">;
  creatorEmail: string;
  plan: Plan;
  timezone: string;

  /**
   * OpenClaw gateway configuration. The Fly bootstrap writes this to disk
   * and starts the gateway with `openclaw gateway start --config <path>`.
   */
  gatewayConfig: GatewayConfig;

  /** Composio account bundles, decrypted at config-generation time. */
  composioAccounts: ReadonlyArray<ComposioAccountConfig>;

  /**
   * Convex storage URL for the per-creator workspace tarball. The Fly
   * bootstrap downloads from this URL, extracts to `~/.openclaw/workspace-default/`,
   * and starts the gateway. Excluded from `version` hash — see notes above.
   */
  workspaceBundleUrl: string;

  /**
   * Runtime cron config. The Fly bootstrap writes this to
   * `~/.openclaw/cron/jobs.json`. Embedded in the config envelope so the
   * bootstrap doesn't need a second HTTP round-trip just to install crons.
   */
  jobsJson: JobsJson;

  /** Where Maya posts model calls. */
  modelRouter: {
    /** Convex HTTP action surface base, from APP_URL or NEXT_PUBLIC_CONVEX_SITE_URL. */
    convexHttpBase: string;
    /** Internal action ref Maya proxies to. */
    callMayaActionPath: "agents/modelRouter/maya/callMaya";
  };

  /** Bookkeeping. Excluded from `version` hash so timestamp drift doesn't churn it. */
  generatedAt: number;
}

export interface MayaConfigBundle {
  config: MayaConfig;
  /** Hex digest of FNV-1a-128(canonical-JSON(config without generatedAt + workspaceBundleUrl)). */
  version: string;
  /**
   * Tarball of the workspace files. Returned only by the pure `buildMayaConfig`
   * function (for unit testing). The Convex action wrapper `generateMayaConfig`
   * uploads the bytes to Convex storage internally and returns
   * `MayaConfigDeployBundle` (no bytes) so the value never crosses the action
   * boundary — Convex's value serializer rejects `Uint8Array`.
   */
  workspaceBundleBytes: Uint8Array;
}

/**
 * Action-boundary-safe variant of `MayaConfigBundle`. `generateMayaConfig`
 * returns this so deployMaya can consume the config without ever touching raw
 * bytes — the workspace tarball is uploaded inside the action and the URL is
 * already patched onto `config.workspaceBundleUrl`.
 */
export interface MayaConfigDeployBundle {
  config: MayaConfig;
  version: string;
}

/* -------------------------------------------------------------------------- */
/* Core builder                                                                */
/* -------------------------------------------------------------------------- */

export interface BuildInputs {
  creator: Doc<"creators">;
  picture: Doc<"creatorPicture"> | null;
  handles: Doc<"creatorHandles">[];
  connectedAccounts: Doc<"connectedAccounts">[];
  /** Resolved decrypted composio account IDs, paired with the connectedAccount row. */
  decryptedComposioAccounts: Map<Id<"connectedAccounts">, string>;
}

/**
 * Char cap Maya overrides on top of OpenClaw's 12K default.
 *
 * Wave 5 (2026.4.23 migration): bumped 20K → 28K so the canonical
 * standing-orders inventory fits INSIDE AGENTS.md. Per
 * `https://docs.openclaw.ai/automation/standing-orders`, only AGENTS.md (and
 * the other root canonical files: SOUL.md, USER.md, HEARTBEAT.md, TOOLS.md,
 * MEMORY.md, BOOTSTRAP.md, IDENTITY.md) are auto-injected at session start —
 * arbitrary files like `standing-orders.md` in the workspace root are NOT
 * guaranteed to load. Splitting the standing-orders out was a pre-4.23
 * compromise. Now that we're on 4.23, we embed and let the cap grow.
 *
 * Empirical sizes (size-report test, 2026-04-26):
 *   - AGENTS.md WITHOUT standing orders: ~10K chars (all plans)
 *   - standing-orders.md (13 pro+ programs + 12 all-tier): ~13K chars
 *   - AGENTS.md WITH embedded standing orders for pro/studio: ~22K chars
 *   - Margin to 28K: ~6K — headroom for adding 1-2 more programs
 *
 * The 28K cap is our override; OpenClaw still respects whatever we declare
 * in `gatewayConfig.agents.defaults.bootstrapMaxChars`.
 */
export const MAYA_BOOTSTRAP_MAX_CHARS = 28_000;

/**
 * Build the OpenClaw config + workspace bundle for one creator. Pure function
 * — no Convex ctx or env access except `process.env.NEXT_PUBLIC_CONVEX_SITE_URL`
 * / `process.env.APP_URL` / `process.env.OPENROUTER_DEFAULT_MODEL` (resolved
 * here so tests can stub).
 *
 * `now` is injected for determinism in tests.
 *
 * `workspaceBundleUrl` is `""` on return — `deployMaya` uploads the bundle
 * bytes and patches the real URL in before shipping the config to Fly.
 */
export function buildMayaConfig(inputs: BuildInputs, now: number): MayaConfigBundle {
  const { creator, picture, handles, connectedAccounts, decryptedComposioAccounts } =
    inputs;
  const features = planFeatures(creator);

  // ---- handles: cap to plan max + sort for determinism ----
  const sortedHandles = [...handles].sort(handleSort).slice(0, features.maxHandles);

  // ---- composio accounts: filter by allowedProviders + sort for determinism ----
  const sortedAccounts = [...connectedAccounts].sort(accountSort);
  const composioAccounts: ComposioAccountConfig[] = [];
  for (const a of sortedAccounts) {
    if (!features.allowedProviders.includes(a.provider)) continue;
    if (a.scopeStatus !== "active") continue;
    const decrypted = decryptedComposioAccounts.get(a._id);
    if (!decrypted) continue; // decryption failed — fail closed; skip rather than crash
    composioAccounts.push({
      provider: a.provider,
      composioAccountId: decrypted,
      scopes: [...a.scopes].sort(),
      autoSendThreshold: a.autoSendThreshold ?? null,
    });
  }

  // ---- gateway config: bootstrapMaxChars override + plan-tier channel allowlist ----
  const gatewayConfig: GatewayConfig = {
    agents: {
      defaults: {
        bootstrapMaxChars: MAYA_BOOTSTRAP_MAX_CHARS,
      },
    },
    channels: {
      enabled: [...features.allowedChannels].sort() as ReadonlyArray<Channel>,
    },
    model: {
      provider: "openrouter",
      id: process.env.OPENROUTER_DEFAULT_MODEL ?? "google/gemini-3-flash-preview",
    },
  };

  // ---- workspace bundle: AGENTS.md / USER.md / HEARTBEAT.md / ... + jobs.json ----
  const bundle = assembleWorkspaceBundle(
    {
      creator,
      picture,
      handles: sortedHandles,
      connectedAccounts: sortedAccounts,
      plan: creator.plan,
      now,
    },
    { bootstrapMaxChars: MAYA_BOOTSTRAP_MAX_CHARS }
  );
  const workspaceBundleBytes = serializeWorkspaceBundle(bundle.files);

  // ---- model router endpoint base ----
  const convexHttpBase =
    process.env.NEXT_PUBLIC_CONVEX_SITE_URL ??
    process.env.APP_URL ??
    "http://localhost:3000";

  const appName = `maya-${shortIdSegment(creator._id)}`;

  const config: MayaConfig = {
    schemaVersion: 1,
    openclawVersion: "2026.4.23",
    appName,
    creatorId: creator._id,
    creatorEmail: creator.email,
    plan: creator.plan,
    timezone: creator.timezone,
    gatewayConfig,
    composioAccounts,
    workspaceBundleUrl: "", // populated by deployMaya after uploading the tarball
    jobsJson: bundle.jobsJson,
    modelRouter: {
      convexHttpBase,
      callMayaActionPath: "agents/modelRouter/maya/callMaya",
    },
    generatedAt: now,
  };

  const version = hashConfig(config);
  return { config, version, workspaceBundleBytes };
}

/* -------------------------------------------------------------------------- */
/* Sort + hash helpers                                                         */
/* -------------------------------------------------------------------------- */

function handleSort(a: Doc<"creatorHandles">, b: Doc<"creatorHandles">): number {
  if (a.platform !== b.platform) return a.platform.localeCompare(b.platform);
  return a.handle.localeCompare(b.handle);
}

function accountSort(a: Doc<"connectedAccounts">, b: Doc<"connectedAccounts">): number {
  if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
  return a._id.localeCompare(b._id);
}

/** First 8 chars of the doc id — stable, URL-safe, low collision for our scale. */
function shortIdSegment(id: Id<"creators">): string {
  return id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toLowerCase();
}

/**
 * Deterministic 128-bit FNV-1a hash of the config, hex-encoded. Excludes
 * `generatedAt` (timestamp drift) and `workspaceBundleUrl` (changes per
 * upload even when the underlying workspace bytes are identical).
 *
 * Canonical JSON: keys sorted at every object level. Arrays preserve order
 * (we sort upstream where stability matters).
 */
function hashConfig(config: MayaConfig): string {
  const rest: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(config)) {
    if (k === "generatedAt" || k === "workspaceBundleUrl") continue;
    rest[k] = val;
  }
  return fnv1a128(canonicalJson(rest));
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const entries = keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`);
  return `{${entries.join(",")}}`;
}

/**
 * 128-bit FNV-1a hash of a UTF-8 string, hex-encoded.
 * Pure JS, sync, deterministic, no crypto dep — ideal for change-detection
 * version stamps. Not for security.
 */
function fnv1a128(str: string): string {
  const FNV_PRIME: [number, number, number, number] = [0x0000_0000, 0x0100_0000, 0x0000_0000, 0x0000_013b];
  let h: [number, number, number, number] = [
    0x6c62272e, 0x07bb0142, 0x62b82175, 0x6295c58d,
  ];
  const bytes = new TextEncoder().encode(str);
  for (let i = 0; i < bytes.length; i++) {
    h[3] = (h[3] ^ bytes[i]) >>> 0;
    h = mul128(h, FNV_PRIME);
  }
  return toHex32(h[0]) + toHex32(h[1]) + toHex32(h[2]) + toHex32(h[3]);
}

function mul128(
  a: [number, number, number, number],
  b: [number, number, number, number]
): [number, number, number, number] {
  const out = [0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 3; i >= 0; i--) {
    let carry = 0;
    for (let j = 3; j >= 0; j--) {
      const lo = (a[i] & 0xffff) * (b[j] & 0xffff);
      const mi1 = (a[i] >>> 16) * (b[j] & 0xffff);
      const mi2 = (a[i] & 0xffff) * (b[j] >>> 16);
      const hi = (a[i] >>> 16) * (b[j] >>> 16);
      const sum =
        lo +
        ((mi1 & 0xffff) << 16) +
        ((mi2 & 0xffff) << 16) +
        out[i + j + 1] +
        carry;
      out[i + j + 1] = sum >>> 0;
      carry = ((mi1 >>> 16) + (mi2 >>> 16) + hi + Math.floor(sum / 0x100000000)) >>> 0;
    }
    out[i] = (out[i] + carry) >>> 0;
  }
  return [out[4] >>> 0, out[5] >>> 0, out[6] >>> 0, out[7] >>> 0];
}

function toHex32(n: number): string {
  return (n >>> 0).toString(16).padStart(8, "0");
}

/* -------------------------------------------------------------------------- */
/* Convex internal surface                                                     */
/* -------------------------------------------------------------------------- */

/** Internal query — load every input row in one transaction. */
export const loadConfigInputs = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (
    ctx: QueryCtx,
    args
  ): Promise<{
    creator: Doc<"creators"> | null;
    picture: Doc<"creatorPicture"> | null;
    handles: Doc<"creatorHandles">[];
    connectedAccounts: Doc<"connectedAccounts">[];
  }> => {
    const creator = await ctx.db.get(args.creatorId);
    if (!creator) {
      return { creator: null, picture: null, handles: [], connectedAccounts: [] };
    }
    const handles = await ctx.db
      .query("creatorHandles")
      .withIndex("by_creator", (q) => q.eq("creatorId", args.creatorId))
      .collect();
    const connectedAccounts = await ctx.db
      .query("connectedAccounts")
      .withIndex("by_creator", (q) => q.eq("creatorId", args.creatorId))
      .collect();
    // creatorPicture has at most one row per creator (Sprint 2 generator
    // overwrites). If multiple exist, take the most recent by generatedAt.
    const pictures = await ctx.db
      .query("creatorPicture")
      .withIndex("by_creator", (q) => q.eq("creatorId", args.creatorId))
      .collect();
    const picture =
      pictures.length === 0
        ? null
        : pictures.reduce((latest, p) =>
            p.generatedAt > latest.generatedAt ? p : latest
          );
    return { creator, picture, handles, connectedAccounts };
  },
});

/**
 * Generate the bootstrap config for one Maya, upload the workspace tarball to
 * Convex storage, and patch the resulting URL onto `config.workspaceBundleUrl`.
 *
 * The upload happens INSIDE this action because Convex's action-boundary value
 * serializer rejects `Uint8Array`; bytes never cross the boundary. The deploy
 * caller (`deployMaya`) just consumes `config.workspaceBundleUrl` directly.
 *
 * The version hash is computed by `buildMayaConfig` BEFORE the URL is patched
 * in (workspaceBundleUrl is excluded from the hash anyway — see `hashConfig`),
 * so re-uploads don't churn the version stamp.
 *
 * Convex `internalAction` so decryption + storage can run.
 */
export const generateMayaConfig = internalAction({
  args: {
    creatorId: v.id("creators"),
    /** Test seam — overrides Date.now() for determinism. */
    nowOverride: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<MayaConfigDeployBundle> => {
    const inputs = await ctx.runQuery(
      internal.agents.packs.maya.configGeneratorMaya.loadConfigInputs,
      { creatorId: args.creatorId }
    );
    if (!inputs.creator) {
      throw new Error(
        `configGeneratorMaya: creator ${args.creatorId} not found.`
      );
    }
    // Decrypt every connected account's composioAccountId. We store the field
    // as ciphertext in `connectedAccounts.composioAccountId`. Fail-closed: if
    // a single account fails to decrypt we skip it (Maya boots without that
    // integration) rather than crash the whole deploy.
    const decrypted = new Map<Id<"connectedAccounts">, string>();
    for (const a of inputs.connectedAccounts) {
      try {
        const plain = await decrypt(a.composioAccountId);
        decrypted.set(a._id, plain);
      } catch {
        // Skip; deploy continues. Reconnection lives at the connectedAccounts row.
      }
    }
    const now = args.nowOverride ?? Date.now();
    const bundle = buildMayaConfig(
      {
        creator: inputs.creator,
        picture: inputs.picture,
        handles: inputs.handles,
        connectedAccounts: inputs.connectedAccounts,
        decryptedComposioAccounts: decrypted,
      },
      now
    );

    // Upload workspace tarball to Convex storage. We slice the underlying
    // ArrayBuffer to be safe even when the Uint8Array is a view over a larger
    // buffer.
    const bytes = bundle.workspaceBundleBytes;
    const blob = new Blob(
      [
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        ) as ArrayBuffer,
      ],
      { type: "application/x-tar" }
    );
    const storageId = await ctx.storage.store(blob);
    const workspaceBundleUrl = await ctx.storage.getUrl(storageId);
    if (!workspaceBundleUrl) {
      throw new Error(
        "generateMayaConfig: ctx.storage.getUrl returned null for fresh upload"
      );
    }

    return {
      config: { ...bundle.config, workspaceBundleUrl },
      version: bundle.version,
    };
  },
});
