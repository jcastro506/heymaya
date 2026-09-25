/**
 * Replay mode: a simulation that spends ZERO ScrapeCreators credits, on real data.
 *
 * The dev deployment's `readCache` holds every public read ever made there (the 1,000-creator pool,
 * the first-week sim's subjects, the living sim's creators, the Expert Bench personas): expired rows
 * are overwritten on the next fetch, never deleted. Under replay, a read for an armed creator is
 * answered from that row whatever its age, and a read that is not cached is a NAMED failure
 * ("replay miss"), never a vendor call. Models (OpenRouter, Gemini) still run for real: they are what
 * a simulation measures.
 *
 * The same fail-closed guard as the outage drill (eval/faults.ts), because this changes what a creator
 * is told about the world. All must hold, checked where the read happens:
 *  1. the deployment may run drills at all (`faultsEnabled`: ENVIRONMENT_NAME set, not production);
 *  2. the `eval:replay` syncState row exists and has not expired (at most twelve hours);
 *  3. the read names a creator listed in the row, and that creator can never reach a person:
 *     an `eval-run:` subject, no Telegram chat, and either no phone or a fictional 555-01XX number
 *     (the first-week sim pairs by START from one; the line never registers it).
 */
import { v } from "convex/values";
import { internalQuery, type ActionCtx, type MutationCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { faultsEnabled } from "./faults";
import { KINDS } from "../reads/kinds";
import { readKey } from "../reads/key";

/** The cache key a read of this kind and params is stored under: the read path's own normaliser and key. */
export function cacheKeyFor(kind: keyof typeof KINDS, params: Record<string, unknown>): string {
  const normalize = KINDS[kind].normalize as unknown as (p: Record<string, unknown>) => Record<string, unknown>;
  return readKey(kind, normalize(params));
}

export const REPLAY_KEY = "eval:replay";
export const REPLAY_MISSES_KEY = "eval:replay:misses";
export const MAX_REPLAY_TTL_MS = 12 * 60 * 60_000;

export interface ReplayConfig { creatorIds: string[]; expiresAt: number; runIds: string[] }

/** Pure: a North American number in 555-0100…0199, the range reserved for fiction. */
export function isFictionalPhone(phone: string | undefined): boolean {
  return /^\+1[2-9]\d{2}5550(1\d{2})$/.test(phone ?? "");
}

/** Pure: the only creators replay may touch. Never a person. */
export function isReplayableCreator(c: Pick<Doc<"creators">, "clerkUserId" | "telegramChatId" | "phone"> | null): boolean {
  return Boolean(c && /^eval-run:/.test(c.clerkUserId) && !c.telegramChatId && (!c.phone || isFictionalPhone(c.phone)));
}

export function parseReplay(value: string | undefined): ReplayConfig | null {
  if (!value) return null;
  try {
    const c = JSON.parse(value) as Partial<ReplayConfig>;
    if (!Array.isArray(c.creatorIds) || typeof c.expiresAt !== "number") return null;
    return { creatorIds: c.creatorIds.map(String), expiresAt: c.expiresAt, runIds: Array.isArray(c.runIds) ? c.runIds.map(String) : [] };
  } catch {
    return null;
  }
}

/** Pure: does replay apply to this creator, given the config and the creator row? */
export function replayApplies(config: ReplayConfig | null, creator: Parameters<typeof isReplayableCreator>[0], now: number, env: Record<string, string | undefined>): boolean {
  if (!faultsEnabled(env) || !config || config.expiresAt <= now || !creator) return false;
  return config.creatorIds.includes(String((creator as { _id?: unknown })._id)) && isReplayableCreator(creator);
}

async function configOf(ctx: { db: { query: (t: "syncState") => { withIndex: (i: "by_key", f: (q: { eq: (k: "key", v: string) => unknown }) => unknown) => { first: () => Promise<unknown> } } } }): Promise<ReplayConfig | null> {
  const row = (await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", REPLAY_KEY)).first()) as Doc<"syncState"> | null;
  return parseReplay(row?.value);
}

export const active = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<boolean> => {
    const creator = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    return replayApplies(await configOf(ctx as never), creator, Date.now(), process.env);
  },
});

/** At a read: one env comparison in production (no query), a row read on a drill deployment. */
export async function replayFor(ctx: Pick<ActionCtx, "runQuery">, creatorId: Id<"creators"> | undefined): Promise<boolean> {
  if (!creatorId || !faultsEnabled(process.env)) return false;
  return await ctx.runQuery(internal.eval.replay.active, { creatorId });
}

/** The cached value for a read, whatever its age; null when never read (or only ever failed). */
export const cached = internalQuery({
  args: { kind: v.string(), key: v.string() },
  handler: async (ctx, a): Promise<{ value: unknown } | null> => {
    const row = (await ctx.db.query("readCache").withIndex("by_key", (q) => q.eq("kind", a.kind).eq("key", a.key)).first()) as Doc<"readCache"> | null;
    return row && row.value !== undefined && row.value !== null ? { value: row.value } : null;
  },
});

/** A miss is counted per run, so a report can say what the cache could not answer. */
export const recordMiss = internalMutation({
  args: { creatorId: v.id("creators"), kind: v.string(), key: v.string() },
  handler: async (ctx, a): Promise<null> => {
    const row = (await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", `${REPLAY_MISSES_KEY}:${a.creatorId}`)).first()) as Doc<"syncState"> | null;
    const prev = row ? (JSON.parse(row.value) as Array<{ kind: string; key: string; n: number }>) : [];
    const hit = prev.find((m) => m.kind === a.kind && m.key === a.key);
    if (hit) hit.n += 1;
    else if (prev.length < 200) prev.push({ kind: a.kind, key: a.key.slice(0, 200), n: 1 });
    const value = JSON.stringify(prev);
    if (row) await ctx.db.patch(row._id, { value, updatedAt: Date.now() });
    else await ctx.db.insert("syncState", { key: `${REPLAY_MISSES_KEY}:${a.creatorId}`, value, updatedAt: Date.now() });
    return null;
  },
});

export const missesFor = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<Array<{ kind: string; key: string; n: number }>> => {
    const row = (await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", `${REPLAY_MISSES_KEY}:${a.creatorId}`)).first()) as Doc<"syncState"> | null;
    return row ? (JSON.parse(row.value) as Array<{ kind: string; key: string; n: number }>) : [];
  },
});

export async function armReplay(ctx: MutationCtx, creatorIds: Id<"creators">[], runId: string, ttlMs?: number): Promise<{ ok: boolean; reason?: string; expiresAt?: number }> {
  if (!faultsEnabled(process.env)) return { ok: false, reason: "replay is off on this deployment (ENVIRONMENT_NAME unset or production)" };
  for (const id of creatorIds) {
    if (!isReplayableCreator((await ctx.db.get(id)) as Doc<"creators"> | null)) return { ok: false, reason: `creator ${id} is not a simulation creator; refused` };
  }
  const now = Date.now();
  const row = (await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", REPLAY_KEY)).first()) as Doc<"syncState"> | null;
  const prev = parseReplay(row?.value);
  const live = prev && prev.expiresAt > now ? prev : null;
  const expiresAt = Math.max(live?.expiresAt ?? 0, now + Math.min(ttlMs ?? MAX_REPLAY_TTL_MS, MAX_REPLAY_TTL_MS));
  const config: ReplayConfig = {
    creatorIds: [...new Set([...(live?.creatorIds ?? []), ...creatorIds.map(String)])],
    expiresAt,
    runIds: [...new Set([...(live?.runIds ?? []), runId])],
  };
  if (row) await ctx.db.patch(row._id, { value: JSON.stringify(config), updatedAt: now });
  else await ctx.db.insert("syncState", { key: REPLAY_KEY, value: JSON.stringify(config), updatedAt: now });
  return { ok: true, expiresAt };
}

/**
 * Arm replay for these creators (added to any run already armed; the expiry is the later of the two,
 * capped at twelve hours from now). Refused where drills are off, and for any creator that could
 * reach a person.
 */
export const arm = internalMutation({
  args: { creatorIds: v.array(v.id("creators")), runId: v.string(), ttlMs: v.optional(v.number()) },
  handler: async (ctx, a): Promise<{ ok: boolean; reason?: string; expiresAt?: number }> => await armReplay(ctx, a.creatorIds, a.runId, a.ttlMs),
});

/** Remove creators from replay (a run's clear); the row goes when nobody is left. */
export const disarm = internalMutation({
  args: { creatorIds: v.array(v.id("creators")) },
  handler: async (ctx, a): Promise<null> => {
    const row = (await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", REPLAY_KEY)).first()) as Doc<"syncState"> | null;
    const prev = parseReplay(row?.value);
    if (!row || !prev) return null;
    const drop = new Set(a.creatorIds.map(String));
    const creatorIds = prev.creatorIds.filter((id) => !drop.has(id));
    if (!creatorIds.length) await ctx.db.delete(row._id);
    else await ctx.db.patch(row._id, { value: JSON.stringify({ ...prev, creatorIds }), updatedAt: Date.now() });
    return null;
  },
});

/**
 * Which real accounts can a zero-credit run use? Those whose onboarding reads are all cached: the
 * profile and both post sorts the catalogue read asks for. Paged over `profile` rows only.
 */
export const candidates = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, a): Promise<Array<{ platform: string; handle: string; followers: number | null }>> => {
    const rows = (await ctx.db.query("readCache").withIndex("by_key", (q) => q.eq("kind", "profile")).take(2000)) as Doc<"readCache">[];
    const out: Array<{ platform: string; handle: string; followers: number | null }> = [];
    for (const r of rows) {
      const p = r.params as { platform?: string; handle?: string } | null;
      if (!p?.platform || !p.handle || r.value === undefined || r.value === null) continue;
      let ok = true;
      for (const sort of ["popular", "latest"]) {
        const key = cacheKeyFor("account.posts", { platform: p.platform, handle: p.handle, sort, slot: "onboarding" });
        const hit = await ctx.db.query("readCache").withIndex("by_key", (q) => q.eq("kind", "account.posts").eq("key", key)).first();
        if (!hit || (hit as Doc<"readCache">).value === undefined) { ok = false; break; }
      }
      if (!ok) continue;
      out.push({ platform: p.platform, handle: p.handle, followers: (r.value as { followerCount?: number } | null)?.followerCount ?? null });
      if (out.length >= (a.limit ?? 40)) break;
    }
    return out;
  },
});
