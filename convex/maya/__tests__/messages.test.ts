import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import type { Doc, Id } from "../../_generated/dataModel";

const NOW = Date.UTC(2026, 6, 31, 12, 0, 0);

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

async function getMsg(
  t: ReturnType<typeof convexTest>,
  id: Id<"messages">
): Promise<Doc<"messages"> | null> {
  return (await t.run((ctx) => ctx.db.get(id))) as Doc<"messages"> | null;
}

describe("INVARIANT 6 — every outbound message has a dedupe key", () => {
  it("the same key never sends twice", async () => {
    // A retry after a timeout, a double-fired cron, and a watcher racing a
    // heartbeat all produce the same logical message. Saying it twice is how
    // she stops sounding like an employee.
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "dedupe");

    const first = await t.mutation(internal.maya.messages.send, {
      customerId,
      surface: "telegram",
      body: "Morning — two drafts ready.",
      dedupeKey: "brief:2026-07-31",
    });
    const retry = await t.mutation(internal.maya.messages.send, {
      customerId,
      surface: "telegram",
      body: "Morning — two drafts ready.",
      dedupeKey: "brief:2026-07-31",
    });

    expect(first.sent).toBe(true);
    expect(retry.sent).toBe(false);
    expect(retry.messageId).toBe(first.messageId);

    const rows = await t.run((ctx) => ctx.db.query("messages").collect());
    expect(rows).toHaveLength(1);
  });

  it("a different key on the same day does send", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "distinct");
    await t.mutation(internal.maya.messages.send, {
      customerId,
      surface: "telegram",
      body: "brief",
      dedupeKey: "brief:2026-07-31",
    });
    const second = await t.mutation(internal.maya.messages.send, {
      customerId,
      surface: "telegram",
      body: "recap",
      dedupeKey: "recap:2026-07-31",
    });
    expect(second.sent).toBe(true);
  });

  it("the dedupe key is REQUIRED — it isn't something a caller can forget", async () => {
    // Enforced by the validator, so there's no path that sends without one.
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "required");
    await expect(
      t.mutation(
        internal.maya.messages.send,
        {
          customerId,
          surface: "telegram",
          body: "no key",
        } as unknown as Parameters<typeof t.mutation>[1]
      )
    ).rejects.toThrow();
  });

  it("INBOUND is never deduped — if they said it twice, they meant it twice", async () => {
    // Swallowing a repeated inbound message would lose a directive.
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "inbound");
    await t.mutation(internal.maya.messages.recordInbound, {
      customerId,
      surface: "telegram",
      body: "stop posting on linkedin",
    });
    await t.mutation(internal.maya.messages.recordInbound, {
      customerId,
      surface: "telegram",
      body: "stop posting on linkedin",
    });
    const rows = await t.run((ctx) => ctx.db.query("messages").collect());
    expect(rows).toHaveLength(2);
  });
});

describe("INVARIANT 5 — at most one open question at a time", () => {
  it("a second question is refused while one is open", async () => {
    // Two open questions is how a conversation turns into a form — and worse,
    // the answer to the second gets applied to the first.
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "one_q");

    const first = await t.mutation(internal.maya.messages.askFounder, {
      customerId,
      surface: "telegram",
      body: "Which of these two angles do you prefer?",
      dedupeKey: "q:angle",
    });
    const second = await t.mutation(internal.maya.messages.askFounder, {
      customerId,
      surface: "telegram",
      body: "Also, can I get footage of the dashboard?",
      dedupeKey: "q:footage",
    });

    expect(first.asked).toBe(true);
    expect(second.asked).toBe(false);
    expect(second.blockedBy).toBe(first.messageId);

    const rows = await t.run((ctx) => ctx.db.query("messages").collect());
    expect(rows).toHaveLength(1);
  });

  it("answering frees the slot for the next one", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "answered");
    await t.mutation(internal.maya.messages.askFounder, {
      customerId,
      surface: "telegram",
      body: "first?",
      dedupeKey: "q:1",
    });
    await t.mutation(internal.maya.messages.closeOpenQuestion, { customerId });

    const next = await t.mutation(internal.maya.messages.askFounder, {
      customerId,
      surface: "telegram",
      body: "second?",
      dedupeKey: "q:2",
    });
    expect(next.asked).toBe(true);
  });

  it("supersede is a deliberate act, and it closes the old one", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "supersede");
    const first = await t.mutation(internal.maya.messages.askFounder, {
      customerId,
      surface: "telegram",
      body: "minor question",
      dedupeKey: "q:minor",
    });
    const urgent = await t.mutation(internal.maya.messages.askFounder, {
      customerId,
      surface: "telegram",
      body: "your X token expired — reconnect?",
      dedupeKey: "q:urgent",
      supersede: true,
    });

    expect(urgent.asked).toBe(true);
    expect((await getMsg(t, first.messageId!))?.awaitingAnswer).toBe(false);

    const open = await t.query(internal.maya.messages.openQuestion, {
      customerId,
    });
    expect(open?._id).toBe(urgent.messageId);
  });

  it("a re-triggered unanswered question isn't asked twice", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "retrigger");
    const first = await t.mutation(internal.maya.messages.askFounder, {
      customerId,
      surface: "telegram",
      body: "footage?",
      dedupeKey: "q:footage",
    });
    // Same question, superseding itself — a cron firing again. Dedupe still
    // has to hold, or she nags.
    const again = await t.mutation(internal.maya.messages.askFounder, {
      customerId,
      surface: "telegram",
      body: "footage?",
      dedupeKey: "q:footage",
      supersede: true,
    });
    expect(again.asked).toBe(false);
    expect(again.messageId).toBe(first.messageId);
  });

  it("the open-question slot is PER CUSTOMER, not global", async () => {
    const t = convexTest(schema, modules);
    const a = await seed(t, "q_a");
    const b = await seed(t, "q_b");
    const first = await t.mutation(internal.maya.messages.askFounder, {
      customerId: a,
      surface: "telegram",
      body: "a?",
      dedupeKey: "q:a",
    });
    const other = await t.mutation(internal.maya.messages.askFounder, {
      customerId: b,
      surface: "telegram",
      body: "b?",
      dedupeKey: "q:b",
    });
    expect(first.asked).toBe(true);
    expect(other.asked).toBe(true);
  });

  it("closing when nothing is open is a no-op, not an error", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "noop");
    expect(
      await t.mutation(internal.maya.messages.closeOpenQuestion, { customerId })
    ).toEqual({ closed: 0 });
  });
});

describe("recentHistory — what both surfaces read", () => {
  it("returns newest LAST, the shape a context block wants", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "history");
    for (let i = 0; i < 3; i += 1) {
      await t.mutation(internal.maya.messages.recordInbound, {
        customerId,
        surface: "telegram",
        body: `message ${i}`,
        ts: NOW + i * 1000,
      });
    }
    const history = await t.query(internal.maya.messages.recentHistory, {
      customerId,
    });
    expect(history.map((m) => m.body)).toEqual([
      "message 0",
      "message 1",
      "message 2",
    ]);
  });

  it("caps at the limit but keeps the MOST RECENT, not the oldest", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "cap");
    for (let i = 0; i < 10; i += 1) {
      await t.mutation(internal.maya.messages.recordInbound, {
        customerId,
        surface: "telegram",
        body: `m${i}`,
        ts: NOW + i * 1000,
      });
    }
    const history = await t.query(internal.maya.messages.recentHistory, {
      customerId,
      limit: 3,
    });
    expect(history.map((m) => m.body)).toEqual(["m7", "m8", "m9"]);
  });

  it("both surfaces are the SAME rows — they can never disagree", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "surfaces");
    await t.mutation(internal.maya.messages.recordInbound, {
      customerId,
      surface: "web",
      body: "asked on the web",
      ts: NOW,
    });
    await t.mutation(internal.maya.messages.send, {
      customerId,
      surface: "telegram",
      body: "answered in telegram",
      dedupeKey: "k",
      ts: NOW + 1,
    });
    const history = await t.query(internal.maya.messages.recentHistory, {
      customerId,
    });
    expect(history.map((m) => m.surface)).toEqual(["web", "telegram"]);
  });

  it("never leaks another customer's messages", async () => {
    const t = convexTest(schema, modules);
    const a = await seed(t, "hist_a");
    const b = await seed(t, "hist_b");
    await t.mutation(internal.maya.messages.recordInbound, {
      customerId: b,
      surface: "telegram",
      body: "B's private message",
    });
    const history = await t.query(internal.maya.messages.recentHistory, {
      customerId: a,
    });
    expect(history).toEqual([]);
  });
});

describe("proactiveSentToday — the counter behind proactiveMessagesPerDay", () => {
  it("counts only proactive outbound from today", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "proactive");

    await t.mutation(internal.maya.messages.send, {
      customerId,
      surface: "telegram",
      body: "proactive today",
      dedupeKey: "p1",
      proactive: true,
      ts: NOW,
    });
    await t.mutation(internal.maya.messages.send, {
      customerId,
      surface: "telegram",
      body: "a reply, not proactive",
      dedupeKey: "p2",
      ts: NOW,
    });
    await t.mutation(internal.maya.messages.send, {
      customerId,
      surface: "telegram",
      body: "proactive yesterday",
      dedupeKey: "p3",
      proactive: true,
      ts: NOW - 86_400_000,
    });

    expect(
      await t.query(internal.maya.messages.proactiveSentToday, {
        customerId,
        now: NOW,
      })
    ).toBe(1);
  });

  it("an inbound message never counts as an interruption she made", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "inbound_count");
    await t.mutation(internal.maya.messages.recordInbound, {
      customerId,
      surface: "telegram",
      body: "hey",
      ts: NOW,
    });
    expect(
      await t.query(internal.maya.messages.proactiveSentToday, {
        customerId,
        now: NOW,
      })
    ).toBe(0);
  });
});

/**
 * ⭐ Delivery must not wait for the cron.
 *
 * `drainJobs` had one caller — a 5-minute interval — so every message sat an
 * average of 2.5 minutes before going out. Her REPLIES route through here too,
 * which meant a founder could ask a question, watch the typing indicator stop,
 * and get the answer four minutes later. From their side that is not an
 * employee; it's a broken bot.
 *
 * The fix deliberately does NOT live in `send`: latency is the caller's call.
 * Actions with a human waiting call `deliverNow()`; batch work lets the cron
 * take it, because five minutes on a morning brief is invisible.
 */
describe("⭐ THE QUEUE IS DURABLE, NOT SLOW", () => {
  it("sending enqueues delivery rather than doing it inline", async () => {
    // Inline would mean a transient Telegram 502 silently loses the message.
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "queued");
    await t.mutation(internal.maya.messages.send, {
      customerId,
      surface: "telegram",
      body: "anything",
      dedupeKey: "queue-1",
    });
    const jobs = await t.run(async (ctx) => await ctx.db.query("jobs").collect());
    const deliver = jobs.filter((j) => j.kind === "deliver_message");
    expect(deliver).toHaveLength(1);
    expect(deliver[0].status).toBe("queued");
  });

  it("⭐ SEND ITSELF SCHEDULES NOTHING — the caller decides the urgency", async () => {
    // If `send` nudged the drain for every message, a fleet-wide brief sweep
    // would fire one action per customer to save time nobody is measuring.
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "nonudge");
    await t.mutation(internal.maya.messages.send, {
      customerId,
      surface: "telegram",
      body: "your morning brief",
      dedupeKey: "brief-no-nudge",
    });
    const scheduled = await t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).filter((f) =>
        f.name.includes("drainJobs")
      )
    );
    expect(scheduled).toHaveLength(0);
  });

  it("a deduped re-send enqueues nothing new", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "dedupejob");
    for (let i = 0; i < 2; i += 1) {
      await t.mutation(internal.maya.messages.send, {
        customerId,
        surface: "telegram",
        body: "anything",
        dedupeKey: "queue-2",
      });
    }
    const jobs = await t.run(async (ctx) => await ctx.db.query("jobs").collect());
    expect(jobs.filter((j) => j.kind === "deliver_message")).toHaveLength(1);
  });
});
