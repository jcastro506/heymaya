/**
 * The thin UI's reads and its two write paths (plan §7 S4). Every tab is a reactive
 * query over the rows Maya writes; the web writes only settings and directives, and
 * every control here has a chat equivalent (§1). Clerk identity scopes everything.
 */

import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { summarize, type Affinity } from "./taste/affinities";
import { computeRung, engagement } from "./review/rung";

async function me(ctx: QueryCtx | MutationCtx): Promise<Doc<"creators"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return (await ctx.db.query("creators").withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", identity.subject)).first()) as Doc<"creators"> | null;
}

/** Today: is she working, what did she send, what's next. */
export const today = query({
  args: {},
  handler: async (ctx) => {
    const c = await me(ctx);
    if (!c) return null;
    const now = Date.now();
    const dayAgo = now - 24 * 3600 * 1000;
    const messages = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", c._id)).order("desc").take(30)) as Doc<"messages">[];
    const sentToday = messages.filter((m) => m.direction === "out" && m.ts >= dayAgo).map((m) => ({ id: m._id, kind: m.kind ?? "reply", body: m.body, links: m.links ?? [], ts: m.ts, delivered: Boolean(m.deliveredAt), error: m.deliveryError ?? null }));
    const jobs = (await ctx.db.query("jobs").withIndex("by_creator", (q) => q.eq("creatorId", c._id)).collect()) as Doc<"jobs">[];
    const running = jobs.filter((j) => j.status === "running" || j.status === "queued").map((j) => j.kind);
    const tracked = (await ctx.db.query("trackedAccounts").withIndex("by_creator", (q) => q.eq("creatorId", c._id)).collect()) as Doc<"trackedAccounts">[];
    const active = tracked.filter((t) => t.status === "active");
    const lastSample = active.reduce((m, t) => Math.max(m, t.lastSampledAt ?? 0), 0);
    const posts = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", c._id)).order("desc").take(7)) as Doc<"ownPosts">[];
    const blocks = (await ctx.db.query("calendarBlocks").withIndex("by_creator", (q) => q.eq("creatorId", c._id).gte("start", now)).take(10)) as Doc<"calendarBlocks">[];
    const block = blocks.find((b) => b.status === "confirmed" || b.status === "moved") ?? blocks.find((b) => b.status === "proposed") ?? null;
    const statusLine = !c.channel.paired
      ? "Not connected to Telegram yet."
      : !c.dossier
        ? `Reading your posts now (${posts.length} so far).`
        : `Watching ${active.length} account${active.length === 1 ? "" : "s"}.${lastSample ? ` Last look ${Math.round((now - lastSample) / 3_600_000)}h ago.` : ""}${running.length ? ` Working on ${running.length} thing${running.length === 1 ? "" : "s"}.` : ""}`;
    return {
      statusLine,
      paired: c.channel.paired,
      dossier: Boolean(c.dossier),
      sentToday,
      nextBlock: block ? { kind: block.kind, start: block.start, end: block.end, title: block.title, status: block.status } : null,
      week: posts.map((p) => ({ id: p._id, url: p.url, platform: p.platform, createTime: p.createTime, views: p.metrics.views, multiple: p.multiple ?? null, metricsAsOf: p.metricsAsOf })),
    };
  },
});

/** Ideas: the inventory and the scoreboard. */
export const ideas = query({
  args: { unpostedOnly: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const c = await me(ctx);
    if (!c) return null;
    const rows = (await ctx.db.query("ideas").withIndex("by_creator", (q) => q.eq("creatorId", c._id)).order("desc").take(100)) as Doc<"ideas">[];
    return rows
      .filter((i) => !a.unpostedOnly || i.status !== "posted")
      .map((i) => ({ id: i._id, status: i.status, reaction: i.reaction ?? null, newForYou: Boolean(i.newForYou), features: i.features ?? null, fitWhy: i.fitWhy, evidenceLinks: i.evidenceLinks, version: i.version as { hook?: string; onScreenText?: string; lengthSec?: number; sound?: string } | null, messageText: i.messageText, sentAt: i.sentAt ?? null, postedAt: i.postedAt ?? null, matchedPostId: i.matchedPostId ?? null }));
  },
});

/** Lane: who she watches and what moved. */
export const lane = query({
  args: {},
  handler: async (ctx) => {
    const c = await me(ctx);
    if (!c) return null;
    const tracked = (await ctx.db.query("trackedAccounts").withIndex("by_creator", (q) => q.eq("creatorId", c._id)).collect()) as Doc<"trackedAccounts">[];
    const signals = (await ctx.db.query("signals").withIndex("by_creator", (q) => q.eq("creatorId", c._id)).order("desc").take(30)) as Doc<"signals">[];
    const lastByAccount = new Map<Id<"trackedAccounts">, Doc<"signals">>();
    for (const s of signals) if (s.trackedAccountId && !lastByAccount.has(s.trackedAccountId)) lastByAccount.set(s.trackedAccountId, s);
    return {
      accounts: tracked.filter((t) => t.status !== "removed").map((t) => ({
        id: t._id,
        platform: t.platform,
        handle: t.handle,
        status: t.status,
        baseline: t.medianPace24h ?? null,
        baselineN: t.baselineN,
        lastSampledAt: t.lastSampledAt ?? null,
        lastBreakout: lastByAccount.get(t._id) ? { score: lastByAccount.get(t._id)!.score, verdict: lastByAccount.get(t._id)!.verdict, why: lastByAccount.get(t._id)!.why, at: lastByAccount.get(t._id)!.createdAt } : null,
      })),
      rising: signals.filter((s) => s.kind === "shape").slice(0, 10).map((s) => ({ id: s._id, why: s.why, verdict: s.verdict, at: s.createdAt })),
      keywords: ((c.dossier as { keywords?: string[] } | undefined)?.keywords ?? []),
    };
  },
});

/** Settings: what she knows and what they told her. */
export const settings = query({
  args: {},
  handler: async (ctx) => {
    const c = await me(ctx);
    if (!c) return null;
    const directives = (await ctx.db.query("directives").withIndex("by_creator_and_active", (q) => q.eq("creatorId", c._id).eq("active", true)).collect()) as Doc<"directives">[];
    const d = c.dossier as { persona?: { summary?: string; register?: string }; works?: Array<{ claim: string }>; doesNot?: Array<{ claim: string }>; keywords?: string[]; mode?: string } | undefined;
    return {
      handles: c.handles,
      niche: c.niche,
      timezone: c.timezone,
      quietHours: c.quietHours,
      tone: c.tone,
      paired: c.channel.paired,
      plan: c.plan.status,
      knows: d ? { summary: d.persona?.summary ?? null, register: d.persona?.register ?? null, works: (d.works ?? []).map((w) => w.claim), doesNot: (d.doesNot ?? []).map((w) => w.claim), keywords: d.keywords ?? [], mode: d.mode ?? c.mode } : null,
      notes: (c.notes ?? []).filter((n) => !n.tombstonedAt).map((n) => ({ id: n.id, text: n.text, kind: n.kind, at: n.at })),
      rules: directives.map((r) => ({ id: r._id, text: r.verbatim, at: r.createdAt })),
      taste: { note: c.taste?.text ?? null, updatedAt: c.taste?.updatedAt ?? null, ...summarize((c.affinities ?? []) as Affinity[], Date.now()), events: (await ctx.db.query("tasteEvents").withIndex("by_creator", (q) => q.eq("creatorId", c._id)).take(1)).length > 0 },
    };
  },
});

export const updateSettings = mutation({
  args: { quietHours: v.optional(v.object({ start: v.string(), end: v.string() })), tone: v.optional(v.union(v.literal("coach"), v.literal("friend"), v.literal("blunt"))), timezone: v.optional(v.string()), niche: v.optional(v.string()) },
  handler: async (ctx, a): Promise<{ ok: boolean }> => {
    const c = await me(ctx);
    if (!c) return { ok: false };
    const patch: Partial<Doc<"creators">> = { updatedAt: Date.now() };
    if (a.quietHours) patch.quietHours = a.quietHours;
    if (a.tone) patch.tone = a.tone;
    if (a.timezone) patch.timezone = a.timezone;
    if (a.niche !== undefined) patch.niche = a.niche.slice(0, 300);
    await ctx.db.patch(c._id, patch);
    return { ok: true };
  },
});

/** A correction to what she knows becomes a directive, verbatim (§14.1 correct-me control). */
export const correct = mutation({
  args: { text: v.string() },
  handler: async (ctx, a): Promise<{ ok: boolean }> => {
    const c = await me(ctx);
    if (!c || !a.text.trim()) return { ok: false };
    await ctx.db.insert("directives", { creatorId: c._id, kind: "correction", verbatim: a.text.trim().slice(0, 500), active: true, source: "settings", createdAt: Date.now() });
    if (c.dossier) await ctx.scheduler.runAfter(5 * 60_000, internal.onboarding.ingest.synthesize, { creatorId: c._id, reason: "correction" }); // batched: several corrections, one rewrite
    return { ok: true };
  },
});

export const revokeRule = mutation({
  args: { id: v.id("directives") },
  handler: async (ctx, a): Promise<{ ok: boolean }> => {
    const c = await me(ctx);
    const row = (await ctx.db.get(a.id)) as Doc<"directives"> | null;
    if (!c || !row || row.creatorId !== c._id) return { ok: false };
    await ctx.db.patch(a.id, { active: false, supersededAt: Date.now() }); // history kept
    return { ok: true };
  },
});

export const passIdea = mutation({
  args: { id: v.id("ideas") },
  handler: async (ctx, a): Promise<{ ok: boolean }> => {
    const c = await me(ctx);
    const row = (await ctx.db.get(a.id)) as Doc<"ideas"> | null;
    if (!c || !row || row.creatorId !== c._id) return { ok: false };
    await ctx.db.patch(a.id, { status: "passed" });
    return { ok: true };
  },
});

/** Results: last week as she saw it (§7 S4). The rung and its reasons, the posts, the track record, the experiments. */
export const results = query({
  args: {},
  handler: async (ctx) => {
    const c = await me(ctx);
    if (!c) return null;
    const now = Date.now();
    const since = now - 7 * 86_400_000;
    const all = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", c._id)).order("desc").take(80)) as Doc<"ownPosts">[];
    const week = all.filter((p) => p.createTime >= since);
    const history = all.filter((p) => p.createTime < since).slice(0, 40);
    const planned = (c.dossier as { cadence?: { postsPerWeek?: number } } | undefined)?.cadence?.postsPerWeek ?? null;
    const rung = computeRung({
      week: week.map((p) => ({ views: p.metrics.views, multiple: p.multiple ?? null, likes: p.metrics.likes, comments: p.metrics.comments, shares: p.metrics.shares, saves: p.metrics.saves ?? 0, ageHours: (now - p.createTime) / 3_600_000 })),
      planned: planned && planned > 0 ? planned : null,
      history: history.map((p) => ({ views: p.metrics.views, comments: p.metrics.comments, shares: p.metrics.shares, saves: p.metrics.saves ?? 0 })),
    });
    const reads = (await ctx.db.query("ownPostReads").withIndex("by_creator", (q) => q.eq("creatorId", c._id)).order("desc").take(80)) as Doc<"ownPostReads">[];
    const override = reads.find((r) => r.modelOverride)?.modelOverride ?? null;
    const preds = (await ctx.db.query("predictions").withIndex("by_creator", (q) => q.eq("creatorId", c._id)).collect()) as Doc<"predictions">[];
    const by = new Map<string, { expected: number; actuals: number[] }>();
    for (const p of preds) {
      if (p.outcomeMultiple === undefined) continue;
      const cur = by.get(p.confidence) ?? { expected: p.expectedMultiple, actuals: [] };
      cur.actuals.push(p.outcomeMultiple);
      by.set(p.confidence, cur);
    }
    const review = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", c._id)).order("desc").take(60)) as Doc<"messages">[];
    const lastReview = review.find((m) => m.direction === "out" && m.kind === "review") ?? null;
    return {
      rung,
      override,
      week: week.map((p) => ({ id: p._id, url: p.url, platform: p.platform, createTime: p.createTime, views: p.metrics.views, multiple: p.multiple ?? null, engagementPerView: engagement({ views: p.metrics.views, comments: p.metrics.comments, shares: p.metrics.shares, saves: p.metrics.saves ?? 0 }), source: p.source, metricsAsOf: p.metricsAsOf, sampled: now - p.createTime >= 48 * 3_600_000 })),
      trackRecord: Array.from(by.entries()).map(([confidence, x]) => { const s = [...x.actuals].sort((m, n) => m - n); return { confidence, expected: x.expected, medianActual: s[Math.floor(s.length / 2)], n: s.length }; }),
      openPredictions: preds.filter((p) => p.scoredAt === undefined).length,
      experiments: [...(c.experiments ?? [])].sort((x, y) => y.proposedAt - x.proposedAt).slice(0, 6).map((e) => ({ id: e.id, text: e.text, proposedAt: e.proposedAt, result: e.result ?? null })),
      lastReview: lastReview ? { body: lastReview.body, ts: lastReview.ts, links: lastReview.links ?? [] } : null,
    };
  },
});

/** Plan: the calendar week (§7 S4). Blocks she proposed or they confirmed, and the events she intends to use. */
export const plan = query({
  args: {},
  handler: async (ctx) => {
    const c = await me(ctx);
    if (!c) return null;
    const now = Date.now();
    const horizon = now + 14 * 86_400_000;
    const blocks = (await ctx.db.query("calendarBlocks").withIndex("by_creator", (q) => q.eq("creatorId", c._id).gte("start", now - 86_400_000).lte("start", horizon)).collect()) as Doc<"calendarBlocks">[];
    const events = (await ctx.db.query("calendarEvents").withIndex("by_creator_start", (q) => q.eq("creatorId", c._id).gte("start", now).lte("start", horizon)).collect()) as Doc<"calendarEvents">[];
    const conn = (await ctx.db.query("connections").withIndex("by_creator", (q) => q.eq("creatorId", c._id).eq("provider", "google_calendar")).first()) as Doc<"connections"> | null;
    const bestHours = (c.dossier as { cadence?: { bestHoursLocal?: number[] } } | undefined)?.cadence?.bestHoursLocal ?? [];
    return {
      connected: conn?.status === "connected",
      timezone: c.timezone,
      blocks: blocks.filter((b) => b.status !== "deleted").map((b) => ({ id: b._id, kind: b.kind, title: b.title, start: b.start, end: b.end, status: b.status, onCalendar: Boolean(b.externalEventId), ideaId: b.ideaId ?? null })),
      events: events.filter((e) => e.status === "active" && e.class !== "private").map((e) => ({ id: e.externalId, title: e.title, start: e.start, end: e.end, allDay: e.allDay, class: e.class, link: e.htmlLink ?? null })),
      bestHours,
    };
  },
});

/** A block control from the web has the same effect as the words in chat (§1). Writes go through the same actions. */
export const blockControl = mutation({
  args: { id: v.id("calendarBlocks"), op: v.union(v.literal("confirm"), v.literal("delete"), v.literal("move")), start: v.optional(v.number()), end: v.optional(v.number()) },
  handler: async (ctx, a): Promise<{ ok: boolean }> => {
    const c = await me(ctx);
    const b = (await ctx.db.get(a.id)) as Doc<"calendarBlocks"> | null;
    if (!c || !b || b.creatorId !== c._id) return { ok: false };
    if (a.op === "confirm") await ctx.scheduler.runAfter(0, internal.calendar.blocks.confirm, { blockId: a.id });
    else if (a.op === "delete") await ctx.scheduler.runAfter(0, internal.calendar.blocks.remove, { blockId: a.id });
    else if (a.start && a.end && a.end > a.start) await ctx.scheduler.runAfter(0, internal.calendar.blocks.move, { blockId: a.id, start: a.start, end: a.end });
    else return { ok: false };
    return { ok: true };
  },
});
