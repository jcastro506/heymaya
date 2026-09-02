/**
 * Retrieval on demand (plan §15.7 layer 4). Saved ideas, every idea she sent, and the
 * notes they gave her are embedded once into `memories`; a question that looks back
 * ("what was that idea about the shoe rack") runs a vector search scoped to the
 * creator and the passages ride into the turn as "from memory". The prefix never
 * grows with tenure; this is how the old is reachable.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";

const KIND = v.union(v.literal("idea"), v.literal("note"), v.literal("swipe"));

export const upsert = internalMutation({
  args: { creatorId: v.id("creators"), kind: KIND, refId: v.string(), text: v.string(), embedding: v.array(v.float64()) },
  handler: async (ctx, a): Promise<Id<"memories">> => {
    const existing = (await ctx.db.query("memories").withIndex("by_creator_ref", (q) => q.eq("creatorId", a.creatorId).eq("refId", a.refId)).first()) as Doc<"memories"> | null;
    if (existing) {
      await ctx.db.patch(existing._id, { kind: a.kind, text: a.text, embedding: a.embedding, at: Date.now() });
      return existing._id;
    }
    return await ctx.db.insert("memories", { creatorId: a.creatorId, kind: a.kind, refId: a.refId, text: a.text, embedding: a.embedding, at: Date.now() });
  },
});

export const byIds = internalQuery({
  args: { creatorId: v.id("creators"), ids: v.array(v.id("memories")) },
  handler: async (ctx, a): Promise<Array<{ kind: string; text: string; at: number }>> => {
    const out: Array<{ kind: string; text: string; at: number }> = [];
    for (const id of a.ids) {
      const m = (await ctx.db.get(id)) as Doc<"memories"> | null;
      if (m && m.creatorId === a.creatorId) out.push({ kind: m.kind, text: m.text, at: m.at }); // never another creator's, even by id
    }
    return out;
  },
});

/** Embed one passage and store it. Scheduled from mutations; failures are logged, never thrown into a user turn. */
export const index = internalAction({
  args: { creatorId: v.id("creators"), kind: KIND, refId: v.string(), text: v.string() },
  handler: async (ctx, a): Promise<{ ok: boolean }> => {
    const text = a.text.trim().slice(0, 1500);
    if (!text) return { ok: false };
    const r = await ctx.runAction(internal.core.embeddings.embedTexts, { texts: [text] });
    const vec = r.vectors[0]?.values;
    if (!vec) return { ok: false };
    await ctx.runMutation(internal.agent.memory.upsert, { creatorId: a.creatorId, kind: a.kind, refId: a.refId, text, embedding: vec });
    return { ok: true };
  },
});

/** The search: scoped to the creator by the index filter, then re-checked row by row. */
export const recall = internalAction({
  args: { creatorId: v.id("creators"), query: v.string(), k: v.optional(v.number()) },
  handler: async (ctx, a): Promise<Array<{ kind: string; text: string; at: number; score: number }>> => {
    const r = await ctx.runAction(internal.core.embeddings.embedTexts, { texts: [a.query.slice(0, 500)] });
    const vec = r.vectors[0]?.values;
    if (!vec) return [];
    const hits = await ctx.vectorSearch("memories", "by_embedding", { vector: vec, limit: a.k ?? 4, filter: (q) => q.eq("creatorId", a.creatorId) });
    const rows = await ctx.runQuery(internal.agent.memory.byIds, { creatorId: a.creatorId, ids: hits.map((h) => h._id) });
    return rows.map((row, i) => ({ ...row, score: hits[i]?._score ?? 0 })).filter((x) => x.score >= 0.5);
  },
});
