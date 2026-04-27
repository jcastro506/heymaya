/**
 * mediaAssets cataloger queue — drain side.
 *
 * Per § 10.5: pulls UP TO 5 unprocessed entries per businessId per tick.
 * The 5-concurrent-per-business rate limit is what prevents a 50-photo
 * flood from burning $1 in 10 seconds — the rest queue and drain on
 * subsequent scheduler ticks. Order is preserved (oldest enqueuedAt first).
 *
 * Skill dispatch: calls `catalogAsset` from
 * `agents/skills/maya-service-asset-cataloger/script.ts`, which is owned
 * by a parallel agent. Until that agent ships the body, the script throws
 * "Sprint 3" — we catch + treat as retryable failure with exponential
 * backoff (max 3 attempts, then give up + leave the placeholder catalog).
 * The contract: NEVER lose the file. The mediaAssets row stays; only the
 * catalog stays as [uncataloged] until a future migration recatalogs.
 *
 * Plan-tier rate caps:
 *   - Starter: 3 photos / day cataloger budget (cost protection on the
 *     cheapest tier — operator sending bulk photos hits the soft limit
 *     and waits + surfaces in the Library tab).
 *   - Pro: 100 / day soft cap (typical operator volume per § 10.5
 *     ~80/mo; 100/day is well above).
 *   - Studio: unlimited + multi-asset batch priority (≥10 photos in a
 *     batch jumps the queue ahead of single-photo enqueues).
 *
 * The hard 5-concurrent-per-business rate limit is in addition to the
 * per-tier daily cap. Per-tier cap is checked before dispatch; over-cap
 * rows stay enqueued and become eligible the next calendar day.
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  catalogAsset as productionCatalogAsset,
  type AssetCatalogerInputs,
  type AssetCatalogerOutput,
  type VisionCaller,
  type VisionCallerInput,
  type VisionCallerResult,
} from "../../agents/skills/maya-service-asset-cataloger/script";

/**
 * Test seam for the cataloger skill. Production uses the imported
 * `catalogAsset` + a real Gemini vision caller; tests inject a
 * deterministic stub. Always reset to null in `afterEach` so injected
 * stubs don't leak between tests.
 *
 * NOTE — the parallel skills-batch agent now delivers `catalogAsset` with
 * its own internal retry / fallback (returns `[uncataloged]` placeholder
 * on vision failure). The queue layer's outer retry handles cases where
 * the orchestration itself throws (e.g. R2 presign failure, cross-tenant
 * guard violation, AssetCatalogerRejectError on unsupported mime).
 */
let __injectedCataloger:
  | ((inputs: AssetCatalogerInputs) => Promise<AssetCatalogerOutput>)
  | null = null;

export function _setCatalogerSkillForTests(
  impl: ((inputs: AssetCatalogerInputs) => Promise<AssetCatalogerOutput>) | null
): void {
  __injectedCataloger = impl;
}

/**
 * Production vision caller — placeholder until Wave 4 worker is extended
 * for stills + audio (Sprint 3.5 deliverable owned by parallel agent).
 * Until that lands, this returns a stub result that drives the skill into
 * its own `uncatalogedFallback` path. Once the worker is wired,
 * replace this with an HTTP call to `${VIDEO_SYNTH_WORKER_URL}/vision-catalog`.
 *
 * Tests inject a different caller via `_setCatalogerSkillForTests` (which
 * intercepts at the higher level and never reaches this default).
 */
const productionVisionCaller: VisionCaller = async (
  _input: VisionCallerInput
): Promise<VisionCallerResult> => {
  // Returning a recognizable failure-mode string drives the skill into
  // its built-in uncatalogedFallback path. Future work: real Gemini call.
  throw new Error(
    "vision-caller not yet wired — Wave-4 worker extension pending (Sprint 3.5)"
  );
};

async function catalogAsset(
  inputs: AssetCatalogerInputs
): Promise<AssetCatalogerOutput> {
  if (__injectedCataloger) return await __injectedCataloger(inputs);
  return await productionCatalogAsset(inputs, productionVisionCaller);
}
import { getSignedUrl } from "../integrations/r2/endpoints";
import { planFeaturesService } from "../planService";

/** Max attempts before giving up + retaining placeholder catalog. */
const MAX_ATTEMPTS = 3;

/** 5 concurrent / business — § 10.5 cost-protection rate limit. */
const MAX_CONCURRENT_PER_BUSINESS = 5;

/** Per-tier daily soft caps (per businessId, per UTC day). */
const DAILY_CAP_BY_TIER = {
  starter: 3,
  pro: 100,
  studio: Number.POSITIVE_INFINITY,
} as const;

/* -------------------------------------------------------------------------- */
/* Internal queries — pick eligible work                                       */
/* -------------------------------------------------------------------------- */

/**
 * Return up to MAX_CONCURRENT_PER_BUSINESS unprocessed cataloger queue rows
 * for the given business, oldest first. Studio operators with a batch of
 * ≥10 enqueued get batch-priority — those rows surface ahead of single-
 * asset enqueues from the same business.
 */
export const pickEligibleWork = internalQuery({
  args: {
    businessId: v.id("businesses"),
    /** Override the wall-clock time for tests. */
    nowMs: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    rows: Array<{
      _id: Id<"mayaTaskQueue">;
      payload: { mediaAssetId: Id<"mediaAssets">; batchId?: string };
      attemptCount: number;
    }>;
    isStudioBatch: boolean;
  }> => {
    const business = await ctx.db.get(args.businessId);
    if (!business) return { rows: [], isStudioBatch: false };

    const all = await ctx.db
      .query("mayaTaskQueue")
      .withIndex("by_business_and_kind", (q) =>
        q.eq("businessId", args.businessId).eq("kind", "asset-cataloger")
      )
      .collect();

    const unprocessed = all
      .filter((r) => r.processedAt === undefined)
      .sort((a, b) => a.enqueuedAt - b.enqueuedAt);

    // Studio batch-priority: if ≥10 rows share a batchId, bubble those.
    const features = planFeaturesService(business);
    const isStudio = features.plan === "studio";
    const batchCounts = new Map<string, number>();
    for (const row of unprocessed) {
      const payload = row.payload as { batchId?: string };
      if (payload?.batchId) {
        batchCounts.set(
          payload.batchId,
          (batchCounts.get(payload.batchId) ?? 0) + 1
        );
      }
    }
    const priorityBatchIds = new Set(
      [...batchCounts.entries()]
        .filter(([, count]) => count >= 10)
        .map(([id]) => id)
    );
    const isStudioBatch = isStudio && priorityBatchIds.size > 0;

    const sorted = isStudioBatch
      ? unprocessed
          .slice()
          .sort((a, b) => {
            const aPri = priorityBatchIds.has(
              (a.payload as { batchId?: string }).batchId ?? ""
            );
            const bPri = priorityBatchIds.has(
              (b.payload as { batchId?: string }).batchId ?? ""
            );
            if (aPri && !bPri) return -1;
            if (bPri && !aPri) return 1;
            return a.enqueuedAt - b.enqueuedAt;
          })
      : unprocessed;

    const slice = sorted.slice(0, MAX_CONCURRENT_PER_BUSINESS);
    return {
      rows: slice.map((r) => ({
        _id: r._id,
        payload: r.payload as {
          mediaAssetId: Id<"mediaAssets">;
          batchId?: string;
        },
        attemptCount: r.attemptCount ?? 0,
      })),
      isStudioBatch,
    };
  },
});

/**
 * Count how many cataloger rows have COMPLETED for this business in the
 * current UTC day. Used to enforce the per-tier daily soft cap. Counts
 * `processedAt` (regardless of success / placeholder) — the budget is
 * about Gemini calls attempted, not strictly successful.
 */
export const countCompletedToday = internalQuery({
  args: {
    businessId: v.id("businesses"),
    nowMs: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<number> => {
    const now = args.nowMs ?? Date.now();
    const dayStart = utcDayStart(now);
    const all = await ctx.db
      .query("mayaTaskQueue")
      .withIndex("by_business_and_kind", (q) =>
        q.eq("businessId", args.businessId).eq("kind", "asset-cataloger")
      )
      .collect();
    return all.filter(
      (r) =>
        r.processedAt !== undefined &&
        r.processedAt >= dayStart &&
        r.processedAt < dayStart + 24 * 60 * 60 * 1000
    ).length;
  },
});

function utcDayStart(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    0,
    0,
    0,
    0
  );
}

/* -------------------------------------------------------------------------- */
/* Internal mutations — apply catalog / mark failed / mark done                */
/* -------------------------------------------------------------------------- */

export const applyCatalogResult = internalMutation({
  args: {
    queueRowId: v.id("mayaTaskQueue"),
    mediaAssetId: v.id("mediaAssets"),
    catalog: v.object({
      primarySubject: v.string(),
      serviceCategory: v.string(),
      visualQuality: v.union(
        v.literal("excellent"),
        v.literal("good"),
        v.literal("fair"),
        v.literal("poor")
      ),
      framingNotes: v.string(),
      suggestedUses: v.array(v.string()),
      pairableWithAssetId: v.optional(v.id("mediaAssets")),
      captionDraft: v.optional(v.string()),
      catalogedAt: v.number(),
      catalogModel: v.string(),
      catalogCostUsd: v.number(),
    }),
  },
  handler: async (ctx, args): Promise<void> => {
    await ctx.db.patch(args.mediaAssetId, { catalog: args.catalog });
    await ctx.db.patch(args.queueRowId, { processedAt: Date.now() });
  },
});

export const markAttemptFailed = internalMutation({
  args: {
    queueRowId: v.id("mayaTaskQueue"),
    error: v.string(),
    /**
     * When `terminal=true` the row is marked processed (giving up) so it
     * stops blocking the queue. The mediaAssets row keeps its placeholder
     * catalog; a future schema-version bump or operator-requested refresh
     * can recatalog. Never lose the file.
     */
    terminal: v.boolean(),
  },
  handler: async (ctx, args): Promise<void> => {
    const row = await ctx.db.get(args.queueRowId);
    if (!row) return;
    const nextAttempts = (row.attemptCount ?? 0) + 1;
    const patch: Partial<Doc<"mayaTaskQueue">> = {
      attemptCount: nextAttempts,
      lastError: args.error.slice(0, 500),
    };
    if (args.terminal) {
      patch.processedAt = Date.now();
      patch.failedAt = Date.now();
    }
    await ctx.db.patch(args.queueRowId, patch);
  },
});

export const getMediaAssetForCatalog = internalQuery({
  args: { mediaAssetId: v.id("mediaAssets") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.mediaAssetId);
    if (!row) return null;
    return {
      businessId: row.businessId,
      storageUrl: row.storageUrl,
      mimeType: row.mimeType,
      serviceJobId: row.serviceJobId,
      catalogIsPlaceholder: row.catalog.primarySubject === "[uncataloged]",
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Public action — drain the queue for one business                            */
/* -------------------------------------------------------------------------- */

export interface ProcessQueueResult {
  businessId: string;
  attempted: number;
  succeeded: number;
  failed: number;
  retried: number;
  skippedDailyCap: number;
}

/**
 * Drain up to MAX_CONCURRENT_PER_BUSINESS cataloger rows for a single
 * business. Called by the per-business scheduler tick (registered in
 * `convex/crons.ts` at Sprint 3.5 wiring time — for now invokable directly
 * by tests + manual ops).
 */
export const processCatalogerQueueForBusiness = internalAction({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args): Promise<ProcessQueueResult> => {
    const completedToday: number = await ctx.runQuery(
      internal.mediaAssets.processCatalogerQueue.countCompletedToday,
      { businessId: args.businessId }
    );

    const business = await ctx.runQuery(
      internal.mediaAssets.processCatalogerQueue.getBusinessForGate,
      { businessId: args.businessId }
    );
    if (!business) {
      return {
        businessId: args.businessId,
        attempted: 0,
        succeeded: 0,
        failed: 0,
        retried: 0,
        skippedDailyCap: 0,
      };
    }
    const tier = business.planTier ?? "starter";
    const dailyCap =
      DAILY_CAP_BY_TIER[tier as keyof typeof DAILY_CAP_BY_TIER] ??
      DAILY_CAP_BY_TIER.starter;
    const remainingBudget = Math.max(0, dailyCap - completedToday);

    const eligible = await ctx.runQuery(
      internal.mediaAssets.processCatalogerQueue.pickEligibleWork,
      { businessId: args.businessId }
    );

    const result: ProcessQueueResult = {
      businessId: args.businessId,
      attempted: 0,
      succeeded: 0,
      failed: 0,
      retried: 0,
      skippedDailyCap: 0,
    };

    let usedBudget = 0;
    for (const row of eligible.rows) {
      if (usedBudget >= remainingBudget) {
        result.skippedDailyCap++;
        continue;
      }
      result.attempted++;
      usedBudget++;

      const asset = await ctx.runQuery(
        internal.mediaAssets.processCatalogerQueue.getMediaAssetForCatalog,
        { mediaAssetId: row.payload.mediaAssetId }
      );
      if (!asset) {
        // Asset was deleted out from under us. Mark the queue row processed
        // (terminal) so it doesn't block the queue.
        await ctx.runMutation(
          internal.mediaAssets.processCatalogerQueue.markAttemptFailed,
          {
            queueRowId: row._id,
            error: "media asset row missing",
            terminal: true,
          }
        );
        result.failed++;
        continue;
      }

      // Cross-tenant guard: assert the asset belongs to the business we're
      // processing. Defense in depth — the queue row is also businessId-
      // scoped, but a corrupted payload could in principle point at a
      // different business's asset.
      if (asset.businessId !== args.businessId) {
        await ctx.runMutation(
          internal.mediaAssets.processCatalogerQueue.markAttemptFailed,
          {
            queueRowId: row._id,
            error: "cross-tenant violation: asset.businessId !== queue.businessId",
            terminal: true,
          }
        );
        result.failed++;
        continue;
      }

      // Build a short-lived signed URL so the cataloger never sees the raw
      // R2 storage URL (which is private). The cataloger Gemini call uses
      // this URL via the Files API.
      let signedUrl: string;
      try {
        signedUrl = await getSignedUrl({
          storageKey: extractKeyFromStorageUrl(asset.storageUrl),
          expiresInSec: 5 * 60,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const nextAttempts = row.attemptCount + 1;
        await ctx.runMutation(
          internal.mediaAssets.processCatalogerQueue.markAttemptFailed,
          {
            queueRowId: row._id,
            error: `presign failed: ${msg}`,
            terminal: nextAttempts >= MAX_ATTEMPTS,
          }
        );
        if (nextAttempts >= MAX_ATTEMPTS) result.failed++;
        else result.retried++;
        continue;
      }

      const skillInputs: AssetCatalogerInputs = {
        assetUrl: signedUrl,
        mimeType: asset.mimeType,
        businessId: args.businessId,
        serviceJobId: asset.serviceJobId
          ? String(asset.serviceJobId)
          : undefined,
        geminiFilesApiClient: getInjectedGeminiClient() ?? {},
      };

      let skillOutput: AssetCatalogerOutput | null = null;
      try {
        skillOutput = await catalogAsset(skillInputs);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const nextAttempts = row.attemptCount + 1;
        await ctx.runMutation(
          internal.mediaAssets.processCatalogerQueue.markAttemptFailed,
          {
            queueRowId: row._id,
            error: msg,
            terminal: nextAttempts >= MAX_ATTEMPTS,
          }
        );
        if (nextAttempts >= MAX_ATTEMPTS) result.failed++;
        else result.retried++;
        continue;
      }

      // Convert the skill's catalog (numeric visualQuality 0..1) into our
      // schema's literal-union form. Map: >=0.8 excellent, >=0.6 good,
      // >=0.4 fair, else poor. The skill SKILL.md spec returns numeric;
      // schema stores literal; this is the bridging layer.
      const catalogToWrite = {
        primarySubject: skillOutput.catalog.primarySubject,
        serviceCategory: skillOutput.catalog.serviceCategory,
        visualQuality: numericToVisualQuality(skillOutput.catalog.visualQuality),
        framingNotes: skillOutput.catalog.framingNotes,
        suggestedUses: skillOutput.catalog.suggestedUses.slice(),
        pairableWithAssetId: undefined as Id<"mediaAssets"> | undefined,
        captionDraft: skillOutput.catalog.captionDraft,
        catalogedAt: skillOutput.catalog.catalogedAt,
        catalogModel: skillOutput.catalog.catalogModel,
        catalogCostUsd: skillOutput.catalog.catalogCostUsd,
      };

      await ctx.runMutation(
        internal.mediaAssets.processCatalogerQueue.applyCatalogResult,
        {
          queueRowId: row._id,
          mediaAssetId: row.payload.mediaAssetId,
          catalog: catalogToWrite,
        }
      );
      result.succeeded++;
    }

    return result;
  },
});

export const getBusinessForGate = internalQuery({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.businessId);
    if (!row) return null;
    return { _id: row._id, planTier: row.planTier };
  },
});

/* -------------------------------------------------------------------------- */
/* Test seam for the cataloger skill — Gemini Files API client injection       */
/* -------------------------------------------------------------------------- */

let __injectedGeminiClient: unknown = null;

/**
 * Test seam — production code reads `GOOGLE_GENAI_API_KEY` via the skill
 * itself. Tests inject a deterministic stub so the queue processor can be
 * exercised end-to-end without burning real Gemini calls.
 */
export function _setGeminiClientForTests(client: unknown): void {
  __injectedGeminiClient = client;
}

function getInjectedGeminiClient(): unknown {
  return __injectedGeminiClient;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Pull the bucket-key portion off a storageUrl. The R2 client builds URLs
 * as `https://{bucket}.{host}/{key}`; we recover the key by stripping
 * `https://{bucket}.{host}/`. If the URL is malformed we throw — the
 * cataloger queue treats this as a retryable error.
 */
function extractKeyFromStorageUrl(storageUrl: string): string {
  try {
    const u = new URL(storageUrl);
    return u.pathname.replace(/^\/+/, "");
  } catch {
    throw new Error(`malformed storageUrl: ${storageUrl}`);
  }
}

function numericToVisualQuality(
  v: number
): "excellent" | "good" | "fair" | "poor" {
  if (v >= 0.8) return "excellent";
  if (v >= 0.6) return "good";
  if (v >= 0.4) return "fair";
  return "poor";
}

/**
 * Exposed for tests — same numeric→literal mapping the queue uses.
 */
export const _numericToVisualQualityForTests = numericToVisualQuality;
