/**
 * Customers screen queries — `/biz/customers`.
 *
 * Per Service Sprint Plan § 12.5:
 *   - CRM-mirrored customer list
 *   - Lifetime value, last interaction, review status
 *   - Filter by zip, service-type, ticket-size, review-status
 *   - Click → customer detail (job history, review history, LTV)
 *   - Bulk-action: send review-request to last-30d-completed-with-no-review
 *
 * Plan-tier:
 *   - Starter: CRM-empty state — there are no customers because Starter
 *     can't connect a CRM. Plan helper returns
 *     `crmIntegration: false`. The UI shows a prompt.
 *   - Pro+:    full customer list.
 */

import { v } from "convex/values";
import { query } from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";
import { getCurrentBusinessSession, getSessionForBusiness } from "./_session";

const REVIEW_STATUS = v.union(
  v.literal("not-yet"),
  v.literal("asked"),
  v.literal("left"),
  v.literal("declined")
);

/**
 * List customers with optional filters. Returns most-recently-active first
 * (by `lastJobAt` desc, then by createdAt).
 */
export const listCustomers = query({
  args: {
    reviewStatus: v.optional(REVIEW_STATUS),
    /** Substring match on customer name (case-insensitive). */
    nameContains: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Doc<"serviceCustomers">[]> => {
    const session = await getCurrentBusinessSession(ctx);
    if (!session) return [];

    const limit = clampLimit(args.limit);

    const all = await ctx.db
      .query("serviceCustomers")
      .withIndex("by_business", (q) =>
        q.eq("businessId", session.business._id)
      )
      .collect();

    const filtered = all.filter((c) => {
      if (args.reviewStatus && c.reviewStatus !== args.reviewStatus)
        return false;
      if (args.nameContains) {
        const needle = args.nameContains.toLowerCase().trim();
        if (needle.length > 0 && !c.name.toLowerCase().includes(needle))
          return false;
      }
      return true;
    });

    filtered.sort((a, b) => {
      const aLast = a.lastJobAt ?? 0;
      const bLast = b.lastJobAt ?? 0;
      if (aLast !== bLast) return bLast - aLast;
      return b._creationTime - a._creationTime;
    });

    return filtered.slice(0, limit);
  },
});

/**
 * Customer detail bundle: customer + their jobs + their reviews +
 * outstanding review-requests. Cross-tenant guarded.
 */
export const getCustomer = query({
  args: {
    businessId: v.id("businesses"),
    customerId: v.id("serviceCustomers"),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    customer: Doc<"serviceCustomers">;
    jobs: Doc<"serviceJobs">[];
    reviews: Doc<"reviews">[];
    reviewRequests: Doc<"reviewRequests">[];
  } | null> => {
    const session = await getSessionForBusiness(ctx, args.businessId);
    if (!session) return null;

    const customer = await ctx.db.get(args.customerId);
    if (!customer) return null;
    if (customer.businessId !== session.business._id) return null;

    const jobs = await ctx.db
      .query("serviceJobs")
      .withIndex("by_business", (q) =>
        q.eq("businessId", session.business._id)
      )
      .filter((q) => q.eq(q.field("customerId"), customer._id))
      .order("desc")
      .take(50);

    // Match reviews by `customerMatchedJobId` belonging to one of the jobs.
    const jobIdSet = new Set(jobs.map((j) => j._id));
    const allReviews = await ctx.db
      .query("reviews")
      .withIndex("by_business", (q) =>
        q.eq("businessId", session.business._id)
      )
      .collect();
    const reviews = allReviews.filter(
      (r) =>
        r.customerMatchedJobId !== undefined &&
        jobIdSet.has(r.customerMatchedJobId)
    );

    const allReqs = await ctx.db
      .query("reviewRequests")
      .withIndex("by_business", (q) =>
        q.eq("businessId", session.business._id)
      )
      .collect();
    const reviewRequests = allReqs.filter(
      (r) => r.customerId === customer._id
    );

    return { customer, jobs, reviews, reviewRequests };
  },
});

/**
 * Counts by `reviewStatus` for the filter strip header. Starter callers see
 * all zeros (no customers at all).
 */
export const getReviewStatusCounts = query({
  args: {},
  handler: async (
    ctx
  ): Promise<{
    notYet: number;
    asked: number;
    left: number;
    declined: number;
    total: number;
  }> => {
    const session = await getCurrentBusinessSession(ctx);
    const empty = { notYet: 0, asked: 0, left: 0, declined: 0, total: 0 };
    if (!session) return empty;

    const all = await ctx.db
      .query("serviceCustomers")
      .withIndex("by_business", (q) =>
        q.eq("businessId", session.business._id)
      )
      .collect();

    const counts = { ...empty };
    for (const c of all) {
      counts.total++;
      if (c.reviewStatus === "not-yet") counts.notYet++;
      else if (c.reviewStatus === "asked") counts.asked++;
      else if (c.reviewStatus === "left") counts.left++;
      else if (c.reviewStatus === "declined") counts.declined++;
    }
    return counts;
  },
});

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return 100;
  if (limit < 1) return 1;
  if (limit > 500) return 500;
  return Math.floor(limit);
}
