/**
 * One definition of "their normal" (audit B1; every skill reads the stored `multiple`, so
 * fixing it here fixes all of them). Pure; no model, no judgment: facts about the numbers.
 *
 * - Per platform: a TikTok normal and an Instagram normal can differ tenfold.
 * - Settled posts only (≥ 48 h old): a post from this morning isn't done growing, and counting
 *   it dragged the normal down every time they posted.
 * - A fresh post's multiple is views ÷ the settled normal, which is a LOWER BOUND ("so far"):
 *   views only grow, so a fresh post at 3× is at least 3×.
 * - The median, never the mean: one viral post can't drag the normal up.
 */

export const SETTLED_HOURS = 48;
export const NORMAL_WINDOW = 20; // the last 20 settled posts on that platform
export const NORMAL_MIN_POSTS = 5; // fewer settled posts than this and there is no normal yet

export interface PostLike { platform: string; createTime: number; metrics: { views: number } }

export function ageHours(p: Pick<PostLike, "createTime">, now: number): number {
  return (now - p.createTime) / 3_600_000;
}

export function settled(p: Pick<PostLike, "createTime">, now: number): boolean {
  return ageHours(p, now) >= SETTLED_HOURS;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Their normal views on one platform, from the last settled posts; null until there are enough. */
export function normalViews(posts: PostLike[], platform: string, now: number): { value: number; n: number } | null {
  const pool = posts
    .filter((p) => p.platform === platform && settled(p, now) && p.metrics.views > 0)
    .sort((a, b) => b.createTime - a.createTime)
    .slice(0, NORMAL_WINDOW)
    .map((p) => p.metrics.views);
  if (pool.length < NORMAL_MIN_POSTS) return null;
  const m = median(pool);
  return m && m > 0 ? { value: m, n: pool.length } : null;
}

/** views ÷ normal on the post's own platform, 2 dp; a lower bound while the post is fresh. */
export function multipleFor(p: PostLike, normals: Map<string, { value: number } | null>): number | undefined {
  const n = normals.get(p.platform);
  return n ? Number((p.metrics.views / n.value).toFixed(2)) : undefined;
}

export function normalsByPlatform(posts: PostLike[], now: number): Map<string, { value: number; n: number } | null> {
  const out = new Map<string, { value: number; n: number } | null>();
  for (const pl of new Set(posts.map((p) => p.platform))) out.set(pl, normalViews(posts, pl, now));
  return out;
}

// ------------------------------------------------------------------ history

export interface Point { at: number; views: number }
export const HISTORY_MAX = 48;

/** Append a reading when the views moved; keep the first reading and the most recent ones. Pure. */
export function appendHistory(history: Point[] | undefined, point: Point): Point[] {
  const h = [...(history ?? [])];
  const last = h[h.length - 1];
  if (last && last.views === point.views) return h;
  if (last && point.at <= last.at) return h;
  h.push(point);
  return h.length > HISTORY_MAX ? [h[0], ...h.slice(h.length - HISTORY_MAX + 1)] : h;
}

/**
 * How the views arrived, as a fact from the readings: most of them in the first two days
 * (a spike), a large share after the first week (a slow burn, e.g. search or a resurfacing),
 * still inside its first two days (early), or not enough readings to say.
 */
export type Shape = "early" | "spike" | "slow_burn" | "steady" | "unknown";
export function shapeOf(p: PostLike & { history?: Point[] }, now: number): Shape {
  if (!settled(p, now)) return "early";
  const h = (p.history ?? []).filter((x) => x.at >= p.createTime);
  if (h.length < 2) return "unknown";
  const total = p.metrics.views;
  if (total <= 0) return "unknown";
  const viewsBy = (t: number) => {
    let v = 0;
    for (const x of h) if (x.at <= t) v = x.views;
    return v;
  };
  const day2 = viewsBy(p.createTime + SETTLED_HOURS * 3_600_000);
  const day7 = viewsBy(p.createTime + 7 * 86_400_000);
  const firstReadingAfter2d = h.some((x) => x.at > p.createTime + SETTLED_HOURS * 3_600_000);
  if (!firstReadingAfter2d || day2 === 0) return "unknown";
  if (ageHours(p, now) > 8 * 24 && day7 > 0 && (total - day7) / total >= 0.4) return "slow_burn";
  if (day2 / total >= 0.7) return "spike";
  return "steady";
}
