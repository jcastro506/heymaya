/**
 * Cost reconciliation (plan §16.4): once a day, the vendor's own count of credits used
 * today against what our ledger says we spent. Within ten percent is fine; beyond that
 * is a vendorHealth failure the operator alert picks up, because an endpoint that
 * charges more than the table says is how a budget lies.
 */

import { v } from "convex/values";
import { internalAction, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";

export const TOLERANCE = 0.1;

/** Pure: the verdict on two numbers. */
export function compare(vendorCredits: number | null, ledgerCredits: number): { ok: boolean; delta: number | null; detail: string } {
  if (vendorCredits === null) return { ok: false, delta: null, detail: "vendor gave no number" };
  if (vendorCredits === 0 && ledgerCredits === 0) return { ok: true, delta: 0, detail: "nothing spent, both agree" };
  const base = Math.max(vendorCredits, ledgerCredits, 1);
  const delta = (vendorCredits - ledgerCredits) / base;
  return { ok: Math.abs(delta) <= TOLERANCE, delta, detail: `vendor ${vendorCredits} vs ledger ${ledgerCredits} (${Math.round(delta * 100)}%)` };
}

export const ledgerCreditsToday = internalQuery({
  args: { sinceUtcMidnight: v.number() },
  handler: async (ctx, a): Promise<number> => {
    const rows = (await ctx.db.query("costEvents").filter((q) => q.and(q.eq(q.field("vendor"), "scrapecreators"), q.gte(q.field("at"), a.sinceUtcMidnight))).collect()) as Doc<"costEvents">[];
    return rows.reduce((s, r) => s + (r.units ?? 0), 0);
  },
});

export const run = internalAction({
  args: {},
  handler: async (ctx): Promise<{ ok: boolean; detail: string }> => {
    const now = new Date();
    const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    let vendor: number | null = null;
    try {
      const res = await fetch("https://api.scrapecreators.com/v1/account/get-daily-usage-count", { headers: { "x-api-key": process.env.SCRAPE_CREATORS_API_KEY ?? "" } });
      // The vendor answers a list of days: [{ usage_date: "2026-08-23T00:00:00.000Z", total_credits: "78", request_count: "78" }, …]
      const body = (await res.json().catch(() => null)) as Array<{ usage_date?: string; total_credits?: string | number }> | null;
      if (Array.isArray(body)) {
        // The vendor's day is UTC by their definition; match it by epoch, not by slicing a string (the founder-day guard).
        const row = body.find((r) => Date.parse(String(r.usage_date ?? "")) === midnight);
        vendor = row ? Number(row.total_credits ?? 0) : 0; // no row for today means nothing was spent today
      }
    } catch {
      vendor = null;
    }
    const ledger = await ctx.runQuery(internal.core.reconcile.ledgerCreditsToday, { sinceUtcMidnight: midnight });
    const r = compare(vendor, ledger);
    await ctx.runMutation(internal.core.smoke.record, { vendor: "scrapecreators", check: "reconcile", ok: r.ok, detail: r.detail });
    return { ok: r.ok, detail: r.detail };
  },
});

/** Our ledger's OpenRouter spend in a window (every creator, eval runs included: the key pays for both). */
export const ledgerOpenRouterSince = internalQuery({
  args: { since: v.number() },
  handler: async (ctx, a): Promise<number> => {
    const rows = (await ctx.db.query("costEvents").withIndex("by_at", (q) => q.gte("at", a.since)).collect()) as Doc<"costEvents">[];
    return rows.filter((r) => r.vendor === "openrouter").reduce((s, r) => s + r.costUsd, 0);
  },
});

/**
 * COGS §7: OpenRouter's own bill against our ledger, daily. The key endpoint reports lifetime
 * usage in USD; we keep yesterday's reading and compare the difference with what the ledger
 * recorded over the same window. Beyond 10% is a vendorHealth failure the operator alert sees.
 */
export const openRouter = internalAction({
  args: {},
  handler: async (ctx): Promise<{ ok: boolean; detail: string }> => {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) return { ok: false, detail: "no OPENROUTER_API_KEY" };
    let usage: number | null = null;
    try {
      const res = await fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
      const body = (await res.json().catch(() => null)) as { data?: { usage?: number } } | null;
      usage = typeof body?.data?.usage === "number" ? body.data.usage : null;
    } catch {
      usage = null;
    }
    const prevRaw = await ctx.runQuery(internal.connections.sync.cursor, { key: "openrouter:usage" });
    const now = Date.now();
    if (usage !== null) await ctx.runMutation(internal.connections.sync.setCursor, { key: "openrouter:usage", value: JSON.stringify({ usage, at: now }) });
    if (usage === null) {
      await ctx.runMutation(internal.core.smoke.record, { vendor: "openrouter", check: "reconcile", ok: false, detail: "vendor gave no number" });
      return { ok: false, detail: "vendor gave no number" };
    }
    const prev = prevRaw ? (JSON.parse(prevRaw) as { usage: number; at: number }) : null;
    if (!prev) {
      await ctx.runMutation(internal.core.smoke.record, { vendor: "openrouter", check: "reconcile", ok: true, detail: "first reading kept; compares from tomorrow" });
      return { ok: true, detail: "first reading" };
    }
    const vendorUsd = Math.max(0, usage - prev.usage);
    const ledgerUsd = await ctx.runQuery(internal.core.reconcile.ledgerOpenRouterSince, { since: prev.at });
    const base = Math.max(vendorUsd, ledgerUsd, 0.01);
    const delta = (vendorUsd - ledgerUsd) / base;
    const ok = Math.abs(delta) <= TOLERANCE || vendorUsd + ledgerUsd < 0.05; // pennies aren't a finding
    const detail = `vendor $${vendorUsd.toFixed(2)} vs ledger $${ledgerUsd.toFixed(2)} (${Math.round(delta * 100)}%)`;
    await ctx.runMutation(internal.core.smoke.record, { vendor: "openrouter", check: "reconcile", ok, detail });
    return { ok, detail };
  },
});
