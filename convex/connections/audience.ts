/**
 * A1 part 2: what she may say about their ACCOUNT — who follows them and what's growing — from
 * the rows the account-insights sync wrote. Grounded: every number is a stored row, labelled
 * "connected" with its platform and age; what a platform doesn't give is said once, plainly.
 * The per-post equivalent is `numbers.ts`.
 */

import { v } from "convex/values";
import { internalQuery, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { countryName, GENDER_WORDS } from "./accountInsights";

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

/** Pure given the rows. */
export function accountFacts(
  platform: "tiktok" | "instagram",
  connected: boolean,
  rows: { insights: Doc<"accountInsights"> | null; audience: Doc<"accountInsights"> | null; snaps: Doc<"followerSnapshots">[] },
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

  if (platform === "instagram") {
    const ins = rows.insights;
    const m = ins?.status === "ok" ? ins.metrics ?? {} : {};
    const parts: string[] = [];
    if (m.reach !== undefined) parts.push(`reached ${n(m.reach)} accounts`);
    if (m.views !== undefined) parts.push(`${n(m.views)} views`);
    if (m.accountsEngaged !== undefined) parts.push(`${n(m.accountsEngaged)} accounts engaged`);
    if (m.totalInteractions !== undefined) parts.push(`${n(m.totalInteractions)} interactions`);
    if (m.profileLinkTaps !== undefined) parts.push(`${n(m.profileLinkTaps)} taps on the link in their profile`);
    if (m.follows !== undefined) parts.push(`${n(m.follows)} follows`);
    if (m.unfollows !== undefined) parts.push(`${n(m.unfollows)} unfollows`);
    if (ins && parts.length) lines.push(`whole account, ${ins.fromDate ?? "last 30 days"} to ${ins.toDate ?? "now"}: ${parts.join(", ")} (connected, Instagram, ${age(ins.fetchedAt)}; Instagram runs up to 2 days behind)`);
    if (ins?.reachDaily) {
      const wow = weekOverWeek(ins.reachDaily);
      if (wow) lines.push(`reach: ${n(wow.last)} this past week vs ${n(wow.prior)} the week before (connected, Instagram)`);
    }
    if (!ins || ins.status !== "ok") cannotKnow.push(ins?.status === "not_available" ? "Instagram's account numbers (reach, profile taps, follows): not available for this account" : "Instagram's account numbers (reach, profile taps, follows): not reported yet");
    else if (m.profileLinkTaps === undefined) cannotKnow.push("taps on the link in their profile: Instagram didn't report it");

    const aud = rows.audience;
    if (aud?.status === "ok" && aud.audience) {
      const a = aud.audience;
      const bits: string[] = [];
      const top = (xs: Array<{ label: string; share: number | null }> | undefined, k: number, word: (s: string) => string) => (xs ?? []).filter((x) => x.share !== null).slice(0, k).map((x) => `${word(x.label)} ${pct(x.share!)}`).join(", ");
      if (a.gender?.length) bits.push(top(a.gender, 3, (s) => GENDER_WORDS[s] ?? s));
      if (a.age?.length) bits.push(`ages ${top([...a.age].sort((x, y) => (y.share ?? 0) - (x.share ?? 0)), 3, (s) => s)}`);
      if (a.country?.length) bits.push(`top countries ${top(a.country, 3, countryName)}`);
      if (a.city?.length) bits.push(`top cities ${top(a.city, 3, (s) => s)}`);
      const said = bits.filter(Boolean);
      if (said.length) lines.push(`who follows them: ${said.join("; ")} (connected, Instagram, ${age(aud.fetchedAt)}${aud.audienceBase ? `, ${n(aud.audienceBase)} followers counted` : ""})`);
    } else {
      cannotKnow.push(aud?.status === "too_few_followers" ? "who follows them on Instagram: Instagram only shares this from 100 followers" : aud?.status === "not_available" ? "who follows them on Instagram: not available for this account" : "who follows them on Instagram: not reported yet");
    }
  } else {
    cannotKnow.push("on TikTok, account-wide reach and who follows them (age, gender, places): TikTok doesn't give these for an account; per-post viewer splits come with each post's numbers");
  }
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
  const insights = (await ctx.db.query("accountInsights").withIndex("by_creator_kind", (q) => q.eq("creatorId", creatorId).eq("kind", "insights")).take(20)) as Doc<"accountInsights">[];
  const audience = (await ctx.db.query("accountInsights").withIndex("by_creator_kind", (q) => q.eq("creatorId", creatorId).eq("kind", "audience")).take(20)) as Doc<"accountInsights">[];
  const since = new Date(now - 95 * 86_400_000).toISOString().slice(0, 10);
  const snaps = (await ctx.db.query("followerSnapshots").withIndex("by_creator_day", (q) => q.eq("creatorId", creatorId).gte("day", since)).take(400)) as Doc<"followerSnapshots">[];
  const platforms = (["tiktok", "instagram"] as const).filter((p) => creator.handles[p] || (conn?.zernioAccounts ?? []).some((x) => x.platform === p));
  return platforms.map((p) => {
    const acct = (conn?.zernioAccounts ?? []).find((x) => x.platform === p);
    const connected = Boolean(conn && conn.status !== "disconnected" && acct && acct.canFetchAnalytics && !acct.needsReconnect);
    const byAcct = <T extends { accountId: string; platform: string }>(xs: T[]) => xs.filter((x) => x.platform === p && (!acct || x.accountId === acct.accountId));
    return accountFacts(p, connected, { insights: byAcct(insights)[0] ?? null, audience: byAcct(audience)[0] ?? null, snaps: byAcct(snaps) }, now);
  });
}

// ------------------------------------------------------------------ the app

export type CardStatus = "ok" | "not_connected" | "too_few_followers" | "not_reported" | "not_available";
const cardStatus = (connected: boolean, row: Doc<"accountInsights"> | null): CardStatus =>
  !connected ? "not_connected" : !row ? "not_reported" : row.status === "ok" ? "ok" : row.status;

const APP_GENDER: Record<string, string> = { F: "Women", M: "Men", U: "Not specified" };

/**
 * Pure: the account's growth chart, "From your profile" and "Who follows you" for the app.
 * Only stored numbers; a card with nothing carries its status so the app can say why in words.
 */
export function appCards(
  platform: "tiktok" | "instagram",
  connected: boolean,
  rows: { insights: Doc<"accountInsights"> | null; audience: Doc<"accountInsights"> | null; snaps: Doc<"followerSnapshots">[] },
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

  if (platform !== "instagram") return { growth, profile: null, audience: null };

  const ins = rows.insights;
  const m = ins?.status === "ok" ? ins.metrics ?? {} : {};
  const num = (k: string) => (m[k] !== undefined ? m[k] : null);
  const profile = {
    status: cardStatus(connected, ins),
    fromDate: ins?.status === "ok" ? ins.fromDate ?? null : null,
    toDate: ins?.status === "ok" ? ins.toDate ?? null : null,
    asOf: ins?.status === "ok" ? ins.fetchedAt : null,
    profileLinkTaps: num("profileLinkTaps"),
    follows: num("follows"),
    unfollows: num("unfollows"),
    reach: num("reach"),
    accountsEngaged: num("accountsEngaged"),
  };

  const aud = rows.audience;
  const a = aud?.status === "ok" ? aud.audience ?? {} : {};
  const shares = (xs: Array<{ label: string; share: number | null }> | undefined, word: (s: string) => string, k: number) =>
    (xs ?? []).filter((x): x is { label: string; share: number } => x.share !== null && x.share > 0).slice(0, k).map((x) => ({ label: word(x.label), share: x.share }));
  const audience = {
    status: cardStatus(connected, aud),
    asOf: aud?.status === "ok" ? aud.fetchedAt : null,
    followersCounted: aud?.status === "ok" ? aud.audienceBase ?? null : null,
    gender: shares(a.gender, (s) => APP_GENDER[s] ?? s, 3),
    age: shares(a.age, (s) => s, 8), // youngest first, as stored
    countries: shares(a.country, countryName, 5),
    cities: shares(a.city, (s) => s, 5),
  };
  return { growth, profile, audience };
}
