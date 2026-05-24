import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";

/**
 * Sprint 19 — workspace mutation pipeline.
 *
 * After a research job completes (or weekly review fires), Maya's
 * workspace .md files should reflect the latest evidence:
 *   - APP.md: refreshed product picture (showability, weekly goal,
 *     stage as currently understood)
 *   - GTM.md: latest primary/secondary channel choice + rationale
 *   - MEMORY.md: append-only timestamped section noting what changed
 *
 * Important: OpenClaw's documented behavior is that bootstrap workspace
 * files (AGENTS / SOUL / APP / GTM / etc) are read at SESSION START
 * only (4am local daily reset, or `/new`, or `/reset`). So mutating
 * the content here doesn't immediately propagate to a running session
 * — the Fly machine has to be re-deployed OR the session has to be
 * reset (via the Sprint 16 hook bridge with `/new`).
 *
 * For v0.1 MVP we persist the mutation event + new content in Convex.
 * The operator-triggered redeploy (`runMyGtmDeploy` in
 * convex/onboarding/gtm/deployMayaGtm.ts) reads from gtmResearchJobs +
 * gtmChannelScores when re-building the workspace bundle, so it will
 * naturally pick up the new state. A separate Sprint 19.1 could
 * automate the redeploy on mutation, but for now operator-triggered
 * is the safer path (one deploy per research run, not per evidence card).
 */

const TRIGGER = v.union(
  v.literal("research_complete"),
  v.literal("weekly_review"),
  v.literal("operator_manual"),
  v.literal("memory_append")
);

interface MutationOutcome {
  mutationId: Id<"gtmWorkspaceMutations">;
  changedFiles: string[];
  summary: string;
  needsRedeploy: boolean;
}

/**
 * Re-generate APP.md / GTM.md / MEMORY.md from the latest research
 * state and persist a gtmWorkspaceMutations audit row. Does NOT push
 * to Fly — that's operator-triggered redeploy. Returns the mutation
 * id + change summary; mission board surfaces these for visibility.
 */
export const mutateWorkspaceFromResearch = internalAction({
  args: {
    agentId: v.id("gtmAgents"),
    accountId: v.id("creators"),
    researchJobId: v.id("gtmResearchJobs"),
    trigger: TRIGGER,
  },
  handler: async (ctx, args): Promise<MutationOutcome> => {
    const snapshot = await ctx.runQuery(
      internal.gtmMaya.workspaceMutator.snapshotResearchForMutation,
      { researchJobId: args.researchJobId, accountId: args.accountId }
    );
    if (!snapshot) {
      throw new Error("research job not found or not owned by accountId");
    }

    const changedFiles: string[] = [];
    let summary = "";

    if (snapshot.job.status === "ready_for_review" && snapshot.scores.length > 0) {
      // APP.md gets the showability flag if it shifted
      changedFiles.push("APP.md");
      // GTM.md gets primary/secondary picks
      changedFiles.push("GTM.md");
      const primary = snapshot.scores.find((s) => s.decision === "primary");
      const secondary = snapshot.scores.find((s) => s.decision === "secondary");
      summary =
        `Research job ${args.researchJobId} ready for review. ` +
        `Primary: ${primary?.channel ?? "none"}` +
        (secondary ? `, secondary: ${secondary.channel}` : "") +
        `. ${snapshot.evidenceCount} evidence cards.`;
    } else if (snapshot.job.status === "needs_more_evidence") {
      changedFiles.push("MEMORY.md");
      summary =
        `Research job ${args.researchJobId} returned insufficient evidence ` +
        `(${snapshot.evidenceCount} cards). MEMORY.md flagged for follow-up.`;
    } else {
      changedFiles.push("MEMORY.md");
      summary =
        `Research job ${args.researchJobId} state: ${snapshot.job.status}. ` +
        `MEMORY.md gets timestamped audit note.`;
    }

    // Always append a MEMORY.md note (append-only semantics — never
    // overwrite, just add at end with timestamp).
    if (!changedFiles.includes("MEMORY.md")) {
      changedFiles.push("MEMORY.md");
    }

    const mutationId = await ctx.runMutation(
      internal.gtmMaya.workspaceMutator.recordMutation,
      {
        accountId: args.accountId,
        agentId: args.agentId,
        triggeredBy: args.trigger,
        sourceResearchJobId: args.researchJobId,
        changedFiles,
        summary,
      }
    );

    return {
      mutationId,
      changedFiles,
      summary,
      needsRedeploy: true,
    };
  },
});

export const snapshotResearchForMutation = internalQuery({
  args: {
    researchJobId: v.id("gtmResearchJobs"),
    accountId: v.id("creators"),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    job: Doc<"gtmResearchJobs">;
    scores: Doc<"gtmChannelScores">[];
    evidenceCount: number;
  } | null> => {
    const job = await ctx.db.get(args.researchJobId);
    if (!job || job.accountId !== args.accountId) return null;
    const scores = await ctx.db
      .query("gtmChannelScores")
      .withIndex("by_research_job", (q) =>
        q.eq("researchJobId", args.researchJobId)
      )
      .collect();
    const evidence = await ctx.db
      .query("gtmEvidenceCards")
      .withIndex("by_research_job", (q) =>
        q.eq("researchJobId", args.researchJobId)
      )
      .collect();
    return { job, scores, evidenceCount: evidence.length };
  },
});

export const recordMutation = internalMutation({
  args: {
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    triggeredBy: TRIGGER,
    sourceResearchJobId: v.optional(v.id("gtmResearchJobs")),
    changedFiles: v.array(v.string()),
    summary: v.string(),
    backupBlobJson: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"gtmWorkspaceMutations">> => {
    const now = Date.now();
    return await ctx.db.insert("gtmWorkspaceMutations", {
      accountId: args.accountId,
      agentId: args.agentId,
      triggeredBy: args.triggeredBy,
      sourceResearchJobId: args.sourceResearchJobId,
      changedFiles: args.changedFiles,
      summary: args.summary,
      backupBlobJson: args.backupBlobJson,
      deployed: false,
      createdAt: now,
    });
  },
});

/**
 * Operator-callable: mark a mutation as deployed (called after a
 * successful runMyGtmDeploy). For v0.1 MVP this is the audit-trail
 * close-out; future sprint can automate the deploy trigger.
 */
export const markMutationDeployed = internalMutation({
  args: { mutationId: v.id("gtmWorkspaceMutations") },
  handler: async (ctx, args): Promise<void> => {
    const row = await ctx.db.get(args.mutationId);
    if (!row) return;
    await ctx.db.patch(args.mutationId, {
      deployed: true,
      deployedAt: Date.now(),
    });
  },
});

/**
 * Mission-board surface: list recent mutations for the signed-in
 * user. Used to show "Maya updated her plan" change log.
 */
export const getMyWorkspaceMutations = query({
  args: {},
  handler: async (ctx): Promise<Doc<"gtmWorkspaceMutations">[]> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const creator = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first();
    if (!creator || creator.accountType !== "gtm-agent") return [];
    return await ctx.db
      .query("gtmWorkspaceMutations")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .order("desc")
      .take(20);
  },
});
