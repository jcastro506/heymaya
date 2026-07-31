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

  it("purges creator, Creator Maya, business, growth, channel, and Stripe audit rows by Clerk id", async () => {
    const t = convexTest(schema, modules);
    const { creatorId, businessId } = await seedFullAccount(t);

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
    expect(result.flyAppIds).toEqual(
      expect.arrayContaining([
        "maya-delete-creator",
        "maya-delete-business",
        "maya-delete-growth",
        "maya-delete-deployment",
      ])
    );
    await t.run(async (ctx) => {
      expect(await ctx.db.get(creatorId)).toBeNull();
      expect(await ctx.db.get(businessId)).toBeNull();
      expect(
        await ctx.db
          .query("creatorMayaV0TiktokAccounts")
          .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
          .collect()
      ).toHaveLength(0);
      expect(
        await ctx.db
          .query("businessPicture")
          .withIndex("by_business", (q) => q.eq("businessId", businessId))
          .collect()
      ).toHaveLength(0);
      expect(
        await ctx.db
          .query("growthAgents")
          .withIndex("by_account", (q) => q.eq("accountId", creatorId))
          .collect()
      ).toHaveLength(0);
      expect(
        await ctx.db
          .query("stripeWebhookEvents")
          .withIndex("by_customer", (q) => q.eq("customerId", "cus_creator"))
          .collect()
      ).toHaveLength(0);
      expect(
        await ctx.db
          .query("stripeWebhookEvents")
          .withIndex("by_customer", (q) => q.eq("customerId", "cus_business"))
          .collect()
      ).toHaveLength(0);
    });
  });

  it("requires an active iMessage channel and exact confirmation phrase", async () => {
    const t = convexTest(schema, modules);
    await seedFullAccount(t);

    const request = await t.mutation(
      api.accountDeletion.requestDeletionByPhonePublic,
      {
        secret: SECRET,
        channel: "imessage",
        phoneNumber: "+15555550123",
      }
    );
    expect(request.ok).toBe(true);
    expect(request.confirmationPhrase).toBe("DELETE MAYA");

    const mismatch = await t.mutation(
      api.accountDeletion.confirmDeletionByPhonePublic,
      {
        secret: SECRET,
        channel: "imessage",
        phoneNumber: "+15555550123",
        confirmationText: "delete my account",
      }
    );
    expect(mismatch.ok).toBe(false);
    expect(mismatch.reason).toBe("confirmation-mismatch");

    const confirmed = await t.mutation(
      api.accountDeletion.confirmDeletionByPhonePublic,
      {
        secret: SECRET,
        channel: "imessage",
        phoneNumber: "+15555550123",
        confirmationText: "DELETE MAYA",
      }
    );
    expect(confirmed.ok).toBe(true);

    const after = await t.run((ctx) =>
      ctx.db
        .query("creators")
        .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", "user_delete"))
        .first()
    );
    expect(after).toBeNull();
  });
});

async function seedFullAccount(t: ReturnType<typeof convexTest>): Promise<{
  creatorId: Id<"creators">;
  businessId: Id<"businesses">;
}> {
  return await t.run(async (ctx) => {
    const creatorId = await ctx.db.insert("creators", {
      clerkUserId: "user_delete",
      email: "delete@example.com",
      primaryHandle: "deleteme",
      phoneNumber: "+15555550123",
      channelPreference: "imessage",
      timezone: "America/New_York",
      status: "active",
      plan: "manager",
      stripeCustomerId: "cus_creator",
      mayaFlyAppId: "maya-delete-creator",
      accountType: "service-business",
      createdAt: NOW,
    });
    const businessId = await ctx.db.insert("businesses", {
      accountId: creatorId,
      name: "Delete Co",
      serviceTypes: ["marketing"],
      planTier: "pro",
      stripeCustomerId: "cus_business",
      mayaFlyAppId: "maya-delete-business",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await ctx.db.patch(creatorId, { businessId });
    await ctx.db.insert("creatorMayaV0TiktokAccounts", {
      creatorId,
      handle: "deleteme",
      displayName: "Delete Me",
      followerCount: 1000,
      bio: "test",
      verifiedAt: NOW,
    });
    await ctx.db.insert("pairedChannels", {
      creatorId,
      channel: "imessage",
      phoneNumber: "+15555550123",
      externalPairingId: "pair_delete",
      externalIdentifier: "imessage:+15555550123",
      status: "active",
      requestedAt: NOW,
      pairedAt: NOW,
    });
    await ctx.db.insert("businessPicture", {
      businessId,
      brandVoice: "direct",
      recurringServicePatterns: [],
      localCompetitors: [],
      generatedAt: NOW,
      model: "test",
      sourceCitations: [],
    });
    await ctx.db.insert("growthAgents", {
      accountId: creatorId,
      onboardingStep: "complete",
      rileyFlyAppId: "maya-delete-growth",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await ctx.db.insert("creatorMayaV0OpenClawDeployments", {
      creatorId,
      mode: "production",
      status: "deployed",
      flyAppId: "maya-delete-deployment",
      machineId: "machine-delete",
      createdAt: NOW,
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
    await ctx.db.insert("stripeWebhookEvents", {
      eventId: "evt_business",
      type: "customer.updated",
      livemode: false,
      status: "processed",
      customerId: "cus_business",
      receivedAt: NOW,
      rawPayload: {},
    });
    return { creatorId, businessId };
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
