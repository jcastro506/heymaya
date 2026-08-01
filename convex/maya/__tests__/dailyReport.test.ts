import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import type { Doc, Id } from "../../_generated/dataModel";
import { composeBrief, composeRecap, dayKey, isSpecific } from "../dailyReport";

const NOW = Date.UTC(2026, 6, 31, 7, 5, 0);
const EVENING = Date.UTC(2026, 6, 31, 19, 0, 0);

async function seed(t: ReturnType<typeof convexTest>, suffix: string) {
  return await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("creators", {
      clerkUserId: `u_${suffix}`,
      email: `${suffix}@example.com`,
      channelPreference: "web",
      timezone: "UTC",
      status: "active",
      plan: "manager",
      createdAt: NOW,
    });
    return await ctx.db.insert("customers", {
      accountId,
      agentVersion: "v2",
      plan: "mvp",
      state: "active",
      timezone: "UTC",
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
}

async function place(
  t: ReturnType<typeof convexTest>,
  customerId: Id<"customers">,
  over: Partial<Doc<"placements">> = {},
  key = "k1"
) {
  await t.run((ctx) =>
    ctx.db.insert("placements", {
      customerId,
      kind: "post",
      channel: "x",
      url: "https://x.com/dana/1",
      linkStatus: "live",
      publishedAt: EVENING - 3600_000,
      snapshotText: "shipped it",
      idempotencyKey: key,
      ...over,
    })
  );
}

describe("SEND-FIRST — the brief goes out before any work", () => {
  it("sends the brief, THEN enqueues production", async () => {
    // §8: "composed and sent before any other work in the run. Three briefs
    // have orphaned historically because the message came last." Asserted by
    // observing the order, not by reading the code.
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "sendfirst");
    const result = await t.mutation(internal.maya.dailyReport.runMorningRun, {
      customerId,
      plannedPosts: [
        { channel: "x", angle: "the 3am rollback" },
        { channel: "tiktok", angle: "migration demo" },
      ],
      now: NOW,
    });
    expect(result.order).toEqual(["brief", "work"]);
    expect(result.briefSent).toBe(true);
    expect(result.jobsEnqueued).toBe(2);
  });

  it("the brief still goes out on a day with nothing planned", async () => {
    // The failure mode that orphaned three briefs: no work to do, so the run
    // ends early and the message never happens.
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "nowork");
    const result = await t.mutation(internal.maya.dailyReport.runMorningRun, {
      customerId,
      plannedPosts: [],
      now: NOW,
    });
    expect(result.briefSent).toBe(true);
    expect(result.order).toEqual(["brief"]);
  });

  it("a re-run the same day re-sends nothing", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "rerun");
    const args = {
      customerId,
      plannedPosts: [{ channel: "x", angle: "a" }],
      now: NOW,
    };
    const first = await t.mutation(internal.maya.dailyReport.runMorningRun, args);
    const second = await t.mutation(internal.maya.dailyReport.runMorningRun, args);

    expect(first.briefSent).toBe(true);
    expect(second.briefSent).toBe(false);
    expect(second.messageId).toBe(first.messageId);

    const messages = await t.run((ctx) => ctx.db.query("messages").collect());
    expect(messages).toHaveLength(1);
  });

  it("and re-running doesn't double-enqueue the work either", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "rework");
    const args = {
      customerId,
      plannedPosts: [{ channel: "x", angle: "a" }],
      now: NOW,
    };
    await t.mutation(internal.maya.dailyReport.runMorningRun, args);
    const second = await t.mutation(internal.maya.dailyReport.runMorningRun, args);
    expect(second.jobsEnqueued).toBe(0);
    // Kind-specific: a telegram send also enqueues its own delivery job, so a
    // bare count would conflate production work with message delivery.
    const jobs = (await t.run((ctx) => ctx.db.query("jobs").collect())) as Array<{
      kind: string;
    }>;
    expect(jobs.filter((j) => j.kind === "produce_post")).toHaveLength(1);
  });

  it("the next day gets its own brief", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "nextday");
    await t.mutation(internal.maya.dailyReport.runMorningRun, {
      customerId,
      plannedPosts: [],
      now: NOW,
    });
    const tomorrow = await t.mutation(internal.maya.dailyReport.runMorningRun, {
      customerId,
      plannedPosts: [],
      now: NOW + 86_400_000,
    });
    expect(tomorrow.briefSent).toBe(true);
  });
});

describe("composeBrief — specific, not a greeting", () => {
  it("names the channel and the angle", () => {
    const { text } = composeBrief({
      plannedPosts: [{ channel: "x", angle: "the 3am rollback" }],
      openQuestionCount: 0,
      blockedChannels: [],
    });
    expect(text).toContain("x");
    expect(text).toContain("the 3am rollback");
    expect(isSpecific(text)).toBe(true);
  });

  it("groups several posts on one channel", () => {
    const { text } = composeBrief({
      plannedPosts: [
        { channel: "x", angle: "rollbacks" },
        { channel: "x", angle: "pgvector" },
      ],
      openQuestionCount: 0,
      blockedChannels: [],
    });
    expect(text).toContain("2 posts");
  });

  it("says plainly when nothing is scheduled — no padding", () => {
    const { text } = composeBrief({
      plannedPosts: [],
      openQuestionCount: 0,
      blockedChannels: [],
    });
    expect(text).toBe("Nothing scheduled to go out today.");
  });

  it("names a blocked channel and why", () => {
    const { text } = composeBrief({
      plannedPosts: [{ channel: "x", angle: "a" }],
      openQuestionCount: 0,
      blockedChannels: [{ channel: "instagram", reason: "needs reconnecting" }],
    });
    expect(text).toContain("instagram is on hold: needs reconnecting");
  });

  it("mentions an outstanding question instead of asking a second one", () => {
    // Invariant 5 lives in messages.askFounder; the brief must not route
    // around it by asking again in prose.
    const { text } = composeBrief({
      plannedPosts: [{ channel: "x", angle: "a" }],
      openQuestionCount: 1,
      blockedChannels: [],
    });
    expect(text).toMatch(/waiting on your answer/i);
    expect(text).not.toMatch(/\?/);
  });
});

describe("composeRecap — a receipt, built from rows", () => {
  it("lists each placement with its link", () => {
    const { text } = composeRecap({
      placements: [
        { channel: "x", url: "https://x.com/dana/1", linkStatus: "live" },
      ],
    });
    expect(text).toContain("One post went out:");
    expect(text).toContain("https://x.com/dana/1");
  });

  it("includes metrics when there are any", () => {
    const { text } = composeRecap({
      placements: [
        {
          channel: "x",
          url: "https://x.com/dana/1",
          linkStatus: "live",
          metricsJson: JSON.stringify({ views: 4100, likes: 62, comments: 0 }),
        },
      ],
    });
    expect(text).toContain("4100 views");
    expect(text).toContain("62 likes");
    // A zero isn't worth a word.
    expect(text).not.toContain("0 comments");
  });

  it("INVARIANT 1: a placement with no URL says so, never omits it silently", () => {
    const { text } = composeRecap({
      placements: [{ channel: "tiktok", linkStatus: "unknown" }],
    });
    expect(text).toContain("link not resolved yet");
  });

  it("reports a deleted post as deleted", () => {
    const { text } = composeRecap({
      placements: [{ channel: "x", url: "https://x.com/d/1", linkStatus: "gone" }],
    });
    expect(text).toContain("no longer up");
  });

  it("HONEST ABOUT ZERO DAYS — one line, the real reason, no padding", () => {
    const { text } = composeRecap({
      placements: [],
      zeroDayReason: "your X account needs reconnecting",
    });
    expect(text).toBe("Nothing went out today — your X account needs reconnecting");
    expect(text.split("\n")).toHaveLength(1);
  });

  it("a zero day with no known reason still reports the zero", () => {
    const { text } = composeRecap({ placements: [] });
    expect(text).toBe("Nothing went out today.");
  });

  it("corrupt metrics are omitted, never reported as zero", () => {
    // A wrong number is worse than a missing one — every future number the
    // founder reads depends on this one never lying.
    const { text } = composeRecap({
      placements: [
        {
          channel: "x",
          url: "https://x.com/d/1",
          linkStatus: "live",
          metricsJson: "{not json",
        },
      ],
    });
    expect(text).toContain("https://x.com/d/1");
    expect(text).not.toMatch(/\(\)/);
  });
});

describe("sendEveningRecap through Convex", () => {
  it("builds the recap from real placements", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "recap");
    await place(t, customerId, {}, "r1");
    const result = await t.mutation(internal.maya.dailyReport.sendEveningRecap, {
      customerId,
      now: EVENING,
    });
    expect(result.count).toBe(1);
    const messages = await t.run((ctx) => ctx.db.query("messages").collect());
    expect(messages[0].body).toContain("https://x.com/dana/1");
  });

  it("never reports another customer's placements", async () => {
    const t = convexTest(schema, modules);
    const a = await seed(t, "recap_a");
    const b = await seed(t, "recap_b");
    await place(t, b, {}, "rb");
    const result = await t.mutation(internal.maya.dailyReport.sendEveningRecap, {
      customerId: a,
      now: EVENING,
    });
    expect(result.count).toBe(0);
  });

  it("yesterday's placements don't appear in today's recap", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "recap_old");
    await place(t, customerId, { publishedAt: EVENING - 86_400_000 }, "ro");
    const result = await t.mutation(internal.maya.dailyReport.sendEveningRecap, {
      customerId,
      now: EVENING,
    });
    expect(result.count).toBe(0);
  });

  it("is deduped per day like the brief", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "recap_dedupe");
    await place(t, customerId, {}, "rd");
    const first = await t.mutation(internal.maya.dailyReport.sendEveningRecap, {
      customerId,
      now: EVENING,
    });
    const second = await t.mutation(internal.maya.dailyReport.sendEveningRecap, {
      customerId,
      now: EVENING,
    });
    expect(first.sent).toBe(true);
    expect(second.sent).toBe(false);
  });

  it("STEADY STATE: exactly two proactive messages in a full day", async () => {
    // §8: "Steady state is two proactive messages a day — brief and recap."
    // Anything more has to earn the interruption.
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "steady");
    await t.mutation(internal.maya.dailyReport.runMorningRun, {
      customerId,
      plannedPosts: [{ channel: "x", angle: "a" }],
      now: NOW,
    });
    await place(t, customerId, {}, "rs");
    await t.mutation(internal.maya.dailyReport.sendEveningRecap, {
      customerId,
      now: EVENING,
    });

    const count = await t.query(internal.maya.messages.proactiveSentToday, {
      customerId,
      now: EVENING,
    });
    expect(count).toBe(2);
  });
});

describe("dayKey", () => {
  it("is the UTC date, so a re-run at 23:59 and 00:01 are different days", () => {
    expect(dayKey(Date.UTC(2026, 6, 31, 23, 59))).toBe("2026-07-31");
    expect(dayKey(Date.UTC(2026, 7, 1, 0, 1))).toBe("2026-08-01");
  });
});
