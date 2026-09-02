/**
 * Taste arithmetic (plan §13.10 (1)–(3)). Pure functions, no model, no ctx: an event
 * adds its weight to every feature of the idea, scores decay with a 45-day half-life,
 * `n` is the confidence. Everything here is unit-tested and visible in Settings.
 */

import type { Doc } from "../_generated/dataModel";

export type Affinity = { key: string; kind: string; score: number; n: number; updatedAt?: number };

export const TASTE = {
  halfLifeDays: 45, // (tune)
  hardNoScore: -2, // (tune) at or below this, with hardNoMinN events, a feature is a rail
  hardNoMinN: 3,
  rankWeight: 0.25, // (tune) candidate score × (1 + rankWeight × affinity)
  ignoreAfterHours: 72,
  exploreEvery: 5, // (tune) one idea in five is chosen outside the core
  profileMinEvents: 3,
} as const;

/** Default weights (plan §13.10 table). `posted` is scaled by performance at write time. */
export const WEIGHTS: Record<string, number> = {
  posted: 3,
  blocked: 2,
  shotlist: 1.5,
  heart: 1,
  save: 1,
  reply_pos: 1,
  idea_only: 0.3,
  ignored: -0.3,
  unlinked: -1,
  reply_neg: -1.5,
  thumbs_down: -1.5,
  notme: -2,
};

const HARD_NO_KINDS = new Set(["format", "topic", "sound", "account"]);

export type IdeaFeatures = NonNullable<Doc<"ideas">["features"]>;

/** The feature keys of an idea: every taste event on the idea lands on all of them. */
export function featureKeys(f: Partial<IdeaFeatures> | null | undefined): string[] {
  if (!f) return [];
  const keys: string[] = [];
  if (f.format) keys.push(`format:${norm(f.format)}`);
  for (const t of f.topics ?? []) keys.push(`topic:${norm(t)}`);
  if (f.tone) keys.push(`tone:${norm(f.tone)}`);
  if (f.lengthBucket) keys.push(`length:${norm(f.lengthBucket)}`);
  if (f.sound) keys.push(`sound:${norm(f.sound)}`);
  if (f.source) keys.push(`source:${norm(f.source)}`);
  if (f.account) keys.push(`account:@${norm(f.account).replace(/^@/, "")}`);
  return Array.from(new Set(keys));
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 40);
}

export function kindOf(key: string): string {
  return key.split(":")[0] ?? "other";
}

/** Exponential decay: a score's weight after `ageMs`. */
export function decayFactor(ageMs: number): number {
  if (ageMs <= 0) return 1;
  return Math.pow(0.5, ageMs / (TASTE.halfLifeDays * 86_400_000));
}

/** Fold one event into the affinities. Existing scores decay to `now` first, so order of events is respected. */
export function applyEvent(affinities: Affinity[], keys: string[], weight: number, now: number): Affinity[] {
  const byKey = new Map(affinities.map((a) => [a.key, { ...a }]));
  for (const key of keys) {
    const cur = byKey.get(key);
    if (!cur) {
      byKey.set(key, { key, kind: kindOf(key), score: weight, n: 1, updatedAt: now });
    } else {
      const decayed = cur.score * decayFactor(now - (cur.updatedAt ?? now));
      byKey.set(key, { key, kind: cur.kind, score: round(decayed + weight), n: cur.n + 1, updatedAt: now });
    }
  }
  return Array.from(byKey.values());
}

/** A score as of `now`, without mutating. */
export function currentScore(a: Affinity, now: number): number {
  return round(a.score * decayFactor(now - (a.updatedAt ?? now)));
}

function round(x: number): number {
  return Math.round(x * 100) / 100;
}

/** The taste hint for a candidate: the summed affinity over its features, and the reasons in words. */
export function tasteHint(affinities: Affinity[], keys: string[], now: number): { score: number; n: number; hint: string; hardNo: string | null } {
  let score = 0;
  let n = 0;
  const reasons: string[] = [];
  let hardNo: string | null = null;
  const byKey = new Map(affinities.map((a) => [a.key, a]));
  for (const key of keys) {
    const a = byKey.get(key);
    if (!a) continue;
    const s = currentScore(a, now);
    score += s;
    n += a.n;
    const label = key.replace(/^account:/, "").replace(/^(format|topic|tone|length|sound|source):/, "");
    // A hard no is about WHAT (format, topic, sound) or WHO (account), never about where it came from:
    // three passes on breakouts from three accounts must not silence every breakout.
    if (HARD_NO_KINDS.has(kindOf(key)) && s <= TASTE.hardNoScore && a.n >= TASTE.hardNoMinN && !hardNo) hardNo = `passed on the last ${a.n} like this (${label})`;
    if (Math.abs(s) >= 1) reasons.push(`${s > 0 ? "took" : "passed on"} ${label} ×${a.n}`);
  }
  return { score: round(score), n, hint: reasons.slice(0, 3).join("; ") || "no history on this yet", hardNo };
}

/** Rank multiplier for the gate (§13.10 (5)). Clamped so taste re-orders, never erases. */
export function rankMultiplier(score: number): number {
  return Math.max(0.5, Math.min(2, 1 + TASTE.rankWeight * score));
}

/** The likes and dislikes in words for Settings and the prefix. */
export function summarize(affinities: Affinity[], now: number, limit = 6): { likes: string[]; dislikes: string[] } {
  const scored = affinities.map((a) => ({ key: a.key, score: currentScore(a, now), n: a.n })).filter((a) => a.n >= 2 && Math.abs(a.score) >= 1);
  const label = (k: string) => k.replace(/^account:/, "").replace(/^(format|topic|tone|length|sound|source):/, "$1 ");
  return {
    likes: scored.filter((a) => a.score > 0).sort((x, y) => y.score - x.score).slice(0, limit).map((a) => `${label(a.key)} (+${a.score}, ${a.n})`),
    dislikes: scored.filter((a) => a.score < 0).sort((x, y) => x.score - y.score).slice(0, limit).map((a) => `${label(a.key)} (${a.score}, ${a.n})`),
  };
}
