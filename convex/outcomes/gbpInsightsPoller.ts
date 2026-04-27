/**
 * gbpInsightsPoller — nightly poll of GBP Insights for engagement metrics.
 *
 * Per `project_north_star_outcomes.md`: behavior signals (calls, directions,
 * website clicks, post views) are GBP local-pack ranking inputs AND the
 * primary outcome metric for "did this post drive demand?" The poller
 * resolves engagement counts for every published `gbpPosts` row from the
 * last 30d and writes `engagementMetrics` + `engagementPolledAt`.
 *
 * IMPORTANT — per-post GBP analytics deprecation (verified 2026-04-27):
 * `LOCAL_POST_VIEWS_SEARCH` and `LOCAL_POST_ACTIONS_CALL_TO_ACTION` were
 * deprecated 2022-11-21 and discontinued 2023-02-20 with NO replacement
 * per Google's deprecation schedule
 * (https://developers.google.com/my-business/content/sunset-dates). The
 * new Performance API (`locations.fetchMultiDailyMetricsTimeSeries`)
 * exposes **location-level metrics only**. Direct GBP partner access
 * does NOT bring per-post metrics back. See
 * `docs/spikes/zernio-capability-audit.md` for the full audit.
 *
 * What this means: `engagementMetrics` per-row on `gbpPosts` will be
 * NULL for GBP-platform posts. Schema field stays additive (forward-
 * compatible if Google ever resurrects). Outcome attribution for GBP
 * posts is therefore **correlational not causal** — "during weeks Maya
 * posted N times, location calls went up X%", not "post P drove K
 * calls". For FB/IG posts, per-post metrics survive and causal
 * attribution holds — the metaInsightsPoller handles those.
 *
 * Cron lifecycle: NOT a new standing order. Per the Wave C.5 scope rules
 * (see `convex/agents/packs/maya_service/standingOrders.ts` length lock at
 * 15), the poller is referenced from the EXISTING `weekly_review`-style
 * standing-order prose (we extend `competitor_watch` + `revenue_snapshot`
 * prose to mention "the outcome poller runs nightly via the action layer").
 * In production OpenClaw triggers it; in v0 the operator's existing
 * heartbeat-cron config wires it. This module is the action implementation.
 *
 * Cross-tenant: every poll iteration takes a single businessId. The action
 * NEVER fans out across businesses in a single call — the orchestrator
 * iterates businesses and calls per-business. This keeps the cross-tenant
 * blast radius bounded to a single Zernio API call per poll.
 *
 * Idempotency: re-polling the same post on the same day OVERWRITES counters
 * (counters are absolute snapshots, not deltas). `engagementPolledAt`
 * captures the latest poll time. A failed poll for a single post never
 * blocks others (per-post try/catch).
 *
 * Plan-tier: runs at every tier. Outcome data is the moat — gating it off
 * is self-defeating. Read surfacing in HQ varies by tier (Wave C.7).
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

/** Look-back window for posts we still poll. Older than this = settled. */
const POLL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Per-business max posts polled in a single run. Bounds runaway spend. */
const MAX_POSTS_PER_RUN = 50;

/* -------------------------------------------------------------------------- */
/* Internal queries / mutations                                                */
/* -------------------------------------------------------------------------- */

/**
 * Resolve the (decryptable) Zernio connection for this business. Returns
 * null when the business has no active GBP connection — caller short-
 * circuits silently in that case.
 */
export const getZernioConnectionForPoll = internalQuery({
  args: { businessId: v.id("businesses") },
  handler: async (
    ctx,
    args
  ): Promise<{
    zernioAccountId: string;
    encryptedApiKey: string;
    gbpPlatformAccountId: string;
  } | null> => {
    const conn = await ctx.db
      .query("zernioConnections")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .first();
    if (!conn) return null;
    if (conn.businessId !== args.businessId) return null; // defensive
    const gbp = conn.connectedPlatforms.find(
      (p) => p.platform === "gbp" && p.status === "active"
    );
    if (!gbp) return null;
    return {
      zernioAccountId: conn.zernioAccountId,
      encryptedApiKey: conn.encryptedApiKey,
      gbpPlatformAccountId: gbp.platformAccountId,
    };
  },
});

/**
 * Pull the recent published posts that need polling, scoped strictly by
 * businessId. Cross-tenant safety: index `by_business`.
 */
export const listPostsForPoll = internalQuery({
  args: {
    businessId: v.id("businesses"),
    sinceMs: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Array<Doc<"gbpPosts">>> => {
    const limit = Math.max(1, Math.min(args.limit ?? MAX_POSTS_PER_RUN, MAX_POSTS_PER_RUN));
    const rows = await ctx.db
      .query("gbpPosts")
      .withIndex("by_business_and_status", (q) =>
        q.eq("businessId", args.businessId).eq("status", "posted")
      )
      .collect();
    return rows
      .filter((r) => (r.postedAt ?? 0) >= args.sinceMs)
      .sort((a, b) => (b.postedAt ?? 0) - (a.postedAt ?? 0))
      .slice(0, limit);
  },
});

/**
 * Persist polled metrics. Cross-tenant guarded — refuses to write if the
 * post.businessId doesn't match.
 */
export const persistPostMetrics = internalMutation({
  args: {
    businessId: v.id("businesses"),
    postId: v.id("gbpPosts"),
    metrics: v.object({
      callsClicked: v.number(),
      directionsClicked: v.number(),
      websiteClicked: v.number(),
      postViews: v.number(),
    }),
    polledAt: v.number(),
  },
  handler: async (ctx, args): Promise<void> => {
    const post = await ctx.db.get(args.postId);
    if (!post) {
      throw new Error(`gbpInsightsPoller: post ${args.postId} not found.`);
    }
    if (post.businessId !== args.businessId) {
      throw new Error(
        "gbpInsightsPoller.persistPostMetrics: cross-tenant violation."
      );
    }
    // Validation — counters cannot be negative or NaN (adversarial guard
    // against malformed Zernio JSON).
    for (const k of ["callsClicked", "directionsClicked", "websiteClicked", "postViews"] as const) {
      const v = args.metrics[k];
      if (!Number.isFinite(v) || v < 0) {
        throw new Error(
          `gbpInsightsPoller: malformed metric ${k}=${v}; refusing write.`
        );
      }
    }
    await ctx.db.patch(args.postId, {
      engagementMetrics: args.metrics,
      engagementPolledAt: args.polledAt,
      updatedAt: Date.now(),
    });
  },
});

/* -------------------------------------------------------------------------- */
/* Action — orchestrates the poll                                             */
/* -------------------------------------------------------------------------- */

/**
 * Map of GBP Insights metric name → our `engagementMetrics` field. Maps to
 * Zernio's normalized metric vocabulary (see `convex/integrations/zernio/types.ts`
 * `GbpInsightsRequest.metrics`). Names are stable; values are absolute counts.
 */
function rollupMetrics(
  rows: ReadonlyArray<{ name: string; value: number }>
): {
  callsClicked: number;
  directionsClicked: number;
  websiteClicked: number;
  postViews: number;
} {
  let calls = 0;
  let directions = 0;
  let website = 0;
  let views = 0;
  for (const row of rows) {
    if (!Number.isFinite(row.value) || row.value < 0) continue;
    switch (row.name) {
      case "ACTIONS_PHONE":
        calls += row.value;
        break;
      case "ACTIONS_DRIVING_DIRECTIONS":
        directions += row.value;
        break;
      case "ACTIONS_WEBSITE":
        website += row.value;
        break;
      case "VIEWS_SEARCH":
      case "VIEWS_MAPS":
      case "PHOTOS_VIEWS":
        views += row.value;
        break;
      default:
        // Unknown metric name → skip silently (forward-compat with Zernio).
        break;
    }
  }
  return {
    callsClicked: calls,
    directionsClicked: directions,
    websiteClicked: website,
    postViews: views,
  };
}

export interface PollGbpInsightsResult {
  businessId: Id<"businesses">;
  postsPolled: number;
  postsSkipped: number;
  errors: ReadonlyArray<{ postId: string; reason: string }>;
}

/**
 * Per-business poll. Caller (a multi-business orchestrator OR OpenClaw cron
 * driver) iterates businesses + calls this once each. Idempotent + isolated.
 */
export const pollGbpInsightsForBusiness = internalAction({
  args: {
    businessId: v.id("businesses"),
    /** Test seam — pinned timestamp. */
    nowMs: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<PollGbpInsightsResult> => {
    const now = args.nowMs ?? Date.now();
    const sinceMs = now - POLL_WINDOW_MS;

    const conn = await ctx.runQuery(
      internal.outcomes.gbpInsightsPoller.getZernioConnectionForPoll,
      { businessId: args.businessId }
    );
    if (!conn) {
      return {
        businessId: args.businessId,
        postsPolled: 0,
        postsSkipped: 0,
        errors: [],
      };
    }

    const posts = await ctx.runQuery(
      internal.outcomes.gbpInsightsPoller.listPostsForPoll,
      { businessId: args.businessId, sinceMs }
    );
    if (posts.length === 0) {
      return {
        businessId: args.businessId,
        postsPolled: 0,
        postsSkipped: 0,
        errors: [],
      };
    }

    return await fetchAndPersist(ctx, conn, posts, args.businessId, now);
  },
});

async function fetchAndPersist(
  ctx: ActionCtx,
  conn: {
    zernioAccountId: string;
    encryptedApiKey: string;
    gbpPlatformAccountId: string;
  },
  posts: ReadonlyArray<Doc<"gbpPosts">>,
  businessId: Id<"businesses">,
  now: number
): Promise<PollGbpInsightsResult> {
  const { decrypt } = await import("../lib/encryption");
  const { ZernioClient } = await import("../integrations/zernio/client");
  const endpoints = await import("../integrations/zernio/endpoints");

  const apiKey = await decrypt(conn.encryptedApiKey);
  const client = new ZernioClient({ apiKey });
  const zCtx = { client, zernioAccountId: conn.zernioAccountId };

  const errors: { postId: string; reason: string }[] = [];
  let polled = 0;
  let skipped = 0;

  for (const post of posts) {
    if (post.businessId !== businessId) {
      // Defensive — index already pinned this; refuse to act anyway.
      errors.push({ postId: String(post._id), reason: "cross-tenant-row" });
      continue;
    }
    if (!post.gbpLocalPostId) {
      // Post not yet published end-to-end — nothing to poll.
      skipped += 1;
      continue;
    }
    const startAt = post.postedAt ?? now - POLL_WINDOW_MS;
    try {
      const insights = await endpoints.gbpGetInsights(
        zCtx,
        conn.gbpPlatformAccountId,
        {
          startAt,
          endAt: now,
          metrics: [
            "ACTIONS_PHONE",
            "ACTIONS_DRIVING_DIRECTIONS",
            "ACTIONS_WEBSITE",
            "VIEWS_SEARCH",
            "VIEWS_MAPS",
            "PHOTOS_VIEWS",
          ],
        }
      );
      const rolled = rollupMetrics(insights.metrics);
      await ctx.runMutation(
        internal.outcomes.gbpInsightsPoller.persistPostMetrics,
        {
          businessId,
          postId: post._id,
          metrics: rolled,
          polledAt: now,
        }
      );
      polled += 1;
    } catch (err) {
      const reason = (err as Error).message.slice(0, 200);
      errors.push({ postId: String(post._id), reason });
    }
  }

  return {
    businessId,
    postsPolled: polled,
    postsSkipped: skipped,
    errors,
  };
}
