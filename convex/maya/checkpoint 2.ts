/**
 * The daily checkpoint (§18 Sprint 2.9, §2.9.6).
 *
 * Once a day the agent reports two things Convex cannot see for itself, because
 * they live inside the machine:
 *
 * 1. **Her curated memory**, mirrored somewhere durable.
 * 2. **Whether her own context is being truncated.**
 *
 * ## Why this isn't the agent marking its own homework
 *
 * The liveness rule is that a system cannot be the watchdog for itself. This
 * doesn't violate it: the machine *reports facts* — a file's contents, a byte
 * count, a boolean from `openclaw doctor` — and **Convex does the judging**. A
 * machine that stops reporting is itself a breach, detected by a sweep that
 * runs somewhere else. Self-report of observations is fine; self-assessment of
 * health is not.
 *
 * ## Why only `MEMORY.md`
 *
 * Everything else on the volume is reproducible. The workspace is regenerated
 * on every deploy, and the memory vector index is **derived** — one
 * `openclaw memory index --force` rebuilds it from the markdown. `MEMORY.md` is
 * the single artifact that exists nowhere else: she writes it, dreaming
 * promotes into it, and it sits on one Fly volume with one copy.
 *
 * Daily notes are deliberately not copied. They're bulk, and their value is
 * largely as raw material for the distillation that lands in `MEMORY.md`.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

/**
 * How many snapshots to keep per customer.
 *
 * Enough to recover from "dreaming promoted something wrong last week" rather
 * than only "the volume died last night". Thirty daily copies of a compact
 * markdown file is trivial storage and a month of undo.
 */
export const SNAPSHOT_RETENTION = 30;

/**
 * A `MEMORY.md` that has shrunk sharply is the signal worth catching.
 *
 * The clobber bug this sprint fixed would have shown up exactly here: a file
 * that was 8KB yesterday and 200 bytes today has not been "tidied", it has been
 * overwritten by a template. Recording the drop is what makes that visible
 * before a month of learning is gone.
 */
export const SHRINK_ALERT_RATIO = 0.5;

export const record = internalMutation({
  args: {
    customerId: v.id("customers"),
    markdown: v.string(),
    contextTruncated: v.optional(v.boolean()),
    now: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    stored: boolean;
    bytes: number;
    shrankBy?: number;
    pruned: number;
  }> => {
    const customer = (await ctx.db.get(args.customerId)) as Doc<"customers"> | null;
    if (!customer) return { stored: false, bytes: 0, pruned: 0 };

    const now = args.now ?? Date.now();
    const bytes = args.markdown.length;

    const existing = (await ctx.db
      .query("memorySnapshots")
      .withIndex("by_customer_and_capturedAt", (q) =>
        q.eq("customerId", args.customerId)
      )
      .order("desc")
      .collect()) as Doc<"memorySnapshots">[];

    const previous = existing[0];
    // Only a DROP is interesting. Growth is the system working.
    const shrankBy =
      previous && previous.bytes > 0 && bytes < previous.bytes * SHRINK_ALERT_RATIO
        ? previous.bytes - bytes
        : undefined;

    if (shrankBy !== undefined) {
      await ctx.db.insert("gtmAuditEvents", {
        accountId: customer.accountId,
        actor: "system",
        eventType: "memory.shrank",
        // `error`, not `warn`: memory disappearing is the failure this product
        // spent a sprint fixing, and it is invisible from the outside.
        severity: "error",
        message: `MEMORY.md dropped from ${previous.bytes} to ${bytes} bytes`,
        createdAt: now,
      });
    }

    await ctx.db.insert("memorySnapshots", {
      customerId: args.customerId,
      capturedAt: now,
      markdown: args.markdown,
      bytes,
      contextTruncated: args.contextTruncated,
    });

    // Prune oldest-first. Retention is per customer, so a busy account can't
    // age out a quiet one's history.
    let pruned = 0;
    for (const row of existing.slice(SNAPSHOT_RETENTION - 1)) {
      await ctx.db.delete(row._id);
      pruned += 1;
    }

    return { stored: true, bytes, shrankBy, pruned };
  },
});

/**
 * The most recent checkpoint, for the liveness sweep.
 *
 * Returns null when there has never been one — which is itself the signal that
 * a machine has never checked in, not an error.
 */
export const latest = internalQuery({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args): Promise<Doc<"memorySnapshots"> | null> => {
    return (await ctx.db
      .query("memorySnapshots")
      .withIndex("by_customer_and_capturedAt", (q) =>
        q.eq("customerId", args.customerId)
      )
      .order("desc")
      .first()) as Doc<"memorySnapshots"> | null;
  },
});

/** Restore point: what her memory said at a given time. */
export const history = internalQuery({
  args: { customerId: v.id("customers"), limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<Doc<"memorySnapshots">[]> => {
    return (await ctx.db
      .query("memorySnapshots")
      .withIndex("by_customer_and_capturedAt", (q) =>
        q.eq("customerId", args.customerId)
      )
      .order("desc")
      .take(args.limit ?? 10)) as Doc<"memorySnapshots">[];
  },
});
