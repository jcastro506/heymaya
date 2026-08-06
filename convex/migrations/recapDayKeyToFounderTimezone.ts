/**
 * One-time re-key: evening recaps filed under tomorrow's date.
 *
 * Until 2026-08-06 `dayKey()` was UTC. The evening recap fires at 20:00 in the
 * founder's timezone, which for `America/New_York` is 00:00 UTC the NEXT day —
 * so every recap was stored as `recap:<tomorrow>`.
 *
 * Two consequences, one fixed in code and one only fixable here:
 *
 *  - `recapSentToday` looked for `recap:<today>`, matched the row written by
 *    YESTERDAY's recap, and concluded the recap had gone out. Permanently.
 *    That is fixed by the dayKey change itself.
 *
 *  - ⚠️ The stored rows still carry the shifted key, and `messages.send`
 *    dedupes forever on an exact key match. So TONIGHT's recap would compute
 *    the same key that last night's recap already wrote, and be silently
 *    suppressed — the fix would cause exactly one missing recap per customer.
 *
 * This re-keys those rows to the day they actually belong to. It is derived
 * from each message's own `ts` and the customer's own timezone, so it is
 * correct for every timezone rather than hard-coded to the one that exposed it.
 *
 * Idempotent: a row already carrying its correct key is left alone, so a
 * re-run is a no-op.
 */
import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { dayKeyInZone } from "../maya/cadence";

export const run = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (
    ctx,
    args
  ): Promise<{
    scanned: number;
    rekeyed: number;
    collisions: number;
    changes: Array<{ from: string; to: string }>;
  }> => {
    const dryRun = args.dryRun ?? false;
    const customers = (await ctx.db
      .query("customers")
      .collect()) as Doc<"customers">[];

    let scanned = 0;
    let rekeyed = 0;
    let collisions = 0;
    const changes: Array<{ from: string; to: string }> = [];

    for (const customer of customers) {
      const timezone = customer.timezone ?? "UTC";
      const messages = (await ctx.db
        .query("messages")
        .withIndex("by_customer_and_ts", (q) => q.eq("customerId", customer._id))
        .collect()) as Doc<"messages">[];

      for (const m of messages) {
        if (!m.dedupeKey?.startsWith("recap:")) continue;
        scanned += 1;

        const correct = `recap:${dayKeyInZone(m.ts, timezone)}`;
        if (m.dedupeKey === correct) continue;

        // If a row ALREADY holds the correct key, this one is a duplicate of a
        // day rather than a misfiled row. Leave it: silently merging two
        // recaps would destroy a receipt, and §2.7 says the founder's trust in
        // every future number rests on these never lying.
        const clash = messages.find(
          (other) => other._id !== m._id && other.dedupeKey === correct
        );
        if (clash) {
          collisions += 1;
          continue;
        }

        changes.push({ from: m.dedupeKey, to: correct });
        if (!dryRun) await ctx.db.patch(m._id, { dedupeKey: correct });
        rekeyed += 1;
      }
    }

    return { scanned, rekeyed, collisions, changes };
  },
});
