/**
 * Sprint 2.2 — target-list persistence layer.
 *
 * The deep-research subagents (Sprint 2.1) need a place to write three
 * artifact kinds:
 *   1. gtmTargetThreads    — specific Reddit/X/HN/LinkedIn/IG/TikTok
 *                            threads where the operator's product fits
 *                            as a natural reply.
 *   2. gtmTargetAccounts   — specific people/accounts to follow + engage
 *                            with (used by Sprint 2.6 daily heartbeat).
 *   3. gtmDraftedContent   — drafts of replies/posts/threads/comments/DMs
 *                            the operator can tap-and-post once they pass
 *                            slop-critic (Sprint 2.10) + approval.
 *
 * Writes flow inbound through HTTP actions (the OpenClaw plugin POSTs to
 * /lc_gtm/* endpoints which call these internal mutations). Reads flow
 * outbound through the mission board surfaces (Today, Targets, Drafts
 * tabs) via the public queries below.
 *
 * Cross-tenant isolation lives at TWO layers:
 *   - Internal mutations require accountId + agentId args; callers
 *     (the HTTP actions in Sprint 2.1) authenticate the agent's hookToken
 *     and resolve those IDs before writing. We re-verify the agent
 *     belongs to the account so a leaked token can't insert into a
 *     mismatched account.
 *   - Public queries auth-gate via ctx.auth.getUserIdentity() and
 *     resolve the calling creator through clerkUserId; unauthenticated
 *     callers and non-gtm-agent accountType creators get [] back. Same
 *     pattern as gtmMaya/researchLifecycle.ts:getMyGtmSnapshot.
 */

import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
  type QueryCtx,
} from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

// ───────────────────── shared validators ─────────────────────

const PLATFORM = v.union(
  v.literal("reddit"),
  v.literal("x"),
  v.literal("hn"),
  v.literal("linkedin"),
  v.literal("instagram"),
  v.literal("tiktok")
);

const THREAD_ACTION = v.union(
  v.literal("reply"),
  v.literal("lurk"),
  v.literal("upvote_only"),
  v.literal("avoid")
);

const ACCOUNT_ACTION = v.union(
  v.literal("follow_and_engage"),
  v.literal("lurk"),
  v.literal("dm"),
  v.literal("avoid")
);

const THREAD_STATUS = v.union(
  v.literal("queued"),
  v.literal("replied"),
  v.literal("dropped"),
  v.literal("expired")
);

const ACCOUNT_STATUS = v.union(
  v.literal("queued"),
  v.literal("following"),
  v.literal("dropped")
);

const DRAFT_KIND = v.union(
  v.literal("reply"),
  v.literal("thread"),
  v.literal("post"),
  v.literal("comment"),
  v.literal("dm")
);

const APPROVAL_STATE = v.union(
  v.literal("draft"),
  v.literal("pending_approval"),
  v.literal("approved"),
  v.literal("rejected"),
  v.literal("published"),
  v.literal("needs_revision")
);

const METRICS = v.object({
  upvotes: v.optional(v.number()),
  comments: v.optional(v.number()),
  likes: v.optional(v.number()),
  shares: v.optional(v.number()),
  views: v.optional(v.number()),
});

// ───────────────────── internal mutations ─────────────────────

/**
 * Insert (or update-on-dedupe) a target thread.
 *
 * Dedupe key: (accountId, platform, externalId). If a row already exists
 * for that triple, we UPDATE its currentMetrics + whyItFits +
 * priorityScore + lastSeenMetricsAtMs + updatedAt — never insert a
 * duplicate. This lets a subagent re-surface the same thread on a
 * later run with fresher metrics without polluting the mission board.
 *
 * researchJobId is on the update path too because a thread first
 * surfaced in job A might be re-surfaced in job B with stronger
 * reasoning; we keep the LATEST job's pointer.
 */
export const recordTargetThread = internalMutation({
  args: {
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    researchJobId: v.optional(v.id("gtmResearchJobs")),
    platform: PLATFORM,
    url: v.string(),
    externalId: v.string(),
    title: v.optional(v.string()),
    excerpt: v.optional(v.string()),
    author: v.optional(v.string()),
    subredditOrCommunity: v.optional(v.string()),
    currentMetrics: METRICS,
    whyItFits: v.string(),
    recommendedAction: THREAD_ACTION,
    priorityScore: v.number(),
  },
  handler: async (ctx, args): Promise<Id<"gtmTargetThreads">> => {
    await assertAgentBelongsToAccount(ctx, args.accountId, args.agentId);
    const now = Date.now();
    // Dedupe scan: account-scoped so cross-tenant collisions on
    // externalId can never happen. Convex doesn't support a 3-column
    // index without naming it; we filter the by_account_and_platform
    // index inline rather than adding yet another index for a
    // dedupe-only path that runs at most a few times per minute.
    const existing = await ctx.db
      .query("gtmTargetThreads")
      .withIndex("by_account_and_platform", (q) =>
        q.eq("accountId", args.accountId).eq("platform", args.platform)
      )
      .filter((q) => q.eq(q.field("externalId"), args.externalId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        researchJobId: args.researchJobId ?? existing.researchJobId,
        url: args.url,
        title: args.title,
        excerpt: args.excerpt,
        author: args.author,
        subredditOrCommunity: args.subredditOrCommunity,
        currentMetrics: args.currentMetrics,
        lastSeenMetricsAtMs: now,
        whyItFits: args.whyItFits,
        recommendedAction: args.recommendedAction,
        priorityScore: args.priorityScore,
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("gtmTargetThreads", {
      accountId: args.accountId,
      agentId: args.agentId,
      researchJobId: args.researchJobId,
      platform: args.platform,
      url: args.url,
      externalId: args.externalId,
      title: args.title,
      excerpt: args.excerpt,
      author: args.author,
      subredditOrCommunity: args.subredditOrCommunity,
      currentMetrics: args.currentMetrics,
      lastSeenMetricsAtMs: now,
      whyItFits: args.whyItFits,
      recommendedAction: args.recommendedAction,
      status: "queued",
      priorityScore: args.priorityScore,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Insert (or update-on-dedupe) a target account.
 *
 * Dedupe key: (accountId, platform, handle). Handle is lowercased before
 * compare so "@Sabesh" and "@sabesh" don't double-insert. Update path
 * refreshes bio + followerCount + voiceAnalysis + whyItFits + priorityScore.
 */
export const recordTargetAccount = internalMutation({
  args: {
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    researchJobId: v.optional(v.id("gtmResearchJobs")),
    platform: PLATFORM,
    handle: v.string(),
    profileUrl: v.string(),
    displayName: v.optional(v.string()),
    bio: v.optional(v.string()),
    followerCount: v.optional(v.number()),
    voiceAnalysis: v.optional(v.string()),
    whyItFits: v.string(),
    recommendedAction: ACCOUNT_ACTION,
    priorityScore: v.number(),
  },
  handler: async (ctx, args): Promise<Id<"gtmTargetAccounts">> => {
    await assertAgentBelongsToAccount(ctx, args.accountId, args.agentId);
    const now = Date.now();
    const normalizedHandle = args.handle.trim().replace(/^@/, "").toLowerCase();
    const existing = await ctx.db
      .query("gtmTargetAccounts")
      .withIndex("by_account_and_platform", (q) =>
        q.eq("accountId", args.accountId).eq("platform", args.platform)
      )
      .filter((q) => q.eq(q.field("handle"), normalizedHandle))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        researchJobId: args.researchJobId ?? existing.researchJobId,
        profileUrl: args.profileUrl,
        displayName: args.displayName,
        bio: args.bio,
        followerCount: args.followerCount,
        voiceAnalysis: args.voiceAnalysis,
        whyItFits: args.whyItFits,
        recommendedAction: args.recommendedAction,
        priorityScore: args.priorityScore,
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("gtmTargetAccounts", {
      accountId: args.accountId,
      agentId: args.agentId,
      researchJobId: args.researchJobId,
      platform: args.platform,
      handle: normalizedHandle,
      profileUrl: args.profileUrl,
      displayName: args.displayName,
      bio: args.bio,
      followerCount: args.followerCount,
      voiceAnalysis: args.voiceAnalysis,
      whyItFits: args.whyItFits,
      recommendedAction: args.recommendedAction,
      status: "queued",
      priorityScore: args.priorityScore,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Insert a new draft. Never dedupes — multiple drafts per target are
 * allowed because the operator may ask for a rewrite (each revision is
 * a new row). New drafts always start with slopCriticPassed=false; the
 * Sprint 2.10 slop-critic flips it true via updateDraftedContentApproval
 * once it scans the content.
 */
export const recordDraftedContent = internalMutation({
  args: {
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    researchJobId: v.optional(v.id("gtmResearchJobs")),
    kind: DRAFT_KIND,
    platform: PLATFORM,
    targetThreadId: v.optional(v.id("gtmTargetThreads")),
    targetAccountId: v.optional(v.id("gtmTargetAccounts")),
    draftText: v.string(),
    draftSegments: v.optional(v.array(v.string())),
    voiceMatchScore: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Id<"gtmDraftedContent">> => {
    await assertAgentBelongsToAccount(ctx, args.accountId, args.agentId);
    if (args.targetThreadId) {
      const thread = await ctx.db.get(args.targetThreadId);
      if (!thread || thread.accountId !== args.accountId) {
        throw new Error(
          "recordDraftedContent: targetThreadId does not belong to this account."
        );
      }
    }
    if (args.targetAccountId) {
      const target = await ctx.db.get(args.targetAccountId);
      if (!target || target.accountId !== args.accountId) {
        throw new Error(
          "recordDraftedContent: targetAccountId does not belong to this account."
        );
      }
    }
    const now = Date.now();
    return await ctx.db.insert("gtmDraftedContent", {
      accountId: args.accountId,
      agentId: args.agentId,
      researchJobId: args.researchJobId,
      kind: args.kind,
      platform: args.platform,
      targetThreadId: args.targetThreadId,
      targetAccountId: args.targetAccountId,
      draftText: args.draftText,
      draftSegments: args.draftSegments,
      voiceMatchScore: args.voiceMatchScore,
      slopCriticPassed: false,
      approvalState: "draft",
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Move a target thread through its status lifecycle. Used by the
 * approval workflow (when a draft is published, mark its thread
 * "replied") and by Sprint 2.6 heartbeat (when a thread ages out,
 * mark it "expired"). draftedReplyId is an optional pointer set when
 * status transitions to "replied".
 */
export const updateTargetThreadStatus = internalMutation({
  args: {
    id: v.id("gtmTargetThreads"),
    status: THREAD_STATUS,
    draftedReplyId: v.optional(v.id("gtmDraftedContent")),
  },
  handler: async (ctx, args): Promise<void> => {
    const thread = await ctx.db.get(args.id);
    if (!thread) throw new Error("updateTargetThreadStatus: thread not found.");
    if (args.draftedReplyId) {
      const draft = await ctx.db.get(args.draftedReplyId);
      if (!draft || draft.accountId !== thread.accountId) {
        throw new Error(
          "updateTargetThreadStatus: draftedReplyId does not belong to this account."
        );
      }
    }
    await ctx.db.patch(args.id, {
      status: args.status,
      draftedReplyId: args.draftedReplyId ?? thread.draftedReplyId,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Drive the approval workflow on a draft. The Sprint 2.10 slop-critic
 * sets slopCriticPassed + slopCriticFailures here when it scans the
 * draft; the operator's approval UI calls this when they tap
 * approve/reject/publish; the rewrite path calls this with
 * needs_revision + userFeedback.
 */
export const updateDraftedContentApproval = internalMutation({
  args: {
    id: v.id("gtmDraftedContent"),
    approvalState: APPROVAL_STATE,
    userFeedback: v.optional(v.string()),
    publishedAt: v.optional(v.number()),
    providerPostId: v.optional(v.string()),
    slopCriticPassed: v.optional(v.boolean()),
    slopCriticFailures: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<void> => {
    const draft = await ctx.db.get(args.id);
    if (!draft) throw new Error("updateDraftedContentApproval: draft not found.");
    const patch: Partial<Doc<"gtmDraftedContent">> = {
      approvalState: args.approvalState,
      updatedAt: Date.now(),
    };
    if (args.userFeedback !== undefined) patch.userFeedback = args.userFeedback;
    if (args.publishedAt !== undefined) patch.publishedAt = args.publishedAt;
    if (args.providerPostId !== undefined)
      patch.providerPostId = args.providerPostId;
    if (args.slopCriticPassed !== undefined)
      patch.slopCriticPassed = args.slopCriticPassed;
    if (args.slopCriticFailures !== undefined)
      patch.slopCriticFailures = args.slopCriticFailures;
    await ctx.db.patch(args.id, patch);
  },
});

/**
 * Daily heartbeat refresh: re-scrape the thread on a cadence and update
 * its metrics. Bumps lastSeenMetricsAtMs + updatedAt; doesn't touch
 * whyItFits or recommendedAction (those are subagent-owned).
 */
export const refreshTargetThreadMetrics = internalMutation({
  args: {
    id: v.id("gtmTargetThreads"),
    currentMetrics: METRICS,
  },
  handler: async (ctx, args): Promise<void> => {
    const thread = await ctx.db.get(args.id);
    if (!thread) throw new Error("refreshTargetThreadMetrics: thread not found.");
    const now = Date.now();
    await ctx.db.patch(args.id, {
      currentMetrics: args.currentMetrics,
      lastSeenMetricsAtMs: now,
      updatedAt: now,
    });
  },
});

// ───────────────────── public queries ─────────────────────

/**
 * Return the current creator's target threads, optionally filtered by
 * status + platform. Unauthenticated callers and non-gtm-agent accounts
 * get [] — never throws so the mission board surfaces degrade gracefully.
 */
export const getMyTargetThreads = query({
  args: {
    status: v.optional(THREAD_STATUS),
    platform: v.optional(PLATFORM),
  },
  handler: async (ctx, args): Promise<Doc<"gtmTargetThreads">[]> => {
    const creator = await resolveMyGtmCreator(ctx);
    if (!creator) return [];
    let rows: Doc<"gtmTargetThreads">[];
    if (args.status !== undefined) {
      const status = args.status;
      rows = await ctx.db
        .query("gtmTargetThreads")
        .withIndex("by_account_and_status", (q) =>
          q.eq("accountId", creator._id).eq("status", status)
        )
        .order("desc")
        .collect();
    } else if (args.platform !== undefined) {
      const platform = args.platform;
      rows = await ctx.db
        .query("gtmTargetThreads")
        .withIndex("by_account_and_platform", (q) =>
          q.eq("accountId", creator._id).eq("platform", platform)
        )
        .order("desc")
        .collect();
    } else {
      rows = await ctx.db
        .query("gtmTargetThreads")
        .withIndex("by_account", (q) => q.eq("accountId", creator._id))
        .order("desc")
        .collect();
    }
    // When both filters are present, refine the platform inline (rare
    // path — most callers pass one or zero filters).
    if (args.status !== undefined && args.platform !== undefined) {
      rows = rows.filter((row) => row.platform === args.platform);
    }
    return rows;
  },
});

/**
 * Return the current creator's target accounts, optionally filtered
 * by platform.
 */
export const getMyTargetAccounts = query({
  args: { platform: v.optional(PLATFORM) },
  handler: async (ctx, args): Promise<Doc<"gtmTargetAccounts">[]> => {
    const creator = await resolveMyGtmCreator(ctx);
    if (!creator) return [];
    if (args.platform !== undefined) {
      const platform = args.platform;
      return await ctx.db
        .query("gtmTargetAccounts")
        .withIndex("by_account_and_platform", (q) =>
          q.eq("accountId", creator._id).eq("platform", platform)
        )
        .order("desc")
        .collect();
    }
    return await ctx.db
      .query("gtmTargetAccounts")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .order("desc")
      .collect();
  },
});

/**
 * Return the current creator's drafted content, optionally filtered
 * by approvalState. Used by the approval queue + the published-history
 * tab in the mission board.
 */
export const getMyDraftedContent = query({
  args: { approvalState: v.optional(APPROVAL_STATE) },
  handler: async (ctx, args): Promise<Doc<"gtmDraftedContent">[]> => {
    const creator = await resolveMyGtmCreator(ctx);
    if (!creator) return [];
    if (args.approvalState !== undefined) {
      const approvalState = args.approvalState;
      return await ctx.db
        .query("gtmDraftedContent")
        .withIndex("by_account_and_state", (q) =>
          q.eq("accountId", creator._id).eq("approvalState", approvalState)
        )
        .order("desc")
        .collect();
    }
    return await ctx.db
      .query("gtmDraftedContent")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .order("desc")
      .collect();
  },
});

/**
 * Return a single target thread plus all drafts linked to it via
 * targetThreadId. Used by the thread-detail view in the mission board
 * so the operator sees the thread + every draft attempt against it.
 * Returns null if the thread doesn't exist or doesn't belong to the
 * caller (cross-tenant isolation).
 */
export const getMyTargetThreadById = query({
  args: { id: v.id("gtmTargetThreads") },
  handler: async (
    ctx,
    args
  ): Promise<{
    thread: Doc<"gtmTargetThreads">;
    drafts: Doc<"gtmDraftedContent">[];
  } | null> => {
    const creator = await resolveMyGtmCreator(ctx);
    if (!creator) return null;
    const thread = await ctx.db.get(args.id);
    if (!thread || thread.accountId !== creator._id) return null;
    const drafts = await ctx.db
      .query("gtmDraftedContent")
      .withIndex("by_target_thread", (q) => q.eq("targetThreadId", args.id))
      .order("desc")
      .collect();
    return { thread, drafts };
  },
});

/**
 * Internal query for the OpenClaw HTTP bridge in
 * convex/gtmMaya/openclaw/inboundCallback.ts:getMyTargetThreadsHttp.
 *
 * Authenticated by hookToken at the HTTP layer, then this query
 * scopes to a specific (accountId, agentId) pair so the agent can
 * never read another agent's target threads even within the same
 * account (defensive — current product is 1:1 agent:account but
 * the index supports the join either way).
 */
export const listAgentTargetThreads = internalQuery({
  args: {
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    status: v.optional(THREAD_STATUS),
    platform: v.optional(PLATFORM),
  },
  handler: async (ctx, args): Promise<Doc<"gtmTargetThreads">[]> => {
    let rows: Doc<"gtmTargetThreads">[];
    if (args.status !== undefined) {
      const status = args.status;
      rows = await ctx.db
        .query("gtmTargetThreads")
        .withIndex("by_account_and_status", (q) =>
          q.eq("accountId", args.accountId).eq("status", status)
        )
        .order("desc")
        .collect();
    } else if (args.platform !== undefined) {
      const platform = args.platform;
      rows = await ctx.db
        .query("gtmTargetThreads")
        .withIndex("by_account_and_platform", (q) =>
          q.eq("accountId", args.accountId).eq("platform", platform)
        )
        .order("desc")
        .collect();
    } else {
      rows = await ctx.db
        .query("gtmTargetThreads")
        .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
        .order("desc")
        .collect();
    }
    // Apply remaining filters + agent scope inline.
    return rows.filter((row) => {
      if (row.agentId !== args.agentId) return false;
      if (args.platform !== undefined && row.platform !== args.platform) return false;
      if (args.status !== undefined && row.status !== args.status) return false;
      return true;
    });
  },
});

// ───────────────────── helpers ─────────────────────

/**
 * Resolve the currently-signed-in user to a gtm-agent creator row.
 * Mirrors gtmMaya/researchLifecycle.ts:getMyGtmSnapshot's resolution
 * pattern — null on no identity, no creator row, or wrong accountType.
 */
async function resolveMyGtmCreator(
  ctx: QueryCtx
): Promise<Doc<"creators"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const creator = await ctx.db
    .query("creators")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
    .first();
  if (!creator || creator.accountType !== "gtm-agent") return null;
  return creator;
}

/**
 * Confirm the agent row exists AND belongs to the given account.
 * Internal mutations get accountId + agentId from authenticated callers
 * (HTTP actions that validated the hookToken); we re-verify here so a
 * mis-issued token can't write into a mismatched account.
 */
async function assertAgentBelongsToAccount(
  ctx: { db: { get: <T>(id: T) => Promise<unknown> } },
  accountId: Id<"creators">,
  agentId: Id<"gtmAgents">
): Promise<void> {
  // ctx typing is intentionally loose here to support both MutationCtx
  // and the test harness's mutation surface. The runtime check is the
  // contract: db.get(agentId) must return a row whose accountId field
  // matches.
  const agent = (await ctx.db.get(agentId)) as Doc<"gtmAgents"> | null;
  if (!agent || agent.accountId !== accountId) {
    throw new Error("Target-list mutation: agent does not belong to account.");
  }
}
