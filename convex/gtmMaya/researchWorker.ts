import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  evaluateChannelSet,
  type GtmAppContext,
  type GtmEvidenceCard,
} from "./channelScoring";
import { buildResearchQueryPlan, type IcpHypothesisInput } from "./researchQueryBuilder";
import type { PlatformResearchResult } from "./platformWorkers";
import { scoreAllCardsForProduct } from "./judgeCardsBatch";
import { judgeAllChannels } from "./judgeChannel";
import { mineTopRedditCards } from "./mineCommentTrees";
import { ScrapeCreatorsClient } from "../integrations/scrapeCreators/client";
import { fireBootPhase2Webhook } from "./phase2Trigger";

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

// ──────────────────────────────────────────────────────────────────────
// Sprint 1 — runBudgetedResearchJob (replaces runBudgetedResearchSkeleton)
//
// The REAL research orchestrator. Calls Sprint 3 (query builder) +
// Sprint 4 (platform workers) instead of writing canned evidence.
// runBudgetedResearchSkeleton above is left in place for backward
// compatibility with existing tests; production onboarding now points at
// runBudgetedResearchJob.
// ──────────────────────────────────────────────────────────────────────

interface OrchestratorInputs {
  job: Doc<"gtmResearchJobs">;
  app: Doc<"gtmApps">;
  creatorId: Id<"creators">;
}

export const getResearchJobForOrchestrator = internalQuery({
  args: { researchJobId: v.id("gtmResearchJobs") },
  handler: async (
    ctx,
    args
  ): Promise<OrchestratorInputs | null> => {
    const job = await ctx.db.get(args.researchJobId);
    if (!job) return null;
    const app = await ctx.db.get(job.appId);
    if (!app || app.accountId !== job.accountId) return null;
    return { job, app, creatorId: job.accountId };
  },
});

export const setJobPhase = internalMutation({
  args: {
    researchJobId: v.id("gtmResearchJobs"),
    phase: v.union(
      v.literal("app_inspection"),
      v.literal("icp_hypotheses"),
      v.literal("channel_research"),
      v.literal("strategy_judge"),
      v.literal("calendar_build"),
      v.literal("complete")
    ),
    status: v.optional(
      v.union(
        v.literal("queued"),
        v.literal("running"),
        v.literal("needs_more_evidence"),
        v.literal("ready_for_review"),
        v.literal("failed"),
        v.literal("cancelled")
      )
    ),
    failureReason: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const job = await ctx.db.get(args.researchJobId);
    if (!job) throw new Error("research job not found");
    const now = Date.now();
    const patch: Partial<Doc<"gtmResearchJobs">> = {
      phase: args.phase,
      updatedAt: now,
    };
    if (args.status) patch.status = args.status;
    if (args.status === "running" && !job.startedAt) patch.startedAt = now;
    if (
      args.status === "ready_for_review" ||
      args.status === "needs_more_evidence" ||
      args.status === "failed" ||
      args.status === "cancelled"
    ) {
      patch.completedAt = now;
    }
    if (args.failureReason) patch.failureReason = args.failureReason;
    await ctx.db.patch(args.researchJobId, patch);
  },
});

export const getEvidenceCardsForScoring = internalQuery({
  args: { researchJobId: v.id("gtmResearchJobs") },
  handler: async (ctx, args): Promise<GtmEvidenceCard[]> => {
    const rows = await ctx.db
      .query("gtmEvidenceCards")
      .withIndex("by_research_job", (q) => q.eq("researchJobId", args.researchJobId))
      .collect();
    return rows.map((r) => ({
      id: String(r._id),
      source: r.source,
      url: r.url,
      title: r.title,
      snippet: r.snippet,
      observedAt: r.observedAt,
      recency: r.recency,
      engagement: r.engagement ?? {},
      painMatch: r.painMatch,
      buyerMatch: r.buyerMatch,
      channelFit: r.channelFit,
      promotionRisk: r.promotionRisk,
      recommendedUse: r.recommendedUse,
      extractedClaims: r.extractedClaims,
      painLanguageReason: r.painLanguageReason,
      commentInsights: r.commentInsights,
    }));
  },
});

/**
 * Sprint 2.13a — patch LLM-scored painMatch / buyerMatch / channelFit
 * + painLanguageReason onto evidence cards after scoreAllCardsForProduct
 * returns. Bounded batch update; silently skips IDs that no longer
 * exist (could happen if a parallel run wiped the job).
 */
/**
 * Sprint 2.15.4 — persist aggregated LLM cost from a research run.
 * spentUsdLlm = total across all stages. spentUsdLlmByStage =
 * per-stage breakdown (keywordExpansion / cardScorer / commentMiner
 * / channelJudge). OpenRouter returns exact USD per call so the
 * sum here matches the operator's OpenRouter dashboard for this run.
 */
export const recordLlmCost = internalMutation({
  args: {
    researchJobId: v.id("gtmResearchJobs"),
    spentUsdLlm: v.number(),
    spentUsdLlmByStage: v.object({
      keywordExpansion: v.number(),
      cardScorer: v.number(),
      commentMiner: v.number(),
      channelJudge: v.number(),
    }),
  },
  handler: async (ctx, args): Promise<void> => {
    const job = await ctx.db.get(args.researchJobId);
    if (!job) return;
    await ctx.db.patch(args.researchJobId, {
      spentUsdLlm: args.spentUsdLlm,
      spentUsdLlmByStage: args.spentUsdLlmByStage,
    });
  },
});

/**
 * Sprint 2.14a.10 — record how many subagents phase 1 spawned.
 * Called via /lc_gtm/phase_1_announce. Idempotent — re-announcing
 * just overwrites (e.g. if phase 1 re-fires after a transient
 * failure, the count is whatever the latest call said).
 */
export const recordSubagentsExpected = internalMutation({
  args: {
    researchJobId: v.id("gtmResearchJobs"),
    count: v.number(),
  },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const job = await ctx.db.get(args.researchJobId);
    if (!job) return { ok: false };
    await ctx.db.patch(args.researchJobId, {
      subagentsExpected: Math.max(0, Math.floor(args.count)),
      // Reset completed count when expected is announced, so
      // re-announce doesn't carry stale completions.
      subagentsCompleted: 0,
    });
    return { ok: true };
  },
});

/**
 * Sprint 2.14a.10 — increment subagentsCompleted. Called via
 * /lc_gtm/subagent_complete. Returns whether all expected
 * subagents are now done (ready to trigger phase 2).
 *
 * Atomically claims the phase2 trigger right when the count
 * transitions from N-1 → N (where N = subagentsExpected). This
 * avoids double-triggering when multiple subagents complete in
 * the same instant.
 */
export const incrementSubagentsCompleted = internalMutation({
  args: {
    researchJobId: v.id("gtmResearchJobs"),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    completed: number;
    expected: number;
    readyToFirePhase2: boolean;
    alreadyTriggered: boolean;
  }> => {
    const job = await ctx.db.get(args.researchJobId);
    if (!job) {
      return {
        completed: 0,
        expected: 0,
        readyToFirePhase2: false,
        alreadyTriggered: false,
      };
    }
    const expected = job.subagentsExpected ?? 0;
    const completed = (job.subagentsCompleted ?? 0) + 1;
    await ctx.db.patch(args.researchJobId, {
      subagentsCompleted: completed,
    });
    const alreadyTriggered = Boolean(job.phase2TriggeredAt);
    // Ready when: expected was announced (>0), we've reached it,
    // and phase 2 hasn't already been triggered.
    const readyToFirePhase2 =
      expected > 0 && completed >= expected && !alreadyTriggered;
    return {
      completed,
      expected,
      readyToFirePhase2,
      alreadyTriggered,
    };
  },
});

/**
 * Sprint 2.14a.10 — load Fly app name + hookToken + telegramChatId
 * for an active research job's agent. Needed by the phase 2 trigger
 * action which can't run a mutation/query directly.
 */
export const getPhase2TriggerContext = internalQuery({
  args: { researchJobId: v.id("gtmResearchJobs") },
  handler: async (
    ctx,
    args
  ): Promise<{
    flyAppName: string | undefined;
    hookToken: string | undefined;
    telegramChatId: string | undefined;
  } | null> => {
    const job = await ctx.db.get(args.researchJobId);
    if (!job) return null;
    const agent = await ctx.db
      .query("gtmAgents")
      .withIndex("by_account", (q) => q.eq("accountId", job.accountId))
      .first();
    if (!agent) return null;
    return {
      flyAppName: agent.openClawFlyAppId,
      hookToken: agent.hookToken,
      telegramChatId: agent.telegramChatId,
    };
  },
});

/**
 * Sprint 2.14a.10 — fire boot phase 2 via OpenClaw runAgentTurn
 * webhook. Called when all subagents have completed OR by the
 * safety-net cron at deploy+2hr. Idempotent: claims the trigger
 * via a transactional mutation first; if already claimed, no-op.
 */
export const triggerPhase2 = internalAction({
  args: {
    researchJobId: v.id("gtmResearchJobs"),
    source: v.union(
      v.literal("subagent_complete"),
      v.literal("safety_net_cron")
    ),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    fired: boolean;
    reason: string;
  }> => {
    const claim = await ctx.runMutation(
      internal.gtmMaya.researchWorker.claimPhase2Trigger,
      { researchJobId: args.researchJobId, source: args.source }
    );
    if (!claim.claimed) {
      return { fired: false, reason: "already_triggered" };
    }
    const context = await ctx.runQuery(
      internal.gtmMaya.researchWorker.getPhase2TriggerContext,
      { researchJobId: args.researchJobId }
    );
    if (!context) {
      return { fired: false, reason: "context_not_found" };
    }
    const result = await fireBootPhase2Webhook({
      flyAppName: context.flyAppName ?? "",
      hookToken: context.hookToken ?? "",
      telegramChatId: context.telegramChatId,
      source: args.source,
    });
    console.log(
      `[gtm/phase2Trigger] source=${args.source} fired=${result.fired} reason=${result.reason} webhookStatus=${result.webhookStatus}`
    );
    return { fired: result.fired, reason: result.reason };
  },
});

/**
 * Sprint 2.14a.10 — atomic claim of the phase 2 trigger right.
 * Returns true only on the first call; subsequent calls return false
 * (someone else already claimed). Caller MUST check the return value
 * before actually firing the webhook.
 */
export const claimPhase2Trigger = internalMutation({
  args: {
    researchJobId: v.id("gtmResearchJobs"),
    source: v.string(),
  },
  handler: async (ctx, args): Promise<{ claimed: boolean }> => {
    const job = await ctx.db.get(args.researchJobId);
    if (!job) return { claimed: false };
    if (job.phase2TriggeredAt) return { claimed: false };
    await ctx.db.patch(args.researchJobId, {
      phase2TriggeredAt: Date.now(),
      phase2TriggerSource: args.source.slice(0, 40),
    });
    return { claimed: true };
  },
});

/**
 * Sprint 2.14a.4 — record pipeline health on the research job row.
 * Surfaces "did the LLM scorer + comment miner actually run, or did
 * we fall back to engagement-only scoring?" so the operator + Maya's
 * boot_kickoff prompt can both see degradation rather than assuming
 * everything worked when the orchestrator returns ok.
 */
export const recordPipelineHealth = internalMutation({
  args: {
    researchJobId: v.id("gtmResearchJobs"),
    cardsScoredCount: v.optional(v.number()),
    cardsExpectedCount: v.optional(v.number()),
    commentsMinedCount: v.optional(v.number()),
    commentsAttemptedCount: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<void> => {
    const job = await ctx.db.get(args.researchJobId);
    if (!job) return;
    const patch: Record<string, number> = {};
    if (args.cardsScoredCount !== undefined)
      patch.cardsScoredCount = args.cardsScoredCount;
    if (args.cardsExpectedCount !== undefined)
      patch.cardsExpectedCount = args.cardsExpectedCount;
    if (args.commentsMinedCount !== undefined)
      patch.commentsMinedCount = args.commentsMinedCount;
    if (args.commentsAttemptedCount !== undefined)
      patch.commentsAttemptedCount = args.commentsAttemptedCount;
    if (Object.keys(patch).length === 0) return;
    await ctx.db.patch(args.researchJobId, patch);
  },
});

export const patchEvidenceCardScores = internalMutation({
  args: {
    scores: v.array(
      v.object({
        cardId: v.id("gtmEvidenceCards"),
        painMatch: v.number(),
        buyerMatch: v.number(),
        channelFit: v.number(),
        reason: v.string(),
      })
    ),
  },
  handler: async (ctx, args): Promise<{ patched: number; missing: number }> => {
    let patched = 0;
    let missing = 0;
    for (const s of args.scores) {
      const row = await ctx.db.get(s.cardId);
      if (!row) {
        missing += 1;
        continue;
      }
      await ctx.db.patch(s.cardId, {
        painMatch: s.painMatch,
        buyerMatch: s.buyerMatch,
        channelFit: s.channelFit,
        painLanguageReason: s.reason,
      });
      patched += 1;
    }
    return { patched, missing };
  },
});

/**
 * Sprint 2.14a — persist comment-tree mining results onto the parent
 * evidence cards. Atomic batch patch.
 */
export const patchEvidenceCardCommentInsights = internalMutation({
  args: {
    insights: v.array(
      v.object({
        cardId: v.id("gtmEvidenceCards"),
        commentInsights: v.object({
          extractedPains: v.array(v.string()),
          topCommenters: v.array(
            v.object({
              author: v.string(),
              stance: v.string(),
              buyerQuality: v.number(),
            })
          ),
          summary: v.string(),
          commentCount: v.number(),
        }),
      })
    ),
  },
  handler: async (ctx, args): Promise<{ patched: number; missing: number }> => {
    let patched = 0;
    let missing = 0;
    for (const i of args.insights) {
      const row = await ctx.db.get(i.cardId);
      if (!row) {
        missing += 1;
        continue;
      }
      await ctx.db.patch(i.cardId, { commentInsights: i.commentInsights });
      patched += 1;
    }
    return { patched, missing };
  },
});

export const insertChannelScores = internalMutation({
  args: {
    researchJobId: v.id("gtmResearchJobs"),
    scores: v.array(
      v.object({
        // Mirrors the gtmChannelScores schema union. The live judge
        // (judgeChannel.ts) emits reddit/x/hn/linkedin/tiktok now, so
        // youtube/product_hunt never actually reach this insert — they
        // stay here only to match the schema union for backward compat.
        channel: v.union(
          v.literal("reddit"),
          v.literal("x"),
          v.literal("hn"),
          v.literal("linkedin"),
          v.literal("tiktok"),
          v.literal("instagram"),
          v.literal("youtube"),
          v.literal("product_hunt")
        ),
        score: v.number(),
        decision: v.union(
          v.literal("primary"),
          v.literal("secondary"),
          v.literal("parked")
        ),
        confidence: v.union(
          v.literal("low"),
          v.literal("medium"),
          v.literal("high")
        ),
        reasons: v.array(v.string()),
        risks: v.array(v.string()),
        evidenceCardIds: v.array(v.id("gtmEvidenceCards")),
        firstWeekTest: v.optional(v.string()),
        qualityGate: v.object({
          passed: v.boolean(),
          failures: v.array(v.string()),
        }),
      })
    ),
  },
  handler: async (ctx, args): Promise<void> => {
    const job = await ctx.db.get(args.researchJobId);
    if (!job) throw new Error("research job not found");
    const now = Date.now();
    for (const score of args.scores) {
      await ctx.db.insert("gtmChannelScores", {
        accountId: job.accountId,
        researchJobId: args.researchJobId,
        ...score,
        createdAt: now,
      });
    }
  },
});

/**
 * Default per-platform call budgets the orchestrator uses when launching
 * Sprint 4 workers. These compound up to ~$0.40 worst-case across all 5
 * platforms; well below the $3 per-research-job cap from PLAYBOOK § Cost.
 */
const ORCHESTRATOR_BUDGETS = {
  reddit: 8,
  twitter: 6,
  tiktok: 8,
  instagram: 4,
  google: 4,
  linkedin: 0, // Sprint 4 has no LinkedIn worker yet; reserve.
};

export const runBudgetedResearchJob = internalAction({
  args: { researchJobId: v.id("gtmResearchJobs") },
  handler: async (
    ctx,
    args
  ): Promise<{
    status: "ready_for_review" | "needs_more_evidence" | "failed";
    summary: string;
    evidenceCount: number;
    spentUsd: number;
    perPlatformResults: PlatformResearchResult[];
  }> => {
    const orch = await ctx.runQuery(
      internal.gtmMaya.researchWorker.getResearchJobForOrchestrator,
      { researchJobId: args.researchJobId }
    );
    if (!orch) {
      return {
        status: "failed",
        summary: "research job not found",
        evidenceCount: 0,
        spentUsd: 0,
        perPlatformResults: [],
      };
    }
    const { job, app, creatorId } = orch;

    // Sprint 2.15.4 — LLM cost tracker. Aggregated across all stages
    // (keyword expansion, card scorer, comment miner, channel judge)
    // and persisted on gtmResearchJobs.spentUsdLlm at the end.
    // OpenRouter returns exact cost per call via usage.cost.
    const llmCost = {
      keywordExpansion: 0,
      cardScorer: 0,
      commentMiner: 0,
      channelJudge: 0,
    };

    // Sprint 2.14a.2 — safety net. Live observed: ModelHub v6/v7
    // intermittently left research jobs stuck at status:"running"
    // phase:"strategy_judge" because an uncaught throw (likely
    // OpenRouter rate-limit under concurrent load) bypassed the
    // final setJobPhase("complete") call. The jobs were never
    // ineligible for retry / monitoring. Trap any uncaught throw
    // here and force-finalize as "failed" so the row never gets
    // stranded.
    let _finalized = false;
    const forceFinalizeOnError = async (err: unknown): Promise<void> => {
      if (_finalized) return;
      _finalized = true;
      try {
        await ctx.runMutation(internal.gtmMaya.researchWorker.setJobPhase, {
          researchJobId: args.researchJobId,
          phase: "complete",
          status: "failed",
          failureReason: `orchestrator exception: ${(err as Error)?.message ?? "unknown"}`.slice(
            0,
            400
          ),
        });
      } catch (mutErr) {
        console.warn(
          `[gtm/orchestrator] force-finalize mutation itself failed: ${(mutErr as Error).message}`
        );
      }
    };

    await ctx.runMutation(internal.gtmMaya.researchWorker.setJobPhase, {
      researchJobId: args.researchJobId,
      phase: "app_inspection",
      status: "running",
    });

    try {

    // ── Sprint 1.1 — LLM-driven keyword expansion. Replaces the prior
    // syntactic seed ([app.name, weekGoal-fallback]) with semantic keywords
    // + verbatim audience pain phrases derived from the product description.
    // Cached on the gtmApps row; one LLM call per product, not per research
    // job. Without this step, Reddit/X searches use the bare product name,
    // which collides with unrelated terms (e.g. "ModelHub" matches
    // modelhub.com, an adult site).
    const expansionResult = await ctx.runAction(
      internal.gtmMaya.queryExpansion.expandProductKeywords,
      { accountId: creatorId, appId: app._id }
    );
    const expansion = expansionResult.expansion;

    // ── ICP hypotheses now thread the LLM-generated pain phrases into the
    // exact-quoted search queries the Sprint 3 builder generates for
    // Reddit/X. Two starter hypotheses survive (one X-locatable, one
    // Reddit-locatable); channel-judge re-weights based on real evidence.
    // Spread every expansion pain phrase across a hypothesis, alternating
    // Reddit/Twitter so both platforms get quoted-phrase queries. Falls back
    // to the original two-hypothesis shape if expansion produced no phrases.
    const phrases =
      expansion.icpPainPhrases.length > 0
        ? expansion.icpPainPhrases
        : [
            app.weekGoal === "feedback"
              ? "shipped but no one's actually using it"
              : "no audience, no idea how to launch",
            `currently working around ${app.weekGoal === "signups" ? "this problem with manual workflows" : "the lack of a real solution"}`,
          ];

    const icpHypotheses: IcpHypothesisInput[] = phrases.map((phrase, i) => ({
      id: `icp_${i % 2 === 0 ? "x" : "reddit"}_${i}`,
      buyer:
        i % 2 === 0
          ? "Indie devs or builders shipping solo products who need first users"
          : "Operators/prosumers in the product's category looking for a tool",
      currentPain: phrase,
      currentWorkaround:
        i % 2 === 0
          ? "post once on Twitter or Reddit, hope for replies"
          : "manual workflow, spreadsheet, or paying freelancers",
      locatableOn: i % 2 === 0 ? "twitter" : "reddit",
    }));

    await ctx.runMutation(internal.gtmMaya.researchWorker.setJobPhase, {
      researchJobId: args.researchJobId,
      phase: "icp_hypotheses",
    });

    // ── Build the query plan (Sprint 3). Use the LLM-expanded semantic
    // keywords instead of [app.name, weekGoal-fallback]. The query builder
    // templates these into per-platform search queries.
    const productCategoryKeywords = expansion.productCategoryKeywords;

    const plan = buildResearchQueryPlan({
      diagnosis: {
        productName: app.name ?? "Untitled",
        productCategoryKeywords,
        oneSentencePromise: `${app.name ?? "this product"} solves a real problem for indie builders.`,
        showability:
          app.canRecordScreen || app.canProvideScreenshots
            ? "screen-recordable"
            : "unshowable",
        competitorMentions: [],
        unverifiable: false,
      },
      icpHypotheses,
      budgetOverrides: ORCHESTRATOR_BUDGETS,
    });

    await ctx.runMutation(internal.gtmMaya.researchWorker.setJobPhase, {
      researchJobId: args.researchJobId,
      phase: "channel_research",
    });

    // ── Run Sprint 4 platform workers in parallel.
    const platformActions: Record<
      string,
      typeof internal.gtmMaya.platformWorkers.runRedditWorker
    > = {
      reddit: internal.gtmMaya.platformWorkers.runRedditWorker,
      twitter: internal.gtmMaya.platformWorkers.runTwitterWorker,
      tiktok: internal.gtmMaya.platformWorkers.runTikTokWorker,
      instagram: internal.gtmMaya.platformWorkers.runInstagramWorker,
      google: internal.gtmMaya.platformWorkers.runGoogleWorker,
    };
    const workerPromises: Promise<PlatformResearchResult>[] = [];
    for (const pack of plan.packs) {
      const action = platformActions[pack.platform];
      if (!action) continue; // linkedin / others not yet supported in S4
      workerPromises.push(
        ctx.runAction(action, {
          researchJobId: args.researchJobId,
          accountId: creatorId,
          pack: {
            painQueries: pack.painQueries,
            solutionQueries: pack.solutionQueries,
            competitorQueries: pack.competitorQueries,
            formatQueries: pack.formatQueries,
            minimumEvidenceCards: pack.minimumEvidenceCards,
            maxCalls: pack.maxCalls,
          },
        })
      );
    }
    const perPlatformResults = await Promise.all(workerPromises);

    await ctx.runMutation(internal.gtmMaya.researchWorker.setJobPhase, {
      researchJobId: args.researchJobId,
      phase: "strategy_judge",
    });

    // ── Sprint 2.13a: LLM per-card scoring (batched).
    // Replaces the engagement-rank heuristic painMatch=totalSignal/100
    // that was promoting popular-but-off-topic posts (live N=3 on
    // 2026-05-24 showed Bezel's #1 Reddit pick was an unrelated
    // MacBook upgrade post at 803↑ — high engagement, zero pain
    // match). Gemini Flash Lite reads each card's text against the
    // product's ICPs + category keywords and scores 0-1 with reason.
    const evidenceCards = await ctx.runQuery(
      internal.gtmMaya.researchWorker.getEvidenceCardsForScoring,
      { researchJobId: args.researchJobId }
    );

    try {
      const product = {
        productName: app.name ?? "Untitled product",
        productUrl: app.url,
        founderWhy: app.founderWhy,
        // Use the FRESH expansion from line 532 — `app.keywordExpansion`
        // is whatever was on the row when we loaded it at line 513,
        // i.e. stale-empty on the first research job for a product.
        // Hit live 2026-05-24 on Bezel v2 — painLanguageReason was
        // empty on every card because scorer skipped on hasContext=false.
        icpPainPhrases: expansion.icpPainPhrases ?? [],
        productCategoryKeywords: expansion.productCategoryKeywords ?? [],
      };
      // Skip LLM scoring if we have no product context — would just
      // score every card 0 against an empty prompt.
      const hasContext =
        product.icpPainPhrases.length > 0 ||
        product.productCategoryKeywords.length > 0;
      if (hasContext && evidenceCards.length > 0) {
        const cardsForScoring = evidenceCards.map((c) => ({
          id: c.id!,
          source: c.source,
          title: c.title,
          snippet: c.snippet,
          author: undefined,
          engagement: c.engagement,
        }));
        const result = await scoreAllCardsForProduct(cardsForScoring, product);
        if (result.scores.length > 0) {
          await ctx.runMutation(
            internal.gtmMaya.researchWorker.patchEvidenceCardScores,
            {
              scores: result.scores.map((s) => ({
                cardId: s.id as Id<"gtmEvidenceCards">,
                painMatch: s.painMatch,
                buyerMatch: s.buyerMatch,
                channelFit: s.channelFit,
                reason: s.reason,
              })),
            }
          );
        }
        // Sprint 2.14a.4 — record degradation signal
        await ctx.runMutation(
          internal.gtmMaya.researchWorker.recordPipelineHealth,
          {
            researchJobId: args.researchJobId,
            cardsScoredCount: result.scores.length,
            cardsExpectedCount: evidenceCards.length,
          }
        );
        llmCost.cardScorer = result.totalUsage.costUsd;
        console.log(
          `[gtm/cardScorer] scored=${result.scores.length}/${evidenceCards.length} missing=${result.missingIds.length} batches=${result.batchCount} usage=${JSON.stringify(result.totalUsage)}`
        );
      } else {
        await ctx.runMutation(
          internal.gtmMaya.researchWorker.recordPipelineHealth,
          {
            researchJobId: args.researchJobId,
            cardsScoredCount: 0,
            cardsExpectedCount: evidenceCards.length,
          }
        );
        console.log(
          `[gtm/cardScorer] skipped — hasContext=${hasContext} cards=${evidenceCards.length}`
        );
      }
    } catch (err) {
      // LLM scoring failure shouldn't abort the whole research job —
      // the downstream channel-judge still has the engagement-derived
      // placeholder scores to work with (worse output, but no crash).
      console.warn(
        `[gtm/cardScorer] LLM scoring failed, falling back to engagement-derived scores: ${(err as Error).message}`
      );
    }

    // Re-read cards to pick up the LLM-patched scores before the
    // channel-judge runs.
    const scoredCards = await ctx.runQuery(
      internal.gtmMaya.researchWorker.getEvidenceCardsForScoring,
      { researchJobId: args.researchJobId }
    );

    // ── Sprint 2.14a: Reddit comment-tree mining.
    // For the TOP N reddit cards (those that passed Sprint 2.13a's
    // pain threshold), pull the comment trees and LLM-extract:
    //   - additional pain expressions found in REPLIES (~50% of
    //     buyer signal that the OP-only pipeline misses)
    //   - top buyer-quality commenters with their stated context
    // Patched onto the parent card's commentInsights field so the
    // channel-judge + downstream Maya subagents see the richer
    // conversation, not just the OP text. Skipped silently when
    // hasContext is false or scrapeCreatorsClient is unavailable.
    try {
      const reddit_topn_threshold_paid = expansion;
      if (
        scoredCards.length > 0 &&
        (reddit_topn_threshold_paid.icpPainPhrases.length > 0 ||
          reddit_topn_threshold_paid.productCategoryKeywords.length > 0)
      ) {
        const scrapeKey =
          process.env.SCRAPE_CREATORS_API_KEY ??
          process.env.SCRAPECREATORS_API_KEY;
        if (scrapeKey) {
          const scrapeClient = new ScrapeCreatorsClient({ apiKey: scrapeKey });
          const cardsForMining = scoredCards.map((c) => ({
            id: c.id!,
            url: c.url,
            title: c.title,
            snippet: c.snippet,
            painMatch: c.painMatch,
            source: c.source,
          }));
          const product = {
            productName: app.name ?? "Untitled product",
            productUrl: app.url,
            icpPainPhrases: expansion.icpPainPhrases ?? [],
            productCategoryKeywords: expansion.productCategoryKeywords ?? [],
          };
          const mineResult = await mineTopRedditCards(cardsForMining, product, {
            scrapeClient,
          });
          const toPatch = mineResult.results
            .filter((r) => r.insights !== null)
            .map((r) => ({
              cardId: r.cardId as Id<"gtmEvidenceCards">,
              commentInsights: r.insights!,
            }));
          if (toPatch.length > 0) {
            await ctx.runMutation(
              internal.gtmMaya.researchWorker.patchEvidenceCardCommentInsights,
              { insights: toPatch }
            );
          }
          await ctx.runMutation(
            internal.gtmMaya.researchWorker.recordPipelineHealth,
            {
              researchJobId: args.researchJobId,
              commentsMinedCount: mineResult.succeeded,
              commentsAttemptedCount: mineResult.attempted,
            }
          );
          llmCost.commentMiner = mineResult.costUsd;
          console.log(
            `[gtm/commentMiner] attempted=${mineResult.attempted} succeeded=${mineResult.succeeded} costUsd=${mineResult.costUsd.toFixed(6)}`
          );
        } else {
          console.log("[gtm/commentMiner] skipped — no ScrapeCreators API key");
        }
      }
    } catch (err) {
      console.warn(
        `[gtm/commentMiner] failed (channel-judge proceeds with OP-only signal): ${(err as Error).message}`
      );
    }

    // Re-read AGAIN to pick up commentInsights for the channel-judge.
    const cardsWithInsights = await ctx.runQuery(
      internal.gtmMaya.researchWorker.getEvidenceCardsForScoring,
      { researchJobId: args.researchJobId }
    );

    // ── Sprint 2.13b: LLM channel-judge.
    // Replaces the weighted-formula evaluateChannelSet that was
    // picking wrong channels on non-dev-tools products (live N=3
    // on 2026-05-24: Beehiiv → LinkedIn parked at 0.00; Bezel →
    // X parked at 0.00; TikTok scored 0.80+ but always parked).
    // One Gemini Flash medium-thinking call per channel decides
    // decision/confidence/reasons/risks/firstWeekTest from the
    // LLM-scored cards + product context.
    //
    // Sprint 2.13c: NO legacy fallback in production.
    // Previously fell back to evaluateChannelSet on LLM judge
    // failure, but the weighted-formula path produces wrong-shape
    // decisions (engagement-rank, not pain-language match) that
    // would silently ship to the operator. Cleaner failure mode:
    // when the LLM judge returns 0 decisions, ship 0 decisions
    // and surface a loud warning. Maya's boot_kickoff prompt
    // handles the "no active channels" case by skipping subagent
    // dispatch and asking the operator for guidance.
    let scores: Array<{
      channel: import("./channelScoring").GtmChannel;
      score: number;
      decision: import("./channelScoring").GtmChannelDecision;
      confidence: import("./channelScoring").GtmConfidence;
      reasons: string[];
      risks: string[];
      evidenceCardIds: string[];
      firstWeekTest?: string;
      qualityGate: { passed: boolean; failures: string[] };
    }> = [];
    try {
      const judgeProduct = {
        productName: app.name ?? "Untitled product",
        productUrl: app.url,
        founderWhy: app.founderWhy,
        icpPainPhrases: expansion.icpPainPhrases ?? [],
        productCategoryKeywords: expansion.productCategoryKeywords ?? [],
        stage: app.stage,
        weekGoal: app.weekGoal,
      };
      const judgeResult = await judgeAllChannels(cardsWithInsights, judgeProduct);
      scores = judgeResult.decisions.map((d) => ({
        channel: d.channel,
        score: d.score,
        decision: d.decision,
        confidence: d.confidence,
        reasons: d.reasons,
        risks: d.risks,
        evidenceCardIds: d.evidenceCardIds,
        firstWeekTest: d.firstWeekTest,
        qualityGate: d.qualityGate,
      }));
      llmCost.channelJudge = judgeResult.costUsd;
      console.log(
        `[gtm/channelJudge] LLM judged ${judgeResult.decisions.length}/${judgeResult.decisions.length + judgeResult.failedChannels.length} channels; failed=${judgeResult.failedChannels.join(",") || "none"} costUsd=${judgeResult.costUsd.toFixed(6)}`
      );
    } catch (err) {
      console.warn(
        `[gtm/channelJudge] LLM judge fatal — falling back to weighted formulas: ${(err as Error).message}`
      );
    }
    if (scores.length === 0) {
      console.warn(
        "[gtm/channelJudge] LLM produced 0 channel decisions — research job will complete with 0 channel decisions. Maya's first boot will surface this to the operator for manual review."
      );
    }

    if (scores.length > 0) {
      await ctx.runMutation(
        internal.gtmMaya.researchWorker.insertChannelScores,
        {
          researchJobId: args.researchJobId,
          // Defense in depth: drop only channels we never post to. TikTok /
          // Instagram / YouTube ARE postable bet channels (the visual set for
          // consumer products) and must persist. HN is research-only and
          // product_hunt is a one-day event — neither is a steady-state
          // posting channel, so neither is surfaced in the picker.
          scores: scores
            .filter((s) => s.channel !== "product_hunt" && s.channel !== "hn")
            .map((s) => ({
            channel: s.channel,
            score: s.score,
            // Schema's decision union doesn't include "blocked"; treat
            // blocked as parked for persistence (judge's reasons[] keeps
            // the original rationale).
            decision: s.decision === "blocked" ? "parked" : s.decision,
            confidence: s.confidence,
            reasons: s.reasons,
            risks: s.risks,
            evidenceCardIds: s.evidenceCardIds.map((id) => id as Id<"gtmEvidenceCards">),
            firstWeekTest: s.firstWeekTest,
            qualityGate: s.qualityGate,
          })),
        }
      );
    }

    // ── Final status + summary.
    const totalEvidence = evidenceCards.length;
    const totalSpent = perPlatformResults.reduce((sum, r) => sum + r.spentUsd, 0);
    const anyBudgetBlocked = perPlatformResults.some(
      (r) => r.status === "budget_blocked"
    );
    const enoughEvidence = totalEvidence >= 8; // doctrine threshold

    const status: "ready_for_review" | "needs_more_evidence" | "failed" =
      anyBudgetBlocked && totalEvidence === 0
        ? "failed"
        : enoughEvidence
          ? "ready_for_review"
          : "needs_more_evidence";

    await ctx.runMutation(internal.gtmMaya.researchWorker.setJobPhase, {
      researchJobId: args.researchJobId,
      phase: "complete",
      status,
      failureReason:
        status === "failed"
          ? "budget_blocked before any evidence was gathered"
          : undefined,
    });

    // Sprint 10 + 19 — Telegram handoff + workspace mutation. Look up
    // the agent that owns this account, persist a workspace-mutation
    // audit row (Sprint 19; APP/GTM/MEMORY content gets regenerated on
    // next deploy), then ping Maya via the hook bridge so she
    // summarizes the research to the user via Telegram. Both best-effort
    // — if the agent isn't deployed yet or hookToken is missing, the
    // research is still persisted.
    if (status !== "failed") {
      const agent = await ctx.runQuery(
        internal.gtmMaya.researchWorker.getGtmAgentForJob,
        { accountId: creatorId }
      );
      if (agent) {
        // Sprint 19 mutation audit (always; backup-blob optional).
        try {
          await ctx.runAction(
            internal.gtmMaya.workspaceMutator.mutateWorkspaceFromResearch,
            {
              agentId: agent._id,
              accountId: creatorId,
              researchJobId: args.researchJobId,
              trigger: "research_complete",
            }
          );
        } catch (err) {
          console.warn(
            "[orchestrator] workspace mutation failed:",
            (err as Error).message
          );
        }
        const primary = scores.find((s) => s.decision === "primary");
        const secondary = scores.find((s) => s.decision === "secondary");
        const topEvidenceUrls = evidenceCards
          .slice(0, 3)
          .map((c) => c.url)
          .filter((u) => Boolean(u));
        const succeededCount = perPlatformResults.filter(
          (r) => r.status === "succeeded"
        ).length;
        const insufficientCount = perPlatformResults.filter(
          (r) => r.status === "insufficient_evidence"
        ).length;
        try {
          await ctx.runAction(
            internal.gtmMaya.telegramHandoff.handoffResearchToTelegram,
            {
              agentId: agent._id,
              summary: {
                researchJobId: args.researchJobId,
                primaryChannel: primary?.channel,
                secondaryChannel: secondary?.channel,
                evidenceCount: totalEvidence,
                spentUsd: Math.round(totalSpent * 10000) / 10000,
                status,
                succeededPlatformCount: succeededCount,
                insufficientPlatformCount: insufficientCount,
                topEvidenceUrls,
              },
            }
          );
        } catch (err) {
          // Don't fail the orchestrator on handoff failure — research is
          // already persisted. Operator sees the failure in logs.
          console.warn(
            "[orchestrator] handoff failed:",
            (err as Error).message
          );
        }
      }
    }

    // Sprint 2.15.4 — persist aggregated LLM cost on the research
    // job row so analyze* queries surface exactly how much we spent
    // per stage. Excludes platform-scraping cost (spentUsd) which
    // is tracked separately. Excludes keywordExpansion until we
    // plumb cost through callMaya.
    const totalLlmCost =
      llmCost.keywordExpansion +
      llmCost.cardScorer +
      llmCost.commentMiner +
      llmCost.channelJudge;
    try {
      await ctx.runMutation(
        internal.gtmMaya.researchWorker.recordLlmCost,
        {
          researchJobId: args.researchJobId,
          spentUsdLlm: totalLlmCost,
          spentUsdLlmByStage: llmCost,
        }
      );
      console.log(
        `[gtm/llmCost] total=$${totalLlmCost.toFixed(6)} scorer=$${llmCost.cardScorer.toFixed(6)} miner=$${llmCost.commentMiner.toFixed(6)} judge=$${llmCost.channelJudge.toFixed(6)}`
      );
    } catch (err) {
      console.warn(
        `[gtm/llmCost] persist failed: ${(err as Error).message}`
      );
    }

    // Mark normal completion so the safety-net catch below doesn't
    // re-finalize as "failed" after a clean run.
    _finalized = true;
    return {
      status,
      summary: `${perPlatformResults.length} workers, ${totalEvidence} evidence cards, $${totalSpent.toFixed(4)} spent`,
      evidenceCount: totalEvidence,
      spentUsd: Math.round(totalSpent * 10000) / 10000,
      perPlatformResults,
    };

    } catch (err) {
      // Sprint 2.14a.2 safety net: ensure the research job never
      // sits at status:"running" if the orchestrator hits an
      // uncaught throw (observed live on ModelHub v6/v7,
      // probably OpenRouter rate-limit). Force-finalize so the
      // row is queryable + the deploy can fall through to "no
      // research decisions; manual review" instead of hanging.
      console.error(
        `[gtm/orchestrator] uncaught exception, force-finalizing as failed: ${(err as Error).message}`
      );
      await forceFinalizeOnError(err);
      // Re-throw so the caller sees the failure.
      throw err;
    }
  },
});

export const getGtmAgentForJob = internalQuery({
  args: { accountId: v.id("creators") },
  handler: async (
    ctx,
    args
  ): Promise<Doc<"gtmAgents"> | null> => {
    return await ctx.db
      .query("gtmAgents")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .first();
  },
});

/**
 * Public action the onboarding UI calls. Verifies the caller owns the
 * research job (cross-tenant isolation), then dispatches to the internal
 * orchestrator.
 */
export const runMyResearch = action({
  args: { researchJobId: v.id("gtmResearchJobs") },
  handler: async (
    ctx,
    args
  ): Promise<{
    status: string;
    summary: string;
    evidenceCount: number;
    spentUsd: number;
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("signed-in user required");
    const ownership = await ctx.runQuery(
      internal.gtmMaya.researchWorker.assertOwnsResearchJob,
      { researchJobId: args.researchJobId, clerkUserId: identity.subject }
    );
    if (!ownership.ok) throw new Error(ownership.reason);
    return await ctx.runAction(
      internal.gtmMaya.researchWorker.runBudgetedResearchJob,
      args
    );
  },
});

export const assertOwnsResearchJob = internalQuery({
  args: {
    researchJobId: v.id("gtmResearchJobs"),
    clerkUserId: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: true } | { ok: false; reason: string }> => {
    const creator = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", args.clerkUserId))
      .first();
    if (!creator || creator.accountType !== "gtm-agent") {
      return { ok: false, reason: "GTM account not found." };
    }
    const job = await ctx.db.get(args.researchJobId);
    if (!job || job.accountId !== creator._id) {
      return { ok: false, reason: "research job does not belong to caller" };
    }
    return { ok: true };
  },
});
