/**
 * Stripe creator-product seeder — Coach + Manager 2-tier model
 * (operator-run, idempotent).
 *
 * Creates the 2 CREATOR-tier products (Coach / Manager) with their
 * monthly + annual recurring prices. Designed to be re-runnable: every
 * created object is tagged with `metadata.heymaya_creator_tier_v0` and the
 * script uses the metadata + `lookup_key` (canonical name) to detect
 * existing rows on rerun rather than blindly creating duplicates.
 *
 * Pricing (locked):
 *   - Coach   — $19.99/mo, $199/yr
 *   - Manager — $49.99/mo, $499/yr
 *
 * Trial: 7 days free on BOTH tiers for new sign-ups (first subscription only).
 *   Trials are applied at SUBSCRIPTION creation time (not on the price), so
 *   this script does NOT encode the trial — see
 *   `convex/billing/checkout.ts` for the trial gating.
 *
 * Output: writes `scripts/stripe/stripe-creator-products.json` mapping the
 * price ids the operator pastes into env vars (or copies into Convex env).
 *
 * Usage (operator):
 *   STRIPE_SECRET_KEY=sk_test_... npx tsx scripts/stripe/createCreatorProducts.ts
 *
 * After it succeeds, set the printed env vars in `.env.local` AND in Convex:
 *   npx convex env set STRIPE_PRICE_COACH_MONTHLY price_xxx
 *   ... (one per row)
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
import Stripe from "stripe";

/* ---------------------------------------------------------------------- */
/* Configuration — locked tier prices                                      */
/* ---------------------------------------------------------------------- */

interface TierConfig {
  key: "coach" | "manager";
  productName: string;
  /** Stripe statement_descriptor — must be ≤ 22 chars, uppercase. */
  statementDescriptor: string;
  description: string;
  monthlyCents: number;
  annualCents: number;
  /** Metadata key used by checkout/webhook for filterability. */
  metadataLookupKey: {
    monthly: string;
    annual: string;
  };
}

const CREATOR_TIERS: ReadonlyArray<TierConfig> = [
  {
    key: "coach",
    productName: "HeyMaya Coach",
    statementDescriptor: "HEYMAYA COACH",
    description:
      "Maya as your AI creator coach. Daily proactive guidance across iMessage. Limited cron set, capped chat, cost-bounded thinking budget. The post-trial default.",
    monthlyCents: 1999, // $19.99
    annualCents: 19900, // $199.00
    metadataLookupKey: {
      monthly: "heymaya_creator_coach_monthly",
      annual: "heymaya_creator_coach_annual",
    },
  },
  {
    key: "manager",
    productName: "HeyMaya Manager",
    statementDescriptor: "HEYMAYA MANAGER",
    description:
      "Maya as your full-time AI creator manager. Full proactive cron set, unlimited chat, all thinking budgets, full Gmail deal desk, brand-contact discovery via Apollo/Hunter. New sign-ups get 7 days free.",
    monthlyCents: 4999, // $49.99
    annualCents: 49900, // $499.00
    metadataLookupKey: {
      monthly: "heymaya_creator_manager_monthly",
      annual: "heymaya_creator_manager_annual",
    },
  },
];

/** Tag attached to every product/price the script creates so reruns can
 *  detect existing rows rather than duplicating. Mirrors the service
 *  product's `heymaya_service_tier_v0` convention. */
const HEYMAYA_TIER_TAG = "heymaya_creator_tier_v0";

/* ---------------------------------------------------------------------- */
/* Helpers                                                                 */
/* ---------------------------------------------------------------------- */

async function findProductByLookupKey(
  stripe: Stripe,
  lookupKey: string
): Promise<Stripe.Product | null> {
  // Stripe doesn't support lookup_key on Product directly; we use metadata
  // search. List products with the metadata tag and filter.
  const result = await stripe.products.search({
    query: `metadata['${HEYMAYA_TIER_TAG}']:'${lookupKey}'`,
  });
  return result.data[0] ?? null;
}

async function findPriceByLookupKey(
  stripe: Stripe,
  lookupKey: string
): Promise<Stripe.Price | null> {
  const result = await stripe.prices.list({
    lookup_keys: [lookupKey],
    limit: 1,
    active: true,
  });
  return result.data[0] ?? null;
}

async function ensureProduct(
  stripe: Stripe,
  cfg: TierConfig
): Promise<Stripe.Product> {
  const lookupKey = `creator-${cfg.key}`;
  const existing = await findProductByLookupKey(stripe, lookupKey);
  if (existing) {
    console.log(`[product] reuse ${existing.id} (${cfg.productName})`);
    return existing;
  }
  // Stripe statement_descriptor cap is 22 chars. We pre-defined them at ≤22
  // but assert defensively.
  if (cfg.statementDescriptor.length > 22) {
    throw new Error(
      `statementDescriptor for ${cfg.key} exceeds 22-char Stripe cap: "${cfg.statementDescriptor}"`
    );
  }
  const created = await stripe.products.create({
    name: cfg.productName,
    description: cfg.description,
    statement_descriptor: cfg.statementDescriptor,
    metadata: {
      [HEYMAYA_TIER_TAG]: lookupKey,
      heymaya_product_kind: "creator-tier",
      heymaya_creator_tier: cfg.key,
    },
  });
  console.log(`[product] CREATED ${created.id} (${cfg.productName})`);
  return created;
}

async function ensureRecurringPrice(
  stripe: Stripe,
  product: Stripe.Product,
  cfg: TierConfig,
  interval: "month" | "year"
): Promise<Stripe.Price> {
  const intervalSuffix = interval === "month" ? "monthly" : "annual";
  const lookupKey = `creator-${cfg.key}-${intervalSuffix}`;
  const existing = await findPriceByLookupKey(stripe, lookupKey);
  if (existing) {
    console.log(
      `[price ] reuse ${existing.id} (${cfg.key} ${intervalSuffix})`
    );
    return existing;
  }
  const unitAmount =
    interval === "month" ? cfg.monthlyCents : cfg.annualCents;
  const filterableKey =
    interval === "month"
      ? cfg.metadataLookupKey.monthly
      : cfg.metadataLookupKey.annual;
  const created = await stripe.prices.create({
    product: product.id,
    unit_amount: unitAmount,
    currency: "usd",
    recurring: { interval },
    lookup_key: lookupKey,
    // Caller adds tax — `exclusive` is the correct setting for B2C SaaS where
    // we surface the headline price ($19.99 / $49.99) and Stripe Tax computes
    // sales tax on top.
    tax_behavior: "exclusive",
    metadata: {
      [HEYMAYA_TIER_TAG]: lookupKey,
      heymaya_creator_tier: cfg.key,
      heymaya_creator_billing: intervalSuffix,
      // Operator-facing metadata key per the locked spec — lets the operator
      // filter prices in the Stripe dashboard by exact spec name.
      [filterableKey]: "true",
    },
  });
  console.log(
    `[price ] CREATED ${created.id} (${cfg.key} ${intervalSuffix} $${unitAmount / 100} USD)`
  );
  return created;
}

/* ---------------------------------------------------------------------- */
/* Main                                                                    */
/* ---------------------------------------------------------------------- */

interface OutputManifest {
  generatedAt: string;
  stripeApiVersion: string;
  tiers: Record<
    "coach" | "manager",
    {
      productId: string;
      monthlyPriceId: string;
      annualPriceId: string;
    }
  >;
  envVarsNeeded: string[];
  trialReminder: string;
}

async function main(): Promise<void> {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    console.error(
      "STRIPE_SECRET_KEY is not set. Export it before running this script."
    );
    process.exit(1);
  }

  const stripe = new Stripe(secret);

  const tierResults: Record<
    "coach" | "manager",
    { productId: string; monthlyPriceId: string; annualPriceId: string }
  > = {
    coach: { productId: "", monthlyPriceId: "", annualPriceId: "" },
    manager: { productId: "", monthlyPriceId: "", annualPriceId: "" },
  };

  for (const cfg of CREATOR_TIERS) {
    const product = await ensureProduct(stripe, cfg);
    const monthly = await ensureRecurringPrice(stripe, product, cfg, "month");
    const annual = await ensureRecurringPrice(stripe, product, cfg, "year");
    tierResults[cfg.key] = {
      productId: product.id,
      monthlyPriceId: monthly.id,
      annualPriceId: annual.id,
    };
  }

  const envVars = [
    `STRIPE_PRICE_COACH_MONTHLY=${tierResults.coach.monthlyPriceId}`,
    `STRIPE_PRICE_COACH_ANNUAL=${tierResults.coach.annualPriceId}`,
    `STRIPE_PRICE_MANAGER_MONTHLY=${tierResults.manager.monthlyPriceId}`,
    `STRIPE_PRICE_MANAGER_ANNUAL=${tierResults.manager.annualPriceId}`,
  ];

  const manifest: OutputManifest = {
    generatedAt: new Date().toISOString(),
    stripeApiVersion: stripe.getApiField("version") ?? "default",
    tiers: tierResults,
    envVarsNeeded: envVars,
    trialReminder: [
      "7-day free trial applies to BOTH Coach and Manager on first subscription.",
      "It is NOT encoded on the Stripe price — see convex/billing/checkout.ts",
      "for the gating logic. On Manager trial expiry the subscription should",
      "either continue at the chosen tier (if card on file) or be canceled by",
      "Stripe; cancel handler downgrades to Coach (the post-cancel floor).",
    ].join("\n"),
  };

  const outPath = path.resolve(__dirname, "stripe-creator-products.json");
  writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log("\n=== DONE ===");
  console.log(`Wrote manifest to ${outPath}`);
  console.log("\nSet these env vars in .env.local AND Convex env:");
  for (const line of envVars) console.log(`  ${line}`);
  console.log("\n" + manifest.trialReminder);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
