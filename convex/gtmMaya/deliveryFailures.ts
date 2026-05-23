import { v } from "convex/values";
import {
  httpAction,
  internalMutation,
  internalQuery,
  query,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";

/**
 * Sprint 14 — Convex endpoint OpenClaw POSTs to when a cron job's announce
 * delivery fails. Wired into every workspace bundle as the cron jobs'
 * `delivery.failureDestination` URL.
 *
 * Contract (matches OpenClaw's documented failureDestination payload):
 *   POST /lc_gtm/delivery_failure
 *   Authorization: Bearer <hookToken>
 *   {
 *     "cronJobId": "gtm_heartbeat",
 *     "agentFlyAppId": "maya-gtm-abc123",
 *     "channel": "telegram",
 *     "recipient": "555111222",
 *     "error": { "class": "channel_blocked", "message": "user blocked the bot" },
 *     "attempt": 3,
 *     "retryAfterMs": 60000
 *   }
 *
 * We dedupe by (agentId, cronJobId) — if a heartbeat keeps failing every
 * 30 minutes for the same reason, we update the existing row's
 * attemptCount + lastSeenAt instead of creating N rows per day. The
 * mission board surfaces unresolved failures.
 *
 * Auth: the hookToken is per-agent (provisioned at deploy in S16). We
 * resolve agentId from the Fly app id and verify the token matches.
 * Bad tokens get 401, never logged. Unknown agentFlyAppId gets 404.
 */

export interface DeliveryFailurePayload {
  cronJobId: string;
  agentFlyAppId: string;
  channel: string;
  recipient: string;
  error: { class: string; message?: string };
  attempt?: number;
  retryAfterMs?: number;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    let acc = 0;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      acc |= (a.charCodeAt(i) ?? 0) ^ (b.charCodeAt(i) ?? 0);
    }
    return false || acc === -1;
  }
  let acc = 0;
  for (let i = 0; i < a.length; i++) {
    acc |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return acc === 0;
}

/**
 * Internal query for the HTTP handler to look up the agent + its
 * hookToken for bearer verification.
 */
export const getAgentForDeliveryAuth = internalQuery({
  args: { agentFlyAppId: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{ agentId: Id<"gtmAgents">; hookToken: string | undefined } | null> => {
    const row = await ctx.db
      .query("gtmAgents")
      .withIndex("by_fly_app", (q) => q.eq("openClawFlyAppId", args.agentFlyAppId))
      .first();
    if (!row) return null;
    return { agentId: row._id, hookToken: row.hookToken };
  },
});

/**
 * Internal mutation that does the actual write. Separate from the
 * httpAction so it's unit-testable without an HTTP round-trip.
 */
export const recordDeliveryFailure = internalMutation({
  args: {
    agentFlyAppId: v.string(),
    cronJobId: v.string(),
    channel: v.string(),
    recipient: v.string(),
    errorClass: v.string(),
    errorMessage: v.optional(v.string()),
    attempt: v.optional(v.number()),
    retryAfterMs: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Id<"gtmDeliveryFailures"> | null> => {
    const agent = await ctx.db
      .query("gtmAgents")
      .withIndex("by_fly_app", (q) => q.eq("openClawFlyAppId", args.agentFlyAppId))
      .first();
    if (!agent) return null;
    const now = Date.now();
    const existing = await ctx.db
      .query("gtmDeliveryFailures")
      .withIndex("by_cron_job", (q) =>
        q.eq("agentId", agent._id).eq("cronJobId", args.cronJobId)
      )
      .first();
    if (existing && !existing.resolvedAt) {
      await ctx.db.patch(existing._id, {
        attemptCount: existing.attemptCount + (args.attempt ?? 1),
        lastSeenAt: now,
        errorClass: args.errorClass,
        errorMessage: args.errorMessage,
        retryAfterMs: args.retryAfterMs,
      });
      return existing._id;
    }
    return await ctx.db.insert("gtmDeliveryFailures", {
      accountId: agent.accountId,
      agentId: agent._id,
      cronJobId: args.cronJobId,
      channel: args.channel,
      recipient: args.recipient,
      errorClass: args.errorClass,
      errorMessage: args.errorMessage,
      attemptCount: args.attempt ?? 1,
      firstSeenAt: now,
      lastSeenAt: now,
      retryAfterMs: args.retryAfterMs,
    });
  },
});

/**
 * HTTP route handler. Mounted at /lc_gtm/delivery_failure via convex/http.ts.
 */
export const deliveryFailureHttp = httpAction(async (ctx, request) => {
  // Bearer auth against the per-agent hookToken.
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response("missing bearer token", { status: 401 });
  }
  const presentedToken = authHeader.slice("Bearer ".length).trim();
  if (presentedToken.length === 0) {
    return new Response("missing bearer token", { status: 401 });
  }

  let body: DeliveryFailurePayload;
  try {
    body = (await request.json()) as DeliveryFailurePayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (
    !body.agentFlyAppId ||
    !body.cronJobId ||
    !body.channel ||
    !body.recipient ||
    !body.error?.class
  ) {
    return new Response("missing required fields", { status: 400 });
  }

  const agent = await ctx.runQuery(
    internal.gtmMaya.deliveryFailures.getAgentForDeliveryAuth,
    { agentFlyAppId: body.agentFlyAppId }
  );
  if (!agent) {
    return new Response("unknown agent", { status: 404 });
  }
  if (!agent.hookToken || !constantTimeEqual(presentedToken, agent.hookToken)) {
    return new Response("bad bearer token", { status: 401 });
  }

  await ctx.runMutation(
    internal.gtmMaya.deliveryFailures.recordDeliveryFailure,
    {
      agentFlyAppId: body.agentFlyAppId,
      cronJobId: body.cronJobId,
      channel: body.channel,
      recipient: body.recipient,
      errorClass: body.error.class,
      errorMessage: body.error.message,
      attempt: body.attempt,
      retryAfterMs: body.retryAfterMs,
    }
  );

  return new Response("ok", { status: 200 });
});

/**
 * Public query for the mission board to surface unresolved failures.
 */
export const getMyDeliveryFailures = query({
  args: {},
  handler: async (ctx): Promise<Doc<"gtmDeliveryFailures">[]> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const creator = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first();
    if (!creator || creator.accountType !== "gtm-agent") return [];
    return await ctx.db
      .query("gtmDeliveryFailures")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .filter((q) => q.eq(q.field("resolvedAt"), undefined))
      .order("desc")
      .take(20);
  },
});
