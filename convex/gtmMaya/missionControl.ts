/**
 * Mission Control — public read queries for the web UI + the agent-activity
 * feed mutation. All reads are auth-scoped to the signed-in operator via
 * `resolveMyGtmCreator` (cross-tenant isolation, fail-closed: no identity / not
 * a gtm-agent → empty). The UI calls these with `useQuery` (live subscriptions),
 * so when OpenClaw POSTs new data the UI re-renders automatically.
 */

import { v } from "convex/values";
import { internalMutation, mutation, query } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { resolveMyGtmCreator } from "./targetList";

// ───────────────────────── Research / "What we know" ─────────────────────────

/** ICP / buyer map (singleton per agent). Research tab. */
export const getMyBuyerMap = query({
  args: {},
  handler: async (ctx): Promise<Doc<"gtmBuyerMap"> | null> => {
    const creator = await resolveMyGtmCreator(ctx);
    if (!creator) return null;
    return await ctx.db
      .query("gtmBuyerMap")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .first();
  },
});

/** Competitive map (N per agent) — competitors + cited complaints. Research tab. */
export const getMyCompetitiveMap = query({
  args: {},
  handler: async (ctx): Promise<Doc<"gtmCompetitiveMap">[]> => {
    const creator = await resolveMyGtmCreator(ctx);
    if (!creator) return [];
    return await ctx.db
      .query("gtmCompetitiveMap")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .collect();
  },
});

// ───────────────────────── Results ─────────────────────────

/** Niche learnings (what's working) — Results tab. Hides retired by default. */
export const getMyNicheLearnings = query({
  args: { includeRetired: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<Doc<"gtmNicheLearnings">[]> => {
    const creator = await resolveMyGtmCreator(ctx);
    if (!creator) return [];
    const rows = await ctx.db
      .query("gtmNicheLearnings")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .collect();
    return args.includeRetired ? rows : rows.filter((r) => !r.retired);
  },
});

/** Conversions (signups/demos/feedback/revenue) — the outcome. Results tab. */
export const getMyConversions = query({
  args: {},
  handler: async (ctx): Promise<Doc<"gtmConversions">[]> => {
    const creator = await resolveMyGtmCreator(ctx);
    if (!creator) return [];
    return await ctx.db
      .query("gtmConversions")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .order("desc")
      .collect();
  },
});

/**
 * Per-post attribution — "which post/reply drove clicks + signups." Joins
 * each tracked link (gtmLinkWraps) to its click count (gtmLinkClicks) and the
 * conversions tied to it (gtmConversions.linkWrapId), plus the draft it came
 * from (so the UI can show the actual post text + platform). This is the
 * proof-it's-working surface AND the data Maya reads to adapt ("double down on
 * what converts, cut what flops"). Most-recent first, capped.
 */
export const getMyPostAttribution = query({
  args: { limit: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<
    Array<{
      linkWrapId: Id<"gtmLinkWraps">;
      destinationUrl: string;
      platform: string | null;
      draftText: string | null;
      draftKind: string | null;
      clicks: number;
      conversions: number;
      conversionKinds: string[];
      createdAt: number;
    }>
  > => {
    const creator = await resolveMyGtmCreator(ctx);
    if (!creator) return [];
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);

    const wraps = await ctx.db
      .query("gtmLinkWraps")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .order("desc")
      .take(limit);

    const rows = await Promise.all(
      wraps.map(async (w) => {
        const clicks = await ctx.db
          .query("gtmLinkClicks")
          .withIndex("by_link_wrap", (q) => q.eq("linkWrapId", w._id))
          .collect();
        const convs = await ctx.db
          .query("gtmConversions")
          .withIndex("by_account", (q) => q.eq("accountId", creator._id))
          .collect();
        const linked = convs.filter((c) => c.linkWrapId === w._id);
        let draftText: string | null = null;
        let draftKind: string | null = null;
        if (w.draftId) {
          const draft = await ctx.db.get(w.draftId);
          if (draft && draft.accountId === creator._id) {
            draftText = draft.draftText;
            draftKind = draft.kind;
          }
        }
        return {
          linkWrapId: w._id,
          destinationUrl: w.destinationUrl,
          platform: w.platform ?? null,
          draftText,
          draftKind,
          clicks: clicks.length,
          conversions: linked.reduce((sum, c) => sum + c.count, 0),
          conversionKinds: [...new Set(linked.map((c) => c.kind))],
          createdAt: w.createdAt,
        };
      })
    );
    return rows;
  },
});

// ───────────────────────── Account ─────────────────────────

/** Account/profile view for the Account tab — the operator's product, North
 *  Star, plan, and account status. Auth-scoped; null if not a gtm-agent. */
export const getMyAccount = query({
  args: {},
  handler: async (
    ctx
  ): Promise<{
    email?: string;
    plan: string;
    status: string;
    app: Doc<"gtmApps"> | null;
    deployedAt?: number;
  } | null> => {
    const creator = await resolveMyGtmCreator(ctx);
    if (!creator) return null;
    const agent = await ctx.db
      .query("gtmAgents")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .first();
    const app = agent?.appId ? await ctx.db.get(agent.appId) : null;
    return {
      email: creator.email,
      plan: creator.plan,
      status: creator.status,
      app: app ?? null,
      deployedAt: agent?.deployedAt,
    };
  },
});

/** Reversible soft-delete of the caller's OWN account (sets status="deleted").
 *  Auth-scoped — can only ever affect the signed-in operator's row. A hard
 *  purge of all gtm* rows is a follow-up background job; this stops the agent
 *  + hides the account immediately and is reversible. */
/**
 * Soft, REVERSIBLE delete — marks the account `status: "deleted"` (gates
 * Convex reads) but keeps the data recoverable. The in-app "delete account"
 * affordance.
 *
 * S7 note: the PERMANENT purge is `POST /api/account/delete` →
 * `accountDeletion.purgeByClerkUserIdPublic`, which cascade-deletes all ~47
 * GTM tables (cross-tenant learnings exempt) AND destroys the agent's Fly
 * machine via the collected `gtmAgents.openClawFlyAppId`. A Clerk
 * `user.deleted` webhook backstop runs the same purge if a user is removed in
 * Clerk directly. Inbound Telegram hits Fly directly, so only the permanent
 * path — which destroys the machine — truly stops Maya from answering.
 */
export const deleteMyGtmAccount = mutation({
  args: {},
  handler: async (ctx): Promise<{ ok: boolean }> => {
    const creator = await resolveMyGtmCreator(ctx);
    if (!creator) return { ok: false };
    await ctx.db.patch(creator._id, { status: "deleted" });
    return { ok: true };
  },
});

// ───────────────────────── Today — the live activity feed ─────────────────────────

/** The "what Maya is doing/thinking" feed. Most recent first, capped.
 *  Live-subscribed: OpenClaw POSTs → UI updates in real time.
 *
 *  `sinceMs` (optional) bounds the window from below — this is what powers the
 *  Thinking view's Hour / Day / Week filter. The `by_account_and_created`
 *  index makes the range read efficient (`.gte("createdAt", sinceMs)`). When
 *  `sinceMs` is set we raise the cap to 500 so a full week of activity fits;
 *  the Today tab calls it with just `limit` and gets the old behavior.
 *  Kind filtering is done client-side off this single subscription so the
 *  filter chips toggle instantly without a re-query. */
export const getMyAgentActivity = query({
  args: { limit: v.optional(v.number()), sinceMs: v.optional(v.number()) },
  handler: async (ctx, args): Promise<Doc<"gtmAgentActivity">[]> => {
    const creator = await resolveMyGtmCreator(ctx);
    if (!creator) return [];
    const ranged = args.sinceMs !== undefined;
    const cap = Math.min(Math.max(args.limit ?? 30, 1), ranged ? 500 : 100);
    return await ctx.db
      .query("gtmAgentActivity")
      .withIndex("by_account_and_created", (q) =>
        ranged
          ? q.eq("accountId", creator._id).gte("createdAt", args.sinceMs!)
          : q.eq("accountId", creator._id)
      )
      .order("desc")
      .take(cap);
  },
});

// ───────────────────────── activity write (agent-driven) ─────────────────────────

const ACTIVITY_KIND = v.union(
  v.literal("researching"),
  v.literal("found"),
  v.literal("drafted"),
  v.literal("plan_changed"),
  v.literal("posted"),
  v.literal("thinking"),
  v.literal("status")
);

/** Append one activity-feed entry. Called by /lc_gtm/post_activity. Scoped to
 *  the agent's own account. Old entries are pruned (keep the feed bounded). */
export const recordAgentActivity = internalMutation({
  args: {
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    kind: ACTIVITY_KIND,
    summary: v.string(),
    detail: v.optional(v.string()),
    linkedRef: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"gtmAgentActivity">> => {
    const id = await ctx.db.insert("gtmAgentActivity", {
      accountId: args.accountId,
      agentId: args.agentId,
      kind: args.kind,
      summary: args.summary.slice(0, 500),
      detail: args.detail?.slice(0, 4000),
      linkedRef: args.linkedRef,
      createdAt: Date.now(),
    });
    // Keep the feed durable enough for the Thinking view's Week filter while
    // still bounded: retain the last 30 days, and cap at 1500 rows as a
    // hard upper bound so a runaway-chatty agent can't grow it unbounded.
    // (Old policy kept only 200 rows, which a busy week could blow past —
    // breaking the Week view.)
    const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
    const HARD_CAP = 1500;
    const cutoff = Date.now() - RETENTION_MS;
    const all = await ctx.db
      .query("gtmAgentActivity")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .collect();
    const sorted = all.sort((a, b) => a.createdAt - b.createdAt);
    // Survivors = the most-recent HARD_CAP rows; delete anything older than
    // the survivor set OR older than the retention cutoff.
    const keep = new Set(sorted.slice(-HARD_CAP).map((r) => r._id));
    for (const row of sorted) {
      if (!keep.has(row._id) || row.createdAt < cutoff) {
        await ctx.db.delete(row._id);
      }
    }
    return id;
  },
});
