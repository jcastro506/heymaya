#!/usr/bin/env tsx
/**
 * Creator Maya v0 Fly/OpenClaw smoke.
 *
 * Mock mode validates the exact workspace + flyctl command shape without
 * touching cloud resources. Live mode creates a temporary Fly app, boots the
 * published OpenClaw runtime image with a Creator Maya workspace, verifies the
 * machine, then destroys the app.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildCreatorMayaWorkspaceManifest,
  type CreatorMayaWorkspaceInput,
} from "../convex/creatorMayaV0/workspaceManifest";

const OPENCLAW_IMAGE =
  process.env.MAYA_OPENCLAW_IMAGE ??
  "registry.fly.io/heymaya-openclaw:v2026.4.23";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface Flags {
  mode: "mock" | "live";
  confirm: boolean;
  appName: string | null;
  keepApp: boolean;
  help: boolean;
}

export interface CreatorMayaFlySmokeFixture {
  appName: string;
  image: string;
  region: string;
  workspaceFiles: Record<string, string>;
  gatewayConfig: Record<string, unknown>;
  bootCommand: string;
}

export interface CreatorMayaFlySmokeMockResult {
  fixture: CreatorMayaFlySmokeFixture;
  fileTargets: ReadonlyArray<string>;
  commandArgs: ReadonlyArray<string>;
}

const CREATOR_MAYA_OPENCLAW_GATEWAY_CONFIG = {
  agents: {
    defaults: {
      workspace: "/data/workspace",
    },
  },
  skills: {
    load: {
      watch: true,
    },
  },
} satisfies Record<string, unknown>;

function parseFlags(argv: ReadonlyArray<string>): Flags {
  const flags: Flags = {
    mode: "mock",
    confirm: false,
    appName: null,
    keepApp: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--mock") flags.mode = "mock";
    else if (arg === "--live") flags.mode = "live";
    else if (arg === "--confirm") flags.confirm = true;
    else if (arg === "--keep-app") flags.keepApp = true;
    else if (arg === "--help" || arg === "-h") flags.help = true;
    else if (arg === "--app") flags.appName = argv[++i] ?? null;
    else if (arg.startsWith("--app=")) flags.appName = arg.slice("--app=".length);
  }

  return flags;
}

function loadDotEnvLocal(): void {
  const envPath = join(REPO_ROOT, ".env.local");
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
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

function defaultWorkspaceInput(): CreatorMayaWorkspaceInput {
  return {
    creatorId: "creator-maya-v0-smoke",
    timezone: "America/New_York",
    tiktokHandle: "smokecreator",
    calendarConnected: true,
    imessagePaired: true,
    creatorPicture: {
      niche: "solo lifestyle creator testing practical TikTok systems",
      stage: "early growth",
      goal: "publish consistently without burning out",
      voiceFingerprint: "specific, useful, direct, lightly funny",
      contentPillars: [
        "behind-the-scenes systems",
        "simple creator routines",
        "TikTok hook experiments",
      ],
      workingHooks: [
        "I tested this so you do not have to",
        "The smallest change that made posting easier",
      ],
      weakHooks: ["generic day-in-the-life opener"],
      scheduleConstraints: [
        "prefers filming blocks before noon",
        "does not want auto-posting",
      ],
    },
  };
}

export function buildCreatorMayaFlySmokeFixture(
  appName = `heymaya-cmv0-smoke-${Date.now().toString(36)}`,
  region = process.env.FLY_REGION || "iad"
): CreatorMayaFlySmokeFixture {
  const manifest = buildCreatorMayaWorkspaceManifest(defaultWorkspaceInput());
  return {
    appName,
    image: OPENCLAW_IMAGE,
    region,
    workspaceFiles: manifest.files,
    gatewayConfig: CREATOR_MAYA_OPENCLAW_GATEWAY_CONFIG,
    bootCommand: [
      "test -s /data/workspace/AGENTS.md",
      "test -s /data/workspace/SOUL.md",
      "test -s /data/workspace/USER.md",
      "test -s /data/cron/jobs.json",
      "test -s /data/openclaw.json",
      "if [ ! -w /data/workspace ]; then boot=/data/workspace.bootstrap.$$; mv /data/workspace \"$boot\"; mkdir -p /data/workspace; cp -R \"$boot/.\" /data/workspace; fi",
      "if [ ! -w /data/cron ]; then boot=/data/cron.bootstrap.$$; mv /data/cron \"$boot\"; mkdir -p /data/cron; cp \"$boot/jobs.json\" /data/cron/jobs.json; fi",
      "mkdir -p /data/workspace/state /data/canvas",
      "test -w /data/workspace",
      "test -w /data/cron",
      "exec openclaw gateway --allow-unconfigured",
    ].join(" && "),
  };
}

function writeFixtureFiles(fixture: CreatorMayaFlySmokeFixture): string {
  const dir = mkdtempSync(join(tmpdir(), "creator-maya-v0-fly-smoke-"));
  for (const [name, content] of Object.entries(fixture.workspaceFiles)) {
    const target = name === "jobs.json" ? "jobs.json" : name;
    const filePath = join(dir, target);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, "utf8");
  }
  writeFileSync(join(dir, "openclaw.json"), JSON.stringify(fixture.gatewayConfig), "utf8");
  return dir;
}

export function buildFlyMachineRunArgs(
  fixture: CreatorMayaFlySmokeFixture,
  fixtureDir: string
): string[] {
  const args = [
    "machine",
    "run",
    "--app",
    fixture.appName,
    "--region",
    fixture.region,
    "--name",
    fixture.appName,
    "--detach",
    "--restart",
    "always",
    "--vm-cpu-kind",
    "shared",
    "--vm-cpus",
    "1",
    "--vm-memory",
    "1024",
    "--env",
    "OPENCLAW_STATE_DIR=/data",
    "--metadata",
    "smoke=creator-maya-v0",
  ];

  for (const name of Object.keys(fixture.workspaceFiles).sort()) {
    const inside =
      name === "jobs.json" ? "/data/cron/jobs.json" : `/data/workspace/${name}`;
    args.push("--file-local", `${inside}=${join(fixtureDir, name)}`);
  }
  args.push("--file-local", `/data/openclaw.json=${join(fixtureDir, "openclaw.json")}`);
  args.push("--", fixture.image, "/bin/sh", "-lc", fixture.bootCommand);
  return args;
}

export function runMockSmoke(): CreatorMayaFlySmokeMockResult {
  const fixture = buildCreatorMayaFlySmokeFixture("heymaya-cmv0-smoke-test", "iad");
  const dir = writeFixtureFiles(fixture);
  try {
    const commandArgs = buildFlyMachineRunArgs(fixture, dir);
    return {
      fixture,
      commandArgs,
      fileTargets: commandArgs
        .filter((arg, index, all) => all[index - 1] === "--file-local")
        .map((arg) => arg.split("=")[0]),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
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
  if (flags.mode === "live" && !flags.confirm) {
    console.error("Refusing --live without --confirm because this creates paid Fly resources.");
    process.exit(1);
  }
  try {
    runFly(["version"], 10_000);
    const whoami = runFly(["auth", "whoami"], 20_000).trim();
    console.log(`Fly auth: ${whoami}`);
  } catch (err) {
    console.error(`Fly preflight failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

interface MachineListRow {
  id?: string;
  name?: string;
  state?: string;
  region?: string;
}

function waitForMachine(appName: string): MachineListRow {
  const deadline = Date.now() + 150_000;
  let lastState = "unknown";
  while (Date.now() < deadline) {
    try {
      const raw = runFly(["machine", "list", "--app", appName, "--json"], 20_000);
      const rows = JSON.parse(raw) as MachineListRow[];
      const machine = rows[0];
      if (machine?.id) {
        lastState = machine.state ?? "unknown";
        if (lastState === "started") return machine;
      }
    } catch {
      // Keep polling; Fly can briefly return non-JSON while app metadata settles.
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5_000);
  }
  throw new Error(`Timed out waiting for machine to start. Last state: ${lastState}`);
}

function verifyMachine(appName: string, machineId: string): string {
  const command = [
    "test -s /data/workspace/AGENTS.md",
    "test -s /data/workspace/SOUL.md",
    "test -s /data/workspace/USER.md",
    "test -s /data/cron/jobs.json",
    "test -s /data/openclaw.json",
    "test -w /data/workspace",
    "test -w /data/cron",
    "grep -q '^name: creator-calendar-content-planner$' /data/workspace/skills/creator-calendar-content-planner/SKILL.md",
    "openclaw skills list | grep -q 'creator-calendar-content-planner'",
    "(curl -fsS http://127.0.0.1:18789/healthz || curl -fsS http://127.0.0.1:3000/healthz || true)",
  ].join(" && ");
  const shellCommand = `/bin/sh -lc ${quoteShell(command)}`;
  return runFly(
    ["ssh", "console", "--app", appName, "--machine", machineId, "--command", shellCommand],
    60_000
  );
}

function waitForGatewayReadyLogs(appName: string, machineId: string): string {
  const deadline = Date.now() + 120_000;
  const postReadyDeadlineMs = 20_000;
  let logs = "";
  while (Date.now() < deadline) {
    logs = runFly(["logs", "--app", appName, "--machine", machineId, "--no-tail"], 30_000);
    if (
      /cron\].*failed to start|plugin service failed|EACCES|permission denied|Cannot read properties of undefined/i.test(
        logs
      )
    ) {
      throw new Error(
        `OpenClaw gateway failed during boot for ${appName}/${machineId}.`
      );
    }
    if (/\[gateway\].*ready/i.test(logs)) {
      const stableUntil = Date.now() + postReadyDeadlineMs;
      while (Date.now() < stableUntil) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5_000);
        logs = runFly(["logs", "--app", appName, "--machine", machineId, "--no-tail"], 30_000);
        if (
          /cron\].*failed to start|plugin service failed|EACCES|permission denied|Cannot read properties of undefined/i.test(
            logs
          )
        ) {
          throw new Error(
            `OpenClaw gateway failed after ready for ${appName}/${machineId}.`
          );
        }
      }
      return logs;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5_000);
  }
  throw new Error(`Timed out waiting for OpenClaw gateway ready logs for ${appName}.`);
}

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function destroyApp(appName: string): void {
  try {
    runFly(["apps", "destroy", appName, "--yes"], 120_000);
  } catch (err) {
    console.error(`Failed to destroy Fly app ${appName}: ${(err as Error).message}`);
    process.exitCode = 3;
  }
}

async function runLiveSmoke(flags: Flags): Promise<void> {
  loadDotEnvLocal();
  preflight(flags);

  const appName = flags.appName ?? `heymaya-cmv0-smoke-${Date.now().toString(36)}`;
  const fixture = buildCreatorMayaFlySmokeFixture(appName);
  const org = process.env.FLY_ORG_SLUG || "personal";
  const dir = writeFixtureFiles(fixture);
  let appCreated = false;

  try {
    console.log(`Creating Fly app ${appName} in org ${org}`);
    runFly(["apps", "create", appName, "--org", org], 120_000);
    appCreated = true;

    console.log(`Booting ${basename(fixture.image)} in ${fixture.region}`);
    runFly(buildFlyMachineRunArgs(fixture, dir), 180_000);

    const machine = waitForMachine(appName);
    if (!machine.id) throw new Error("Fly returned a machine row without id");
    console.log(`Machine started: ${machine.id} (${machine.region ?? fixture.region})`);

    const verifyOutput = verifyMachine(appName, machine.id).trim();
    if (verifyOutput) console.log(verifyOutput);

    const logs = waitForGatewayReadyLogs(appName, machine.id);
    const interesting = logs
      .split(/\r?\n/)
      .filter((line) => /openclaw|gateway|cron|health|ready|error|failed/i.test(line))
      .slice(-20)
      .join("\n");
    if (interesting) console.log(interesting);

    console.log("Creator Maya v0 live Fly/OpenClaw smoke passed.");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (appCreated && !flags.keepApp) {
      console.log(`Destroying temporary Fly app ${appName}`);
      destroyApp(appName);
    } else if (appCreated) {
      console.log(`Keeping Fly app ${appName} because --keep-app was provided.`);
    }
  }
}

function printHelp(): void {
  console.log(
    [
      "Creator Maya v0 Fly/OpenClaw smoke",
      "",
      "Usage:",
      "  npm run smoke:creator-maya-v0",
      "  npm run smoke:creator-maya-v0 -- --live --confirm",
      "",
      "Flags:",
      "  --mock            Hermetic command/workspace validation (default).",
      "  --live            Create a real temporary Fly app and OpenClaw machine.",
      "  --confirm         Required with --live.",
      "  --app <name>      Optional app name for live mode.",
      "  --keep-app        Do not destroy the Fly app after live mode.",
      "  --help            Show this help.",
    ].join("\n")
  );
}

const isDirectRun =
  typeof process !== "undefined" &&
  process.argv[1] &&
  process.argv[1].endsWith("creator-maya-v0-fly-smoke.ts");

if (isDirectRun) {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.help) {
    printHelp();
    process.exit(0);
  }

  if (flags.mode === "mock") {
    const result = runMockSmoke();
    console.log(`Creator Maya v0 mock Fly smoke passed: ${result.fileTargets.length} files`);
  } else {
    runLiveSmoke(flags).catch((err) => {
      console.error(`Creator Maya v0 live Fly smoke failed: ${(err as Error).message}`);
      process.exit(2);
    });
  }
}
