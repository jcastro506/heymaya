/**
 * Trends screen queries.
 *
 * The Trends screen at `app/(creator)/trends/page.tsx` surfaces what Maya
 * picked up from her three intel-gathering crons:
 *   - 6pm daily niche scan        → trendObservations (source='niche-scan')
 *   - 9am daily competitor watch  → competitorObservations
 *   - 9am daily collab matchmaker → collabMatchLog
 *   - 7:30am industry intel       → trendObservations (source='industry-intel')
 *
 * Cross-tenant: same Clerk identity → creators row → creatorId chain as
 * Today/Performance/Plan. Plan-tier: `competitorWatch`, `collabMatches`,
 * and `industryIntel` are Pro+ behaviors per the playbook — Starter gets
 * an empty array (fail-closed but graceful so the UI hides the section).
 */

import { query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { planFeatures } from "./lib/planFeatures";

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const NICHE_RADAR_LIMIT = 30;
const COMPETITOR_LIMIT = 30;
const COLLAB_MATCH_LIMIT = 12;

async function getCurrentCreator(
  ctx: QueryCtx
): Promise<Doc<"creators"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("creators")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
    .first();
}

/**
 * Niche radar — last 30 niche-scan observations, newest first. Available
 * on every plan because the daily niche scan runs on every Maya (low
 * thinking, cheap to keep on Starter).
 *
 * Uses the `by_creator_and_source` index so we never over-fetch the cross-
 * source mix and discard rows in memory.
 */
export const nicheRadar = query({
  args: {},
  handler: async (ctx) => {
    const creator = await getCurrentCreator(ctx);
    if (!creator) return [];
    return await ctx.db
      .query("trendObservations")
      .withIndex("by_creator_and_source", (q) =>
        q.eq("creatorId", creator._id).eq("source", "niche-scan")
      )
      .order("desc")
      .take(NICHE_RADAR_LIMIT);
  },
});

/**
 * Competitor watch — last 30 peer observations, newest first. Pro+ behavior
 * per playbook § Competitor watch. Starter does not run this cron, but we
 * still fail-closed on the read (a downgrade-then-upgrade cycle would
 * otherwise surface stale rows from the Pro window).
 */
export const competitorWatch = query({
  args: {},
  handler: async (ctx) => {
    const creator = await getCurrentCreator(ctx);
    if (!creator) return [];
    if (planFeatures(creator).competitorWatchSlots === 0) return [];
    return await ctx.db
      .query("competitorObservations")
      .withIndex("by_creator_and_observedAt", (q) =>
        q.eq("creatorId", creator._id)
      )
      .order("desc")
      .take(COMPETITOR_LIMIT);
  },
});

/**
 * Collab matchmaker — latest unactioned (or pending) collab suggestions
 * Maya surfaced. Pro+ via `planFeatures.collabMatchEnabled`. UI renders
 * each as a card with "Send DM" link-out (no auto-DM per no-posting
 * principle).
 *
 * Filter `creatorActedOn === null OR 'pending'` — the dashboard is a fresh-
 * suggestions surface, not a history log.
 */
export const collabMatches = query({
  args: {},
  handler: async (ctx) => {
    const creator = await getCurrentCreator(ctx);
    if (!creator) return [];
    if (!planFeatures(creator).collabMatchEnabled) return [];

    const rows = await ctx.db
      .query("collabMatchLog")
      .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
      .order("desc")
      .take(COLLAB_MATCH_LIMIT * 2);
    return rows
      .filter(
        (r) => r.creatorActedOn === undefined || r.creatorActedOn === "pending"
      )
      .slice(0, COLLAB_MATCH_LIMIT);
  },
});

/**
 * Industry intel — last 14 days of `trendObservations` from the daily
 * industry-intel skill. Pro+ per playbook § Industry intel. Used as a
 * sidebar/section on the Trends screen.
 *
 * The cron writes one row per surfaced article; we cap by date rather
 * than count because some days produce nothing and others produce 5+.
 *
 * Uses `by_creator_and_source` to filter on industry-intel index-side,
 * then drops anything older than the 14-day cutoff. Industry-intel
 * frequency is bounded enough (~1-3/day) that scanning the per-source
 * desc-order rows is cheap.
 */
export const industryIntel = query({
  args: {},
  handler: async (ctx) => {
    const creator = await getCurrentCreator(ctx);
    if (!creator) return [];
    if (!planFeatures(creator).proactiveCronAll) return [];

    const cutoff = Date.now() - FOURTEEN_DAYS_MS;
    const rows = await ctx.db
      .query("trendObservations")
      .withIndex("by_creator_and_source", (q) =>
        q.eq("creatorId", creator._id).eq("source", "industry-intel")
      )
      .order("desc")
      .take(60);
    return rows.filter((r) => r.observedAt >= cutoff);
  },
});
