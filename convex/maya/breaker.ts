/**
 * ⭐ The vendor circuit breaker (Sprint 6).
 *
 * `CREDIT_RESERVES` and `checkBalance` shipped with nothing fetching a real
 * number. The hourly sweep fixed that — and then only logged it. So a vendor at
 * zero changed nothing: every sweep still fired, every call still failed, every
 * retry still burned budget and latency, and the founder got silence.
 *
 * A breaker is the difference between *knowing* a vendor is down and *behaving*
 * as though it is.
 *
 * ## Why it fails OPEN
 *
 * ⚠️ A missing row means GO, and a stale row means GO. Both are deliberate.
 *
 * A breaker that fails closed turns "we have never checked this vendor" into
 * "nothing runs" — which is what a fresh deploy looks like, and what a broken
 * balance endpoint looks like. The cost of being wrong in that direction is a
 * silent product; the cost of being wrong the other way is one failed call that
 * was going to fail anyway.
 *
 * That is the same reasoning as the directive gate's no-key branch: open, and
 * loud about it.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

/**
 * How long a reading is trusted.
 *
 * Past this the breaker reopens on its own. A vendor marked critical three days
 * ago, by a sweep that has since stopped running, must not hold the product
 * shut forever — an unattended breaker that never reopens is an outage with a
 * good explanation.
 */
export const READING_TTL_MS = 3 * 60 * 60 * 1000;

export const record = internalMutation({
  args: {
    vendor: v.string(),
    verdict: v.union(v.literal("ok"), v.literal("low"), v.literal("critical")),
    balance: v.number(),
    detail: v.string(),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<null> => {
    const now = args.now ?? Date.now();
    const existing = (await ctx.db
      .query("vendorBreaker")
      .withIndex("by_vendor", (q) => q.eq("vendor", args.vendor))
      .first()) as Doc<"vendorBreaker"> | null;

    const row = {
      vendor: args.vendor,
      verdict: args.verdict,
      balance: args.balance,
      detail: args.detail,
      checkedAt: now,
    };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("vendorBreaker", row);
    return null;
  },
});

/**
 * May we call this vendor right now?
 *
 * ⚠️ `low` still goes. Low means "top this up this week", not "stop working" —
 * tripping at `low` would halt the product on a threshold set for comfort
 * rather than for failure. Only `critical` (a quarter of the reserve) trips,
 * because that is the reading that says the next calls will fail anyway.
 */
export const vendorOpen = internalQuery({
  args: { vendor: v.string(), now: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<{ open: boolean; reason?: string }> => {
    const now = args.now ?? Date.now();
    const row = (await ctx.db
      .query("vendorBreaker")
      .withIndex("by_vendor", (q) => q.eq("vendor", args.vendor))
      .first()) as Doc<"vendorBreaker"> | null;

    // Never checked. Open — see the module note.
    if (!row) return { open: true };
    // Stale. Open, and it reopens on its own rather than needing a hand.
    if (now - row.checkedAt > READING_TTL_MS) return { open: true };
    if (row.verdict !== "critical") return { open: true };

    return { open: false, reason: row.detail };
  },
});

/** Every vendor's last reading, for the operator surface. */
export const allVendors = internalQuery({
  args: {},
  handler: async (ctx): Promise<Doc<"vendorBreaker">[]> =>
    (await ctx.db.query("vendorBreaker").collect()) as Doc<"vendorBreaker">[],
});
