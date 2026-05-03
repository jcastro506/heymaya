/**
 * Plan screen queries + mutations.
 *
 * The Plan screen at `app/(creator)/plan/page.tsx` renders Maya's
 * Sun-4pm-generated content plan for the upcoming week and a scrollable
 * archive of past plans. Every read is cross-tenant safe via the same
 * Clerk identity → creators row → creatorId chain Today/Performance use.
 *
 * Plan-tier: weekly content plans run on every plan (it's the core
 * value-prop), so reads are unrestricted. The replan/approve mutations
 * are also unrestricted because the creator owns their plan — they can
 * always reshape it. The thinking-budget cap is enforced separately
 * inside the model router when Maya re-generates.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

/**
 * Cross-tenant gate. Mirrors `today.ts` / `performance.ts`. Centralized so
 * an audit can grep `getCurrentCreator(` across convex/ and find every
 * cross-tenant boundary in one shot.
 */
async function getCurrentCreator(
  ctx: QueryCtx
): Promise<Doc<"creators"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("creators")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
    .first();
}

/**
 * Latest contentPlans row for the signed-in creator. The Plan screen reads
 * this directly to render the 7-day arc. We sort by `_creationTime` desc
 * because two Sundays in flight on a brand-new creator should always show
 * the most-recently-written.
 *
 * Returns null when:
 *   - unauthenticated (UI shows skeleton)
 *   - creator row not yet provisioned
 *   - no plan written yet (UI shows empty state)
 */
export const currentPlan = query({
  args: {},
  handler: async (ctx) => {
    const creator = await getCurrentCreator(ctx);
    if (!creator) return null;
    return await ctx.db
      .query("contentPlans")
      .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
      .order("desc")
      .first();
  },
});

/**
 * Paginated past plans, newest first. The Plan screen renders the most-
 * recent under "This week" and stacks the rest under a collapsible
 * "Plan history" panel.
 *
 * Skips the most-recent row (it's already shown as `currentPlan`) so the
 * history list is unambiguous.
 */
export const planHistory = query({
  args: {
    paginationOpts: v.object({
      numItems: v.number(),
      cursor: v.union(v.string(), v.null()),
    }),
  },
  handler: async (ctx, args) => {
    const creator = await getCurrentCreator(ctx);
    if (!creator) {
      return { page: [], isDone: true, continueCursor: "" };
    }
    // Pull one extra row so we can drop the current plan from the head of
    // the first page deterministically. The pagination cursor is opaque
    // so we can't index-skip it server-side without a custom cursor.
    const result = await ctx.db
      .query("contentPlans")
      .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
      .order("desc")
      .paginate(args.paginationOpts);

    if (args.paginationOpts.cursor === null && result.page.length > 0) {
      result.page = result.page.slice(1);
    }
    return result;
  },
});

/**
 * Reset a single day in the latest plan back to draft state. Sprint 5 ships
 * this as the user-visible reset; the actual Maya-side regen wires up in
 * Sprint 6 when the model router gains a `replanDay` task tag.
 *
 * Cross-tenant: the planId is supplied by the client but we re-validate
 * `creatorId === me._id` before mutating — never trust an id from the wire.
 *
 * TODO(s6): wire to maya-content-arc-planner via the model router so the
 * replan actually re-generates the day instead of just clearing approval.
 */
export const replanDay = mutation({
  args: {
    planId: v.id("contentPlans"),
    dayOffset: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated.");
    const me = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first();
    if (!me) throw new Error("Creator row not found for signed-in user.");

    const plan = await ctx.db.get(args.planId);
    if (!plan) throw new Error("Plan not found.");
    if (plan.creatorId !== me._id) {
      throw new Error("Plan does not belong to signed-in creator.");
    }

    const updatedArc = plan.arc.map((entry) =>
      entry.dayOffset === args.dayOffset
        ? { ...entry, status: "draft" as const }
        : entry
    );
    await ctx.db.patch(args.planId, { arc: updatedArc });
    return { ok: true };
  },
});

/**
 * Mark a planned post as approved. Approved entries graduate from "needs
 * eyes" (surfaced in Today's pending items) to "queued" — Maya stops
 * nagging about them.
 *
 * Cross-tenant: same revalidation as `replanDay`.
 */
export const approveDay = mutation({
  args: {
    planId: v.id("contentPlans"),
    dayOffset: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated.");
    const me = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first();
    if (!me) throw new Error("Creator row not found for signed-in user.");

    const plan = await ctx.db.get(args.planId);
    if (!plan) throw new Error("Plan not found.");
    if (plan.creatorId !== me._id) {
      throw new Error("Plan does not belong to signed-in creator.");
    }

    const updatedArc = plan.arc.map((entry) =>
      entry.dayOffset === args.dayOffset
        ? { ...entry, status: "approved" as const }
        : entry
    );
    await ctx.db.patch(args.planId, { arc: updatedArc });
    return { ok: true };
  },
});
