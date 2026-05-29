import { v } from "convex/values";
import {
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { assertGtmSpendAllowed } from "./betaGuards";

const CHANNEL_PREFERENCE = v.union(
  v.literal("whatsapp"),
  v.literal("imessage"),
  v.literal("web"),
  // Sprint 15 (Part II D1) — Telegram is the default ClawLaunch channel.
  v.literal("telegram")
);

const APP_STAGE = v.union(
  v.literal("idea"),
  v.literal("live-beta"),
  v.literal("paid"),
  v.literal("unknown")
);

const WEEK_GOAL = v.union(
  v.literal("feedback"),
  v.literal("signups"),
  v.literal("demos"),
  v.literal("revenue"),
  v.literal("unknown")
);

const TIKTOK_WARMUP_STATE = v.union(
  v.literal("unknown"),
  v.literal("new_needs_warmup"),
  v.literal("warming"),
  v.literal("ready"),
  v.literal("restricted")
);

const RESEARCH_STATUS = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("needs_more_evidence"),
  v.literal("ready_for_review"),
  v.literal("failed"),
  v.literal("cancelled")
);

const RESEARCH_PHASE = v.union(
  v.literal("app_inspection"),
  v.literal("icp_hypotheses"),
  v.literal("channel_research"),
  v.literal("strategy_judge"),
  v.literal("calendar_build"),
  v.literal("complete")
);

const EVIDENCE_SOURCE = v.union(
  v.literal("app"),
  v.literal("google"),
  v.literal("reddit"),
  v.literal("x"),
  v.literal("linkedin"),
  v.literal("tiktok"),
  v.literal("instagram"),
  v.literal("competitor")
);

const EVIDENCE_RECENCY = v.union(
  v.literal("fresh"),
  v.literal("recent"),
  v.literal("old"),
  v.literal("unknown")
);

const PROMOTION_RISK = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
  v.literal("unknown")
);

const RECOMMENDED_USE = v.union(
  v.literal("strategy"),
  v.literal("reply"),
  v.literal("content_format"),
  v.literal("avoid"),
  v.literal("competitor")
);

const CHANNEL = v.union(
  v.literal("reddit"),
  v.literal("x"),
  v.literal("linkedin"),
  v.literal("tiktok"),
  v.literal("product_hunt")
);

const CHANNEL_DECISION = v.union(
  v.literal("primary"),
  v.literal("secondary"),
  v.literal("parked"),
  v.literal("blocked")
);

const CONFIDENCE = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high")
);

const COST_PROVIDER = v.union(
  v.literal("scrapecreators"),
  v.literal("gemini"),
  v.literal("openrouter"),
  v.literal("composio"),
  v.literal("x_api"),
  v.literal("openclaw"),
  v.literal("other")
);

const CACHE_STATUS = v.union(
  v.literal("hit"),
  v.literal("miss"),
  v.literal("called"),
  v.literal("skipped"),
  v.literal("failed")
);

const EVIDENCE_INPUT = v.object({
  source: EVIDENCE_SOURCE,
  url: v.string(),
  title: v.optional(v.string()),
  snippet: v.string(),
  authorOrCommunity: v.optional(v.string()),
  observedAt: v.number(),
  recency: EVIDENCE_RECENCY,
  engagement: v.optional(
    v.object({
      likes: v.optional(v.number()),
      comments: v.optional(v.number()),
      shares: v.optional(v.number()),
      views: v.optional(v.number()),
    })
  ),
  painMatch: v.number(),
  buyerMatch: v.number(),
  channelFit: v.number(),
  promotionRisk: PROMOTION_RISK,
  recommendedUse: RECOMMENDED_USE,
  extractedClaims: v.array(v.string()),
  rawRef: v.optional(v.string()),
});

const CHANNEL_SCORE_INPUT = v.object({
  channel: CHANNEL,
  score: v.number(),
  decision: CHANNEL_DECISION,
  confidence: CONFIDENCE,
  reasons: v.array(v.string()),
  risks: v.array(v.string()),
  evidenceCardIds: v.array(v.id("gtmEvidenceCards")),
  firstWeekTest: v.optional(v.string()),
  qualityGate: v.object({
    passed: v.boolean(),
    failures: v.array(v.string()),
  }),
});

export const getGtmCreatorForDeploy = internalQuery({
  args: { clerkUserId: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{
    accountId: Id<"creators">;
    agentId: Id<"gtmAgents"> | null;
  } | null> => {
    const creator = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", args.clerkUserId))
      .first();
    if (!creator || creator.accountType !== "gtm-agent") return null;
    const agent = await ctx.db
      .query("gtmAgents")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .first();
    return {
      accountId: creator._id,
      agentId: agent?._id ?? null,
    };
  },
});

export const startGtmOnboarding = mutation({
  args: {
    channelPreference: v.optional(CHANNEL_PREFERENCE),
    timezone: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    accountId: Id<"creators">;
    agentId: Id<"gtmAgents">;
    created: boolean;
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("startGtmOnboarding: signed-in user required.");
    return await findOrCreateGtmAgent(ctx, {
      clerkUserId: identity.subject,
      email: identity.email ?? `${identity.subject}@unknown.clawlaunch`,
      channelPreference: args.channelPreference ?? "web",
      timezone: args.timezone ?? "America/New_York",
    });
  },
});

export const setAppProfile = mutation({
  args: {
    name: v.optional(v.string()),
    url: v.string(),
    founderWhy: v.optional(v.string()),
    stage: APP_STAGE,
    weekGoal: WEEK_GOAL,
    canRecordScreen: v.boolean(),
    canShowFace: v.boolean(),
    canRecordVoice: v.optional(v.boolean()),
    canProvideScreenshots: v.optional(v.boolean()),
    canPostTikTokManually: v.optional(v.boolean()),
    canPostInstagramManually: v.optional(v.boolean()),
    existingTikTokUrl: v.optional(v.string()),
    existingInstagramUrl: v.optional(v.string()),
    tiktokWarmupState: v.optional(TIKTOK_WARMUP_STATE),
    tiktokAccountAgeDays: v.optional(v.number()),
    tiktokAccountStatusChecked: v.optional(v.boolean()),
    openToUgcCreators: v.optional(v.boolean()),
    creatorBudgetMonthlyUsd: v.optional(v.number()),
    maxWeeklyVisualPosts: v.optional(v.number()),
    excludedAudiences: v.array(v.string()),
    // Sprint B — journey-stage fork captured at onboarding (the launch vs
    // manager tab). Optional; Maya can also resolve/refine it later via
    // /lc_gtm/set_north_star.
    entryMode: v.optional(v.union(v.literal("launch"), v.literal("manager"))),
    diagnosis: v.optional(v.any()),
  },
  handler: async (ctx, args): Promise<Id<"gtmApps">> => {
    const { creator, agent } = await requireMyGtmAgent(ctx);
    const now = Date.now();
    const existing = await ctx.db
      .query("gtmApps")
      .withIndex("by_account_and_url", (q) =>
        q.eq("accountId", creator._id).eq("url", args.url)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name,
        founderWhy: args.founderWhy,
        stage: args.stage,
        weekGoal: args.weekGoal,
        canRecordScreen: args.canRecordScreen,
        canShowFace: args.canShowFace,
        canRecordVoice: args.canRecordVoice ?? false,
        canProvideScreenshots: args.canProvideScreenshots ?? false,
        canPostTikTokManually: args.canPostTikTokManually ?? false,
        canPostInstagramManually: args.canPostInstagramManually ?? false,
        existingTikTokUrl: normalizeOptionalUrl(args.existingTikTokUrl),
        existingInstagramUrl: normalizeOptionalUrl(args.existingInstagramUrl),
        tiktokWarmupState: args.tiktokWarmupState ?? "unknown",
        tiktokAccountAgeDays: args.tiktokAccountAgeDays,
        tiktokAccountStatusChecked: args.tiktokAccountStatusChecked ?? false,
        openToUgcCreators: args.openToUgcCreators ?? false,
        creatorBudgetMonthlyUsd: args.creatorBudgetMonthlyUsd,
        maxWeeklyVisualPosts: args.maxWeeklyVisualPosts,
        excludedAudiences: args.excludedAudiences,
        entryMode: args.entryMode,
        diagnosis: args.diagnosis,
        updatedAt: now,
      });
      await ctx.db.patch(agent._id, { appId: existing._id, updatedAt: now });
      return existing._id;
    }

    const appId = await ctx.db.insert("gtmApps", {
      accountId: creator._id,
      name: args.name,
      url: args.url,
      founderWhy: args.founderWhy,
      stage: args.stage,
      weekGoal: args.weekGoal,
      canRecordScreen: args.canRecordScreen,
      canShowFace: args.canShowFace,
      canRecordVoice: args.canRecordVoice ?? false,
      canProvideScreenshots: args.canProvideScreenshots ?? false,
      canPostTikTokManually: args.canPostTikTokManually ?? false,
      canPostInstagramManually: args.canPostInstagramManually ?? false,
      existingTikTokUrl: normalizeOptionalUrl(args.existingTikTokUrl),
      existingInstagramUrl: normalizeOptionalUrl(args.existingInstagramUrl),
      tiktokWarmupState: args.tiktokWarmupState ?? "unknown",
      tiktokAccountAgeDays: args.tiktokAccountAgeDays,
      tiktokAccountStatusChecked: args.tiktokAccountStatusChecked ?? false,
      openToUgcCreators: args.openToUgcCreators ?? false,
      creatorBudgetMonthlyUsd: args.creatorBudgetMonthlyUsd,
      maxWeeklyVisualPosts: args.maxWeeklyVisualPosts,
      excludedAudiences: args.excludedAudiences,
      entryMode: args.entryMode,
      diagnosis: args.diagnosis,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(agent._id, { appId, updatedAt: now });
    return appId;
  },
});

export const createResearchJob = mutation({
  args: {
    appId: v.id("gtmApps"),
    budgetUsd: v.number(),
  },
  handler: async (ctx, args): Promise<Id<"gtmResearchJobs">> => {
    if (args.budgetUsd <= 0) throw new Error("budgetUsd must be positive.");
    const { creator } = await requireMyGtmAgent(ctx);
    const app = await ctx.db.get(args.appId);
    if (!app || app.accountId !== creator._id) {
      throw new Error("createResearchJob: app does not belong to this account.");
    }
    const now = Date.now();
    return await ctx.db.insert("gtmResearchJobs", {
      accountId: creator._id,
      appId: args.appId,
      status: "queued",
      phase: "app_inspection",
      budgetUsd: args.budgetUsd,
      spentUsd: 0,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateResearchJob = mutation({
  args: {
    researchJobId: v.id("gtmResearchJobs"),
    status: RESEARCH_STATUS,
    phase: RESEARCH_PHASE,
    failureReason: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const { creator } = await requireMyGtmAgent(ctx);
    const job = await requireMyResearchJob(ctx, creator._id, args.researchJobId);
    const now = Date.now();
    await ctx.db.patch(job._id, {
      status: args.status,
      phase: args.phase,
      failureReason: args.failureReason,
      startedAt: job.startedAt ?? (args.status === "running" ? now : undefined),
      completedAt: isTerminalStatus(args.status) ? now : job.completedAt,
      updatedAt: now,
    });
  },
});

export const recordEvidenceCards = mutation({
  args: {
    researchJobId: v.id("gtmResearchJobs"),
    cards: v.array(EVIDENCE_INPUT),
  },
  handler: async (ctx, args): Promise<Id<"gtmEvidenceCards">[]> => {
    const { creator } = await requireMyGtmAgent(ctx);
    await requireMyResearchJob(ctx, creator._id, args.researchJobId);
    const now = Date.now();
    const ids: Id<"gtmEvidenceCards">[] = [];
    for (const card of args.cards) {
      ids.push(
        await ctx.db.insert("gtmEvidenceCards", {
          accountId: creator._id,
          researchJobId: args.researchJobId,
          ...card,
          createdAt: now,
        })
      );
    }
    return ids;
  },
});

export const recordChannelScores = mutation({
  args: {
    researchJobId: v.id("gtmResearchJobs"),
    scores: v.array(CHANNEL_SCORE_INPUT),
  },
  handler: async (ctx, args): Promise<Id<"gtmChannelScores">[]> => {
    const { creator } = await requireMyGtmAgent(ctx);
    await requireMyResearchJob(ctx, creator._id, args.researchJobId);
    for (const score of args.scores) {
      await assertEvidenceBelongsToJob(
        ctx,
        creator._id,
        args.researchJobId,
        score.evidenceCardIds
      );
    }
    const now = Date.now();
    const ids: Id<"gtmChannelScores">[] = [];
    for (const score of args.scores) {
      ids.push(
        await ctx.db.insert("gtmChannelScores", {
          accountId: creator._id,
          researchJobId: args.researchJobId,
          ...score,
          createdAt: now,
        })
      );
    }
    return ids;
  },
});

export const recordCost = mutation({
  args: {
    researchJobId: v.optional(v.id("gtmResearchJobs")),
    provider: COST_PROVIDER,
    operation: v.string(),
    reason: v.string(),
    costUsd: v.number(),
    units: v.optional(v.number()),
    cacheStatus: CACHE_STATUS,
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args): Promise<Id<"gtmCostLedger">> => {
    if (args.costUsd < 0) throw new Error("costUsd cannot be negative.");
    const { creator } = await requireMyGtmAgent(ctx);
    await assertGtmSpendAllowed(ctx, creator._id, args.costUsd);
    let job: Doc<"gtmResearchJobs"> | null = null;
    if (args.researchJobId) {
      job = await requireMyResearchJob(ctx, creator._id, args.researchJobId);
    }
    const now = Date.now();
    const id = await ctx.db.insert("gtmCostLedger", {
      accountId: creator._id,
      researchJobId: args.researchJobId,
      provider: args.provider,
      operation: args.operation,
      reason: args.reason,
      costUsd: args.costUsd,
      units: args.units,
      cacheStatus: args.cacheStatus,
      metadata: args.metadata,
      createdAt: now,
    });
    if (job) {
      await ctx.db.patch(job._id, {
        spentUsd: Math.round((job.spentUsd + args.costUsd) * 10000) / 10000,
        updatedAt: now,
      });
    }
    return id;
  },
});

export const getMyGtmSnapshot = query({
  args: {},
  handler: async (
    ctx
  ): Promise<{
    creator: Pick<Doc<"creators">, "_id" | "email" | "accountType">;
    agent: Doc<"gtmAgents">;
    app: Doc<"gtmApps"> | null;
    latestJob: Doc<"gtmResearchJobs"> | null;
    evidenceCount: number;
    channelScores: Doc<"gtmChannelScores">[];
    costTotalUsd: number;
  } | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const creator = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first();
    if (!creator || creator.accountType !== "gtm-agent") return null;
    const agent = await ctx.db
      .query("gtmAgents")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .first();
    if (!agent) return null;
    const app = agent.appId ? await ctx.db.get(agent.appId) : null;
    const jobs = await ctx.db
      .query("gtmResearchJobs")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .collect();
    const latestJob = jobs.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
    const evidence = latestJob
      ? await ctx.db
          .query("gtmEvidenceCards")
          .withIndex("by_research_job", (q) =>
            q.eq("researchJobId", latestJob._id)
          )
          .collect()
      : [];
    const channelScores = latestJob
      ? await ctx.db
          .query("gtmChannelScores")
          .withIndex("by_research_job", (q) =>
            q.eq("researchJobId", latestJob._id)
          )
          .collect()
      : [];
    const costs = await ctx.db
      .query("gtmCostLedger")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .collect();

    return {
      creator: {
        _id: creator._id,
        email: creator.email,
        accountType: creator.accountType,
      },
      agent,
      app,
      latestJob,
      evidenceCount: evidence.length,
      channelScores,
      costTotalUsd: Math.round(
        costs.reduce((sum, row) => sum + row.costUsd, 0) * 10000
      ) / 10000,
    };
  },
});

async function findOrCreateGtmAgent(
  ctx: MutationCtx,
  args: {
    clerkUserId: string;
    email: string;
    channelPreference: "whatsapp" | "imessage" | "web" | "telegram";
    timezone: string;
  }
): Promise<{
  accountId: Id<"creators">;
  agentId: Id<"gtmAgents">;
  created: boolean;
}> {
  const now = Date.now();
  let creator = await ctx.db
    .query("creators")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", args.clerkUserId))
    .first();
  if (!creator) {
    const creatorId = await ctx.db.insert("creators", {
      clerkUserId: args.clerkUserId,
      email: args.email,
      channelPreference: args.channelPreference,
      timezone: args.timezone,
      status: "onboarding",
      plan: "coach",
      accountType: "gtm-agent",
      createdAt: now,
    });
    creator = (await ctx.db.get(creatorId))!;
  } else if (creator.accountType !== "gtm-agent") {
    await ctx.db.patch(creator._id, {
      accountType: "gtm-agent",
      channelPreference: args.channelPreference,
      timezone: args.timezone,
    });
    creator = (await ctx.db.get(creator._id))!;
  }

  let agent = await ctx.db
    .query("gtmAgents")
    .withIndex("by_account", (q) => q.eq("accountId", creator._id))
    .first();
  let created = false;
  if (!agent) {
    const agentId = await ctx.db.insert("gtmAgents", {
      accountId: creator._id,
      onboardingStep: "intake",
      channelPreference: args.channelPreference,
      timezone: args.timezone,
      createdAt: now,
      updatedAt: now,
    });
    agent = (await ctx.db.get(agentId))!;
    created = true;
  }

  return { accountId: creator._id, agentId: agent._id, created };
}

async function requireMyGtmAgent(
  ctx: MutationCtx
): Promise<{ creator: Doc<"creators">; agent: Doc<"gtmAgents"> }> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("GTM Maya mutation requires a signed-in user.");
  const creator = await ctx.db
    .query("creators")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
    .first();
  if (!creator || creator.accountType !== "gtm-agent") {
    throw new Error("GTM Maya account not found for signed-in user.");
  }
  const agent = await ctx.db
    .query("gtmAgents")
    .withIndex("by_account", (q) => q.eq("accountId", creator._id))
    .first();
  if (!agent) throw new Error("GTM Maya agent row missing.");
  return { creator, agent };
}

async function requireMyResearchJob(
  ctx: MutationCtx,
  accountId: Id<"creators">,
  researchJobId: Id<"gtmResearchJobs">
): Promise<Doc<"gtmResearchJobs">> {
  const job = await ctx.db.get(researchJobId);
  if (!job || job.accountId !== accountId) {
    throw new Error("Research job does not belong to this account.");
  }
  return job;
}

async function assertEvidenceBelongsToJob(
  ctx: MutationCtx,
  accountId: Id<"creators">,
  researchJobId: Id<"gtmResearchJobs">,
  evidenceCardIds: ReadonlyArray<Id<"gtmEvidenceCards">>
): Promise<void> {
  for (const evidenceCardId of evidenceCardIds) {
    const card = await ctx.db.get(evidenceCardId);
    if (!card || card.accountId !== accountId || card.researchJobId !== researchJobId) {
      throw new Error("Channel score referenced evidence outside this research job.");
    }
  }
}

function isTerminalStatus(status: Doc<"gtmResearchJobs">["status"]): boolean {
  return (
    status === "ready_for_review" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "needs_more_evidence"
  );
}

function normalizeOptionalUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
