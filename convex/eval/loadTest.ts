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
import { TABLES_BY_CREATOR } from "../account/deletion";

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

/** Removes up to `limit` load-test creators and every row they own per call (call until 0). */
export const clear = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, a): Promise<number> => {
    const rows = (await ctx.db.query("schedule").withIndex("by_paired_status", (q) => q.eq("paired", true)).collect()) as Doc<"schedule">[];
    let removed = 0;
    for (const r of rows) {
      if (removed >= (a.limit ?? 100)) break;
      const c = (await ctx.db.get(r.creatorId)) as Doc<"creators"> | null;
      if (!c || !c.clerkUserId.startsWith(LOAD_PREFIX)) continue;
      // Every row it owns, or the fleet sampler keeps reading its watched accounts after it's gone.
      // Through each table's creator index (a filter scan read whole tables and hit the read limit).
      for (const table of TABLES_BY_CREATOR) {
        if (table === "schedule") continue; // the creator's delete trigger removes it
        let rows: Array<{ _id: never }> = [];
        for (const index of ["by_creator", "by_creator_and_ts", "by_creator_kind", "by_creator_and_createdAt", "by_creator_day"]) {
          try {
            rows = (await (ctx.db.query(table) as unknown as { withIndex: (i: string, f: (q: { eq: (k: string, v: unknown) => unknown }) => unknown) => { take: (n: number) => Promise<Array<{ _id: never }>> } }).withIndex(index, (q) => q.eq("creatorId", c._id)).take(500));
            break;
          } catch { /* this table has no index by that name; try the next */ }
        }
        for (const row of rows) await ctx.db.delete(row._id);
      }
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

/** Eval personas only: one open idea and a booked film block tomorrow, so the widget can be seen with data. */
export const seedWidgetDemo = internalMutation({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c || !/^eval(-run)?[:-]/.test(c.clerkUserId)) throw new Error("demo data is for eval personas only");
    const now = Date.now();
    const ideaId = await ctx.db.insert("ideas", { creatorId: a.creatorId, evidenceLinks: ["https://www.instagram.com/p/DcRIKq6xDpQ/"], fit: "yes", fitWhy: "your sub preps are your best format, and this is the next one", version: { hook: "pesto chicken subs, but for the whole week" }, messageText: "pesto chicken subs, but for the whole week", status: "sent", produced: { skillVersion: "demo", model: "demo", thresholdsVersion: "demo" }, createdAt: now } as never);
    const start = now + 22 * 3_600_000;
    await ctx.db.insert("calendarBlocks", { creatorId: a.creatorId, kind: "film", start, end: start + 3_600_000, title: "film: pesto chicken subs, but for the whole week", ideaId, status: "confirmed", consentAt: now, createdAt: now } as never);
    return null;
  },
});

/** Eval: an upload URL for a test file (big-video intake tests). */
export const uploadUrl = internalMutation({
  args: {},
  handler: async (ctx): Promise<string> => await ctx.storage.generateUploadUrl(),
});
