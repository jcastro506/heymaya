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
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  CHANNEL_REQUIREMENTS,
  noticesFor,
  type Channel,
} from "./channelRequirements";

/** Zernio's platform slug → our channel key. `twitter` is X. */
const CHANNEL_BY_SLUG: Record<
  string,
  "x" | "instagram" | "tiktok" | "youtube"
> = {
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
/**
 * ⭐ The permission that means "this connection can actually publish" (§6.0.15).
 *
 * > *"Some platforms accept a connection that can never post. The connection
 * > succeeds, the account appears in every listing, health looks fine — and the
 * > first evidence of a problem is a publish failing weeks later, which reads as
 * > our bug rather than an account setting."*
 *
 * ⚠️ This map used to contain **X only**, so three of four channels could
 * connect cleanly and never post with nothing to show for it. Instagram is the
 * case §6.0.15 calls load-bearing.
 *
 * ⭐ And Instagram needs no special case. Meta issues
 * `instagram_business_content_publish` only to Business/Creator accounts, so
 * "is this a personal account?" arrives as a missing scope — the same shape as
 * every other platform. A lookup, not a branch.
 *
 * VERIFIED LIVE 2026-08-11 against `GET /api/v1/accounts` for four real
 * connected accounts. Every value below was read off that response rather than
 * taken from a doc, because the platform slug for X is `twitter` and two of
 * these scope names are not what their docs call them.
 */
const WRITE_PERMISSION: Record<string, string> = {
  instagram: "instagram_business_content_publish",
  tiktok: "video.publish",
  x: "tweet.write",
  youtube: "https://www.googleapis.com/auth/youtube.upload",
};

/**
 * What to tell them when the publish permission is absent — per channel, in
 * their terms. Keyed rather than branched, same as the map above.
 */
const CANNOT_POST_REASON: Record<string, string> = {
  instagram:
    "this looks like a personal Instagram — it needs to be a Business or Creator account before anything can be posted",
  tiktok:
    "TikTok didn't grant permission to publish — reconnecting should fix it",
  x: "X didn't grant permission to post — reconnecting should fix it",
  youtube:
    "YouTube didn't grant permission to upload — reconnecting should fix it",
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

  const base: ChannelHealth = {
    channel,
    zernioAccountId,
    handle,
    connected: true,
  };

  if (raw.needsReconnection === true) {
    return {
      ...base,
      connected: false,
      reason: "the connection needs to be re-authorised",
    };
  }
  if (raw.isActive === false || raw.enabled === false) {
    return {
      ...base,
      connected: false,
      reason: "the connection is switched off in Zernio",
    };
  }
  if (
    typeof raw.platformStatus === "string" &&
    raw.platformStatus !== "active"
  ) {
    const detail =
      typeof raw.platformStatusReason === "string" && raw.platformStatusReason
        ? ` — ${raw.platformStatusReason}`
        : "";
    return {
      ...base,
      connected: false,
      reason: `the platform reports "${raw.platformStatus}"${detail}`,
    };
  }

  const needed = WRITE_PERMISSION[channel];
  if (needed) {
    const granted = Array.isArray(raw.permissions)
      ? raw.permissions.filter((p): p is string => typeof p === "string")
      : [];
    if (!granted.includes(needed)) {
      // Authenticates fine, lists fine, cannot post. Caught here rather than at
      // publish time, where it would read as a publishing bug.
      /**
       * ⚠️ Named in terms of what the FOUNDER has to change, not the scope
       * string. "missing instagram_business_content_publish" is true and
       * useless; "your Instagram is a personal account" is the same fact
       * expressed as the two-minute fix it actually is (§11 — never leak our
       * plumbing at them).
       */
      return {
        ...base,
        connected: false,
        reason:
          CANNOT_POST_REASON[channel] ??
          "the connection can't post — it needs to be re-authorised",
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
      v.literal("youtube"),
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
 * The customer's vendor-side tenant id. Its own query so the action can read
 * it without a db handle.
 */
export const profileIdFor = internalQuery({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args): Promise<string | null> => {
    const customer = (await ctx.db.get(
      args.customerId,
    )) as Doc<"customers"> | null;
    return customer?.zernioProfileId ?? null;
  },
});

export const setProfileId = internalMutation({
  args: { customerId: v.id("customers"), zernioProfileId: v.string() },
  handler: async (ctx, args): Promise<null> => {
    const customer = (await ctx.db.get(
      args.customerId,
    )) as Doc<"customers"> | null;
    /**
     * ⚠️ Never reassigned. A customer whose profile id changed would orphan
     * every channel row pointing at the old one, and the next sync would find
     * nothing while the founder's accounts still exist at the vendor.
     */
    if (!customer || customer.zernioProfileId) return null;
    await ctx.db.patch(args.customerId, {
      zernioProfileId: args.zernioProfileId,
      updatedAt: Date.now(),
    });
    return null;
  },
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
    args,
  ): Promise<{ ok: boolean; error?: string; channels: ChannelHealth[] }> => {
    const apiKey = process.env.ZERNIO_API_KEY;
    if (!apiKey)
      return { ok: false, error: "Zernio isn't configured", channels: [] };

    /**
     * ⚠️ THE TENANT BOUNDARY. One Zernio API key covers the whole fleet, so an
     * unfiltered `GET /api/v1/accounts` returns EVERY customer's accounts —
     * and the loop below attaches whatever comes back to `args.customerId`.
     *
     * Until 2026-08-11 this call carried no `profileId`. With a single
     * customer that is invisible; with two, customer B's Instagram becomes
     * customer A's channel row and she posts to a stranger's account.
     *
     * Fails CLOSED when the customer has no profile yet — an empty channel
     * list is recoverable, inheriting the fleet's accounts is not.
     */
    const profileId = await ctx.runQuery(internal.maya.channels.profileIdFor, {
      customerId: args.customerId,
    });
    if (!profileId) return { ok: true, channels: [] };

    const { ZernioClient } = await import("../integrations/zernio/client");
    let raw: unknown;
    try {
      /**
       * ⚠️ The raw request, NOT the `listAccounts` helper, and deliberately.
       *
       * `AccountsListResponseSchema` declares `accounts: z.array(...).default([])`,
       * so ANY object without an `accounts` key parses successfully as zero
       * accounts. Routing through it turns a vendor contract change into
       * "nothing is connected" — and the loop below would then mark every one
       * of the founder's channels as gone. That is precisely what the strict
       * check further down exists to prevent, so this keeps its own parsing.
       */
      raw = await new ZernioClient({ apiKey }).request<unknown>(
        "/api/v1/accounts",
        { method: "GET", query: { profileId } },
      );
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

/* -------------------------------------------------------------------------- */
/* Noticing a new connection                                                   */
/* -------------------------------------------------------------------------- */

/**
 * ⭐ Sync every active customer's channels, and SAY SO when one is new.
 *
 * `syncChannels` has existed since Sprint 2 with **no caller**. The consequence
 * showed up live on 2026-08-05: the operator connected TikTok, Instagram and
 * YouTube, and nothing noticed — the `channels` table still held one row, the
 * scroll swept one channel, and a publish to Instagram would have been refused
 * with *"no instagram channel connected"*. It took a hand-run to fix.
 *
 * A founder who connects an account and hears nothing has no way to tell
 * whether it worked. §18.9.3's empty-state rule is about exactly this moment:
 * the point of maximum doubt is when they have done something and see no
 * response.
 *
 * ⚠️ The message fires ONLY for a channel that is newly connected. Announcing
 * the same three channels every hour is how a founder learns to ignore her.
 */
export const syncAllChannels = internalAction({
  args: { now: v.optional(v.number()) },
  handler: async (
    ctx,
    args,
  ): Promise<{ customers: number; announced: number }> => {
    const customerIds = await ctx.runQuery(
      internal.maya.scheduler.activeV2Customers,
      {},
    );
    let announced = 0;

    for (const customerId of customerIds) {
      const before = await ctx.runQuery(internal.maya.channels.forCustomer, {
        customerId,
      });
      const known = new Set<string>(
        before.filter((c) => c.status === "connected").map((c) => c.channel),
      );

      const result = await ctx.runAction(internal.maya.channels.syncChannels, {
        customerId,
      });
      if (!result.ok) continue;

      const fresh: string[] = result.channels
        .filter((c) => c.connected && !known.has(c.channel))
        .map((c) => c.channel);
      if (fresh.length === 0) continue;

      /**
       * The wording §17.35 already wrote: *"Instagram and YouTube are open now
       * — I'll start there tomorrow."* Not "channel sync complete".
       */
      const list =
        fresh.length === 1
          ? fresh[0]
          : `${fresh.slice(0, -1).join(", ")} and ${fresh[fresh.length - 1]}`;
      await ctx.runMutation(internal.maya.messages.send, {
        customerId,
        surface: "telegram",
        body: `${list} ${fresh.length === 1 ? "is" : "are"} connected now — I'll start including ${fresh.length === 1 ? "it" : "them"} tomorrow.`,
        // Keyed to the channels, so a re-sync never says it twice.
        dedupeKey: `channel-live:${fresh.sort().join(",")}`,
        proactive: true,
        ts: args.now,
      });
      announced += 1;
    }

    return { customers: customerIds.length, announced };
  },
});

/* -------------------------------------------------------------------------- */

/**
 * ⭐ Every channel, and what is actually true about it (§6.0.15 point 3).
 *
 * > *"**Mission Control never renders a connected-but-unpostable channel as
 * > simply 'connected'**. Instagram-must-be-Business is the load-bearing case:
 * > it connects cleanly and then never posts."*
 *
 * ⚠️ The shape is the enforcement. There is no `connected` boolean for a
 * surface to render on its own — a caller gets `state`, and
 * `connected_cant_post` is a value it must handle. A screen cannot accidentally
 * show "connected" for an account that can't publish, because that word is
 * never returned for one.
 *
 * All four channels are listed whether connected or not, each carrying the
 * notices §6.0.15 requires **before** the OAuth redirect. A card that hasn't
 * been connected yet still knows what to say.
 */
export type ChannelState =
  | "not_connected"
  | "connected"
  | "connected_cant_post"
  | "needs_attention";

export interface MyChannel {
  channel: Channel;
  state: ChannelState;
  handle?: string;
  /** Her words for what is wrong, when something is. Never a scope name. */
  reason?: string;
  /** Said BEFORE they connect — prevention beats diagnosis. */
  notices: string[];
  /** ⚠️ Permanent platform limits, not a problem with their setup. */
  permanentLimit?: string;
  lastCheckedAt?: number;
}

const ALL_CHANNELS: Channel[] = ["tiktok", "instagram", "youtube", "x"];

export const myChannels = query({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ ok: boolean; channels?: MyChannel[]; error?: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { ok: false, error: "sign in first" };

    const creator = (await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first()) as Doc<"creators"> | null;
    if (!creator) return { ok: false, error: "no account yet" };

    const customer = (await ctx.db
      .query("customers")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .first()) as Doc<"customers"> | null;
    if (!customer) return { ok: false, error: "no account yet" };

    const rows = (await ctx.db
      .query("channels")
      .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
      .collect()) as Doc<"channels">[];

    return {
      ok: true,
      channels: ALL_CHANNELS.map((channel) => {
        const row = rows.find((r) => r.channel === channel);
        const notices = noticesFor(channel);
        const permanentLimit = CHANNEL_REQUIREMENTS[channel].permanentLimit;

        if (!row) {
          return {
            channel,
            state: "not_connected" as const,
            notices,
            permanentLimit,
          };
        }

        /**
         * ⚠️ `status` is written by `upsertChannel` from `readAccount`, which
         * sets it false with a reason when the publish scope is missing. So a
         * row that exists but isn't `connected` is precisely the
         * connected-but-unpostable case §6.0.15 is about — and it is reported
         * as its own state rather than folded into "connected".
         */
        const state: ChannelState =
          row.status === "connected"
            ? "connected"
            : row.failureReason
              ? "connected_cant_post"
              : "needs_attention";

        return {
          channel,
          state,
          handle: row.handle,
          reason: row.failureReason,
          notices,
          permanentLimit,
          lastCheckedAt: row.lastCheckedAt,
        };
      }),
    };
  },
});
