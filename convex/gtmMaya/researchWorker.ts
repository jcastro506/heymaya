import { v } from "convex/values";
import { mutation } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
  evaluateChannelSet,
  type GtmAppContext,
  type GtmEvidenceCard,
} from "./channelScoring";

export interface ResearchSkeletonEvidence {
  source: Doc<"gtmEvidenceCards">["source"];
  url: string;
  title?: string;
  snippet: string;
  recency: Doc<"gtmEvidenceCards">["recency"];
  painMatch: number;
  buyerMatch: number;
  channelFit: number;
  promotionRisk: Doc<"gtmEvidenceCards">["promotionRisk"];
  recommendedUse: Doc<"gtmEvidenceCards">["recommendedUse"];
  extractedClaims: string[];
}

export const runBudgetedResearchSkeleton = mutation({
  args: { researchJobId: v.id("gtmResearchJobs") },
  handler: async (
    ctx,
    args
  ): Promise<{
    evidenceCount: number;
    primaryChannel: string | null;
    secondaryChannel: string | null;
    spentUsd: number;
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("research worker requires signed-in user.");

    const creator = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first();
    if (!creator || creator.accountType !== "gtm-agent") {
      throw new Error("GTM account not found.");
    }

    const job = await ctx.db.get(args.researchJobId);
    if (!job || job.accountId !== creator._id) {
      throw new Error("research job does not belong to this account.");
    }
    const app = await ctx.db.get(job.appId);
    if (!app || app.accountId !== creator._id) {
      throw new Error("research job app does not belong to this account.");
    }
    if (job.budgetUsd < 0.05) {
      throw new Error("research budget is too low to start.");
    }

    const now = Date.now();
    await ctx.db.patch(job._id, {
      status: "running",
      phase: "app_inspection",
      startedAt: job.startedAt ?? now,
      updatedAt: now,
    });

    const evidenceInputs = buildResearchSkeletonEvidence(app);
    const evidenceCards: Array<GtmEvidenceCard & { id: string }> = [];
    for (const evidence of evidenceInputs) {
      const id = await ctx.db.insert("gtmEvidenceCards", {
        accountId: creator._id,
        researchJobId: job._id,
        authorOrCommunity: evidence.source === "reddit" ? "r/sideproject" : undefined,
        observedAt: now,
        engagement: { likes: 20, comments: 12, shares: 3, views: 1_000 },
        rawRef: "research_skeleton",
        createdAt: now,
        ...evidence,
      });
      evidenceCards.push({
        id: String(id),
        source: evidence.source,
        url: evidence.url,
        title: evidence.title,
        snippet: evidence.snippet,
        observedAt: now,
        recency: evidence.recency,
        engagement: { likes: 20, comments: 12, shares: 3, views: 1_000 },
        painMatch: evidence.painMatch,
        buyerMatch: evidence.buyerMatch,
        channelFit: evidence.channelFit,
        promotionRisk: evidence.promotionRisk,
        recommendedUse: evidence.recommendedUse,
        extractedClaims: evidence.extractedClaims,
      });
    }

    await ctx.db.insert("gtmCostLedger", {
      accountId: creator._id,
      researchJobId: job._id,
      provider: "scrapecreators",
      operation: "research.skeleton.external_calls",
      reason: "Sprint 4 skeleton proves no external spend from orchestration.",
      costUsd: 0,
      units: 0,
      cacheStatus: "skipped",
      metadata: { mode: "skeleton" },
      createdAt: now,
    });
    await ctx.db.insert("gtmCostLedger", {
      accountId: creator._id,
      researchJobId: job._id,
      provider: "gemini",
      operation: "research.skeleton.strategy_judge",
      reason: "Deterministic skeleton uses local scoring before model routing is enabled.",
      costUsd: 0,
      units: 0,
      cacheStatus: "skipped",
      metadata: { mode: "skeleton" },
      createdAt: now,
    });

    const scores = evaluateChannelSet(evidenceCards, appContext(app));
    for (const score of scores) {
      await ctx.db.insert("gtmChannelScores", {
        accountId: creator._id,
        researchJobId: job._id,
        channel: score.channel,
        score: score.score,
        decision: score.decision,
        confidence: score.confidence,
        reasons: score.reasons,
        risks: score.risks,
        evidenceCardIds: score.evidenceCardIds.map(
          (id) => id as Id<"gtmEvidenceCards">
        ),
        firstWeekTest: score.firstWeekTest,
        qualityGate: score.qualityGate,
        createdAt: now,
      });
    }

    await ctx.db.patch(job._id, {
      status: "ready_for_review",
      phase: "complete",
      completedAt: now,
      updatedAt: now,
    });

    return {
      evidenceCount: evidenceInputs.length,
      primaryChannel: scores.find((score) => score.decision === "primary")
        ?.channel ?? null,
      secondaryChannel: scores.find((score) => score.decision === "secondary")
        ?.channel ?? null,
      spentUsd: 0,
    };
  },
});

export function buildResearchSkeletonEvidence(
  app: Pick<
    Doc<"gtmApps">,
    | "name"
    | "url"
    | "weekGoal"
    | "stage"
    | "canRecordScreen"
    | "canShowFace"
    | "canProvideScreenshots"
    | "canPostTikTokManually"
    | "tiktokWarmupState"
    | "tiktokAccountAgeDays"
    | "tiktokAccountStatusChecked"
  >
): ResearchSkeletonEvidence[] {
  const name = app.name ?? "the product";
  const visualFit = Boolean(
    app.canPostTikTokManually &&
      (app.canRecordScreen || app.canShowFace || app.canProvideScreenshots)
  );
  return [
    {
      source: "app",
      url: app.url,
      title: `${name} app inspection`,
      snippet: `${name} is at ${app.stage} stage and needs ${app.weekGoal}. The first plan must convert product reality into a narrow channel test.`,
      recency: "fresh",
      painMatch: 0.72,
      buyerMatch: 0.72,
      channelFit: 0.7,
      promotionRisk: "low",
      recommendedUse: "strategy",
      extractedClaims: ["app is inspectable", `weekly goal is ${app.weekGoal}`],
    },
    {
      source: "reddit",
      url: "https://reddit.com/r/sideproject/search?q=first%20users",
      title: "Founders asking where first users come from",
      snippet: "Indie builders repeatedly ask for practical ways to get their first users without hiring a marketer.",
      recency: "fresh",
      painMatch: 0.9,
      buyerMatch: 0.82,
      channelFit: 0.84,
      promotionRisk: "medium",
      recommendedUse: "reply",
      extractedClaims: ["first-user pain is explicit", "reply-first motion fits Reddit"],
    },
    {
      source: "reddit",
      url: "https://reddit.com/r/SaaS/search?q=marketing",
      title: "SaaS builders struggling with marketing",
      snippet: "SaaS builders describe marketing as the blocker after they finish building the first version.",
      recency: "recent",
      painMatch: 0.86,
      buyerMatch: 0.8,
      channelFit: 0.8,
      promotionRisk: "medium",
      recommendedUse: "strategy",
      extractedClaims: ["marketing is a blocker", "SaaS builders ask publicly"],
    },
    {
      source: "x",
      url: "https://x.com/search?q=building%20in%20public%20first%20users",
      title: "Founder-led first-user conversation",
      snippet: "Founders on X respond to specific build-in-public posts that show what shipped and ask for direct feedback.",
      recency: "fresh",
      painMatch: 0.76,
      buyerMatch: 0.7,
      channelFit: 0.74,
      promotionRisk: "low",
      recommendedUse: "content_format",
      extractedClaims: ["specific build updates get replies", "founder-led posts fit X"],
    },
    {
      source: "tiktok",
      url: "https://www.tiktok.com/search?q=indie%20app%20demo",
      title: "Short product demo format",
      snippet: visualFit
        ? "Short screen-recorded demos can explain the product without needing a polished creator persona."
        : "TikTok needs visual assets, but this user cannot currently provide a screen recording or face-camera explanation.",
      recency: "recent",
      painMatch: visualFit ? 0.72 : 0.45,
      buyerMatch: visualFit ? 0.62 : 0.4,
      channelFit: visualFit ? 0.7 : 0.25,
      promotionRisk: "low",
      recommendedUse: visualFit ? "content_format" : "avoid",
      extractedClaims: visualFit
        ? ["screen recording can carry TikTok", "demo format is possible"]
        : ["TikTok needs assets", "park until recording is possible"],
    },
  ];
}

function appContext(app: Doc<"gtmApps">): GtmAppContext {
  return {
    stage: app.stage,
    weekGoal: app.weekGoal,
    canRecordScreen: app.canRecordScreen,
    canShowFace: app.canShowFace,
    canRecordVoice: app.canRecordVoice,
    canProvideScreenshots: app.canProvideScreenshots,
    canPostTikTokManually: app.canPostTikTokManually,
    tiktokWarmupState: app.tiktokWarmupState,
    tiktokAccountAgeDays: app.tiktokAccountAgeDays,
    tiktokAccountStatusChecked: app.tiktokAccountStatusChecked,
    canPostInstagramManually: app.canPostInstagramManually,
    openToUgcCreators: app.openToUgcCreators,
    creatorBudgetMonthlyUsd: app.creatorBudgetMonthlyUsd,
    excludedAudiences: app.excludedAudiences,
  };
}
