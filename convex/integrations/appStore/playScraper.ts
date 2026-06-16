"use node";

/**
 * W1.3 — Google Play listing fetch (Node runtime).
 *
 * Isolated in a "use node" module because `google-play-scraper` (v10, ESM)
 * needs Node; the non-node app inspector reaches it via `ctx.runAction`. Play
 * has no public metadata API, so the lib parses the listing's embedded
 * AF_initDataCallback datasets (description/category/rating/screenshots) — the
 * `og:` meta tags are empty. Verified live 2026-06-15 against com.duolingo.
 *
 * Soft-fails to null on any scrape error (markup drift, network, not-found) so
 * onboarding degrades to grounded search instead of throwing.
 */

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import gplay from "google-play-scraper";
import {
  normalizePlayApp,
  type PlayAppResult,
  type StoreListing,
} from "./storeListing";

export const fetchPlayListingAction = internalAction({
  args: { packageName: v.string() },
  handler: async (_ctx, args): Promise<StoreListing | null> => {
    try {
      const app = await gplay.app({ appId: args.packageName });
      return normalizePlayApp(args.packageName, app as unknown as PlayAppResult);
    } catch {
      return null;
    }
  },
});
