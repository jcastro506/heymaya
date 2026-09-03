/**
 * The tracked-account sampler (plan §13.2). Every few hours, for every distinct
 * admired handle across the fleet, read the account's recent posts once (the cache
 * shares the read), write an observation per post, keep each account's baseline,
 * and turn anything above its own normal into a `signals` row for the creators who
 * admire it. Code measures; the scout judges.
 *
 * v1 velocity: views per hour since posting, compared to the account's median
 * velocity over its last 20 posts older than 24 h. Age-bucketed pace from repeated
 * samples (§13.2) replaces this once observations accumulate.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { THRESHOLDS } from "../config/thresholds";

interface PostIn {
  postId: string;
  url: string | null;
  caption: string | null;
  postedAt: number | null;
  metrics: { viewCount: number | null; likeCount: number | null; commentCount: number | null; shareCount: number | null; saveCount: number | null };
  clipId?: string | null;
  raw?: { is_ad?: boolean } | null;
}

/** Distinct (platform, handle) across every active tracked account, with who admires each. */
export const distinctTracked = internalQuery({
  args: {},
  handler: async (ctx): Promise<Array<{ platform: "tiktok" | "instagram"; handle: string; rows: Array<{ id: Id<"trackedAccounts">; creatorId: Id<"creators"> }> }>> => {
    const all = (await ctx.db.query("trackedAccounts").collect()) as Doc<"trackedAccounts">[];
    const map = new Map<string, { platform: "tiktok" | "instagram"; handle: string; rows: Array<{ id: Id<"trackedAccounts">; creatorId: Id<"creators"> }> }>();
    for (const r of all) {
      if (r.status !== "active") continue;
      const k = `${r.platform}:${r.handle}`;
      const e = map.get(k) ?? { platform: r.platform, handle: r.handle, rows: [] };
      e.rows.push({ id: r._id, creatorId: r.creatorId });
      map.set(k, e);
    }
    return [...map.values()];
  },
});

/** Retire a handle that the platform says no longer exists, and tell each creator who watched it. */
export const markGone = internalMutation({
  args: { ids: v.array(v.id("trackedAccounts")), handle: v.string(), platform: v.string() },
  handler: async (ctx, a): Promise<{ retired: number }> => {
    let retired = 0;
    for (const id of a.ids) {
      const row = (await ctx.db.get(id)) as Doc<"trackedAccounts"> | null;
      if (!row || row.status !== "active") continue;
      await ctx.db.patch(id, { status: "gone" });
      retired += 1;
      // Said once per account, by the dedupe key: they chose this handle, so its
      // disappearance is theirs to know rather than a silent hole in her watching.
      await ctx.runMutation(internal.core.messages.send, {
        creatorId: row.creatorId,
        surface: "telegram",
        body: `@${a.handle} isn't up anymore, so i've stopped watching them. tell me who to watch instead and i'll pick it up.`,
        dedupeKey: `gone:${id}`,
        proactive: true,
        kind: "status",
      });
    }
    return { retired };
  },
});

/** Write observations for one account's page and compute its baseline. Returns candidates above it. */
export const recordAccountPage = internalMutation({
  args: { platform: v.union(v.literal("tiktok"), v.literal("instagram")), handle: v.string(), posts: v.any(), now: v.number() },
  handler: async (ctx, a): Promise<{ baseline: number | null; n: number; candidates: Array<{ postId: string; url: string; ratio: number; views: number; ageHours: number; clipId: string | null }> }> => {
    const posts = (a.posts as PostIn[]).filter((p) => p.postId);
    const rows: Array<{ postId: string; url: string; views: number; ageHours: number; velocity: number; clipId: string | null; paid: boolean }> = [];
    for (const p of posts) {
      const createTime = p.postedAt ? (p.postedAt < 1e12 ? p.postedAt * 1000 : p.postedAt) : a.now;
      const ageHours = Math.max(0.5, (a.now - createTime) / 3_600_000);
      const views = p.metrics.viewCount ?? 0;
      const url = p.url ?? (a.platform === "tiktok" ? `https://www.tiktok.com/@${a.handle}/video/${p.postId}` : "");
      rows.push({ postId: p.postId, url, views, ageHours, velocity: views / ageHours, clipId: p.clipId ?? null, paid: Boolean(p.raw?.is_ad) });
      await ctx.db.insert("observations", {
        platform: a.platform,
        postId: p.postId,
        authorHandle: a.handle,
        url,
        createTime,
        sampledAt: a.now,
        ageHours,
        views,
        likes: p.metrics.likeCount ?? 0,
        comments: p.metrics.commentCount ?? 0,
        shares: p.metrics.shareCount ?? 0,
        saves: p.metrics.saveCount ?? undefined,
        clipId: (p as { clipId?: string | null }).clipId ?? undefined,
        keywords: [],
        source: "account.posts",
        paidPromotion: Boolean(p.raw?.is_ad),
      });
    }
    // Baseline: median velocity over the last 20 posts older than 24 h. Fewer than 8 → unknown.
    const settled = rows.filter((r) => r.ageHours >= 24).sort((x, y) => y.ageHours - x.ageHours).slice(-20);
    const vels = settled.map((r) => r.velocity).sort((x, y) => x - y);
    const minPosts = process.env.SCOUT_DEV_RELAX && process.env.ENVIRONMENT_NAME !== "production" ? 1 : THRESHOLDS.baselineMinPosts;
    const baseline = vels.length >= minPosts ? vels[Math.floor(vels.length / 2)] : null;
    // SCOUT_DEV_RELAX widens the age window so fixture posts (all old) can exercise the scout on dev; never set in production.
    const maxAge = process.env.SCOUT_DEV_RELAX && process.env.ENVIRONMENT_NAME !== "production" ? Number.MAX_SAFE_INTEGER : THRESHOLDS.breakoutMaxAgeHours;
    const floor = process.env.SCOUT_DEV_RELAX && process.env.ENVIRONMENT_NAME !== "production" ? 0 : THRESHOLDS.breakoutFloorRatio;
    const candidates = baseline && baseline > 0
      ? rows
          .filter((r) => !r.paid && r.ageHours <= maxAge && r.velocity / baseline >= floor)
          .map((r) => ({ postId: r.postId, url: r.url, ratio: Number((r.velocity / baseline).toFixed(2)), views: r.views, ageHours: Number(r.ageHours.toFixed(1)), clipId: r.clipId }))
      : [];
    return { baseline, n: vels.length, candidates };
  },
});

export const markSampled = internalMutation({
  args: { ids: v.array(v.id("trackedAccounts")), baseline: v.optional(v.number()), n: v.number(), now: v.number(), lastPostedAt: v.optional(v.number()) },
  handler: async (ctx, a): Promise<null> => {
    for (const id of a.ids) await ctx.db.patch(id, { medianPace24h: a.baseline, baselineN: a.n, lastSampledAt: a.now, lastPostedAt: a.lastPostedAt });
    return null;
  },
});

/** One signal per (creator, post), ever. Returns how many were new. */
export const writeBreakouts = internalMutation({
  args: {
    trackedAccountId: v.id("trackedAccounts"),
    creatorId: v.id("creators"),
    candidates: v.array(v.object({ postId: v.string(), url: v.string(), ratio: v.number(), views: v.number(), ageHours: v.number(), clipId: v.union(v.string(), v.null()) })),
    now: v.number(),
  },
  handler: async (ctx, a): Promise<{ written: number }> => {
    const existing = (await ctx.db.query("signals").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"signals">[];
    const seen = new Set(existing.flatMap((s) => s.sourcePostIds));
    let written = 0;
    for (const c of a.candidates) {
      if (seen.has(c.postId)) continue;
      await ctx.db.insert("signals", {
        creatorId: a.creatorId,
        kind: "breakout",
        sourcePostIds: [c.postId],
        trackedAccountId: a.trackedAccountId,
        clipId: c.clipId ?? undefined,
        score: c.ratio,
        corroboration: { accounts: 0, soundRising: false },
        verdict: "pending",
        why: `${c.ratio}× this account's normal at ${c.ageHours}h (${c.views.toLocaleString()} views); ${c.url}`,
        thresholdsVersion: THRESHOLDS.version,
        createdAt: a.now,
      });
      written += 1;
    }
    return { written };
  },
});

/** The fleet job: sample every distinct tracked account once, fan out to its admirers. */
export const run = internalAction({
  args: { slot: v.optional(v.string()) },
  handler: async (ctx): Promise<{ accounts: number; signals: number; failed: number; gone: number }> => {
    const now = Date.now();
    const slot = `sample-${Math.floor(now / (6 * 3_600_000))}`; // one read per account per 6 h bucket
    const accounts = await ctx.runQuery(internal.scout.sampler.distinctTracked, {});
    let signals = 0, failed = 0, gone = 0;
    for (const acct of accounts) {
      try {
        const r = await ctx.runAction(internal.reads.read.read, { kind: "account.posts", params: { platform: acct.platform, handle: acct.handle, sort: "latest", slot } });
        const posts = (Array.isArray(r.value) ? r.value : []) as PostIn[];
        const { baseline, n, candidates } = await ctx.runMutation(internal.scout.sampler.recordAccountPage, { platform: acct.platform, handle: acct.handle, posts, now });
        const lastPostedAt = posts.map((p) => (p.postedAt ? (p.postedAt < 1e12 ? p.postedAt * 1000 : p.postedAt) : 0)).reduce((m, t) => Math.max(m, t), 0) || undefined;
        await ctx.runMutation(internal.scout.sampler.markSampled, { ids: acct.rows.map((x) => x.id), baseline: baseline ?? undefined, n, now, lastPostedAt });
        for (const row of acct.rows) {
          const { written } = await ctx.runMutation(internal.scout.sampler.writeBreakouts, { trackedAccountId: row.id, creatorId: row.creatorId, candidates, now });
          signals += written;
        }
      } catch (error) {
        failed += 1;
        const detail = error instanceof Error ? error.message : String(error);
        console.error(`[sampler] ${acct.platform}/${acct.handle}: ${detail}`);
        /**
         * An account that no longer exists never will again. `status: "gone"` was in the
         * schema from the start and nothing ever set it, so two deleted handles failed
         * every six-hour sweep forever, burning a request each time and filling the
         * operator alerts with noise. Retire it and tell whoever was watching it.
         */
        if (/account_deactivated|"error":"not_found"|HTTP 404/.test(detail)) {
          const { retired } = await ctx.runMutation(internal.scout.sampler.markGone, { ids: acct.rows.map((x) => x.id), handle: acct.handle, platform: acct.platform });
          if (retired) gone += retired;
        }
      }
    }
    return { accounts: accounts.length, signals, failed, gone };
  },
});
