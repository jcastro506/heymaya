import { describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import type { Doc, Id } from "../../_generated/dataModel";

const NOW = Date.UTC(2026, 7, 1, 9, 0, 0);

async function seed(
  t: ReturnType<typeof convexTest>,
  suffix: string,
  telegramChatId?: string,
): Promise<Id<"customers">> {
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
      telegramChatId,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
}

async function getMsg(
  t: ReturnType<typeof convexTest>,
  id: Id<"messages">,
): Promise<Doc<"messages"> | null> {
  return (await t.run((ctx) => ctx.db.get(id))) as Doc<"messages"> | null;
}

describe("WRITTEN IS NOT DELIVERED", () => {
  it("a freshly sent message is undelivered until proven otherwise", async () => {
    // Conflating "we wrote it" with "they got it" is how the old system
    // produced eaten replies: the transcript showed a message the founder
    // never received, so every later decision was made against a conversation
    // that only existed on our side.
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "undelivered", "chat_1");
    const { messageId } = await t.mutation(internal.maya.messages.send, {
      customerId,
      surface: "telegram",
      body: "morning brief",
      dedupeKey: "brief:2026-08-01",
    });

    const row = await getMsg(t, messageId);
    expect(row?.deliveredAt).toBeUndefined();
    expect(row?.deliveryError).toBeUndefined();
  });

  it("sending enqueues a delivery job rather than sending inline", async () => {
    // Inline sending means a transient Telegram 502 silently loses a brief.
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "queued", "chat_1");
    const { messageId } = await t.mutation(internal.maya.messages.send, {
      customerId,
      surface: "telegram",
      body: "hi",
      dedupeKey: "k1",
    });

    const jobs = (await t.run((ctx) =>
      ctx.db.query("jobs").collect(),
    )) as Doc<"jobs">[];
    expect(jobs).toHaveLength(1);
    expect(jobs[0].kind).toBe("deliver_message");
    expect(jobs[0].idempotencyKey).toBe(`deliver:${messageId}`);
  });

  it("a web-surface message doesn't enqueue a Telegram delivery", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "web", "chat_1");
    await t.mutation(internal.maya.messages.send, {
      customerId,
      surface: "web",
      body: "shown in the dashboard",
      dedupeKey: "k2",
    });
    expect(await t.run((ctx) => ctx.db.query("jobs").collect())).toEqual([]);
  });

  /**
   * ⚠️ `telegram.undelivered` was deleted 2026-08-12 — no production caller.
   *
   * Its intent, "the honest answer to 'did she actually say that?'", is kept
   * and improved by `maya/delivery.fleetUnreachable` (#347): it filters to
   * sends that actually FAILED rather than listing merely-queued ones, groups
   * by customer, and is rendered on /founder. Covered by
   * `tests/deliveryUnreachable.test.ts`.
   */
});

describe("deliverMessage", () => {
  it("an unpaired account records a NAMED failure, not silence", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "unpaired"); // no chat id
    const { messageId } = await t.mutation(internal.maya.messages.send, {
      customerId,
      surface: "telegram",
      body: "hello?",
      dedupeKey: "k4",
    });

    const result = await t.action(internal.maya.telegram.deliverMessage, {
      messageId,
    });
    expect(result.delivered).toBe(false);
    expect(result.reason).toMatch(/no Telegram chat paired/);

    const row = await getMsg(t, messageId);
    expect(row?.deliveryError).toMatch(/no Telegram chat paired/);
    expect(row?.deliveredAt).toBeUndefined();
  });

  it("a delivered message is never re-sent on a job retry", async () => {
    // The queue retries. Founders notice being told the same thing twice.
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "retry", "chat_1");
    const { messageId } = await t.mutation(internal.maya.messages.send, {
      customerId,
      surface: "telegram",
      body: "already sent",
      dedupeKey: "k5",
    });
    await t.mutation(internal.maya.telegram.markDelivered, { messageId });

    const result = await t.action(internal.maya.telegram.deliverMessage, {
      messageId,
    });
    expect(result.delivered).toBe(true);
    // Proven by the fact that it short-circuits before touching the network:
    // no bot token is configured in tests, so a real attempt would have failed.
  });

  it("a missing message is reported, not thrown", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "gone", "chat_1");
    const { messageId } = await t.mutation(internal.maya.messages.send, {
      customerId,
      surface: "telegram",
      body: "x",
      dedupeKey: "k6",
    });
    await t.run((ctx) => ctx.db.delete(messageId));
    const result = await t.action(internal.maya.telegram.deliverMessage, {
      messageId,
    });
    expect(result.delivered).toBe(false);
  });

  it("marking an error clears any stale deliveredAt", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "clear", "chat_1");
    const { messageId } = await t.mutation(internal.maya.messages.send, {
      customerId,
      surface: "telegram",
      body: "x",
      dedupeKey: "k7",
    });
    await t.mutation(internal.maya.telegram.markDelivered, { messageId });
    await t.mutation(internal.maya.telegram.markDelivered, {
      messageId,
      error: "Telegram said no",
    });
    const row = await getMsg(t, messageId);
    expect(row?.deliveredAt).toBeUndefined();
    expect(row?.deliveryError).toBe("Telegram said no");
  });
});

describe("the drainer routes delivery jobs", () => {
  it("a delivery that fails leaves the job FAILED with the real reason", async () => {
    // Nothing fails silently: an undeliverable message must be visible as a
    // failed job, not a quietly-succeeded one.
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "drain_fail"); // unpaired
    await t.mutation(internal.maya.messages.send, {
      customerId,
      surface: "telegram",
      body: "will not land",
      dedupeKey: "k8",
    });

    const result = await t.action(internal.maya.scheduler.drainJobs, {});
    expect(result.claimed).toBe(1);
    expect(result.failed).toBe(1);

    const jobs = (await t.run((ctx) =>
      ctx.db.query("jobs").collect(),
    )) as Doc<"jobs">[];
    expect(jobs[0].lastError).toMatch(/no Telegram chat paired/);
  });

  it("a malformed payload is a named failure, not a crash", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "bad_payload", "chat_1");
    const { jobId } = await t.mutation(internal.maya.jobs.enqueue, {
      kind: "deliver_message",
      idempotencyKey: "bad",
      customerId,
      payloadJson: "{not json",
    });
    await t.action(internal.maya.scheduler.drainJobs, {});
    const job = (await t.run((ctx) => ctx.db.get(jobId))) as Doc<"jobs">;
    expect(job.lastError).toMatch(/not valid JSON/);
  });

  it("a payload with no messageId is named too", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "no_id", "chat_1");
    const { jobId } = await t.mutation(internal.maya.jobs.enqueue, {
      kind: "deliver_message",
      idempotencyKey: "noid",
      customerId,
      payloadJson: "{}",
    });
    await t.action(internal.maya.scheduler.drainJobs, {});
    const job = (await t.run((ctx) => ctx.db.get(jobId))) as Doc<"jobs">;
    expect(job.lastError).toMatch(/no messageId/);
  });
});

describe("inbound", () => {
  it("records a message from a paired chat", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "inbound", "chat_42");
    const result = await t.mutation(internal.maya.telegram.receiveInbound, {
      chatId: "chat_42",
      text: "stop posting on linkedin",
      ts: NOW,
    });
    expect(result.recorded).toBe(true);

    const history = await t.query(internal.maya.messages.recentHistory, {
      customerId,
    });
    expect(history[0].body).toBe("stop posting on linkedin");
    expect(history[0].direction).toBe("in");
  });

  it("an UNPAIRED chat is dropped with a reason and mints nothing", async () => {
    // Someone who found the bot, or a pairing that hasn't finished. Neither
    // should create a customer.
    const t = convexTest(schema, modules);
    await seed(t, "other", "chat_1");
    const result = await t.mutation(internal.maya.telegram.receiveInbound, {
      chatId: "chat_stranger",
      text: "hello?",
    });
    expect(result.recorded).toBe(false);
    expect(result.reason).toBe("unpaired chat");
    expect(await t.run((ctx) => ctx.db.query("messages").collect())).toEqual(
      [],
    );
    expect(
      await t.run((ctx) => ctx.db.query("customers").collect()),
    ).toHaveLength(1);
  });

  it("an empty message is ignored", async () => {
    const t = convexTest(schema, modules);
    await seed(t, "empty", "chat_1");
    const result = await t.mutation(internal.maya.telegram.receiveInbound, {
      chatId: "chat_1",
      text: "   ",
    });
    expect(result.recorded).toBe(false);
  });

  it("AN INBOUND MESSAGE CLOSES THE OPEN QUESTION", async () => {
    // Invariant 5 allows one open question. If answering never closed it, she
    // could never ask a second one — permanently mute after the first ask.
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "answers", "chat_7");
    await t.mutation(internal.maya.messages.askFounder, {
      customerId,
      surface: "telegram",
      body: "which angle?",
      dedupeKey: "q1",
    });
    expect(
      await t.query(internal.maya.messages.openQuestion, { customerId }),
    ).not.toBeNull();

    await t.mutation(internal.maya.telegram.receiveInbound, {
      chatId: "chat_7",
      text: "the second one",
    });

    expect(
      await t.query(internal.maya.messages.openQuestion, { customerId }),
    ).toBeNull();
    // And she can ask again.
    const next = await t.mutation(internal.maya.messages.askFounder, {
      customerId,
      surface: "telegram",
      body: "footage?",
      dedupeKey: "q2",
    });
    expect(next.asked).toBe(true);
  });

  it("one customer's chat never resolves to another's account", async () => {
    const t = convexTest(schema, modules);
    const a = await seed(t, "chat_a", "chat_aaa");
    await seed(t, "chat_b", "chat_bbb");
    await t.mutation(internal.maya.telegram.receiveInbound, {
      chatId: "chat_aaa",
      text: "A's message",
    });
    const history = await t.query(internal.maya.messages.recentHistory, {
      customerId: a,
    });
    expect(history).toHaveLength(1);
  });
});
