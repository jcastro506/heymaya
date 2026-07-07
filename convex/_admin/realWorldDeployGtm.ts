/**
 * One-shot admin driver to spin up a real synthetic ClawLaunch GTM creator
 * end-to-end, without Clerk. Mirrors `_admin/realWorldDeploy.ts` but for
 * the GTM track. Burns real ScrapeCreators + OpenRouter credits, and
 * (when `deployFly: true`) creates a real Fly machine.
 *
 * Phases (each gated by an arg flag so partial runs are possible):
 *   1. wipe prior synthetic gtm test rows (always)
 *   2. seed creator + gtmAgent + gtmApp + initial gtmResearchJob (always)
 *   3. deploy Fly machine via deployMayaGtm (when deployFly=true)
 *   4. patch telegramChatId onto agent (when provided)
 *   5. run runBudgetedResearchJob — which already chains workspace
 *      mutation + Telegram handoff after research completes
 *
 * Usage:
 *   npx convex run _admin/realWorldDeployGtm:run \
 *     '{"productName":"ModelHub","productUrl":"https://studio.consciousengines.com/model-hub","founderWhy":"local LLM workflows on Mac feel disjointed","weekGoal":"signups","stage":"live-beta","budgetUsd":0.5,"deployFly":true}'
 *
 *   # With known operator Telegram chatId (skip pairing flow):
 *   #   ...add `"telegramChatId":"12345678"` to the JSON above
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id, TableNames } from "../_generated/dataModel";
import {
  buildGtmPlanJson,
  type GtmPlan,
  type GtmPlanStatus,
} from "../gtmMaya/planGtm";

const TEST_CLERK_USER_ID_PREFIX = "test_gtm_synth_";
const TEST_EMAIL = "gtm-synth-test@heymaya.local";
const TEST_TIMEZONE = "America/New_York";

export const wipeExistingGtmTestCreators = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ wipedCreators: number; wipedAgents: number; wipedApps: number; wipedJobs: number }> => {
    const all = await ctx.db.query("creators").collect();
    const testRows = all.filter((c) => c.clerkUserId.startsWith(TEST_CLERK_USER_ID_PREFIX));
    let wipedAgents = 0;
    let wipedApps = 0;
    let wipedJobs = 0;

    for (const creator of testRows) {
      const cid = creator._id;

      const agents = await ctx.db
        .query("gtmAgents")
        .withIndex("by_account", (q) => q.eq("accountId", cid))
        .collect();
      for (const agent of agents) {
        const pairTokens = await ctx.db
          .query("gtmTelegramPairingTokens")
          .withIndex("by_agent", (q) => q.eq("agentId", agent._id))
          .collect();
        for (const t of pairTokens) await ctx.db.delete(t._id);
        await ctx.db.delete(agent._id);
        wipedAgents += 1;
      }

      const apps = await ctx.db
        .query("gtmApps")
        .withIndex("by_account", (q) => q.eq("accountId", cid))
        .collect();
      for (const app of apps) {
        const jobs = await ctx.db
          .query("gtmResearchJobs")
          .withIndex("by_app", (q) => q.eq("appId", app._id))
          .collect();
        for (const job of jobs) {
          await ctx.db.delete(job._id);
          wipedJobs += 1;
        }
        await ctx.db.delete(app._id);
        wipedApps += 1;
      }

      await ctx.db.delete(cid);
    }

    return {
      wipedCreators: testRows.length,
      wipedAgents,
      wipedApps,
      wipedJobs,
    };
  },
});

// One-time STAGING clean-slate: wipe ALL creators + every gtm* table so a fresh
// signup → onboarding → mission-control flow starts from zero. This is a full
// reset (not a per-user delete), so it also clears the cross-tenant learning
// tables (gtmArchetypeLearnings / gtmSkillImprovementProposals). Staging only —
// never run against prod.
export const wipeStagingCleanSlate = internalMutation({
  args: {},
  handler: async (ctx): Promise<Record<string, number>> => {
    const TABLES = [
      "creators",
      "gtmActionLog", "gtmAgentActivity", "gtmAgents", "gtmApps",
      "gtmArchetypeLearnings", "gtmAuditEvents", "gtmBetaCohort", "gtmBuyerMap",
      "gtmBuyerSegments", "gtmCalendarConnections", "gtmCalendarEvents",
      "gtmChannelScorecard", "gtmChannelScores", "gtmCompetitiveMap",
      "gtmCompetitorMoves", "gtmConnectionHealth", "gtmContentAngles",
      "gtmContentBankItems", "gtmContentDrafts", "gtmConversions",
      "gtmCostLedger", "gtmDeliveryFailures", "gtmDistributionMotions",
      "gtmDraftedContent", "gtmEvidenceCards", "gtmFormatExperiments",
      "gtmHookCallbacks", "gtmHumanPlanReviews", "gtmLinkClicks", "gtmLinkWraps",
      "gtmMachineHealth", "gtmMemoryWrites", "gtmNicheLearnings", "gtmNichePulse",
      "gtmOauthStateTokens", "gtmPlatformBriefs", "gtmPlatformClaims",
      "gtmPlatformRefreshRuns", "gtmPostResults", "gtmRelationshipTargets",
      "gtmResearchJobs", "gtmResultSnapshots", "gtmSafetyStates",
      "gtmSkillImprovementProposals", "gtmTargetAccounts", "gtmTargetThreads",
      "gtmTelegramPairingTokens", "gtmToolCallLog", "gtmUgcReadinessReports",
      "gtmUserReportedSignals", "gtmWalkthroughUploads", "gtmWorkspaceMutations",
    ] as const;
    const counts: Record<string, number> = {};
    for (const table of TABLES) {
      const rows = await ctx.db.query(table).collect();
      for (const row of rows) await ctx.db.delete(row._id);
      if (rows.length > 0) counts[table] = rows.length;
    }
    return counts;
  },
});

export const seedGtmAgentAndApp = internalMutation({
  args: {
    clerkUserId: v.string(),
    productName: v.string(),
    productUrl: v.string(),
    founderWhy: v.optional(v.string()),
    stage: v.union(v.literal("idea"), v.literal("live-beta"), v.literal("paid"), v.literal("unknown")),
    weekGoal: v.union(v.literal("feedback"), v.literal("signups"), v.literal("demos"), v.literal("revenue"), v.literal("unknown")),
    budgetUsd: v.number(),
    // Optional per-agent override of the 24h hard spend kill ceiling (see
    // gtmMaya/spendKill.ts). Lets a watched test bound damage tighter than the
    // default $6/24h. Unset → default applies.
    spendKillCapUsd: v.optional(v.number()),
    channelPreference: v.optional(v.union(v.literal("whatsapp"), v.literal("imessage"), v.literal("web"), v.literal("telegram"))),
    // Verification/test deploys: force all-platform coverage in the workspace.
    verifyAllPlatforms: v.optional(v.boolean()),
    // Slideshow + conversion test fields — exercise the mobile path + the
    // closed-loop signup attribution end-to-end.
    appType: v.optional(v.union(v.literal("web"), v.literal("mobile"))),
    appStoreUrl: v.optional(v.string()),
    playStoreUrl: v.optional(v.string()),
    conversionKind: v.optional(v.string()),
    signupUrl: v.optional(v.string()),
    // Founder's "what's different" + existing social handles, so the deployed
    // agent's workspace bakes in real voice/channel grounding from boot.
    differentiator: v.optional(v.string()),
    existingTikTokUrl: v.optional(v.string()),
    existingInstagramUrl: v.optional(v.string()),
    existingXUrl: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    creatorId: Id<"creators">;
    agentId: Id<"gtmAgents">;
    appId: Id<"gtmApps">;
    researchJobId: Id<"gtmResearchJobs">;
  }> => {
    const now = Date.now();
    const channel = args.channelPreference ?? "telegram";

    const creatorId = await ctx.db.insert("creators", {
      clerkUserId: args.clerkUserId,
      email: TEST_EMAIL,
      channelPreference: channel,
      timezone: TEST_TIMEZONE,
      status: "onboarding",
      plan: "manager",
      accountType: "gtm-agent",
      compedByAdmin: true,
      createdAt: now,
    });

    const agentId = await ctx.db.insert("gtmAgents", {
      accountId: creatorId,
      onboardingStep: "researching",
      channelPreference: channel,
      timezone: TEST_TIMEZONE,
      verifyAllPlatforms: args.verifyAllPlatforms,
      spendKillCapUsd: args.spendKillCapUsd,
      createdAt: now,
      updatedAt: now,
    });

    const appId = await ctx.db.insert("gtmApps", {
      accountId: creatorId,
      name: args.productName,
      url: args.productUrl,
      founderWhy: args.founderWhy,
      stage: args.stage,
      weekGoal: args.weekGoal,
      canRecordScreen: true,
      canShowFace: false,
      canRecordVoice: false,
      canProvideScreenshots: true,
      canPostTikTokManually: true,
      canPostInstagramManually: true,
      excludedAudiences: [],
      appType: args.appType,
      appStoreUrl: args.appStoreUrl,
      playStoreUrl: args.playStoreUrl,
      conversionKind: args.conversionKind,
      signupUrl: args.signupUrl,
      differentiator: args.differentiator,
      existingTikTokUrl: args.existingTikTokUrl,
      existingInstagramUrl: args.existingInstagramUrl,
      existingXUrl: args.existingXUrl,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(agentId, { appId, updatedAt: now });

    const researchJobId = await ctx.db.insert("gtmResearchJobs", {
      accountId: creatorId,
      appId,
      status: "queued",
      phase: "app_inspection",
      budgetUsd: args.budgetUsd,
      spentUsd: 0,
      createdAt: now,
      updatedAt: now,
    });

    return { creatorId, agentId, appId, researchJobId };
  },
});

export const dumpLastResearchQueries = internalQuery({
  args: { platform: v.optional(v.string()) },
  handler: async (ctx, args): Promise<unknown> => {
    const all = await ctx.db.query("creators").collect();
    const testRows = all
      .filter((c) => c.clerkUserId.startsWith(TEST_CLERK_USER_ID_PREFIX))
      .sort((a, b) => b.createdAt - a.createdAt);
    if (testRows.length === 0) return { found: false };
    const creator = testRows[0];

    const jobs = await ctx.db
      .query("gtmResearchJobs")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .collect();
    const latestJob = jobs.sort((a, b) => b.createdAt - a.createdAt)[0];

    const ledger = await ctx.db
      .query("gtmCostLedger")
      .withIndex("by_research_job", (q) => q.eq("researchJobId", latestJob._id))
      .collect();

    const filtered = ledger.filter((row) => {
      if (!args.platform) return true;
      return row.operation.startsWith(`${args.platform}.`);
    });

    return filtered.map((r: any) => ({
      operation: r.operation,
      reason: r.reason,
      cacheStatus: r.cacheStatus,
      itemCount: r.metadata?.itemCount,
      error: r.metadata?.error,
    }));
  },
});

export const analyzeLatestSynth = internalQuery({
  args: { sampleSize: v.optional(v.number()) },
  handler: async (ctx, args): Promise<unknown> => {
    const N = args.sampleSize ?? 8;
    const all = await ctx.db.query("creators").collect();
    const testRows = all
      .filter((c) => c.clerkUserId.startsWith(TEST_CLERK_USER_ID_PREFIX))
      .sort((a, b) => b.createdAt - a.createdAt);
    if (testRows.length === 0) return { found: false };
    const creator = testRows[0];

    const jobs = await ctx.db
      .query("gtmResearchJobs")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .collect();
    const latestJob = jobs.sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!latestJob) return { found: true, jobs: 0 };

    const cards = await ctx.db
      .query("gtmEvidenceCards")
      .withIndex("by_research_job", (q) => q.eq("researchJobId", latestJob._id))
      .collect();

    const scores = await ctx.db
      .query("gtmChannelScores")
      .withIndex("by_research_job", (q) => q.eq("researchJobId", latestJob._id))
      .collect();

    const mutations = await ctx.db
      .query("gtmWorkspaceMutations")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .collect();

    // Per-source breakdown + a sample of high-pain-match cards
    const bySource: Record<string, number> = {};
    for (const c of cards) bySource[c.source] = (bySource[c.source] ?? 0) + 1;

    const renderCard = (c: any) => ({
      source: c.source,
      url: c.url,
      title: c.title,
      snippet: c.snippet.slice(0, 240),
      author: c.authorOrCommunity,
      painMatch: c.painMatch,
      buyerMatch: c.buyerMatch,
      channelFit: c.channelFit,
      recommendedUse: c.recommendedUse,
      promotionRisk: c.promotionRisk,
      claims: c.extractedClaims.slice(0, 3),
      engagement: c.engagement,
    });
    const topReddit = cards
      .filter((c) => c.source === "reddit")
      .sort((a, b) => b.painMatch + b.buyerMatch + b.channelFit - (a.painMatch + a.buyerMatch + a.channelFit))
      .slice(0, N)
      .map(renderCard);

    const topByPain = [...cards]
      .sort((a, b) => b.painMatch * 0.5 + b.buyerMatch * 0.5 - (a.painMatch * 0.5 + a.buyerMatch * 0.5))
      .slice(0, N)
      .map((c) => ({
        source: c.source,
        url: c.url,
        title: c.title,
        snippet: c.snippet.slice(0, 240),
        author: c.authorOrCommunity,
        painMatch: c.painMatch,
        buyerMatch: c.buyerMatch,
        channelFit: c.channelFit,
        recommendedUse: c.recommendedUse,
        promotionRisk: c.promotionRisk,
        claims: c.extractedClaims.slice(0, 3),
        engagement: c.engagement,
      }));

    return {
      researchJob: {
        _id: latestJob._id,
        status: latestJob.status,
        phase: latestJob.phase,
        spentUsd: latestJob.spentUsd,
        lastAgentNote: latestJob.lastAgentNote,
      },
      totalCards: cards.length,
      bySource,
      avgScores: cards.length
        ? {
            painMatch: cards.reduce((a, c) => a + c.painMatch, 0) / cards.length,
            buyerMatch: cards.reduce((a, c) => a + c.buyerMatch, 0) / cards.length,
            channelFit: cards.reduce((a, c) => a + c.channelFit, 0) / cards.length,
          }
        : null,
      channelScores: scores.map((s) => ({
        channel: s.channel,
        decision: s.decision,
        score: s.score,
        confidence: s.confidence,
        reasons: s.reasons,
        risks: s.risks,
        firstWeekTest: s.firstWeekTest,
        qualityGate: s.qualityGate,
      })),
      topByPain,
      topReddit,
      workspaceMutations: mutations.map((m: any) => ({
        triggeredBy: m.triggeredBy ?? m.trigger,
        targetPath: m.targetPath,
        diffSummary: m.diffSummary,
        deployed: m.deployed,
        createdAt: m.createdAt,
      })),
    };
  },
});

/**
 * Sprint 1.3 — direct Telegram delivery smoke. Fires a one-shot agent turn
 * against the most-recently-deployed synth Maya with `deliver: true` so
 * OpenClaw's native channels.telegram adapter handles delivery. If the
 * adapter is wired correctly the operator receives a Telegram message
 * within ~30s. If they don't, channel config is still broken (look at
 * Fly logs).
 */
export const pingLatestSynthOnTelegram = internalAction({
  args: { message: v.optional(v.string()) },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: boolean; status: number; body: unknown; error?: string }> => {
    const all = await ctx.runQuery(
      internal._admin.realWorldDeployGtm.inspectLatestSynthQuery,
      {}
    );
    const found = all as {
      found: boolean;
      agent?: {
        _id: string;
        openClawFlyAppId?: string;
        telegramChatId?: string;
        hookTokenSet?: boolean;
      };
    };
    if (!found.found || !found.agent?.openClawFlyAppId) {
      return { ok: false, status: 0, body: null, error: "no synth agent or not deployed" };
    }
    if (!found.agent.telegramChatId) {
      return { ok: false, status: 0, body: null, error: "no telegramChatId on synth agent" };
    }
    const agentRow = await ctx.runQuery(
      internal.onboarding.gtm.deployMayaGtm.getGtmAgentForDeploy,
      { agentId: found.agent._id as Id<"gtmAgents"> }
    );
    if (!agentRow?.agent.hookToken) {
      return { ok: false, status: 0, body: null, error: "agent has no hookToken" };
    }
    const baseUrl = `https://${found.agent.openClawFlyAppId}.fly.dev/hooks`;
    const message =
      args.message ??
      "Hi — this is a delivery smoke test from your Convex admin. If you see this on Telegram, the channels.telegram adapter is wired correctly.";
    const res = await fetch(`${baseUrl}/agent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${agentRow.agent.hookToken}`,
      },
      body: JSON.stringify({
        message,
        deliver: true,
        channel: "telegram",
        to: found.agent.telegramChatId,
        thinking: "low",
        timeoutSeconds: 60,
      }),
    });
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    return { ok: res.ok, status: res.status, body: parsed };
  },
});

export const inspectLatestSynth = internalAction({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const summary = await ctx.runQuery(
      internal._admin.realWorldDeployGtm.inspectLatestSynthQuery,
      {}
    );
    return summary;
  },
});

export const inspectLatestSynthQuery = internalQuery({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const all = await ctx.db.query("creators").collect();
    const testRows = all
      .filter((c) => c.clerkUserId.startsWith(TEST_CLERK_USER_ID_PREFIX))
      .sort((a, b) => b.createdAt - a.createdAt);
    if (testRows.length === 0) return { found: false };
    const creator = testRows[0];
    const agent = await ctx.db
      .query("gtmAgents")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .first();
    const app = agent?.appId ? await ctx.db.get(agent.appId) : null;
    const jobs = app
      ? await ctx.db.query("gtmResearchJobs").withIndex("by_app", (q) => q.eq("appId", app._id)).collect()
      : [];
    const mutations = agent
      ? await ctx.db
          .query("gtmWorkspaceMutations")
          .withIndex("by_agent", (q) => q.eq("agentId", agent._id))
          .collect()
      : [];

    // Sprint 2.15.2 — surface REAL Maya activity counts. Previously
    // mutationsCount=1 was the only signal and it was misleading:
    // gtmWorkspaceMutations tracks bundle-rebuild events, NOT
    // Maya's research output. Live 2026-05-25 showed
    // mutationsCount=1 while Maya had actually written 42 target
    // threads + 18 accounts + 24 drafts. Real activity counts make
    // her work visible without a separate audit call.
    const targetThreads = await ctx.db
      .query("gtmTargetThreads")
      .withIndex("by_account_and_platform", (q) =>
        q.eq("accountId", creator._id)
      )
      .collect();
    const targetAccounts = await ctx.db
      .query("gtmTargetAccounts")
      .withIndex("by_account_and_platform", (q) =>
        q.eq("accountId", creator._id)
      )
      .collect();
    const drafts = await ctx.db
      .query("gtmDraftedContent")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .collect();
    const calendar = await ctx.db
      .query("gtmCalendarEvents")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .collect();
    const threadsByPlatform: Record<string, number> = {};
    for (const t of targetThreads) {
      const k = t.platform ?? "unknown";
      threadsByPlatform[k] = (threadsByPlatform[k] ?? 0) + 1;
    }
    const calendarByKind: Record<string, number> = {};
    for (const e of calendar) {
      const k = e.kind ?? "unknown";
      calendarByKind[k] = (calendarByKind[k] ?? 0) + 1;
    }

    return {
      found: true,
      creator: { _id: creator._id, plan: creator.plan, accountType: creator.accountType },
      agent: agent && {
        _id: agent._id,
        appId: agent.appId,
        onboardingStep: agent.onboardingStep,
        openClawFlyAppId: agent.openClawFlyAppId,
        deployedAt: agent.deployedAt,
        telegramChatId: agent.telegramChatId,
        hookTokenSet: Boolean(agent.hookToken),
        deployTimeHelloAttemptedAt: agent.deployTimeHelloAttemptedAt,
        deployTimeHelloResult: agent.deployTimeHelloResult,
        deployTimeHelloMessageId: agent.deployTimeHelloMessageId,
      },
      app: app && {
        _id: app._id,
        name: app.name,
        url: app.url,
        stage: app.stage,
        weekGoal: app.weekGoal,
        founderWhy: app.founderWhy,
        keywordExpansion: app.keywordExpansion,
      },
      jobs: jobs.map((j) => ({
        _id: j._id,
        status: j.status,
        phase: j.phase,
        spentUsd: j.spentUsd,
        // Sprint 2.15.4 — LLM cost from OpenRouter usage.cost field
        // (separate from spentUsd which is scraping API costs).
        spentUsdLlm: j.spentUsdLlm,
        spentUsdLlmByStage: j.spentUsdLlmByStage,
        spentUsdTotal:
          (j.spentUsd ?? 0) + (j.spentUsdLlm ?? 0),
        cardsScoredCount: j.cardsScoredCount,
        cardsExpectedCount: j.cardsExpectedCount,
        commentsMinedCount: j.commentsMinedCount,
        commentsAttemptedCount: j.commentsAttemptedCount,
        lastAgentNote: j.lastAgentNote,
      })),
      // Sprint 2.15.2 — real activity (what Maya actually wrote).
      mayaActivity: {
        gtmTargetThreads: { count: targetThreads.length, byPlatform: threadsByPlatform },
        gtmTargetAccounts: { count: targetAccounts.length },
        gtmDraftedContent: { count: drafts.length },
        gtmCalendarEvents: { count: calendar.length, byKind: calendarByKind },
      },
      // Kept for backward compat with prior scripts; semantically just
      // a workspace-rebuild counter, not Maya's research output.
      mutationsCount: mutations.length,
      mutationsByTarget: mutations.reduce<Record<string, number>>((acc, m: any) => {
        const k = m.targetPath ?? "?";
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      }, {}),
    };
  },
});

/**
 * Sprint 2.12 — parallel-safe research-only path for N=2/N=3 cross-
 * product validation.
 *
 * The default `run` action wipes ALL test creators on the
 * `TEST_CLERK_USER_ID_PREFIX` prefix, so two parallel deploys clobber
 * each other. `runResearchOnly` takes a per-product prefix, never
 * wipes, never deploys, and just returns the research analysis.
 * Goal: validate channel-judge decisions across contrasting ICP
 * shapes without burning the running Maya.
 */
export const runResearchOnly = internalAction({
  args: {
    productName: v.string(),
    productUrl: v.string(),
    founderWhy: v.optional(v.string()),
    stage: v.optional(v.union(v.literal("idea"), v.literal("live-beta"), v.literal("paid"), v.literal("unknown"))),
    weekGoal: v.optional(v.union(v.literal("feedback"), v.literal("signups"), v.literal("demos"), v.literal("revenue"), v.literal("unknown"))),
    budgetUsd: v.optional(v.number()),
    /** Distinguishes this aux test from the default synth + from sibling aux tests. */
    prefixSlug: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    ok: boolean;
    creatorId: string;
    appId: string;
    researchJobId: string;
    research: unknown;
    prefixSlug: string;
  }> => {
    const clerkUserId = `test_gtm_aux_${args.prefixSlug}_${Date.now().toString(36)}`;
    const seed = await ctx.runMutation(
      internal._admin.realWorldDeployGtm.seedGtmAgentAndApp,
      {
        clerkUserId,
        productName: args.productName,
        productUrl: args.productUrl,
        founderWhy: args.founderWhy,
        stage: args.stage ?? "live-beta",
        weekGoal: args.weekGoal ?? "signups",
        budgetUsd: args.budgetUsd ?? 0.5,
      }
    );
    console.log(
      `[gtmAux/${args.prefixSlug}] seeded creatorId=${seed.creatorId} researchJobId=${seed.researchJobId}`
    );

    const research = await ctx.runAction(
      internal.gtmMaya.researchWorker.runBudgetedResearchJob,
      { researchJobId: seed.researchJobId }
    );
    console.log(`[gtmAux/${args.prefixSlug}] research complete`);

    return {
      ok: true,
      creatorId: String(seed.creatorId),
      appId: String(seed.appId),
      researchJobId: String(seed.researchJobId),
      research,
      prefixSlug: args.prefixSlug,
    };
  },
});

export const analyzeAuxSynth = internalQuery({
  args: { prefixSlug: v.string(), sampleSize: v.optional(v.number()) },
  handler: async (ctx, args): Promise<unknown> => {
    const N = args.sampleSize ?? 5;
    const prefix = `test_gtm_aux_${args.prefixSlug}_`;
    const all = await ctx.db.query("creators").collect();
    const rows = all
      .filter((c) => c.clerkUserId.startsWith(prefix))
      .sort((a, b) => b.createdAt - a.createdAt);
    if (rows.length === 0) return { found: false, prefix };
    const creator = rows[0];

    const jobs = await ctx.db
      .query("gtmResearchJobs")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .collect();
    const latest = jobs.sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!latest) return { found: true, jobs: 0 };

    const cards = await ctx.db
      .query("gtmEvidenceCards")
      .withIndex("by_research_job", (q) => q.eq("researchJobId", latest._id))
      .collect();
    const scores = await ctx.db
      .query("gtmChannelScores")
      .withIndex("by_research_job", (q) => q.eq("researchJobId", latest._id))
      .collect();

    const bySource: Record<string, number> = {};
    for (const c of cards) bySource[c.source] = (bySource[c.source] ?? 0) + 1;

    const renderCard = (c: any) => ({
      source: c.source,
      url: c.url,
      title: c.title,
      snippet: c.snippet.slice(0, 180),
      author: c.authorOrCommunity,
      engagement: c.engagement,
      painMatch: c.painMatch,
      buyerMatch: c.buyerMatch,
      channelFit: c.channelFit,
      painLanguageReason: c.painLanguageReason,
      commentInsights: c.commentInsights,
    });
    const topReddit = cards
      .filter((c) => c.source === "reddit")
      .sort((a, b) => b.painMatch + b.buyerMatch + b.channelFit - (a.painMatch + a.buyerMatch + a.channelFit))
      .slice(0, N)
      .map(renderCard);
    const topX = cards
      .filter((c) => c.source === "x")
      .sort((a, b) => b.painMatch + b.buyerMatch + b.channelFit - (a.painMatch + a.buyerMatch + a.channelFit))
      .slice(0, N)
      .map(renderCard);
    const topHN = cards
      .filter((c) => c.source === "google")
      .sort((a, b) => b.painMatch + b.buyerMatch + b.channelFit - (a.painMatch + a.buyerMatch + a.channelFit))
      .slice(0, N)
      .map(renderCard);
    const topTiktok = cards
      .filter((c) => c.source === "tiktok")
      .sort((a, b) => b.painMatch + b.buyerMatch + b.channelFit - (a.painMatch + a.buyerMatch + a.channelFit))
      .slice(0, N)
      .map(renderCard);

    // App + expansion — surface so we can debug skipped-scoring paths
    const app = await ctx.db
      .query("gtmApps")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .first();

    return {
      found: true,
      prefix,
      creator: { _id: creator._id, plan: creator.plan },
      app: app && {
        _id: app._id,
        name: app.name,
        url: app.url,
        keywordExpansion: app.keywordExpansion,
      },
      researchJob: {
        _id: latest._id,
        phase: latest.phase,
        status: latest.status,
        spentUsd: latest.spentUsd,
        cardsScoredCount: latest.cardsScoredCount,
        cardsExpectedCount: latest.cardsExpectedCount,
        commentsMinedCount: latest.commentsMinedCount,
        commentsAttemptedCount: latest.commentsAttemptedCount,
      },
      channelScoresCount: scores.length,
      channelScores: scores.map((s: any) => ({
        channel: s.channel,
        score: s.score,
        decision: s.decision,
        confidence: s.confidence,
        reasons: s.reasons,
        firstWeekTest: s.firstWeekTest,
        summary: s.summary,
        workingFormats: s.workingFormatsJson
          ? JSON.parse(s.workingFormatsJson)
          : undefined,
      })),
      totalCards: cards.length,
      bySource,
      topReddit,
      topX,
      topHN,
      topTiktok,
    };
  },
});

/** Sprint 2.13a.2 — debug helper. Direct call to scoreAllCardsForProduct
 * with hardcoded inputs so we can verify the scorer works in the Convex
 * runtime independent of the orchestrator. */
export const debugScoreCards = internalAction({
  args: {},
  handler: async (_ctx): Promise<unknown> => {
    const { scoreAllCardsForProduct } = await import("../gtmMaya/judgeCardsBatch");
    const cards = [
      {
        id: "test1",
        source: "reddit",
        title: "Best Mac GUI for ollama?",
        snippet: "I'm tired of CLI for local LLMs on my M3 — what's the best free desktop wrapper for ollama these days?",
        engagement: { upvotes: 45, comments: 12 },
      },
      {
        id: "test2",
        source: "reddit",
        title: "From 2019 Dell to MacBook Pro M5",
        snippet: "Just switched, here's my unboxing experience",
        engagement: { upvotes: 803, comments: 50 },
      },
    ];
    const product = {
      productName: "ModelHub",
      productUrl: "https://studio.consciousengines.com/model-hub",
      founderWhy: "local LLM workflows on Mac feel disjointed",
      icpPainPhrases: ["I am tired of using the terminal for local llms"],
      productCategoryKeywords: ["local llm desktop app mac"],
    };
    try {
      const result = await scoreAllCardsForProduct(cards, product);
      return { ok: true, result };
    } catch (err) {
      return {
        ok: false,
        error: (err as Error).message,
        stack: (err as Error).stack?.split("\n").slice(0, 5),
      };
    }
  },
});

/** Sprint 2.14a debug. Direct call to mineTopRedditCards on a real
 * card from a prior research job to isolate why mining isn't firing
 * end-to-end. */
export const debugMineRedditComments = internalAction({
  args: { prefixSlug: v.string() },
  handler: async (ctx, args): Promise<unknown> => {
    const { mineTopRedditCards } = await import("../gtmMaya/mineCommentTrees");
    const { ScrapeCreatorsClient } = await import(
      "../integrations/scrapeCreators/client"
    );
    // Pull the most recent cards from this aux run
    const analysis = (await ctx.runQuery(
      internal._admin.realWorldDeployGtm.analyzeAuxSynth,
      { prefixSlug: args.prefixSlug, sampleSize: 3 }
    )) as {
      app?: { name?: string; url?: string; keywordExpansion?: { icpPainPhrases?: string[]; productCategoryKeywords?: string[] } };
      topReddit?: Array<{ url: string; title?: string; snippet?: string; painMatch?: number; source?: string; _id?: string }>;
    };
    if (!analysis.app || !analysis.topReddit) {
      return { ok: false, error: "no app or topReddit in analysis" };
    }
    const cardsForMining = analysis.topReddit.map((c, i) => ({
      id: `dbg${i}`,
      url: c.url,
      title: c.title,
      snippet: c.snippet ?? "",
      painMatch: c.painMatch ?? 0,
      source: c.source ?? "reddit",
    }));
    const scrapeKey =
      process.env.SCRAPE_CREATORS_API_KEY ?? process.env.SCRAPECREATORS_API_KEY;
    if (!scrapeKey) return { ok: false, error: "no scrape key" };
    const scrapeClient = new ScrapeCreatorsClient({ apiKey: scrapeKey });
    const product = {
      productName: analysis.app.name ?? "Untitled",
      productUrl: analysis.app.url ?? "",
      icpPainPhrases: analysis.app.keywordExpansion?.icpPainPhrases ?? [],
      productCategoryKeywords:
        analysis.app.keywordExpansion?.productCategoryKeywords ?? [],
    };
    try {
      const result = await mineTopRedditCards(cardsForMining, product, {
        scrapeClient,
      });
      return { ok: true, attempted: result.attempted, succeeded: result.succeeded, results: result.results };
    } catch (err) {
      return {
        ok: false,
        error: (err as Error).message,
        stack: (err as Error).stack?.split("\n").slice(0, 6),
      };
    }
  },
});

/** Sprint 2.15 grounded-or-silent audit. Counts actual rows Maya
 * may have written (target threads, drafts, calendar events) for
 * the latest synth creator. Used to verify "I queued 23 threads"
 * type claims in her boot hello. */
export const auditMayaClaims = internalQuery({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const all = await ctx.db.query("creators").collect();
    const testRows = all
      .filter((c) => c.clerkUserId.startsWith(TEST_CLERK_USER_ID_PREFIX))
      .sort((a, b) => b.createdAt - a.createdAt);
    if (testRows.length === 0) return { found: false };
    const creator = testRows[0];

    const targetThreads = await ctx.db
      .query("gtmTargetThreads")
      .withIndex("by_account_and_platform", (q) => q.eq("accountId", creator._id))
      .collect();
    const drafts = await ctx.db
      .query("gtmDraftedContent")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .collect();
    const calendar = await ctx.db
      .query("gtmCalendarEvents")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .collect();
    const targetAccounts = await ctx.db
      .query("gtmTargetAccounts")
      .withIndex("by_account_and_platform", (q) => q.eq("accountId", creator._id))
      .collect();

    const threadsByPlatform: Record<string, number> = {};
    for (const t of targetThreads) {
      const k = t.platform ?? "unknown";
      threadsByPlatform[k] = (threadsByPlatform[k] ?? 0) + 1;
    }
    const calendarByKind: Record<string, number> = {};
    for (const e of calendar) {
      const k = e.kind ?? "unknown";
      calendarByKind[k] = (calendarByKind[k] ?? 0) + 1;
    }

    return {
      found: true,
      creator: { _id: creator._id, plan: creator.plan },
      gtmTargetThreads: { count: targetThreads.length, byPlatform: threadsByPlatform },
      gtmTargetAccounts: { count: targetAccounts.length },
      gtmDraftedContent: { count: drafts.length },
      gtmCalendarEvents: { count: calendar.length, byKind: calendarByKind },
    };
  },
});

/**
 * Sprint 2.15.7 — full grading view. Pulls everything needed to
 * judge Maya's output end-to-end:
 *   - channel decisions (LLM judge reasoning)
 *   - top reddit picks with commentInsights (LLM-scored)
 *   - top X picks with painLanguageReason
 *   - top HN picks
 *   - drafted content (the actual replies Maya wrote)
 *   - calendar events Maya populated (or didn't)
 *   - target accounts she's tracking
 *   - cost breakdown
 *   - pipeline health
 *
 * Call: `npx convex run _admin/realWorldDeployGtm:gradeLatestSynth '{}'`
 */
export const gradeLatestSynth = internalQuery({
  args: { sampleSize: v.optional(v.number()) },
  handler: async (ctx, args): Promise<unknown> => {
    const N = args.sampleSize ?? 8;
    const all = await ctx.db.query("creators").collect();
    const rows = all
      .filter((c) => c.clerkUserId.startsWith(TEST_CLERK_USER_ID_PREFIX))
      .sort((a, b) => b.createdAt - a.createdAt);
    if (rows.length === 0) return { found: false };
    const creator = rows[0];

    const agent = await ctx.db
      .query("gtmAgents")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .first();
    const app = agent?.appId ? await ctx.db.get(agent.appId) : null;
    const jobs = app
      ? await ctx.db.query("gtmResearchJobs").withIndex("by_app", (q) => q.eq("appId", app._id)).collect()
      : [];
    const latestJob = jobs.sort((a, b) => b.createdAt - a.createdAt)[0];

    const channelScores = latestJob
      ? await ctx.db
          .query("gtmChannelScores")
          .withIndex("by_research_job", (q) => q.eq("researchJobId", latestJob._id))
          .collect()
      : [];

    const targetThreads = await ctx.db
      .query("gtmTargetThreads")
      .withIndex("by_account_and_platform", (q) => q.eq("accountId", creator._id))
      .collect();
    const targetAccounts = await ctx.db
      .query("gtmTargetAccounts")
      .withIndex("by_account_and_platform", (q) => q.eq("accountId", creator._id))
      .collect();
    const drafts = await ctx.db
      .query("gtmDraftedContent")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .collect();
    const calendar = await ctx.db
      .query("gtmCalendarEvents")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .collect();
    const evidenceCards = latestJob
      ? await ctx.db
          .query("gtmEvidenceCards")
          .withIndex("by_research_job", (q) => q.eq("researchJobId", latestJob._id))
          .collect()
      : [];

    // Top reddit/X cards by combined LLM scores
    const sortByLlm = (a: any, b: any) =>
      (b.painMatch + b.buyerMatch + b.channelFit) -
      (a.painMatch + a.buyerMatch + a.channelFit);
    const topReddit = evidenceCards
      .filter((c) => c.source === "reddit")
      .sort(sortByLlm)
      .slice(0, N)
      .map((c) => ({
        url: c.url,
        title: c.title,
        snippet: c.snippet.slice(0, 200),
        painMatch: c.painMatch,
        buyerMatch: c.buyerMatch,
        painLanguageReason: c.painLanguageReason,
        commentInsights: c.commentInsights,
      }));
    const topX = evidenceCards
      .filter((c) => c.source === "x")
      .sort(sortByLlm)
      .slice(0, N)
      .map((c) => ({
        author: c.authorOrCommunity,
        url: c.url,
        snippet: c.snippet.slice(0, 200),
        painLanguageReason: c.painLanguageReason,
      }));

    const calendarByDay: Record<string, number> = {};
    for (const e of calendar) {
      const day = new Date(e.startsAtMs ?? e._creationTime).toISOString().slice(0, 10);
      calendarByDay[day] = (calendarByDay[day] ?? 0) + 1;
    }

    return {
      product: {
        name: app?.name,
        url: app?.url,
        founderWhy: app?.founderWhy,
      },
      cost: latestJob && {
        scraping: latestJob.spentUsd,
        llm: latestJob.spentUsdLlm,
        total: (latestJob.spentUsd ?? 0) + (latestJob.spentUsdLlm ?? 0),
        breakdown: latestJob.spentUsdLlmByStage,
      },
      pipelineHealth: latestJob && {
        cardsScored: `${latestJob.cardsScoredCount ?? 0}/${latestJob.cardsExpectedCount ?? 0}`,
        commentsMined: `${latestJob.commentsMinedCount ?? 0}/${latestJob.commentsAttemptedCount ?? 0}`,
        subagents: `${latestJob.subagentsCompleted ?? 0}/${latestJob.subagentsExpected ?? 0}`,
        phase2Triggered: latestJob.phase2TriggeredAt
          ? `yes (${latestJob.phase2TriggerSource})`
          : "no",
      },
      channelDecisions: channelScores.map((c: any) => ({
        channel: c.channel,
        score: c.score,
        decision: c.decision,
        confidence: c.confidence,
        reasons: c.reasons,
        firstWeekTest: c.firstWeekTest,
      })),
      mayaActivity: {
        targetThreads: targetThreads.length,
        targetAccounts: targetAccounts.length,
        drafts: drafts.length,
        calendarEvents: calendar.length,
        calendarByDay,
      },
      topReddit,
      topX,
      sampleDrafts: drafts.slice(0, 5).map((d: any) => ({
        platform: d.platform,
        text: (d.text ?? "").slice(0, 300),
        approvalState: d.approvalState,
        voiceMatchScore: d.voiceMatchScore,
      })),
      sampleCalendar: calendar.slice(0, 10).map((e: any) => ({
        kind: e.kind,
        startsAtMs: e.startsAtMs,
        startsAtIso: e.startsAtMs ? new Date(e.startsAtMs).toISOString() : null,
        title: e.title,
        description: (e.description ?? "").slice(0, 200),
      })),
    };
  },
});

export const patchTelegramChatId = internalMutation({
  args: { agentId: v.id("gtmAgents"), telegramChatId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    await ctx.db.patch(args.agentId, {
      telegramChatId: args.telegramChatId,
      telegramPairedAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

/**
 * 2026-07-07 — flip the per-agent discovery_pulse override for a cost-soak.
 * Takes effect on the agent's NEXT redeploy (jobs.json renders at deploy):
 *   npx convex run _admin/realWorldDeployGtm:setPulseOverride '{"agentId":"...","enabled":true}'
 * then redeploy the agent so the workspace re-renders with the pulse cron.
 */
export const setPulseOverride = internalMutation({
  args: { agentId: v.id("gtmAgents"), enabled: v.boolean() },
  handler: async (ctx, args): Promise<void> => {
    await ctx.db.patch(args.agentId, {
      pulseEnabledOverride: args.enabled,
      updatedAt: Date.now(),
    });
  },
});

/** 2026-07-07 — test-only: attach a Stripe customer to a seeded creator so the
 * deletion cascade's Convex-side Stripe delete can be verified end-to-end. */
export const patchCreatorStripeCustomerId = internalMutation({
  args: { creatorId: v.id("creators"), stripeCustomerId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    await ctx.db.patch(args.creatorId, {
      stripeCustomerId: args.stripeCustomerId,
    });
  },
});

/** 2026-07-07 — test-only: point a seeded agent at a Fly app so the account-
 * deletion cascade's Convex-side Fly destroy can be verified end-to-end. */
export const patchOpenClawFlyAppId = internalMutation({
  args: { agentId: v.id("gtmAgents"), openClawFlyAppId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    await ctx.db.patch(args.agentId, {
      openClawFlyAppId: args.openClawFlyAppId,
      updatedAt: Date.now(),
    });
  },
});

/* -------------------------------------------------------------------------- */
/* Real-signup demo helpers (Stripe-bypass comp + live peek + repoint).        */
/*                                                                            */
/* These drive a real prod signup through a demo without Stripe: comp the     */
/* agent to active, peek its live state, and (for synthetic runs) repoint the  */
/* latest test creator onto the operator's real email so dashboard +          */
/* comp-by-email resolve. Restored 2026-06-15 after a `git reset --hard`       */
/* wiped them from git while they stayed deployed to prod.                     */
/* -------------------------------------------------------------------------- */

/**
 * Comp the REAL (non-synthetic) agent owned by `email` to an active GTM plan,
 * bypassing Stripe. For demoing a real prod signup before/without billing.
 *   npx convex run _admin/realWorldDeployGtm:compRealAgentByEmail \
 *     '{"email":"founder@example.com"}'   # tier defaults to starter
 */
export const compRealAgentByEmail = internalMutation({
  args: {
    email: v.string(),
    tier: v.optional(
      v.union(
        v.literal("starter"),
        v.literal("growth"),
        v.literal("studio")
      )
    ),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: boolean; agentId?: string; reason?: string }> => {
    const creator = await ctx.db
      .query("creators")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .order("desc")
      .first();
    if (!creator) return { ok: false, reason: `no creator for email ${args.email}` };
    const agent = await ctx.db
      .query("gtmAgents")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .first();
    if (!agent) return { ok: false, reason: "no gtmAgent for creator" };
    await ctx.db.patch(agent._id, {
      gtmPlanJson: buildGtmPlanJson({
        status: "active" as GtmPlanStatus,
        tier: (args.tier as GtmPlan | undefined) ?? "starter",
        periodStartMs: Date.now(),
      }),
      updatedAt: Date.now(),
    });
    return { ok: true, agentId: agent._id };
  },
});

/**
 * Peek the latest REAL (non-synthetic) agent's live state: deploy + plan +
 * telegram pairing + recent activity + recent Maya messages. The triage view
 * for "what is the operator's real signup actually doing right now."
 *   npx convex run _admin/realWorldDeployGtm:peekLatestRealAgent
 */
export const peekLatestRealAgent = internalQuery({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const all = await ctx.db.query("creators").collect();
    const reals = all
      .filter((c) => !c.clerkUserId.startsWith(TEST_CLERK_USER_ID_PREFIX))
      .sort((a, b) => b.createdAt - a.createdAt);
    if (reals.length === 0) return { found: false };
    const creator = reals[0];
    const agent = await ctx.db
      .query("gtmAgents")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .first();
    if (!agent) {
      return { found: true, creatorEmail: creator.email, agent: null };
    }
    const app = agent.appId ? await ctx.db.get(agent.appId) : null;
    const [activity, messages] = await Promise.all([
      ctx.db
        .query("gtmAgentActivity")
        .withIndex("by_account_and_created", (q) => q.eq("accountId", creator._id))
        .order("desc")
        .take(10),
      ctx.db
        .query("mayaMessages")
        .withIndex("by_account_and_ts", (q) => q.eq("accountId", creator._id))
        .order("desc")
        .take(10),
    ]);
    let plan: unknown = null;
    if (agent.gtmPlanJson) {
      try {
        plan = JSON.parse(agent.gtmPlanJson);
      } catch {
        plan = agent.gtmPlanJson;
      }
    }
    const iso = (ms?: number) => (ms ? new Date(ms).toISOString() : null);
    return {
      found: true,
      creatorEmail: creator.email,
      clerkUserId: creator.clerkUserId,
      deploy: {
        flyAppId: agent.openClawFlyAppId ?? null,
        deployedAt: iso(agent.deployedAt),
        foundationCompletedAt: iso(agent.foundationCompletedAt),
        strategyDeliveredAt: iso(agent.strategyDeliveredAt),
      },
      plan,
      telegram: {
        chatId: agent.telegramChatId ?? null,
        pairedAt: iso(agent.telegramPairedAt),
      },
      product: {
        name: (app as { name?: string } | null)?.name ?? null,
        url: (app as { url?: string } | null)?.url ?? null,
      },
      recentActivity: activity.map((a) => ({
        kind: a.kind,
        summary: a.summary,
        at: iso(a.createdAt),
      })),
      recentMessages: messages.map((m) => ({
        role: m.role,
        channel: m.channel,
        body: m.body.slice(0, 200),
        at: iso(m.ts),
      })),
    };
  },
});

/**
 * Repoint the latest synthetic test creator onto a real `clerkUserId` + email,
 * so a real web sign-in (or dashboard lookup) maps onto the already-deployed
 * test agent instead of spinning up a fresh one.
 *   npx convex run _admin/realWorldDeployGtm:repointLatestTestCreator \
 *     '{"clerkUserId":"user_abc","email":"founder@example.com"}'
 */
export const repointLatestTestCreator = internalMutation({
  args: { clerkUserId: v.string(), email: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: boolean; creatorId?: string; reason?: string }> => {
    const all = await ctx.db.query("creators").collect();
    const tests = all
      .filter((c) => c.clerkUserId.startsWith(TEST_CLERK_USER_ID_PREFIX))
      .sort((a, b) => b.createdAt - a.createdAt);
    if (tests.length === 0) return { ok: false, reason: "no test creator" };
    await ctx.db.patch(tests[0]._id, {
      clerkUserId: args.clerkUserId,
      email: args.email,
    });
    return { ok: true, creatorId: tests[0]._id };
  },
});

/** AUDIT: list EVERY Fly app in the org + every machine's state, with NO name
 *  filter — so a burning machine under any name (clawlaunch-*, maya-*, or
 *  anything else) is visible. A machine in state "started" is consuming. */
export const auditFlyMachines = internalAction({
  args: {},
  handler: async (
    ctx
  ): Promise<{
    runningCount: number;
    running: Array<{ app: string; machine: string; state: string }>;
    apps: Array<{ app: string; machines: Array<{ name: string; state: string }> }>;
  }> => {
    const { FlyClient } = await import("../lib/flyClient");
    const fly = new FlyClient();
    const apps = await fly.listApps({ first: 500 });
    const out: Array<{ app: string; machines: Array<{ name: string; state: string }> }> = [];
    const running: Array<{ app: string; machine: string; state: string }> = [];
    for (const a of apps) {
      try {
        const machines = await fly.listMachines(a.name);
        const ms = machines.map((m) => ({ name: m.name, state: m.state }));
        out.push({ app: a.name, machines: ms });
        for (const m of ms) {
          if (m.state === "started" || m.state === "starting" || m.state === "replacing") {
            running.push({ app: a.name, machine: m.name, state: m.state });
          }
        }
      } catch (e) {
        out.push({ app: a.name, machines: [{ name: "LIST_ERROR", state: String(e).slice(0, 80) }] });
      }
    }
    return { runningCount: running.length, running, apps: out };
  },
});

/** Read-only: look up a Clerk user id by email (no create, no modify). Used to
 *  bind a test agent to the operator's REAL Google account after they sign in,
 *  without touching their account. */
export const lookupClerkUser = internalAction({
  args: { email: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{ found: boolean; userId?: string; reason?: string }> => {
    const key = process.env.CLERK_SECRET_KEY;
    if (!key) return { found: false, reason: "no CLERK_SECRET_KEY" };
    const res = await fetch(
      `https://api.clerk.com/v1/users?email_address[]=${encodeURIComponent(args.email)}`,
      { headers: { Authorization: `Bearer ${key}` } }
    );
    if (!res.ok) return { found: false, reason: `lookup ${res.status}` };
    const arr = (await res.json()) as Array<{ id: string }>;
    if (Array.isArray(arr) && arr.length > 0) {
      return { found: true, userId: arr[0].id };
    }
    return { found: false };
  },
});

/** Deterministic bind: point clerkUserId at a SPECIFIC agent's creator, and
 *  orphan every other creator that currently has that clerkUserId (repoint to a
 *  dead id). No "latest"/"live-app" guessing — ends the multi-bind mess. */
export const bindSpecificAgentToClerkUser = internalMutation({
  args: {
    agentId: v.id("gtmAgents"),
    clerkUserId: v.string(),
    email: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: boolean; creatorId?: string; orphaned: number; reason?: string }> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return { ok: false, orphaned: 0, reason: "agent not found" };
    const targetCreatorId = agent.accountId;
    // Orphan every OTHER creator currently on this clerkUserId.
    const existing = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", args.clerkUserId))
      .collect();
    let orphaned = 0;
    for (const c of existing) {
      if (c._id === targetCreatorId) continue;
      await ctx.db.patch(c._id, { clerkUserId: `dead_${c._id}` });
      orphaned += 1;
    }
    await ctx.db.patch(targetCreatorId, {
      clerkUserId: args.clerkUserId,
      email: args.email,
    });
    return { ok: true, creatorId: targetCreatorId, orphaned };
  },
});

/** Collapse multiple creators bound to one clerkUserId down to ONE — keeps the
 *  creator whose agent has a live Fly app (else the newest), and repoints the
 *  rest to dead ids so the dashboard's .first() resolves to the live agent.
 *  Fixes the multi-bind mess from repeated test deploys. */
export const dedupeCreatorsForClerkUser = internalMutation({
  args: { clerkUserId: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{ kept: string | null; repointed: number }> => {
    const creators = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", args.clerkUserId))
      .collect();
    if (creators.length <= 1) {
      return { kept: creators[0]?._id ?? null, repointed: 0 };
    }
    let keep: (typeof creators)[number] | null = null;
    for (const c of creators) {
      const agent = await ctx.db
        .query("gtmAgents")
        .withIndex("by_account", (q) => q.eq("accountId", c._id))
        .first();
      if (agent?.openClawFlyAppId) {
        keep = c;
        break;
      }
    }
    if (!keep) {
      keep = [...creators].sort((a, b) => b.createdAt - a.createdAt)[0];
    }
    let repointed = 0;
    for (const c of creators) {
      if (c._id === keep._id) continue;
      await ctx.db.patch(c._id, { clerkUserId: `dead_${c._id}` });
      repointed += 1;
    }
    return { kept: keep._id, repointed };
  },
});

/**
 * Provision an email+password Clerk login for the staging test agent, so the
 * operator can sign in with credentials instead of Google + console-fishing for
 * their user id. Creates (or updates the password of) a Clerk user via the
 * Backend API, then optionally binds the latest test creator to it.
 * NOTE: only lets them log in if the staging Clerk instance has PASSWORD sign-in
 * enabled (vs social-only). Returns the userId either way.
 *   npx convex run _admin/realWorldDeployGtm:provisionClerkLogin \
 *     '{"email":"founder@hey-maya.ai","password":"...","bind":true}'
 */
export const provisionClerkLogin = internalAction({
  args: {
    email: v.string(),
    password: v.string(),
    bind: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    ok: boolean;
    userId?: string;
    created?: boolean;
    bound?: boolean;
    reason?: string;
  }> => {
    const key = process.env.CLERK_SECRET_KEY;
    if (!key) return { ok: false, reason: "no CLERK_SECRET_KEY in env" };
    const base = "https://api.clerk.com/v1";
    const authJson = {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    };
    let userId: string | undefined;
    let created = false;
    // Find an existing user with this email.
    const found = await fetch(
      `${base}/users?email_address[]=${encodeURIComponent(args.email)}`,
      { headers: { Authorization: `Bearer ${key}` } }
    );
    if (found.ok) {
      const arr = (await found.json()) as Array<{ id: string }>;
      if (Array.isArray(arr) && arr.length > 0) userId = arr[0].id;
    }
    if (userId) {
      const patch = await fetch(`${base}/users/${userId}`, {
        method: "PATCH",
        headers: authJson,
        body: JSON.stringify({ password: args.password, skip_password_checks: true }),
      });
      if (!patch.ok) {
        return {
          ok: false,
          userId,
          reason: `password update failed: ${patch.status} ${await patch.text()}`,
        };
      }
    } else {
      const create = await fetch(`${base}/users`, {
        method: "POST",
        headers: authJson,
        body: JSON.stringify({
          email_address: [args.email],
          password: args.password,
          skip_password_checks: true,
        }),
      });
      if (!create.ok) {
        return {
          ok: false,
          reason: `create failed: ${create.status} ${await create.text()}`,
        };
      }
      userId = ((await create.json()) as { id: string }).id;
      created = true;
    }
    let bound = false;
    if (args.bind && userId) {
      const r = await ctx.runMutation(
        internal._admin.realWorldDeployGtm.repointLatestTestCreator,
        { clerkUserId: userId, email: args.email }
      );
      bound = r.ok;
    }
    return { ok: true, userId, created, bound };
  },
});

/**
 * Bind the MOST-RECENT creator (regardless of clerk-id prefix) to a real
 * Clerk user + email. Unlike repointLatestTestCreator, this works even after
 * the creator has already been repointed once (no test-prefix requirement) —
 * so a demo agent can be re-bound to a different login without redeploying.
 *   npx convex run _admin/realWorldDeployGtm:bindLatestAgentToClerkUser \
 *     '{"clerkUserId":"user_...","email":"founder@example.com"}'
 */
export const bindLatestAgentToClerkUser = internalMutation({
  args: { clerkUserId: v.string(), email: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: boolean; creatorId?: string; reason?: string }> => {
    const all = await ctx.db.query("creators").collect();
    const latest = all.sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!latest) return { ok: false, reason: "no creator" };
    await ctx.db.patch(latest._id, {
      clerkUserId: args.clerkUserId,
      email: args.email,
    });
    return { ok: true, creatorId: latest._id };
  },
});

/**
 * Bind the deployed gtm-agent creator to a real login AND delete the stray
 * default creator that the Clerk `user.created` webhook auto-spawns
 * (accountType 'service-business' during creator-product suppression) — which
 * otherwise collides on the same clerkUserId and routes the founder to the
 * wrong product. The clean one-shot for "bind this demo agent to my login".
 *   npx convex run _admin/realWorldDeployGtm:bindGtmAgentToClerkUser \
 *     '{"clerkUserId":"user_...","email":"me@example.com"}'
 */
export const bindGtmAgentToClerkUser = internalMutation({
  args: { clerkUserId: v.string(), email: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{
    ok: boolean;
    creatorId?: string;
    removedStrays?: number;
    reason?: string;
  }> => {
    const all = await ctx.db.query("creators").collect();
    // Drop any NON-gtm creator squatting on this clerkUserId (the webhook spawn).
    let removedStrays = 0;
    for (const c of all) {
      if (c.clerkUserId === args.clerkUserId && c.accountType !== "gtm-agent") {
        await ctx.db.delete(c._id);
        removedStrays += 1;
      }
    }
    const gtm = all
      .filter((c) => c.accountType === "gtm-agent")
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!gtm) return { ok: false, reason: "no gtm-agent creator", removedStrays };
    await ctx.db.patch(gtm._id, {
      clerkUserId: args.clerkUserId,
      email: args.email,
    });
    return { ok: true, creatorId: gtm._id, removedStrays };
  },
});

/**
 * Convenience wrapper: attach the latest synthetic test creator to a real
 * email by deriving a stable non-test clerkUserId, then repointing. Lets a
 * demo bind the just-deployed test agent to the operator's email in one call.
 *   npx convex run _admin/realWorldDeployGtm:attachLatestAgentToEmail \
 *     '{"email":"founder@example.com"}'
 */
export const attachLatestAgentToEmail = internalAction({
  args: { email: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: boolean; creatorId?: string; reason?: string }> => {
    const clerkUserId = `attached_${args.email.replace(/[^a-zA-Z0-9]/g, "_")}`;
    return await ctx.runMutation(
      internal._admin.realWorldDeployGtm.repointLatestTestCreator,
      { clerkUserId, email: args.email }
    );
  },
});

/** §6 diagnostic — dump the latest test agent's outbound messages with the
 *  model + messageClass + turnId that produced each, so we can see WHY a
 *  synthesis went out N times and WHICH model/session sent each. */
export const peekRecentMessages = internalQuery({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const all = await ctx.db.query("creators").collect();
    const tests = all
      .filter((c) => c.clerkUserId.startsWith(TEST_CLERK_USER_ID_PREFIX))
      .sort((a, b) => b.createdAt - a.createdAt);
    if (tests.length === 0) return { found: false };
    const creator = tests[0];
    const msgs = await ctx.db
      .query("mayaMessages")
      .withIndex("by_account_and_ts", (q) => q.eq("accountId", creator._id))
      .order("asc")
      .collect();
    return {
      total: msgs.length,
      mayaOutbound: msgs.filter((m) => m.role === "maya").length,
      messages: msgs.map((m) => ({
        at: new Date(m.ts).toLocaleTimeString("en-US", {
          timeZone: "America/New_York",
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
        }),
        role: m.role,
        messageClass: m.messageClass ?? null,
        model: m.model ?? null,
        turnId: m.turnId,
        criticPassed: m.criticPassed ?? null,
        head: m.body.slice(0, 90),
      })),
    };
  },
});

export const run = internalAction({
  args: {
    productName: v.string(),
    productUrl: v.string(),
    founderWhy: v.optional(v.string()),
    stage: v.optional(v.union(v.literal("idea"), v.literal("live-beta"), v.literal("paid"), v.literal("unknown"))),
    weekGoal: v.optional(v.union(v.literal("feedback"), v.literal("signups"), v.literal("demos"), v.literal("revenue"), v.literal("unknown"))),
    budgetUsd: v.optional(v.number()),
    spendKillCapUsd: v.optional(v.number()),
    deployFly: v.optional(v.boolean()),
    telegramChatId: v.optional(v.string()),
    skipResearch: v.optional(v.boolean()),
    // Set true for a coverage test: Maya exercises EVERY platform end-to-end.
    verifyAllPlatforms: v.optional(v.boolean()),
    // Slideshow + conversion test fields (mobile path + signup attribution).
    appType: v.optional(v.union(v.literal("web"), v.literal("mobile"))),
    appStoreUrl: v.optional(v.string()),
    playStoreUrl: v.optional(v.string()),
    conversionKind: v.optional(v.string()),
    signupUrl: v.optional(v.string()),
    // Founder's differentiator + existing social handles → baked into the
    // workspace so the agent grounds in real voice/channels from boot.
    differentiator: v.optional(v.string()),
    existingTikTokUrl: v.optional(v.string()),
    existingInstagramUrl: v.optional(v.string()),
    existingXUrl: v.optional(v.string()),
    // Set true to NOT wipe existing test creators first — lets several test
    // agents (e.g. one per pricing tier) run side by side. Each run still gets a
    // unique clerkUserId, so no collision.
    skipWipe: v.optional(v.boolean()),
    // Optional pricing tier to comp this test agent to (starter/growth/studio).
    tier: v.optional(
      v.union(v.literal("starter"), v.literal("growth"), v.literal("studio"))
    ),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    ok: boolean;
    creatorId: string;
    agentId: string;
    appId: string;
    researchJobId: string;
    deploy: unknown;
    research: unknown;
  }> => {
    if (!args.skipWipe) {
      const wipe = await ctx.runMutation(
        internal._admin.realWorldDeployGtm.wipeExistingGtmTestCreators,
        {}
      );
      console.log(`[gtmSynth] wiped: ${JSON.stringify(wipe)}`);
    } else {
      console.log(`[gtmSynth] skipWipe — leaving existing test creators in place`);
    }

    const clerkUserId = `${TEST_CLERK_USER_ID_PREFIX}${Date.now().toString(36)}`;
    const seed = await ctx.runMutation(
      internal._admin.realWorldDeployGtm.seedGtmAgentAndApp,
      {
        clerkUserId,
        productName: args.productName,
        productUrl: args.productUrl,
        founderWhy: args.founderWhy,
        stage: args.stage ?? "live-beta",
        weekGoal: args.weekGoal ?? "signups",
        budgetUsd: args.budgetUsd ?? 0.5,
        spendKillCapUsd: args.spendKillCapUsd,
        verifyAllPlatforms: args.verifyAllPlatforms,
        appType: args.appType,
        appStoreUrl: args.appStoreUrl,
        playStoreUrl: args.playStoreUrl,
        conversionKind: args.conversionKind,
        signupUrl: args.signupUrl,
        differentiator: args.differentiator,
        existingTikTokUrl: args.existingTikTokUrl,
        existingInstagramUrl: args.existingInstagramUrl,
        existingXUrl: args.existingXUrl,
      }
    );
    console.log(
      `[gtmSynth] seeded creatorId=${seed.creatorId} agentId=${seed.agentId} appId=${seed.appId} researchJobId=${seed.researchJobId}`
    );

    if (args.telegramChatId) {
      await ctx.runMutation(
        internal._admin.realWorldDeployGtm.patchTelegramChatId,
        { agentId: seed.agentId, telegramChatId: args.telegramChatId }
      );
      console.log(`[gtmSynth] patched telegramChatId=${args.telegramChatId}`);
    }

    if (args.tier) {
      await ctx.runMutation(internal.billing.gtmBilling.compGtmPlanByAgent, {
        agentId: seed.agentId as Id<"gtmAgents">,
        status: "active",
        tier: args.tier,
      });
      console.log(`[gtmSynth] comped agent ${seed.agentId} to tier ${args.tier}`);
    }

    // Sprint 2.16f — Convex no longer runs research before deploy. Maya
    // owns her own research loop end-to-end (per OpenClaw-native pattern
    // verified against the 2026.4.23 runtime). The previous orchestrator
    // (runBudgetedResearchJob) was belt-and-suspenders scaffolding from
    // when we didn't trust the agent to do its own work. With the
    // sessions_yield + LLM idle-timeout fixes (Sprint 2.16g/2.16h) Maya
    // wakes up, reads APP.md, picks channels from product context,
    // spawns _research subagents, and synthesizes the plan herself.
    // GTM.md ships as "pending research" — that's Maya's signal that
    // it's her job.
    const research = {
      skipped: true,
      reason: "Sprint 2.16f — Maya owns research loop natively",
    };

    let deploy: unknown = { skipped: true, reason: "deployFly=false" };
    if (args.deployFly) {
      console.log(
        "[gtmSynth] deploying Fly machine via deployMayaGtm (workspace will include any research baked above)..."
      );
      deploy = await ctx.runAction(
        internal.onboarding.gtm.deployMayaGtm.deployMayaGtm,
        { agentId: seed.agentId }
      );
      console.log(`[gtmSynth] deploy: ${JSON.stringify(deploy)}`);
    }

    return {
      ok: true,
      creatorId: String(seed.creatorId),
      agentId: String(seed.agentId),
      appId: String(seed.appId),
      researchJobId: String(seed.researchJobId),
      deploy,
      research,
    };
  },
});

/**
 * Sprint 2.16f — quick Fly machine status inspector for the latest GTM
 * test creator. Returns machine state + recent events so we can see
 * whether the machine is alive, crashed, still installing deps, etc.
 *
 * Usage:
 *   npx convex run _admin/realWorldDeployGtm:inspectLatestFlyMachine
 */
export const inspectLatestFlyMachine = internalAction({
  args: {},
  handler: async (
    ctx
  ): Promise<{
    flyAppId?: string;
    machines: Array<{
      id: string;
      state: string;
      events: string;
    }>;
  }> => {
    const latest = await ctx.runQuery(
      internal._admin.realWorldDeployGtm.findLatestGtmTestAgent,
      {}
    );
    if (!latest?.flyAppId) return { machines: [] };
    const { FlyClient } = await import("../lib/flyClient");
    const fly = new FlyClient();
    const machines = await fly.listMachines(latest.flyAppId);
    const results = await Promise.all(
      machines.map(async (m) => ({
        id: m.id,
        state: m.state,
        events: await fly
          .machineLogs(latest.flyAppId!, m.id, { sinceSec: 1800 })
          .catch((e: Error) => `events-fetch-error: ${e.message}`),
      }))
    );
    return { flyAppId: latest.flyAppId, machines: results };
  },
});

/**
 * Sprint 2.16f — fetch actual stdout/stderr logs from the latest Maya
 * via Fly GraphQL. Same surface as `flyctl logs -a <app>`.
 *
 * Usage:
 *   npx convex run _admin/realWorldDeployGtm:tailLatestMaya '{"limit":200}'
 */
export const tailLatestMaya = internalAction({
  args: { limit: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<{ flyAppId?: string; logs: string }> => {
    const latest = await ctx.runQuery(
      internal._admin.realWorldDeployGtm.findLatestGtmTestAgent,
      {}
    );
    if (!latest?.flyAppId) return { logs: "" };
    const { FlyClient } = await import("../lib/flyClient");
    const fly = new FlyClient();
    const logs = await fly
      .recentLogs(latest.flyAppId, { limit: args.limit ?? 200 })
      .catch((e: Error) => `logs-fetch-error: ${e.message}`);
    return { flyAppId: latest.flyAppId, logs };
  },
});

/** Inspect a SPECIFIC agent's plan + intended posts by agentId (works after the
 *  creator has been re-bound to a real login, unlike the latest-test-creator
 *  peeks). Returns the buyer read, bet channels, the target threads, and the
 *  actual drafted replies/posts. */
export const peekAgentPlan = internalQuery({
  args: { agentId: v.id("gtmAgents") },
  handler: async (ctx, args): Promise<unknown> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return { found: false };
    const buyerMap = await ctx.db
      .query("gtmBuyerMap")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .first();
    const scorecards = await ctx.db
      .query("gtmChannelScorecard")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .collect();
    const threads = (
      await ctx.db
        .query("gtmTargetThreads")
        .withIndex("by_account", (q) => q.eq("accountId", agent.accountId))
        .collect()
    ).filter((t) => t.agentId === args.agentId);
    const drafts = await ctx.db
      .query("gtmDraftedContent")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .collect();
    return {
      found: true,
      icp: buyerMap?.icpDescription ?? null,
      intentPhrases: buyerMap?.intentPhrases ?? [],
      betChannels: scorecards
        .filter((s) => s.bet)
        .map((s) => ({ channel: s.channel, unlock: s.uniqueUnlock })),
      threadCount: threads.length,
      threads: threads.slice(0, 12).map((t) => ({
        platform: t.platform,
        tier: t.tier,
        title: (t.title ?? "").slice(0, 120),
        url: t.url,
      })),
      draftCount: drafts.length,
      drafts: drafts.slice(0, 8).map((d) => ({
        platform: d.platform,
        kind: d.kind,
        text: (d.draftText ?? "").slice(0, 400),
      })),
    };
  },
});

export const peekFoundationDetails = internalQuery({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const all = await ctx.db.query("creators").collect();
    const tests = all
      .filter((c) => c.clerkUserId.startsWith(TEST_CLERK_USER_ID_PREFIX))
      .sort((a, b) => b.createdAt - a.createdAt);
    if (tests.length === 0) return { found: false };
    const agent = await ctx.db
      .query("gtmAgents")
      .withIndex("by_account", (q) => q.eq("accountId", tests[0]._id))
      .first();
    if (!agent) return { found: true };

    const competitive = await ctx.db
      .query("gtmCompetitiveMap")
      .withIndex("by_agent", (q) => q.eq("agentId", agent._id))
      .collect();
    const angles = await ctx.db
      .query("gtmContentAngles")
      .withIndex("by_agent", (q) => q.eq("agentId", agent._id))
      .collect();
    const channels = await ctx.db
      .query("gtmChannelScorecard")
      .withIndex("by_agent", (q) => q.eq("agentId", agent._id))
      .collect();
    const threads = await ctx.db
      .query("gtmTargetThreads")
      .withIndex("by_agent", (q) => q.eq("agentId", agent._id))
      .collect();
    const calendar = await ctx.db
      .query("gtmCalendarEvents")
      .withIndex("by_agent", (q) => q.eq("agentId", agent._id))
      .collect();

    return {
      competitorSample: competitive.slice(0, 3).map((c) => ({
        name: c.competitorName,
        kind: c.kind,
        positioning: c.positioning?.slice(0, 200),
        complaintCount: c.complaints?.length ?? 0,
        sampleComplaint: c.complaints?.[0],
        vulnerabilities: c.vulnerabilities?.slice(0, 3),
      })),
      angleSample: angles.slice(0, 3).map((a: any) => ({
        angle: a.angle?.slice(0, 200),
        painCitation: a.painCitation,
        hooks: a.hookVariants?.slice(0, 2),
      })),
      channelBets: channels
        .filter((c) => c.bet)
        .map((c) => ({
          channel: c.channel,
          unlock: c.uniqueUnlock?.slice(0, 200),
          fit: { aud: c.audienceFit, cad: c.cadenceFit },
        })),
      threadSample: threads.slice(0, 3).map((t: any) => ({
        platform: t.platform,
        url: t.url,
        title: t.title,
        painQuote: t.painQuote?.slice(0, 200),
        draftReply: t.draftReply?.slice(0, 250),
        recommendedAction: t.recommendedAction,
      })),
      calendarSample: calendar.slice(0, 3).map((e: any) => ({
        title: e.title,
        kind: e.kind,
        descriptionLen: e.description?.length ?? 0,
        descriptionFirst200: e.description?.slice(0, 200),
        scheduledAt: e.scheduledAt
          ? new Date(e.scheduledAt).toISOString()
          : undefined,
      })),
      calendarTotal: calendar.length,
    };
  },
});

/**
 * One-shot verification of the ideal-product REBUILD behaviors for the latest
 * GTM test agent: (1) NO 7-day plan — exactly ~1 day-1 calendar event, not a
 * week; (2) voice Phase 0 attempted (voiceProfileJson present + confidence);
 * (3) 6-channel research incl YouTube + per-channel icpKnowledge stored;
 * (4) messaging discipline — how many outbound messages + their framing
 * ("first move" vs "first week").
 *   npx convex run _admin/realWorldDeployGtm:verifyRebuild
 */
export const verifyRebuild = internalQuery({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const all = await ctx.db.query("creators").collect();
    const tests = all
      .filter((c) => c.clerkUserId.startsWith(TEST_CLERK_USER_ID_PREFIX))
      .sort((a, b) => b.createdAt - a.createdAt);
    if (tests.length === 0) return { found: false };
    const agent = await ctx.db
      .query("gtmAgents")
      .withIndex("by_account", (q) => q.eq("accountId", tests[0]._id))
      .first();
    if (!agent) return { found: true, agent: null };

    const [events, scorecards, messages] = await Promise.all([
      ctx.db
        .query("gtmCalendarEvents")
        .withIndex("by_agent", (q) => q.eq("agentId", agent._id))
        .collect(),
      ctx.db
        .query("gtmChannelScorecard")
        .withIndex("by_agent", (q) => q.eq("agentId", agent._id))
        .collect(),
      ctx.db
        .query("mayaMessages")
        .withIndex("by_agent", (q) => q.eq("agentId", agent._id))
        .collect(),
    ]);

    let voiceConfidence: string | null = null;
    if (agent.voiceProfileJson) {
      try {
        voiceConfidence =
          (JSON.parse(agent.voiceProfileJson) as { confidence?: string })
            .confidence ?? "present-unparsed-confidence";
      } catch {
        voiceConfidence = "present-malformed";
      }
    }

    const mayaMsgs = messages.filter((m) => m.role === "maya");
    return {
      agentId: agent._id,
      flyAppId: agent.openClawFlyAppId,
      // (1) NO 7-DAY PLAN — want ~1 day-1 event, not a week
      calendar: {
        totalEvents: events.length,
        kinds: events.map((e) => e.kind ?? "untyped"),
        turnKey: events.filter((e) => e.openUrl && e.draftText).length,
        verdict:
          events.length === 0
            ? "none-yet"
            : events.length <= 2
              ? "DAY-1 ✓ (not a week)"
              : `WEEK? (${events.length} events)`,
      },
      // (2) VOICE Phase 0
      voice: {
        profilePresent: Boolean(agent.voiceProfileJson),
        confidence: voiceConfidence,
        note: "no handles in this test → confidence:none is the correct graceful path",
      },
      // (3) 6-channel + YouTube + icpKnowledge
      channels: {
        scored: scorecards.map((s) => s.channel),
        bets: scorecards.filter((s) => s.bet).map((s) => s.channel),
        youtubeScored: scorecards.some((s) => s.channel === "youtube"),
        betChannelsWithIcpKnowledge: scorecards
          .filter((s) => s.bet && s.icpKnowledge)
          .map((s) => s.channel),
      },
      // (4) MESSAGING DISCIPLINE
      messaging: {
        outboundCount: mayaMsgs.length,
        firstWeekMentions: mayaMsgs.filter((m) =>
          /first week|whole week|rolling.{0,3}week/i.test(m.body)
        ).length,
        firstMoveMentions: mayaMsgs.filter((m) =>
          /first move|today/i.test(m.body)
        ).length,
        previews: mayaMsgs.slice(0, 6).map((m) => m.body.slice(0, 140)),
      },
    };
  },
});

/**
 * GROUNDED research-evidence dump for the latest GTM test agent — proof she's
 * doing REAL work (not fabricating): the actual tool calls (cost ledger by
 * provider+operation, e.g. scrapecreators /v1/tiktok/video/comments × N +
 * gemini review_media "watching"), the verbatim quotes she pulled (evidence
 * cards by source), her action narration (gtmAgentActivity), and channel
 * coverage. npx convex run _admin/realWorldDeployGtm:peekResearchEvidence
 */
export const peekResearchEvidence = internalQuery({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const all = await ctx.db.query("creators").collect();
    const tests = all
      .filter((c) => c.clerkUserId.startsWith(TEST_CLERK_USER_ID_PREFIX))
      .sort((a, b) => b.createdAt - a.createdAt);
    if (tests.length === 0) return { found: false };
    const creator = tests[0];
    const agent = await ctx.db
      .query("gtmAgents")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .first();
    if (!agent) return { found: true, agent: null };

    const [ledger, cards, activity, scorecards] = await Promise.all([
      ctx.db
        .query("gtmCostLedger")
        .withIndex("by_account", (q) => q.eq("accountId", creator._id))
        .collect(),
      ctx.db
        .query("gtmEvidenceCards")
        .withIndex("by_account", (q) => q.eq("accountId", creator._id))
        .collect(),
      ctx.db
        .query("gtmAgentActivity")
        .withIndex("by_agent", (q) => q.eq("agentId", agent._id))
        .collect(),
      ctx.db
        .query("gtmChannelScorecard")
        .withIndex("by_agent", (q) => q.eq("agentId", agent._id))
        .collect(),
    ]);

    // The actual tool calls — proves which APIs/channels she really hit.
    const callCounts: Record<string, number> = {};
    for (const e of ledger) {
      const k = `${e.provider} ${e.operation}`;
      callCounts[k] = (callCounts[k] ?? 0) + 1;
    }
    // Evidence cards by source, with sample verbatim quotes.
    const bySource: Record<
      string,
      { count: number; samples: Array<{ quote: string; url: string; who: string | null }> }
    > = {};
    for (const c of cards) {
      const s = c.source;
      if (!bySource[s]) bySource[s] = { count: 0, samples: [] };
      bySource[s].count += 1;
      if (bySource[s].samples.length < 2) {
        bySource[s].samples.push({
          quote: c.snippet.slice(0, 180),
          url: c.url,
          who: c.authorOrCommunity ?? null,
        });
      }
    }

    return {
      agentId: agent._id,
      toolCalls: callCounts, // e.g. {"scrapecreators /v1/tiktok/video/comments": 4, "gemini review_media": 2, ...}
      totalLedgerCalls: ledger.length,
      evidenceCards: { total: cards.length, bySource },
      activity: activity
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 20)
        .map((a) => ({ kind: a.kind, summary: a.summary })),
      channels: scorecards.map((s) => ({
        channel: s.channel,
        bet: s.bet,
        hasIcpKnowledge: Boolean(s.icpKnowledge),
      })),
    };
  },
});

export const peekFoundationState = internalQuery({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const all = await ctx.db.query("creators").collect();
    const tests = all
      .filter((c) => c.clerkUserId.startsWith(TEST_CLERK_USER_ID_PREFIX))
      .sort((a, b) => b.createdAt - a.createdAt);
    if (tests.length === 0) return { found: false };
    const agent = await ctx.db
      .query("gtmAgents")
      .withIndex("by_account", (q) => q.eq("accountId", tests[0]._id))
      .first();
    if (!agent) return { found: true, agent: null };

    const [
      buyerMap,
      competitiveMap,
      channelScorecard,
      contentAngles,
      relationshipTargets,
      actionLog,
    ] = await Promise.all([
      ctx.db
        .query("gtmBuyerMap")
        .withIndex("by_agent", (q) => q.eq("agentId", agent._id))
        .first(),
      ctx.db
        .query("gtmCompetitiveMap")
        .withIndex("by_agent", (q) => q.eq("agentId", agent._id))
        .collect(),
      ctx.db
        .query("gtmChannelScorecard")
        .withIndex("by_agent", (q) => q.eq("agentId", agent._id))
        .collect(),
      ctx.db
        .query("gtmContentAngles")
        .withIndex("by_agent", (q) => q.eq("agentId", agent._id))
        .collect(),
      ctx.db
        .query("gtmRelationshipTargets")
        .withIndex("by_agent", (q) => q.eq("agentId", agent._id))
        .collect(),
      ctx.db
        .query("gtmActionLog")
        .withIndex("by_agent_and_sent", (q) => q.eq("agentId", agent._id))
        .order("desc")
        .take(10),
    ]);

    return {
      agentId: agent._id,
      flyAppId: agent.openClawFlyAppId,
      buyerMap: buyerMap
        ? {
            icpDescription: buyerMap.icpDescription,
            buyerJourneyStageCount: buyerMap.buyerJourneyStages.length,
            intentPhraseCount: buyerMap.intentPhrases.length,
            trustedVoiceCount: buyerMap.trustedVoices.length,
            synthesizedAt: new Date(buyerMap.synthesizedAt).toISOString(),
          }
        : null,
      competitiveMapCount: competitiveMap.length,
      channelScorecardCount: channelScorecard.length,
      betChannels: channelScorecard.filter((r) => r.bet).map((r) => r.channel),
      contentAnglesCount: contentAngles.length,
      relationshipTargetsCount: relationshipTargets.length,
      recentActions: actionLog.map((r) => ({
        kind: r.kind,
        summary: r.summary,
        sentAt: new Date(r.sentAt).toISOString(),
      })),
    };
  },
});

export const peekLatestApp = internalQuery({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const all = await ctx.db.query("creators").collect();
    const tests = all
      .filter((c) => c.clerkUserId.startsWith(TEST_CLERK_USER_ID_PREFIX))
      .sort((a, b) => b.createdAt - a.createdAt);
    if (tests.length === 0) return null;
    const agent = await ctx.db
      .query("gtmAgents")
      .withIndex("by_account", (q) => q.eq("accountId", tests[0]._id))
      .first();
    if (!agent?.appId) return null;
    const app = await ctx.db.get(agent.appId);
    return {
      productName: (app as { name?: string } | null)?.name,
      productUrl: (app as { url?: string } | null)?.url,
      founderWhy: (app as { founderWhy?: string } | null)?.founderWhy,
      stage: (app as { stage?: string } | null)?.stage,
      weekGoal: (app as { weekGoal?: string } | null)?.weekGoal,
      telegramChatId: agent.telegramChatId,
      flyAppId: agent.openClawFlyAppId,
    };
  },
});

export const findLatestGtmTestAgent = internalQuery({
  args: {},
  handler: async (ctx): Promise<{ flyAppId?: string } | null> => {
    const all = await ctx.db.query("creators").collect();
    const tests = all
      .filter((c) => c.clerkUserId.startsWith(TEST_CLERK_USER_ID_PREFIX))
      .sort((a, b) => b.createdAt - a.createdAt);
    if (tests.length === 0) return null;
    const agent = await ctx.db
      .query("gtmAgents")
      .withIndex("by_account", (q) => q.eq("accountId", tests[0]._id))
      .first();
    return { flyAppId: agent?.openClawFlyAppId };
  },
});

/**
 * Live triage helper — dump latest agent's gtmTargetThreads counts by platform,
 * plus the freshest 5 thread rows so we can confirm what actually made it to
 * Convex when Maya appears stuck. Pairs with flyctl logs.
 */
/** Total spend + the actual content she produced (drafts + calendar event
 *  dates), for a "show me the work + cost" review before teardown.
 *  npx convex run _admin/realWorldDeployGtm:showWorkAndSpend */
export const showWorkAndSpend = internalQuery({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const all = await ctx.db.query("creators").collect();
    const tests = all
      .filter((c) => c.clerkUserId.startsWith(TEST_CLERK_USER_ID_PREFIX))
      .sort((a, b) => b.createdAt - a.createdAt);
    if (tests.length === 0) return { found: false };
    const creator = tests[0];
    const agent = await ctx.db
      .query("gtmAgents")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .first();
    if (!agent) return { found: true, agent: null };

    const [ledger, drafts, events, buyerMap, job] = await Promise.all([
      ctx.db
        .query("gtmCostLedger")
        .withIndex("by_account", (q) => q.eq("accountId", creator._id))
        .collect(),
      ctx.db
        .query("gtmDraftedContent")
        .withIndex("by_agent", (q) => q.eq("agentId", agent._id))
        .collect(),
      ctx.db
        .query("gtmCalendarEvents")
        .withIndex("by_agent", (q) => q.eq("agentId", agent._id))
        .collect(),
      ctx.db
        .query("gtmBuyerMap")
        .withIndex("by_agent", (q) => q.eq("agentId", agent._id))
        .first(),
      ctx.db
        .query("gtmResearchJobs")
        .withIndex("by_account", (q) => q.eq("accountId", creator._id))
        .order("desc")
        .first(),
    ]);

    const spendByProvider: Record<string, number> = {};
    let totalSpend = 0;
    for (const e of ledger) {
      spendByProvider[e.provider] =
        (spendByProvider[e.provider] ?? 0) + (e.costUsd ?? 0);
      totalSpend += e.costUsd ?? 0;
    }
    const tz = agent.timezone;
    return {
      spend: {
        totalUsd: Number(totalSpend.toFixed(4)),
        byProvider: Object.fromEntries(
          Object.entries(spendByProvider).map(([k, v]) => [
            k,
            Number(v.toFixed(4)),
          ])
        ),
        researchJobSpentUsd: job?.spentUsd ?? null,
        ledgerEntries: ledger.length,
      },
      timezone: tz,
      buyerMap: buyerMap
        ? {
            icp: buyerMap.icpDescription?.slice(0, 200),
            stages: buyerMap.buyerJourneyStages?.length ?? 0,
          }
        : null,
      drafts: {
        total: drafts.length,
        samples: drafts.slice(0, 4).map((d) => ({
          platform: d.platform,
          kind: d.kind,
          state: d.approvalState,
          voiceScore: d.voiceMatchScore ?? null,
          text: d.draftText.slice(0, 220),
        })),
      },
      calendar: {
        total: events.length,
        events: events
          .sort((a, b) => a.startsAtMs - b.startsAtMs)
          .map((e) => ({
            title: e.title,
            kind: e.kind ?? "untyped",
            date: new Date(e.startsAtMs).toLocaleString("en-US", {
              timeZone: tz,
              weekday: "short",
              hour: "numeric",
              minute: "2-digit",
              month: "short",
              day: "numeric",
            }),
            hasLink: Boolean(e.openUrl),
            hasDraft: Boolean(e.draftText),
          })),
      },
    };
  },
});

/** Merge messages + activity chronologically to see if an inbound user message
 *  triggered the foundation restart (the double-pass root cause).
 *  npx convex run _admin/realWorldDeployGtm:peekTimeline */
export const peekTimeline = internalQuery({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const all = await ctx.db.query("creators").collect();
    const tests = all
      .filter((c) => c.clerkUserId.startsWith(TEST_CLERK_USER_ID_PREFIX))
      .sort((a, b) => b.createdAt - a.createdAt);
    if (tests.length === 0) return { found: false };
    const creator = tests[0];
    const agent = await ctx.db
      .query("gtmAgents")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .first();
    if (!agent) return { found: true, agent: null };

    const [messages, activity] = await Promise.all([
      ctx.db
        .query("mayaMessages")
        .withIndex("by_agent", (q) => q.eq("agentId", agent._id))
        .collect(),
      ctx.db
        .query("gtmAgentActivity")
        .withIndex("by_agent", (q) => q.eq("agentId", agent._id))
        .collect(),
    ]);
    const tz = agent.timezone;
    const fmt = (ms: number) =>
      new Date(ms).toLocaleString("en-US", {
        timeZone: tz,
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      });
    type Row = { t: number; line: string };
    const rows: Row[] = [];
    for (const m of messages)
      rows.push({
        t: m._creationTime,
        line: `[${m.role === "user" ? "USER→" : "MAYA→"}] ${m.body.slice(0, 80)}`,
      });
    for (const a of activity)
      rows.push({ t: a.createdAt, line: `(${a.kind}) ${a.summary.slice(0, 80)}` });
    rows.sort((a, b) => a.t - b.t);
    return {
      timezone: tz,
      timeline: rows.map((r) => `${fmt(r.t)}  ${r.line}`),
    };
  },
});

/** Dump the FULL content of saved calendar events (the turn-key payload).
 *  npx convex run _admin/realWorldDeployGtm:peekCalendarFull */
export const peekCalendarFull = internalQuery({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const all = await ctx.db.query("creators").collect();
    const tests = all
      .filter((c) => c.clerkUserId.startsWith(TEST_CLERK_USER_ID_PREFIX))
      .sort((a, b) => b.createdAt - a.createdAt);
    if (tests.length === 0) return { found: false };
    const agent = await ctx.db
      .query("gtmAgents")
      .withIndex("by_account", (q) => q.eq("accountId", tests[0]._id))
      .first();
    if (!agent) return { found: true, agent: null };
    const events = await ctx.db
      .query("gtmCalendarEvents")
      .withIndex("by_agent", (q) => q.eq("agentId", agent._id))
      .collect();
    const tz = agent.timezone;
    return events
      .sort((a, b) => a.startsAtMs - b.startsAtMs)
      .map((e) => ({
        title: e.title,
        kind: e.kind ?? "untyped",
        status: e.status,
        when: new Date(e.startsAtMs).toLocaleString("en-US", {
          timeZone: tz,
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }),
        openUrl: e.openUrl ?? null,
        successMetric: e.successMetric ?? null,
        description: e.description ?? null,
        draftText: e.draftText ?? null,
      }));
  },
});

export const peekResearchLanded = internalQuery({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const all = await ctx.db.query("creators").collect();
    const tests = all
      .filter((c) => c.clerkUserId.startsWith(TEST_CLERK_USER_ID_PREFIX))
      .sort((a, b) => b.createdAt - a.createdAt);
    if (tests.length === 0) return { found: false };
    const creator = tests[0];
    const agent = await ctx.db
      .query("gtmAgents")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .first();
    if (!agent) return { found: true, agent: null };

    const threads = await ctx.db
      .query("gtmTargetThreads")
      .withIndex("by_agent", (q) => q.eq("agentId", agent._id))
      .collect();
    const byPlatform: Record<string, number> = {};
    for (const t of threads) {
      byPlatform[t.platform] = (byPlatform[t.platform] ?? 0) + 1;
    }

    const events = await ctx.db
      .query("gtmCalendarEvents")
      .withIndex("by_agent", (q) => q.eq("agentId", agent._id))
      .collect();

    const latest = threads
      .sort((a, b) => b._creationTime - a._creationTime)
      .map((t: any) => ({
        platform: t.platform,
        url: t.url,
        title: t.title,
        excerpt: t.excerpt,
        whyItFits: t.whyItFits,
        painMatchReason: t.painMatchReason,
        recommendedAction: t.recommendedAction,
        priorityScore: t.priorityScore,
        currentMetrics: t.currentMetrics,
        community: t.subredditOrCommunity,
      }));

    return {
      agentId: agent._id,
      flyAppId: agent.openClawFlyAppId,
      threadTotal: threads.length,
      threadsByPlatform: byPlatform,
      calendarEventTotal: events.length,
      latestThreads: latest,
    };
  },
});

/**
 * Verification-deploy coverage report. After a `verifyAllPlatforms` run, this
 * reads back the STRUCTURED evidence Maya wrote per platform + per provider and
 * reports a ✓/✗ coverage matrix — so "did every platform + tool work?" is a
 * queryable fact, not a vibe. Ground-truth backups: `flyctl logs` + the
 * OpenClaw session transcript at /data/agents/<id>/sessions/*.jsonl.
 *
 *   arch -arm64 npx convex run _admin/realWorldDeployGtm:verifyAllPlatformsCoverage
 */
export const verifyAllPlatformsCoverage = internalQuery({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const tests = (await ctx.db.query("creators").collect())
      .filter((c) => c.clerkUserId.startsWith(TEST_CLERK_USER_ID_PREFIX))
      .sort((a, b) => b.createdAt - a.createdAt);
    if (tests.length === 0) return { found: false };
    const creator = tests[0];
    const agent = await ctx.db
      .query("gtmAgents")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .first();
    if (!agent) return { found: true, agent: null };

    const threads = await ctx.db
      .query("gtmTargetThreads")
      .withIndex("by_agent", (q) => q.eq("agentId", agent._id))
      .collect();
    const drafts = await ctx.db
      .query("gtmDraftedContent")
      .withIndex("by_agent", (q) => q.eq("agentId", agent._id))
      .collect();
    const channelScores = await ctx.db
      .query("gtmChannelScores")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .collect();
    const cost = await ctx.db
      .query("gtmCostLedger")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .collect();
    const toolCalls = await ctx.db
      .query("gtmToolCallLog")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .collect();

    const count = <T>(rows: T[], key: (r: T) => string | undefined) => {
      const m: Record<string, number> = {};
      for (const r of rows) {
        const k = key(r);
        if (k) m[k] = (m[k] ?? 0) + 1;
      }
      return m;
    };

    const threadsByPlatform = count(threads, (t) => t.platform);
    const draftsByPlatform = count(drafts, (d) => d.platform);
    const channelsScored = new Set(channelScores.map((c) => c.channel));
    const providersHit = count([...cost, ...toolCalls], (r) => r.provider);
    const operations = [...new Set(cost.map((c) => c.operation))];
    const toolNames = [...new Set(toolCalls.map((t) => t.toolName))];

    // The provider that proves each platform's READ pipeline actually fired.
    const platformProvider: Record<string, string> = {
      reddit: "scrapecreators",
      tiktok: "scrapecreators",
      instagram: "scrapecreators",
      youtube: "scrapecreators",
      linkedin: "scrapecreators",
      x: "x_api",
      hn: "other", // Algolia HN is unauthenticated; logged as other/openclaw
    };

    const PLATFORMS = ["reddit", "x", "linkedin", "tiktok", "instagram", "youtube", "hn"];
    const matrix = PLATFORMS.map((p) => {
      const researched = (threadsByPlatform[p] ?? 0) > 0;
      const drafted = (draftsByPlatform[p] ?? 0) > 0;
      const scored = channelsScored.has(p as never);
      // operation strings are "<platform>.<op>" per dumpLastResearchQueries.
      const apiCalled = operations.some((o) => o.startsWith(`${p}.`));
      return {
        platform: p,
        researched, // surfaced ≥1 target thread
        threadCount: threadsByPlatform[p] ?? 0,
        scored, // channel-scored
        drafted,
        draftCount: draftsByPlatform[p] ?? 0,
        apiCalled, // a cost-ledger op recorded for this platform
        expectedProvider: platformProvider[p],
        ok: researched || apiCalled, // pipeline demonstrably ran
      };
    });

    return {
      found: true,
      agentId: agent._id,
      flyAppId: agent.openClawFlyAppId,
      verifyAllPlatforms: agent.verifyAllPlatforms ?? false,
      // Per-platform coverage — the headline ✓/✗ matrix.
      platformMatrix: matrix,
      platformsCovered: matrix.filter((m) => m.ok).map((m) => m.platform),
      platformsMissing: matrix.filter((m) => !m.ok).map((m) => m.platform),
      // Tool/provider coverage — proves the APIs + multimodal path fired.
      providersHit, // counts per provider (scrapecreators / x_api / gemini / openrouter / …)
      geminiCalled: (providersHit["gemini"] ?? 0) > 0, // video-watch / multimodal proof
      toolNames, // every distinct tool that fired
      operationSample: operations.slice(0, 40),
      totals: {
        targetThreads: threads.length,
        drafts: drafts.length,
        channelScores: channelScores.length,
        costRows: cost.length,
        toolCalls: toolCalls.length,
        totalSpendUsd: cost.reduce((a, c) => a + (c.costUsd ?? 0), 0),
      },
    };
  },
});

/**
 * Sprint 2.16f — nuke every clawlaunch-* Fly app. Use when starting from
 * a known-clean slate: kills orphaned Maya machines whose Convex DB rows
 * have already been wiped. Pairs with `run` (which wipes Convex rows).
 *
 * Usage:
 *   npx convex run _admin/realWorldDeployGtm:destroyAllClawlaunchApps
 */
export const destroyAllClawlaunchApps = internalAction({
  args: {},
  handler: async (
    ctx
  ): Promise<{
    destroyed: string[];
    failed: string[];
    listed: number;
    tokensRotated: number;
  }> => {
    const { FlyClient } = await import("../lib/flyClient");
    const fly = new FlyClient();
    const all = await fly.listApps({ first: 500 });
    // Per-agent test machines deploy under TWO prefixes — `clawlaunch-*` (the
    // GTM admin path) and `maya-*` (the onboarding deploy path). Matching only
    // clawlaunch-* let a `maya-*` agent run 7 days unnoticed and burn $28
    // (2026-06-22). Match both ephemeral prefixes; NEVER touch the persistent
    // shared infra apps (`heymaya-openclaw`, `heymaya-video-synth`).
    const EPHEMERAL_PREFIXES = ["clawlaunch-", "maya-"];
    const targets = all
      .map((a) => a.name)
      .filter((n) => EPHEMERAL_PREFIXES.some((p) => n.startsWith(p)));
    console.log(
      `[destroyAllClawlaunchApps] listed ${all.length} apps, ${targets.length} match clawlaunch-*/maya-*`
    );
    const destroyed: string[] = [];
    const failed: string[] = [];
    for (const name of targets) {
      try {
        await fly.destroyApp(name);
        destroyed.push(name);
        console.log(`[destroyAllClawlaunchApps] destroyed ${name}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failed.push(`${name}: ${msg}`);
        console.error(`[destroyAllClawlaunchApps] failed ${name}: ${msg}`);
      }
    }
    // Security: an agent whose Fly machine is destroyed must lose its
    // hookToken. Otherwise the per-agent shared secret keeps authenticating
    // Convex POSTs (and worse — could be leaked to the operator's Telegram
    // history, as happened on run #10, 2026-05-27). Force the next deploy to
    // mint a fresh token by clearing the existing one.
    const tokensRotated = await ctx.runMutation(
      internal._admin.realWorldDeployGtm.rotateHookTokensForDestroyedApps,
      { destroyedAppNames: destroyed }
    );
    return { destroyed, failed, listed: all.length, tokensRotated };
  },
});

export const rotateAllHookTokens = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ rotated: number; total: number }> => {
    const agents = await ctx.db.query("gtmAgents").collect();
    let rotated = 0;
    for (const agent of agents) {
      if (agent.hookToken) {
        await ctx.db.patch(agent._id, {
          hookToken: undefined,
          updatedAt: Date.now(),
        });
        rotated += 1;
      }
    }
    console.log(
      `[rotateAllHookTokens] rotated ${rotated} of ${agents.length} gtmAgents`
    );
    return { rotated, total: agents.length };
  },
});

export const rotateHookTokensForDestroyedApps = internalMutation({
  args: { destroyedAppNames: v.array(v.string()) },
  handler: async (ctx, args): Promise<number> => {
    let rotated = 0;
    for (const appName of args.destroyedAppNames) {
      const agent = await ctx.db
        .query("gtmAgents")
        .withIndex("by_fly_app", (q) => q.eq("openClawFlyAppId", appName))
        .first();
      if (agent && agent.hookToken) {
        await ctx.db.patch(agent._id, {
          hookToken: undefined,
          updatedAt: Date.now(),
        });
        rotated += 1;
        console.log(
          `[rotateHookTokensForDestroyedApps] cleared hookToken for ${appName}`
        );
      }
    }
    return rotated;
  },
});

/**
 * Read-only: dump recent mayaMessages for an agent (both roles), newest first.
 * Diagnostic only — used to inspect exactly what Maya sent to Telegram.
 */
export const peekAgentMessages = internalQuery({
  args: { agentId: v.id("gtmAgents"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("mayaMessages")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .collect();
    rows.sort((a, b) => b.ts - a.ts);
    return rows.slice(0, args.limit ?? 20).map((r) => ({
      ts: r.ts,
      role: r.role,
      channel: r.channel,
      messageClass: r.messageClass ?? null,
      bodyHead: r.body.slice(0, 240),
    }));
  },
});

/**
 * Read-only: list every creator on this deployment with the key identity
 * fields + their gtmAgent count. Diagnostic for a pre-wipe audit — shows
 * exactly who exists before any destructive clear. Safe to run against prod.
 */
export const auditAllCreators = internalQuery({
  args: {},
  handler: async (ctx) => {
    const creators = await ctx.db.query("creators").collect();
    const rows = [];
    for (const c of creators) {
      const agents = await ctx.db
        .query("gtmAgents")
        .withIndex("by_account", (q) => q.eq("accountId", c._id))
        .collect();
      rows.push({
        creatorId: c._id,
        email: (c as { email?: string }).email ?? null,
        clerkUserId: c.clerkUserId,
        accountType: (c as { accountType?: string }).accountType ?? null,
        agentCount: agents.length,
        agentIds: agents.map((a) => a._id),
        createdAt: c._creationTime,
      });
    }
    return { totalCreators: creators.length, rows };
  },
});

/**
 * COMPLETE tenant wipe — clears every creator + the entire GTM data surface
 * (all gtm* tables + mayaMessages) + the creator-side connect/oauth tables.
 * Unlike wipeStagingCleanSlate this is prod-capable (guarded by an explicit
 * confirm token) and complete (mayaMessages + newer tables the older wipes
 * missed). Use for a full clean-slate reset before a fresh onboarding test.
 * Does NOT touch Fly machines or Clerk — call wipeAllClerkUsers + the Fly
 * teardown separately.
 */
const WIPE_TABLES = [
  "creators", "connectedAccounts", "oauthStateTokens",
      "gtmActionLog", "gtmAgentActivity", "gtmAgentTrace", "gtmAgents",
      "gtmApps", "gtmArchetypeLearnings", "gtmAuditEvents", "gtmBetaCohort",
      "gtmBuyerMap", "gtmBuyerSegments", "gtmCalendarConnections",
      "gtmCalendarEvents", "gtmChannelScorecard", "gtmChannelScores",
      "gtmChannelWatermarks", "gtmCompetitiveMap", "gtmCompetitorMoves",
      "gtmConnectionHealth", "gtmContentAngles", "gtmContentBankItems",
      "gtmContentDrafts", "gtmConversions", "gtmCostLedger",
      "gtmDeliveryFailures", "gtmDistributionMotions", "gtmDraftedContent",
      "gtmEvidenceCards", "gtmFormatExperiments", "gtmHookCallbacks",
      "gtmHumanPlanReviews", "gtmLinkClicks", "gtmLinkWraps", "gtmMachineHealth",
      "gtmMemoryWrites", "gtmNicheLearnings", "gtmNichePulse",
      "gtmOauthStateTokens", "gtmPlatformBriefs", "gtmPlatformClaims",
      "gtmPlatformRefreshRuns", "gtmPostResults", "gtmRelationshipTargets",
      "gtmResearchJobs", "gtmResultSnapshots", "gtmSafetyStates",
      "gtmSkillImprovementProposals", "gtmSteeringDirectives",
      "gtmTargetAccounts", "gtmTargetThreads", "gtmTelegramPairingTokens",
      "gtmToolCallLog", "gtmUgcReadinessReports", "gtmUserReportedSignals",
  "gtmWalkthroughUploads", "gtmWatchLaneState", "gtmWorkspaceMutations",
  "mayaMessages",
] as const;

/** Delete up to 1000 rows from one table (stays under Convex's 4096-read
 *  per-transaction limit). Returns how many it deleted; the orchestrating
 *  action loops until a table returns < 1000. */
export const wipeTableBatch = internalMutation({
  args: { table: v.string(), confirm: v.string() },
  handler: async (ctx, args): Promise<number> => {
    if (args.confirm !== "WIPE_ALL") {
      throw new Error("refusing: pass { confirm: \"WIPE_ALL\" }");
    }
    const rows = await ctx.db.query(args.table as TableNames).take(1000);
    for (const row of rows) await ctx.db.delete(row._id);
    return rows.length;
  },
});

export const wipeAllTenants = internalAction({
  args: { confirm: v.string() },
  handler: async (ctx, args): Promise<Record<string, number>> => {
    if (args.confirm !== "WIPE_ALL") {
      throw new Error("refusing: pass { confirm: \"WIPE_ALL\" }");
    }
    const counts: Record<string, number> = {};
    for (const table of WIPE_TABLES) {
      let total = 0;
      for (;;) {
        const n: number = await ctx.runMutation(
          internal._admin.realWorldDeployGtm.wipeTableBatch,
          { table, confirm: "WIPE_ALL" }
        );
        total += n;
        if (n < 1000) break;
      }
      if (total > 0) counts[table] = total;
    }
    return counts;
  },
});

/**
 * Delete EVERY Clerk user on this deployment's Clerk instance (via CLERK_SECRET_KEY).
 * Paginates the list endpoint and DELETEs each. Guarded by an explicit confirm.
 * Staging + prod use DIFFERENT Clerk instances (different secret) — run once per
 * deployment. The user's own Google sign-in recreates a fresh Clerk user on next
 * login, so this is safe for a clean-slate onboarding test.
 */
export const wipeAllClerkUsers = internalAction({
  args: { confirm: v.string() },
  handler: async (
    _ctx,
    args
  ): Promise<{ deleted: number; failed: number; errors: string[] }> => {
    if (args.confirm !== "WIPE_ALL") {
      throw new Error("refusing: pass { confirm: \"WIPE_ALL\" }");
    }
    const key = process.env.CLERK_SECRET_KEY;
    if (!key) throw new Error("no CLERK_SECRET_KEY in env");
    const base = "https://api.clerk.com/v1";
    const auth = { Authorization: `Bearer ${key}` };
    let deleted = 0;
    let failed = 0;
    const errors: string[] = [];
    // Page through all users (limit 100) and delete each. Re-fetch from offset 0
    // each round since deletions shrink the set.
    for (let guard = 0; guard < 100; guard++) {
      const res = await fetch(`${base}/users?limit=100&offset=0`, {
        headers: auth,
      });
      if (!res.ok) {
        errors.push(`list: ${res.status} ${await res.text()}`);
        break;
      }
      const arr = (await res.json()) as Array<{ id: string }>;
      if (!Array.isArray(arr) || arr.length === 0) break;
      for (const u of arr) {
        const del = await fetch(`${base}/users/${u.id}`, {
          method: "DELETE",
          headers: auth,
        });
        if (del.ok) deleted += 1;
        else {
          failed += 1;
          errors.push(`${u.id}: ${del.status}`);
        }
      }
    }
    return { deleted, failed, errors: errors.slice(0, 10) };
  },
});
