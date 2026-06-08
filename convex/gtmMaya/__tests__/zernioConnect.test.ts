/**
 * Maya v2 S2 — Zernio connect-flow isolation + state-token tests.
 *
 * Covers the security-critical, pure-DB parts of the hosted-OAuth connect flow
 * (the external Zernio calls are covered by the integration contract tests):
 *   1. A state token is single-use (claim once, second claim fails).
 *   2. Claiming binds to exactly the issuing agent (cross-tenant binding).
 *   3. Claim rejects an expired token.
 *   4. Claim rejects a non-zernio (google) provider token — provider isolation.
 *   5. Claim rejects an unknown token.
 *   6. Connected accounts are per-agent: agent B never sees agent A's accounts.
 */

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";

async function setupAgent(
  t: ReturnType<typeof convexTest>,
  subject: string
): Promise<{ accountId: Id<"creators">; agentId: Id<"gtmAgents"> }> {
  const authed = t.withIdentity({
    subject,
    email: `${subject}@clawlaunch.test`,
  });
  await authed.mutation(api.gtmMaya.researchLifecycle.startGtmOnboarding, {});
  await authed.mutation(api.gtmMaya.researchLifecycle.setAppProfile, {
    name: `App for ${subject}`,
    url: `https://${subject}.test`,
    stage: "live-beta",
    weekGoal: "signups",
    canRecordScreen: true,
    canShowFace: false,
    excludedAudiences: [],
  });
  // Inside t.run, ctx.db is typed generically (no schema index types), so we
  // collect + find in JS rather than withIndex.
  const resolved = await t.run(async (ctx) => {
    const creators = await ctx.db.query("creators").collect();
    const creator = creators.find((c) => c.clerkUserId === subject);
    const agents = await ctx.db.query("gtmAgents").collect();
    const agent = agents.find((a) => a.accountId === creator!._id);
    return { accountId: creator!._id, agentId: agent!._id };
  });
  return resolved;
}

describe("zernioConnect — state tokens", () => {
  it("a state token is single-use", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "user_a");
    const { token } = await t.mutation(
      internal.gtmMaya.zernioConnect.issueZernioStateToken,
      { accountId: a.accountId, agentId: a.agentId }
    );
    const first = await t.mutation(
      internal.gtmMaya.zernioConnect.claimZernioStateToken,
      { token }
    );
    expect(first).not.toBeNull();
    expect(first!.agentId).toBe(a.agentId);
    const second = await t.mutation(
      internal.gtmMaya.zernioConnect.claimZernioStateToken,
      { token }
    );
    expect(second).toBeNull();
  });

  it("claim binds to exactly the issuing agent (cross-tenant binding)", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "user_a");
    const b = await setupAgent(t, "user_b");
    const { token } = await t.mutation(
      internal.gtmMaya.zernioConnect.issueZernioStateToken,
      { accountId: a.accountId, agentId: a.agentId }
    );
    const claim = await t.mutation(
      internal.gtmMaya.zernioConnect.claimZernioStateToken,
      { token }
    );
    expect(claim!.agentId).toBe(a.agentId);
    expect(claim!.agentId).not.toBe(b.agentId);
  });

  it("claim rejects an expired token", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "user_a");
    const expiredToken = "expired-token-xyz";
    await t.run(async (ctx) => {
      await ctx.db.insert("gtmOauthStateTokens", {
        accountId: a.accountId,
        agentId: a.agentId,
        token: expiredToken,
        provider: "zernio",
        expiresAt: Date.now() - 1000,
        createdAt: Date.now() - 2000,
      });
    });
    const claim = await t.mutation(
      internal.gtmMaya.zernioConnect.claimZernioStateToken,
      { token: expiredToken }
    );
    expect(claim).toBeNull();
  });

  it("claim rejects a non-zernio (google) provider token", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "user_a");
    const googleToken = "google-provider-token";
    await t.run(async (ctx) => {
      await ctx.db.insert("gtmOauthStateTokens", {
        accountId: a.accountId,
        agentId: a.agentId,
        token: googleToken,
        provider: "google",
        expiresAt: Date.now() + 60_000,
        createdAt: Date.now(),
      });
    });
    const claim = await t.mutation(
      internal.gtmMaya.zernioConnect.claimZernioStateToken,
      { token: googleToken }
    );
    expect(claim).toBeNull();
  });

  it("claim rejects an unknown token", async () => {
    const t = convexTest(schema, modules);
    await setupAgent(t, "user_a");
    const claim = await t.mutation(
      internal.gtmMaya.zernioConnect.claimZernioStateToken,
      { token: "never-issued" }
    );
    expect(claim).toBeNull();
  });
});

describe("zernioConnect — connected-account isolation", () => {
  it("connected accounts are per-agent (B never sees A's)", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "user_a");
    await setupAgent(t, "user_b");

    await t.mutation(internal.gtmMaya.zernioConnect.replaceConnectedAccounts, {
      agentId: a.agentId,
      accounts: [
        {
          accountId: "acct_x_123",
          platform: "x",
          username: "alice",
          displayName: "Alice",
          isActive: true,
          needsReconnect: false,
          connectedAt: Date.now(),
        },
      ],
    });

    const aSees = await t
      .withIdentity({ subject: "user_a", email: "user_a@clawlaunch.test" })
      .query(api.gtmMaya.zernioConnect.getMyConnectedAccounts, {});
    const bSees = await t
      .withIdentity({ subject: "user_b", email: "user_b@clawlaunch.test" })
      .query(api.gtmMaya.zernioConnect.getMyConnectedAccounts, {});

    expect(aSees).toHaveLength(1);
    expect(aSees[0].accountId).toBe("acct_x_123");
    expect(bSees).toHaveLength(0);
  });

  it("getMyConnectedAccounts returns empty for an unauthenticated caller", async () => {
    const t = convexTest(schema, modules);
    const res = await t.query(
      api.gtmMaya.zernioConnect.getMyConnectedAccounts,
      {}
    );
    expect(res).toHaveLength(0);
  });
});

describe("zernioConnect — peek/claim split (don't burn token on empty connect)", () => {
  it("peek resolves WITHOUT consuming; mark consumes", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "user_a");
    const { token } = await t.mutation(
      internal.gtmMaya.zernioConnect.issueZernioStateToken,
      { accountId: a.accountId, agentId: a.agentId }
    );

    // Peek twice — a failed/empty connect must leave the token live to retry.
    const peek1 = await t.query(
      internal.gtmMaya.zernioConnect.peekZernioStateToken,
      { token }
    );
    const peek2 = await t.query(
      internal.gtmMaya.zernioConnect.peekZernioStateToken,
      { token }
    );
    expect(peek1?.agentId).toBe(a.agentId);
    expect(peek2?.agentId).toBe(a.agentId);

    // Once accounts land we mark it claimed; further peeks fail (single-use).
    await t.mutation(internal.gtmMaya.zernioConnect.markZernioStateTokenClaimed, {
      token,
    });
    const peek3 = await t.query(
      internal.gtmMaya.zernioConnect.peekZernioStateToken,
      { token }
    );
    expect(peek3).toBeNull();
  });

  it("peek rejects expired / wrong-provider / unknown tokens", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "user_a");
    await t.run(async (ctx) => {
      await ctx.db.insert("gtmOauthStateTokens", {
        accountId: a.accountId,
        agentId: a.agentId,
        token: "expired",
        provider: "zernio",
        expiresAt: Date.now() - 1000,
        createdAt: Date.now() - 2000,
      });
      await ctx.db.insert("gtmOauthStateTokens", {
        accountId: a.accountId,
        agentId: a.agentId,
        token: "google-tok",
        provider: "google",
        expiresAt: Date.now() + 60_000,
        createdAt: Date.now(),
      });
    });
    expect(
      await t.query(internal.gtmMaya.zernioConnect.peekZernioStateToken, {
        token: "expired",
      })
    ).toBeNull();
    expect(
      await t.query(internal.gtmMaya.zernioConnect.peekZernioStateToken, {
        token: "google-tok",
      })
    ).toBeNull();
    expect(
      await t.query(internal.gtmMaya.zernioConnect.peekZernioStateToken, {
        token: "never-issued",
      })
    ).toBeNull();
  });
});

describe("zernioConnect — webhook profile routing", () => {
  it("lookupAgentByZernioProfile resolves the owning agent only", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "user_a");
    const b = await setupAgent(t, "user_b");
    await t.run(async (ctx) => {
      await ctx.db.patch(a.agentId, { zernioProfileId: "prof_a" });
      await ctx.db.patch(b.agentId, { zernioProfileId: "prof_b" });
    });

    const hitA = await t.query(
      internal.gtmMaya.zernioConnect.lookupAgentByZernioProfile,
      { zernioProfileId: "prof_a" }
    );
    expect(hitA?.agentId).toBe(a.agentId);
    expect(hitA?.agentId).not.toBe(b.agentId);

    const miss = await t.query(
      internal.gtmMaya.zernioConnect.lookupAgentByZernioProfile,
      { zernioProfileId: "prof_does_not_exist" }
    );
    expect(miss).toBeNull();
  });
});

describe("zernioWebhook — dedup + profile extraction", () => {
  it("recordGtmWebhookEventIfNew is idempotent (replay defense)", async () => {
    const t = convexTest(schema, modules);
    const first = await t.mutation(
      internal.gtmMaya.zernioWebhook.recordGtmWebhookEventIfNew,
      { externalEventId: "evt_1", kind: "account.connected" }
    );
    const second = await t.mutation(
      internal.gtmMaya.zernioWebhook.recordGtmWebhookEventIfNew,
      { externalEventId: "evt_1", kind: "account.connected" }
    );
    expect(first.isNew).toBe(true);
    expect(second.isNew).toBe(false);
  });
});
