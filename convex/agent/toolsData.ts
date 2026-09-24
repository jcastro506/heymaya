/** The creator-side tools' reads (plan §13.11): their own rows, scoped by creatorId, never the vendor. */

import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "my", "your", "this", "that", "is", "it", "i", "you", "about", "post", "video", "one"]);

export function tokens(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9#@]+/).filter((w) => w.length > 2 && !STOP.has(w));
}

/** Word overlap over caption + transcript, ranked, top five. Cheap and honest; embeddings arrive with the swipe file. */
export const ownRhymes = internalQuery({
  args: { creatorId: v.id("creators"), query: v.string() },
  handler: async (ctx, a): Promise<Array<{ url: string; multiple: number | null; caption: string; createTime: number }>> => {
    const q = new Set(tokens(a.query));
    if (q.size === 0) return [];
    const posts = (await ctx.db.query("ownPosts").withIndex("by_creator", (q2) => q2.eq("creatorId", a.creatorId)).order("desc").take(200)) as Doc<"ownPosts">[];
    const scored = posts
      .map((p) => {
        const words = new Set(tokens(`${p.caption} ${p.transcript ?? ""}`));
        let hit = 0;
        for (const w of q) if (words.has(w)) hit++;
        return { p, score: hit / q.size };
      })
      .filter((x) => x.score > 0)
      .sort((x, y) => y.score - x.score || (y.p.multiple ?? 0) - (x.p.multiple ?? 0))
      .slice(0, 5);
    return scored.map(({ p }) => ({ url: p.url, multiple: p.multiple ?? null, caption: p.caption, createTime: p.createTime }));
  },
});

/** Posts by row id, for the semantic half of own_rhymes (2026-09-07). Scoped to the creator. */
export const postsByIds = internalQuery({
  args: { creatorId: v.id("creators"), ids: v.array(v.id("ownPosts")) },
  handler: async (ctx, a): Promise<Array<{ url: string; multiple: number | null; caption: string; createTime: number }>> => {
    const out: Array<{ url: string; multiple: number | null; caption: string; createTime: number }> = [];
    for (const id of a.ids) {
      const p = (await ctx.db.get(id)) as Doc<"ownPosts"> | null;
      if (p && p.creatorId === a.creatorId) out.push({ url: p.url, multiple: p.reachMultiple ?? p.multiple ?? null, caption: p.caption, createTime: p.createTime });
    }
    return out;
  },
});
