/**
 * §6 — claimFounderSynthesisSend: the onboarding synthesis handover goes to the
 * founder EXACTLY ONCE, no matter how many main sessions race to send it
 * (the live demo sent it 3× from two sessions, mixing tactical + strategic).
 * Class-independent; keyed on lifecycle state. Atomic (serializable mutation).
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";

async function setupAgent(t: ReturnType<typeof convexTest>, subject: string) {
  const authed = t.withIdentity({ subject, email: `${subject}@clawlaunch.test` });
  const started = await authed.mutation(
    api.gtmMaya.researchLifecycle.startGtmOnboarding,
    { channelPreference: "telegram", timezone: "America/New_York" }
  );
  return {
    accountId: started.accountId as Id<"creators">,
    agentId: started.agentId as Id<"gtmAgents">,
  };
}

async function seedBuyerMap(
  t: ReturnType<typeof convexTest>,
  accountId: Id<"creators">,
  agentId: Id<"gtmAgents">
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("gtmBuyerMap", {
      accountId,
      agentId,
      icpDescription: "ICP",
      buyerJourneyStages: [],
      intentPhrases: [],
      trustedVoices: [],
      synthesizedAt: 1,
    });
  });
}

const claim = internal.gtmMaya.agentLifecycle.claimFounderSynthesisSend;
const release = internal.gtmMaya.agentLifecycle.releaseFounderSynthesisClaim;

describe("claimFounderSynthesisSend", () => {
  it("allows progress updates while still researching (no buyer map)", async () => {
    const t = convexTest(schema, modules);
    const { agentId } = await setupAgent(t, "synth_research");
    expect((await t.mutation(claim, { agentId })).decision).toBe("allow");
    // strategyDeliveredAt must NOT be stamped by a progress update.
    const agent = await t.run((ctx) => ctx.db.get(agentId));
    expect(agent?.strategyDeliveredAt ?? null).toBeNull();
  });

  it("first send in the synthesis window claims it; the rest are suppressed", async () => {
    const t = convexTest(schema, modules);
    const { accountId, agentId } = await setupAgent(t, "synth_window");
    await seedBuyerMap(t, accountId, agentId);

    // First founder-facing send → claims the handover.
    expect((await t.mutation(claim, { agentId })).decision).toBe("send");
    const afterClaim = await t.run((ctx) => ctx.db.get(agentId));
    expect(typeof afterClaim?.strategyDeliveredAt).toBe("number");

    // Every subsequent send in the window → suppressed (no matter the source).
    expect((await t.mutation(claim, { agentId })).decision).toBe("suppress");
    expect((await t.mutation(claim, { agentId })).decision).toBe("suppress");
  });

  it("releasing a failed send lets a genuine retry re-claim", async () => {
    const t = convexTest(schema, modules);
    const { accountId, agentId } = await setupAgent(t, "synth_retry");
    await seedBuyerMap(t, accountId, agentId);
    expect((await t.mutation(claim, { agentId })).decision).toBe("send");
    // Send failed → release.
    await t.mutation(release, { agentId });
    const afterRelease = await t.run((ctx) => ctx.db.get(agentId));
    expect(afterRelease?.strategyDeliveredAt ?? null).toBeNull();
    // Retry re-claims + sends.
    expect((await t.mutation(claim, { agentId })).decision).toBe("send");
  });

  it("post-onboarding sends flow freely when no handover was delivered (legacy)", async () => {
    const t = convexTest(schema, modules);
    const { accountId, agentId } = await setupAgent(t, "synth_post");
    await seedBuyerMap(t, accountId, agentId);
    // Mark onboarding complete WITHOUT a delivered handover (strategyDeliveredAt
    // null) — the cooldown only bites when a handover timestamp exists.
    await t.run((ctx) =>
      ctx.db.patch(agentId, { foundationCompletedAt: Date.now() })
    );
    expect((await t.mutation(claim, { agentId })).decision).toBe("allow");
    // release is a no-op after completion (the plan really landed).
    await t.mutation(release, { agentId });
    const agent = await t.run((ctx) => ctx.db.get(agentId));
    expect(typeof agent?.foundationCompletedAt).toBe("number");
  });

  // REGRESSION (Cal AI, 2026-06-21): the 3× duplicate handover. Session A sends +
  // marks complete; Session B's re-articulated copy lands seconds later. The old
  // gate waved it through (foundationCompletedAt → "allow"). It must now suppress.
  it("suppresses a concurrent duplicate that lands just AFTER completion (the straddle)", async () => {
    const t = convexTest(schema, modules);
    const { accountId, agentId } = await setupAgent(t, "synth_straddle");
    await seedBuyerMap(t, accountId, agentId);
    // Session A claims + sends the handover (stamps strategyDeliveredAt).
    expect((await t.mutation(claim, { agentId })).decision).toBe("send");
    // Session A marks foundation complete seconds later.
    await t.run((ctx) =>
      ctx.db.patch(agentId, { foundationCompletedAt: Date.now() })
    );
    // Session B's re-articulated handover lands seconds after → SUPPRESS, even
    // though foundation is now complete (the former hole that sent it 3×).
    expect((await t.mutation(claim, { agentId })).decision).toBe("suppress");
    expect((await t.mutation(claim, { agentId })).decision).toBe("suppress");
  });

  it("allows a genuine later proactive send once past the handover cooldown", async () => {
    const t = convexTest(schema, modules);
    const { accountId, agentId } = await setupAgent(t, "synth_cooldown");
    await seedBuyerMap(t, accountId, agentId);
    // Handover delivered + completed 31 min ago (past the 30-min cooldown).
    const longAgo = Date.now() - 31 * 60 * 1000;
    await t.run((ctx) =>
      ctx.db.patch(agentId, {
        strategyDeliveredAt: longAgo,
        foundationCompletedAt: longAgo,
      })
    );
    // The next morning brief (proactive) flows — it's not a duplicate handover.
    expect((await t.mutation(claim, { agentId })).decision).toBe("allow");
  });
});
