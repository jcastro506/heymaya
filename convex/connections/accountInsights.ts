/**
 * A1 part 2, the pure half: Zernio's ACCOUNT-level reads → what a consumer may reason with.
 *
 *   TikTok     account-insights (follower count as a daily series, gained/lost).
 *
 * ⚠️ Built against the OpenAPI spec (1.69.0, read 2026-09-24) and its examples
 * (`integrations/zernio/fixtures.spec.json`), NOT a recording of a real account. The shape
 * this trusts is the shared envelope `{ metrics: { name: { total, values?, breakdowns? } },
 * unavailableMetrics? }`.
 * Anything else reads as "not reported", never as zero and never as a throw.
 *
 * The null-not-zero rule, as it applies at account level:
 * - a metric absent from `metrics`, or listed in `unavailableMetrics`, is null (the spec's own contract);
 * - when EVERY number that came back is 0, nothing was reported: all null (an active account
 *   does not reach nobody for thirty days; a new connection before the first sync does);
 * - a day's gained/lost with no follower count that day, or the first day of a range (nothing
 *   to diff against), both 0, is null;
 * - a follower count of 0 on one day while other days are positive is a missing snapshot: null.
 *
 * Nothing here calls the network and nothing here is a model's opinion.
 */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 120;

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
 * Pure: TikTok account-insights (time_series,
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

// ------------------------------------------------------------------- words

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
