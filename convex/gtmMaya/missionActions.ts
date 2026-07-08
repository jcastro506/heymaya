import { v } from "convex/values";
import {
  internalAction,
  mutation,
  query,
  type MutationCtx,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { resolveMyGtmCreator } from "./targetList";
import { runAgentTurn, type HookEndpoint } from "./openclaw/hookClient";

/**
 * Mission Control v2 — the operator's WRITE surface on the web.
 *
 * Until now every decision (approve a draft, steer Maya, log a conversion)
 * lived only in Telegram. These endpoints give the web app the same verbs,
 * auth-scoped to the signed-in founder's own agent and fail-closed:
 * every mutation resolves the creator from Clerk identity first and asserts
 * row ownership before touching anything (cross-tenant isolation, test
 * category 1).
 *
 * Design constraints honored here:
 *  - No Convex-authored operator messages: decisions are relayed to Maya as
 *    an agent TURN (deliver:false) so anything the founder hears comes from
 *    Maya herself, in her voice.
 *  - Draft approval does NOT publish from Convex. Publishing stays with
 *    Maya's runtime (warmth, ban-safety, posting windows all live there);
 *    the web only records the decision and wakes her.
 */

/** Approval states the founder can act on from the web. `published` rows are
 *  immutable history; everything else can still be decided or re-decided. */
const WEB_DECIDABLE = new Set<Doc<"gtmDraftedContent">["approvalState"]>([
  "draft",
  "pending_approval",
  "needs_revision",
  "approved",
  "rejected",
]);

async function loadMyDraftOrThrow(
  ctx: MutationCtx,
  draftId: Id<"gtmDraftedContent">
): Promise<{ creator: Doc<"creators">; draft: Doc<"gtmDraftedContent"> }> {
  const creator = await resolveMyGtmCreator(ctx);
  if (!creator) throw new Error("Sign in to manage drafts.");
  const draft = await ctx.db.get(draftId);
  if (!draft || draft.accountId !== creator._id) {
    throw new Error("Draft not found.");
  }
  if (!WEB_DECIDABLE.has(draft.approvalState)) {
    throw new Error("This one already went out — it can't be changed.");
  }
  return { creator, draft };
}

/** Platform label for manager-voice activity lines. */
function platformLabel(p: Doc<"gtmDraftedContent">["platform"]): string {
  return p === "x" ? "X" : p === "hn" ? "Hacker News" : p.charAt(0).toUpperCase() + p.slice(1);
}

export const approveMyDraft = mutation({
  args: { draftId: v.id("gtmDraftedContent") },
  handler: async (ctx, args): Promise<void> => {
    const { creator, draft } = await loadMyDraftOrThrow(ctx, args.draftId);
    if (draft.approvalState === "approved") return; // idempotent double-tap
    const now = Date.now();
    await ctx.db.patch(draft._id, { approvalState: "approved", updatedAt: now });
    await ctx.db.insert("gtmAgentActivity", {
      accountId: creator._id,
      agentId: draft.agentId,
      kind: "status",
      summary: `You approved the ${platformLabel(draft.platform)} ${draft.kind} — Maya will post it in the right window.`,
      linkedRef: String(draft._id),
      createdAt: now,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.gtmMaya.missionActions.notifyAgentOfDraftDecision,
      { agentId: draft.agentId, draftId: draft._id, decision: "approved" }
    );
  },
});

export const passOnMyDraft = mutation({
  args: {
    draftId: v.id("gtmDraftedContent"),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const { creator, draft } = await loadMyDraftOrThrow(ctx, args.draftId);
    const now = Date.now();
    const note = args.note?.trim().slice(0, 1000) || undefined;
    await ctx.db.patch(draft._id, {
      approvalState: "rejected",
      userFeedback: note ?? draft.userFeedback,
      updatedAt: now,
    });
    await ctx.db.insert("gtmAgentActivity", {
      accountId: creator._id,
      agentId: draft.agentId,
      kind: "status",
      summary: `You passed on the ${platformLabel(draft.platform)} ${draft.kind}${note ? " — with a note for Maya" : ""}.`,
      detail: note,
      linkedRef: String(draft._id),
      createdAt: now,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.gtmMaya.missionActions.notifyAgentOfDraftDecision,
      { agentId: draft.agentId, draftId: draft._id, decision: "rejected", note }
    );
  },
});

export const requestDraftTweak = mutation({
  args: {
    draftId: v.id("gtmDraftedContent"),
    note: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const note = args.note.trim().slice(0, 1000);
    if (!note) throw new Error("Tell Maya what to change.");
    const { creator, draft } = await loadMyDraftOrThrow(ctx, args.draftId);
    const now = Date.now();
    await ctx.db.patch(draft._id, {
      approvalState: "needs_revision",
      userFeedback: note,
      updatedAt: now,
    });
    await ctx.db.insert("gtmAgentActivity", {
      accountId: creator._id,
      agentId: draft.agentId,
      kind: "status",
      summary: `You asked for a tweak on the ${platformLabel(draft.platform)} ${draft.kind}.`,
      detail: note,
      linkedRef: String(draft._id),
      createdAt: now,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.gtmMaya.missionActions.notifyAgentOfDraftDecision,
      { agentId: draft.agentId, draftId: draft._id, decision: "needs_revision", note }
    );
  },
});

/**
 * Relay a web decision to Maya's machine as an isolated agent turn.
 * Best-effort by design: the decision is already durable in Convex (rows are
 * truth); if the machine is asleep or unreachable her next heartbeat reads
 * the same state. deliver:false — Maya replies through send_update if she
 * has anything to say, never a Convex-authored message.
 */
export const notifyAgentOfDraftDecision = internalAction({
  args: {
    agentId: v.id("gtmAgents"),
    draftId: v.id("gtmDraftedContent"),
    decision: v.union(
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("needs_revision")
    ),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const row = await ctx.runQuery(
      internal.gtmMaya.telegramHandoff.getHandoffContext,
      { agentId: args.agentId }
    );
    if (!row?.hookBaseUrl || !row.hookToken) return;
    const endpoint: HookEndpoint = {
      baseUrl: row.hookBaseUrl,
      token: row.hookToken,
    };
    const lines = [
      `Operator decision from Mission Control on draft ${String(args.draftId)}: ${args.decision.replace("_", " ")}.`,
      args.decision === "approved"
        ? "Publish it through the normal pipeline when the posting window and warmth allow."
        : args.decision === "needs_revision"
          ? "Revise it per the note and re-queue for approval."
          : "Drop it and fold the feedback into future drafts.",
      args.note ? `Operator note: ${args.note}` : undefined,
    ].filter(Boolean);
    try {
      await runAgentTurn(endpoint, {
        message: lines.join("\n"),
        deliver: false,
        thinking: "medium",
        timeoutSeconds: 90,
      });
    } catch {
      // Machine asleep/unreachable — heartbeat will pick the row state up.
    }
  },
});

export const sendMySteeringDirective = mutation({
  args: {
    directive: v.string(),
    intent: v.optional(
      v.union(
        v.literal("focus"),
        v.literal("avoid"),
        v.literal("angle"),
        v.literal("pace"),
        v.literal("other")
      )
    ),
  },
  handler: async (ctx, args): Promise<void> => {
    const directive = args.directive.trim().slice(0, 2000);
    if (!directive) throw new Error("Say what you want Maya to do differently.");
    const creator = await resolveMyGtmCreator(ctx);
    if (!creator) throw new Error("Sign in to steer Maya.");
    const agent = await ctx.db
      .query("gtmAgents")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .first();
    if (!agent) throw new Error("No agent yet — finish onboarding first.");
    const now = Date.now();
    // The supersede logic (focus↔avoid on the same lane) lives in
    // steering.saveSteeringDirective — schedule it rather than fork it.
    await ctx.scheduler.runAfter(0, internal.gtmMaya.steering.saveSteeringDirective, {
      accountId: creator._id,
      agentId: agent._id,
      directive,
      intent: args.intent,
      source: "founder" as const,
    });
    await ctx.db.insert("gtmAgentActivity", {
      accountId: creator._id,
      agentId: agent._id,
      kind: "status",
      summary: "New standing instruction from you.",
      detail: directive,
      createdAt: now,
    });
  },
});

export const reportMyConversion = mutation({
  args: {
    kind: v.union(
      v.literal("signup"),
      v.literal("demo"),
      v.literal("feedback"),
      v.literal("revenue"),
      v.literal("activated")
    ),
    count: v.number(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const creator = await resolveMyGtmCreator(ctx);
    if (!creator) throw new Error("Sign in to log results.");
    const agent = await ctx.db
      .query("gtmAgents")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .first();
    if (!agent) throw new Error("No agent yet — finish onboarding first.");
    const count = Math.floor(args.count);
    if (!Number.isFinite(count) || count < 1 || count > 10000) {
      throw new Error("Count must be between 1 and 10,000.");
    }
    const now = Date.now();
    await ctx.db.insert("gtmConversions", {
      accountId: creator._id,
      agentId: agent._id,
      kind: args.kind,
      count,
      source: "self_report",
      occurredAt: now,
      note: args.note?.trim().slice(0, 500) || undefined,
    });
    await ctx.db.insert("gtmAgentActivity", {
      accountId: creator._id,
      agentId: agent._id,
      kind: "posted",
      summary: `You logged ${count} ${args.kind}${count === 1 ? "" : "s"} — Maya will fold it into attribution.`,
      detail: args.note?.trim().slice(0, 500) || undefined,
      createdAt: now,
    });
  },
});

/** Per-channel connection health — powers the "Needs you" reconnect alerts.
 *  Fail-closed: no identity → empty. */
export const getMyConnectionHealth = query({
  args: {},
  handler: async (ctx): Promise<Doc<"gtmConnectionHealth">[]> => {
    const creator = await resolveMyGtmCreator(ctx);
    if (!creator) return [];
    return await ctx.db
      .query("gtmConnectionHealth")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .collect();
  },
});

/** Competitor moves feed for the Brain tab, newest first. */
export const getMyCompetitorMoves = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<Doc<"gtmCompetitorMoves">[]> => {
    const creator = await resolveMyGtmCreator(ctx);
    if (!creator) return [];
    const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);
    const rows = await ctx.db
      .query("gtmCompetitorMoves")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .order("desc")
      .take(limit);
    return rows.sort((a, b) => b.observedAt - a.observedAt);
  },
});

/** Draft queue with thread context joined in — a reply card without the
 *  conversation it answers is unreviewable. */
export type QueueDraft = Doc<"gtmDraftedContent"> & {
  thread?: {
    title?: string;
    url: string;
    excerpt?: string;
    author?: string;
    platform: Doc<"gtmTargetThreads">["platform"];
  };
};

export const getMyDraftQueue = query({
  args: {},
  handler: async (ctx): Promise<QueueDraft[]> => {
    const creator = await resolveMyGtmCreator(ctx);
    if (!creator) return [];
    const drafts = await ctx.db
      .query("gtmDraftedContent")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .order("desc")
      .take(200);
    const threadIds = [
      ...new Set(
        drafts
          .map((d) => d.targetThreadId)
          .filter((id): id is Id<"gtmTargetThreads"> => id !== undefined)
      ),
    ];
    const threads = new Map<string, Doc<"gtmTargetThreads">>();
    for (const id of threadIds) {
      const t = await ctx.db.get(id);
      if (t && t.accountId === creator._id) threads.set(String(id), t);
    }
    return drafts.map((d) => {
      const t = d.targetThreadId ? threads.get(String(d.targetThreadId)) : undefined;
      return {
        ...d,
        thread: t
          ? {
              title: t.title,
              url: t.url,
              excerpt: t.excerpt,
              author: t.author,
              platform: t.platform,
            }
          : undefined,
      };
    });
  },
});
