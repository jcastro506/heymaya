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
import type { Doc, Id } from "../_generated/dataModel";

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

export const seedGtmAgentAndApp = internalMutation({
  args: {
    clerkUserId: v.string(),
    productName: v.string(),
    productUrl: v.string(),
    founderWhy: v.optional(v.string()),
    stage: v.union(v.literal("idea"), v.literal("live-beta"), v.literal("paid"), v.literal("unknown")),
    weekGoal: v.union(v.literal("feedback"), v.literal("signups"), v.literal("demos"), v.literal("revenue"), v.literal("unknown")),
    budgetUsd: v.number(),
    channelPreference: v.optional(v.union(v.literal("whatsapp"), v.literal("imessage"), v.literal("web"), v.literal("telegram"))),
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
      jobs: jobs.map((j) => ({ _id: j._id, status: j.status, phase: j.phase, spentUsd: j.spentUsd, lastAgentNote: j.lastAgentNote })),
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

export const run = internalAction({
  args: {
    productName: v.string(),
    productUrl: v.string(),
    founderWhy: v.optional(v.string()),
    stage: v.optional(v.union(v.literal("idea"), v.literal("live-beta"), v.literal("paid"), v.literal("unknown"))),
    weekGoal: v.optional(v.union(v.literal("feedback"), v.literal("signups"), v.literal("demos"), v.literal("revenue"), v.literal("unknown"))),
    budgetUsd: v.optional(v.number()),
    deployFly: v.optional(v.boolean()),
    telegramChatId: v.optional(v.string()),
    skipResearch: v.optional(v.boolean()),
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
    const wipe = await ctx.runMutation(
      internal._admin.realWorldDeployGtm.wipeExistingGtmTestCreators,
      {}
    );
    console.log(`[gtmSynth] wiped: ${JSON.stringify(wipe)}`);

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

    // Sprint 1.5 — research BEFORE deploy. Reason: deployMayaGtm builds the
    // workspace tarball via buildAndUploadGtmWorkspace which reads the
    // latest gtmResearchJobs → channelScores via getGtmAgentForDeploy.
    // If we deploy first, the workspace bundle has empty GTM.md (no
    // channel picks, no first-week-test) and Maya boots blind. If we
    // research first, the workspace bundle bakes in the X-primary,
    // Reddit-secondary decisions + cheat-sheet evidence and Maya boots
    // already smart about the product.
    let research: unknown = { skipped: true, reason: "skipResearch=true" };
    if (!args.skipResearch) {
      console.log(
        "[gtmSynth] running orchestrator (runBudgetedResearchJob) FIRST — burns real credits..."
      );
      research = await ctx.runAction(
        internal.gtmMaya.researchWorker.runBudgetedResearchJob,
        { researchJobId: seed.researchJobId }
      );
      console.log(`[gtmSynth] research: ${JSON.stringify(research, null, 2)}`);
    } else {
      console.log("[gtmSynth] skipResearch=true; orchestrator not invoked");
    }

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
