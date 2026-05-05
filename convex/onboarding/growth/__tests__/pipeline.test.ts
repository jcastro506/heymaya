import { beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { api } from "../../../_generated/api";
import { modules } from "../../../../tests/_modules";
import { encrypt, _resetEncryptionKeyCache } from "../../../lib/encryption";
import { sha256Hex } from "../../../integrations/composio/oauth";

const ENCRYPTION_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

describe("Builder onboarding pipeline", () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = ENCRYPTION_KEY;
    _resetEncryptionKeyCache();
  });

  it("creates the Builder agent, stores Composio ids encrypted, and advances through core setup", async () => {
    const t = convexTest(schema, modules);
    const authed = t.withIdentity({
      subject: "u_builder",
      email: "builder@example.com",
    });

    const started = await authed.action(
      api.onboarding.growth.pipeline.startGrowthOnboarding,
      {}
    );
    expect(started.created).toBe(true);

    await authed.mutation(
      api.onboarding.growth.pipeline.markPlatformConnected,
      {
        platform: "linkedin",
        composioAccountId: "ca_linkedin_plain",
      }
    );
    await authed.mutation(
      api.onboarding.growth.pipeline.setProductContext,
      {
        productContext: {
          productName: "ShipFast",
          oneLiner: "Launch tiny SaaS products faster.",
          targetAudience: "builders who need distribution",
          focus: "LinkedIn and X launch loops",
        },
      }
    );
    await authed.mutation(api.onboarding.growth.pipeline.setVoiceSamples, {
      voiceSamples: {
        linkedin: ["Here is a launch lesson with specifics."],
        twitter: ["Distribution is the tax."],
      },
    });

    const row = await t.run((ctx) => ctx.db.get(started.agentId));
    expect(row?.productContext?.productName).toBe("ShipFast");
    expect(row?.voiceSamples?.twitter).toEqual(["Distribution is the tax."]);
    expect(row?.linkedinConnection?.composioAccountId).not.toBe(
      "ca_linkedin_plain"
    );
    expect(row?.linkedinConnection?.composioAccountIdHash).toBe(
      await sha256Hex("ca_linkedin_plain")
    );
  });

  it("hydrates Builder platform state from a completed hosted OAuth connectedAccounts row", async () => {
    const t = convexTest(schema, modules);
    const authed = t.withIdentity({
      subject: "u_oauth_builder",
      email: "oauth-builder@example.com",
    });
    const started = await authed.action(
      api.onboarding.growth.pipeline.startGrowthOnboarding,
      {}
    );
    const encrypted = await encrypt("ca_twitter_plain");
    const hash = await sha256Hex("ca_twitter_plain");
    const connectedAccountId = await t.run((ctx) =>
      ctx.db.insert("connectedAccounts", {
        creatorId: started.creatorId,
        provider: "twitter",
        composioAccountId: encrypted,
        composioAccountIdHash: hash,
        scopes: ["tweet.read", "tweet.write"],
        scopeStatus: "active",
        connectedAt: 123,
      })
    );

    await authed.mutation(
      api.onboarding.growth.pipeline.markPlatformConnectedFromConnectedAccount,
      {
        platform: "twitter",
        connectedAccountId,
      }
    );

    const row = await t.run((ctx) => ctx.db.get(started.agentId));
    expect(row?.twitterConnection?.composioAccountId).toBe(encrypted);
    expect(row?.twitterConnection?.composioAccountIdHash).toBe(hash);
  });
});
