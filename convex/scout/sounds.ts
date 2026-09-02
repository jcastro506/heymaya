/**
 * Sound signals (plan §13.8 rail "sound: rising and used by ≥ 1 lane account", §4).
 * Once a day, fleet-wide: every sound seen on two or more distinct lane accounts in the
 * last seven days (the sampler's admired accounts and the sweep's keyword tops, which
 * both record the clip id on observations) becomes a `sound` signal for the creators
 * whose lane it came from. The scout may look the sound up (sound_info, sound_videos)
 * before judging; nothing here calls the vendor.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { THRESHOLDS } from "../config/thresholds";

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

export const weekObservations = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, a): Promise<Array<{ clipId?: string; authorHandle: string; url: string; views: number; keywords: string[] }>> => {
    const rows = (await ctx.db.query("observations").withIndex("by_sampledAt", (q) => q.gte("sampledAt", a.now - WEEK_MS)).collect()) as Doc<"observations">[];
    return rows.filter((r) => r.clipId).map((r) => ({ clipId: r.clipId, authorHandle: r.authorHandle, url: r.url, views: r.views, keywords: r.keywords }));
  },
});

/** Who cares about a sound: creators watching one of its accounts, or whose lane keywords surfaced it. */
export const audienceFor = internalQuery({
  args: { handles: v.array(v.string()), keywords: v.array(v.string()) },
  handler: async (ctx, a): Promise<Id<"creators">[]> => {
    const out = new Set<Id<"creators">>();
    const tracked = (await ctx.db.query("trackedAccounts").collect()) as Doc<"trackedAccounts">[];
    for (const t of tracked) if (t.status === "active" && a.handles.includes(t.handle)) out.add(t.creatorId);
    if (a.keywords.length) {
      const creators = (await ctx.db.query("creators").collect()) as Doc<"creators">[];
      for (const c of creators) {
        const kws = ((c.dossier as { keywords?: string[] } | undefined)?.keywords ?? []).map((k) => k.toLowerCase());
        if (c.channel.paired && kws.some((k) => a.keywords.includes(k))) out.add(c._id);
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
    const obs = await ctx.runQuery(internal.scout.sounds.weekObservations, { now });
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
