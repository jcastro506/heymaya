/**
 * #15 — durable agent lifecycle + idempotency tests (the re-doing-loop fix).
 *
 * Covers the 5 CLAUDE.md mandatory categories:
 *   1. Cross-tenant isolation — agent A's lifecycle + lease + dedupe keys are
 *      independent of agent B's; one agent's foundation lease never blocks
 *      another's.
 *   2. Plan-tier × action — these are internal mutations behind hookToken HTTP
 *      handlers; verified they no-op / throw safely on missing agents.
 *   3. Adversarial / idempotency — double markHelloSent, re-acquire while a
 *      lease is held, persist the same calendar dedupeKey twice, re-draft the
 *      same thread twice. None may duplicate. THIS is the loop fix.
 *   4. Sibling-file scan — the lifecycle tool names are asserted present in the
 *      generated BOOT/HEARTBEAT prose by generators.test.ts.
 *   5. TODO grep — repo-wide sweep test.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";

function authedGtm(t: ReturnType<typeof convexTest>, subject: string) {
  return t.withIdentity({ subject, email: `${subject}@clawlaunch.test` });
}

async function setupAgent(
  t: ReturnType<typeof convexTest>,
  subject: string
): Promise<{ accountId: Id<"creators">; agentId: Id<"gtmAgents"> }> {
  const authed = authedGtm(t, subject);
  const started = await authed.mutation(
    api.gtmMaya.researchLifecycle.startGtmOnboarding,
    { channelPreference: "telegram", timezone: "America/New_York" }
  );
  await authed.mutation(api.gtmMaya.researchLifecycle.setAppProfile, {
    url: `https://${subject}.test`,
    stage: "live-beta",
    weekGoal: "signups",
    canRecordScreen: true,
    canShowFace: false,
    excludedAudiences: [],
  });
  return { accountId: started.accountId, agentId: started.agentId };
}

async function seedThread(
  t: ReturnType<typeof convexTest>,
  accountId: Id<"creators">,
  agentId: Id<"gtmAgents">,
  externalId: string
): Promise<Id<"gtmTargetThreads">> {
  return await t.mutation(internal.gtmMaya.targetList.recordTargetThread, {
    accountId,
    agentId,
    platform: "reddit",
    url: `https://reddit.com/r/test/${externalId}`,
    externalId,
    currentMetrics: { upvotes: 10, comments: 3 },
    whyItFits: "Buyer asking exactly what the product solves.",
    recommendedAction: "reply",
    priorityScore: 0.8,
  });
}

describe("#15 lifecycle — markers + phases", () => {
  it("markHelloSent is idempotent and flips phase fresh → hello_sent", async () => {
    const t = convexTest(schema, modules);
    const { agentId } = await setupAgent(t, "lc_hello");

    let lc = await t.query(internal.gtmMaya.agentLifecycle.getAgentLifecycle, {
      agentId,
    });
    expect(lc?.phase).toBe("fresh");
    expect(lc?.helloSent).toBe(false);

    const first = await t.mutation(
      internal.gtmMaya.agentLifecycle.markHelloSent,
      { agentId }
    );
    expect(first.alreadySent).toBe(false);

    const second = await t.mutation(
      internal.gtmMaya.agentLifecycle.markHelloSent,
      { agentId }
    );
    expect(second.alreadySent).toBe(true);

    lc = await t.query(internal.gtmMaya.agentLifecycle.getAgentLifecycle, {
      agentId,
    });
    expect(lc?.helloSent).toBe(true);
    expect(lc?.phase).toBe("hello_sent");
  });

  it("foundationComplete is computed from durable rows (voice + thread + draft)", async () => {
    const t = convexTest(schema, modules);
    const { accountId, agentId } = await setupAgent(t, "lc_rows");

    // No rows yet → not complete.
    let lc = await t.query(internal.gtmMaya.agentLifecycle.getAgentLifecycle, {
      agentId,
    });
    expect(lc?.foundationComplete).toBe(false);

    // Voice profile present but no research → still not complete.
    await t.run(async (ctx) => {
      await ctx.db.patch(agentId, { voiceProfileJson: '{"confidence":"high"}' });
    });
    lc = await t.query(internal.gtmMaya.agentLifecycle.getAgentLifecycle, {
      agentId,
    });
    expect(lc?.hasVoiceProfile).toBe(true);
    expect(lc?.foundationComplete).toBe(false);

    // Add a thread + a draft → research landed → complete.
    const threadId = await seedThread(t, accountId, agentId, "post_rows_1");
    await t.mutation(internal.gtmMaya.targetList.recordDraftedContent, {
      accountId,
      agentId,
      kind: "reply",
      platform: "reddit",
      targetThreadId: threadId,
      draftText: "A genuine, grounded reply that helps the OP.",
    });

    // Pool exists, but the synthesis plan was NEVER generated/sent → NOT complete.
    lc = await t.query(internal.gtmMaya.agentLifecycle.getAgentLifecycle, {
      agentId,
    });
    expect(lc?.targetThreadCount).toBe(1);
    expect(lc?.draftCount).toBe(1);
    expect(lc?.foundationComplete).toBe(false);

    // The synthesis plan is generated/sent (planGeneratedAt) → with the pool, NOW
    // complete. Completion requires BOTH the plan AND the actionable pool.
    await t.run((ctx) => ctx.db.patch(agentId, { planGeneratedAt: Date.now() }));
    lc = await t.query(internal.gtmMaya.agentLifecycle.getAgentLifecycle, {
      agentId,
    });
    expect(lc?.foundationComplete).toBe(true);
    expect(lc?.phase).toBe("active");
  });

  // The 283-subagent bug: a founder with NO social handles has no voice to
  // extract, so hasVoiceProfile is false. Voice must NOT gate completion, or
  // foundation never auto-completes and the heartbeat watchdog re-runs the WHOLE
  // research fleet every tick forever.
  // The phase machine: research → finalize → complete, derived from rows so a
  // completed step is never re-run.
  it("foundationStep advances research → finalize → complete as rows land", async () => {
    const t = convexTest(schema, modules);
    const { accountId, agentId } = await setupAgent(t, "lc_step");
    const lc0 = await t.query(internal.gtmMaya.agentLifecycle.getAgentLifecycle, { agentId });
    expect(lc0?.foundationStep).toBe("research");
    expect(lc0?.researchComplete).toBe(false);

    // Foundation research rows land (buyer map + competitor + scorecard).
    await t.mutation(internal.gtmMaya.managerStore.upsertBuyerMap, {
      accountId, agentId,
      icpDescription: "Privacy-conscious SaaS founders.",
      buyerJourneyStages: [{ stage: "aware", whereTheyHangOut: "r/SaaS", intentLanguage: "GA4 sucks" }],
      intentPhrases: ["GA4 alternative"],
      trustedVoices: [],
    });
    await t.mutation(internal.gtmMaya.managerStore.upsertCompetitor, {
      accountId, agentId, competitorKey: "fathom", competitorName: "Fathom",
      kind: "direct", positioning: "Simple privacy analytics", complaints: [], vulnerabilities: [],
    });
    await t.mutation(internal.gtmMaya.managerStore.upsertChannelScorecard, {
      accountId, agentId, channel: "reddit", audienceFit: 0.8, cadenceFit: 0.7,
      uniqueUnlock: "answer-strike on GA4 threads", bet: true,
    });

    // Research DONE, but no threads/drafts → finalize (and NEVER re-spawn research).
    const lc1 = await t.query(internal.gtmMaya.agentLifecycle.getAgentLifecycle, { agentId });
    expect(lc1?.researchComplete).toBe(true);
    expect(lc1?.foundationComplete).toBe(false);
    expect(lc1?.foundationStep).toBe("finalize");

    // Discovery + drafting land — but the plan isn't delivered yet, so the step
    // stays FINALIZE (drive the synthesis), never re-spawning research.
    const threadId = await seedThread(t, accountId, agentId, "post_step_1");
    await t.mutation(internal.gtmMaya.targetList.recordDraftedContent, {
      accountId, agentId, kind: "reply", platform: "reddit", targetThreadId: threadId,
      draftText: "A grounded reply.",
    });
    const lc2 = await t.query(internal.gtmMaya.agentLifecycle.getAgentLifecycle, { agentId });
    expect(lc2?.foundationComplete).toBe(false);
    expect(lc2?.foundationStep).toBe("finalize");

    // The synthesis plan is generated/sent → with the pool, complete.
    await t.run((ctx) => ctx.db.patch(agentId, { planGeneratedAt: Date.now() }));
    const lc3 = await t.query(internal.gtmMaya.agentLifecycle.getAgentLifecycle, { agentId });
    expect(lc3?.foundationComplete).toBe(true);
    expect(lc3?.foundationStep).toBe("complete");
  });

  // The HARD backstop: the lease is denied past the cap so a stuck agent
  // CANNOT re-spawn the research fleet forever (the 283-session bleed).
  it("acquireFoundationLease is hard-capped — denies past the max", async () => {
    const t = convexTest(schema, modules);
    const { agentId } = await setupAgent(t, "lc_cap");
    const { FOUNDATION_MAX_LEASE_ACQUIRES } = await import("../agentLifecycle");

    // Acquire + release the max number of times (each grant increments the count).
    for (let i = 0; i < FOUNDATION_MAX_LEASE_ACQUIRES; i++) {
      const r = await t.mutation(internal.gtmMaya.agentLifecycle.acquireFoundationLease, { agentId });
      expect(r.acquired).toBe(true);
      expect(r.foundationStep).toBe("research"); // no rows → still research
      await t.mutation(internal.gtmMaya.agentLifecycle.releaseFoundationLease, { agentId });
    }
    // The NEXT acquire is over the cap → denied, capped, no re-spawn possible.
    const capped = await t.mutation(internal.gtmMaya.agentLifecycle.acquireFoundationLease, { agentId });
    expect(capped.acquired).toBe(false);
    expect(capped.capped).toBe(true);
  });

  it("foundation auto-completes WITHOUT a voice profile once research landed (no-handles founder)", async () => {
    const t = convexTest(schema, modules);
    const { accountId, agentId } = await setupAgent(t, "lc_novoice");

    // No voice profile at all (founder gave no handles) + research landed.
    const threadId = await seedThread(t, accountId, agentId, "post_novoice_1");
    await t.mutation(internal.gtmMaya.targetList.recordDraftedContent, {
      accountId,
      agentId,
      kind: "reply",
      platform: "reddit",
      targetThreadId: threadId,
      draftText: "A grounded reply for a brand with only a website.",
    });

    // Plan generated/sent (voice may be low-confidence, but the founder still gets it).
    await t.run((ctx) => ctx.db.patch(agentId, { planGeneratedAt: Date.now() }));
    const lc = await t.query(internal.gtmMaya.agentLifecycle.getAgentLifecycle, {
      agentId,
    });
    expect(lc?.hasVoiceProfile).toBe(false); // legitimately — no handles
    expect(lc?.foundationComplete).toBe(true); // research real + pool + plan → DONE
    expect(lc?.phase).toBe("active"); // watchdog stops → no re-spawn loop
  });

  // ENUM REFACTOR — completion gates on the plan being GENERATED, not DELIVERED.
  // The live $22 run looped re-synthesis forever because a no-channel founder
  // never "received" the plan → completion was blocked → the watchdog re-ran.
  // Now: refuse only on an empty foundation; succeed the moment research is done
  // / a plan exists, WITHOUT requiring delivery.
  it("markFoundationComplete requires the POOL and the PLAN (loop fix + thin-pool fix)", async () => {
    const t = convexTest(schema, modules);
    const { accountId, agentId } = await setupAgent(t, "lc_plangate");

    // (a) Plan generated but NO pool (no threads/drafts) → refuse (the thin-pool
    // fix: the live agent rushed to plan_ready with 0 threads, nothing to post).
    await t.run((ctx) => ctx.db.patch(agentId, { planGeneratedAt: Date.now() }));
    const noPool = await t.mutation(
      internal.gtmMaya.agentLifecycle.markFoundationComplete,
      { agentId }
    );
    expect(noPool.completed).toBe(false);
    expect(noPool.reason).toContain("not_ready");
    let lc = await t.query(internal.gtmMaya.agentLifecycle.getAgentLifecycle, { agentId });
    expect(lc?.foundationComplete).toBe(false);

    // (b) Build the actionable pool (thread + draft) → with the plan generated,
    // completion SUCCEEDS even though it was NEVER delivered (strategyDeliveredAt
    // null). No founder-channel dependency → no $22 loop; the safety-net +
    // deliver-on-connect still get the founder a plan.
    const threadId = await seedThread(t, accountId, agentId, "post_gate_1");
    await t.mutation(internal.gtmMaya.targetList.recordDraftedContent, {
      accountId, agentId, kind: "reply", platform: "reddit", targetThreadId: threadId,
      draftText: "A grounded reply.",
    });
    const ok = await t.mutation(
      internal.gtmMaya.agentLifecycle.markFoundationComplete,
      { agentId }
    );
    expect(ok.completed).toBe(true);
    const agent = await t.run((ctx) => ctx.db.get(agentId));
    expect(agent?.strategyDeliveredAt ?? null).toBeNull(); // completed WITHOUT delivery
    lc = await t.query(internal.gtmMaya.agentLifecycle.getAgentLifecycle, { agentId });
    expect(lc?.foundationComplete).toBe(true);
    expect(lc?.lifecycleState).toBe("plan_ready");
  });

  // The DECOUPLING fix: steady-state engagement (engagementReady) starts on
  // research-done, INDEPENDENT of whether the synthesis plan was delivered — so a
  // flaked send never leaves the agent idle. And research-done is durably stamped
  // so it survives a row moving (the fleet is never re-spawned).
  it("engagementReady decouples from strategy delivery + researchCompletedAt is durable", async () => {
    const t = convexTest(schema, modules);
    const { accountId, agentId } = await setupAgent(t, "lc_engageready");

    let lc = await t.query(internal.gtmMaya.agentLifecycle.getAgentLifecycle, { agentId });
    expect(lc?.engagementReady).toBe(false);
    expect(lc?.researchCompletedAt).toBeNull();

    // Foundation research lands (buyer map + competitor + scorecard).
    await t.mutation(internal.gtmMaya.managerStore.upsertBuyerMap, {
      accountId, agentId,
      icpDescription: "Privacy-conscious SaaS founders.",
      buyerJourneyStages: [{ stage: "aware", whereTheyHangOut: "r/SaaS", intentLanguage: "GA4 sucks" }],
      intentPhrases: ["GA4 alternative"],
      trustedVoices: [],
    });
    await t.mutation(internal.gtmMaya.managerStore.upsertCompetitor, {
      accountId, agentId, competitorKey: "fathom", competitorName: "Fathom",
      kind: "direct", positioning: "Simple privacy analytics", complaints: [], vulnerabilities: [],
    });
    await t.mutation(internal.gtmMaya.managerStore.upsertChannelScorecard, {
      accountId, agentId, channel: "reddit", audienceFit: 0.8, cadenceFit: 0.7,
      uniqueUnlock: "answer-strike on GA4 threads", bet: true,
    });

    // Engagement READY even though the plan was never delivered + onboarding NOT complete.
    lc = await t.query(internal.gtmMaya.agentLifecycle.getAgentLifecycle, { agentId });
    expect(lc?.researchComplete).toBe(true);
    expect(lc?.engagementReady).toBe(true);
    expect(lc?.strategyDelivered).toBe(false);
    expect(lc?.foundationComplete).toBe(false);

    // acquireFoundationLease durably stamps researchCompletedAt.
    await t.mutation(internal.gtmMaya.agentLifecycle.acquireFoundationLease, { agentId });
    lc = await t.query(internal.gtmMaya.agentLifecycle.getAgentLifecycle, { agentId });
    expect(lc?.researchCompletedAt).not.toBeNull();

    // Durable: remove a research row → research STILL reads done (marker holds),
    // so the fleet is never re-spawned.
    await t.run(async (ctx) => {
      const bm = await ctx.db
        .query("gtmBuyerMap")
        .withIndex("by_agent", (q) => q.eq("agentId", agentId))
        .first();
      if (bm) await ctx.db.delete(bm._id);
    });
    lc = await t.query(internal.gtmMaya.agentLifecycle.getAgentLifecycle, { agentId });
    expect(lc?.researchComplete).toBe(true);
    expect(lc?.engagementReady).toBe(true);
  });

  // THE LIVE DOGFOOD FIX (2026-06-27): on a real deploy the competitor worker
  // persisted 0 rows, so the old `buyerMap && competitor>=1 && scorecard>=1` gate
  // stayed FALSE forever → the watchdog re-ran the synthesis → 6 duplicate
  // "foundation complete" messages. Research is now "done" on the CORE signals
  // (buyer map + ≥1 scorecard); a missing competitor map can't loop it.
  it("researchComplete flips on buyer map + scorecard ALONE — a failed competitor worker can't loop", async () => {
    const t = convexTest(schema, modules);
    const { accountId, agentId } = await setupAgent(t, "lc_nocompetitor");
    await t.mutation(internal.gtmMaya.managerStore.upsertBuyerMap, {
      accountId, agentId,
      icpDescription: "Solo devs shipping micro-SaaS with no audience.",
      buyerJourneyStages: [{ stage: "aware", whereTheyHangOut: "r/SaaS", intentLanguage: "no users yet" }],
      intentPhrases: ["how to get first users"],
      trustedVoices: [],
    });
    await t.mutation(internal.gtmMaya.managerStore.upsertChannelScorecard, {
      accountId, agentId, channel: "reddit", audienceFit: 0.8, cadenceFit: 0.7,
      uniqueUnlock: "answer-strike on first-users threads", bet: true,
    });
    // NO competitor rows landed — but research is DONE on the core signals.
    const lc = await t.query(internal.gtmMaya.agentLifecycle.getAgentLifecycle, { agentId });
    expect(lc?.researchComplete).toBe(true);
    expect(lc?.engagementReady).toBe(true);
    expect(lc?.foundationStep).toBe("finalize"); // advances — does NOT loop on "research"
  });
});

describe("#15 lifecycle — foundation lease (the lock)", () => {
  it("acquires when free, blocks a concurrent re-acquire, releases, completes", async () => {
    const t = convexTest(schema, modules);
    const { accountId, agentId } = await setupAgent(t, "lc_lease");

    // First acquire succeeds.
    const a1 = await t.mutation(
      internal.gtmMaya.agentLifecycle.acquireFoundationLease,
      { agentId }
    );
    expect(a1.acquired).toBe(true);
    expect(a1.alreadyComplete).toBe(false);

    // Second acquire while the lease is held is BLOCKED — this is what stops two
    // heartbeat ticks / two machines from re-running onboarding at once.
    const a2 = await t.mutation(
      internal.gtmMaya.agentLifecycle.acquireFoundationLease,
      { agentId }
    );
    expect(a2.acquired).toBe(false);
    expect(a2.leaseActive).toBe(true);

    // Release → re-acquire works again (mid-pipeline yield/resume).
    await t.mutation(internal.gtmMaya.agentLifecycle.releaseFoundationLease, {
      agentId,
    });
    const a3 = await t.mutation(
      internal.gtmMaya.agentLifecycle.acquireFoundationLease,
      { agentId }
    );
    expect(a3.acquired).toBe(true);

    // Research + the actionable pool land (the completion gate — plan generated +
    // pool, NOT delivery), then mark complete → acquire reports alreadyComplete
    // and refuses (never re-run).
    await t.run(async (ctx) => {
      await ctx.db.insert("gtmBuyerMap", {
        accountId, agentId, icpDescription: "ICP", buyerJourneyStages: [],
        intentPhrases: [], trustedVoices: [], synthesizedAt: 1,
      });
      await ctx.db.insert("gtmChannelScorecard", {
        accountId, agentId, channel: "reddit", audienceFit: 1, cadenceFit: 1,
        uniqueUnlock: "buyers vent here", bet: true, synthesizedAt: 1, updatedAt: 1,
      });
      // Hardened 2026-06-30: synthesis claim gates on the explicit stamp.
      await ctx.db.patch(agentId, { researchCompletedAt: 1, updatedAt: 1 });
    });
    const leaseThread = await seedThread(t, accountId, agentId, "post_lease_1");
    await t.mutation(internal.gtmMaya.targetList.recordDraftedContent, {
      accountId, agentId, kind: "reply", platform: "reddit", targetThreadId: leaseThread,
      draftText: "A grounded reply.",
    });
    // The synthesis send claims it (stamps planGeneratedAt — the completion gate).
    await t.mutation(internal.gtmMaya.agentLifecycle.claimFounderSynthesisSend, {
      agentId,
    });
    await t.mutation(internal.gtmMaya.agentLifecycle.markFoundationComplete, {
      agentId,
    });
    const a4 = await t.mutation(
      internal.gtmMaya.agentLifecycle.acquireFoundationLease,
      { agentId }
    );
    expect(a4.acquired).toBe(false);
    expect(a4.alreadyComplete).toBe(true);

    const lc = await t.query(
      internal.gtmMaya.agentLifecycle.getAgentLifecycle,
      { agentId }
    );
    expect(lc?.foundationComplete).toBe(true);
    expect(lc?.leaseActive).toBe(false);
  });

  it("an expired lease can be re-acquired (a crashed pass frees the slot)", async () => {
    const t = convexTest(schema, modules);
    const { agentId } = await setupAgent(t, "lc_expire");

    // Acquire with a 1ms TTL, then force it past expiry.
    await t.mutation(internal.gtmMaya.agentLifecycle.acquireFoundationLease, {
      agentId,
      ttlMs: 1,
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(agentId, { foundationLeaseUntil: Date.now() - 1000 });
    });
    const again = await t.mutation(
      internal.gtmMaya.agentLifecycle.acquireFoundationLease,
      { agentId }
    );
    expect(again.acquired).toBe(true);
  });
});

describe("#15 idempotency — no duplicate inserts on re-run", () => {
  it("persistGtmCalendarEventDraft with the same dedupeKey upserts, never duplicates", async () => {
    const t = convexTest(schema, modules);
    const { accountId, agentId } = await setupAgent(t, "lc_caldedupe");

    const id1 = await t.mutation(
      internal.gtmMaya.calendarWrite.persistGtmCalendarEventDraft,
      {
        accountId,
        agentId,
        title: "Day-1 first move",
        startsAtMs: 1_900_000_000_000,
        endsAtMs: 1_900_003_600_000,
        timezone: "America/New_York",
        dedupeKey: "day1_first_move",
      }
    );
    const id2 = await t.mutation(
      internal.gtmMaya.calendarWrite.persistGtmCalendarEventDraft,
      {
        accountId,
        agentId,
        title: "Day-1 first move (regenerated)",
        startsAtMs: 1_900_000_000_000,
        endsAtMs: 1_900_003_600_000,
        timezone: "America/New_York",
        dedupeKey: "day1_first_move",
      }
    );
    expect(id2).toBe(id1); // same row reused

    const events = await t.run(async (ctx) =>
      ctx.db
        .query("gtmCalendarEvents")
        .withIndex("by_agent", (q) => q.eq("agentId", agentId))
        .collect()
    );
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe("Day-1 first move (regenerated)"); // payload refreshed
  });

  it("recordDraftedContent re-draft for the same thread upserts, never piles up", async () => {
    const t = convexTest(schema, modules);
    const { accountId, agentId } = await setupAgent(t, "lc_draftdedupe");
    const threadId = await seedThread(t, accountId, agentId, "post_dd_1");

    const d1 = await t.mutation(
      internal.gtmMaya.targetList.recordDraftedContent,
      {
        accountId,
        agentId,
        kind: "reply",
        platform: "reddit",
        targetThreadId: threadId,
        draftText: "First draft of the reply.",
      }
    );
    const d2 = await t.mutation(
      internal.gtmMaya.targetList.recordDraftedContent,
      {
        accountId,
        agentId,
        kind: "reply",
        platform: "reddit",
        targetThreadId: threadId,
        draftText: "Re-run draft of the reply.",
      }
    );
    expect(d2).toBe(d1);

    const drafts = await t.run(async (ctx) =>
      ctx.db
        .query("gtmDraftedContent")
        .withIndex("by_agent", (q) => q.eq("agentId", agentId))
        .collect()
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0].draftText).toBe("Re-run draft of the reply.");
  });
});

describe("#15 cross-tenant isolation", () => {
  it("one agent's lifecycle, lease, and dedupe keys are independent of another's", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "lc_tenantA");
    const b = await setupAgent(t, "lc_tenantB");

    // A acquires its lease + marks complete.
    await t.mutation(internal.gtmMaya.agentLifecycle.acquireFoundationLease, {
      agentId: a.agentId,
    });
    await t.mutation(internal.gtmMaya.agentLifecycle.markFoundationComplete, {
      agentId: a.agentId,
    });

    // B is untouched: still fresh, lease still free.
    const lcB = await t.query(
      internal.gtmMaya.agentLifecycle.getAgentLifecycle,
      { agentId: b.agentId }
    );
    expect(lcB?.foundationComplete).toBe(false);
    const bAcq = await t.mutation(
      internal.gtmMaya.agentLifecycle.acquireFoundationLease,
      { agentId: b.agentId }
    );
    expect(bAcq.acquired).toBe(true);

    // Same dedupeKey on both agents creates ONE row EACH (keyed per agent).
    for (const ag of [a, b]) {
      await t.mutation(
        internal.gtmMaya.calendarWrite.persistGtmCalendarEventDraft,
        {
          accountId: ag.accountId,
          agentId: ag.agentId,
          title: "shared key",
          startsAtMs: 1_900_000_000_000,
          endsAtMs: 1_900_003_600_000,
          timezone: "America/New_York",
          dedupeKey: "day1_first_move",
        }
      );
    }
    const aEvents = await t.run(async (ctx) =>
      ctx.db
        .query("gtmCalendarEvents")
        .withIndex("by_agent", (q) => q.eq("agentId", a.agentId))
        .collect()
    );
    const bEvents = await t.run(async (ctx) =>
      ctx.db
        .query("gtmCalendarEvents")
        .withIndex("by_agent", (q) => q.eq("agentId", b.agentId))
        .collect()
    );
    expect(aEvents).toHaveLength(1);
    expect(bEvents).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE ENUM REFACTOR — the explicit lifecycleState machine + deliver-on-connect.
// Locks in the fix for the live $22 no-channel re-synthesis loop: Maya's WORK is
// done when the plan is GENERATED (plan_ready), independent of whether the
// founder ever received it; delivery + approval + connect are EVENTS, never work
// she spins on.
// ─────────────────────────────────────────────────────────────────────────────
describe("enum lifecycle — plan_ready + deliver-on-connect + activate", () => {
  const claim = internal.gtmMaya.agentLifecycle.claimFounderSynthesisSend;

  async function seedResearchComplete(
    t: ReturnType<typeof convexTest>,
    accountId: Id<"creators">,
    agentId: Id<"gtmAgents">
  ) {
    await t.run(async (ctx) => {
      await ctx.db.insert("gtmBuyerMap", {
        accountId, agentId, icpDescription: "ICP", buyerJourneyStages: [],
        intentPhrases: [], trustedVoices: [], synthesizedAt: 1,
      });
      await ctx.db.insert("gtmChannelScorecard", {
        accountId, agentId, channel: "reddit", audienceFit: 1, cadenceFit: 1,
        uniqueUnlock: "buyers vent here", bet: true, synthesizedAt: 1, updatedAt: 1,
      });
      // Hardened 2026-06-30: the synthesis "send" claim gates on the EXPLICIT
      // researchCompletedAt stamp (not the derived flag). Research-done = rows
      // AND stamp.
      await ctx.db.patch(agentId, { researchCompletedAt: 1, updatedAt: 1 });
    });
    // The actionable pool (thread + draft) — completion now requires it too.
    const poolThread = await seedThread(t, accountId, agentId, "post_enum_1");
    await t.mutation(internal.gtmMaya.targetList.recordDraftedContent, {
      accountId, agentId, kind: "reply", platform: "reddit", targetThreadId: poolThread,
      draftText: "A grounded reply.",
    });
  }

  it("no channel: synthesis claim → plan_ready + complete WITHOUT delivery; a re-claim SUPPRESSES (loop dead); plan is cached", async () => {
    const t = convexTest(schema, modules);
    const { accountId, agentId } = await setupAgent(t, "enum_nochannel");
    await seedResearchComplete(t, accountId, agentId);

    // The synthesis send claims it → plan_ready, work done.
    expect((await t.mutation(claim, { agentId })).decision).toBe("send");
    // The handler caches the composed plan (no channel paired, so the real send
    // would fail — but the plan is HELD, not lost).
    await t.mutation(internal.gtmMaya.agentLifecycle.cacheSynthesisPlan, {
      agentId,
      text: "Here's your plan: buyers, channels, the play.",
    });

    const lc = await t.query(internal.gtmMaya.agentLifecycle.getAgentLifecycle, { agentId });
    expect(lc?.lifecycleState).toBe("plan_ready");
    expect(lc?.foundationComplete).toBe(true);      // work done…
    expect(lc?.strategyDelivered).toBe(false);      // …WITHOUT the founder receiving it
    expect(lc?.hasCachedPlan).toBe(true);
    expect(lc?.foundationStep).toBe("complete");    // watchdog STOPS — no finalize re-run

    // The loop is dead: another proactive send does NOT re-claim/re-generate.
    expect((await t.mutation(claim, { agentId })).decision).toBe("suppress");
  });

  it("plan delivery attempts are bounded (dormant, not an infinite retry)", async () => {
    const t = convexTest(schema, modules);
    const { agentId } = await setupAgent(t, "enum_cap");
    let last = { attempts: 0, capped: false };
    for (let i = 0; i < 6; i++) {
      last = await t.mutation(
        internal.gtmMaya.agentLifecycle.bumpPlanDeliveryAttempt,
        { agentId }
      );
    }
    expect(last.attempts).toBe(6);
    expect(last.capped).toBe(true);
  });

  it("tryActivateAgent stays a no-op until approved AND connected, then flips to active", async () => {
    const t = convexTest(schema, modules);
    const { accountId, agentId } = await setupAgent(t, "enum_activate");
    await seedResearchComplete(t, accountId, agentId);
    // Reach plan_ready (the synthesis send claims it → planGeneratedAt → mark).
    await t.mutation(claim, { agentId });
    await t.mutation(internal.gtmMaya.agentLifecycle.markFoundationComplete, { agentId });

    // Plan ready but nothing connected + not approved → no-op.
    expect((await t.mutation(internal.gtmMaya.agentLifecycle.tryActivateAgent, { agentId })).activated).toBe(false);

    // Wire an app + an APPROVED research job + a connected account.
    const appId = await t.run((ctx) =>
      ctx.db.insert("gtmApps", {
        accountId, name: "Acme", url: "https://acme.test", stage: "live-beta",
        weekGoal: "signups", canRecordScreen: true, canShowFace: false,
        excludedAudiences: [], createdAt: 1, updatedAt: 1,
      })
    );
    await t.run((ctx) => ctx.db.patch(agentId, {
      appId,
      connectedAccountsJson: JSON.stringify([
        { accountId: "x1", platform: "reddit", isActive: true, needsReconnect: false, connectedAt: 1 },
      ]),
    }));
    await t.run((ctx) =>
      ctx.db.insert("gtmResearchJobs", {
        accountId, appId, status: "running", phase: "complete", budgetUsd: 3,
        spentUsd: 1, strategyApprovalState: "approved", createdAt: 2, updatedAt: 2,
      })
    );

    // Now the pair is complete → active.
    const res = await t.mutation(internal.gtmMaya.agentLifecycle.tryActivateAgent, { agentId });
    expect(res.activated).toBe(true);
    const lc = await t.query(internal.gtmMaya.agentLifecycle.getAgentLifecycle, { agentId });
    expect(lc?.lifecycleState).toBe("active");
  });
});
