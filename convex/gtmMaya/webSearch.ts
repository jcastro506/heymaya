/**
 * Sprint 1 (top-tier) — `search_web`: expose the open web to Maya.
 *
 * The Gemini grounded-search integration already exists
 * (`convex/integrations/gemini/groundedSearch.ts`, used by the monthly
 * platform-algo cron). This is the last mile: a hookToken-authed tool so the
 * per-founder Maya can read the open web — competitor pricing/positioning/
 * changelog pages, and any landing page she wants to judge — not just social
 * threads. Grounded + cited; soft-fails gracefully (missing key / HTTP error /
 * empty grounding all return a clean shape, never throw).
 *
 * There is no tenant data in a web query — auth is access control, not
 * isolation (the result is public web content). Cost ~$0.035/query; the agent
 * logs it via `log_cost` (provider gemini).
 */

import { httpAction, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { authenticate } from "./openclaw/inboundCallback";
import { geminiGroundedSearch } from "../integrations/gemini/groundedSearch";

export interface WebSearchResult {
  ok: boolean;
  query: string;
  statusDetail: string;
  results: Array<{
    url: string;
    title: string | null;
    excerpt: string | null;
    domain: string | null;
  }>;
}

/** Run one grounded web search and shape it for the model. */
export const webSearch = internalAction({
  args: { query: v.string(), limit: v.optional(v.number()) },
  handler: async (_ctx, args): Promise<WebSearchResult> => {
    const query = args.query.trim();
    if (query.length === 0) {
      return { ok: false, query, statusDetail: "empty_query", results: [] };
    }
    const limit =
      typeof args.limit === "number" && args.limit > 0
        ? Math.min(args.limit, 12)
        : 8;
    const raw = await geminiGroundedSearch(query);
    const results = raw.items.slice(0, limit).map((i) => ({
      url: i.url,
      title: i.title,
      excerpt: i.excerpt,
      domain: i.author,
    }));
    return {
      ok: raw.statusDetail === "ok" || results.length > 0,
      query,
      statusDetail: raw.statusDetail,
      results,
    };
  },
});

export const searchWebHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  const url = new URL(request.url);
  const query = url.searchParams.get("query") ?? "";
  if (query.trim().length === 0) {
    return new Response("missing query", { status: 400 });
  }
  const limitRaw = url.searchParams.get("limit");
  const result = await ctx.runAction(internal.gtmMaya.webSearch.webSearch, {
    query,
    limit: limitRaw ? Number(limitRaw) : undefined,
  });
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});
