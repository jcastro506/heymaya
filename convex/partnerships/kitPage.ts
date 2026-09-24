/**
 * B6 (audit §8.2): the shareable media-kit page, "the one kind of public web page worth keeping".
 * They turn it on (app or chat, one shared function), get a link to paste into a pitch or a brand
 * form, and can turn it off, which kills the old link at once.
 *
 * The page shows public numbers only: handles, followers, normal views, best recent posts, lane.
 * Never their rates, deal preferences, excluded brands, email or the brands they tag.
 */
import { v } from "convex/values";
import { query, type MutationCtx } from "../_generated/server";
import { internalMutation, mutation } from "../lib/functions";
import type { Doc, Id } from "../_generated/dataModel";
import { creatorForIdentity } from "../core/identity";
import { readKit } from "./kit";

export interface PublicKit {
  name: string;
  lane: string | null;
  asOf: string;
  platforms: Array<{ platform: string; handle: string | null; followers: number | null; normalViews: number | null; best: Array<{ url: string; views: number; caption: string }> }>;
}

function slug(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 20);
}

export function kitUrl(s: string, env: Record<string, string | undefined> = process.env): string {
  return `${(env.APP_URL ?? "https://hey-maya.ai").replace(/\/$/, "")}/k/${s}`;
}

/** The one function both doors use: on keeps an existing link, off deletes it. */
export async function setKitLink(ctx: MutationCtx, creatorId: Id<"creators">, on: boolean): Promise<{ url: string | null }> {
  const c = (await ctx.db.get(creatorId)) as Doc<"creators"> | null;
  if (!c) throw new Error("creator not found");
  if (!on) {
    await ctx.db.patch(creatorId, { kitLink: undefined });
    return { url: null };
  }
  const link = c.kitLink ?? { slug: slug(), createdAt: Date.now() };
  if (!c.kitLink) await ctx.db.patch(creatorId, { kitLink: link });
  return { url: kitUrl(link.slug) };
}

export const kitLink = mutation({
  args: { on: v.boolean() },
  handler: async (ctx, a): Promise<{ url: string | null }> => {
    const c = await creatorForIdentity(ctx);
    if (!c) throw new Error("Not signed in");
    return await setKitLink(ctx, c._id, a.on);
  },
});

export const kitLinkFor = internalMutation({
  args: { creatorId: v.id("creators"), on: v.boolean() },
  handler: async (ctx, a): Promise<{ url: string | null }> => await setKitLink(ctx, a.creatorId, a.on),
});

/** Public, by slug: null for an unknown or revoked link. Only public numbers leave here. */
export const publicKit = query({
  args: { slug: v.string() },
  handler: async (ctx, a): Promise<PublicKit | null> => {
    if (!/^[a-z0-9]{8,40}$/.test(a.slug)) return null;
    const c = (await ctx.db.query("creators").withIndex("by_kit_slug", (q) => q.eq("kitLink.slug", a.slug)).unique()) as Doc<"creators"> | null;
    if (!c || c.plan.status === "deleting") return null;
    const k = await readKit(ctx, c);
    return {
      name: c.handles.tiktok ?? c.handles.instagram ?? "creator",
      lane: k.lane,
      asOf: new Date().toISOString().slice(0, 10),
      platforms: k.platforms.map((p) => ({ platform: p.platform, handle: p.handle, followers: p.followers, normalViews: p.normalViews, best: p.best.slice(0, 3).map((b) => ({ url: b.url, views: b.views, caption: b.caption })) })),
    };
  },
});
