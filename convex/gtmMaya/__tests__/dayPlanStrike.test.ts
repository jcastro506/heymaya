/**
 * Maya v2 §5.1 / §7.6 — day-plan + cold-strike-queue tests.
 *   - Pure helpers (rank/enqueue/select/parse) — no ctx needed.
 *   - Convex wrappers — enqueue → digest → mark-sent round-trip, per-agent.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";
import {
  enqueueStrike,
  rankForDigest,
  selectDigest,
  parseColdStrikeQueue,
  type StrikeCandidate,
} from "../coldStrike";
import { parseDayPlan, isPlanForToday } from "../dayPlanner";

function strike(over: Partial<StrikeCandidate>): StrikeCandidate {
  return {
    threadId: "t1",
    platform: "reddit",
    title: "How do I X?",
    url: "https://reddit.com/r/x/comments/abc",
    priorityScore: 0.5,
    tier: "T2",
    addedAt: 1000,
    ...over,
  };
}

async function setupAgent(
  t: ReturnType<typeof convexTest>,
  subject: string
): Promise<{ accountId: Id<"creators">; agentId: Id<"gtmAgents"> }> {
  const authed = t.withIdentity({ subject, email: `${subject}@clawlaunch.test` });
  const started = await authed.mutation(
    api.gtmMaya.researchLifecycle.startGtmOnboarding,
    {}
  );
  return { accountId: started.accountId, agentId: started.agentId };
}

describe("coldStrike — pure ranking + queue", () => {
  it("ranks T1 first, then priority, then freshness", () => {
    const ranked = rankForDigest([
      strike({ threadId: "a", tier: "T3", priorityScore: 0.9 }),
      strike({ threadId: "b", tier: "T1", priorityScore: 0.4 }),
      strike({ threadId: "c", tier: "T1", priorityScore: 0.8 }),
      strike({ threadId: "d", tier: "T1", priorityScore: 0.8, addedAt: 2000 }),
    ]);
    expect(ranked.map((c) => c.threadId)).toEqual(["d", "c", "b", "a"]);
  });

  it("enqueue dedups by threadId (newest wins)", () => {
    let q = parseColdStrikeQueue(null);
    q = enqueueStrike(q, strike({ threadId: "x", title: "old" }));
    q = enqueueStrike(q, strike({ threadId: "x", title: "new" }));
    expect(q.candidates).toHaveLength(1);
    expect(q.candidates[0].title).toBe("new");
  });

  it("selectDigest drops T4 trash and respects the limit", () => {
    const q = {
      candidates: [
        strike({ threadId: "a", tier: "T1" }),
        strike({ threadId: "b", tier: "T4" }), // trash — never surfaced
        strike({ threadId: "c", tier: "T2" }),
        strike({ threadId: "d", tier: "T3" }),
      ],
    };
    const picked = selectDigest(q, 2);
    expect(picked.map((c) => c.threadId)).toEqual(["a", "c"]);
    expect(picked.every((c) => c.tier !== "T4")).toBe(true);
  });
});

describe("coldStrike — Convex round-trip (per-agent)", () => {
  it("enqueue → digest → mark-sent drains the queue", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "strike_user");

    for (const s of [
      strike({ threadId: "r1", tier: "T1", priorityScore: 0.9 }),
      strike({ threadId: "r2", tier: "T2", priorityScore: 0.6 }),
      strike({ threadId: "r3", tier: "T4" }), // trash
    ]) {
      await t.mutation(internal.gtmMaya.coldStrike.enqueueColdStrike, {
        agentId: a.agentId,
        candidate: s,
      });
    }

    const digest = await t.query(internal.gtmMaya.coldStrike.getStrikeDigest, {
      agentId: a.agentId,
      limit: 5,
    });
    expect(digest.map((c) => c.threadId)).toEqual(["r1", "r2"]); // T4 excluded, T1 first

    await t.mutation(internal.gtmMaya.coldStrike.markStrikeDigestSent, {
      agentId: a.agentId,
      sentThreadIds: ["r1", "r2"],
    });
    const after = await t.query(internal.gtmMaya.coldStrike.getStrikeDigest, {
      agentId: a.agentId,
      limit: 5,
    });
    expect(after).toHaveLength(0); // r1/r2 sent, r3 is T4 (never surfaced)
  });

  it("a strike on agent A never appears in agent B's digest", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "strike_a");
    const b = await setupAgent(t, "strike_b");
    await t.mutation(internal.gtmMaya.coldStrike.enqueueColdStrike, {
      agentId: a.agentId,
      candidate: strike({ threadId: "only_a", tier: "T1" }),
    });
    const bDigest = await t.query(internal.gtmMaya.coldStrike.getStrikeDigest, {
      agentId: b.agentId,
      limit: 5,
    });
    expect(bDigest).toHaveLength(0);
  });
});

describe("dayPlanner", () => {
  it("parses + detects today's plan", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "plan_user");
    const plan = {
      planDate: "2026-06-26",
      posture: "helpful + a little funny",
      funnelBudget: { tier1: 5, tier2: 3, tier3: 2 },
      productMentionRatio: 0.1,
      watchFor: ["GA4 alternative", "competitor:fathom"],
      originalPost: { channel: "x", angle: "build-in-public", needsCreative: false },
      generatedAt: 123,
    };
    await t.mutation(internal.gtmMaya.dayPlanner.writeDayPlan, {
      agentId: a.agentId,
      plan,
    });
    const read = await t.query(internal.gtmMaya.dayPlanner.readDayPlan, {
      agentId: a.agentId,
    });
    expect(read?.planDate).toBe("2026-06-26");
    expect(read?.funnelBudget.tier1).toBe(5);
    expect(isPlanForToday(read, "2026-06-26")).toBe(true);
    expect(isPlanForToday(read, "2026-06-27")).toBe(false);
  });

  it("parseDayPlan rejects junk", () => {
    expect(parseDayPlan(null)).toBeNull();
    expect(parseDayPlan("{not json")).toBeNull();
    expect(parseDayPlan('{"posture":"no date"}')).toBeNull();
  });
});
