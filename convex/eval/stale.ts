/**
 * Dev only (2026-11-23): sims left their test creators live, and fleet jobs kept spending real credits on them
 * (~200 ScrapeCreators credits a day on dev for ten days). This pauses every simulated creator except the runs
 * named, reversibly: nothing is deleted, and a paused creator's watch list isn't read (scout/sampler).
 */
import { v } from "convex/values";
import { internalMutation } from "../lib/functions";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { TABLES_BY_CREATOR } from "../account/deletion";
import { CREATOR_INDEX } from "./livingSim";
import type { Doc } from "../_generated/dataModel";

/** Pure: a simulated creator, by how every sim names its users. A real person's Clerk id never starts this way. */
export function isSimCreator(clerkUserId: string | undefined): boolean {
  return /^(eval[-:_]|eval$|dev:|devbare_)/.test(clerkUserId ?? "");
}

/** Pure: a sim's own creator, deletable. The operator's hand-made dev accounts (devbare_, dev:) are kept. */
export function isDeletableSim(clerkUserId: string | undefined): boolean {
  return /^(eval[-:_]|eval$)/.test(clerkUserId ?? "");
}

/** Sim run state (firstWeek, livingSim, drills, seasons, deals runs): gone with the sims, so nothing resumes. */
export const SIM_STATE_RE = /^(fw:|sim:|drill:|season:|eval:deals_)/;

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

/**
 * Dev only (operator, 2026-11-23: "kill and destroy all old or running sims"): delete every sim creator and its
 * rows, a page at a time, then the sims' run state. New sims are made as needed.
 */
export const deleteSimsPage = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ deleted: number; done: boolean }> => {
    if (process.env.CONVEX_CLOUD_URL?.includes("resilient-mandrill-621")) throw new Error("dev only");
    let deleted = 0;
    const creators = (await ctx.db.query("creators").collect()) as Doc<"creators">[];
    for (const c of creators.filter((x) => isDeletableSim(x.clerkUserId))) {
      for (const table of TABLES_BY_CREATOR) {
        const index = CREATOR_INDEX[table];
        if (!index || table === "schedule") continue; // the creator's delete trigger removes its schedule row
        const q = ctx.db.query(table) as unknown as { withIndex: (i: string, f: (q: { eq: (k: string, v: unknown) => unknown }) => unknown) => { take: (n: number) => Promise<Array<{ _id: never }>> } };
        const rows = await q.withIndex(index, (x) => x.eq("creatorId", c._id)).take(400 - deleted);
        for (const r of rows) { await ctx.db.delete(r._id); deleted++; }
        if (deleted >= 400) return { deleted, done: false };
      }
      await ctx.db.delete(c._id);
      deleted++;
      if (deleted >= 400) return { deleted, done: false };
    }
    for (const row of (await ctx.db.query("syncState").collect()).filter((r) => SIM_STATE_RE.test(r.key))) {
      await ctx.db.delete(row._id);
      if (++deleted >= 400) return { deleted, done: false };
    }
    return { deleted, done: true };
  },
});

export const deleteSims = internalAction({
  args: {},
  handler: async (ctx): Promise<{ deleted: number; done: boolean }> => {
    let deleted = 0;
    for (let n = 0; n < 500; n++) {
      const r = await ctx.runMutation(internal.eval.stale.deleteSimsPage, {});
      deleted += r.deleted;
      if (r.done) return { deleted, done: true };
    }
    return { deleted, done: false };
  },
});
