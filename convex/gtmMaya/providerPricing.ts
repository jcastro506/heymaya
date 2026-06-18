/**
 * Provider-complete cost pricing for the GTM read layer.
 *
 * Phase-2 item ⓪ — PROVIDER-COMPLETE COST METERING. Today the high-frequency
 * READ providers (ScrapeCreators / TwitterAPI.io / DataForSEO) frequently log
 * `costUsd: 0` in gtmCostLedger, so the COGS model + the (coming) discovery
 * budget gate are fiction. This module is the single source of truth for what a
 * READ call actually costs, priced from the sourced unit rates in
 * `docs/COGS_PRICING_REFERENCE.md`.
 *
 * Pure + deterministic + no Convex deps → unit-testable in isolation. The
 * server prices a ledger row by calling `priceUsd(provider, units, operation)`
 * inside `recordCost` when a metered read provider logs `costUsd: 0`.
 *
 * Token-priced providers (gemini / openrouter) are ALREADY metered upstream via
 * openrouterSpend (usage.costUsd is passed through verbatim). We do NOT re-price
 * them here — `priceUsd` returns the passed-through cost (when supplied via the
 * `units` channel is irrelevant for them) or 0. Never double-charge tokens.
 */

// ── Sourced unit rates ──────────────────────────────────────────────────────

/** ScrapeCreators Freelance tier — flat per-call. cost = callCount × this. */
export const SCRAPECREATORS_PER_CALL_USD = 0.00188;

/**
 * TwitterAPI.io — per RETURNED tweet. A call that returns N tweets costs
 * N × this, with a hard 15-credit (== $0.00015) per-call floor so a zero-result
 * call still records its real minimum spend instead of $0.
 */
export const X_API_PER_TWEET_USD = 0.00015;
export const X_API_CALL_FLOOR_USD = 0.00015;

/** DataForSEO SERP Google Organic (Standard) — flat per request. */
export const DATAFORSEO_SERP_PER_REQ_USD = 0.0006;
/** DataForSEO Labs — flat per request, plus a per-keyword adder. */
export const DATAFORSEO_LABS_PER_REQ_USD = 0.01;
export const DATAFORSEO_LABS_PER_KEYWORD_USD = 0.0001;

/** Creatify — per credit. Listed for completeness; not a read provider. */
export const CREATIFY_PER_CREDIT_USD = 0.1495;

/**
 * Returns the real USD cost of a single ledger event for a READ provider.
 *
 * @param provider  the gtmCostLedger.provider literal (or "dataforseo" even
 *                   though the ledger union does not include it — DataForSEO
 *                   reads currently log under "scrapecreators"/"other", so we
 *                   also key off the operation string, see below).
 * @param units     the real countable unit for this provider:
 *                     - scrapecreators → number of calls made (default 1)
 *                     - x_api          → number of tweets RETURNED
 *                     - dataforseo     → number of keywords (Labs only)
 * @param operation the gtmCostLedger.operation string. Used to disambiguate
 *                   DataForSEO SERP vs Labs (operation contains "labs"), and to
 *                   detect DataForSEO reads that were logged under a non-dfs
 *                   provider literal.
 *
 * Pure + deterministic. Unknown / unpriced providers → 0.
 */
export function priceUsd(
  provider: string,
  units?: number,
  operation?: string
): number {
  const op = (operation ?? "").toLowerCase();
  const p = (provider ?? "").toLowerCase();

  // DataForSEO can arrive under provider "dataforseo" OR be mislabeled
  // "scrapecreators"/"other" by an older call site — detect by operation too.
  const isDataForSeo =
    p === "dataforseo" || op.includes("dataforseo") || op.includes("search_demand");
  if (isDataForSeo) {
    if (op.includes("labs")) {
      const keywordCount = Math.max(0, Math.floor(units ?? 0));
      return (
        DATAFORSEO_LABS_PER_REQ_USD +
        DATAFORSEO_LABS_PER_KEYWORD_USD * keywordCount
      );
    }
    // SERP Google Organic (Standard) — flat per request.
    return DATAFORSEO_SERP_PER_REQ_USD;
  }

  switch (p) {
    case "scrapecreators": {
      // callCount defaults to 1 per request when not supplied.
      const callCount = units == null ? 1 : Math.max(0, units);
      return SCRAPECREATORS_PER_CALL_USD * callCount;
    }
    case "x_api": {
      // Per returned tweet, with a per-call floor (0 tweets → floor, not 0).
      const tweets = Math.max(0, units ?? 0);
      return Math.max(X_API_CALL_FLOOR_USD, tweets * X_API_PER_TWEET_USD);
    }
    // Token-priced — already metered upstream via openrouterSpend. Never
    // re-price; the authoritative cost flows in verbatim on the ledger row.
    case "gemini":
    case "openrouter":
      return 0;
    default:
      // composio / openclaw / other / unknown — not a metered read provider
      // here. 0 means "this module has no rate"; the caller keeps whatever
      // explicit cost was passed.
      return 0;
  }
}
