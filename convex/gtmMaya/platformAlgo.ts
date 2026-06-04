/**
 * SHARED platform-algorithm intelligence — refreshed once a month, centrally.
 *
 * Why this is a CONVEX cron, not an OpenClaw (per-agent) cron: the "what's
 * working on each platform's algorithm right now" knowledge is SHARED across
 * every Maya. If each customer's deployed agent re-researched it, N customers =
 * N identical monthly research passes (wasteful + inconsistent). Instead one
 * Convex cron researches each of the 6 channels ONCE via Gemini grounded search
 * (real cited web search — the deployed agent's own web_search isn't wired),
 * writes a shared row per platform (creatorId undefined) to platformAlgoCache,
 * and every Maya reads it via `get_platform_algo`. Research once, all benefit.
 *
 * Per the "shared infra + per-creator soul" principle: the platform algo is
 * shared infrastructure; only the founder's voice/ICP is per-customer.
 */

import { v } from "convex/values";
import {
  httpAction,
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { internal } from "../_generated/api";
import { authenticate } from "./openclaw/inboundCallback";

const ALGO_MODEL = process.env.MAYA_GTM_ALGO_MODEL ?? "gemini-2.5-flash";
const TTL_DAYS = 40; // a monthly refresh + a week of grace before "stale"

type AlgoPlatform =
  | "reddit"
  | "x"
  | "hn"
  | "linkedin"
  | "tiktok"
  | "youtube"
  | "instagram";

const PLATFORMS: Array<{ key: AlgoPlatform; name: string; focus: string }> = [
  { key: "reddit", name: "Reddit", focus: "subreddit self-promo rules, comment-vs-post reach, karma/age gating, what gets auto-filtered or removed" },
  { key: "x", name: "X (Twitter)", focus: "reply-driven reach, link suppression, posting cadence, what the For You algo favors" },
  { key: "hn", name: "Hacker News", focus: "Show HN timing + tone, upvote velocity, what front-pages vs flags as spam" },
  { key: "linkedin", name: "LinkedIn", focus: "dwell time, link-in-comment, post formats (document/carousel/text), cadence" },
  { key: "tiktok", name: "TikTok", focus: "hook + retention signals, trending sounds, Photo Mode/slideshow, posting frequency for a new account" },
  { key: "youtube", name: "YouTube", focus: "Shorts vs long-form, title/thumbnail CTR, search intent, upload cadence" },
  { key: "instagram", name: "Instagram", focus: "Reels reach, saves/shares, carousels, cover frames, cadence for a small account" },
];

// ───────────────────────── research (Gemini grounded) ─────────────────────────

interface AlgoResearchResult {
  whatsHotNow: string;
  sources: string[];
}

/** One Gemini grounded-search call for a platform's current algo state. */
async function researchPlatformAlgo(
  platform: { key: AlgoPlatform; name: string; focus: string },
  monthLabel: string,
  fetchImpl: typeof fetch
): Promise<AlgoResearchResult | null> {
  const apiKey =
    process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) return null;

  const prompt = `It is ${monthLabel}. For a SOLO FOUNDER growing a NEW / small account on ${platform.name} to get an early-stage app its first users, summarize what is working RIGHT NOW on the algorithm. Cover, concretely and current to this month: (1) optimal POSTING CADENCE for a new account (how often to post/comment), (2) the FORMATS getting reach, (3) best TIMING / windows of day, (4) what is LOSING reach or getting filtered/penalized now. Focus on: ${platform.focus}. Prefer recent, credible sources. Keep it tight (~140 words), concrete numbers where they exist, no fluff.`;

  try {
    const res = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${ALGO_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: { maxOutputTokens: 1200, temperature: 0.2 },
        }),
      }
    );
    if (!res.ok) return null;
    const payload = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        groundingMetadata?: {
          groundingChunks?: Array<{ web?: { uri?: string } }>;
        };
      }>;
    };
    const cand = payload.candidates?.[0];
    const text = (cand?.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("")
      .trim();
    if (!text) return null;
    const sources = Array.from(
      new Set(
        (cand?.groundingMetadata?.groundingChunks ?? [])
          .map((c) => c.web?.uri)
          .filter((u): u is string => typeof u === "string" && u.length > 0)
      )
    ).slice(0, 8);
    return { whatsHotNow: text, sources };
  } catch {
    return null;
  }
}

// ───────────────────────── DB layer ─────────────────────────

export const upsertSharedAlgo = internalMutation({
  args: {
    platform: v.union(
      v.literal("reddit"),
      v.literal("x"),
      v.literal("hn"),
      v.literal("linkedin"),
      v.literal("tiktok"),
      v.literal("youtube"),
      v.literal("instagram")
    ),
    whatsHotNow: v.string(),
    sources: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    // The SHARED row for a platform is the one with no creatorId. Find + patch
    // it (latest researched), else insert.
    const rows = await ctx.db
      .query("platformAlgoCache")
      .withIndex("by_platform_and_researched_at", (q) =>
        q.eq("platform", args.platform)
      )
      .collect();
    const shared = rows.find((r) => r.creatorId === undefined);
    const now = Date.now();
    if (shared) {
      await ctx.db.patch(shared._id, {
        whatsHotNow: args.whatsHotNow,
        sources: args.sources,
        researchedAt: now,
        ttlDays: TTL_DAYS,
      });
      return;
    }
    await ctx.db.insert("platformAlgoCache", {
      platform: args.platform,
      signals: [],
      whatsHotNow: args.whatsHotNow,
      whatsCoolingOff: "",
      sources: args.sources,
      researchedAt: now,
      ttlDays: TTL_DAYS,
    });
  },
});

export const getSharedPlatformAlgo = internalQuery({
  args: {},
  handler: async (
    ctx
  ): Promise<
    Array<{
      platform: string;
      whatsHotNow: string;
      sources: string[];
      researchedAt: number;
      ageDays: number;
    }>
  > => {
    const rows = await ctx.db.query("platformAlgoCache").collect();
    const now = Date.now();
    return rows
      .filter((r) => r.creatorId === undefined)
      .map((r) => ({
        platform: r.platform,
        whatsHotNow: r.whatsHotNow,
        sources: r.sources,
        researchedAt: r.researchedAt,
        ageDays: Math.floor((now - r.researchedAt) / 86_400_000),
      }))
      .sort((a, b) => a.platform.localeCompare(b.platform));
  },
});

// ───────────────────────── the monthly cron entry ─────────────────────────

/**
 * Refresh ALL platforms' shared algo intelligence. Called by the Convex
 * `platform-algo-refresh` monthly cron. Best-effort per platform — one
 * platform's failure never blocks the others.
 */
export const refreshAllPlatformAlgo = internalAction({
  args: {},
  handler: async (ctx): Promise<{ refreshed: string[]; failed: string[] }> => {
    const now = new Date(); // allowed in actions
    const monthLabel = now.toLocaleString("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    const refreshed: string[] = [];
    const failed: string[] = [];
    for (const platform of PLATFORMS) {
      const result = await researchPlatformAlgo(platform, monthLabel, fetch);
      if (!result) {
        failed.push(platform.key);
        continue;
      }
      await ctx.runMutation(internal.gtmMaya.platformAlgo.upsertSharedAlgo, {
        platform: platform.key,
        whatsHotNow: result.whatsHotNow,
        sources: result.sources,
      });
      refreshed.push(platform.key);
    }
    console.log(
      `[platformAlgo] refresh complete: ${refreshed.length} ok, ${failed.length} failed (${failed.join(",")})`
    );
    return { refreshed, failed };
  },
});

// ───────────────────────── agent read tool ─────────────────────────

/**
 * GET /lc_gtm/get_platform_algo — the deployed Maya reads the SHARED, centrally-
 * refreshed platform-algo intelligence (hookToken auth). She consults this
 * before choosing a format/timing/cadence so her drafts reflect THIS month's
 * reality, without her (or the user) ever having to research it.
 */
export const getPlatformAlgoHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  const algo = await ctx.runQuery(
    internal.gtmMaya.platformAlgo.getSharedPlatformAlgo,
    {}
  );
  return new Response(
    JSON.stringify({
      ok: true,
      platforms: algo,
      note:
        algo.length === 0
          ? "No shared platform-algo intelligence yet — fall back to PLATFORM_ALGO.md baseline."
          : undefined,
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
});
