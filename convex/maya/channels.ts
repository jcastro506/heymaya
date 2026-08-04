/**
 * Channels — what she's actually allowed to post to (Sprint 3).
 *
 * ## Why this reads from Zernio rather than being told
 *
 * A channel row asserts three things: the connection exists, it works, and we
 * may post through it. All three are Zernio's to know, and all three go stale
 * without warning — a founder revokes access in X's settings and nothing tells
 * us. So the row is **derived from the vendor**, never hand-entered, and a sync
 * that finds a connection gone marks it gone.
 *
 * ## Connected is not the same as can-post
 *
 * The account list carries a `permissions` array. An X connection without
 * `tweet.write` authenticates perfectly, appears in every listing, and cannot
 * publish — which would show up as a publish failure at the worst possible
 * moment rather than a connection problem at the obvious one.
 *
 * That distinction is the reason this file exists instead of an insert.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";

/** Zernio's platform slug → our channel key. `twitter` is X. */
const CHANNEL_BY_SLUG: Record<string, "x" | "instagram" | "tiktok" | "youtube"> = {
  twitter: "x",
  instagram: "instagram",
  tiktok: "tiktok",
  youtube: "youtube",
};

/**
 * The permission each platform needs before a post is even possible.
 *
 * Checked because its absence is silent: everything else about the connection
 * looks healthy.
 */
const WRITE_PERMISSION: Record<string, string> = {
  x: "tweet.write",
};

export interface ChannelHealth {
  channel: string;
  zernioAccountId: string;
  handle?: string;
  connected: boolean;
  /** Why not, in words a founder can act on. */
  reason?: string;
}

/**
 * Decide what one Zernio account row means for us.
 *
 * Pure, so the mapping is testable without a network — and the mapping is the
 * part that carries the judgment.
 */
export function readAccount(raw: {
  _id?: unknown;
  platform?: unknown;
  isActive?: unknown;
  enabled?: unknown;
  needsReconnection?: unknown;
  platformStatus?: unknown;
  platformStatusReason?: unknown;
  permissions?: unknown;
  metadata?: unknown;
}): ChannelHealth | null {
  const slug = typeof raw.platform === "string" ? raw.platform : "";
  const channel = CHANNEL_BY_SLUG[slug];
  const zernioAccountId = typeof raw._id === "string" ? raw._id : "";
  if (!channel || !zernioAccountId) return null;

  const profile = (
    raw.metadata as { profileData?: { username?: unknown } } | undefined
  )?.profileData;
  const handle =
    typeof profile?.username === "string" ? profile.username : undefined;

  const base: ChannelHealth = { channel, zernioAccountId, handle, connected: true };

  if (raw.needsReconnection === true) {
    return { ...base, connected: false, reason: "the connection needs to be re-authorised" };
  }
  if (raw.isActive === false || raw.enabled === false) {
    return { ...base, connected: false, reason: "the connection is switched off in Zernio" };
  }
  if (typeof raw.platformStatus === "string" && raw.platformStatus !== "active") {
    const detail =
      typeof raw.platformStatusReason === "string" && raw.platformStatusReason
        ? ` — ${raw.platformStatusReason}`
        : "";
    return { ...base, connected: false, reason: `the platform reports "${raw.platformStatus}"${detail}` };
  }

  const needed = WRITE_PERMISSION[channel];
  if (needed) {
    const granted = Array.isArray(raw.permissions)
      ? raw.permissions.filter((p): p is string => typeof p === "string")
      : [];
    if (!granted.includes(needed)) {
      // Authenticates fine, lists fine, cannot post. Caught here rather than at
      // publish time, where it would read as a publishing bug.
      return {
        ...base,
        connected: false,
        reason: `the connection can't post — it's missing the ${needed} permission`,
      };
    }
  }

  return base;
}

export const upsertChannel = internalMutation({
  args: {
    customerId: v.id("customers"),
    channel: v.union(
      v.literal("x"),
      v.literal("instagram"),
      v.literal("tiktok"),
      v.literal("youtube")
    ),
    zernioAccountId: v.string(),
    handle: v.optional(v.string()),
    connected: v.boolean(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ channelId: Id<"channels"> }> => {
    const rows = (await ctx.db
      .query("channels")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .collect()) as Doc<"channels">[];
    const existing = rows.find((r) => r.channel === args.channel);

    const now = Date.now();
    const patch = {
      zernioAccountId: args.zernioAccountId,
      handle: args.handle,
      status: args.connected ? ("connected" as const) : ("error" as const),
      failureReason: args.connected ? undefined : args.reason,
      lastCheckedAt: now,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return { channelId: existing._id };
    }

    const channelId = await ctx.db.insert("channels", {
      customerId: args.customerId,
      channel: args.channel,
      // A new channel starts by showing its work. §9.1's calibration is a
      // behaviour, not a gate — but the switch itself opens closed.
      postingMode: "show_me_first",
      createdAt: now,
      ...patch,
    });
    return { channelId };
  },
});

export const forCustomer = internalQuery({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args): Promise<Doc<"channels">[]> =>
    (await ctx.db
      .query("channels")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .collect()) as Doc<"channels">[],
});

/**
 * Ask Zernio what's connected, and make the rows match.
 *
 * Returns what it found so the caller — or a human running it by hand — sees
 * the same thing the rows now say.
 */
export const syncChannels = internalAction({
  args: { customerId: v.id("customers") },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: boolean; error?: string; channels: ChannelHealth[] }> => {
    const apiKey = process.env.ZERNIO_API_KEY;
    if (!apiKey) return { ok: false, error: "Zernio isn't configured", channels: [] };

    const { ZernioClient } = await import("../integrations/zernio/client");
    let raw: unknown;
    try {
      raw = await new ZernioClient({ apiKey }).request<unknown>("/api/v1/accounts");
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        channels: [],
      };
    }

    const accounts = (raw as { accounts?: unknown })?.accounts;
    if (!Array.isArray(accounts)) {
      // Same rule as publishing: a shape we can't read is an error, not an
      // empty list. "No accounts connected" and "the contract moved" would
      // otherwise be indistinguishable, and one of them silently disconnects
      // every channel.
      return {
        ok: false,
        error: "Zernio returned an unrecognised account list",
        channels: [],
      };
    }

    const found: ChannelHealth[] = [];
    for (const account of accounts) {
      const health = readAccount(account as Record<string, unknown>);
      if (!health) continue;
      found.push(health);
      await ctx.runMutation(internal.maya.channels.upsertChannel, {
        customerId: args.customerId,
        channel: health.channel as "x" | "instagram" | "tiktok" | "youtube",
        zernioAccountId: health.zernioAccountId,
        handle: health.handle,
        connected: health.connected,
        reason: health.reason,
      });
    }

    return { ok: true, channels: found };
  },
});

/**
 * Flip a channel's switch. `just_go` is the founder's decision, not ours.
 */
export const setPostingMode = internalMutation({
  args: {
    customerId: v.id("customers"),
    channel: v.string(),
    postingMode: v.union(v.literal("show_me_first"), v.literal("just_go")),
  },
  handler: async (ctx, args): Promise<{ ok: boolean; error?: string }> => {
    const rows = (await ctx.db
      .query("channels")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .collect()) as Doc<"channels">[];
    const row = rows.find((r) => r.channel === args.channel);
    if (!row) return { ok: false, error: `no ${args.channel} channel` };
    await ctx.db.patch(row._id, {
      postingMode: args.postingMode,
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});
