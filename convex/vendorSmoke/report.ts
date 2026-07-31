/**
 * Vendor smoke suite — the operator view (§18.0.5).
 *
 * The rule this file exists to enforce: **a skip is not a pass.** A suite that
 * silently skips every check because a key is missing is a green suite that
 * proves nothing, and "we have monitoring" is a more dangerous belief than "we
 * have none". So `unverified` is its own status all the way to the surface,
 * and the fleet verdict counts it separately from healthy.
 */

import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import { ALL_VENDORS, type Vendor } from "./types";

export type VendorVerdict = "healthy" | "degraded" | "unverified" | "unknown";

export interface VendorStatus {
  vendor: Vendor;
  verdict: VendorVerdict;
  lastRanAt: number | null;
  failing: Array<{ check: string; detail: string; drifts: string[] }>;
  unverified: Array<{ check: string; detail: string }>;
  passing: number;
}

/**
 * Latest known state per vendor, derived from the most recent row for each
 * distinct check.
 *
 * Verdicts:
 *   `degraded`   — at least one check is failing. Something is actually broken.
 *   `unverified` — nothing failing, but nothing verified either (all skipped,
 *                  usually an unconfigured key). NOT healthy.
 *   `healthy`    — at least one check passed and none failed.
 *   `unknown`    — the suite has never run for this vendor.
 */
export const fleetHealth = internalQuery({
  args: { sinceMs: v.optional(v.number()) },
  handler: async (ctx, args): Promise<VendorStatus[]> => {
    const since = args.sinceMs ?? Date.now() - 7 * 24 * 60 * 60 * 1000;
    const statuses: VendorStatus[] = [];

    for (const vendor of ALL_VENDORS) {
      const rows = await ctx.db
        .query("vendorHealth")
        .withIndex("by_vendor_and_ranAt", (q) =>
          q.eq("vendor", vendor).gte("ranAt", since)
        )
        .collect();

      // Most recent row per check — an old failure that has since passed must
      // not keep a vendor red forever.
      const latestPerCheck = new Map<string, (typeof rows)[number]>();
      for (const row of rows) {
        const seen = latestPerCheck.get(row.check);
        if (!seen || row.ranAt > seen.ranAt) latestPerCheck.set(row.check, row);
      }
      const latest = [...latestPerCheck.values()];

      if (latest.length === 0) {
        statuses.push({
          vendor,
          verdict: "unknown",
          lastRanAt: null,
          failing: [],
          unverified: [],
          passing: 0,
        });
        continue;
      }

      const failing = latest
        .filter((row) => row.status === "fail")
        .map((row) => ({
          check: row.check,
          detail: row.detail ?? "failed",
          drifts: row.drifts ?? [],
        }));
      const unverified = latest
        .filter((row) => row.status === "skipped")
        .map((row) => ({ check: row.check, detail: row.detail ?? "skipped" }));
      const passing = latest.filter((row) => row.status === "pass").length;

      statuses.push({
        vendor,
        verdict:
          failing.length > 0
            ? "degraded"
            : passing > 0
              ? "healthy"
              : "unverified",
        lastRanAt: Math.max(...latest.map((row) => row.ranAt)),
        failing,
        unverified,
        passing,
      });
    }

    return statuses;
  },
});

/**
 * The pre-deploy gate: is this vendor's tier-2 shape check green?
 *
 * `ok:false` on a failure OR on never-having-run. Deliberately fail-closed —
 * "we've never checked" is not permission to ship, and a gate that treats
 * absence of evidence as evidence of health is not a gate.
 */
export const deployGate = internalQuery({
  args: { vendor: v.string(), maxAgeMs: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: boolean; reason: string; checkedAt: number | null }> => {
    const maxAge = args.maxAgeMs ?? 48 * 60 * 60 * 1000;
    const cutoff = Date.now() - maxAge;

    const rows = await ctx.db
      .query("vendorHealth")
      .withIndex("by_vendor_and_ranAt", (q) =>
        q.eq("vendor", args.vendor as "zernio").gte("ranAt", cutoff)
      )
      .collect();
    const tier2 = rows.filter((row) => row.tier === 2);

    if (tier2.length === 0) {
      return {
        ok: false,
        reason: `no tier-2 result for ${args.vendor} in the last ${Math.round(
          maxAge / 3_600_000
        )}h — run the shape suite before deploying`,
        checkedAt: null,
      };
    }

    const latestPerCheck = new Map<string, (typeof tier2)[number]>();
    for (const row of tier2) {
      const seen = latestPerCheck.get(row.check);
      if (!seen || row.ranAt > seen.ranAt) latestPerCheck.set(row.check, row);
    }
    const latest = [...latestPerCheck.values()];
    const failing = latest.filter((row) => row.status === "fail");
    const checkedAt = Math.max(...latest.map((row) => row.ranAt));

    if (failing.length > 0) {
      return {
        ok: false,
        reason: `${failing.length} tier-2 check(s) failing: ${failing
          .map((row) => `${row.check} (${row.detail ?? "failed"})`)
          .join(", ")}`,
        checkedAt,
      };
    }

    if (latest.every((row) => row.status === "skipped")) {
      return {
        ok: false,
        reason: `every tier-2 check for ${args.vendor} was skipped — unverified is not green`,
        checkedAt,
      };
    }

    return { ok: true, reason: "tier-2 green", checkedAt };
  },
});
