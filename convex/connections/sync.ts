/**
 * Connected numbers, the network half (plan Sprint 4e). Ingestion is code (law 3): she
 * never touches Zernio; rows do.
 *
 *   bootstrap — once per connection: ninety days from `/v1/analytics`, paged (page AND limit,
 *               or the API answers 400), joined to `ownPosts`, written as `connected`.
 *   delta     — hourly, fleet-wide: `/v1/analytics/delta?cursor=` returns only what changed
 *               across every account we can read (their figure: 1,599 calls/h → 205). The
 *               cursor lives in `syncState`; the first call with no cursor returns an empty
 *               page plus the feed's position.
 *   followers — daily, into `followerSnapshots` (needs their analytics add-on).
 *
 * Connected wins over public and is labelled; `reachMultiple` is written where reach exists.
 * A failure is a `vendorHealth` row, never a silence.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { zernioClient } from "../integrations/zernio/index";
import { normalizeConnected, postIdFromUrl, type Connected, type ZernioPostRow } from "./analytics";

const PAGE = 100;
const BOOTSTRAP_DAYS = 90;

function client() {
  return zernioClient(process.env.ZERNIO_API_KEY ?? "");
}

/** Pure: which own-post row a connected row belongs to. Native id first, then the platform URL. */
export function matchOwnPost<T extends { platform: string; postId: string; url: string }>(rows: T[], c: Connected): T | null {
  const sameUrl = (a: string, b: string) => a.replace(/\?.*$/, "").replace(/\/$/, "").toLowerCase() === b.replace(/\?.*$/, "").replace(/\/$/, "").toLowerCase();
  return (
    rows.find((r) => r.platform === c.platform && c.postId && r.postId === c.postId) ??
    rows.find((r) => r.platform === c.platform && c.url && sameUrl(r.url, c.url)) ??
    rows.find((r) => r.platform === c.platform && c.postId && postIdFromUrl(r.url) === c.postId) ??
    null
  );
}

/** Pure: their normal reach, the median over posts that have one. */
export function normalReach(rows: Array<{ connected?: { reach: number | null } | null }>): number | null {
  const xs = rows.map((r) => r.connected?.reach ?? null).filter((x): x is number => x !== null && x > 0).sort((a, b) => a - b);
  return xs.length >= 3 ? xs[Math.floor(xs.length / 2)] : null;
}

export const ownPostsFor = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<Doc<"ownPosts">[]> =>
    (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(200)) as Doc<"ownPosts">[],
});

/**
 * Write one connected row onto its own-post, or create the own-post when scraping never saw
 * it (an account that only exists connected). Connected counters also refresh the public
 * `metrics` when they are newer, because the owner's number is the true one.
 */
export const upsert = internalMutation({
  args: { creatorId: v.id("creators"), connected: v.any(), caption: v.optional(v.string()) },
  handler: async (ctx, a): Promise<{ ownPostId: Id<"ownPosts">; created: boolean }> => {
    const c = a.connected as Connected;
    const rows = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(200)) as Doc<"ownPosts">[];
    const match = matchOwnPost(rows, c);
    const normal = normalReach(rows.filter((r) => r._id !== match?._id));
    const reachMultiple = c.reach !== null && normal ? Math.round((c.reach / normal) * 100) / 100 : undefined;
    const connected = { asOf: c.asOf, syncStatus: c.syncStatus, views: c.views, likes: c.likes, comments: c.comments, shares: c.shares, saves: c.saves, impressions: c.impressions, reach: c.reach, clicks: c.clicks, follows: c.follows, avgWatchMs: c.avgWatchMs, totalWatchMs: c.totalWatchMs, skipRatePct: c.skipRatePct, durationSec: c.durationSec };
    const now = Date.now();
    if (match) {
      const newer = c.asOf !== null && c.asOf >= match.metricsAsOf;
      await ctx.db.patch(match._id, {
        connected,
        ...(reachMultiple !== undefined ? { reachMultiple } : {}),
        ...(newer && c.views !== null ? { metrics: { ...match.metrics, views: c.views, likes: c.likes ?? match.metrics.likes, comments: c.comments ?? match.metrics.comments, shares: c.shares ?? match.metrics.shares, saves: c.saves ?? match.metrics.saves }, metricsAsOf: c.asOf ?? now, source: "zernio" as const } : {}),
      });
      return { ownPostId: match._id, created: false };
    }
    if (!c.postId || !c.url) throw new Error("connected row has no native id or url; cannot create an own-post");
    const caption = (a.caption ?? "").slice(0, 2000);
    const id = await ctx.db.insert("ownPosts", {
      creatorId: a.creatorId,
      platform: c.platform,
      postId: c.postId,
      url: c.url,
      createTime: c.publishedAt ?? now,
      contentType: c.durationSec ? "video" : "video",
      caption,
      hashtags: Array.from(caption.matchAll(/#([\p{L}\p{N}_]+)/gu)).map((m) => m[1].toLowerCase()).slice(0, 20),
      metrics: { views: c.views ?? 0, likes: c.likes ?? 0, comments: c.comments ?? 0, shares: c.shares ?? 0, saves: c.saves ?? undefined },
      metricsAsOf: c.asOf ?? now,
      source: "zernio",
      connected,
      ...(reachMultiple !== undefined ? { reachMultiple } : {}),
    });
    return { ownPostId: id, created: true };
  },
});

async function pullAccount(creatorId: Id<"creators">, accountId: string, run: (rows: ZernioPostRow[]) => Promise<void>): Promise<number> {
  const c = client();
  const fromDate = new Date(Date.now() - BOOTSTRAP_DAYS * 86_400_000).toISOString().slice(0, 10);
  let page = 1, total = 0;
  for (;;) {
    const res = await c.request<{ posts?: ZernioPostRow[]; pagination?: { pages?: number } }>("/api/v1/analytics", { query: { accountId, fromDate, page, limit: PAGE } });
    const posts = res.posts ?? [];
    await run(posts);
    total += posts.length;
    if (posts.length < PAGE || page >= (res.pagination?.pages ?? 1)) break;
    page++;
  }
  return total;
}

/** Once per connection (and on demand): ninety days of every connected account. */
export const bootstrap = internalAction({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ accounts: number; rows: number; written: number; created: number; detail?: string }> => {
    const conn = await ctx.runQuery(internal.connections.zernio.connection, { creatorId: a.creatorId });
    const accounts = (conn?.zernioAccounts ?? []).filter((x) => x.canFetchAnalytics && !x.needsReconnect);
    if (!conn?.zernioProfileId || accounts.length === 0) return { accounts: 0, rows: 0, written: 0, created: 0, detail: "no connected account with analytics access" };
    let rows = 0, written = 0, created = 0;
    try {
      for (const acc of accounts) {
        rows += await pullAccount(a.creatorId, acc.accountId, async (posts) => {
          for (const p of posts) {
            const c = normalizeConnected(p);
            if (!c) continue;
            const r = await ctx.runMutation(internal.connections.sync.upsert, { creatorId: a.creatorId, connected: c, caption: p.content ?? "" });
            written++;
            if (r.created) created++;
          }
        });
      }
      await ctx.runMutation(internal.connections.zernio.recordHealth, { check: "bootstrap", ok: true, detail: `${written} rows across ${accounts.length} accounts` });
      return { accounts: accounts.length, rows, written, created };
    } catch (e) {
      const detail = e instanceof Error ? e.message.slice(0, 200) : "bootstrap failed";
      await ctx.runMutation(internal.connections.zernio.recordHealth, { check: "bootstrap", ok: false, detail });
      return { accounts: accounts.length, rows, written, created, detail };
    }
  },
});

// ------------------------------------------------------------------ the delta

export const cursor = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, a): Promise<string | null> => ((await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", a.key)).first()) as Doc<"syncState"> | null)?.value ?? null,
});

export const setCursor = internalMutation({
  args: { key: v.string(), value: v.string() },
  handler: async (ctx, a): Promise<null> => {
    const row = (await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", a.key)).first()) as Doc<"syncState"> | null;
    if (row) await ctx.db.patch(row._id, { value: a.value, updatedAt: Date.now() });
    else await ctx.db.insert("syncState", { key: a.key, value: a.value, updatedAt: Date.now() });
    return null;
  },
});

/** Which creator owns a Zernio account id. */
export const creatorForAccount = internalQuery({
  args: { accountId: v.string() },
  handler: async (ctx, a): Promise<Id<"creators"> | null> => {
    const conns = (await ctx.db.query("connections").take(1000)) as Doc<"connections">[];
    return conns.find((c) => c.provider === "zernio" && (c.zernioAccounts ?? []).some((x) => x.accountId === a.accountId))?.creatorId ?? null;
  },
});

/**
 * Fleet-wide: everything that changed since the cursor, in one stream. The first call
 * (no cursor) is a bootstrap of the feed's position and writes nothing.
 */
export const delta = internalAction({
  args: {},
  handler: async (ctx): Promise<{ pages: number; rows: number; written: number; skipped: number }> => {
    const c = client();
    let cur = await ctx.runQuery(internal.connections.sync.cursor, { key: "zernio:analytics:delta" });
    let pages = 0, rows = 0, written = 0, skipped = 0;
    try {
      for (;;) {
        const res = await c.request<{ data?: Array<Record<string, unknown>>; nextCursor?: string; hasMore?: boolean }>("/api/v1/analytics/delta", { query: cur ? { cursor: cur } : {} });
        pages++;
        for (const item of res.data ?? []) {
          rows++;
          // A delta item is a post row (per the spec); anything else is logged, not guessed at.
          const row = (item.post ?? item) as ZernioPostRow;
          const conn = normalizeConnected(row);
          const accountId = String((row.platforms?.[0]?.accountId ?? (item as { accountId?: string }).accountId) ?? "");
          const creatorId = accountId ? await ctx.runQuery(internal.connections.sync.creatorForAccount, { accountId }) : null;
          if (!conn || !creatorId) { skipped++; continue; }
          await ctx.runMutation(internal.connections.sync.upsert, { creatorId, connected: conn, caption: row.content ?? "" });
          written++;
        }
        if (res.nextCursor) { cur = res.nextCursor; await ctx.runMutation(internal.connections.sync.setCursor, { key: "zernio:analytics:delta", value: res.nextCursor }); }
        if (!res.hasMore || !res.nextCursor) break;
        if (pages >= 20) break; // a bound, never a loop
      }
      await ctx.runMutation(internal.connections.zernio.recordHealth, { check: "delta", ok: true, detail: `${written} written, ${skipped} skipped over ${pages} pages` });
    } catch (e) {
      await ctx.runMutation(internal.connections.zernio.recordHealth, { check: "delta", ok: false, detail: e instanceof Error ? e.message.slice(0, 200) : "delta failed" });
    }
    return { pages, rows, written, skipped };
  },
});

// -------------------------------------------------------------- followers

export const writeSnapshot = internalMutation({
  args: { creatorId: v.id("creators"), platform: v.string(), accountId: v.string(), day: v.string(), followers: v.number() },
  handler: async (ctx, a): Promise<null> => {
    const existing = ((await ctx.db.query("followerSnapshots").withIndex("by_creator_day", (q) => q.eq("creatorId", a.creatorId).eq("day", a.day)).collect()) as Doc<"followerSnapshots">[]).find((r) => r.accountId === a.accountId);
    if (existing) await ctx.db.patch(existing._id, { followers: a.followers, at: Date.now() });
    else await ctx.db.insert("followerSnapshots", { creatorId: a.creatorId, platform: a.platform, accountId: a.accountId, day: a.day, followers: a.followers, at: Date.now() });
    return null;
  },
});

export const connectedCreators = internalQuery({
  args: {},
  handler: async (ctx): Promise<Array<{ creatorId: Id<"creators">; accounts: Array<{ accountId: string; platform: string }> }>> =>
    ((await ctx.db.query("connections").take(1000)) as Doc<"connections">[])
      .filter((c) => c.provider === "zernio" && c.status === "connected")
      .map((c) => ({ creatorId: c.creatorId, accounts: (c.zernioAccounts ?? []).filter((x) => x.canFetchAnalytics).map((x) => ({ accountId: x.accountId, platform: x.platform })) })),
});

/** Daily: today's follower count per connected account. */
export const followers = internalAction({
  args: {},
  handler: async (ctx): Promise<{ creators: number; snapshots: number }> => {
    const c = client();
    const all = await ctx.runQuery(internal.connections.sync.connectedCreators, {});
    const day = new Date().toISOString().slice(0, 10);
    let snapshots = 0;
    for (const cr of all) {
      if (cr.accounts.length === 0) continue;
      try {
        const res = await c.request<{ accounts?: Array<{ _id?: string; platform?: string; currentFollowers?: number }> }>("/api/v1/accounts/follower-stats", { query: { accountIds: cr.accounts.map((x) => x.accountId).join(",") } });
        for (const acc of res.accounts ?? []) {
          if (!acc._id || typeof acc.currentFollowers !== "number") continue;
          await ctx.runMutation(internal.connections.sync.writeSnapshot, { creatorId: cr.creatorId, platform: String(acc.platform ?? ""), accountId: acc._id, day, followers: acc.currentFollowers });
          snapshots++;
        }
      } catch (e) {
        await ctx.runMutation(internal.connections.zernio.recordHealth, { check: "followers", ok: false, detail: e instanceof Error ? e.message.slice(0, 200) : "followers failed" });
      }
    }
    return { creators: all.length, snapshots };
  },
});
