import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";

/**
 * Sprint 2.16j — evidence guard validates strategic claims against real
 * gtmEvidenceCards rows owned by the agent's account. Tests:
 *   - happy path (real evidence_ids → ok:true)
 *   - missing evidence_ids array → ok:false
 *   - evidence_id doesn't exist → ok:false with evidence_not_found
 *   - cross-tenant evidence_id → ok:false with evidence_wrong_account
 *   - malformed evidence_id → ok:false with evidence_id_malformed
 *   - mixed valid + invalid → ok:false with per-claim failure breakdown
 */

async function setupAccountWithEvidence(
  t: ReturnType<typeof convexTest>,
  subject: string,
  cardCount: number
) {
  const authed = t.withIdentity({
    subject,
    email: `${subject}@clawlaunch.test`,
  });
  const started = await authed.mutation(
    api.gtmMaya.researchLifecycle.startGtmOnboarding,
    {}
  );
  const appId = await authed.mutation(
    api.gtmMaya.researchLifecycle.setAppProfile,
    {
      name: `App for ${subject}`,
      url: `https://${subject}.test`,
      stage: "live-beta",
      weekGoal: "signups",
      canRecordScreen: true,
      canShowFace: false,
      excludedAudiences: [],
    }
  );
  const jobId = await authed.mutation(
    api.gtmMaya.researchLifecycle.createResearchJob,
    { appId, budgetUsd: 3 }
  );

  // Insert evidence cards directly — there's no public mutation for
  // seeding cards (they're inserted by platform workers).
  const cardIds = await t.run(async (ctx) => {
    const ids: string[] = [];
    for (let i = 0; i < cardCount; i++) {
      const cardId = await ctx.db.insert("gtmEvidenceCards", {
        accountId: started.accountId,
        researchJobId: jobId,
        source: "reddit",
        url: `https://reddit.com/r/test/${subject}-${i}`,
        snippet: `Founders complaining about distribution problem ${i}`,
        observedAt: Date.now(),
        recency: "fresh",
        engagement: { likes: 12, comments: 4 },
        painMatch: 0.8,
        buyerMatch: 0.7,
        channelFit: 0.85,
        promotionRisk: "low",
        recommendedUse: "reply",
        extractedClaims: [`claim ${i}`],
        createdAt: Date.now(),
      });
      ids.push(cardId);
    }
    return ids;
  });

  return { accountId: started.accountId, appId, jobId, cardIds };
}

describe("Sprint 2.16j — evidenceGuard.validateClaims", () => {
  it("returns ok:true when every claim has resolved evidence_ids", async () => {
    const t = convexTest(schema, modules);
    const seed = await setupAccountWithEvidence(t, "guard_happy", 3);

    const result = await t.action(
      internal.gtmMaya.evidenceGuard.validateClaims,
      {
        accountId: seed.accountId,
        claims: [
          {
            claim: "Buyers on Reddit complain about distribution",
            evidence_ids: [seed.cardIds[0], seed.cardIds[1]],
          },
          {
            claim: "r/SaaS is the highest-intent community for this product",
            evidence_ids: [seed.cardIds[2]],
          },
        ],
      }
    );

    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.claimsCount).toBe(2);
    expect(result.evidenceCount).toBe(3);
  });

  it("rejects a claim with an empty evidence_ids array", async () => {
    const t = convexTest(schema, modules);
    const seed = await setupAccountWithEvidence(t, "guard_empty", 1);

    const result = await t.action(
      internal.gtmMaya.evidenceGuard.validateClaims,
      {
        accountId: seed.accountId,
        claims: [
          {
            claim: "TikTok is your primary channel",
            evidence_ids: [],
          },
        ],
      }
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].reason).toBe("missing_evidence_ids");
    expect(result.failures[0].claim).toContain("TikTok");
  });

  it("rejects a claim with an evidence_id that does not exist", async () => {
    const t = convexTest(schema, modules);
    const seed = await setupAccountWithEvidence(t, "guard_missing", 2);

    // Get a well-formed ID by inserting + deleting a card. Result: an ID
    // that normalizes correctly but doesn't resolve to a row.
    const phantomId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("gtmEvidenceCards", {
        accountId: seed.accountId,
        researchJobId: seed.jobId,
        source: "reddit",
        url: "https://reddit.com/r/test/phantom",
        snippet: "soon-to-be-deleted",
        observedAt: Date.now(),
        recency: "fresh",
        engagement: {},
        painMatch: 0.5,
        buyerMatch: 0.5,
        channelFit: 0.5,
        promotionRisk: "low",
        recommendedUse: "reply",
        extractedClaims: [],
        createdAt: Date.now(),
      });
      await ctx.db.delete(id);
      return id;
    });

    const result = await t.action(
      internal.gtmMaya.evidenceGuard.validateClaims,
      {
        accountId: seed.accountId,
        claims: [
          {
            claim: "Buyers are on Reddit",
            evidence_ids: [seed.cardIds[0], phantomId],
          },
        ],
      }
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].reason).toBe("evidence_not_found");
    expect(result.failures[0].missingIds).toEqual([phantomId]);
  });

  it("rejects a claim citing another account's evidence (cross-tenant defense)", async () => {
    const t = convexTest(schema, modules);
    const seedA = await setupAccountWithEvidence(t, "guard_tenant_a", 2);
    const seedB = await setupAccountWithEvidence(t, "guard_tenant_b", 1);

    // Account A tries to cite Account B's evidence card — must be blocked.
    const result = await t.action(
      internal.gtmMaya.evidenceGuard.validateClaims,
      {
        accountId: seedA.accountId,
        claims: [
          {
            claim: "Stealing your neighbor's research",
            evidence_ids: [seedB.cardIds[0]],
          },
        ],
      }
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].reason).toBe("evidence_wrong_account");
    expect(result.failures[0].missingIds).toEqual([seedB.cardIds[0]]);
  });

  it("rejects a claim with a malformed evidence_id", async () => {
    const t = convexTest(schema, modules);
    const seed = await setupAccountWithEvidence(t, "guard_malformed", 1);

    const result = await t.action(
      internal.gtmMaya.evidenceGuard.validateClaims,
      {
        accountId: seed.accountId,
        claims: [
          {
            claim: "Garbage evidence id",
            evidence_ids: ["not a real id with spaces!!!"],
          },
        ],
      }
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].reason).toBe("evidence_id_malformed");
  });

  it("reports per-claim failures when claims mix valid and invalid evidence", async () => {
    const t = convexTest(schema, modules);
    const seed = await setupAccountWithEvidence(t, "guard_mixed", 2);

    const result = await t.action(
      internal.gtmMaya.evidenceGuard.validateClaims,
      {
        accountId: seed.accountId,
        claims: [
          {
            claim: "Good claim with real evidence",
            evidence_ids: [seed.cardIds[0]],
          },
          {
            claim: "Bad claim with missing evidence",
            evidence_ids: [],
          },
          {
            claim: "Another good claim",
            evidence_ids: [seed.cardIds[1]],
          },
        ],
      }
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].claim).toContain("Bad claim");
    expect(result.failures[0].reason).toBe("missing_evidence_ids");
    expect(result.claimsCount).toBe(3);
    expect(result.evidenceCount).toBe(2);
  });

  it("handles zero claims by returning ok:true (caller should pre-filter)", async () => {
    const t = convexTest(schema, modules);
    const seed = await setupAccountWithEvidence(t, "guard_zero", 0);

    const result = await t.action(
      internal.gtmMaya.evidenceGuard.validateClaims,
      {
        accountId: seed.accountId,
        claims: [],
      }
    );

    // Empty claims passes the guard structurally; the send_update handler
    // enforces "strategic messages must carry at least one claim" upstream.
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.claimsCount).toBe(0);
    expect(result.evidenceCount).toBe(0);
  });
});
