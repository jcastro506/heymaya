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

/** §18 metrics and §3.6 COGS, all from rows: activation, weekly active, the north star, track record, silence, funnel, cost per creator. */
export const metrics = query({
  args: { token: v.string() },
  handler: async (ctx, a) => {
    if (!authorized(a.token)) return null;
    const now = Date.now();
    const week = now - 7 * 86_400_000;
    const month = now - 30 * 86_400_000;
    const creators = (await ctx.db.query("creators").collect()) as Doc<"creators">[];
    const paying = creators.filter((c) => c.plan.status === "active" || c.plan.status === "trialing" || c.plan.status === "comped");
    let activated = 0, withFirstRead = 0, weeklyActive = 0, postedIdeas = 0, mutes = 0;
    const ttfm: number[] = [];
    const perCreatorSpend: number[] = [];
    const byVendor: Record<string, number> = {};
    for (const c of creators) {
      const msgs = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", c._id)).collect()) as Doc<"messages">[];
      const firstOut = msgs.filter((m) => m.direction === "out" && m.deliveredAt).sort((x, y) => x.ts - y.ts)[0];
      if (firstOut) {
        withFirstRead++;
        ttfm.push((firstOut.deliveredAt! - c.createdAt) / 60_000);
        if (msgs.some((m) => m.direction === "in" && m.ts >= firstOut.ts && m.ts <= firstOut.ts + 48 * 3_600_000)) activated++;
      }
      if (msgs.some((m) => m.direction === "in" && m.ts >= week)) weeklyActive++;
      if (c.plan.status === "paused") mutes++;
      const ideas = (await ctx.db.query("ideas").withIndex("by_creator_status", (q) => q.eq("creatorId", c._id).eq("status", "posted")).collect()) as Doc<"ideas">[];
      postedIdeas += ideas.filter((i) => (i.postedAt ?? 0) >= month && (i.matchConfidence === "certain" || i.matchConfidence === "likely")).length;
      const costs = (await ctx.db.query("costEvents").withIndex("by_creator_at", (q) => q.eq("creatorId", c._id).gte("at", week)).collect()) as Doc<"costEvents">[];
      const spend = costs.reduce((s, x) => s + x.costUsd, 0);
      perCreatorSpend.push(spend);
      for (const x of costs) byVendor[x.vendor] = (byVendor[x.vendor] ?? 0) + x.costUsd;
    }
    const sorted = [...ttfm].sort((x, y) => x - y);
    const q = (p: number) => (sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]) : null);
    const preds = (await ctx.db.query("predictions").collect()) as Doc<"predictions">[];
    const byConf = new Map<string, number[]>();
    for (const p of preds) if (p.outcomeMultiple !== undefined) byConf.set(p.confidence, [...(byConf.get(p.confidence) ?? []), p.outcomeMultiple]);
    const med = (xs: number[]) => { const s = [...xs].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
    const record = ["strong", "solid", "fine", "weak", "broken"].map((k) => ({ confidence: k, medianActual: med(byConf.get(k) ?? []), n: (byConf.get(k) ?? []).length }));
    const weeklySpend = perCreatorSpend.reduce((s, x) => s + x, 0);
    const perCreatorMonthly = creators.length ? (weeklySpend / creators.length) * (30 / 7) : 0;
    const proactiveWeek = (await ctx.db.query("messages").withIndex("by_creator_and_ts").order("desc").take(1000)).filter((m) => m.direction === "out" && m.proactive && m.ts >= week).length;
    return {
      creators: creators.length,
      paying: paying.length,
      activation: withFirstRead ? Math.round((activated / withFirstRead) * 100) : null,
      weeklyActive: paying.length ? Math.round((weeklyActive / paying.length) * 100) : null,
      ideasPostedPerCreatorMonth: creators.length ? Math.round((postedIdeas / creators.length) * 10) / 10 : 0,
      trackRecord: record,
      silence: { proactivePerCreatorWeek: creators.length ? Math.round((proactiveWeek / creators.length) * 10) / 10 : 0, mutePct: creators.length ? Math.round((mutes / creators.length) * 100) : 0 },
      funnel: { timeToFirstMessageMinP50: q(0.5), p95: q(0.95), withFirstMessage: withFirstRead },
      cogs: { weeklySpendUsd: Math.round(weeklySpend * 100) / 100, perCreatorMonthlyUsd: Math.round(perCreatorMonthly * 100) / 100, byVendorWeek: Object.fromEntries(Object.entries(byVendor).map(([k, v2]) => [k, Math.round(v2 * 100) / 100])), marginAt19: perCreatorMonthly ? Math.round((1 - perCreatorMonthly / 19) * 100) : null, marginAt29: perCreatorMonthly ? Math.round((1 - perCreatorMonthly / 29) * 100) : null },
    };
  },
});
