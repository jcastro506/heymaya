#!/usr/bin/env tsx
/**
 * Autonomous onboarding loop driver.
 *
 * Sends pre-written answers to the running Maya via `openclaw agent` CLI
 * over flyctl ssh, walks through Q1-Q6, then waits for the picture-verify
 * round-trip and confirms. Watches for the heartbeat over a configurable
 * window after onboarding completes.
 *
 * Usage:
 *   npx tsx scripts/loop-onboarding.ts --app maya-jn7d4enf [--phone +16313357603] [--watch-mins 60]
 *
 * Why: testing the full conversation arc through actual iMessage requires
 * a human typing answers in real time. This driver runs the same arc
 * autonomously by injecting messages via `openclaw agent -m '...' --channel
 * imessage --reply-to <phone> --deliver` — same code path Maya runs when a
 * real inbound arrives, but no human in the loop. Reads each Maya response
 * from /data/agents/main/sessions/*.jsonl and prints a transcript.
 *
 * Pre-written answers — operator-confirmed v15 test answers, which produced
 * a clean Q1-Q6 round-trip the first time:
 */

import { execSync, spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

interface Args {
  app: string;
  phone: string;
  watchMins: number;
  help: boolean;
}

const ANSWERS: ReadonlyArray<{ q: string; a: string }> = [
  { q: "Q1 location", a: "NYC" },
  { q: "Q2 niche", a: "NYC lifestyle since I just moved here" },
  { q: "Q3 3-month goals", a: "Getting to 1k followers and being consistent" },
  { q: "Q4 job status", a: "Side hustle — I have a full time job 9-5 but I want to be a creator eventually" },
  { q: "Q5 brand deals", a: "No brand deals yet, no minimum price right now" },
  { q: "Q6 anti-patterns", a: "No banned topics for now" },
  { q: "picture-verify confirm", a: "Looks good — the niche is NYC lifestyle, not London" },
];

function parseArgs(argv: ReadonlyArray<string>): Args {
  const args: Args = {
    app: "",
    phone: "+16313357603",
    watchMins: 60,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--app") args.app = argv[++i] ?? "";
    else if (v === "--phone") args.phone = argv[++i] ?? args.phone;
    else if (v === "--watch-mins") args.watchMins = Number(argv[++i] ?? "60");
    else if (v === "--help" || v === "-h") args.help = true;
  }
  return args;
}

function ssh(app: string, cmd: string, timeoutMs = 120_000): string {
  // Use flyctl ssh console with --command. Quote the inner command for /bin/sh.
  const quoted = cmd.replace(/'/g, "'\"'\"'");
  const result = spawnSync(
    "flyctl",
    ["ssh", "console", "--app", app, "--command", `/bin/sh -c '${quoted}'`],
    { encoding: "utf8", timeout: timeoutMs }
  );
  if (result.status !== 0) {
    return `[ssh exit ${result.status}] ${result.stderr ?? result.stdout ?? ""}`;
  }
  return result.stdout ?? "";
}

function logTo(file: string, line: string): void {
  const dir = dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const stamped = `[${new Date().toISOString()}] ${line}\n`;
  writeFileSync(file, stamped, { flag: "a" });
  process.stdout.write(stamped);
}

function readMayaResponse(app: string, sinceLineCount: number): { lines: string[]; total: number } {
  // Pull all assistant message-tool calls across all sessions, return any new
  // ones that appeared since `sinceLineCount` total lines.
  const cmd = `cat /data/agents/main/sessions/*.jsonl 2>/dev/null | grep -o '"action":"send","target":"[^"]*","message":"[^"]*"' | tail -200`;
  const out = ssh(app, cmd, 60_000);
  const lines = out.split("\n").filter((l) => l.length > 0);
  const newLines = lines.slice(sinceLineCount);
  return { lines: newLines, total: lines.length };
}

function injectAnswer(app: string, phone: string, message: string): string {
  // Run an agent turn as if `message` came from `phone` via claw-messenger.
  // --deliver makes Maya's reply land back on the channel.
  const escaped = message.replace(/"/g, '\\"');
  const cmd = `openclaw agent --channel imessage --reply-to "${phone}" --deliver -m "${escaped}" --json 2>&1`;
  return ssh(app, cmd, 180_000);
}

function sleep(seconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.app) {
    console.log("Usage: npx tsx scripts/loop-onboarding.ts --app <fly-app-name> [--phone +1...] [--watch-mins 60]");
    process.exit(args.help ? 0 : 2);
  }
  const logFile = join("logs", `loop-onboarding-${args.app}-${Date.now()}.log`);
  logTo(logFile, `=== loop-onboarding start app=${args.app} phone=${args.phone} ===`);

  // Wait for kickstart to land (initial 4 messages from Maya). Poll up to 3 min.
  let totalSeen = 0;
  const kickstartDeadline = Date.now() + 180_000;
  while (Date.now() < kickstartDeadline) {
    const r = readMayaResponse(args.app, totalSeen);
    if (r.lines.length >= 4) {
      r.lines.forEach((l) => logTo(logFile, `MAYA: ${l.slice(0, 300)}`));
      totalSeen = r.total;
      break;
    }
    sleep(15);
  }
  if (totalSeen < 4) {
    logTo(logFile, "[fail] kickstart did not land within 3 min");
    process.exit(1);
  }

  // Walk Q1-Q6 + verify-confirm.
  for (const step of ANSWERS) {
    logTo(logFile, `--- ${step.q} ---`);
    logTo(logFile, `OPERATOR: ${step.a}`);
    const out = injectAnswer(args.app, args.phone, step.a);
    logTo(logFile, `[agent-cli exit] ${out.slice(0, 500)}`);
    sleep(20);
    const r = readMayaResponse(args.app, totalSeen);
    r.lines.forEach((l) => logTo(logFile, `MAYA: ${l.slice(0, 300)}`));
    totalSeen = r.total;
  }

  logTo(logFile, `=== onboarding answers + verify done; watching heartbeat for ${args.watchMins} min ===`);
  const watchDeadline = Date.now() + args.watchMins * 60_000;
  while (Date.now() < watchDeadline) {
    sleep(60);
    const r = readMayaResponse(args.app, totalSeen);
    if (r.lines.length > 0) {
      r.lines.forEach((l) => logTo(logFile, `HEARTBEAT-MAYA: ${l.slice(0, 300)}`));
      totalSeen = r.total;
    }
  }
  logTo(logFile, "=== watch window complete ===");
}

main();
