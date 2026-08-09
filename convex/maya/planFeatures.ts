/**
 * `planFeatures` — budgets, never booleans (§17.2.6, §17.2.8).
 *
 * > Never `canVideo: true/false`. Always `videosPerMonth: 0 | 4 | 15`.
 *
 * One dimension (quantity) instead of two (capability × quantity). Zero is a
 * valid budget that degrades through the existing ladder rather than a hard
 * capability wall. This is what structurally enforces *never ship a worse
 * Maya*: every plan is the same product at a different volume, and there is no
 * code path where a capability simply doesn't exist.
 *
 * The audit found `canImage: false` on the old entry tier — which under this
 * channel set made three of four channels unusable. That shipped. Boolean
 * capability flags compose badly and multiply into 2ⁿ states, most of them
 * never tested. Hence numbers.
 *
 * Two layers, always:
 *   - **Behavioral** — her context block carries current budgets, so she plans
 *     within them and never promises past them.
 *   - **Server** — every metered call re-checks here, fail-closed. The model
 *     can drift; the gate cannot.
 */

import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import {
  dayScanFloor,
  isSameDayInZone,
  isSameMonthInZone,
} from "./cadence";

export interface Budgets {
  maxChannels: number;
  postsPerDayPerChannel: number;
  videosPerMonth: number;
  coldRepliesPerDay: number;
  proactiveMessagesPerDay: number;
  dailySpendCeilingUsd: number;
}

/**
 * MVP ships ONE tier at $149, everything unlocked (§17.2.5).
 *
 * Tier gating is a bug factory and you don't yet know what people pay more
 * for. But limits are not gates: "you can't make video" ships a worse product,
 * while "4 videos included this month, then I'll use photo sets" protects COGS
 * and keeps the product whole.
 */
export const MVP_BUDGETS: Budgets = {
  /** All four channels available; ~2 recommended active. */
  maxChannels: 4,
  postsPerDayPerChannel: 2,
  /** Then she degrades to photo sets, and says so plainly (§7.6.5). */
  videosPerMonth: 4,
  coldRepliesPerDay: 8,
  /** Morning brief + evening recap + headroom for genuine alerts. Above this
   *  she is interrupting rather than reporting. */
  proactiveMessagesPerDay: 4,
  /** A runaway guard, not a usage target. Blended COGS runs ~$29–41/month
   *  (~$1–1.4/day), so this sits well clear of normal and catches a loop.
   *  Exceeding it THROTTLES that machine — never destroys it, never
   *  fleet-wide. Destroying a machine on cap is a design bug we already
   *  shipped once. */
  dailySpendCeilingUsd: 5,
};

/**
 * Fail-closed default. An unknown or unreadable customer gets zero of
 * everything — a gate that can't identify you doesn't let you spend.
 */
export const ZERO_BUDGETS: Budgets = {
  maxChannels: 0,
  postsPerDayPerChannel: 0,
  videosPerMonth: 0,
  coldRepliesPerDay: 0,
  proactiveMessagesPerDay: 0,
  dailySpendCeilingUsd: 0,
};

/**
 * Budgets for a customer row.
 *
 * `paused` and `cancelled` zero out everything that acts on the world, while
 * leaving the row intact — a paused account is not a deleted one, and it
 * resumes without re-onboarding.
 */
export function budgetsFor(customer: Doc<"customers"> | null): Budgets {
  if (!customer) return ZERO_BUDGETS;
  if (customer.state === "paused" || customer.state === "cancelled") {
    return ZERO_BUDGETS;
  }
  switch (customer.plan) {
    case "mvp":
      return MVP_BUDGETS;
    default:
      // Unreachable today; the point is that an unrecognized plan fails
      // closed rather than falling through to the most generous branch.
      return ZERO_BUDGETS;
  }
}

export type Verdict = "full" | "graceful_degrade" | "hard_block";

/**
 * Whether running out of a given budget drops a rung or stops the work.
 *
 * Video degrades because a cheaper rung exists (photo sets, then text). Posts
 * and cold replies block because the only rung below "post once more" is not
 * posting — but even then she says so plainly rather than going quiet.
 */
const ON_EXHAUSTION: Record<keyof Budgets, Verdict> = {
  maxChannels: "hard_block",
  postsPerDayPerChannel: "hard_block",
  videosPerMonth: "graceful_degrade",
  coldRepliesPerDay: "hard_block",
  proactiveMessagesPerDay: "hard_block",
  dailySpendCeilingUsd: "graceful_degrade",
};

export interface BudgetCheck {
  verdict: Verdict;
  limit: number;
  used: number;
  remaining: number;
  /** Plain language, because this reaches the founder (§ user-facing copy). */
  reason: string;
}

/**
 * Pure budget arithmetic. Separated from the counting so the policy — what
 * counts as exhausted, and what happens then — is testable without a database.
 */
export function verdictFor(
  metric: keyof Budgets,
  used: number,
  budgets: Budgets
): BudgetCheck {
  const limit = budgets[metric];
  const remaining = Math.max(0, limit - used);
  if (used < limit) {
    return {
      verdict: "full",
      limit,
      used,
      remaining,
      reason: `${remaining} of ${limit} left`,
    };
  }
  const verdict = ON_EXHAUSTION[metric];
  return {
    verdict,
    limit,
    used,
    remaining: 0,
    reason:
      verdict === "graceful_degrade"
        ? `used all ${limit} for this period — dropping to a cheaper option`
        : `used all ${limit} for this period`,
  };
}

/**
 * ⚠️ These were `startOfDayUtc` / `startOfMonthUtc` until 2026-08-06 and both
 * were wrong for the same reason: a budget belongs to the FOUNDER's day, not
 * to UTC's. In `America/New_York` a UTC-midnight boundary hands out a fresh
 * daily post budget at 20:00 local — during the evening she is most active.
 *
 * Kept as scan floors only. Membership is decided by `isSameDayInZone` /
 * `isSameMonthInZone`, which are also correct across DST.
 */

async function loadCustomer(
  ctx: QueryCtx,
  customerId: Id<"customers">
): Promise<Doc<"customers"> | null> {
  // The schema is at TypeScript's instantiation ceiling, so `db.get` returns a
  // union of every table's doc type instead of narrowing.
  return (await ctx.db.get(customerId)) as Doc<"customers"> | null;
}

/** The budget object, as the context block and every metered call read it. */
export const planFeatures = internalQuery({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args): Promise<Budgets> =>
    budgetsFor(await loadCustomer(ctx, args.customerId)),
});

/**
 * Can this customer post on this channel right now?
 *
 * Counts real placements rather than trusting a counter, so a double-write or
 * a lost decrement can't quietly grant extra posts.
 */
export const checkPostBudget = internalQuery({
  args: { customerId: v.id("customers"), channel: v.string(), now: v.optional(v.number()) },
  handler: async (ctx, args): Promise<BudgetCheck> => {
    const customer = await loadCustomer(ctx, args.customerId);
    const budgets = budgetsFor(customer);
    if (!customer) {
      return {
        verdict: "hard_block",
        limit: 0,
        used: 0,
        remaining: 0,
        reason: "account not found",
      };
    }
    const now = args.now ?? Date.now();
    const timezone = customer.timezone ?? "UTC";
    const today = await ctx.db
      .query("placements")
      .withIndex("by_customer_and_publishedAt", (q) =>
        q.eq("customerId", args.customerId).gte("publishedAt", dayScanFloor(now))
      )
      .collect();
    const used = today.filter(
      (row) =>
        row.channel === args.channel &&
        row.kind === "post" &&
        isSameDayInZone(row.publishedAt, now, timezone)
    ).length;
    return verdictFor("postsPerDayPerChannel", used, budgets);
  },
});

/**
 * Video allowance for the calendar month.
 *
 * Exhaustion degrades rather than blocks — she still plans the video, still
 * asks for footage, and ships a photo set instead, saying so.
 */
export const checkVideoBudget = internalQuery({
  args: { customerId: v.id("customers"), now: v.optional(v.number()) },
  handler: async (ctx, args): Promise<BudgetCheck> => {
    const customer = await loadCustomer(ctx, args.customerId);
    const budgets = budgetsFor(customer);
    if (!customer) {
      return {
        verdict: "hard_block",
        limit: 0,
        used: 0,
        remaining: 0,
        reason: "account not found",
      };
    }
    const now = args.now ?? Date.now();
    const rows = await ctx.db
      .query("jobs")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .collect();
    const used = rows.filter(
      (row) =>
        row.kind === "render_video" &&
        row.status === "succeeded" &&
        isSameMonthInZone(row.createdAt, now, customer.timezone ?? "UTC")
    ).length;
    return verdictFor("videosPerMonth", used, budgets);
  },
});

/**
 * Whether another channel may be connected.
 *
 * `dormant` channels don't count — they're over-cap connections preserved
 * across a downgrade, and counting them would prevent the reactivation they
 * exist for.
 */
export const checkChannelBudget = internalQuery({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args): Promise<BudgetCheck> => {
    const customer = await loadCustomer(ctx, args.customerId);
    const budgets = budgetsFor(customer);
    if (!customer) {
      return {
        verdict: "hard_block",
        limit: 0,
        used: 0,
        remaining: 0,
        reason: "account not found",
      };
    }
    const channels = await ctx.db
      .query("channels")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .collect();
    const used = channels.filter((row) => row.status === "connected").length;
    return verdictFor("maxChannels", used, budgets);
  },
});
