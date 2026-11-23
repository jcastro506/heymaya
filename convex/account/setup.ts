/**
 * A1: the account type each platform needs for Maya to work fully, read from their PUBLIC profile
 * (no connection needed), and the one piece of setup advice per platform.
 *
 * TikTok stays personal: a business account loses trending sounds and the Creator Rewards Program,
 * which costs more than the analytics it adds. TikTok only: an old Instagram row gets no advice.
 */
import { v } from "convex/values";
import { internalAction, internalQuery, query } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";

export type AccountType = "personal" | "creator" | "business";
export interface SetupAdvice { needed: boolean; title: string; why: string; steps: string[] }

/** Pure: what (if anything) to ask them to change, per platform and account type. */
export function setupAdvice(platform: "tiktok" | "instagram", type: AccountType | null): SetupAdvice | null {
  if (platform !== "tiktok") return null;
  if (type === "business") return { needed: false, title: "A personal TikTok gets every sound", why: "Business accounts can only use TikTok's commercial music, and can't earn from the Creator Rewards Program. Maya works with either; switch back only if that matters to you.", steps: ["Profile, then the menu (☰)", "Settings and privacy, then Account", "Switch to Personal Account"] };
  return null;
}

/**
 * The same advice, for a screen that can't know their account type yet (onboarding's Connect step,
 * before anything is connected), from the one definition above. Pure read. The validator still takes
 * "instagram" so an older app build's call answers null instead of failing.
 */
export const advice = query({
  args: { platform: v.union(v.literal("tiktok"), v.literal("instagram")), accountType: v.union(v.literal("personal"), v.literal("creator"), v.literal("business")) },
  handler: async (_ctx, a): Promise<SetupAdvice | null> => setupAdvice(a.platform, a.accountType),
});

export const handlesFor = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ tiktok?: string } | null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    return c ? { tiktok: c.handles.tiktok ?? undefined } : null;
  },
});

export const save = internalMutation({
  args: { creatorId: v.id("creators"), tiktok: v.optional(v.union(v.literal("personal"), v.literal("creator"), v.literal("business"))) },
  handler: async (ctx, a): Promise<null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return null;
    await ctx.db.patch(a.creatorId, { accountTypes: { ...(c.accountTypes ?? {}), ...(a.tiktok ? { tiktok: a.tiktok } : {}), checkedAt: Date.now() } });
    return null;
  },
});

/** One creator: read each public profile (cached a week, so ~free) and keep the account type. */
export const check = internalAction({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ tiktok: AccountType | null }> => {
    const h = await ctx.runQuery(internal.account.setup.handlesFor, a);
    const out: { tiktok: AccountType | null } = { tiktok: null };
    const platform = "tiktok" as const;
    const handle = h?.tiktok;
    if (handle) {
      try {
        let r = await ctx.runAction(internal.reads.read.read, { kind: "profile", params: { platform, handle }, creatorId: a.creatorId });
        // A profile cached before account types were read has no such key: read it fresh, once.
        if (r.value && typeof r.value === "object" && !("accountType" in (r.value as object))) r = await ctx.runAction(internal.reads.read.read, { kind: "profile", params: { platform, handle }, creatorId: a.creatorId, force: true });
        const t =(r.value as { accountType?: AccountType | null } | null)?.accountType ?? null;
        out.tiktok = t;
      } catch {
        // an unreadable profile keeps whatever we knew; the next weekly pass tries again
      }
    }
    await ctx.runMutation(internal.account.setup.save, { creatorId: a.creatorId, ...(out.tiktok ? { tiktok: out.tiktok } : {}) });
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
