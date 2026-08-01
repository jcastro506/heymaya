/**
 * The per-machine daily spend ceiling (§8.1, §18 Sprint 2).
 *
 * > Model spend/day: ceiling per machine; **throttle, never destroy.**
 *
 * ## Why this file is careful
 *
 * This product has already got this wrong in the most expensive way available:
 * the previous implementation DESTROYED the Fly machine when a cost cap was
 * hit. That doesn't save money so much as delete the employee — the founder
 * texts and nothing answers, forever, and the only symptom is silence. The
 * standing rule that came out of it is unambiguous:
 *
 *   **Caps DEGRADE. They never destroy, and they are never fleet-wide.**
 *
 * So this module deliberately has no vocabulary for stopping anything. There
 * is no `destroy`, no `kill`, no `shutdown`, and a test asserts the verdict
 * union contains nothing of the kind — the same closed-set trick the iron rule
 * uses, for the same reason: the failure mode is someone reaching for a
 * plausible-sounding option under pressure.
 *
 * ## What throttling actually means
 *
 * Not "stop". **Stop the expensive things, keep answering.**
 *
 * A throttled machine still replies to the founder, still delivers messages,
 * still answers comments. What pauses is speculative, expensive work —
 * renders, research sweeps, production. A customer who has burned their daily
 * model budget should notice slower content, never an agent that stopped
 * talking to them.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { budgetsFor } from "./planFeatures";

/**
 * The only two states. Deliberately no third.
 *
 * `throttled` degrades expensive work. There is no state that stops the agent
 * responding, because that state is what destroyed a machine last time.
 */
export type SpendState = "normal" | "throttled";

/**
 * Work that continues no matter what the spend is.
 *
 * These are the things a human would notice stopping. If the ceiling could
 * silence these, the cap would be indistinguishable from an outage — which is
 * exactly what the machine-destroying version felt like from outside.
 */
export const ALWAYS_ALLOWED_KINDS: readonly string[] = [
  "deliver_message",
  "answer_comment",
  "answer_dm",
  "answer_mention",
] as const;

/**
 * Work that pauses while throttled. Expensive, speculative, and deferrable —
 * nobody is waiting on it in a conversation.
 */
export const THROTTLEABLE_KINDS: readonly string[] = [
  "produce_post",
  "render_video",
  "research_sweep",
  "mine_comments",
  "refresh_buyer_map",
] as const;

export interface SpendVerdict {
  state: SpendState;
  spentUsd: number;
  ceilingUsd: number;
  /** 0–1. Above 1 means over the ceiling. */
  ratio: number;
  /** Plain language, for the operator alert. */
  detail: string;
}

/**
 * Is this kind of work allowed right now?
 *
 * Unknown kinds are treated as throttleable — fail toward spending less. A new
 * job kind that nobody classified should not get an exemption by default; if
 * it genuinely must always run, that's a deliberate addition to the allow-list
 * and a code review.
 */
export function allowsKind(state: SpendState, kind: string): boolean {
  if (state === "normal") return true;
  return ALWAYS_ALLOWED_KINDS.includes(kind);
}

/** Pure verdict, so every branch is testable without a database. */
export function judgeSpend(input: {
  spentUsd: number;
  ceilingUsd: number;
}): SpendVerdict {
  const { spentUsd, ceilingUsd } = input;
  // A zero or negative ceiling would otherwise throttle everyone forever on a
  // division by zero.
  const ratio = ceilingUsd > 0 ? spentUsd / ceilingUsd : Infinity;
  const state: SpendState = spentUsd >= ceilingUsd ? "throttled" : "normal";

  return {
    state,
    spentUsd,
    ceilingUsd,
    ratio,
    detail:
      state === "normal"
        ? `$${spentUsd.toFixed(2)} of $${ceilingUsd.toFixed(2)} today`
        : `$${spentUsd.toFixed(2)} of $${ceilingUsd.toFixed(2)} today — pausing expensive work, still answering`,
  };
}

/**
 * Today's spend for one customer, derived from their jobs.
 *
 * Derived rather than counted (§8.1, "rows the server draws down"). A counter
 * drifts, and a drifted spend counter either throttles someone who spent
 * nothing or fails to throttle a runaway — both worse than a slightly more
 * expensive query.
 */
export const spendToday = internalQuery({
  args: { customerId: v.id("customers"), now: v.optional(v.number()) },
  handler: async (ctx, args): Promise<SpendVerdict> => {
    const now = args.now ?? Date.now();
    const since = Math.floor(now / 86_400_000) * 86_400_000;

    const customer = (await ctx.db.get(args.customerId)) as Doc<"customers"> | null;
    const ceilingUsd = budgetsFor(customer).dailySpendCeilingUsd;

    const jobs = (await ctx.db
      .query("jobs")
      .withIndex("by_customer_and_createdAt", (q) =>
        q.eq("customerId", args.customerId).gte("createdAt", since)
      )
      .collect()) as Doc<"jobs">[];

    const spentUsd = jobs.reduce((sum, job) => sum + (job.costUsd ?? 0), 0);
    return judgeSpend({ spentUsd, ceilingUsd });
  },
});

/**
 * Record what a job cost.
 *
 * Separate from `succeed`/`fail` because a job that FAILED may still have
 * spent money — a render that errored after the vendor charged, an LLM call
 * that timed out mid-stream. Tying cost to success would under-count exactly
 * the runaway case the ceiling exists to catch.
 */
export const recordCost = internalMutation({
  args: { jobId: v.id("jobs"), costUsd: v.number() },
  handler: async (ctx, args): Promise<{ recorded: boolean }> => {
    const job = (await ctx.db.get(args.jobId)) as Doc<"jobs"> | null;
    if (!job) return { recorded: false };
    await ctx.db.patch(args.jobId, {
      costUsd: (job.costUsd ?? 0) + args.costUsd,
      updatedAt: Date.now(),
    });
    return { recorded: true };
  },
});

/**
 * Alert the operator that a machine is throttled.
 *
 * Per customer, never fleet-wide — one runaway must not degrade the other 199.
 * Recorded as `warn` rather than `error`: a throttle is the system working as
 * designed, and treating a working safeguard as an error is how alert fatigue
 * starts.
 */
export const alertThrottled = internalMutation({
  args: {
    customerId: v.id("customers"),
    detail: v.string(),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ alerted: boolean }> => {
    const customer = (await ctx.db.get(args.customerId)) as Doc<"customers"> | null;
    if (!customer) return { alerted: false };

    const now = args.now ?? Date.now();
    const since = Math.floor(now / 86_400_000) * 86_400_000;

    // One alert per customer per day. A throttle that re-alerts every sweep
    // buries the operator surface in a condition they already know about.
    const existing = await ctx.db
      .query("gtmAuditEvents")
      .withIndex("by_account", (q) => q.eq("accountId", customer.accountId))
      .collect();
    if (
      existing.some(
        (e) => e.eventType === "spend.throttled" && e.createdAt >= since
      )
    ) {
      return { alerted: false };
    }

    await ctx.db.insert("gtmAuditEvents", {
      accountId: customer.accountId,
      actor: "system",
      eventType: "spend.throttled",
      severity: "warn",
      message: args.detail,
      createdAt: now,
    });
    return { alerted: true };
  },
});
