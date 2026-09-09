/** Source-checked hybrid recall. Text is durable before optional embeddings are attempted. */
import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, type QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { MESSAGE_DAYS } from "../core/retention";
import { recordVisible } from "./personalHistory";

export const personal = internalQuery({
  args: { creatorId: v.id("creators"), query: v.string() },
  handler: async (ctx, a): Promise<Array<{ text: string; at: number; kind: string; sourceIds: string[] }>> => {
    const creator = await ctx.db.get(a.creatorId);
    if (!creator || creator.plan.status === "deleting" || !a.query.trim()) return [];
    const rows = await ctx.db.query("personalRecords").withSearchIndex("by_text", (q) => q.search("text", a.query.slice(0, 500)).eq("creatorId", a.creatorId).eq("active", true)).take(12);
    const out = [];
    for (const r of rows) if (await recordVisible(ctx, r, a.creatorId)) out.push({ text: `${r.text}${r.reason ? ` Reason: ${r.reason}` : ""}`, at: r.at, kind: r.kind, sourceIds: [...r.sourceMessageIds, ...r.sourcePostIds] });
    return out.slice(0, 4);
  },
});

const KIND = v.union(v.literal("idea"), v.literal("note"), v.literal("swipe"), v.literal("post"));
type Kind = Doc<"memories">["kind"];
export interface MemoryHit { id: Id<"memories">; kind: Kind; refId: string; text: string; at: number }

async function visible(ctx: QueryCtx, creator: Doc<"creators">, m: Doc<"memories">): Promise<boolean> {
  if (m.creatorId !== creator._id || creator.plan.status === "deleting") return false;
  if (m.kind === "note") {
    const note = creator.notes.find((n) => n.id === m.refId);
    return Boolean(note && !note.tombstonedAt && (!note.expiresHint || note.expiresHint > Date.now()));
  }
  const table = m.kind === "post" ? "ownPosts" : "ideas";
  const id = ctx.db.normalizeId(table, m.refId);
  const source = id ? await ctx.db.get(id) : null;
  return Boolean(source && source.creatorId === creator._id);
}
const hit = (m: Doc<"memories">): MemoryHit => ({ id: m._id, kind: m.kind, refId: m.refId, text: m.text, at: m.at });

export const upsert = internalMutation({
  args: { creatorId: v.id("creators"), kind: KIND, refId: v.string(), text: v.string(), embedding: v.optional(v.array(v.float64())) },
  handler: async (ctx, a): Promise<Id<"memories"> | null> => {
    const creator = await ctx.db.get(a.creatorId);
    if (!creator || creator.plan.status === "deleting") return null;
    const existing = await ctx.db.query("memories").withIndex("by_creator_ref", (q) => q.eq("creatorId", a.creatorId).eq("refId", a.refId)).first();
    const embedding = a.embedding ?? (existing?.text === a.text ? existing.embedding : undefined);
    const fields = { ...a, embedding, embeddingState: embedding ? "ready" as const : "pending" as const, at: existing?.at ?? Date.now() };
    if (existing) { await ctx.db.patch(existing._id, fields); return existing._id; }
    return await ctx.db.insert("memories", fields);
  },
});
export const byIds = internalQuery({
  args: { creatorId: v.id("creators"), ids: v.array(v.id("memories")) },
  handler: async (ctx, a): Promise<MemoryHit[]> => {
    const creator = await ctx.db.get(a.creatorId);
    if (!creator) return [];
    const out: MemoryHit[] = [];
    for (const id of a.ids) { const m = await ctx.db.get(id); if (m && await visible(ctx, creator, m)) out.push(hit(m)); }
    return out;
  },
});
export const lexical = internalQuery({
  args: { creatorId: v.id("creators"), query: v.string(), kind: v.optional(KIND) },
  handler: async (ctx, a): Promise<MemoryHit[]> => {
    const creator = await ctx.db.get(a.creatorId);
    if (!creator || !a.query.trim()) return [];
    const rows = await ctx.db.query("memories").withSearchIndex("by_text", (q) => {
      const search = q.search("text", a.query.slice(0, 500)).eq("creatorId", a.creatorId);
      return a.kind ? search.eq("kind", a.kind) : search;
    }).take(24);
    const out: MemoryHit[] = [];
    for (const row of rows) if (await visible(ctx, creator, row)) out.push(hit(row));
    return out;
  },
});
export const embeddingInput = internalQuery({
  args: { id: v.id("memories") },
  handler: async (ctx, a) => {
    const row = await ctx.db.get(a.id);
    const creator = row ? await ctx.db.get(row.creatorId) : null;
    return row && creator && await visible(ctx, creator, row) ? row : null;
  },
});
export const finishEmbedding = internalMutation({
  args: { id: v.id("memories"), text: v.string(), embedding: v.optional(v.array(v.float64())) },
  handler: async (ctx, a) => {
    const row = await ctx.db.get(a.id);
    if (!row || row.text !== a.text || (!a.embedding && row.embeddingState === "ready")) return false;
    await ctx.db.patch(row._id, { embedding: a.embedding, embeddingState: a.embedding ? "ready" : "failed" });
    return true;
  },
});
export const embedStored = internalAction({
  args: { id: v.id("memories"), attempt: v.optional(v.number()) },
  handler: async (ctx, a): Promise<boolean> => {
    const row = await ctx.runQuery(internal.agent.memory.embeddingInput, { id: a.id });
    if (!row || row.embeddingState === "ready") return Boolean(row);
    const result = await ctx.runAction(internal.core.embeddings.embedTexts, { texts: [row.text] }).catch(() => null);
    const embedding = result?.vectors[0]?.values;
    const current = await ctx.runMutation(internal.agent.memory.finishEmbedding, { id: a.id, text: row.text, embedding });
    const attempt = a.attempt ?? 0;
    if (!embedding && current && attempt < 3) await ctx.scheduler.runAfter(60_000 * 5 ** attempt, internal.agent.memory.embedStored, { id: a.id, attempt: attempt + 1 });
    return Boolean(embedding && current);
  },
});
export const index = internalAction({
  args: { creatorId: v.id("creators"), kind: KIND, refId: v.string(), text: v.string() },
  handler: async (ctx, a): Promise<{ ok: boolean; embedded?: boolean }> => {
    const text = a.text.trim().slice(0, 1500);
    if (!text) return { ok: false };
    const id = await ctx.runMutation(internal.agent.memory.upsert, { ...a, text });
    if (!id) return { ok: false };
    const embedded = await ctx.runAction(internal.agent.memory.embedStored, { id });
    return { ok: true, embedded };
  },
});
export const recall = internalAction({
  args: { creatorId: v.id("creators"), query: v.string(), k: v.optional(v.number()), kind: v.optional(KIND) },
  handler: async (ctx, a): Promise<Array<MemoryHit & { score: number }>> => {
    const k = Math.max(1, Math.min(a.k ?? 4, 12));
    const words: MemoryHit[] = await ctx.runQuery(internal.agent.memory.lexical, { creatorId: a.creatorId, query: a.query, kind: a.kind });
    let meaning: MemoryHit[] = [];
    try {
      const r = await ctx.runAction(internal.core.embeddings.embedTexts, { texts: [a.query.slice(0, 500)] });
      const vector = r.vectors[0]?.values;
      if (vector) {
        const hits = await ctx.vectorSearch("memories", "by_embedding", { vector, limit: 24, filter: (q) => q.eq("creatorId", a.creatorId) });
        meaning = (await ctx.runQuery(internal.agent.memory.byIds, { creatorId: a.creatorId, ids: hits.filter((h) => h._score >= 0.5).map((h) => h._id) })).filter((h) => !a.kind || h.kind === a.kind);
      }
    } catch { /* Lexical retrieval remains available during a provider outage. */ }
    const merged = new Map<string, MemoryHit & { score: number }>();
    for (const ranked of [words, meaning]) ranked.forEach((row, i) => merged.set(row.id, { ...row, score: (merged.get(row.id)?.score ?? 0) + 1 / (60 + i + 1) }));
    return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, k);
  },
});

/** Search the retained archive directly, including specialist routes and old conversations.
 * No second copy of private chat, no embedding dependency, no LLM-written false memories.
 */
export const conversations = internalQuery({
  args: { creatorId: v.id("creators"), query: v.string() },
  handler: async (ctx, a): Promise<Array<{ at: number; sourceId: Id<"messages">; text: string }>> => {
    const creator = await ctx.db.get(a.creatorId);
    if (!creator || creator.plan.status === "deleting" || !a.query.trim()) return [];
    const cutoff = Date.now() - MESSAGE_DAYS * 86_400_000;
    const rows = await ctx.db.query("messages").withSearchIndex("by_body", (q) => q.search("body", a.query.slice(0, 500)).eq("creatorId", a.creatorId).eq("memoryExcludedAt", undefined)).take(24);
    const result: Array<{ at: number; sourceId: Id<"messages">; text: string }> = [];
    const used = new Set<string>();
    for (const row of rows) {
      if (row.ts < cutoff || used.has(row._id) || (row.direction === "out" && !row.deliveredAt)) continue;
      const before = await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", a.creatorId).gte("ts", Math.max(cutoff, row.ts - 30 * 60_000)).lte("ts", row.ts)).order("desc").take(3);
      const after = await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", a.creatorId).gt("ts", row.ts).lte("ts", row.ts + 30 * 60_000)).take(2);
      const passage = [...before.reverse(), ...after].filter((m) => !m.memoryExcludedAt && (m.direction === "in" || m.deliveredAt));
      passage.forEach((m) => used.add(m._id));
      result.push({ at: row.ts, sourceId: row._id, text: passage.map((m) => `${m.direction === "in" ? "Creator said" : "Maya said (not proof an action happened)"}: ${m.body.slice(0, 700)}`).join("\n") });
      if (result.length === 3) break;
    }
    return result;
  },
});
