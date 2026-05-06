#!/usr/bin/env tsx
/**
 * Sprint 1 — real-OpenClaw cron smoke against Fly.
 *
 * What this proves (the narrow bar):
 *   - OPENCLAW_SKIP_CRON is unset, so OpenClaw's native cron service
 *     initializes on Maya boot, loads /data/cron/jobs.json, and emits
 *     `cron: started` to the gateway log on a real Fly machine running
 *     the published OpenClaw runtime image.
 *
 * Why this scope: Wave 0b's bug was a kill switch that prevented the
 * cron service from ever starting. The signal of value is "cron service
 * starts on real Fly". The full cron→agent→tool→Convex round-trip
 * requires a production workspace + skills + tools and is out of scope
 * here — that path is covered by `scripts/creator-maya-v0-fly-smoke.ts`
 * (production bundle, real skills).
 *
 * Architecture:
 *   - Minimal openclaw.json (defaults — anything richer correlated with
 *     cron silently failing to auto-enable, verified live 2026-05-06).
 *   - Single-entry jobs.json (* * * * * heartbeat) — content shape just
 *     needs to be loadable; we don't wait for the agent turn to complete.
 *   - SSH-poll the gateway log file at
 *     /tmp/openclaw-1000/openclaw-<DATE>.log for the literal phrase
 *     "cron: started".
 *
 * No mocks on the critical path:
 *   - real Fly app create + machine create
 *   - real OpenClaw runtime image
 *   - real cron service init
 *
 * Exit codes:
 *   0 — `cron: started` observed in gateway log within SMOKE_TIMEOUT_MS
 *   1 — timeout (gateway never logged cron started) or other failure
 *   2 — preflight failure (missing env, fly auth, etc.)
 *
 * Usage:
 *   npm run smoke:cron-fly -- --confirm
 *   npm run smoke:cron-fly -- --confirm --keep-app   # keep machine + app alive
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Budget covers worst-case path: image pull (~20s) + boot (~15s) + gateway
// ready (cold start with plugin install ~45s) + first cron tick (≤60s wait
// for the next * * * * * minute boundary after gateway ready). 240s gives
// ~30s headroom on the slowest observed run.
const SMOKE_TIMEOUT_MS = 240_000;
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
  // OpenClaw cron payload pairings (verified live 2026-05-06 via
  // /usr/local/lib/node_modules/openclaw/dist/cron-cli-*.js):
  //   sessionTarget=main      → payload.kind=systemEvent  (delivers to running main session)
  //   sessionTarget=isolated  → payload.kind=agentTurn    (spawns a fresh isolated session)
  //
  // We use isolated+agentTurn because there is no main-session client
  // running in the smoke (no chat UI, no claw-messenger), so a systemEvent
  // dispatch hangs forever. Isolated sessions self-spawn and self-terminate.
  sessionTarget: "isolated";
  wakeMode: "now";
  payload: {
    kind: "agentTurn";
    message: string;
    lightContext: true;
    // "off" disables thinking-token budgeting → fastest path to a reply.
    thinking: "off";
    // Hard cap. Reply is meant to be a single short token; 60s is plenty
    // and short enough to surface stalls inside the smoke budget.
    timeoutSeconds: 60;
  };
  delivery: { mode: "none"; bestEffort: true };
}

function buildSmokeJobsJson(): { jobs: SmokeJob[] } {
  return {
    jobs: [
      {
        id: SMOKE_JOB_NAME,
        name: "Smoke minute heartbeat",
        enabled: true,
        createdAtMs: 0,
        updatedAtMs: 0,
        schedule: { kind: "cron", expr: "* * * * *", tz: "UTC" },
        sessionTarget: "isolated",
        wakeMode: "now",
        payload: {
          kind: "agentTurn",
          // The matching AGENTS.md (written into /data/workspace below)
          // tells the smoke agent to reply with the literal token "ok"
          // and end the turn. No tools, no files, no chat.
          message: "tick",
          lightContext: true,
          thinking: "off",
          timeoutSeconds: 60,
        },
        delivery: { mode: "none", bestEffort: true },
      },
    ],
  };
}

interface CronStartedSignal {
  enabled: boolean;
  jobs: number;
  nextWakeAtMs: number | null;
  observedAtIso: string;
}

/**
 * Poll the Fly machine's OpenClaw gateway log for `cron: started`.
 *
 * Why this file (not flyctl logs): flyctl logs streaming has been
 * unreliable from inside the harness (ETIMEDOUT). The gateway writes a
 * structured local log file at /tmp/openclaw-1000/openclaw-<DATE>.log
 * which we can grep deterministically over SSH. The same payload is also
 * emitted to stdout (visible via `flyctl logs`), but the file is the more
 * reliable signal source.
 *
 * Pass condition: at least one log entry whose message field is the
 * literal string "cron: started" with `enabled: true` and `jobs >= 1`
 * in the structured payload. Anything less means the cron service didn't
 * load /data/cron/jobs.json.
 */
async function pollCronStarted(
  appName: string,
  budgetMs: number
): Promise<{
  found: boolean;
  attempts: number;
  elapsedMs: number;
  signal: CronStartedSignal | null;
}> {
  const start = Date.now();
  let attempts = 0;
  let signal: CronStartedSignal | null = null;
  while (Date.now() - start < budgetMs) {
    attempts++;
    try {
      const out = execFileSync(
        "flyctl",
        [
          "ssh",
          "console",
          "-a",
          appName,
          "-C",
          // Match `openclaw-<YYYY>-<MM>-<DD>.log` — date may roll over UTC.
          `sh -c "grep -h 'cron: started' /tmp/openclaw-1000/openclaw-*.log 2>/dev/null | head -5 || true"`,
        ],
        {
          cwd: REPO_ROOT,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 25_000,
        }
      );
      for (const line of out.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) continue;
        try {
          // Each log line is a JSON object whose positional fields ("0",
          // "1", "2") carry the bunyan-style log args. Field "1" carries
          // the structured payload; field "2" the message.
          const parsed = JSON.parse(trimmed) as {
            "1"?: {
              enabled?: boolean;
              jobs?: number;
              nextWakeAtMs?: number | null;
            };
            "2"?: string;
            time?: string;
          };
          if (parsed["2"] !== "cron: started") continue;
          const payload = parsed["1"] ?? {};
          if (payload.enabled !== true) continue;
          if (typeof payload.jobs !== "number" || payload.jobs < 1) continue;
          signal = {
            enabled: payload.enabled,
            jobs: payload.jobs,
            nextWakeAtMs: payload.nextWakeAtMs ?? null,
            observedAtIso: parsed.time ?? "",
          };
          return {
            found: true,
            attempts,
            elapsedMs: Date.now() - start,
            signal,
          };
        } catch {
          // ignore non-JSON banner output
        }
      }
    } catch {
      // ignore transient ssh errors during boot (machine not yet ready)
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return {
    found: false,
    attempts,
    elapsedMs: Date.now() - start,
    signal,
  };
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
  const startedAt = Date.now();

  console.log(`[smoke] Fly app: ${appName}`);

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

    const jobsJson = buildSmokeJobsJson();
    const jobsJsonBase64 = Buffer.from(JSON.stringify(jobsJson)).toString(
      "base64"
    );

    // Mirror the service-product bootstrap shape (deployServiceMaya.ts:254-281).
    //
    // Why not `--bind lan --port 3000`: OpenClaw v2026.4.23+ requires explicit
    // gateway.controlUi.allowedOrigins for any non-loopback bind, and crashes
    // the gateway in a reboot loop otherwise (verified live on
    // heymaya-cron-smoke-mou67bmj 2026-05-06). Loopback is sufficient.
    //
    // openclaw.json: minimal. The smallest config that lets the cron service
    // auto-enable. Adding agents.defaults.model.* or explicit cron.* blocks
    // both correlated with cron silently NOT starting (verified live
    // 2026-05-06 on heymaya-cron-smoke-mou76lwe and -mou7hyzs). The "earliest
    // working" shape lives below.
    //
    // Workspace: single-line AGENTS.md placeholder. Pre-seeding more files
    // (IDENTITY/SOUL/USER/MEMORY) also correlated with cron failing to start
    // (heymaya-cron-smoke-mou7qgjy). Whatever the OpenClaw startup-ordering
    // story is, the empirical pattern holds: minimal config = cron starts.
    const openclawJson = JSON.stringify({
      gateway: { mode: "local" },
      agents: { defaults: { workspace: "/data/workspace" } },
      discovery: { mdns: { mode: "off" } },
    }).replace(/"/g, '\\"');
    const bootstrap = [
      "mkdir -p /data/cron /data/workspace /data/identity",
      'echo "$MAYA_JOBS_JSON_BASE64" | base64 -d > /data/cron/jobs.json',
      `echo "${openclawJson}" > /data/openclaw.json`,
      "echo '# Smoke workspace' > /data/workspace/AGENTS.md",
      "exec openclaw gateway --allow-unconfigured",
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
        // Mirror production sizing in deployMaya.ts MACHINE_GUEST.
        // Smoke originally specced 1cpu/512MB which OOM-killed the gateway
        // at ~74s on boot (total-vm spikes to ~1.7GB during init).
        guest: { cpu_kind: "shared", cpus: 2, memory_mb: 2048 },
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

    // Step 3 — poll the gateway log for `cron: started` over SSH.
    // Budget covers: image pull (~20s) + boot (~15s) + gateway ready
    // (~45s on cold start, plugin install) + cron service init buffer.
    const result = await pollCronStarted(appName, SMOKE_TIMEOUT_MS);
    console.log(
      `[smoke] cron-started poll: found=${result.found} attempts=${result.attempts} elapsed=${result.elapsedMs}ms`
    );
    if (result.signal) {
      console.log(
        `[smoke] signal: enabled=${result.signal.enabled} jobs=${result.signal.jobs} nextWakeAtMs=${result.signal.nextWakeAtMs} observedAt=${result.signal.observedAtIso}`
      );
    }

    if (!result.found) {
      console.error(
        `[smoke] FAIL — gateway did not log "cron: started" in ${SMOKE_TIMEOUT_MS}ms`
      );
      process.exitCode = 1;
    } else {
      console.log(
        `[smoke] PASS — cron service started in ${result.elapsedMs}ms (total ${(
          (Date.now() - startedAt) /
          1000
        ).toFixed(1)}s)`
      );
    }
  } finally {
    // Cleanup. Always destroy unless --keep-app (which keeps both
    // machine + app alive for live SSH debugging).
    if (machineId && !flags.keepApp) {
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
      console.log(
        `[smoke] keeping app ${appName} + machine ${machineId ?? "(none)"} (--keep-app)`
      );
      console.log(
        `[smoke] debug: flyctl ssh console -a ${appName}  /  flyctl logs -a ${appName}`
      );
    }
  }
}

main().catch((err) => {
  console.error(`[smoke] uncaught: ${err instanceof Error ? err.stack : err}`);
  process.exit(1);
});
