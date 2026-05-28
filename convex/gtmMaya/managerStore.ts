/**
 * Sprint 2.17 Phase A — Manager-mode store.
 *
 * Internal mutations for the 9 new manager-mode tables:
 *   Foundation:
 *     gtmBuyerMap (singleton per agent)
 *     gtmCompetitiveMap (dedupe: agentId + competitorKey)
 *     gtmChannelScorecard (dedupe: agentId + channel)
 *     gtmContentAngles (dedupe: agentId + angleKey)
 *     gtmRelationshipTargets (dedupe: agentId + platform + lc(handle))
 *   Continuous:
 *     gtmCompetitorMoves (dedupe: agentId + sourceUrl + moveKind)
 *     gtmNichePulse (dedupe: agentId + pulseKind + evidenceUrl)
 *     gtmActionLog (append-only)
 *     gtmNicheLearnings (dedupe: agentId + learningKey)
 *
 * Every mutation calls assertAgentBelongsToAccount() before any write.
 * HTTP callers derive (accountId, agentId) from the hookToken — the
 * mutation re-verifies as a defense-in-depth check.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

async function assertAgentBelongsToAccount(
  ctx: { db: { get: <T>(id: T) => Promise<unknown> } },
  accountId: Id<"creators">,
  agentId: Id<"gtmAgents">
): Promise<void> {
  const agent = (await ctx.db.get(agentId)) as Doc<"gtmAgents"> | null;
  if (!agent || agent.accountId !== accountId) {
    throw new Error("manager-store mutation: agent does not belong to account.");
  }
}

// ───────────────────── Foundation: buyer map ─────────────────────

/** Singleton-per-agent overwrite. Foundation research re-runs at
 *  onboarding + monthly; each pass replaces the prior row whole. */
export const upsertBuyerMap = internalMutation({
  args: {
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    icpDescription: v.string(),
    buyerJourneyStages: v.array(
      v.object({
        stage: v.string(),
        whereTheyHangOut: v.string(),
        intentLanguage: v.string(),
      })
    ),
    intentPhrases: v.array(v.string()),
    trustedVoices: v.array(
      v.object({
        handle: v.string(),
        platform: v.string(),
        whyTrusted: v.string(),
      })
    ),
  },
  handler: async (ctx, args): Promise<Id<"gtmBuyerMap">> => {
    await assertAgentBelongsToAccount(ctx, args.accountId, args.agentId);
    const now = Date.now();
    const existing = await ctx.db
      .query("gtmBuyerMap")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        icpDescription: args.icpDescription,
        buyerJourneyStages: args.buyerJourneyStages,
        intentPhrases: args.intentPhrases,
        trustedVoices: args.trustedVoices,
        synthesizedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("gtmBuyerMap", {
      accountId: args.accountId,
      agentId: args.agentId,
      icpDescription: args.icpDescription,
      buyerJourneyStages: args.buyerJourneyStages,
      intentPhrases: args.intentPhrases,
      trustedVoices: args.trustedVoices,
      synthesizedAt: now,
    });
  },
});

// ───────────────────── Foundation: competitive map ─────────────────────

const COMPETITOR_KIND = v.union(
  v.literal("direct"),
  v.literal("adjacent"),
  v.literal("substitute")
);

/** Dedupe: (agentId, competitorKey). competitorKey is lowercased by
 *  the HTTP handler before reaching here. */
export const upsertCompetitor = internalMutation({
  args: {
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    competitorKey: v.string(),
    competitorName: v.string(),
    kind: COMPETITOR_KIND,
    url: v.optional(v.string()),
    pricing: v.optional(v.string()),
    positioning: v.string(),
    complaints: v.array(
      v.object({ quote: v.string(), sourceUrl: v.string() })
    ),
    vulnerabilities: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"gtmCompetitiveMap">> => {
    await assertAgentBelongsToAccount(ctx, args.accountId, args.agentId);
    const now = Date.now();
    const existing = await ctx.db
      .query("gtmCompetitiveMap")
      .withIndex("by_agent_and_key", (q) =>
        q.eq("agentId", args.agentId).eq("competitorKey", args.competitorKey)
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        competitorName: args.competitorName,
        kind: args.kind,
        url: args.url,
        pricing: args.pricing,
        positioning: args.positioning,
        complaints: args.complaints,
        vulnerabilities: args.vulnerabilities,
        synthesizedAt: now,
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("gtmCompetitiveMap", {
      accountId: args.accountId,
      agentId: args.agentId,
      competitorKey: args.competitorKey,
      competitorName: args.competitorName,
      kind: args.kind,
      url: args.url,
      pricing: args.pricing,
      positioning: args.positioning,
      complaints: args.complaints,
      vulnerabilities: args.vulnerabilities,
      synthesizedAt: now,
      updatedAt: now,
    });
  },
});

// ───────────────────── Foundation: channel scorecard ─────────────────────

// Sprint 2.18 #46 — YouTube REMOVED. Operator scoped product to
// TikTok / IG / LinkedIn / X / Reddit / HN / Threads / podcasts /
// newsletters / Discord / blog.
const CHANNEL = v.union(
  v.literal("reddit"),
  v.literal("x"),
  v.literal("hn"),
  v.literal("linkedin"),
  v.literal("tiktok"),
  v.literal("instagram"),
  v.literal("threads"),
  v.literal("podcasts"),
  v.literal("newsletters"),
  v.literal("discord"),
  v.literal("blog")
);

export const upsertChannelScorecard = internalMutation({
  args: {
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    channel: CHANNEL,
    audienceFit: v.number(),
    cadenceFit: v.number(),
    uniqueUnlock: v.string(),
    bet: v.boolean(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"gtmChannelScorecard">> => {
    await assertAgentBelongsToAccount(ctx, args.accountId, args.agentId);
    if (args.audienceFit < 0 || args.audienceFit > 1) {
      throw new Error("audienceFit must be in [0, 1]");
    }
    if (args.cadenceFit < 0 || args.cadenceFit > 1) {
      throw new Error("cadenceFit must be in [0, 1]");
    }
    const now = Date.now();
    const existing = await ctx.db
      .query("gtmChannelScorecard")
      .withIndex("by_agent_and_channel", (q) =>
        q.eq("agentId", args.agentId).eq("channel", args.channel)
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        audienceFit: args.audienceFit,
        cadenceFit: args.cadenceFit,
        uniqueUnlock: args.uniqueUnlock,
        bet: args.bet,
        notes: args.notes,
        synthesizedAt: now,
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("gtmChannelScorecard", {
      accountId: args.accountId,
      agentId: args.agentId,
      channel: args.channel,
      audienceFit: args.audienceFit,
      cadenceFit: args.cadenceFit,
      uniqueUnlock: args.uniqueUnlock,
      bet: args.bet,
      notes: args.notes,
      synthesizedAt: now,
      updatedAt: now,
    });
  },
});

// ───────────────────── Foundation: content angles ─────────────────────

export const upsertContentAngle = internalMutation({
  args: {
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    angleKey: v.string(),
    angle: v.string(),
    painCitation: v.object({
      quote: v.string(),
      sourceUrl: v.string(),
    }),
    hookVariants: v.array(v.string()),
    voiceCheck: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"gtmContentAngles">> => {
    await assertAgentBelongsToAccount(ctx, args.accountId, args.agentId);
    const now = Date.now();
    const existing = await ctx.db
      .query("gtmContentAngles")
      .withIndex("by_agent_and_key", (q) =>
        q.eq("agentId", args.agentId).eq("angleKey", args.angleKey)
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        angle: args.angle,
        painCitation: args.painCitation,
        hookVariants: args.hookVariants,
        voiceCheck: args.voiceCheck,
        synthesizedAt: now,
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("gtmContentAngles", {
      accountId: args.accountId,
      agentId: args.agentId,
      angleKey: args.angleKey,
      angle: args.angle,
      painCitation: args.painCitation,
      hookVariants: args.hookVariants,
      voiceCheck: args.voiceCheck,
      usageCount: 0,
      synthesizedAt: now,
      updatedAt: now,
    });
  },
});

// ───────────────────── Foundation: relationship targets ─────────────────────

const RELATIONSHIP_PLATFORM = v.union(
  v.literal("reddit"),
  v.literal("x"),
  v.literal("hn"),
  v.literal("linkedin"),
  v.literal("instagram"),
  v.literal("tiktok"),
  v.literal("threads")
);
const RELATIONSHIP_CADENCE = v.union(
  v.literal("weekly"),
  v.literal("monthly"),
  v.literal("as_they_post")
);
const RELATIONSHIP_STATUS = v.union(
  v.literal("prospect"),
  v.literal("warming"),
  v.literal("engaged"),
  v.literal("reciprocal"),
  v.literal("dropped")
);

export const upsertRelationshipTarget = internalMutation({
  args: {
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    platform: RELATIONSHIP_PLATFORM,
    handle: v.string(), // HTTP handler lowercases before passing
    displayName: v.optional(v.string()),
    profileUrl: v.optional(v.string()),
    whyThem: v.string(),
    engagementPlan: v.string(),
    cadence: RELATIONSHIP_CADENCE,
    status: v.optional(RELATIONSHIP_STATUS),
  },
  handler: async (ctx, args): Promise<Id<"gtmRelationshipTargets">> => {
    await assertAgentBelongsToAccount(ctx, args.accountId, args.agentId);
    const now = Date.now();
    const handle = args.handle.toLowerCase();
    const existing = await ctx.db
      .query("gtmRelationshipTargets")
      .withIndex("by_agent_and_platform", (q) =>
        q.eq("agentId", args.agentId).eq("platform", args.platform)
      )
      .filter((q) => q.eq(q.field("handle"), handle))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        displayName: args.displayName,
        profileUrl: args.profileUrl,
        whyThem: args.whyThem,
        engagementPlan: args.engagementPlan,
        cadence: args.cadence,
        // Preserve existing status unless caller passed one explicitly.
        // Onboarding refresh shouldn't reset "engaged" back to "prospect".
        status: args.status ?? existing.status,
        synthesizedAt: now,
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("gtmRelationshipTargets", {
      accountId: args.accountId,
      agentId: args.agentId,
      platform: args.platform,
      handle,
      displayName: args.displayName,
      profileUrl: args.profileUrl,
      whyThem: args.whyThem,
      engagementPlan: args.engagementPlan,
      cadence: args.cadence,
      status: args.status ?? "prospect",
      synthesizedAt: now,
      updatedAt: now,
    });
  },
});

// ───────────────────── Continuous: competitor moves ─────────────────────

const MOVE_KIND = v.union(
  v.literal("feature_ship"),
  v.literal("campaign"),
  v.literal("milestone"),
  v.literal("pricing_change"),
  v.literal("partnership"),
  v.literal("incident")
);

/** Dedupe by (agentId, sourceUrl, moveKind) — same URL can carry
 *  multiple distinct move classifications, but the same combination
 *  shouldn't double-insert. */
export const recordCompetitorMove = internalMutation({
  args: {
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    competitiveMapId: v.optional(v.id("gtmCompetitiveMap")),
    competitorName: v.string(),
    moveKind: MOVE_KIND,
    summary: v.string(),
    sourceUrl: v.string(),
    observedAt: v.number(),
    recommendedCounter: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"gtmCompetitorMoves">> => {
    await assertAgentBelongsToAccount(ctx, args.accountId, args.agentId);
    const now = Date.now();
    const existing = await ctx.db
      .query("gtmCompetitorMoves")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .filter((q) =>
        q.and(
          q.eq(q.field("sourceUrl"), args.sourceUrl),
          q.eq(q.field("moveKind"), args.moveKind)
        )
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        competitiveMapId: args.competitiveMapId ?? existing.competitiveMapId,
        competitorName: args.competitorName,
        summary: args.summary,
        observedAt: args.observedAt,
        recommendedCounter:
          args.recommendedCounter ?? existing.recommendedCounter,
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("gtmCompetitorMoves", {
      accountId: args.accountId,
      agentId: args.agentId,
      competitiveMapId: args.competitiveMapId,
      competitorName: args.competitorName,
      moveKind: args.moveKind,
      summary: args.summary,
      sourceUrl: args.sourceUrl,
      observedAt: args.observedAt,
      recommendedCounter: args.recommendedCounter,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// ───────────────────── Continuous: niche pulse ─────────────────────

const PULSE_KIND = v.union(
  v.literal("new_community"),
  v.literal("rising_account"),
  v.literal("rising_keyword"),
  v.literal("rising_topic"),
  v.literal("declining_signal")
);
const PULSE_RELEVANCE = v.union(
  v.literal("act_now"),
  v.literal("monitor"),
  v.literal("noise")
);

/** Dedupe by (agentId, pulseKind, evidenceUrl). */
export const recordNichePulse = internalMutation({
  args: {
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    pulseKind: PULSE_KIND,
    name: v.string(),
    platform: v.optional(v.string()),
    evidenceUrl: v.string(),
    momentumSignal: v.string(),
    observedAt: v.number(),
    relevance: PULSE_RELEVANCE,
  },
  handler: async (ctx, args): Promise<Id<"gtmNichePulse">> => {
    await assertAgentBelongsToAccount(ctx, args.accountId, args.agentId);
    const now = Date.now();
    const existing = await ctx.db
      .query("gtmNichePulse")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .filter((q) =>
        q.and(
          q.eq(q.field("pulseKind"), args.pulseKind),
          q.eq(q.field("evidenceUrl"), args.evidenceUrl)
        )
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name,
        platform: args.platform,
        momentumSignal: args.momentumSignal,
        observedAt: args.observedAt,
        relevance: args.relevance,
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("gtmNichePulse", {
      accountId: args.accountId,
      agentId: args.agentId,
      pulseKind: args.pulseKind,
      name: args.name,
      platform: args.platform,
      evidenceUrl: args.evidenceUrl,
      momentumSignal: args.momentumSignal,
      observedAt: args.observedAt,
      relevance: args.relevance,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// ───────────────────── Continuous: action log ─────────────────────

const ACTION_KIND = v.union(
  v.literal("morning_brief"),
  v.literal("evening_recap"),
  v.literal("weekly_review"),
  v.literal("monthly_reset"),
  v.literal("hot_alert"),
  v.literal("inbound_triage"),
  v.literal("calendar_event_created"),
  v.literal("draft_proposed"),
  v.literal("foundation_complete"),
  v.literal("competitor_move_alert"),
  v.literal("niche_pulse_alert"),
  v.literal("other")
);
const ACTION_RESPONSE = v.union(
  v.literal("pending"),
  v.literal("acknowledged"),
  v.literal("acted"),
  v.literal("ignored"),
  v.literal("dismissed")
);

/** Append-only — every Maya output writes one row. The HTTP handler
 *  carries an idempotencyKey so retries don't double-insert; the
 *  callback's idempotency table handles that, not this mutation. */
export const recordActionLog = internalMutation({
  args: {
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    kind: ACTION_KIND,
    summary: v.string(),
    linkedEntities: v.optional(
      v.array(
        v.object({
          entityKind: v.string(),
          entityId: v.string(),
        })
      )
    ),
    sentAt: v.number(),
    userResponse: v.optional(ACTION_RESPONSE),
    outcomeNotes: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"gtmActionLog">> => {
    await assertAgentBelongsToAccount(ctx, args.accountId, args.agentId);
    const now = Date.now();
    return await ctx.db.insert("gtmActionLog", {
      accountId: args.accountId,
      agentId: args.agentId,
      kind: args.kind,
      summary: args.summary,
      linkedEntities: args.linkedEntities,
      sentAt: args.sentAt,
      userResponse: args.userResponse ?? "pending",
      outcomeNotes: args.outcomeNotes,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// ───────────────────── Continuous: niche learnings ─────────────────────

const LEARNING_KIND = v.union(
  v.literal("timing"),
  v.literal("channel_priority"),
  v.literal("voice_angle"),
  v.literal("community_quality"),
  v.literal("format_preference"),
  v.literal("hook_pattern"),
  v.literal("other")
);

/** Upsert keyed by (agentId, learningKey). New evidence on an existing
 *  learning bumps evidenceCount + lastReinforcedAt + confidenceScore. */
export const upsertNicheLearning = internalMutation({
  args: {
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    learningKey: v.string(),
    learningKind: LEARNING_KIND,
    learning: v.string(),
    /** When upserting, this is the new confidence (Maya re-grades each
     *  time she reinforces). Caller is responsible for combining old
     *  + new evidence — we trust the LLM judgment here. */
    confidenceScore: v.number(),
    /** Optional: explicit evidenceCount override. If omitted, we
     *  increment the existing count by 1 (or start at 1 for new). */
    evidenceCount: v.optional(v.number()),
    retired: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<Id<"gtmNicheLearnings">> => {
    await assertAgentBelongsToAccount(ctx, args.accountId, args.agentId);
    if (args.confidenceScore < 0 || args.confidenceScore > 1) {
      throw new Error("confidenceScore must be in [0, 1]");
    }
    const now = Date.now();
    const existing = await ctx.db
      .query("gtmNicheLearnings")
      .withIndex("by_agent_and_key", (q) =>
        q.eq("agentId", args.agentId).eq("learningKey", args.learningKey)
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        learningKind: args.learningKind,
        learning: args.learning,
        confidenceScore: args.confidenceScore,
        evidenceCount: args.evidenceCount ?? existing.evidenceCount + 1,
        lastReinforcedAt: now,
        retired: args.retired ?? existing.retired,
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("gtmNicheLearnings", {
      accountId: args.accountId,
      agentId: args.agentId,
      learningKey: args.learningKey,
      learningKind: args.learningKind,
      learning: args.learning,
      confidenceScore: args.confidenceScore,
      evidenceCount: args.evidenceCount ?? 1,
      firstObservedAt: now,
      lastReinforcedAt: now,
      retired: args.retired ?? false,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// ───────────────────── Read-side queries ─────────────────────
//
// These are called from the manager-mode HTTP GET endpoints. Each
// scopes by agentId (no cross-tenant leak — the HTTP layer derives
// agentId from the hookToken). Foundation reads are bundled into
// `getMyFoundation` so Maya can curl-GET her whole operating model
// in one request at boot or morning brief time.

/** One-shot read of all five foundation outputs. Returns null fields
 *  for parts that haven't been synthesized yet (fresh deploys, or
 *  partial foundation runs). */
export const getMyFoundation = internalQuery({
  args: { agentId: v.id("gtmAgents") },
  handler: async (
    ctx,
    args
  ): Promise<{
    buyerMap: Doc<"gtmBuyerMap"> | null;
    competitiveMap: Doc<"gtmCompetitiveMap">[];
    channelScorecard: Doc<"gtmChannelScorecard">[];
    contentAngles: Doc<"gtmContentAngles">[];
    relationshipTargets: Doc<"gtmRelationshipTargets">[];
  }> => {
    const buyerMap = await ctx.db
      .query("gtmBuyerMap")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .first();
    const competitiveMap = await ctx.db
      .query("gtmCompetitiveMap")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .collect();
    const channelScorecard = await ctx.db
      .query("gtmChannelScorecard")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .collect();
    const contentAngles = await ctx.db
      .query("gtmContentAngles")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .collect();
    const relationshipTargets = await ctx.db
      .query("gtmRelationshipTargets")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .collect();
    return {
      buyerMap,
      competitiveMap,
      channelScorecard,
      contentAngles,
      relationshipTargets,
    };
  },
});

/** Recent competitor moves, newest first. limit defaults to 30. */
export const listCompetitorMoves = internalQuery({
  args: {
    agentId: v.id("gtmAgents"),
    sinceMs: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Doc<"gtmCompetitorMoves">[]> => {
    const rows = await ctx.db
      .query("gtmCompetitorMoves")
      .withIndex("by_agent_and_observed", (q) => q.eq("agentId", args.agentId))
      .order("desc")
      .take(args.limit ?? 30);
    if (args.sinceMs === undefined) return rows;
    return rows.filter((r) => r.observedAt >= (args.sinceMs ?? 0));
  },
});

/** Recent niche-pulse signals, newest first. */
export const listNichePulse = internalQuery({
  args: {
    agentId: v.id("gtmAgents"),
    sinceMs: v.optional(v.number()),
    limit: v.optional(v.number()),
    relevance: v.optional(
      v.union(
        v.literal("act_now"),
        v.literal("monitor"),
        v.literal("noise")
      )
    ),
  },
  handler: async (ctx, args): Promise<Doc<"gtmNichePulse">[]> => {
    const limit = args.limit ?? 30;
    if (args.relevance) {
      const rows = await ctx.db
        .query("gtmNichePulse")
        .withIndex("by_agent_and_relevance", (q) =>
          q.eq("agentId", args.agentId).eq("relevance", args.relevance!)
        )
        .order("desc")
        .take(limit);
      if (args.sinceMs === undefined) return rows;
      return rows.filter((r) => r.observedAt >= (args.sinceMs ?? 0));
    }
    const rows = await ctx.db
      .query("gtmNichePulse")
      .withIndex("by_agent_and_observed", (q) => q.eq("agentId", args.agentId))
      .order("desc")
      .take(limit);
    if (args.sinceMs === undefined) return rows;
    return rows.filter((r) => r.observedAt >= (args.sinceMs ?? 0));
  },
});

/** Recent action-log entries. Maya reads this on weekly review to
 *  extract learnings + grade prior briefs against operator response. */
export const listActionLog = internalQuery({
  args: {
    agentId: v.id("gtmAgents"),
    sinceMs: v.optional(v.number()),
    limit: v.optional(v.number()),
    kind: v.optional(
      v.union(
        v.literal("morning_brief"),
        v.literal("evening_recap"),
        v.literal("weekly_review"),
        v.literal("monthly_reset"),
        v.literal("hot_alert"),
        v.literal("inbound_triage"),
        v.literal("calendar_event_created"),
        v.literal("draft_proposed"),
        v.literal("foundation_complete"),
        v.literal("competitor_move_alert"),
        v.literal("niche_pulse_alert"),
        v.literal("other")
      )
    ),
  },
  handler: async (ctx, args): Promise<Doc<"gtmActionLog">[]> => {
    const limit = args.limit ?? 50;
    if (args.kind) {
      const rows = await ctx.db
        .query("gtmActionLog")
        .withIndex("by_agent_and_kind", (q) =>
          q.eq("agentId", args.agentId).eq("kind", args.kind!)
        )
        .order("desc")
        .take(limit);
      if (args.sinceMs === undefined) return rows;
      return rows.filter((r) => r.sentAt >= (args.sinceMs ?? 0));
    }
    const rows = await ctx.db
      .query("gtmActionLog")
      .withIndex("by_agent_and_sent", (q) => q.eq("agentId", args.agentId))
      .order("desc")
      .take(limit);
    if (args.sinceMs === undefined) return rows;
    return rows.filter((r) => r.sentAt >= (args.sinceMs ?? 0));
  },
});

/** All non-retired niche learnings for an agent. Maya reads this
 *  every morning brief to weight what surfaces. */
export const listNicheLearnings = internalQuery({
  args: {
    agentId: v.id("gtmAgents"),
    includeRetired: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<Doc<"gtmNicheLearnings">[]> => {
    if (args.includeRetired) {
      return await ctx.db
        .query("gtmNicheLearnings")
        .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
        .collect();
    }
    return await ctx.db
      .query("gtmNicheLearnings")
      .withIndex("by_agent_and_retired", (q) =>
        q.eq("agentId", args.agentId).eq("retired", false)
      )
      .collect();
  },
});

