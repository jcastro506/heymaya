import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";

/**
 * Fake timers so convex-test's scheduler never fires. These tests assert that
 * work was SCHEDULED (they query `_scheduled_functions`), never that it ran —
 * so letting a real timer fire it after teardown only produced
 * "Write outside of transaction" as an UNHANDLED rejection, which vitest
 * counts as a suite error and exits 1 even with every test green.
 */
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});
import {
  buildPairingDeepLink,
  parsePairingPayload,
  parseStartCommand,
  resolveTelegramBotIdentity,
} from "../../integrations/telegram/client";

const TEST_BOT_TOKEN = "0000000000:AAtest_bot_token_value";
const TEST_BOT_USERNAME = "ClawLaunchStagingBot";

function configureBot() {
  process.env.TELEGRAM_BOT_TOKEN = TEST_BOT_TOKEN;
  process.env.TELEGRAM_BOT_USERNAME = TEST_BOT_USERNAME;
}

function clearBot() {
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_BOT_USERNAME;
  delete process.env.TELEGRAM_BOT_TOKEN_STAGING;
  delete process.env.TELEGRAM_BOT_TOKEN_PRODUCTION;
  delete process.env.TELEGRAM_BOT_USERNAME_STAGING;
  delete process.env.TELEGRAM_BOT_USERNAME_PRODUCTION;
}

async function provisionGtmAgent(
  t: ReturnType<typeof convexTest>,
  subject: string
) {
  const authed = t.withIdentity({
    subject,
    email: `${subject}@clawlaunch.test`,
  });
  const started = await authed.mutation(
    api.gtmMaya.researchLifecycle.startGtmOnboarding,
    {}
  );
  await authed.mutation(api.gtmMaya.researchLifecycle.setAppProfile, {
    name: `App for ${subject}`,
    url: `https://${subject}.test`,
    stage: "live-beta",
    weekGoal: "signups",
    canRecordScreen: true,
    canShowFace: false,
    excludedAudiences: [],
  });
  return { authed, accountId: started.accountId };
}

describe("Telegram client — pure helpers", () => {
  it("parses /start commands with payloads", () => {
    expect(
      parseStartCommand({
        message_id: 1,
        date: 0,
        chat: { id: 123, type: "private" },
        text: "/start pair_abc123",
      })
    ).toBe("pair_abc123");
    expect(
      parseStartCommand({
        message_id: 1,
        date: 0,
        chat: { id: 123, type: "private" },
        text: "/start  pair_xyz",
      })
    ).toBe("pair_xyz");
    expect(
      parseStartCommand({
        message_id: 1,
        date: 0,
        chat: { id: 123, type: "private" },
        text: "/start",
      })
    ).toBeNull();
    expect(parseStartCommand(undefined)).toBeNull();
  });

  it("extracts pairing token from start payload", () => {
    expect(parsePairingPayload("pair_abc123")).toBe("abc123");
    expect(parsePairingPayload("pair_")).toBeNull();
    expect(parsePairingPayload("hello")).toBeNull();
    expect(parsePairingPayload(null)).toBeNull();
  });

  it("builds canonical pairing deep links", () => {
    const link = buildPairingDeepLink(
      { token: TEST_BOT_TOKEN, username: TEST_BOT_USERNAME },
      "abc.123"
    );
    expect(link).toBe(
      "https://t.me/ClawLaunchStagingBot?start=pair_abc.123"
    );
  });

  it("resolves bot identity per deployment environment", () => {
    expect(
      resolveTelegramBotIdentity({
        TELEGRAM_BOT_TOKEN: "global-token",
        TELEGRAM_BOT_USERNAME: "GlobalBot",
      })
    ).toEqual({ token: "global-token", username: "GlobalBot" });
    expect(
      resolveTelegramBotIdentity({
        CONVEX_DEPLOYMENT: "dev:precise-canary-781",
        TELEGRAM_BOT_TOKEN: "global-token",
        TELEGRAM_BOT_TOKEN_STAGING: "staging-token",
        TELEGRAM_BOT_USERNAME: "GlobalBot",
        TELEGRAM_BOT_USERNAME_STAGING: "StagingBot",
      })
    ).toEqual({ token: "staging-token", username: "StagingBot" });
    expect(resolveTelegramBotIdentity({})).toBeNull();
    expect(
      resolveTelegramBotIdentity({ TELEGRAM_BOT_TOKEN: "only-token" })
    ).toBeNull();
  });
});

describe("Telegram pairing — Convex integration", () => {
  beforeEach(() => {
    configureBot();
  });

  afterEach(() => {
    clearBot();
  });

  it("createPairingToken returns a deep link and persists a row", async () => {
    const t = convexTest(schema, modules);
    const { authed, accountId } = await provisionGtmAgent(t, "u_tg_create");
    const { token, deepLink, expiresAt, botUsername } = await authed.mutation(
      api.gtmMaya.telegramPairing.createPairingToken,
      {}
    );
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(deepLink).toBe(
      `https://t.me/${TEST_BOT_USERNAME}?start=pair_${encodeURIComponent(token)}`
    );
    expect(botUsername).toBe(TEST_BOT_USERNAME);
    expect(expiresAt).toBeGreaterThan(Date.now());

    // Row exists, unclaimed, account-scoped.
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("gtmTelegramPairingTokens")
        .withIndex("by_account", (q) => q.eq("accountId", accountId))
        .collect()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.claimedAt).toBeUndefined();
  });

  it("createPairingToken is idempotent within TTL — returns same token on retry", async () => {
    const t = convexTest(schema, modules);
    const { authed } = await provisionGtmAgent(t, "u_tg_idempotent");
    const first = await authed.mutation(
      api.gtmMaya.telegramPairing.createPairingToken,
      {}
    );
    const second = await authed.mutation(
      api.gtmMaya.telegramPairing.createPairingToken,
      {}
    );
    expect(second.token).toBe(first.token);
  });

  it("claimPairingToken atomically binds chat to agent", async () => {
    const t = convexTest(schema, modules);
    const { authed, accountId } = await provisionGtmAgent(t, "u_tg_claim");
    const { token } = await authed.mutation(
      api.gtmMaya.telegramPairing.createPairingToken,
      {}
    );

    const result = await t.mutation(
      internal.gtmMaya.telegramPairing.claimPairingToken,
      { token, chatId: "555111222", username: "rwtcoperator" }
    );
    expect(result.ok).toBe(true);
    expect(result.accountId).toBe(accountId);

    const status = await authed.query(
      api.gtmMaya.telegramPairing.getMyPairingStatus,
      {}
    );
    expect(status?.paired).toBe(true);
    expect(status?.chatId).toBe("555111222");
    expect(status?.username).toBe("rwtcoperator");
    expect(status?.channelPreference).toBe("telegram");
  });

  it("rejects claim with expired token", async () => {
    const t = convexTest(schema, modules);
    const { authed } = await provisionGtmAgent(t, "u_tg_expired");
    const { token } = await authed.mutation(
      api.gtmMaya.telegramPairing.createPairingToken,
      {}
    );

    // Fast-forward expiry by patching the row.
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("gtmTelegramPairingTokens")
        .withIndex("by_token", (q) => q.eq("token", token))
        .first();
      if (!row) throw new Error("token row missing");
      await ctx.db.patch(row._id, { expiresAt: Date.now() - 1000 });
    });

    await expect(
      t.mutation(internal.gtmMaya.telegramPairing.claimPairingToken, {
        token,
        chatId: "555111222",
      })
    ).rejects.toThrow("pairing token expired");
  });

  it("double-claim by the same chat is idempotent", async () => {
    const t = convexTest(schema, modules);
    const { authed } = await provisionGtmAgent(t, "u_tg_double_same");
    const { token } = await authed.mutation(
      api.gtmMaya.telegramPairing.createPairingToken,
      {}
    );
    const first = await t.mutation(
      internal.gtmMaya.telegramPairing.claimPairingToken,
      { token, chatId: "555111222" }
    );
    const second = await t.mutation(
      internal.gtmMaya.telegramPairing.claimPairingToken,
      { token, chatId: "555111222" }
    );
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.agentId).toBe(first.agentId);
  });

  it("rejects double-claim by a different chat", async () => {
    const t = convexTest(schema, modules);
    const { authed } = await provisionGtmAgent(t, "u_tg_double_diff");
    const { token } = await authed.mutation(
      api.gtmMaya.telegramPairing.createPairingToken,
      {}
    );
    await t.mutation(internal.gtmMaya.telegramPairing.claimPairingToken, {
      token,
      chatId: "first_chat",
    });
    await expect(
      t.mutation(internal.gtmMaya.telegramPairing.claimPairingToken, {
        token,
        chatId: "second_chat",
      })
    ).rejects.toThrow("already claimed by a different chat");
  });

  it("rejects claiming a chat that's already paired to a different account", async () => {
    const t = convexTest(schema, modules);
    const a = await provisionGtmAgent(t, "u_tg_collision_a");
    const b = await provisionGtmAgent(t, "u_tg_collision_b");

    const aPair = await a.authed.mutation(
      api.gtmMaya.telegramPairing.createPairingToken,
      {}
    );
    await t.mutation(internal.gtmMaya.telegramPairing.claimPairingToken, {
      token: aPair.token,
      chatId: "shared_chat_id",
    });

    const bPair = await b.authed.mutation(
      api.gtmMaya.telegramPairing.createPairingToken,
      {}
    );
    await expect(
      t.mutation(internal.gtmMaya.telegramPairing.claimPairingToken, {
        token: bPair.token,
        chatId: "shared_chat_id",
      })
    ).rejects.toThrow("already paired to a different ClawLaunch account");
  });

  it("cross-tenant isolation — getMyPairingStatus only returns the caller's pairing", async () => {
    const t = convexTest(schema, modules);
    const a = await provisionGtmAgent(t, "u_tg_iso_a");
    const b = await provisionGtmAgent(t, "u_tg_iso_b");

    const aPair = await a.authed.mutation(
      api.gtmMaya.telegramPairing.createPairingToken,
      {}
    );
    await t.mutation(internal.gtmMaya.telegramPairing.claimPairingToken, {
      token: aPair.token,
      chatId: "a_chat",
    });

    const aStatus = await a.authed.query(
      api.gtmMaya.telegramPairing.getMyPairingStatus,
      {}
    );
    const bStatus = await b.authed.query(
      api.gtmMaya.telegramPairing.getMyPairingStatus,
      {}
    );
    expect(aStatus?.paired).toBe(true);
    expect(aStatus?.chatId).toBe("a_chat");
    expect(bStatus?.paired).toBe(false);
    expect(bStatus?.chatId).toBeNull();
  });

  it("createPairingToken throws when bot env is missing", async () => {
    clearBot();
    const t = convexTest(schema, modules);
    const { authed } = await provisionGtmAgent(t, "u_tg_no_bot");
    await expect(
      authed.mutation(api.gtmMaya.telegramPairing.createPairingToken, {})
    ).rejects.toThrow("Telegram bot identity not configured");
  });

  it("getMyPairingStatus returns null for unauthenticated callers", async () => {
    const t = convexTest(schema, modules);
    const status = await t.query(
      api.gtmMaya.telegramPairing.getMyPairingStatus,
      {}
    );
    expect(status).toBeNull();
  });
});
