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
