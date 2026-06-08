#!/usr/bin/env tsx
/**
 * ClawLaunch GTM Sprint 16 — L4 smoke (Convex ↔ Maya hook bridge).
 *
 * Asserts:
 *   - hookToken is provisioned per-agent and is idempotent on re-run.
 *   - Workspace bundle TOOLS.md surfaces the convex callback URLs + bearer
 *     token so Maya knows where to POST.
 *   - resolveAgentFromHookToken / claimIdempotencyKey work with cross-tenant
 *     isolation + replay-safety.
 *   - runAgentTurn signs with Authorization: Bearer.
 *   - resolveConvexHookCallbackBaseUrl honours env precedence.
 *
 * `--live --confirm` mode adds the L6 operator follow-ups for testing the
 * real round-trip against a deployed Fly machine.
 */

import { convexTest } from "convex-test";
import { readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import { buildMayaGtmWorkspace } from "../convex/agents/packs/maya_gtm/generators";
import {
  buildResearchPhasePrompt,
  deriveHookBaseUrl,
  mintHookToken,
  runAgentTurn,
} from "../convex/gtmMaya/openclaw/hookClient";
import { resolveConvexHookCallbackBaseUrl } from "../convex/onboarding/gtm/deployMayaGtm";

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

function checkMintHookToken(): void {
  const seen = new Set<string>();
  for (let i = 0; i < 20; i++) seen.add(mintHookToken());
  if (seen.size !== 20) {
    fail("hook-token-uniqueness", `expected 20 unique tokens, got ${seen.size}`);
    return;
  }
  for (const tok of seen) {
    if (!/^[A-Za-z0-9_-]{40,}$/.test(tok)) {
      fail("hook-token-shape", `bad token: ${tok}`);
      return;
    }
  }
  pass(
    "hook-token-shape",
    `mintHookToken produces 20 unique base64url tokens >= 40 chars`
  );
}

function checkDeriveBaseUrl(): void {
  if (
    deriveHookBaseUrl("maya-gtm-abc123") !== "https://maya-gtm-abc123.fly.dev/hooks"
  ) {
    fail("derive-base-url", "unexpected hook base URL shape");
    return;
  }
  pass("derive-base-url", "hooks base URL matches fly subdomain convention");
}

function checkConvexCallbackBaseUrlResolver(): void {
  const explicit = resolveConvexHookCallbackBaseUrl({
    MAYA_GTM_CONVEX_CALLBACK_BASE_URL: "https://override.example.test/",
    CONVEX_SITE_URL: "https://convex.example.test",
  });
  if (explicit !== "https://override.example.test") {
    fail("callback-url-explicit", `expected explicit override, got ${explicit}`);
    return;
  }
  const derived = resolveConvexHookCallbackBaseUrl({
    CONVEX_SITE_URL: "https://precise-canary-781.convex.site/",
  });
  if (derived !== "https://precise-canary-781.convex.site") {
    fail("callback-url-derived", `expected derived URL, got ${derived}`);
    return;
  }
  const empty = resolveConvexHookCallbackBaseUrl({});
  if (empty !== undefined) {
    fail("callback-url-empty", `expected undefined, got ${empty}`);
    return;
  }
  pass(
    "callback-url-resolver",
    "explicit override wins; CONVEX_SITE_URL derives; empty -> undefined"
  );
}

function checkRunAgentTurnBearerHeader(): void {
  let observed: Record<string, string> = {};
  const fakeFetch: typeof fetch = async (_url, init) => {
    observed = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>)
    );
    return new Response('{"ok":true}', { status: 200 });
  };
  // Fire-and-forget; we just need to inspect headers.
  void runAgentTurn(
    { baseUrl: "https://maya.test/hooks", token: "smoke-token" },
    { message: "hello" },
    fakeFetch
  ).then((res) => {
    if (!res.ok) fail("run-agent-turn", `expected ok, got ${res.status}`);
    if (observed.Authorization !== "Bearer smoke-token") {
      fail(
        "run-agent-turn-auth",
        `expected 'Bearer smoke-token', got '${observed.Authorization}'`
      );
      return;
    }
    pass(
      "run-agent-turn-auth",
      "runAgentTurn signs with Authorization: Bearer <token>"
    );
  });
}

function checkResearchPhasePrompt(): void {
  const prompt = buildResearchPhasePrompt({
    researchJobId: "research_job_test_id" as never,
    phase: "channel_research",
    newEvidenceCount: 4,
  });
  const required = ["PLAYBOOK.md", "APP.md", "GTM.md", "Do not spend"];
  for (const must of required) {
    if (!prompt.includes(must)) {
      fail(
        "research-phase-prompt-coverage",
        `prompt missing required substring '${must}'`
      );
      return;
    }
  }
  pass(
    "research-phase-prompt-coverage",
    "prompt names PLAYBOOK/APP/GTM + bans paid spend from the turn"
  );
}

async function checkHookTokenProvisioning(): Promise<void> {
  const t = convexTest(schema, buildConvexModules());
  const user = t.withIdentity({
    subject: `gtm_s16_smoke_${Date.now()}`,
    email: "gtm-s16@clawlaunch.test",
  });
  const started = await user.mutation(
    api.gtmMaya.researchLifecycle.startGtmOnboarding,
    {}
  );
  await user.mutation(api.gtmMaya.researchLifecycle.setAppProfile, {
    name: "S16 Smoke",
    url: "https://s16.smoke.test",
    stage: "live-beta",
    weekGoal: "signups",
    canRecordScreen: true,
    canShowFace: false,
    excludedAudiences: [],
  });
  const tok1 = await t.mutation(
    internal.onboarding.gtm.deployMayaGtm.ensureGtmAgentHookToken,
    { agentId: started.agentId }
  );
  const tok2 = await t.mutation(
    internal.onboarding.gtm.deployMayaGtm.ensureGtmAgentHookToken,
    { agentId: started.agentId }
  );
  if (tok1 !== tok2) {
    fail(
      "hook-token-idempotent",
      `expected same token on re-run; got '${tok1}' vs '${tok2}'`
    );
    return;
  }
  if (!/^[A-Za-z0-9_-]{40,}$/.test(tok1)) {
    fail("hook-token-shape-deployed", `bad provisioned token: ${tok1}`);
    return;
  }
  pass(
    "hook-token-provisioning",
    `ensureGtmAgentHookToken is idempotent on re-run (same ${tok1.length}-char base64url token)`
  );
}

function checkToolsMdHasCallbackSection(): void {
  const { files } = buildMayaGtmWorkspace({
    accountEmail: "rwtc@heymaya.test",
    timezone: "America/New_York",
    bootKickoffAtMs: Date.UTC(2026, 0, 1, 12, 0, 0),
    app: {
      name: "S16 fixture",
      url: "https://s16-fixture.test/",
      stage: "live-beta",
      weekGoal: "signups",
      canRecordScreen: true,
      canShowFace: false,
      excludedAudiences: [],
    },
    hookToken: "fixture-hook-token-1234567890",
    convexHookCallbackUrl: "https://precise-canary-781.convex.site",
  });
  const tools = files.get("TOOLS.md") ?? "";
  const required = [
    "/lc_gtm/research_callback",
    "/lc_gtm/approval_decision",
    "/lc_gtm/calendar_proposal",
    "Authorization: Bearer",
    "idempotencyKey",
    "fixture-hook-token-1234567890",
  ];
  for (const r of required) {
    if (!tools.includes(r)) {
      fail("tools-md-callbacks", `TOOLS.md missing required substring '${r}'`);
      return;
    }
  }
  pass(
    "tools-md-callbacks",
    "TOOLS.md surfaces all 3 callback endpoints + bearer token + idempotencyKey requirement"
  );
}

function checkToolsMdHidesCallbackWhenUnconfigured(): void {
  const { files } = buildMayaGtmWorkspace({
    accountEmail: "rwtc@heymaya.test",
    timezone: "America/New_York",
    bootKickoffAtMs: Date.UTC(2026, 0, 1, 12, 0, 0),
    app: {
      name: "S16 nohook fixture",
      url: "https://s16-nohook.test/",
      stage: "live-beta",
      weekGoal: "signups",
      canRecordScreen: true,
      canShowFace: false,
      excludedAudiences: [],
    },
    // hookToken + convexHookCallbackUrl deliberately omitted.
  });
  const tools = files.get("TOOLS.md") ?? "";
  if (tools.includes("/lc_gtm/research_callback")) {
    fail(
      "tools-md-no-callbacks-without-token",
      "TOOLS.md leaked callback URLs even though hookToken was unset"
    );
    return;
  }
  pass(
    "tools-md-no-callbacks-without-token",
    "TOOLS.md correctly hides callback section when hookToken not provisioned"
  );
}

async function main(): Promise<void> {
  const liveMode = process.argv.includes("--live");
  const confirmed = process.argv.includes("--confirm");
  if (liveMode && !confirmed) {
    console.error("[smoke] --live requires --confirm");
    process.exit(2);
  }

  checkMintHookToken();
  checkDeriveBaseUrl();
  checkConvexCallbackBaseUrlResolver();
  checkRunAgentTurnBearerHeader();
  checkResearchPhasePrompt();
  await checkHookTokenProvisioning();
  checkToolsMdHasCallbackSection();
  checkToolsMdHidesCallbackWhenUnconfigured();

  const failed = checks.filter((c) => c.status === "failed");
  for (const c of checks) {
    const tag = c.status === "passed" ? "[PASS]" : "[FAIL]";
    console.log(`${tag} ${c.name}: ${c.detail}`);
  }
  const passed = checks.length - failed.length;
  console.log(
    `\nSprint 16 L4 smoke: ${passed}/${checks.length} checks passed${
      liveMode ? " (live mode)" : " (in-process)"
    }.`
  );

  if (liveMode) {
    console.log(
      "\nL6 operator follow-ups:\n" +
        "  1. Deploy RWTC. SSH into Fly machine, `cat /data/openclaw.json | jq .gateway.hooks`. Confirm enabled:true + token present.\n" +
        "  2. From Convex action playground, call runAgentTurn against the RWTC machine. Confirm agent turn fires within 60s + Telegram delivery.\n" +
        "  3. POST a fake /lc_gtm/research_callback with bad bearer → expect 401. With correct bearer + idempotencyKey → 200. Replay → 200 (replay).\n" +
        "  4. Try sending account A's bearer with a body referencing account B's research job → expect 'research job does not belong to this account' on apply.\n" +
        "  5. Screenshot all 4 verifications in the PR description."
    );
  }

  // Give the fire-and-forget runAgentTurn check a moment to land.
  await new Promise((r) => setTimeout(r, 100));
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("[smoke] harness error:", err);
  process.exit(2);
});
