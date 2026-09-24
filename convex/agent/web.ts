/**
 * B3: her eyes on the real world (audit §7 B3). Two tools on every skill's belt:
 * `web_search` (Tavily search, general or news, a date window) and `web_read` (one page).
 *
 * She decides WHEN (the tool descriptions give the reasons); code keeps the promises:
 * - privacy: a query never carries the creator's own handles or email (stripped here, by code);
 * - money: every call is on the cost ledger; a turn gets at most WEB_CALLS_PER_TURN;
 * - trust: results come back labelled as untrusted web text, with the URL and the day checked,
 *   so a fact she cites has a source and an "as of".
 * The same real-or-fake switch as partnership research (`providerBase`): the eval fake only on a
 * local deployment with EVAL_FAKES=1, never an arbitrary URL.
 */
import { v } from "convex/values";
import { internalAction, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { providerBase } from "../partnerships/providerConfig";
import { publicUrl } from "../partnerships/contracts";

export const WEB_CALLS_PER_TURN = 2;
export const TAVILY_USD_PER_CALL = 0.008; // basic search or a basic extract: one credit (COGS doc)

/** Pure: the query with the creator's own identifiers removed, or null if nothing public remains. */
export function scrubQuery(query: string, own: { handles: string[]; email?: string }): string | null {
  let q = query.slice(0, 300);
  for (const h of own.handles.filter(Boolean)) q = q.replace(new RegExp(`@?${h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "gi"), " ");
  if (own.email) q = q.replace(new RegExp(own.email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ");
  q = q.replace(/\S+@\S+\.\S+/g, " ").replace(/\b(?:token|password|secret)\s*[:=]\S*/gi, " ").replace(/\s+/g, " ").trim();
  return q.length >= 3 ? q : null;
}

export const identity = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ handles: string[]; email?: string } | null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    return c ? { handles: [c.handles.tiktok, c.handles.instagram].filter((x): x is string => Boolean(x)), email: c.email } : null;
  },
});

/** An eval fixture on a local deployment with the fakes on (the same test as partnership research). */
async function fixtureCreator(ctx: { runQuery: ActionCtx["runQuery"] }, creatorId: Id<"creators">): Promise<boolean> {
  return process.env.EVAL_FAKES === "1" && process.env.ENVIRONMENT_NAME === "local" && await ctx.runQuery(internal.eval.fakes.isFixture, { creatorId });
}

type WebResult = { url: string; title: string; excerpt: string; published?: string };
export type WebAnswer = { ok: true; checkedOn: string; results: WebResult[] } | { ok: false; reason: string };

/**
 * 2026-09-24: the header promised the fake for eval fixtures, but this passed `false`, so a fixture's
 * web_search reached the real Tavily with the real key. Now a fixture on a local EVAL_FAKES deployment
 * gets the fake (and the fake token); everyone else gets the real endpoint, exactly as before.
 */
async function call(path: "search" | "extract", body: Record<string, unknown>, fixture = false): Promise<Response> {
  const key = fixture ? "fake-research" : process.env.TAVILY_API_KEY;
  if (!key) throw new Error("web search isn't set up on this deployment");
  return await fetch(`${providerBase("tavily", fixture)}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
}

export const search = internalAction({
  args: { creatorId: v.id("creators"), query: v.string(), topic: v.optional(v.union(v.literal("general"), v.literal("news"))), days: v.optional(v.number()) },
  handler: async (ctx, a): Promise<WebAnswer> => {
    const own = await ctx.runQuery(internal.agent.web.identity, { creatorId: a.creatorId });
    const q = scrubQuery(a.query, own ?? { handles: [] });
    if (!q) return { ok: false, reason: "that search had nothing public left in it" };
    await ctx.runMutation(internal.core.costs.record, { creatorId: a.creatorId, vendor: "tavily", resource: "search_basic", purpose: "web_search", costUsd: TAVILY_USD_PER_CALL, costSource: "tier_table" });
    try {
      const r = await call("search", { query: q, topic: a.topic ?? "general", ...(a.days ? { days: Math.max(1, Math.min(365, Math.round(a.days))) } : {}), search_depth: "basic", max_results: 5, include_answer: false, include_raw_content: false }, await fixtureCreator(ctx, a.creatorId));
      if (!r.ok) return { ok: false, reason: `search unavailable (${r.status})` };
      const body = (await r.json()) as { results?: Array<{ url?: string; title?: string; content?: string; published_date?: string }> };
      const results = (body.results ?? []).slice(0, 5).flatMap((x) => {
        try {
          return [{ url: publicUrl(x.url ?? ""), title: (x.title ?? "").slice(0, 160), excerpt: (x.content ?? "").slice(0, 700), ...(x.published_date ? { published: x.published_date.slice(0, 10) } : {}) }];
        } catch {
          return [];
        }
      });
      return { ok: true, checkedOn: new Date().toISOString().slice(0, 10), results };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message.slice(0, 120) : "search failed" };
    }
  },
});

export const read = internalAction({
  args: { creatorId: v.id("creators"), url: v.string() },
  handler: async (ctx, a): Promise<WebAnswer> => {
    let target: string;
    try {
      target = publicUrl(a.url);
    } catch {
      return { ok: false, reason: "that isn't a public web page" };
    }
    await ctx.runMutation(internal.core.costs.record, { creatorId: a.creatorId, vendor: "tavily", resource: "extract_basic", purpose: "web_read", costUsd: TAVILY_USD_PER_CALL, costSource: "tier_table" });
    try {
      const r = await call("extract", { urls: [target], extract_depth: "basic" }, await fixtureCreator(ctx, a.creatorId));
      if (!r.ok) return { ok: false, reason: `page unavailable (${r.status})` };
      const body = (await r.json()) as { results?: Array<{ url?: string; raw_content?: string }> };
      const page = body.results?.[0];
      if (!page?.raw_content) return { ok: false, reason: "that page came back empty" };
      return { ok: true, checkedOn: new Date().toISOString().slice(0, 10), results: [{ url: target, title: "", excerpt: page.raw_content.slice(0, 2500) }] };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message.slice(0, 120) : "read failed" };
    }
  },
});
