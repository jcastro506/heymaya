import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { modules } from "../../tests/_modules";
import { _setWebhookSecretForTests } from "../lib/webhookSecret";
import type { Id } from "../_generated/dataModel";

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

const SECRET = "account-delete-secret".repeat(2);
const NOW = Date.UTC(2026, 4, 2, 12, 0, 0);

describe("account deletion", () => {
  beforeEach(() => {
    _setWebhookSecretForTests(SECRET);
  });

  afterEach(() => {
    _setWebhookSecretForTests(null);
  });

  it("purges the creator, its GTM account-scoped rows, and the Stripe audit trail by Clerk id", async () => {
    const t = convexTest(schema, modules);
    const { creatorId, agentId } = await seedFullAccount(t);

    await expect(
      t.mutation(api.accountDeletion.purgeByClerkUserIdPublic, {
        secret: "wrong",
        clerkUserId: "user_delete",
        source: "web",
      })
    ).rejects.toThrow(/unauthorized/i);

    const result = await t.mutation(api.accountDeletion.purgeByClerkUserIdPublic, {
      secret: SECRET,
      clerkUserId: "user_delete",
      source: "web",
    });

    expect(result.deleted).toBe(true);
    // Both Fly sources are collected: the creator row's own app and the GTM
    // agent's machine. Missing either one orphans a machine that keeps
    // burning LLM spend with no owning row.
    expect(result.flyAppIds).toEqual(
      expect.arrayContaining(["maya-delete-creator", "maya-delete-openclaw"])
    );

    await t.run(async (ctx) => {
      expect(await ctx.db.get(creatorId)).toBeNull();
      expect(await ctx.db.get(agentId)).toBeNull();
      // Account-scoped cascade.
      expect(
        await ctx.db
          .query("gtmConnectionHealth")
          .withIndex("by_account", (q) => q.eq("accountId", creatorId))
          .collect()
      ).toHaveLength(0);
      // mayaMessages is the private DM transcript — the 2026-07-15 orphan bug.
      expect(
        await ctx.db
          .query("mayaMessages")
          .withIndex("by_account", (q) => q.eq("accountId", creatorId))
          .collect()
      ).toHaveLength(0);
      // Creator-scoped cascade.
      expect(
        await ctx.db
          .query("aiCallLog")
          .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
          .collect()
      ).toHaveLength(0);
      // Stripe audit rows keyed by the deleted customer.
      expect(
        await ctx.db
          .query("stripeWebhookEvents")
          .withIndex("by_customer", (q) => q.eq("customerId", "cus_creator"))
          .collect()
      ).toHaveLength(0);
    });
  });

  it("unknown Clerk id is a no-op, not an error", async () => {
    const t = convexTest(schema, modules);
    const result = await t.mutation(api.accountDeletion.purgeByClerkUserIdPublic, {
      secret: SECRET,
      clerkUserId: "user_does_not_exist",
      source: "web",
    });
    expect(result.ok).toBe(true);
    expect(result.deleted).toBe(false);
    expect(result.flyAppIds).toEqual([]);
  });
});

async function seedFullAccount(t: ReturnType<typeof convexTest>): Promise<{
  creatorId: Id<"creators">;
  agentId: Id<"gtmAgents">;
}> {
  return await t.run(async (ctx) => {
    const creatorId = await ctx.db.insert("creators", {
      clerkUserId: "user_delete",
      email: "delete@example.com",
      primaryHandle: "deleteme",
      channelPreference: "web",
      timezone: "America/New_York",
      status: "active",
      plan: "manager",
      stripeCustomerId: "cus_creator",
      mayaFlyAppId: "maya-delete-creator",
      accountType: "gtm-agent",
      createdAt: NOW,
    });
    const agentId = await ctx.db.insert("gtmAgents", {
      accountId: creatorId,
      onboardingStep: "active",
      channelPreference: "telegram",
      timezone: "America/New_York",
      openClawFlyAppId: "maya-delete-openclaw",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await ctx.db.insert("gtmConnectionHealth", {
      accountId: creatorId,
      provider: "x",
      status: "connected",
      lastCheckedAt: NOW,
      updatedAt: NOW,
    });
    await ctx.db.insert("mayaMessages", {
      accountId: creatorId,
      agentId,
      role: "maya",
      body: "private transcript row",
      channel: "telegram",
      turnId: "turn_delete_1",
      ts: NOW,
    });
    await ctx.db.insert("aiCallLog", {
      creatorId,
      taskTag: "test",
      model: "test-model",
      thinkingBudget: "none",
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 0,
      latencyMs: 1,
      ts: NOW,
    });
    await ctx.db.insert("stripeWebhookEvents", {
      eventId: "evt_creator",
      type: "customer.updated",
      livemode: false,
      status: "processed",
      customerId: "cus_creator",
      receivedAt: NOW,
      rawPayload: {},
    });
    return { creatorId, agentId };
  });
}

describe("Zernio disconnect on account deletion (2026-07-20)", () => {
  it("purging a GTM account schedules disconnectZernioAccountsInternal with the agent's connected account ids", async () => {
    const t = convexTest(schema, modules);
    const authed = t.withIdentity({
      subject: "user_zdel",
      email: "zdel@clawlaunch.test",
    });
    const started = await authed.mutation(
      api.gtmMaya.researchLifecycle.startGtmOnboarding,
      { channelPreference: "telegram", timezone: "America/New_York" }
    );
    await t.run(async (ctx) => {
      await ctx.db.patch(started.agentId, {
        connectedAccountsJson: JSON.stringify([
          { accountId: "zern_x_1", platform: "x" },
          { accountId: "zern_li_2", platform: "linkedin" },
        ]),
      });
    });

    await t.mutation(internal.accountDeletion.purgeGtmAccountByCreatorId, {
      creatorId: started.accountId,
      source: "web",
    });

    const scheduled = await t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).filter((f) =>
        f.name.includes("disconnectZernioAccountsInternal")
      )
    );
    expect(scheduled).toHaveLength(1);
    const argsRow = scheduled[0].args[0] as { zernioAccountIds: string[] };
    expect(argsRow.zernioAccountIds.sort()).toEqual(["zern_li_2", "zern_x_1"]);
    // The creator + agent rows are gone — ids were collected BEFORE the cascade.
    await t.run(async (ctx) => {
      expect(await ctx.db.get(started.accountId)).toBeNull();
      expect(await ctx.db.get(started.agentId)).toBeNull();
    });
  });

  it("disconnectZernioAccountsInternal DELETEs each account; 404 counts as already-disconnected", async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv("ZERNIO_API_KEY", "test-key");
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: { method?: string }) => {
        const u = String(url);
        calls.push(`${init?.method} ${u}`);
        if (u.includes("zern_gone")) {
          return new Response("not found", { status: 404 });
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      })
    );
    const result = (await t.action(
      internal.accountDeletion.disconnectZernioAccountsInternal,
      { zernioAccountIds: ["zern_live", "zern_gone"], attempt: 1 },
    )) as { disconnected: number; failed: string[] };
    expect(result.disconnected).toBe(2);
    expect(result.failed).toEqual([]);
    expect(
      calls.some((c) => c.startsWith("DELETE") && c.includes("/api/v1/accounts/zern_live"))
    ).toBe(true);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("missing ZERNIO_API_KEY fails loudly without throwing (deletion never blocks)", async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv("ZERNIO_API_KEY", "");
    const result = (await t.action(
      internal.accountDeletion.disconnectZernioAccountsInternal,
      { zernioAccountIds: ["zern_x_1"], attempt: 1 },
    )) as { disconnected: number; failed: string[] };
    expect(result.disconnected).toBe(0);
    expect(result.failed).toEqual(["zern_x_1"]);
    vi.unstubAllEnvs();
  });
});
