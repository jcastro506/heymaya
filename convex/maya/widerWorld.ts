/**
 * The wider-world sweep (§5.2 sweep 6) — what happened in this niche this week.
 *
 * The last of the six sweeps to have a caller. Weekly, not daily: this answers
 * *"what's going on in this world"*, which does not change hourly, and each run
 * is a grounded search rather than a cheap keyword hit.
 *
 * ## ⭐ Grounded or silent, enforced rather than hoped for
 *
 * A grounded search that returns prose with no citations is worse than one
 * that returns nothing: it reads exactly like a finding. §2.7 forbids
 * publishing it, and §7.5.2 would call it filler — but nothing downstream can
 * tell, because a confident paragraph looks the same either way.
 *
 * So a result with zero sources is discarded here, at the door, and reported
 * as a failure rather than an empty week.
 *
 * That is not theoretical. `geminiGroundedSearch` defaulted to
 * `maxOutputTokens: 1024`, and at that budget the citations — which the API
 * emits AFTER the prose — were truncated away. Live, the same query returned:
 *
 *   1024 tokens → finishReason MAX_TOKENS, 0 groundingChunks, fluent summary
 *   4000 tokens → finishReason STOP, 7 chunks (indiehackers.com, reddit.com)
 *
 * The wrapper is fixed. This gate exists because the next silent truncation
 * will not announce itself either.
 */

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";

/** Below this, the answer isn't grounded enough to act on. */
export const MIN_SOURCES = 2;

/**
 * The questions worth asking weekly.
 *
 * Deliberately about the BUYER and the WORLD, not about us. "What is happening
 * in <niche>" returns press releases; "what are people complaining about"
 * returns people.
 */
export function buildQueries(niche: string): string[] {
  return [
    `what are ${niche} complaining about this week`,
    `what changed for ${niche} recently that they are reacting to`,
    `what are ${niche} asking for help with right now`,
  ];
}

export interface WorldFinding {
  question: string;
  summary: string;
  sourceUrls: string[];
  /**
   * ⭐ The domains, which are the citable part.
   *
   * Gemini's `uri` is an opaque redirect —
   * `vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQ…` — and a
   * founder shown that learns nothing. The chunk's `title` carries the real
   * host (`indiehackers.com`, `reddit.com`), so that is what she quotes.
   *
   * ⚠️ The wrapper's `author` field is `domainOf(url)`, which on these results
   * is the REDIRECT's domain. Using it would have her citing Google for
   * everything.
   */
  sources: string[];
}

/**
 * Read the week, and refuse anything that can't cite itself.
 */
export const sweepWiderWorld = internalAction({
  args: {
    customerId: v.id("customers"),
    now: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    ok: boolean;
    findings: WorldFinding[];
    ungrounded: number;
    detail: string;
  }> => {
    const truth = await ctx.runQuery(internal.maya.productTruth.forCustomer, {
      customerId: args.customerId,
    });
    /**
     * The audience phrase, not the product name. Searching "HeyMaya" returns
     * us; searching "indie founders who can't get users" returns the world we
     * are supposed to be reading.
     */
    const niche = truth?.whoItsFor?.trim();
    if (!niche) {
      return {
        ok: false,
        findings: [],
        ungrounded: 0,
        detail: "I don't know who this is for yet",
      };
    }

    const { geminiGroundedSearch } = await import(
      "../integrations/gemini/groundedSearch"
    );

    const findings: WorldFinding[] = [];
    let ungrounded = 0;

    for (const question of buildQueries(niche)) {
      try {
        const result = await geminiGroundedSearch(question);
        const urls = [
          ...new Set(
            result.items
              .map((i) => i.url)
              .filter((u): u is string => typeof u === "string" && u.length > 0)
          ),
        ];
        // `title` is the real host; `url` is Google's redirect. See WorldFinding.
        const sources = [
          ...new Set(
            result.items
              .map((i) => i.title)
              .filter((t): t is string => typeof t === "string" && t.length > 0)
          ),
        ];

        /**
         * ⭐ The gate. Fewer than two sources and this is one model's
         * impression of the week, which is exactly what a product built on
         * "grounded or silent" must not carry into a post.
         */
        if (urls.length < MIN_SOURCES) {
          ungrounded += 1;
          continue;
        }

        const summary = result.items
          .map((i) => i.excerpt ?? "")
          .filter(Boolean)
          .join(" ")
          .slice(0, 1_200);
        if (!summary) {
          ungrounded += 1;
          continue;
        }

        findings.push({ question, summary, sourceUrls: urls, sources });
      } catch (error) {
        console.error(`[wider-world] "${question}" failed: ${String(error)}`);
        ungrounded += 1;
      }
    }

    return {
      ok: findings.length > 0,
      findings,
      ungrounded,
      /**
       * ⚠️ An ungrounded count is reported, never hidden. "Nothing happened
       * this week" and "I asked three times and couldn't cite an answer" are
       * different weeks, and only one of them is about the niche.
       */
      detail:
        findings.length === 0
          ? `asked ${buildQueries(niche).length} questions and couldn't source an answer to any of them`
          : `${findings.length} grounded findings${ungrounded > 0 ? `, ${ungrounded} unciteable and dropped` : ""}`,
    };
  },
});
