/**
 * The evidence pack for "why did this do that" (audit B2, capability 2). Pure code, no model:
 * it lays the post beside the creator's own recent posts so the model judges against facts
 * instead of a feeling. Every entry has a stable key; a cause she names must cite at least
 * one key (or a lookup she actually ran), and code drops any cause that cites nothing.
 *
 * Facts only, no verdicts. "Posted at 21:00, they usually post around 07:00" is a fact; whether
 * that mattered is her call.
 */

import { dayKeyInZone } from "./cadence";
import { SETTLED_HOURS, normalViews, shapeOf, type Point, type Shape } from "./normal";

export interface PackPost {
  platform: string;
  createTime: number;
  caption: string;
  hashtags: string[];
  durationSec?: number;
  soundClipId?: string;
  contentType?: string;
  metrics: { views: number; likes: number; comments: number; shares: number; saves?: number };
  history?: Point[];
}

export interface EvidencePack {
  keys: string[]; // every key a hypothesis may cite
  facts: Record<string, unknown>;
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

function local(at: number, timezone: string): { weekday: string; hour: number; date: string } {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(new Date(at));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return { weekday: get("weekday"), hour: Number(get("hour")) % 24, date: dayKeyInZone(at, timezone) };
  } catch {
    const d = new Date(at);
    return { weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()], hour: d.getUTCHours(), date: dayKeyInZone(at, "UTC") };
  }
}

const perView = (n: number, views: number): number | null => (views > 0 ? Number(((n / views) * 100).toFixed(2)) : null);

/**
 * The post against the creator's last posts on the same platform. `others` may include the
 * post itself; it's excluded. Returns only the facts that exist: a missing duration is a
 * missing key, never a zero.
 */
export function buildEvidencePack(post: PackPost, others: PackPost[], timezone: string, now: number): EvidencePack {
  const facts: Record<string, unknown> = {};
  const peers = others
    .filter((p) => p.platform === post.platform && p.createTime !== post.createTime)
    .sort((a, b) => b.createTime - a.createTime)
    .slice(0, 20);

  const when = local(post.createTime, timezone);
  facts.posted = { date: when.date, weekday: when.weekday, hourLocal: when.hour, hoursOld: Math.round((now - post.createTime) / 3_600_000), settled: now - post.createTime >= SETTLED_HOURS * 3_600_000 };

  const normal = normalViews([post, ...others], post.platform, now);
  if (normal) facts.againstNormal = { views: post.metrics.views, normal: normal.value, multiple: Number((post.metrics.views / normal.value).toFixed(2)), basedOnPosts: normal.n, lowerBound: now - post.createTime < SETTLED_HOURS * 3_600_000 };

  const shape: Shape = shapeOf(post, now);
  facts.shape = { shape, readings: (post.history ?? []).length };

  if (peers.length >= 3) {
    const hours = peers.map((p) => local(p.createTime, timezone).hour);
    const days = new Map<string, number>();
    for (const p of peers) days.set(local(p.createTime, timezone).weekday, (days.get(local(p.createTime, timezone).weekday) ?? 0) + 1);
    facts.timing = { thisHour: when.hour, usualHour: median(hours), thisWeekday: when.weekday, usualWeekday: [...days.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null, comparedWith: peers.length };

    if (post.durationSec) {
      const d = median(peers.map((p) => p.durationSec ?? 0).filter((x) => x > 0));
      if (d) facts.length = { thisSec: post.durationSec, usualSec: d };
    }

    facts.caption = { thisChars: post.caption.length, usualChars: median(peers.map((p) => p.caption.length)), firstLine: post.caption.split("\n")[0].slice(0, 140) };

    const peerTags = new Map<string, number>();
    for (const p of peers) for (const t of p.hashtags) peerTags.set(t.toLowerCase(), (peerTags.get(t.toLowerCase()) ?? 0) + 1);
    const tags = post.hashtags.map((t) => t.toLowerCase());
    facts.hashtags = { used: tags.slice(0, 12), newToThem: tags.filter((t) => !peerTags.has(t)).slice(0, 8) };

    if (post.soundClipId) {
      const reused = peers.filter((p) => p.soundClipId === post.soundClipId).length;
      facts.sound = { soundId: post.soundClipId, usedBeforeByThem: reused };
    }

    if (post.contentType) {
      const same = peers.filter((p) => p.contentType === post.contentType).length;
      facts.format = { thisType: post.contentType, sameTypeInLast: same, of: peers.length };
    }

    const rate = (pick: (p: PackPost) => number) => median(peers.map((p) => perView(pick(p), p.metrics.views) ?? 0).filter((x) => x > 0));
    facts.engagementPer100Views = {
      this: { likes: perView(post.metrics.likes, post.metrics.views), comments: perView(post.metrics.comments, post.metrics.views), shares: perView(post.metrics.shares, post.metrics.views) },
      usual: { likes: rate((p) => p.metrics.likes), comments: rate((p) => p.metrics.comments), shares: rate((p) => p.metrics.shares) },
    };

    const byViews = [...peers].sort((a, b) => b.metrics.views - a.metrics.views);
    facts.theirBestRecent = byViews.slice(0, 3).map((p) => ({ date: local(p.createTime, timezone).date, views: p.metrics.views, firstLine: p.caption.split("\n")[0].slice(0, 100) }));
  } else {
    facts.thin = `only ${peers.length} other posts on this platform to compare with`;
  }

  // The same video on their other platform (a cross-post): the strongest clue there is. If it
  // broke out on both, it's the video; if only on one, it's something about that platform or day.
  const twin = crossPostOf(post, others);
  if (twin) {
    const twinNormal = normalViews(others, twin.platform, now);
    facts.sameVideoOtherPlatform = { platform: twin.platform, views: twin.metrics.views, multiple: twinNormal ? Number((twin.metrics.views / twinNormal.value).toFixed(2)) : null, postedDaysApart: Math.round(Math.abs(twin.createTime - post.createTime) / 86_400_000) };
  }

  return { keys: Object.keys(facts), facts };
}

const titleOf = (caption: string): string => caption.split("\n")[0].toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

/** Pure: their post on the OTHER platform with the same opening line, posted within a week. */
export function crossPostOf(post: PackPost, others: PackPost[]): PackPost | null {
  const t = titleOf(post.caption);
  if (t.length < 12) return null; // too short to be sure it's the same video
  return others
    .filter((o) => o.platform !== post.platform && Math.abs(o.createTime - post.createTime) <= 7 * 86_400_000)
    .find((o) => { const u = titleOf(o.caption); return u.length >= 12 && (u === t || u.startsWith(t) || t.startsWith(u)); }) ?? null;
}

export interface Hypothesis { cause: string; evidence: string[]; confidence: string }

/**
 * Code's half of "ranked hypotheses": a cause survives only if it cites at least one real
 * evidence key or a lookup that actually ran this turn. The model judges what's likely; code
 * refuses causes with nothing behind them. Order is kept (she ranked them).
 */
export function supportedHypotheses(raw: unknown, allowed: Iterable<string>): Hypothesis[] {
  if (!Array.isArray(raw)) return [];
  const ok = new Set([...allowed].map((k) => k.toLowerCase()));
  const out: Hypothesis[] = [];
  for (const h of raw.slice(0, 4)) {
    if (!h || typeof h !== "object") continue;
    const cause = String((h as { cause?: unknown }).cause ?? "").trim().slice(0, 200);
    const cites = Array.isArray((h as { evidence?: unknown }).evidence) ? ((h as { evidence: unknown[] }).evidence.map((e) => String(e).trim().toLowerCase()).filter((e) => ok.has(e))) : [];
    if (!cause || cites.length === 0) continue;
    out.push({ cause, evidence: cites, confidence: String((h as { confidence?: unknown }).confidence ?? "possible").slice(0, 20) });
  }
  return out;
}
