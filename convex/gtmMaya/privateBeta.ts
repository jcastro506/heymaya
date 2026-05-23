import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

const RETENTION_INTENT = v.union(
  v.literal("high"),
  v.literal("medium"),
  v.literal("low"),
  v.literal("unknown")
);

const SIGNAL_KIND = v.union(
  v.literal("reply"),
  v.literal("signup"),
  v.literal("demo"),
  v.literal("feedback"),
  v.literal("retention")
);

export interface PrivateBetaMetrics {
  timeToFirstPlanMs: number | null;
  approvalRate: number | null;
  postsShipped: number;
  userReportedSignals: number;
  costUsd: number;
  retentionIntent: "high" | "medium" | "low" | "unknown" | null;
  humanReviewAverage: number | null;
  executedWeekOneActions: number;
  noUnauthorizedPublishing: boolean;
}

export const adminEnrollBetaUser = mutation({
  args: {
    token: v.string(),
    accountId: v.id("creators"),
    cohortName: v.string(),
    requiredAppUrlLive: v.boolean(),
    startedAt: v.optional(v.number()),
    days: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Id<"gtmBetaCohort">> => {
    assertAdminToken(args.token);
    const creator = await ctx.db.get(args.accountId);
    if (!creator || creator.accountType !== "gtm-agent") {
      throw new Error("GTM account not found");
    }
    const now = Date.now();
    const startedAt = args.startedAt ?? now;
    const endsAt = startedAt + (args.days ?? 14) * 24 * 60 * 60 * 1000;
    const existing = await ctx.db
      .query("gtmBetaCohort")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .first();
    const row = {
      accountId: args.accountId,
      cohortName: args.cohortName,
      status: "active" as const,
      requiredAppUrlLive: args.requiredAppUrlLive,
      startedAt,
      endsAt,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, row);
      return existing._id;
    }
    return await ctx.db.insert("gtmBetaCohort", row);
  },
});

export const recordHumanPlanReview = mutation({
  args: {
    token: v.string(),
    accountId: v.id("creators"),
    researchJobId: v.optional(v.id("gtmResearchJobs")),
    reviewer: v.string(),
    specificityScore: v.number(),
    usefulnessScore: v.number(),
    notes: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"gtmHumanPlanReviews">> => {
    assertAdminToken(args.token);
    assertScore(args.specificityScore, "specificityScore");
    assertScore(args.usefulnessScore, "usefulnessScore");
    if (args.researchJobId) {
      const job = await ctx.db.get(args.researchJobId);
      if (!job || job.accountId !== args.accountId) {
        throw new Error("review research job does not belong to account");
      }
    }
    return await ctx.db.insert("gtmHumanPlanReviews", {
      accountId: args.accountId,
      researchJobId: args.researchJobId,
      reviewer: args.reviewer,
      specificityScore: args.specificityScore,
      usefulnessScore: args.usefulnessScore,
      notes: args.notes,
      reviewedAt: Date.now(),
    });
  },
});

export const recordUserReportedSignal = mutation({
  args: {
    kind: SIGNAL_KIND,
    message: v.string(),
    retentionIntent: v.optional(RETENTION_INTENT),
  },
  handler: async (ctx, args): Promise<Id<"gtmUserReportedSignals">> => {
    const creator = await requireMyGtmCreator(ctx);
    const id = await ctx.db.insert("gtmUserReportedSignals", {
      accountId: creator._id,
      kind: args.kind,
      message: args.message,
      retentionIntent: args.retentionIntent,
      createdAt: Date.now(),
    });
    if (args.retentionIntent) {
      const cohort = await ctx.db
        .query("gtmBetaCohort")
        .withIndex("by_account", (q) => q.eq("accountId", creator._id))
        .first();
      if (cohort) {
        await ctx.db.patch(cohort._id, {
          retentionIntent: args.retentionIntent,
          updatedAt: Date.now(),
        });
      }
    }
    return id;
  },
});

export const getMyPrivateBetaStatus = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const creator = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first();
    if (!creator || creator.accountType !== "gtm-agent") return null;
    return await buildPrivateBetaStatus(ctx, creator);
  },
});

export const adminGetCohortSummary = query({
  args: { token: v.string(), cohortName: v.string() },
  handler: async (ctx, args) => {
    assertAdminToken(args.token);
    const cohort = await ctx.db
      .query("gtmBetaCohort")
      .withIndex("by_cohort", (q) => q.eq("cohortName", args.cohortName))
      .collect();
    const rows = await Promise.all(
      cohort.map(async (row) => {
        const creator = await ctx.db.get(row.accountId);
        return {
          accountId: row.accountId,
          email: creator?.email ?? "unknown",
          cohort: row,
          status: creator ? await buildPrivateBetaStatus(ctx, creator) : null,
        };
      })
    );
    return {
      cohortName: args.cohortName,
      users: rows,
      success: summarizeCohort(rows.map((row) => row.status?.metrics ?? null)),
    };
  },
});

async function buildPrivateBetaStatus(
  ctx: QueryCtx,
  creator: Doc<"creators">
) {
  const [cohort, jobs, drafts, costs, reviews, signals] = await Promise.all([
    ctx.db
      .query("gtmBetaCohort")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .first(),
    ctx.db
      .query("gtmResearchJobs")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .collect(),
    ctx.db
      .query("gtmContentDrafts")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .collect(),
    ctx.db
      .query("gtmCostLedger")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .collect(),
    ctx.db
      .query("gtmHumanPlanReviews")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .collect(),
    ctx.db
      .query("gtmUserReportedSignals")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .collect(),
  ]);
  const firstReadyPlan = jobs
    .filter((job) => job.status === "ready_for_review")
    .sort((a, b) => a.updatedAt - b.updatedAt)[0];
  const approvalEligible = drafts.filter((draft) =>
    ["approved", "published", "rejected"].includes(draft.status)
  );
  const approved = drafts.filter(
    (draft) => draft.status === "approved" || draft.status === "published"
  );
  const unauthorizedPublished = drafts.some(
    (draft) => draft.status === "published" && !draft.approvedAt
  );
  const humanReviewAverage =
    reviews.length === 0
      ? null
      : round2(
          reviews.reduce(
            (sum, row) => sum + (row.specificityScore + row.usefulnessScore) / 2,
            0
          ) / reviews.length
        );
  const latestRetention = [...signals]
    .reverse()
    .find((signal) => signal.retentionIntent)?.retentionIntent;
  const weekOneEnd =
    (cohort?.startedAt ?? creator.createdAt) + 7 * 24 * 60 * 60 * 1000;

  const metrics: PrivateBetaMetrics = {
    timeToFirstPlanMs: firstReadyPlan
      ? firstReadyPlan.updatedAt - creator.createdAt
      : null,
    approvalRate:
      approvalEligible.length === 0
        ? null
        : round2(approved.length / approvalEligible.length),
    postsShipped: drafts.filter((draft) => draft.status === "published").length,
    userReportedSignals: signals.length,
    costUsd: round2(costs.reduce((sum, row) => sum + row.costUsd, 0)),
    retentionIntent: latestRetention ?? cohort?.retentionIntent ?? null,
    humanReviewAverage,
    executedWeekOneActions: drafts.filter(
      (draft) =>
        (draft.status === "approved" || draft.status === "published") &&
        draft.updatedAt <= weekOneEnd
    ).length,
    noUnauthorizedPublishing: !unauthorizedPublished,
  };

  return {
    cohort,
    metrics,
    successCriteria: {
      approvedFirstStrategy:
        metrics.approvalRate === null ? false : metrics.approvalRate >= 0.8,
      executedThreeWeekOneActions: metrics.executedWeekOneActions >= 3,
      humanReviewGood:
        metrics.humanReviewAverage === null
          ? false
          : metrics.humanReviewAverage >= 4,
      noUnauthorizedPublishing: metrics.noUnauthorizedPublishing,
    },
  };
}

function summarizeCohort(rows: Array<PrivateBetaMetrics | null>) {
  const metrics = rows.filter((row): row is PrivateBetaMetrics => Boolean(row));
  if (metrics.length === 0) {
    return {
      users: 0,
      approvalRatePass: 0,
      weekOneExecutionPass: 0,
      humanReviewPass: 0,
      noUnauthorizedPublishing: true,
      averageCostUsd: 0,
    };
  }
  return {
    users: metrics.length,
    approvalRatePass: fraction(
      metrics,
      (row) => row.approvalRate !== null && row.approvalRate >= 0.8
    ),
    weekOneExecutionPass: fraction(
      metrics,
      (row) => row.executedWeekOneActions >= 3
    ),
    humanReviewPass: fraction(
      metrics,
      (row) => row.humanReviewAverage !== null && row.humanReviewAverage >= 4
    ),
    noUnauthorizedPublishing: metrics.every((row) => row.noUnauthorizedPublishing),
    averageCostUsd: round2(
      metrics.reduce((sum, row) => sum + row.costUsd, 0) / metrics.length
    ),
  };
}

async function requireMyGtmCreator(
  ctx: MutationCtx
): Promise<Doc<"creators">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("signed-in user required");
  const creator = await ctx.db
    .query("creators")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
    .first();
  if (!creator || creator.accountType !== "gtm-agent") {
    throw new Error("GTM account not found");
  }
  return creator;
}

function fraction<T>(rows: T[], predicate: (row: T) => boolean): number {
  return round2(rows.filter(predicate).length / rows.length);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function assertScore(value: number, name: string): void {
  if (value < 1 || value > 5) {
    throw new Error(`${name} must be between 1 and 5`);
  }
}

function assertAdminToken(provided: string): void {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected || !constantTimeEqual(expected, provided)) {
    throw new Error("admin: unauthorized");
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
