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

/** Seed the FULL research-complete state (buyer map + ≥1 competitor + ≥1 channel
 *  scorecard) — the bar the synthesis claim now gates on (researchComplete), not
 *  buyer-map-alone. */
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
    await ctx.db.insert("gtmCompetitiveMap", {
      accountId,
      agentId,
      competitorKey: "rival",
      competitorName: "Rival",
      kind: "direct",
      positioning: "the incumbent",
      complaints: [],
      vulnerabilities: [],
      synthesizedAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("gtmChannelScorecard", {
      accountId,
      agentId,
      channel: "reddit",
      audienceFit: 1,
      cadenceFit: 1,
      uniqueUnlock: "buyers vent here",
      bet: true,
      synthesizedAt: 1,
      updatedAt: 1,
    });
    // Hardened 2026-06-30: the synthesis "send" claim gates on the EXPLICIT
    // researchCompletedAt stamp, not the derived researchComplete boolean. A
    // genuine research-done state has both the rows AND the stamp — seed both.
    await ctx.db.patch(agentId, { researchCompletedAt: 1, updatedAt: 1 });
  });
}

/** Seed the full research ROWS (buyerMap + competitor + scorecard) but WITHOUT
 *  the explicit researchCompletedAt stamp — the exact live failure mode (agent
 *  ws7bk96g, 2026-06-30) where the derived researchComplete flag is true
 *  mid-research but the run hasn't actually finished, so a tactical holding
 *  message must NOT be allowed to claim the synthesis send. */
async function seedResearchRowsNoStamp(
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
    await ctx.db.insert("gtmChannelScorecard", {
      accountId,
      agentId,
      channel: "reddit",
      audienceFit: 1,
      cadenceFit: 1,
      uniqueUnlock: "buyers vent here",
      bet: true,
      synthesizedAt: 1,
      updatedAt: 1,
    });
    // Deliberately NO researchCompletedAt patch.
  });
}

/** Seed buyer map ONLY (research still in progress — competitor/scorecard
 *  missing) for the gate test. */
async function seedBuyerMapOnly(
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
    // The claim token (planGeneratedAt) must NOT be stamped by a progress update.
    const agent = await t.run((ctx) => ctx.db.get(agentId));
    expect(agent?.planGeneratedAt ?? null).toBeNull();
  });

  it("hello burst: first send allows + stamps hello; rapid repeats suppress within the cooldown (the 4-duplicate-hellos fix)", async () => {
    const t = convexTest(schema, modules);
    const { agentId } = await setupAgent(t, "synth_hello_burst");
    // No research yet, no prior hello → first send flows AND records the hello.
    expect((await t.mutation(claim, { agentId })).decision).toBe("allow");
    const afterHello = await t.run((ctx) => ctx.db.get(agentId));
    expect(typeof afterHello?.helloSentAt).toBe("number");
    // Rapid follow-ups inside the burst window → suppressed (no 2nd/3rd/4th hello).
    expect((await t.mutation(claim, { agentId })).decision).toBe("suppress");
    expect((await t.mutation(claim, { agentId })).decision).toBe("suppress");
  });

  it("buyer map alone is NOT enough — research-incomplete sends are 'allow', never the synthesis 'send' (premature-synthesis fix)", async () => {
    const t = convexTest(schema, modules);
    const { accountId, agentId } = await setupAgent(t, "synth_research_gate");
    await seedBuyerMapOnly(t, accountId, agentId); // buyer map, but no competitor/scorecard
    // Research not complete → progress flows ("allow"), but the synthesis is NOT
    // claimed (planGeneratedAt stays null) — the live "shipped the play on a
    // half-built foundation" bug.
    expect((await t.mutation(claim, { agentId })).decision).toBe("allow");
    const agent = await t.run((ctx) => ctx.db.get(agentId));
    expect(agent?.planGeneratedAt ?? null).toBeNull();
  });

  // REGRESSION (agent ws7bk96g, 2026-06-30): the derived researchComplete flag
  // (buyerMap + ≥1 scorecard) flips true EARLY, while Maya is still mid-research
  // and only sending tactical holding messages ("still digging, back in a bit").
  // The old gate used that derived flag, so a holding message won the synthesis
  // claim, was cached as "the plan", and flipped the agent to plan_ready — the
  // REAL post-research plan was then suppressed and the operator NEVER got it.
  // The claim must gate on the EXPLICIT researchCompletedAt stamp: rows-but-no-
  // stamp is "allow" (progress), never "send".
  it("research ROWS present but researchCompletedAt NOT stamped → 'allow', never 'send' (the holding-message-steals-the-plan fix)", async () => {
    const t = convexTest(schema, modules);
    const { accountId, agentId } = await setupAgent(t, "synth_rows_no_stamp");
    await seedResearchRowsNoStamp(t, accountId, agentId);
    // Derived researchComplete is TRUE (rows exist) but the run isn't done.
    expect((await t.mutation(claim, { agentId })).decision).toBe("allow");
    const midResearch = await t.run((ctx) => ctx.db.get(agentId));
    expect(midResearch?.planGeneratedAt ?? null).toBeNull();
    expect(midResearch?.lifecycleState ?? "fresh").not.toBe("plan_ready");
    // Now research genuinely completes (stamp lands) → the NEXT send claims it.
    await t.run((ctx) =>
      ctx.db.patch(agentId, { researchCompletedAt: Date.now() })
    );
    expect((await t.mutation(claim, { agentId })).decision).toBe("send");
  });

  it("first send in the synthesis window claims it (stamps planGeneratedAt + plan_ready); the rest are suppressed", async () => {
    const t = convexTest(schema, modules);
    const { accountId, agentId } = await setupAgent(t, "synth_window");
    await seedBuyerMap(t, accountId, agentId);

    // First founder-facing send → claims the handover.
    expect((await t.mutation(claim, { agentId })).decision).toBe("send");
    const afterClaim = await t.run((ctx) => ctx.db.get(agentId));
    // ENUM REFACTOR: the claim token is planGeneratedAt (work done), NOT
    // strategyDeliveredAt (which is set only on a successful SEND, separately).
    expect(typeof afterClaim?.planGeneratedAt).toBe("number");
    expect(afterClaim?.strategyDeliveredAt ?? null).toBeNull();
    expect(afterClaim?.lifecycleState).toBe("plan_ready");

    // Every subsequent send in the window → suppressed (no matter the source).
    expect((await t.mutation(claim, { agentId })).decision).toBe("suppress");
    expect((await t.mutation(claim, { agentId })).decision).toBe("suppress");
  });

  it("a FAILED send does NOT re-claim or re-generate (the loop fix) — release is a no-op", async () => {
    const t = convexTest(schema, modules);
    const { accountId, agentId } = await setupAgent(t, "synth_retry");
    await seedBuyerMap(t, accountId, agentId);
    expect((await t.mutation(claim, { agentId })).decision).toBe("send");
    // Send failed → the OLD model released the claim so the agent re-generated +
    // re-sent (the delivery-failure re-synthesis loop). The NEW model holds the
    // cached plan for Convex to re-push: release is a no-op, planGeneratedAt
    // stays, and a retry SUPPRESSES (never re-generates the whole strategy).
    await t.mutation(release, { agentId });
    const afterRelease = await t.run((ctx) => ctx.db.get(agentId));
    expect(typeof afterRelease?.planGeneratedAt).toBe("number"); // still claimed
    expect((await t.mutation(claim, { agentId })).decision).toBe("suppress");
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
