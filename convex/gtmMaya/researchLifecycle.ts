import { v } from "convex/values";
import {
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { assertGtmSpendAllowed } from "./betaGuards";
import { priceUsd } from "./providerPricing";

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

// Channels the agent may record scores for. Reconciled to the live
// judge's scored set: Reddit / X / LinkedIn / TikTok. youtube and
// product_hunt are deliberately excluded (vestigial / not in the
// product vision); the judge no longer emits them.
const CHANNEL = v.union(
  v.literal("reddit"),
  v.literal("x"),
  v.literal("linkedin"),
  v.literal("tiktok")
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
    // What the product does + what's different — the founder's own words, so
    // Maya never has to guess the differentiator (the dogfood "generic pitch"
    // gap). Renders into APP.md; anchors every research worker.
    differentiator: v.optional(v.string()),
    stage: APP_STAGE,
    weekGoal: WEEK_GOAL,
    userCountBand: v.optional(
      v.union(
        v.literal("none"),
        v.literal("1-100"),
        v.literal("100-1k"),
        v.literal("1k+"),
        v.literal("unknown")
      )
    ),
    canRecordScreen: v.boolean(),
    canShowFace: v.boolean(),
    canRecordVoice: v.optional(v.boolean()),
    canProvideScreenshots: v.optional(v.boolean()),
    canPostTikTokManually: v.optional(v.boolean()),
    canPostInstagramManually: v.optional(v.boolean()),
    existingTikTokUrl: v.optional(v.string()),
    existingInstagramUrl: v.optional(v.string()),
    existingYoutubeUrl: v.optional(v.string()),
    existingLinkedinUrl: v.optional(v.string()),
    existingXUrl: v.optional(v.string()),
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
    // Slideshow cluster — web-vs-mobile fork. Mobile apps carry store URLs +
    // a screenshots-as-asset emphasis; web apps just have the site `url`.
    appType: v.optional(v.union(v.literal("web"), v.literal("mobile"))),
    appStoreUrl: v.optional(v.string()),
    playStoreUrl: v.optional(v.string()),
    // Conversion instrumentation — what counts as a win + where it lands, so
    // the signup side of attribution can close.
    conversionKind: v.optional(v.string()),
    signupUrl: v.optional(v.string()),
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
        differentiator: args.differentiator,
        stage: args.stage,
        weekGoal: args.weekGoal,
        userCountBand: args.userCountBand,
        canRecordScreen: args.canRecordScreen,
        canShowFace: args.canShowFace,
        canRecordVoice: args.canRecordVoice ?? false,
        canProvideScreenshots: args.canProvideScreenshots ?? false,
        canPostTikTokManually: args.canPostTikTokManually ?? false,
        canPostInstagramManually: args.canPostInstagramManually ?? false,
        existingTikTokUrl: normalizeOptionalUrl(args.existingTikTokUrl),
        existingInstagramUrl: normalizeOptionalUrl(args.existingInstagramUrl),
        existingYoutubeUrl: normalizeOptionalUrl(args.existingYoutubeUrl),
        existingLinkedinUrl: normalizeOptionalUrl(args.existingLinkedinUrl),
        existingXUrl: normalizeOptionalUrl(args.existingXUrl),
        tiktokWarmupState: args.tiktokWarmupState ?? "unknown",
        tiktokAccountAgeDays: args.tiktokAccountAgeDays,
        tiktokAccountStatusChecked: args.tiktokAccountStatusChecked ?? false,
        openToUgcCreators: args.openToUgcCreators ?? false,
        creatorBudgetMonthlyUsd: args.creatorBudgetMonthlyUsd,
        maxWeeklyVisualPosts: args.maxWeeklyVisualPosts,
        excludedAudiences: args.excludedAudiences,
        entryMode: args.entryMode,
        appType: args.appType,
        appStoreUrl: normalizeOptionalUrl(args.appStoreUrl),
        playStoreUrl: normalizeOptionalUrl(args.playStoreUrl),
        conversionKind: args.conversionKind,
        signupUrl: normalizeOptionalUrl(args.signupUrl),
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
      differentiator: args.differentiator,
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
      existingXUrl: normalizeOptionalUrl(args.existingXUrl),
      tiktokWarmupState: args.tiktokWarmupState ?? "unknown",
      tiktokAccountAgeDays: args.tiktokAccountAgeDays,
      tiktokAccountStatusChecked: args.tiktokAccountStatusChecked ?? false,
      openToUgcCreators: args.openToUgcCreators ?? false,
      creatorBudgetMonthlyUsd: args.creatorBudgetMonthlyUsd,
      maxWeeklyVisualPosts: args.maxWeeklyVisualPosts,
      excludedAudiences: args.excludedAudiences,
      entryMode: args.entryMode,
      appType: args.appType,
      appStoreUrl: normalizeOptionalUrl(args.appStoreUrl),
      playStoreUrl: normalizeOptionalUrl(args.playStoreUrl),
      conversionKind: args.conversionKind,
      signupUrl: normalizeOptionalUrl(args.signupUrl),
      diagnosis: args.diagnosis,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(agent._id, { appId, updatedAt: now });
    return appId;
  },
});

const USER_COUNT_BAND = v.union(
  v.literal("none"),
  v.literal("1-100"),
  v.literal("100-1k"),
  v.literal("1k+"),
  v.literal("unknown")
);

const MAX_DIFFERENTIATOR = 2000;
const MAX_FOUNDER_WHY = 2000;
const MAX_NAME = 200;

/** Trim, drop-if-empty, clamp to max length (adversarial guard). */
function clampOptionalString(
  value: string | undefined,
  max: number
): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed.slice(0, max);
}

/**
 * W1.1 — Post-onboarding product-context correction. The founder edits Maya's
 * working picture of the product (differentiator, why, stage, goal, traction
 * band, name) from the Product-brain surface. Corrections persist to `gtmApps`
 * (NOT ephemeral chat memory) and re-anchor APP.md on the next deploy. Every
 * field is optional so the UI can patch one at a time. Auth-scoped + fail-
 * closed: the app must belong to the signed-in founder's agent.
 */
export const updateProductContext = mutation({
  args: {
    differentiator: v.optional(v.string()),
    founderWhy: v.optional(v.string()),
    name: v.optional(v.string()),
    stage: v.optional(APP_STAGE),
    weekGoal: v.optional(WEEK_GOAL),
    userCountBand: v.optional(USER_COUNT_BAND),
  },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const { creator, agent } = await requireMyGtmAgent(ctx);
    if (!agent.appId) {
      throw new Error("updateProductContext: no app for this agent.");
    }
    const app = await ctx.db.get(agent.appId);
    if (!app || app.accountId !== creator._id) {
      throw new Error("updateProductContext: app/account mismatch.");
    }
    const now = Date.now();
    const differentiator = clampOptionalString(
      args.differentiator,
      MAX_DIFFERENTIATOR
    );
    const founderWhy = clampOptionalString(args.founderWhy, MAX_FOUNDER_WHY);
    const name = clampOptionalString(args.name, MAX_NAME);
    await ctx.db.patch(app._id, {
      updatedAt: now,
      ...(differentiator !== undefined ? { differentiator } : {}),
      ...(founderWhy !== undefined ? { founderWhy } : {}),
      ...(name !== undefined ? { name } : {}),
      ...(args.stage !== undefined ? { stage: args.stage } : {}),
      ...(args.weekGoal !== undefined ? { weekGoal: args.weekGoal } : {}),
      ...(args.userCountBand !== undefined
        ? { userCountBand: args.userCountBand }
        : {}),
    });
    return { ok: true };
  },
});

const AUTONOMOUS_POSTING = v.union(
  v.literal("confirm_each"),
  v.literal("confirm_first_week"),
  v.literal("autonomous")
);

/**
 * W2 — the founder sets how much rope Maya gets on the auto channels (the
 * Account settings control + the conversational set_posting_mode tool both land
 * here). Auth-scoped + fail-closed. The publish gate enforces this inside the
 * ban-safety floor + plan ceiling, so this is a preference, never a bypass.
 */
export const setMyPostingMode = mutation({
  args: { mode: AUTONOMOUS_POSTING },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const { agent } = await requireMyGtmAgent(ctx);
    const now = Date.now();
    await ctx.db.patch(agent._id, {
      autonomousPosting: args.mode,
      // Starting/restarting the ramp: stamp the clock if entering
      // confirm_first_week without one already running.
      ...(args.mode === "confirm_first_week" && agent.autonomousSince == null
        ? { autonomousSince: now }
        : {}),
      updatedAt: now,
    });
    return { ok: true };
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

    // Provider-complete metering (Phase-2 ⓪): the high-frequency READ
    // providers (ScrapeCreators / TwitterAPI.io / DataForSEO) often log
    // costUsd: 0 because the call site never knew the rate. When the caller
    // passes 0 AND a unit count, derive the REAL cost from the sourced unit
    // rates. An explicit non-zero costUsd stays authoritative — never
    // overridden. Token providers (gemini/openrouter) price to 0 here because
    // they're already metered upstream via openrouterSpend (usage.costUsd).
    // This single hook prices both the Convex workers and any plugin
    // read-endpoint that routes through recordCost.
    const effectiveCostUsd =
      args.costUsd === 0 && args.units !== undefined
        ? priceUsd(args.provider, args.units, args.operation)
        : args.costUsd;

    await assertGtmSpendAllowed(ctx, creator._id, effectiveCostUsd);
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
      costUsd: effectiveCostUsd,
      units: args.units,
      cacheStatus: args.cacheStatus,
      metadata: args.metadata,
      createdAt: now,
    });
    if (job) {
      await ctx.db.patch(job._id, {
        spentUsd: Math.round((job.spentUsd + effectiveCostUsd) * 10000) / 10000,
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

/**
 * S3 — operator channel-selection override. The onboarding channel-selection
 * UX shows the agent's ranked, evidence-backed recommendation; the operator
 * confirms it or toggles which channels to bet on. This persists their pick
 * by patching the latest research job's gtmChannelScores `decision` + stamping
 * operatorConfirmedAt. The deploy reads `decision === "primary"/"secondary"`
 * into GTM.md, so the operator's call flows straight to the agent's bet
 * channels. All platforms are selectable — nothing is gated, the operator
 * just focuses the set ("Maya proposes with evidence, the operator decides").
 */
export const setMyChannelDecisions = mutation({
  args: {
    decisions: v.array(
      v.object({
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
        decision: v.union(
          v.literal("primary"),
          v.literal("secondary"),
          v.literal("parked"),
          v.literal("blocked")
        ),
      })
    ),
  },
  handler: async (ctx, args): Promise<{ updated: number }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("channel selection requires a signed-in user.");
    const creator = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first();
    if (!creator || creator.accountType !== "gtm-agent") {
      throw new Error("GTM account not found.");
    }
    const jobs = await ctx.db
      .query("gtmResearchJobs")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .collect();
    const latestJob = jobs.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
    if (!latestJob) throw new Error("no research job to apply decisions to.");

    const scores = await ctx.db
      .query("gtmChannelScores")
      .withIndex("by_research_job", (q) => q.eq("researchJobId", latestJob._id))
      .collect();
    const byChannel = new Map(scores.map((s) => [s.channel, s]));
    const now = Date.now();
    let updated = 0;
    for (const d of args.decisions) {
      const row = byChannel.get(d.channel);
      // Cross-tenant safety: only patch rows under this creator's latest job.
      if (!row || row.accountId !== creator._id) continue;
      await ctx.db.patch(row._id, {
        decision: d.decision,
        operatorConfirmedAt: now,
      });
      updated += 1;
    }
    return { updated };
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
      // W2 — default to the confirm-first-week trust ramp. autonomousSince
      // starts the 7-day clock now; confirmedPostCount climbs toward the
      // 3-confirm graduation. The founder can change this any time (settings
      // control + set_posting_mode). Default lives here so the ramp actually
      // runs; the publish gate fail-closes to confirm if it's ever absent.
      autonomousPosting: "confirm_first_week",
      autonomousSince: now,
      confirmedPostCount: 0,
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
