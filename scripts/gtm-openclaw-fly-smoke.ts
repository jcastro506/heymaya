#!/usr/bin/env tsx
/**
 * ClawLaunch GTM Fly/OpenClaw smoke.
 *
 * Mock mode validates the exact workspace + flyctl command shape without
 * touching cloud resources. Live mode creates a temporary Fly app, boots the
 * published OpenClaw runtime image with the GTM workspace, verifies cron/skill
 * files, then sends a direct OpenClaw message that proves Maya can read the
 * ScrapeCreators skill and the heartbeat spend boundary.
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
  buildMayaGtmWorkspace,
  type MayaGtmWorkspaceInput,
} from "../convex/agents/packs/maya_gtm/generators";

const OPENCLAW_IMAGE =
  process.env.MAYA_GTM_OPENCLAW_IMAGE ??
  process.env.MAYA_OPENCLAW_IMAGE ??
  "registry.fly.io/heymaya-openclaw:v2026.4.24";
const OPENCLAW_MODEL =
  process.env.MAYA_GTM_MODEL ??
  process.env.OPENCLAW_MODEL ??
  "google/gemini-3-flash-preview";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface Flags {
  mode: "mock" | "live";
  confirm: boolean;
  appName: string | null;
  keepApp: boolean;
  agentMessage: boolean;
  realWork: boolean;
  requireCron: boolean;
  help: boolean;
}

export interface GtmOpenClawFlySmokeFixture {
  appName: string;
  image: string;
  region: string;
  workspaceFiles: Record<string, string>;
  gatewayConfig: Record<string, unknown>;
  bootCommand: string;
}

export interface GtmOpenClawFlySmokeMockResult {
  fixture: GtmOpenClawFlySmokeFixture;
  commandArgs: ReadonlyArray<string>;
  fileTargets: ReadonlyArray<string>;
}

function buildGatewayConfig(): Record<string, unknown> {
  const mainModel = toOpenClawModelRef(OPENCLAW_MODEL);
  const memorySearch = buildMemorySearchConfig();
  return {
    gateway: { mode: "local" },
    agents: {
      defaults: {
        workspace: "/data/workspace",
        model: {
          primary: mainModel,
        },
        memorySearch,
        subagents: {
          // Sprint 2.16j — bumped 4 → 8 per external-architect review.
          maxConcurrent: 8,
          maxChildrenPerAgent: 4,
          runTimeoutSeconds: 900,
          archiveAfterMinutes: 60,
        },
      },
      list: [
        {
          id: "main",
          default: true,
          name: "Maya",
          workspace: "/data/workspace",
          model: mainModel,
          subagents: { allowAgents: ["main", "hard_research_beta"] },
          tools: { profile: "coding" },
        },
        {
          id: "hard_research_beta",
          name: "Hard Research Beta",
          workspace: "/data/workspace",
          model: "openrouter/anthropic/claude-sonnet-4.5",
          tools: { profile: "coding" },
        },
      ],
    },
    plugins: {
      entries: {
        acpx: { enabled: false },
        browser: { enabled: false },
        "device-pair": { enabled: false },
        "phone-control": { enabled: false },
        "talk-voice": { enabled: false },
      },
    },
    discovery: { mdns: { mode: "off" } },
    skills: { load: { watch: true } },
  };
}

function buildMemorySearchConfig(): Record<string, unknown> {
  const geminiKey =
    process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!geminiKey) {
    return { enabled: false };
  }

  return {
    enabled: true,
    provider: "gemini",
    model: "gemini-embedding-001",
    outputDimensionality: 768,
    fallback: "none",
    store: {
      path: "/data/openclaw-memory/{agentId}.sqlite",
      vector: { enabled: true },
      fts: { tokenizer: "unicode61" },
    },
    query: {
      maxResults: 8,
      minScore: 0.25,
      hybrid: {
        enabled: true,
        vectorWeight: 0.65,
        textWeight: 0.35,
        temporalDecay: { enabled: true, halfLifeDays: 45 },
      },
    },
    sync: {
      onSessionStart: true,
      onSearch: true,
      watch: true,
      intervalMinutes: 30,
      sessions: {
        deltaBytes: 100000,
        deltaMessages: 50,
        postCompactionForce: true,
      },
    },
  };
}

function parseFlags(argv: ReadonlyArray<string>): Flags {
  const flags: Flags = {
    mode: "mock",
    confirm: false,
    appName: null,
    keepApp: false,
    agentMessage: false,
    realWork: false,
    requireCron: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--mock") flags.mode = "mock";
    else if (arg === "--live") flags.mode = "live";
    else if (arg === "--confirm") flags.confirm = true;
    else if (arg === "--keep-app") flags.keepApp = true;
    else if (arg === "--agent-message") flags.agentMessage = true;
    else if (arg === "--real-work") flags.realWork = true;
    else if (arg === "--require-cron") flags.requireCron = true;
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

  if (!process.env.FLY_ACCESS_TOKEN && process.env.FLY_API_TOKEN) {
    process.env.FLY_ACCESS_TOKEN = process.env.FLY_API_TOKEN;
  }
}

function defaultWorkspaceInput(): MayaGtmWorkspaceInput {
  return {
    accountEmail: "founder@clawlaunch.test",
    timezone: "America/New_York",
    app: {
      name: "BugBrief",
      url: "https://bugbrief.test",
      stage: "live-beta",
      weekGoal: "signups",
      founderWhy: "Small teams lose bug context before they can fix it.",
      canRecordScreen: true,
      canShowFace: false,
      canRecordVoice: true,
      canProvideScreenshots: true,
      canPostTikTokManually: true,
      canPostInstagramManually: true,
      existingTikTokUrl: "https://www.tiktok.com/@bugbrief",
      existingInstagramUrl: "https://www.instagram.com/bugbrief",
      tiktokWarmupState: "warming",
      tiktokAccountAgeDays: 3,
      tiktokAccountStatusChecked: false,
      openToUgcCreators: true,
      creatorBudgetMonthlyUsd: 250,
      maxWeeklyVisualPosts: 4,
      excludedAudiences: ["enterprise procurement"],
    },
    primaryChannel: "reddit",
    secondaryChannel: "x",
  };
}

function realUserWorkspaceInput(): MayaGtmWorkspaceInput {
  return {
    accountEmail: "founder+jam-realwork@clawlaunch.test",
    timezone: "America/New_York",
    app: {
      name: "Jam",
      url: "https://jam.dev",
      stage: "live-beta",
      weekGoal: "signups",
      founderWhy:
        "Developers and product teams lose bug context when reports are vague, missing logs, or detached from the actual user session.",
      canRecordScreen: true,
      canShowFace: false,
      canRecordVoice: true,
      canProvideScreenshots: true,
      canPostTikTokManually: true,
      canPostInstagramManually: true,
      existingTikTokUrl: "not connected",
      existingInstagramUrl: "not connected",
      tiktokWarmupState: "new_needs_warmup",
      tiktokAccountAgeDays: 0,
      tiktokAccountStatusChecked: false,
      openToUgcCreators: false,
      creatorBudgetMonthlyUsd: 0,
      maxWeeklyVisualPosts: 3,
      excludedAudiences: ["enterprise procurement"],
    },
    primaryChannel: "reddit",
    secondaryChannel: "x",
  };
}

export function buildGtmOpenClawFlySmokeFixture(
  appName = `clawlaunch-gtm-smoke-${Date.now().toString(36)}`,
  region = process.env.FLY_REGION || "iad",
  workspaceInput: MayaGtmWorkspaceInput = defaultWorkspaceInput()
): GtmOpenClawFlySmokeFixture {
  const { files } = buildMayaGtmWorkspace(workspaceInput);
  const workspaceFiles = Object.fromEntries(files.entries());
  return {
    appName,
    image: OPENCLAW_IMAGE,
    region,
    workspaceFiles,
    gatewayConfig: buildGatewayConfig(),
    bootCommand: [
      "test -s /data/workspace/AGENTS.md",
      "test -s /data/workspace/TOOLS.md",
      "test -s /data/workspace/HEARTBEAT.md",
      "test -s /data/workspace/USER.md",
      "test -s /data/workspace/skills/scrapecreators-api/SKILL.md",
      "test -s /data/cron/jobs.json",
      "test -s /data/openclaw.json",
      "if [ ! -w /data/workspace ]; then boot=/data/workspace.bootstrap.$$; mv /data/workspace \"$boot\"; mkdir -p /data/workspace; cp -R \"$boot/.\" /data/workspace; fi",
      "if [ ! -w /data/cron ]; then boot=/data/cron.bootstrap.$$; mv /data/cron \"$boot\"; mkdir -p /data/cron; cp \"$boot/jobs.json\" /data/cron/jobs.json; fi",
      "mkdir -p /data/workspace/state /data/canvas",
      "chmod 700 /data/cron",
      "chmod 600 /data/cron/jobs.json",
      "test -w /data/workspace",
      "test -w /data/cron",
      "exec openclaw gateway --allow-unconfigured",
    ].join(" && "),
  };
}

function addRealWorkCronJob(
  fixture: GtmOpenClawFlySmokeFixture,
  atMs = Date.now() + 120_000
): GtmOpenClawFlySmokeFixture {
  const parsed = JSON.parse(fixture.workspaceFiles["jobs.json"] ?? "{}") as {
    version: number;
    jobs: Array<Record<string, unknown>>;
  };
  // Sprint 2.16u — gtm_heartbeat + 0001_gtm_boot_kickoff crons no
  // longer exist (HEARTBEAT.md state machine + agents.defaults
  // .heartbeat.every:"5m" drive boot work). This loop is a no-op now
  // but kept structurally in case future smoke fixtures need
  // per-job overrides.
  parsed.jobs.unshift({
    id: "0002_onboarding_deep_research_realwork",
    name: "0002 Onboarding deep research real work",
    description:
      "One-shot real-work gate. Executes the bounded onboarding research task through OpenClaw cron/gateway, not the direct CLI path.",
    enabled: true,
    createdAtMs: 0,
    updatedAtMs: 0,
    schedule: { kind: "at", at: new Date(atMs).toISOString() },
    sessionTarget: "isolated",
    wakeMode: "now",
    deleteAfterRun: true,
    payload: {
      kind: "agentTurn",
      lightContext: false,
      thinking: "off",
      timeoutSeconds: 900,
      message: [
        "RUN REAL WORK: Execute the bounded onboarding_deep_research job for the user in /data/workspace.",
        "Read AGENTS.md, APP.md, GTM.md, USER.md, TOOLS.md, MEMORY.md, and relevant skill files.",
        "Read /data/workspace/skills/scrapecreators-api/SKILL.md before platform research.",
        "Use the ScrapeCreators API only if SCRAPECREATORS_API_KEY or SCRAPE_CREATORS_API_KEY is available; prefer SCRAPECREATORS_API_KEY and cap this smoke to 3 ScrapeCreators calls total.",
        "Prefer ScrapeCreators /v1/reddit/search and /v1/google/search for platform evidence; do not scrape Google HTML with raw curl.",
        "If you use sessions_spawn, call agents_list first and set agentId to hard_research_beta for hard research workers.",
        "Use only tools actually available in this OpenClaw runtime.",
        "If web/search/ScrapeCreators tools are not actually callable, do not fake source-backed research; return RUN_STATUS_BLOCKED with the missing tool surface and exact next engineering fix.",
        "If tools are available, inspect the product URL and gather real evidence before strategy.",
        "Required output sections: product_diagnosis, likely_buyers, pain_evidence, channel_recommendation, first_7_day_plan, tiktok_or_instagram_manual_handoff, calendar_briefs, next_jobs, budget_used.",
        "For TikTok/Instagram, include manual-post constraints and account warm-up / Account Check status because this user has a new account.",
        "Write the final research brief to /data/workspace/state/onboarding_deep_research.md if file writes are available.",
        "End the final answer with exactly one marker: RUN_STATUS_DONE if real evidence was gathered, otherwise RUN_STATUS_BLOCKED.",
      ].join(" "),
    },
    delivery: { mode: "none", bestEffort: true },
    state: {},
  });

  return {
    ...fixture,
    workspaceFiles: {
      ...fixture.workspaceFiles,
      "jobs.json": `${JSON.stringify(parsed, null, 2)}\n`,
    },
  };
}

function writeFixtureFiles(fixture: GtmOpenClawFlySmokeFixture): string {
  const dir = mkdtempSync(join(tmpdir(), "gtm-openclaw-fly-smoke-"));
  for (const [name, content] of Object.entries(fixture.workspaceFiles)) {
    const localName = name === "jobs.json" ? "jobs.json" : name;
    const filePath = join(dir, localName);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, "utf8");
  }
  writeFileSync(join(dir, "openclaw.json"), JSON.stringify(fixture.gatewayConfig), "utf8");
  return dir;
}

export function buildFlyMachineRunArgs(
  fixture: GtmOpenClawFlySmokeFixture,
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
    "2",
    "--vm-memory",
    "2048",
    "--env",
    "OPENCLAW_STATE_DIR=/data",
    "--env",
    "OPENCLAW_CONFIG_PATH=/data/openclaw.json",
    "--env",
    "OPENCLAW_DISABLE_BONJOUR=1",
    "--env",
    `OPENCLAW_MODEL=${toOpenClawModelRef(OPENCLAW_MODEL)}`,
    "--metadata",
    "smoke=clawlaunch-gtm",
  ];

  for (const key of [
    "GEMINI_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "OPENROUTER_API_KEY",
    "SCRAPE_CREATORS_API_KEY",
    "SCRAPECREATORS_API_KEY",
  ]) {
    const value = process.env[key];
    if (value) args.push("--env", `${key}=${value}`);
  }
  if (!process.env.SCRAPE_CREATORS_API_KEY && process.env.SCRAPECREATORS_API_KEY) {
    args.push("--env", `SCRAPE_CREATORS_API_KEY=${process.env.SCRAPECREATORS_API_KEY}`);
  }
  if (!process.env.SCRAPECREATORS_API_KEY && process.env.SCRAPE_CREATORS_API_KEY) {
    args.push("--env", `SCRAPECREATORS_API_KEY=${process.env.SCRAPE_CREATORS_API_KEY}`);
  }
  if (!process.env.GEMINI_API_KEY && process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    args.push("--env", `GEMINI_API_KEY=${process.env.GOOGLE_GENERATIVE_AI_API_KEY}`);
  }
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY && process.env.GEMINI_API_KEY) {
    args.push("--env", `GOOGLE_GENERATIVE_AI_API_KEY=${process.env.GEMINI_API_KEY}`);
  }

  for (const name of Object.keys(fixture.workspaceFiles).sort()) {
    const inside =
      name === "jobs.json" ? "/data/cron/jobs.json" : `/data/workspace/${name}`;
    const localName = name === "jobs.json" ? "jobs.json" : name;
    args.push("--file-local", `${inside}=${join(fixtureDir, localName)}`);
  }
  args.push("--file-local", `/data/openclaw.json=${join(fixtureDir, "openclaw.json")}`);
  args.push("--", fixture.image, "/bin/sh", "-lc", fixture.bootCommand);
  return args;
}

export function runMockSmoke(): GtmOpenClawFlySmokeMockResult {
  const fixture = buildGtmOpenClawFlySmokeFixture("clawlaunch-gtm-smoke-test", "iad");
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
    env: process.env,
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
      // Fly can briefly return non-JSON while app metadata settles.
    }
    sleep(5_000);
  }
  throw new Error(`Timed out waiting for machine to start. Last state: ${lastState}`);
}

function verifyMachineFiles(appName: string, machineId: string): string {
  const command = [
    "test -s /data/workspace/AGENTS.md",
    "test -s /data/workspace/GTM.md",
    "test -s /data/workspace/TOOLS.md",
    "test -s /data/workspace/HEARTBEAT.md",
    "test -s /data/workspace/USER.md",
    "test -s /data/workspace/skills/scrapecreators-api/SKILL.md",
    "grep -q 'ScrapeCreators' /data/workspace/skills/scrapecreators-api/SKILL.md",
    // Sprint 2.16u — HEARTBEAT.md is the state machine now; assert
    // the state-* tasks instead of the old "ScrapeCreators calls"
    // forbid-list wording.
    "grep -q 'state-hello' /data/workspace/HEARTBEAT.md",
    "grep -q 'state-plan-synthesis' /data/workspace/HEARTBEAT.md",
    "test -s /data/cron/jobs.json",
    // Boot cron + heartbeat cron were dropped in Sprint 2.16u; only
    // real scheduled events remain.
    "grep -q 'gtm_weekly_review' /data/cron/jobs.json",
    "grep -q 'gtm_channel_discovery' /data/cron/jobs.json",
    "test -s /data/openclaw.json",
    "test -w /data/workspace",
    "test -w /data/cron",
  ].join(" && ");
  return runSsh(appName, machineId, command, 180_000);
}

function waitForGatewayReadyLogs(appName: string, machineId: string): string {
  const deadline = Date.now() + 1_200_000;
  const expectedModel = toOpenClawModelRef(OPENCLAW_MODEL);
  const command = [
    "grep -h -i 'agent model:\\|ready (\\|failed\\|error' /tmp/openclaw-1000/openclaw-*.log 2>/dev/null",
    "tail -120",
  ].join(" | ");
  let logs = "";
  while (Date.now() < deadline) {
    logs = runSsh(appName, machineId, command, 90_000);
    if (/failed to start|plugin service failed|EACCES|permission denied|Cannot read properties of undefined/i.test(logs)) {
      throw new Error(`OpenClaw gateway failed during boot for ${appName}/${machineId}.`);
    }
    if (logs.includes(`agent model: ${expectedModel}`) && /\bready \(/i.test(logs)) {
      return logs;
    }
    sleep(5_000);
  }
  throw new Error(
    `Timed out waiting for OpenClaw gateway ready logs with model ${expectedModel} for ${appName}.`
  );
}

function waitForCronStarted(appName: string, machineId: string): void {
  const deadline = Date.now() + 1_800_000;
  const command =
    "grep -h 'cron: started' /tmp/openclaw-1000/openclaw-*.log 2>/dev/null | head -1";
  while (Date.now() < deadline) {
    const out = runSsh(appName, machineId, command, 90_000);
    if (out.includes("cron: started")) return;
    sleep(5_000);
  }
  throw new Error(`Timed out waiting for "cron: started" in gateway log for ${appName}.`);
}

function waitForHeartbeatStarted(appName: string, machineId: string): void {
  const deadline = Date.now() + 180_000;
  const command =
    "grep -h 'heartbeat: started' /tmp/openclaw-1000/openclaw-*.log 2>/dev/null | head -1";
  while (Date.now() < deadline) {
    const out = runSsh(appName, machineId, command, 90_000);
    if (out.includes("heartbeat: started")) return;
    sleep(5_000);
  }
  throw new Error(`Timed out waiting for "heartbeat: started" in gateway log for ${appName}.`);
}

function verifyAgentSkillMessage(appName: string, machineId: string): string {
  const prompt = [
    "SMOKE TEST ONLY.",
    "Read /data/workspace/skills/scrapecreators-api/SKILL.md and /data/workspace/HEARTBEAT.md.",
    "Do not call external APIs.",
    "Return one line exactly like JSON with keys skill_present and heartbeat_spend_forbidden, both true, if those files prove the ScrapeCreators skill is installed and heartbeat cannot spend on ScrapeCreators.",
  ].join(" ");
  const command = `openclaw agent --to gtm-smoke -m ${quoteShell(prompt)} --json --timeout 180 2>&1`;
  const out = runSsh(appName, machineId, command, 300_000);
  if (!/skill_present/i.test(out) || !/heartbeat_spend_forbidden/i.test(out)) {
    throw new Error(`OpenClaw agent message did not prove skill access:\n${out}`);
  }
  return out;
}

function runSsh(
  appName: string,
  machineId: string,
  command: string,
  timeoutMs: number
): string {
  const args = [
    "ssh",
    "console",
    "--app",
    appName,
    "--machine",
    machineId,
    "--command",
    `/bin/sh -lc ${quoteShell(command)}`,
  ];
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return runFly(args, timeoutMs);
    } catch (err) {
      lastErr = err;
      const message = (err as Error).message;
      if (!/ETIMEDOUT|timed out|timeout/i.test(message)) throw err;
      if (attempt < 3) sleep(5_000 * attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function waitForCronSessionMarker(
  appName: string,
  machineId: string,
  sessionKey: string,
  timeoutMs = 1_200_000
): string {
  const deadline = Date.now() + timeoutMs;
  const command = `node -e ${quoteShell(`
const fs = require("fs");
const sessionsPath = "/data/agents/main/sessions/sessions.json";
const statePath = "/data/workspace/state/onboarding_deep_research.md";
if (fs.existsSync(statePath)) {
  const stateText = fs.readFileSync(statePath, "utf8");
  if (/RUN_STATUS_BLOCKED/i.test(stateText)) {
    console.log("REALWORK_BLOCKED");
    console.log(stateText.slice(-16000));
    process.exit(0);
  }
  if (/RUN_STATUS_DONE/i.test(stateText)) {
    console.log("REALWORK_DONE");
    console.log(stateText.slice(-16000));
    process.exit(0);
  }
}
if (!fs.existsSync(sessionsPath)) {
  console.log("REALWORK_PENDING: sessions file missing");
  process.exit(0);
}
const sessions = JSON.parse(fs.readFileSync(sessionsPath, "utf8"));
const entry = sessions[${JSON.stringify(sessionKey)}];
if (!entry || !entry.sessionFile || !fs.existsSync(entry.sessionFile)) {
  console.log("REALWORK_PENDING: session file missing");
  process.exit(0);
}
const text = fs.readFileSync(entry.sessionFile, "utf8");
const assistantText = text
  .split(/\\r?\\n/)
  .filter(Boolean)
  .flatMap((line) => {
    try {
      const event = JSON.parse(line);
      if (event?.message?.role !== "assistant") return [];
      const content = event.message.content;
      if (!Array.isArray(content)) return [];
      return content
        .filter((part) => part?.type === "text" && typeof part.text === "string")
        .map((part) => part.text);
    } catch {
      return [];
    }
  })
  .join("\\n");
if (/RUN_STATUS_BLOCKED/i.test(assistantText)) {
  console.log("REALWORK_BLOCKED");
  console.log(assistantText.slice(-16000));
  process.exit(0);
}
if (/RUN_STATUS_DONE/i.test(assistantText)) {
  console.log("REALWORK_DONE");
  console.log(assistantText.slice(-16000));
  process.exit(0);
}
console.log("REALWORK_PENDING: marker missing");
console.log(text.slice(-4000));
process.exit(0);
`)}`;

  let lastOut = "";
  while (Date.now() < deadline) {
    lastOut = runSsh(appName, machineId, command, 120_000);
    if (lastOut.includes("REALWORK_BLOCKED")) {
      throw new Error(`Maya reported the real-work gate is blocked:\n${lastOut}`);
    }
    if (lastOut.includes("REALWORK_DONE")) {
      return lastOut;
    }
    sleep(10_000);
  }
  throw new Error(`Timed out waiting for ${sessionKey} to emit RUN_STATUS_DONE. Last: ${lastOut}`);
}

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function toOpenClawModelRef(model: string): string {
  if (model.includes("/")) {
    return model.startsWith("openrouter/") ? model : `openrouter/${model}`;
  }
  return model;
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
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

  const appName = flags.appName ?? `clawlaunch-gtm-smoke-${Date.now().toString(36)}`;
  let fixture = buildGtmOpenClawFlySmokeFixture(
    appName,
    process.env.FLY_REGION || "iad",
    flags.realWork ? realUserWorkspaceInput() : defaultWorkspaceInput()
  );
  if (flags.realWork) fixture = addRealWorkCronJob(fixture);
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

    console.log("Verifying workspace, cron, config, and skill files on the machine.");
    const verifyOut = verifyMachineFiles(appName, machine.id).trim();
    if (verifyOut) console.log(verifyOut);

    console.log("Waiting for OpenClaw gateway ready logs.");
    const logs = waitForGatewayReadyLogs(appName, machine.id);
    const interesting = logs
      .split(/\r?\n/)
      .filter((line) => /openclaw|gateway|cron|ready|error|failed/i.test(line))
      .slice(-20)
      .join("\n");
    if (interesting) console.log(interesting);

    console.log("Waiting for heartbeat started log.");
    waitForHeartbeatStarted(appName, machine.id);
    console.log("Heartbeat started log observed.");

    if (flags.requireCron) {
      console.log("Waiting for cron started log.");
      waitForCronStarted(appName, machine.id);
      console.log("Cron started log observed.");
    } else {
      console.log(
        "Cron started log not required by default. Use --require-cron for the stricter scheduler gate."
      );
    }

    if (flags.agentMessage) {
      const agentOut = verifyAgentSkillMessage(appName, machine.id);
      console.log(agentOut.split(/\r?\n/).slice(-8).join("\n"));
    } else {
      console.log(
        "Skipped direct agent message. Use --agent-message when a channel/main recipient is available."
      );
    }

    if (flags.realWork) {
      console.log("Waiting for real onboarding_deep_research cron agent work.");
      const realWorkOut = waitForCronSessionMarker(
        appName,
        machine.id,
        "agent:main:cron:0002_onboarding_deep_research_realwork"
      );
      console.log(realWorkOut.split(/\r?\n/).slice(-40).join("\n"));
    }

    console.log("ClawLaunch GTM live Fly/OpenClaw smoke passed.");
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
      "ClawLaunch GTM Fly/OpenClaw smoke",
      "",
      "Usage:",
      "  npm run smoke:gtm-openclaw",
      "  npm run smoke:gtm-openclaw -- --live --confirm",
      "  npm run smoke:gtm-openclaw -- --live --confirm --require-cron",
      "  npm run smoke:gtm-openclaw -- --live --confirm --require-cron --real-work --keep-app",
      "",
      "Flags:",
      "  --mock            Hermetic command/workspace validation (default).",
      "  --live            Create a real temporary Fly app and OpenClaw machine.",
      "  --confirm         Required with --live.",
      "  --app <name>      Optional app name for live mode.",
      "  --keep-app        Do not destroy the Fly app after live mode.",
      "  --agent-message   Also send a direct OpenClaw agent turn. This requires",
      "                    model/channel routing that can complete in this runtime.",
      "  --real-work       Deploy a real user-shaped Maya and run bounded onboarding research.",
      "  --help            Show this help.",
    ].join("\n")
  );
}

const isDirectRun =
  typeof process !== "undefined" &&
  process.argv[1] &&
  process.argv[1].endsWith("gtm-openclaw-fly-smoke.ts");

if (isDirectRun) {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.help) {
    printHelp();
    process.exit(0);
  }

  if (flags.mode === "mock") {
    const result = runMockSmoke();
    console.log(`ClawLaunch GTM mock Fly smoke passed: ${result.fileTargets.length} files`);
  } else {
    runLiveSmoke(flags).catch((err) => {
      console.error(`ClawLaunch GTM live Fly smoke failed: ${(err as Error).message}`);
      process.exit(2);
    });
  }
}
