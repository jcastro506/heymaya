/**
 * A1 part 2: what she may say about their ACCOUNT — who follows them and what's growing — from
 * the rows the account-insights sync wrote. Grounded: every number is a stored row, labelled
 * "connected" with its platform and age; what a platform doesn't give is said once, plainly.
 * The per-post equivalent is `numbers.ts`.
 */

import { enabledPlatforms } from "../config/platforms";
import { v } from "convex/values";
import { internalQuery, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { countryName } from "./accountInsights";

export interface AccountFacts {
  platform: "tiktok" | "instagram";
  connected: boolean;
  lines: string[];
  cannotKnow: string[];
}

const PLATFORM_WORD = { tiktok: "TikTok", instagram: "Instagram" } as const;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const n = (x: number) => Math.round(x).toLocaleString("en-US");

/** Pure: last 7 days against the 7 before, when both weeks are complete. Null otherwise. */
export function weekOverWeek(values: Array<{ date: string; value: number }>): { last: number; prior: number } | null {
  if (values.length < 14) return null;
  const tail = values.slice(-14);
  const prior = tail.slice(0, 7).reduce((s, p) => s + p.value, 0);
  const last = tail.slice(7).reduce((s, p) => s + p.value, 0);
  return { last, prior };
}

export interface ViewerCountries { countries: Array<{ code: string; share: number }>; posts: number; views: number; asOf: number | null }

/**
 * Pure: where their TikTok viewers are, across their recent connected posts, weighted by each post's
 * views (TikTok reports the split per post, never for the account). Null when no post carried one.
 */
export function viewerCountriesAcross(posts: Array<{ views: number | null; viewerCountries?: Record<string, number> | null; asOf: number | null }>, top = 5): ViewerCountries | null {
  const usable = posts.filter((p) => p.viewerCountries && Object.keys(p.viewerCountries).length && (p.views ?? 0) > 0);
  if (!usable.length) return null;
  const totals = new Map<string, number>();
  let views = 0;
  for (const p of usable) {
    views += p.views!;
    for (const [k, s] of Object.entries(p.viewerCountries!)) if (/^[A-Za-z]{2}$/.test(k)) totals.set(k.toUpperCase(), (totals.get(k.toUpperCase()) ?? 0) + s * p.views!);
  }
  const countries = [...totals.entries()].map(([code, v]) => ({ code, share: Math.round((v / views) * 1000) / 1000 })).filter((x) => x.share >= 0.01).sort((a, b) => b.share - a.share).slice(0, top);
  if (!countries.length) return null;
  return { countries, posts: usable.length, views, asOf: usable.reduce<number | null>((m, p) => (p.asOf !== null && (m === null || p.asOf > m) ? p.asOf : m), null) };
}

/** Pure given the rows. */
export function accountFacts(
  platform: "tiktok" | "instagram",
  connected: boolean,
  rows: { snaps: Doc<"followerSnapshots">[]; viewerCountries?: ViewerCountries | null },
  now: number,
): AccountFacts {
  const P = PLATFORM_WORD[platform];
  const lines: string[] = [];
  const cannotKnow: string[] = [];
  if (!connected) {
    cannotKnow.push(`${P} isn't connected, so there are no account-level numbers: no follower history, no reach, no audience`);
    return { platform, connected, lines, cannotKnow };
  }
  const age = (t: number) => `read ${Math.max(0, Math.round((now - t) / 3_600_000))}h ago`;

  // Followers and their flow, from the daily snapshots.
  const snaps = [...rows.snaps].sort((a, b) => a.day.localeCompare(b.day));
  const latest = snaps.at(-1) ?? null;
  if (latest) lines.push(`${n(latest.followers)} followers on ${latest.day} (connected, ${P})`);
  const monthAgo = new Date(now - 29 * 86_400_000).toISOString().slice(0, 10);
  const month = snaps.filter((s) => s.day >= monthAgo);
  const withFlow = month.filter((s) => s.gained !== undefined || s.lost !== undefined);
  if (withFlow.length) {
    const g = withFlow.reduce((s, x) => s + (x.gained ?? 0), 0);
    const l = withFlow.reduce((s, x) => s + (x.lost ?? 0), 0);
    lines.push(`last 30 days: ${n(g)} followed, ${n(l)} unfollowed, net ${g - l >= 0 ? "+" : "−"}${n(Math.abs(g - l))} (connected, ${P}, from ${withFlow.length} days reported)`);
    const flowDays = snaps.filter((s) => s.gained !== undefined).map((s) => ({ date: s.day, value: s.gained ?? 0 }));
    const wow = weekOverWeek(flowDays);
    if (wow) lines.push(`new followers: ${n(wow.last)} this past week vs ${n(wow.prior)} the week before (connected, ${P})`);
  } else if (month.length >= 2) {
    const first = month[0], last = month.at(-1)!;
    lines.push(`followers ${first.day} → ${last.day}: ${n(first.followers)} → ${n(last.followers)} (connected, ${P}; daily follows and unfollows not reported)`);
  } else {
    cannotKnow.push(`follower growth on ${P}: not enough days recorded yet`);
  }

  cannotKnow.push("on TikTok, account-wide reach and who follows them (age, gender): TikTok doesn't give these for an account");
  // A2: TikTok splits viewers by country per post; across their recent posts that is where their viewers are.
  const vc = rows.viewerCountries;
  if (vc) lines.push(`where their TikTok viewers are, across ${vc.posts} recent post${vc.posts === 1 ? "" : "s"} (${n(vc.views)} views): ${vc.countries.map((x) => `${countryName(x.code)} ${pct(x.share)}`).join(", ")} (connected, TikTok${vc.asOf ? `, ${age(vc.asOf)}` : ""})`);
  else cannotKnow.push("where their TikTok viewers are: TikTok didn't report viewer countries for their recent posts");
  return { platform, connected, lines, cannotKnow };
}

/** Their accounts, read for her. Scoped to the creator; nothing from another creator's rows. */
export const forCreator = internalQuery({
  args: { creatorId: v.id("creators"), now: v.optional(v.number()) },
  handler: async (ctx, a): Promise<AccountFacts[]> => accountFactsFor(ctx, a.creatorId, a.now ?? Date.now()),
});

export async function accountFactsFor(ctx: Pick<QueryCtx, "db">, creatorId: Id<"creators">, now: number): Promise<AccountFacts[]> {
  const creator = (await ctx.db.get(creatorId)) as Doc<"creators"> | null;
  if (!creator) return [];
  const conn = (await ctx.db.query("connections").withIndex("by_creator", (q) => q.eq("creatorId", creatorId).eq("provider", "zernio")).first()) as Doc<"connections"> | null;
  const tiktokCountries = await tiktokViewerCountries(ctx, creatorId, now);
  const since = new Date(now - 95 * 86_400_000).toISOString().slice(0, 10);
  const snaps = (await ctx.db.query("followerSnapshots").withIndex("by_creator_day", (q) => q.eq("creatorId", creatorId).gte("day", since)).take(400)) as Doc<"followerSnapshots">[];
  const platforms = enabledPlatforms().filter((p) => creator.handles[p] || (conn?.zernioAccounts ?? []).some((x) => x.platform === p));
  return platforms.map((p) => {
    const acct = (conn?.zernioAccounts ?? []).find((x) => x.platform === p);
    const connected = Boolean(conn && conn.status !== "disconnected" && acct && acct.canFetchAnalytics && !acct.needsReconnect);
    const byAcct = <T extends { accountId: string; platform: string }>(xs: T[]) => xs.filter((x) => x.platform === p && (!acct || x.accountId === acct.accountId));
    return accountFacts(p, connected, { snaps: byAcct(snaps), viewerCountries: p === "tiktok" ? tiktokCountries : null }, now);
  });
}

/** Their recent connected TikTok posts' viewer countries, view-weighted (last 90 days, up to 60 posts). Shared by her tool and the kit. */
export async function tiktokViewerCountries(ctx: Pick<QueryCtx, "db">, creatorId: Id<"creators">, now: number): Promise<ViewerCountries | null> {
  const posts = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", creatorId).gte("createTime", now - 90 * 86_400_000)).order("desc").take(60)) as Doc<"ownPosts">[];
  return viewerCountriesAcross(posts.filter((p) => p.platform === "tiktok" && p.connected).map((p) => ({ views: p.connected!.views, viewerCountries: p.connected!.viewerCountries ?? null, asOf: p.connected!.asOf })));
}

// ------------------------------------------------------------------ the app

/**
 * Pure: the account's growth chart for the app. Only stored numbers. `profile` and `audience` are
 * always null (they were Instagram-only; TikTok gives neither for an account), kept so the app decodes.
 */
export function appCards(
  _platform: "tiktok" | "instagram",
  connected: boolean,
  rows: { snaps: Doc<"followerSnapshots">[] },
  now: number,
) {
  const since = new Date(now - 89 * 86_400_000).toISOString().slice(0, 10);
  const monthAgo = new Date(now - 29 * 86_400_000).toISOString().slice(0, 10);
  const days = [...rows.snaps].filter((s) => s.day >= since).sort((a, b) => a.day.localeCompare(b.day)).map((s) => ({ day: s.day, followers: s.followers, gained: s.gained ?? null, lost: s.lost ?? null }));
  const month = days.filter((d) => d.day >= monthAgo);
  const flowReported = month.some((d) => d.gained !== null || d.lost !== null);
  const growth = connected && days.length
    ? { days, flowReported, gained30d: flowReported ? month.reduce((s, d) => s + (d.gained ?? 0), 0) : null, lost30d: flowReported ? month.reduce((s, d) => s + (d.lost ?? 0), 0) : null }
    : null;
  return { growth, profile: null, audience: null };
}
