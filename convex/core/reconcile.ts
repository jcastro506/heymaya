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
      const body = (await res.json().catch(() => null)) as { creditsUsed?: number; credits?: number; count?: number; usage?: { credits?: number } } | null;
      const n = body?.creditsUsed ?? body?.credits ?? body?.usage?.credits ?? body?.count;
      vendor = typeof n === "number" ? n : null;
    } catch {
      vendor = null;
    }
    const ledger = await ctx.runQuery(internal.core.reconcile.ledgerCreditsToday, { sinceUtcMidnight: midnight });
    const r = compare(vendor, ledger);
    await ctx.runMutation(internal.core.smoke.record, { vendor: "scrapecreators", check: "reconcile", ok: r.ok, detail: r.detail });
    return { ok: r.ok, detail: r.detail };
  },
});
