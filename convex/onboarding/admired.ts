/**
 * The admired list (plan §13.9): required, minimum three, and we do the work.
 * Adds are validated against the live profile read; removals keep history.
 */

import { v } from "convex/values";
import { action, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { addTracked } from "../agent/manage";

const platform = v.union(v.literal("tiktok"), v.literal("instagram"));

async function creatorFor(ctx: QueryCtx | MutationCtx): Promise<Doc<"creators"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return (await ctx.db.query("creators").withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", identity.subject)).first()) as Doc<"creators"> | null;
}

export const list = query({
  args: {},
  handler: async (ctx): Promise<Array<{ id: Id<"trackedAccounts">; platform: "tiktok" | "instagram"; handle: string; addedBy: string; status: string }>> => {
    const creator = await creatorFor(ctx);
    if (!creator) return [];
    const rows = (await ctx.db.query("trackedAccounts").withIndex("by_creator", (q) => q.eq("creatorId", creator._id)).collect()) as Doc<"trackedAccounts">[];
    return rows.filter((r) => r.status !== "removed").map((r) => ({ id: r._id, platform: r.platform, handle: r.handle, addedBy: r.addedBy, status: r.status }));
  },
});

/** Validate a handle against the live profile (0 credits on a vendor cache hit for Instagram). */
export const validate = action({
  args: { platform, handle: v.string() },
  handler: async (ctx, a): Promise<{ ok: boolean; handle: string; displayName?: string; followers?: number; avatarUrl?: string; reason?: string }> => {
    const handle = a.handle.trim().replace(/^@/, "").toLowerCase();
    if (!/^[a-z0-9._]{1,40}$/.test(handle)) return { ok: false, handle, reason: "that doesn't look like a handle" };
    try {
      const r = await ctx.runAction(internal.reads.read.read, { kind: "profile", params: { platform: a.platform, handle } });
      const p = r.value as { handle?: string; displayName?: string | null; followerCount?: number; avatarUrl?: string | null } | null;
      if (!p) return { ok: false, handle, reason: "couldn't find that account" };
      return { ok: true, handle: p.handle ?? handle, displayName: p.displayName ?? undefined, followers: p.followerCount, avatarUrl: p.avatarUrl ?? undefined };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (/404/.test(msg)) return { ok: false, handle, reason: "couldn't find that account" };
      return { ok: false, handle, reason: "couldn't check that account right now" };
    }
  },
});

export const add = mutation({
  args: { platform, handle: v.string(), addedBy: v.optional(v.union(v.literal("creator"), v.literal("suggested"))) },
  handler: async (ctx, a): Promise<{ ok: boolean; error?: string; id?: Id<"trackedAccounts"> }> => {
    const creator = await creatorFor(ctx);
    if (!creator) return { ok: false, error: "sign in first" };
    const existing = (await ctx.db.query("trackedAccounts").withIndex("by_creator", (q) => q.eq("creatorId", creator._id)).collect()) as Doc<"trackedAccounts">[];
    return await addTracked(ctx as never, creator._id, a.platform, a.handle, existing); // one rule for the web and the chat
  },
});

export const remove = mutation({
  args: { id: v.id("trackedAccounts") },
  handler: async (ctx, a): Promise<{ ok: boolean }> => {
    const creator = await creatorFor(ctx);
    const row = (await ctx.db.get(a.id)) as Doc<"trackedAccounts"> | null;
    if (!creator || !row || row.creatorId !== creator._id) return { ok: false };
    await ctx.db.patch(a.id, { status: "removed" }); // history kept
    return { ok: true };
  },
});

/**
 * Tap-to-pick suggestions for screen 3 (plan §7 S2): popular creators in their follower
 * band and country, plus the accounts they follow on TikTok, both through the cache.
 * Never their own handle, never one already on the list. Best effort: an empty list is
 * a normal answer, the free-entry field is always there.
 */
export const suggest = action({
  args: {},
  handler: async (ctx): Promise<Array<{ platform: "tiktok" | "instagram"; handle: string; followers: number | null; why: string }>> => {
    const me = await ctx.runQuery(internal.onboarding.admired.meForSuggest, {});
    if (!me) return [];
    const out: Array<{ platform: "tiktok" | "instagram"; handle: string; followers: number | null; why: string }> = [];
    const seen = new Set<string>([...me.mine, ...me.already]);
    const push = (platform: "tiktok" | "instagram", handle: string, followers: number | null, why: string) => {
      const h = handle.toLowerCase().replace(/^@/, "");
      if (!h || seen.has(h)) return;
      seen.add(h);
      out.push({ platform, handle: h, followers, why });
    };
    const country = me.timezone.startsWith("America/") ? "US" : me.timezone.startsWith("Europe/London") ? "GB" : me.timezone.startsWith("Australia/") ? "AU" : "US";
    let followers = 0;
    try {
      if (me.handles.tiktok) {
        const p = await ctx.runAction(internal.reads.read.read, { kind: "profile", params: { platform: "tiktok", handle: me.handles.tiktok }, creatorId: me.creatorId });
        followers = Number((p.value as { followerCount?: number } | null)?.followerCount ?? 0);
      }
    } catch {
      /* size unknown: middle band */
    }
    const band = followers >= 10_000_000 ? "10M+" : followers >= 1_000_000 ? "1M-10M" : followers >= 100_000 ? "100K-1M" : "10K-100K";
    try {
      const r = await ctx.runAction(internal.reads.read.read, { kind: "discover.creators", params: { band, country }, creatorId: me.creatorId });
      const rows = (Array.isArray(r.value) ? r.value : ((r.value as { creators?: unknown[]; users?: unknown[] } | null)?.creators ?? (r.value as { users?: unknown[] } | null)?.users ?? [])) as Array<{ handle?: string; uniqueId?: string; username?: string; followerCount?: number; followers?: number }>;
      for (const c of rows.slice(0, 12)) push("tiktok", String(c.handle ?? c.uniqueId ?? c.username ?? ""), Number(c.followerCount ?? c.followers ?? 0) || null, `popular in your size band (${band}) in ${country}`);
    } catch {
      /* discover is optional */
    }
    try {
      if (me.handles.tiktok) {
        const f = await ctx.runAction(internal.reads.read.read, { kind: "account.following", params: { handle: me.handles.tiktok }, creatorId: me.creatorId });
        const rows = (Array.isArray(f.value) ? f.value : ((f.value as { users?: unknown[]; following?: unknown[] } | null)?.users ?? (f.value as { following?: unknown[] } | null)?.following ?? [])) as Array<{ handle?: string; uniqueId?: string; username?: string; followerCount?: number }>;
        for (const c of rows.slice(0, 12)) push("tiktok", String(c.handle ?? c.uniqueId ?? c.username ?? ""), Number(c.followerCount ?? 0) || null, "you follow them");
      }
    } catch {
      /* following can be private */
    }
    return out.slice(0, 10);
  },
});

export const meForSuggest = internalQuery({
  args: {},
  handler: async (ctx): Promise<{ creatorId: Id<"creators">; handles: { tiktok?: string; instagram?: string }; timezone: string; mine: string[]; already: string[] } | null> => {
    const creator = await creatorFor(ctx);
    if (!creator) return null;
    const rows = (await ctx.db.query("trackedAccounts").withIndex("by_creator", (q) => q.eq("creatorId", creator._id)).collect()) as Doc<"trackedAccounts">[];
    return { creatorId: creator._id, handles: creator.handles, timezone: creator.timezone, mine: [creator.handles.tiktok, creator.handles.instagram].filter((h): h is string => Boolean(h)).map((h) => h.toLowerCase()), already: rows.filter((r) => r.status !== "removed").map((r) => r.handle) };
  },
});
