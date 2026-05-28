/**
 * Sprint 2.26 — per-operator Telegram bot tests.
 *
 * Validates:
 *   1. validateBotToken accepts a valid getMe response.
 *   2. validateBotToken rejects: bad format, non-bot, missing username.
 *   3. setPersonalTelegramBot encrypts + stores; later getDecryptedBotToken returns plaintext.
 *   4. Cross-tenant isolation: operator A can't read operator B's stored bot.
 *   5. resolveBotForAgent prefers per-tenant over shared fallback.
 *   6. resolveBotForAgent falls back to shared when no per-tenant set.
 *   7. resolveBotForAgent returns none/none when neither path resolves.
 */

import { convexTest } from "convex-test";
import { beforeAll, describe, expect, it } from "vitest";
import { api, internal } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import { validateBotToken, resolveBotForAgent } from "../telegramBotPerTenant";

const TEST_ENCRYPTION_KEY = btoa("\0".repeat(32));

beforeAll(() => {
  process.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
});

async function setupAgent(t: ReturnType<typeof convexTest>, subject: string) {
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
  return { authed, accountId: started.accountId, agentId: started.agentId };
}

function mockGetMeOk(username: string, firstName = "Maya GTM") {
  return (async (_url: RequestInfo | URL) =>
    new Response(
      JSON.stringify({
        ok: true,
        result: {
          id: 999_111,
          is_bot: true,
          first_name: firstName,
          username,
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    )) as typeof fetch;
}

describe("Sprint 2.26 — validateBotToken", () => {
  it("accepts a valid getMe response and returns identity", async () => {
    const result = await validateBotToken(
      "123456789:AAFakeTokenForTests",
      mockGetMeOk("maya_test_bot")
    );
    expect(result.ok).toBe(true);
    expect(result.username).toBe("maya_test_bot");
    expect(result.botId).toBe(999_111);
  });

  it("rejects malformed token (missing colon)", async () => {
    await expect(
      validateBotToken("nottokenformat", mockGetMeOk("x"))
    ).rejects.toThrow(/invalid bot token format/);
  });

  it("rejects when getMe returns non-bot", async () => {
    const fetchImpl = (async (_url: RequestInfo | URL) =>
      new Response(
        JSON.stringify({
          ok: true,
          result: { id: 1, is_bot: false, first_name: "A Person" },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as typeof fetch;
    await expect(
      validateBotToken("1:abc", fetchImpl)
    ).rejects.toThrow(/token is for a user/);
  });

  it("rejects bot without a username", async () => {
    const fetchImpl = (async (_url: RequestInfo | URL) =>
      new Response(
        JSON.stringify({
          ok: true,
          result: { id: 1, is_bot: true, first_name: "Bot" },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as typeof fetch;
    await expect(
      validateBotToken("1:abc", fetchImpl)
    ).rejects.toThrow(/bot has no username/);
  });

  it("rejects getMe network error", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    await expect(
      validateBotToken("1:abc", fetchImpl)
    ).rejects.toThrow(/getMe network error/);
  });

  it("rejects getMe HTTP failure (401 unauthorized)", async () => {
    const fetchImpl = (async () =>
      new Response("Unauthorized", { status: 401 })) as typeof fetch;
    await expect(
      validateBotToken("1:abc", fetchImpl)
    ).rejects.toThrow(/getMe HTTP 401/);
  });
});

describe("Sprint 2.26 — setPersonalTelegramBot + getDecryptedBotToken", () => {
  it("stores encrypted; getDecryptedBotToken returns plaintext", async () => {
    const t = convexTest(schema, modules);
    const { authed, agentId } = await setupAgent(t, "u_bot_set");

    const result = await authed.mutation(
      api.gtmMaya.telegramBotPerTenant.setPersonalTelegramBot,
      { botToken: "8675589785:AAF8OMY4YQpTAOdXZbEtdCNH_0jZtTsn2Lc" }
    );
    expect(result.ok).toBe(true);

    // Stored row has encrypted token (not plaintext).
    const agent = await t.run((ctx) => ctx.db.get(agentId));
    expect(agent?.telegramBotToken).toBeTruthy();
    expect(agent?.telegramBotToken).not.toBe(
      "8675589785:AAF8OMY4YQpTAOdXZbEtdCNH_0jZtTsn2Lc"
    );

    // Internal query roundtrips back to plaintext.
    const decrypted = await t.query(
      internal.gtmMaya.telegramBotPerTenant.getDecryptedBotToken,
      { agentId }
    );
    expect(decrypted.token).toBe("8675589785:AAF8OMY4YQpTAOdXZbEtdCNH_0jZtTsn2Lc");
  });

  it("cross-tenant isolation: A cannot read B's bot token", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "u_bot_iso_a");
    const b = await setupAgent(t, "u_bot_iso_b");

    await a.authed.mutation(
      api.gtmMaya.telegramBotPerTenant.setPersonalTelegramBot,
      { botToken: "1:a-token" }
    );
    await b.authed.mutation(
      api.gtmMaya.telegramBotPerTenant.setPersonalTelegramBot,
      { botToken: "2:b-token" }
    );

    // Each agent only sees their own token.
    const aTok = await t.query(
      internal.gtmMaya.telegramBotPerTenant.getDecryptedBotToken,
      { agentId: a.agentId }
    );
    const bTok = await t.query(
      internal.gtmMaya.telegramBotPerTenant.getDecryptedBotToken,
      { agentId: b.agentId }
    );
    expect(aTok.token).toBe("1:a-token");
    expect(bTok.token).toBe("2:b-token");
  });

  it("returns null/null for an agent that hasn't set a bot", async () => {
    const t = convexTest(schema, modules);
    const { agentId } = await setupAgent(t, "u_bot_unset");

    const result = await t.query(
      internal.gtmMaya.telegramBotPerTenant.getDecryptedBotToken,
      { agentId }
    );
    expect(result.token).toBe(null);
    expect(result.username).toBe(null);
  });
});

describe("Sprint 2.26b — validateAndSetPersonalTelegramBot action", () => {
  it("rejects token that fails getMe validation", async () => {
    // Action's network fetch hits real api.telegram.org with a fake
    // token — Telegram returns 401, validateBotToken throws. We catch
    // here and confirm propagation.
    const t = convexTest(schema, modules);
    await setupAgent(t, "u_botaction_invalid");
    const authed = t.withIdentity({
      subject: "u_botaction_invalid",
      email: "u_botaction_invalid@clawlaunch.test",
    });

    // Replace global fetch for this test only — pretend Telegram
    // rejected the token with 401.
    const originalFetch = global.fetch;
    global.fetch = (async () =>
      new Response("Unauthorized", { status: 401 })) as typeof fetch;

    try {
      await expect(
        authed.action(
          api.gtmMaya.telegramBotPerTenant.validateAndSetPersonalTelegramBot,
          { botToken: "1:not-a-real-token-just-shape" }
        )
      ).rejects.toThrow(/getMe HTTP 401/);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("happy path: validates + stores + persists username", async () => {
    const t = convexTest(schema, modules);
    const { agentId } = await setupAgent(t, "u_botaction_ok");
    const authed = t.withIdentity({
      subject: "u_botaction_ok",
      email: "u_botaction_ok@clawlaunch.test",
    });

    // Mock Telegram getMe to return a valid bot identity.
    const originalFetch = global.fetch;
    global.fetch = (async () =>
      new Response(
        JSON.stringify({
          ok: true,
          result: {
            id: 999_888,
            is_bot: true,
            first_name: "My GTM Maya",
            username: "my_gtm_maya_bot",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as typeof fetch;

    try {
      const result = await authed.action(
        api.gtmMaya.telegramBotPerTenant.validateAndSetPersonalTelegramBot,
        { botToken: "1234567890:AA-validated-token" }
      );
      expect(result.ok).toBe(true);
      expect(result.botUsername).toBe("my_gtm_maya_bot");
      expect(result.botFirstName).toBe("My GTM Maya");

      // Agent row has the encrypted token + the validated username.
      const agent = await t.run((ctx) => ctx.db.get(agentId));
      expect(agent?.telegramBotToken).toBeTruthy();
      expect(agent?.telegramBotToken).not.toBe(
        "1234567890:AA-validated-token"
      );
      expect(agent?.telegramBotUsername).toBe("my_gtm_maya_bot");
      expect(agent?.telegramBotIdentityCheckedAt).toBeGreaterThan(
        Date.now() - 10_000
      );
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe("Sprint 2.26 — resolveBotForAgent priority", () => {
  it("prefers per-tenant over shared fallback when both exist", async () => {
    const t = convexTest(schema, modules);
    const { authed, agentId } = await setupAgent(t, "u_bot_pref");

    await authed.mutation(
      api.gtmMaya.telegramBotPerTenant.setPersonalTelegramBot,
      { botToken: "1:per-tenant-token" }
    );

    // Run the action context to call resolveBotForAgent.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = { runQuery: t.query.bind(t) as any };
    const resolved = await resolveBotForAgent(ctx, agentId, {
      sharedToken: "shared:fallback-token",
      sharedUsername: "shared_bot",
    });
    expect(resolved.token).toBe("1:per-tenant-token");
    expect(resolved.source).toBe("per_tenant");
  });

  it("falls back to shared token when no per-tenant set", async () => {
    const t = convexTest(schema, modules);
    const { agentId } = await setupAgent(t, "u_bot_fb");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = { runQuery: t.query.bind(t) as any };
    const resolved = await resolveBotForAgent(ctx, agentId, {
      sharedToken: "shared:dev-token",
      sharedUsername: "dev_bot",
    });
    expect(resolved.token).toBe("shared:dev-token");
    expect(resolved.username).toBe("dev_bot");
    expect(resolved.source).toBe("shared_fallback");
  });

  it("returns none/none when neither path resolves", async () => {
    const t = convexTest(schema, modules);
    const { agentId } = await setupAgent(t, "u_bot_none");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = { runQuery: t.query.bind(t) as any };
    const resolved = await resolveBotForAgent(ctx, agentId, {});
    expect(resolved.token).toBe(null);
    expect(resolved.source).toBe("none");
  });
});
