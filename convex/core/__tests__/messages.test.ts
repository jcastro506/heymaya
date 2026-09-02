import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { seedCreator } from "../../../tests/lib/creatorRow";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import type { Doc, Id } from "../../_generated/dataModel";

const NOW = Date.UTC(2026, 6, 31, 12, 0, 0);

async function seed(t: ReturnType<typeof convexTest>, suffix: string) {
  return await t.run(async (ctx) => seedCreator(ctx, suffix, { timezone: "UTC" }));
}

async function getMsg(
  t: ReturnType<typeof convexTest>,
  id: Id<"messages">,
): Promise<Doc<"messages"> | null> {
  return (await t.run((ctx) => ctx.db.get(id))) as Doc<"messages"> | null;
}

describe("INVARIANT 6 — every outbound message has a dedupe key", () => {
  it("the same key never sends twice", async () => {
    // A retry after a timeout, a double-fired cron, and a watcher racing a
    // heartbeat all produce the same logical message. Saying it twice is how
    // she stops sounding like an employee.
    const t = convexTest(schema, modules);
    const creatorId = await seed(t, "dedupe");

    const first = await t.mutation(internal.core.messages.send, {
      creatorId,
      surface: "telegram",
      body: "Morning — two drafts ready.",
      dedupeKey: "brief:2026-07-31",
    });
    const retry = await t.mutation(internal.core.messages.send, {
      creatorId,
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
    const creatorId = await seed(t, "distinct");
    await t.mutation(internal.core.messages.send, {
      creatorId,
      surface: "telegram",
      body: "brief",
      dedupeKey: "brief:2026-07-31",
    });
    const second = await t.mutation(internal.core.messages.send, {
      creatorId,
      surface: "telegram",
      body: "recap",
      dedupeKey: "recap:2026-07-31",
    });
    expect(second.sent).toBe(true);
  });

  it("the dedupe key is REQUIRED — it isn't something a caller can forget", async () => {
    // Enforced by the validator, so there's no path that sends without one.
    const t = convexTest(schema, modules);
    const creatorId = await seed(t, "required");
    await expect(
      t.mutation(internal.core.messages.send, {
        creatorId,
        surface: "telegram",
        body: "no key",
      } as unknown as Parameters<typeof t.mutation>[1]),
    ).rejects.toThrow();
  });

  it("INBOUND is never deduped — if they said it twice, they meant it twice", async () => {
    // Swallowing a repeated inbound message would lose a directive.
    const t = convexTest(schema, modules);
    const creatorId = await seed(t, "inbound");
    await t.mutation(internal.core.messages.recordInbound, {
      creatorId,
      surface: "telegram",
      body: "stop posting on linkedin",
    });
    await t.mutation(internal.core.messages.recordInbound, {
      creatorId,
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
    const creatorId = await seed(t, "one_q");

    const first = await t.mutation(internal.core.messages.askFounder, {
      creatorId,
      surface: "telegram",
      body: "Which of these two angles do you prefer?",
      dedupeKey: "q:angle",
    });
    const second = await t.mutation(internal.core.messages.askFounder, {
      creatorId,
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
    const creatorId = await seed(t, "answered");
    await t.mutation(internal.core.messages.askFounder, {
      creatorId,
      surface: "telegram",
      body: "first?",
      dedupeKey: "q:1",
    });
    /**
     * ⚠️ Closed by patching the row. `closeOpenQuestion` was deleted
     * 2026-08-12 (no production caller — `expireStaleQuestions` is the wired
     * path). This test is about the SLOT freeing up, so the close is fixture
     * setup rather than the behaviour under test.
     */
    await t.run(async (ctx) => {
      const open = await ctx.db
        .query("messages")
        .withIndex("by_creator_and_awaiting", (q) =>
          q.eq("creatorId", creatorId).eq("awaitingAnswer", true),
        )
        .collect();
      for (const row of open) {
        await ctx.db.patch(row._id, { awaitingAnswer: false });
      }
    });

    const next = await t.mutation(internal.core.messages.askFounder, {
      creatorId,
      surface: "telegram",
      body: "second?",
      dedupeKey: "q:2",
    });
    expect(next.asked).toBe(true);
  });

  it("supersede is a deliberate act, and it closes the old one", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seed(t, "supersede");
    const first = await t.mutation(internal.core.messages.askFounder, {
      creatorId,
      surface: "telegram",
      body: "minor question",
      dedupeKey: "q:minor",
    });
    const urgent = await t.mutation(internal.core.messages.askFounder, {
      creatorId,
      surface: "telegram",
      body: "your X token expired — reconnect?",
      dedupeKey: "q:urgent",
      supersede: true,
    });

    expect(urgent.asked).toBe(true);
    expect((await getMsg(t, first.messageId!))?.awaitingAnswer).toBe(false);

    const open = await t.query(internal.core.messages.openQuestion, {
      creatorId,
    });
    expect(open?._id).toBe(urgent.messageId);
  });

  it("a re-triggered unanswered question isn't asked twice", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seed(t, "retrigger");
    const first = await t.mutation(internal.core.messages.askFounder, {
      creatorId,
      surface: "telegram",
      body: "footage?",
      dedupeKey: "q:footage",
    });
    // Same question, superseding itself — a cron firing again. Dedupe still
    // has to hold, or she nags.
    const again = await t.mutation(internal.core.messages.askFounder, {
      creatorId,
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
    const first = await t.mutation(internal.core.messages.askFounder, {
      creatorId: a,
      surface: "telegram",
      body: "a?",
      dedupeKey: "q:a",
    });
    const other = await t.mutation(internal.core.messages.askFounder, {
      creatorId: b,
      surface: "telegram",
      body: "b?",
      dedupeKey: "q:b",
    });
    expect(first.asked).toBe(true);
    expect(other.asked).toBe(true);
  });

  /**
   * ⚠️ `closeOpenQuestion` was deleted 2026-08-12 — it had no production
   * caller, which is exactly what the INVARIANT 8 suite below records: its own
   * comment stated the rule and nothing invoked it. `expireStaleQuestions` is
   * the wired path and is covered there.
   */
});

describe("recentHistory — what both surfaces read", () => {
  it("returns newest LAST, the shape a context block wants", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seed(t, "history");
    for (let i = 0; i < 3; i += 1) {
      await t.mutation(internal.core.messages.recordInbound, {
        creatorId,
        surface: "telegram",
        body: `message ${i}`,
        ts: NOW + i * 1000,
      });
    }
    const history = await t.query(internal.core.messages.recentHistory, {
      creatorId,
    });
    expect(history.map((m) => m.body)).toEqual([
      "message 0",
      "message 1",
      "message 2",
    ]);
  });

  it("caps at the limit but keeps the MOST RECENT, not the oldest", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seed(t, "cap");
    for (let i = 0; i < 10; i += 1) {
      await t.mutation(internal.core.messages.recordInbound, {
        creatorId,
        surface: "telegram",
        body: `m${i}`,
        ts: NOW + i * 1000,
      });
    }
    const history = await t.query(internal.core.messages.recentHistory, {
      creatorId,
      limit: 3,
    });
    expect(history.map((m) => m.body)).toEqual(["m7", "m8", "m9"]);
  });

  it("both surfaces are the SAME rows — they can never disagree", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seed(t, "surfaces");
    await t.mutation(internal.core.messages.recordInbound, {
      creatorId,
      surface: "web",
      body: "asked on the web",
      ts: NOW,
    });
    await t.mutation(internal.core.messages.send, {
      creatorId,
      surface: "telegram",
      body: "answered in telegram",
      dedupeKey: "k",
      ts: NOW + 1,
    });
    const history = await t.query(internal.core.messages.recentHistory, {
      creatorId,
    });
    expect(history.map((m) => m.surface)).toEqual(["web", "telegram"]);
  });

  it("never leaks another creator's messages", async () => {
    const t = convexTest(schema, modules);
    const a = await seed(t, "hist_a");
    const b = await seed(t, "hist_b");
    await t.mutation(internal.core.messages.recordInbound, {
      creatorId: b,
      surface: "telegram",
      body: "B's private message",
    });
    const history = await t.query(internal.core.messages.recentHistory, {
      creatorId: a,
    });
    expect(history).toEqual([]);
  });
});

describe("proactiveSentToday — the counter behind proactiveMessagesPerDay", () => {
  it("counts only proactive outbound from today", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seed(t, "proactive");

    await t.mutation(internal.core.messages.send, {
      creatorId,
      surface: "telegram",
      body: "proactive today",
      dedupeKey: "p1",
      proactive: true,
      ts: NOW,
    });
    await t.mutation(internal.core.messages.send, {
      creatorId,
      surface: "telegram",
      body: "a reply, not proactive",
      dedupeKey: "p2",
      ts: NOW,
    });
    await t.mutation(internal.core.messages.send, {
      creatorId,
      surface: "telegram",
      body: "proactive yesterday",
      dedupeKey: "p3",
      proactive: true,
      ts: NOW - 86_400_000,
    });

    expect(
      await t.query(internal.core.messages.proactiveSentToday, {
        creatorId,
        now: NOW,
      }),
    ).toBe(1);
  });

  it("an inbound message never counts as an interruption she made", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seed(t, "inbound_count");
    await t.mutation(internal.core.messages.recordInbound, {
      creatorId,
      surface: "telegram",
      body: "hey",
      ts: NOW,
    });
    expect(
      await t.query(internal.core.messages.proactiveSentToday, {
        creatorId,
        now: NOW,
      }),
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
    const creatorId = await seed(t, "queued");
    await t.mutation(internal.core.messages.send, {
      creatorId,
      surface: "telegram",
      body: "anything",
      dedupeKey: "queue-1",
    });
    const jobs = await t.run(
      async (ctx) => await ctx.db.query("jobs").collect(),
    );
    const deliver = jobs.filter((j) => j.kind === "deliver_message");
    expect(deliver).toHaveLength(1);
    expect(deliver[0].status).toBe("queued");
  });

  it("⭐ SEND ITSELF SCHEDULES NOTHING — the caller decides the urgency", async () => {
    // If `send` nudged the drain for every message, a fleet-wide brief sweep
    // would fire one action per creator to save time nobody is measuring.
    const t = convexTest(schema, modules);
    const creatorId = await seed(t, "nonudge");
    await t.mutation(internal.core.messages.send, {
      creatorId,
      surface: "telegram",
      body: "your morning brief",
      dedupeKey: "brief-no-nudge",
    });
    const scheduled = await t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).filter(
        (f) => f.name.includes("drainJobs"),
      ),
    );
    expect(scheduled).toHaveLength(0);
  });

  it("a deduped re-send enqueues nothing new", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seed(t, "dedupejob");
    for (let i = 0; i < 2; i += 1) {
      await t.mutation(internal.core.messages.send, {
        creatorId,
        surface: "telegram",
        body: "anything",
        dedupeKey: "queue-2",
      });
    }
    const jobs = await t.run(
      async (ctx) => await ctx.db.query("jobs").collect(),
    );
    expect(jobs.filter((j) => j.kind === "deliver_message")).toHaveLength(1);
  });
});

/**
 * ⭐ THE 2026-08-06 FAILURE, one layer under the drafts one.
 *
 * `askFounder` did its own `ctx.db.insert` instead of going through `send`'s
 * write path. `send`'s own comment claims *"every outbound message funnels
 * through this function, which makes it the only place a guard can be
 * complete"* — and that was false.
 *
 * Two consequences, both silent:
 *   - no `deliver_message` job, so EVERY question she ever asked was written
 *     to the table and never sent to Telegram
 *   - no plain-language guard, so the one path that most often interpolates
 *     machine strings was the one path with no backstop
 *
 * Caught by reading a real row: `awaitingAnswer: true`, `deliveredAt: null`,
 * and no job that would ever move it.
 */
describe("ONE WRITER — a question is a message, not a row", () => {
  async function jobsFor(
    t: ReturnType<typeof convexTest>,
    creatorId: Id<"creators">,
  ) {
    // The schema sits at TypeScript's instantiation ceiling, so the query
    // builder stops narrowing indexes on this table — collect and filter in
    // JS, as the sibling tests above do.
    const all = (await t.run((ctx) =>
      ctx.db.query("jobs").collect(),
    )) as Array<{
      kind: string;
      creatorId: Id<"creators">;
    }>;
    return all.filter((j) => j.creatorId === creatorId);
  }

  it("askFounder enqueues delivery, exactly as send does", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seed(t, "askdeliver");

    await t.mutation(internal.core.messages.askFounder, {
      creatorId,
      surface: "telegram",
      body: "want this to go out?",
      dedupeKey: "q:one",
    });

    const jobs = await jobsFor(t, creatorId);
    // The regression: this was zero, so the question never left the database.
    expect(jobs.filter((j) => j.kind === "deliver_message")).toHaveLength(1);
  });

  it("askFounder runs the plain-language guard", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seed(t, "askplain");

    await t.mutation(internal.core.messages.askFounder, {
      creatorId,
      surface: "telegram",
      // The exact shape §2.5 exists to catch: a machine string interpolated
      // into a body by code, not written by her.
      body: "Zernio returned a 502 — want me to retry?",
      dedupeKey: "q:leak",
    });

    const msg = await t.run((ctx) =>
      ctx.db
        .query("messages")
        .withIndex("by_creator_and_dedupe", (q) =>
          q.eq("creatorId", creatorId).eq("dedupeKey", "q:leak"),
        )
        .first(),
    );
    // The point of this test is that askFounder RUNS the guard at all — it
    // previously ran none. Note the guard replaces the whole body rather than
    // excising the token, so the question's wording does not survive; the
    // message still goes out, which is what "redacted, never dropped" means.
    expect(msg?.body).not.toContain("502");
    expect(msg?.body).not.toContain("Zernio");
    expect(msg?.body).toBeTruthy();
  });

  it("a deduped question does not enqueue a second delivery", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seed(t, "askdedupe");
    for (let i = 0; i < 3; i += 1) {
      await t.mutation(internal.core.messages.askFounder, {
        creatorId,
        surface: "telegram",
        body: "same question",
        dedupeKey: "q:same",
      });
    }
    const jobs = await jobsFor(t, creatorId);
    expect(jobs.filter((j) => j.kind === "deliver_message")).toHaveLength(1);
  });
});

/**
 * ⭐ THE BUG THAT BROKE THE CADENCE (2026-08-10)
 *
 * A question asked on 08-08 — "Do you want to publish the pending draft…?" —
 * was never answered. `askFounder` refuses a second question while one is
 * outstanding, so every ask for the next two days returned
 * `{asked: false, blockedBy}`. She woke, sent her brief, and could offer
 * nothing. Two zero-placement days, with no signal anywhere.
 *
 * `closeOpenQuestion`'s own comment already stated the invariant — *"an open
 * question is a non-terminal state, so something has to be able to end it other
 * than an answer that may never come"* — and nothing called it.
 */
describe("INVARIANT 8 — an unanswered question cannot block her forever", () => {
  it("expires a question left open from a previous day", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seed(t, "expire_prev");

    const asked = await t.mutation(internal.core.messages.askFounder, {
      creatorId,
      body: "Do you want to publish this?",
      dedupeKey: "ask:day-one",
      surface: "telegram",
      ts: NOW,
    });
    expect(asked.asked).toBe(true);

    // A day later, still unanswered.
    const nextDay = NOW + 26 * 60 * 60 * 1000;
    const out = await t.mutation(internal.core.messages.expireStaleQuestions, {
      creatorId,
      now: nextDay,
    });
    expect(out.expired).toBe(1);

    // ⭐ The point: she can ask again.
    const again = await t.mutation(internal.core.messages.askFounder, {
      creatorId,
      body: "Different question",
      dedupeKey: "ask:day-two",
      surface: "telegram",
      ts: nextDay,
    });
    expect(again.asked).toBe(true);
  });

  it("leaves today's question alone — the answer may still be coming", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seed(t, "expire_today");

    await t.mutation(internal.core.messages.askFounder, {
      creatorId,
      body: "Publish this?",
      dedupeKey: "ask:today",
      surface: "telegram",
      ts: NOW,
    });

    // Four hours later, same day.
    const out = await t.mutation(internal.core.messages.expireStaleQuestions, {
      creatorId,
      now: NOW + 4 * 60 * 60 * 1000,
    });
    expect(out.expired).toBe(0);

    // Still correctly blocked — one open question at a time is the rule.
    const second = await t.mutation(internal.core.messages.askFounder, {
      creatorId,
      body: "Another",
      dedupeKey: "ask:today-2",
      surface: "telegram",
      ts: NOW + 4 * 60 * 60 * 1000,
    });
    expect(second.asked).toBe(false);
  });

  it("is idempotent — a sweep every ten minutes must not thrash", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seed(t, "expire_idem");
    await t.mutation(internal.core.messages.askFounder, {
      creatorId,
      body: "Publish this?",
      dedupeKey: "ask:once",
      surface: "telegram",
      ts: NOW,
    });
    const later = NOW + 26 * 60 * 60 * 1000;
    expect(
      (
        await t.mutation(internal.core.messages.expireStaleQuestions, {
          creatorId,
          now: later,
        })
      ).expired,
    ).toBe(1);
    expect(
      (
        await t.mutation(internal.core.messages.expireStaleQuestions, {
          creatorId,
          now: later,
        })
      ).expired,
    ).toBe(0);
  });

  it("does not touch another account's open question", async () => {
    const t = convexTest(schema, modules);
    const a = await seed(t, "expire_a");
    const b = await seed(t, "expire_b");
    await t.mutation(internal.core.messages.askFounder, {
      creatorId: b,
      body: "B's question",
      dedupeKey: "ask:b",
      surface: "telegram",
      ts: NOW,
    });

    const out = await t.mutation(internal.core.messages.expireStaleQuestions, {
      creatorId: a,
      now: NOW + 26 * 60 * 60 * 1000,
    });
    expect(out.expired).toBe(0);

    // B's is still open, and B is still correctly blocked.
    const bStill = await t.query(internal.core.messages.openQuestion, {
      creatorId: b,
    });
    expect(bStill).not.toBeNull();
  });
});
