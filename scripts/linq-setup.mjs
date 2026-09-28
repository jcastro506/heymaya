#!/usr/bin/env node
/**
 * Linq, set up in one command (X1). Run once per deployment, after you've put the API key in its env
 * yourself (never paste it anywhere else):
 *
 *   CONVEX_DEPLOYMENT=dev:precise-canary-781 npx convex env set LINQ_API_KEY <token from dashboard.linqapp.com/api-tooling>
 *   node scripts/linq-setup.mjs --deployment dev:precise-canary-781 [--photo https://…/maya.png] [--name Maya]
 *
 * It does, in order, and prints only what isn't secret:
 *  1. lists your lines and their reputation (GET /v3/phone_numbers);
 *  2. creates the webhook subscription at https://<deployment>.convex.site/linq/webhook, pinned to
 *     payload version 2026-02-03, for the events Maya handles;
 *  3. stores the subscription's signing secret straight into the deployment's LINQ_WEBHOOK_SECRET
 *     (Linq shows it once; it is never printed or written to disk);
 *  4. creates (or updates) the contact card on every line: her name and photo, which people are
 *     prompted to save.
 * Refuses production unless you pass --prod, and then only from `main` (the same rule as deploys).
 */
import { execFileSync, spawnSync } from "node:child_process";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]] : acc), []));
const deployment = args.deployment;
if (!deployment || typeof deployment !== "string") { console.error("usage: node scripts/linq-setup.mjs --deployment dev:<name> [--photo <url>] [--name Maya]"); process.exit(2); }
const PROD = ["resilient-mandrill-621"];
const name = deployment.split(":").pop();
if (PROD.includes(name) || deployment.startsWith("prod:")) {
  if (!args.prod) { console.error("refusing: that's production. Pass --prod, from a clean main, when you mean it."); process.exit(2); }
  const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"]).toString().trim();
  if (branch !== "main") { console.error(`refusing: production setup runs from main (you're on ${branch}).`); process.exit(2); }
}
const env = { ...process.env, CONVEX_DEPLOYMENT: deployment };
const convexEnvGet = (key) => spawnSync("npx", ["convex", "env", "get", key], { env, encoding: "utf8" }).stdout.trim();
const apiKey = convexEnvGet("LINQ_API_KEY");
if (!apiKey) { console.error(`LINQ_API_KEY isn't set on ${deployment}. Set it yourself first (see the top of this file).`); process.exit(1); }
const base = (convexEnvGet("LINQ_BASE_URL") || "https://api.linqapp.com/api/partner").replace(/\/+$/, "");
const site = `https://${name}.convex.site`;

async function linq(method, path, body) {
  const res = await fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* a non-JSON body is reported by status below */ }
  return { status: res.status, json };
}

const EVENTS = ["message.received", "message.sent", "message.delivered", "message.failed", "reaction.added", "reaction.removed", "chat.typing_indicator.started", "phone_number.status_updated"];

// 1. Lines.
const lines = await linq("GET", "/v3/phone_numbers");
if (lines.status !== 200) { console.error(`couldn't list lines (HTTP ${lines.status}${lines.json?.code ? `, code ${lines.json.code}` : ""}). Is the key right?`); process.exit(1); }
const numbers = (lines.json?.phone_numbers ?? []).map((l) => ({ number: l.phone_number, reputation: l.reputation?.status ?? "unknown" }));
console.log(`lines on the account: ${numbers.length ? numbers.map((l) => `${l.number} (${l.reputation})`).join(", ") : "none yet — ask your Linq rep to provision one"}`);

// 2 + 3. The webhook subscription and its secret.
const target = `${site}/linq/webhook?version=2026-02-03`;
const existing = await linq("GET", "/v3/webhook-subscriptions");
const already = (existing.json?.subscriptions ?? existing.json?.webhook_subscriptions ?? existing.json?.data ?? []).find((s) => s.target_url === target);
if (already && !args["rotate-webhook"]) {
  console.log(`webhook subscription already exists for ${target} (id ${already.id}). Its secret can't be read back; pass --rotate-webhook to delete and recreate it (a new secret is stored).`);
} else {
  if (already) await linq("DELETE", `/v3/webhook-subscriptions/${already.id}`);
  const sub = await linq("POST", "/v3/webhook-subscriptions", { target_url: target, subscribed_events: EVENTS });
  if (sub.status >= 300 || !sub.json?.signing_secret) { console.error(`couldn't create the webhook subscription (HTTP ${sub.status}${sub.json?.code ? `, code ${sub.json.code}` : ""}).`); process.exit(1); }
  const set = spawnSync("npx", ["convex", "env", "set", "LINQ_WEBHOOK_SECRET", sub.json.signing_secret], { env, encoding: "utf8" });
  if (set.status !== 0) { console.error("created the subscription but couldn't store its secret; rerun with --rotate-webhook."); process.exit(1); }
  console.log(`webhook subscription created (id ${sub.json.id}) → ${target}; signing secret stored in LINQ_WEBHOOK_SECRET (not shown).`);
}

// 4. Her contact card on every line.
const first = typeof args.name === "string" ? args.name : "Maya";
for (const l of numbers) {
  const card = { phone_number: l.number, first_name: first, ...(typeof args.photo === "string" ? { image_url: args.photo } : {}) };
  let r = await linq("POST", "/v3/contact_card", card);
  if (r.json?.code === 2014) r = await linq("PATCH", "/v3/contact_card", card);
  console.log(`contact card on ${l.number}: ${r.status < 300 ? "set" : `failed (HTTP ${r.status}${r.json?.code ? `, code ${r.json.code}` : ""})`}`);
}
if (numbers[0]) console.log(`\noptional fallback for the pairing screen: CONVEX_DEPLOYMENT=${deployment} npx convex env set LINQ_LINE_NUMBER ${numbers[0].number}`);
console.log("\nnext: text the line from your phone and check the webhook in `npx convex logs` (see docs/LINQ.md).");
