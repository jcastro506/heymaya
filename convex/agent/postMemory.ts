/**
 * Their own posts in her memory (2026-09-07). Before this, memory held her ideas, their
 * saves and their notes; their posts were searchable only by words in the caption, so "the
 * dog barking at the tv" found nothing for a video captioned "I have no words". Each post is
 * indexed as what it is AND what she saw in it (the card's signature, their world, the
 * humour, the one thing a friend would notice), so recall works the way a friend's does.
 */

import { v } from "convex/values";
import { internalAction, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";

export interface CardLite { signature?: string; them?: { world?: string; humor?: string; look?: string; presence?: string; cares?: string }; aFriendWouldNotice?: string; hook?: { spokenLine?: string; onScreenText?: string } }

/** Pure: one paragraph a friend could search by: what it is, what happened, what it showed about them. */
export function textForPost(post: { caption: string; transcript?: string | null; createTime: number; metrics: { views: number }; multiple?: number | null }, card: CardLite | null, timeZone: string): string {
  const when = new Intl.DateTimeFormat("en-US", { timeZone, month: "short", year: "numeric" }).format(post.createTime);
  const parts = [
    `${when}: "${post.caption.trim().slice(0, 140) || "(no caption)"}"`,
    post.transcript ? `said: ${post.transcript.trim().slice(0, 240)}` : "",
    card?.hook?.onScreenText && card.hook.onScreenText !== "none" ? `on screen: ${card.hook.onScreenText}` : "",
    card?.signature ? `what it is: ${card.signature}` : "",
    card?.them?.world ? `their world: ${card.them.world}` : "",
    card?.them?.humor && card.them.humor !== "none" ? `the humour: ${card.them.humor}` : "",
    card?.aFriendWouldNotice ? `a friend would notice: ${card.aFriendWouldNotice}` : "",
    post.multiple !== undefined && post.multiple !== null ? `did ${post.multiple}× their normal` : `${post.metrics.views.toLocaleString()} views`,
  ].filter(Boolean);
  return parts.join(". ").slice(0, 1200);
}

export const postWithCard = internalQuery({
  args: { creatorId: v.id("creators"), ownPostId: v.id("ownPosts") },
  handler: async (ctx, a): Promise<{ text: string } | null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    const p = (await ctx.db.get(a.ownPostId)) as Doc<"ownPosts"> | null;
    if (!c || !p || p.creatorId !== a.creatorId) return null;
    const read = (await ctx.db.query("ownPostReads").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(300)) as Doc<"ownPostReads">[];
    const mine = read.find((r) => r.ownPostId === a.ownPostId && (r as unknown as { depth?: string }).depth === "watch") ?? read.find((r) => r.ownPostId === a.ownPostId);
    return { text: textForPost(p, (mine?.card as CardLite | undefined) ?? null, c.timezone) };
  },
});

export const postIds = internalQuery({
  args: { creatorId: v.id("creators"), cursor: v.optional(v.string()) },
  handler: async (ctx, a): Promise<{ ids: Id<"ownPosts">[]; cursor: string | null }> => {
    const page = await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").paginate({ cursor: a.cursor ?? null, numItems: 40 });
    return { ids: page.page.map((p) => p._id), cursor: page.isDone ? null : page.continueCursor };
  },
});

/** One post into memory, re-indexed when it is watched again (same refId, upsert). */
export const indexPost = internalAction({
  args: { creatorId: v.id("creators"), ownPostId: v.id("ownPosts") },
  handler: async (ctx, a): Promise<{ indexed: boolean }> => {
    const r = await ctx.runQuery(internal.agent.postMemory.postWithCard, { creatorId: a.creatorId, ownPostId: a.ownPostId });
    if (!r) return { indexed: false };
    const result = await ctx.runAction(internal.agent.memory.index, { creatorId: a.creatorId, kind: "post", refId: String(a.ownPostId), text: r.text });
    return { indexed: result.ok };
  },
});

/** Every post they have, after onboarding and on demand. */
export const indexAll = internalAction({
  args: { creatorId: v.id("creators"), cursor: v.optional(v.string()) },
  handler: async (ctx, a): Promise<{ indexed: number }> => {
    const page = await ctx.runQuery(internal.agent.postMemory.postIds, a);
    let indexed = 0;
    for (const ownPostId of page.ids) {
      const r = await ctx.runAction(internal.agent.postMemory.indexPost, { creatorId: a.creatorId, ownPostId });
      if (r.indexed) indexed++;
    }
    if (page.cursor) await ctx.scheduler.runAfter(0, internal.agent.postMemory.indexAll, { creatorId: a.creatorId, cursor: page.cursor });
    return { indexed };
  },
});
