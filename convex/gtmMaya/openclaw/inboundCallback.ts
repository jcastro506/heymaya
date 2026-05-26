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
  // Sprint 2.1 — deep-research subagent callbacks. Per-platform research
  // subagents (reddit_research, x_research, etc.) POST one row at a time
  // during the FIRST WAKE deep research phase. See
  // convex/gtmMaya/targetList.ts (Sprint 2.2) for the mutation handlers.
  v.literal("target_thread"),
  v.literal("target_account"),
  v.literal("drafted_content")
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
  platform: "reddit" | "x" | "hn" | "linkedin" | "instagram" | "tiktok";
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
  if (
    !body.idempotencyKey ||
    !body.platform ||
    !body.url ||
    !body.externalId ||
    !body.whyItFits ||
    !body.recommendedAction ||
    typeof body.priorityScore !== "number"
  ) {
    return new Response("missing required fields", { status: 400 });
  }
  if (body.priorityScore < 0 || body.priorityScore > 1) {
    return new Response("priorityScore must be in [0, 1]", { status: 400 });
  }

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
      whyItFits: body.whyItFits,
      recommendedAction: body.recommendedAction,
      priorityScore: body.priorityScore,
    });
  } catch (err) {
    return new Response((err as Error).message, { status: 400 });
  }
  return new Response("ok", { status: 200 });
});

interface TargetAccountPayload {
  idempotencyKey: string;
  platform: "reddit" | "x" | "hn" | "linkedin" | "instagram" | "tiktok";
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
  if (
    !body.idempotencyKey ||
    !body.platform ||
    !body.handle ||
    !body.profileUrl ||
    !body.whyItFits ||
    !body.recommendedAction ||
    typeof body.priorityScore !== "number"
  ) {
    return new Response("missing required fields", { status: 400 });
  }
  if (body.priorityScore < 0 || body.priorityScore > 1) {
    return new Response("priorityScore must be in [0, 1]", { status: 400 });
  }

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
      profileUrl: body.profileUrl,
      displayName: body.displayName,
      bio: body.bio,
      followerCount: body.followerCount,
      voiceAnalysis: body.voiceAnalysis,
      whyItFits: body.whyItFits,
      recommendedAction: body.recommendedAction,
      priorityScore: body.priorityScore,
    });
  } catch (err) {
    return new Response((err as Error).message, { status: 400 });
  }
  return new Response("ok", { status: 200 });
});

interface DraftedContentPayload {
  idempotencyKey: string;
  kind: "reply" | "thread" | "post" | "comment" | "dm";
  platform: "reddit" | "x" | "hn" | "linkedin" | "instagram" | "tiktok";
  targetThreadId?: string;
  targetAccountId?: string;
  draftText: string;
  draftSegments?: string[];
  researchJobId?: string;
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
  platform: "reddit" | "x" | "hn" | "linkedin" | "instagram" | "tiktok";
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
  if (!body.researchJobId) {
    return new Response("researchJobId required", { status: 400 });
  }

  const result = await ctx.runMutation(
    internal.gtmMaya.researchWorker.incrementSubagentsCompleted,
    { researchJobId: body.researchJobId as Id<"gtmResearchJobs"> }
  );

  if (result.readyToFirePhase2) {
    // Schedule (fire-and-forget) — actions can't await actions, and
    // we don't want the subagent's HTTP response gated on the
    // phase-2 webhook round-trip.
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

  if (messageClass === "strategic") {
    const normalizedClaims = (body.claims ?? []).map((c) => ({
      claim: typeof c.claim === "string" ? c.claim : "",
      evidence_ids: Array.isArray(c.evidence_ids) ? c.evidence_ids : [],
    }));

    if (normalizedClaims.length === 0) {
      return new Response(
        JSON.stringify({
          ok: false,
          reason: "evidence_required",
          message:
            "Strategic messages require at least one claim with evidence_ids. " +
            "If this is a tactical/accountability message, pass messageClass: 'tactical'.",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    const guard = await ctx.runAction(
      internal.gtmMaya.evidenceGuard.validateClaims,
      { accountId: auth.accountId, claims: normalizedClaims }
    );
    if (!guard.ok) {
      return new Response(
        JSON.stringify({
          ok: false,
          reason: "evidence_blocked",
          failures: guard.failures,
          claimsCount: guard.claimsCount,
          evidenceCount: guard.evidenceCount,
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
  }

  // Firewall after evidence guard.
  const firewall = await ctx.runAction(
    internal.gtmMaya.outboundFirewall.validateOutbound,
    { text: body.text }
  );
  if (!firewall.ok) {
    return new Response(
      JSON.stringify({
        ok: false,
        reason: "firewall_blocked",
        failures: firewall.failures,
      }),
      { status: 200, headers: { "content-type": "application/json" } }
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

  // Send via Telegram Bot API.
  const { sendDirectTelegramMessage } = await import(
    "../../integrations/telegram/sendDirectMessage"
  );
  const result = await sendDirectTelegramMessage({
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: agent.telegramChatId,
    text: body.text,
  });
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
