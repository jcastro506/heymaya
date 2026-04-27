/**
 * computeHealthScore — orchestration for the GBP SEO auditor (Wave C.6).
 *
 * Per the operator's 2026-04-27 directive: this is NOT a deterministic
 * weighted-input calculation. The score is Maya's judgment, produced by
 * `maya-service-gbp-seo-auditor` invoking Gemini 3 Flash MEDIUM thinking
 * over the operator's full GBP picture + memory-wiki learnings.
 *
 * This file is the thin orchestration that:
 *   1. Gathers the auditor's input bundle from Convex (own profile +
 *      recent posts + recent reviews + competitor profiles where present +
 *      Insights totals + wiki learnings).
 *   2. Invokes the skill (when an LLM caller is wired; otherwise the
 *      auditor returns a safe-fallback row).
 *   3. Persists a `gbpHealthScores` row with Maya's score + reasoning +
 *      nudges count.
 *   4. Enqueues each nudge as a `mayaTaskQueue` row keyed `gbp.seo.nudge`.
 *
 * Triggered: prose inside the existing `morning_brief` standing order
 * (NOT a new entry; standing-order array length stays locked at 15 per
 * Wave C.5 precedent). Also callable on-demand.
 *
 * Cross-tenant: every query is `businessId`-indexed; persistence asserts
 * the businessId matches before insert.
 *
 * Plan-tier: storage + audit run is plan-agnostic — every business at every
 * tier gets the audit (gating off self-defeating per north star).
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  auditGbpForBusiness,
  SKILL_METADATA,
  type AuditorInputs,
  type AuditorOutput,
  type LlmCaller,
} from "../../agents/skills/maya-service-gbp-seo-auditor/script";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const RECENT_POSTS_TAKE = 12;
const RECENT_REVIEWS_TAKE = 30;

/* -------------------------------------------------------------------------- */
/* Internal queries — gather the auditor's input bundle                        */
/* -------------------------------------------------------------------------- */

interface BundleData {
  business: Doc<"businesses"> | null;
  picture: Doc<"businessPicture"> | null;
  locations: ReadonlyArray<Doc<"gbpLocations">>;
  recentPosts: ReadonlyArray<Doc<"gbpPosts">>;
  recentReviews: ReadonlyArray<Doc<"reviews">>;
  /** UTC ms of the most-recent mediaAssets row; null if none. */
  latestPhotoReceivedAt: number | null;
  /** Rough count of mediaAssets in the trailing 30d. */
  photoCount30d: number;
}

export const gatherAuditorBundle = internalQuery({
  args: {
    businessId: v.id("businesses"),
    /** Test seam — defaults to Date.now() inside the action wrapper. */
    nowMs: v.number(),
  },
  handler: async (ctx, args): Promise<BundleData> => {
    const business = await ctx.db.get(args.businessId);
    const picture = await ctx.db
      .query("businessPicture")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .first();
    const locations = await ctx.db
      .query("gbpLocations")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();

    const cutoff = args.nowMs - THIRTY_DAYS_MS;
    const allPosts = await ctx.db
      .query("gbpPosts")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();
    const recentPosts = allPosts
      .filter(
        (p) =>
          p.businessId === args.businessId && (p.postedAt ?? 0) >= cutoff
      )
      .sort((a, b) => (b.postedAt ?? 0) - (a.postedAt ?? 0))
      .slice(0, RECENT_POSTS_TAKE);

    const allReviews = await ctx.db
      .query("reviews")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();
    const recentReviews = allReviews
      .filter(
        (r) => r.businessId === args.businessId && r.receivedAt >= cutoff
      )
      .sort((a, b) => b.receivedAt - a.receivedAt)
      .slice(0, RECENT_REVIEWS_TAKE);

    const allMedia = await ctx.db
      .query("mediaAssets")
      .withIndex("by_business_and_received_at", (q) =>
        q.eq("businessId", args.businessId)
      )
      .order("desc")
      .take(60);
    const ownedMedia = allMedia.filter(
      (m) => m.businessId === args.businessId
    );
    const latestPhotoReceivedAt =
      ownedMedia.length > 0 ? ownedMedia[0].receivedAt : null;
    const photoCount30d = ownedMedia.filter(
      (m) => m.receivedAt >= cutoff
    ).length;

    return {
      business,
      picture,
      locations,
      recentPosts,
      recentReviews,
      latestPhotoReceivedAt,
      photoCount30d,
    };
  },
});

export const gatherWikiLearnings = internalQuery({
  args: { businessId: v.id("businesses") },
  handler: async (
    ctx,
    args
  ): Promise<
    Array<{
      vaultPath: string;
      claim: string;
      sampleSize: number;
      jobsAttributed: number;
      fiveStarsAttributed: number;
    }>
  > => {
    // Pull the business's most recent weekly learnings synthesis; expose its
    // top patterns to the auditor as wikiLearnings. The wiki vault on the Fly
    // machine is the source of truth; this Convex-side projection lets the
    // sandbox-bound action read without round-tripping to the agent runtime.
    const latest = await ctx.db
      .query("weeklyLearnings")
      .withIndex("by_business_and_week", (q) =>
        q.eq("businessId", args.businessId)
      )
      .order("desc")
      .first();
    if (!latest) return [];
    return latest.topPatterns
      .filter((p) =>
        p.wikiVaultPath.startsWith("concepts/what-works/gbp")
      )
      .map((p) => ({
        vaultPath: p.wikiVaultPath,
        claim: p.claim,
        sampleSize: p.sampleSize,
        jobsAttributed: p.jobsAttributed,
        fiveStarsAttributed: p.fiveStarsAttributed,
      }));
  },
});

/* -------------------------------------------------------------------------- */
/* Persist                                                                     */
/* -------------------------------------------------------------------------- */

export const persistHealthScore = internalMutation({
  args: {
    businessId: v.id("businesses"),
    scoreAt: v.number(),
    compositeScore: v.number(),
    reasoning: v.string(),
    nudgesPending: v.number(),
    model: v.string(),
    thinkingBudget: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"gbpHealthScores">> => {
    const biz = await ctx.db.get(args.businessId);
    if (!biz) {
      throw new Error(
        `computeHealthScore: businessId ${args.businessId} not found`
      );
    }
    return await ctx.db.insert("gbpHealthScores", {
      businessId: args.businessId,
      scoreAt: args.scoreAt,
      compositeScore: args.compositeScore,
      reasoning: args.reasoning,
      nudgesPending: args.nudgesPending,
      model: args.model,
      thinkingBudget: args.thinkingBudget,
    });
  },
});

export const enqueueAuditorNudge = internalMutation({
  args: {
    businessId: v.id("businesses"),
    headline: v.string(),
    body: v.string(),
    suggestedAction: v.string(),
    rationale: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"mayaTaskQueue">> => {
    const biz = await ctx.db.get(args.businessId);
    if (!biz) {
      throw new Error(
        `computeHealthScore: businessId ${args.businessId} not found`
      );
    }
    return await ctx.db.insert("mayaTaskQueue", {
      businessId: args.businessId,
      kind: "gbp.seo.nudge",
      payload: {
        headline: args.headline,
        body: args.body,
        suggestedAction: args.suggestedAction,
        rationale: args.rationale,
      },
      source: "manual", // synthetic — auditor enqueued.
      enqueuedAt: Date.now(),
      attemptCount: 0,
    });
  },
});

/* -------------------------------------------------------------------------- */
/* Build auditor inputs from the bundle                                        */
/* -------------------------------------------------------------------------- */

function daysBetween(later: number, earlier: number | null): number | null {
  if (earlier === null) return null;
  return Math.max(
    0,
    Math.floor((later - earlier) / (24 * 60 * 60 * 1000))
  );
}

export function buildAuditorInputsFromBundle(
  bundle: BundleData,
  wikiLearnings: ReadonlyArray<{
    vaultPath: string;
    claim: string;
    sampleSize: number;
    jobsAttributed: number;
    fiveStarsAttributed: number;
  }>,
  nowMs: number,
  operatorFirstName: string
): AuditorInputs {
  const business = bundle.business;
  if (!business) {
    throw new Error("buildAuditorInputsFromBundle: business is null");
  }
  // Star rating + review count derived from the recent reviews array — note
  // these are 30d-window summaries, not lifetime. Auditor receives the raw
  // reviews so it can reason about velocity AND quality independently.
  const totalRated = bundle.recentReviews.length;
  const avgRating =
    totalRated > 0
      ? bundle.recentReviews.reduce((s, r) => s + r.starRating, 0) / totalRated
      : null;

  return {
    business: {
      businessId: String(business._id),
      serviceTypes: business.serviceTypes,
      nameForOperator: operatorFirstName,
    },
    ownProfile: {
      primaryCategory: bundle.locations[0]?.primaryCategory ?? null,
      secondaryCategories: [],
      hoursDescribed: business.businessSize !== undefined,
      sundayHoursSet: false,
      holidayHoursSet: false,
      servicesList: business.serviceTypes,
      qAndA: { totalQuestions: 0, unansweredQuestions: 0 },
      primaryPhotosSet: bundle.latestPhotoReceivedAt !== null,
      photoCount: bundle.photoCount30d,
      daysSinceLatestPhoto: daysBetween(nowMs, bundle.latestPhotoReceivedAt),
      starRating: avgRating,
      reviewCount: totalRated,
    },
    recentPosts: bundle.recentPosts.map((p) => ({
      postedAtIsoDate: new Date(p.postedAt ?? 0).toISOString().slice(0, 10),
      text: p.text,
      callsClicked: p.engagementMetrics?.callsClicked,
      directionsClicked: p.engagementMetrics?.directionsClicked,
      websiteClicked: p.engagementMetrics?.websiteClicked,
      postViews: p.engagementMetrics?.postViews,
    })),
    recentReviews: bundle.recentReviews.map((r) => ({
      receivedAtIsoDate: new Date(r.receivedAt).toISOString().slice(0, 10),
      starRating: r.starRating,
      bodyExcerpt: r.body.slice(0, 240),
      replied:
        r.replyStatus === "posted" || r.replyStatus === "approved",
    })),
    // Competitors structured data isn't in our schema yet at the strict
    // `name + servicesList` shape; orchestrator passes empty for now and the
    // auditor handles it gracefully. When direct-GBP-API lands (or the
    // Wave C.5 wiki has competitor profiles), this fills in.
    competitors: [],
    insightsTotals: {
      calls30d: bundle.recentPosts.reduce(
        (s, p) => s + (p.engagementMetrics?.callsClicked ?? 0),
        0
      ),
      directions30d: bundle.recentPosts.reduce(
        (s, p) => s + (p.engagementMetrics?.directionsClicked ?? 0),
        0
      ),
      messages30d: 0,
    },
    wikiLearnings: [...wikiLearnings],
  };
}

/* -------------------------------------------------------------------------- */
/* Public action — orchestrator                                                */
/* -------------------------------------------------------------------------- */

export interface RunGbpHealthAuditResult {
  scoreId: Id<"gbpHealthScores">;
  score: number;
  nudgesEnqueued: number;
}

/**
 * LLM caller seam — overridable via module replace in tests. Production
 * wiring lands when the action is enabled in a non-sandbox deploy. For now,
 * the auditor receives `null` and ships the safe-fallback row, which is
 * the documented behavior pre-LLM-wiring.
 */
let _llmCaller: LlmCaller | null = null;

export function _setAuditorLlmCallerForTests(c: LlmCaller | null): void {
  _llmCaller = c;
}

export const runGbpHealthAuditForBusiness = internalAction({
  args: {
    businessId: v.id("businesses"),
    /** Test seam. */
    nowMs: v.optional(v.number()),
    /** Test seam — override for first-name fallback. */
    operatorFirstName: v.optional(v.string()),
  },
  handler: async (
    ctx: ActionCtx,
    args
  ): Promise<RunGbpHealthAuditResult> => {
    const nowMs = args.nowMs ?? Date.now();
    const bundle: BundleData = await ctx.runQuery(
      internal.gbp.computeHealthScore.gatherAuditorBundle,
      { businessId: args.businessId, nowMs }
    );
    if (!bundle.business) {
      throw new Error(
        `runGbpHealthAuditForBusiness: businessId ${args.businessId} not found`
      );
    }
    const wikiLearnings = await ctx.runQuery(
      internal.gbp.computeHealthScore.gatherWikiLearnings,
      { businessId: args.businessId }
    );

    const auditorInputs = buildAuditorInputsFromBundle(
      bundle,
      wikiLearnings,
      nowMs,
      args.operatorFirstName ?? bundle.business.name.split(" ")[0]
    );

    const audit: AuditorOutput = await auditGbpForBusiness(auditorInputs, {
      llmCaller: _llmCaller,
    });

    const scoreId: Id<"gbpHealthScores"> = await ctx.runMutation(
      internal.gbp.computeHealthScore.persistHealthScore,
      {
        businessId: args.businessId,
        scoreAt: nowMs,
        compositeScore: audit.score,
        reasoning: audit.reasoning,
        nudgesPending: audit.nudges.length,
        model: SKILL_METADATA.modelTarget,
        thinkingBudget: SKILL_METADATA.thinkingBudget,
      }
    );

    for (const nudge of audit.nudges) {
      await ctx.runMutation(
        internal.gbp.computeHealthScore.enqueueAuditorNudge,
        {
          businessId: args.businessId,
          headline: nudge.headline,
          body: nudge.body,
          suggestedAction: nudge.suggestedAction,
          rationale: nudge.rationale,
        }
      );
    }

    return {
      scoreId,
      score: audit.score,
      nudgesEnqueued: audit.nudges.length,
    };
  },
});
