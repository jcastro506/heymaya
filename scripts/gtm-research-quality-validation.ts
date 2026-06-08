#!/usr/bin/env -S npx tsx
/**
 * Sprint 2.13d — research quality validation harness.
 *
 * Runs the full research + LLM scoring + LLM channel-judge pipeline
 * against the canonical N=3 product fixture (ModelHub, Beehiiv, Bezel)
 * and asserts each product's channel decisions match the expected
 * shape. Run before shipping any 2.13+ prompt change or pipeline
 * refactor to catch regressions.
 *
 * Usage:
 *   npx tsx scripts/gtm-research-quality-validation.ts
 *
 * Cost: ~$1 per full run (3 products × ~$0.35 research + LLM)
 *
 * The expected decisions below are pinned from the 2026-05-24 live
 * v4 run that validated Sprint 2.13a + 2.13b. They are not a hard
 * spec — channel-judge decisions reflect LLM judgment which has
 * latitude. The script asserts the LOAD-BEARING decisions (the
 * headline failures Sprint 2.13 was built to fix) and reports any
 * deviation on the rest as informational.
 *
 * Why this isn't a vitest test:
 *   - Burns real LLM tokens (~$1/run)
 *   - Calls live ScrapeCreators / TwitterAPI.io / Algolia / Gemini
 *   - Takes 5-10 min wall-clock
 *   - LLM judgments have non-determinism — strict equality would
 *     thrash. The script reports diffs without failing on minor
 *     score shifts.
 */

import { execSync } from "node:child_process";

interface ChannelExpectation {
  channel: "reddit" | "x" | "linkedin" | "tiktok" | "product_hunt";
  /** Decisions the LLM MUST produce; failure here is a regression. */
  required: "primary" | "secondary" | "parked";
  /** Why this decision is load-bearing (the prior failure mode). */
  why: string;
}

interface ProductFixture {
  prefixSlug: string;
  productName: string;
  productUrl: string;
  founderWhy: string;
  weekGoal: "feedback" | "signups" | "demos" | "revenue";
  stage: "idea" | "live-beta" | "paid" | "unknown";
  expected: ChannelExpectation[];
}

const FIXTURES: ProductFixture[] = [
  {
    prefixSlug: "validation_modelhub",
    productName: "ModelHub",
    productUrl: "https://studio.consciousengines.com/model-hub",
    founderWhy: "local LLM workflows on Mac feel disjointed",
    weekGoal: "signups",
    stage: "live-beta",
    expected: [
      {
        channel: "reddit",
        required: "primary",
        why: "r/ollama, r/LocalLLaMA are the obvious ModelHub buyer rooms",
      },
      {
        channel: "x",
        required: "primary",
        why: "AI/ML dev twitter is the founder-led GTM channel for dev tools",
      },
      {
        channel: "linkedin",
        required: "parked",
        why: "Indie dev utility doesn't belong on B2B LinkedIn",
      },
    ],
  },
  {
    prefixSlug: "validation_beehiiv",
    productName: "Beehiiv",
    productUrl: "https://www.beehiiv.com",
    founderWhy:
      "creators want to own their newsletter economics instead of giving 10-30% to Substack",
    weekGoal: "signups",
    stage: "paid",
    expected: [
      {
        channel: "linkedin",
        // Was the headline failure before Sprint 2.13b — weighted
        // formula parked at 0.00. LLM judge must promote to at
        // least secondary because newsletter operators live on
        // LinkedIn. We accept secondary OR primary here.
        required: "secondary",
        why:
          "HEADLINE FIX: weighted formula parked LinkedIn at 0.00; newsletter operators live on LinkedIn",
      },
      {
        channel: "x",
        required: "primary",
        why: "Writer-X / newsletter-twitter is a real community",
      },
    ],
  },
  {
    prefixSlug: "validation_bezel",
    productName: "Bezel",
    productUrl: "https://getbezel.com",
    founderWhy:
      "Mac users want to control their iPhone from their laptop without picking up the phone",
    weekGoal: "signups",
    stage: "paid",
    expected: [
      {
        channel: "x",
        // Was the headline failure before Sprint 2.13b — formula
        // parked at 0.00 (no X cards). LLM judge with external
        // prior should still recognize indie Mac apps live on X.
        required: "secondary",
        why:
          "HEADLINE FIX: weighted formula parked X at 0.00 due to thin scrape; LLM with external prior knows indie Mac apps live on X",
      },
      {
        channel: "reddit",
        required: "primary",
        why: "r/mac, r/apple, r/iphone are the Mac utility buyer rooms",
      },
      {
        channel: "linkedin",
        required: "parked",
        why: "Indie Mac consumer utility doesn't belong on B2B LinkedIn",
      },
    ],
  },
];

const ACCEPT_LOOSE: Record<string, ReadonlyArray<string>> = {
  // "secondary" passes when expected is "primary" (operator may
  // tune later); strict "parked" failures must NEVER pass
  primary: ["primary", "secondary"],
  secondary: ["secondary", "primary"],
  parked: ["parked"],
};

function sh(cmd: string): string {
  return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function runResearchOnly(fixture: ProductFixture): void {
  const payload = JSON.stringify({
    productName: fixture.productName,
    productUrl: fixture.productUrl,
    founderWhy: fixture.founderWhy,
    weekGoal: fixture.weekGoal,
    stage: fixture.stage,
    budgetUsd: 0.5,
    prefixSlug: fixture.prefixSlug,
  });
  console.log(`[validate] running research for ${fixture.productName}...`);
  sh(`npx convex run _admin/realWorldDeployGtm:runResearchOnly '${payload}'`);
}

function analyze(prefixSlug: string): {
  channelScores: Array<{
    channel: string;
    decision: string;
    score: number;
    confidence: string;
  }>;
  topReddit: Array<{ painLanguageReason?: string; title?: string }>;
} {
  const out = sh(
    `npx convex run _admin/realWorldDeployGtm:analyzeAuxSynth '{"prefixSlug":"${prefixSlug}","sampleSize":3}'`
  );
  const i = out.indexOf("{");
  return JSON.parse(out.slice(i));
}

function validate(fixture: ProductFixture): { passed: number; failed: number; reports: string[] } {
  const reports: string[] = [];
  let passed = 0;
  let failed = 0;
  const result = analyze(fixture.prefixSlug);
  reports.push(`\n=== ${fixture.productName} (${fixture.prefixSlug}) ===`);
  reports.push(
    `  channel decisions: ${result.channelScores
      .map((c) => `${c.channel}=${c.decision}(${c.confidence})`)
      .join(", ")}`
  );

  const llmScoredCount = result.topReddit.filter((c) => c.painLanguageReason).length;
  if (llmScoredCount === 0) {
    failed += 1;
    reports.push(
      `  ❌ CRITICAL: top reddit cards have no painLanguageReason — LLM scorer did not run`
    );
  } else {
    passed += 1;
    reports.push(`  ✓ LLM card scorer fired (${llmScoredCount} reasoned cards in top 3)`);
  }

  for (const exp of fixture.expected) {
    const actual = result.channelScores.find((c) => c.channel === exp.channel);
    if (!actual) {
      failed += 1;
      reports.push(`  ❌ ${exp.channel}: NO DECISION (expected ${exp.required}) — ${exp.why}`);
      continue;
    }
    const accept = ACCEPT_LOOSE[exp.required];
    if (!accept) {
      failed += 1;
      reports.push(
        `  ❌ ${exp.channel}: unknown expected decision "${exp.required}"`
      );
      continue;
    }
    if (accept.includes(actual.decision)) {
      passed += 1;
      reports.push(
        `  ✓ ${exp.channel}: ${actual.decision} (expected ${exp.required}) — ${exp.why}`
      );
    } else {
      failed += 1;
      reports.push(
        `  ❌ ${exp.channel}: ${actual.decision} (expected ${exp.required}) — ${exp.why}`
      );
    }
  }
  return { passed, failed, reports };
}

async function main(): Promise<void> {
  console.log("Sprint 2.13d research quality validation harness");
  console.log("=".repeat(60));
  console.log(`Running N=${FIXTURES.length} fixture products in parallel...`);
  console.log("Cost: ~$1 / run. Wall clock: 5-10 min.\n");

  // Fire all research runs in parallel (each ~5 min)
  await Promise.all(FIXTURES.map((f) => Promise.resolve(runResearchOnly(f))));

  let totalPassed = 0;
  let totalFailed = 0;
  for (const fixture of FIXTURES) {
    const { passed, failed, reports } = validate(fixture);
    totalPassed += passed;
    totalFailed += failed;
    for (const r of reports) console.log(r);
  }

  console.log("\n" + "=".repeat(60));
  console.log(`RESULT: ${totalPassed} passed, ${totalFailed} failed`);
  if (totalFailed > 0) {
    console.log(
      "\nFAIL: research quality regressed against the pinned fixtures.\n" +
        "Investigate the failing channels before shipping. See\n" +
        "[[session-handoff-sprint-2-13-llm-research-judge]] for context."
    );
    process.exit(1);
  }
  console.log("\nPASS: research quality matches pinned N=3 baseline.");
}

main().catch((err) => {
  console.error("[validate] fatal:", err);
  process.exit(1);
});
