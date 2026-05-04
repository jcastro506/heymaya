/**
 * Creator usage analytics — admin queries.
 *
 * Internal-only queries the operator runs via:
 *   npx convex run queries/admin/usage:usageRollup '{"rangeStart":<ms>,"rangeEnd":<ms>}'
 *   npx convex run queries/admin/usage:creatorEngagementProfile '{"creatorId":"...","rangeStart":<ms>,"rangeEnd":<ms>}'
 *   npx convex run queries/admin/usage:topCreatorsByEngagement '{}'
 *
 * Exposure model — these are `internalQuery` so they CANNOT be invoked
 * over a public Convex client. The CLI `convex run` path requires the
 * deploy key, which only the operator has. No HTTP route, no Next.js API
 * route, no client-side `useQuery` call wires into this file. Adding a
 * dashboard later is a follow-up; today queries-only is enough.
 *
 * Cross-tenant safety:
 *   - `usageRollup`: scans by (kind, ts) / (label, ts) globally — no per-creator
 *     data leaks because the output is aggregate counts only.
 *   - `creatorEngagementProfile`: takes an explicit `creatorId` arg and
 *     scans only that creator's slice of `usageEvents` via
 *     `by_creator_and_ts`. The operator passes the id; there's no creator-
 *     supplied input that could spoof it.
 *   - `topCreatorsByEngagement`: scans the `creators` table directly,
 *     filtering on the denormalized `engagementScore7d` column. No
 *     `usageEvents` cross-creator scan needed.
 *
 * Five mandatory test categories — covered in
 * `convex/queries/admin/__tests__/usage.test.ts`.
 */

import { v } from "convex/values";
import { internalQuery } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";

/* -------------------------------------------------------------------------- */
/* Shared types                                                               */
/* -------------------------------------------------------------------------- */

export type UsageRollupResult = {
  totalEvents: number;
  byKind: Record<string, number>;
  byLabel: ReadonlyArray<{ label: string; count: number }>;
  creatorsActive: number;
};

export type CreatorEngagementProfileResult = {
  eventsByKind: Record<string, number>;
  eventsByLabel: ReadonlyArray<{ label: string; count: number }>;
  /** Distribution of `signal` values for `reaction_received` events. */
  reactionDistribution: Record<string, number>;
  /**
   * action_taken vs action_ignored ratio. Returns null if neither kind has
   * fired in the window (no signal yet — UI should render "—").
   */
  replyVsIgnoreRate: {
    taken: number;
    ignored: number;
    /** taken / (taken + ignored), or null if denominator is 0. */
    ratio: number | null;
  };
  /** Daily chat_turn_in counts, keyed by `YYYY-MM-DD` (UTC). */
  chatTurnsByDay: ReadonlyArray<{ day: string; count: number }>;
};

export type TopCreatorRow = {
  creatorId: Id<"creators">;
  handle: string | undefined;
  plan: Doc<"creators">["plan"];
  engagementScore7d: number;
  topSkillLast7d: string | undefined;
  lastEngagedAt: number | undefined;
};

const DEFAULT_TOP_LIMIT = 50;
const MAX_TOP_LIMIT = 500;

/* -------------------------------------------------------------------------- */
/* usageRollup                                                                */
/* -------------------------------------------------------------------------- */

/**
 * All-creators rollup over `[rangeStart, rangeEnd]` (ms, inclusive of start,
 * exclusive of end). Returns aggregate counts only — no creator-identifying
 * data is exposed.
 *
 * Implementation: scans `usageEvents` via the `by_kind_and_ts` index per
 * kind. We iterate the 8 kinds explicitly so we can use the index range.
 * `byLabel` is built by scanning `by_label_and_ts` for `cron_fired` +
 * `event_fired` entries (where labels are most informative); chat-turn
 * labels are folded in too if present.
 */
export const usageRollup = internalQuery({
  args: {
    rangeStart: v.number(),
    rangeEnd: v.number(),
  },
  handler: async (ctx, args): Promise<UsageRollupResult> => {
    if (args.rangeEnd <= args.rangeStart) {
      return {
        totalEvents: 0,
        byKind: {},
        byLabel: [],
        creatorsActive: 0,
      };
    }

    // Single scan over the time window. We use `by_kind_and_ts` only when we
    // know we want to slice by kind; for the rollup we want everything in
    // the window so we use a full-table scan filtered by ts. To avoid
    // unbounded scans we cap at 100k events per query — far above any v0
    // beta volume.
    const events = await ctx.db
      .query("usageEvents")
      .filter((q) =>
        q.and(
          q.gte(q.field("ts"), args.rangeStart),
          q.lt(q.field("ts"), args.rangeEnd)
        )
      )
      .take(100_000);

    const byKind: Record<string, number> = {};
    const labelCounts = new Map<string, number>();
    const creatorSet = new Set<string>();

    for (const e of events) {
      byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
      if (e.label) {
        labelCounts.set(e.label, (labelCounts.get(e.label) ?? 0) + 1);
      }
      creatorSet.add(String(e.creatorId));
    }

    const byLabel = Array.from(labelCounts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.label.localeCompare(b.label);
      });

    return {
      totalEvents: events.length,
      byKind,
      byLabel,
      creatorsActive: creatorSet.size,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* creatorEngagementProfile                                                   */
/* -------------------------------------------------------------------------- */

/**
 * One creator's engagement profile over `[rangeStart, rangeEnd]`.
 *
 * Cross-tenant safety: the `creatorId` arg is operator-supplied (from the
 * CLI). We index-scan via `by_creator_and_ts` so no other creator's data
 * is touched.
 */
export const creatorEngagementProfile = internalQuery({
  args: {
    creatorId: v.id("creators"),
    rangeStart: v.number(),
    rangeEnd: v.number(),
  },
  handler: async (ctx, args): Promise<CreatorEngagementProfileResult> => {
    if (args.rangeEnd <= args.rangeStart) {
      return {
        eventsByKind: {},
        eventsByLabel: [],
        reactionDistribution: {},
        replyVsIgnoreRate: { taken: 0, ignored: 0, ratio: null },
        chatTurnsByDay: [],
      };
    }

    const events = await ctx.db
      .query("usageEvents")
      .withIndex("by_creator_and_ts", (q) =>
        q
          .eq("creatorId", args.creatorId)
          .gte("ts", args.rangeStart)
          .lt("ts", args.rangeEnd)
      )
      .take(100_000);

    const eventsByKind: Record<string, number> = {};
    const labelCounts = new Map<string, number>();
    const reactionDistribution: Record<string, number> = {};
    let taken = 0;
    let ignored = 0;
    const dayCounts = new Map<string, number>();

    for (const e of events) {
      eventsByKind[e.kind] = (eventsByKind[e.kind] ?? 0) + 1;
      if (e.label) {
        labelCounts.set(e.label, (labelCounts.get(e.label) ?? 0) + 1);
      }
      if (e.kind === "reaction_received" && e.signal) {
        reactionDistribution[e.signal] =
          (reactionDistribution[e.signal] ?? 0) + 1;
      }
      if (e.kind === "action_taken") taken += 1;
      if (e.kind === "action_ignored") ignored += 1;
      if (e.kind === "chat_turn_in") {
        const day = msToYyyyMmDdUtc(e.ts);
        dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
      }
    }

    const eventsByLabel = Array.from(labelCounts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.label.localeCompare(b.label);
      });

    const denominator = taken + ignored;
    const replyVsIgnoreRate = {
      taken,
      ignored,
      ratio: denominator === 0 ? null : taken / denominator,
    };

    const chatTurnsByDay = Array.from(dayCounts.entries())
      .map(([day, count]) => ({ day, count }))
      .sort((a, b) => a.day.localeCompare(b.day));

    return {
      eventsByKind,
      eventsByLabel,
      reactionDistribution,
      replyVsIgnoreRate,
      chatTurnsByDay,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* topCreatorsByEngagement                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Top creators by `engagementScore7d` (descending).
 *
 * Reads only the denormalized scoreboard columns on `creators`. No
 * `usageEvents` scan — the helper updates these columns on every event so
 * this query is O(creators).
 *
 * Tie-break: lexicographically by creatorId so the order is deterministic
 * across calls.
 */
export const topCreatorsByEngagement = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<ReadonlyArray<TopCreatorRow>> => {
    const limit = Math.max(
      1,
      Math.min(MAX_TOP_LIMIT, args.limit ?? DEFAULT_TOP_LIMIT)
    );

    // Scan creators table — cap at 10k rows. Beyond that the operator
    // should narrow with a different query (we're not at that scale yet).
    const creators = await ctx.db.query("creators").take(10_000);

    const ranked = creators
      .map((c): TopCreatorRow => ({
        creatorId: c._id,
        handle: c.primaryHandle,
        plan: c.plan,
        engagementScore7d: c.engagementScore7d ?? 0,
        topSkillLast7d: c.topSkillLast7d,
        lastEngagedAt: c.lastEngagedAt,
      }))
      .sort((a, b) => {
        if (b.engagementScore7d !== a.engagementScore7d) {
          return b.engagementScore7d - a.engagementScore7d;
        }
        return String(a.creatorId).localeCompare(String(b.creatorId));
      })
      .slice(0, limit);

    return ranked;
  },
});

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * UTC `YYYY-MM-DD` from a unix-ms timestamp. Kept UTC because creators span
 * timezones and the operator wants a single global view; switching to local
 * date per creator is a follow-up if/when needed.
 */
function msToYyyyMmDdUtc(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
