/**
 * The operator console's one read (plan §7 operator surface). Token-gated and
 * fail-closed: no OPS_TOKEN on the deployment means nothing is readable. Everything
 * here is a row Maya already writes; the console adds no state.
 */

import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { pulseWord } from "./review/pulse";

function authorized(token: string): boolean {
  const expected = process.env.OPS_TOKEN;
  return Boolean(expected) && token === expected;
}

export const overview = query({
  args: { token: v.string() },
  handler: async (ctx, a) => {
    if (!authorized(a.token)) return null;
    const now = Date.now();
    const day = now - 86_400_000;
    const week = now - 7 * 86_400_000;
    const month = now - 28 * 86_400_000;
    const creators = (await ctx.db.query("creators").collect()) as Doc<"creators">[];
    const rows = [];
    for (const c of creators) {
      const messages = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", c._id).gte("ts", month)).collect()) as Doc<"messages">[];
      const events = (await ctx.db.query("tasteEvents").withIndex("by_creator", (q) => q.eq("creatorId", c._id).gte("at", month)).collect()) as Doc<"tasteEvents">[];
      const posts = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", c._id).gte("createTime", month)).collect()) as Doc<"ownPosts">[];
      const costs = (await ctx.db.query("costEvents").withIndex("by_creator_at", (q) => q.eq("creatorId", c._id).gte("at", week)).collect()) as Doc<"costEvents">[];
      const TAKEN = new Set(["posted", "blocked", "shotlist", "heart", "save", "reply_pos"]);
      const sentIn = (s: number) => messages.filter((m) => m.direction === "out" && m.proactive && m.ts >= s).length;
      const repliesIn = (s: number) => messages.filter((m) => m.direction === "in" && (m.kind ?? "inbound") === "inbound" && m.ts >= s).length;
      const lastReply = messages.filter((m) => m.direction === "in").sort((x, y) => y.ts - x.ts)[0];
      const lastOut = messages.filter((m) => m.direction === "out").sort((x, y) => y.ts - x.ts)[0];
      const pulseIn = { week: { sent: sentIn(week), replies: repliesIn(week), reactions: messages.filter((m) => m.direction === "in" && m.kind === "reaction" && m.ts >= week).length, taken: events.filter((e) => TAKEN.has(e.kind) && e.at >= week).length, passed: events.filter((e) => ["notme", "thumbs_down", "reply_neg"].includes(e.kind) && e.at >= week).length, posts: posts.filter((p) => p.createTime >= week).length }, month: { sent: sentIn(month), replies: repliesIn(month), taken: events.filter((e) => TAKEN.has(e.kind)).length, posts: posts.length }, daysSinceLastReply: lastReply ? Math.floor((now - lastReply.ts) / 86_400_000) : null, daysSincePaired: c.channel.paired ? Math.floor((now - (c.channel.pairedAt ?? c.createdAt)) / 86_400_000) : null };
      rows.push({
        id: c._id,
        handle: c.handles.tiktok ? `@${c.handles.tiktok}` : c.handles.instagram ? `ig @${c.handles.instagram}` : c.email,
        plan: c.plan.status,
        founding: c.plan.founding,
        paired: c.channel.paired,
        mode: c.mode,
        dossierVersion: c.dossierVersion,
        pulse: pulseWord(pulseIn),
        sentWeek: pulseIn.week.sent,
        repliesWeek: pulseIn.week.replies,
        takenWeek: pulseIn.week.taken,
        spendWeekUsd: Math.round(costs.reduce((s, x) => s + x.costUsd, 0) * 1000) / 1000,
        spendDayUsd: Math.round(costs.filter((x) => x.at >= day).reduce((s, x) => s + x.costUsd, 0) * 1000) / 1000,
        lastOut: lastOut ? { ts: lastOut.ts, kind: lastOut.kind ?? "reply", delivered: Boolean(lastOut.deliveredAt), error: lastOut.deliveryError ?? null, body: lastOut.body.slice(0, 140) } : null,
        undelivered: messages.filter((m) => m.direction === "out" && !m.deliveredAt && m.ts >= day).length,
      });
    }
    const jobs = (await ctx.db.query("jobs").order("desc").take(200)) as Doc<"jobs">[];
    const failed = jobs.filter((j) => j.status === "failed" || j.status === "dead").slice(0, 12).map((j) => ({ id: j._id, kind: j.kind, status: j.status, attempts: j.attempts, error: j.lastError ?? null, creatorId: j.creatorId ?? null, updatedAt: j.updatedAt }));
    const breakers = (await ctx.db.query("vendorBreaker").collect()) as Doc<"vendorBreaker">[];
    const fleetCosts = (await ctx.db.query("costEvents").filter((q) => q.gte(q.field("at"), day)).collect()) as Doc<"costEvents">[];
    const byVendor: Record<string, number> = {};
    for (const x of fleetCosts) byVendor[x.vendor] = Math.round(((byVendor[x.vendor] ?? 0) + x.costUsd) * 1000) / 1000;
    return { at: now, creators: rows, failedJobs: failed, queued: jobs.filter((j) => j.status === "queued").length, running: jobs.filter((j) => j.status === "running").length, breakers: breakers.map((b) => ({ vendor: b.vendor, verdict: b.verdict, balance: b.balance, detail: b.detail, checkedAt: b.checkedAt })), spendDayByVendor: byVendor };
  },
});
