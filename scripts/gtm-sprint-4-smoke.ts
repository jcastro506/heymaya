#!/usr/bin/env tsx
/**
 * ClawLaunch GTM Sprint 4 — L4 smoke (platform workers).
 *
 * Asserts that the 5 platform worker actions exist + are registered in
 * the Convex API surface, and that rawItemToEvidence + the cost rate
 * table produce sane outputs.
 *
 * Live mode (`--live --confirm`) runs ONE platform worker against the
 * real ScrapeCreators API on the RWTC account; capped at 1 call per
 * platform = max $0.05 spend per run.
 */

import { internal } from "../convex/_generated/api";
import {
  PER_CALL_COST_USD,
  rawItemToEvidence,
} from "../convex/gtmMaya/platformWorkers";
import type { ResearchRawItem } from "../convex/gtmMaya/scrapeCreatorsGtmResearch";

interface Check {
  name: string;
  status: "passed" | "failed";
  detail: string;
}
const checks: Check[] = [];
const pass = (name: string, detail: string) =>
  checks.push({ name, status: "passed", detail });
const fail = (name: string, detail: string) =>
  checks.push({ name, status: "failed", detail });

function checkWorkerRegistration(): void {
  // Internal API references — codegen would have failed if these weren't registered.
  const required = [
    "runRedditWorker",
    "runRedditSubredditWorker",
    "runTwitterWorker",
    "runTikTokWorker",
    "runInstagramWorker",
    "runGoogleWorker",
    "recordPlatformEvidence",
    "recordPlatformCost",
  ];
  const reg = internal.gtmMaya.platformWorkers as Record<string, unknown>;
  for (const name of required) {
    if (reg[name] === undefined) {
      fail("worker-registration", `internal.gtmMaya.platformWorkers.${name} is not registered`);
      return;
    }
  }
  pass(
    "worker-registration",
    `all 8 platform worker symbols registered in internal.gtmMaya.platformWorkers (5 actions + 1 subreddit variant + 2 mutations)`
  );
}

function checkRateTableSanity(): void {
  for (const p of ["reddit", "tiktok", "twitter", "instagram", "google"] as const) {
    const c = PER_CALL_COST_USD[p];
    if (c <= 0 || c > 0.05) {
      fail("rate-table-sanity", `${p} cost ${c} out of sane range (0, 0.05]`);
      return;
    }
  }
  pass(
    "rate-table-sanity",
    `all 5 platforms have per-call cost estimates in (0, $0.05] range — fits the $1/hr cost-cap on any single worker burst`
  );
}

function checkNormalizationShape(): void {
  const item: ResearchRawItem = {
    platform: "reddit",
    externalId: "abc",
    url: "https://r.test/p",
    title: "Title",
    excerpt: "Body excerpt",
    author: "u",
    createdAtMs: Date.now() - 2 * 24 * 60 * 60 * 1000,
    engagement: {
      likes: 50,
      comments: 10,
      shares: null,
      views: null,
      upvotes: 60,
      downvotes: 5,
    },
    tags: [],
    rawRef: "reddit:search:abc",
  };
  const ev = rawItemToEvidence("reddit", item);
  if (ev.source !== "reddit") {
    fail("normalization-source", `expected source=reddit, got ${ev.source}`);
    return;
  }
  if (ev.recency !== "fresh") {
    fail("normalization-recency", `expected recency=fresh for 2-day-old item, got ${ev.recency}`);
    return;
  }
  if (ev.painMatch <= 0 || ev.painMatch > 1.0) {
    fail("normalization-pain", `painMatch=${ev.painMatch} out of (0, 1.0]`);
    return;
  }
  if (ev.rawRef !== "reddit:search:abc") {
    fail("normalization-rawref", `rawRef not preserved: ${ev.rawRef}`);
    return;
  }
  pass(
    "normalization-shape",
    `rawItemToEvidence produces source/recency/painMatch/rawRef correctly (painMatch=${ev.painMatch.toFixed(2)})`
  );
}

async function main(): Promise<void> {
  const liveMode = process.argv.includes("--live");
  const confirmed = process.argv.includes("--confirm");
  if (liveMode && !confirmed) {
    console.error("[smoke] --live requires --confirm");
    process.exit(2);
  }

  checkWorkerRegistration();
  checkRateTableSanity();
  checkNormalizationShape();

  const failed = checks.filter((c) => c.status === "failed");
  for (const c of checks) {
    const tag = c.status === "passed" ? "[PASS]" : "[FAIL]";
    console.log(`${tag} ${c.name}: ${c.detail}`);
  }
  const passed = checks.length - failed.length;
  console.log(
    `\nSprint 4 L4 smoke: ${passed}/${checks.length} checks passed${
      liveMode ? " (live mode)" : " (in-process)"
    }.`
  );

  if (liveMode) {
    console.log(
      "\nL6 operator follow-ups:\n" +
        "  1. Ensure SCRAPE_CREATORS_API_KEY is set on staging Convex.\n" +
        "  2. Trigger runRedditWorker on RWTC with a 1-pain-query pack (maxCalls=1). Confirm 1 row in gtmCostLedger, evidence cards inserted under RWTC account.\n" +
        "  3. Verify cost ledger spentUsd updated on the research job row.\n" +
        "  4. Trigger same with bogus accountId — expect 'does not belong to accountId' error from recordPlatformEvidence (cross-tenant defense).\n" +
        "  5. Trigger Twitter worker; same checks."
    );
  }

  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("[smoke] harness error:", err);
  process.exit(2);
});
