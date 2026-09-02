#!/usr/bin/env node
/**
 * Create (or find) the Stripe products and prices for one Stripe account, and print
 * the env lines to set on the Convex deployment (plan §19.1). Idempotent by
 * `lookup_key`. Reads STRIPE_SECRET_KEY from .env.local with a parser, never `source`.
 *
 *   node scripts/stripe-products.mjs            # test mode key from .env.local
 *   STRIPE_SECRET_KEY=sk_live_… node scripts/stripe-products.mjs   # live, when the operator says so
 */
import { readFileSync } from "node:fs";
import Stripe from "stripe";

function envFromFile(path) {
  const out = {};
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* no file */
  }
  return out;
}

const key = process.env.STRIPE_SECRET_KEY ?? envFromFile(".env.local").STRIPE_SECRET_KEY;
if (!key) {
  console.error("STRIPE_SECRET_KEY not found");
  process.exit(1);
}
const stripe = new Stripe(key);
const mode = key.startsWith("sk_live") ? "LIVE" : "test";

const PRICES = [
  { lookup: "maya_founding_monthly", env: "STRIPE_PRICE_FOUNDING_MONTHLY", amount: 1900, interval: "month", nickname: "Founding · monthly" },
  { lookup: "maya_founding_annual", env: "STRIPE_PRICE_FOUNDING_ANNUAL", amount: 18000, interval: "year", nickname: "Founding · annual" },
  { lookup: "maya_list_monthly", env: "STRIPE_PRICE_LIST_MONTHLY", amount: 2900, interval: "month", nickname: "List · monthly" },
  { lookup: "maya_list_annual", env: "STRIPE_PRICE_LIST_ANNUAL", amount: 29000, interval: "year", nickname: "List · annual" },
];

async function main() {
  const products = await stripe.products.search({ query: "name:'Maya'" });
  let product = products.data.find((p) => p.metadata?.app === "maya-creator");
  if (!product) product = await stripe.products.create({ name: "Maya", description: "A creator's assistant who watches your posts, your calendar and your lane, and texts you ideas.", metadata: { app: "maya-creator" } });
  const lines = [];
  for (const p of PRICES) {
    const existing = await stripe.prices.list({ lookup_keys: [p.lookup], limit: 1 });
    let price = existing.data[0];
    if (!price) price = await stripe.prices.create({ product: product.id, currency: "usd", unit_amount: p.amount, recurring: { interval: p.interval }, lookup_key: p.lookup, nickname: p.nickname, tax_behavior: "exclusive" });
    lines.push(`${p.env}=${price.id}`);
  }
  console.log(`# Stripe ${mode} · product ${product.id}`);
  for (const l of lines) console.log(l);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
