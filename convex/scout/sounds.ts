/**
 * Sound signals (plan §13.8 rail "sound: rising and used by ≥ 1 lane account", §4).
 * Once a day, fleet-wide: every sound seen on two or more distinct lane accounts in the
 * last seven days (the sampler's admired accounts and the sweep's keyword tops, which
 * both record the clip id on observations) becomes a `sound` signal for the creators
 * whose lane it came from. The scout may look the sound up (sound_info, sound_videos)
 * before judging; nothing here calls the vendor.
 */

import { v } from "convex/values";
import { internalAction, internalQuery, type ActionCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { THRESHOLDS } from "../config/thresholds";
import { pairedRows } from "../core/schedule";

export const MIN_ACCOUNTS = 2;
const WEEK_MS = 7 * 86_400_000;

export interface RisingSound { clipId: string; accounts: string[]; posts: Array<{ url: string; authorHandle: string; views: number; keywords: string[] }> }

/** Pure: group observations by sound, keep the ones two or more distinct accounts used. */
export function risingSounds(obs: Array<{ clipId?: string; authorHandle: string; url: string; views: number; keywords: string[] }>): RisingSound[] {
  const by = new Map<string, RisingSound>();
  for (const o of obs) {
    if (!o.clipId) continue;
    const cur = by.get(o.clipId) ?? { clipId: o.clipId, accounts: [], posts: [] };
    if (!cur.accounts.includes(o.authorHandle)) cur.accounts.push(o.authorHandle);
    if (!cur.posts.some((p) => p.url === o.url)) cur.posts.push({ url: o.url, authorHandle: o.authorHandle, views: o.views, keywords: o.keywords });
    by.set(o.clipId, cur);
  }
  return Array.from(by.values()).filter((s) => s.accounts.length >= MIN_ACCOUNTS).sort((a, b) => b.accounts.length - a.accounts.length);
}

/** The fields the sound passes read, from one page of the week's observations (sounds with a clip only). */
export type SoundObservation = { platform: string; clipId: string; authorHandle: string; url: string; views: number; keywords: string[]; createTime: number };

/**
 * One page of the week's observations. The week is read in pages because the whole of it is larger than one
 * function may read (2026-11-12: dev passed Convex's 16 MB limit and the daily trends and sound jobs crashed;
 * a few dozen creators' sampled accounts reach the same size).
 */
export const observationPage = internalQuery({
  args: { since: v.number(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, a): Promise<{ rows: SoundObservation[]; cursor: string; done: boolean }> => {
    const page = await ctx.db.query("observations").withIndex("by_sampledAt", (q) => q.gte("sampledAt", a.since)).paginate({ cursor: a.cursor, numItems: OBS_PAGE });
    const rows = (page.page as Doc<"observations">[]).filter((r) => r.clipId).map((r) => ({ platform: r.platform, clipId: r.clipId!, authorHandle: r.authorHandle, url: r.url, views: r.views, keywords: r.keywords, createTime: r.createTime }));
    return { rows, cursor: page.continueCursor, done: page.isDone };
  },
});

/** Rows per page: well under the read limit at observations' size (~1 KB each). */
export const OBS_PAGE = 1500;
/** Pages at most: 300k observations a week. Past that the newest-first tail is dropped, and logged. */
const MAX_PAGES = 200;

/** Every observation of the last week that carries a sound, page by page. */
export async function weekSoundObservations(ctx: ActionCtx, now: number): Promise<SoundObservation[]> {
  const out: SoundObservation[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const r: { rows: SoundObservation[]; cursor: string; done: boolean } = await ctx.runQuery(internal.scout.sounds.observationPage, { since: now - WEEK_MS, cursor });
    out.push(...r.rows);
    if (r.done) return out;
    cursor = r.cursor;
  }
  console.error(`[sounds] the week's observations ran past ${MAX_PAGES} pages; read the first ${MAX_PAGES * OBS_PAGE}`);
  return out;
}

/** Who cares about a sound: creators watching one of its accounts, or whose lane keywords surfaced it. */
export const audienceFor = internalQuery({
  args: { handles: v.array(v.string()), keywords: v.array(v.string()) },
  handler: async (ctx, a): Promise<Id<"creators">[]> => {
    const out = new Set<Id<"creators">>();
    const tracked = (await ctx.db.query("trackedAccounts").collect()) as Doc<"trackedAccounts">[];
    for (const t of tracked) if (t.status === "active" && a.handles.includes(t.handle)) out.add(t.creatorId);
    if (a.keywords.length) {
      for (const c of await pairedRows(ctx)) {
        if (c.keywords.some((k) => a.keywords.includes(k))) out.add(c.creatorId);
      }
    }
    return Array.from(out);
  },
});

export const writeSoundSignals = internalMutation({
  args: { creatorIds: v.array(v.id("creators")), sound: v.object({ clipId: v.string(), accounts: v.array(v.string()), posts: v.array(v.object({ url: v.string(), authorHandle: v.string(), views: v.number(), keywords: v.array(v.string()) })) }), now: v.number() },
  handler: async (ctx, a): Promise<{ written: number }> => {
    let written = 0;
    for (const creatorId of a.creatorIds) {
      const recent = (await ctx.db.query("signals").withIndex("by_creator", (q) => q.eq("creatorId", creatorId).gte("createdAt", a.now - WEEK_MS)).collect()) as Doc<"signals">[];
      if (recent.some((s) => s.kind === "sound" && s.clipId === a.sound.clipId)) continue;
      const top = [...a.sound.posts].sort((x, y) => y.views - x.views)[0];
      await ctx.db.insert("signals", {
        creatorId,
        kind: "sound",
        sourcePostIds: a.sound.posts.map((p) => p.url.split("/").pop() ?? p.url).slice(0, 5),
        clipId: a.sound.clipId,
        score: 1 + a.sound.accounts.length * 0.5,
        corroboration: { accounts: a.sound.accounts.length, soundRising: true },
        verdict: "pending",
        url: top.url,
        detected: `a sound ${a.sound.accounts.length} accounts in their lane used this week (${a.sound.accounts.map((h) => "@" + h).join(", ")}); biggest: ${top.views.toLocaleString()} views by @${top.authorHandle}; ${top.url}`,
        why: `a sound ${a.sound.accounts.length} accounts in their lane used this week (${a.sound.accounts.map((h) => "@" + h).join(", ")}); biggest: ${top.views.toLocaleString()} views by @${top.authorHandle}; ${top.url}`,
        thresholdsVersion: THRESHOLDS.version,
        createdAt: a.now,
      });
      written++;
    }
    return { written };
  },
});

export const run = internalAction({
  args: {},
  handler: async (ctx): Promise<{ sounds: number; written: number }> => {
    const now = Date.now();
    const obs = await weekSoundObservations(ctx, now);
    const rising = risingSounds(obs).slice(0, 10);
    let written = 0;
    for (const s of rising) {
      const creatorIds = await ctx.runQuery(internal.scout.sounds.audienceFor, { handles: s.accounts, keywords: Array.from(new Set(s.posts.flatMap((p) => p.keywords))) });
      if (!creatorIds.length) continue;
      written += (await ctx.runMutation(internal.scout.sounds.writeSoundSignals, { creatorIds, sound: s, now })).written;
    }
    return { sounds: rising.length, written };
  },
});
