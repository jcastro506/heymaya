/**
 * Mission Control v2 write surface — approve/tweak/pass drafts, steering,
 * conversion self-report, and the joined draft queue.
 *
 * Mandatory categories exercised here:
 *  1. Cross-tenant — founder B can never decide founder A's drafts, read A's
 *     queue/health/moves, or log conversions into A's ledger.
 *  2. Fail-closed — no identity → mutations throw, queries return empty.
 *  3. Adversarial — empty tweak note, zero/negative/absurd conversion counts,
 *     deciding an already-published draft.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";

// The decision mutations schedule a follow-up (notify-the-machine action /
// the shared steering save). Fake timers + finishAllScheduledFunctions drain
// them inside the test transaction — the house pattern (see
// lcMaya/__tests__/firstProactivePing.test.ts).
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function drain(t: ReturnType<typeof convexTest>): Promise<void> {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

async function seedAgent(
  t: ReturnType<typeof convexTest>,
  subject: string
): Promise<{ accountId: Id<"creators">; agentId: Id<"gtmAgents"> }> {
  return await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("creators", {
      clerkUserId: subject,
      email: `${subject}@clawlaunch.test`,
      channelPreference: "telegram",
      timezone: "America/New_York",
      status: "active",
      plan: "manager",
      accountType: "gtm-agent",
      createdAt: Date.now(),
    } as never);
    const agentId = await ctx.db.insert("gtmAgents", {
      accountId,
      onboardingStep: "active",
      channelPreference: "telegram",
      timezone: "America/New_York",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as never);
    return { accountId, agentId };
  });
}

async function seedDraft(
  t: ReturnType<typeof convexTest>,
  ids: { accountId: Id<"creators">; agentId: Id<"gtmAgents"> },
  overrides: Record<string, unknown> = {}
): Promise<Id<"gtmDraftedContent">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("gtmDraftedContent", {
      accountId: ids.accountId,
      agentId: ids.agentId,
      kind: "reply",
      platform: "reddit",
      draftText: "Honest answer: this is exactly what we built for.",
      slopCriticPassed: true,
      approvalState: "pending_approval",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides,
    } as never);
  });
}

describe("draft decisions — approve / tweak / pass", () => {
  it("owner approves their own pending draft → approved + activity row", async () => {
    const t = convexTest(schema, modules);
    const a = await seedAgent(t, "founder_a_approve");
    const draftId = await seedDraft(t, a);
    const asA = t.withIdentity({ subject: "founder_a_approve" });
    await asA.mutation(api.gtmMaya.missionActions.approveMyDraft, { draftId });
    await drain(t);
    const { draft, activity } = await t.run(async (ctx) => ({
      draft: await ctx.db.get(draftId),
      activity: await ctx.db
        .query("gtmAgentActivity")
        .withIndex("by_account", (q) => q.eq("accountId", a.accountId))
        .collect(),
    }));
    expect(draft?.approvalState).toBe("approved");
    expect(activity).toHaveLength(1);
    expect(activity[0].summary).toContain("approved");
  });

  it("cross-tenant: founder B cannot decide founder A's draft", async () => {
    const t = convexTest(schema, modules);
    const a = await seedAgent(t, "founder_a_xt");
    await seedAgent(t, "founder_b_xt");
    const draftId = await seedDraft(t, a);
    const asB = t.withIdentity({ subject: "founder_b_xt" });
    await expect(
      asB.mutation(api.gtmMaya.missionActions.approveMyDraft, { draftId })
    ).rejects.toThrow(/not found/i);
    const draft = await t.run(async (ctx) => ctx.db.get(draftId));
    expect(draft?.approvalState).toBe("pending_approval");
  });

  it("fail-closed: unauthenticated approve throws", async () => {
    const t = convexTest(schema, modules);
    const a = await seedAgent(t, "founder_a_anon");
    const draftId = await seedDraft(t, a);
    await expect(
      t.mutation(api.gtmMaya.missionActions.approveMyDraft, { draftId })
    ).rejects.toThrow(/sign in/i);
  });

  it("adversarial: a published draft is immutable", async () => {
    const t = convexTest(schema, modules);
    const a = await seedAgent(t, "founder_a_pub");
    const draftId = await seedDraft(t, a, { approvalState: "published" });
    const asA = t.withIdentity({ subject: "founder_a_pub" });
    await expect(
      asA.mutation(api.gtmMaya.missionActions.passOnMyDraft, { draftId })
    ).rejects.toThrow(/already went out/i);
  });

  it("tweak requires a note; a valid note routes to needs_revision", async () => {
    const t = convexTest(schema, modules);
    const a = await seedAgent(t, "founder_a_tweak");
    const draftId = await seedDraft(t, a);
    const asA = t.withIdentity({ subject: "founder_a_tweak" });
    await expect(
      asA.mutation(api.gtmMaya.missionActions.requestDraftTweak, {
        draftId,
        note: "   ",
      })
    ).rejects.toThrow(/what to change/i);
    await asA.mutation(api.gtmMaya.missionActions.requestDraftTweak, {
      draftId,
      note: "Shorter, and mention the free tier.",
    });
    await drain(t);
    const draft = await t.run(async (ctx) => ctx.db.get(draftId));
    expect(draft?.approvalState).toBe("needs_revision");
    expect(draft?.userFeedback).toBe("Shorter, and mention the free tier.");
  });

  it("pass marks rejected and keeps the note", async () => {
    const t = convexTest(schema, modules);
    const a = await seedAgent(t, "founder_a_pass");
    const draftId = await seedDraft(t, a);
    const asA = t.withIdentity({ subject: "founder_a_pass" });
    await asA.mutation(api.gtmMaya.missionActions.passOnMyDraft, {
      draftId,
      note: "Wrong thread for us.",
    });
    await drain(t);
    const draft = await t.run(async (ctx) => ctx.db.get(draftId));
    expect(draft?.approvalState).toBe("rejected");
    expect(draft?.userFeedback).toBe("Wrong thread for us.");
  });
});

describe("conversion self-report", () => {
  it("logs a self_report conversion + activity row", async () => {
    const t = convexTest(schema, modules);
    const a = await seedAgent(t, "founder_a_conv");
    const asA = t.withIdentity({ subject: "founder_a_conv" });
    await asA.mutation(api.gtmMaya.missionActions.reportMyConversion, {
      kind: "signup",
      count: 3,
      note: "said they saw the Reddit post",
    });
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("gtmConversions")
        .withIndex("by_account", (q) => q.eq("accountId", a.accountId))
        .collect()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("self_report");
    expect(rows[0].count).toBe(3);
  });

  it("adversarial: zero / negative / absurd counts are rejected", async () => {
    const t = convexTest(schema, modules);
    await seedAgent(t, "founder_a_convbad");
    const asA = t.withIdentity({ subject: "founder_a_convbad" });
    for (const count of [0, -5, 10001]) {
      await expect(
        asA.mutation(api.gtmMaya.missionActions.reportMyConversion, {
          kind: "signup",
          count,
        })
      ).rejects.toThrow(/between 1 and/i);
    }
  });
});

describe("read surface — queue, health, moves", () => {
  it("getMyDraftQueue joins thread context and never leaks cross-tenant", async () => {
    const t = convexTest(schema, modules);
    const a = await seedAgent(t, "founder_a_queue");
    const b = await seedAgent(t, "founder_b_queue");
    const threadId = await t.run(async (ctx) =>
      ctx.db.insert("gtmTargetThreads", {
        accountId: a.accountId,
        agentId: a.agentId,
        platform: "reddit",
        url: "https://reddit.com/r/SaaS/comments/abc",
        externalId: "abc",
        title: "What tool do you use for organic distribution?",
        currentMetrics: { upvotes: 12, comments: 4 },
        lastSeenMetricsAtMs: Date.now(),
        whyItFits: "Founder asking for exactly this tool category.",
        recommendedAction: "reply",
        status: "queued",
        priorityScore: 0.9,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as never)
    );
    await seedDraft(t, a, { targetThreadId: threadId });
    await seedDraft(t, b, { draftText: "founder B's private draft" });

    const asA = t.withIdentity({ subject: "founder_a_queue" });
    const queueA = await asA.query(api.gtmMaya.missionActions.getMyDraftQueue, {});
    expect(queueA).toHaveLength(1);
    expect(queueA[0].thread?.url).toContain("reddit.com");
    expect(queueA.some((d) => d.draftText.includes("founder B"))).toBe(false);

    // Fail-closed: no identity → empty, never an error leak.
    const anon = await t.query(api.gtmMaya.missionActions.getMyDraftQueue, {});
    expect(anon).toEqual([]);
  });

  it("connection health + competitor moves fail closed and stay scoped", async () => {
    const t = convexTest(schema, modules);
    const a = await seedAgent(t, "founder_a_health");
    await seedAgent(t, "founder_b_health");
    await t.run(async (ctx) => {
      await ctx.db.insert("gtmConnectionHealth", {
        accountId: a.accountId,
        provider: "x",
        status: "reconnect_required",
        lastCheckedAt: Date.now(),
        updatedAt: Date.now(),
      } as never);
      await ctx.db.insert("gtmCompetitorMoves", {
        accountId: a.accountId,
        agentId: a.agentId,
        competitorName: "Replymer",
        moveKind: "pricing_change",
        summary: "Raised prices 30%",
        sourceUrl: "https://example.com/pricing",
        observedAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as never);
    });
    const asB = t.withIdentity({ subject: "founder_b_health" });
    expect(
      await asB.query(api.gtmMaya.missionActions.getMyConnectionHealth, {})
    ).toEqual([]);
    expect(
      await asB.query(api.gtmMaya.missionActions.getMyCompetitorMoves, {})
    ).toEqual([]);
    expect(
      await t.query(api.gtmMaya.missionActions.getMyConnectionHealth, {})
    ).toEqual([]);

    const asA = t.withIdentity({ subject: "founder_a_health" });
    expect(
      await asA.query(api.gtmMaya.missionActions.getMyConnectionHealth, {})
    ).toHaveLength(1);
    expect(
      await asA.query(api.gtmMaya.missionActions.getMyCompetitorMoves, {})
    ).toHaveLength(1);
  });
});

describe("steering from the web", () => {
  it("saves via the shared internal path and drops an activity row", async () => {
    const t = convexTest(schema, modules);
    const a = await seedAgent(t, "founder_a_steerweb");
    const asA = t.withIdentity({ subject: "founder_a_steerweb" });
    await asA.mutation(api.gtmMaya.missionActions.sendMySteeringDirective, {
      directive: "Focus on LinkedIn this month.",
    });
    await drain(t);
    const { directives, activity } = await t.run(async (ctx) => ({
      directives: await ctx.db
        .query("gtmSteeringDirectives")
        .withIndex("by_account_and_active", (q) =>
          q.eq("accountId", a.accountId).eq("active", true)
        )
        .collect(),
      activity: await ctx.db
        .query("gtmAgentActivity")
        .withIndex("by_account", (q) => q.eq("accountId", a.accountId))
        .collect(),
    }));
    expect(directives).toHaveLength(1);
    expect(directives[0].source).toBe("founder");
    expect(activity).toHaveLength(1);
  });

  it("fail-closed: anonymous + empty directives throw", async () => {
    const t = convexTest(schema, modules);
    await seedAgent(t, "founder_a_steerbad");
    await expect(
      t.mutation(api.gtmMaya.missionActions.sendMySteeringDirective, {
        directive: "do things",
      })
    ).rejects.toThrow(/sign in/i);
    const asA = t.withIdentity({ subject: "founder_a_steerbad" });
    await expect(
      asA.mutation(api.gtmMaya.missionActions.sendMySteeringDirective, {
        directive: "   ",
      })
    ).rejects.toThrow(/differently/i);
  });
});
