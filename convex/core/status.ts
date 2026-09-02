/**
 * Creator-facing status (plan §7 S3 "Status" messages, §6 Sprint 3 edge cases): when
 * her own machinery let them down, she says so once, plainly, and never blames them.
 * "behind today" when her proactive work died and nothing reached them for hours;
 * "couldn't see TikTok today" when every read for their lane failed. One per kind per
 * day; status messages do not count against the daily cap (the gate ignores `status`).
 */

import { v } from "convex/values";
import { internalAction, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { dayKeyInZone } from "./cadence";
import { localHourMinute } from "../scout/gate";

export const BEHIND = "behind today: my read on your lane didn't go through on my side. nothing you did. back on it, and i'll text when there's something worth it.";
export const CANNOT_SEE = "heads up: i couldn't see tiktok properly today, so if i'm quiet that's why, not because nothing happened. trying again through the day.";

export const dueStatus = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, a): Promise<Array<{ creatorId: Id<"creators">; kind: "behind" | "cannot_see"; day: string }>> => {
    const out: Array<{ creatorId: Id<"creators">; kind: "behind" | "cannot_see"; day: string }> = [];
    const creators = (await ctx.db.query("creators").collect()) as Doc<"creators">[];
    const since = a.now - 6 * 3_600_000;
    const scrapeDown = (await ctx.db.query("vendorHealth").withIndex("by_vendor_at", (q) => q.eq("vendor", "scrapecreators").gte("at", since)).order("desc").first()) as Doc<"vendorHealth"> | null;
    for (const c of creators) {
      if (!c.channel.paired || c.plan.status === "paused" || c.plan.status === "canceled" || c.plan.status === "deleting") continue;
      const { hour } = localHourMinute(a.now, c.timezone);
      if (hour < 9 || hour >= 20) continue; // a status text at 3am helps nobody
      const day = dayKeyInZone(a.now, c.timezone);
      const messages = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", c._id).gte("ts", a.now - 26 * 3_600_000)).collect()) as Doc<"messages">[];
      const saidToday = (kind: string) => messages.some((m) => m.direction === "out" && m.dedupeKey === `status:${kind}:${day}`);
      const outboundRecently = messages.some((m) => m.direction === "out" && m.ts >= since && m.kind !== "status");
      const jobs = (await ctx.db.query("jobs").withIndex("by_creator", (q) => q.eq("creatorId", c._id)).order("desc").take(40)) as Doc<"jobs">[];
      const diedRecently = jobs.some((j) => (j.status === "dead" || j.status === "failed") && j.updatedAt >= since && ["scout", "first_read", "ingest_catalogue", "deliver_message"].includes(j.kind));
      if (diedRecently && !outboundRecently && !saidToday("behind")) out.push({ creatorId: c._id, kind: "behind", day });
      if (scrapeDown && !scrapeDown.ok && !saidToday("cannot_see")) out.push({ creatorId: c._id, kind: "cannot_see", day });
    }
    return out;
  },
});

export const run = internalAction({
  args: {},
  handler: async (ctx): Promise<{ sent: number }> => {
    const due = await ctx.runQuery(internal.core.status.dueStatus, { now: Date.now() });
    let sent = 0;
    for (const d of due) {
      const { messageId } = await ctx.runMutation(internal.core.messages.send, { creatorId: d.creatorId, surface: "telegram", body: d.kind === "behind" ? BEHIND : CANNOT_SEE, dedupeKey: `status:${d.kind}:${d.day}`, proactive: false, kind: "status" });
      if (messageId) sent++;
    }
    return { sent };
  },
});
