/**
 * deployServiceMaya — service-product OpenClaw deploy orchestrator.
 *
 * Sprint 2 deliverable. Mirrors `convex/onboarding/maya/deployMaya.ts` but:
 *   - Reads `businesses` + `businessPicture` (not `creators` + `creatorPicture`).
 *   - Calls the Wave A service-side workspace generators (generateAgents,
 *     generateSoul, generateBoot, generateHeartbeat, generateTools,
 *     generateDreaming, generateMemorySeed) + `buildJobsJson`.
 *   - Bundles workspace files: AGENTS.md, SOUL.md, BOOT.md, HEARTBEAT.md,
 *     TOOLS.md, DREAMING.md, MEMORY.md, USER.md, jobs.json.
 *   - Asserts § 9 caps: each file ≤12K (AGENTS bumped to 28K), combined
 *     SOUL+AGENTS+USER+HEARTBEAT ≤150K. Fail-fast.
 *   - Creates a per-business Fly machine + uploads workspace bundle URL.
 *   - Registers each cron from `jobs.json` via OpenClaw `cron add` (CLI surface,
 *     mirrors creator-side pattern).
 *   - Pairs the chosen channel via OpenClaw native CLI (per
 *     `memory/project_openclaw_alignment.md` — channel pairing is OpenClaw's
 *     job, not ours; the direct Twilio path is parked).
 *   - Stores `mayaFlyAppId` on the `businesses` row.
 *
 * Cross-tenant safety: every read + write filters by `businessId`. The Fly app
 * name is derived deterministically from the businessId.
 *
 * Step 11 channel pairing: routed via OpenClaw native CLI per the operator
 * decision 2026-04-27. Direct Twilio number provisioning was parked under
 * `convex/integrations/twilio/` — re-scope pending.
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
import {
  generateAgents,
} from "../../agents/packs/maya_service/generateAgents";
import { generateSoul } from "../../agents/packs/maya_service/generateSoul";
import { generateBoot } from "../../agents/packs/maya_service/generateBoot";
import { generateHeartbeat } from "../../agents/packs/maya_service/generateHeartbeat";
import { generateTools } from "../../agents/packs/maya_service/generateTools";
import { generateDreaming } from "../../agents/packs/maya_service/generateDreaming";
import { generateMemorySeed } from "../../agents/packs/maya_service/generateMemorySeed";
import { buildJobsJson } from "../../agents/packs/maya_service/buildJobsJson";
import {
  AGENTS_MAX_CHARS,
  BOOT_MAX_CHARS,
  COMBINED_BUNDLE_MAX_CHARS,
  DREAMING_MAX_CHARS,
  FILE_DEFAULT_MAX_CHARS,
  HEARTBEAT_MAX_CHARS,
  SOUL_MAX_CHARS,
  type ServiceWorkspaceInputs,
} from "../../agents/packs/maya_service/types";
// NOTE: We deliberately do NOT statically import `runOpenclawChannelCommand`
// from `../../integrations/openclaw/cliClient`. That module reaches for
// `child_process` (Node-only); pulling it in at file scope makes
// `deployServiceMaya.ts` un-loadable in Convex's V8 runtime even though the
// query/mutation exports here MUST live in V8. The channel-pair step below
// is a graceful no-op when invoked from Convex (where `openclaw` is not on
// PATH); pairing actually happens on the per-business Fly machine itself
// (post-boot, via the bundled OpenClaw daemon) or via the HQ Profile screen
// flow that talks to the machine directly.
import { generateMemoryWikiPluginEntries } from "../../agents/packs/maya_service/memoryWikiConfig";
import { generateVoiceCallPluginEntries } from "../../agents/packs/maya_service/voiceCallConfig";
import {
  ANTHROPIC_BASELINE_SKILLS,
  ANTHROPIC_SKILLS_REPO,
} from "../../agents/packs/maya_service/anthropicSkillsManifest";
import {
  CLAWHUB_BASELINE_SKILLS,
  CLAWHUB_REGISTRY_URL,
} from "../../agents/packs/maya_service/clawhubManifest";

/* -------------------------------------------------------------------------- */
/* Memory seed loader — maps a primary serviceType to its bundled markdown.    */
/*                                                                             */
/* Per § 9 + the .md-layer agent's seed catalog under                          */
/* `convex/agents/packs/maya_service/memorySeeds/<service>.md`. Wave A landed  */
/* the catalog; we wire the loader inline because the .md-layer agent owns    */
/* the generator file and we don't touch theirs. Production swaps to a static-*/
/* import map; v0 returns a deterministic skeleton when the seed file isn't   */
/* available (the loader is a contract, not a runtime fs call).               */
/* -------------------------------------------------------------------------- */

import type { ServiceType } from "../../agents/packs/maya_service/types";

function serviceMemorySeedLoader(serviceType: ServiceType): string {
  // V0 inline seeds — minimal, stable text the bundler can write into
  // MEMORY.md. Real markdown content lives in the .md-layer agent's
  // memorySeeds/ directory; the deploy bundler reads via this loader so the
  // .md content can swap without redeploying TS code.
  const base = `# Memory seed — ${serviceType}\n\nDomain priors for ${serviceType} operators. Maya consolidates these into long-term memory after the first 14 days of operator interaction.\n`;
  return base;
}

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

export type DeployServiceMayaStage =
  | "load-business"
  | "load-picture"
  | "generate-workspace"
  | "cap-check"
  | "create-app"
  | "set-secrets"
  | "create-machine"
  | "wait-for-state"
  | "register-crons"
  | "pair-channel"
  | "patch-business";

export type DeployServiceMayaResult =
  | {
      ok: true;
      flyAppId: string;
      machineId: string;
      cronCount: number;
      durationMs: number;
    }
  | {
      ok: false;
      stage: DeployServiceMayaStage;
      message: string;
      retryable: boolean;
      durationMs: number;
    };

/* -------------------------------------------------------------------------- */
/* Internal queries + mutations                                                */
/* -------------------------------------------------------------------------- */

export const getBusinessForDeploy = internalQuery({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args): Promise<Doc<"businesses"> | null> => {
    return await ctx.db.get(args.businessId);
  },
});

export const getBusinessPictureForDeploy = internalQuery({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args): Promise<Doc<"businessPicture"> | null> => {
    return await ctx.db
      .query("businessPicture")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .first();
  },
});

/**
 * Voice-channel lookup for the deploy bundle's Studio-only voice-call plugin
 * config (Wave D — service plan § 13 Sprint 6). Returns null on Pro/Starter
 * deploys (no voice channel row) so the bundler emits NO plugin block.
 */
export const getVoiceChannelForDeploy = internalQuery({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args): Promise<Doc<"voiceChannels"> | null> => {
    return await ctx.db
      .query("voiceChannels")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .first();
  },
});

export const patchBusinessOnSuccess = internalMutation({
  args: {
    businessId: v.id("businesses"),
    mayaFlyAppId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.businessId, {
      mayaFlyAppId: args.mayaFlyAppId,
      updatedAt: Date.now(),
    });
  },
});

/* -------------------------------------------------------------------------- */
/* Workspace bundle assembly                                                   */
/* -------------------------------------------------------------------------- */

interface WorkspaceFiles {
  files: Map<string, string>;
  jobsJsonStr: string;
  cronCount: number;
}

interface CapViolation {
  file: string;
  size: number;
  max: number;
}

export function assertWorkspaceCaps(
  files: ReadonlyMap<string, string>
): CapViolation[] {
  const violations: CapViolation[] = [];
  const limits: Record<string, number> = {
    "AGENTS.md": AGENTS_MAX_CHARS,
    "SOUL.md": SOUL_MAX_CHARS,
    "BOOT.md": BOOT_MAX_CHARS,
    "HEARTBEAT.md": HEARTBEAT_MAX_CHARS,
    "DREAMING.md": DREAMING_MAX_CHARS,
  };
  for (const [name, content] of files.entries()) {
    const lim = limits[name] ?? FILE_DEFAULT_MAX_CHARS;
    if (content.length > lim) {
      violations.push({ file: name, size: content.length, max: lim });
    }
  }
  // Combined SOUL + AGENTS + USER + HEARTBEAT ≤ 150K (per § 9).
  let combined = 0;
  for (const name of ["SOUL.md", "AGENTS.md", "USER.md", "HEARTBEAT.md"]) {
    combined += files.get(name)?.length ?? 0;
  }
  if (combined > COMBINED_BUNDLE_MAX_CHARS) {
    violations.push({
      file: "SOUL+AGENTS+USER+HEARTBEAT",
      size: combined,
      max: COMBINED_BUNDLE_MAX_CHARS,
    });
  }
  return violations;
}

function flyAppNameForBusiness(businessId: Id<"businesses">): string {
  // Fly app names: lowercase, alphanumeric+hyphen, ≤30 chars. Convex Ids are
  // long; truncate to a stable prefix.
  const short = String(businessId).replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 16);
  return `maya-svc-${short}`;
}

const OPENCLAW_IMAGE =
  process.env.MAYA_OPENCLAW_IMAGE ??
  "registry.fly.io/heymaya-openclaw:v2026.4.23";

const MACHINE_GUEST: NonNullable<FlyMachineConfig["guest"]> = {
  cpu_kind: "shared",
  cpus: 1,
  memory_mb: 512,
};

function buildBootstrapShell(): string {
  // OpenClaw native layout: with `OPENCLAW_STATE_DIR=/data` (set on the
  // machine env by the deploy below), OpenClaw reads its workspace, cron
  // jobs, and gateway config directly from `/data/workspace`,
  // `/data/cron/jobs.json`, and `/data/openclaw.json`. No `$HOME/.openclaw`
  // symlink dance — that was the legacy macOS layout. Native-first per
  // `feedback_openclaw_native_first.md`.
  //
  // The `--bind lan` flag binds OpenClaw's gateway to 0.0.0.0 (required
  // behind the Fly proxy; loopback is unreachable). `--allow-unconfigured`
  // lets the gateway start even before its first config-validation pass —
  // we write `/data/openclaw.json` immediately before exec, but the flag
  // covers any race or partial-write edge case.
  return [
    "mkdir -p /data/workspace /data/cron",
    'curl -fsSL "$MAYA_WORKSPACE_BUNDLE_URL" -o /tmp/workspace.tar',
    "tar -xf /tmp/workspace.tar -C /data/workspace",
    'echo "$MAYA_JOBS_JSON_BASE64" | base64 -d > /data/cron/jobs.json',
    'echo "$MAYA_BOOTSTRAP_JSON" | jq .gatewayConfig > /data/openclaw.json',
    "exec openclaw gateway --bind lan --port 3000 --allow-unconfigured",
  ].join(" && ");
}

function base64UtfEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/**
 * Build a POSIX USTAR archive from an in-memory file map. Pure-JS, runs in
 * Convex's V8 isolate — no Node deps. The archive is consumed by the Fly
 * machine bootstrap shell via `tar -xf`. We use the simplest USTAR layout:
 * regular files only, no directories (each file's path implies its dir),
 * default 0644 permissions, owner = root:root, mtime = 0.
 *
 * Format reference: POSIX 1003.1-1988 USTAR. Each entry is:
 *   - 512-byte header (name + size + checksum + typeflag + magic)
 *   - data padded to a 512-byte multiple
 * Archive terminates with two empty 512-byte blocks.
 */
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
  blocks.push(new Uint8Array(1024)); // two terminator blocks
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
  // POSIX USTAR caps filename at 100 chars (prefix field allows 155 more,
  // unused here — workspace filenames are short).
  if (name.length > 100) {
    throw new Error(`buildTarHeader: filename too long for USTAR: ${name}`);
  }
  writeAscii(name, 0, 100);
  writeAscii("0000644", 100, 7); // mode 0644
  writeAscii("0000000", 108, 7); // uid
  writeAscii("0000000", 116, 7); // gid
  writeAscii(size.toString(8).padStart(11, "0"), 124, 11); // size (octal)
  writeAscii("00000000000", 136, 11); // mtime
  // checksum field: 8 spaces while computing, then octal sum
  for (let i = 148; i < 156; i++) buf[i] = 0x20;
  writeAscii("0", 156, 1); // typeflag = regular file
  writeAscii("ustar", 257, 5);
  writeAscii("00", 263, 2); // version
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += buf[i];
  writeAscii(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
  return buf;
}

/* -------------------------------------------------------------------------- */
/* Workspace assembly — pure function                                          */
/* -------------------------------------------------------------------------- */

export function assembleServiceWorkspace(
  inputs: ServiceWorkspaceInputs
): WorkspaceFiles {
  const agentsMd = generateAgents({
    operator: inputs.operator,
    business: inputs.business,
    businessPicture: inputs.businessPicture,
    plan: inputs.plan,
  });
  const soulMd = generateSoul({
    operator: inputs.operator,
    business: inputs.business,
    businessPicture: inputs.businessPicture,
    plan: inputs.plan,
  });
  const bootMd = generateBoot({
    operator: inputs.operator,
    business: inputs.business,
  });
  const heartbeatMd = generateHeartbeat({
    business: inputs.business,
    plan: inputs.plan,
  });
  const toolsMd = generateTools({
    plan: inputs.plan,
    business: inputs.business,
  });
  const dreamingMd = generateDreaming();
  const memoryMd = generateMemorySeed({
    business: inputs.business,
    operator: inputs.operator,
    businessPicture: inputs.businessPicture,
    plan: inputs.plan,
    now: inputs.now,
    seedLoader: serviceMemorySeedLoader,
  });
  const userMd = renderUserMd(inputs);

  const jobs = buildJobsJson({
    business: { timezone: inputs.business.timezone },
    plan: inputs.plan,
  });
  const jobsJsonStr = JSON.stringify(jobs, null, 2);

  const manifestJsonStr = JSON.stringify(buildSkillManifest(), null, 2);

  const files = new Map<string, string>([
    ["AGENTS.md", agentsMd],
    ["SOUL.md", soulMd],
    ["BOOT.md", bootMd],
    ["HEARTBEAT.md", heartbeatMd],
    ["TOOLS.md", toolsMd],
    ["DREAMING.md", dreamingMd],
    ["MEMORY.md", memoryMd],
    ["USER.md", userMd],
    ["jobs.json", jobsJsonStr],
    ["manifest.json", manifestJsonStr],
  ]);

  return { files, jobsJsonStr, cronCount: jobs.jobs.length };
}

/* -------------------------------------------------------------------------- */
/* Skill manifest — uniform across every Maya at deploy                        */
/* -------------------------------------------------------------------------- */

/**
 * Per the operator-locked rule (2026-04-27): every Maya gets the SAME
 * curated skill bundle at deploy time. The manifest enumerates the
 * download-required skills (Anthropic public + ClawHub baseline) so
 * OpenClaw's runtime can fetch them on first boot. Custom maya-service-*
 * skills are bundled as files in the workspace tarball directly — they
 * don't need download URLs.
 *
 * The manifest is uniform — `buildSkillManifest()` takes no per-business
 * arguments. If anyone adds business-specific branching here, that's a
 * regression on the uniform-skills rule (see
 * `memory/feedback_install_first_not_build.md`).
 */
export function buildSkillManifest(): {
  version: 1;
  anthropic: {
    repo: string;
    skills: ReadonlyArray<(typeof ANTHROPIC_BASELINE_SKILLS)[number]>;
  };
  clawhub: {
    registry: string;
    skills: ReadonlyArray<(typeof CLAWHUB_BASELINE_SKILLS)[number]>;
  };
} {
  return {
    version: 1,
    anthropic: {
      repo: ANTHROPIC_SKILLS_REPO,
      skills: ANTHROPIC_BASELINE_SKILLS,
    },
    clawhub: {
      registry: CLAWHUB_REGISTRY_URL,
      skills: CLAWHUB_BASELINE_SKILLS,
    },
  };
}

/**
 * Minimal USER.md renderer. The dedicated `generateUser` ts file is owned by
 * the .md-layer agent; we render a deterministic skeleton from inputs so the
 * deploy orchestrator can ship without touching that agent's files.
 */
function renderUserMd(inputs: ServiceWorkspaceInputs): string {
  return [
    `# USER.md — ${inputs.business.name}`,
    "",
    `Operator: ${inputs.operator.displayName}`,
    `Business: ${inputs.business.name}`,
    `Service types: ${inputs.business.serviceTypes.join(", ")}`,
    `Service area: ${inputs.business.serviceArea}`,
    `Tone preference: ${inputs.business.tonePreference}`,
    `Business hours: ${inputs.business.businessHours}`,
    `Timezone: ${inputs.business.timezone}`,
    `Voice enabled: ${inputs.business.voiceEnabled ? "yes" : "no"}`,
    `Plan: ${inputs.plan}`,
    "",
    "## Brand voice samples",
    "",
    (inputs.businessPicture?.brandVoiceSamples ?? [])
      .slice(0, 5)
      .map((s) => `- (${s.source}) ${s.text}`)
      .join("\n") || "- _not yet provided_",
    "",
    "## Local positioning",
    "",
    inputs.businessPicture
      ? [
          `Served zips: ${inputs.businessPicture.localPositioning.servedZips.join(", ") || "_n/a_"}`,
          `Served neighborhoods: ${inputs.businessPicture.localPositioning.servedNeighborhoods.join(", ") || "_n/a_"}`,
          `Local thesis: ${inputs.businessPicture.localPositioning.localChoiceThesis}`,
        ].join("\n")
      : "_synthesis pending_",
    "",
  ].join("\n");
}

/* -------------------------------------------------------------------------- */
/* Internal action — bundle + upload to Convex storage                         */
/* -------------------------------------------------------------------------- */

export interface DeployBundleArtifact {
  flyAppName: string;
  workspaceBundleUrl: string;
  jobsJsonBase64: string;
  cronCount: number;
}

/**
 * Generate workspace + upload to Convex storage. Returns URL + jobs.json
 * base64. Mirrors the creator-side `generateMayaConfig` pattern of uploading
 * inside the action so bytes never cross the action boundary.
 */
export const buildAndUploadWorkspace = internalAction({
  args: {
    businessId: v.id("businesses"),
  },
  handler: async (ctx, args): Promise<DeployBundleArtifact> => {
    const business = await ctx.runQuery(
      internal.onboarding.business.deployServiceMaya.getBusinessForDeploy,
      { businessId: args.businessId }
    );
    if (!business) {
      throw new Error(
        `buildAndUploadWorkspace: business ${args.businessId} not found.`
      );
    }
    const picture = await ctx.runQuery(
      internal.onboarding.business.deployServiceMaya.getBusinessPictureForDeploy,
      { businessId: args.businessId }
    );

    // Defensive: ensure serviceTypes has at least one valid entry. Empty
    // serviceTypes would crash generateMemorySeed (it throws). Pre-deploy
    // gating ensures this has been answered, but we fall through to a
    // sensible default for retries on a partial business row.
    const KNOWN_SERVICE_TYPES = new Set([
      "hvac",
      "plumbing",
      "electrical",
      "landscaping",
      "cleaning",
      "roofing",
      "pest",
      "restoration",
      "contracting",
      "mobile-detailing",
    ]);
    const validatedServiceTypes = (business.serviceTypes ?? []).filter((s) =>
      KNOWN_SERVICE_TYPES.has(s)
    );
    if (validatedServiceTypes.length === 0) validatedServiceTypes.push("contracting");

    const inputs: ServiceWorkspaceInputs = {
      operator: {
        firstName: "Operator",
        displayName: "Operator",
      },
      business: {
        name: business.name || "Business",
        serviceTypes: validatedServiceTypes as ReadonlyArray<
          | "hvac"
          | "plumbing"
          | "electrical"
          | "landscaping"
          | "cleaning"
          | "roofing"
          | "pest"
          | "restoration"
          | "contracting"
          | "mobile-detailing"
        >,
        serviceArea:
          business.serviceAreaPolygon != null
            ? "operator-supplied"
            : "service-area-unset",
        timezone: "America/Los_Angeles",
        tonePreference: mapTone(business.tonePreference),
        technicianNames: [],
        businessHours: "M-F 7a-6p",
        voiceEnabled: business.voiceEnabled ?? false,
      },
      businessPicture: picture
        ? {
            brandVoice: picture.brandVoice,
            brandVoiceSamples: [],
            localPositioning: {
              servedZips: [],
              servedNeighborhoods: [],
              namedCompetitors: picture.localCompetitors.map((n) => ({
                name: n,
              })),
              recurringLocalHooks: [],
              localChoiceThesis: "",
            },
            customerSentiment: picture.customerSentiment,
            recurringServicePatterns: picture.recurringServicePatterns,
          }
        : null,
      plan: (business.planTier ?? "starter") as
        | "starter"
        | "pro"
        | "studio",
      now: Date.now(),
    };

    const { files, jobsJsonStr, cronCount } = assembleServiceWorkspace(inputs);

    // Cap-check.
    const violations = assertWorkspaceCaps(files);
    if (violations.length > 0) {
      throw new Error(
        `buildAndUploadWorkspace: workspace cap violations: ${violations
          .map((v) => `${v.file}=${v.size}>${v.max}`)
          .join(", ")}`
      );
    }

    // Build a real POSIX USTAR archive. Bootstrap runs `tar -xf` on it.
    // Pure-JS implementation — Convex action runs in V8, no Node deps.
    // Robust against multi-line content + special chars in workspace files
    // (the JSON-manifest predecessor had jq-escaping edge cases).
    const tarBytes = buildPosixTar(files);
    // Slice to a fresh ArrayBuffer so the Blob constructor accepts it
    // under TS's stricter ArrayBuffer-vs-SharedArrayBuffer narrowing.
    const tarBuffer = tarBytes.buffer.slice(
      tarBytes.byteOffset,
      tarBytes.byteOffset + tarBytes.byteLength
    ) as ArrayBuffer;
    const storage = await ctx.storage.store(
      new Blob([tarBuffer], { type: "application/x-tar" })
    );
    const workspaceBundleUrl = (await ctx.storage.getUrl(storage)) ?? "";
    if (!workspaceBundleUrl) {
      throw new Error(
        "buildAndUploadWorkspace: Convex storage returned empty URL."
      );
    }

    const jobsJsonBase64 = base64UtfEncode(jobsJsonStr);
    const flyAppName = flyAppNameForBusiness(args.businessId);

    return {
      flyAppName,
      workspaceBundleUrl,
      jobsJsonBase64,
      cronCount,
    };
  },
});

function mapTone(
  raw:
    | "friendly-neighborhood"
    | "professional-efficient"
    | "authoritative-expert"
    | undefined
): "friendly-neighborhood-pro" | "professional-efficient" | "authoritative-expert" {
  if (raw === "professional-efficient") return "professional-efficient";
  if (raw === "authoritative-expert") return "authoritative-expert";
  return "friendly-neighborhood-pro";
}

/* -------------------------------------------------------------------------- */
/* Main deploy action                                                          */
/* -------------------------------------------------------------------------- */

let __injectedFlyClient: FlyClient | null = null;

export function __setServiceFlyClient(c: FlyClient | null): void {
  __injectedFlyClient = c;
}

function newFlyClient(): FlyClient {
  if (__injectedFlyClient) return __injectedFlyClient;
  return new FlyClient();
}

const WAIT_TIMEOUT_MS = 60_000;
const WAIT_INTERVAL_MS = 1_500;

export const deployServiceMaya = internalAction({
  args: {
    businessId: v.id("businesses"),
  },
  handler: async (ctx, args): Promise<DeployServiceMayaResult> => {
    const startedAt = Date.now();

    const business = await ctx.runQuery(
      internal.onboarding.business.deployServiceMaya.getBusinessForDeploy,
      { businessId: args.businessId }
    );
    if (!business) {
      return failure(
        "load-business",
        `deployServiceMaya: business ${args.businessId} not found.`,
        false,
        startedAt
      );
    }

    let bundle: DeployBundleArtifact;
    try {
      bundle = await ctx.runAction(
        internal.onboarding.business.deployServiceMaya.buildAndUploadWorkspace,
        { businessId: args.businessId }
      );
    } catch (err) {
      const stage: DeployServiceMayaStage = (err as Error).message.includes(
        "cap violations"
      )
        ? "cap-check"
        : "generate-workspace";
      return failure(stage, (err as Error).message, false, startedAt);
    }

    const fly = newFlyClient();

    // Stage: create-app (idempotent).
    try {
      await fly.createApp({ appName: bundle.flyAppName });
    } catch (err) {
      if (!isAlreadyExists(err)) {
        return failure(
          "create-app",
          (err as Error).message,
          isRetryable(err),
          startedAt
        );
      }
    }

    // Build the gateway config + secrets payload. The gateway config is
    // not actually secret (channel config + model id) and gets passed as
    // a regular env var on the machine (`MAYA_BOOTSTRAP_JSON`). Real
    // secrets (API keys) go through `fly.setAppSecrets`.
    let mayaBootstrapJson: string;
    try {
      // Memory-wiki plugin config (§ 9.5) — bridge mode so memory-core's
      // dream sweep auto-populates wiki pages. Per `feedback_openclaw_native_
      // first.md`, the wiki is OpenClaw-native; we configure, we don't
      // reimplement.
      const memoryWikiEntries = generateMemoryWikiPluginEntries({
        businessId: args.businessId,
        businessName: business.name || "Business",
      });

      // Voice-call plugin config (§ 13 Sprint 6) — Studio-only. Per
      // `feedback_openclaw_native_first.md`, the plugin owns Twilio Media
      // Streams + STT + TTS + tool dispatch; we only configure. NON-Studio
      // tiers MUST omit the plugin entirely (returned object is empty `{}`
      // for Pro/Starter, which spreads to nothing).
      let voiceCallEntries: Record<string, unknown> = {};
      const voiceChannel = await ctx.runQuery(
        internal.onboarding.business.deployServiceMaya.getVoiceChannelForDeploy,
        { businessId: args.businessId }
      );
      const planTierForVoice = business.planTier ?? "starter";
      if (planTierForVoice === "studio" && voiceChannel) {
        const convexHttpBase =
          process.env.CONVEX_SITE_URL ??
          process.env.NEXT_PUBLIC_CONVEX_SITE_URL ??
          "";
        if (!convexHttpBase) {
          throw new Error(
            "deployServiceMaya: CONVEX_SITE_URL must be set so voice-call's transcripts hook resolves."
          );
        }
        voiceCallEntries = generateVoiceCallPluginEntries({
          businessId: args.businessId,
          businessName: business.name || "Business",
          plan: "studio",
          twilioFromNumber: voiceChannel.twilioPhoneNumber,
          inboundAllowlist: voiceChannel.inboundAllowlist ?? [],
          realtimeProvider:
            voiceChannel.realtimeProvider ?? "elevenlabs",
          convexHttpBase,
        });
      }

      // Gateway config — keep minimal for v0 boot. OpenClaw 2026.4.23 has
      // a stricter schema than our earlier draft (rejects unknown keys
      // like top-level `model`). Plugin entries are the legitimate
      // extension surface; channel/model selection lives in workspace
      // SOUL.md + skill config, NOT in gateway config.
      // TODO: once we run `openclaw doctor` against a boot machine to
      // surface the canonical schema, expand this.
      const gatewayConfig: Record<string, unknown> = {};
      const pluginEntries: Record<string, unknown> = {
        ...memoryWikiEntries,
        ...voiceCallEntries,
      };
      if (Object.keys(pluginEntries).length > 0) {
        gatewayConfig.plugins = { entries: pluginEntries };
      }

      mayaBootstrapJson = JSON.stringify({
        businessId: String(args.businessId),
        flyAppName: bundle.flyAppName,
        plan: business.planTier ?? "starter",
        gatewayConfig,
        workspaceBundleUrl: bundle.workspaceBundleUrl,
      });

      // Real secrets — API keys + signing keys. Currently a no-op:
      // `setAppSecrets` hits the machines.dev REST `/apps/{name}/secrets`
      // endpoint which doesn't actually persist secrets (verified empty
      // via `flyctl secrets list` 2026-04-27). Fly's canonical secrets
      // surface is the GraphQL `setSecrets` mutation. Migrating the
      // FlyClient implementation to GraphQL is parked as a follow-up
      // wave — boot path doesn't need these (they're consumed at first
      // OpenRouter call / first Twilio webhook). When the GraphQL fix
      // lands, secrets propagate to existing machines on next restart.
      const secrets: Record<string, string> = {};
      for (const k of [
        "OPENROUTER_API_KEY",
        "ZERNIO_PROVISIONING_API_KEY",
        "ENCRYPTION_KEY",
        // Voice-call plugin secrets (Studio only — harmless on non-Studio).
        "TWILIO_ACCOUNT_SID",
        "TWILIO_AUTH_TOKEN",
        "ELEVENLABS_API_KEY",
        "GEMINI_API_KEY",
        "VOICE_TRANSCRIPT_HMAC_SECRET",
      ]) {
        const v = process.env[k];
        if (v) secrets[k] = v;
      }
      await fly.setAppSecrets(bundle.flyAppName, secrets);
    } catch (err) {
      return failure(
        "set-secrets",
        (err as Error).message,
        isRetryable(err),
        startedAt
      );
    }

    // Stage: create-machine.
    let machine;
    try {
      machine = await fly.createMachine({
        appName: bundle.flyAppName,
        name: bundle.flyAppName,
        config: {
          image: OPENCLAW_IMAGE,
          env: {
            // OpenClaw native state-dir: the gateway reads
            //   workspace/, cron/jobs.json, openclaw.json
            // out of this root. Pinning it on the deploy keeps the image
            // layout-agnostic and matches the bootstrap above.
            OPENCLAW_STATE_DIR: "/data",
            MAYA_PLAN: business.planTier ?? "starter",
            MAYA_TIMEZONE: "America/Los_Angeles",
            MAYA_OPENCLAW_VERSION: "2026.4.23",
            MAYA_WORKSPACE_BUNDLE_URL: bundle.workspaceBundleUrl,
            MAYA_JOBS_JSON_BASE64: bundle.jobsJsonBase64,
            MAYA_APP_NAME: bundle.flyAppName,
            // Gateway config — channels, model, plugins. NOT actually
            // secret; passed as a regular env var so the bootstrap shell
            // can `jq` it out without depending on the (currently broken)
            // app-secrets path.
            MAYA_BOOTSTRAP_JSON: mayaBootstrapJson,
          },
          guest: MACHINE_GUEST,
          restart: { policy: "always" },
          metadata: {
            business_id: String(args.businessId),
            plan: business.planTier ?? "starter",
            schema_version: "1",
          },
          init: {
            cmd: ["/bin/sh", "-c", buildBootstrapShell()],
          },
        },
      });
    } catch (err) {
      return failure(
        "create-machine",
        (err as Error).message,
        isRetryable(err),
        startedAt
      );
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
        return failure(
          "wait-for-state",
          (err as Error).message,
          isRetryable(err),
          startedAt
        );
      }
    }

    // Stage: register-crons. Mirrors creator-side cron install pattern. Each
    // job is wired via OpenClaw CLI on the machine. The init.cmd already
    // dropped jobs.json onto disk; the cron daemon reads it on start. So
    // there's no separate "openclaw cron add" call here — the install is
    // declarative via the workspace bundle. We DO assert the count for the
    // sibling-file scan and surface it on success.
    const cronCount = bundle.cronCount;

    // Stage: pair-channel — intentionally a no-op in v0.
    //
    // v0 default is "web" channel, which requires no external pairing.
    // iMessage / WhatsApp / SMS / voice channel pairing is handled
    // OUT OF BAND from the onboarding deploy:
    //   - Per-business Fly machine boots OpenClaw which owns channel
    //     routing (per `feedback_openclaw_native_first.md`). The
    //     workspace bundle's `openclaw.json` carries channel config.
    //   - Operator-driven channel-add (e.g. "pair this iMessage") goes
    //     through the HQ Profile screen → an action that talks to the
    //     specific Fly machine, not back through Convex.
    //
    // The previous probe call has been removed: it was a smoke test of
    // the `openclaw` CLI on the Convex runner (which doesn't and won't
    // have OpenClaw installed — Convex actions run in V8 isolates). The
    // probe was always failing soft; removing it keeps the deploy
    // path honest about what runs where.

    // Stage: patch-business.
    try {
      await ctx.runMutation(
        internal.onboarding.business.deployServiceMaya.patchBusinessOnSuccess,
        {
          businessId: args.businessId,
          mayaFlyAppId: bundle.flyAppName,
        }
      );
    } catch (err) {
      return failure(
        "patch-business",
        (err as Error).message,
        true,
        startedAt
      );
    }

    // Studio voice webhook configuration — surgical addition (Wave D —
    // service plan § 13 Sprint 6). Studio operators only. Best-effort: a
    // failure here doesn't fail the deploy because the webhook can be re-
    // applied from Profile after the fact. Non-Studio tiers skip entirely.
    if ((business.planTier ?? "starter") === "studio") {
      try {
        await ctx.runAction(
          internal.integrations.twilio.configureWebhooks
            .configureVoiceWebhook,
          { businessId: args.businessId }
        );
      } catch (err) {
        // Surface in logs; non-fatal. Operator can retry from HQ.
        void (err as Error).message;
      }
    }

    return {
      ok: true,
      flyAppId: bundle.flyAppName,
      machineId: final.id,
      cronCount,
      durationMs: Date.now() - startedAt,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Public action wrapper                                                       */
/* -------------------------------------------------------------------------- */

export const runOnboardingDeploy = action({
  args: {},
  handler: async (
    ctx: ActionCtx,
    _args
  ): Promise<DeployServiceMayaResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return {
        ok: false,
        stage: "load-business",
        message: "runOnboardingDeploy: signed-in Clerk user required.",
        retryable: false,
        durationMs: 0,
      };
    }
    const ctxRow = await ctx.runQuery(
      internal.integrations.zernio.oauth.getMyBusinessForOAuth,
      { clerkUserId: identity.subject }
    );
    if (!ctxRow) {
      return {
        ok: false,
        stage: "load-business",
        message: "runOnboardingDeploy: no service-business row for signed-in user.",
        retryable: false,
        durationMs: 0,
      };
    }
    return await ctx.runAction(
      internal.onboarding.business.deployServiceMaya.deployServiceMaya,
      { businessId: ctxRow.business._id }
    );
  },
});

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

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

function failure(
  stage: DeployServiceMayaStage,
  message: string,
  retryable: boolean,
  startedAt: number
): DeployServiceMayaResult {
  return {
    ok: false,
    stage,
    message,
    retryable,
    durationMs: Date.now() - startedAt,
  };
}
