/**
 * ⭐ `plan-day` (Sprint 5) — the plan as a promise, not a sentence.
 *
 * §3.1 gives the agent "the daily plan" and it stayed entirely in her head: the
 * morning brief said what she intended and nothing recorded it. So when the day
 * ended differently, there was nothing to compare against.
 *
 * That happened twice in three days. On 2026-08-06 the brief said *"I'll shape
 * one X post… then show it to you first"* and the founder never saw one. On
 * 2026-08-08 it planned a placement and the turn produced nothing at all. Both
 * times the only record of the intention was a sentence in a chat message, and
 * a sentence cannot be checked.
 *
 * Principle 4: **anything promised to the user is enforced by the server.** A
 * plan is a promise. This is the row that makes it one.
 *
 * ## What it is not
 *
 * Not a scheduler and not a queue. Nothing here publishes, nothing here decides
 * what to write — she still chooses the angle and the words. The plan records
 * the choice so the evening can ask whether it happened, which is the only
 * thing an unrecorded intention can never be asked.
 *
 * ⚠️ And an unkept plan is REPORTED, not hidden. §12's rule holds: *"honest
 * silence beats fake activity."* A day that planned one post and shipped none
 * says so, with the reason — the failure mode being avoided is a recap that
 * reads fine on a day nothing happened.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { dayKeyInZone } from "./cadence";

export interface PlannedPost {
  planId: Id<"dayPlans">;
  channel: string;
  angle: string;
  ideaId: Id<"ideas">;
  status: "planned" | "done" | "dropped";
  droppedReason?: string;
}

export interface DayPlanReport {
  day: string;
  planned: number;
  done: number;
  dropped: number;
  /** Still open with the day running out. */
  outstanding: PlannedPost[];
  posts: PlannedPost[];
  /** Plain language, for the recap — it relays this unchanged. */
  detail: string;
}

/**
 * Write down what today is for.
 *
 * Idempotent per `{day, ideaId}`: the placement cron and a mid-morning
 * conversation can both plan the same thing without producing two promises to
 * keep.
 */
export const planPost = internalMutation({
  args: {
    customerId: v.id("customers"),
    ideaId: v.id("ideas"),
    channel: v.string(),
    now: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: boolean; planId?: Id<"dayPlans">; reason?: string }> => {
    const customer = (await ctx.db.get(args.customerId)) as Doc<"customers"> | null;
    if (!customer) return { ok: false, reason: "no such account" };

    const idea = (await ctx.db.get(args.ideaId)) as Doc<"ideas"> | null;
    if (!idea) return { ok: false, reason: "that idea doesn't exist" };
    // Cross-tenant guard: an id from another account never resolves.
    if (idea.customerId !== args.customerId) {
      return { ok: false, reason: "that idea belongs to a different account" };
    }

    const now = args.now ?? Date.now();
    const day = dayKeyInZone(now, customer.timezone ?? "UTC");

    const existing = (
      (await ctx.db
        .query("dayPlans")
        .withIndex("by_customer_and_day", (q) =>
          q.eq("customerId", args.customerId).eq("day", day)
        )
        .collect()) as Doc<"dayPlans">[]
    ).find((p) => p.ideaId === args.ideaId);
    if (existing) return { ok: true, planId: existing._id };

    const planId = await ctx.db.insert("dayPlans", {
      customerId: args.customerId,
      day,
      channel: args.channel,
      ideaId: args.ideaId,
      angle: idea.angle,
      status: "planned",
      createdAt: now,
      updatedAt: now,
    });
    return { ok: true, planId };
  },
});

/**
 * Mark a plan kept, by the placement that kept it.
 *
 * Matched on the IDEA rather than passed in, so publishing keeps the promise
 * without the publish path needing to know a plan exists. A join the caller has
 * to remember is a join that eventually isn't made — the shape that left
 * `placements.ideaId` empty for a sprint.
 */
export const markDoneByIdea = internalMutation({
  args: {
    customerId: v.id("customers"),
    ideaId: v.id("ideas"),
    placementId: v.id("placements"),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ marked: boolean }> => {
    const customer = (await ctx.db.get(args.customerId)) as Doc<"customers"> | null;
    if (!customer) return { marked: false };
    const now = args.now ?? Date.now();
    const day = dayKeyInZone(now, customer.timezone ?? "UTC");

    const plan = (
      (await ctx.db
        .query("dayPlans")
        .withIndex("by_customer_and_day", (q) =>
          q.eq("customerId", args.customerId).eq("day", day)
        )
        .collect()) as Doc<"dayPlans">[]
    ).find((p) => p.ideaId === args.ideaId && p.status === "planned");
    if (!plan) return { marked: false };

    await ctx.db.patch(plan._id, {
      status: "done",
      placementId: args.placementId,
      updatedAt: now,
    });
    return { marked: true };
  },
});

/**
 * Drop a plan, with a reason.
 *
 * ⚠️ The reason is required and short-circuits without one. §12: *"honest
 * silence beats fake activity"* — a plan that vanishes with no explanation is
 * indistinguishable from one that was never made, which is precisely the state
 * this table exists to end.
 */
export const dropPlan = internalMutation({
  args: {
    planId: v.id("dayPlans"),
    reason: v.string(),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ dropped: boolean; reason?: string }> => {
    if (args.reason.trim().length < 3) {
      return { dropped: false, reason: "a dropped plan needs a reason" };
    }
    const plan = (await ctx.db.get(args.planId)) as Doc<"dayPlans"> | null;
    if (!plan || plan.status !== "planned") return { dropped: false };

    await ctx.db.patch(args.planId, {
      status: "dropped",
      droppedReason: args.reason,
      updatedAt: args.now ?? Date.now(),
    });
    return { dropped: true };
  },
});

/**
 * ⭐ What she said she'd do today, and whether she did.
 *
 * The evening recap reads this. Its whole value is the gap: a day that planned
 * one post and shipped none must say so, because §12's failure mode is a recap
 * that reads fine on a day nothing happened.
 */
export const planFor = internalQuery({
  args: {
    customerId: v.id("customers"),
    now: v.optional(v.number()),
    day: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<DayPlanReport> => {
    const customer = (await ctx.db.get(args.customerId)) as Doc<"customers"> | null;
    const now = args.now ?? Date.now();
    const day =
      args.day ?? dayKeyInZone(now, customer?.timezone ?? "UTC");

    const rows = (await ctx.db
      .query("dayPlans")
      .withIndex("by_customer_and_day", (q) =>
        q.eq("customerId", args.customerId).eq("day", day)
      )
      .collect()) as Doc<"dayPlans">[];

    const posts: PlannedPost[] = rows.map((r) => ({
      planId: r._id,
      channel: r.channel,
      angle: r.angle,
      ideaId: r.ideaId,
      status: r.status,
      droppedReason: r.droppedReason,
    }));

    const done = posts.filter((p) => p.status === "done").length;
    const dropped = posts.filter((p) => p.status === "dropped").length;
    const outstanding = posts.filter((p) => p.status === "planned");

    let detail: string;
    if (posts.length === 0) {
      detail = "nothing was planned today";
    } else if (outstanding.length === 0 && dropped === 0) {
      detail = `everything planned went out — ${done} of ${posts.length}`;
    } else if (outstanding.length > 0) {
      // Named, never softened. This is the sentence that would have caught
      // both silent days.
      detail = `${done} of ${posts.length} planned posts went out; still open: ${outstanding
        .map((p) => `"${p.angle}"`)
        .join(", ")}`;
    } else {
      detail = `${done} of ${posts.length} went out; dropped: ${posts
        .filter((p) => p.status === "dropped")
        .map((p) => `"${p.angle}" — ${p.droppedReason ?? "no reason given"}`)
        .join(", ")}`;
    }

    return { day, planned: posts.length, done, dropped, outstanding, posts, detail };
  },
});
