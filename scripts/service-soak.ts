#!/usr/bin/env tsx
/**
 * scripts/service-soak.ts
 *
 * Real-world soak test for the service-product MVP.
 *
 * Spins up a real Maya for a fixture business on Fly, seeds realistic
 * historical data (50 reviews, 20 jobs, 10 customers, 1 GBP location),
 * drives a synthetic stimulus stream over N hours (job-completed
 * webhooks, GBP review arrivals at realistic operator rates), and
 * captures rolling telemetry every 60 seconds.
 *
 * On exit (clean exit, Ctrl-C, or after the duration completes):
 *   - Destroys the Fly app
 *   - Sweeps fixture rows from Convex
 *   - Writes a final report to `soak-runs/<timestamp>.md`
 *
 * Usage:
 *   set -a && source .env.local && set +a
 *   npx tsx scripts/service-soak.ts --hours 2 --confirm
 *
 * Flags:
 *   --hours <N>        Duration. Default 2.
 *   --rate <minutes>   Job-completion injection rate. Default 25 (one
 *                      every 25 min).
 *   --review-rate <h>  Review-arrival rate (hours between). Default 1.5.
 *   --confirm          Required (real OpenRouter spend, real Fly machine).
 *   --keep             Don't tear down on exit; for debugging a stuck
 *                      machine. Default false.
 *
 * Real spend warning: ~$1-5 for 2 hours, ~$25-60 for 24 hours,
 * depending on stimulus rates + behavior count. Real Fly $$ for the
 * shared-cpu-1x machine + ~250 MB egress.
 */

import "node:process";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

/* -------------------------------------------------------------------------- */
/* Flags                                                                       */
/* -------------------------------------------------------------------------- */

interface Flags {
  hours: number;
  /** Minutes between job-completed injections. */
  jobRateMin: number;
  /** Hours between review-arrival injections. */
  reviewRateHours: number;
  confirm: boolean;
  keep: boolean;
  help: boolean;
}

function parseFlags(argv: ReadonlyArray<string>): Flags {
  const flags: Flags = {
    hours: 2,
    jobRateMin: 25,
    reviewRateHours: 1.5,
    confirm: false,
    keep: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--hours") flags.hours = Number(argv[++i] ?? 2);
    else if (a === "--rate") flags.jobRateMin = Number(argv[++i] ?? 25);
    else if (a === "--review-rate")
      flags.reviewRateHours = Number(argv[++i] ?? 1.5);
    else if (a === "--confirm") flags.confirm = true;
    else if (a === "--keep") flags.keep = true;
    else if (a === "--help" || a === "-h") flags.help = true;
  }
  return flags;
}

/* -------------------------------------------------------------------------- */
/* Logging                                                                     */
/* -------------------------------------------------------------------------- */

const COLOUR = process.stdout.isTTY && !process.env.NO_COLOR;
const C = {
  green: (s: string) => (COLOUR ? `\x1b[32m${s}\x1b[0m` : s),
  red: (s: string) => (COLOUR ? `\x1b[31m${s}\x1b[0m` : s),
  yellow: (s: string) => (COLOUR ? `\x1b[33m${s}\x1b[0m` : s),
  cyan: (s: string) => (COLOUR ? `\x1b[36m${s}\x1b[0m` : s),
  dim: (s: string) => (COLOUR ? `\x1b[2m${s}\x1b[0m` : s),
};

function ts(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}
function log(msg: string): void {
  console.log(`${C.dim(ts())}  ${msg}`);
}
function info(msg: string): void {
  log(C.dim(msg));
}
function ok(msg: string): void {
  log(`${C.green("OK")} ${msg}`);
}
function warn(msg: string): void {
  log(`${C.yellow("WARN")} ${msg}`);
}
function err(msg: string): void {
  log(`${C.red("ERR")} ${msg}`);
}

/* -------------------------------------------------------------------------- */
/* convex run shell-out                                                        */
/* -------------------------------------------------------------------------- */

async function convexRun<T>(
  functionName: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const proc = spawn(
      "npx",
      ["convex", "run", functionName, JSON.stringify(args)],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => {
      stdout += String(d);
    });
    proc.stderr.on("data", (d) => {
      stderr += String(d);
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `npx convex run ${functionName} exited code=${code}\n${stderr}\n${stdout}`
          )
        );
        return;
      }
      const trimmed = stdout.trim();
      try {
        resolve(JSON.parse(trimmed) as T);
      } catch {
        const m = stdout.match(/(\{[\s\S]*\}|\[[\s\S]*\])\s*$/);
        if (m) {
          try {
            resolve(JSON.parse(m[1]) as T);
            return;
          } catch {
            /* fall through */
          }
        }
        reject(
          new Error(
            `npx convex run ${functionName}: not JSON\n${stdout}\n${stderr}`
          )
        );
      }
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Snapshot types                                                              */
/* -------------------------------------------------------------------------- */

interface Snapshot {
  nowMs: number;
  business: { mayaFlyAppId: string | null; planTier: string };
  ai: {
    calls: number;
    totalCostUsd: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    latencyP50Ms: number;
    latencyP95Ms: number;
    byTaskTag: Record<string, number>;
  };
  queue: {
    enqueued: number;
    processed: number;
    failed: number;
    byKind: Record<string, number>;
  };
  telemetry: { total: number; bySignal: Record<string, number> };
  behaviors: {
    reviewsTotal: number;
    reviewsDrafted: number;
    reviewsApproved: number;
    reviewsPosted: number;
    reviewRequestsTotal: number;
    reviewRequestsSent: number;
    gbpPostsTotal: number;
    gbpPostsDrafted: number;
  };
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}
function fmtMs(n: number): string {
  return `${n.toFixed(0)}ms`;
}

function compactSnapshot(s: Snapshot): string {
  return [
    `ai=${s.ai.calls}calls/${fmtUsd(s.ai.totalCostUsd)}/p50=${fmtMs(s.ai.latencyP50Ms)}/p95=${fmtMs(s.ai.latencyP95Ms)}`,
    `queue=${s.queue.processed}/${s.queue.enqueued}done${s.queue.failed > 0 ? `/${s.queue.failed}fail` : ""}`,
    `telemetry=${s.telemetry.total}`,
    `behaviors: rev=${s.behaviors.reviewsDrafted}D/${s.behaviors.reviewsTotal}T req=${s.behaviors.reviewRequestsSent}S/${s.behaviors.reviewRequestsTotal}T post=${s.behaviors.gbpPostsDrafted}D/${s.behaviors.gbpPostsTotal}T`,
  ].join("  ");
}

/* -------------------------------------------------------------------------- */
/* Help                                                                        */
/* -------------------------------------------------------------------------- */

function printHelp(): void {
  console.log(
    [
      "HeyMaya Service-product real-world soak",
      "",
      "Spins up a real Maya, seeds realistic data, drives stimulus over",
      "N hours, captures rolling telemetry. Real OpenRouter $$, real Fly $$.",
      "",
      "Usage:",
      "  set -a && source .env.local && set +a",
      "  npx tsx scripts/service-soak.ts --hours 2 --confirm",
      "",
      "Flags:",
      "  --hours <N>          Duration. Default 2.",
      "  --rate <minutes>     Job-completed rate. Default 25.",
      "  --review-rate <h>    Review-arrival rate (hours). Default 1.5.",
      "  --confirm            Required (real cloud spend).",
      "  --keep               Skip teardown on exit (debugging).",
      "  --help               Show this and exit.",
      "",
      "Real-spend estimate:",
      "  ~$1-5 for 2h, ~$25-60 for 24h depending on stimulus rates.",
      "",
      "Output:",
      "  Final report at soak-runs/<timestamp>.md",
      "  Live Fly logs streamed to soak-runs/<timestamp>.log",
    ].join("\n")
  );
}

/* -------------------------------------------------------------------------- */
/* Main                                                                        */
/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.help) {
    printHelp();
    process.exit(0);
  }
  if (!flags.confirm) {
    err(
      "Refusing to run without --confirm. This soak runs real OpenRouter calls + real Fly machines. Pass --confirm to acknowledge."
    );
    process.exit(1);
  }
  if (flags.hours <= 0 || flags.hours > 48) {
    err(`--hours must be in (0, 48]. Got ${flags.hours}.`);
    process.exit(1);
  }

  const runId = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
  const outDir = join(process.cwd(), "soak-runs");
  mkdirSync(outDir, { recursive: true });
  const reportPath = join(outDir, `${runId}.md`);
  const logPath = join(outDir, `${runId}.log`);
  log(C.cyan(`HeyMaya soak start — run id ${runId}`));
  log(`hours=${flags.hours} jobRate=${flags.jobRateMin}min reviewRate=${flags.reviewRateHours}h`);
  log(`report → ${reportPath}`);
  log(`fly logs → ${logPath}`);

  // Step 1 — fixture business + seed data.
  log(C.cyan("[1/5] Creating fixture business…"));
  const fixture = await convexRun<{
    businessId: string;
    creatorId: string;
    clerkUserId: string;
  }>("smokeFixtures/serviceBusiness:createServiceFixture", {});
  ok(`business=${fixture.businessId} clerk=${fixture.clerkUserId}`);

  log(C.cyan("[2/5] Seeding realistic data…"));
  const seed = await convexRun<{
    seeded: boolean;
    counts: { gbpLocation: number; customers: number; jobs: number; reviews: number };
  }>("smokeFixtures/serviceBusiness:seedSoakData", {
    businessId: fixture.businessId,
  });
  ok(
    `seeded ${seed.seeded ? "fresh" : "(already seeded)"} — gbp=${seed.counts.gbpLocation} cust=${seed.counts.customers} jobs=${seed.counts.jobs} reviews=${seed.counts.reviews}`
  );

  // Step 2 — deploy Maya.
  log(C.cyan("[3/5] Deploying Maya to Fly…"));
  type DeployResult = {
    ok: boolean;
    stage: string;
    message?: string;
    flyAppId?: string;
    machineId?: string;
    durationMs: number;
  };
  const deploy = await convexRun<DeployResult>(
    "onboarding/business/deployServiceMaya:deployServiceMaya",
    { businessId: fixture.businessId }
  );
  if (!deploy.ok) {
    err(`deploy failed: stage=${deploy.stage} ${deploy.message ?? ""}`);
    if (!flags.keep && deploy.flyAppId) {
      await teardown(fixture.businessId, deploy.flyAppId).catch(() => {});
    }
    process.exit(2);
  }
  ok(
    `deployed app=${deploy.flyAppId} machine=${deploy.machineId} (${(deploy.durationMs / 1000).toFixed(1)}s)`
  );
  const flyAppId = deploy.flyAppId!;

  // Step 3 — start fly logs streaming to file.
  log(C.cyan("[4/5] Streaming Fly logs to file…"));
  const flyLogProc = spawn("flyctl", ["logs", "-a", flyAppId], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  flyLogProc.stdout.on("data", (d) => appendFileSync(logPath, String(d)));
  flyLogProc.stderr.on("data", (d) => appendFileSync(logPath, String(d)));

  // Capture handlers so Ctrl-C and errors both teardown.
  let teardownPromise: Promise<unknown> | null = null;
  const cleanup = async (): Promise<void> => {
    if (teardownPromise) return void teardownPromise;
    log(C.cyan("Tearing down…"));
    flyLogProc.kill();
    if (!flags.keep) {
      teardownPromise = teardown(fixture.businessId, flyAppId);
      await teardownPromise;
    } else {
      warn(`--keep set; left fly app=${flyAppId} business=${fixture.businessId}`);
    }
  };
  process.on("SIGINT", () => {
    void (async () => {
      log(C.yellow("SIGINT — tearing down…"));
      await cleanup();
      process.exit(130);
    })();
  });

  // Step 4 — soak loop.
  log(C.cyan("[5/5] Soak loop running…"));
  const startMs = Date.now();
  const endMs = startMs + flags.hours * 60 * 60 * 1000;
  const jobIntervalMs = flags.jobRateMin * 60 * 1000;
  const reviewIntervalMs = flags.reviewRateHours * 60 * 60 * 1000;
  let nextJobMs = startMs + 30 * 1000; // first job after 30s warmup
  let nextReviewMs = startMs + 60 * 1000; // first review after 60s
  let nextSnapshotMs = startMs + 60 * 1000;
  const snapshots: Array<{ ms: number; snap: Snapshot }> = [];

  // Initial snapshot pre-stimulus
  try {
    const s = await convexRun<Snapshot>(
      "smokeFixtures/serviceBusiness:getSoakSnapshot",
      { businessId: fixture.businessId }
    );
    snapshots.push({ ms: Date.now(), snap: s });
    info(`t=0   ${compactSnapshot(s)}`);
  } catch (e) {
    warn(`initial snapshot failed: ${(e as Error).message}`);
  }

  while (Date.now() < endMs) {
    const now = Date.now();
    if (now >= nextJobMs) {
      try {
        const jobRes = await convexRun<{ jobId: string }>(
          "smokeFixtures/serviceBusiness:injectJobCompleted",
          { businessId: fixture.businessId }
        );
        ok(`inject job-completed → ${jobRes.jobId}`);
      } catch (e) {
        warn(`inject job-completed failed: ${(e as Error).message}`);
      }
      nextJobMs = now + jobIntervalMs;
    }
    if (now >= nextReviewMs) {
      try {
        const revRes = await convexRun<{ reviewId: string }>(
          "smokeFixtures/serviceBusiness:injectGbpReview",
          { businessId: fixture.businessId }
        );
        ok(`inject review → ${revRes.reviewId}`);
      } catch (e) {
        warn(`inject review failed: ${(e as Error).message}`);
      }
      nextReviewMs = now + reviewIntervalMs;
    }
    if (now >= nextSnapshotMs) {
      try {
        const s = await convexRun<Snapshot>(
          "smokeFixtures/serviceBusiness:getSoakSnapshot",
          { businessId: fixture.businessId }
        );
        snapshots.push({ ms: now, snap: s });
        const elapsedMin = ((now - startMs) / 60000).toFixed(1);
        info(`t=${elapsedMin}min  ${compactSnapshot(s)}`);
      } catch (e) {
        warn(`snapshot failed: ${(e as Error).message}`);
      }
      nextSnapshotMs = now + 60 * 1000;
    }
    // Sleep ~5s; the loop polls fast enough that minute-rounded events fire on time.
    await new Promise((r) => setTimeout(r, 5_000));
  }

  log(C.cyan("Soak window complete. Finalizing…"));
  // Final snapshot.
  let finalSnap: Snapshot | null = null;
  try {
    finalSnap = await convexRun<Snapshot>(
      "smokeFixtures/serviceBusiness:getSoakSnapshot",
      { businessId: fixture.businessId }
    );
    snapshots.push({ ms: Date.now(), snap: finalSnap });
  } catch (e) {
    warn(`final snapshot failed: ${(e as Error).message}`);
  }

  // Write report BEFORE teardown (so we have it even if teardown explodes).
  if (finalSnap) {
    writeReport(reportPath, {
      runId,
      flags,
      fixture,
      flyAppId,
      machineId: deploy.machineId,
      startMs,
      endMs: Date.now(),
      finalSnap,
      snapshots,
    });
    ok(`report written → ${reportPath}`);
  }

  await cleanup();
  log(C.green(`SOAK COMPLETE — ${((Date.now() - startMs) / 1000 / 60).toFixed(1)} min total`));
  process.exit(0);
}

async function teardown(businessId: string, flyAppId: string): Promise<void> {
  try {
    const res = await convexRun<{
      flyAppDestroyed: boolean;
      flyError: string | null;
      deletedCounts: Record<string, number>;
    }>("smokeFixtures/serviceBusiness:destroyServiceFixtureWithFly", {
      businessId,
      flyAppId,
    });
    if (res.flyAppDestroyed) ok(`fly app destroyed (${flyAppId})`);
    else if (res.flyError) warn(`fly destroy failed: ${res.flyError}`);
    const total = Object.values(res.deletedCounts).reduce((a, b) => a + b, 0);
    if (total > 0) ok(`fixture rows swept (${total} total)`);
  } catch (e) {
    err(`teardown failed: ${(e as Error).message}`);
    err(`MANUAL CLEANUP: flyctl apps destroy ${flyAppId} --yes`);
  }
}

interface ReportInput {
  runId: string;
  flags: Flags;
  fixture: { businessId: string; creatorId: string; clerkUserId: string };
  flyAppId: string;
  machineId: string | undefined;
  startMs: number;
  endMs: number;
  finalSnap: Snapshot;
  snapshots: Array<{ ms: number; snap: Snapshot }>;
}

function writeReport(path: string, r: ReportInput): void {
  const durationMin = (r.endMs - r.startMs) / 60000;
  const final = r.finalSnap;
  const lines: string[] = [];
  lines.push(`# Soak run ${r.runId}`);
  lines.push("");
  lines.push(`- **Duration**: ${durationMin.toFixed(1)} minutes`);
  lines.push(
    `- **Stimulus**: job-completed every ${r.flags.jobRateMin}min, review-arrival every ${r.flags.reviewRateHours}h`
  );
  lines.push(`- **Fly app**: \`${r.flyAppId}\``);
  lines.push(`- **Machine**: \`${r.machineId ?? "?"}\``);
  lines.push(
    `- **Business**: \`${r.fixture.businessId}\` (creator=\`${r.fixture.creatorId}\`)`
  );
  lines.push("");
  lines.push("## Headline numbers");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| AI calls (real OpenRouter) | ${final.ai.calls} |`);
  lines.push(`| Total OpenRouter spend | ${fmtUsd(final.ai.totalCostUsd)} |`);
  lines.push(
    `| Input tokens | ${final.ai.totalInputTokens.toLocaleString()} |`
  );
  lines.push(
    `| Output tokens | ${final.ai.totalOutputTokens.toLocaleString()} |`
  );
  lines.push(`| AI latency p50 | ${fmtMs(final.ai.latencyP50Ms)} |`);
  lines.push(`| AI latency p95 | ${fmtMs(final.ai.latencyP95Ms)} |`);
  lines.push(
    `| Tasks enqueued | ${final.queue.enqueued} (processed=${final.queue.processed}, failed=${final.queue.failed}) |`
  );
  lines.push(`| Telemetry rows | ${final.telemetry.total} |`);
  lines.push(
    `| Reviews drafted | ${final.behaviors.reviewsDrafted} of ${final.behaviors.reviewsTotal} |`
  );
  lines.push(
    `| Review-requests sent | ${final.behaviors.reviewRequestsSent} of ${final.behaviors.reviewRequestsTotal} |`
  );
  lines.push(
    `| GBP posts drafted | ${final.behaviors.gbpPostsDrafted} of ${final.behaviors.gbpPostsTotal} |`
  );
  lines.push("");
  lines.push("## AI calls by task tag");
  lines.push("");
  if (Object.keys(final.ai.byTaskTag).length === 0) {
    lines.push("*(none — Maya did not make any model calls during this run)*");
  } else {
    for (const [tag, n] of Object.entries(final.ai.byTaskTag).sort(
      (a, b) => b[1] - a[1]
    )) {
      lines.push(`- \`${tag}\` × ${n}`);
    }
  }
  lines.push("");
  lines.push("## Queue work by kind");
  lines.push("");
  for (const [k, n] of Object.entries(final.queue.byKind).sort(
    (a, b) => b[1] - a[1]
  )) {
    lines.push(`- \`${k}\` × ${n}`);
  }
  lines.push("");
  lines.push("## Telemetry by signal");
  lines.push("");
  for (const [s, n] of Object.entries(final.telemetry.bySignal).sort(
    (a, b) => b[1] - a[1]
  )) {
    lines.push(`- \`${s}\` × ${n}`);
  }
  lines.push("");
  lines.push("## Snapshot timeline (every minute)");
  lines.push("");
  lines.push("| Min | AI calls | Spend | p95 latency | Q done | Reviews drafted | GBP posts |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const { ms, snap } of r.snapshots) {
    const elapsedMin = ((ms - r.startMs) / 60000).toFixed(1);
    lines.push(
      `| ${elapsedMin} | ${snap.ai.calls} | ${fmtUsd(snap.ai.totalCostUsd)} | ${fmtMs(snap.ai.latencyP95Ms)} | ${snap.queue.processed}/${snap.queue.enqueued} | ${snap.behaviors.reviewsDrafted} | ${snap.behaviors.gbpPostsDrafted} |`
    );
  }
  lines.push("");
  lines.push("## What this proves (or doesn't)");
  lines.push("");
  if (final.ai.calls === 0) {
    lines.push(
      "Maya made ZERO model calls during this soak. The deploy contract works (boot proven), but Maya's behaviors did not fire. Likely causes:"
    );
    lines.push(
      "- Cron schedule didn't fire during the soak window (heartbeat is daily; soak shorter than 24h)"
    );
    lines.push(
      "- Skill polling cron not yet wired to the synthetic mayaTaskQueue events"
    );
    lines.push(
      "- Workspace bundle is missing skills that handle these events"
    );
    lines.push(
      "Next: SSH into the machine and run `openclaw cron list` + `openclaw cron run --once <name>` to manually fire a behavior."
    );
  } else {
    lines.push(
      `Maya made **${final.ai.calls} model calls** for **${fmtUsd(final.ai.totalCostUsd)}** total. p95 latency ${fmtMs(final.ai.latencyP95Ms)}. ${final.queue.processed} of ${final.queue.enqueued} queued tasks processed. **Real Maya is doing real work.**`
    );
  }
  writeFileSync(path, lines.join("\n"));
}

main().catch((e) => {
  err(`uncaught: ${(e as Error).message}`);
  process.exit(2);
});
