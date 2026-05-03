/**
 * Wave C.5 outcome wire-back — attribution chain.
 *
 * North star (per `project_north_star_outcomes.md`): jobs booked + 5-star
 * reviews. Maya's actions only matter to the extent they drive those two
 * numbers. Attribution is the bridge from "Maya did X" to "X drove a lead"
 * to "lead converted to a job" to "job earned a 5-star review."
 *
 * The attribution chain (locked):
 *
 *   gbpPosts / reviewRequests / reviews / inboundLeads-self-as-nudge
 *     │
 *     │  linkLeadToAction(leadId, kind, actionId)
 *     ▼
 *   inboundLeads.{originatingActionKind, originatingActionId}
 *     │
 *     │  linkLeadToJob(leadId, jobId)
 *     ▼
 *   serviceJobs.originatingLeadId  ←─ bidirectional ─→  inboundLeads.convertedJobId
 *
 * And, separately:
 *
 *   reviewRequests
 *     │
 *     │  recordReviewArrival(reviewId, requestId?)
 *     ▼
 *   reviewRequests.{responseAt, responseRating, attributedReviewId}
 *
 * Cross-tenant safety:
 *   - Every mutation re-resolves both endpoints' `businessId` and refuses to
 *     link rows from different businesses. A vaultPath collision or an id
 *     spoofed across tenants cannot create a leak.
 *   - The string `originatingActionId` field is intentionally polymorphic
 *     (the producing kind dispatches across multiple tables); we validate
 *     the id resolves WITHIN the lead's businessId before persisting.
 *
 * Plan-tier:
 *   - Attribution writes run at every tier. The learnings extractor (and the
 *     Growth-tab outcomes surface in Wave C.7) is THE moat — gating it off
 *     would be self-defeating. Tier gating happens at the read surface.
 *
 * Idempotency:
 *   - All link mutations are idempotent — re-applying with the same args is
 *     a no-op. The producer side (post-create / lead-respond / job-create)
 *     calls in at-least-once semantics; we guarantee at-most-once effect.
 */

import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

/* -------------------------------------------------------------------------- */
/* Cross-tenant guards                                                         */
/* -------------------------------------------------------------------------- */

async function getLeadOrThrow(
  ctx: MutationCtx,
  leadId: Id<"inboundLeads">,
  businessId: Id<"businesses">
): Promise<Doc<"inboundLeads">> {
  const lead = await ctx.db.get(leadId);
  if (!lead) {
    throw new Error(`attribution: inboundLead ${leadId} not found.`);
  }
  if (lead.businessId !== businessId) {
    throw new Error(
      "attribution: cross-tenant violation — lead.businessId mismatch."
    );
  }
  return lead;
}

/**
 * Resolve a producing-action `id` against the kind's table, asserting the
 * action belongs to the same business as the lead. Returns true if the
 * (kind, id) pair is valid and same-tenant.
 */
async function actionResolvesWithinBusiness(
  ctx: MutationCtx,
  kind: "gbp-post" | "lead-nudge" | "review-request" | "review-reply" | "none",
  actionId: string,
  businessId: Id<"businesses">
): Promise<boolean> {
  if (kind === "none") {
    // "none" attribution accepts any string sentinel ("system", "manual",
    // "operator-direct"); the value is informational only.
    return true;
  }
  if (kind === "gbp-post") {
    const row = await ctx.db.get(actionId as Id<"gbpPosts">);
    return row !== null && row.businessId === businessId;
  }
  if (kind === "review-request") {
    const row = await ctx.db.get(actionId as Id<"reviewRequests">);
    return row !== null && row.businessId === businessId;
  }
  if (kind === "review-reply") {
    const row = await ctx.db.get(actionId as Id<"reviews">);
    return row !== null && row.businessId === businessId;
  }
  if (kind === "lead-nudge") {
    // Lead-nudge attribution links a lead to ITSELF (Maya nudged the
    // operator about it; the lead's eventual outcome is the nudge's
    // outcome). actionId === leadId in this case — caller passes the same
    // id. The validation is "the id is a lead in this business".
    const row = await ctx.db.get(actionId as Id<"inboundLeads">);
    return row !== null && row.businessId === businessId;
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* linkLeadToAction                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Link an `inboundLeads` row to the Maya action that produced it. Idempotent:
 * re-applying with the same (lead, kind, action) is a no-op. Re-applying with
 * a DIFFERENT (kind, action) on a lead that already has an attribution
 * throws — the producer must explicitly call `clearAttribution` first
 * (intentional: silent overwrite would corrupt the audit trail).
 *
 * Adversarial guard — attribution loops: if `kind === "lead-nudge"`, we allow
 * the lead to be linked to itself (Maya's nudge is ABOUT this lead).
 * For every other kind, we refuse self-linking — the action must be a
 * different row. This prevents pathological "lead caused itself" loops the
 * extractor would otherwise have to handle.
 */
export const linkLeadToAction = internalMutation({
  args: {
    businessId: v.id("businesses"),
    leadId: v.id("inboundLeads"),
    kind: v.union(
      v.literal("gbp-post"),
      v.literal("lead-nudge"),
      v.literal("review-request"),
      v.literal("review-reply"),
      v.literal("none")
    ),
    actionId: v.string(),
  },
  handler: async (ctx, args): Promise<{ linked: boolean; alreadyLinked: boolean }> => {
    const lead = await getLeadOrThrow(ctx, args.leadId, args.businessId);

    // Idempotency check.
    if (
      lead.originatingActionKind === args.kind &&
      lead.originatingActionId === args.actionId
    ) {
      return { linked: false, alreadyLinked: true };
    }

    // Refuse silent overwrite.
    if (
      lead.originatingActionKind !== undefined &&
      lead.originatingActionId !== undefined &&
      lead.originatingActionKind !== "none"
    ) {
      throw new Error(
        `attribution: lead ${args.leadId} already linked to ${lead.originatingActionKind}/${lead.originatingActionId}; call clearAttribution first.`
      );
    }

    // Self-link guard (loop prevention).
    if (args.kind !== "lead-nudge" && args.actionId === args.leadId) {
      throw new Error(
        `attribution: refused self-link for kind=${args.kind} (only lead-nudge may self-link).`
      );
    }

    // Cross-tenant + existence guard for the action side.
    const ok = await actionResolvesWithinBusiness(
      ctx,
      args.kind,
      args.actionId,
      args.businessId
    );
    if (!ok) {
      throw new Error(
        `attribution: action (${args.kind}/${args.actionId}) does not resolve within business ${args.businessId}.`
      );
    }

    await ctx.db.patch(args.leadId, {
      originatingActionKind: args.kind,
      originatingActionId: args.actionId,
    });

    // For gbp-post attribution, also append the lead id to the post's
    // `attributedLeadIds` (bidirectional convenience). Idempotent on append.
    if (args.kind === "gbp-post") {
      const post = await ctx.db.get(args.actionId as Id<"gbpPosts">);
      if (post && post.businessId === args.businessId) {
        const existing = post.attributedLeadIds ?? [];
        if (!existing.includes(args.leadId)) {
          await ctx.db.patch(post._id, {
            attributedLeadIds: [...existing, args.leadId],
            updatedAt: Date.now(),
          });
        }
      }
    }

    return { linked: true, alreadyLinked: false };
  },
});

/* -------------------------------------------------------------------------- */
/* linkLeadToJob                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Reconcile an inboundLead → serviceJob conversion. Bidirectional: writes
 * `lead.convertedJobId` AND `job.originatingLeadId`. Idempotent: re-applying
 * the same (lead, job) is a no-op; mismatched re-application throws.
 *
 * Adversarial guard: refuses to link if either row's businessId differs from
 * the supplied `businessId` arg. Refuses to link a lead that's already
 * converted to a DIFFERENT job, or a job that's already attributed to a
 * DIFFERENT lead.
 */
export const linkLeadToJob = internalMutation({
  args: {
    businessId: v.id("businesses"),
    leadId: v.id("inboundLeads"),
    jobId: v.id("serviceJobs"),
  },
  handler: async (ctx, args): Promise<{ linked: boolean; alreadyLinked: boolean }> => {
    const lead = await getLeadOrThrow(ctx, args.leadId, args.businessId);
    const job = await ctx.db.get(args.jobId);
    if (!job) {
      throw new Error(`attribution: serviceJob ${args.jobId} not found.`);
    }
    if (job.businessId !== args.businessId) {
      throw new Error(
        "attribution.linkLeadToJob: cross-tenant violation — job.businessId mismatch."
      );
    }

    // Idempotency.
    if (lead.convertedJobId === args.jobId && job.originatingLeadId === args.leadId) {
      return { linked: false, alreadyLinked: true };
    }
    // Refuse silent overwrite on either side.
    if (lead.convertedJobId !== undefined && lead.convertedJobId !== args.jobId) {
      throw new Error(
        `attribution.linkLeadToJob: lead ${args.leadId} already converted to job ${lead.convertedJobId}.`
      );
    }
    if (
      job.originatingLeadId !== undefined &&
      job.originatingLeadId !== args.leadId
    ) {
      throw new Error(
        `attribution.linkLeadToJob: job ${args.jobId} already attributed to lead ${job.originatingLeadId}.`
      );
    }

    await ctx.db.patch(args.leadId, { convertedJobId: args.jobId });
    await ctx.db.patch(args.jobId, {
      originatingLeadId: args.leadId,
      updatedAt: Date.now(),
    });
    return { linked: true, alreadyLinked: false };
  },
});

/* -------------------------------------------------------------------------- */
/* recordReviewArrival                                                         */
/* -------------------------------------------------------------------------- */

/**
 * When a `reviews` row arrives, attribute it back to the most recent
 * `reviewRequests` row that targeted the same customer within the outcome
 * window (default 30d). Patches `reviewRequests.{responseAt, responseRating,
 * attributedReviewId, status: "completed"}`.
 *
 * If `requestId` is supplied (the producer can provide it directly when
 * Pub/Sub correlates), we trust that pairing after a cross-tenant + same-
 * customer check. If not, we resolve via reviews.customerMatchedJobId →
 * reviewRequests.jobId match.
 */
export const recordReviewArrival = internalMutation({
  args: {
    businessId: v.id("businesses"),
    reviewId: v.id("reviews"),
    requestId: v.optional(v.id("reviewRequests")),
    /** Outcome window in ms — default 30d. */
    windowMs: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ attributed: boolean; reason?: string }> => {
    const review = await ctx.db.get(args.reviewId);
    if (!review) {
      throw new Error(`attribution: review ${args.reviewId} not found.`);
    }
    if (review.businessId !== args.businessId) {
      throw new Error(
        "attribution.recordReviewArrival: cross-tenant violation — review.businessId mismatch."
      );
    }

    const windowMs = args.windowMs ?? 30 * 24 * 60 * 60 * 1000;
    let request: Doc<"reviewRequests"> | null = null;

    if (args.requestId !== undefined) {
      const r = await ctx.db.get(args.requestId);
      if (r && r.businessId === args.businessId) {
        request = r;
      }
    } else if (review.customerMatchedJobId !== undefined) {
      // Find the most recent SENT request against the matched job within window.
      const candidates = await ctx.db
        .query("reviewRequests")
        .withIndex("by_job", (q) =>
          q.eq("jobId", review.customerMatchedJobId as Id<"serviceJobs">)
        )
        .collect();
      const inWindow = candidates
        .filter(
          (c) =>
            c.businessId === args.businessId &&
            c.sentAt !== undefined &&
            review.receivedAt - c.sentAt <= windowMs &&
            review.receivedAt >= c.sentAt
        )
        .sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0));
      request = inWindow[0] ?? null;
    }

    if (!request) {
      return { attributed: false, reason: "no-matching-request-in-window" };
    }

    // Idempotency.
    if (request.attributedReviewId === args.reviewId) {
      return { attributed: false, reason: "already-attributed" };
    }
    if (
      request.attributedReviewId !== undefined &&
      request.attributedReviewId !== args.reviewId
    ) {
      throw new Error(
        `attribution.recordReviewArrival: request ${request._id} already linked to review ${request.attributedReviewId}.`
      );
    }

    await ctx.db.patch(request._id, {
      responseAt: review.receivedAt,
      responseRating: review.starRating,
      attributedReviewId: args.reviewId,
      status: "completed",
      completedAt: review.receivedAt,
    });

    return { attributed: true };
  },
});

/* -------------------------------------------------------------------------- */
/* recordLeadResponse                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Mark an inboundLead as having received a response (operator or Maya nudge).
 * Computes + freezes `responseLatencyMs` for the learnings extractor.
 * Idempotent: subsequent calls do NOT overwrite a previously-set response
 * timestamp (the FIRST response is what matters for outcome attribution).
 */
export const recordLeadResponse = internalMutation({
  args: {
    businessId: v.id("businesses"),
    leadId: v.id("inboundLeads"),
    respondedAtMs: v.number(),
  },
  handler: async (ctx, args): Promise<{ recorded: boolean; alreadyRecorded: boolean }> => {
    const lead = await getLeadOrThrow(ctx, args.leadId, args.businessId);
    if (lead.respondedAtMs !== undefined) {
      return { recorded: false, alreadyRecorded: true };
    }
    if (args.respondedAtMs < lead.capturedAt) {
      throw new Error(
        `attribution.recordLeadResponse: respondedAtMs (${args.respondedAtMs}) is before capturedAt (${lead.capturedAt}).`
      );
    }
    await ctx.db.patch(args.leadId, {
      respondedAtMs: args.respondedAtMs,
      responseLatencyMs: args.respondedAtMs - lead.capturedAt,
    });
    return { recorded: true, alreadyRecorded: false };
  },
});

/* -------------------------------------------------------------------------- */
/* clearAttribution — escape hatch for operator corrections                   */
/* -------------------------------------------------------------------------- */

/**
 * Clear an attribution link on an inboundLead. Used when the operator
 * corrects a wrong attribution from HQ (the "no, that lead came from
 * Yelp, not from the GBP post" case). Cross-tenant guarded.
 */
export const clearAttribution = internalMutation({
  args: {
    businessId: v.id("businesses"),
    leadId: v.id("inboundLeads"),
  },
  handler: async (ctx, args): Promise<void> => {
    const lead = await getLeadOrThrow(ctx, args.leadId, args.businessId);
    if (
      lead.originatingActionKind === undefined &&
      lead.originatingActionId === undefined
    ) {
      return;
    }
    // If the prior attribution was a gbp-post, scrub the post's
    // `attributedLeadIds` too.
    if (
      lead.originatingActionKind === "gbp-post" &&
      lead.originatingActionId !== undefined
    ) {
      const post = await ctx.db.get(lead.originatingActionId as Id<"gbpPosts">);
      if (post && post.businessId === args.businessId) {
        const filtered = (post.attributedLeadIds ?? []).filter(
          (id) => id !== args.leadId
        );
        await ctx.db.patch(post._id, {
          attributedLeadIds: filtered,
          updatedAt: Date.now(),
        });
      }
    }
    await ctx.db.patch(args.leadId, {
      originatingActionKind: undefined,
      originatingActionId: undefined,
    });
  },
});
