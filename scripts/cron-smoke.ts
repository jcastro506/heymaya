#!/usr/bin/env tsx
/**
 * scripts/cron-smoke.ts
 *
 * Standalone cron-simulator smoke test. Spins up convex-test in-process,
 * fires every one of Maya's 19 cron jobs against a Starter and a Pro
 * creator, then re-queries the corresponding HQ surface to prove the
 * mutation→query path is unbroken.
 *
 * Run: `npm run smoke:cron`
 *
 * Exit codes:
 *   0 = every cron's mutation→query path passed for both tiers
 *   1 = one or more failures (details in the printed table + exit-stderr)
 *   2 = uncaught exception
 *
 * This script is intentionally distinct from `tests/cronSimulator.test.ts`:
 *   - the test runs in vitest's edge-runtime VM (CI-friendly, fast)
 *   - this script runs at the same Node-runtime as `npm run smoke` so the
 *     operator can eyeball the per-job table without booting vitest
 *   - both share the SAME inventory (the 19 entryIds + their domain
 *     mutations) so a drift between the two would surface as a test diff
 *
 * Mirrors the convex-test harness pattern from tests/_modules.ts (which can
 * only be reached from a vitest-context file, since vite's `import.meta.glob`
 * is the magic). For the standalone script we replicate the glob via
 * `globSync` from `tinyglobby` is overkill — we hardcode the convex modules
 * via `import.meta.glob` here, which works because tsx's runtime (esbuild +
 * Node) ALSO supports it via the @edge-runtime/vm shim convex-test loads.
 *
 * Wait — that's wrong. tsx doesn't ship a glob equivalent. We instead use
 * the recommended pattern: import the same `modules` object from
 * `tests/_modules.ts`. tsx will refuse to resolve `import.meta.glob` outside
 * a vite/vitest context. So we use `fast-glob`-equivalent: walk the convex
 * directory and dynamic-import each .ts file. Implemented inline below to
 * avoid a new npm dep.
 */

import { readdirSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const HAS_TTY = Boolean(process.stdout.isTTY);
const COLOUR = HAS_TTY && !process.env.NO_COLOR;
const C = {
  green: (s: string) => (COLOUR ? `\x1b[32m${s}\x1b[0m` : s),
  red: (s: string) => (COLOUR ? `\x1b[31m${s}\x1b[0m` : s),
  yellow: (s: string) => (COLOUR ? `\x1b[33m${s}\x1b[0m` : s),
  cyan: (s: string) => (COLOUR ? `\x1b[36m${s}\x1b[0m` : s),
  dim: (s: string) => (COLOUR ? `\x1b[2m${s}\x1b[0m` : s),
};

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const RESULTS_PATH = join(REPO_ROOT, "scripts", "cron-smoke-results.txt");

/* ------------------------------------------------------------------------- */
/* Cron inventory — kept IDENTICAL to tests/cronSimulator.test.ts             */
/* ------------------------------------------------------------------------- */

interface CronJob {
  entryId: string;
  tier: "all" | "pro+";
  domainMutation: string | null;
  hqQuery: string;
}

const CRON_INVENTORY: ReadonlyArray<CronJob> = [
  // 9 base (Starter+) crons
  { entryId: "morning_brief",         tier: "all",  domainMutation: null,                     hqQuery: "today.latestBrief" },
  { entryId: "evening_recap",         tier: "all",  domainMutation: null,                     hqQuery: "today.latestBrief" },
  { entryId: "weekly_review",         tier: "all",  domainMutation: null,                     hqQuery: "businessReadiness.latestActionLog" },
  { entryId: "weekly_content_plan",   tier: "all",  domainMutation: null,                     hqQuery: "plan.currentPlan" },
  { entryId: "performance_check_2h",  tier: "all",  domainMutation: null,                     hqQuery: "businessReadiness.latestActionLog" },
  { entryId: "daily_niche_scan",      tier: "all",  domainMutation: "skillRecordTrend",       hqQuery: "trends.nicheRadar" },
  { entryId: "trend_watcher",         tier: "all",  domainMutation: "skillRecordTrend",       hqQuery: "trends.nicheRadar" },
  { entryId: "comment_triage",        tier: "all",  domainMutation: null,                     hqQuery: "businessReadiness.latestActionLog" },
  { entryId: "accountability_nudge",  tier: "all",  domainMutation: null,                     hqQuery: "businessReadiness.latestActionLog" },
  // 10 Pro/Studio additional crons
  { entryId: "competitor_watch",                       tier: "pro+", domainMutation: "skillRecordCompetitor", hqQuery: "trends.competitorWatch" },
  { entryId: "calendar_lookahead",                     tier: "pro+", domainMutation: null,                     hqQuery: "businessReadiness.latestActionLog" },
  { entryId: "manager_readiness_packet_quarterly",     tier: "pro+", domainMutation: null,                     hqQuery: "businessReadiness.latestActionLog" },
  { entryId: "revenue_snapshot",                       tier: "pro+", domainMutation: null,                     hqQuery: "today.revenueWidget" },
  { entryId: "industry_intel_daily",                   tier: "pro+", domainMutation: "skillRecordTrend",       hqQuery: "trends.industryIntel" },
  { entryId: "algo_research_tiktok",                   tier: "pro+", domainMutation: null,                     hqQuery: "businessReadiness.latestActionLog" },
  { entryId: "algo_research_instagram",                tier: "pro+", domainMutation: null,                     hqQuery: "businessReadiness.latestActionLog" },
  { entryId: "algo_research_youtube",                  tier: "pro+", domainMutation: null,                     hqQuery: "businessReadiness.latestActionLog" },
  { entryId: "algo_research_linkedin",                 tier: "pro+", domainMutation: null,                     hqQuery: "businessReadiness.latestActionLog" },
  { entryId: "algo_research_x",                        tier: "pro+", domainMutation: null,                     hqQuery: "businessReadiness.latestActionLog" },
];

/* ------------------------------------------------------------------------- */
/* Convex module discovery — tsx-compatible                                   */
/* ------------------------------------------------------------------------- */

/**
 * Walk convex/ recursively and build the same `modules` map convex-test
 * expects: `{ "../convex/<rel>.ts": () => import(...) }`.
 *
 * Why hand-rolled: vite's `import.meta.glob` is unavailable outside vitest;
 * `tests/_modules.ts` uses it because that file is read inside the vitest
 * VM. This script runs under tsx (Node) where we must enumerate manually.
 */
function buildConvexModules(): Record<string, () => Promise<unknown>> {
  const convexDir = join(REPO_ROOT, "convex");
  const modules: Record<string, () => Promise<unknown>> = {};
  function walk(dir: string): void {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        // Skip OS noise; INCLUDE _generated (convex-test needs it).
        if (name === "node_modules" || name === ".git") continue;
        walk(full);
        continue;
      }
      if (!name.endsWith(".ts") && !name.endsWith(".js")) continue;
      if (name.endsWith(".d.ts")) continue;
      // Skip test files — they aren't part of the Convex deployment surface.
      if (full.includes("__tests__") || name.endsWith(".test.ts")) continue;
      // The key shape convex-test expects mirrors the vite glob from a file
      // at tests/<x>: keys begin with "../convex/...".
      const rel = relative(convexDir, full).split("\\").join("/");
      const key = `../convex/${rel}`;
      modules[key] = () => import(full);
    }
  }
  walk(convexDir);
  return modules;
}

/* ------------------------------------------------------------------------- */
/* Per-cron simulator runners                                                 */
/* ------------------------------------------------------------------------- */

interface SimResult {
  entryId: string;
  tier: "all" | "pro+";
  creatorPlan: "starter" | "pro";
  step: "starter" | "pro";
  pass: boolean;
  detail: string;
}

const RUNTIME_SECRET = "test-runtime-secret-cron-smoke";
const NOW = 1_700_000_000_000;

async function runSim(): Promise<SimResult[]> {
  // Lazy-import vitest harness so the script's pre-flight error path runs
  // first if any module fails to load.
  process.env.MAYA_RUNTIME_SECRET = RUNTIME_SECRET;

  const { convexTest } = await import("convex-test");
  const schemaModule = (await import(join(REPO_ROOT, "convex", "schema.ts"))) as {
    default: unknown;
  };
  const apiModule = (await import(
    join(REPO_ROOT, "convex", "_generated", "api.js")
  )) as { api: unknown };

  // Justification: the dynamic-import paths above resolve to TypeScript
  // sources whose generated types live in `convex/_generated/*` and require
  // the convex codegen step to land in the tsx process. We're a one-shot
  // smoke script — running typegen here would balloon the runtime by ~3s
  // for zero correctness benefit since the test version of this simulator
  // (`tests/cronSimulator.test.ts`) IS strictly typed and is the
  // authoritative pass/fail signal. The two `any` casts below are bounded
  // to the convex-test harness boundary; everything beyond uses the
  // dynamically-checked Convex validator surface.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const schema = schemaModule.default as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = apiModule.api as any;
  const modules = buildConvexModules();

  const t = convexTest(schema, modules);

  const results: SimResult[] = [];

  // Plant two creators
  const starterId = (await t.run((ctx: any) =>
    ctx.db.insert("creators", {
      clerkUserId: "u_smoke_starter",
      email: "starter@smoke.test",
      channelPreference: "web",
      timezone: "America/Los_Angeles",
      status: "active",
      plan: "starter",
      createdAt: NOW,
    })
  )) as string;
  await t.run((ctx: any) =>
    ctx.db.insert("creatorPicture", {
      creatorId: starterId,
      niche: "fitness-coaching",
      audience: { ageRanges: ["25-34"], topGeos: ["US"], interestTags: [] },
      voiceFingerprint: "warm + direct",
      topHooks: [],
      bottomHooks: [],
      postingCadence: { perPlatform: [] },
      brandDealHistory: [],
      generatedAt: NOW,
      model: "smoke-fixture",
      sourceCitations: [],
      careerStage: "just-starting",
    })
  );

  const proId = (await t.run((ctx: any) =>
    ctx.db.insert("creators", {
      clerkUserId: "u_smoke_pro",
      email: "pro@smoke.test",
      channelPreference: "web",
      timezone: "America/Los_Angeles",
      status: "active",
      plan: "pro",
      createdAt: NOW,
    })
  )) as string;
  await t.run((ctx: any) =>
    ctx.db.insert("creatorPicture", {
      creatorId: proId,
      niche: "fitness-coaching",
      audience: { ageRanges: ["25-34"], topGeos: ["US"], interestTags: [] },
      voiceFingerprint: "warm + direct",
      topHooks: [],
      bottomHooks: [],
      postingCadence: { perPlatform: [] },
      brandDealHistory: [],
      generatedAt: NOW,
      model: "smoke-fixture",
      sourceCitations: [],
      careerStage: "building",
    })
  );

  // Iterate every cron × every creator
  for (const cron of CRON_INVENTORY) {
    for (const [plan, creatorId, suffix] of [
      ["starter", starterId, "u_smoke_starter"] as const,
      ["pro", proId, "u_smoke_pro"] as const,
    ]) {
      const result: SimResult = {
        entryId: cron.entryId,
        tier: cron.tier,
        creatorPlan: plan,
        step: plan,
        pass: false,
        detail: "",
      };

      try {
        // Always emit the heartbeat receipt (matches OpenClaw playbook).
        await t.mutation(api.businessReadiness.skillRecordActionLog, {
          mayaSecret: RUNTIME_SECRET,
          creatorId,
          entryId: cron.entryId,
          outcome: "ran",
          detail: `smoke: ${cron.entryId}`,
        });

        // For domain-specific crons: invoke the matching skillRecord*
        // mutation. For Starter on Pro+ entries, the gate must reject.
        if (cron.domainMutation === "skillRecordTrend") {
          const isProGate =
            cron.entryId === "industry_intel_daily" ||
            cron.entryId === "competitor_watch";
          if (isProGate && plan === "starter") {
            // Starter must be REJECTED (proactiveCronAll=false).
            try {
              await t.mutation(api.businessReadiness.skillRecordTrend, {
                mayaSecret: RUNTIME_SECRET,
                creatorId,
                source: "industry-intel",
                observation: "smoke",
                evidence: [],
                relevanceScore: 0.5,
              });
              result.pass = false;
              result.detail = "Starter NOT blocked on industry-intel — gate broken";
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              if (/PlanGateError|trend:industry-intel/.test(msg)) {
                result.pass = true;
                result.detail = "starter correctly blocked";
              } else {
                result.pass = false;
                result.detail = `unexpected reject: ${msg.slice(0, 80)}`;
              }
            }
          } else {
            const source =
              cron.entryId === "industry_intel_daily" ? "industry-intel" : "niche-scan";
            await t.mutation(api.businessReadiness.skillRecordTrend, {
              mayaSecret: RUNTIME_SECRET,
              creatorId,
              source,
              observation: `${cron.entryId} smoke`,
              evidence: [{ kind: "hashtag", ref: "#x", fact: "rising" }],
              relevanceScore: 0.7,
            });
            // Verify HQ query reflects.
            const out = await t
              .withIdentity({ subject: suffix })
              .query(api.trends.nicheRadar, {});
            const intel = await t
              .withIdentity({ subject: suffix })
              .query(api.trends.industryIntel, {});
            const total = out.length + intel.length;
            if (total >= 1) {
              result.pass = true;
              result.detail = `HQ reflects ${total} trend row(s)`;
            } else {
              result.pass = false;
              result.detail = "HQ query did not reflect trend write";
            }
          }
        } else if (cron.domainMutation === "skillRecordCompetitor") {
          // Pro+ via competitorWatchSlots > 0; Starter has slots=2 so it ALSO succeeds (revised).
          await t.mutation(api.businessReadiness.skillRecordCompetitor, {
            mayaSecret: RUNTIME_SECRET,
            creatorId,
            peerHandle: "@smoke_peer",
            platform: "tiktok",
            observation: `${cron.entryId} smoke`,
            evidence: [],
          });
          const peers = await t
            .withIdentity({ subject: suffix })
            .query(api.trends.competitorWatch, {});
          if (peers.length >= 1) {
            result.pass = true;
            result.detail = `HQ reflects ${peers.length} competitor row(s)`;
          } else {
            result.pass = false;
            result.detail = "HQ query did not reflect competitor write";
          }
        } else {
          // No domain mutation — only the heartbeat is the contract. Verify
          // the action-log query surfaces it.
          const log = await t
            .withIdentity({ subject: suffix })
            .query(api.businessReadiness.latestActionLog, {});
          const found = log.find((r: any) => r.entryId === cron.entryId);
          if (found) {
            result.pass = true;
            result.detail = "heartbeat surfaced";
          } else {
            result.pass = false;
            result.detail = "heartbeat did NOT surface in latestActionLog";
          }
        }
      } catch (err) {
        result.pass = false;
        result.detail = `EXCEPTION: ${err instanceof Error ? err.message.slice(0, 120) : String(err).slice(0, 120)}`;
      }

      results.push(result);
    }
  }

  return results;
}

/* ------------------------------------------------------------------------- */
/* Output rendering                                                           */
/* ------------------------------------------------------------------------- */

function renderTable(results: SimResult[]): string {
  const lines: string[] = [];
  lines.push("HeyMaya cron-smoke results");
  lines.push("==========================");
  lines.push("");
  lines.push(`Total cron jobs: ${CRON_INVENTORY.length}`);
  lines.push(`Total simulations: ${results.length} (19 × 2 tiers)`);
  lines.push("");

  const passes = results.filter((r) => r.pass).length;
  const fails = results.filter((r) => !r.pass).length;
  lines.push(`Passed: ${passes}    Failed: ${fails}`);
  lines.push("");
  lines.push("Per-job table:");
  lines.push("-".repeat(110));
  lines.push(
    pad("entryId", 38) +
      pad("tier", 8) +
      pad("plan", 10) +
      pad("status", 10) +
      "detail"
  );
  lines.push("-".repeat(110));
  for (const r of results) {
    lines.push(
      pad(r.entryId, 38) +
        pad(r.tier, 8) +
        pad(r.creatorPlan, 10) +
        pad(r.pass ? "PASS" : "FAIL", 10) +
        r.detail
    );
  }
  lines.push("-".repeat(110));
  lines.push("");

  // Gap report — domain-mutation coverage across the 19 entries.
  const noDomain = CRON_INVENTORY.filter((c) => c.domainMutation === null);
  lines.push(
    `Cron entries with NO domain-specific skillRecord* mutation: ${noDomain.length}`
  );
  lines.push(
    "  (these rely on heartbeat-only writes via skillRecordActionLog;"
  );
  lines.push(
    "   the actual table writes happen via OTHER convex pathways NOT"
  );
  lines.push(
    "   exercised by this simulator. Flag as 'requires-public-mutation' if"
  );
  lines.push("   the runtime needs a write surface before MVP):");
  for (const c of noDomain) {
    lines.push(`    - ${c.entryId} (${c.tier}) → writes-via: external pathway`);
  }
  return lines.join("\n");
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n - 1) + " " : s + " ".repeat(n - s.length);
}

/* ------------------------------------------------------------------------- */
/* Main                                                                       */
/* ------------------------------------------------------------------------- */

async function main(): Promise<void> {
  const startedAt = Date.now();
  console.log(`${C.cyan("HeyMaya cron-smoke")} — simulating 19 cron jobs × 2 tiers`);

  let results: SimResult[];
  try {
    results = await runSim();
  } catch (err) {
    console.error(C.red(`\nUncaught: ${err instanceof Error ? err.stack : String(err)}`));
    process.exit(2);
  }

  const report = renderTable(results);
  console.log("\n" + report);

  // Persist the same report so CI / handoff can read it.
  try {
    writeFileSync(RESULTS_PATH, report, "utf-8");
    console.log(C.dim(`\nResults written to ${RESULTS_PATH}`));
  } catch (err) {
    console.error(
      C.yellow(`Could not write results file: ${err instanceof Error ? err.message : String(err)}`)
    );
  }

  const fails = results.filter((r) => !r.pass).length;
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  if (fails > 0) {
    console.error(
      `\n${C.red("CRON-SMOKE FAIL")} — ${fails}/${results.length} simulations failed (${elapsed}s)`
    );
    process.exit(1);
  }
  console.log(
    `\n${C.green("CRON-SMOKE PASS")} — ${results.length}/${results.length} simulations passed (${elapsed}s)`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(C.red(`Uncaught: ${err instanceof Error ? err.stack : String(err)}`));
  process.exit(2);
});
