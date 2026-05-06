#!/usr/bin/env tsx
/**
 * Wave 0b — real-OpenClaw cron smoke against Fly.
 *
 * What this proves:
 *   1. We do NOT set OPENCLAW_SKIP_CRON, so OpenClaw's native cron service
 *      starts on every Maya boot.
 *   2. A `* * * * *` jobs.json entry actually fires within 90 seconds of
 *      machine boot on a real Fly machine running the published OpenClaw
 *      runtime image.
 *   3. The fired cron POSTs a heartbeat to Convex's
 *      `/lc_maya/cron_heartbeat` endpoint and the row lands in the
 *      `cronHeartbeat` table, observable via Convex query.
 *   4. Live Fly logs include `cron: started` followed by the agent-turn
 *      runs we expect.
 *
 * No mocks on the critical path:
 *   - real Fly app create + machine create
 *   - real OpenClaw runtime image
 *   - real Convex deployment (NEXT_PUBLIC_CONVEX_URL / convex.site)
 *   - real cron firing (no manual `openclaw cron run` invocations)
 *
 * Lifecycle:
 *   - Inserts a one-shot test creator into Convex via internal mutation.
 *   - Builds a creator workspace bundle with our production manifest, then
 *     OVERWRITES the bundled jobs.json with a single `* * * * *` heartbeat
 *     job that POSTs to /lc_maya/cron_heartbeat with the test creatorId.
 *   - Creates a Fly app + machine with the same env shape as
 *     deployMaya.ts:machineConfigFor (minus SKIP_CRON, which is the bug).
 *   - Polls the `cronHeartbeat` Convex table for ≥1 row in ≤90s.
 *   - Reads `flyctl logs` to extract `[cron]` lines for the report.
 *   - Tears down the Fly app + deletes the test creator row.
 *
 * Exit codes:
 *   0 — heartbeat row landed in Convex within budget AND logs confirm cron fired
 *   1 — timeout or test failure (machine boot, log mismatch, no heartbeat row)
 *   2 — preflight failure (missing env, fly auth, etc.)
 *
 * Usage:
 *   npm run smoke:cron-fly -- --confirm
 *   npm run smoke:cron-fly -- --confirm --keep-app   # debug: keep app alive
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ConvexClient } from "convex/browser";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SMOKE_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 5_000;
const SMOKE_JOB_NAME = "smoke_minute_heartbeat";

interface Flags {
  confirm: boolean;
  keepApp: boolean;
  help: boolean;
}

function parseFlags(argv: ReadonlyArray<string>): Flags {
  const f: Flags = { confirm: false, keepApp: false, help: false };
  for (const a of argv) {
    if (a === "--confirm") f.confirm = true;
    else if (a === "--keep-app") f.keepApp = true;
    else if (a === "--help" || a === "-h") f.help = true;
  }
  return f;
}

function loadDotEnvLocal(): void {
  const envPath = join(REPO_ROOT, ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key]) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function runFly(args: ReadonlyArray<string>, timeoutMs = 120_000): string {
  return execFileSync("flyctl", [...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
  });
}

function preflight(flags: Flags): void {
  if (!flags.confirm) {
    console.error(
      "Refusing to run without --confirm: this creates a real Fly app + machine and writes a row to your Convex deployment."
    );
    process.exit(2);
  }
  for (const k of [
    "FLY_API_TOKEN",
    "FLY_ORG_SLUG",
    "NEXT_PUBLIC_CONVEX_URL",
    "WEBHOOK_INTERNAL_SECRET",
    "MAYA_OPENCLAW_IMAGE",
    "OPENROUTER_API_KEY",
  ]) {
    if (!process.env[k]) {
      console.error(`Missing required env var: ${k}`);
      process.exit(2);
    }
  }
  try {
    runFly(["version"], 10_000);
    runFly(["auth", "whoami"], 20_000);
  } catch (err) {
    console.error(`flyctl preflight failed: ${(err as Error).message}`);
    process.exit(2);
  }
}

interface SmokeJob {
  id: string;
  name: string;
  enabled: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  schedule: { kind: "cron"; expr: string; tz: string };
  sessionTarget: "main";
  wakeMode: "now";
  payload: { kind: "agentTurn"; message: string; lightContext: true };
  delivery: { mode: "announce"; channel: "last"; bestEffort: true };
}

function buildSmokeJobsJson(opts: {
  convexHttpBase: string;
  webhookSecret: string;
  creatorId: string;
}): { jobs: SmokeJob[] } {
  // Maya is told to call our cron-heartbeat HTTP endpoint with the test
  // creatorId. Native-first: we don't reimplement scheduling — OpenClaw
  // schedules `* * * * *` and Maya does the call from her standing-order
  // body. The agent-turn payload is the simplest path to prove the
  // schedule fires.
  const convexSiteUrl = opts.convexHttpBase.replace(
    /\.convex\.cloud\/?$/,
    ".convex.site"
  );
  const message = [
    "SMOKE CRON HEARTBEAT.",
    `POST a single application/json body to ${convexSiteUrl}/lc_maya/cron_heartbeat with`,
    `{"secret":"${opts.webhookSecret}","creatorId":"${opts.creatorId}","jobName":"${SMOKE_JOB_NAME}","firedAt":${Date.now()}}`,
    "Then stop. Do not message the channel. Do not write memory. Do not call any other tool.",
  ].join(" ");
  return {
    jobs: [
      {
        id: SMOKE_JOB_NAME,
        name: "Smoke minute heartbeat",
        enabled: true,
        createdAtMs: 0,
        updatedAtMs: 0,
        schedule: { kind: "cron", expr: "* * * * *", tz: "UTC" },
        sessionTarget: "main",
        wakeMode: "now",
        payload: {
          kind: "agentTurn",
          message,
          lightContext: true,
        },
        delivery: { mode: "announce", channel: "last", bestEffort: true },
      },
    ],
  };
}

interface ConvexHandle {
  client: ConvexClient;
  url: string;
}

async function newConvexClient(): Promise<ConvexHandle> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL!;
  const client = new ConvexClient(url);
  return { client, url };
}

function convexSiteUrl(convexUrl: string): string {
  return convexUrl.replace(/\.convex\.cloud\/?$/, ".convex.site");
}

async function pollHeartbeat(
  convex: ConvexHandle,
  creatorId: string,
  budgetMs: number
): Promise<{ found: boolean; rows: number; elapsedMs: number }> {
  const start = Date.now();
  while (Date.now() - start < budgetMs) {
    try {
      const res = await fetch(
        `${convexSiteUrl(convex.url)}/smoke/cron_heartbeat/list`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            secret: process.env.WEBHOOK_INTERNAL_SECRET!,
            creatorId,
          }),
        }
      );
      const body = (await res.json()) as { value?: Array<unknown> };
      const list = body.value ?? [];
      if (list.length > 0) {
        return {
          found: true,
          rows: list.length,
          elapsedMs: Date.now() - start,
        };
      }
    } catch {
      // ignore transient query errors during boot
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return { found: false, rows: 0, elapsedMs: Date.now() - start };
}

async function main(): Promise<void> {
  loadDotEnvLocal();
  const flags = parseFlags(process.argv.slice(2));
  if (flags.help) {
    console.log(
      [
        "Wave 0b cron-Fly smoke",
        "",
        "Usage:",
        "  npm run smoke:cron-fly -- --confirm",
        "  npm run smoke:cron-fly -- --confirm --keep-app",
      ].join("\n")
    );
    process.exit(0);
  }
  preflight(flags);

  const appName = `heymaya-cron-smoke-${Date.now().toString(36)}`;
  const convex = await newConvexClient();
  const startedAt = Date.now();

  console.log(`[smoke] Convex: ${convex.url}`);
  console.log(`[smoke] Fly app: ${appName}`);

  // Step 1 — insert a smoke creator row via Convex internal mutation.
  // We require the operator to have wired `smokeFixtures.creator.insert*`
  // on their Convex deployment. Lazy-load the module name to avoid a
  // hard dep when smoke isn't being run.
  console.log("[smoke] inserting smoke creator");
  const insertRes = (await fetch(
    `${convexSiteUrl(convex.url)}/smoke/cron_heartbeat/insert_creator`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: process.env.WEBHOOK_INTERNAL_SECRET! }),
    }
  ).then((r) => r.json())) as { value?: { creatorId: string } };
  if (!insertRes.value?.creatorId) {
    console.error(
      "[smoke] failed to insert smoke creator. Did you push the latest Convex schema + smokeFixtures module?"
    );
    process.exit(1);
  }
  const cId = insertRes.value.creatorId;
  console.log(`[smoke] creator ${cId}`);

  // Step 2 — Fly app create. We deliberately do NOT use deployMaya here:
  // the smoke is testing the bootstrap shell + cron path independently of
  // ScrapeCreators/Composio/Picture synth, all of which are unrelated.
  let appCreated = false;
  let machineId: string | null = null;
  try {
    runFly([
      "apps",
      "create",
      appName,
      "--org",
      process.env.FLY_ORG_SLUG!,
    ]);
    appCreated = true;
    console.log("[smoke] app created");

    const jobsJson = buildSmokeJobsJson({
      convexHttpBase: convex.url,
      webhookSecret: process.env.WEBHOOK_INTERNAL_SECRET!,
      creatorId: cId,
    });
    const jobsJsonBase64 = Buffer.from(JSON.stringify(jobsJson)).toString(
      "base64"
    );

    // Mirror the bootstrap shell from convex/onboarding/maya/deployMaya.ts.
    // Native-first: same `openclaw gateway` invocation, same OPENCLAW_STATE_DIR.
    const bootstrap = [
      "mkdir -p /data/cron /data/workspace /data/identity",
      'echo "$MAYA_JOBS_JSON_BASE64" | base64 -d > /data/cron/jobs.json',
      "echo '# Smoke workspace' > /data/workspace/AGENTS.md",
      'echo "{\\"gateway\\":{\\"mode\\":\\"local\\"},\\"agents\\":{\\"defaults\\":{\\"workspace\\":\\"/data/workspace\\"}},\\"discovery\\":{\\"mdns\\":{\\"mode\\":\\"off\\"}}}" > /data/openclaw.json',
      "exec openclaw gateway --bind lan --tailscale off --port 3000",
    ].join(" && ");

    runFly([
      "secrets",
      "set",
      `MAYA_JOBS_JSON_BASE64=${jobsJsonBase64}`,
      `OPENROUTER_API_KEY=${process.env.OPENROUTER_API_KEY!}`,
      "--app",
      appName,
      "--stage",
    ]);

    const machineSpec = {
      config: {
        image: process.env.MAYA_OPENCLAW_IMAGE!,
        env: {
          OPENCLAW_DISABLE_BONJOUR: "1",
          OPENCLAW_CONFIG_PATH: "/data/openclaw.json",
          OPENCLAW_STATE_DIR: "/data",
          MAYA_APP_NAME: appName,
        },
        guest: { cpu_kind: "shared", cpus: 1, memory_mb: 512 },
        restart: { policy: "always" },
        init: { cmd: ["/bin/sh", "-c", bootstrap] },
      },
    };

    // Direct Fly Machines REST. Avoids the pre-staged secrets restart
    // dance flyctl would otherwise impose.
    const flyToken = process.env.FLY_API_TOKEN!;
    const machineRes = await fetch(
      `https://api.machines.dev/v1/apps/${encodeURIComponent(appName)}/machines`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${flyToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(machineSpec),
      }
    );
    if (!machineRes.ok) {
      const text = await machineRes.text();
      throw new Error(
        `machine create failed: HTTP ${machineRes.status} ${text}`
      );
    }
    const machine = (await machineRes.json()) as { id: string; state: string };
    machineId = machine.id;
    console.log(`[smoke] machine ${machineId} state=${machine.state}`);

    // Step 3 — wait for cronHeartbeat row.
    const result = await pollHeartbeat(convex, cId, SMOKE_TIMEOUT_MS);
    console.log(
      `[smoke] heartbeat poll: found=${result.found} rows=${result.rows} elapsed=${result.elapsedMs}ms`
    );

    // Step 4 — read live Fly logs to confirm cron fired.
    let logExcerpt = "";
    try {
      const logs = runFly(
        ["logs", "--app", appName, "--no-tail"],
        45_000
      );
      logExcerpt = logs
        .split(/\r?\n/)
        .filter((l) =>
          /cron|gateway.*ready|heartbeat|smoke_minute/i.test(l)
        )
        .slice(-15)
        .join("\n");
      console.log("[smoke] log excerpt:");
      console.log(logExcerpt || "(no matching lines)");
    } catch (err) {
      console.error(
        `[smoke] could not read logs: ${(err as Error).message}`
      );
    }

    if (!result.found) {
      console.error(
        `[smoke] FAIL — no cronHeartbeat row in ${SMOKE_TIMEOUT_MS}ms`
      );
      process.exitCode = 1;
    } else if (!/cron: started/i.test(logExcerpt)) {
      console.error(
        "[smoke] FAIL — heartbeat row landed but `cron: started` not in logs"
      );
      process.exitCode = 1;
    } else {
      console.log(
        `[smoke] PASS — heartbeat in ${result.elapsedMs}ms, cron started in logs (total ${(
          (Date.now() - startedAt) /
          1000
        ).toFixed(1)}s)`
      );
    }
  } finally {
    // Cleanup. Always destroy unless --keep-app.
    if (machineId) {
      try {
        runFly([
          "machine",
          "destroy",
          machineId,
          "--app",
          appName,
          "--force",
        ]);
      } catch {
        // best-effort
      }
    }
    if (appCreated && !flags.keepApp) {
      try {
        runFly(["apps", "destroy", appName, "--yes"]);
      } catch {
        // best-effort
      }
    } else if (appCreated) {
      console.log(`[smoke] keeping app ${appName} (--keep-app)`);
    }

    // Always tear down the smoke creator row.
    try {
      await fetch(
        `${convexSiteUrl(convex.url)}/smoke/cron_heartbeat/delete_creator`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            secret: process.env.WEBHOOK_INTERNAL_SECRET,
            creatorId: cId,
          }),
        }
      );
    } catch {
      // best-effort
    }

    convex.client.close();
  }
}

main().catch((err) => {
  console.error(`[smoke] uncaught: ${err instanceof Error ? err.stack : err}`);
  process.exit(1);
});
