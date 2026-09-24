/**
 * A1 part 2, the pure half: Zernio's ACCOUNT-level reads → what a consumer may reason with.
 *
 *   Instagram  account-insights (reach, views, accounts engaged, interactions, profile link
 *              taps, follows/unfollows; reach also as a daily series), follower-history
 *              (a daily running count with gained/lost), demographics (100+ followers).
 *   TikTok     account-insights (follower count as a daily series, gained/lost).
 *
 * ⚠️ Built against the OpenAPI spec (1.69.0, read 2026-09-24) and its examples
 * (`integrations/zernio/fixtures.spec.json`), NOT a recording of a real account. The shapes
 * this trusts are the shared envelope `{ metrics: { name: { total, values?, breakdowns? } },
 * unavailableMetrics? }` and `{ demographics: { age|gender|country|city: [{dimension, value}] } }`.
 * Anything else reads as "not reported", never as zero and never as a throw.
 *
 * The null-not-zero rule, as it applies at account level:
 * - a metric absent from `metrics`, or listed in `unavailableMetrics`, is null (the spec's own contract);
 * - when EVERY number that came back is 0, nothing was reported: all null (an active account
 *   does not reach nobody for thirty days; a new connection before the first sync does);
 * - reach 0 while views > 0 is a sync gap, not an audience of nobody: null (same rule as posts);
 * - a day's gained/lost with no follower count that day, or the first day of a range (nothing
 *   to diff against), both 0, is null;
 * - a follower count of 0 on one day while other days are positive is a missing snapshot: null.
 *
 * Nothing here calls the network and nothing here is a model's opinion.
 */

export type InsightsPlatform = "tiktok" | "instagram";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 120;
const MAX_SLICES = 10;

const finite = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : null);
const isObj = (x: unknown): x is Record<string, unknown> => Boolean(x) && typeof x === "object" && !Array.isArray(x);

export interface EnvelopeMetric {
  total: number | null;
  values: Array<{ date: string; value: number }> | null;
  breakdowns: Array<{ dimension: string; value: number }> | null;
}
export interface Envelope {
  metrics: Record<string, EnvelopeMetric>;
  unavailable: string[];
  dateRange: { since: string; until: string } | null;
}

/** Pure: the shared account-insights envelope, validated. Null when it isn't one. */
export function readEnvelope(raw: unknown): Envelope | null {
  if (!isObj(raw) || raw.success === false || !isObj(raw.metrics)) return null;
  const unavailable = Array.isArray(raw.unavailableMetrics)
    ? raw.unavailableMetrics.map((u) => (isObj(u) && typeof u.metric === "string" ? u.metric : null)).filter((m): m is string => m !== null && /^[a-z_]{1,40}$/.test(m)).slice(0, 20)
    : [];
  const metrics: Record<string, EnvelopeMetric> = {};
  for (const [name, m] of Object.entries(raw.metrics)) {
    if (!/^[a-z_]{1,40}$/.test(name) || !isObj(m) || unavailable.includes(name)) continue;
    let values: EnvelopeMetric["values"] = null;
    if (Array.isArray(m.values)) {
      const byDay = new Map<string, number>();
      for (const p of m.values.slice(0, MAX_DAYS * 2)) {
        if (!isObj(p) || typeof p.date !== "string") continue;
        const day = p.date.slice(0, 10);
        const val = finite(p.value);
        if (DAY_RE.test(day) && val !== null) byDay.set(day, val);
      }
      values = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-MAX_DAYS).map(([date, value]) => ({ date, value }));
    }
    let breakdowns: EnvelopeMetric["breakdowns"] = null;
    if (Array.isArray(m.breakdowns)) {
      breakdowns = m.breakdowns
        .slice(0, 60)
        .map((b) => (isObj(b) && typeof b.dimension === "string" && finite(b.value) !== null ? { dimension: cleanLabel(b.dimension), value: finite(b.value)! } : null))
        .filter((b): b is { dimension: string; value: number } => b !== null && b.dimension.length > 0);
    }
    metrics[name] = { total: finite(m.total), values, breakdowns };
  }
  const dr = isObj(raw.dateRange) ? raw.dateRange : null;
  const dateRange = dr && typeof dr.since === "string" && typeof dr.until === "string" && DAY_RE.test(dr.since.slice(0, 10)) && DAY_RE.test(dr.until.slice(0, 10)) ? { since: dr.since.slice(0, 10), until: dr.until.slice(0, 10) } : null;
  return { metrics, unavailable, dateRange };
}

/** Labels come from the platform, so they are data: no control characters, bounded. */
function cleanLabel(s: string): string {
  return s.replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
}

// --------------------------------------------------------------- follower history

export interface FollowerDay { day: string; followers: number | null; gained: number | null; lost: number | null }
export interface FollowerHistory { days: FollowerDay[]; unavailable: string[] }

/**
 * Pure: Instagram follower-history and TikTok account-insights share this (both time_series,
 * `follower_count`, `followers_gained`, `followers_lost`). Days with nothing are dropped.
 */
export function normalizeFollowerHistory(raw: unknown): FollowerHistory | null {
  const env = readEnvelope(raw);
  if (!env) return null;
  const series = (name: string) => new Map((env.metrics[name]?.values ?? []).map((p) => [p.date, p.value] as const));
  const count = series("follower_count");
  const gained = series("followers_gained");
  const lost = series("followers_lost");
  const anyPositiveCount = [...count.values()].some((x) => x > 0);
  const days = [...new Set([...count.keys(), ...gained.keys(), ...lost.keys()])].sort();
  const out: FollowerDay[] = [];
  days.forEach((day, i) => {
    let followers = count.get(day) ?? null;
    if (followers === 0 && anyPositiveCount) followers = null; // a missing snapshot, not an empty account
    let g = gained.get(day) ?? null;
    let l = lost.get(day) ?? null;
    const zeroPair = (g ?? 0) === 0 && (l ?? 0) === 0;
    if (zeroPair && (followers === null || i === 0)) { g = null; l = null; }
    if (followers === null && g === null && l === null) return;
    out.push({ day, followers, gained: g, lost: l });
  });
  const everythingZero = out.length > 0 && out.every((d) => (d.followers ?? 0) === 0 && (d.gained ?? 0) === 0 && (d.lost ?? 0) === 0);
  return { days: everythingZero ? [] : out, unavailable: env.unavailable };
}

/** Pure: gained and lost over the last N days of a history, or null when none were reported. */
export function flowOver(days: FollowerDay[], lastDays: number, today: string): { gained: number | null; lost: number | null } {
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - (lastDays - 1) * 86_400_000).toISOString().slice(0, 10);
  const inRange = days.filter((d) => d.day >= from && d.day <= today);
  const sum = (k: "gained" | "lost") => (inRange.some((d) => d[k] !== null) ? inRange.reduce((s, d) => s + (d[k] ?? 0), 0) : null);
  return { gained: sum("gained"), lost: sum("lost") };
}

// ------------------------------------------------------------ Instagram insights

export const IG_TOTAL_METRICS = ["reach", "views", "accounts_engaged", "total_interactions", "profile_links_taps"] as const;

export interface IgInsights {
  reach: number | null;
  views: number | null;
  accountsEngaged: number | null;
  totalInteractions: number | null;
  profileLinkTaps: number | null;
  follows: number | null;
  unfollows: number | null;
  reachDaily: Array<{ date: string; value: number }> | null;
  fromDate: string | null;
  toDate: string | null;
  unavailable: string[];
}

/**
 * Pure. Three reads, any of which may be missing (a failed call is null): the totals, the
 * follows split (`follows_and_unfollows` with `breakdown=follow_type`), and reach per day.
 *
 * ⚠️ Spec gap: the spec does not name the follow_type dimensions. Meta's Graph docs do:
 * FOLLOWER = accounts that followed, NON_FOLLOWER = accounts that unfollowed. Any other
 * dimension is ignored, and with no split at all both stay null (a combined total of follows
 * plus unfollows is not a number anyone should cite).
 */
export function normalizeIgInsights(raw: { totals?: unknown; follows?: unknown; reachSeries?: unknown }): IgInsights | null {
  const totals = readEnvelope(raw.totals);
  const follows = readEnvelope(raw.follows);
  const series = readEnvelope(raw.reachSeries);
  if (!totals && !follows && !series) return null;
  const t = (name: string) => totals?.metrics[name]?.total ?? null;
  let reach = t("reach");
  const views = t("views");
  let accountsEngaged = t("accounts_engaged");
  const totalInteractions = t("total_interactions");
  const profileLinkTaps = t("profile_links_taps");
  const split = follows?.metrics.follows_and_unfollows?.breakdowns ?? null;
  const dim = (d: string) => (split ? split.filter((b) => b.dimension.toUpperCase() === d).reduce<number | null>((s, b) => (s ?? 0) + b.value, null) : null);
  const followsN = dim("FOLLOWER");
  const unfollowsN = dim("NON_FOLLOWER");
  let reachDaily = series?.metrics.reach?.values ?? null;
  if (reachDaily && (reachDaily.length === 0 || reachDaily.every((p) => p.value === 0))) reachDaily = null;

  if (reach === 0 && (views ?? 0) > 0) reach = null;
  if (accountsEngaged === 0 && (totalInteractions ?? 0) > 0) accountsEngaged = null;
  const present = [reach, views, accountsEngaged, totalInteractions, profileLinkTaps, followsN, unfollowsN].filter((x): x is number => x !== null);
  // Every number zero and no daily reach: nothing was reported yet, not an account nobody saw.
  const nothing = present.length > 0 && present.every((x) => x === 0) && !reachDaily;
  const z = (x: number | null) => (nothing ? null : x);
  return {
    reach: z(reach), views: z(views), accountsEngaged: z(accountsEngaged), totalInteractions: z(totalInteractions), profileLinkTaps: z(profileLinkTaps), follows: z(followsN), unfollows: z(unfollowsN), reachDaily,
    fromDate: totals?.dateRange?.since ?? series?.dateRange?.since ?? null,
    toDate: totals?.dateRange?.until ?? series?.dateRange?.until ?? null,
    unavailable: [...new Set([...(totals?.unavailable ?? []), ...(follows?.unavailable ?? []), ...(series?.unavailable ?? [])])],
  };
}

// ------------------------------------------------------------ Instagram audience

export interface Slice { label: string; value: number; share: number | null }
export interface Audience { age: Slice[] | null; gender: Slice[] | null; country: Slice[] | null; city: Slice[] | null; base: number | null }

const LABEL_OK: Record<keyof Omit<Audience, "base">, RegExp> = {
  age: /^\d{2}(-\d{2}|\+)$/,
  gender: /^[MFU]$/,
  country: /^[A-Z]{2}$/,
  city: /^[^\n]{1,80}$/,
};

/**
 * Pure: Instagram demographics → the top slices per dimension, each with its share of the
 * audience. The base is the whole audience (the larger of the age and gender sums, which
 * cover everyone), so a top-city share is of all followers, not of the top 45.
 */
export function normalizeDemographics(raw: unknown): Audience | null {
  if (!isObj(raw) || raw.success === false || !isObj(raw.demographics)) return null;
  const d = raw.demographics;
  const read = (k: keyof typeof LABEL_OK): Array<{ label: string; value: number }> | null => {
    const arr = d[k];
    if (!Array.isArray(arr)) return null;
    const merged = new Map<string, number>();
    for (const e of arr.slice(0, 60)) {
      if (!isObj(e) || typeof e.dimension !== "string") continue;
      const label = cleanLabel(k === "gender" || k === "country" ? e.dimension.toUpperCase() : e.dimension);
      const value = finite(e.value);
      if (!value || !LABEL_OK[k].test(label)) continue;
      merged.set(label, (merged.get(label) ?? 0) + value);
    }
    const out = [...merged.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
    return out.length ? out : null;
  };
  const raws = { age: read("age"), gender: read("gender"), country: read("country"), city: read("city") };
  if (!raws.age && !raws.gender && !raws.country && !raws.city) return null;
  const sum = (xs: Array<{ value: number }> | null) => (xs ? xs.reduce((s, x) => s + x.value, 0) : 0);
  const base = Math.max(sum(raws.age), sum(raws.gender)) || null;
  const withShare = (xs: Array<{ label: string; value: number }> | null, sortByLabel = false): Slice[] | null => {
    if (!xs) return null;
    const top = xs.slice(0, MAX_SLICES).map((x) => ({ ...x, share: base ? Math.round((x.value / Math.max(base, x.value)) * 10000) / 10000 : null }));
    return sortByLabel ? top.sort((a, b) => a.label.localeCompare(b.label)) : top;
  };
  return { age: withShare(raws.age, true), gender: withShare(raws.gender), country: withShare(raws.country), city: withShare(raws.city), base };
}

// ------------------------------------------------------------------- words

export const GENDER_WORDS: Record<string, string> = { M: "men", F: "women", U: "not specified" };

/** A country code in words ("US" → "United States"); the code itself when the runtime can't say. */
export function countryName(code: string): string {
  try {
    const n = new Intl.DisplayNames(["en"], { type: "region" }).of(code);
    return n && n !== code ? n : code;
  } catch {
    return code;
  }
}

/** Why a read came back empty, for the row and for the words. */
export type ReadStatus = "ok" | "not_reported" | "too_few_followers" | "not_available" | "failed";

/**
 * Pure: a Zernio error → what it means for this account. 402 (their add-on), 403, 404 and
 * 412 (TikTok's user.info.stats scope) are "not available for this account", which is
 * recorded and said plainly; the demographics 100-follower 400 is its own state; anything
 * else (429 after retries, 5xx, a 400 we caused) is a failure the operator hears about.
 */
export function classifyError(e: unknown): ReadStatus {
  const status = typeof (e as { status?: unknown })?.status === "number" ? (e as { status: number }).status : 0;
  const body = typeof (e as { body?: unknown })?.body === "string" ? (e as { body: string }).body : "";
  if (status === 400 && /insufficient_followers|at least 100 followers/i.test(body)) return "too_few_followers";
  if ([402, 403, 404, 412].includes(status)) return "not_available";
  return "failed";
}
