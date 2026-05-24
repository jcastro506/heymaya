#!/usr/bin/env tsx
/**
 * ClawLaunch GTM Sprint 18 — L4 smoke (heartbeat tasks block).
 *
 * Asserts:
 *   - HEARTBEAT.md ships a documented `tasks:` YAML block (native
 *     OpenClaw interval gating, not hand-rolled cron throttle)
 *   - The 4 documented tasks are present (pending-approvals,
 *     calendar-due, open-loops, hourly-result-scan)
 *   - HEARTBEAT_OK silent-ack token convention is documented
 *   - jobs.json no longer ships gtm_calendar_check / gtm_result_refresh
 *     (their work moved into heartbeat tasks)
 *   - gateway config carries heartbeat.activeHours + lightContext +
 *     isolatedSession (documented cost-savings pattern)
 */

import { buildMayaGtmWorkspace } from "../convex/agents/packs/maya_gtm/generators";
import { buildGatewayConfig } from "../convex/onboarding/gtm/deployMayaGtm";

interface Check {
  name: string;
  status: "passed" | "failed";
  detail: string;
}
const checks: Check[] = [];
const pass = (n: string, d: string) =>
  checks.push({ name: n, status: "passed", detail: d });
const fail = (n: string, d: string) =>
  checks.push({ name: n, status: "failed", detail: d });

function fixtureInput() {
  return {
    accountEmail: "rwtc@heymaya.test",
    timezone: "America/New_York",
    bootKickoffAtMs: Date.UTC(2026, 0, 1, 12, 0, 0),
    app: {
      name: "S18 fixture",
      url: "https://s18-fixture.test/",
      stage: "live-beta" as const,
      weekGoal: "signups" as const,
      canRecordScreen: true,
      canShowFace: false,
      excludedAudiences: [] as string[],
    },
  };
}

function checkHeartbeatMdHasTasksBlock(): void {
  const { files } = buildMayaGtmWorkspace(fixtureInput());
  const hb = files.get("HEARTBEAT.md") ?? "";
  const required = [
    "```yaml",
    "tasks:",
    "name: pending-approvals",
    "interval: 30m",
    "name: calendar-due",
    "name: open-loops",
    "name: hourly-result-scan",
    "HEARTBEAT_OK",
  ];
  for (const r of required) {
    if (!hb.includes(r)) {
      fail("heartbeat-tasks-block", `HEARTBEAT.md missing required text: '${r}'`);
      return;
    }
  }
  pass(
    "heartbeat-tasks-block",
    `HEARTBEAT.md ships the documented OpenClaw tasks: YAML with all 4 tasks + HEARTBEAT_OK token convention`
  );
}

function checkRedundantCronsRemoved(): void {
  const { files } = buildMayaGtmWorkspace(fixtureInput());
  const jobs = JSON.parse(files.get("jobs.json") ?? "{}") as {
    jobs?: Array<{ id?: string }>;
  };
  const ids = (jobs.jobs ?? []).map((j) => j.id);
  if (ids.includes("gtm_calendar_check") || ids.includes("gtm_result_refresh")) {
    fail(
      "redundant-crons-removed",
      `jobs.json still ships dropped cron IDs: ${ids.join(", ")}`
    );
    return;
  }
  const required = ["0001_gtm_boot_kickoff", "gtm_heartbeat", "gtm_weekly_review"];
  for (const r of required) {
    if (!ids.includes(r)) {
      fail("required-crons-still-present", `jobs.json missing '${r}'`);
      return;
    }
  }
  pass(
    "cron-set-reduced",
    `jobs.json now ships exactly the 3 required crons (boot_kickoff + heartbeat + weekly_review); calendar_check + result_refresh moved into HEARTBEAT.md tasks`
  );
}

function checkGatewayHeartbeatConfig(): void {
  const cfg = buildGatewayConfig() as {
    agents: {
      defaults: {
        heartbeat?: {
          every?: string;
          lightContext?: boolean;
          isolatedSession?: boolean;
          activeHours?: { start?: string; end?: string; timezone?: string };
        };
      };
    };
  };
  const hb = cfg.agents.defaults.heartbeat;
  if (!hb) {
    fail("gateway-heartbeat", "gateway config has no agents.defaults.heartbeat");
    return;
  }
  if (hb.every !== "30m") {
    fail(
      "gateway-heartbeat-every",
      `expected heartbeat.every=30m, got ${hb.every}`
    );
    return;
  }
  if (hb.lightContext !== true) {
    fail(
      "gateway-heartbeat-light",
      "expected heartbeat.lightContext=true (cost-savings pattern)"
    );
    return;
  }
  if (hb.isolatedSession !== true) {
    fail(
      "gateway-heartbeat-isolated",
      "expected heartbeat.isolatedSession=true (cost-savings pattern)"
    );
    return;
  }
  if (
    !hb.activeHours ||
    !hb.activeHours.start ||
    !hb.activeHours.end
  ) {
    fail(
      "gateway-heartbeat-active-hours",
      "expected heartbeat.activeHours with start + end"
    );
    return;
  }
  pass(
    "gateway-heartbeat-config",
    `heartbeat every=30m, lightContext=true, isolatedSession=true, activeHours=${hb.activeHours.start}-${hb.activeHours.end}`
  );
}

async function main(): Promise<void> {
  const liveMode = process.argv.includes("--live");
  const confirmed = process.argv.includes("--confirm");
  if (liveMode && !confirmed) {
    console.error("[smoke] --live requires --confirm");
    process.exit(2);
  }

  checkHeartbeatMdHasTasksBlock();
  checkRedundantCronsRemoved();
  checkGatewayHeartbeatConfig();

  const failed = checks.filter((c) => c.status === "failed");
  for (const c of checks) {
    const tag = c.status === "passed" ? "[PASS]" : "[FAIL]";
    console.log(`${tag} ${c.name}: ${c.detail}`);
  }
  const passed = checks.length - failed.length;
  console.log(
    `\nSprint 18 L4 smoke: ${passed}/${checks.length} checks passed${
      liveMode ? " (live mode)" : " (in-process)"
    }.`
  );

  if (liveMode) {
    console.log(
      "\nL6 operator follow-ups:\n" +
        "  1. After RWTC redeploy, SSH in + `openclaw heartbeat --dry-run`. Confirm YAML tasks block parses cleanly.\n" +
        "  2. Wait through a 24h cycle. Count Telegram messages — should be ≤4 on a quiet day (boot kickoff + at most 3 substantive heartbeat fires).\n" +
        "  3. Watch for the HEARTBEAT_OK silent-ack pattern: heartbeats with nothing to surface should drop, not deliver.\n" +
        "  4. Outside 09:00-22:00 operator-tz, heartbeats should skip silently."
    );
  }

  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("[smoke] harness error:", err);
  process.exit(2);
});
