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
  v.literal("calendar_proposal"),
  // Sprint 2.22 — operator-approved Google Calendar push.
  v.literal("calendar_approval"),
  // Sprint 2.1 — deep-research subagent callbacks. Per-platform research
  // subagents (reddit_research, x_research, etc.) POST one row at a time
  // during the FIRST WAKE deep research phase. See
  // convex/gtmMaya/targetList.ts (Sprint 2.2) for the mutation handlers.
  v.literal("target_thread"),
  v.literal("target_account"),
  v.literal("drafted_content"),
  // Sprint 2.17 Phase A — manager-mode foundation + continuous callbacks.
  // Each new write surface gets its own kind so idempotency keys are
  // scoped per-endpoint (a buyer-map write and an action-log write can
  // share a UUID without colliding).
  v.literal("foundation_buyer_map"),
  v.literal("foundation_competitor"),
  v.literal("foundation_channel_scorecard"),
  v.literal("foundation_content_angle"),
  v.literal("foundation_relationship_target"),
  v.literal("competitor_move"),
  v.literal("niche_pulse_signal"),
  v.literal("action_logged"),
  v.literal("learning_extracted"),
  // Sprint B — Maya persists the proposed/approved North Star + entry mode.
  v.literal("set_north_star"),
  // Sprint B — Maya records the strategy approval state (propose→approve gate).
  v.literal("set_strategy_approval"),
  // Sprint C — conversion (signup/demo/feedback) self-report or pixel.
  v.literal("record_conversion"),
  // Sprint J — proposed improvement to a shared skill (Layer 2, governed).
  v.literal("propose_skill_improvement"),
  // Mission Control — agent activity feed entry (drives the web UI Today tab).
  v.literal("post_activity"),
  // Data-collection sprint — inbound user message capture (one per turn).
  v.literal("log_message"),
  // W1.2 — founder corrects a product fact in chat; persisted to gtmApps.
  v.literal("update_product_fact")
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
/**
 * Sprint 2.16b — Maya's send_update endpoint needs the agent's
 * telegramChatId to relay her progress message. Internal query
 * because authenticate() already validated the hookToken.
 */
export const getAgentForSendUpdate = internalQuery({
  args: { agentId: v.id("gtmAgents") },
  handler: async (
    ctx,
    args
  ): Promise<{ telegramChatId: string | undefined } | null> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return null;
    return { telegramChatId: agent.telegramChatId };
  },
});

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

// Exported so Sprint 2.17 manager-mode HTTP handlers in a sibling file
// can reuse the same bearer-token → agent resolution path. The
// signature is stable: returns a discriminated union with either the
// resolved agentId+accountId or a 401 status + reason.
export async function authenticate(
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

  // Sprint 2.22 — STORE-ONLY. Don't push to Google Calendar yet —
  // that happens via /lc_gtm/approve_calendar after operator approves.
  // This decoupling means draft events persist regardless of OAuth
  // state (previously: no OAuth = silent drop).
  try {
    const result = await ctx.runAction(
      internal.gtmMaya.calendarWrite.storeProposedCalendarEvents,
      {
        agentId: auth.agentId,
        accountId: auth.accountId,
        researchJobId: body.researchJobId as Id<"gtmResearchJobs">,
        events: body.events,
      }
    );
    return new Response(
      `ok (${result.stored} events stored as draft; awaiting approval)`,
      { status: 200 }
    );
  } catch (err) {
    console.error(
      "[/lc_gtm/calendar_proposal] store failed:",
      (err as Error).message
    );
    return new Response("ok (store failed; see logs)", { status: 200 });
  }
});

/**
 * Sprint 2.22 — operator-approval gate before Google Calendar push.
 *
 * Maya POSTs to this endpoint AFTER the operator approves the
 * synthesis. Reads all draft gtmCalendarEvents for this agent and
 * pushes them to the operator's connected Google Calendar.
 *
 * Request body: { idempotencyKey } — no events array, since drafts
 *   are looked up server-side by agentId.
 *
 * Response cases:
 *   200 ok pushed:N        — success
 *   200 needs_oauth        — operator must connect Google Calendar
 *                            via /lc_maya/start_google_calendar_oauth
 *   200 no_drafts          — nothing to push (idempotent / already pushed)
 *   400 missing fields     — malformed request
 *   401/403 auth           — invalid hookToken
 *
 * The 200 + needs_oauth shape lets Maya gracefully tell the operator
 * "your calendar isn't connected yet" instead of erroring.
 */
interface ApproveCalendarPayload {
  idempotencyKey: string;
}
export const approveCalendarHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: ApproveCalendarPayload;
  try {
    body = (await request.json()) as ApproveCalendarPayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (!body.idempotencyKey) {
    return new Response("missing required fields", { status: 400 });
  }

  const claim = await ctx.runMutation(
    internal.gtmMaya.openclaw.inboundCallback.claimIdempotencyKey,
    {
      agentId: auth.agentId,
      accountId: auth.accountId,
      kind: "calendar_approval",
      idempotencyKey: body.idempotencyKey,
    }
  );
  if (claim === "duplicate") {
    return new Response("ok (replay)", { status: 200 });
  }

  // Approval gate (server-enforced, not prompt-trust): rich Google Calendar
  // events are pushed onto the operator's real calendar ONLY after they
  // approve. If the strategy isn't `approved` yet, refuse the push — the draft
  // events still live in gtmCalendarEvents + show in the operator's plan, but
  // nothing hits their calendar until they say yes. This is the operator's
  // explicit requirement ("Rich Google cal events get added on user approval").
  const approvalState = await ctx.runQuery(
    internal.gtmMaya.managerStore.getStrategyApprovalState,
    { agentId: auth.agentId, accountId: auth.accountId }
  );
  if (approvalState !== "approved") {
    return new Response(
      `not_approved (strategy state: ${approvalState ?? "unset"}; call set_strategy_approval state=approved after the operator says yes)`,
      { status: 200 }
    );
  }

  try {
    const result = await ctx.runAction(
      internal.gtmMaya.calendarWrite.pushApprovedCalendarEvents,
      { agentId: auth.agentId, accountId: auth.accountId }
    );
    if (result.needsOAuth) {
      return new Response("needs_oauth", { status: 200 });
    }
    return new Response(
      `ok (pushed=${result.pushed} failed=${result.failed})`,
      { status: 200 }
    );
  } catch (err) {
    console.error(
      "[/lc_gtm/approve_calendar] push failed:",
      (err as Error).message
    );
    return new Response("ok (push failed; see logs)", { status: 200 });
  }
});

/* ──────────────────────────────────────────────────────────────────────
 * Sprint 2.1 — Deep-research subagent callbacks.
 *
 * The per-platform _research subagents (reddit_research, x_research,
 * tiktok_research, instagram_research, linkedin_research, hn_research)
 * POST one row at a time during the FIRST WAKE deep research phase.
 * Each row is auth-gated by the parent agent's hookToken — subagents
 * inherit the parent's token via OpenClaw's session credentials.
 *
 * Routes (mounted in convex/http.ts):
 *   POST /lc_gtm/target_thread       — a specific thread/post to engage with
 *   POST /lc_gtm/target_account      — a specific account to follow/engage
 *   POST /lc_gtm/drafted_content     — a pre-written reply/post/draft
 *   POST /lc_gtm/get_my_target_threads — token-auth read of current state
 *
 * Mutations dispatched to convex/gtmMaya/targetList.ts (Sprint 2.2).
 * ────────────────────────────────────────────────────────────────────── */

interface TargetThreadPayload {
  idempotencyKey: string;
  platform: "reddit" | "x" | "hn" | "linkedin" | "instagram" | "tiktok" | "youtube";
  url: string;
  externalId: string;
  title?: string;
  excerpt?: string;
  author?: string;
  subredditOrCommunity?: string;
  currentMetrics?: {
    upvotes?: number;
    comments?: number;
    likes?: number;
    shares?: number;
    views?: number;
  };
  whyItFits: string;
  recommendedAction: "reply" | "lurk" | "upvote_only" | "avoid";
  priorityScore: number;
  researchJobId?: string;
}

export const targetThreadHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: TargetThreadPayload;
  try {
    body = (await request.json()) as TargetThreadPayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  // Sprint 2.18 #8 — relaxed validation. Mandatory: idempotencyKey +
  // platform (enum) + url + externalId (the identity quartet that
  // makes dedupe + scoping safe). Everything else has a default — if
  // the worker forgot to populate whyItFits/recommendedAction/
  // priorityScore, we accept the row with stubs and let Maya's
  // judgment layer (maya-continuous-research SKILL.md gates) catch
  // and steer for more. Hard gates here force workers into 8-retry
  // bounce loops; loose gates + skill-level judgment matches the
  // "trust the LLM" rule.
  if (!body.idempotencyKey || !body.platform || !body.url || !body.externalId) {
    return new Response("missing required fields", { status: 400 });
  }
  // priorityScore: clamp into [0,1] instead of rejecting. Anything
  // outside the range likely means the LLM hallucinated a normalized
  // value — clamp is safer than reject.
  const priorityScore =
    typeof body.priorityScore === "number"
      ? Math.max(0, Math.min(1, body.priorityScore))
      : 0.5;
  const whyItFits = body.whyItFits || "pending — Maya to fill in synthesis";
  const recommendedAction =
    body.recommendedAction &&
    ["reply", "lurk", "upvote_only", "avoid"].includes(body.recommendedAction)
      ? body.recommendedAction
      : "lurk";

  const claim = await ctx.runMutation(
    internal.gtmMaya.openclaw.inboundCallback.claimIdempotencyKey,
    {
      agentId: auth.agentId,
      accountId: auth.accountId,
      kind: "target_thread",
      idempotencyKey: body.idempotencyKey,
    }
  );
  if (claim === "duplicate") {
    return new Response("ok (replay)", { status: 200 });
  }

  try {
    await ctx.runMutation(internal.gtmMaya.targetList.recordTargetThread, {
      agentId: auth.agentId,
      accountId: auth.accountId,
      researchJobId: body.researchJobId as Id<"gtmResearchJobs"> | undefined,
      platform: body.platform,
      url: body.url,
      externalId: body.externalId,
      title: body.title,
      excerpt: body.excerpt,
      author: body.author,
      subredditOrCommunity: body.subredditOrCommunity,
      currentMetrics: body.currentMetrics ?? {},
      whyItFits,
      recommendedAction,
      priorityScore,
    });
  } catch (err) {
    return new Response((err as Error).message, { status: 400 });
  }
  return new Response("ok", { status: 200 });
});

interface TargetAccountPayload {
  idempotencyKey: string;
  platform: "reddit" | "x" | "hn" | "linkedin" | "instagram" | "tiktok" | "youtube";
  handle: string;
  profileUrl: string;
  displayName?: string;
  bio?: string;
  followerCount?: number;
  voiceAnalysis?: string;
  whyItFits: string;
  recommendedAction: "follow_and_engage" | "lurk" | "dm" | "avoid";
  priorityScore: number;
  researchJobId?: string;
}

export const targetAccountHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: TargetAccountPayload;
  try {
    body = (await request.json()) as TargetAccountPayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  // Sprint 2.18 #8 — relaxed validation (see target_thread comment).
  if (!body.idempotencyKey || !body.platform || !body.handle) {
    return new Response("missing required fields", { status: 400 });
  }
  const priorityScore =
    typeof body.priorityScore === "number"
      ? Math.max(0, Math.min(1, body.priorityScore))
      : 0.5;
  const whyItFits = body.whyItFits || "pending — Maya to fill in synthesis";
  const recommendedAction =
    body.recommendedAction &&
    ["follow_and_engage", "lurk", "dm", "avoid"].includes(body.recommendedAction)
      ? body.recommendedAction
      : "lurk";
  const profileUrl = body.profileUrl ?? `https://${body.platform}/${body.handle}`;

  const claim = await ctx.runMutation(
    internal.gtmMaya.openclaw.inboundCallback.claimIdempotencyKey,
    {
      agentId: auth.agentId,
      accountId: auth.accountId,
      kind: "target_account",
      idempotencyKey: body.idempotencyKey,
    }
  );
  if (claim === "duplicate") {
    return new Response("ok (replay)", { status: 200 });
  }

  try {
    await ctx.runMutation(internal.gtmMaya.targetList.recordTargetAccount, {
      agentId: auth.agentId,
      accountId: auth.accountId,
      researchJobId: body.researchJobId as Id<"gtmResearchJobs"> | undefined,
      platform: body.platform,
      handle: body.handle,
      profileUrl,
      displayName: body.displayName,
      bio: body.bio,
      followerCount: body.followerCount,
      voiceAnalysis: body.voiceAnalysis,
      whyItFits,
      recommendedAction,
      priorityScore,
    });
  } catch (err) {
    return new Response((err as Error).message, { status: 400 });
  }
  return new Response("ok", { status: 200 });
});

interface DraftedContentPayload {
  idempotencyKey: string;
  kind: "reply" | "thread" | "post" | "comment" | "dm";
  platform: "reddit" | "x" | "hn" | "linkedin" | "instagram" | "tiktok" | "youtube";
  targetThreadId?: string;
  targetAccountId?: string;
  draftText: string;
  draftSegments?: string[];
  researchJobId?: string;
  // Sprint C — content-attribute tags for attribute→outcome learning.
  attributes?: {
    hookType?: string;
    format?: string;
    tone?: string;
    lengthBucket?: string;
    hasFace?: boolean;
    captionStyle?: string;
    postingWindow?: string;
  };
}

export const draftedContentHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: DraftedContentPayload;
  try {
    body = (await request.json()) as DraftedContentPayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (
    !body.idempotencyKey ||
    !body.kind ||
    !body.platform ||
    !body.draftText
  ) {
    return new Response("missing required fields", { status: 400 });
  }
  if (body.draftText.length > 12000) {
    return new Response("draftText too long (>12000 chars)", { status: 400 });
  }

  const claim = await ctx.runMutation(
    internal.gtmMaya.openclaw.inboundCallback.claimIdempotencyKey,
    {
      agentId: auth.agentId,
      accountId: auth.accountId,
      kind: "drafted_content",
      idempotencyKey: body.idempotencyKey,
    }
  );
  if (claim === "duplicate") {
    return new Response("ok (replay)", { status: 200 });
  }

  try {
    await ctx.runMutation(internal.gtmMaya.targetList.recordDraftedContent, {
      agentId: auth.agentId,
      accountId: auth.accountId,
      researchJobId: body.researchJobId as Id<"gtmResearchJobs"> | undefined,
      kind: body.kind,
      platform: body.platform,
      targetThreadId: body.targetThreadId as
        | Id<"gtmTargetThreads">
        | undefined,
      targetAccountId: body.targetAccountId as
        | Id<"gtmTargetAccounts">
        | undefined,
      draftText: body.draftText,
      draftSegments: body.draftSegments,
      attributes: body.attributes,
    });
  } catch (err) {
    return new Response((err as Error).message, { status: 400 });
  }
  return new Response("ok", { status: 200 });
});

/**
 * Sprint 2.4 — voice-matcher updates the draft's voiceMatchScore +
 * slopCriticPassed fields. Called by Maya after invoking
 * `maya-voice-matcher` on a fresh draft.
 */
interface UpdateDraftVoiceMatchPayload {
  idempotencyKey: string;
  draftId: string;
  voiceMatchScore: number;
  slopCriticPassed: boolean;
  slopCriticFailures?: string[];
  approvalStateUpdate?: "pending_approval" | "rejected";
  userFeedback?: string;
}

export const updateDraftVoiceMatchHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: UpdateDraftVoiceMatchPayload;
  try {
    body = (await request.json()) as UpdateDraftVoiceMatchPayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (
    !body.idempotencyKey ||
    !body.draftId ||
    typeof body.voiceMatchScore !== "number" ||
    typeof body.slopCriticPassed !== "boolean"
  ) {
    return new Response("missing required fields", { status: 400 });
  }
  if (body.voiceMatchScore < 0 || body.voiceMatchScore > 1) {
    return new Response("voiceMatchScore must be in [0, 1]", { status: 400 });
  }

  // Re-use the existing approval-decision idempotency lane so a draft
  // scored twice during a single research run doesn't double-write.
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

  try {
    await ctx.runMutation(
      internal.gtmMaya.targetList.updateDraftedContentVoiceMatch,
      {
        agentId: auth.agentId,
        accountId: auth.accountId,
        draftId: body.draftId as Id<"gtmDraftedContent">,
        voiceMatchScore: body.voiceMatchScore,
        slopCriticPassed: body.slopCriticPassed,
        slopCriticFailures: body.slopCriticFailures,
        approvalStateUpdate: body.approvalStateUpdate,
        userFeedback: body.userFeedback,
      }
    );
  } catch (err) {
    return new Response((err as Error).message, { status: 400 });
  }
  return new Response("ok", { status: 200 });
});

/**
 * Sprint 2.5 — publish an approved drafted_content via Composio. Maya
 * POSTs here after the operator approves the draft (via Telegram reply
 * or mission-board click). Reuses approval_decision idempotency lane.
 */
interface PublishDraftPayload {
  idempotencyKey: string;
  draftId: string;
}

export const publishDraftHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: PublishDraftPayload;
  try {
    body = (await request.json()) as PublishDraftPayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (!body.idempotencyKey || !body.draftId) {
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

  const outcome = await ctx.runAction(
    internal.gtmMaya.publishWorkflow.publishApprovedDraft,
    { draftId: body.draftId as Id<"gtmDraftedContent"> }
  );
  return new Response(JSON.stringify(outcome), {
    status: outcome.ok ? 200 : 200,  // always 200 — caller inspects body.ok
    headers: { "content-type": "application/json" },
  });
});

/**
 * Sprint 2.6 — heartbeat results scan persistence. The
 * published-post-results-scan heartbeat task posts one snapshot per
 * draft per scan. Reuses approval_decision idempotency lane (a draft
 * scanned twice in 6h doesn't double-write).
 */
interface PostResultSnapshotPayload {
  idempotencyKey: string;
  draftId: string;
  platform: "reddit" | "x" | "hn" | "linkedin" | "instagram" | "tiktok" | "youtube";
  providerPostId: string;
  metrics: {
    likes?: number;
    comments?: number;
    shares?: number;
    views?: number;
    upvotes?: number;
    downvotes?: number;
  };
  notes?: string;
}

export const postResultSnapshotHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: PostResultSnapshotPayload;
  try {
    body = (await request.json()) as PostResultSnapshotPayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (
    !body.idempotencyKey ||
    !body.draftId ||
    !body.platform ||
    !body.providerPostId ||
    !body.metrics
  ) {
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

  try {
    await ctx.runMutation(
      internal.gtmMaya.postResults.recordPostResultSnapshot,
      {
        agentId: auth.agentId,
        accountId: auth.accountId,
        draftId: body.draftId as Id<"gtmDraftedContent">,
        platform: body.platform,
        providerPostId: body.providerPostId,
        metrics: body.metrics,
        notes: body.notes,
      }
    );
  } catch (err) {
    return new Response((err as Error).message, { status: 400 });
  }
  return new Response("ok", { status: 200 });
});

/**
 * Sprint 2.10 — outbound voice-contract / slop firewall. Maya POSTs
 * any user-facing draft message here BEFORE sendMessage. Failures
 * return an array of specific reasons + excerpts so the rewrite has
 * concrete targets. No idempotency check (validation is read-only).
 */
interface ValidateOutboundPayload {
  text: string;
}

/**
 * Sprint 2.14a.10 — phase 1 announces how many subagents it spawned.
 * Body: { researchJobId: string, subagentsExpected: number }.
 * Subagents are responsible for POSTing /lc_gtm/subagent_complete
 * when done; we count down from this number to trigger phase 2.
 */
export const phase1AnnounceHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: { researchJobId?: string; subagentsExpected?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (!body.researchJobId || typeof body.subagentsExpected !== "number") {
    return new Response("researchJobId + subagentsExpected required", {
      status: 400,
    });
  }
  if (body.subagentsExpected < 0 || body.subagentsExpected > 50) {
    return new Response("subagentsExpected out of range (0-50)", {
      status: 400,
    });
  }

  const result = await ctx.runMutation(
    internal.gtmMaya.researchWorker.recordSubagentsExpected,
    {
      researchJobId: body.researchJobId as Id<"gtmResearchJobs">,
      count: body.subagentsExpected,
    }
  );
  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : 404,
    headers: { "content-type": "application/json" },
  });
});

/**
 * Sprint 2.14a.10 — subagent completion signal. Body:
 * { researchJobId: string, platform?: string }. Increments the
 * completed counter; when count >= expected, schedules phase 2
 * trigger immediately (no waiting for the +2hr safety-net cron).
 */
export const subagentCompleteHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: { researchJobId?: string; platform?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return new Response("bad json", { status: 400 });
  }

  // A *completion* signal must NEVER fail-closed and strand a worker. Returning
  // 400 on a missing/invalid jobId made the worker see a tool error, retry, and
  // never terminate — a zombie that burned tokens for hours (post-foundation
  // cost loop). In the native-research model a worker often has no jobId at all.
  // Treat missing/unresolvable as a best-effort no-op and ALWAYS return 200.
  if (!body.researchJobId) {
    return new Response(JSON.stringify({ ok: true, noop: "no researchJobId" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    const result = await ctx.runMutation(
      internal.gtmMaya.researchWorker.incrementSubagentsCompleted,
      { researchJobId: body.researchJobId as Id<"gtmResearchJobs"> }
    );

    if (result.readyToFirePhase2) {
      // Schedule (fire-and-forget) — actions can't await actions, and we don't
      // want the subagent's HTTP response gated on the phase-2 round-trip.
      await ctx.scheduler.runAfter(
        0,
        internal.gtmMaya.researchWorker.triggerPhase2,
        {
          researchJobId: body.researchJobId as Id<"gtmResearchJobs">,
          source: "subagent_complete",
        }
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        completed: result.completed,
        expected: result.expected,
        readyToFirePhase2: result.readyToFirePhase2,
        alreadyTriggered: result.alreadyTriggered,
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  } catch {
    // Stale/malformed jobId — accept the signal so the worker terminates cleanly
    // instead of retrying into a loop.
    return new Response(JSON.stringify({ ok: true, noop: "unresolved researchJobId" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
});

/**
 * Sprint 2.16b — Maya's progress-update channel. She POSTs here at
 * milestones during her iterative research loop ("done with reddit,
 * going deeper on r/ollama") so the operator sees life over 30-90
 * min instead of one big delivery at the end.
 *
 * Body: {
 *   text: string,
 *   messageClass?: "strategic" | "tactical" | "accountability",
 *   claims?: Array<{ claim: string, evidence_ids: string[] }>,
 * }
 *
 * Sprint 2.16j — evidence-guard added. Strategic messages MUST carry
 * `claims` (array can be empty only if `messageClass === "tactical"`
 * or "accountability"). Every evidence_id is resolved to a real
 * gtmEvidenceCards row owned by this agent's account. Hard block on
 * any failure — Maya rewrites with real evidence, drops the claim,
 * or sends the degraded "checking sources" fallback per her prompt.
 *
 * Auth: hookToken (same as other /lc_gtm/* endpoints).
 * Pipeline: evidenceGuard (Sprint 2.16j, strategic only)
 *        → outboundFirewall (Sprint 2.10, all messages)
 *        → sendDirectTelegramMessage → Telegram Bot API.
 */
export const sendUpdateHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: {
    text?: string;
    messageClass?: string;
    claims?: Array<{ claim?: string; evidence_ids?: string[] }>;
    // Sprint 2.28 — operator-facing-message critic gate. Maya self-
    // declares whether she ran maya-output-critic's 5 gates before
    // this send (grounding / voice / recipe / tier-honesty / time-box).
    // Strategic messages REQUIRE criticPassed === true; tactical
    // (e.g. mid-pass progress ping) treats false as warning not block.
    criticPassed?: boolean;
    criticReasons?: string[];
    // Data-collection sprint — the turn this reply belongs to. Maya passes
    // the same turnId she used for the inbound /lc_gtm/log_message call so
    // the user message and this reply share a turn in mayaMessages. Absent
    // for proactive/cron pings (no inbound turn) — we synthesize one.
    turnId?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (typeof body.text !== "string" || body.text.length === 0) {
    return new Response("text required", { status: 400 });
  }
  if (body.text.length > 1500) {
    // Telegram has a 4K limit but progress updates should stay terse.
    return new Response("text too long (>1500 chars)", { status: 400 });
  }

  // Sprint 2.16j — evidence guard for strategic messages. Defaults to
  // strategic on ambiguity (under-classifying defeats the moat).
  const { classifyMessage } = await import("../evidenceGuard");
  const messageClass = classifyMessage(body.messageClass);

  // Sprint 2.28 — output-critic gate. Strategic messages MUST have
  // criticPassed=true (Maya declares she ran the 5-gate framework).
  // Tactical messages can be sent with criticPassed=false but we log
  // the gap. This is data-plane enforcement of an otherwise prompt-
  // level discipline rule.
  // ─────────────────────────────────────────────────────────────────────────
  // GROUNDING POLICY — operator DMs: DELIVERY WINS, NEVER BLACKHOLE.
  //
  // send_update is the Maya↔founder channel (it only ever sends to the agent's
  // telegramChatId). The anti-hallucination moat (criticPassed + evidence-backed
  // claims) is the right discipline, but on THIS surface a hard block silently
  // DROPS the message — which is exactly how the live dogfood lost the synthesis
  // plan: a strategic message bounced at the evidence gate and the founder got
  // nothing ("she never sent me the plan"). The cost of delivering with a soft
  // claim is tiny (Maya talking to her own boss); the cost of dropping the plan
  // is catastrophic. So strategic-grounding failures here are LOGGED as a
  // grounding gap and the message is DELIVERED (sanitized below), never blocked.
  //
  // Hard grounding enforcement still lives where the liability is real: PUBLIC
  // posts under the founder's name (post_to_channel / approval-publishing), where
  // a hallucinated claim or ban-risky post is an external liability. That path is
  // unchanged. This relaxation is scoped to operator DMs ONLY.
  // ─────────────────────────────────────────────────────────────────────────
  const groundingGaps: string[] = [];
  if (messageClass === "strategic" && body.criticPassed !== true) {
    groundingGaps.push("critic_not_passed");
  }
  if (messageClass === "strategic") {
    const normalizedClaims = (body.claims ?? []).map((c) => ({
      claim: typeof c.claim === "string" ? c.claim : "",
      evidence_ids: Array.isArray(c.evidence_ids) ? c.evidence_ids : [],
    }));
    if (normalizedClaims.length === 0) {
      groundingGaps.push("no_claims");
    } else {
      const guard = await ctx.runAction(
        internal.gtmMaya.evidenceGuard.validateClaims,
        { accountId: auth.accountId, claims: normalizedClaims }
      );
      if (!guard.ok) {
        groundingGaps.push(
          `evidence_unverified:${guard.failures?.length ?? 0}/${guard.claimsCount ?? normalizedClaims.length}`
        );
      }
    }
  }
  // Audit log — structured console line so operators / ops scripts can grep for
  // grounding state. A non-empty groundingGaps means the message went out with a
  // soft (un-evidenced) claim — surfaced, never silenced.
  console.log(
    JSON.stringify({
      event: "send_update.send_attempt",
      agentId: auth.agentId,
      messageClass,
      criticPassed: body.criticPassed ?? false,
      criticReasonsCount: (body.criticReasons ?? []).length,
      textLength: body.text.length,
      groundingGaps,
    })
  );

  // Firewall (voice-quality AI-tell scan). For OPERATOR DMs the firewall is
  // voice-quality, NOT ban-safety (public posts hard-gate elsewhere). A hard
  // block here blackholes the founder's message (the live root-cause of "hello +
  // synthesis never arrived" — bounced on an em-dash). So instead of blocking,
  // SANITIZE the mechanical AI-tells and SEND the cleaned text. Delivery wins.
  const firewall = await ctx.runAction(
    internal.gtmMaya.outboundFirewall.validateOutbound,
    { text: body.text }
  );
  let outboundText = body.text;
  if (!firewall.ok) {
    const { sanitizeOutboundText } = await import("../outboundFirewall");
    outboundText = sanitizeOutboundText(body.text);
    console.warn(
      JSON.stringify({
        event: "send_update.firewall_sanitized",
        agentId: auth.agentId,
        failures: firewall.failures,
      })
    );
  }

  // Get the agent's telegramChatId.
  const agent = await ctx.runQuery(
    internal.gtmMaya.openclaw.inboundCallback.getAgentForSendUpdate,
    { agentId: auth.agentId }
  );
  if (!agent || !agent.telegramChatId) {
    return new Response(
      JSON.stringify({ ok: false, reason: "no_telegram_chat_id" }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  // §6 — send the onboarding synthesis handover EXACTLY ONCE, no matter how
  // many main sessions race to "research done → send the plan" (the live demo
  // had two main sessions send it 3× total, mixing tactical + strategic). This
  // atomic, class-INDEPENDENT claim is the real fix: the FIRST founder-facing
  // send in the synthesis window wins; the rest are swallowed. Progress updates
  // (pre-research) and post-onboarding sends are unaffected.
  const synthClaim = await ctx.runMutation(
    internal.gtmMaya.agentLifecycle.claimFounderSynthesisSend,
    { agentId: auth.agentId }
  );
  if (synthClaim.decision === "suppress") {
    console.warn(
      JSON.stringify({
        event: "send_update.duplicate_synthesis_suppressed",
        agentId: auth.agentId,
        messageClass,
      })
    );
    return new Response(
      JSON.stringify({ ok: true, suppressed: "duplicate_synthesis" }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  // Send via Telegram Bot API. Sprint 2.26 — prefer per-tenant bot
  // token; fall back to shared env var for dev/test deploys only.
  const { resolveBotForAgent } = await import("../telegramBotPerTenant");
  const resolvedBot = await resolveBotForAgent(
    ctx as { runQuery: <T>(ref: unknown, args: unknown) => Promise<T> },
    auth.agentId,
    {
      sharedToken: process.env.TELEGRAM_BOT_TOKEN,
      sharedUsername: process.env.TELEGRAM_BOT_USERNAME,
    }
  );
  if (!resolvedBot.token) {
    return new Response(
      JSON.stringify({ ok: false, reason: "no_telegram_bot_configured" }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }
  const { sendDirectTelegramMessage } = await import(
    "../../integrations/telegram/sendDirectMessage"
  );
  const result = await sendDirectTelegramMessage({
    botToken: resolvedBot.token,
    chatId: agent.telegramChatId,
    text: outboundText,
  });

  // Data-collection sprint — persist Maya's reply to the transcript. This
  // is the only place her outbound content is observable; we record it
  // regardless of Telegram delivery success (the content was produced and
  // passed every gate above). A proactive ping with no inbound turn gets a
  // synthesized turnId so it still groups coherently.
  const turnId =
    typeof body.turnId === "string" && body.turnId.length > 0
      ? body.turnId
      : `maya-${auth.agentId}-${Date.now()}`;
  try {
    await ctx.runMutation(
      internal.gtmMaya.openclaw.conversationCapture.persistMayaMessage,
      {
        accountId: auth.accountId,
        agentId: auth.agentId,
        role: "maya",
        body: outboundText,
        channel: "telegram",
        turnId,
        messageClass,
        criticPassed: body.criticPassed ?? undefined,
      }
    );
  } catch (err) {
    // Never fail the send because transcript capture hiccuped — log + move on.
    console.error(
      JSON.stringify({
        event: "send_update.persist_failed",
        agentId: auth.agentId,
        error: err instanceof Error ? err.message : String(err),
      })
    );
  }

  // §6 — the synthesis claim stamped strategyDeliveredAt (the completion gate)
  // BEFORE this send. If WE claimed the synthesis ("send") but Telegram
  // delivery failed, release the claim so a genuine retry re-claims + re-sends —
  // otherwise onboarding could "complete" on a plan that never reached the
  // founder. (A successful send keeps the stamp; that's the delivery signal
  // markFoundationComplete + the rows-complete backstop gate on.)
  if (synthClaim.decision === "send" && !result.ok) {
    try {
      await ctx.runMutation(
        internal.gtmMaya.agentLifecycle.releaseFounderSynthesisClaim,
        { agentId: auth.agentId }
      );
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "send_update.release_synthesis_claim_failed",
          agentId: auth.agentId,
          error: err instanceof Error ? err.message : String(err),
        })
      );
    }
  }

  return new Response(
    JSON.stringify({
      ok: result.ok,
      reason: result.reason,
      messageId: result.messageId ?? undefined,
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
});

export const validateOutboundHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: ValidateOutboundPayload;
  try {
    body = (await request.json()) as ValidateOutboundPayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (typeof body.text !== "string" || body.text.length === 0) {
    return new Response("text required", { status: 400 });
  }
  if (body.text.length > 10000) {
    return new Response("text too long (>10000 chars)", { status: 400 });
  }

  const result = await ctx.runAction(
    internal.gtmMaya.outboundFirewall.validateOutbound,
    { text: body.text }
  );
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

/**
 * Sprint 2.7 — weekly review reads recent post results via hookToken
 * auth from Maya's runtime.
 */
export const getMyRecentPostResultsHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? parseInt(limitParam, 10) : undefined;
  const results = await ctx.runQuery(
    internal.gtmMaya.postResults.listAgentRecentPostResults,
    {
      agentId: auth.agentId,
      accountId: auth.accountId,
      limit: Number.isFinite(limit) ? limit : undefined,
    }
  );
  return new Response(JSON.stringify({ results }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

/**
 * Read endpoint Maya hits from her runtime after subagents finish — uses
 * hookToken auth (not Clerk) since she's calling from inside her own Fly
 * machine. Returns this agent's target threads only.
 */
export const getMyTargetThreadsHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status");
  const platformFilter = url.searchParams.get("platform");

  const threads = await ctx.runQuery(
    internal.gtmMaya.targetList.listAgentTargetThreads,
    {
      agentId: auth.agentId,
      accountId: auth.accountId,
      status:
        statusFilter === "queued" ||
        statusFilter === "replied" ||
        statusFilter === "dropped" ||
        statusFilter === "expired"
          ? statusFilter
          : undefined,
      platform:
        platformFilter === "reddit" ||
        platformFilter === "x" ||
        platformFilter === "hn" ||
        platformFilter === "linkedin" ||
        platformFilter === "instagram" ||
        platformFilter === "tiktok"
          ? platformFilter
          : undefined,
    }
  );
  return new Response(JSON.stringify({ threads }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
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
