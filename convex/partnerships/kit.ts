/**
 * B6 (§8.2): the creator's media kit, computed from their own rows, never re-derived by the
 * model and never invented: followers and normal per platform, best recent posts with their
 * multiples, the lane, and their deal preferences. Pitches cite it; the app can show it.
 *
 * Plus the weekly opportunities offer (partner tier): brands seen paying creators in their lane
 * that aren't already in their record and aren't excluded. It only OFFERS; research (which spends
 * credits) starts when they say yes. At most one a week, inside the texting rails.
 */
import { v } from "convex/values";
import { internalAction, internalQuery, type QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { normalViews } from "../core/normal";
import { dayKeyInZone } from "../core/cadence";
import { Profile } from "./contracts";
import { partnershipsOpen, sameBrand } from "./store";
import type { LaneBrand } from "./signals";

export interface MediaKit {
  lane: string | null;
  platforms: Array<{ platform: string; handle: string | null; followers: number | null; normalViews: number | null; posts: number; best: Array<{ url: string; views: number; multiple: number | null; caption: string }> }>;
  prefs: { paidOnly: boolean; dealTypes: string[]; excludedBrands: string[]; minimumRate: string; region: string };
  /** Signal 2: accounts they tagged in their own posts (brands they already use, or friends: her call), with a post to point at. */
  taggedByThem: Array<{ handle: string; posts: number; example: string }>;
}

export const mediaKit = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<MediaKit | null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    return c ? await readKit(ctx, c) : null;
  },
});

/** Shared by the internal query and the public page (a query can't call a query). */
export async function readKit(ctx: QueryCtx, c: Doc<"creators">): Promise<MediaKit> {
  {
    const a = { creatorId: c._id };
    const now = Date.now();
    const posts = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(120)) as Doc<"ownPosts">[];
    const snaps = (await ctx.db.query("followerSnapshots").withIndex("by_creator_day", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(20)) as Doc<"followerSnapshots">[];
    const prof = (await ctx.db.query("partnershipProfiles").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).unique()) as Doc<"partnershipProfiles"> | null;
    const p = Profile.parse(prof?.data ?? {});
    const platforms = (["tiktok", "instagram"] as const).flatMap((platform) => {
      const mine = posts.filter((x) => x.platform === platform);
      const handle = c.handles[platform] ?? null;
      if (!mine.length && !handle) return [];
      return [{
        platform,
        handle,
        followers: snaps.find((s) => s.platform === platform)?.followers ?? null,
        normalViews: normalViews(mine, platform, now)?.value ?? null,
        posts: mine.length,
        best: [...mine].filter((x) => now - x.createTime < 90 * 86_400_000).sort((x, y) => y.metrics.views - x.metrics.views).slice(0, 5).map((x) => ({ url: x.url, views: x.metrics.views, multiple: x.multiple ?? null, caption: x.caption.split("\n")[0].slice(0, 100) })),
      }];
    });
    const lane = typeof (c.dossier as { lane?: unknown } | undefined)?.lane === "string" ? String((c.dossier as { lane: string }).lane) : c.niche ?? null;
    const tags = new Map<string, { posts: number; example: string }>();
    for (const x of posts) for (const m of (x.caption.match(/@([a-z0-9._]{2,30})/gi) ?? []).map((t) => t.slice(1).toLowerCase().replace(/\.$/, ""))) {
      if (m === c.handles.tiktok?.toLowerCase() || m === c.handles.instagram?.toLowerCase()) continue;
      const t = tags.get(m) ?? { posts: 0, example: x.url };
      t.posts++;
      tags.set(m, t);
    }
    const taggedByThem = [...tags.entries()].sort((a2, b2) => b2[1].posts - a2[1].posts).slice(0, 8).map(([handle, t]) => ({ handle, ...t }));
    return { taggedByThem, lane, platforms, prefs: { paidOnly: p.paidOnly, dealTypes: p.dealTypes, excludedBrands: p.excludedBrands, minimumRate: p.minimumRate, region: p.region } };
  }
}

/** Pure: the brands worth offering: paying their lane, not already a relationship, not excluded. */
export function offerable(brands: LaneBrand[], known: Array<{ brandDomain: string; brand?: string }>, excluded: string[]): LaneBrand[] {
  const ex = new Set(excluded.map((e) => e.toLowerCase().replace(/^@/, "")));
  return brands.filter((b) => !ex.has(b.handle) && !known.some((k) => sameBrand(k, b.handle, `${b.handle}.com`)));
}

/** Pure: the offer, in her voice, from facts only. */
export function offerText(brands: LaneBrand[]): string {
  const top = brands.slice(0, 3).map((b) => `@${b.handle}${b.creators.length > 1 ? ` (paid ${b.creators.length} creators you'd know)` : ""}`);
  return `brands that paid creators in your lane this month: ${top.join(", ")}. want me to look into ${brands.length > 1 ? "one of them" : "them"}? i'll check what they actually pay for and how to get in.`;
}

export const offerInputs = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ open: boolean; known: Array<{ brandDomain: string; brand?: string }>; excluded: string[]; timezone: string } | null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return null;
    const rows = (await ctx.db.query("partnershipOpportunities").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).take(200)) as Doc<"partnershipOpportunities">[];
    const prof = (await ctx.db.query("partnershipProfiles").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).unique()) as Doc<"partnershipProfiles"> | null;
    const p = Profile.parse(prof?.data ?? {});
    return { open: partnershipsOpen(c) && !p.paused, known: rows.map((r) => ({ brandDomain: r.brandDomain, brand: (r.data as { brand?: string }).brand })), excluded: p.excludedBrands, timezone: c.timezone };
  },
});

/** One creator's weekly offer: partner tier, something new to offer, the rails, once a week. */
export const offerOne = internalAction({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ sent: boolean; reason: string }> => {
    const inp = await ctx.runQuery(internal.partnerships.kit.offerInputs, { creatorId: a.creatorId });
    if (!inp?.open) return { sent: false, reason: "partnerships not on their plan" };
    const brands = offerable(await ctx.runQuery(internal.partnerships.signals.laneBrands, { creatorId: a.creatorId }), inp.known, inp.excluded);
    if (!brands.length) return { sent: false, reason: "nothing new paying their lane" };
    const rails = await ctx.runQuery(internal.scout.gate.railsOnly, { creatorId: a.creatorId, now: Date.now() });
    if (!rails?.ok) return { sent: false, reason: rails?.reason ?? "rails" };
    const week = weekKey(Date.now(), inp.timezone);
    const r = await ctx.runMutation(internal.core.messages.send, { creatorId: a.creatorId, surface: "telegram", body: offerText(brands), dedupeKey: `partner-week:${week}`, proactive: true, capped: true, kind: "partnership" });
    return { sent: r.sent, reason: r.held ?? (r.sent ? "offered" : "already offered this week") };
  },
});

/** Pure: the ISO-ish week of their local day (a Monday key), so the offer is once a week on their clock. */
export function weekKey(now: number, timezone: string): string {
  const day = dayKeyInZone(now, timezone);
  const d = new Date(`${day}T00:00:00Z`);
  const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000);
  return monday.toISOString().slice(0, 10);
}

/** Daily; each creator is offered at most once per their week (the dedupe key), within the rails. */
export const offerAll = internalAction({
  args: {},
  handler: async (ctx): Promise<{ scheduled: number }> => {
    const ids: Id<"creators">[] = await ctx.runQuery(internal.partnerships.kit.partnerCreators, {});
    for (const [i, creatorId] of ids.entries()) await ctx.scheduler.runAfter(i * 2_000, internal.partnerships.kit.offerOne, { creatorId });
    return { scheduled: ids.length };
  },
});

export const partnerCreators = internalQuery({
  args: {},
  handler: async (ctx): Promise<Id<"creators">[]> => {
    const rows = (await ctx.db.query("schedule").withIndex("by_paired_status", (q) => q.eq("paired", true)).collect()) as Doc<"schedule">[];
    const out: Id<"creators">[] = [];
    for (const r of rows) {
      if (r.isEval || !["active", "trialing", "comped"].includes(r.status)) continue;
      const c = (await ctx.db.get(r.creatorId)) as Doc<"creators"> | null;
      if (c && partnershipsOpen(c)) out.push(c._id);
    }
    return out;
  },
});
