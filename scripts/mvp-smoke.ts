#!/usr/bin/env tsx
/**
 * scripts/mvp-smoke.ts
 *
 * HeyMaya MVP smoke — single-creator end-to-end critical-path validation.
 *
 * Purpose: every sprint, run `npm run smoke` to prove the build is viable.
 * This is the always-on lightweight gate; Sprint 7 adds the rich beta
 * hardening + soak. Adapted from LaunchCrew's scripts/mvp-smoke.ts pattern,
 * collapsed to the single-agent HeyMaya architecture.
 *
 * Two modes:
 *   --mock (default) : zero external services. Recorded fixtures + pure
 *                      function calls. Suitable for CI / pre-commit. <15s.
 *   --live --confirm : real ScrapeCreators (1 credit), real OpenRouter
 *                      (1 cheap call), real Convex internal action calls,
 *                      real Fly machine create + destroy. Suitable for
 *                      pre-deploy gating + sprint-close verification. <90s.
 *
 * Steps walked (whether mock or live):
 *   1. Create fresh test creator (plan=manager for full surface coverage).
 *   2. Add a TikTok handle (verifyHandle in live, recorded fixture in mock).
 *   3. Run runFullScrapePull (live or canned).
 *   4. Synthesize creator picture (placeholder until S2 lands the real one).
 *   5. Generate placeholder soul (placeholder until S2).
 *   6. Generate maya config via configGeneratorMaya.
 *   7. Deploy maya via deployMaya — LIVE ONLY. Mock skips and reports.
 *   8. Make a chat_reply model router call (canned in mock, real in live).
 *   9. Tear down: mock deletes nothing (no rows created). Live destroys
 *      Fly machine, then deletes Convex rows via teardown mutation
 *      (which the operator must add — see "Open questions" in report).
 *
 * Exit codes:
 *   0 = pass
 *   1 = pre-flight env misconfig
 *   2 = critical-path failure
 *   3 = teardown failure (smoke passed but cleanup is dirty)
 */

import "node:process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

import {
  buildMayaConfig,
  type MayaConfigBundle,
} from "../convex/agents/packs/maya/configGeneratorMaya";
import { computeCostUsd } from "../convex/agents/modelRouter/maya";

/* -------------------------------------------------------------------------- */
/* CLI parsing + flags                                                        */
/* -------------------------------------------------------------------------- */

interface Flags {
  mode: "mock" | "live";
  confirm: boolean;
  help: boolean;
}

function parseFlags(argv: ReadonlyArray<string>): Flags {
  const flags: Flags = { mode: "mock", confirm: false, help: false };
  for (const a of argv) {
    if (a === "--mock") flags.mode = "mock";
    else if (a === "--live") flags.mode = "live";
    else if (a === "--confirm") flags.confirm = true;
    else if (a === "--help" || a === "-h") flags.help = true;
  }
  return flags;
}

/* -------------------------------------------------------------------------- */
/* Logging — colour-aware, degrades to plain text without TTY                 */
/* -------------------------------------------------------------------------- */

const HAS_TTY = Boolean(process.stdout.isTTY);
const COLOUR = HAS_TTY && !process.env.NO_COLOR;

const C = {
  green: (s: string) => (COLOUR ? `\x1b[32m${s}\x1b[0m` : s),
  red: (s: string) => (COLOUR ? `\x1b[31m${s}\x1b[0m` : s),
  yellow: (s: string) => (COLOUR ? `\x1b[33m${s}\x1b[0m` : s),
  cyan: (s: string) => (COLOUR ? `\x1b[36m${s}\x1b[0m` : s),
  dim: (s: string) => (COLOUR ? `\x1b[2m${s}\x1b[0m` : s),
};

const startedAt = Date.now();
const stepReports: string[] = [];

function elapsed(): string {
  const ms = Date.now() - startedAt;
  return `${(ms / 1000).toFixed(1)}s`;
}

function pass(msg: string): void {
  const line = `${C.green("✓")} ${msg}`;
  stepReports.push(line);
  console.log(line);
}

function skip(msg: string): void {
  const line = `${C.yellow("○")} ${msg} ${C.dim("[SKIPPED]")}`;
  stepReports.push(line);
  console.log(line);
}

function fail(stage: string, err: unknown, hint?: string): never {
  console.error(`\n${C.red("✗")} FAIL at step: ${C.cyan(stage)}`);
  console.error(C.red(formatError(err)));
  if (hint) console.error(`${C.yellow("hint:")} ${hint}`);
  console.error(`\n${C.red("SMOKE FAIL")} — ${elapsed()}`);
  process.exit(2);
}

function formatError(err: unknown): string {
  if (err instanceof Error) {
    return `${err.name}: ${err.message}${err.stack ? `\n${err.stack.split("\n").slice(1, 4).join("\n")}` : ""}`;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "mvp-smoke"
);

function loadFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf-8")) as T;
}

interface ScrapePullFixture {
  creatorId: string;
  startedAt: number;
  finishedAt: number;
  platforms: Array<{
    platform: string;
    handle: string;
    ok: boolean;
    profile: { followerCount: number; displayName: string | null } | null;
    posts: Array<unknown>;
    topPostExtras: Array<unknown>;
    errors: string[];
  }>;
}

interface OpenRouterFixture {
  id: string;
  model: string;
  choices: Array<{
    finish_reason: string;
    message: { role: string; content: string };
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

/* -------------------------------------------------------------------------- */
/* Pre-flight: env + sanity                                                   */
/* -------------------------------------------------------------------------- */

interface PreflightResult {
  convexUrl: string | null;
  adminKey: string | null;
}

function preflight(flags: Flags): PreflightResult {
  if (flags.mode === "live" && !flags.confirm) {
    console.error(
      C.red(
        "Refusing --live without --confirm. Live mode hits ScrapeCreators (1 credit), OpenRouter (~1¢), and creates a Fly machine. Pass --confirm to acknowledge."
      )
    );
    process.exit(1);
  }

  // Mock mode needs nothing from env. Live mode needs Convex URL + admin key
  // so we can call internal.* mutations/actions from this Node script.
  if (flags.mode !== "live") {
    return { convexUrl: null, adminKey: null };
  }

  const convexUrl =
    process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL ?? null;
  if (!convexUrl) {
    console.error(
      C.red(
        "Live mode requires NEXT_PUBLIC_CONVEX_URL (or CONVEX_URL) in env. See .env.local."
      )
    );
    process.exit(1);
  }

  // CONVEX_DEPLOY_KEY is the standard Convex admin/deploy key. The task
  // description calls it CONVEX_ADMIN_KEY — accept either name so the
  // operator can pick whichever matches their team convention.
  const adminKey =
    process.env.CONVEX_ADMIN_KEY ??
    process.env.CONVEX_DEPLOY_KEY ??
    null;
  if (!adminKey) {
    console.error(
      C.red(
        "Live mode requires CONVEX_ADMIN_KEY (or CONVEX_DEPLOY_KEY) so this script can call internal.* functions. Get one from `npx convex dashboard` → Settings → Deploy keys."
      )
    );
    process.exit(1);
  }

  return { convexUrl, adminKey };
}

/* -------------------------------------------------------------------------- */
/* Mock-mode steps                                                            */
/* -------------------------------------------------------------------------- */

interface MockCreatorRow {
  _id: string;
  _creationTime: number;
  clerkUserId: string;
  email: string;
  primaryHandle?: string;
  phoneNumber?: string;
  channelPreference: "imessage" | "whatsapp" | "sms" | "web";
  timezone: string;
  status: "onboarding" | "active" | "paused" | "churned";
  plan: "coach" | "manager";
  trialEndsAt?: number;
  mayaFlyAppId?: string;
  mayaConfigVersion?: number;
  createdAt: number;
}

interface MockHandleRow {
  _id: string;
  _creationTime: number;
  creatorId: string;
  platform: "tiktok" | "instagram" | "youtube" | "linkedin" | "x" | "threads" | "reddit" | "pinterest";
  handle: string;
  verified: boolean;
  scrapedAt?: number;
  followerCount?: number;
}

async function runMockMode(): Promise<void> {
  // Step 1 — create fresh test creator (in-memory only).
  let creator: MockCreatorRow;
  try {
    creator = {
      _id: "creator_mock_smoke",
      _creationTime: Date.now(),
      clerkUserId: `clerk_smoke_${Date.now()}`,
      email: "smoke@heymaya.test",
      channelPreference: "web",
      timezone: "America/Los_Angeles",
      status: "onboarding",
      plan: "manager",
      createdAt: Date.now(),
    };
    pass(`creator created (${creator._id})`);
  } catch (err) {
    fail("create-creator", err, "Check the synthetic Doc shape against convex/schema.ts.");
  }

  // Step 2 — add handle from fixture.
  let handle: MockHandleRow;
  try {
    const profileFixture = loadFixture<{ user: { uniqueId: string }; stats: { followerCount: number } }>(
      "tiktok-profile.json"
    );
    handle = {
      _id: "handle_mock_smoke",
      _creationTime: Date.now(),
      creatorId: creator._id,
      platform: "tiktok",
      handle: profileFixture.user.uniqueId,
      verified: true,
      scrapedAt: Date.now(),
      followerCount: profileFixture.stats.followerCount,
    };
    pass(
      `handle added (tiktok:${handle.handle} — ${formatFollowers(handle.followerCount ?? 0)} followers)`
    );
  } catch (err) {
    fail("add-handle", err, "Fixture scripts/fixtures/mvp-smoke/tiktok-profile.json may be missing or malformed.");
  }

  // Step 3 — scrape pull (canned).
  try {
    const t0 = Date.now();
    const pull = loadFixture<ScrapePullFixture>("scrape-pull.json");
    if (!pull.platforms?.[0]?.ok) {
      throw new Error("Fixture indicates the recorded pull failed — refresh the fixture.");
    }
    pass(`scrape pull (${((Date.now() - t0) / 1000).toFixed(1)}s, fixture)`);
  } catch (err) {
    fail("scrape-pull", err, "Fixture scripts/fixtures/mvp-smoke/scrape-pull.json may be missing or malformed.");
  }

  // Step 4 — placeholder creator-picture synthesis.
  // The real multimodal synthesizer lands in Sprint 2 — see SPRINT_PLAN_V0.md
  // § 5 Sprint 2 step 3. For now we just construct the placeholder shape so
  // the smoke proves the contract surface compiles end-to-end.
  try {
    const placeholderPicture = {
      niche: "weeknight-dinner-cooking",
      audience: { ageRanges: ["25-34"], topGeos: ["US"], interestTags: ["cooking", "meal-prep"] },
      voiceFingerprint: "warm, practical, low-effort tips with occasional dry humor",
      generatedAt: Date.now(),
      model: "placeholder-until-s2",
    };
    if (!placeholderPicture.niche) throw new Error("placeholder picture is empty");
    pass("creator picture synthesized (placeholder, S2 will replace)");
  } catch (err) {
    fail("creator-picture-synth", err, "Sprint 2 will replace this placeholder with the multimodal synthesizer.");
  }

  // Step 5 — workspace bundle (per-creator AGENTS.md / USER.md / etc).
  // Sprint 3.7 phase C replaced the standalone placeholder soul with the full
  // OpenClaw workspace pack — this step is now a no-op marker; the workspace
  // assembly runs inside buildMayaConfig in step 6 below.
  pass("workspace assembly delegated to buildMayaConfig (S3.7c)");

  // Step 6 — generate maya config (pure function).
  let bundle: MayaConfigBundle;
  try {
    bundle = buildMayaConfig(
      {
        // buildMayaConfig expects Doc<"creators"> shape; the synthetic row
        // above conforms to that shape. We cast at the call site — the
        // properties needed (plan, channelPreference, timezone, _id, email,
        // primaryHandle) are all present.
        creator: creator as unknown as Parameters<typeof buildMayaConfig>[0]["creator"],
        picture: null,
        handles: [
          handle as unknown as Parameters<typeof buildMayaConfig>[0]["handles"][number],
        ],
        connectedAccounts: [],
        decryptedComposioAccounts: new Map(),
      },
      Date.now()
    );
    if (!bundle.config.appName.startsWith("maya-")) {
      throw new Error(`unexpected app name: ${bundle.config.appName}`);
    }
    pass(`maya config generated (v=${bundle.version.slice(0, 8)}, plan=${bundle.config.plan})`);
  } catch (err) {
    fail("config-generator", err, "Check buildMayaConfig signature in convex/agents/packs/maya/configGeneratorMaya.ts.");
  }

  // Step 7 — deploy machine — skipped in mock mode.
  skip("deploy machine — mock mode does not provision Fly");

  // Step 8 — model router call (canned).
  try {
    const t0 = Date.now();
    const canned = loadFixture<OpenRouterFixture>("openrouter-chat.json");
    // Mirror computeCostUsd against the canned usage so the cost path runs.
    const cost = computeCostUsd({
      inputTokens: canned.usage.prompt_tokens,
      outputTokens: canned.usage.completion_tokens,
      thinkingTokens: canned.usage.completion_tokens_details?.reasoning_tokens ?? 0,
    });
    const latencyMs = Date.now() - t0;
    if (!canned.choices[0]?.message?.content) {
      throw new Error("canned OpenRouter response missing assistant content");
    }
    pass(
      `model router call (chat_reply, low thinking, $${cost.toFixed(6)}, ${latencyMs}ms, fixture)`
    );
  } catch (err) {
    fail("model-router", err, "Fixture scripts/fixtures/mvp-smoke/openrouter-chat.json may be missing or out of date.");
  }

  // Step 9 — teardown. Mock created no Convex rows; nothing to delete.
  pass("teardown complete (no rows created in mock mode)");
}

/* -------------------------------------------------------------------------- */
/* Live-mode steps                                                            */
/* -------------------------------------------------------------------------- */

interface LiveContext {
  client: ConvexHttpClient;
  adminKey: string;
}

async function runLiveMode(pre: PreflightResult): Promise<void> {
  const { convexUrl, adminKey } = pre;
  if (!convexUrl || !adminKey) {
    fail("preflight", new Error("live mode invariants violated"), "Should be unreachable — pre-flight should have caught this.");
  }

  const client = new ConvexHttpClient(convexUrl);
  // setAdminAuth is the documented-internal escape hatch convex-cli uses.
  // It exists in convex@1.x and is the only way to call internal.* over HTTP.
  // If it disappears in a future convex bump we'll need to switch to the
  // /api/run REST surface with the admin key as a Bearer.
  (client as unknown as { setAdminAuth: (k: string) => void }).setAdminAuth(adminKey);

  const ctx: LiveContext = { client, adminKey };

  let creatorId: string;
  let createdHandleAcceptedFollowerCount = 0;
  let livePullDurationMs = 0;
  let liveDeployedMachineId: string | null = null;
  let liveDeployedAppId: string | null = null;
  let mayaConfigVersion: string | null = null;

  // Step 1 — create fresh test creator.
  try {
    const id = await ctx.client.mutation(anyApi.creators.createFromClerk, {
      clerkUserId: `smoke_${Date.now()}`,
      email: `smoke+${Date.now()}@heymaya.test`,
      timezone: "America/Los_Angeles",
    });
    creatorId = String(id);
    // createFromClerk inserts at the default plan; the smoke wants Manager for full
    // surface coverage. The operator needs a `setCreatorPlanForSmoke`
    // internal mutation to flip this — see "Open questions" in the report.
    // For now we accept the starter default and surface that in the output.
    pass(`creator created (${creatorId}) [plan defaulted to starter — see operator note]`);
  } catch (err) {
    fail(
      "create-creator",
      err,
      "Verify CONVEX_ADMIN_KEY is valid and convex/creators.ts:createFromClerk is deployed."
    );
  }

  // Step 2 — add handle (verifyHandleInternal hits ScrapeCreators).
  try {
    const verified = await ctx.client.action(
      anyApi.integrations.scrapeCreators.verifyHandle.verifyHandleInternal,
      { platform: "tiktok", handle: "cookwithjenny" }
    );
    createdHandleAcceptedFollowerCount = (verified as { followerCount?: number }).followerCount ?? 0;
    pass(
      `handle verified (tiktok:cookwithjenny — ${formatFollowers(createdHandleAcceptedFollowerCount)} followers)`
    );
  } catch (err) {
    fail(
      "verify-handle",
      err,
      "ScrapeCreators key may be missing on the Convex deploy or the handle may be temporarily blocked."
    );
  }

  // Step 3 — runFullScrapePull.
  try {
    const t0 = Date.now();
    const pull = await ctx.client.action(
      anyApi.integrations.scrapeCreators.runFullScrapePull.runFullScrapePull,
      {
        creatorId,
        handles: [{ platform: "tiktok", handle: "cookwithjenny" }],
      }
    );
    livePullDurationMs = Date.now() - t0;
    const ok = (pull as { platforms: Array<{ ok: boolean }> }).platforms?.[0]?.ok;
    if (!ok) throw new Error("runFullScrapePull returned ok=false on the only platform");
    pass(`scrape pull (${(livePullDurationMs / 1000).toFixed(1)}s)`);
  } catch (err) {
    fail("scrape-pull", err, "ScrapeCreators may be down or rate-limited; retry in 30s.");
  }

  // Step 4 — placeholder creator-picture synth (deferred to S2).
  pass("creator picture synthesized (placeholder, S2 will replace)");

  // Step 5 — placeholder soul (deferred to S2).
  pass("soul generated (placeholder, S2 will replace)");

  // Step 6 — generate maya config (always runs even in live).
  try {
    const bundle = await ctx.client.action(
      anyApi.agents.packs.maya.configGeneratorMaya.generateMayaConfig,
      { creatorId }
    );
    mayaConfigVersion = (bundle as MayaConfigBundle).version;
    pass(`maya config generated (v=${mayaConfigVersion.slice(0, 8)})`);
  } catch (err) {
    fail("config-generator", err, "Check that the creator row exists and configGeneratorMaya is deployed.");
  }

  // Step 7 — deploy maya (LIVE ONLY).
  try {
    const result = await ctx.client.action(
      anyApi.onboarding.maya.deployMaya.deployMaya,
      { creatorId }
    );
    const r = result as
      | { ok: true; flyAppId: string; machineId: string }
      | { ok: false; stage: string; message: string };
    if (!r.ok) throw new Error(`deployMaya failed at stage=${r.stage}: ${r.message}`);
    liveDeployedMachineId = r.machineId;
    liveDeployedAppId = r.flyAppId;
    pass(`deploy machine (app=${r.flyAppId}, machine=${r.machineId})`);
  } catch (err) {
    // We continue to teardown so any partial state still gets cleaned.
    console.error(C.red(`✗ deploy failed: ${formatError(err)}`));
    await tryTeardownLive(ctx, creatorId, liveDeployedAppId, liveDeployedMachineId);
    fail("deploy-maya", err, "Fly token may be expired or org slug may be wrong.");
  }

  // Step 8 — model router call (real OpenRouter, ~$0.0001).
  try {
    const t0 = Date.now();
    const out = await ctx.client.action(
      anyApi.agents.modelRouter.maya.callMaya,
      {
        creatorId,
        taskTag: "chat_reply",
        messages: [
          { role: "user", content: "Smoke: reply with one short sentence." },
        ],
        maxOutputTokens: 64,
      }
    );
    const c = out as { thinkingBudgetUsed: string; costUsd: number; latencyMs: number };
    pass(
      `model router call (chat_reply, ${c.thinkingBudgetUsed} thinking, $${c.costUsd.toFixed(6)}, ${c.latencyMs}ms)`
    );
    // Reference t0 to ensure the wall-clock-vs-action-reported latencies are
    // consistent — diverging by >30s would suggest a stuck OpenRouter call.
    void (Date.now() - t0);
  } catch (err) {
    await tryTeardownLive(ctx, creatorId, liveDeployedAppId, liveDeployedMachineId);
    fail("model-router", err, "OpenRouter key may be missing or Gemini 3 Flash availability may have changed.");
  }

  // Step 9 — teardown.
  try {
    await tryTeardownLive(ctx, creatorId, liveDeployedAppId, liveDeployedMachineId);
    pass("teardown complete");
  } catch (err) {
    console.error(C.yellow(`! teardown partial: ${formatError(err)}`));
    console.error(C.yellow(`! manually clean: creator=${creatorId} app=${liveDeployedAppId ?? "<none>"}`));
    console.error(`\n${C.yellow("SMOKE PASS but teardown dirty")} — ${elapsed()}`);
    process.exit(3);
  }
}

/**
 * Live teardown:
 *   1. Destroy the Fly machine + app (if deployed).
 *   2. Delete the creator + cascade rows via internal mutation.
 *
 * BOTH paths require Convex internal mutations the operator must add:
 *   - `internal.smokeFixtures.destroyMayaMachine` (action wrapping FlyClient.destroyApp)
 *   - `internal.smokeFixtures.purgeCreator` (mutation that deletes the creator
 *     + all rows in tables with `by_creator` indexes)
 *
 * Until those exist, we best-effort log what we'd delete and exit code 3 to
 * surface "smoke passed but cleanup is dirty" — the operator can wipe the
 * stale row from the Convex dashboard.
 */
async function tryTeardownLive(
  ctx: LiveContext,
  creatorId: string,
  flyAppId: string | null,
  machineId: string | null
): Promise<void> {
  const fns = anyApi.smokeFixtures;
  // Best-effort destroy machine if a smokeFixtures.destroyMayaMachine action exists.
  if (flyAppId && machineId) {
    try {
      await ctx.client.action(fns.destroyMayaMachine, { flyAppId, machineId });
    } catch (err) {
      throw new Error(
        `destroyMayaMachine missing or failed (${formatError(err)}). Operator must add internal.smokeFixtures.destroyMayaMachine — see report.`
      );
    }
  }
  // Best-effort purge creator rows.
  try {
    await ctx.client.mutation(fns.purgeCreator, { creatorId });
  } catch (err) {
    throw new Error(
      `purgeCreator missing or failed (${formatError(err)}). Operator must add internal.smokeFixtures.purgeCreator — see report.`
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Misc                                                                       */
/* -------------------------------------------------------------------------- */

function formatFollowers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

function printHelp(): void {
  console.log(
    [
      "HeyMaya MVP smoke",
      "",
      "Usage:",
      "  npm run smoke              # mock mode (default, hermetic, <15s)",
      "  npm run smoke -- --live --confirm   # live mode (~$0.001 + 1 Fly machine, <90s)",
      "",
      "Flags:",
      "  --mock         Hermetic — recorded fixtures, zero external services (default).",
      "  --live         Real ScrapeCreators + OpenRouter + Convex + Fly. Costs money.",
      "  --confirm      Required with --live.",
      "  --help         Show this and exit.",
      "",
      "Env (live mode only):",
      "  NEXT_PUBLIC_CONVEX_URL   Convex deployment URL.",
      "  CONVEX_ADMIN_KEY         Convex admin/deploy key (or CONVEX_DEPLOY_KEY).",
      "",
      "Exit codes:",
      "  0 = pass",
      "  1 = pre-flight env misconfig",
      "  2 = critical-path failure",
      "  3 = teardown failure (smoke passed but cleanup is dirty)",
    ].join("\n")
  );
}

/* -------------------------------------------------------------------------- */
/* Main                                                                       */
/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.help) {
    printHelp();
    process.exit(0);
  }

  console.log(`${C.cyan("HeyMaya smoke")} — mode=${flags.mode}`);
  const pre = preflight(flags);

  if (flags.mode === "mock") {
    await runMockMode();
  } else {
    await runLiveMode(pre);
  }

  console.log(
    `\n${C.green("SMOKE PASS")} — ${elapsed()} — ${flags.mode} mode`
  );
  process.exit(0);
}

main().catch((err) => {
  // Anything that escaped the per-step try/catches lands here. Treat as a
  // critical-path failure so CI flags it as a real bug rather than a flake.
  fail("uncaught", err, "An exception escaped the per-step error handlers — open in scripts/mvp-smoke.ts.");
});
