/**
 * ⭐ People talking to her — the other half of the product.
 *
 * > *"She runs one business's social accounts — watches the niche, makes the
 * > content, posts it, **and answers everyone who replies**."*
 *
 * The `reply` tool has existed since Sprint 3. It refuses without an
 * `inReplyTo` and tells her *"a reply needs the thing it's replying to — find
 * it and call again."* **There was nothing to find it with.** The Zernio inbox
 * wrappers were verified live on 2026-08-01 — pagination bug and all —  and no
 * product code ever called them.
 *
 * So she could answer, and could not discover anything to answer. Half the
 * promise, with no input.
 *
 * ## Rows, not a live fetch
 *
 * §13.4 puts *"whether I already replied to someone"* squarely in the rows
 * column. A model deciding that from a context window will eventually answer
 * the same person twice, which is the fastest way to look like a bot. So every
 * item is a row, deduped on the platform's own id, and answering one writes the
 * placement that answered it.
 *
 * ## ⚠️ What this genuinely cannot see
 *
 * **TikTok exposes no comment API at all** (CLAUDE.md, and §5 says the same).
 * Not a gap in this module — there is no endpoint. TikTok is publish-only, so
 * a TikTok item will never appear here, and she must never imply she's
 * watching TikTok replies.
 *
 * **Zernio's comment shape carries no author.** `InboxComment` is
 * `{id, platform, accountId, accountUsername, content, permalink, createdTime,
 * commentCount, likeCount, cid}` — `accountUsername` is *ours*, not theirs.
 * So `authorHandle` is usually absent, and anything wanting "who said this"
 * has to get it from the permalink or go without. Recorded as a known gap
 * rather than invented.
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";

/** §5.2 — the own-account sweep runs three times a day. */
export const SYNC_PAGE_LIMIT = 50;

/** How far back a sync looks on a cold start. */
export const LOOKBACK_MS = 7 * 86_400_000;

/**
 * Pages to walk in one sync.
 *
 * A cap, because "answer everyone" against an unbounded inbox is how a sync
 * job becomes a runaway bill. When it's hit the caller is TOLD — a silent stop
 * at page 10 reports "all clear" while page 11 has someone asking to buy.
 */
export const MAX_PAGES = 10;

export const record = internalMutation({
  args: {
    customerId: v.id("customers"),
    externalId: v.string(),
    channel: v.string(),
    authorHandle: v.optional(v.string()),
    text: v.string(),
    permalink: v.optional(v.string()),
    postedAt: v.number(),
    now: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ itemId: Id<"inboxItems">; isNew: boolean }> => {
    const now = args.now ?? Date.now();
    const existing = (await ctx.db
      .query("inboxItems")
      .withIndex("by_customer_and_external", (q) =>
        q.eq("customerId", args.customerId).eq("externalId", args.externalId)
      )
      .first()) as Doc<"inboxItems"> | null;

    /**
     * Seeing it again is not new. Crucially this does NOT reopen an answered
     * item — a sync that resurrected everything it re-fetched would have her
     * answering the same comment every eight hours, forever.
     */
    if (existing) return { itemId: existing._id, isNew: false };

    const itemId = await ctx.db.insert("inboxItems", {
      customerId: args.customerId,
      externalId: args.externalId,
      channel: args.channel,
      authorHandle: args.authorHandle,
      text: args.text,
      permalink: args.permalink,
      postedAt: args.postedAt,
      firstSeenAt: now,
      status: "open",
    });
    return { itemId, isNew: true };
  },
});

/**
 * ⭐ Everything still waiting on her, oldest first.
 *
 * Oldest first on purpose: someone who asked yesterday has been waiting
 * longest, and a newest-first inbox quietly abandons the tail every time
 * volume rises.
 */
export const open = internalQuery({
  args: { customerId: v.id("customers"), limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<Doc<"inboxItems">[]> => {
    const items = (await ctx.db
      .query("inboxItems")
      .withIndex("by_customer_and_status", (q) =>
        q.eq("customerId", args.customerId).eq("status", "open")
      )
      .collect()) as Doc<"inboxItems">[];
    return items
      .sort((a, b) => a.postedAt - b.postedAt)
      .slice(0, args.limit ?? 20);
  },
});

/**
 * Close an item — answered, or deliberately not.
 *
 * `skipped` requires a reason. "Nothing happened" and "I decided this one
 * didn't need a reply" look identical in a table otherwise, and only one of
 * them is a working product.
 */
export const resolve = internalMutation({
  args: {
    itemId: v.id("inboxItems"),
    status: v.union(v.literal("answered"), v.literal("skipped")),
    placementId: v.optional(v.id("placements")),
    skipReason: v.optional(v.string()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ ok: boolean; why?: string }> => {
    const item = (await ctx.db.get(args.itemId)) as Doc<"inboxItems"> | null;
    if (!item) return { ok: false, why: "no such item" };
    if (args.status === "skipped" && !args.skipReason) {
      return { ok: false, why: "a skip needs a reason" };
    }
    await ctx.db.patch(args.itemId, {
      status: args.status,
      answeredWithPlacementId: args.placementId,
      skipReason: args.skipReason,
      resolvedAt: args.now ?? Date.now(),
    });
    return { ok: true };
  },
});


/**
 * ⭐ X mentions — the channel Zernio's inbox can't fully carry, read directly.
 *
 * All five twitterapi.io wrappers had zero callers. Two of them say what they
 * are for in their own doc comments — *"half of 'answer everyone' on X"* and
 * *"the other half"* — and X is both the launch channel (§18 Sprint 3, "the
 * gamble") and, today, the only one connected.
 *
 * Shape VERIFIED LIVE 2026-08-05 against a busy account, because the account
 * under test has no mentions yet and an empty array teaches nothing:
 *
 *   { id, text, createdAt, author: { userName }, url, isReply, ... }
 *
 * ⚠️ `createdAt` is Twitter's legacy format — `"Wed Aug 05 19:56:13 +0000
 * 2026"`, not ISO. `Date.parse` handles it exactly (checked against a
 * hand-built UTC timestamp), but it is not interchangeable with Instagram's
 * ISO strings or TikTok's unix seconds, and assuming otherwise is the bug that
 * once made every post fifty years old.
 *
 * ⭐ Unlike Zernio's comment shape, this one carries the AUTHOR — which is the
 * only reason her own tweets can be filtered out. A mentions feed includes
 * replies she wrote in the same thread, and answering herself is the most
 * visible way to look broken.
 */
async function readXMentions(
  handle: string,
  since: number,
  now: number
): Promise<
  Array<{
    externalId: string;
    text: string;
    permalink?: string;
    postedAt: number;
    authorHandle?: string;
  }>
> {
  const { getMentions } = await import("../integrations/twitterApiIo/endpoints");
  const page = await getMentions(handle);
  const out: Array<{
    externalId: string;
    text: string;
    permalink?: string;
    postedAt: number;
    authorHandle?: string;
  }> = [];

  const ours = handle.toLowerCase().replace(/^@/, "");
  for (const raw of page.items) {
    const tweet = raw as {
      id?: string;
      text?: string;
      createdAt?: string;
      url?: string;
      author?: { userName?: string };
    };
    if (!tweet.id || !tweet.text) continue;

    const author = tweet.author?.userName?.toLowerCase();
    // Never answer yourself. A mentions feed includes her own replies in the
    // thread, and X is the one channel that tells us who wrote it.
    if (author && author === ours) continue;

    const postedAt = tweet.createdAt ? Date.parse(tweet.createdAt) : NaN;
    if (!Number.isFinite(postedAt) || postedAt < since) continue;

    out.push({
      externalId: `x:${tweet.id}`,
      text: tweet.text,
      permalink: tweet.url,
      postedAt,
      authorHandle: tweet.author?.userName,
    });
  }
  return out;
}

export interface SyncResult {
  ok: boolean;
  fetched: number;
  added: number;
  /** ⚠️ Accounts Zernio could not read. Never silently dropped. */
  unreadableAccounts: string[];
  /** True when MAX_PAGES stopped the walk before the inbox ran out. */
  truncated: boolean;
  detail: string;
}

/**
 * ⭐ Pull what people have said, and be honest about what we couldn't see.
 *
 * Two failure modes the vendor layer already learned the hard way, both of
 * which this function is required to surface rather than swallow:
 *
 * 1. **`nextCursor` is nested in `pagination`.** Reading it at the root always
 *    yielded `undefined`, so paging never advanced and only page one was ever
 *    seen — *"the difference between answering everyone and answering whoever
 *    happens to be on page one."*
 * 2. **`meta.failedAccounts` reports PARTIAL FAILURE.** A live call returned
 *    `accountsQueried: 2, accountsFailed: 1`. Reading half the inbox and
 *    reporting all-clear is the exact failure class this product exists to
 *    eliminate.
 */
export const sync = internalAction({
  args: {
    customerId: v.id("customers"),
    since: v.optional(v.number()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<SyncResult> => {
    const now = args.now ?? Date.now();
    const since = args.since ?? now - LOOKBACK_MS;

    const apiKey = process.env.ZERNIO_API_KEY;
    if (!apiKey) {
      return {
        ok: false,
        fetched: 0,
        added: 0,
        unreadableAccounts: [],
        truncated: false,
        detail: "the accounts aren't connected yet",
      };
    }

    const { ZernioClient } = await import("../integrations/zernio/client");
    const { listInboxComments } = await import(
      "../integrations/zernio/endpoints"
    );
    const client = new ZernioClient({ apiKey });

    let cursor: string | null = null;
    let pages = 0;
    let fetched = 0;
    let added = 0;
    const unreadable = new Set<string>();

    try {
      do {
        const page = await listInboxComments(client, {
          since: new Date(since).toISOString(),
          limit: SYNC_PAGE_LIMIT,
          cursor: cursor ?? undefined,
        });

        for (const account of page.failedAccounts) {
          unreadable.add(
            account.accountUsername ?? account.accountId ?? "an account"
          );
        }

        /**
         * ⭐ ZERO ACCOUNTS QUERIED IS NOT AN EMPTY INBOX.
         *
         * Live 2026-08-05: `/inbox/comments` returned `accountsQueried: 0`
         * against one healthy connected X account, while
         * `/inbox/conversations` returned `1` on the same pass. So this sync
         * reported "0 new" — which read as "nobody replied" when the truth
         * was "I didn't look at anything".
         *
         * For a product whose job is *answer everyone*, those two must never
         * be the same output.
         */
        if (page.accountsQueried === 0) {
          unreadable.add("comments on your posts");
        }

        for (const comment of page.items) {
          /**
           * ⭐ THESE ARE OUR OWN POSTS, NOT COMMENTS.
           *
           * Discovered by reading a live response on 2026-08-05 rather than
           * the endpoint's name. `/inbox/comments` returns the WORK QUEUE —
           * posts of ours that may have comments — exactly as §2.15.2
           * describes it: *"list commented posts — which of our posts have
           * unanswered comments"*. A YouTube row came back as:
           *
           *   { id: "GtO7pd2o5BM", content: "Sensocore release 2",
           *     accountUsername: "joshuacastro7418", commentCount: 0 }
           *
           * `content` is the VIDEO TITLE. `accountUsername` is OURS. Recording
           * it as something to answer would have had her replying to the
           * founder's own posts — the same "answering yourself" failure the X
           * path guards against, arriving through the other vendor.
           *
           * `commentCount === 0` means nobody has said anything, so there is
           * nothing to answer and the row is skipped. A row WITH comments is a
           * real signal, but it still isn't the comment text — fetching that
           * needs a per-platform call (`igListComments` and its siblings) that
           * isn't wrapped yet. Until it is, this endpoint contributes the
           * queue and never the content. See §2.15.1.
           */
          const commentCount =
            typeof comment.commentCount === "number" ? comment.commentCount : 0;
          if (commentCount === 0) continue;

          const text = (comment.content ?? "").trim();
          // An empty comment is a like or a sticker with no words in it.
          // There is nothing to answer, and recording it would pad the inbox
          // with items she can only ever skip.
          if (!text) continue;

          fetched += 1;
          const postedAt = comment.createdTime
            ? Date.parse(comment.createdTime)
            : now;
          const result = await ctx.runMutation(internal.maya.inbox.record, {
            customerId: args.customerId,
            externalId: comment.id,
            channel: comment.platform ?? "unknown",
            text,
            permalink: comment.permalink ?? undefined,
            // Guard the parse: an unparseable date became NaN, which sorts
            // unpredictably and would scramble the oldest-first ordering.
            postedAt: Number.isFinite(postedAt) ? postedAt : now,
            now,
          });
          if (result.isNew) added += 1;
        }

        cursor = page.hasMore ? page.nextCursor : null;
        pages += 1;
      } while (cursor && pages < MAX_PAGES);
    } catch (error) {
      // Plain language out, diagnosis to the log — the guard in `messages.send`
      // is a backstop, not an excuse to hand a vendor error to a founder.
      console.error(
        `[inbox] sync failed for ${args.customerId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return {
        ok: false,
        fetched,
        added,
        unreadableAccounts: [...unreadable],
        truncated: false,
        detail: "I couldn't read the replies just now",
      };
    }

    /**
     * ⭐ Then X, directly.
     *
     * Additive, not a replacement: Zernio's inbox covers comments on connected
     * accounts, and this covers mentions — someone talking ABOUT the product
     * without commenting on a post is invisible to the first and obvious to
     * the second. Deduped on `x:<id>`, so overlap costs nothing.
     *
     * Isolated in its own try: a twitterapi.io outage must not discard the
     * Zernio items already recorded above.
     */
    try {
      const channels = await ctx.runQuery(internal.maya.channels.forCustomer, {
        customerId: args.customerId,
      });
      const x = channels.find(
        (c) => c.channel === "x" && c.status === "connected" && c.handle
      );
      if (x?.handle && process.env.TWITTERAPI_IO_KEY) {
        for (const mention of await readXMentions(x.handle, since, now)) {
          fetched += 1;
          const result = await ctx.runMutation(internal.maya.inbox.record, {
            customerId: args.customerId,
            externalId: mention.externalId,
            channel: "x",
            authorHandle: mention.authorHandle,
            text: mention.text,
            permalink: mention.permalink,
            postedAt: mention.postedAt,
            now,
          });
          if (result.isNew) added += 1;
        }
      }
    } catch (error) {
      console.error(
        `[inbox] X mentions failed for ${args.customerId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      unreadable.add("X mentions");
    }

    const truncated = Boolean(cursor);
    const parts = [`${added} new`];
    if (unreadable.size > 0) {
      parts.push(`couldn't read ${[...unreadable].join(", ")}`);
    }
    if (truncated) parts.push("more still waiting");

    return {
      ok: true,
      fetched,
      added,
      unreadableAccounts: [...unreadable],
      truncated,
      detail: parts.join(" — "),
    };
  },
});
