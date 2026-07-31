/**
 * One day, end to end, through every module.
 *
 * ## Why this file exists
 *
 * An audit of `convex/maya` found that every production call into it comes
 * from exactly ONE file (`dailyReport.ts`); every other module is exercised
 * only by its own unit tests. That is expected mid-rebuild — the agent loop
 * that will drive these doesn't exist yet — but it means the real risk isn't
 * inside any module. It's whether they COMPOSE.
 *
 * Unit tests answer "does this function do what it says". This answers the
 * question they can't: "does the output of one actually fit the input of the
 * next, and does a whole day hold together". Those are the seams where a
 * rebuild breaks, and they're invisible until something walks the whole path.
 *
 * So this walks it: a founder gives a rule → she plans the day → the brief
 * goes out → a draft is preflighted → the iron rule decides → it publishes →
 * the recap reports it → liveness confirms the day was healthy.
 */

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import type { Doc, Id } from "../../_generated/dataModel";
import { evaluate } from "../liveness";
import { budgetsFor } from "../planFeatures";

const MORNING = Date.UTC(2026, 6, 31, 7, 5, 0);
const MIDDAY = Date.UTC(2026, 6, 31, 12, 0, 0);
const EVENING = Date.UTC(2026, 6, 31, 20, 0, 0);

async function newCustomer(t: ReturnType<typeof convexTest>, suffix: string) {
  return await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("creators", {
      clerkUserId: `u_${suffix}`,
      email: `${suffix}@example.com`,
      channelPreference: "web",
      timezone: "UTC",
      status: "active",
      plan: "manager",
      createdAt: MORNING,
    });
    const customerId = await ctx.db.insert("customers", {
      accountId,
      agentVersion: "v2",
      plan: "mvp",
      state: "active",
      timezone: "UTC",
      createdAt: MORNING,
      updatedAt: MORNING,
    });
    await ctx.db.insert("channels", {
      customerId,
      channel: "x",
      postingMode: "just_go",
      status: "connected",
      createdAt: MORNING,
      updatedAt: MORNING,
    });
    return customerId;
  });
}

describe("a full day, walked through every module", () => {
  it("directive → brief → draft → preflight → iron rule → placement → recap → liveness", async () => {
    const t = convexTest(schema, modules);
    const customerId = await newCustomer(t, "full_day");

    /* 1. The founder gives a rule, in passing, the night before. --------- */
    const inbound = await t.mutation(internal.maya.messages.recordInbound, {
      customerId,
      surface: "telegram",
      body: "stop saying game-changer, it makes me cringe",
      ts: MORNING - 3600_000,
    });
    const rule = await t.mutation(internal.maya.directives.append, {
      customerId,
      kind: "phrase_ban",
      verbatim: "stop saying game-changer, it makes me cringe",
      sourceMessageId: inbound.messageId,
      now: MORNING - 3600_000,
    });

    /* 2. Morning run — brief FIRST, then the work. ------------------------ */
    const morning = await t.mutation(internal.maya.dailyReport.runMorningRun, {
      customerId,
      plannedPosts: [{ channel: "x", angle: "the 3am rollback" }],
      now: MORNING,
    });
    expect(morning.order).toEqual(["brief", "work"]);
    expect(morning.briefSent).toBe(true);
    expect(morning.jobsEnqueued).toBe(1);

    /* 3. A worker claims the job. ---------------------------------------- */
    const job = await t.mutation(internal.maya.jobs.claimNext, {
      kinds: ["produce_post"],
    });
    expect(job?.customerId).toBe(customerId);

    /* 4. She writes a draft — honouring the rule she was given. ----------- */
    const active = await t.query(internal.maya.directives.activeRules, {
      customerId,
      kind: "phrase_ban",
    });
    expect(active).toHaveLength(1);
    const draftText =
      "Migration ran at 3am. Rollback didn't. Here's what we changed.";
    expect(draftText.toLowerCase()).not.toContain("game-changer");

    const draftId = await t.run((ctx) =>
      ctx.db.insert("drafts", {
        customerId,
        channel: "x",
        kind: "post",
        snapshotText: draftText,
        outcome: "pending",
        proposedAt: MIDDAY,
        expiresAt: MIDDAY + 86_400_000,
      })
    );

    /* 5. Budget is settled BEFORE anything is shown. ---------------------- */
    const budget = await t.query(internal.maya.planFeatures.checkPostBudget, {
      customerId,
      channel: "x",
      now: MIDDAY,
    });
    expect(budget.verdict).toBe("full");

    /* 6. Preflight. ------------------------------------------------------- */
    const pre = await t.query(internal.maya.preflight.preflightDraft, {
      customerId,
      draftId,
    });
    expect(pre.ok).toBe(true);

    /* 7. THE iron rule. On just_go, nothing holds it. --------------------- */
    const decision = await t.query(
      internal.maya.publishDecision.decidePublish,
      { customerId, draftId }
    );
    expect(decision.publish).toBe(true);
    if (!decision.publish) throw new Error("unreachable");

    /* 8. Publish — the SNAPSHOT, under the decision's idempotency key. ---- */
    expect(decision.snapshotText).toBe(draftText);
    await t.run((ctx) =>
      ctx.db.insert("placements", {
        customerId,
        kind: "post",
        channel: "x",
        url: "https://x.com/dana/1",
        linkStatus: "live",
        publishedAt: MIDDAY + 60_000,
        snapshotText: decision.snapshotText,
        draftId,
        idempotencyKey: decision.idempotencyKey,
        metricsJson: JSON.stringify({ views: 4100, likes: 62 }),
      })
    );
    await t.mutation(internal.maya.jobs.succeed, { jobId: job!._id });

    /* 9. A retry of the same draft cannot double-publish. ----------------- */
    expect(
      await t.query(internal.maya.publishDecision.alreadyPublished, { draftId })
    ).toBe(true);

    /* 10. Evening recap — built from the row, not from a memory. ---------- */
    const recap = await t.mutation(internal.maya.dailyReport.sendEveningRecap, {
      customerId,
      now: EVENING,
    });
    expect(recap.count).toBe(1);
    const messages = (await t.run((ctx) =>
      ctx.db.query("messages").collect()
    )) as Doc<"messages">[];
    const recapBody = messages.find((m) => m.dedupeKey?.startsWith("recap:"))!.body;
    expect(recapBody).toContain("https://x.com/dana/1");
    expect(recapBody).toContain("4100 views");

    /* 11. Steady state: exactly two proactive messages. ------------------- */
    expect(
      await t.query(internal.maya.messages.proactiveSentToday, {
        customerId,
        now: EVENING,
      })
    ).toBe(2);

    /* 12. Liveness agrees the day was healthy. ---------------------------- */
    const facts = await t.query(internal.maya.liveness.gatherFacts, {
      customerId,
      now: EVENING,
    });
    expect(facts?.placementsToday).toBe(1);
    expect(evaluate(facts!)).toEqual([]);

    /* 13. And the rule they gave is still quotable, verbatim. ------------- */
    const stored = (await t.run((ctx) =>
      ctx.db.get(rule.directiveId)
    )) as Doc<"directives"> | null;
    expect(stored?.verbatim).toBe("stop saying game-changer, it makes me cringe");
  });

  it("a BAD day composes too: expired channel → held → honest recap → breach", async () => {
    // The path that actually matters. Every module has to agree about what
    // went wrong, and the founder has to get one true sentence rather than
    // silence or fake activity.
    const t = convexTest(schema, modules);
    const customerId = await newCustomer(t, "bad_day");

    await t.run(async (ctx) => {
      const channels = await ctx.db
        .query("channels")
        .withIndex("by_customer", (q) => q.eq("customerId", customerId))
        .collect();
      await ctx.db.patch(channels[0]._id, { status: "error" });
    });

    const draftId = await t.run((ctx) =>
      ctx.db.insert("drafts", {
        customerId,
        channel: "x",
        kind: "post",
        snapshotText: "a perfectly good post nobody will see",
        outcome: "pending",
        proposedAt: MIDDAY,
        expiresAt: MIDDAY + 86_400_000,
      })
    );

    // Preflight catches it BEFORE the founder is told anything is coming.
    const pre = await t.query(internal.maya.preflight.preflightDraft, {
      customerId,
      draftId,
    });
    expect(pre.ok).toBe(false);
    if (pre.ok) throw new Error("unreachable");
    expect(pre.failure.kind).toBe("token_expired");

    // And the iron rule independently refuses, for a reason from the closed set.
    const decision = await t.query(
      internal.maya.publishDecision.decidePublish,
      { customerId, draftId, alreadyApproved: true }
    );
    expect(decision.publish).toBe(false);
    if (decision.publish) throw new Error("unreachable");
    expect(decision.reason).toBe("channel_unavailable");

    // The recap says so plainly, with the real reason and no padding.
    await t.mutation(internal.maya.dailyReport.sendEveningRecap, {
      customerId,
      zeroDayReason: pre.message,
      now: EVENING,
    });
    const messages = (await t.run((ctx) =>
      ctx.db.query("messages").collect()
    )) as Doc<"messages">[];
    const recap = messages.find((m) => m.dedupeKey?.startsWith("recap:"))!.body;
    expect(recap).toBe(
      "Nothing went out today — that account needs reconnecting before I can post"
    );
    expect(recap).not.toMatch(/found|\d+ posts/i);

    // Liveness independently flags the zero day.
    const facts = await t.query(internal.maya.liveness.gatherFacts, {
      customerId,
      now: EVENING,
    });
    const breaches = evaluate({ ...facts!, knownReason: pre.message });
    // A first zero day, not a crisis — the account is one day old, and the
    // liveness clamp knows the difference.
    expect(breaches.map((b) => b.kind)).toContain("zero_placements_today");
    const zero = breaches.find((b) => b.kind === "zero_placements_today")!;
    expect(zero.detail).toContain("needs reconnecting");
    expect(zero.action).toBe("state_plainly_in_recap");
  });

  it("a paused customer: no budget, no publish, no liveness noise", async () => {
    // Three modules have to agree that silence is correct here, and they
    // reach it independently — budgets zero out, the floor holds the publish,
    // and the watchdog stays quiet.
    const t = convexTest(schema, modules);
    const customerId = await newCustomer(t, "paused_day");
    await t.run((ctx) => ctx.db.patch(customerId, { state: "paused" }));

    const customer = (await t.run((ctx) =>
      ctx.db.get(customerId)
    )) as Doc<"customers">;
    expect(budgetsFor(customer).postsPerDayPerChannel).toBe(0);

    const draftId = await t.run((ctx) =>
      ctx.db.insert("drafts", {
        customerId,
        channel: "x",
        kind: "post",
        snapshotText: "should not go out",
        outcome: "approved",
        proposedAt: MIDDAY,
        expiresAt: MIDDAY + 86_400_000,
      })
    );
    const decision = await t.query(
      internal.maya.publishDecision.decidePublish,
      { customerId, draftId, alreadyApproved: true }
    );
    expect(decision.publish).toBe(false);
    if (decision.publish) throw new Error("unreachable");
    expect(decision.reason).toBe("safety_floor");

    const facts = await t.query(internal.maya.liveness.gatherFacts, {
      customerId,
      now: EVENING,
    });
    expect(evaluate(facts!)).toEqual([]);
  });

  it("two customers run the same day without touching each other", async () => {
    const t = convexTest(schema, modules);
    const a = await newCustomer(t, "tenant_x");
    const b = await newCustomer(t, "tenant_y");

    for (const [id, angle] of [
      [a, "A's angle"],
      [b, "B's angle"],
    ] as const) {
      await t.mutation(internal.maya.dailyReport.runMorningRun, {
        customerId: id as Id<"customers">,
        plannedPosts: [{ channel: "x", angle }],
        now: MORNING,
      });
    }

    const aHistory = await t.query(internal.maya.messages.recentHistory, {
      customerId: a,
    });
    expect(aHistory).toHaveLength(1);
    expect(aHistory[0].body).toContain("A's angle");
    expect(aHistory[0].body).not.toContain("B's angle");

    // Two customers, two briefs, two jobs — and the jobs' idempotency keys
    // are scoped so one tenant's run can never satisfy the other's.
    const jobs = await t.run((ctx) => ctx.db.query("jobs").collect());
    expect(jobs).toHaveLength(2);
    expect(new Set(jobs.map((j) => j.idempotencyKey)).size).toBe(2);
  });
});
