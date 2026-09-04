/**
 * Growing the watchlist from the lane (plan §13.9).
 *
 * ⚠️ THE GAP THIS FILLS. The roster was set once at onboarding and never grew. Onboarding
 * asks for three handles and offers suggestions from two sources, and BOTH are unreliable:
 * `discover.creators` maps to TikTok's Creative Center, which is down at the vendor, and
 * `account.following` needs the creator's following list to be public. So a creator who
 * cannot name three accounts from memory ends up watching almost nobody, forever, and a
 * thin roster is the single biggest cause of her having nothing to say.
 *
 * The fix uses evidence we already collect. The lane sweep records every top-of-lane post
 * for their keywords, including its author. An account that keeps appearing at the top of
 * someone's lane is, by definition, worth watching. So: count the authors, and when one
 * recurs with real numbers, offer it once with a button.
 *
 * Deliberately conservative. One offer at a time, never while another question is open,
 * and only for an account seen on several different days — a single viral post is luck,
 * not a creator worth following.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { addTracked } from "../agent/manage";

export const ROSTER = {
  /** Below this, she is actively short of accounts and should ask sooner. */
  thin: 6,
  /** Never grow past this on her own; beyond it the creator should be choosing. */
  max: 15,
  /** Distinct days an author must appear on before being offered. One viral post is luck. */
  minDays: 2,
  windowDays: 14,
  /**
   * The candidate's median must be at least this fraction of the creator's own normal.
   *
   * ⚠️ Without it, ranking by consistency alone put a 6,474-view account above a 955,927-view
   * one, because the small account posted on four days and the big one on two. An account
   * doing a fraction of your numbers has nothing to teach you, however reliably it posts.
   */
  minScaleOfOwn: 0.5,
} as const;

export interface Candidate { handle: string; posts: number; days: number; medianViews: number }

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Who keeps showing up in this creator's lane and is not already on the list. */
export const candidatesFor = internalQuery({
  args: { creatorId: v.id("creators"), now: v.number() },
  handler: async (ctx, a): Promise<{ candidates: Candidate[]; tracked: number }> => {
    const creator = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!creator) return { candidates: [], tracked: 0 };

    const tracked = (await ctx.db.query("trackedAccounts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"trackedAccounts">[];
    const active = tracked.filter((t) => t.status === "active");
    // Anything they already removed, or that she already retired, must never be offered again.
    const known = new Set(tracked.map((t) => t.handle.toLowerCase()));
    for (const h of Object.values(creator.handles)) if (h) known.add(String(h).toLowerCase());

    const keywords = ((creator.dossier as { keywords?: string[] } | undefined)?.keywords ?? []).map((k) => k.toLowerCase());
    const since = a.now - ROSTER.windowDays * 86_400_000;
    const rows = (await ctx.db.query("observations").withIndex("by_sampledAt", (q) => q.gte("sampledAt", since)).take(1000)) as Doc<"observations">[];

    const byAuthor = new Map<string, { views: number[]; days: Set<string>; posts: Set<string> }>();
    for (const r of rows) {
      const handle = (r.authorHandle ?? "").toLowerCase().replace(/^@/, "");
      if (!handle || known.has(handle)) continue;
      // Their lane, not the whole platform: the post must carry one of their keywords.
      if (keywords.length && !r.keywords.some((k) => keywords.includes(k.toLowerCase()))) continue;
      const e = byAuthor.get(handle) ?? { views: [], days: new Set<string>(), posts: new Set<string>() };
      e.views.push(r.views);
      /**
       * ⚠️ The day they POSTED, not the day we sampled. Counting sample days meant one
       * viral post seen on two consecutive sweeps looked like an account posting
       * repeatedly — which is precisely the case this is supposed to exclude. Caught by
       * running it against a real lane: a single 1.28M-view post scored two days.
       */
      e.days.add(new Date(r.createTime).toISOString().slice(0, 10));
      e.posts.add(r.postId);
      byAuthor.set(handle, e);
    }

    // Their own normal, to judge whether a candidate is even in their weight class.
    const ownPosts = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(20)) as Doc<"ownPosts">[];
    const ownNormal = median(ownPosts.map((p) => p.metrics.views).filter((v) => v > 0));
    const floor = ownNormal > 0 ? ownNormal * ROSTER.minScaleOfOwn : 0;

    const candidates = [...byAuthor.entries()]
      .map(([handle, e]) => ({ handle, posts: e.posts.size, days: e.days.size, medianViews: median(e.views) }))
      // Both: two posts on two different days. One post cannot satisfy this however it is sampled.
      .filter((c) => c.days >= ROSTER.minDays && c.posts >= ROSTER.minDays)
      .filter((c) => c.medianViews >= floor)
      // Consistency AND reach: days as the primary weight, but scaled by how big they are,
      // so four small posts do not beat two that actually landed.
      .sort((x, y) => y.days * Math.log10(1 + y.medianViews) - x.days * Math.log10(1 + x.medianViews));

    return { candidates, tracked: active.length };
  },
});

export const accept = internalMutation({
  args: { creatorId: v.id("creators"), handle: v.string() },
  handler: async (ctx, a): Promise<{ ok: boolean; error?: string }> => {
    const existing = (await ctx.db.query("trackedAccounts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"trackedAccounts">[];
    // The same rule as the web control and the chat: one way to join the roster.
    return await addTracked(ctx as never, a.creatorId, "tiktok", a.handle, existing);
  },
});

/** Offer one account, to one creator, with a button. Silent when there is nothing worth asking. */
export const offer = internalAction({
  args: { creatorId: v.id("creators"), now: v.optional(v.number()) },
  handler: async (ctx, a): Promise<{ offered: string | null; reason: string }> => {
    const now = a.now ?? Date.now();
    const g = await ctx.runQuery(internal.scout.gate.railsFor, { creatorId: a.creatorId, now });
    if (!g) return { offered: null, reason: "creator not found" };
    // Never talk over an idea or an open question. This is the least urgent thing she does.
    if (!g.rails.ok) return { offered: null, reason: g.rails.reason ?? "rails" };

    const { candidates, tracked } = await ctx.runQuery(internal.scout.roster.candidatesFor, { creatorId: a.creatorId, now });
    if (tracked >= ROSTER.max) return { offered: null, reason: `already watching ${tracked}` };
    if (candidates.length === 0) return { offered: null, reason: "nobody recurring in their lane yet" };
    // When the roster is healthy, only a genuinely strong recurrer is worth interrupting for.
    const pick = tracked < ROSTER.thin ? candidates[0] : candidates.find((c) => c.days >= 3) ?? null;
    if (!pick) return { offered: null, reason: `roster is healthy (${tracked}) and nobody stands out` };

    const sent = await ctx.runMutation(internal.core.messages.send, {
      creatorId: a.creatorId,
      surface: "telegram",
      body: `@${pick.handle} keeps coming up in your lane — ${pick.posts} posts on ${pick.days} different days, median ${pick.medianViews.toLocaleString()} views. want me to watch them?`,
      // One ask per account, ever.
      dedupeKey: `roster:${pick.handle}`,
      proactive: true,
      kind: "status",
      /**
       * ⚠️ NOT an open question. "At most one open question" exists so the creator is never
       * holding two pending decisions, and an optional offer is not a pending decision: if
       * they never tap it, nothing is lost, and the dedupe key means it is asked once. It
       * held the slot until 2026-09-04, which blocked the next offer behind an unanswered
       * idea and inverted the priority — the idea matters, this does not.
       */
      awaitingAnswer: false,
      buttons: [{ id: `roster:${pick.handle}:yes`, label: "watch them" }, { id: `roster:${pick.handle}:no`, label: "no" }],
    });
    /**
     * The dedupe key means asking twice writes nothing, so trust `sent` rather than the
     * fact that we called send. Reporting an offer that was silently deduped made the
     * caller's count a lie.
     */
    if (!sent.sent) return { offered: null, reason: `already asked about @${pick.handle}` };
    return { offered: pick.handle, reason: `seen on ${pick.days} days` };
  },
});

/** The fleet pass. Runs after the sweep, so the lane is fresh. */
export const run = internalAction({
  args: {},
  handler: async (ctx): Promise<{ creators: number; offered: number }> => {
    const ids = (await ctx.runQuery(internal.scout.roster.paired, {})) as Id<"creators">[];
    let offered = 0;
    for (const creatorId of ids) {
      const r = await ctx.runAction(internal.scout.roster.offer, { creatorId });
      if (r.offered) offered++;
    }
    return { creators: ids.length, offered };
  },
});

export const paired = internalQuery({
  args: {},
  handler: async (ctx): Promise<Id<"creators">[]> =>
    ((await ctx.db.query("creators").take(500)) as Doc<"creators">[]).filter((c) => c.channel.paired && c.dossier).map((c) => c._id),
});
