/**
 * Sprint 1.1 — LLM-driven keyword expansion for the research orchestrator.
 *
 * Why this exists: the Sprint 3 query builder takes `productCategoryKeywords`
 * (string[]) + ICP `currentPain` text and templates them into platform-specific
 * search queries. Before this module, those inputs were [app.name, weekGoal
 * fallback] — purely syntactic. For a product named "ModelHub" that input
 * collides with adult content ("modelhub.com") and 3D-modeling content. For
 * almost any indie product, raw product-name search is the wrong seed.
 *
 * What this does: takes the app row (name + url + founderWhy + weekGoal) and
 * asks Gemini-3-Flash to produce a structured query plan:
 *   - productCategoryKeywords: 6-10 semantic keywords describing the product's
 *     category as a real user would search for it (NOT the brand name).
 *     For ModelHub: ["local LLM Mac UI", "Ollama dashboard", "MLX management",
 *     "LM Studio alternative", "llama.cpp Mac GUI", "Hugging Face local
 *     downloader"].
 *   - icpPainPhrases: 3-5 verbatim quotes a real prospect would write/say
 *     about the pain this product solves, suitable for exact-quoted search
 *     on Reddit and X. For ModelHub: ["managing models across Ollama and
 *     MLX is a nightmare", "Mac GUI for local LLMs", "wish there was one
 *     dashboard for all my local models"].
 *
 * Result is cached on `gtmApps.keywordExpansion` so the LLM cost is paid
 * once per product, not per research job.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";

const EXPANSION_VERSION = "1";

export type KeywordExpansion = NonNullable<Doc<"gtmApps">["keywordExpansion"]>;

export const getAppForExpansion = internalQuery({
  args: { appId: v.id("gtmApps") },
  handler: async (ctx, args): Promise<Doc<"gtmApps"> | null> => {
    return await ctx.db.get(args.appId);
  },
});

export const cacheExpansionOnApp = internalMutation({
  args: {
    appId: v.id("gtmApps"),
    productCategoryKeywords: v.array(v.string()),
    icpPainPhrases: v.array(v.string()),
    modelUsed: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    await ctx.db.patch(args.appId, {
      keywordExpansion: {
        productCategoryKeywords: args.productCategoryKeywords,
        icpPainPhrases: args.icpPainPhrases,
        version: EXPANSION_VERSION,
        modelUsed: args.modelUsed,
        createdAt: Date.now(),
      },
      updatedAt: Date.now(),
    });
  },
});

/**
 * Expand a product into searchable keywords + audience pain phrases.
 *
 * Idempotent + cached: if `app.keywordExpansion` is already set, returns it
 * without calling the LLM. Pass `force: true` to regenerate.
 */
export const expandProductKeywords = internalAction({
  args: {
    accountId: v.id("creators"),
    appId: v.id("gtmApps"),
    force: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ cached: boolean; expansion: KeywordExpansion }> => {
    const app = await ctx.runQuery(
      internal.gtmMaya.queryExpansion.getAppForExpansion,
      { appId: args.appId }
    );
    if (!app) throw new Error(`expandProductKeywords: app ${args.appId} not found`);

    if (
      !args.force &&
      app.keywordExpansion &&
      app.keywordExpansion.version === EXPANSION_VERSION
    ) {
      return { cached: true, expansion: app.keywordExpansion };
    }

    const system = `You are a research strategist helping founders find their first users. Given a product description, produce a structured search-keyword plan that ignores the brand name and targets the underlying category + audience pain.

Return ONLY a JSON object matching this shape (no markdown, no commentary):
{
  "productCategoryKeywords": string[],   // 6-10 keywords describing the CATEGORY as a real user would search for it. Do NOT include the brand/product name itself. Each should be 2-6 words.
  "icpPainPhrases": string[]             // 3-5 verbatim phrases a real prospect would write on Reddit/X/forums describing the pain this product solves. Natural language, NOT keyword-stuffed.
}

Rules:
- The brand name is OFTEN a bad search seed (may collide with unrelated terms). Skip it entirely.
- Category keywords should let a Reddit/X searcher find people TALKING ABOUT the problem, not people promoting solutions.
- Pain phrases should sound like real complaints, not marketing copy.
- If the product description is vague, infer the most likely category from the URL.`;

    const userMessage = JSON.stringify({
      productName: app.name ?? "(unnamed)",
      url: app.url,
      founderWhy: app.founderWhy ?? "(none provided)",
      weekGoal: app.weekGoal,
      stage: app.stage,
    });

    const result: { content: string; model: string } = await ctx.runAction(
      internal.agents.modelRouter.maya.callMaya,
      {
        creatorId: args.accountId,
        taskTag: "gtm_query_expansion",
        messages: [
          { role: "system", content: system },
          { role: "user", content: userMessage },
        ],
        maxOutputTokens: 1800,
      }
    );

    let parsed: { productCategoryKeywords: string[]; icpPainPhrases: string[] };
    try {
      const text = result.content.trim();
      const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
      parsed = JSON.parse(stripped);
    } catch (err) {
      throw new Error(
        `expandProductKeywords: failed to parse LLM JSON: ${(err as Error).message}\nRaw: ${result.content.slice(0, 500)}`
      );
    }

    const productCategoryKeywords = (parsed.productCategoryKeywords ?? [])
      .filter((s) => typeof s === "string" && s.trim().length > 0)
      .map((s) => s.trim())
      .slice(0, 12);
    const icpPainPhrases = (parsed.icpPainPhrases ?? [])
      .filter((s) => typeof s === "string" && s.trim().length > 0)
      .map((s) => s.trim())
      .slice(0, 6);

    if (productCategoryKeywords.length < 3) {
      throw new Error(
        `expandProductKeywords: LLM returned only ${productCategoryKeywords.length} category keywords (need >=3). Raw: ${result.content.slice(0, 500)}`
      );
    }

    await ctx.runMutation(internal.gtmMaya.queryExpansion.cacheExpansionOnApp, {
      appId: args.appId,
      productCategoryKeywords,
      icpPainPhrases,
      modelUsed: result.model,
    });

    return {
      cached: false,
      expansion: {
        productCategoryKeywords,
        icpPainPhrases,
        version: EXPANSION_VERSION,
        modelUsed: result.model,
        createdAt: Date.now(),
      },
    };
  },
});
