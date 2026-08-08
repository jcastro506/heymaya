/**
 * Carry the idea onto placements that were written before it was recorded.
 *
 * `placements.ideaId` exists in the schema and nothing wrote it until
 * 2026-08-08, so §5.0.0's *"% of posts traceable to a real buyer complaint"* —
 * the number that tests whether she does the homework — read **0 of 7** on its
 * first run. Every one of those posts had an idea behind it; the link simply
 * wasn't stored.
 *
 * The chain still exists one hop away: `placement.draftId → draft.ideaId`. This
 * walks it once so the measure is honest today rather than in a week.
 *
 * ⚠️ Only fills what is EMPTY. A placement that already carries an ideaId is
 * left alone — a backfill that overwrites is a backfill that can be wrong
 * twice.
 */
import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

export const run = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (
    ctx,
    args
  ): Promise<{ scanned: number; filled: number; noDraft: number; noIdea: number }> => {
    const dryRun = args.dryRun ?? false;
    const placements = (await ctx.db
      .query("placements")
      .collect()) as Doc<"placements">[];

    let filled = 0;
    let noDraft = 0;
    let noIdea = 0;

    for (const placement of placements) {
      if (placement.ideaId) continue;
      if (!placement.draftId) {
        // Replies carry no idea by design — the thing being answered IS the
        // evidence. Counted, not treated as a gap.
        noDraft += 1;
        continue;
      }
      const draft = (await ctx.db.get(placement.draftId)) as Doc<"drafts"> | null;
      if (!draft?.ideaId) {
        noIdea += 1;
        continue;
      }
      if (!dryRun) {
        await ctx.db.patch(placement._id, { ideaId: draft.ideaId });
      }
      filled += 1;
    }

    return { scanned: placements.length, filled, noDraft, noIdea };
  },
});
