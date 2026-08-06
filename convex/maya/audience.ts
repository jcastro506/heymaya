/**
 * ⭐ Who the buyers actually are, and where they gather (§5.0.0).
 *
 * Sprint 4 lists *"the buyer map — audience-overlap discovery, community
 * discovery"* as a task row. Every piece of it existed and **nothing ran any of
 * it**:
 *
 * | piece | status before this file |
 * |---|---|
 * | `tiktok.followers()` | wrapped, zero callers |
 * | `tiktok.following()` | wrapped, zero callers |
 * | `computeAudienceOverlap()` | pure, zero callers |
 * | `discoverGathering()` | pure, zero callers |
 *
 * Four finished components and no runner — the defect shape this codebase
 * produces more than any other. This is the runner.
 *
 * ## The move, in two halves
 *
 * §5.0.0: **who follows the competitors *is* the ICP.** Someone following one
 * tracked account might be a customer, a rival, or a bot. Someone following
 * four is in the market. Then the second half: ask what *else* those people
 * follow, and the accounts that aren't competitors are where the niche
 * actually gathers — which is where a founder should be posting, as opposed to
 * where we assumed.
 *
 * ## Why this is TikTok-only for now
 *
 * `tiktok/user/followers` is the only follower-list endpoint we have. X's
 * equivalent exists in `twitterApiIo` and is not wired; Instagram and YouTube
 * expose nothing comparable. The map is still useful — it identifies *people*,
 * and a person found on TikTok is the same person to follow on X.
 *
 * ## ⚠️ MEASURED LIMIT — read §5.0.0a before trusting this
 *
 * Run live on 2026-08-06 it returned **one** ICP from five audiences. The
 * follower endpoint is `min_time` paginated and page one is 26–50 rows, so
 * this intersects ~30-person samples drawn from audiences of thousands: the
 * expected overlap is near zero, and deeper pagination does not rescue it
 * (ten pages each is 50 credits to sample 0.5% of a large account).
 *
 * The ranking is sound; the POOL is wrong. Sprint 5.7 replaces it with the
 * commenters `mineComplaints` already pulls for free — people demonstrably in
 * the niche and demonstrably talking, which a follower row does not prove.
 * `computeAudienceOverlap` stays exactly as it is and is applied to that pool.
 *
 * Until then this runs and caveats honestly rather than presenting one row as
 * a map.
 *
 * ## Cost, which is the reason for every cap in here
 *
 * One credit per handle, both directions. `COMPETITOR_SAMPLE` × 1 for the
 * follower pulls plus `ICP_SAMPLE` × 1 for the following pulls — 20 credits a
 * run at the current caps. Weekly, that is 80 a month per customer, and at 200
 * customers it is **16,000 a month against a balance that sits around 3,000**.
 *
 * ⚠️ So the caps are not tuning knobs, they are the cost model. Raising them is
 * a pricing decision, not a code change.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { computeAudienceOverlap, discoverGathering } from "./buyerMap";

/**
 * How many tracked accounts we sample the audience of.
 *
 * The overlap score is a fraction of THIS number, so it also sets the
 * resolution: with 5, a person following 2 scores 0.4. Fewer than 3 makes
 * "follows several competitors" meaningless.
 */
export const COMPETITOR_SAMPLE = 5;

/** How many of the identified ICP we ask "what else do you follow?". */
export const ICP_SAMPLE = 15;

/** Below this, an account is too small to be a useful gathering place. */
export const MIN_GATHERING_FOLLOWERS = 2;

export interface AudienceMap {
  /** Ranked people who follow several of the tracked accounts. */
  icp: Array<{ handle: string; overlapScore: number; followsCompetitors: string[] }>;
  /** Accounts the ICP watches that are NOT the competitors. */
  gathering: Array<{ handle: string; icpFollowers: number; share: number }>;
  competitorsSampled: string[];
  builtAt: number;
  /** Named when the map is thin, so a weak result is never read as a finding. */
  caveat?: string;
}

export const storeAudienceMap = internalMutation({
  args: { customerId: v.id("customers"), mapJson: v.string() },
  handler: async (ctx, args): Promise<null> => {
    const customer = (await ctx.db.get(args.customerId)) as Doc<"customers"> | null;
    if (!customer) return null;
    let existing: Record<string, unknown> = {};
    try {
      existing = customer.buyerJson ? JSON.parse(customer.buyerJson) : {};
    } catch {
      existing = {};
    }
    await ctx.db.patch(args.customerId, {
      // Merged, not replaced — `complaints` and `targets` live in the same blob
      // and an overwrite here would silently delete the buyer map's other half.
      buyerJson: JSON.stringify({
        ...existing,
        audience: JSON.parse(args.mapJson),
      }),
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const audienceFor = internalQuery({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args): Promise<AudienceMap | null> => {
    const customer = (await ctx.db.get(args.customerId)) as Doc<"customers"> | null;
    if (!customer?.buyerJson) return null;
    try {
      const parsed = JSON.parse(customer.buyerJson) as { audience?: AudienceMap };
      return parsed.audience ?? null;
    } catch {
      return null;
    }
  },
});

/**
 * Build the audience map.
 *
 * Every failure is named rather than thrown. A partial map is worth keeping —
 * three competitors read and two rate-limited still identifies real people —
 * and an exception here would retry work that has already been paid for.
 */
export const buildAudienceMap = internalAction({
  args: { customerId: v.id("customers"), now: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<
    | { ok: true; icp: number; gathering: number; credits: number; caveat?: string }
    | { ok: false; error: string }
  > => {
    const now = args.now ?? Date.now();
    const targets = await ctx.runQuery(internal.maya.learnBusiness.targetsFor, {
      customerId: args.customerId,
    });
    if (!targets) {
      return { ok: false, error: "no targets yet — learn-business hasn't run" };
    }

    // TikTok only: it is the one channel with a follower-list endpoint.
    // Ranked by keywordHits, because an account that keeps appearing under
    // several of our validated keywords is more central to the niche than one
    // that appeared once with high velocity.
    const competitors = targets.trackedAccounts
      .filter((a) => a.channel === "tiktok")
      .sort((a, b) => b.keywordHits - a.keywordHits)
      .slice(0, COMPETITOR_SAMPLE);

    if (competitors.length < 2) {
      // Overlap across one account is not overlap. Saying so beats writing a
      // map whose scores are all 1.0 and mean nothing.
      return {
        ok: false,
        error: `only ${competitors.length} tracked TikTok account(s) — overlap needs at least 2`,
      };
    }

    const { tiktok } = await import("../integrations/scrapeCreators/endpoints");

    let credits = 0;
    const audiences: Array<{ handle: string; followers: string[] }> = [];
    const failed: string[] = [];

    for (const competitor of competitors) {
      try {
        const res = await tiktok.followers(competitor.handle);
        credits += 1;
        audiences.push({
          handle: competitor.handle,
          followers: res.users
            .map((u) => u.handle)
            .filter((h): h is string => typeof h === "string" && h.length > 0),
        });
      } catch (error) {
        // One dead handle must not lose the other four reads we paid for.
        failed.push(competitor.handle);
        console.warn(
          `[audience] followers failed for @${competitor.handle}: ${String(error)}`
        );
      }
    }

    if (audiences.length < 2) {
      return {
        ok: false,
        error: `could only read ${audiences.length} audience(s) — not enough to compare`,
      };
    }

    const icp = computeAudienceOverlap({ competitors: audiences });

    // Second half: what else do these people watch?
    const sample = icp.slice(0, ICP_SAMPLE).map((p) => p.handle);
    const followingByHandle: Record<string, string[]> = {};
    for (const handle of sample) {
      try {
        const res = await tiktok.following(handle);
        credits += 1;
        followingByHandle[handle] = res.users
          .map((u) => u.handle)
          .filter((h): h is string => typeof h === "string" && h.length > 0);
      } catch (error) {
        console.warn(`[audience] following failed for @${handle}: ${String(error)}`);
      }
    }

    const gathering = discoverGathering({
      icpHandles: sample,
      followingByHandle,
      competitorHandles: audiences.map((a) => a.handle),
    }).filter((g) => g.icpFollowers >= MIN_GATHERING_FOLLOWERS);

    /**
     * ⚠️ A thin map must say so. The follower endpoint reads page one only, so
     * for a large account this is a sample rather than the audience — and a
     * ranked list of nine people presented without that caveat reads as a
     * finding when it is a hint.
     */
    const caveat =
      failed.length > 0
        ? `couldn't read ${failed.length} of ${competitors.length} audiences`
        : icp.length < 10
          ? "small sample — treat as a hint rather than a map"
          : undefined;

    const map: AudienceMap = {
      icp: icp.slice(0, 50),
      gathering: gathering.slice(0, 25),
      competitorsSampled: audiences.map((a) => a.handle),
      builtAt: now,
      caveat,
    };

    await ctx.runMutation(internal.maya.audience.storeAudienceMap, {
      customerId: args.customerId,
      mapJson: JSON.stringify(map),
    });

    return { ok: true, icp: map.icp.length, gathering: map.gathering.length, credits, caveat };
  },
});
