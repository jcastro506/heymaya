/**
 * Plan-awareness typed-tool endpoint — the LIVE-truth side of Maya's plan
 * awareness.
 *
 * PLAN.md (rendered at deploy from `describePlanForMaya(planFeaturesGtm(agent))`)
 * is the passive snapshot; this endpoint is the live read. Maya calls
 * `get_my_plan` (no args) whenever she's about to tell the founder their tier,
 * explain a limit, or consider an upgrade nudge — so she's never reasoning off a
 * stale deploy-time snapshot.
 *
 * Mirrors the `check_discovery_budget` read pattern exactly: bearer
 * `authenticate(ctx, request)` (yields `auth.accountId` + `auth.agentId`), then
 * a single internalQuery that resolves the agent's `gtmPlanJson` server-side and
 * returns `planFeaturesGtm` + `describePlanForMaya`. It is a READ — no
 * idempotency claim, no CALLBACK_KIND, no callback-kind union entry.
 *
 * AWARENESS ONLY — this never gates anything. `planFeaturesGtm` +
 * `requireFeatureGtm` at the real entry points stay the sole authority; this
 * just lets Maya SEE her plan. The tier is resolved server-side from the agent
 * row (never trusts a client-supplied tier), and the agent is resolved from the
 * bearer token (cross-tenant safe — a token can only read its own agent's plan).
 */

import { v } from "convex/values";
import { httpAction, internalQuery } from "../../_generated/server";
import { internal } from "../../_generated/api";
import {
  planFeaturesGtm,
  describePlanForMaya,
  type GtmPlanFeatures,
} from "../planGtm";

/**
 * Resolve the live plan summary + raw caps for an agent. Internal — the bearer
 * auth already validated the caller owns this agent. Returns null when the agent
 * row is gone (the httpAction maps that to a 404).
 */
export const resolveAgentPlan = internalQuery({
  args: { agentId: v.id("gtmAgents") },
  handler: async (
    ctx,
    args
  ): Promise<{ summary: string; features: GtmPlanFeatures } | null> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return null;
    const features = planFeaturesGtm({ gtmPlanJson: agent.gtmPlanJson });
    return { summary: describePlanForMaya(features), features };
  },
});

/**
 * GET /lc_gtm/get_my_plan — `get_my_plan` typed tool.
 *
 * Returns the founder's live plan summary + the raw caps:
 *   {
 *     summary,                  // describePlanForMaya text (human-readable)
 *     plan, status,             // tier name + lifecycle status
 *     maxActiveChannels,
 *     connectedChannelCap,
 *     autoPostChannelCap,
 *     videoCreditsMonth,
 *     canVideo, canAutoPost
 *   }
 *
 * Read-only: no idempotency claim. Maya calls it before she says anything about
 * the plan, hits a cap, or considers an upgrade nudge.
 */
export const getMyPlanHttp = httpAction(async (ctx, request) => {
  const { authenticate } = await import("./inboundCallback");
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  const resolved = await ctx.runQuery(
    internal.gtmMaya.openclaw.planCallbacks.resolveAgentPlan,
    { agentId: auth.agentId }
  );
  if (!resolved) {
    return new Response("agent not found", { status: 404 });
  }

  const { summary, features } = resolved;
  return new Response(
    JSON.stringify({
      summary,
      plan: features.plan,
      status: features.status,
      maxActiveChannels: features.maxActiveChannels,
      connectedChannelCap: features.connectedChannelCap,
      autoPostChannelCap: features.autoPostChannelCap,
      videoCreditsMonth: features.videoCreditsMonth,
      canVideo: features.canVideo,
      canAutoPost: features.canAutoPost,
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
});
