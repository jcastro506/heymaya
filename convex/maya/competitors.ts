/**
 * ⭐ Watching the accounts that keep showing up in this niche.
 *
 * The operator's idea, and the discovery half was already built: `rankAccounts`
 * ranks accounts by how many DIFFERENT validated keywords they appear under, so
 * nobody is ever asked to name their competitors. An account showing up beneath
 * two separate niche terms is in this world; one that appeared once is passing
 * traffic.
 *
 * ## ⭐ What earns a message
 *
 * Not "they posted". They post constantly, and a feed of that is a notification
 * setting, not an employee.
 *
 * **A post that materially beats their OWN baseline.** We already store each
 * tracked account's `medianVelocity` from discovery, so the question is
 * answerable without judgment: is this one pulling far harder than what they
 * normally pull? That is the moment a founder actually wants to know about,
 * because it means something worked and it can be studied.
 *
 * Comparing to their own median rather than to an absolute number matters — a
 * 10k-view account and a 200-view account both have breakout posts, and an
 * absolute floor only ever surfaces the big accounts, who are the least
 * comparable to a founder starting out.
 *
 * ## Cost
 *
 * One request per watched account per run. Capped at the accounts that appear
 * under more than one keyword — for the live customer that is 3 of 30 — and run
 * DAILY, not hourly. A watchlist that costs thirty requests to tell you nothing
 * is how a cheap read becomes a line item.
 */

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { velocity, toMillis } from "./learnBusiness";

/**
 * How far above their own median a post must pull to be worth a message.
 *
 * Deliberately high. Something twice their usual is a good day; something six
 * times their usual is a different kind of event, and only the second is worth
 * spending one of a handful of daily messages on.
 */
export const BREAKOUT_MULTIPLE = 6;

/** Only accounts that showed up under more than one niche keyword. */
export const MIN_KEYWORD_HITS = 2;

/** Nothing older than this is news, however well it did. */
export const BREAKOUT_WINDOW_MS = 3 * 86_400_000;

export interface Breakout {
  handle: string;
  channel: string;
  url: string;
  text: string;
  velocity: number;
  theirMedian: number;
  multiple: number;
}

/**
 * ⭐ Pure, so the decision is testable without a network.
 *
 * A zero or missing median means we never established what normal looks like
 * for this account — and without that, "outperforming" has no meaning. Those
 * are skipped rather than treated as infinitely surprising, which is what a
 * naive divide would do.
 */
export function isBreakout(
  postVelocity: number,
  theirMedian: number | undefined
): boolean {
  if (!theirMedian || theirMedian <= 0) return false;
  return postVelocity >= theirMedian * BREAKOUT_MULTIPLE;
}

export const watchCompetitors = internalAction({
  args: { customerId: v.id("customers"), now: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<{
    ok: boolean;
    watched: number;
    breakouts: Breakout[];
    detail: string;
  }> => {
    const now = args.now ?? Date.now();
    const targets = await ctx.runQuery(internal.maya.learnBusiness.targetsFor, {
      customerId: args.customerId,
    });
    if (!targets) {
      return { ok: false, watched: 0, breakouts: [], detail: "no niche worked out yet" };
    }

    const watchlist = (targets.trackedAccounts ?? []).filter(
      (a) => (a.keywordHits ?? 0) >= MIN_KEYWORD_HITS && a.channel === "tiktok"
    );
    if (watchlist.length === 0) {
      return {
        ok: true,
        watched: 0,
        breakouts: [],
        detail: "nobody shows up under enough of this niche's terms to be worth watching yet",
      };
    }

    const { tiktok } = await import(
      "../integrations/scrapeCreators/platforms/tiktok"
    );

    const breakouts: Breakout[] = [];
    for (const account of watchlist) {
      try {
        const posts = await tiktok.lastPosts(account.handle, 10);
        for (const post of posts) {
          const ms = toMillis(post.postedAt);
          if (!ms || now - ms > BREAKOUT_WINDOW_MS) continue;
          const v = velocity(post.metrics, post.postedAt, now);
          if (!isBreakout(v, account.medianVelocity)) continue;

          breakouts.push({
            handle: account.handle,
            channel: account.channel,
            url:
              post.url ??
              `https://www.tiktok.com/@${account.handle}/video/${post.postId}`,
            text: post.caption ?? "",
            velocity: v,
            theirMedian: account.medianVelocity ?? 0,
            multiple: Math.round(v / (account.medianVelocity || 1)),
          });
        }
      } catch (error) {
        // One unreachable account never costs the whole watch.
        console.error(`[competitors] ${account.handle} failed: ${String(error)}`);
      }
    }

    // Loudest first — if only one message gets sent, it should be the biggest.
    breakouts.sort((a, b) => b.multiple - a.multiple);

    return {
      ok: true,
      watched: watchlist.length,
      breakouts,
      /**
       * A quiet watchlist is the normal case and says so. "Nobody broke out"
       * is a real answer; a watcher that only ever speaks when it has news
       * looks broken on the days it doesn't.
       */
      detail:
        breakouts.length === 0
          ? `watched ${watchlist.length} accounts, nothing unusual`
          : `${breakouts.length} posts pulling well above their usual`,
    };
  },
});
