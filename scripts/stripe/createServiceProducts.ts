/**
 * Stripe service-product seeder — Wave D (operator-run, idempotent).
 *
 * Creates the 3 SERVICE-tier products (Starter / Pro / Studio) with their
 * monthly + annual recurring prices, plus the 2 metered voice-overage prices
 * (Pro $0.20/min, Studio $0.15/min). Designed to be re-runnable: every
 * created object is tagged with `metadata.heymaya_service_tier_v0` and the
 * script uses the metadata + `lookup_key` (canonical name) to detect
 * existing rows on rerun rather than blindly creating duplicates.
 *
 * Output: writes `scripts/stripe/stripe-products.json` mapping the price
 * ids the operator pastes into env vars (or copies into Convex env).
 *
 * Usage (operator):
 *   STRIPE_SECRET_KEY=sk_test_... npx tsx scripts/stripe/createServiceProducts.ts
 *
 * After it succeeds, set the printed env vars in `.env.local` AND in Convex:
 *   npx convex env set STRIPE_SERVICE_PRICE_STARTER_MONTHLY price_xxx
 *   ... (one per row)
 *
 * The Stripe Billing Meters (event_name → meter mapping) ALSO needs to be
 * configured in the Stripe Dashboard's Billing → Meters UI per
 * https://docs.stripe.com/billing/subscriptions/usage-based/meters/configure
 * — the script CANNOT create meters via API (they're a dashboard-only
 * resource at the time of v0). The script prints the two `event_name` strings
 * the operator must paste into the meter-create UI:
 *   - heymaya_service_voice_minutes_pro   → Pro overage at $0.20/min
 *   - heymaya_service_voice_minutes_studio → Studio overage at $0.15/min
 *
 * NOTE: prices on the metered products use Stripe's "graduated" or
 * "package" pricing models that gate around the metered usage. We use a
 * simple `unit_amount` × per-event reporting (Stripe sums meter values into
 * line items at invoice time). Quantity rounding is in-app
 * (`voiceMetering.ts` rounds partial minutes UP to the next minute, then
 * batches in $5 chunks before reporting to the meter).
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
import Stripe from "stripe";

/* ---------------------------------------------------------------------- */
/* Configuration — locked tier prices                                      */
/* ---------------------------------------------------------------------- */

interface TierConfig {
  key: "starter" | "pro" | "studio";
  productName: string;
  description: string;
  monthlyCents: number;
  annualCents: number;
}

const SERVICE_TIERS: ReadonlyArray<TierConfig> = [
  {
    key: "starter",
    productName: "HeyMaya Service Starter",
    description:
      "1 GBP, text-only (web + SMS), 200 chat turns/mo, manual review-reply approval, no voice, no CRM integration.",
    monthlyCents: 9900, // $99.00
    annualCents: 99900, // $999.00
  },
  {
    key: "pro",
    productName: "HeyMaya Service Pro",
    description:
      "1 GBP + 2 social, all 4 text channels, 1000 chat turns/mo, full Gmail deal desk, CRM (Jobber / HCP / QBO), 30 voice min/mo + $0.20/min overage.",
    monthlyCents: 14900, // $149.00
    annualCents: 149900, // $1,499.00
  },
  {
    key: "studio",
    productName: "HeyMaya Service Studio",
    description:
      "Multi-location (up to 5 GBPs), all channels, unlimited chat, ServiceTitan integration, content rejuvenation, Maya video editing, 100 voice min/mo + $0.15/min overage (hard cap 500 min/mo).",
    monthlyCents: 19900, // $199.00
    annualCents: 199900, // $1,999.00
  },
];

interface MeteredVoiceConfig {
  tier: "pro" | "studio";
  productName: string;
  description: string;
  /** Cents PER MINUTE (the unit Stripe will multiply against meter `value`). */
  unitAmountCents: number;
  meterEventName: string;
}

const METERED_VOICE_CONFIGS: ReadonlyArray<MeteredVoiceConfig> = [
  {
    tier: "pro",
    productName: "HeyMaya Service Pro — Voice Overage",
    description:
      "Voice minutes above the Pro tier's 30-min/mo inclusion. Reported via Stripe Billing Meter Events.",
    unitAmountCents: 20, // $0.20/min
    meterEventName: "heymaya_service_voice_minutes_pro",
  },
  {
    tier: "studio",
    productName: "HeyMaya Service Studio — Voice Overage",
    description:
      "Voice minutes above the Studio tier's 100-min/mo inclusion. Reported via Stripe Billing Meter Events. Hard-capped at 500 min/mo per business.",
    unitAmountCents: 15, // $0.15/min
    meterEventName: "heymaya_service_voice_minutes_studio",
  },
];

const HEYMAYA_TIER_TAG = "heymaya_service_tier_v0";

/* ---------------------------------------------------------------------- */
/* Helpers                                                                 */
/* ---------------------------------------------------------------------- */

async function findProductByLookupKey(
  stripe: Stripe,
  lookupKey: string
): Promise<Stripe.Product | null> {
  // Stripe doesn't support lookup_key on Product directly; we use metadata
  // + name match. List products with the metadata tag and filter.
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
  const lookupKey = `service-${cfg.key}`;
  const existing = await findProductByLookupKey(stripe, lookupKey);
  if (existing) {
    console.log(`[product] reuse ${existing.id} (${cfg.productName})`);
    return existing;
  }
  const created = await stripe.products.create({
    name: cfg.productName,
    description: cfg.description,
    metadata: {
      [HEYMAYA_TIER_TAG]: lookupKey,
      heymaya_product_kind: "service-tier",
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
  const lookupKey = `service-${cfg.key}-${intervalSuffix}`;
  const existing = await findPriceByLookupKey(stripe, lookupKey);
  if (existing) {
    console.log(
      `[price ] reuse ${existing.id} (${cfg.key} ${intervalSuffix})`
    );
    return existing;
  }
  const unitAmount =
    interval === "month" ? cfg.monthlyCents : cfg.annualCents;
  const created = await stripe.prices.create({
    product: product.id,
    unit_amount: unitAmount,
    currency: "usd",
    recurring: { interval },
    lookup_key: lookupKey,
    metadata: {
      [HEYMAYA_TIER_TAG]: lookupKey,
      heymaya_tier: cfg.key,
      heymaya_interval: intervalSuffix,
    },
  });
  console.log(
    `[price ] CREATED ${created.id} (${cfg.key} ${intervalSuffix} ${unitAmount / 100} USD)`
  );
  return created;
}

async function ensureMeteredProduct(
  stripe: Stripe,
  cfg: MeteredVoiceConfig
): Promise<Stripe.Product> {
  const lookupKey = `service-voice-overage-${cfg.tier}`;
  const existing = await findProductByLookupKey(stripe, lookupKey);
  if (existing) {
    console.log(`[product] reuse ${existing.id} (${cfg.productName})`);
    return existing;
  }
  const created = await stripe.products.create({
    name: cfg.productName,
    description: cfg.description,
    metadata: {
      [HEYMAYA_TIER_TAG]: lookupKey,
      heymaya_product_kind: "service-metered-voice",
      heymaya_tier: cfg.tier,
      heymaya_meter_event_name: cfg.meterEventName,
    },
  });
  console.log(`[product] CREATED ${created.id} (${cfg.productName})`);
  return created;
}

async function ensureMeteredPrice(
  stripe: Stripe,
  product: Stripe.Product,
  cfg: MeteredVoiceConfig
): Promise<Stripe.Price> {
  const lookupKey = `service-voice-overage-${cfg.tier}-price`;
  const existing = await findPriceByLookupKey(stripe, lookupKey);
  if (existing) {
    console.log(
      `[price ] reuse ${existing.id} (voice overage ${cfg.tier})`
    );
    return existing;
  }
  // Metered usage prices: `recurring.usage_type = "metered"`. The meter is
  // bound to the price via the `meter` field — that field must contain the
  // ID of an existing Stripe Billing Meter (which the operator creates in
  // the dashboard, since meters are not API-creatable in v0). On a fresh
  // run where the meter doesn't yet exist, we create the price WITHOUT the
  // `meter` association (Stripe will allow it for legacy metered pricing)
  // and the operator ties it to the meter manually after creation.
  const created = await stripe.prices.create({
    product: product.id,
    unit_amount: cfg.unitAmountCents,
    currency: "usd",
    recurring: {
      interval: "month",
      usage_type: "metered",
    },
    lookup_key: lookupKey,
    metadata: {
      [HEYMAYA_TIER_TAG]: lookupKey,
      heymaya_tier: cfg.tier,
      heymaya_meter_event_name: cfg.meterEventName,
    },
  });
  console.log(
    `[price ] CREATED ${created.id} (voice overage ${cfg.tier} @ $${(cfg.unitAmountCents / 100).toFixed(2)}/min)`
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
    "starter" | "pro" | "studio",
    {
      productId: string;
      monthlyPriceId: string;
      annualPriceId: string;
    }
  >;
  voiceOverage: Record<
    "pro" | "studio",
    {
      productId: string;
      priceId: string;
      meterEventName: string;
      unitAmountCents: number;
    }
  >;
  envVarsNeeded: string[];
  meterSetupReminder: string;
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

  // 1. Subscription tiers + prices
  const tierResults: Record<
    "starter" | "pro" | "studio",
    { productId: string; monthlyPriceId: string; annualPriceId: string }
  > = {
    starter: { productId: "", monthlyPriceId: "", annualPriceId: "" },
    pro: { productId: "", monthlyPriceId: "", annualPriceId: "" },
    studio: { productId: "", monthlyPriceId: "", annualPriceId: "" },
  };

  for (const cfg of SERVICE_TIERS) {
    const product = await ensureProduct(stripe, cfg);
    const monthly = await ensureRecurringPrice(stripe, product, cfg, "month");
    const annual = await ensureRecurringPrice(stripe, product, cfg, "year");
    tierResults[cfg.key] = {
      productId: product.id,
      monthlyPriceId: monthly.id,
      annualPriceId: annual.id,
    };
  }

  // 2. Metered voice-overage products + prices
  const voiceResults: Record<
    "pro" | "studio",
    {
      productId: string;
      priceId: string;
      meterEventName: string;
      unitAmountCents: number;
    }
  > = {
    pro: {
      productId: "",
      priceId: "",
      meterEventName: METERED_VOICE_CONFIGS[0].meterEventName,
      unitAmountCents: METERED_VOICE_CONFIGS[0].unitAmountCents,
    },
    studio: {
      productId: "",
      priceId: "",
      meterEventName: METERED_VOICE_CONFIGS[1].meterEventName,
      unitAmountCents: METERED_VOICE_CONFIGS[1].unitAmountCents,
    },
  };

  for (const cfg of METERED_VOICE_CONFIGS) {
    const product = await ensureMeteredProduct(stripe, cfg);
    const price = await ensureMeteredPrice(stripe, product, cfg);
    voiceResults[cfg.tier] = {
      productId: product.id,
      priceId: price.id,
      meterEventName: cfg.meterEventName,
      unitAmountCents: cfg.unitAmountCents,
    };
  }

  const envVars = [
    `STRIPE_SERVICE_PRICE_STARTER_MONTHLY=${tierResults.starter.monthlyPriceId}`,
    `STRIPE_SERVICE_PRICE_STARTER_ANNUAL=${tierResults.starter.annualPriceId}`,
    `STRIPE_SERVICE_PRICE_PRO_MONTHLY=${tierResults.pro.monthlyPriceId}`,
    `STRIPE_SERVICE_PRICE_PRO_ANNUAL=${tierResults.pro.annualPriceId}`,
    `STRIPE_SERVICE_PRICE_STUDIO_MONTHLY=${tierResults.studio.monthlyPriceId}`,
    `STRIPE_SERVICE_PRICE_STUDIO_ANNUAL=${tierResults.studio.annualPriceId}`,
    `STRIPE_SERVICE_PRICE_VOICE_OVERAGE_PRO=${voiceResults.pro.priceId}`,
    `STRIPE_SERVICE_PRICE_VOICE_OVERAGE_STUDIO=${voiceResults.studio.priceId}`,
  ];

  const manifest: OutputManifest = {
    generatedAt: new Date().toISOString(),
    stripeApiVersion: stripe.getApiField("version") ?? "default",
    tiers: tierResults,
    voiceOverage: voiceResults,
    envVarsNeeded: envVars,
    meterSetupReminder: [
      "Stripe Billing Meters CANNOT be created via API in v0.",
      "Operator must create them manually at:",
      "  https://dashboard.stripe.com/test/billing/meters/create",
      "Two meters needed:",
      `  1. event_name=heymaya_service_voice_minutes_pro,    aggregation=sum, customer_mapping=stripe_customer_id`,
      `  2. event_name=heymaya_service_voice_minutes_studio, aggregation=sum, customer_mapping=stripe_customer_id`,
      "After creating, attach each meter to its respective price (Pro/Studio voice-overage) via the dashboard.",
    ].join("\n"),
  };

  const outPath = path.resolve(
    __dirname,
    "stripe-products.json"
  );
  writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log("\n=== DONE ===");
  console.log(`Wrote manifest to ${outPath}`);
  console.log("\nSet these env vars in .env.local AND Convex env:");
  for (const line of envVars) console.log(`  ${line}`);
  console.log("\n" + manifest.meterSetupReminder);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
