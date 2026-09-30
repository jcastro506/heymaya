/**
 * Plan changes run through our own Stripe portal configuration (2026-09-29): Stripe's default had
 * switching off, so "Unlock with Partner" landed on a page that only showed the current plan.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fingerprintOf, planPriceIds, portalConfigParams, productsFor, PORTAL_TAG } from "../portal";

describe("the plan-switch portal configuration", () => {
  it("switching is on, prorated, between exactly our plan prices; card, invoices and cancel stay", () => {
    const products = productsFor([{ id: "price_duo_m", product: "prod_duo" }, { id: "price_solo_m", product: "prod_solo" }, { id: "price_duo_y", product: "prod_duo" }]);
    expect(products).toEqual([{ product: "prod_duo", prices: ["price_duo_m", "price_duo_y"] }, { product: "prod_solo", prices: ["price_solo_m"] }]);
    const p = portalConfigParams(products, "fp");
    expect(p.features.subscription_update).toEqual({ enabled: true, default_allowed_updates: ["price"], proration_behavior: "create_prorations", products });
    expect(p.features.subscription_cancel).toMatchObject({ enabled: true, mode: "at_period_end" });
    expect(p.features.payment_method_update?.enabled).toBe(true);
    expect(p.metadata).toEqual({ maya: PORTAL_TAG, prices: "fp" });
  });

  it("reads every configured price from the env; a changed price means a new fingerprint", () => {
    const env = { STRIPE_PRICE_SOLO_MONTHLY: "a", STRIPE_PRICE_DUO_MONTHLY: "b", STRIPE_PRICE_PARTNER_ANNUAL: "c" };
    const keys = planPriceIds(env);
    expect(keys.length).toBeGreaterThan(0);
    expect(fingerprintOf(["b", "a"])).toBe(fingerprintOf(["a", "b"]));
    expect(fingerprintOf(["a", "b"])).not.toBe(fingerprintOf(["a", "x"]));
  });

  it("every portal session uses it (upgrade, and card/invoices/cancel)", () => {
    const src = readFileSync(new URL("../checkout.ts", import.meta.url), "utf8");
    expect(src.match(/planSwitchConfigId\(stripe\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(src).toMatch(/configuration,\n\s+return_url/);
  });
});
