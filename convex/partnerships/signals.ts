import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

/**
 * B6 (§8.2) signals, collected by code. Signal 1, brands paying your lane: paid or #ad posts from
 * the accounts she watches for them, grouped by the brand the post tags. Zero new credits (the
 * sampler already reads these posts). Facts only; which brand fits them is her judgment.
 */
export interface PaidSighting { platform: string; postId: string; authorHandle: string; mentions: string[]; sampledAt: number }
export interface LaneBrand { handle: string; platform: string; posts: number; creators: string[]; lastSeen: number }

/** Pure: brands by how many different creators in their lane they paid (then posts, then recency). */
export function brandsPaying(sightings: PaidSighting[]): LaneBrand[] {
  const byBrand = new Map<string, { handle: string; platform: string; posts: Set<string>; creators: Set<string>; lastSeen: number }>();
  for (const s of sightings) {
    for (const m of s.mentions) {
      const key = `${s.platform}:${m}`;
      const b = byBrand.get(key) ?? { handle: m, platform: s.platform, posts: new Set(), creators: new Set(), lastSeen: 0 };
      b.posts.add(s.postId);
      b.creators.add(s.authorHandle);
      b.lastSeen = Math.max(b.lastSeen, s.sampledAt);
      byBrand.set(key, b);
    }
  }
  return [...byBrand.values()]
    .map((b) => ({ handle: b.handle, platform: b.platform, posts: b.posts.size, creators: [...b.creators].slice(0, 5), lastSeen: b.lastSeen }))
    .sort((x, y) => y.creators.length - x.creators.length || y.posts - x.posts || y.lastSeen - x.lastSeen);
}

/** Their lane's paying brands, from the accounts she watches for THEM (never another creator's roster). */
export const laneBrands = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<LaneBrand[]> => {
    const since = Date.now() - 30 * 86_400_000;
    const tracked = ((await ctx.db.query("trackedAccounts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"trackedAccounts">[]).filter((t) => t.status === "active");
    const sightings: PaidSighting[] = [];
    for (const t of tracked) {
      const rows = (await ctx.db.query("observations").withIndex("by_author", (q) => q.eq("platform", t.platform).eq("authorHandle", t.handle).gte("sampledAt", since)).take(200)) as Doc<"observations">[];
      for (const r of rows) if (r.paidPromotion && r.mentions?.length) sightings.push({ platform: r.platform, postId: r.postId, authorHandle: r.authorHandle, mentions: r.mentions, sampledAt: r.sampledAt });
    }
    return brandsPaying(sightings).slice(0, 8);
  },
});
