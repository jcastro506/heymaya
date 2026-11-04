/**
 * Does she read a creator like an expert? (2026-11-04) Seeds a scenario persona from a list of posts (caption,
 * date, views, likes, comments, shares, saves), runs the real dossier read, the opening's standout, and, given
 * what they said back, the correction and the month plan she'd send. No vendor reads; model calls only.
 * Personas are "eval:expertread:<ts>"; nothing is delivered (eval personas are suppressed in messages.send).
 *
 *   npx convex run eval/expertReadLive:run '{"niche":"…","posts":[…],"said":"i don't want to be a food creator"}'
 *   npx convex run eval/expertReadLive:clear '{}'
 */
import { v } from "convex/values";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";

const PREFIX = "eval:expertread:";
const post = v.object({ caption: v.string(), at: v.string(), views: v.number(), likes: v.number(), comments: v.number(), shares: v.number(), saves: v.optional(v.number()), url: v.string() });

export const seed = internalMutation({
  args: { niche: v.string(), posts: v.array(post), timezone: v.optional(v.string()) },
  handler: async (ctx, a): Promise<Id<"creators">> => {
    const now = Date.now();
    const id = await ctx.db.insert("creators", {
      clerkUserId: `${PREFIX}${now}`, email: `expertread-${now}@example.com`, handles: { tiktok: `expertread${now}` }, ownership: "unverified",
      niche: a.niche, timezone: a.timezone ?? "America/New_York", quietHours: { start: "22:00", end: "07:00" }, tone: "friend", mode: "full",
      dossierVersion: 0, notes: [], affinities: [], experiments: [], channel: { paired: true, pairedAt: now, kind: "imessage" }, plan: { status: "trialing", founding: true }, createdAt: now,
    } as never);
    for (const [i, p] of a.posts.entries()) {
      const t = Date.parse(p.at);
      await ctx.db.insert("ownPosts", {
        creatorId: id, platform: "tiktok", postId: `er${now}${i}`, url: p.url, createTime: t, contentType: "video", caption: p.caption,
        hashtags: Array.from(p.caption.matchAll(/#([\p{L}\p{N}_]+)/gu)).map((m) => m[1].toLowerCase()),
        metrics: { views: p.views, likes: p.likes, comments: p.comments, shares: p.shares, saves: p.saves }, metricsAsOf: now, source: "zernio",
      } as never);
    }
    return id;
  },
});

export const read = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<Record<string, unknown>> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    const d = (c?.dossier ?? {}) as Record<string, unknown>;
    const msgs = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"messages">[];
    return { keywords: d.keywords, strengths: d.strengths, works: d.works, doesNot: d.doesNot, oneOffs: d.oneOffs, formats: d.formats, growthPlan: c?.growthPlan, out: msgs.filter((m) => m.direction === "out").map((m) => `${m.kind}: ${m.body}`) };
  },
});

export const run = internalAction({
  args: { niche: v.string(), posts: v.array(post), said: v.optional(v.string()) },
  handler: async (ctx, a): Promise<Record<string, unknown>> => {
    const creatorId = await ctx.runMutation(internal.eval.expertReadLive.seed, { niche: a.niche, posts: a.posts });
    await ctx.runMutation(internal.onboarding.ingest.computeMultiples, { creatorId });
    const first = await ctx.runAction(internal.onboarding.ingest.synthesize, { creatorId, reason: "onboarding" });
    const standout = await ctx.runQuery(internal.onboarding.standout.forCreator, { creatorId });
    const before = await ctx.runQuery(internal.eval.expertReadLive.read, { creatorId });
    let after: Record<string, unknown> | null = null;
    if (a.said) {
      await ctx.runMutation(internal.core.messages.recordInbound, { creatorId, surface: "telegram", body: a.said });
      await ctx.runMutation(internal.agent.manage.setNiche, { creatorId, text: a.said });
      await ctx.runAction(internal.onboarding.ingest.synthesize, { creatorId, reason: "correction", said: a.said });
      await ctx.runAction(internal.agent.monthPlan.proposeThenWeek, { creatorId });
      after = await ctx.runQuery(internal.eval.expertReadLive.read, { creatorId });
    }
    return { creatorId, synth: first, standout: standout?.line ?? null, before, after };
  },
});

export const clear = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ creators: number }> => {
    let n = 0;
    // Only this eval's personas, by an index range: never the whole creators table.
    for (const c of (await ctx.db.query("creators").withIndex("by_clerkUserId", (q) => q.gte("clerkUserId", PREFIX).lt("clerkUserId", `${PREFIX}\uffff`)).take(50)) as Doc<"creators">[]) {
      for (const r of await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", c._id)).collect()) await ctx.db.delete(r._id);
      for (const r of await ctx.db.query("ideas").withIndex("by_creator", (q) => q.eq("creatorId", c._id)).collect()) await ctx.db.delete(r._id);
      for (const r of await ctx.db.query("calendarBlocks").withIndex("by_creator", (q) => q.eq("creatorId", c._id)).collect()) await ctx.db.delete(r._id);
      for (const r of await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", c._id)).collect()) await ctx.db.delete(r._id);
      await ctx.db.delete(c._id);
      n++;
    }
    return { creators: n };
  },
});
