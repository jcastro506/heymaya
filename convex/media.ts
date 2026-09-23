/**
 * Post covers and account avatars, mirrored once (app spec §M1 additions). Her readers
 * already receive `thumbnailUrl` / `avatarUrl` and used to drop them; now they `remember`
 * them, `mirror` fetches each image once into storage, and the app reads a stable URL.
 * Covers never change and are never refetched. Only the platforms' own image CDNs are
 * fetched: the URLs come from scraped data, and an open fetch would be an SSRF door.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";

export type MediaKind = "cover" | "avatar";
export interface MediaItem { platform: string; kind: MediaKind; key: string; url: string }

/** The key a cover is stored under: the id in the post's URL, so every surface agrees. Pure. */
export function coverKey(platform: string, url?: string | null, postId?: string | null): string | null {
  if (url) {
    const tt = url.match(/tiktok\.com\/@[^/]+\/(?:video|photo)\/(\d+)/);
    if (tt) return tt[1];
    const ig = url.match(/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
    if (ig) return ig[1];
  }
  return postId ? String(postId) : null;
}

export function avatarKey(handle: string): string {
  return handle.trim().replace(/^@/, "").toLowerCase();
}

/** Only the platforms' image CDNs, over https. Pure. */
export function fetchable(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const h = u.hostname.toLowerCase();
    return [/\.tiktokcdn(-[a-z]+)?\.com$/, /\.tiktokcdn\.us$/, /\.ibyteimg\.com$/, /\.muscdn\.com$/, /\.cdninstagram\.com$/, /\.fbcdn\.net$/].some((re) => re.test(h));
  } catch {
    return false;
  }
}

/** Record images worth keeping; new ones are fetched in the background. Callable inside any mutation. */
export async function rememberMedia(ctx: MutationCtx, items: MediaItem[]): Promise<number> {
  const fresh: Id<"media">[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    if (!it.key || !it.url || !fetchable(it.url)) continue;
    const id = `${it.platform}:${it.kind}:${it.key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const existing = await ctx.db.query("media").withIndex("by_key", (q) => q.eq("platform", it.platform).eq("kind", it.kind).eq("key", it.key)).first();
    if (existing && (existing.state !== "failed" || existing.attempts >= 3)) continue;
    if (existing) {
      await ctx.db.patch(existing._id, { sourceUrl: it.url, state: "pending", at: Date.now() });
      fresh.push(existing._id);
    } else {
      fresh.push(await ctx.db.insert("media", { platform: it.platform, kind: it.kind, key: it.key, sourceUrl: it.url, state: "pending", attempts: 0, at: Date.now() }));
    }
  }
  for (let i = 0; i < fresh.length; i += 20) await ctx.scheduler.runAfter(0, internal.media.mirror, { ids: fresh.slice(i, i + 20) });
  return fresh.length;
}

export const remember = internalMutation({
  args: { items: v.array(v.object({ platform: v.string(), kind: v.union(v.literal("cover"), v.literal("avatar")), key: v.string(), url: v.string() })) },
  handler: async (ctx, a): Promise<number> => await rememberMedia(ctx, a.items),
});

export const pending = internalQuery({
  args: { ids: v.array(v.id("media")) },
  handler: async (ctx, a): Promise<Array<Pick<Doc<"media">, "_id" | "sourceUrl" | "state">>> => {
    const rows: Array<Pick<Doc<"media">, "_id" | "sourceUrl" | "state">> = [];
    for (const id of a.ids) {
      const r = (await ctx.db.get(id)) as Doc<"media"> | null;
      if (r && r.state === "pending") rows.push({ _id: r._id, sourceUrl: r.sourceUrl, state: r.state });
    }
    return rows;
  },
});

export const settle = internalMutation({
  args: { id: v.id("media"), storageId: v.optional(v.id("_storage")) },
  handler: async (ctx, a): Promise<null> => {
    const r = (await ctx.db.get(a.id)) as Doc<"media"> | null;
    if (!r) return null;
    await ctx.db.patch(a.id, a.storageId ? { state: "stored", storageId: a.storageId, at: Date.now() } : { state: "failed", attempts: r.attempts + 1, at: Date.now() });
    return null;
  },
});

const MAX_BYTES = 3 * 1024 * 1024;

export const mirror = internalAction({
  args: { ids: v.array(v.id("media")) },
  handler: async (ctx, a): Promise<{ stored: number; failed: number }> => {
    const rows = await ctx.runQuery(internal.media.pending, { ids: a.ids });
    let stored = 0, failed = 0;
    for (const r of rows) {
      let storageId: Id<"_storage"> | undefined;
      try {
        if (!fetchable(r.sourceUrl)) throw new Error("not a platform image host");
        const res = await fetch(r.sourceUrl, { signal: AbortSignal.timeout(10_000), redirect: "error" });
        const type = res.headers.get("content-type") ?? "";
        if (!res.ok || !type.startsWith("image/")) throw new Error(`HTTP ${res.status} ${type}`);
        const bytes = await res.arrayBuffer();
        if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) throw new Error(`size ${bytes.byteLength}`);
        storageId = await ctx.storage.store(new Blob([bytes], { type }));
        stored++;
      } catch (error) {
        failed++;
        console.error(`[media] ${String(error).slice(0, 120)}`);
      }
      await ctx.runMutation(internal.media.settle, { id: r._id, storageId });
    }
    return { stored, failed };
  },
});

/** Stable URLs for stored images, or null. For queries. */
export async function mediaUrl(ctx: QueryCtx, platform: string, kind: MediaKind, key: string | null): Promise<string | null> {
  if (!key) return null;
  const r = (await ctx.db.query("media").withIndex("by_key", (q) => q.eq("platform", platform).eq("kind", kind).eq("key", key)).first()) as Doc<"media"> | null;
  return r?.storageId ? await ctx.storage.getUrl(r.storageId) : null;
}

export async function coverForUrl(ctx: QueryCtx, url: string, postId?: string | null): Promise<string | null> {
  const platform = url.includes("instagram.com") ? "instagram" : url.includes("tiktok.com") ? "tiktok" : null;
  return platform ? await mediaUrl(ctx, platform, "cover", coverKey(platform, url, postId)) : null;
}

/** Avatars for the creator's own handles and the accounts they watch that don't have one yet. */
export const missingAvatars = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<Array<{ platform: "tiktok" | "instagram"; handle: string }>> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return [];
    const want: Array<{ platform: "tiktok" | "instagram"; handle: string }> = [];
    for (const pl of ["tiktok", "instagram"] as const) if (c.handles[pl]) want.push({ platform: pl, handle: c.handles[pl]! });
    const tracked = (await ctx.db.query("trackedAccounts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"trackedAccounts">[];
    for (const t of tracked) if (t.status === "active") want.push({ platform: t.platform, handle: t.handle });
    const out: typeof want = [];
    for (const w of want) {
      const r = await ctx.db.query("media").withIndex("by_key", (q) => q.eq("platform", w.platform).eq("kind", "avatar").eq("key", avatarKey(w.handle))).first();
      if (!r || (r.state === "failed" && r.attempts < 3)) out.push(w);
    }
    return out;
  },
});

/** One profile read per missing avatar (free from the vendor's cache when fresh), then mirror. */
export const refreshAvatars = internalAction({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<number> => {
    const missing = await ctx.runQuery(internal.media.missingAvatars, { creatorId: a.creatorId });
    const items: MediaItem[] = [];
    for (const m of missing.slice(0, 12)) {
      try {
        const r = await ctx.runAction(internal.reads.read.read, { kind: "profile", params: { platform: m.platform, handle: m.handle }, creatorId: a.creatorId });
        const url = (r.value as { avatarUrl?: string | null } | null)?.avatarUrl;
        if (url) items.push({ platform: m.platform, kind: "avatar", key: avatarKey(m.handle), url });
      } catch (error) {
        console.error(`[media] avatar ${m.platform}/${m.handle}: ${String(error).slice(0, 100)}`);
      }
    }
    return items.length ? await ctx.runMutation(internal.media.remember, { items }) : 0;
  },
});

/**
 * One-off for creators who existed before covers were kept: one feed read per handle
 * (the vendor's cache makes a repeat free), covers remembered, avatars refreshed.
 * Run: npx convex run media:backfillCreator '{"creatorId":"..."}'
 */
export const backfillCreator = internalAction({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ covers: number; avatars: number }> => {
    const creator = await ctx.runQuery(internal.onboarding.ingest.creatorHandles, { creatorId: a.creatorId });
    const items: MediaItem[] = [];
    for (const platform of ["tiktok", "instagram"] as const) {
      const handle = creator?.handles[platform];
      if (!handle) continue;
      const r = await ctx.runAction(internal.reads.read.read, { kind: "account.posts", params: { platform, handle, sort: "latest" }, creatorId: a.creatorId });
      // Through the normal own-post write path, so the rows and their covers refresh together.
      if (Array.isArray(r.value)) await ctx.runMutation(internal.onboarding.ingest.upsertOwnPosts, { creatorId: a.creatorId, posts: r.value, now: Date.now(), handle });
      for (const p of (Array.isArray(r.value) ? r.value : []) as Array<{ postId: string; url: string | null; thumbnailUrl?: string | null }>) {
        const key = coverKey(platform, p.url, p.postId);
        if (key && p.thumbnailUrl) items.push({ platform, kind: "cover", key, url: p.thumbnailUrl });
      }
    }
    await ctx.runMutation(internal.onboarding.ingest.computeMultiples, { creatorId: a.creatorId });
    const covers = items.length ? await ctx.runMutation(internal.media.remember, { items }) : 0;
    const avatars = await ctx.runAction(internal.media.refreshAvatars, { creatorId: a.creatorId });
    return { covers, avatars };
  },
});
