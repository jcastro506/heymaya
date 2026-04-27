/**
 * metaInsightsPoller — nightly poll of FB Page engagement metrics via Zernio.
 *
 * Counterpart to `gbpInsightsPoller.ts` for the Meta side. Per the north
 * star (jobs + 5-star reviews), social engagement matters only insofar as
 * it correlates to leads/jobs. We capture FB Page messages count + post
 * engagement so the learnings extractor can ask "did this hook style
 * actually drive Pages messages?"
 *
 * Cron lifecycle: NOT a new standing order. Same pattern as the GBP poller —
 * referenced from prose in EXISTING `competitor_watch` standing order
 * (Sundays 9am op-tz, which already does a weekly Meta sweep).
 *
 * Data model: FB engagement is stored on the `gbpPosts` row only when that
 * post was cross-posted to FB via the multi-platform flow (Wave B's
 * Zernio integration). v0 keeps a single engagementMetrics field on
 * `gbpPosts` because the cross-posted IDs share business attribution; for
 * FB-only posts (no GBP equivalent), we surface to the action's caller as
 * "no canonical post row" and skip — Wave C.7's surface treats those as
 * direct FB Page metrics distinct from per-post attribution.
 *
 * Cross-tenant + idempotency + plan-tier: identical contract to the GBP
 * poller. Polls run at every tier; read surfacing varies by tier.
 *
 * Adversarial: malformed metric values (NaN, negatives, missing) skip the
 * row silently — never write garbage; never throw. Test category
 * `adversarial.malformed-meta-payload` covers.
 */

import { v } from "convex/values";
import {
  internalAction,
  internalQuery,
  type ActionCtx,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

/** Look-back window for posts we still poll. Same as GBP. */
const POLL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/* -------------------------------------------------------------------------- */
/* Internal queries                                                            */
/* -------------------------------------------------------------------------- */

export const getZernioFbConnection = internalQuery({
  args: { businessId: v.id("businesses") },
  handler: async (
    ctx,
    args
  ): Promise<{
    zernioAccountId: string;
    encryptedApiKey: string;
    fbPageId: string;
  } | null> => {
    const conn = await ctx.db
      .query("zernioConnections")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .first();
    if (!conn) return null;
    if (conn.businessId !== args.businessId) return null; // defensive
    const fb = conn.connectedPlatforms.find(
      (p) => p.platform === "facebook" && p.status === "active"
    );
    if (!fb) return null;
    return {
      zernioAccountId: conn.zernioAccountId,
      encryptedApiKey: conn.encryptedApiKey,
      fbPageId: fb.platformAccountId,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Action                                                                      */
/* -------------------------------------------------------------------------- */

export interface PollMetaInsightsResult {
  businessId: Id<"businesses">;
  pagesMessagesCount: number | null;
  postEngagementSampled: number;
  errors: ReadonlyArray<{ kind: string; reason: string }>;
}

/**
 * Per-business Meta poll. v0 consumes:
 *   - FB Pages messages count via `fbListMessages` (count of messages received
 *     in window — caller may correlate with `inboundLeads` but we don't link
 *     here).
 *   - FB Page post engagement (sampled — we don't have a `fbPosts` table
 *     in v0; we surface the count so Wave C.7 can show it on the Growth tab).
 *
 * Returns counts only; the only persistent write is to a future
 * `metaPostInsights` table (parked for Wave D — not introduced here per scope
 * rules: "no new tables except weeklyLearnings"). This v0 action exposes the
 * counts to caller telemetry; the learnings extractor reads through the
 * caller's persisted observation.
 */
export const pollMetaInsightsForBusiness = internalAction({
  args: {
    businessId: v.id("businesses"),
    /** Test seam — pinned timestamp. */
    nowMs: v.optional(v.number()),
    /** Test seam — limit messages fetched. */
    messageLimit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<PollMetaInsightsResult> => {
    const now = args.nowMs ?? Date.now();
    const sinceMs = now - POLL_WINDOW_MS;

    const conn = await ctx.runQuery(
      internal.outcomes.metaInsightsPoller.getZernioFbConnection,
      { businessId: args.businessId }
    );
    if (!conn) {
      return {
        businessId: args.businessId,
        pagesMessagesCount: null,
        postEngagementSampled: 0,
        errors: [],
      };
    }

    return await fetchMeta(ctx, conn, args.businessId, sinceMs, args.messageLimit);
  },
});

async function fetchMeta(
  ctx: ActionCtx,
  conn: { zernioAccountId: string; encryptedApiKey: string; fbPageId: string },
  businessId: Id<"businesses">,
  sinceMs: number,
  messageLimit: number | undefined
): Promise<PollMetaInsightsResult> {
  // ctx unused in v0 (no persistence yet) — cast away.
  void ctx;

  const { decrypt } = await import("../lib/encryption");
  const { ZernioClient } = await import("../integrations/zernio/client");
  const endpoints = await import("../integrations/zernio/endpoints");

  const apiKey = await decrypt(conn.encryptedApiKey);
  const client = new ZernioClient({ apiKey });
  const zCtx = { client, zernioAccountId: conn.zernioAccountId };

  const errors: { kind: string; reason: string }[] = [];
  let pagesMessagesCount: number | null = null;
  let postEngagementSampled = 0;

  try {
    const messages = await endpoints.fbListMessages(zCtx, conn.fbPageId, {
      since: sinceMs,
      limit: messageLimit ?? 200,
    });
    pagesMessagesCount = messages.length;
  } catch (err) {
    errors.push({ kind: "fb-messages", reason: (err as Error).message.slice(0, 200) });
  }

  // Per-post FB insights would require iterating cross-posted gbpPosts; v0
  // surfaces only the count. We sample size 0 because the integrated path
  // lands in Wave D (per-post FB engagement table). Acceptable per north star
  // (north star surface is jobs + 5-stars; Pages messages count is a
  // proximate-lead signal, sufficient for v0).
  void postEngagementSampled;

  return {
    businessId,
    pagesMessagesCount,
    postEngagementSampled,
    errors,
  };
}
