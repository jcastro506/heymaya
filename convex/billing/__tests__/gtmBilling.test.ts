/**
 * GTM 3-tier billing — price-env resolution unit tests.
 *
 * Covers the env-var convention STRIPE_PRICE_<TIER>_<INTERVAL> for the three
 * live GTM tiers (starter $99 / growth $149 / studio $199) in both directions:
 *   - gtmPriceId(interval, tier)        → forward (checkout)
 *   - gtmTierFromPriceId(priceId)       → reverse (webhook defense-in-depth)
 *
 * These are pure functions (no Convex runtime), so they unit-test directly
 * without convex-test or codegen. The creator-product (coach/manager) billing
 * tests live in convex/__tests__/billing.test.ts and are intentionally separate.
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  gtmPriceId,
  gtmTierFromPriceId,
  type GtmInterval,
} from "../gtmBilling";
import type { GtmPlan } from "../../gtmMaya/planGtm";

/** Every GTM price env var name, mapped to a deterministic test price id. */
const PRICE_ENVS: ReadonlyArray<[string, string]> = [
  ["STRIPE_PRICE_STARTER_MONTHLY", "price_starter_m"],
  ["STRIPE_PRICE_STARTER_ANNUAL", "price_starter_a"],
  ["STRIPE_PRICE_GROWTH_MONTHLY", "price_growth_m"],
  ["STRIPE_PRICE_GROWTH_ANNUAL", "price_growth_a"],
  ["STRIPE_PRICE_STUDIO_MONTHLY", "price_studio_m"],
  ["STRIPE_PRICE_STUDIO_ANNUAL", "price_studio_a"],
];

function setGtmPriceEnvs(): () => void {
  const prior: Record<string, string | undefined> = {};
  for (const [k, v] of PRICE_ENVS) {
    prior[k] = process.env[k];
    process.env[k] = v;
  }
  return () => {
    for (const [k] of PRICE_ENVS) {
      if (prior[k] === undefined) delete process.env[k];
      else process.env[k] = prior[k];
    }
  };
}

let teardown: (() => void) | null = null;
afterEach(() => {
  teardown?.();
  teardown = null;
});

describe("gtmBilling.gtmPriceId — 3-tier env resolution", () => {
  it.each<[GtmPlan, GtmInterval, string]>([
    ["starter", "monthly", "price_starter_m"],
    ["starter", "annual", "price_starter_a"],
    ["growth", "monthly", "price_growth_m"],
    ["growth", "annual", "price_growth_a"],
    ["studio", "monthly", "price_studio_m"],
    ["studio", "annual", "price_studio_a"],
  ])(
    "PLAN-TIER × ACTION: %s/%s resolves STRIPE_PRICE_<TIER>_<INTERVAL> → %s",
    (tier, interval, expected) => {
      teardown = setGtmPriceEnvs();
      expect(gtmPriceId(interval, tier)).toBe(expected);
    }
  );

  it("defaults to the starter tier when tier is omitted", () => {
    teardown = setGtmPriceEnvs();
    expect(gtmPriceId("monthly")).toBe("price_starter_m");
    expect(gtmPriceId("annual")).toBe("price_starter_a");
  });

  it("returns null when the env var for that tier+interval is unset", () => {
    teardown = setGtmPriceEnvs();
    delete process.env.STRIPE_PRICE_GROWTH_MONTHLY;
    expect(gtmPriceId("monthly", "growth")).toBeNull();
    // Other tiers still resolve — one missing env doesn't break the rest.
    expect(gtmPriceId("monthly", "studio")).toBe("price_studio_m");
  });

  it("returns null for an empty-string env value (treated as unset)", () => {
    teardown = setGtmPriceEnvs();
    process.env.STRIPE_PRICE_STARTER_MONTHLY = "";
    expect(gtmPriceId("monthly", "starter")).toBeNull();
  });
});

describe("gtmBilling.gtmTierFromPriceId — reverse price-id lookup", () => {
  it.each<[string, GtmPlan]>([
    ["price_starter_m", "starter"],
    ["price_starter_a", "starter"],
    ["price_growth_m", "growth"],
    ["price_growth_a", "growth"],
    ["price_studio_m", "studio"],
    ["price_studio_a", "studio"],
  ])("recovers tier %s → %s across all three tiers", (priceId, tier) => {
    teardown = setGtmPriceEnvs();
    expect(gtmTierFromPriceId(priceId)).toBe(tier);
  });

  it("returns null for an unknown price id and for null/empty input", () => {
    teardown = setGtmPriceEnvs();
    expect(gtmTierFromPriceId("price_does_not_exist")).toBeNull();
    expect(gtmTierFromPriceId(null)).toBeNull();
    expect(gtmTierFromPriceId(undefined)).toBeNull();
    expect(gtmTierFromPriceId("")).toBeNull();
  });
});
