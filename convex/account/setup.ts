/**
 * A1: the account type each platform needs for Maya to work fully, read from their PUBLIC profile
 * (no connection needed), and the one piece of setup advice per platform.
 *
 * Instagram must be professional to connect at all; Creator beats Business (Business accounts get
 * a limited music library). TikTok stays personal: a business account loses trending sounds and
 * the Creator Rewards Program, which costs more than the analytics it adds.
 */
import { v } from "convex/values";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";

export type AccountType = "personal" | "creator" | "business";
export interface SetupAdvice { needed: boolean; title: string; why: string; steps: string[] }

/** Pure: what (if anything) to ask them to change, per platform and account type. */
export function setupAdvice(platform: "tiktok" | "instagram", type: AccountType | null): SetupAdvice | null {
  if (platform === "instagram") {
    if (type === "personal") return { needed: true, title: "Switch Instagram to a Creator account", why: "Instagram only lets a Creator or Business account connect, and without it Maya can't see your reach, saves or watch time. It's free and takes a minute. Creator keeps the full music library.", steps: ["Open Instagram and go to your profile", "Tap the menu (☰), then Settings and privacy", "Tap Account type and tools", "Tap Switch to professional account", "Choose Creator, pick a category, and tap Done"] };
    if (type === "business") return { needed: false, title: "Creator works better than Business for you", why: "Business accounts get a limited music library. A Creator account connects the same way and keeps every sound. Optional.", steps: ["Settings and privacy", "Account type and tools", "Switch to creator account"] };
    return null;
  }
  if (type === "business") return { needed: false, title: "A personal TikTok gets every sound", why: "Business accounts can only use TikTok's commercial music, and can't earn from the Creator Rewards Program. Maya works with either; switch back only if that matters to you.", steps: ["Profile, then the menu (☰)", "Settings and privacy, then Account", "Switch to Personal Account"] };
  return null;
}

export const handlesFor = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ tiktok?: string; instagram?: string } | null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    return c ? { tiktok: c.handles.tiktok ?? undefined, instagram: c.handles.instagram ?? undefined } : null;
  },
});

export const save = internalMutation({
  args: { creatorId: v.id("creators"), tiktok: v.optional(v.union(v.literal("personal"), v.literal("creator"), v.literal("business"))), instagram: v.optional(v.union(v.literal("personal"), v.literal("creator"), v.literal("business"))) },
  handler: async (ctx, a): Promise<null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return null;
    await ctx.db.patch(a.creatorId, { accountTypes: { ...(c.accountTypes ?? {}), ...(a.tiktok ? { tiktok: a.tiktok } : {}), ...(a.instagram ? { instagram: a.instagram } : {}), checkedAt: Date.now() } });
    return null;
  },
});

/** One creator: read each public profile (cached a week, so ~free) and keep the account type. */
export const check = internalAction({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ tiktok: AccountType | null; instagram: AccountType | null }> => {
    const h = await ctx.runQuery(internal.account.setup.handlesFor, a);
    const out: { tiktok: AccountType | null; instagram: AccountType | null } = { tiktok: null, instagram: null };
    for (const platform of ["tiktok", "instagram"] as const) {
      const handle = h?.[platform];
      if (!handle) continue;
      try {
        let r = await ctx.runAction(internal.reads.read.read, { kind: "profile", params: { platform, handle }, creatorId: a.creatorId });
        // A profile cached before account types were read has no such key: read it fresh, once.
        if (r.value && typeof r.value === "object" && !("accountType" in (r.value as object))) r = await ctx.runAction(internal.reads.read.read, { kind: "profile", params: { platform, handle }, creatorId: a.creatorId, force: true });
        const t =(r.value as { accountType?: AccountType | null } | null)?.accountType ?? null;
        out[platform] = t;
      } catch {
        // an unreadable profile keeps whatever we knew; the next weekly pass tries again
      }
    }
    await ctx.runMutation(internal.account.setup.save, { creatorId: a.creatorId, ...(out.tiktok ? { tiktok: out.tiktok } : {}), ...(out.instagram ? { instagram: out.instagram } : {}) });
    return out;
  },
});

export const due = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, a): Promise<Id<"creators">[]> => {
    const rows = (await ctx.db.query("schedule").withIndex("by_paired_status", (q) => q.eq("paired", true)).collect()) as Doc<"schedule">[];
    const out: Id<"creators">[] = [];
    for (const r of rows) {
      if (r.isEval) continue;
      const c = (await ctx.db.get(r.creatorId)) as Doc<"creators"> | null;
      if (c && (!c.accountTypes?.checkedAt || c.accountTypes.checkedAt < a.now - 7 * 86_400_000)) out.push(c._id);
    }
    return out;
  },
});

export const checkAll = internalAction({
  args: {},
  handler: async (ctx): Promise<{ scheduled: number }> => {
    const ids = await ctx.runQuery(internal.account.setup.due, { now: Date.now() });
    for (const [i, creatorId] of ids.entries()) await ctx.scheduler.runAfter(i * 1_500, internal.account.setup.check, { creatorId });
    return { scheduled: ids.length };
  },
});
