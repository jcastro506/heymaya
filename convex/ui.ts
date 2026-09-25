/**
 * The thin UI's reads and its two write paths (plan §7 S4). Every tab is a reactive
 * query over the rows Maya writes; the web writes only settings and directives, and
 * every control here has a chat equivalent (§1). Clerk identity scopes everything.
 */

import { v } from "convex/values";
import { setupAdvice } from "./account/setup";
import { applyIdeaAct } from "./core/ideaActs";
import { isUnseen } from "./core/unseen";
import { TIERS, TIER_NAMES, entitlementsFor, price } from "./billing/tiers";
import { partnershipsOpen } from "./partnerships/store";
import { brandsPaying } from "./partnerships/signals";
import { markApplied as markAppliedFor } from "./partnerships/delivery";
import { connectedFrom, DIAGNOSIS_WORDS, numbersFor } from "./connections/numbers";
import { appCards } from "./connections/audience";
import { avatarKey, coverForUrl, coverKey, mediaUrl } from "./media";
import { recordAction } from "./core/act";
import { internalQuery, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { mutation } from "./lib/functions";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { summarize, type Affinity } from "./taste/affinities";
import { computeRung, engagement } from "./review/rung";
import { laneBenchmarkFor } from "./scout/benchmarks";
import { clip } from "./lib/clip";

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
      ? "Not connected to Messages yet. Text her START to finish."
      : !c.dossier
        ? `Reading your posts now (${posts.length} so far).`
        : `Watching ${active.length} account${active.length === 1 ? "" : "s"}.${lastSample ? ` Last look ${Math.round((now - lastSample) / 3_600_000)}h ago.` : ""}${running.length ? ` Working on ${running.length} thing${running.length === 1 ? "" : "s"}.` : ""}`;
    return {
      statusLine,
      paired: c.channel.paired,
      dossier: Boolean(c.dossier),
      sentToday,
      nextBlock: block ? { kind: block.kind, start: block.start, end: block.end, title: block.title, status: block.status } : null,
      week: await Promise.all(posts.map(async (p) => ({ id: p._id, url: p.url, platform: p.platform, createTime: p.createTime, views: p.metrics.views, multiple: p.multiple ?? null, metricsAsOf: p.metricsAsOf, cover: await mediaUrl(ctx, p.platform, "cover", coverKey(p.platform, p.url, p.postId)) }))),
    };
  },
});

/** Ideas: the inventory and the scoreboard. */
export const ideas = query({
  args: { unpostedOnly: v.optional(v.boolean()), savedOnly: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const c = await me(ctx);
    if (!c) return null;
    const rows = (await ctx.db.query("ideas").withIndex("by_creator", (q) => q.eq("creatorId", c._id)).order("desc").take(100)) as Doc<"ideas">[];
    const mapped = rows
      .filter((i) => !a.unpostedOnly || i.status !== "posted")
      .filter((i) => !a.savedOnly || i.savedAt)
      .map((i) => ({ id: i._id, status: i.status, saved: Boolean(i.savedAt), unseen: isUnseen(i, Date.now()), reaction: i.reaction ?? null, newForYou: Boolean(i.newForYou), features: i.features ?? null, fitWhy: i.fitWhy, evidenceLinks: i.evidenceLinks, version: i.version as { hook?: string; onScreenText?: string; lengthSec?: number; sound?: string } | null, messageText: i.messageText, sentAt: i.sentAt ?? null, postedAt: i.postedAt ?? null, matchedPostId: i.matchedPostId ?? null }));
    return await Promise.all(mapped.map(async (m) => ({ ...m, evidenceCovers: await Promise.all(m.evidenceLinks.map((l) => coverForUrl(ctx, l))) })));
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
      accounts: await Promise.all(tracked.filter((t) => t.status !== "removed").map(async (t) => ({
        id: t._id,
        platform: t.platform,
        handle: t.handle,
        status: t.status,
        baseline: t.medianPace24h ?? null,
        baselineN: t.baselineN,
        lastSampledAt: t.lastSampledAt ?? null,
        avatar: await mediaUrl(ctx, t.platform, "avatar", avatarKey(t.handle)),
        lastBreakout: lastByAccount.get(t._id) ? { score: lastByAccount.get(t._id)!.score, verdict: lastByAccount.get(t._id)!.verdict, why: lastByAccount.get(t._id)!.why, at: lastByAccount.get(t._id)!.createdAt } : null,
      }))),
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
      avatars: { tiktok: c.handles.tiktok ? await mediaUrl(ctx, "tiktok", "avatar", avatarKey(c.handles.tiktok)) : null, instagram: c.handles.instagram ? await mediaUrl(ctx, "instagram", "avatar", avatarKey(c.handles.instagram)) : null },
      niche: c.niche,
      timezone: c.timezone,
      quietHours: c.quietHours,
      tone: c.tone,
      paired: c.channel.paired,
      plan: c.plan.status,
      founding: c.plan.founding,
      tier: entitlementsFor(c.plan).tier,
      accountCap: entitlementsFor(c.plan).accounts,
      trialEndsAt: c.plan.trialEndsAt ?? null,
      currentPeriodEnd: c.plan.currentPeriodEnd ?? null,
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
    const changed = [a.quietHours && `quiet hours ${a.quietHours.start}–${a.quietHours.end}`, a.tone && `tone ${a.tone}`, a.timezone && `time zone ${a.timezone}`, a.niche !== undefined && "what they make"].filter(Boolean).join(", ");
    if (changed) await recordAction(ctx, { creatorId: c._id, kind: "settings.update", summary: `changed ${changed}` });
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
    await recordAction(ctx, { creatorId: c._id, kind: "correction.add", summary: `corrected you: "${a.text.trim().slice(0, 140)}"` });
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
    await recordAction(ctx, { creatorId: c._id, kind: "rule.revoke", objectId: a.id, summary: `removed their rule "${clip(row.verbatim, 120)}"` });
    return { ok: true };
  },
});

/**
 * "Not for me" from the app. Same effect as saying it in chat: the idea is passed AND her
 * taste learns from it (the old web path only flipped the status; audit gap 1).
 */
export const passIdea = mutation({
  args: { id: v.id("ideas") },
  handler: async (ctx, a): Promise<{ ok: boolean }> => {
    const c = await me(ctx);
    if (!c) return { ok: false };
    return { ok: (await applyIdeaAct(ctx, c._id, a.id, "pass", { origin: "app" })).ok };
  },
});

/**
 * N1: ideas that were on their screen. Batched and idempotent (the app sends ids as cards appear);
 * owner-checked; a seen idea is never offered in Messages as new.
 */
export const markIdeasSeen = mutation({
  args: { ids: v.array(v.id("ideas")) },
  handler: async (ctx, a): Promise<{ ok: boolean; marked: number }> => {
    const c = await me(ctx);
    if (!c) return { ok: false, marked: 0 };
    const now = Date.now();
    let marked = 0;
    for (const id of a.ids.slice(0, 50)) {
      const i = (await ctx.db.get(id)) as Doc<"ideas"> | null;
      if (!i || i.creatorId !== c._id || i.seenAt) continue;
      await ctx.db.patch(id, { seenAt: now });
      marked++;
    }
    return { ok: true, marked };
  },
});

/** Bring a passed idea back (I1; chat has the same act through `idea_status`). */
export const restoreIdea = mutation({
  args: { id: v.id("ideas") },
  handler: async (ctx, a): Promise<{ ok: boolean }> => {
    const c = await me(ctx);
    if (!c) return { ok: false };
    return { ok: (await applyIdeaAct(ctx, c._id, a.id, "restore", { origin: "app" })).ok };
  },
});

/** Save (or unsave) from the app: into the swipe file and her searchable memory, like "save" in chat. */
export const saveIdea = mutation({
  args: { id: v.id("ideas"), saved: v.boolean() },
  handler: async (ctx, a): Promise<{ ok: boolean }> => {
    const c = await me(ctx);
    if (!c) return { ok: false };
    return { ok: (await applyIdeaAct(ctx, c._id, a.id, a.saved ? "save" : "unsave", { origin: "app" })).ok };
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
    const lane = await laneBenchmarkFor(ctx, c._id, now);
    return {
      rung,
      lane: { usable: lane.usable, medianViews: lane.medianViews, p75Views: lane.p75Views, why: lane.why, computedAt: lane.computedAt },
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
      blocks: blocks.filter((b) => b.status !== "deleted").map((b) => ({ id: b._id, rev: b.rev ?? 0, kind: b.kind, title: b.title, start: b.start, end: b.end, status: b.status, onCalendar: Boolean(b.externalEventId), ideaId: b.ideaId ?? null })),
      events: events.filter((e) => e.status === "active" && e.class !== "private").map((e) => ({ id: e.externalId, title: e.title, start: e.start, end: e.end, allDay: e.allDay, class: e.class, link: e.htmlLink ?? null })),
      bestHours,
    };
  },
});

/**
 * P1: their plan and every plan, for the app. Prices and allowances come from billing/tiers.ts
 * only (the app has no price literals; a test checks). Doors read `entitlementsFor`, the same
 * function this reports from, so what the app shows is what the server enforces.
 */
export const plans = query({
  args: {},
  handler: async (ctx) => {
    const c = await me(ctx);
    if (!c) return null;
    const mine = entitlementsFor(c.plan);
    return {
      current: { tier: mine.tier, status: c.plan.status, trialEndsAt: c.plan.trialEndsAt ?? null, renewsAt: c.plan.currentPeriodEnd ?? null, subscribed: Boolean(c.plan.stripeSubscriptionId), partnershipsOpen: partnershipsOpen(c) }, // the same door Deals and her tools read
      tiers: TIER_NAMES.map((t) => ({ tier: t, label: TIERS[t].label, blurb: TIERS[t].blurb, monthly: price(TIERS[t].priceUsd), annual: price(TIERS[t].annualUsd), accounts: TIERS[t].accounts, partnerships: TIERS[t].partnerships.researchPerMonth > 0 })),
    };
  },
});

/** B6: one application, question by question, for the app's copy-each-answer screen. */
export const application = query({
  args: { id: v.string() },
  handler: async (ctx, a) => {
    const c = await me(ctx);
    if (!c) return null;
    const id = ctx.db.normalizeId("partnershipOpportunities", a.id);
    const row = id ? ((await ctx.db.get(id)) as Doc<"partnershipOpportunities"> | null) : null;
    if (!row || row.creatorId !== c._id) return null;
    const o = row.data as { brand?: string; route?: string; routeUrl?: string; officialApplicationUrl?: string; applicationFields?: Array<{ label: string; required: boolean; type: string }>; appliedAt?: number; status?: string };
    if (o.route !== "application") return null;
    const drafts = (await ctx.db.query("partnershipDrafts").withIndex("by_opportunity", (q) => q.eq("opportunityId", row._id)).collect()) as Doc<"partnershipDrafts">[];
    const latest = drafts.map((d) => d.data as { answers?: Array<{ label: string; answer: string }>; createdAt: number; status: string }).filter((d) => d.status !== "canceled").sort((x, y) => y.createdAt - x.createdAt)[0];
    const answers = new Map((latest?.answers ?? []).map((x) => [x.label, x.answer]));
    return {
      id: row._id,
      brand: o.brand ?? row.brandDomain,
      formUrl: o.officialApplicationUrl ?? o.routeUrl ?? null,
      applied: Boolean(o.appliedAt),
      status: o.status ?? "discovered",
      questions: (o.applicationFields ?? []).map((f) => ({ label: f.label, required: f.required, type: f.type, answer: answers.get(f.label) ?? null })),
    };
  },
});

/** "I submitted it" from the app; the same record she writes when they tell her in Messages. */
export const markApplied = mutation({
  args: { id: v.id("partnershipOpportunities") },
  handler: async (ctx, a): Promise<{ ok: boolean }> => {
    const c = await me(ctx);
    const row = (await ctx.db.get(a.id)) as Doc<"partnershipOpportunities"> | null;
    if (!c || !row || row.creatorId !== c._id) return { ok: false };
    await markAppliedFor(ctx, c._id, a.id);
    await recordAction(ctx, { creatorId: c._id, kind: "application.submitted", objectId: a.id, summary: `submitted their application to ${(row.data as { brand?: string }).brand ?? row.brandDomain}` });
    return { ok: true };
  },
});

/** A block control from the web has the same effect as the words in chat (§1). Writes go through the same actions. */
export const blockControl = mutation({
  args: { expectedRev: v.optional(v.number()), id: v.id("calendarBlocks"), op: v.union(v.literal("confirm"), v.literal("delete"), v.literal("move")), start: v.optional(v.number()), end: v.optional(v.number()) },
  handler: async (ctx, a): Promise<{ ok: boolean; changed?: boolean }> => {
    const c = await me(ctx);
    const b = (await ctx.db.get(a.id)) as Doc<"calendarBlocks"> | null;
    if (!c || !b || b.creatorId !== c._id) return { ok: false };
    // The app shows a block at a revision; if Maya (or another device) changed it since, say so instead of clobbering.
    if (a.expectedRev !== undefined && (b.rev ?? 0) !== a.expectedRev) return { ok: false, changed: true };
    const when = a.start ? new Date(a.start).toISOString().slice(0, 16).replace("T", " ") : "";
    await recordAction(ctx, { creatorId: c._id, kind: `block.${a.op === "delete" ? "drop" : a.op}`, objectId: a.id, summary: a.op === "confirm" ? `booked the "${b.title}" block` : a.op === "delete" ? `dropped the "${b.title}" block` : `moved the "${b.title}" block to ${when} UTC` });
    if (a.op === "confirm") await ctx.scheduler.runAfter(0, internal.calendar.blocks.confirm, { blockId: a.id });
    else if (a.op === "delete") await ctx.scheduler.runAfter(0, internal.calendar.blocks.remove, { blockId: a.id, expectedRev: a.expectedRev });
    else if (a.start && a.end && a.end > a.start) await ctx.scheduler.runAfter(0, internal.calendar.blocks.move, { blockId: a.id, start: a.start, end: a.end, expectedRev: a.expectedRev });
    else return { ok: false };
    return { ok: true };
  },
});

/**
 * Opportunities (app spec §6.6): the pipeline when their plan carries partnerships, and a
 * grounded teaser when it doesn't. The teaser counts real paid-partnership posts from the
 * accounts she watches for them in the last 30 days (the sampler's `paidPromotion` flag);
 * with none, the count is 0 and the app shows no number. Never invented, never another
 * creator's rows.
 */
export const opportunities = query({
  args: {},
  handler: async (ctx) => {
    const c = await me(ctx);
    if (!c) return null;
    const unlocked = partnershipsOpen(c);
    const since = Date.now() - 30 * 86_400_000;
    const tracked = ((await ctx.db.query("trackedAccounts").withIndex("by_creator", (q) => q.eq("creatorId", c._id)).collect()) as Doc<"trackedAccounts">[]).filter((t) => t.status === "active");
    const paidPosts = new Set<string>();
    const paidAccounts = new Set<string>();
    const paid: Array<{ platform: string; postId: string; authorHandle: string; mentions: string[]; sampledAt: number }> = [];
    for (const t of tracked) {
      const rows = (await ctx.db.query("observations").withIndex("by_author", (q) => q.eq("platform", t.platform).eq("authorHandle", t.handle).gte("sampledAt", since)).take(200)) as Doc<"observations">[];
      for (const r of rows) {
        if (!r.paidPromotion) continue;
        paidPosts.add(`${r.platform}:${r.postId}`);
        paidAccounts.add(`${r.platform}:${r.authorHandle}`);
        paid.push({ platform: r.platform, postId: r.postId, authorHandle: r.authorHandle, mentions: r.mentions ?? [], sampledAt: r.sampledAt });
      }
    }
    const rows = unlocked ? ((await ctx.db.query("partnershipOpportunities").withIndex("by_creator", (q) => q.eq("creatorId", c._id)).order("desc").take(100)) as Doc<"partnershipOpportunities">[]) : [];
    return {
      unlocked,
      tier: entitlementsFor(c.plan).tier,
      unlockTier: "partner" as const,
      unlockPriceUsd: TIERS.partner.priceUsd,
      teaser: { paidPostsInLane: paidPosts.size, accountsPaid: paidAccounts.size, days: 30 },
      // B6 signal 1: real brands seen paying creators she watches for them (named, never invented).
      brandsInLane: brandsPaying(paid).slice(0, 5),
      opportunities: rows.map((r) => {
        const o = r.data as { brand?: string; campaign?: string; type?: string; fit?: string; status?: string; route?: string; compensation?: string; deadline?: number; assessment?: { verdict?: string } };
        return {
          id: r._id,
          brand: String(o.brand ?? r.brandDomain),
          campaign: String(o.campaign ?? ""),
          type: String(o.type ?? "unknown"),
          fit: String(o.fit ?? ""),
          status: String(o.status ?? "discovered"),
          verdict: String(o.assessment?.verdict ?? "investigate"),
          route: String(o.route ?? "unknown"),
          compensation: String(o.compensation ?? ""),
          deadline: typeof o.deadline === "number" ? o.deadline : null,
          updatedAt: r.updatedAt,
        };
      }),
    };
  },
});

// ------------------------------------------------------------------ analytics (app)

type Fields = Record<string, number | null>;

/** The numbers a post actually has, per basis, and nothing it doesn't. Pure. */
function postNumbersView(p: Doc<"ownPosts">, siblings: Doc<"ownPosts">[], now: number, cover: string | null = null) {
  const n = numbersFor(p, siblings, now);
  const c = connectedFrom(p);
  const publicCounts: Fields = { views: p.metrics.views, likes: p.metrics.likes, comments: p.metrics.comments, shares: p.metrics.shares, saves: p.metrics.saves ?? null };
  const connected: Fields | null = c
    ? { views: c.views, likes: c.likes, comments: c.comments, shares: c.shares, saves: c.saves, reach: c.reach, impressions: c.impressions, follows: c.follows, avgWatchMs: c.avgWatchMs, skipRatePct: c.skipRatePct, durationSec: c.durationSec, completionRate: c.completionRate, profileViews: c.profileViews }
    : null;
  // A1: TikTok's own splits, as labelled shares for the app (biggest first); null when TikTok reported none.
  const shareList = (m: Record<string, number> | null, words: Record<string, string>) => (m ? Object.entries(m).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: words[k] ?? k, share: v })) : null);
  return {
    id: p._id,
    url: p.url,
    platform: p.platform,
    createTime: p.createTime,
    contentType: p.contentType,
    cover,
    caption: clip(p.caption, 300),
    publicCounts,
    publicAsOf: p.metricsAsOf,
    connected,
    connectedAsOf: c?.asOf ?? null,
    headline: n.headline,
    multiple: n.multiple,
    derived: n.derived ? { distribution: n.derived.distribution, reachMultiple: n.derived.reachMultiple, engagementPerReach: n.derived.engagementPerReach, retention: n.derived.retention, diagnosis: n.derived.diagnosis, basis: n.derived.basis } : null,
    read: n.derived && n.derived.diagnosis !== "unknown" ? DIAGNOSIS_WORDS[n.derived.diagnosis] : null,
    shape: n.shape,
    cannotKnow: n.cannotKnow,
    viewSources: shareList(c?.viewSources ?? null, { forYou: "For You", follow: "Following", search: "Search", personalProfile: "Your profile", sound: "Sound page", directMessage: "Messages", other: "Other" }),
    viewerTypes: shareList(c?.viewerTypes ?? null, { follower: "Followers", nonFollower: "Not following yet", newViewer: "New viewers", returnViewer: "Returning viewers" }),
  };
}

/**
 * Analytics overview for the app: each platform's account (connected or public-only,
 * followers now and ~30 days ago from Zernio's daily snapshots) and the recent posts with
 * their honest headline number. Only what Zernio / the public counts actually give; every
 * number keeps its basis. Scoped to the signed-in creator.
 */
export const analytics = query({
  args: {},
  handler: async (ctx) => {
    const c = await me(ctx);
    if (!c) return null;
    const now = Date.now();
    const posts = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", c._id)).order("desc").take(40)) as Doc<"ownPosts">[];
    const conn = (await ctx.db.query("connections").withIndex("by_creator", (q) => q.eq("creatorId", c._id).eq("provider", "zernio")).first()) as Doc<"connections"> | null;
    const snaps = (await ctx.db.query("followerSnapshots").withIndex("by_creator_day", (q) => q.eq("creatorId", c._id)).order("desc").take(400)) as Doc<"followerSnapshots">[];
    const insightRows = (await ctx.db.query("accountInsights").withIndex("by_creator_kind", (q) => q.eq("creatorId", c._id)).take(40)) as Doc<"accountInsights">[];
    const platforms = (["tiktok", "instagram"] as const).filter((pl) => c.handles[pl] || posts.some((p) => p.platform === pl));
    const monthAgo = now - 30 * 86_400_000;
    return {
      accounts: platforms.map((pl) => {
        const acct = (conn?.zernioAccounts ?? []).find((a) => a.platform === pl);
        const mine = snaps.filter((s) => s.platform === pl).sort((x, y) => y.at - x.at);
        const latest = mine[0] ?? null;
        const past = mine.find((s) => s.at <= monthAgo) ?? null;
        const connected = Boolean(acct && !acct.needsReconnect && acct.canFetchAnalytics);
        // A1: follower growth, "From your profile" and "Who follows you", from this account's rows only.
        const own = <T extends { accountId: string; platform: string }>(xs: T[]) => xs.filter((x) => x.platform === pl && (!acct || x.accountId === acct.accountId));
        const cards = appCards(pl, connected, { insights: own(insightRows.filter((r) => r.kind === "insights"))[0] ?? null, audience: own(insightRows.filter((r) => r.kind === "audience"))[0] ?? null, snaps: own(mine) }, now);
        return {
          platform: pl,
          handle: c.handles[pl] ?? acct?.username ?? null,
          connected,
          needsReconnect: Boolean(acct?.needsReconnect),
          followers: latest?.followers ?? null,
          followersAsOf: latest?.at ?? null,
          followers30dAgo: past?.followers ?? null,
          posts: posts.filter((p) => p.platform === pl).length,
          accountType: c.accountTypes?.[pl] ?? null,
          setup: setupAdvice(pl, c.accountTypes?.[pl] ?? null),
          growth: cards.growth,
          profile: cards.profile,
          audience: cards.audience,
        };
      }),
      posts: await Promise.all(posts.slice(0, 30).map(async (p) => {
        const v = postNumbersView(p, posts, now, await mediaUrl(ctx, p.platform, "cover", coverKey(p.platform, p.url, p.postId)));
        return { id: v.id, url: v.url, platform: v.platform, createTime: v.createTime, contentType: v.contentType, cover: v.cover, headline: v.headline, multiple: v.multiple, diagnosis: v.derived?.diagnosis ?? null };
      })),
    };
  },
});

/** One post's full numbers for the app, with its basis, its age, her read, and what the platform hides. */
export const post = query({
  args: { id: v.id("ownPosts") },
  handler: async (ctx, a) => {
    const c = await me(ctx);
    if (!c) return null;
    const p = (await ctx.db.get(a.id)) as Doc<"ownPosts"> | null;
    if (!p || p.creatorId !== c._id) return null; // another creator's post is not found, not forbidden
    const siblings = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", c._id)).order("desc").take(40)) as Doc<"ownPosts">[];
    return postNumbersView(p, siblings, Date.now(), await mediaUrl(ctx, p.platform, "cover", coverKey(p.platform, p.url, p.postId)));
  },
});

/** Is this idea or post theirs? For the app-link tool: no link to a foreign or made-up object. */
export const ownsObject = internalQuery({
  args: { creatorId: v.id("creators"), kind: v.union(v.literal("idea"), v.literal("post")), id: v.string() },
  handler: async (ctx, a): Promise<boolean> => {
    const table = a.kind === "idea" ? "ideas" : "ownPosts";
    const id = ctx.db.normalizeId(table, a.id);
    if (!id) return false;
    const row = (await ctx.db.get(id)) as { creatorId?: Id<"creators"> } | null;
    return row?.creatorId === a.creatorId;
  },
});

/** One idea for the app's deep link (/o/idea/<id>): theirs, or null ("this changed / not found"). */
export const idea = query({
  args: { id: v.string() },
  handler: async (ctx, a) => {
    const c = await me(ctx);
    if (!c) return null;
    const id = ctx.db.normalizeId("ideas", a.id);
    const i = id ? ((await ctx.db.get(id)) as Doc<"ideas"> | null) : null;
    if (!i || i.creatorId !== c._id) return null;
    return {
      id: i._id, status: i.status, saved: Boolean(i.savedAt), reaction: i.reaction ?? null, newForYou: Boolean(i.newForYou), features: i.features ?? null, fitWhy: i.fitWhy,
      evidenceLinks: i.evidenceLinks, version: i.version as { hook?: string; onScreenText?: string; lengthSec?: number; sound?: string } | null, messageText: i.messageText,
      sentAt: i.sentAt ?? null, postedAt: i.postedAt ?? null, matchedPostId: i.matchedPostId ?? null,
      evidenceCovers: await Promise.all(i.evidenceLinks.map((l) => coverForUrl(ctx, l))),
    };
  },
});
