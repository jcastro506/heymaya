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
  getCreatifyJob,
  getInspirations,
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
/** Any persisted Creatify job — video or static image — share the poll loop. */
type JobMode = VideoMode | ImageMode;

/** True for the static-image modes (gated by canImage + assetCreditsMonth). */
function isImageMode(mode: JobMode): mode is ImageMode {
  return mode === "iab_images";
}

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
function countRecentVideos(jobsJson: string | null): number {
  const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
  return parseJobs(jobsJson ?? undefined).filter(
    (j) => j.createdAt >= since && j.status !== "failed" && !isImageMode(j.mode)
  ).length;
}

/** STATIC-IMAGE jobs in the trailing 30 days — counted against assetCreditsMonth. */
function countRecentAssets(jobsJson: string | null): number {
  const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
  return parseJobs(jobsJson ?? undefined).filter(
    (j) => j.createdAt >= since && j.status !== "failed" && isImageMode(j.mode)
  ).length;
}

/**
 * Docs-derived per-job cost ESTIMATE in USD, for ledger metadata + a soft
 * preflight log only — NOT a hard gate (the hard gates are canVideo/canImage +
 * the monthly count caps). ⚠ These are docs estimates; the real cost comes from
 * `credits_used` on the finished job. Re-ground if the live numbers differ.
 */
function estimatedCreatifyCostUsd(mode: JobMode): number {
  const perCredit = usdPerCredit();
  // ad_clone ~24cr/10s · url_to_video ~5cr/30s · iab_images ~2cr.
  const credits = mode === "ad_clone" ? 24 : mode === "iab_images" ? 2 : 5;
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
    if (used >= plan.videoCreditsMonth) {
      return {
        ok: false,
        reason: `video_cap_reached (${used}/${plan.videoCreditsMonth} this month)`,
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
      if (args.mode === "ad_clone") {
        job = await createAdClone({
          link: link.id,
          video_url: args.referenceVideoUrl as string,
          aspect_ratio: "9x16",
        });
      } else {
        job = await createLinkToVideo({
          link: link.id,
          aspect_ratio: "9x16",
          video_length: (args.videoLength as 15 | 30 | 45 | 60 | undefined) ?? 15,
          override_script: args.overrideScript ?? null,
          script_style: args.scriptStyle ?? null,
          visual_style: args.visualStyle ?? null,
          model_version:
            (args.modelVersion as "standard" | "aurora_v1" | "aurora_v1_fast" | undefined) ??
            "standard",
        });
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
  ): Promise<{ ok: boolean; reason?: string; recipes?: Array<{ id: string; name: string | null }> }> => {
    if (!isCreatifyConfigured()) {
      return { ok: false, reason: "creatify_not_configured" };
    }
    try {
      const list = await getInspirations();
      return {
        ok: true,
        recipes: list.slice(0, 40).map((r) => ({ id: r.id, name: r.name ?? null })),
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
  const image = isImageMode(job.mode);
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
      operation: image ? "creatify_image" : "creatify_video",
      reason: `${job.mode} ${image ? "image" : "video"} (${creditsUsed} cr)`,
      costUsd,
      units: creditsUsed,
      cacheStatus: "called",
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
      terminal = await getCreatifyJob(job.mode, job.creatifyId);
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
        terminal = await getCreatifyJob(job.mode, job.creatifyId);
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
