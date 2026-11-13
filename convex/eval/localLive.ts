/**
 * What's on near them, live (2026-11-13): seeds scenario personas (a note or a world line that says where they live,
 * a niche, lane keywords), runs the real weekly look (real web search, real models), then the stock top-up that
 * reads it. Personas are "eval:local:<ts>"; nothing is delivered (eval personas are suppressed in messages.send).
 * Costs about $0.02 a persona (two searches, two short model calls) plus one stock call.
 *
 *   npx convex run eval/localLive:run '{"personas":[{"niche":"home cooking","note":"lives in Denver now","keywords":["pasta recipes"]}]}'
 *   npx convex run eval/localLive:clear '{}'
 */
import { v } from "convex/values";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";

const PREFIX = "eval:local:";
const persona = v.object({ niche: v.string(), note: v.optional(v.string()), world: v.optional(v.string()), keywords: v.array(v.string()) });

export const seed = internalMutation({
  args: { p: persona, k: v.number() },
  handler: async (ctx, a): Promise<Id<"creators">> => {
    const now = Date.now();
    const tag = `${now}${a.k}`;
    const id = await ctx.db.insert("creators", {
      clerkUserId: `${PREFIX}${tag}`, email: `local-${tag}@example.com`, handles: { tiktok: `localeval${tag}` }, ownership: "unverified",
      niche: a.p.niche, timezone: "America/Denver", quietHours: { start: "22:00", end: "07:00" }, tone: "friend", mode: "full",
      dossierVersion: 1, dossier: { persona: { summary: a.p.niche, ...(a.p.world ? { world: a.p.world } : {}) } },
      notes: a.p.note ? [{ id: `n_${tag}`, text: a.p.note, kind: "fact", at: now }] : [], affinities: [], experiments: [],
      channel: { paired: true, pairedAt: now, kind: "imessage" }, plan: { status: "trialing", founding: true }, createdAt: now,
    } as never);
    const row = await ctx.db.query("schedule").withIndex("by_creator", (q) => q.eq("creatorId", id)).first();
    if (row) await ctx.db.patch(row._id, { keywords: a.p.keywords });
    return id;
  },
});

export const read = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<Record<string, unknown>> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    const events = (await ctx.db.query("localEvents").withIndex("by_creator_date", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"localEvents">[];
    const ideas = (await ctx.db.query("ideas").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"ideas">[];
    return {
      scout: c?.localScout,
      events: events.map((e) => ({ title: e.title, date: e.date, url: e.url, quote: e.quote, why: e.why })),
      ideas: ideas.map((i) => ({ hook: (i.version as { hook?: string }).hook, link: i.evidenceLinks[0], about: (i.version as { about?: string }).about })),
    };
  },
});

export const run = internalAction({
  args: { personas: v.array(persona), stock: v.optional(v.boolean()) },
  handler: async (ctx, a): Promise<Array<Record<string, unknown>>> => {
    const out: Array<Record<string, unknown>> = [];
    for (const [k, p] of a.personas.entries()) {
      const creatorId = await ctx.runMutation(internal.eval.localLive.seed, { p, k });
      const local = await ctx.runAction(internal.scout.local.run, { creatorId, force: true });
      const stock = a.stock === false ? null : await ctx.runAction(internal.scout.stock.topUp, { creatorId });
      out.push({ persona: p.niche, local, stock, ...(await ctx.runQuery(internal.eval.localLive.read, { creatorId })) });
    }
    return out;
  },
});

export const clear = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ deleted: number }> => {
    let deleted = 0;
    for (const c of (await ctx.db.query("creators").collect()) as Doc<"creators">[]) {
      if (!c.clerkUserId.startsWith(PREFIX)) continue;
      const rows = [
        ...(await ctx.db.query("localEvents").withIndex("by_creator_date", (q) => q.eq("creatorId", c._id)).collect()),
        ...(await ctx.db.query("ideas").withIndex("by_creator", (q) => q.eq("creatorId", c._id)).collect()),
        ...(await ctx.db.query("costEvents").withIndex("by_creator_at", (q) => q.eq("creatorId", c._id)).collect()),
        ...(await ctx.db.query("schedule").withIndex("by_creator", (q) => q.eq("creatorId", c._id)).collect()),
      ];
      for (const r of rows) { await ctx.db.delete(r._id); deleted++; }
      await ctx.db.delete(c._id);
      deleted++;
    }
    return { deleted };
  },
});
