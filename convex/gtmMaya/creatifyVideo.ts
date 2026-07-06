/**
 * Studio-tier video orchestration (Creatify).
 *
 * The agent-facing tools (Phase 3) call the HTTP actions here; each starts a
 * Creatify job and returns immediately. A DURABLE self-rescheduling poller
 * (`pollVideoJob`, via ctx.scheduler — survives Fly restarts, unlike a blocking
 * action) drives the job to completion, then:
 *   1. re-hosts the finished `video_output` into Convex storage (Creatify S3
 *      URLs are NOT durable — see docs/CREATIFY_API_REFERENCE.md §1), landing it
 *      in the media library as a kind:"video" entry the agent can deliver via
 *      the existing send_media_to_user;
 *   2. records the credit cost to gtmCostLedger (provider:"creatify") for COGS
 *      visibility — EXCLUDED from the operational caps + spend-kill (it has its
 *      own videoCreditsMonth budget; see costCap.ts / spendKill.ts).
 *
 * In-flight + finished job state lives on gtmAgents.creatifyJobsJson (JSON-on-
 * row — schema is at the TS table ceiling, no new table). Vendor specifics stay
 * sealed in convex/integrations/creatify/; this module only orchestrates.
 *
 * NOTE: Tier gating (Studio-only) is enforced server-side in Phase 5 — the HTTP
 * actions here will consult planFeaturesGtm(canVideo) before starting a job.
 */

import { v } from "convex/values";
import {
  httpAction,
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { authenticate } from "./openclaw/inboundCallback";
import { planFeaturesGtm } from "./planGtm";
import { isCreatifyConfigured } from "../integrations/creatify/client";
import {
  createAdClone,
  createIabImages,
  createLinkFromUrl,
  createLinkToVideo,
  createLinkToVideoPreviews,
  createLipsyncV2,
  createLipsyncWithAurora,
  createInspirationJob,
  getCreatifyJob,
  getInspirations,
  getPersonasV2,
  getRemainingCredits,
  getVoices,
  renderLinkToVideoPreview,
  updateLink,
} from "../integrations/creatify/endpoints";
import {
  isDoneStatus,
  isFailedStatus,
  type CreatifyJob,
} from "../integrations/creatify/types";

// The two production VIDEO flows wired in Phase 2 (aurora/product_video later).
type VideoMode = "ad_clone" | "url_to_video";
// Static-image flow for the Growth $149 tier (canImage). iab_images is the
// clean 2cr path; asset_gen stays deferred (schema-driven/runtime roster).
type ImageMode = "iab_images";
// Aurora UGC avatar video — Studio-only, paced by the creative CREDIT budget
// (creativeBudgetGate), NOT the standard videoCreditsMonth count cap.
type UgcMode = "ugc_avatar" | "ugc_avatar_v2";
/** Inspiration template renders (gen_type image|video decided per template). */
type InspirationMode = "inspiration";
/** Any persisted Creatify job — video, image, UGC, or inspiration — share the poll loop. */
type JobMode = VideoMode | ImageMode | UgcMode | InspirationMode;

/** True for the static-image modes (gated by canImage + assetCreditsMonth). */
function isImageMode(mode: JobMode): mode is ImageMode {
  return mode === "iab_images";
}

/** Does this job produce an IMAGE deliverable (drives caps + ingest kind)? */
function producesImage(j: { mode: JobMode; genType?: "image" | "video" }): boolean {
  if (isImageMode(j.mode)) return true;
  return j.mode === "inspiration" && j.genType === "image";
}

/** True for the Aurora UGC avatar mode (gated by canUgc + the credit budget). */
function isUgcMode(mode: JobMode): mode is UgcMode {
  return mode === "ugc_avatar" || mode === "ugc_avatar_v2";
}

/** Map a persisted job mode to the integration poll mode. UGC polls the lipsync
 *  endpoint; all other modes are already valid CreatifyJobMode values. */
function toPollMode(
  mode: JobMode
): "ad_clone" | "url_to_video" | "lipsync" | "lipsync_v2" | "iab_images" {
  if (mode === "ugc_avatar") return "lipsync";
  if (mode === "ugc_avatar_v2") return "lipsync_v2";
  return mode as "ad_clone" | "url_to_video" | "iab_images";
}

/**
 * Ad-clone is the expensive path: 12 credits per 5s of REFERENCE video
 * (a 30s reference = 72 cr ≈ $14 vs ~4-5 cr for a url_to_video render).
 * Count each clone as several jobs against the monthly fair-use cap so a
 * month of clones can't silently run 10x the COGS of a month of renders.
 * The skill/tool guidance additionally tells Maya to pick refs ≤15s.
 */
export const AD_CLONE_CAP_WEIGHT = 4;

const POLL_INTERVAL_MS = 30_000;
const MAX_POLL_ATTEMPTS = 30; // ~15 min at 30s — well past typical render time.

/** $/credit. Defaults to API Starter ($99/500cr); override per plan via env. */
function usdPerCredit(): number {
  const env = Number(process.env.CREATIFY_USD_PER_CREDIT);
  return Number.isFinite(env) && env > 0 ? env : 0.198;
}

/** One row in gtmAgents.creatifyJobsJson. */
interface CreatifyJobEntry {
  jobId: string; // our id (links the agent's tool call → this job)
  mode: JobMode;
  creatifyId: string; // Creatify's job id (what we poll)
  status: string; // last-seen Creatify status
  attempts: number;
  productUrl?: string;
  refUrl?: string; // reference video (ad_clone)
  /** Inspiration renders: what the template produces (drives cap + ingest kind). */
  genType?: "image" | "video";
  /** Preview-first url_to_video: "preview" until Maya picks, then "render". */
  phase?: "preview" | "render";
  /** Preview candidates surfaced by preview_list_async (Maya picks one). */
  previews?: Array<{ mediaJob: string; url: string | null }>;
  mediaStorageId?: string; // set once re-hosted
  creditsUsed?: number;
  costUsd?: number;
  failedReason?: string;
  createdAt: number;
  updatedAt: number;
}

// Explicit handler return types throughout — breaks the circular inference
// between these exported Convex functions and the internal.* API graph that
// would otherwise re-instantiate the whole DataModel (regressing db.get()
// narrowing project-wide). Same discipline as mediaAssets.ts.
interface StartResult {
  ok: boolean;
  jobId?: string;
  creatifyId?: string;
  status?: string;
  reason?: string;
  /** Creative-budget pacing mode when a UGC render was gated (full/graceful_degrade/hard_block). */
  budgetMode?: string;
  /** On graceful_degrade — the cheaper format Maya should fall back to. */
  suggest?: string;
}
interface JobView {
  jobId: string;
  mode: JobMode;
  status: string;
  mediaStorageId: string | null;
  creditsUsed: number | null;
  costUsd: number | null;
  failedReason: string | null;
}

function parseJobs(json: string | undefined): CreatifyJobEntry[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? (parsed as CreatifyJobEntry[]) : [];
  } catch {
    return [];
  }
}

function newJobId(creatifyId: string, attempts: number): string {
  // Deterministic-ish, no Math.random (unavailable in some runtimes): the
  // Creatify id is already unique; suffix keeps collisions impossible.
  return `cv_${creatifyId}_${attempts}`;
}

// =====================================================================
// DB layer — jobs live on gtmAgents.creatifyJobsJson
// =====================================================================

export const getAgentVideoContext = internalQuery({
  args: { agentId: v.id("gtmAgents") },
  handler: async (
    ctx,
    args
  ): Promise<{
    accountId: Id<"creators"> | null;
    jobsJson: string | null;
    gtmPlanJson: string | null;
  }> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return { accountId: null, jobsJson: null, gtmPlanJson: null };
    return {
      accountId: agent.accountId,
      jobsJson: agent.creatifyJobsJson ?? null,
      gtmPlanJson: agent.gtmPlanJson ?? null,
    };
  },
});

/** VIDEO jobs created in the trailing 30 days that weren't outright failures —
 *  the monthly fair-use usage counted against videoCreditsMonth. Image jobs are
 *  counted separately so they never consume the video budget (or vice-versa). */
export function countRecentVideos(jobsJson: string | null): number {
  const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
  return parseJobs(jobsJson ?? undefined)
    .filter(
      (j) => j.createdAt >= since && j.status !== "failed" && !producesImage(j)
    )
    .reduce((sum, j) => sum + (j.mode === "ad_clone" ? AD_CLONE_CAP_WEIGHT : 1), 0);
}

/** STATIC-IMAGE jobs in the trailing 30 days — counted against assetCreditsMonth. */
function countRecentAssets(jobsJson: string | null): number {
  const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
  return parseJobs(jobsJson ?? undefined).filter(
    (j) => j.createdAt >= since && j.status !== "failed" && producesImage(j)
  ).length;
}

/**
 * UGC CREDITS spent in the trailing 30 days — a SECONDARY per-agent signal for
 * visibility. The AUTHORITATIVE budget gate is `creativeBudgetGate.checkCreativeBudget`
 * (per-ACCOUNT, ledger-sourced) — multi-agent accounts share the ceiling, which a
 * per-agent jobsJson count would miss. Sums `creditsUsed` (NOT a count — credit
 * semantics) for non-failed UGC jobs; failed renders cost 0 (free retry).
 */
function countRecentUgcCredits(jobsJson: string | null): number {
  const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
  return parseJobs(jobsJson ?? undefined)
    .filter((j) => j.createdAt >= since && j.status !== "failed" && isUgcMode(j.mode))
    .reduce((sum, j) => sum + (j.creditsUsed ?? 0), 0);
}

/**
 * Docs-derived per-job cost ESTIMATE in USD, for ledger metadata + a soft
 * preflight log only — NOT a hard gate (the hard gates are canVideo/canImage +
 * the monthly count caps). ⚠ These are docs estimates; the real cost comes from
 * `credits_used` on the finished job. Re-ground if the live numbers differ.
 */
function estimatedCreatifyCostUsd(mode: JobMode): number {
  const perCredit = usdPerCredit();
  // ad_clone ~24cr/10s · url_to_video ~5cr/30s · iab_images ~2cr ·
  // ugc_avatar ~7.5cr (aurora_v1_fast 15s @ 0.5cr/s).
  const credits =
    mode === "ad_clone"
      ? 24
      : mode === "iab_images"
        ? 2
        : mode === "ugc_avatar"
          ? 7.5
          : 5;
  return Math.round(credits * perCredit * 10000) / 10000;
}

export const appendJob = internalMutation({
  args: {
    agentId: v.id("gtmAgents"),
    jobId: v.string(),
    mode: v.string(),
    creatifyId: v.string(),
    status: v.string(),
    productUrl: v.optional(v.string()),
    refUrl: v.optional(v.string()),
    phase: v.optional(v.union(v.literal("preview"), v.literal("render"))),
    genType: v.optional(v.union(v.literal("image"), v.literal("video"))),
  },
  handler: async (ctx, args): Promise<void> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) throw new Error("agent not found");
    const jobs = parseJobs(agent.creatifyJobsJson);
    const now = Date.now();
    jobs.push({
      jobId: args.jobId,
      mode: args.mode as JobMode,
      creatifyId: args.creatifyId,
      status: args.status,
      attempts: 0,
      phase: args.phase,
      genType: args.genType,
      productUrl: args.productUrl,
      refUrl: args.refUrl,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(args.agentId, {
      creatifyJobsJson: JSON.stringify(jobs),
      updatedAt: now,
    });
  },
});

export const patchJob = internalMutation({
  args: {
    agentId: v.id("gtmAgents"),
    jobId: v.string(),
    status: v.optional(v.string()),
    attempts: v.optional(v.number()),
    phase: v.optional(v.union(v.literal("preview"), v.literal("render"))),
    previewsJson: v.optional(v.string()),
    mediaStorageId: v.optional(v.string()),
    creditsUsed: v.optional(v.number()),
    costUsd: v.optional(v.number()),
    failedReason: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return;
    const jobs = parseJobs(agent.creatifyJobsJson);
    const idx = jobs.findIndex((j) => j.jobId === args.jobId);
    if (idx < 0) return;
    const j = jobs[idx];
    jobs[idx] = {
      ...j,
      status: args.status ?? j.status,
      attempts: args.attempts ?? j.attempts,
      phase: args.phase ?? j.phase,
      previews: args.previewsJson
        ? (JSON.parse(args.previewsJson) as CreatifyJobEntry["previews"])
        : j.previews,
      mediaStorageId: args.mediaStorageId ?? j.mediaStorageId,
      creditsUsed: args.creditsUsed ?? j.creditsUsed,
      costUsd: args.costUsd ?? j.costUsd,
      failedReason: args.failedReason ?? j.failedReason,
      updatedAt: Date.now(),
    };
    await ctx.db.patch(args.agentId, {
      creatifyJobsJson: JSON.stringify(jobs),
      updatedAt: Date.now(),
    });
  },
});

export const getJob = internalQuery({
  args: { agentId: v.id("gtmAgents"), jobId: v.string() },
  handler: async (ctx, args): Promise<CreatifyJobEntry | null> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return null;
    return parseJobs(agent.creatifyJobsJson).find((j) => j.jobId === args.jobId) ?? null;
  },
});

export const listJobs = internalQuery({
  args: { agentId: v.id("gtmAgents") },
  handler: async (ctx, args): Promise<JobView[]> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return [];
    return parseJobs(agent.creatifyJobsJson)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((j) => ({
        jobId: j.jobId,
        mode: j.mode,
        status: j.status,
        mediaStorageId: j.mediaStorageId ?? null,
        creditsUsed: j.creditsUsed ?? null,
        costUsd: j.costUsd ?? null,
        failedReason: j.failedReason ?? null,
      }));
  },
});

// =====================================================================
// The engine — start, poll, finalize
// =====================================================================

/**
 * Create the Creatify Link (grounded in the founder's real product), kick off
 * the chosen video job, persist it, and schedule the durable poller.
 */
export const startVideoJob = internalAction({
  args: {
    agentId: v.id("gtmAgents"),
    mode: v.union(v.literal("ad_clone"), v.literal("url_to_video")),
    productUrl: v.string(),
    // GROUNDING: the founder's real screenshots. Prefer imageAssetIds (storage
    // ids from search_my_media) — resolved server-side to public Convex URLs
    // Creatify fetches. imageUrls is the raw-URL escape hatch (e2e/operator).
    imageAssetIds: v.optional(v.array(v.string())),
    imageUrls: v.optional(v.array(v.string())),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    // ad_clone:
    referenceVideoUrl: v.optional(v.string()),
    // url_to_video:
    overrideScript: v.optional(v.string()),
    scriptStyle: v.optional(v.string()),
    visualStyle: v.optional(v.string()),
    modelVersion: v.optional(v.string()),
    videoLength: v.optional(v.number()),
    /** url_to_video only: fan out cheap style previews (1 cr/30s each) and
     *  wait for renderPreviewChoice instead of a blind 4-5 cr full render. */
    previewFirst: v.optional(v.boolean()),
    // skip scheduling the durable poller (the e2e smoke polls inline instead).
    noSchedule: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<StartResult> => {
    if (!isCreatifyConfigured()) {
      return { ok: false, reason: "creatify_not_configured" };
    }
    if (args.mode === "ad_clone" && !args.referenceVideoUrl) {
      return { ok: false, reason: "ad_clone_requires_referenceVideoUrl" };
    }

    // ── Server-side tier gate (fail-closed) ────────────────────────────────
    // Video is $149 Studio-tier only. A $99 (or trial-lapsed / corrupt-plan)
    // agent resolves to canVideo:false and CANNOT generate video here — the
    // hard backstop behind the skill/tool-level gating. Also enforce the
    // monthly fair-use cap so a Studio agent can't run COGS unbounded.
    const gctx = await ctx.runQuery(
      internal.gtmMaya.creatifyVideo.getAgentVideoContext,
      { agentId: args.agentId }
    );
    const plan = planFeaturesGtm({ gtmPlanJson: gctx.gtmPlanJson });
    if (!plan.canVideo) {
      return { ok: false, reason: "studio_tier_required" };
    }
    const used = countRecentVideos(gctx.jobsJson);
    // Ad-clone weighs AD_CLONE_CAP_WEIGHT jobs (12cr/5s of reference video).
    const weight = args.mode === "ad_clone" ? AD_CLONE_CAP_WEIGHT : 1;
    if (used + weight > plan.videoCreditsMonth) {
      return {
        ok: false,
        reason:
          args.mode === "ad_clone"
            ? `video_cap_reached (${used}/${plan.videoCreditsMonth}; an ad clone counts as ${AD_CLONE_CAP_WEIGHT} — use make_ad_from_url instead this month)`
            : `video_cap_reached (${used}/${plan.videoCreditsMonth} this month)`,
      };
    }
    try {
      // Resolve the founder's real screenshots (assetIds → public Convex URLs
      // Creatify can fetch), combined with any raw URLs. Tenant-isolated:
      // resolveDeliveryUrls only returns assets owned by THIS agent.
      let imageUrls: string[] = [...(args.imageUrls ?? [])];
      if (args.imageAssetIds && args.imageAssetIds.length > 0) {
        const resolved: Array<{ url: string }> = await ctx.runAction(
          internal.gtmMaya.mediaAssets.resolveDeliveryUrls,
          { agentId: args.agentId, ids: args.imageAssetIds }
        );
        imageUrls = [...imageUrls, ...resolved.map((r) => r.url)];
      }

      // 1) Link from the product URL + ground it with the real screenshots.
      const link = await createLinkFromUrl(args.productUrl);
      if (args.title || args.description || imageUrls.length > 0) {
        await updateLink(link.id, {
          title: args.title,
          description: args.description,
          image_urls: imageUrls.length > 0 ? imageUrls : undefined,
        });
      }

      // 2) Start the chosen flow.
      let job: CreatifyJob;
      const previewFirst = args.previewFirst === true && args.mode === "url_to_video";
      if (args.mode === "ad_clone") {
        job = await createAdClone({
          link: link.id,
          video_url: args.referenceVideoUrl as string,
          aspect_ratio: "9x16",
        });
      } else {
        const input = {
          link: link.id,
          aspect_ratio: "9x16" as const,
          video_length: (args.videoLength as 15 | 30 | 45 | 60 | undefined) ?? 15,
          override_script: args.overrideScript ?? null,
          script_style: args.scriptStyle ?? null,
          visual_style: args.visualStyle ?? null,
          model_version:
            (args.modelVersion as "standard" | "aurora_v1" | "aurora_v1_fast" | undefined) ??
            "standard",
        };
        // Preview-first (the cost lever): fan out style previews at 1 cr/30s
        // each instead of a blind 4-5 cr render; Maya reviews + picks, then
        // renderPreviewChoice renders only the winner.
        job = previewFirst
          ? await createLinkToVideoPreviews(input)
          : await createLinkToVideo(input);
      }

      const jobId = newJobId(job.id, 0);
      await ctx.runMutation(internal.gtmMaya.creatifyVideo.appendJob, {
        agentId: args.agentId,
        jobId,
        mode: args.mode,
        creatifyId: job.id,
        status: job.status ?? "pending",
        productUrl: args.productUrl,
        refUrl: args.referenceVideoUrl,
        phase: previewFirst ? ("preview" as const) : undefined,
      });

      if (!args.noSchedule) {
        await ctx.scheduler.runAfter(
          POLL_INTERVAL_MS,
          internal.gtmMaya.creatifyVideo.pollVideoJob,
          { agentId: args.agentId, jobId }
        );
      }
      return { ok: true, jobId, creatifyId: job.id, status: job.status ?? "pending" };
    } catch (err) {
      return {
        ok: false,
        reason: `start_failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

/**
 * Static-image (IAB Images) job — the Growth $149 tier creative path. Grounds a
 * banner set in the founder's REAL product (Link + screenshots), persists it on
 * the same creatifyJobsJson, and reuses the durable poller. Gated server-side on
 * canImage + assetCreditsMonth (fail-closed). Mirrors startVideoJob.
 */
export const startAssetJob = internalAction({
  args: {
    agentId: v.id("gtmAgents"),
    productUrl: v.string(),
    imageAssetIds: v.optional(v.array(v.string())),
    imageUrls: v.optional(v.array(v.string())),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    /** Maya's grounded headline/copy brief to render onto the banner set. */
    prompt: v.optional(v.string()),
    /** IAB banner format/size set; Creatify defaults if omitted. */
    format: v.optional(v.string()),
    noSchedule: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<StartResult> => {
    if (!isCreatifyConfigured()) {
      return { ok: false, reason: "creatify_not_configured" };
    }

    // ── Server-side tier gate (fail-closed) ────────────────────────────────
    // Static images are Growth + Studio only (canImage). A starter / trial-
    // lapsed / corrupt-plan agent resolves to canImage:false and CANNOT
    // generate. Enforce the monthly fair-use cap so COGS stays bounded.
    const gctx = await ctx.runQuery(
      internal.gtmMaya.creatifyVideo.getAgentVideoContext,
      { agentId: args.agentId }
    );
    const plan = planFeaturesGtm({ gtmPlanJson: gctx.gtmPlanJson });
    if (!plan.canImage) {
      return { ok: false, reason: "growth_tier_required" };
    }
    const used = countRecentAssets(gctx.jobsJson);
    if (used >= plan.assetCreditsMonth) {
      return {
        ok: false,
        reason: `asset_cap_reached (${used}/${plan.assetCreditsMonth} this month)`,
      };
    }

    try {
      // Resolve the founder's real screenshots (tenant-isolated), like video.
      let imageUrls: string[] = [...(args.imageUrls ?? [])];
      if (args.imageAssetIds && args.imageAssetIds.length > 0) {
        const resolved: Array<{ url: string }> = await ctx.runAction(
          internal.gtmMaya.mediaAssets.resolveDeliveryUrls,
          { agentId: args.agentId, ids: args.imageAssetIds }
        );
        imageUrls = [...imageUrls, ...resolved.map((r) => r.url)];
      }

      // Ground a Link in the product (gives Creatify scraped title/desc/images).
      const link = await createLinkFromUrl(args.productUrl);
      if (args.title || args.description || imageUrls.length > 0) {
        await updateLink(link.id, {
          title: args.title,
          description: args.description,
          image_urls: imageUrls.length > 0 ? imageUrls : undefined,
        });
      }

      const job: CreatifyJob = await createIabImages({
        link: link.id,
        image_urls: imageUrls.length > 0 ? imageUrls : undefined,
        prompt: args.prompt ?? null,
        format: args.format ?? null,
      });

      const jobId = newJobId(job.id, 0);
      await ctx.runMutation(internal.gtmMaya.creatifyVideo.appendJob, {
        agentId: args.agentId,
        jobId,
        mode: "iab_images",
        creatifyId: job.id,
        status: job.status ?? "pending",
        productUrl: args.productUrl,
      });

      if (!args.noSchedule) {
        await ctx.scheduler.runAfter(
          POLL_INTERVAL_MS,
          internal.gtmMaya.creatifyVideo.pollVideoJob,
          { agentId: args.agentId, jobId }
        );
      }
      return { ok: true, jobId, creatifyId: job.id, status: job.status ?? "pending" };
    } catch (err) {
      return {
        ok: false,
        reason: `start_failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

/**
 * Aurora UGC AVATAR video — the Studio $199 talking-head/testimonial path. The
 * avatar performs a GROUNDED, voice-passed `avatarScript` (Maya writes it in the
 * founder's voice from the grounded fact sheet; see maya-ugc-producer SKILL). Two
 * fail-closed server gates run BEFORE any paid render:
 *   1. canUgc — Studio-only (a starter/growth/lapsed/corrupt plan → false → blocked).
 *   2. creativeBudgetGate — the paced credit budget (full → render; graceful_degrade
 *      → refuse + suggest a cheaper format; hard_block → refuse, ceiling hit).
 * Uses the 1-step lipsync path (aurora_v1_fast default). Persists on the shared
 * creatifyJobsJson with mode 'ugc_avatar' and reuses the durable poller.
 */
export const startUgcVideoJob = internalAction({
  args: {
    agentId: v.id("gtmAgents"),
    avatarScript: v.string(),
    // Recorded on the job for traceability (the script is grounded in the
    // product; the lipsync render itself is avatar+script, no image input).
    productUrl: v.optional(v.string()),
    modelVersion: v.optional(v.string()),
    aspectRatio: v.optional(v.string()),
    overrideAvatar: v.optional(v.string()),
    overrideVoice: v.optional(v.string()),
    /**
     * Multi-scene UGC (lipsync v2): the avatar/b-roll "sandwich" that actually
     * performs — avatar hook → product b-roll → avatar CTA. Each scene is
     * either avatar-speaking (script) or b-roll (brollUrl, with the script as
     * voiceover). Requires overrideAvatar (v2 scenes need an explicit avatar
     * id). When omitted or a single script-only scene → classic v1 lipsync.
     */
    scenes: v.optional(
      v.array(
        v.object({
          script: v.string(),
          brollUrl: v.optional(v.string()),
        })
      )
    ),
    noSchedule: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<StartResult> => {
    if (!isCreatifyConfigured()) {
      return { ok: false, reason: "creatify_not_configured" };
    }
    if (!args.avatarScript.trim()) {
      return { ok: false, reason: "missing avatarScript" };
    }

    const gctx = await ctx.runQuery(
      internal.gtmMaya.creatifyVideo.getAgentVideoContext,
      { agentId: args.agentId }
    );

    // ── Gate 1: Studio-only canUgc (fail-closed) ───────────────────────────
    const plan = planFeaturesGtm({ gtmPlanJson: gctx.gtmPlanJson });
    if (!plan.canUgc) {
      return { ok: false, reason: "studio_tier_required" };
    }
    if (!gctx.accountId) {
      return { ok: false, reason: "account_not_resolved" };
    }

    // ── Gate 2: paced creative-credit budget (per-account, fail-closed) ─────
    const verdict = await ctx.runQuery(
      internal.gtmMaya.creativeBudgetGate.checkCreativeBudget,
      { accountId: gctx.accountId, gtmPlanJson: gctx.gtmPlanJson, now: Date.now() }
    );
    if (!verdict.allowed) {
      return {
        ok: false,
        reason: verdict.reason,
        budgetMode: verdict.mode,
        // On a soft degrade, point Maya at the cheap fallback (no render burned).
        suggest: verdict.mode === "graceful_degrade" ? "static_asset" : undefined,
      };
    }

    // Multi-scene v2 needs an explicit avatar id per avatar scene; without one
    // we fall back to single-scene v1 (which has a provider default avatar).
    const wantsScenes = (args.scenes?.length ?? 0) > 0;
    const useV2 = wantsScenes && Boolean(args.overrideAvatar);

    try {
      const aspect =
        (args.aspectRatio as "9x16" | "16x9" | "1x1" | undefined) ?? "9x16";
      const model =
        (args.modelVersion as
          | "standard"
          | "aurora_v1"
          | "aurora_v1_fast"
          | undefined) ?? "aurora_v1_fast";

      let job: CreatifyJob;
      if (useV2) {
        const IMAGE_EXT = /\.(png|jpe?g|webp|gif)(\?|$)/i;
        job = await createLipsyncV2({
          video_inputs: (args.scenes ?? []).map((scene) => ({
            // B-roll scenes keep the voiceover but swap the visual for the
            // founder's real product footage/stills; avatar scenes show the
            // avatar speaking. Same voice throughout = one coherent speaker.
            character: scene.brollUrl
              ? null
              : {
                  type: "avatar" as const,
                  avatar_id: args.overrideAvatar as string,
                },
            voice: {
              type: "text" as const,
              input_text: scene.script,
              voice_id: args.overrideVoice ?? null,
            },
            background: scene.brollUrl
              ? {
                  type: IMAGE_EXT.test(scene.brollUrl)
                    ? ("image" as const)
                    : ("video" as const),
                  url: scene.brollUrl,
                }
              : null,
          })),
          aspect_ratio: aspect,
          model_version: model,
        });
      } else {
        job = await createLipsyncWithAurora({
          script: args.avatarScript,
          aspect_ratio: aspect,
          model_version: model,
          override_avatar: args.overrideAvatar ?? null,
          override_voice: args.overrideVoice ?? null,
        });
      }

      const jobId = newJobId(job.id, 0);
      await ctx.runMutation(internal.gtmMaya.creatifyVideo.appendJob, {
        agentId: args.agentId,
        jobId,
        mode: useV2 ? "ugc_avatar_v2" : "ugc_avatar",
        creatifyId: job.id,
        status: job.status ?? "pending",
        productUrl: args.productUrl,
      });

      if (!args.noSchedule) {
        await ctx.scheduler.runAfter(
          POLL_INTERVAL_MS,
          internal.gtmMaya.creatifyVideo.pollVideoJob,
          { agentId: args.agentId, jobId }
        );
      }
      return {
        ok: true,
        jobId,
        creatifyId: job.id,
        status: job.status ?? "pending",
        budgetMode: verdict.mode,
      };
    } catch (err) {
      return {
        ok: false,
        reason: `start_failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

/**
 * Read-only: fetch the Creatify Inspiration recipe/format catalog (FREE GET).
 * This is a format-idea catalog, NOT a competitor-ad feed — Maya reads it as one
 * grounded input to her brief, never as the strategy. No tier gate (free + read-
 * only), but still requires Creatify to be configured.
 */
export const startInspirationQuery = internalAction({
  args: { agentId: v.id("gtmAgents") },
  handler: async (
    _ctx,
    _args
  ): Promise<{
    ok: boolean;
    reason?: string;
    recipes?: Array<{
      id: string;
      name: string | null;
      genType: string | null;
      creditCost: number | null;
      previewImage: string | null;
      previewVideo: string | null;
      categories: string[];
      requiredInputs: string[];
    }>;
  }> => {
    if (!isCreatifyConfigured()) {
      return { ok: false, reason: "creatify_not_configured" };
    }
    try {
      const list = await getInspirations();
      return {
        ok: true,
        recipes: list.slice(0, 40).map((r) => {
          const x = r as unknown as Record<string, unknown>;
          return {
            id: r.id,
            name: r.name ?? null,
            genType: typeof x.gen_type === "string" ? (x.gen_type as string) : null,
            creditCost: typeof x.credit_cost === "number" ? (x.credit_cost as number) : null,
            previewImage: typeof x.preview_image === "string" ? (x.preview_image as string) : null,
            previewVideo: typeof x.preview_video === "string" ? (x.preview_video as string) : null,
            categories: Array.isArray(x.categories) ? (x.categories as string[]) : [],
            requiredInputs:
              x.input_params_schema && typeof x.input_params_schema === "object"
                ? Object.keys(
                    ((x.input_params_schema as Record<string, unknown>).properties as
                      | Record<string, unknown>
                      | undefined) ?? {}
                  )
                : [],
          };
        }),
      };
    } catch (err) {
      return {
        ok: false,
        reason: `inspiration_failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

/**
 * Pull the preview candidates out of a done preview_list_async job. The docs
 * shape the previews as media-job entries carrying an id + a playable URL;
 * field names are docs-derived (⚠ unverified live, like iab_images), so this
 * reads defensively: any array of objects with an id-ish and/or url-ish field.
 */
function extractPreviewCandidates(
  terminal: CreatifyJob
): Array<{ mediaJob: string; url: string | null }> {
  const t = terminal as unknown as Record<string, unknown>;
  const candidates: Array<{ mediaJob: string; url: string | null }> = [];
  const arrays = [t.previews, t.media_jobs, t.preview_list, t.output].filter(
    Array.isArray
  ) as unknown[][];
  for (const arr of arrays) {
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const id =
        (typeof o.media_job === "string" && o.media_job) ||
        (typeof o.id === "string" && o.id) ||
        "";
      const url =
        (typeof o.video_output === "string" && o.video_output) ||
        (typeof o.url === "string" && o.url) ||
        (typeof o.preview_url === "string" && o.preview_url) ||
        null;
      if (id) candidates.push({ mediaJob: id, url });
    }
    if (candidates.length > 0) break;
  }
  return candidates;
}

/**
 * Finalize a job whose Creatify status just went terminal-done: re-host the
 * video into Convex storage + record cost. Returns the media storageId.
 * Shared by the durable poller and the e2e smoke.
 */
async function finalizeDoneJob(
  ctx: { runAction: any; runMutation: any; runQuery: any },
  agentId: Id<"gtmAgents">,
  job: CreatifyJobEntry,
  terminal: CreatifyJob
): Promise<{ mediaStorageId: string | null; creditsUsed: number; costUsd: number }> {
  const image = producesImage(job);
  const ugc = isUgcMode(job.mode);
  const creditsUsed = Number(terminal.credits_used ?? 0) || 0;
  const costUsd = Math.round(creditsUsed * usdPerCredit() * 10000) / 10000;

  // Resolve the finished asset URL: video jobs land in `video_output`; static
  // image jobs land in `output[].url` (first image is the primary deliverable).
  let assetUrl = "";
  if (image) {
    const out = terminal.output;
    if (Array.isArray(out)) {
      const first = out.find((o) => o && typeof o.url === "string" && o.url);
      assetUrl = (first?.url as string) ?? "";
    } else if (typeof out === "string") {
      assetUrl = out;
    }
  } else {
    assetUrl = (terminal.video_output ?? "") as string;
  }

  let mediaStorageId: string | null = null;
  if (assetUrl) {
    const ingest = await ctx.runAction(internal.gtmMaya.mediaAssets.ingestFromUrl, {
      agentId,
      mediaUrl: assetUrl,
      label: image
        ? `Static creative (${job.productUrl ?? "product"})`
        : ugc
          ? `UGC avatar video (${job.productUrl ?? "product"})`
          : `${job.mode === "ad_clone" ? "Ad clone" : "Video ad"} (${job.productUrl ?? "product"})`,
      kindHint: image ? "image" : "video",
      source: "creatify",
    });
    if (ingest.ok) mediaStorageId = ingest.assetId;
  }

  // Record COGS (visible in the ledger; excluded from caps/kill by provider —
  // costCap.ts / spendKill.ts already key the exclusion on provider==='creatify',
  // so a burst of asset jobs can't trip the $6/24h machine-kill).
  const vctx = await ctx.runQuery(internal.gtmMaya.creatifyVideo.getAgentVideoContext, {
    agentId,
  });
  if (vctx.accountId && costUsd > 0) {
    await ctx.runMutation(internal.gtmMaya.costLedger.recordGtmCostInternal, {
      accountId: vctx.accountId,
      provider: "creatify",
      operation: ugc
        ? "creatify_ugc_avatar"
        : image
          ? "creatify_image"
          : "creatify_video",
      reason: `${job.mode} (${creditsUsed} cr)`,
      costUsd,
      units: creditsUsed,
      cacheStatus: "called",
      // `creative: true` is how creativeBudgetGate identifies UGC rows to pace.
      // Only UGC is tagged — standard video/image keep their own count caps.
      creative: ugc ? true : undefined,
      metadata: { mode: job.mode, creatifyId: job.creatifyId, mediaStorageId },
    });
  }

  await ctx.runMutation(internal.gtmMaya.creatifyVideo.patchJob, {
    agentId,
    jobId: job.jobId,
    status: "done",
    mediaStorageId: mediaStorageId ?? undefined,
    creditsUsed,
    costUsd,
  });
  return { mediaStorageId, creditsUsed, costUsd };
}

/**
 * Durable poll: check Creatify status; finalize on done, self-reschedule while
 * running (up to MAX_POLL_ATTEMPTS), mark failed/timeout otherwise.
 */
export const pollVideoJob = internalAction({
  args: { agentId: v.id("gtmAgents"), jobId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const job = await ctx.runQuery(internal.gtmMaya.creatifyVideo.getJob, {
      agentId: args.agentId,
      jobId: args.jobId,
    });
    if (!job || job.status === "done" || job.status === "failed") return;

    let terminal: CreatifyJob;
    try {
      terminal = await getCreatifyJob(toPollMode(job.mode), job.creatifyId);
    } catch (err) {
      // Transient — reschedule unless we're out of attempts.
      const attempts = job.attempts + 1;
      if (attempts >= MAX_POLL_ATTEMPTS) {
        await ctx.runMutation(internal.gtmMaya.creatifyVideo.patchJob, {
          agentId: args.agentId,
          jobId: args.jobId,
          status: "failed",
          attempts,
          failedReason: `poll_error: ${err instanceof Error ? err.message : String(err)}`,
        });
        return;
      }
      await ctx.runMutation(internal.gtmMaya.creatifyVideo.patchJob, {
        agentId: args.agentId,
        jobId: args.jobId,
        attempts,
      });
      await ctx.scheduler.runAfter(
        POLL_INTERVAL_MS,
        internal.gtmMaya.creatifyVideo.pollVideoJob,
        { agentId: args.agentId, jobId: args.jobId }
      );
      return;
    }

    if (isDoneStatus(terminal.status)) {
      // Preview-first url_to_video: "done" in the preview phase means the
      // PREVIEW LIST is ready, not the ad. Surface the candidates on the job
      // (status preview_ready) and stop polling — Maya reviews via
      // check_creative_status and calls render_chosen_preview to continue.
      if (job.mode === "url_to_video" && job.phase === "preview") {
        const previews = extractPreviewCandidates(terminal);
        await ctx.runMutation(internal.gtmMaya.creatifyVideo.patchJob, {
          agentId: args.agentId,
          jobId: args.jobId,
          status: "preview_ready",
          previewsJson: JSON.stringify(previews),
        });
        return;
      }
      await finalizeDoneJob(ctx, args.agentId, job, terminal);
      return;
    }
    if (isFailedStatus(terminal.status)) {
      await ctx.runMutation(internal.gtmMaya.creatifyVideo.patchJob, {
        agentId: args.agentId,
        jobId: args.jobId,
        status: "failed",
        failedReason: (terminal.failed_reason as string) ?? "creatify_failed",
      });
      return;
    }

    // Still running — reschedule or time out.
    const attempts = job.attempts + 1;
    if (attempts >= MAX_POLL_ATTEMPTS) {
      await ctx.runMutation(internal.gtmMaya.creatifyVideo.patchJob, {
        agentId: args.agentId,
        jobId: args.jobId,
        status: "failed",
        attempts,
        failedReason: "poll_timeout",
      });
      return;
    }
    await ctx.runMutation(internal.gtmMaya.creatifyVideo.patchJob, {
      agentId: args.agentId,
      jobId: args.jobId,
      status: terminal.status ?? job.status,
      attempts,
    });
    await ctx.scheduler.runAfter(
      POLL_INTERVAL_MS,
      internal.gtmMaya.creatifyVideo.pollVideoJob,
      { agentId: args.agentId, jobId: args.jobId }
    );
  },
});

// =====================================================================
// E2E smoke — operator-runnable proof the whole chain works once key is in.
//   npx convex run gtmMaya/creatifyVideo:e2eSmoke '{"agentId":"...",
//     "mode":"ad_clone","productUrl":"https://...","imageUrls":["https://..."],
//     "referenceVideoUrl":"https://<winning tiktok>"}'
// Polls INLINE (blocks) so a single CLI call returns the finished result + COGS.
// =====================================================================

export const e2eSmoke = internalAction({
  args: {
    agentId: v.id("gtmAgents"),
    mode: v.union(v.literal("ad_clone"), v.literal("url_to_video")),
    productUrl: v.string(),
    imageUrls: v.optional(v.array(v.string())),
    referenceVideoUrl: v.optional(v.string()),
    overrideScript: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    ok: boolean;
    reason?: string;
    jobId?: string;
    status?: string;
    creditsUsed?: number;
    costUsd?: number;
    mediaStorageId?: string | null;
    videoUrl?: string | null;
  }> => {
    const start: StartResult = await ctx.runAction(
      internal.gtmMaya.creatifyVideo.startVideoJob,
      {
        agentId: args.agentId,
        mode: args.mode,
        productUrl: args.productUrl,
        imageUrls: args.imageUrls,
        referenceVideoUrl: args.referenceVideoUrl,
        overrideScript: args.overrideScript,
        noSchedule: true, // we poll inline below
      }
    );
    if (!start.ok || !start.jobId || !start.creatifyId) {
      return { ok: false, reason: start.reason ?? "start_failed" };
    }

    const job = await ctx.runQuery(internal.gtmMaya.creatifyVideo.getJob, {
      agentId: args.agentId,
      jobId: start.jobId,
    });
    if (!job) return { ok: false, reason: "job_not_persisted" };

    // Inline poll loop.
    for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      let terminal: CreatifyJob;
      try {
        terminal = await getCreatifyJob(toPollMode(job.mode), job.creatifyId);
      } catch {
        continue;
      }
      if (isFailedStatus(terminal.status)) {
        await ctx.runMutation(internal.gtmMaya.creatifyVideo.patchJob, {
          agentId: args.agentId,
          jobId: start.jobId,
          status: "failed",
          failedReason: (terminal.failed_reason as string) ?? "creatify_failed",
        });
        return { ok: false, reason: "creatify_failed", jobId: start.jobId };
      }
      if (isDoneStatus(terminal.status)) {
        const fin = await finalizeDoneJob(ctx, args.agentId, job, terminal);
        return {
          ok: true,
          jobId: start.jobId,
          status: "done",
          creditsUsed: fin.creditsUsed,
          costUsd: fin.costUsd,
          mediaStorageId: fin.mediaStorageId,
          videoUrl: (terminal.video_output as string) ?? null,
        };
      }
    }
    return { ok: false, reason: "timeout", jobId: start.jobId, status: job.status };
  },
});

// =====================================================================
// HTTP endpoints (agent-facing typed tools land in Phase 3)
// =====================================================================

/**
 * Render one of Creatify's curated Inspiration templates with the founder's
 * grounded inputs. gen_type decides the gate: image templates bill against the
 * Growth image cap (canImage), video templates against the Studio video cap
 * (canVideo). ⚠ API credit_cost is 4x in-app per docs — Maya sees the cost in
 * the catalog BEFORE rendering and must treat it as part of the budget.
 */
export const startInspirationRenderJob = internalAction({
  args: {
    agentId: v.id("gtmAgents"),
    inspirationId: v.string(),
    genType: v.union(v.literal("image"), v.literal("video")),
    /** Template inputs per its input_params_schema (from get_inspirations). */
    inputParams: v.optional(v.any()),
    productUrl: v.optional(v.string()),
    noSchedule: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<StartResult> => {
    if (!isCreatifyConfigured()) {
      return { ok: false, reason: "creatify_not_configured" };
    }
    const gctx = await ctx.runQuery(
      internal.gtmMaya.creatifyVideo.getAgentVideoContext,
      { agentId: args.agentId }
    );
    const plan = planFeaturesGtm({ gtmPlanJson: gctx.gtmPlanJson });
    if (args.genType === "image") {
      if (!plan.canImage) return { ok: false, reason: "growth_tier_required" };
      const used = countRecentAssets(gctx.jobsJson);
      if (used >= plan.assetCreditsMonth) {
        return {
          ok: false,
          reason: `asset_cap_reached (${used}/${plan.assetCreditsMonth} this month)`,
        };
      }
    } else {
      if (!plan.canVideo) return { ok: false, reason: "studio_tier_required" };
      const used = countRecentVideos(gctx.jobsJson);
      if (used + 1 > plan.videoCreditsMonth) {
        return {
          ok: false,
          reason: `video_cap_reached (${used}/${plan.videoCreditsMonth} this month)`,
        };
      }
    }
    try {
      const job = await createInspirationJob({
        inspiration_id: args.inspirationId,
        input_params: args.inputParams ?? undefined,
      });
      const jobId = newJobId(job.id, 0);
      await ctx.runMutation(internal.gtmMaya.creatifyVideo.appendJob, {
        agentId: args.agentId,
        jobId,
        mode: "inspiration",
        creatifyId: job.id,
        status: job.status ?? "pending",
        productUrl: args.productUrl,
        genType: args.genType,
      });
      if (!args.noSchedule) {
        await ctx.scheduler.runAfter(
          POLL_INTERVAL_MS,
          internal.gtmMaya.creatifyVideo.pollVideoJob,
          { agentId: args.agentId, jobId }
        );
      }
      return { ok: true, jobId, creatifyId: job.id, status: job.status ?? "pending" };
    } catch (err) {
      return {
        ok: false,
        reason: `start_failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

/**
 * Free read: UGC avatar personas (+ voices) so Maya can PICK an avatar_id for
 * the lipsync_v2 sandwich and pin one consistent voice. No tier gate (read-only).
 */
export const listUgcAvatarsAction = internalAction({
  args: {
    style: v.optional(v.string()),
    gender: v.optional(v.string()),
  },
  handler: async (
    _ctx,
    args
  ): Promise<{
    ok: boolean;
    reason?: string;
    avatars?: Array<{
      id: string;
      gender: string | null;
      style: string | null;
      previewImage: string | null;
      previewVideo: string | null;
    }>;
    voices?: Array<{ id: string; name: string | null; gender: string | null }>;
  }> => {
    if (!isCreatifyConfigured()) {
      return { ok: false, reason: "creatify_not_configured" };
    }
    try {
      const [personas, voices] = await Promise.all([
        getPersonasV2({ style: args.style, gender: args.gender }),
        getVoices().catch(() => []),
      ]);
      return {
        ok: true,
        avatars: personas.slice(0, 24).map((p) => ({
          id: p.id,
          gender: (p.gender as string | null) ?? null,
          style: (p.style as string | null) ?? null,
          previewImage: (p.preview_image_9_16 as string | null) ?? null,
          previewVideo: (p.preview_video_9_16 as string | null) ?? null,
        })),
        voices: voices.slice(0, 24).map((v2) => ({
          id: String(v2.voice_id ?? v2.id ?? ""),
          name: (v2.name as string | null) ?? null,
          gender: (v2.gender as string | null) ?? null,
        })),
      };
    } catch (err) {
      return {
        ok: false,
        reason: `personas_failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

/**
 * Preview-first phase 2: Maya picked a preview — render ONLY that one.
 * Resets the poll counter and flips the job to the render phase; the durable
 * poller then finalizes exactly like a classic url_to_video render.
 */
export const renderPreviewChoice = internalAction({
  args: {
    agentId: v.id("gtmAgents"),
    jobId: v.string(),
    mediaJob: v.string(),
  },
  handler: async (ctx, args): Promise<StartResult> => {
    if (!isCreatifyConfigured()) {
      return { ok: false, reason: "creatify_not_configured" };
    }
    const job = await ctx.runQuery(internal.gtmMaya.creatifyVideo.getJob, {
      agentId: args.agentId,
      jobId: args.jobId,
    });
    if (!job) return { ok: false, reason: "job_not_found" };
    if (job.mode !== "url_to_video" || job.phase !== "preview") {
      return { ok: false, reason: "not_a_preview_job" };
    }
    if (job.status !== "preview_ready") {
      return { ok: false, reason: `previews_not_ready (status ${job.status})` };
    }
    const known = (job.previews ?? []).some((p) => p.mediaJob === args.mediaJob);
    if (!known) {
      return { ok: false, reason: "unknown_mediaJob (pick one from the job's previews)" };
    }
    try {
      await renderLinkToVideoPreview(job.creatifyId, args.mediaJob);
      await ctx.runMutation(internal.gtmMaya.creatifyVideo.patchJob, {
        agentId: args.agentId,
        jobId: args.jobId,
        status: "pending",
        phase: "render",
        attempts: 0,
      });
      await ctx.scheduler.runAfter(
        POLL_INTERVAL_MS,
        internal.gtmMaya.creatifyVideo.pollVideoJob,
        { agentId: args.agentId, jobId: args.jobId }
      );
      return { ok: true, jobId: args.jobId, creatifyId: job.creatifyId, status: "pending" };
    } catch (err) {
      return {
        ok: false,
        reason: `render_failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

async function startFromHttp(
  ctx: Parameters<Parameters<typeof httpAction>[0]>[0],
  agentId: Id<"gtmAgents">,
  mode: VideoMode,
  body: Record<string, unknown>
): Promise<Response> {
  const result: StartResult = await ctx.runAction(
    internal.gtmMaya.creatifyVideo.startVideoJob,
    {
      agentId,
      mode,
      productUrl: String(body.productUrl ?? ""),
      imageAssetIds: Array.isArray(body.imageAssetIds)
        ? (body.imageAssetIds as string[])
        : undefined,
      imageUrls: Array.isArray(body.imageUrls) ? (body.imageUrls as string[]) : undefined,
      title: typeof body.title === "string" ? body.title : undefined,
      description: typeof body.description === "string" ? body.description : undefined,
      referenceVideoUrl:
        typeof body.referenceVideoUrl === "string" ? body.referenceVideoUrl : undefined,
      overrideScript: typeof body.script === "string" ? body.script : undefined,
      scriptStyle: typeof body.scriptStyle === "string" ? body.scriptStyle : undefined,
      visualStyle: typeof body.visualStyle === "string" ? body.visualStyle : undefined,
      modelVersion: typeof body.modelVersion === "string" ? body.modelVersion : undefined,
      videoLength: typeof body.videoLength === "number" ? body.videoLength : undefined,
      previewFirst: body.previewFirst === true ? true : undefined,
    }
  );
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** url_to_video: product URL → Creatify writes the script + assembles the ad. */
export const creatifyMakeAdHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (!body.productUrl || typeof body.productUrl !== "string") {
    return new Response("missing required field (productUrl)", { status: 400 });
  }
  return startFromHttp(ctx, auth.agentId, "url_to_video", body);
});

/** ad_clone: product + a winning reference video → copy its format. */
export const creatifyCloneAdHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (!body.productUrl || typeof body.productUrl !== "string") {
    return new Response("missing required field (productUrl)", { status: 400 });
  }
  if (!body.referenceVideoUrl || typeof body.referenceVideoUrl !== "string") {
    return new Response("missing required field (referenceVideoUrl)", { status: 400 });
  }
  return startFromHttp(ctx, auth.agentId, "ad_clone", body);
});

/** Status check — the agent can poll on demand (the scheduler is the durable engine). */
export const creatifyPollHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");
  if (jobId) {
    const job = await ctx.runQuery(internal.gtmMaya.creatifyVideo.getJob, {
      agentId: auth.agentId,
      jobId,
    });
    return new Response(JSON.stringify({ ok: true, job }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  const jobs = await ctx.runQuery(internal.gtmMaya.creatifyVideo.listJobs, {
    agentId: auth.agentId,
  });
  return new Response(JSON.stringify({ ok: true, jobs }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

/** make_static_asset: product (+ real screenshots) → grounded IAB banner set.
 *  Growth $149 tier (canImage). Gated server-side in startAssetJob. */
export const creatifyMakeAssetHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (!body.productUrl || typeof body.productUrl !== "string") {
    return new Response("missing required field (productUrl)", { status: 400 });
  }
  const result: StartResult = await ctx.runAction(
    internal.gtmMaya.creatifyVideo.startAssetJob,
    {
      agentId: auth.agentId,
      productUrl: body.productUrl,
      imageAssetIds: Array.isArray(body.imageAssetIds)
        ? (body.imageAssetIds as string[])
        : undefined,
      imageUrls: Array.isArray(body.imageUrls) ? (body.imageUrls as string[]) : undefined,
      title: typeof body.title === "string" ? body.title : undefined,
      description: typeof body.description === "string" ? body.description : undefined,
      prompt: typeof body.prompt === "string" ? body.prompt : undefined,
      format: typeof body.format === "string" ? body.format : undefined,
    }
  );
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

/** make_ugc_video: grounded, voice-passed script → Aurora UGC avatar video.
 *  Studio $199 tier (canUgc) + the paced creative-credit budget. Both gates are
 *  enforced server-side in startUgcVideoJob (fail-closed). */
export const makeUgcVideoHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (!body.avatarScript || typeof body.avatarScript !== "string") {
    return new Response("missing required field (avatarScript)", { status: 400 });
  }
  const result: StartResult = await ctx.runAction(
    internal.gtmMaya.creatifyVideo.startUgcVideoJob,
    {
      agentId: auth.agentId,
      avatarScript: body.avatarScript,
      productUrl: typeof body.productUrl === "string" ? body.productUrl : undefined,
      modelVersion:
        typeof body.modelVersion === "string" ? body.modelVersion : undefined,
      aspectRatio: typeof body.aspectRatio === "string" ? body.aspectRatio : undefined,
      overrideAvatar:
        typeof body.overrideAvatar === "string" ? body.overrideAvatar : undefined,
      overrideVoice:
        typeof body.overrideVoice === "string" ? body.overrideVoice : undefined,
      scenes: Array.isArray(body.scenes)
        ? (body.scenes as Array<Record<string, unknown>>)
            .filter((s) => s && typeof s.script === "string")
            .map((s) => ({
              script: s.script as string,
              brollUrl: typeof s.brollUrl === "string" ? s.brollUrl : undefined,
            }))
        : undefined,
    }
  );
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

/** check_creative_budget: read-only. Returns remaining creative credits + the
 *  pacing mode (full/graceful_degrade/hard_block). Maya calls this BEFORE any
 *  paid render. Tier + period resolved server-side from the agent's plan. */
export const checkCreativeBudgetHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });
  const gctx = await ctx.runQuery(
    internal.gtmMaya.creatifyVideo.getAgentVideoContext,
    { agentId: auth.agentId }
  );
  if (!gctx.accountId) {
    return new Response(JSON.stringify({ ok: false, reason: "account_not_resolved" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  const verdict = await ctx.runQuery(
    internal.gtmMaya.creativeBudgetGate.checkCreativeBudget,
    { accountId: gctx.accountId, gtmPlanJson: gctx.gtmPlanJson, now: Date.now() }
  );
  // Best-effort REAL account balance from Creatify so the paced ledger can't
  // drift from what the API will actually accept. Never blocks the verdict.
  let remainingCredits: number | null = null;
  if (isCreatifyConfigured()) {
    try {
      const rc = await getRemainingCredits();
      remainingCredits =
        typeof rc.remaining_credits === "number" ? rc.remaining_credits : null;
    } catch {
      remainingCredits = null;
    }
  }
  return new Response(JSON.stringify({ ok: true, ...verdict, remainingCredits }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

/** get_inspirations: free read of the Creatify recipe/format catalog (a brief
 *  input, NOT a competitor-ad feed). */
export const creatifyInspirationsHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });
  const result = await ctx.runAction(
    internal.gtmMaya.creatifyVideo.startInspirationQuery,
    { agentId: auth.agentId }
  );
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});


/** render_chosen_preview: phase 2 of the preview-first flow — Maya reviewed the
 *  style previews and picked one; render only that winner (4-5 cr once, instead
 *  of gambling the full render blind). */
export const renderChosenPreviewHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (!body.jobId || typeof body.jobId !== "string") {
    return new Response("missing required field (jobId)", { status: 400 });
  }
  if (!body.mediaJob || typeof body.mediaJob !== "string") {
    return new Response("missing required field (mediaJob)", { status: 400 });
  }
  const result: StartResult = await ctx.runAction(
    internal.gtmMaya.creatifyVideo.renderPreviewChoice,
    { agentId: auth.agentId, jobId: body.jobId, mediaJob: body.mediaJob }
  );
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});


/** render_inspiration: render one of Creatify's curated templates (image or
 *  video) with grounded inputs. Cost known upfront from get_inspirations. */
export const renderInspirationHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (!body.inspirationId || typeof body.inspirationId !== "string") {
    return new Response("missing required field (inspirationId)", { status: 400 });
  }
  if (body.genType !== "image" && body.genType !== "video") {
    return new Response("genType must be 'image' or 'video' (from get_inspirations)", {
      status: 400,
    });
  }
  const result: StartResult = await ctx.runAction(
    internal.gtmMaya.creatifyVideo.startInspirationRenderJob,
    {
      agentId: auth.agentId,
      inspirationId: body.inspirationId,
      genType: body.genType,
      inputParams:
        body.inputParams && typeof body.inputParams === "object"
          ? body.inputParams
          : undefined,
      productUrl: typeof body.productUrl === "string" ? body.productUrl : undefined,
    }
  );
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

/** list_ugc_avatars: personas + voices so Maya can pick (and pin) an avatar
 *  for the multi-scene UGC sandwich. Free read. */
export const listUgcAvatarsHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });
  const url = new URL(request.url);
  const result = await ctx.runAction(
    internal.gtmMaya.creatifyVideo.listUgcAvatarsAction,
    {
      style: url.searchParams.get("style") ?? undefined,
      gender: url.searchParams.get("gender") ?? undefined,
    }
  );
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});
