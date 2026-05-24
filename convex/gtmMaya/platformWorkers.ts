import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  type ActionCtx,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { ScrapeCreatorsClient } from "../integrations/scrapeCreators/client";
import {
  googleSearch,
  instagramSearchReels,
  redditPostComments,
  searchRedditAll,
  searchRedditSubreddit,
  subredditPosts,
  tiktokVideoComments,
  twitterProfile,
  twitterSearch,
  twitterUserTweets,
  type ResearchRawItem,
} from "./scrapeCreatorsGtmResearch";
import { checkAllCostCaps } from "./costCap";

/**
 * Sprint 4 — platform workers.
 *
 * Each worker is an internal Convex action that takes:
 *   - researchJobId — already created in gtmResearchJobs by S1 orchestrator
 *   - accountId — the GTM account that owns the job (workers run with no
 *     user identity; cross-tenant isolation is by accountId in every write)
 *   - pack — the PlatformQueryPack from Sprint 3
 *
 * Each worker:
 *   1. Pre-flight cost-cap (hour / day / month / research-job).
 *   2. Build a flat list of queries from the pack (painQueries +
 *      solutionQueries + competitorQueries + formatQueries), respecting
 *      maxCalls.
 *   3. For each query, call the appropriate Sprint 2 wrapper.
 *   4. Convert each ResearchRawItem to a gtmEvidenceCards row + insert.
 *   5. Insert one gtmCostLedger row per call (estimated cost from
 *      PER_CALL_COST_USD table — Sprint 4 uses flat estimates; later
 *      sprints can pull real billing).
 *   6. Return a PlatformResearchResult per spec.
 *
 * Workers do NOT decide channel selection — channel-judge (Sprint 6)
 * does. They produce evidence; the judge scores it.
 */

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

export type PlatformWorkerPlatform =
  | "reddit"
  | "tiktok"
  | "twitter"
  | "instagram"
  | "google";

export interface PlatformResearchResult {
  platform: PlatformWorkerPlatform;
  status: "succeeded" | "insufficient_evidence" | "failed" | "budget_blocked";
  summary: string;
  evidenceCardIds: Id<"gtmEvidenceCards">[];
  callsMade: number;
  spentUsd: number;
  /** Concrete missing-coverage notes — surfaced to channel-judge so it
   *  can park the platform with a real reason instead of "low score". */
  missingCoverage: string[];
}

// Flat estimates per call. Reasonable mid-band for ScrapeCreators 2026
// pricing. Workers stamp this into gtmCostLedger; channel-judge consumes
// the ledger sum.
const PER_CALL_COST_USD: Record<PlatformWorkerPlatform, number> = {
  reddit: 0.01,
  tiktok: 0.015,
  twitter: 0.012,
  instagram: 0.012,
  google: 0.005,
};

// ──────────────────────────────────────────────────────────────────────
// Internal mutations (called by workers — bypass user auth, use accountId)
// ──────────────────────────────────────────────────────────────────────

const EVIDENCE_INPUT_INTERNAL = v.object({
  source: v.union(
    v.literal("app"),
    v.literal("google"),
    v.literal("reddit"),
    v.literal("x"),
    v.literal("linkedin"),
    v.literal("tiktok"),
    v.literal("instagram"),
    v.literal("competitor")
  ),
  url: v.string(),
  title: v.optional(v.string()),
  snippet: v.string(),
  authorOrCommunity: v.optional(v.string()),
  observedAt: v.number(),
  recency: v.union(
    v.literal("fresh"),
    v.literal("recent"),
    v.literal("old"),
    v.literal("unknown")
  ),
  engagement: v.optional(
    v.object({
      likes: v.optional(v.number()),
      comments: v.optional(v.number()),
      shares: v.optional(v.number()),
      views: v.optional(v.number()),
    })
  ),
  painMatch: v.number(),
  buyerMatch: v.number(),
  channelFit: v.number(),
  promotionRisk: v.union(
    v.literal("low"),
    v.literal("medium"),
    v.literal("high"),
    v.literal("unknown")
  ),
  recommendedUse: v.union(
    v.literal("strategy"),
    v.literal("reply"),
    v.literal("content_format"),
    v.literal("avoid"),
    v.literal("competitor")
  ),
  extractedClaims: v.array(v.string()),
  rawRef: v.optional(v.string()),
});

export const recordPlatformEvidence = internalMutation({
  args: {
    researchJobId: v.id("gtmResearchJobs"),
    accountId: v.id("creators"),
    cards: v.array(EVIDENCE_INPUT_INTERNAL),
  },
  handler: async (ctx, args): Promise<Id<"gtmEvidenceCards">[]> => {
    const job = await ctx.db.get(args.researchJobId);
    if (!job || job.accountId !== args.accountId) {
      throw new Error(
        "recordPlatformEvidence: research job does not belong to accountId"
      );
    }
    const now = Date.now();
    const ids: Id<"gtmEvidenceCards">[] = [];
    for (const card of args.cards) {
      const id = await ctx.db.insert("gtmEvidenceCards", {
        accountId: args.accountId,
        researchJobId: args.researchJobId,
        ...card,
        createdAt: now,
      });
      ids.push(id);
    }
    return ids;
  },
});

export const recordPlatformCost = internalMutation({
  args: {
    researchJobId: v.id("gtmResearchJobs"),
    accountId: v.id("creators"),
    provider: v.union(
      v.literal("scrapecreators"),
      v.literal("gemini"),
      v.literal("openrouter"),
      v.literal("composio"),
      v.literal("x_api"),
      v.literal("openclaw"),
      v.literal("other")
    ),
    operation: v.string(),
    reason: v.string(),
    costUsd: v.number(),
    units: v.optional(v.number()),
    cacheStatus: v.union(
      v.literal("hit"),
      v.literal("miss"),
      v.literal("called"),
      v.literal("skipped"),
      v.literal("failed")
    ),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args): Promise<Id<"gtmCostLedger">> => {
    const job = await ctx.db.get(args.researchJobId);
    if (!job || job.accountId !== args.accountId) {
      throw new Error("recordPlatformCost: job does not belong to accountId");
    }
    const now = Date.now();
    const id = await ctx.db.insert("gtmCostLedger", {
      accountId: args.accountId,
      researchJobId: args.researchJobId,
      provider: args.provider,
      operation: args.operation,
      reason: args.reason,
      costUsd: args.costUsd,
      units: args.units,
      cacheStatus: args.cacheStatus,
      metadata: args.metadata,
      createdAt: now,
    });
    // Update job.spentUsd
    if (args.cacheStatus === "called" && args.costUsd > 0) {
      await ctx.db.patch(args.researchJobId, {
        spentUsd: Math.round((job.spentUsd + args.costUsd) * 10000) / 10000,
        updatedAt: now,
      });
    }
    return id;
  },
});

// ──────────────────────────────────────────────────────────────────────
// Shared worker harness
// ──────────────────────────────────────────────────────────────────────

interface WorkerContext {
  ctx: ActionCtx;
  client: ScrapeCreatorsClient;
  researchJobId: Id<"gtmResearchJobs">;
  accountId: Id<"creators">;
  platform: PlatformWorkerPlatform;
}

interface WorkerPack {
  painQueries: string[];
  solutionQueries: string[];
  competitorQueries: string[];
  formatQueries: string[];
  minimumEvidenceCards: number;
  maxCalls: number;
}

/**
 * Run a worker — common loop logic. Each platform supplies a fetchOne()
 * that maps a query string to a wrapper invocation. Pure orchestration.
 */
async function runWorker(
  wc: WorkerContext,
  pack: WorkerPack,
  fetchOne: (
    query: string,
    queryKind: "pain" | "solution" | "competitor" | "format"
  ) => Promise<ResearchRawItem[]>
): Promise<PlatformResearchResult> {
  // Pre-flight cost-cap check at the worker level.
  const costStatus = await wc.ctx.runQuery(
    internal.gtmMaya.costCap.checkCostCapPreflight,
    {
      accountId: wc.accountId,
      nextCostUsd: PER_CALL_COST_USD[wc.platform] * Math.min(pack.maxCalls, 3),
      researchJobId: wc.researchJobId,
    }
  );
  if (!costStatus.allowed) {
    return {
      platform: wc.platform,
      status: "budget_blocked",
      summary: `cost cap blocked: ${costStatus.reason}`,
      evidenceCardIds: [],
      callsMade: 0,
      spentUsd: 0,
      missingCoverage: [`budget_blocked: ${costStatus.reason}`],
    };
  }

  // Build a flat ordered query list: pain → solution → competitor →
  // format. Pain has the highest signal, so it runs first if budget is
  // tight.
  const orderedQueries: Array<{
    query: string;
    kind: "pain" | "solution" | "competitor" | "format";
  }> = [
    ...pack.painQueries.map((q) => ({ query: q, kind: "pain" as const })),
    ...pack.solutionQueries.map((q) => ({ query: q, kind: "solution" as const })),
    ...pack.competitorQueries.map((q) => ({ query: q, kind: "competitor" as const })),
    ...pack.formatQueries.map((q) => ({ query: q, kind: "format" as const })),
  ];

  const allItems: ResearchRawItem[] = [];
  const seenUrls = new Set<string>();
  let callsMade = 0;
  const errors: string[] = [];

  for (const { query, kind } of orderedQueries) {
    if (callsMade >= pack.maxCalls) break;
    callsMade += 1;
    try {
      const items = await fetchOne(query, kind);
      // Cost ledger: call=success
      await wc.ctx.runMutation(internal.gtmMaya.platformWorkers.recordPlatformCost, {
        researchJobId: wc.researchJobId,
        accountId: wc.accountId,
        provider: "scrapecreators",
        operation: `${wc.platform}.${kind}`,
        reason: `query: ${query.slice(0, 100)}`,
        costUsd: PER_CALL_COST_USD[wc.platform],
        units: 1,
        cacheStatus: items.length === 0 ? "skipped" : "called",
        metadata: { itemCount: items.length },
      });
      // Dedupe by URL across queries.
      for (const item of items) {
        if (seenUrls.has(item.url)) continue;
        seenUrls.add(item.url);
        allItems.push(item);
      }
    } catch (err) {
      errors.push(`${kind}/${query.slice(0, 50)}: ${(err as Error).message}`);
      await wc.ctx.runMutation(internal.gtmMaya.platformWorkers.recordPlatformCost, {
        researchJobId: wc.researchJobId,
        accountId: wc.accountId,
        provider: "scrapecreators",
        operation: `${wc.platform}.${kind}`,
        reason: `query: ${query.slice(0, 100)}`,
        costUsd: 0,
        cacheStatus: "failed",
        metadata: { error: (err as Error).message },
      });
    }
  }

  // Convert raw items → evidence cards.
  const cards = allItems.map((item) =>
    rawItemToEvidence(wc.platform, item)
  );

  let evidenceCardIds: Id<"gtmEvidenceCards">[] = [];
  if (cards.length > 0) {
    evidenceCardIds = await wc.ctx.runMutation(
      internal.gtmMaya.platformWorkers.recordPlatformEvidence,
      {
        researchJobId: wc.researchJobId,
        accountId: wc.accountId,
        cards,
      }
    );
  }

  const status: PlatformResearchResult["status"] =
    evidenceCardIds.length >= pack.minimumEvidenceCards
      ? "succeeded"
      : evidenceCardIds.length > 0 || errors.length === 0
        ? "insufficient_evidence"
        : "failed";

  const missingCoverage: string[] = [];
  if (status === "insufficient_evidence") {
    missingCoverage.push(
      `Only ${evidenceCardIds.length}/${pack.minimumEvidenceCards} evidence cards reached the bar`
    );
  }
  if (errors.length > 0) {
    missingCoverage.push(`${errors.length} query(ies) failed: ${errors.slice(0, 3).join("; ")}`);
  }

  return {
    platform: wc.platform,
    status,
    summary:
      status === "succeeded"
        ? `${wc.platform}: ${evidenceCardIds.length} evidence cards from ${callsMade} call(s)`
        : `${wc.platform}: ${status} (${evidenceCardIds.length} cards, ${callsMade} calls, ${errors.length} errors)`,
    evidenceCardIds,
    callsMade,
    spentUsd: Math.round(callsMade * PER_CALL_COST_USD[wc.platform] * 10000) / 10000,
    missingCoverage,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Raw item → evidence card normalization
// ──────────────────────────────────────────────────────────────────────

function platformToSource(
  p: PlatformWorkerPlatform
): Doc<"gtmEvidenceCards">["source"] {
  switch (p) {
    case "reddit":
      return "reddit";
    case "tiktok":
      return "tiktok";
    case "twitter":
      return "x";
    case "instagram":
      return "instagram";
    case "google":
      return "google";
  }
}

/**
 * Convert a normalized ResearchRawItem into the gtmEvidenceCards row
 * shape. Pain/buyer/channel-fit scores are baseline heuristics from
 * engagement signals; channel-judge (Sprint 6) re-scores with full
 * cross-evidence context.
 */
function rawItemToEvidence(
  platform: PlatformWorkerPlatform,
  item: ResearchRawItem
): {
  source: Doc<"gtmEvidenceCards">["source"];
  url: string;
  title?: string;
  snippet: string;
  authorOrCommunity?: string;
  observedAt: number;
  recency: Doc<"gtmEvidenceCards">["recency"];
  engagement?: {
    likes?: number;
    comments?: number;
    shares?: number;
    views?: number;
  };
  painMatch: number;
  buyerMatch: number;
  channelFit: number;
  promotionRisk: Doc<"gtmEvidenceCards">["promotionRisk"];
  recommendedUse: Doc<"gtmEvidenceCards">["recommendedUse"];
  extractedClaims: string[];
  rawRef?: string;
} {
  const now = Date.now();
  const ageMs = item.createdAtMs ? now - item.createdAtMs : null;
  const recency: Doc<"gtmEvidenceCards">["recency"] = ageMs === null
    ? "unknown"
    : ageMs < 7 * 24 * 60 * 60 * 1000
      ? "fresh"
      : ageMs < 90 * 24 * 60 * 60 * 1000
        ? "recent"
        : "old";

  // Engagement signal → baseline match scores (0.0 - 1.0). Channel-judge
  // re-scores using cross-evidence context; this is a first-pass priority.
  const eng = item.engagement;
  const totalSignal =
    (eng.likes ?? 0) +
    (eng.comments ?? 0) * 2 + // comments are higher signal than likes
    (eng.upvotes ?? 0) +
    (eng.shares ?? 0) * 1.5 +
    (eng.views ?? 0) / 50;
  const painMatch = Math.min(1.0, totalSignal / 100);
  const buyerMatch = painMatch * 0.8; // heuristic: channel-judge sharpens
  const channelFit = recency === "fresh" ? 0.8 : recency === "recent" ? 0.6 : 0.4;

  // Promotion risk heuristic — Reddit content is highest-risk, Google
  // search results are lowest. Channel-judge re-scores.
  const promotionRisk: Doc<"gtmEvidenceCards">["promotionRisk"] =
    platform === "reddit"
      ? "medium"
      : platform === "google"
        ? "low"
        : "low";

  // Recommended use — defaults; the judge re-tags.
  const recommendedUse: Doc<"gtmEvidenceCards">["recommendedUse"] = "strategy";

  return {
    source: platformToSource(platform),
    url: item.url,
    title: item.title ?? undefined,
    snippet: item.excerpt ?? item.title ?? "",
    authorOrCommunity: item.author ?? undefined,
    observedAt: now,
    recency,
    engagement: {
      likes: eng.likes ?? undefined,
      comments: eng.comments ?? undefined,
      shares: eng.shares ?? undefined,
      views: eng.views ?? undefined,
    },
    painMatch,
    buyerMatch,
    channelFit,
    promotionRisk,
    recommendedUse,
    extractedClaims: [],
    rawRef: item.rawRef,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Reddit worker
// ──────────────────────────────────────────────────────────────────────

const PACK_ARGS = v.object({
  painQueries: v.array(v.string()),
  solutionQueries: v.array(v.string()),
  competitorQueries: v.array(v.string()),
  formatQueries: v.array(v.string()),
  minimumEvidenceCards: v.number(),
  maxCalls: v.number(),
});

export const runRedditWorker = internalAction({
  args: {
    researchJobId: v.id("gtmResearchJobs"),
    accountId: v.id("creators"),
    pack: PACK_ARGS,
  },
  handler: async (ctx, args): Promise<PlatformResearchResult> => {
    const client = new ScrapeCreatorsClient();
    const wc: WorkerContext = {
      ctx,
      client,
      researchJobId: args.researchJobId,
      accountId: args.accountId,
      platform: "reddit",
    };
    return await runWorker(wc, args.pack, async (query) => {
      const res = await searchRedditAll(client, query, {
        sort: "relevance",
        timeframe: "month",
      });
      return res.items;
    });
  },
});

export const runRedditSubredditWorker = internalAction({
  args: {
    researchJobId: v.id("gtmResearchJobs"),
    accountId: v.id("creators"),
    subreddit: v.string(),
    pack: PACK_ARGS,
  },
  handler: async (ctx, args): Promise<PlatformResearchResult> => {
    const client = new ScrapeCreatorsClient();
    const wc: WorkerContext = {
      ctx,
      client,
      researchJobId: args.researchJobId,
      accountId: args.accountId,
      platform: "reddit",
    };
    return await runWorker(wc, args.pack, async (query) => {
      const res = await searchRedditSubreddit(client, args.subreddit, query, {
        sort: "relevance",
      });
      return res.items;
    });
  },
});

// ──────────────────────────────────────────────────────────────────────
// Twitter worker
// ──────────────────────────────────────────────────────────────────────

export const runTwitterWorker = internalAction({
  args: {
    researchJobId: v.id("gtmResearchJobs"),
    accountId: v.id("creators"),
    pack: PACK_ARGS,
  },
  handler: async (ctx, args): Promise<PlatformResearchResult> => {
    const client = new ScrapeCreatorsClient();
    const wc: WorkerContext = {
      ctx,
      client,
      researchJobId: args.researchJobId,
      accountId: args.accountId,
      platform: "twitter",
    };
    return await runWorker(wc, args.pack, async (query) => {
      const res = await twitterSearch(client, query, { mode: "latest" });
      return res.items;
    });
  },
});

// ──────────────────────────────────────────────────────────────────────
// TikTok worker — search/keyword and search/hashtag live in
// integrations/scrapeCreators/endpoints.ts (creator-Maya pack). We use
// twitter-search-like patterns here via the wrapper-free call surface;
// for v0.1 MVP we rely on the existing endpoints in endpoints.ts via
// generic ScrapeCreatorsClient.request for the search/keyword path.
// ──────────────────────────────────────────────────────────────────────

interface RawTikTokSearchKeywordResponse {
  search_item_list?: Array<{
    aweme_info?: {
      aweme_id?: string;
      author?: { unique_id?: string; nickname?: string };
      desc?: string;
      create_time?: number;
      statistics?: {
        digg_count?: number;
        comment_count?: number;
        share_count?: number;
        play_count?: number;
      };
    };
  }>;
}

export const runTikTokWorker = internalAction({
  args: {
    researchJobId: v.id("gtmResearchJobs"),
    accountId: v.id("creators"),
    pack: PACK_ARGS,
  },
  handler: async (ctx, args): Promise<PlatformResearchResult> => {
    const client = new ScrapeCreatorsClient();
    const wc: WorkerContext = {
      ctx,
      client,
      researchJobId: args.researchJobId,
      accountId: args.accountId,
      platform: "tiktok",
    };
    return await runWorker(wc, args.pack, async (query) => {
      // TikTok keyword search via raw client (the typed wrapper for this
      // lives in integrations/scrapeCreators/endpoints.ts but its
      // signature is creator-pack-shaped; using raw here for parity with
      // the other wrappers' return shape).
      try {
        const raw = await client.request<RawTikTokSearchKeywordResponse>(
          "/v1/tiktok/search/keyword",
          { query: { query } }
        );
        const items: ResearchRawItem[] = [];
        for (const entry of raw.search_item_list ?? []) {
          const a = entry.aweme_info;
          if (!a?.aweme_id) continue;
          const handle = a.author?.unique_id ?? null;
          items.push({
            platform: "tiktok",
            externalId: a.aweme_id,
            url: handle
              ? `https://www.tiktok.com/@${handle}/video/${a.aweme_id}`
              : `https://www.tiktok.com/video/${a.aweme_id}`,
            title: null,
            excerpt: a.desc?.slice(0, 2000) ?? null,
            author: a.author?.nickname ?? handle ?? null,
            createdAtMs: a.create_time ? a.create_time * 1000 : null,
            engagement: {
              likes: a.statistics?.digg_count ?? null,
              comments: a.statistics?.comment_count ?? null,
              shares: a.statistics?.share_count ?? null,
              views: a.statistics?.play_count ?? null,
              upvotes: null,
              downvotes: null,
            },
            tags: [],
            rawRef: `tiktok:search/keyword:${query}`,
          });
        }
        return items;
      } catch {
        return [];
      }
    });
  },
});

// ──────────────────────────────────────────────────────────────────────
// Instagram worker
// ──────────────────────────────────────────────────────────────────────

export const runInstagramWorker = internalAction({
  args: {
    researchJobId: v.id("gtmResearchJobs"),
    accountId: v.id("creators"),
    pack: PACK_ARGS,
  },
  handler: async (ctx, args): Promise<PlatformResearchResult> => {
    const client = new ScrapeCreatorsClient();
    const wc: WorkerContext = {
      ctx,
      client,
      researchJobId: args.researchJobId,
      accountId: args.accountId,
      platform: "instagram",
    };
    return await runWorker(wc, args.pack, async (query) => {
      const res = await instagramSearchReels(client, query);
      return res.items;
    });
  },
});

// ──────────────────────────────────────────────────────────────────────
// Google worker
// ──────────────────────────────────────────────────────────────────────

export const runGoogleWorker = internalAction({
  args: {
    researchJobId: v.id("gtmResearchJobs"),
    accountId: v.id("creators"),
    pack: PACK_ARGS,
  },
  handler: async (ctx, args): Promise<PlatformResearchResult> => {
    const client = new ScrapeCreatorsClient();
    const wc: WorkerContext = {
      ctx,
      client,
      researchJobId: args.researchJobId,
      accountId: args.accountId,
      platform: "google",
    };
    return await runWorker(wc, args.pack, async (query) => {
      const res = await googleSearch(client, query);
      return res.items;
    });
  },
});

// ──────────────────────────────────────────────────────────────────────
// Pure exports for unit testing
// ──────────────────────────────────────────────────────────────────────

export { rawItemToEvidence, PER_CALL_COST_USD };

// (Re-export for type clarity in callers.)
export type { ResearchRawItem };

// Unused imports defense — keep compiler from tree-shaking helpers used
// only by the per-platform workers above.
void subredditPosts;
void redditPostComments;
void tiktokVideoComments;
void twitterProfile;
void twitterUserTweets;
void checkAllCostCaps;
