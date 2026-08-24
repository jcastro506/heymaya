/**
 * ⭐ WHAT SHE ACTUALLY DID, IN THE FOUNDER'S LANGUAGE.
 *
 * ⚠️ 111 COST EVENTS AND 182 JOBS, READ BY NOTHING. Audited on a live account
 * four days in: she had run 45 quality judgements, 22 trend reads, 15 idea
 * scorings, 9 format cards and 6 complaint minings — and the founder's only
 * signal about whether she was working was a watchdog announcing that nothing
 * had gone out. Their question, verbatim, was "so are you still doing stuff or".
 *
 * ⭐ THE LEDGER IS THE HONEST SOURCE. `costEvents` records work that ACTUALLY
 * HAPPENED and cost money — it cannot be talked into anything, cannot report an
 * intention, and cannot be padded. That is exactly the property a
 * "is she working?" answer needs, and it is why this reads spend rather than
 * her own account of her day.
 *
 * ⚠️ AND IT IS TRANSLATED, NEVER RELAYED. `ad_competitor_search_terms` is our
 * word. A founder reading our internals learns to think in our vocabulary
 * instead of their business, which is the same failure as her leaking tool
 * names into Telegram. Anything without a translation is DROPPED rather than
 * shown raw — an unnamed line is worse than a shorter list.
 */

import { v } from "convex/values";
import { query } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { dayKeyInZone } from "./cadence";

/**
 * Our purposes, in their words.
 *
 * ⚠️ A label table, not a judgement — this is the one place hardcoding is
 * right, because it maps OUR fixed vocabulary to plain English rather than
 * deciding anything about content.
 */
export const WORK_LABELS: Readonly<Record<string, string>> = {
  ad_competitor_search_terms: "worked out what to search for",
  ad_competitor_discover: "looked for who you compete with",
  ad_competitor_identify: "checked which pages are really them",
  ad_watch: "watched a competitor's ad",
  format_watch: "watched a video to see how it was made",
  keyword_proposal: "worked out how your buyers talk",
  keyword_relevance: "checked those terms reach real people",
  niche_screen: "read what's moving in your niche",
  trend_shape: "worked out which shapes are landing",
  format_card: "wrote down a format that works",
  complaint_mining: "read what buyers are complaining about",
  idea_scoring: "weighed up an idea",
  research_sweep: "read the wider web",
  product_read: "re-read your site",
  brand_register: "learned your register",
  voice_judge: "checked it sounds like you",
  filler_judge: "cut the filler",
  cringe_eval: "checked it isn't cringe",
  safety_critic: "safety-checked a post",
  behaviour_eval: "reviewed her own behaviour",
  directive_gate: "applied one of your rules",
  carousel_plan: "planned a carousel",
  carousel_critic: "critiqued a carousel",
  slide_background: "made a slide",
  video_script: "wrote a video script",
  adapt_crosspost: "rewrote it for another channel",
};

export interface WorkDay {
  /** `YYYY-MM-DD` in the founder's zone — never UTC. */
  day: string;
  items: Array<{ what: string; times: number }>;
  total: number;
}

/**
 * Group spend into days of work, newest first.
 *
 * Pure so the grouping is testable without a database — the timezone rule is
 * the part that has broken twice elsewhere in this codebase.
 */
export function groupWork(
  events: Array<{ at: number; purpose: string }>,
  timezone: string,
  dayLimit: number
): WorkDay[] {
  const byDay = new Map<string, Map<string, number>>();

  for (const e of events) {
    const label = WORK_LABELS[e.purpose];
    // Untranslated work is dropped, not shown raw. See the module docblock.
    if (!label) continue;
    const day = dayKeyInZone(e.at, timezone);
    if (!byDay.has(day)) byDay.set(day, new Map());
    const counts = byDay.get(day)!;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, dayLimit)
    .map(([day, counts]) => ({
      day,
      items: [...counts.entries()]
        .map(([what, times]) => ({ what, times }))
        .sort((a, b) => b.times - a.times),
      total: [...counts.values()].reduce((s, n) => s + n, 0),
    }));
}

/** How far back the feed looks. A fortnight is enough to see a rhythm. */
export const FEED_DAYS = 14;

export const myWork = query({
  args: { days: v.optional(v.number()) },
  handler: async (
    ctx
  ): Promise<{ ok: boolean; error?: string; days: WorkDay[] }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { ok: false, error: "sign in first", days: [] };

    const creator = (await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first()) as Doc<"creators"> | null;
    if (!creator) return { ok: false, error: "no account yet", days: [] };

    const customer = (await ctx.db
      .query("customers")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .first()) as Doc<"customers"> | null;
    if (!customer) return { ok: false, error: "no account yet", days: [] };

    /**
     * ⚠️ THE FOUNDER'S DAY, NOT UTC. A day boundary in the wrong zone has
     * already broken the recap dedupe and the daily message budget in this
     * codebase — the 20:00 recap on 2026-08-07 was filed as the 8th.
     */
    const timezone = customer.timezone ?? "UTC";
    const since = Date.now() - FEED_DAYS * 86_400_000;

    const events = (await ctx.db
      .query("costEvents")
      .withIndex("by_customer_and_at", (q) =>
        q.eq("customerId", customer._id).gte("at", since)
      )
      .collect()) as Doc<"costEvents">[];

    return { ok: true, days: groupWork(events, timezone, FEED_DAYS) };
  },
});
