/**
 * Connected numbers (plan Sprint 4e), the pure half: Zernio's post analytics → what a
 * consumer may reason with. Built against a RECORDING of the real responses
 * (`integrations/zernio/fixtures.recorded.json`, 2026-09-05), not the spec.
 *
 * ⚠️ THE ZERO. Zernio returns `0` for "not applicable on this platform". On the recorded
 * TikTok post: `views: 107, impressions: 0, reach: 0, igReelsAvgWatchTime: 0`. A model handed
 * that reads "107 views, nobody was reached, nobody watched" and explains it confidently.
 * So: a metric a platform does not expose becomes NULL here, before anything downstream
 * sees it, and a "0 while views > 0" on a metric the platform should expose is treated as
 * not-yet-synced rather than as zero.
 *
 * Nothing here calls the network and nothing here is a model's opinion.
 */

export type Platform = "tiktok" | "instagram";

export interface ZernioPostRow {
  _id: string;
  platform: string;
  platformPostUrl?: string | null;
  publishedAt?: string | null;
  status?: string;
  isExternal?: boolean;
  content?: string;
  analytics?: Record<string, unknown> | null;
  platforms?: Array<{ accountId?: string; accountUsername?: string | null; analytics?: Record<string, unknown> | null; syncStatus?: string; errorMessage?: string | null; platformPostId?: string | null; platformPostUrl?: string | null }>;
}

export interface Connected {
  platform: Platform;
  postId: string | null;      // the native id, parsed from the platform URL
  url: string | null;
  publishedAt: number | null;
  asOf: number | null;        // Zernio's lastUpdated
  syncStatus: "synced" | "pending" | "unavailable" | "unknown";
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  follows: number | null;
  /** Instagram Reels only. Null everywhere else, by construction. */
  avgWatchMs: number | null;
  totalWatchMs: number | null;
  skipRatePct: number | null;
  durationSec: number | null;
}

/** Which metrics each platform can actually report, per Zernio's spec and the recording. */
export const EXPOSES: Record<Platform, ReadonlySet<keyof Connected>> = {
  tiktok: new Set(["views", "likes", "comments", "shares", "saves", "impressions", "reach", "clicks"] as const),
  instagram: new Set(["views", "likes", "comments", "shares", "saves", "impressions", "reach", "clicks", "follows", "avgWatchMs", "totalWatchMs", "skipRatePct", "durationSec"] as const),
};

const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : x === null ? null : typeof x === "string" && x.trim() !== "" && Number.isFinite(Number(x)) ? Number(x) : null);

/** The native post id from the platform URL. Zernio's own ids are not the platform's. */
export function postIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const tt = url.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/);
  if (tt) return tt[1];
  const ig = url.match(/instagram\.com\/(?:p|reel|reels)\/([A-Za-z0-9_-]+)/);
  if (ig) return ig[1];
  return null;
}

function parseAsOf(s: unknown): number | null {
  if (typeof s !== "string" || !s) return null;
  // Zernio writes "2026-09-05 22:55:34" (no zone) in analytics and ISO elsewhere; both are UTC.
  const t = Date.parse(s.includes("T") ? s : s.replace(" ", "T") + "Z");
  return Number.isFinite(t) ? t : null;
}

/**
 * Normalise one post row. Pure.
 *
 * Rules, in order: a metric the platform does not expose is null; on an exposed metric, a
 * zero while `views` is positive is treated as not-yet-synced (null) rather than as zero —
 * the recorded TikTok post had 107 views and reach 0, which is a sync gap, not an audience
 * of nobody; and Reels retention fields are null unless the media is a video with a duration.
 */
export function normalizeConnected(row: ZernioPostRow): Connected | null {
  const platform = String(row.platform ?? "").toLowerCase();
  if (platform !== "tiktok" && platform !== "instagram") return null;
  const p = platform as Platform;
  const per = row.platforms?.find((x) => x.analytics) ?? null;
  const a = (per?.analytics ?? row.analytics ?? null) as Record<string, unknown> | null;
  const url = per?.platformPostUrl ?? row.platformPostUrl ?? null;
  const syncRaw = String(per?.syncStatus ?? (a ? "synced" : "unknown"));
  const syncStatus: Connected["syncStatus"] = syncRaw === "synced" || syncRaw === "pending" || syncRaw === "unavailable" ? syncRaw : "unknown";
  const exposes = EXPOSES[p];
  const views = a ? num(a.views) : null;
  const take = (key: keyof Connected, raw: unknown): number | null => {
    if (!exposes.has(key)) return null;
    const v = num(raw);
    if (v === null) return null;
    // Zero on an exposed metric while the post plainly has views: not synced yet, not zero.
    if (v === 0 && key !== "views" && (views ?? 0) > 0 && ["impressions", "reach"].includes(key)) return null;
    return v;
  };
  const durationSec = take("durationSec", a?.videoDurationSeconds);
  const isVideoWithDuration = durationSec !== null && durationSec > 0;
  return {
    platform: p,
    postId: postIdFromUrl(url),
    url,
    publishedAt: parseAsOf(row.publishedAt),
    asOf: a ? parseAsOf(a.lastUpdated) : null,
    syncStatus,
    views,
    likes: take("likes", a?.likes),
    comments: take("comments", a?.comments),
    shares: take("shares", a?.shares),
    saves: take("saves", a?.saves),
    impressions: take("impressions", a?.impressions),
    reach: take("reach", a?.reach),
    clicks: take("clicks", a?.clicks),
    follows: take("follows", a?.follows),
    avgWatchMs: isVideoWithDuration ? take("avgWatchMs", a?.igReelsAvgWatchTime) : null,
    totalWatchMs: isVideoWithDuration ? take("totalWatchMs", a?.igReelsVideoViewTotalTime) : null,
    skipRatePct: isVideoWithDuration ? take("skipRatePct", a?.reelsSkipRate) : null,
    durationSec,
  };
}

// --------------------------------------------------------------- derived facts

export type Diagnosis = "not_distributed" | "distributed_scrolled" | "hook_lost_them" | "held_them" | "normal" | "unknown";

export interface Derived {
  /** views ÷ reach: how many times each person saw it. */
  distribution: number | null;
  /** reach ÷ their normal reach. */
  reachMultiple: number | null;
  /** (likes + comments + shares + saves) ÷ reach, one consistent basis. */
  engagementPerReach: number | null;
  /** avg watch ÷ duration, Reels only. */
  retention: number | null;
  diagnosis: Diagnosis;
  /** What the diagnosis rests on, for the label she must carry. */
  basis: "reach" | "views" | "retention" | "none";
}

export const DIAGNOSE = {
  notDistributedBelow: 0.5,   // reach under half their normal reach
  scrolledEngagementBelow: 0.01, // fewer than 1 in 100 reached people did anything
  hookLostSkipAbove: 55,      // % leaving in the first 3 s
  heldRetentionAbove: 0.6,    // watched 60% of it on average
} as const;

/** Pure. The four-way read, with what it rests on. */
export function derive(c: Connected, normals: { reach: number | null; engagementPerReach: number | null }): Derived {
  const inter = (c.likes ?? 0) + (c.comments ?? 0) + (c.shares ?? 0) + (c.saves ?? 0);
  const distribution = c.reach && c.views ? Math.round((c.views / c.reach) * 100) / 100 : null;
  const reachMultiple = c.reach && normals.reach ? Math.round((c.reach / normals.reach) * 100) / 100 : null;
  const engagementPerReach = c.reach ? Math.round((inter / c.reach) * 10000) / 10000 : null;
  const retention = c.avgWatchMs !== null && c.durationSec ? Math.round((c.avgWatchMs / (c.durationSec * 1000)) * 100) / 100 : null;

  let diagnosis: Diagnosis = "unknown";
  let basis: Derived["basis"] = "none";
  if (retention !== null && c.skipRatePct !== null) {
    basis = "retention";
    diagnosis = c.skipRatePct >= DIAGNOSE.hookLostSkipAbove ? "hook_lost_them" : retention >= DIAGNOSE.heldRetentionAbove ? "held_them" : "normal";
  } else if (reachMultiple !== null) {
    basis = "reach";
    if (reachMultiple < DIAGNOSE.notDistributedBelow) diagnosis = "not_distributed";
    else if (engagementPerReach !== null && engagementPerReach < DIAGNOSE.scrolledEngagementBelow) diagnosis = "distributed_scrolled";
    else diagnosis = "normal";
  } else if (c.views !== null) {
    basis = "views";
  }
  return { distribution, reachMultiple, engagementPerReach, retention, diagnosis, basis };
}

/** Which of a post's numbers she may cite, with the label she must attach. Pure. */
export function citeable(c: Connected): { line: string; basis: "connected" | "public" }[] {
  const out: { line: string; basis: "connected" | "public" }[] = [];
  if (c.reach !== null) out.push({ line: `reached ${c.reach.toLocaleString()} people`, basis: "connected" });
  if (c.impressions !== null) out.push({ line: `${c.impressions.toLocaleString()} impressions`, basis: "connected" });
  if (c.avgWatchMs !== null && c.durationSec) out.push({ line: `watched ${Math.round((c.avgWatchMs / (c.durationSec * 1000)) * 100)}% on average`, basis: "connected" });
  if (c.skipRatePct !== null) out.push({ line: `${Math.round(c.skipRatePct)}% left in the first 3 seconds (Meta's estimate)`, basis: "connected" });
  return out;
}
