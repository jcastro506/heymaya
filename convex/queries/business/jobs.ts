/**
 * Jobs screen queries — `/biz/jobs`.
 *
 * Per Service Sprint Plan § 12.2:
 *   - CRM-mirrored job pipeline (open / scheduled / in-progress / completed
 *     / invoiced / paid)
 *   - Filter by status, technician, zip, date range
 *   - Click → detail panel with photos, review-request status, customer
 *
 * Plan-tier:
 *   - Starter: last 30d only
 *   - Pro+:    unlimited history
 *
 * Filtering happens server-side via `planFeaturesService`. Starter clients
 * cannot bypass the 30d cap by passing a wider date range — the server
 * intersects the requested window with the tier-allowed window.
 */

import { v } from "convex/values";
import { query } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { getCurrentBusinessSession, getSessionForBusiness } from "./_session";
import { planFeaturesService } from "../../planService";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const JOB_STATUS = v.union(
  v.literal("scheduled"),
  v.literal("in-progress"),
  v.literal("completed"),
  v.literal("cancelled")
);

/**
 * List jobs for the signed-in operator's business. Respects plan-tier date
 * window: Starter callers requesting > 30d back are silently clamped to
 * `now - 30d` (the UI mirrors this with a "Upgrade to Pro for full history"
 * banner — UX hint only, server is the source of truth).
 */
export const listJobs = query({
  args: {
    status: v.optional(JOB_STATUS),
    technician: v.optional(v.string()),
    /** ms timestamp lower bound. */
    sinceMs: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Doc<"serviceJobs">[]> => {
    const session = await getCurrentBusinessSession(ctx);
    if (!session) return [];

    const features = planFeaturesService(session.business);
    const now = Date.now();

    // Plan-tier date window: Starter cannot read jobs older than 30d.
    const tierFloor = features.plan === "starter" ? now - THIRTY_DAYS_MS : 0;
    const requestedFloor = args.sinceMs ?? 0;
    const effectiveFloor = Math.max(tierFloor, requestedFloor);

    const limit = clampLimit(args.limit);

    let q;
    if (args.status !== undefined) {
      const status = args.status;
      q = ctx.db
        .query("serviceJobs")
        .withIndex("by_business_and_status", (b) =>
          b.eq("businessId", session.business._id).eq("status", status)
        );
    } else {
      q = ctx.db
        .query("serviceJobs")
        .withIndex("by_business", (b) =>
          b.eq("businessId", session.business._id)
        );
    }

    const all = await q.order("desc").collect();

    return all
      .filter((j) => {
        // Date window enforcement — `_creationTime` is the canonical row age.
        if (effectiveFloor > 0 && j._creationTime < effectiveFloor) return false;
        if (args.technician && j.technicianName !== args.technician) return false;
        return true;
      })
      .slice(0, limit);
  },
});

/**
 * Single-job detail with cross-tenant guard. The client passes the
 * `businessId` it thinks it owns — we re-verify against the session and
 * fail closed (return null) on mismatch.
 *
 * Returns the job + its associated customer + any review-request rows so
 * the detail panel renders everything in one round-trip.
 */
export const getJob = query({
  args: {
    businessId: v.id("businesses"),
    jobId: v.id("serviceJobs"),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    job: Doc<"serviceJobs">;
    customer: Doc<"serviceCustomers"> | null;
    reviewRequests: Doc<"reviewRequests">[];
  } | null> => {
    const session = await getSessionForBusiness(ctx, args.businessId);
    if (!session) return null;

    const job = await ctx.db.get(args.jobId);
    if (!job) return null;
    // Defense-in-depth: even though `getSessionForBusiness` already gated on
    // session.business._id === businessId, we re-verify the job's
    // businessId against the session before returning. A row created with a
    // mismatched businessId (impossible under normal mutation paths but
    // defensive against a future bug) returns null.
    if (job.businessId !== session.business._id) return null;

    const customer = job.customerId ? await ctx.db.get(job.customerId) : null;
    if (customer && customer.businessId !== session.business._id) {
      // Cross-tenant assertion on linked customer.
      return { job, customer: null, reviewRequests: [] };
    }

    const reviewRequests = await ctx.db
      .query("reviewRequests")
      .withIndex("by_job", (q) => q.eq("jobId", job._id))
      .collect();

    // Filter review requests to ensure they belong to the same business.
    const safeReqs = reviewRequests.filter(
      (r) => r.businessId === session.business._id
    );

    return { job, customer, reviewRequests: safeReqs };
  },
});

/**
 * Status-pipeline counts for the Jobs screen header. Returns one entry per
 * status value so the UI can render a Kanban-style strip without a second
 * query.
 */
export const getStatusCounts = query({
  args: {},
  handler: async (
    ctx
  ): Promise<Record<Doc<"serviceJobs">["status"], number>> => {
    const session = await getCurrentBusinessSession(ctx);
    const empty: Record<Doc<"serviceJobs">["status"], number> = {
      scheduled: 0,
      "in-progress": 0,
      completed: 0,
      cancelled: 0,
    };
    if (!session) return empty;

    const features = planFeaturesService(session.business);
    const tierFloor =
      features.plan === "starter" ? Date.now() - THIRTY_DAYS_MS : 0;

    const all = await ctx.db
      .query("serviceJobs")
      .withIndex("by_business", (q) =>
        q.eq("businessId", session.business._id)
      )
      .collect();

    const counts: Record<Doc<"serviceJobs">["status"], number> = { ...empty };
    for (const j of all) {
      if (tierFloor > 0 && j._creationTime < tierFloor) continue;
      counts[j.status]++;
    }
    return counts;
  },
});

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return 50;
  if (limit < 1) return 1;
  if (limit > 200) return 200;
  return Math.floor(limit);
}

// Suppress unused-warning on `Id` type re-export — kept for symmetry with
// other query files in this folder. Future detail panels add `Id<...>` args.
void (null as unknown as Id<"serviceJobs">);
