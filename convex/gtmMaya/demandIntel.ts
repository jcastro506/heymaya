/**
 * Sprint 2 (top-tier) — demand intelligence via DataForSEO.
 *
 * `search_demand` — real Google search volume + CPC + competition for the terms
 * Maya derives from the buyer map. This is the genuinely-NEW signal she can't
 * fake from social threads: which buyer phrasing has actual demand, and which is
 * a dead end. (The live search-volume endpoint is ~$0.075/CALL regardless of
 * keyword count up to ~1000, so Maya batches all her seeds into one call.)
 *
 * Soft-fails into a clean shape on every gate (no creds / unverified / empty) so
 * Maya says "search demand isn't available yet" plainly, never errors.
 */

import { httpAction, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { authenticate } from "./openclaw/inboundCallback";
import { dataForSeoPost } from "../integrations/dataforseo/client";

interface SearchVolumeRow {
  keyword?: string;
  search_volume?: number | null;
  cpc?: number | null;
  competition?: string | null;
  competition_index?: number | null;
}

export interface DemandKeyword {
  keyword: string;
  volume: number | null;
  cpc: number | null;
  competition: string | null;
}

export interface SearchDemandResult {
  ok: boolean;
  reason?: string;
  message?: string;
  keywords: DemandKeyword[];
  cost?: number;
}

export const searchDemand = internalAction({
  args: {
    seeds: v.array(v.string()),
    locationCode: v.optional(v.number()),
    languageCode: v.optional(v.string()),
  },
  handler: async (_ctx, args): Promise<SearchDemandResult> => {
    const seeds = Array.from(
      new Set(args.seeds.map((s) => s.trim().toLowerCase()).filter((s) => s.length > 0))
    ).slice(0, 200); // the live endpoint accepts up to ~1000; cap generously
    if (seeds.length === 0) {
      return { ok: false, reason: "empty_seeds", keywords: [] };
    }
    const r = await dataForSeoPost<SearchVolumeRow>(
      "/keywords_data/google_ads/search_volume/live",
      [
        {
          keywords: seeds,
          location_code: args.locationCode ?? 2840, // Google US
          language_code: args.languageCode ?? "en",
        },
      ]
    );
    if (!r.ok) {
      return { ok: false, reason: r.reason, message: r.message, keywords: [] };
    }
    const keywords: DemandKeyword[] = r.result
      .filter((k) => typeof k.keyword === "string")
      .map((k) => ({
        keyword: k.keyword as string,
        volume: k.search_volume ?? null,
        cpc: k.cpc ?? null,
        competition: k.competition ?? null,
      }))
      // real demand first (volume desc, nulls last)
      .sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1));
    return { ok: true, keywords, cost: r.cost };
  },
});

export const searchDemandHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });
  let body: { seeds?: string[]; locationCode?: number; languageCode?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (!Array.isArray(body.seeds) || body.seeds.length === 0) {
    return new Response("missing seeds[]", { status: 400 });
  }
  const result = await ctx.runAction(internal.gtmMaya.demandIntel.searchDemand, {
    seeds: body.seeds,
    locationCode: body.locationCode,
    languageCode: body.languageCode,
  });
  // Phase 2 ⓪ — meter DataForSEO. It returns its own `cost`; record it (the
  // ledger auto-pricer also catches it by the "dataforseo" operation if 0).
  // Previously this spend was invisible — no ledger row was ever written.
  if (result.ok) {
    await ctx.runMutation(internal.gtmMaya.costLedger.recordGtmCostInternal, {
      accountId: auth.accountId,
      provider: "other",
      operation: "dataforseo.search_volume",
      reason: "search_demand keyword volumes",
      costUsd: result.cost ?? 0,
      units: result.keywords.length,
      cacheStatus: "called",
    });
  }
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});
