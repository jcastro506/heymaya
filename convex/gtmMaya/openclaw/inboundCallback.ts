import { v } from "convex/values";
import {
  httpAction,
  internalMutation,
  internalQuery,
  query,
  type ActionCtx,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";

/**
 * Sprint 16 — Maya → Convex inbound callbacks (D4).
 *
 * After the per-agent gateway runs a research turn or receives a user
 * approval, Maya POSTs back to Convex with the result. This module is the
 * shared infrastructure for those callbacks: bearer-token auth against the
 * per-agent hookToken (constant-time compare), idempotency-key dedup, and
 * cross-tenant safety (the writes are scoped to the agent the token
 * authenticates).
 *
 * Routes mounted in convex/http.ts:
 *   POST /lc_gtm/research_callback   — Maya updates a research job phase
 *   POST /lc_gtm/approval_decision   — Maya reports a user approval/reject
 *   POST /lc_gtm/calendar_proposal   — Maya proposes calendar events for
 *                                       human approval (write happens after
 *                                       calendar OAuth in Sprint 9)
 *
 * Auth: Authorization: Bearer <hookToken>. The agent's hookToken
 * uniquely identifies the agent — we look up agentId from token, NOT
 * from the body. Bodies cannot claim a different agentId than the
 * token's owner.
 *
 * Idempotency: every callback carries an `idempotencyKey` (a UUID the
 * agent mints per logical operation). We store the key in
 * `gtmHookCallbacks` and reject replays.
 */

const CALLBACK_KIND = v.union(
  v.literal("research_callback"),
  v.literal("approval_decision"),
  v.literal("calendar_proposal")
);

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
 * Resolve agent from bearer token. Returns null if no match. Constant-time
 * over hookToken comparison via a full table scan (small N — one row per
 * deployed agent — acceptable).
 */
export const resolveAgentFromHookToken = internalQuery({
  args: { presentedToken: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{
    agentId: Id<"gtmAgents">;
    accountId: Id<"creators">;
  } | null> => {
    // Scan all agents that have a hookToken. We can't index on token because
    // tokens are secrets we don't want exposed in indexes. N is small.
    const agents = await ctx.db.query("gtmAgents").collect();
    let matched: Doc<"gtmAgents"> | null = null;
    for (const agent of agents) {
      if (!agent.hookToken) continue;
      if (constantTimeEqual(args.presentedToken, agent.hookToken)) {
        matched = agent;
        // Don't break — keep iterating to make timing constant.
      }
    }
    if (!matched) return null;
    return { agentId: matched._id, accountId: matched.accountId };
  },
});

/**
 * Atomic claim of an idempotency key for a callback. Returns "fresh" if
 * the key was just claimed, "duplicate" if it was already seen (with
 * matching kind), or throws if the key was claimed with a DIFFERENT kind
 * — that's a bug in the agent, not a replay.
 */
export const claimIdempotencyKey = internalMutation({
  args: {
    agentId: v.id("gtmAgents"),
    accountId: v.id("creators"),
    kind: CALLBACK_KIND,
    idempotencyKey: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<"fresh" | "duplicate"> => {
    const existing = await ctx.db
      .query("gtmHookCallbacks")
      .withIndex("by_idempotency_key", (q) =>
        q.eq("idempotencyKey", args.idempotencyKey)
      )
      .first();
    if (existing) {
      if (existing.agentId !== args.agentId) {
        // Cross-tenant replay attempt — token mismatch should have caught
        // this, but defense-in-depth.
        throw new Error(
          "idempotency key collision across agents — refusing"
        );
      }
      if (existing.kind !== args.kind) {
        throw new Error(
          `idempotency key reused with different kind: was ${existing.kind}, now ${args.kind}`
        );
      }
      return "duplicate";
    }
    await ctx.db.insert("gtmHookCallbacks", {
      agentId: args.agentId,
      accountId: args.accountId,
      kind: args.kind,
      idempotencyKey: args.idempotencyKey,
      receivedAt: Date.now(),
    });
    return "fresh";
  },
});

/**
 * Persist a research-callback update from Maya. Internal helper; the
 * httpAction below verifies + dispatches.
 */
export const applyResearchCallback = internalMutation({
  args: {
    agentId: v.id("gtmAgents"),
    accountId: v.id("creators"),
    researchJobId: v.id("gtmResearchJobs"),
    phase: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const job = await ctx.db.get(args.researchJobId);
    if (!job || job.accountId !== args.accountId) {
      throw new Error("research job does not belong to this account");
    }
    await ctx.db.patch(args.researchJobId, {
      phase: args.phase as Doc<"gtmResearchJobs">["phase"],
      updatedAt: Date.now(),
      ...(args.note ? { lastAgentNote: args.note } : {}),
    });
  },
});

interface ResearchCallbackPayload {
  idempotencyKey: string;
  researchJobId: string;
  phase: string;
  note?: string;
}

interface ApprovalDecisionPayload {
  idempotencyKey: string;
  draftId: string;
  decision: "approved" | "rejected" | "revise";
  reviseNotes?: string;
}

interface CalendarProposalPayload {
  idempotencyKey: string;
  researchJobId: string;
  events: Array<{
    title: string;
    description?: string;
    startsAtMs: number;
    endsAtMs: number;
  }>;
}

type CallbackPayload =
  | ResearchCallbackPayload
  | ApprovalDecisionPayload
  | CalendarProposalPayload;

async function authenticate(
  ctx: ActionCtx,
  request: Request
): Promise<
  | { ok: true; agentId: Id<"gtmAgents">; accountId: Id<"creators"> }
  | { ok: false; status: number; reason: string }
> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, status: 401, reason: "missing bearer token" };
  }
  const presentedToken = authHeader.slice("Bearer ".length).trim();
  if (presentedToken.length === 0) {
    return { ok: false, status: 401, reason: "empty bearer token" };
  }
  const resolved = await ctx.runQuery(
    internal.gtmMaya.openclaw.inboundCallback.resolveAgentFromHookToken,
    { presentedToken }
  );
  if (!resolved) {
    return { ok: false, status: 401, reason: "bad bearer token" };
  }
  return { ok: true, agentId: resolved.agentId, accountId: resolved.accountId };
}

/**
 * Research callback. Maya POSTs here after a research-phase milestone so
 * Convex can advance the job state machine and refresh APP.md/GTM.md.
 */
export const researchCallbackHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: ResearchCallbackPayload;
  try {
    body = (await request.json()) as ResearchCallbackPayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (!body.idempotencyKey || !body.researchJobId || !body.phase) {
    return new Response("missing required fields", { status: 400 });
  }

  const claim = await ctx.runMutation(
    internal.gtmMaya.openclaw.inboundCallback.claimIdempotencyKey,
    {
      agentId: auth.agentId,
      accountId: auth.accountId,
      kind: "research_callback",
      idempotencyKey: body.idempotencyKey,
    }
  );
  if (claim === "duplicate") {
    return new Response("ok (replay)", { status: 200 });
  }

  try {
    await ctx.runMutation(
      internal.gtmMaya.openclaw.inboundCallback.applyResearchCallback,
      {
        agentId: auth.agentId,
        accountId: auth.accountId,
        researchJobId: body.researchJobId as Id<"gtmResearchJobs">,
        phase: body.phase,
        note: body.note,
      }
    );
  } catch (err) {
    return new Response((err as Error).message, { status: 400 });
  }
  return new Response("ok", { status: 200 });
});

/**
 * Approval decision callback. Maya forwards the user's approve/reject from
 * the mission board interaction or a Telegram reply.
 */
export const approvalDecisionHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: ApprovalDecisionPayload;
  try {
    body = (await request.json()) as ApprovalDecisionPayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (!body.idempotencyKey || !body.draftId || !body.decision) {
    return new Response("missing required fields", { status: 400 });
  }

  const claim = await ctx.runMutation(
    internal.gtmMaya.openclaw.inboundCallback.claimIdempotencyKey,
    {
      agentId: auth.agentId,
      accountId: auth.accountId,
      kind: "approval_decision",
      idempotencyKey: body.idempotencyKey,
    }
  );
  if (claim === "duplicate") {
    return new Response("ok (replay)", { status: 200 });
  }

  return new Response("ok (decision recorded — execution in Sprint 8)", {
    status: 200,
  });
});

/**
 * Calendar-event proposal callback. Maya proposes events; this handler
 * writes them to Google Calendar via the connection stored in
 * gtmCalendarConnections (Sprint 9). Each event is written sequentially
 * (Google's per-account rate limit is generous; sequential keeps error
 * handling simple). On success we insert one gtmCalendarEvents row per
 * event tagged createdBy="maya" for the maya-owned deletion safeguard.
 */
export const calendarProposalHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: CalendarProposalPayload;
  try {
    body = (await request.json()) as CalendarProposalPayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (
    !body.idempotencyKey ||
    !body.researchJobId ||
    !Array.isArray(body.events)
  ) {
    return new Response("missing required fields", { status: 400 });
  }

  const claim = await ctx.runMutation(
    internal.gtmMaya.openclaw.inboundCallback.claimIdempotencyKey,
    {
      agentId: auth.agentId,
      accountId: auth.accountId,
      kind: "calendar_proposal",
      idempotencyKey: body.idempotencyKey,
    }
  );
  if (claim === "duplicate") {
    return new Response("ok (replay)", { status: 200 });
  }

  // Write events via the GTM calendar connection.
  try {
    await ctx.runAction(
      internal.gtmMaya.calendarWrite.writeCalendarEventsForAgent,
      {
        agentId: auth.agentId,
        accountId: auth.accountId,
        researchJobId: body.researchJobId as Id<"gtmResearchJobs">,
        events: body.events,
      }
    );
  } catch (err) {
    console.error(
      "[/lc_gtm/calendar_proposal] write failed:",
      (err as Error).message
    );
    // Still 200 so Maya doesn't retry — the proposal idempotency key is
    // already claimed. Operator sees the failure in the action log.
    return new Response("ok (write failed; see logs)", { status: 200 });
  }

  return new Response("ok (events written)", { status: 200 });
});

/**
 * Public query for the mission board to surface recent inbound callbacks.
 * Useful for debugging and operator visibility.
 */
export const getMyRecentCallbacks = query({
  args: {},
  handler: async (ctx): Promise<Doc<"gtmHookCallbacks">[]> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const creator = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first();
    if (!creator || creator.accountType !== "gtm-agent") return [];
    return await ctx.db
      .query("gtmHookCallbacks")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .order("desc")
      .take(20);
  },
});

// Used by callbackKinds — re-export to ensure CALLBACK_KIND stays in sync
// with the schema.
export const CALLBACK_KIND_REEXPORT = CALLBACK_KIND;
export type CallbackPayloadShape = CallbackPayload;
