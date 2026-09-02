/**
 * The admired list (plan §13.9): required, minimum three, and we do the work.
 * Adds are validated against the live profile read; removals keep history.
 */

import { v } from "convex/values";
import { action, mutation, query } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";

const platform = v.union(v.literal("tiktok"), v.literal("instagram"));

async function creatorFor(ctx: { auth: { getUserIdentity: () => Promise<{ subject: string } | null> }; db: { query: (t: "creators") => any } }): Promise<Doc<"creators"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return (await ctx.db.query("creators").withIndex("by_clerkUserId", (q: any) => q.eq("clerkUserId", identity.subject)).first()) as Doc<"creators"> | null;
}

export const list = query({
  args: {},
  handler: async (ctx): Promise<Array<{ id: Id<"trackedAccounts">; platform: "tiktok" | "instagram"; handle: string; addedBy: string; status: string }>> => {
    const creator = await creatorFor(ctx as never);
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
    const creator = await creatorFor(ctx as never);
    if (!creator) return { ok: false, error: "sign in first" };
    const handle = a.handle.trim().replace(/^@/, "").toLowerCase();
    const existing = (await ctx.db.query("trackedAccounts").withIndex("by_creator", (q) => q.eq("creatorId", creator._id)).collect()) as Doc<"trackedAccounts">[];
    const dup = existing.find((r) => r.platform === a.platform && r.handle === handle);
    if (dup) {
      if (dup.status === "removed") await ctx.db.patch(dup._id, { status: "active" });
      return { ok: true, id: dup._id };
    }
    if (existing.filter((r) => r.status !== "removed").length >= 10) return { ok: false, error: "ten is the most she can watch closely" };
    const id = await ctx.db.insert("trackedAccounts", {
      creatorId: creator._id,
      platform: a.platform,
      handle,
      addedBy: a.addedBy ?? "creator",
      baselineN: 0,
      status: "active",
      createdAt: Date.now(),
    });
    return { ok: true, id };
  },
});

export const remove = mutation({
  args: { id: v.id("trackedAccounts") },
  handler: async (ctx, a): Promise<{ ok: boolean }> => {
    const creator = await creatorFor(ctx as never);
    const row = (await ctx.db.get(a.id)) as Doc<"trackedAccounts"> | null;
    if (!creator || !row || row.creatorId !== creator._id) return { ok: false };
    await ctx.db.patch(a.id, { status: "removed" }); // history kept
    return { ok: true };
  },
});
