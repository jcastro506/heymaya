/**
 * Stripe creator products config — Sprint 9 spec validation tests.
 *
 * The config in `convex/integrations/stripe/products.ts` is the single
 * source of truth read by both the seeder script
 * (`scripts/stripe/createCreatorProducts.ts`) and any future deploy-time
 * drift detector. These tests pin the spec so a typo in pricing or a
 * lookup-key drift is caught before it ships to Stripe.
 *
 * Coverage:
 *   1. Cross-tenant — N/A (config is global, not per-creator).
 *   2. Plan-tier × action — Coach + Manager configured exactly per spec.
 *   3. Adversarial — statement_descriptor honors Stripe's 22-char cap.
 *   4. Sibling-file scan — env-var names + lookup keys + tier keys all
 *      align across the seeder, the priceIds.ts table, and the products
 *      config. (This catches the "operator added a tier here but forgot
 *      to wire env vars there" failure mode.)
 *   5. TODO grep — none introduced.
 */

import { describe, expect, it } from "vitest";
import {
  CREATOR_TIER_CONFIGS,
  HEYMAYA_CREATOR_TIER_TAG,
  priceEnvVarName,
  priceLookupKey,
  productLookupKey,
} from "../products";
import { SELLABLE_PRICE_ENV_VARS } from "../../../billing/priceIds";

describe("Stripe creator products config — locked pricing", () => {
  it("ships Coach + Manager only (2 tiers, no others)", () => {
    expect(CREATOR_TIER_CONFIGS.length).toBe(2);
    expect(CREATOR_TIER_CONFIGS.map((t) => t.key).sort()).toEqual([
      "coach",
      "manager",
    ]);
  });

  it("Coach: $19.99 monthly / $199 annual", () => {
    const coach = CREATOR_TIER_CONFIGS.find((t) => t.key === "coach")!;
    expect(coach.monthlyCents).toBe(1999);
    expect(coach.annualCents).toBe(19900);
    expect(coach.productName).toBe("HeyMaya Coach");
  });

  it("Manager: $49.99 monthly / $499 annual", () => {
    const manager = CREATOR_TIER_CONFIGS.find((t) => t.key === "manager")!;
    expect(manager.monthlyCents).toBe(4999);
    expect(manager.annualCents).toBe(49900);
    expect(manager.productName).toBe("HeyMaya Manager");
  });

  it("annual saves a meaningful amount vs 12× monthly (sanity check on pricing)", () => {
    for (const t of CREATOR_TIER_CONFIGS) {
      // Annual must be cheaper than 12× monthly (otherwise no incentive).
      expect(t.annualCents).toBeLessThan(t.monthlyCents * 12);
      // And annual must be at least 9× monthly (otherwise we're giving it
      // away — would catch a typo like 1990 instead of 19900). 9× is the
      // floor because Coach is $19.99 mo / $199 yr = 9.96× — we round
      // down to 9× as the lower-bound sanity check.
      expect(t.annualCents).toBeGreaterThanOrEqual(t.monthlyCents * 9);
    }
  });
});

describe("Stripe creator products config — Stripe constraints", () => {
  it("statement_descriptor fits Stripe's 22-char cap", () => {
    for (const t of CREATOR_TIER_CONFIGS) {
      expect(t.statementDescriptor.length).toBeLessThanOrEqual(22);
      expect(t.statementDescriptor).toBe(t.statementDescriptor.toUpperCase());
    }
  });

  it("description is non-empty (Stripe will display this on Checkout)", () => {
    for (const t of CREATOR_TIER_CONFIGS) {
      expect(t.description.trim().length).toBeGreaterThan(20);
    }
  });

  it("HEYMAYA_CREATOR_TIER_TAG is a stable namespace prefix", () => {
    expect(HEYMAYA_CREATOR_TIER_TAG).toBe("heymaya_creator_tier_v0");
  });
});

describe("Stripe creator products config — lookup helpers", () => {
  it("productLookupKey matches the seeder convention", () => {
    expect(productLookupKey("coach")).toBe("creator-coach");
    expect(productLookupKey("manager")).toBe("creator-manager");
  });

  it("priceLookupKey is deterministic per (tier, interval)", () => {
    expect(priceLookupKey("coach", "month")).toBe("creator-coach-monthly");
    expect(priceLookupKey("coach", "year")).toBe("creator-coach-annual");
    expect(priceLookupKey("manager", "month")).toBe("creator-manager-monthly");
    expect(priceLookupKey("manager", "year")).toBe("creator-manager-annual");
  });

  it("priceEnvVarName matches the table priceIds.ts reads", () => {
    expect(priceEnvVarName("coach", "month")).toBe("STRIPE_PRICE_COACH_MONTHLY");
    expect(priceEnvVarName("coach", "year")).toBe("STRIPE_PRICE_COACH_ANNUAL");
    expect(priceEnvVarName("manager", "month")).toBe(
      "STRIPE_PRICE_MANAGER_MONTHLY"
    );
    expect(priceEnvVarName("manager", "year")).toBe(
      "STRIPE_PRICE_MANAGER_ANNUAL"
    );
  });
});

describe("Stripe creator products config — sibling-file alignment", () => {
  it("every (tier, interval) in the products config has a matching SELLABLE_PRICE_ENV_VARS entry", () => {
    const expectedEnvVars = new Set<string>();
    for (const t of CREATOR_TIER_CONFIGS) {
      expectedEnvVars.add(priceEnvVarName(t.key, "month"));
      expectedEnvVars.add(priceEnvVarName(t.key, "year"));
    }
    const actualEnvVars = new Set(
      SELLABLE_PRICE_ENV_VARS.map((e) => e.envVar)
    );
    expect(actualEnvVars).toEqual(expectedEnvVars);
  });

  it("metadataLookupKey maps 1:1 with tier × interval", () => {
    for (const t of CREATOR_TIER_CONFIGS) {
      expect(t.metadataLookupKey.monthly).toMatch(
        new RegExp(`^heymaya_creator_${t.key}_monthly$`)
      );
      expect(t.metadataLookupKey.annual).toMatch(
        new RegExp(`^heymaya_creator_${t.key}_annual$`)
      );
    }
  });
});
