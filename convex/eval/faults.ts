/**
 * The outage drill's fault switch (docs/OUTAGE_DRILL.md). Principle 5 says nothing fails silently;
 * this is how we prove it under the failures vendors actually have: ScrapeCreators out of credits
 * (402), rate limited (429), down (500) or hanging; Gemini overloaded or hanging; OpenRouter 5xx or
 * hanging for the writer and for the classifier; Zernio, Tavily and Gmail 5xx.
 *
 * It is a THIN GUARD at the existing vendor boundaries, never a new code path: each boundary asks
 * `faultFor(...)` and, when a fault is on, the real client runs against a fetch that answers the
 * way the vendor does when it is failing (the real status, the real body shape), so the real retry,
 * error mapping, caching and messaging code is what gets measured.
 *
 * Production can never trip it, and neither can a real creator. All of these must hold, and each is
 * checked where the fault is read (fail-closed: anything missing means no fault):
 *  1. `ENVIRONMENT_NAME` is set and is not "production", and the deployment is not a production one;
 *  2. the `eval:faults` syncState row exists and has not expired (at most two hours);
 *  3. the call names a creator, that creator is listed in the row, and it is an eval creator
 *     (`eval:` / `eval-run:` subject, no phone, no Telegram chat): the only creators whose messages
 *     are never delivered to anyone (core/messages.ts).
 * In production the check is one env comparison: no query, no read.
 */
import { v } from "convex/values";
import { internalQuery, type ActionCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { REGISTRY } from "../agent/registry";

export const FAULTS = [
  "scrape_402", "scrape_429", "scrape_500", "scrape_timeout",
  "gemini_overload", "gemini_timeout",
  "writer_5xx", "writer_timeout", "classifier_5xx", "classifier_timeout",
  "zernio_5xx", "tavily_5xx", "gmail_5xx",
] as const;
export type Fault = (typeof FAULTS)[number];
export type FaultVendor = "scrapecreators" | "gemini" | "openrouter" | "zernio" | "tavily" | "gmail";

export const VENDOR_OF: Record<Fault, FaultVendor> = {
  scrape_402: "scrapecreators", scrape_429: "scrapecreators", scrape_500: "scrapecreators", scrape_timeout: "scrapecreators",
  gemini_overload: "gemini", gemini_timeout: "gemini",
  writer_5xx: "openrouter", writer_timeout: "openrouter", classifier_5xx: "openrouter", classifier_timeout: "openrouter",
  zernio_5xx: "zernio", tavily_5xx: "tavily", gmail_5xx: "gmail",
};

export const FAULTS_KEY = "eval:faults";
export const HITS_KEY = "eval:faults:hits";
export const MAX_TTL_MS = 2 * 60 * 60_000;
/** Production deployments by name, a second lock behind ENVIRONMENT_NAME (CLAUDE.md, Environments). */
export const PRODUCTION_DEPLOYMENTS = ["resilient-mandrill-621"];

export interface FaultConfig { faults: Fault[]; creatorIds: string[]; expiresAt: number; runId?: string }

/** Pure: may this deployment inject faults at all? Unset or production means no. */
export function faultsEnabled(env: Record<string, string | undefined>): boolean {
  const name = env.ENVIRONMENT_NAME?.trim();
  if (!name || name === "production" || name === "prod") return false;
  const url = `${env.CONVEX_CLOUD_URL ?? ""} ${env.CONVEX_SITE_URL ?? ""}`;
  return !PRODUCTION_DEPLOYMENTS.some((d) => url.includes(d));
}

/** Pure: the only creators a fault may touch. Never a person: no phone, no chat, an eval subject. */
export function isFaultableCreator(c: Pick<Doc<"creators">, "clerkUserId" | "telegramChatId" | "phone"> | null): boolean {
  return Boolean(c && /^eval(-run)?:/.test(c.clerkUserId) && !c.telegramChatId && !c.phone);
}

/** Pure: is this call the classifier? (The classifier runs on the screener models, so it is named by purpose.) */
export function isClassifierPurpose(purpose: string | undefined): boolean {
  return /^classif/.test(purpose ?? "");
}

/** Pure: is this call the writer? The writer's two models, and only them (the critic is another family). */
export function isWriterModel(model: string | undefined, writer = REGISTRY.writer): boolean {
  return Boolean(model && (model === writer.primary || model === writer.fallback));
}

/** Pure: which fault (if any) applies to one call, given the config. */
export function pickFault(config: FaultConfig | null, vendor: FaultVendor, now: number, call: { creatorId?: string; purpose?: string; model?: string } = {}): Fault | null {
  if (!config || config.expiresAt <= now || !call.creatorId || !config.creatorIds.includes(call.creatorId)) return null;
  const on = config.faults.filter((f) => VENDOR_OF[f] === vendor);
  if (!on.length) return null;
  if (vendor !== "openrouter") return on[0];
  if (isClassifierPurpose(call.purpose)) return on.find((f) => f.startsWith("classifier_")) ?? null;
  if (isWriterModel(call.model)) return on.find((f) => f.startsWith("writer_")) ?? null;
  return null;
}

export function parseConfig(value: string | undefined): FaultConfig | null {
  if (!value) return null;
  try {
    const c = JSON.parse(value) as Partial<FaultConfig>;
    if (!Array.isArray(c.faults) || !Array.isArray(c.creatorIds) || typeof c.expiresAt !== "number") return null;
    return { faults: c.faults.filter((f): f is Fault => (FAULTS as readonly string[]).includes(f)), creatorIds: c.creatorIds.map(String), expiresAt: c.expiresAt, runId: c.runId };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ what a failing vendor sends back

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/** Pure: what the vendor sends when it is failing this way; an Error for a hang (the fetch rejects as it would on abort). */
export function faultResponse(fault: Fault): Response | Error {
  switch (fault) {
    case "scrape_402": return json(402, { success: false, message: "You are out of credits. Please purchase more credits to continue." });
    case "scrape_429": return json(429, { success: false, message: "Too many requests" }, { "retry-after": "0" });
    case "scrape_500": return new Response("Internal Server Error", { status: 500 });
    case "gemini_overload": return json(503, { error: { code: 503, message: "The model is overloaded. Please try again later.", status: "UNAVAILABLE" } });
    case "zernio_5xx": return json(503, { error: "Service temporarily unavailable" });
    case "tavily_5xx": return json(502, { detail: "Bad gateway" });
    case "gmail_5xx": return json(503, { error: { code: 503, message: "The service is currently unavailable.", status: "UNAVAILABLE" } });
    case "scrape_timeout": { const e = new Error("The operation was aborted."); e.name = "AbortError"; return e; }
    case "gemini_timeout": { const e = new Error("The operation was aborted due to timeout"); e.name = "TimeoutError"; return e; }
    // OpenRouter faults are answered in callModel (its client takes no fetch); these are never fetched.
    case "writer_5xx": case "classifier_5xx": return json(503, { error: { message: "Provider returned error", code: 503 } });
    case "writer_timeout": case "classifier_timeout": { const e = new Error("This operation was aborted"); e.name = "AbortError"; return e; }
  }
}

/** A fetch that fails the way the vendor does. A fresh Response per call: a body reads once. */
export function faultFetch(fault: Fault): typeof fetch {
  return (async () => {
    const r = faultResponse(fault);
    if (r instanceof Error) throw r;
    return r;
  }) as unknown as typeof fetch;
}

/** OpenRouter's client never throws; these are the reasons it returns for a 5xx and for a hang. */
export function modelFaultResult(fault: Fault): { ok: false; reason: string } {
  return fault.endsWith("_timeout") ? { ok: false, reason: "openrouter timed out" } : { ok: false, reason: 'openrouter 503: {"error":{"message":"Provider returned error","code":503}}' };
}

/** A vendorHealth check written by a pass that ran under an injected fault: the operator console shows it; the hourly alert and creator status skip it. */
export const drillCheck = (check: string, fault: Fault | null | undefined): string => (fault ? `${check}:drill` : check);
export const isDrillCheck = (check: string): boolean => check.endsWith(":drill");

// ------------------------------------------------------------------ the switch

export const active = internalQuery({
  args: { creatorId: v.id("creators"), vendor: v.string(), purpose: v.optional(v.string()), model: v.optional(v.string()) },
  handler: async (ctx, a): Promise<Fault | null> => {
    if (!faultsEnabled(process.env)) return null;
    const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", FAULTS_KEY)).unique();
    const config = parseConfig(row?.value);
    if (!config || !config.creatorIds.includes(a.creatorId)) return null;
    if (!isFaultableCreator((await ctx.db.get(a.creatorId)) as Doc<"creators"> | null)) return null;
    return pickFault(config, a.vendor as FaultVendor, Date.now(), { creatorId: a.creatorId, purpose: a.purpose, model: a.model });
  },
});

/** Every injected failure is counted, so a drill cell can say whether its fault was actually reached. */
export const hit = internalMutation({
  // `ref`: what the failed call was about (a read's `kind|key`), so the drill can check what got cached.
  args: { fault: v.string(), purpose: v.optional(v.string()), ref: v.optional(v.string()) },
  handler: async (ctx, a): Promise<null> => {
    const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", HITS_KEY)).unique();
    const state = parseHits(row?.value);
    const k = a.purpose ? `${a.fault}:${a.purpose}` : a.fault;
    state.counts[k] = (state.counts[k] ?? 0) + 1;
    if (a.ref && !state.refs.includes(a.ref) && state.refs.length < 100) state.refs.push(a.ref);
    if (row) await ctx.db.patch(row._id, { value: JSON.stringify(state), updatedAt: Date.now() });
    else await ctx.db.insert("syncState", { key: HITS_KEY, value: JSON.stringify(state), updatedAt: Date.now() });
    return null;
  },
});

export interface Hits { counts: Record<string, number>; refs: string[] }
export function parseHits(value: string | undefined): Hits {
  try {
    const h = value ? (JSON.parse(value) as Partial<Hits>) : {};
    return { counts: h.counts ?? {}, refs: h.refs ?? [] };
  } catch {
    return { counts: {}, refs: [] };
  }
}

/**
 * The boundary's one question. Actions only. Returns null in production without touching the
 * database, and null for any call that does not name a creator (a fleet pass is scoped to an eval
 * creator by passing its id, as the sampler and the sweep do when run for one creator).
 */
export async function faultFor(ctx: Pick<ActionCtx, "runQuery" | "runMutation">, creatorId: Id<"creators"> | undefined, vendor: FaultVendor, call: { purpose?: string; model?: string; count?: boolean; ref?: string } = {}): Promise<Fault | null> {
  if (!creatorId || !faultsEnabled(process.env)) return null;
  const fault: Fault | null = await ctx.runQuery(internal.eval.faults.active, { creatorId, vendor, purpose: call.purpose, model: call.model });
  // `count: false`: a pass asking only how to label its health row, not a vendor call.
  if (fault && call.count !== false) await ctx.runMutation(internal.eval.faults.hit, { fault, purpose: call.purpose, ref: call.ref });
  return fault;
}

/** Turn faults on for listed eval creators. Refuses production, unknown faults and any creator that could be a person. */
export const set = internalMutation({
  args: { faults: v.array(v.string()), creatorIds: v.array(v.id("creators")), ttlMinutes: v.optional(v.number()), runId: v.optional(v.string()) },
  handler: async (ctx, a): Promise<FaultConfig> => {
    if (!faultsEnabled(process.env)) throw new Error("fault injection is off on this deployment (ENVIRONMENT_NAME is unset or production)");
    const unknown = a.faults.filter((f) => !(FAULTS as readonly string[]).includes(f));
    if (unknown.length) throw new Error(`unknown fault: ${unknown.join(", ")}`);
    if (!a.creatorIds.length) throw new Error("name at least one eval creator");
    for (const id of a.creatorIds) if (!isFaultableCreator((await ctx.db.get(id)) as Doc<"creators"> | null)) throw new Error(`${id} is not an isolated eval creator`);
    const config: FaultConfig = { faults: a.faults as Fault[], creatorIds: a.creatorIds.map(String), expiresAt: Date.now() + Math.min(MAX_TTL_MS, Math.max(1, a.ttlMinutes ?? 60) * 60_000), ...(a.runId ? { runId: a.runId } : {}) };
    const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", FAULTS_KEY)).unique();
    if (row) await ctx.db.patch(row._id, { value: JSON.stringify(config), updatedAt: Date.now() });
    else await ctx.db.insert("syncState", { key: FAULTS_KEY, value: JSON.stringify(config), updatedAt: Date.now() });
    return config;
  },
});

export const clear = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ cleared: boolean }> => {
    const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", FAULTS_KEY)).unique();
    if (row) await ctx.db.delete(row._id);
    return { cleared: Boolean(row) };
  },
});

export const current = internalQuery({
  args: {},
  handler: async (ctx): Promise<{ config: FaultConfig | null; hits: Hits }> => {
    const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", FAULTS_KEY)).unique();
    const hits = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", HITS_KEY)).unique();
    return { config: parseConfig(row?.value), hits: parseHits(hits?.value) };
  },
});

export const resetHits = internalMutation({
  args: {},
  handler: async (ctx): Promise<null> => {
    const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", HITS_KEY)).unique();
    if (row) await ctx.db.delete(row._id);
    return null;
  },
});
