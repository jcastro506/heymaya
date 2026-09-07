/**
 * Scenario creators for the eval suites (plan §17, Sprint 3c), as their own rows.
 *
 * ⚠️ The first scout scenario shared a handle with the live pilot, and every gate run
 * reopened the pilot's real signals (2026-09-06). A scenario creator is never a customer:
 * its own clerk subject, never paired, `plan.status: "paused"` so no cron ever messages
 * it, and the dry runs pass `ignoreRails` on purpose. Seeding runs the same onboarding
 * path a customer takes, so the dossier and the clusters are the real ones.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { startCreator } from "../onboarding/start";
import { addTracked } from "../agent/manage";

export const SCENARIOS: ReadonlyArray<{ handle: string; platform: "tiktok"; admired: string[]; niche: string }> = [
  { handle: "vanessaalopezz", platform: "tiktok", admired: ["andi.renay", "becca_foggia", "nadyaokamoto"], niche: "" },
  { handle: "brettconti", platform: "tiktok", admired: ["drewbinsky", "starterstory", "aliabdaal"], niche: "" },
];

export const subjectFor = (handle: string) => `eval:${handle}`;

export const seedOne = internalMutation({
  args: { handle: v.string(), admired: v.array(v.string()), niche: v.string() },
  handler: async (ctx, a): Promise<{ creatorId: Id<"creators">; created: boolean }> => {
    const existing = (await ctx.db.query("creators").withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", subjectFor(a.handle))).first()) as Doc<"creators"> | null;
    if (existing) return { creatorId: existing._id, created: false };
    const r = await startCreator(ctx, { subject: subjectFor(a.handle), email: `${subjectFor(a.handle)}@eval.invalid`, handles: { tiktok: a.handle }, timezone: "America/New_York" });
    if (!r.ok || !r.creatorId) throw new Error(`could not seed scenario ${a.handle}: ${r.error}`);
    const creatorId = r.creatorId as Id<"creators">;
    const c = (await ctx.db.get(creatorId)) as Doc<"creators">;
    // Paused: the scout gate, the plan, the review and the first-week steps all skip it. Never paired.
    await ctx.db.patch(creatorId, { plan: { ...c.plan, status: "paused" }, niche: a.niche, updatedAt: Date.now() });
    for (const h of a.admired) {
      const rows = (await ctx.db.query("trackedAccounts").withIndex("by_creator", (q) => q.eq("creatorId", creatorId)).collect()) as Doc<"trackedAccounts">[];
      await addTracked(ctx as never, creatorId, "tiktok", h, rows);
    }
    return { creatorId, created: true };
  },
});

export const list = internalQuery({
  args: {},
  handler: async (ctx): Promise<Array<{ handle: string; creatorId: Id<"creators">; dossier: boolean; paused: boolean; paired: boolean }>> => {
    const out: Array<{ handle: string; creatorId: Id<"creators">; dossier: boolean; paused: boolean; paired: boolean }> = [];
    for (const s of SCENARIOS) {
      const c = (await ctx.db.query("creators").withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", subjectFor(s.handle))).first()) as Doc<"creators"> | null;
      if (c) out.push({ handle: s.handle, creatorId: c._id, dossier: Boolean(c.dossier), paused: c.plan.status === "paused", paired: Boolean(c.channel.paired) });
    }
    return out;
  },
});

/** Seed whatever is missing and run their onboarding read inline, so the suite has dossiers to judge against. */
export const ensure = internalAction({
  args: {},
  handler: async (ctx): Promise<Array<{ handle: string; creatorId: Id<"creators">; created: boolean; dossier: boolean }>> => {
    const out: Array<{ handle: string; creatorId: Id<"creators">; created: boolean; dossier: boolean }> = [];
    for (const s of SCENARIOS) {
      const r = await ctx.runMutation(internal.eval.scenarios.seedOne, { handle: s.handle, admired: s.admired, niche: s.niche });
      const before = (await ctx.runQuery(internal.eval.scenarios.list, {})).find((x) => x.creatorId === r.creatorId);
      if (!before?.dossier) await ctx.runAction(internal.onboarding.ingest.run, { creatorId: r.creatorId });
      const after = (await ctx.runQuery(internal.eval.scenarios.list, {})).find((x) => x.creatorId === r.creatorId);
      out.push({ handle: s.handle, creatorId: r.creatorId, created: r.created, dossier: Boolean(after?.dossier) });
    }
    return out;
  },
});
