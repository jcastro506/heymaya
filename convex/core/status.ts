/**
 * Her own machinery's bad days (plan §7 S3): "behind" when her proactive work died and nothing reached
 * them for hours; "cannot_see" when every read for their lane failed. Found once per kind per day and
 * logged for the operator. Never texted since 2026-10-09 (docs/CREATOR_REACH_OUT.md): a friend doesn't
 * announce a slow day.
 */

import { v } from "convex/values";
import { internalAction, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { dayKeyInZone } from "./cadence";
import { localHourMinute } from "../scout/gate";
import { pairedRows } from "./schedule";

export const dueStatus = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, a): Promise<Array<{ creatorId: Id<"creators">; kind: "behind" | "cannot_see"; day: string }>> => {
    const out: Array<{ creatorId: Id<"creators">; kind: "behind" | "cannot_see"; day: string }> = [];
    const since = a.now - 6 * 3_600_000;
    /**
     * ⚠️ Only checks that mean READS ARE FAILING may tell a creator she cannot see their
     * lane. This took the newest scrapecreators health row of any kind, so a nightly COST
     * RECONCILIATION mismatch ("vendor 50 vs ledger 114") made her apologise to a real
     * creator for an outage that never happened. An accounting discrepancy is an operator
     * problem; it has nothing to do with whether she can see TikTok.
     */
    const readChecks = new Set(["credit-balance", "read", "tiktok", "instagram"]);
    const recent = (await ctx.db.query("vendorHealth").withIndex("by_vendor_at", (q) => q.eq("vendor", "scrapecreators").gte("at", since)).order("desc").take(20)) as Doc<"vendorHealth">[];
    const scrapeDown = recent.find((r) => readChecks.has(r.check)) ?? null;
    for (const c of await pairedRows(ctx, { activeOnly: true })) {
      const { hour } = localHourMinute(a.now, c.timezone);
      if (hour < 9 || hour >= 20) continue; // a status text at 3am helps nobody
      const day = dayKeyInZone(a.now, c.timezone);
      const messages = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", c.creatorId).gte("ts", a.now - 26 * 3_600_000)).collect()) as Doc<"messages">[];
      const saidToday = (kind: string) => messages.some((m) => m.direction === "out" && m.dedupeKey === `status:${kind}:${day}`);
      const outboundRecently = messages.some((m) => m.direction === "out" && m.ts >= since && m.kind !== "status");
      const jobs = (await ctx.db.query("jobs").withIndex("by_creator", (q) => q.eq("creatorId", c.creatorId)).order("desc").take(40)) as Doc<"jobs">[];
      const diedRecently = jobs.some((j) => (j.status === "dead" || j.status === "failed") && j.updatedAt >= since && ["scout", "first_read", "ingest_catalogue", "deliver_message"].includes(j.kind));
      if (diedRecently && !outboundRecently && !saidToday("behind")) out.push({ creatorId: c.creatorId, kind: "behind", day });
      if (scrapeDown && !scrapeDown.ok && !saidToday("cannot_see")) out.push({ creatorId: c.creatorId, kind: "cannot_see", day });
    }
    return out;
  },
});

export const run = internalAction({
  args: {},
  handler: async (ctx): Promise<{ sent: number }> => {
    const due = await ctx.runQuery(internal.core.status.dueStatus, { now: Date.now() });
    let sent = 0;
    // Never texted (2026-10-09, docs/CREATOR_REACH_OUT.md): a friend doesn't announce a slow day, and this
    // went out as a non-proactive text past every rail. The operator sees it; the creator sees her next good text.
    for (const d of due) {
      console.warn(`[status] ${d.kind} for ${d.creatorId} on ${d.day} (not texted)`);
      sent++;
    }
    return { sent };
  },
});
