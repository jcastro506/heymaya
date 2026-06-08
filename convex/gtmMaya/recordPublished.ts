/**
 * Sprint 2.27 — record published posts + schedule metric polling.
 *
 * Flow:
 *   1. Operator posts (e.g., replies on a calendar event "I posted!")
 *   2. Maya POSTs to /lc_gtm/record_published with the draftId +
 *      providerPostId + platform + permalink.
 *   3. recordDraftPublished patches gtmDraftedContent status →
 *      "published", fills providerPostId + publishedAt.
 *   4. Schedules pollAndRecordPostMetrics three times: T+2h, T+24h,
 *      T+7d (per maya-results-reviewer's review windows).
 *   5. Each poll fetches engagement metrics + writes a gtmPostResults
 *      row. The actual fetch goes through Composio (when OAuth is
 *      connected) or returns 0s with a "no_oauth" note (this v1
 *      stubs the fetch — Sprint 2.27b wires real Composio calls).
 *
 * Cross-tenant safety: the HTTP endpoint authenticates via hookToken
 * (auth.agentId + auth.accountId). The internal mutation re-verifies
 * draft.agentId === auth.agentId.
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

const PLATFORM = v.union(
  v.literal("reddit"),
  v.literal("x"),
  v.literal("hn"),
  v.literal("linkedin"),
  v.literal("instagram"),
  v.literal("tiktok"),
  v.literal("youtube")
);

const POLL_WINDOWS_MS = {
  T_PLUS_2H: 2 * 60 * 60 * 1000,
  T_PLUS_24H: 24 * 60 * 60 * 1000,
  T_PLUS_7D: 7 * 24 * 60 * 60 * 1000,
} as const;

/**
 * Internal mutation called from the HTTP handler. Patches the draft
 * to "published", then schedules the three polling windows.
 */
export const recordDraftPublished = internalMutation({
  args: {
    agentId: v.id("gtmAgents"),
    accountId: v.id("creators"),
    draftId: v.id("gtmDraftedContent"),
    providerPostId: v.string(),
    platform: PLATFORM,
    permalink: v.optional(v.string()),
    postedAtMs: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    draftId: Id<"gtmDraftedContent">;
    polledAt: { tPlus2h: number; tPlus24h: number; tPlus7d: number };
  }> => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft) {
      throw new Error("recordDraftPublished: draft not found");
    }
    if (
      draft.agentId !== args.agentId ||
      draft.accountId !== args.accountId
    ) {
      throw new Error(
        "recordDraftPublished: agent/account mismatch on draft"
      );
    }
    if (draft.platform !== args.platform) {
      throw new Error(
        `recordDraftPublished: platform mismatch — draft is ${draft.platform}, payload says ${args.platform}`
      );
    }

    const postedAtMs = args.postedAtMs ?? Date.now();
    await ctx.db.patch(args.draftId, {
      approvalState: "published",
      providerPostId: args.providerPostId,
      publishedAt: postedAtMs,
      updatedAt: Date.now(),
    });

    // Schedule the three polling windows. We use Convex's scheduler
    // (ctx.scheduler) so each window fires even if the gateway is
    // restarted. Each schedule call returns a job id we could store
    // for cancellation, but for v1 we let them fire-and-forget.
    const tPlus2h = postedAtMs + POLL_WINDOWS_MS.T_PLUS_2H;
    const tPlus24h = postedAtMs + POLL_WINDOWS_MS.T_PLUS_24H;
    const tPlus7d = postedAtMs + POLL_WINDOWS_MS.T_PLUS_7D;

    await ctx.scheduler.runAt(
      tPlus2h,
      internal.gtmMaya.recordPublished.pollAndRecordPostMetrics,
      {
        agentId: args.agentId,
        accountId: args.accountId,
        draftId: args.draftId,
        providerPostId: args.providerPostId,
        platform: args.platform,
        window: "t_plus_2h",
      }
    );
    await ctx.scheduler.runAt(
      tPlus24h,
      internal.gtmMaya.recordPublished.pollAndRecordPostMetrics,
      {
        agentId: args.agentId,
        accountId: args.accountId,
        draftId: args.draftId,
        providerPostId: args.providerPostId,
        platform: args.platform,
        window: "t_plus_24h",
      }
    );
    await ctx.scheduler.runAt(
      tPlus7d,
      internal.gtmMaya.recordPublished.pollAndRecordPostMetrics,
      {
        agentId: args.agentId,
        accountId: args.accountId,
        draftId: args.draftId,
        providerPostId: args.providerPostId,
        platform: args.platform,
        window: "t_plus_7d",
      }
    );

    return {
      draftId: args.draftId,
      polledAt: { tPlus2h, tPlus24h, tPlus7d },
    };
  },
});

/**
 * Internal action — invoked at each poll window by the scheduler.
 * Fetches metrics from Composio (when OAuth connected) or stubs
 * zeros for v1. Persists a gtmPostResults snapshot.
 *
 * Soft-fail per call: if fetch errors, persist a snapshot with empty
 * metrics + note so the review window isn't completely lost.
 */
/**
 * Sprint 2.27b — Reddit metric fetch via public JSON (no OAuth).
 *
 * Reddit exposes post metrics through the public `<post_url>/.json`
 * endpoint with no auth required. We use a polite UA string + 5s
 * timeout. Returns null if the post is deleted/private/rate-limited;
 * caller logs zeros + a note.
 *
 * `providerPostId` is expected to be either:
 *   - a full URL (https://reddit.com/r/sub/comments/abc/title)
 *   - a t3_<id> fullname (we'll reconstruct via search)
 */
export async function fetchRedditMetrics(
  providerPostIdOrUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ likes: number; comments: number; views: number } | null> {
  // Reddit's JSON endpoint accepts either the full thread URL with
  // .json or a t3_id via the listing route.
  let url: string;
  if (providerPostIdOrUrl.startsWith("http")) {
    url = providerPostIdOrUrl.replace(/\/?$/, "") + "/.json";
  } else {
    // t3_xxx → resolve via the by_id listing.
    url = `https://www.reddit.com/by_id/${providerPostIdOrUrl}/.json`;
  }
  try {
    const res = await fetchImpl(url, {
      headers: {
        "user-agent": "heymaya/maya-results-poller/0.1 (+https://heymaya.com)",
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as unknown;
    // Listing response → data.children[0].data carries the post.
    // by_id route also returns a listing.
    let post: { ups?: number; num_comments?: number; view_count?: number } | undefined;
    if (
      typeof json === "object" &&
      json !== null &&
      "data" in (json as object)
    ) {
      const data = (json as { data?: { children?: Array<{ data?: object }> } })
        .data;
      const first = data?.children?.[0]?.data;
      if (first) post = first as typeof post;
    } else if (Array.isArray(json)) {
      // Single-thread URL returns [postListing, commentsListing].
      const listing = json[0] as
        | { data?: { children?: Array<{ data?: object }> } }
        | undefined;
      const first = listing?.data?.children?.[0]?.data;
      if (first) post = first as typeof post;
    }
    if (!post) return null;
    return {
      likes: typeof post.ups === "number" ? post.ups : 0,
      comments: typeof post.num_comments === "number" ? post.num_comments : 0,
      views: typeof post.view_count === "number" ? post.view_count : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Sprint 2.27b — HN metric fetch via Algolia HN API (no OAuth).
 *
 * `providerPostId` expected to be the HN numeric item id (as a string).
 */
export async function fetchHnMetrics(
  providerPostId: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ likes: number; comments: number; views: number } | null> {
  const url = `https://hn.algolia.com/api/v1/items/${providerPostId}`;
  try {
    const res = await fetchImpl(url, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const item = (await res.json()) as {
      points?: number;
      children?: Array<{ id: number }>;
    };
    // Algolia returns the whole comment tree under children; the count
    // is the recursive descendant total.
    const countComments = (node: { children?: Array<{ id: number }> }): number => {
      if (!node.children) return 0;
      let total = node.children.length;
      for (const c of node.children) {
        total += countComments(c as { children?: Array<{ id: number }> });
      }
      return total;
    };
    return {
      likes: typeof item.points === "number" ? item.points : 0,
      comments: countComments(item),
      views: 0, // HN doesn't expose views.
    };
  } catch {
    return null;
  }
}

export const pollAndRecordPostMetrics = internalAction({
  args: {
    agentId: v.id("gtmAgents"),
    accountId: v.id("creators"),
    draftId: v.id("gtmDraftedContent"),
    providerPostId: v.string(),
    platform: PLATFORM,
    window: v.union(
      v.literal("t_plus_2h"),
      v.literal("t_plus_24h"),
      v.literal("t_plus_7d")
    ),
  },
  handler: async (ctx, args): Promise<{ snapshotId: Id<"gtmPostResults"> }> => {
    // Sprint 2.27b — real metric fetch for Reddit + HN (no OAuth path).
    // Other platforms still return zeros + "needs_oauth" note until
    // Composio social OAuth wiring lands (Sprint 2.27c).
    let metrics = { likes: 0, comments: 0, shares: 0, views: 0 };
    let notes: string;

    if (args.platform === "reddit") {
      const fetched = await fetchRedditMetrics(args.providerPostId);
      if (fetched) {
        metrics = { ...metrics, ...fetched };
        notes = `auto_poll:${args.window} via reddit_public_json`;
      } else {
        notes = `auto_poll:${args.window} — reddit fetch failed (deleted/private/rate-limited)`;
      }
    } else if (args.platform === "hn") {
      const fetched = await fetchHnMetrics(args.providerPostId);
      if (fetched) {
        metrics = { ...metrics, ...fetched };
        notes = `auto_poll:${args.window} via algolia_hn`;
      } else {
        notes = `auto_poll:${args.window} — hn fetch failed`;
      }
    } else {
      notes = `auto_poll:${args.window} — needs_oauth (Composio Sprint 2.27c)`;
    }

    const snapshotId = await ctx.runMutation(
      internal.gtmMaya.postResults.recordPostResultSnapshot,
      {
        agentId: args.agentId,
        accountId: args.accountId,
        draftId: args.draftId,
        platform: args.platform,
        providerPostId: args.providerPostId,
        metrics,
        notes,
      }
    );
    return { snapshotId };
  },
});

/**
 * Internal query — read recent published drafts for an agent.
 * Used by maya-results-reviewer + tests.
 */
export const listMyPublishedDrafts = internalQuery({
  args: {
    agentId: v.id("gtmAgents"),
    sinceMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("gtmDraftedContent")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .collect();
    const since = args.sinceMs ?? 0;
    return all
      .filter(
        (d) =>
          d.approvalState === "published" && (d.publishedAt ?? 0) >= since
      )
      .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
  },
});
