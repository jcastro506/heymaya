/**
 * S0 live exit: a cost-free load test of the hourly fleet jobs on a real deployment.
 *
 * `seed` writes N creators named `eval-load:<i>` across 24 timezones. They are paired and have a
 * dossier, so every hourly job's real "who's due" selection, fan-out and rails run on them. They
 * have no handles, tracked accounts or connections, so nothing calls a paid vendor; their
 * messages are never delivered (eval personas never queue a delivery); run it with MODEL_FAKE set
 * on the deployment so no model is billed. `clear` removes every one of them (and their rows).
 *
 * Eval only: every function refuses to touch a creator that isn't `eval-load:`.
 */
import { v } from "convex/values";
import { internalMutation } from "../lib/functions";
import { internalQuery } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

export const LOAD_PREFIX = "eval-load:";
const ZONES = [
  "Pacific/Honolulu", "America/Anchorage", "America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York",
  "America/Sao_Paulo", "Atlantic/Azores", "Europe/London", "Europe/Paris", "Europe/Athens", "Europe/Moscow",
  "Asia/Dubai", "Asia/Karachi", "Asia/Kolkata", "Asia/Dhaka", "Asia/Bangkok", "Asia/Shanghai",
  "Asia/Tokyo", "Australia/Brisbane", "Australia/Sydney", "Pacific/Noumea", "Pacific/Auckland", "Pacific/Tongatapu",
];

export const seed = internalMutation({
  args: { from: v.number(), count: v.number() },
  handler: async (ctx, a): Promise<number> => {
    const now = Date.now();
    for (let i = a.from; i < a.from + a.count; i++) {
      await ctx.db.insert("creators", {
        clerkUserId: `${LOAD_PREFIX}${i}`,
        email: `load-${i}@eval.invalid`,
        handles: {},
        ownership: "unverified",
        niche: "load test",
        timezone: ZONES[i % ZONES.length],
        quietHours: { start: "22:00", end: "07:00" },
        tone: "friend",
        mode: "full",
        dossier: { persona: "load test", voice: "plain" },
        dossierVersion: 1,
        notes: [],
        affinities: [],
        experiments: [],
        channel: { paired: true, pairedAt: now, kind: "telegram" },
        plan: { status: "active", founding: false, tier: "solo" },
        createdAt: now,
        updatedAt: now,
      } as never);
    }
    return a.count;
  },
});

/** Removes up to `limit` load-test creators and their messages per call (call until 0). */
export const clear = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, a): Promise<number> => {
    const rows = (await ctx.db.query("schedule").withIndex("by_paired_status", (q) => q.eq("paired", true)).collect()) as Doc<"schedule">[];
    let removed = 0;
    for (const r of rows) {
      if (removed >= (a.limit ?? 100)) break;
      const c = (await ctx.db.get(r.creatorId)) as Doc<"creators"> | null;
      if (!c || !c.clerkUserId.startsWith(LOAD_PREFIX)) continue;
      for (const m of await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", c._id)).collect()) await ctx.db.delete(m._id);
      await ctx.db.delete(c._id); // the trigger removes its schedule row
      removed++;
    }
    return removed;
  },
});

export const count = internalQuery({
  args: {},
  handler: async (ctx): Promise<number> => {
    const rows = (await ctx.db.query("schedule").withIndex("by_paired_status", (q) => q.eq("paired", true)).collect()) as Doc<"schedule">[];
    let n = 0;
    for (const r of rows) {
      const c = (await ctx.db.get(r.creatorId)) as Doc<"creators"> | null;
      if (c?.clerkUserId.startsWith(LOAD_PREFIX)) n++;
    }
    return n;
  },
});
