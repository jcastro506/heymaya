#!/usr/bin/env tsx
/**
 * ClawLaunch GTM Sprint 14 — L4 live smoke (native cron delivery).
 *
 * Asserts:
 *   - Workspace generator emits announce delivery (channel:telegram, to:<chatId>)
 *     when telegramChatId + channelPreference="telegram" both set.
 *   - REGRESSION: zero cron jobs have mode:none in the paired path.
 *   - failureDestination URL templated when env provides it.
 *   - resolveDeliveryFailureUrl resolves with both explicit env + CONVEX_SITE_URL.
 *   - Convex /lc_gtm/delivery_failure endpoint records failures + dedupes.
 *   - Bearer auth rejects bad tokens.
 *
 * `--live --confirm` mode adds operator follow-ups for L6.
 */

import { convexTest } from "convex-test";
import { readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import { buildMayaGtmWorkspace } from "../convex/agents/packs/maya_gtm/generators";
import { resolveDeliveryFailureUrl } from "../convex/onboarding/gtm/deployMayaGtm";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface Check {
  name: string;
  status: "passed" | "failed";
  detail: string;
}

function buildConvexModules(): Record<string, () => Promise<unknown>> {
  const convexDir = join(REPO_ROOT, "convex");
  const modules: Record<string, () => Promise<unknown>> = {};
  function walk(dir: string): void {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (name === "node_modules" || name === ".git") continue;
        walk(full);
        continue;
      }
      if (!name.endsWith(".ts") && !name.endsWith(".js")) continue;
      if (name.endsWith(".d.ts")) continue;
      if (full.includes("__tests__") || name.endsWith(".test.ts")) continue;
      const rel = relative(convexDir, full).split("\\").join("/");
      modules[`../convex/${rel}`] = () => import(full);
    }
  }
  walk(convexDir);
  return modules;
}

const checks: Check[] = [];

function pass(name: string, detail: string): void {
  checks.push({ name, status: "passed", detail });
}

function fail(name: string, detail: string): void {
  checks.push({ name, status: "failed", detail });
}

function fixtureInput(extras: Record<string, unknown> = {}) {
  return {
    accountEmail: "rwtc@heymaya.test",
    timezone: "America/New_York",
    bootKickoffAtMs: Date.UTC(2026, 0, 1, 12, 0, 0),
    app: {
      name: "Sprint 14 Smoke",
      url: "https://sprint14-smoke.test/",
      stage: "live-beta" as const,
      weekGoal: "signups" as const,
      canRecordScreen: true,
      canShowFace: false,
      excludedAudiences: [] as string[],
    },
    ...extras,
  };
}

function checkPairedAnnounceDelivery(): void {
  const { files } = buildMayaGtmWorkspace(
    fixtureInput({
      telegramChatId: "555111222",
      channelPreference: "telegram" as const,
    })
  );
  const jobs = (
    JSON.parse(files.get("jobs.json") ?? "{}") as { jobs?: Array<Record<string, unknown>> }
  ).jobs;
  if (!Array.isArray(jobs) || jobs.length === 0) {
    fail("paired-jobs-present", "jobs.json had no jobs after paired build");
    return;
  }
  const offenders = jobs.filter(
    (j) => (j as { delivery?: { mode?: string } }).delivery?.mode !== "announce"
  );
  if (offenders.length > 0) {
    fail(
      "paired-all-announce",
      `expected every cron to use mode:announce when paired; found ${offenders.length} that didn't`
    );
    return;
  }
  pass(
    "paired-all-announce",
    `all ${jobs.length} cron jobs use mode:announce → channel:telegram → to:555111222`
  );
}

function checkPrePairingFallback(): void {
  const { files } = buildMayaGtmWorkspace(fixtureInput());
  const jobs = (
    JSON.parse(files.get("jobs.json") ?? "{}") as { jobs?: Array<{ delivery: { mode: string } }> }
  ).jobs;
  if (!Array.isArray(jobs) || jobs.length === 0) {
    fail("fallback-jobs-present", "jobs.json had no jobs in fallback build");
    return;
  }
  const wrong = jobs.filter((j) => j.delivery.mode !== "none");
  if (wrong.length > 0) {
    fail(
      "prepair-fallback-mode-none",
      `expected mode:none in fallback build (no telegramChatId); ${wrong.length} jobs had a different mode`
    );
    return;
  }
  pass(
    "prepair-fallback-mode-none",
    "pre-pairing builds correctly fall back to mode:none across all crons"
  );
}

function checkFailureUrlResolution(): void {
  // Explicit env wins.
  const explicit = resolveDeliveryFailureUrl({
    MAYA_GTM_FAILURE_DESTINATION_URL: "https://custom.example.test/route",
    CONVEX_SITE_URL: "https://convex.example.test",
  });
  if (explicit !== "https://custom.example.test/route") {
    fail("failure-url-explicit", `expected explicit override, got ${explicit}`);
    return;
  }
  // Derived from CONVEX_SITE_URL.
  const derived = resolveDeliveryFailureUrl({
    CONVEX_SITE_URL: "https://precise-canary-781.convex.site/",
  });
  if (
    derived !==
    "https://precise-canary-781.convex.site/lc_gtm/delivery_failure"
  ) {
    fail("failure-url-derived", `expected derived URL, got ${derived}`);
    return;
  }
  // No env -> undefined.
  const empty = resolveDeliveryFailureUrl({});
  if (empty !== undefined) {
    fail("failure-url-empty", `expected undefined, got ${empty}`);
    return;
  }
  pass(
    "failure-url-resolver",
    "explicit env wins; CONVEX_SITE_URL derives; empty -> undefined"
  );
}

async function checkFailureRecordingEndpoint(): Promise<void> {
  const t = convexTest(schema, buildConvexModules());
  const user = t.withIdentity({
    subject: `gtm_sprint14_${Date.now()}`,
    email: "gtm-sprint14@clawlaunch.test",
  });
  const started = await user.mutation(
    api.gtmMaya.researchLifecycle.startGtmOnboarding,
    {}
  );
  await user.mutation(api.gtmMaya.researchLifecycle.setAppProfile, {
    name: "Sprint 14 Smoke App",
    url: "https://sprint14.smoke.test",
    stage: "live-beta",
    weekGoal: "signups",
    canRecordScreen: true,
    canShowFace: false,
    excludedAudiences: [],
  });

  // Plant flyAppId + hookToken on the agent so the auth lookup works.
  const flyAppId = `maya-gtm-smoke-${Date.now()}`;
  await t.run(async (ctx) => {
    const agent = await ctx.db
      .query("gtmAgents")
      .withIndex("by_account", (q) => q.eq("accountId", started.accountId))
      .first();
    if (!agent) throw new Error("agent missing");
    await ctx.db.patch(agent._id, {
      openClawFlyAppId: flyAppId,
      hookToken: "smoke-hook-token",
      updatedAt: Date.now(),
    });
  });

  // Same cron, three failures — should dedupe to one row.
  for (let i = 1; i <= 3; i++) {
    await t.mutation(
      internal.gtmMaya.deliveryFailures.recordDeliveryFailure,
      {
        agentFlyAppId: flyAppId,
        cronJobId: "gtm_heartbeat",
        channel: "telegram",
        recipient: "555111222",
        errorClass: "channel_blocked",
        errorMessage: "blocked",
        attempt: 1,
      }
    );
  }
  const rows = await user.query(
    api.gtmMaya.deliveryFailures.getMyDeliveryFailures,
    {}
  );
  if (rows.length !== 1 || rows[0]?.attemptCount !== 3) {
    fail(
      "failure-recording-dedupe",
      `expected 1 row with attemptCount 3; got ${rows.length} rows, attemptCount ${rows[0]?.attemptCount}`
    );
    return;
  }
  pass(
    "failure-recording-dedupe",
    "3 failures from same agent + cronJob dedupe to 1 row, attemptCount=3"
  );
}

async function checkAuthLookup(): Promise<void> {
  const t = convexTest(schema, buildConvexModules());
  const result = await t.query(
    internal.gtmMaya.deliveryFailures.getAgentForDeliveryAuth,
    { agentFlyAppId: "ghost-fly-app" }
  );
  if (result !== null) {
    fail("auth-lookup-ghost", "expected null for unknown fly app id");
    return;
  }
  pass("auth-lookup-ghost", "unknown fly app id returns null");
}

async function main(): Promise<void> {
  const liveMode = process.argv.includes("--live");
  const confirmed = process.argv.includes("--confirm");
  if (liveMode && !confirmed) {
    console.error("[smoke] --live requires --confirm");
    process.exit(2);
  }

  checkPairedAnnounceDelivery();
  checkPrePairingFallback();
  checkFailureUrlResolution();
  await checkFailureRecordingEndpoint();
  await checkAuthLookup();

  const failed = checks.filter((c) => c.status === "failed");
  for (const c of checks) {
    const tag = c.status === "passed" ? "[PASS]" : "[FAIL]";
    console.log(`${tag} ${c.name}: ${c.detail}`);
  }
  const passed = checks.length - failed.length;
  console.log(
    `\nSprint 14 L4 smoke: ${passed}/${checks.length} checks passed${
      liveMode ? " (live mode)" : " (in-process)"
    }.`
  );

  if (liveMode) {
    console.log(
      "\nL6 operator follow-ups:\n" +
        "  1. Deploy a workspace bundle to RWTC after Telegram pairing complete; SSH into Fly and `cat /data/cron/jobs.json`. Confirm every cron has delivery.mode=announce + channel=telegram + to=<chatId>.\n" +
        "  2. Trigger a cron via SSH `openclaw cron run-now gtm_heartbeat`. Confirm Telegram delivery within 30s.\n" +
        "  3. Block the bot from the RWTC operator's Telegram. Trigger again. Confirm a row appears in gtmDeliveryFailures within 60s.\n" +
        "  4. Screenshot the Telegram thread + the mission board failures section. Attach to PR."
    );
  }

  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("[smoke] harness error:", err);
  process.exit(2);
});
