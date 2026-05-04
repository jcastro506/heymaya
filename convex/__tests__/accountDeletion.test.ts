import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../../tests/_modules";
import { _setWebhookSecretForTests } from "../lib/webhookSecret";
import type { Id } from "../_generated/dataModel";

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
      accountType: "service-business",
      createdAt: NOW,
    });
    const businessId = await ctx.db.insert("businesses", {
      accountId: creatorId,
      name: "Delete Co",
      serviceTypes: ["marketing"],
      planTier: "pro",
      stripeCustomerId: "cus_business",
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
      createdAt: NOW,
      updatedAt: NOW,
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
