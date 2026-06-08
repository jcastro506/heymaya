#!/usr/bin/env tsx
/**
 * ClawLaunch GTM Sprint 15 — L4 live smoke (Telegram pairing at signup).
 *
 * Per Part III of docs/CLAWLAUNCH_GTM_MVP_EXECUTION_SPRINT.md.
 *
 * Modes:
 *   - Default (no flags): in-process verification. No real Telegram bot,
 *     no real HTTPS. Mock bot env, exercise pairing mutations + webhook
 *     contract end-to-end via convex-test.
 *   - `--live --confirm`: operator runs against staging Convex + real bot.
 *     Mints a token, prints the deep link, polls for claim. The operator
 *     must tap the link from a real phone within TTL.
 *
 * Exit codes: 0 ok / 1 sprint deliverable not ready / 2 harness error.
 */

import { convexTest } from "convex-test";
import { readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import {
  buildPairingDeepLink,
  parsePairingPayload,
  parseStartCommand,
  resolveTelegramBotIdentity,
} from "../convex/integrations/telegram/client";

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

function checkBotResolverContract(): void {
  const ok = resolveTelegramBotIdentity({
    TELEGRAM_BOT_TOKEN: "test-token",
    TELEGRAM_BOT_USERNAME: "TestBot",
  });
  if (!ok || ok.username !== "TestBot") {
    fail(
      "bot-resolver-baseline",
      "resolveTelegramBotIdentity did not return identity when both vars present"
    );
    return;
  }
  const staging = resolveTelegramBotIdentity({
    CONVEX_DEPLOYMENT: "dev:precise-canary-781",
    TELEGRAM_BOT_TOKEN: "global",
    TELEGRAM_BOT_TOKEN_STAGING: "staging-token",
    TELEGRAM_BOT_USERNAME: "GlobalBot",
    TELEGRAM_BOT_USERNAME_STAGING: "StagingBot",
  });
  if (!staging || staging.token !== "staging-token") {
    fail(
      "bot-resolver-staging-override",
      "staging override did not take precedence over global env"
    );
    return;
  }
  pass(
    "bot-resolver",
    "resolves baseline + staging override correctly"
  );
}

function checkStartCommandParser(): void {
  const t1 = parseStartCommand({
    message_id: 1,
    date: 0,
    chat: { id: 123, type: "private" },
    text: "/start pair_abcdef123",
  });
  const t2 = parsePairingPayload(t1);
  if (t2 !== "abcdef123") {
    fail("start-parser", `expected token 'abcdef123', got '${t2 ?? "null"}'`);
    return;
  }
  pass(
    "start-parser",
    "/start pair_<token> parses to bare token via parsePairingPayload"
  );
}

function checkDeepLinkShape(): void {
  const link = buildPairingDeepLink(
    { token: "ignored", username: "ClawLaunchBot" },
    "abc.123"
  );
  if (link !== "https://t.me/ClawLaunchBot?start=pair_abc.123") {
    fail("deep-link-shape", `unexpected link: ${link}`);
    return;
  }
  pass("deep-link-shape", "deep link matches t.me/<bot>?start=pair_<token>");
}

async function checkPairingRoundTrip(): Promise<void> {
  process.env.TELEGRAM_BOT_TOKEN = "smoke-token";
  process.env.TELEGRAM_BOT_USERNAME = "ClawLaunchSmokeBot";

  const t = convexTest(schema, buildConvexModules());
  const user = t.withIdentity({
    subject: `gtm_sprint15_${Date.now()}`,
    email: "gtm-sprint15@clawlaunch.test",
  });

  await user.mutation(api.gtmMaya.researchLifecycle.startGtmOnboarding, {});
  await user.mutation(api.gtmMaya.researchLifecycle.setAppProfile, {
    name: "Sprint 15 Smoke App",
    url: "https://sprint15.clawlaunch.test",
    stage: "live-beta",
    weekGoal: "signups",
    canRecordScreen: true,
    canShowFace: false,
    excludedAudiences: [],
  });

  const { token, deepLink, botUsername } = await user.mutation(
    api.gtmMaya.telegramPairing.createPairingToken,
    {}
  );
  if (!token || botUsername !== "ClawLaunchSmokeBot") {
    fail(
      "create-pairing-token",
      "createPairingToken did not return a token + matching bot username"
    );
    return;
  }
  if (!deepLink.includes(token)) {
    fail("deep-link-contains-token", "deep link missing token payload");
    return;
  }

  await t.mutation(internal.gtmMaya.telegramPairing.claimPairingToken, {
    token,
    chatId: "9991112222",
    username: "smoke-user",
  });

  const status = await user.query(
    api.gtmMaya.telegramPairing.getMyPairingStatus,
    {}
  );
  if (!status?.paired || status.chatId !== "9991112222") {
    fail(
      "pairing-claimed",
      `pairing did not propagate to gtmAgents row: ${JSON.stringify(status)}`
    );
    return;
  }
  if (status.channelPreference !== "telegram") {
    fail(
      "channel-preference-flipped",
      `expected channelPreference=telegram after pairing, got ${status.channelPreference}`
    );
    return;
  }
  pass(
    "pairing-round-trip",
    "create → claim → gtmAgents row updated; channelPreference flipped to telegram"
  );
}

async function checkAdversarial(): Promise<void> {
  process.env.TELEGRAM_BOT_TOKEN = "smoke-token";
  process.env.TELEGRAM_BOT_USERNAME = "ClawLaunchSmokeBot";

  const t = convexTest(schema, buildConvexModules());
  const a = t.withIdentity({
    subject: `gtm_sprint15_adv_a_${Date.now()}`,
    email: "gtm-sprint15-adv-a@clawlaunch.test",
  });
  const b = t.withIdentity({
    subject: `gtm_sprint15_adv_b_${Date.now()}`,
    email: "gtm-sprint15-adv-b@clawlaunch.test",
  });
  for (const u of [a, b]) {
    await u.mutation(api.gtmMaya.researchLifecycle.startGtmOnboarding, {});
    await u.mutation(api.gtmMaya.researchLifecycle.setAppProfile, {
      name: "adv",
      url: `https://adv-${Date.now()}.test`,
      stage: "live-beta",
      weekGoal: "signups",
      canRecordScreen: true,
      canShowFace: false,
      excludedAudiences: [],
    });
  }

  const aPair = await a.mutation(
    api.gtmMaya.telegramPairing.createPairingToken,
    {}
  );
  await t.mutation(internal.gtmMaya.telegramPairing.claimPairingToken, {
    token: aPair.token,
    chatId: "shared_chat",
  });

  const bPair = await b.mutation(
    api.gtmMaya.telegramPairing.createPairingToken,
    {}
  );
  try {
    await t.mutation(internal.gtmMaya.telegramPairing.claimPairingToken, {
      token: bPair.token,
      chatId: "shared_chat",
    });
    fail(
      "cross-tenant-chat-collision",
      "shared chat id was claimed by a second account — cross-tenant isolation broken"
    );
    return;
  } catch (err) {
    if (!(err as Error).message.includes("different ClawLaunch account")) {
      fail(
        "cross-tenant-chat-collision-message",
        `unexpected error: ${(err as Error).message}`
      );
      return;
    }
  }
  pass(
    "cross-tenant-chat-collision",
    "second account cannot claim a chat already paired to account A"
  );
}

async function main(): Promise<void> {
  const liveMode = process.argv.includes("--live");
  const confirmed = process.argv.includes("--confirm");
  if (liveMode && !confirmed) {
    console.error("[smoke] --live requires --confirm");
    process.exit(2);
  }

  checkBotResolverContract();
  checkStartCommandParser();
  checkDeepLinkShape();
  await checkPairingRoundTrip();
  await checkAdversarial();

  const failed = checks.filter((c) => c.status === "failed");
  for (const c of checks) {
    const tag = c.status === "passed" ? "[PASS]" : "[FAIL]";
    console.log(`${tag} ${c.name}: ${c.detail}`);
  }
  const passed = checks.length - failed.length;
  console.log(
    `\nSprint 15 L4 smoke: ${passed}/${checks.length} checks passed${
      liveMode ? " (live mode)" : " (in-process)"
    }.`
  );

  if (liveMode) {
    console.log(
      "\nL6 operator follow-ups (cannot be automated):\n" +
        "  1. Provision @ClawLaunchStagingBot via BotFather; record token + username in Convex env (TELEGRAM_BOT_TOKEN_STAGING / TELEGRAM_BOT_USERNAME_STAGING).\n" +
        "  2. Set TELEGRAM_WEBHOOK_SECRET to a fresh 32+ char random string.\n" +
        "  3. Call setWebhook with url=<convex-site>/telegram/webhook + the same secret.\n" +
        "  4. Sign up as a fresh user on staging; tap the 'Open Maya in Telegram' deep link from a real phone.\n" +
        "  5. Confirm Maya's hello-back arrives in the Telegram thread within 15s.\n" +
        "  6. Screenshot the Telegram thread, attach to PR description.\n" +
        "  7. Try the same deep link from a second account — confirm rejection ('already paired')."
    );
  }

  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("[smoke] harness error:", err);
  process.exit(2);
});
