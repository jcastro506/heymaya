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
    }));
  },
});

/**
 * Sprint 2.13a — patch LLM-scored painMatch / buyerMatch / channelFit
 * + painLanguageReason onto evidence cards after scoreAllCardsForProduct
 * returns. Bounded batch update; silently skips IDs that no longer
 * exist (could happen if a parallel run wiped the job).
 */
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

export const insertChannelScores = internalMutation({
  args: {
    researchJobId: v.id("gtmResearchJobs"),
    scores: v.array(
      v.object({
        channel: v.union(
          v.literal("reddit"),
          v.literal("x"),
          v.literal("linkedin"),
          v.literal("tiktok"),
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

    await ctx.runMutation(internal.gtmMaya.researchWorker.setJobPhase, {
      researchJobId: args.researchJobId,
      phase: "app_inspection",
      status: "running",
    });

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
        console.log(
          `[gtm/cardScorer] scored=${result.scores.length} missing=${result.missingIds.length} batches=${result.batchCount} usage=${JSON.stringify(result.totalUsage)}`
        );
      } else {
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

    // ── Sprint 2.13b: LLM channel-judge.
    // Replaces the weighted-formula evaluateChannelSet that was
    // picking wrong channels on non-dev-tools products (live N=3
    // on 2026-05-24: Beehiiv → LinkedIn parked at 0.00; Bezel →
    // X parked at 0.00; TikTok scored 0.80+ but always parked).
    // One Gemini Flash medium-thinking call per channel decides
    // decision/confidence/reasons/risks/firstWeekTest from the
    // LLM-scored cards + product context.
    //
    // Fallback: if the LLM judge fails entirely (no decisions
    // returned), fall back to the legacy evaluateChannelSet so we
    // don't ship a deploy with zero channel decisions. The
    // fallback path is logged loud so we can investigate.
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
      const judgeResult = await judgeAllChannels(scoredCards, judgeProduct);
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
      console.log(
        `[gtm/channelJudge] LLM judged ${judgeResult.decisions.length}/${judgeResult.decisions.length + judgeResult.failedChannels.length} channels; failed=${judgeResult.failedChannels.join(",") || "none"}`
      );
    } catch (err) {
      console.warn(
        `[gtm/channelJudge] LLM judge fatal — falling back to weighted formulas: ${(err as Error).message}`
      );
    }
    if (scores.length === 0) {
      console.warn(
        "[gtm/channelJudge] LLM produced 0 channel decisions; using legacy evaluateChannelSet fallback"
      );
      scores = evaluateChannelSet(scoredCards, appContext(app));
    }

    if (scores.length > 0) {
      await ctx.runMutation(
        internal.gtmMaya.researchWorker.insertChannelScores,
        {
          researchJobId: args.researchJobId,
          scores: scores.map((s) => ({
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

    return {
      status,
      summary: `${perPlatformResults.length} workers, ${totalEvidence} evidence cards, $${totalSpent.toFixed(4)} spent`,
      evidenceCount: totalEvidence,
      spentUsd: Math.round(totalSpent * 10000) / 10000,
      perPlatformResults,
    };
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
