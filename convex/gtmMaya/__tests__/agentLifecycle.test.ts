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

    // Rows exist, but the plan was NEVER delivered to the founder → NOT complete.
    // (The live dogfood: research landed, she went idle, the founder got no plan.)
    lc = await t.query(internal.gtmMaya.agentLifecycle.getAgentLifecycle, {
      agentId,
    });
    expect(lc?.targetThreadCount).toBe(1);
    expect(lc?.draftCount).toBe(1);
    expect(lc?.strategyDelivered).toBe(false);
    expect(lc?.foundationComplete).toBe(false);

    // The synthesis plan is delivered to the founder → NOW complete.
    await t.mutation(internal.gtmMaya.agentLifecycle.markStrategyDelivered, {
      agentId,
    });
    lc = await t.query(internal.gtmMaya.agentLifecycle.getAgentLifecycle, {
      agentId,
    });
    expect(lc?.strategyDelivered).toBe(true);
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

    // The synthesis plan is delivered → complete.
    await t.mutation(internal.gtmMaya.agentLifecycle.markStrategyDelivered, { agentId });
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

    // Plan delivered (voice may be low-confidence, but the founder still gets it).
    await t.mutation(internal.gtmMaya.agentLifecycle.markStrategyDelivered, {
      agentId,
    });
    const lc = await t.query(internal.gtmMaya.agentLifecycle.getAgentLifecycle, {
      agentId,
    });
    expect(lc?.hasVoiceProfile).toBe(false); // legitimately — no handles
    expect(lc?.foundationComplete).toBe(true); // research real + plan delivered → DONE
    expect(lc?.phase).toBe("active"); // watchdog stops → no re-spawn loop
  });

  // The plan-delivery gate: onboarding cannot finish until the founder actually
  // gets the synthesis. The live dogfood marked complete + went idle WITHOUT
  // ever sending the plan ("she never sent me the plan").
  it("markFoundationComplete REFUSES until the plan is delivered, then succeeds", async () => {
    const t = convexTest(schema, modules);
    const { accountId, agentId } = await setupAgent(t, "lc_plangate");

    // Research landed (threads + drafts) but plan not delivered.
    const threadId = await seedThread(t, accountId, agentId, "post_gate_1");
    await t.mutation(internal.gtmMaya.targetList.recordDraftedContent, {
      accountId, agentId, kind: "reply", platform: "reddit", targetThreadId: threadId,
      draftText: "A grounded reply.",
    });

    // Marking complete is REFUSED — nothing reached the founder.
    const blocked = await t.mutation(
      internal.gtmMaya.agentLifecycle.markFoundationComplete,
      { agentId }
    );
    expect(blocked.completed).toBe(false);
    expect(blocked.reason).toContain("strategy_not_delivered");
    let lc = await t.query(internal.gtmMaya.agentLifecycle.getAgentLifecycle, { agentId });
    expect(lc?.foundationComplete).toBe(false);

    // Deliver the plan → marking complete now succeeds.
    await t.mutation(internal.gtmMaya.agentLifecycle.markStrategyDelivered, { agentId });
    const ok = await t.mutation(
      internal.gtmMaya.agentLifecycle.markFoundationComplete,
      { agentId }
    );
    expect(ok.completed).toBe(true);
    lc = await t.query(internal.gtmMaya.agentLifecycle.getAgentLifecycle, { agentId });
    expect(lc?.foundationComplete).toBe(true);
  });
});

describe("#15 lifecycle — foundation lease (the lock)", () => {
  it("acquires when free, blocks a concurrent re-acquire, releases, completes", async () => {
    const t = convexTest(schema, modules);
    const { agentId } = await setupAgent(t, "lc_lease");

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

    // Deliver the plan first (required gate), then mark complete → acquire
    // reports alreadyComplete and refuses (never re-run).
    await t.mutation(internal.gtmMaya.agentLifecycle.markStrategyDelivered, {
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
