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
  /** A1, TikTok via the TikTok for Business connection, T+24-48h: share who watched to the end (0-1). */
  completionRate: number | null;
  profileViews: number | null;
  /** Share of views by surface: forYou, follow, search, personalProfile, sound, directMessage, other. */
  viewSources: Record<string, number> | null;
  /** follower/nonFollower and newViewer/returnViewer, each pair summing to 1 when present. */
  viewerTypes: Record<string, number> | null;
  viewerCountries: Record<string, number> | null;
}

/** Which metrics each platform can actually report, per Zernio's spec and the recording. */
export const EXPOSES: Record<Platform, ReadonlySet<keyof Connected>> = {
  tiktok: new Set(["views", "likes", "comments", "shares", "saves", "impressions", "reach", "clicks", "completionRate", "profileViews", "viewSources", "viewerTypes", "viewerCountries"] as const),
  instagram: new Set(["views", "likes", "comments", "shares", "saves", "impressions", "reach", "clicks", "follows", "avgWatchMs", "totalWatchMs", "skipRatePct", "durationSec"] as const),
};

const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : x === null ? null : typeof x === "string" && x.trim() !== "" && Number.isFinite(Number(x)) ? Number(x) : null);

/** Pure: a share map (fractions 0-1) or null when TikTok reported nothing (Zernio sends {} then). */
export function shares01(x: unknown): Record<string, number> | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 && /^[A-Za-z]{1,40}$/.test(k)) out[k] = Math.round(v * 1000) / 1000;
  return Object.keys(out).length ? out : null;
}

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
    // Zernio sends 0 and {} for "not reported" (other platforms, other connection lanes, not filled yet).
    // Nobody finishes 0% of a watched video, so 0 is "unknown", never a finding.
    completionRate: exposes.has("completionRate") && (num(a?.completionRate) ?? 0) > 0 ? Math.min(1, num(a?.completionRate)!) : null,
    profileViews: exposes.has("profileViews") && (num(a?.profileViews) ?? 0) > 0 ? num(a?.profileViews) : null,
    viewSources: exposes.has("viewSources") ? shares01(a?.impressionSources) : null,
    viewerTypes: exposes.has("viewerTypes") ? shares01(a?.audienceTypes) : null,
    viewerCountries: exposes.has("viewerCountries") ? shares01(a?.audienceCountries) : null,
  };
}

// --------------------------------------------------------------- derived facts

export type Diagnosis = "broke_out" | "below_normal" | "not_distributed" | "distributed_scrolled" | "hook_lost_them" | "held_them" | "normal" | "unknown";

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
  brokeOutAtLeast: 3,         // 3× their normal (reach, or views on the public count) is a breakout
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
    if (reachMultiple >= DIAGNOSE.brokeOutAtLeast) diagnosis = "broke_out";
    else if (reachMultiple < DIAGNOSE.notDistributedBelow) diagnosis = "not_distributed";
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

/**
 * The same read on the public count when no account is connected (B1): only what views can
 * say — broke out, below their normal, or about normal. Never why; that's her judgment.
 * A fresh post can be called a breakout (its multiple is a lower bound) but never "below".
 */
export function derivePublic(multiple: number | null | undefined, settledPost: boolean): Derived | null {
  if (multiple === null || multiple === undefined) return null;
  const diagnosis: Diagnosis = multiple >= DIAGNOSE.brokeOutAtLeast ? "broke_out" : !settledPost ? "unknown" : multiple < DIAGNOSE.notDistributedBelow ? "below_normal" : "normal";
  return { distribution: null, reachMultiple: null, engagementPerReach: null, retention: null, diagnosis, basis: "views" };
}
