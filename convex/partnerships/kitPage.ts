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
import { publicView, readKitV2, type PublicKitV2 } from "./kitData";
import { partnershipsOpen } from "./store";
import { CLOSED, Opportunity } from "./contracts";

export type PublicKit = PublicKitV2;

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
  // K1: the kit is a partnerships-plan thing; turning it OFF always works.
  if (on && !partnershipsOpen(c)) throw new Error("Media kits are on the partnerships plan");
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

/**
 * Public, by slug: the base kit, or a per-brand link (K1). Null for an unknown, revoked or closed
 * link, and for anyone not on the partnerships plan. Only what `publicView` allows leaves here:
 * never rates, preferences, excluded brands or the brands they tag; the audience only with their yes.
 */
export const publicKit = query({
  args: { slug: v.string() },
  handler: async (ctx, a): Promise<PublicKit | null> => {
    if (!/^[a-z0-9]{8,40}$/.test(a.slug)) return null;
    const variant = (await ctx.db.query("kitVariants").withIndex("by_slug", (q) => q.eq("slug", a.slug)).first()) as Doc<"kitVariants"> | null;
    const c = variant
      ? ((await ctx.db.get(variant.creatorId)) as Doc<"creators"> | null)
      : ((await ctx.db.query("creators").withIndex("by_kit_slug", (q) => q.eq("kitLink.slug", a.slug)).unique()) as Doc<"creators"> | null);
    if (!c || c.plan.status === "deleting" || !partnershipsOpen(c)) return null;
    if (variant) {
      const opp = (await ctx.db.get(variant.opportunityId)) as Doc<"partnershipOpportunities"> | null;
      const d = opp ? Opportunity.safeParse(opp.data) : null;
      if (!d?.success || CLOSED.has(d.data.status)) return null;
      return publicView(await readKitV2(ctx, c), { brand: variant.brand, idea: variant.idea, postUrls: variant.postUrls });
    }
    return publicView(await readKitV2(ctx, c));
  },
});
