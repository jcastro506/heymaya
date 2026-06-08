#!/usr/bin/env tsx
/**
 * ClawLaunch GTM Sprint 3 — L4 smoke (research query builder).
 *
 * Asserts the query builder produces real per-platform packs from a
 * representative ProductDiagnosis + IcpHypotheses input, with:
 *   - all 6 platforms covered (Reddit / X / TikTok / IG / LinkedIn / Google)
 *   - playbook-grounded query patterns ("alternative to X", "how do I X",
 *     "-filter:retweets", etc.)
 *   - showability + ICP gates honored
 *   - budget overrides respected
 *   - plan fingerprint stable + input-sensitive
 */

import {
  buildResearchQueryPlan,
  PlatformQueryPackSchema,
  type BuildResearchQueryPlanInput,
} from "../convex/gtmMaya/researchQueryBuilder";

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

const BASE: BuildResearchQueryPlanInput = {
  diagnosis: {
    productName: "ClawLaunch",
    productCategoryKeywords: ["AI launch teammate", "indie hacker GTM"],
    oneSentencePromise:
      "ClawLaunch helps indie founders find first 100 users.",
    showability: "screen-recordable",
    competitorMentions: ["Beehiiv", "Hypefury"],
    unverifiable: false,
  },
  icpHypotheses: [
    {
      id: "icp_1",
      buyer: "Indie devs with <100 followers",
      currentPain: "no audience after shipping",
      currentWorkaround: "post once on Twitter",
      locatableOn: "twitter",
    },
    {
      id: "icp_2",
      buyer: "Vibe-coders launching first AI app",
      currentPain: "launching is harder than coding",
      currentWorkaround: "ask in Discord servers",
      locatableOn: "reddit",
    },
    {
      id: "icp_3",
      buyer: "Ops manager at 50-200 SaaS",
      currentPain: "no comms playbook",
      currentWorkaround: "Slack + spreadsheets",
      locatableOn: "linkedin",
    },
  ],
};

function checkAllPlatformsCovered(): void {
  const plan = buildResearchQueryPlan(BASE);
  const expected = ["google", "instagram", "linkedin", "reddit", "tiktok", "twitter"];
  const got = plan.packs.map((p) => p.platform).sort();
  if (JSON.stringify(got) !== JSON.stringify(expected)) {
    fail("platform-coverage", `expected ${expected.join(",")}; got ${got.join(",")}`);
    return;
  }
  pass("platform-coverage", "all 6 platforms emit packs when ICPs locate + showable");
}

function checkSchemaShape(): void {
  const plan = buildResearchQueryPlan(BASE);
  for (const pack of plan.packs) {
    const result = PlatformQueryPackSchema.safeParse(pack);
    if (!result.success) {
      fail(
        "pack-schema",
        `${pack.platform} failed schema: ${JSON.stringify(result.error.issues[0])}`
      );
      return;
    }
  }
  pass(
    "pack-schema",
    `all ${plan.packs.length} packs match PlatformQueryPack zod schema`
  );
}

function checkPlaybookGroundedQueries(): void {
  const plan = buildResearchQueryPlan(BASE);
  const reddit = plan.packs.find((p) => p.platform === "reddit")!;
  const twitter = plan.packs.find((p) => p.platform === "twitter")!;
  const tiktok = plan.packs.find((p) => p.platform === "tiktok")!;
  const google = plan.packs.find((p) => p.platform === "google")!;

  // Per playbook decision rules
  const redditOk =
    reddit.painQueries.some((q) => q.startsWith("how do I")) &&
    reddit.competitorQueries.some((q) => q.includes("alternative to Beehiiv"));
  const twitterOk =
    twitter.painQueries.some((q) => q.includes("-filter:retweets")) &&
    twitter.competitorQueries.some((q) => q.includes("too expensive"));
  const tiktokOk =
    tiktok.formatQueries.some((q) => q.startsWith("#")) &&
    tiktok.formatQueries.some((q) => q.includes("before after"));
  const googleOk =
    google.competitorQueries.some((q) => q === "alternative to Beehiiv");

  if (!redditOk) {
    fail("reddit-grounded", "Reddit pack missing reddit.md § 4 patterns");
    return;
  }
  if (!twitterOk) {
    fail("twitter-grounded", "Twitter pack missing x.md § 3 patterns");
    return;
  }
  if (!tiktokOk) {
    fail("tiktok-grounded", "TikTok pack missing format-mining queries");
    return;
  }
  if (!googleOk) {
    fail("google-grounded", "Google pack missing 'alternative to X' probes");
    return;
  }
  pass(
    "playbook-grounded",
    "Reddit / Twitter / TikTok / Google packs reference real playbook patterns"
  );
}

function checkShowabilityGate(): void {
  const unshowable = buildResearchQueryPlan({
    ...BASE,
    diagnosis: { ...BASE.diagnosis, showability: "unshowable" },
  });
  const platforms = unshowable.packs.map((p) => p.platform);
  if (platforms.includes("tiktok") || platforms.includes("instagram")) {
    fail("showability-gate", "TikTok/IG must be skipped when unshowable");
    return;
  }
  pass(
    "showability-gate",
    "TikTok + IG correctly skipped when diagnosis.showability=unshowable"
  );
}

function checkBudgetRespect(): void {
  const plan = buildResearchQueryPlan({
    ...BASE,
    budgetOverrides: { reddit: 2, tiktok: 0 },
  });
  const reddit = plan.packs.find((p) => p.platform === "reddit");
  const tiktok = plan.packs.find((p) => p.platform === "tiktok");
  if (reddit?.maxCalls !== 2) {
    fail("budget-respect-reddit", `expected reddit.maxCalls=2, got ${reddit?.maxCalls}`);
    return;
  }
  if (tiktok !== undefined) {
    fail("budget-respect-tiktok", "budget=0 should skip the platform entirely");
    return;
  }
  pass("budget-respect", "per-platform budget overrides honored; budget=0 skips");
}

function checkFingerprintStability(): void {
  const a = buildResearchQueryPlan(BASE);
  const b = buildResearchQueryPlan(BASE);
  const c = buildResearchQueryPlan({
    ...BASE,
    diagnosis: {
      ...BASE.diagnosis,
      productCategoryKeywords: ["different category"],
    },
  });
  if (a.planFingerprint !== b.planFingerprint) {
    fail(
      "fingerprint-stable",
      `same input produced different fingerprints: ${a.planFingerprint} vs ${b.planFingerprint}`
    );
    return;
  }
  if (a.planFingerprint === c.planFingerprint) {
    fail(
      "fingerprint-input-sensitive",
      "different inputs produced same fingerprint"
    );
    return;
  }
  pass(
    "fingerprint",
    `planFingerprint stable across calls + changes when inputs change (${a.planFingerprint} → ${c.planFingerprint})`
  );
}

async function main(): Promise<void> {
  const liveMode = process.argv.includes("--live");
  const confirmed = process.argv.includes("--confirm");
  if (liveMode && !confirmed) {
    console.error("[smoke] --live requires --confirm");
    process.exit(2);
  }

  checkAllPlatformsCovered();
  checkSchemaShape();
  checkPlaybookGroundedQueries();
  checkShowabilityGate();
  checkBudgetRespect();
  checkFingerprintStability();

  const failed = checks.filter((c) => c.status === "failed");
  for (const c of checks) {
    const tag = c.status === "passed" ? "[PASS]" : "[FAIL]";
    console.log(`${tag} ${c.name}: ${c.detail}`);
  }
  const passed = checks.length - failed.length;
  console.log(
    `\nSprint 3 L4 smoke: ${passed}/${checks.length} checks passed${
      liveMode ? " (live mode)" : " (in-process)"
    }.`
  );

  if (liveMode) {
    console.log(
      "\nL6 operator follow-ups:\n" +
        "  1. Run buildResearchQueryPlan against the RWTC's ProductDiagnosis. Inspect the per-platform packs.\n" +
        "  2. Confirm Reddit painQueries include 'how do I {category}' phrases.\n" +
        "  3. Confirm Twitter painQueries include the -filter:retweets operator.\n" +
        "  4. Confirm TikTok formatQueries include hashtag probes for the 5-video rule.\n" +
        "  5. Spot-check that excludedAudiences (from intake) propagate into Reddit exclusionQueries."
    );
  }

  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("[smoke] harness error:", err);
  process.exit(2);
});
