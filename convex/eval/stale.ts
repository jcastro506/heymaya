/**
 * Dev only (2026-11-23): sims left their test creators live, and fleet jobs kept spending real credits on them
 * (~200 ScrapeCreators credits a day on dev for ten days). This pauses every simulated creator except the runs
 * named, reversibly: nothing is deleted, and a paused creator's watch list isn't read (scout/sampler).
 */
import { v } from "convex/values";
import { internalMutation } from "../lib/functions";
import type { Doc } from "../_generated/dataModel";

/** Pure: a simulated creator, by how every sim names its users. A real person's Clerk id never starts this way. */
export function isSimCreator(clerkUserId: string | undefined): boolean {
  return /^(eval[-:_]|eval$|dev:|devbare_)/.test(clerkUserId ?? "");
}

export const pauseSims = internalMutation({
  args: { keepRuns: v.array(v.string()) },
  handler: async (ctx, a): Promise<{ paused: number; kept: number }> => {
    if (process.env.CONVEX_CLOUD_URL?.includes("resilient-mandrill-621")) throw new Error("dev only");
    const all = (await ctx.db.query("creators").collect()) as Doc<"creators">[];
    let paused = 0, kept = 0;
    for (const c of all) {
      if (!isSimCreator(c.clerkUserId)) continue;
      if (a.keepRuns.some((r) => c.clerkUserId.includes(r))) { kept++; continue; }
      if (["paused", "canceled", "deleting"].includes(c.plan.status)) continue;
      await ctx.db.patch(c._id, { plan: { ...c.plan, status: "paused" }, updatedAt: Date.now() });
      paused++;
    }
    return { paused, kept };
  },
});
