/** One Stripe product per plan (Stripe's plan-switch page requires it), priced from tiers.ts only. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { planCatalog } from "../stripeAdmin";
import { TIERS, priceEnvKey } from "../tiers";

describe("the per-plan Stripe catalog", () => {
  it("three products, each with a monthly and annual price, amounts from tiers.ts, env keys the app reads", () => {
    const c = planCatalog();
    expect(c.map((p) => p.tier)).toEqual(["solo", "duo", "partner"]);
    for (const p of c) {
      const t = TIERS[p.tier as keyof typeof TIERS];
      expect(p.name).toBe(`Maya: ${t.label}`);
      expect(p.prices.map((x) => [x.interval, x.recurring, x.unitAmount])).toEqual([["monthly", "month", Math.round(t.priceUsd * 100)], ["annual", "year", Math.round(t.annualUsd * 100)]]);
      expect(p.prices.map((x) => x.envKey)).toEqual([priceEnvKey(p.tier as never, "monthly"), priceEnvKey(p.tier as never, "annual")]);
      expect(new Set(p.prices.map((x) => x.recurring)).size, "one price per interval per product").toBe(2);
    }
  });
  it("only ever adds: it never archives, deactivates or edits an existing product or price, and dry-runs by default", () => {
    const src = readFileSync(new URL("../stripeAdmin.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/products\.(update|del)|prices\.update|active: false/);
    expect(src).toMatch(/const apply = a\.apply === true;/);
  });
});
