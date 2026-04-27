/**
 * Wave 3 (onboarding parallelism) — background-job kickoff + tracking.
 *
 * The two slow async stages of onboarding (bulk ScrapeCreators pull + the
 * multimodal Gemini 3 Flash creator-picture synthesis) used to live serially
 * at the END of onboarding inside `runOnboardingDeploy`, where the user
 * watched a spinner for ~60-90s. This module fires them WHILE the user is
 * still answering questions / picking a channel, so by the time the Deploy
 * step runs, both jobs are already done.
 *
 * Flow shape:
 *   - HandlesStep submits → `kickoffBulkPullJob` → returns jobId immediately,
 *     internal action runs the heavy bulk pull in the background, patches
 *     the row to running/done/failed.
 *   - PullingStep subscribes to `getJobStatus({jobType:"bulk-pull"})` and
 *     renders REAL progress.
 *   - QuestionsStep submits final answer → `kickoffSynthJob` → same pattern.
 *   - DeployStep checks both jobs, skips stages 1+2 of `runOnboardingDeploy`
 *     when they're done.
 *
 * Cross-tenant safety:
 *   - Every PUBLIC mutation/action re-resolves the creator from the Clerk
 *     identity. The client never gets to choose `creatorId`.
 *   - The internal actions take `jobId` and re-resolve `creatorId` from the
 *     job row before doing anything.
 *   - `getJobStatus` filters by signed-in creator ONLY.
 *   - The internal actions are scheduled-only — they're not exported through
 *     any client-callable surface.
 *
 * Plan-tier policy:
 *   - Onboarding is universal. No plan check on these jobs (the creator
 *     hasn't even picked a plan yet at HandlesStep time, in the trial flow).
 *
 * Idempotency:
 *   - `kickoffBulkPullJob` / `kickoffSynthJob` look for an in-flight job for
 *     the same creator+type FIRST. If one exists with status pending/running,
 *     the existing jobId is returned (no double-schedule). A `done` job is
 *     returned as-is too (no re-run). A `failed` job kicks off a fresh row
 *     (the retry semantics match what DeployStep expects).
 *
 * Why ctx.scheduler.runAfter(0, ...):
 *   - Convex's request model doesn't keep arbitrary detached promises alive
 *     past the action's return. The scheduler is the supported primitive for
 *     "fire and forget background work" — the scheduled function runs in its
 *     own action invocation with its own request lifecycle.
 *   - This means the kickoff action returns IMMEDIATELY (sub-100ms) and the
 *     heavy work happens in the scheduled internal action.
 */

import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

export type OnboardingJobType = "bulk-pull" | "synth-picture";
export type OnboardingJobStatus = "pending" | "running" | "done" | "failed";

/** TTL for job rows. An infra cron sweeps `by_expires_at` in v0.X. */
const JOB_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/* -------------------------------------------------------------------------- */
/* Identity resolution                                                         */
/* -------------------------------------------------------------------------- */

const findCreatorByClerkUser = internalQuery({
  args: { clerkUserId: v.string() },
  handler: async (ctx, args): Promise<Doc<"creators"> | null> => {
    return await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", args.clerkUserId))
      .first();
  },
});

/* -------------------------------------------------------------------------- */
/* Internal job-row mutations                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Look up the most-recent job row for (creator, jobType). Used by the
 * idempotency guard in `kickoffBulkPullJob` / `kickoffSynthJob` and by
 * `getJobStatus`.
 */
export const getLatestJobForCreator = internalQuery({
  args: {
    creatorId: v.id("creators"),
    jobType: v.union(
      v.literal("bulk-pull"),
      v.literal("synth-picture"),
    ),
  },
  handler: async (ctx, args): Promise<Doc<"onboardingJobs"> | null> => {
    const rows = await ctx.db
      .query("onboardingJobs")
      .withIndex("by_creator_and_type", (q) =>
        q.eq("creatorId", args.creatorId).eq("jobType", args.jobType)
      )
      .collect();
    if (rows.length === 0) return null;
    // Most-recent by startedAt — tests pin this ordering.
    return rows.reduce((latest, r) =>
      r.startedAt > latest.startedAt ? r : latest
    );
  },
});

/**
 * Insert a fresh `onboardingJobs` row in `pending` state. Caller schedules
 * the internal worker action immediately after.
 */
export const insertJobRow = internalMutation({
  args: {
    creatorId: v.id("creators"),
    jobType: v.union(
      v.literal("bulk-pull"),
      v.literal("synth-picture"),
    ),
    now: v.number(),
  },
  handler: async (ctx, args): Promise<Id<"onboardingJobs">> => {
    return await ctx.db.insert("onboardingJobs", {
      creatorId: args.creatorId,
      jobType: args.jobType,
      status: "pending",
      startedAt: args.now,
      expiresAt: args.now + JOB_TTL_MS,
    });
  },
});

/** Patch the row's status. Used for the running/done/failed transitions. */
export const patchJobRow = internalMutation({
  args: {
    jobId: v.id("onboardingJobs"),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("running"),
        v.literal("done"),
        v.literal("failed"),
      )
    ),
    progress: v.optional(v.any()),
    result: v.optional(v.any()),
    errorDetail: v.optional(v.string()),
    completedAt: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<void> => {
    const row = await ctx.db.get(args.jobId);
    if (!row) return; // idempotent — caller may have advanced state already
    const patch: Partial<Doc<"onboardingJobs">> = {};
    if (args.status !== undefined) patch.status = args.status;
    if (args.progress !== undefined) patch.progress = args.progress;
    if (args.result !== undefined) patch.result = args.result;
    if (args.errorDetail !== undefined) patch.errorDetail = args.errorDetail;
    if (args.completedAt !== undefined) patch.completedAt = args.completedAt;
    await ctx.db.patch(args.jobId, patch);
  },
});

/**
 * Cancel a job (mutation). Used by the HandlesStep "Undo + restart" path:
 * if the user wants to edit handles after Continue, we want to nullify the
 * outstanding bulk-pull row. Marks the row as `failed` with a cancellation
 * marker so the existing path-failure UI / DeployStep retry logic still
 * works (they treat cancelled the same as a transient failure → retry).
 *
 * Cross-tenant: re-resolves creator from Clerk and asserts the job row's
 * creatorId matches before patching. Cancel-without-active-job is a no-op
 * (returns null) — not an error — so the UI can "Undo" idempotently.
 */
export const cancelJob = mutation({
  args: {
    jobType: v.union(
      v.literal("bulk-pull"),
      v.literal("synth-picture"),
    ),
  },
  handler: async (ctx, args): Promise<{ cancelled: boolean }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { cancelled: false };
    const me = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first();
    if (!me) return { cancelled: false };
    const rows = await ctx.db
      .query("onboardingJobs")
      .withIndex("by_creator_and_type", (q) =>
        q.eq("creatorId", me._id).eq("jobType", args.jobType)
      )
      .collect();
    if (rows.length === 0) return { cancelled: false };
    const latest = rows.reduce((acc, r) =>
      r.startedAt > acc.startedAt ? r : acc
    );
    if (latest.status === "done" || latest.status === "failed") {
      return { cancelled: false };
    }
    await ctx.db.patch(latest._id, {
      status: "failed",
      errorDetail: "cancelled-by-user",
      completedAt: Date.now(),
    });
    return { cancelled: true };
  },
});

/* -------------------------------------------------------------------------- */
/* Public: kickoff actions                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Public action — fires the bulk ScrapeCreators pull as a background job.
 *
 * Returns the jobId immediately (sub-100ms). The actual work is scheduled
 * to run via `ctx.scheduler.runAfter(0, ...)` so this action does NOT await
 * the heavy work. PullingStep subscribes to `getJobStatus` for live state.
 *
 * Idempotent: if a pending/running/done row already exists for this creator,
 * its jobId is returned (no double-schedule). A `failed` row spawns a fresh
 * job (retry semantics).
 */
export const kickoffBulkPullJob = action({
  args: {},
  handler: async (
    ctx,
    _args
  ): Promise<{
    ok: boolean;
    jobId: Id<"onboardingJobs"> | null;
    status: OnboardingJobStatus | null;
    reason?: string;
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return {
        ok: false,
        jobId: null,
        status: null,
        reason: "kickoffBulkPullJob: signed-in Clerk user required.",
      };
    }
    const me = await ctx.runQuery(
      internal.onboarding.maya.jobs.findCreatorByClerkUser,
      { clerkUserId: identity.subject }
    );
    if (!me) {
      return {
        ok: false,
        jobId: null,
        status: null,
        reason: "kickoffBulkPullJob: creators row not found for signed-in user.",
      };
    }

    // Idempotency guard.
    const existing = await ctx.runQuery(
      internal.onboarding.maya.jobs.getLatestJobForCreator,
      { creatorId: me._id, jobType: "bulk-pull" }
    );
    if (
      existing &&
      (existing.status === "pending" ||
        existing.status === "running" ||
        existing.status === "done")
    ) {
      return {
        ok: true,
        jobId: existing._id,
        status: existing.status,
      };
    }

    const jobId = await ctx.runMutation(
      internal.onboarding.maya.jobs.insertJobRow,
      { creatorId: me._id, jobType: "bulk-pull", now: Date.now() }
    );

    // Fire-and-forget. The scheduler guarantees the function runs in its
    // own request lifecycle even if this action returns immediately.
    await ctx.scheduler.runAfter(
      0,
      internal.onboarding.maya.jobs.runBulkPullJob,
      { jobId }
    );

    return { ok: true, jobId, status: "pending" };
  },
});

/**
 * Public action — fires the multimodal creator-picture synthesis as a
 * background job. Same shape as `kickoffBulkPullJob`.
 *
 * Behavior when bulk-pull is not yet done: returns ok=true with reason
 * "waiting-for-bulk-pull" and does NOT schedule the synth. The caller (or
 * DeployStep) is expected to poll `getJobStatus("bulk-pull")` until done
 * before retrying. We deliberately don't queue-and-wait here — that would
 * tie up the scheduled action's runtime budget for a wait that may never
 * resolve (bulk-pull failed). Cleaner to fail-fast and let the UI retry.
 */
export const kickoffSynthJob = action({
  args: {},
  handler: async (
    ctx,
    _args
  ): Promise<{
    ok: boolean;
    jobId: Id<"onboardingJobs"> | null;
    status: OnboardingJobStatus | null;
    reason?: string;
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return {
        ok: false,
        jobId: null,
        status: null,
        reason: "kickoffSynthJob: signed-in Clerk user required.",
      };
    }
    const me = await ctx.runQuery(
      internal.onboarding.maya.jobs.findCreatorByClerkUser,
      { clerkUserId: identity.subject }
    );
    if (!me) {
      return {
        ok: false,
        jobId: null,
        status: null,
        reason: "kickoffSynthJob: creators row not found for signed-in user.",
      };
    }

    // Synth requires bulk-pull to be done first. We don't enforce a wait here
    // (see module docstring) — fail-fast and let the UI poll.
    const bulkPullJob = await ctx.runQuery(
      internal.onboarding.maya.jobs.getLatestJobForCreator,
      { creatorId: me._id, jobType: "bulk-pull" }
    );
    if (!bulkPullJob || bulkPullJob.status !== "done") {
      return {
        ok: false,
        jobId: null,
        status: null,
        reason:
          "kickoffSynthJob: bulk-pull job must complete before synthesis can start.",
      };
    }

    // Idempotency guard.
    const existing = await ctx.runQuery(
      internal.onboarding.maya.jobs.getLatestJobForCreator,
      { creatorId: me._id, jobType: "synth-picture" }
    );
    if (
      existing &&
      (existing.status === "pending" ||
        existing.status === "running" ||
        existing.status === "done")
    ) {
      return {
        ok: true,
        jobId: existing._id,
        status: existing.status,
      };
    }

    const jobId = await ctx.runMutation(
      internal.onboarding.maya.jobs.insertJobRow,
      { creatorId: me._id, jobType: "synth-picture", now: Date.now() }
    );

    await ctx.scheduler.runAfter(
      0,
      internal.onboarding.maya.jobs.runSynthJob,
      { jobId }
    );

    return { ok: true, jobId, status: "pending" };
  },
});

/* -------------------------------------------------------------------------- */
/* Public: status query                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Public query — returns the latest job row for the signed-in creator +
 * jobType. Used by PullingStep to subscribe to live progress.
 *
 * Returns null when:
 *   - unauthenticated
 *   - creator row not found
 *   - no matching job row exists
 *
 * Cross-tenant: filtered to the signed-in creator. There is NO way for the
 * client to specify a `creatorId` argument.
 */
export const getJobStatus = query({
  args: {
    jobType: v.union(
      v.literal("bulk-pull"),
      v.literal("synth-picture"),
    ),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    jobId: Id<"onboardingJobs">;
    status: OnboardingJobStatus;
    progress: unknown;
    errorDetail: string | null;
    startedAt: number;
    completedAt: number | null;
  } | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const me = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first();
    if (!me) return null;
    const rows = await ctx.db
      .query("onboardingJobs")
      .withIndex("by_creator_and_type", (q) =>
        q.eq("creatorId", me._id).eq("jobType", args.jobType)
      )
      .collect();
    if (rows.length === 0) return null;
    const latest = rows.reduce((acc, r) =>
      r.startedAt > acc.startedAt ? r : acc
    );
    return {
      jobId: latest._id,
      status: latest.status,
      progress: latest.progress ?? null,
      errorDetail: latest.errorDetail ?? null,
      startedAt: latest.startedAt,
      completedAt: latest.completedAt ?? null,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Internal worker actions — scheduled-only                                    */
/* -------------------------------------------------------------------------- */

/**
 * Internal worker — does the actual bulk pull. Patches the job row from
 * pending → running → done (or failed). Runs INSIDE its own action request
 * lifecycle (scheduled via runAfter), so it can take 30-60s without
 * blocking the kickoff action.
 *
 * Re-resolves creator + handles from the job row's `creatorId` — does NOT
 * trust any client-provided argument (none can reach this internal action
 * anyway, but defense-in-depth).
 */
export const runBulkPullJob = internalAction({
  args: { jobId: v.id("onboardingJobs") },
  handler: async (ctx, args): Promise<void> => {
    const job = await ctx.runQuery(
      internal.onboarding.maya.jobs.getJobRow,
      { jobId: args.jobId }
    );
    if (!job) return; // job row was deleted between schedule and execution
    // Idempotent: a re-fire on an already-completed row is a no-op.
    if (job.status === "done" || job.status === "failed") return;

    // Mark running.
    await ctx.runMutation(internal.onboarding.maya.jobs.patchJobRow, {
      jobId: args.jobId,
      status: "running",
      progress: {
        handlesProcessed: 0,
        totalHandles: 0,
        postsPulled: 0,
      },
    });

    // Resolve handles. The deploy pipeline already has a helper for this;
    // we use the same one to keep the single source of truth.
    let handles: Array<{
      platform: "tiktok" | "instagram" | "youtube" | "linkedin" | "x";
      handle: string;
    }>;
    try {
      handles = await ctx.runQuery(
        internal.onboarding.maya.deployMaya.listScrapableHandles,
        { creatorId: job.creatorId }
      );
    } catch (err) {
      await ctx.runMutation(internal.onboarding.maya.jobs.patchJobRow, {
        jobId: args.jobId,
        status: "failed",
        errorDetail: `runBulkPullJob: failed to list handles: ${(err as Error).message}`,
        completedAt: Date.now(),
      });
      return;
    }

    if (handles.length === 0) {
      // No handles to pull — succeed trivially. Deploy will see status=done
      // and skip the scrape stage. Synthesis will still gracefully handle
      // an empty cache (it returns a no-scraped-data structured failure
      // and downstream UX falls back to a stub picture).
      await ctx.runMutation(internal.onboarding.maya.jobs.patchJobRow, {
        jobId: args.jobId,
        status: "done",
        progress: {
          handlesProcessed: 0,
          totalHandles: 0,
          postsPulled: 0,
        },
        result: { platforms: [], handlesProcessed: 0 },
        completedAt: Date.now(),
      });
      return;
    }

    // Patch the discovered total so the UI's progress bar can scale.
    await ctx.runMutation(internal.onboarding.maya.jobs.patchJobRow, {
      jobId: args.jobId,
      progress: {
        handlesProcessed: 0,
        totalHandles: handles.length,
        postsPulled: 0,
      },
    });

    try {
      const pullResult = await ctx.runAction(
        internal.integrations.scrapeCreators.runFullScrapePull
          .runFullScrapePull,
        { creatorId: job.creatorId, handles }
      );
      // Tally posts pulled across all platforms.
      const postsPulled = pullResult.platforms.reduce(
        (acc, p) => acc + (p.posts?.length ?? 0),
        0
      );
      await ctx.runMutation(internal.onboarding.maya.jobs.patchJobRow, {
        jobId: args.jobId,
        status: "done",
        progress: {
          handlesProcessed: handles.length,
          totalHandles: handles.length,
          postsPulled,
        },
        result: {
          platforms: pullResult.platforms.map((p) => ({
            platform: p.platform,
            handle: p.handle,
            ok: p.ok,
            postsCount: p.posts?.length ?? 0,
            errorsCount: p.errors?.length ?? 0,
          })),
          handlesProcessed: handles.length,
          postsPulled,
        },
        completedAt: Date.now(),
      });
    } catch (err) {
      await ctx.runMutation(internal.onboarding.maya.jobs.patchJobRow, {
        jobId: args.jobId,
        status: "failed",
        errorDetail: `runBulkPullJob: bulk pull failed: ${(err as Error).message}`,
        completedAt: Date.now(),
      });
    }
  },
});

/**
 * Internal worker — runs the multimodal synthesis. Patches the job row
 * pending → running → done (or failed). Same shape as `runBulkPullJob`.
 *
 * Calls the existing `internal.onboarding.maya.synthesizeCreatorPicture
 * .synthesizeCreatorPicture` action under the hood, which already does
 * its own thinking-budget bypass + citation firewall + retry on malformed
 * JSON. This worker is just a thin status-tracking wrapper.
 */
export const runSynthJob = internalAction({
  args: { jobId: v.id("onboardingJobs") },
  handler: async (ctx, args): Promise<void> => {
    const job = await ctx.runQuery(
      internal.onboarding.maya.jobs.getJobRow,
      { jobId: args.jobId }
    );
    if (!job) return;
    if (job.status === "done" || job.status === "failed") return;

    await ctx.runMutation(internal.onboarding.maya.jobs.patchJobRow, {
      jobId: args.jobId,
      status: "running",
      progress: { stage: "calling-gemini" },
    });

    try {
      const synthResult = await ctx.runAction(
        internal.onboarding.maya.synthesizeCreatorPicture
          .synthesizeCreatorPicture,
        { creatorId: job.creatorId }
      );
      if (!synthResult.ok) {
        await ctx.runMutation(internal.onboarding.maya.jobs.patchJobRow, {
          jobId: args.jobId,
          status: "failed",
          errorDetail: `runSynthJob: synthesis failed at stage '${synthResult.stage}': ${synthResult.message}`,
          completedAt: Date.now(),
        });
        return;
      }
      await ctx.runMutation(internal.onboarding.maya.jobs.patchJobRow, {
        jobId: args.jobId,
        status: "done",
        progress: { stage: "writing" },
        result: {
          creatorPictureId: synthResult.creatorPictureId,
          model: synthResult.model,
          costUsd: synthResult.costUsd,
          latencyMs: synthResult.latencyMs,
          retried: synthResult.retried,
        },
        completedAt: Date.now(),
      });
    } catch (err) {
      await ctx.runMutation(internal.onboarding.maya.jobs.patchJobRow, {
        jobId: args.jobId,
        status: "failed",
        errorDetail: `runSynthJob: ${(err as Error).message}`,
        completedAt: Date.now(),
      });
    }
  },
});

/**
 * Internal helper — fetch a job row by id. Used by the worker actions and
 * by deployMaya's wait/skip logic.
 */
export const getJobRow = internalQuery({
  args: { jobId: v.id("onboardingJobs") },
  handler: async (ctx, args): Promise<Doc<"onboardingJobs"> | null> => {
    return await ctx.db.get(args.jobId);
  },
});

/**
 * Internal helper — used by `runOnboardingDeploy` to peek at the latest
 * pre-fired job for a creator without going through the public Clerk path.
 */
export const getLatestJobForCreatorInternal = internalQuery({
  args: {
    creatorId: v.id("creators"),
    jobType: v.union(
      v.literal("bulk-pull"),
      v.literal("synth-picture"),
    ),
  },
  handler: async (ctx, args): Promise<Doc<"onboardingJobs"> | null> => {
    const rows = await ctx.db
      .query("onboardingJobs")
      .withIndex("by_creator_and_type", (q) =>
        q.eq("creatorId", args.creatorId).eq("jobType", args.jobType)
      )
      .collect();
    if (rows.length === 0) return null;
    return rows.reduce((latest, r) =>
      r.startedAt > latest.startedAt ? r : latest
    );
  },
});

// Re-export the internal helper so the deployMaya action can import it via
// the generated `internal` map without a separate file.
export { findCreatorByClerkUser };
