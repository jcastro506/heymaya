/**
 * The message log (§3.2) — one table both surfaces read.
 *
 * Every message persists here: inbound from the founder, outbound proactive,
 * cron receipts. Recent history is injected into her context on every turn.
 * Without this she repeats herself and invents things she never sent — both
 * have happened live, which is why this is a table and not a context window.
 *
 * Two of the nine data-model invariants are enforced here, and they're
 * enforced in the WRITE PATH rather than by convention:
 *
 *   5. At most one open question to the founder at a time.
 *   6. Every outbound message has a dedupe key.
 *
 * Invariant 6 is the reason `send` takes a required `dedupeKey`: a retry, a
 * double-fired cron, and a watcher racing a heartbeat all produce the same
 * logical message, and saying it twice is how she stops sounding like an
 * employee. The key is the contract; the table enforces it.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
// ⚠️ Static. Convex MUTATIONS cannot do dynamic imports — only actions can, and
// the failure is a runtime `dynamic module import unsupported`, not a compile
// error, so it surfaces the first time the mutation actually runs.
import { dayKeyInZone } from "./cadence";
import { checkPlainLanguage } from "./plainLanguage";
import { dayScanFloor, isSameDayInZone } from "./cadence";

const SURFACE = v.union(
  v.literal("telegram"),
  v.literal("web"),
  v.literal("system")
);

async function getMessage(
  ctx: QueryCtx | MutationCtx,
  id: Id<"messages">
): Promise<Doc<"messages"> | null> {
  // The schema is at TypeScript's instantiation ceiling, so `db.get` returns a
  // union of every table's doc type instead of narrowing.
  return (await ctx.db.get(id)) as Doc<"messages"> | null;
}

/** Record something the founder said. Inbound is never deduped — if they sent
 *  it twice, they meant it twice, and swallowing one would lose a directive. */
export const recordInbound = internalMutation({
  args: {
    customerId: v.id("customers"),
    surface: SURFACE,
    body: v.string(),
    turnId: v.optional(v.string()),
    ts: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ messageId: Id<"messages"> }> => {
    const messageId = await ctx.db.insert("messages", {
      customerId: args.customerId,
      direction: "in",
      surface: args.surface,
      body: args.body,
      turnId: args.turnId,
      ts: args.ts ?? Date.now(),
    });
    return { messageId };
  },
});

/**
 * Send something outbound — idempotently.
 *
 * `dedupeKey` is required, not optional. Returns `sent: false` with the
 * original id when the key has already been used, so a caller retrying after a
 * timeout re-sends nothing and can't tell the difference.
 *
 * Scope the key to the thing it's about, not to the moment: `brief:<date>`,
 * not `brief:<timestamp>`.
 */

/**
 * ⭐ THE ONE WRITER. Every outbound message goes through here.
 *
 * Two things must happen for a message to actually reach a founder, and both
 * were previously duplicated in `send` and simply missing from `askFounder`:
 *
 *  1. **The plain-language guard** — the last thing between her machinery and
 *     their chat. It catches the class the prompt structurally cannot: strings
 *     she never wrote, interpolated by code. `ingestFromTelegram` returned
 *     `error.message` and `telegramFiles` put it straight into a body, so an
 *     R2 failure would have reached a founder as "The specified bucket does
 *     not exist". Redacted, never dropped (§2.5) — the LOG keeps the original
 *     so an operator can find the source instead of guessing.
 *
 *  2. **The delivery job** — delivery is a JOB, not a side effect of writing.
 *     Sending inline would mean a transient Telegram 502 silently loses a
 *     brief; through the queue it retries with backoff and, failing that,
 *     lands in the dead-letter view where someone can see it.
 *
 * A second write path that skips either one is not a shortcut, it is a message
 * that never arrives. That is precisely what `askFounder` was.
 */
async function writeOutbound(
  ctx: MutationCtx,
  row: {
    customerId: Id<"customers">;
    surface: "telegram" | "web" | "system";
    body: string;
    dedupeKey: string;
    proactive?: boolean;
    awaitingAnswer?: boolean;
    turnId?: string;
    ts: number;
  }
): Promise<Id<"messages">> {
  const plain = checkPlainLanguage(row.body);
  if (!plain.ok) {
    console.error(
      `[messages] redacted ${plain.redacted.join(", ")} from ${row.dedupeKey}: ${row.body}`
    );
  }

  const messageId = await ctx.db.insert("messages", {
    customerId: row.customerId,
    direction: "out",
    surface: row.surface,
    body: plain.clean,
    dedupeKey: row.dedupeKey,
    proactive: row.proactive,
    awaitingAnswer: row.awaitingAnswer,
    turnId: row.turnId,
    ts: row.ts,
  });

  if (row.surface === "telegram") {
    await ctx.runMutation(internal.maya.jobs.enqueue, {
      kind: "deliver_message",
      idempotencyKey: `deliver:${messageId}`,
      customerId: row.customerId,
      payloadJson: JSON.stringify({ messageId }),
    });
  }

  return messageId;
}

export const send = internalMutation({
  args: {
    customerId: v.id("customers"),
    surface: SURFACE,
    body: v.string(),
    dedupeKey: v.string(),
    proactive: v.optional(v.boolean()),
    turnId: v.optional(v.string()),
    ts: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ messageId: Id<"messages">; sent: boolean }> => {
    // Scoped to the customer. `brief:2026-07-31` is the same string for every
    // customer in the fleet, so a global dedupe lookup silently suppressed
    // everyone's brief after the first — found by the fleet sweep, invisible
    // to any single-customer test.
    const existing = await ctx.db
      .query("messages")
      .withIndex("by_customer_and_dedupe", (q) =>
        q.eq("customerId", args.customerId).eq("dedupeKey", args.dedupeKey)
      )
      .first();
    if (existing) return { messageId: existing._id, sent: false };

    // ⭐ One writer — the plain-language guard and the delivery job both live
    // in `writeOutbound`. `askFounder` skipped this block entirely when it was
    // inline here, and its questions were never delivered.
    const messageId = await writeOutbound(ctx, {
      customerId: args.customerId,
      surface: args.surface,
      body: args.body,
      dedupeKey: args.dedupeKey,
      proactive: args.proactive,
      turnId: args.turnId,
      ts: args.ts ?? Date.now(),
    });

    /**
     * ⭐ Delivery latency is the CALLER's call, not this function's.
     *
     * `drainJobs` had exactly one caller — a 5-minute interval cron — so every
     * message sat in the queue an average of two and a half minutes,
     * including her replies. Anything with a human waiting calls
     * `deliverNow()` (scheduler.ts) straight after this, which drains inline
     * and returns once the message is actually out. Batch work — a brief, a
     * recap — just lets the cron pick it up.
     */

    return { messageId, sent: true };
  },
});

/**
 * Ask the founder something, enforcing invariant 5: at most one open question
 * at a time.
 *
 * If a question is already open, this does NOT send. Two open questions is how
 * a conversation turns into a form — and worse, the answer to the second gets
 * applied to the first. The caller gets the existing question back so it can
 * decide whether to wait or supersede.
 *
 * `supersede: true` closes the outstanding question first, for the case where
 * the new one genuinely matters more. That's a deliberate act with a name, not
 * a side effect.
 */
export const askFounder = internalMutation({
  args: {
    customerId: v.id("customers"),
    surface: SURFACE,
    body: v.string(),
    dedupeKey: v.string(),
    supersede: v.optional(v.boolean()),
    ts: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    messageId: Id<"messages"> | null;
    asked: boolean;
    blockedBy?: Id<"messages">;
  }> => {
    const open = await ctx.db
      .query("messages")
      .withIndex("by_customer_and_awaiting", (q) =>
        q.eq("customerId", args.customerId).eq("awaitingAnswer", true)
      )
      .first();

    if (open && !args.supersede) {
      return { messageId: null, asked: false, blockedBy: open._id };
    }
    if (open && args.supersede) {
      await ctx.db.patch(open._id, { awaitingAnswer: false });
    }

    // Still deduped: an unanswered question that gets re-triggered by a cron
    // must not be asked twice.
    const existing = await ctx.db
      .query("messages")
      .withIndex("by_customer_and_dedupe", (q) =>
        q.eq("customerId", args.customerId).eq("dedupeKey", args.dedupeKey)
      )
      .first();
    if (existing) return { messageId: existing._id, asked: false };

    /**
     * ⚠️ This used to `ctx.db.insert` directly, and that was two bugs.
     *
     * `send`'s comment claims *"every outbound message funnels through this
     * function, which makes it the only place a guard can be complete."* This
     * one didn't, so it got **neither** the plain-language guard **nor** the
     * `deliver_message` job — meaning every question she has ever asked was
     * written to the table and never sent to Telegram at all.
     *
     * Caught 2026-08-06 by watching a real row: a draft question was created
     * with `awaitingAnswer: true` and `deliveredAt: null`, and nothing was
     * ever going to move it, because delivery is enqueued and no job existed.
     *
     * Now both paths share one writer, so the claim in that comment is true.
     */
    const messageId = await writeOutbound(ctx, {
      customerId: args.customerId,
      surface: args.surface,
      body: args.body,
      dedupeKey: args.dedupeKey,
      proactive: true,
      awaitingAnswer: true,
      ts: args.ts ?? Date.now(),
    });
    return { messageId, asked: true };
  },
});

/**
 * ⭐ Close the question about ONE thing, by its key.
 *
 * `closeOpenQuestion` closes whatever happens to be open. This closes a
 * specific one, which is what a publish needs: the founder should not be left
 * holding *"want this to go out?"* for something that went out a minute ago —
 * and while that question stays open, invariant 5 means the NEXT draft can
 * never reach them.
 *
 * That exact chain stalled a day of the seven-day run on 2026-08-07.
 *
 * Silent when nothing is open under that key: publishing on `just_go` never
 * asked anything, and treating that as a failure would make the normal path
 * noisy.
 */
export const closeQuestionFor = internalMutation({
  args: { customerId: v.id("customers"), dedupeKey: v.string() },
  handler: async (ctx, args): Promise<{ closed: boolean }> => {
    const row = (await ctx.db
      .query("messages")
      .withIndex("by_customer_and_dedupe", (q) =>
        q.eq("customerId", args.customerId).eq("dedupeKey", args.dedupeKey)
      )
      .first()) as Doc<"messages"> | null;
    if (!row?.awaitingAnswer) return { closed: false };
    await ctx.db.patch(row._id, { awaitingAnswer: false });
    return { closed: true };
  },
});

/**
 * Close the open question.
 *
 * Called when the founder answers — or when the question stops mattering.
 * Invariant 8: an open question is a non-terminal state, so something has to
 * be able to end it other than an answer that may never come.
 */
export const closeOpenQuestion = internalMutation({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args): Promise<{ closed: number }> => {
    const open = await ctx.db
      .query("messages")
      .withIndex("by_customer_and_awaiting", (q) =>
        q.eq("customerId", args.customerId).eq("awaitingAnswer", true)
      )
      .collect();
    for (const row of open) {
      await ctx.db.patch(row._id, { awaitingAnswer: false });
    }
    return { closed: open.length };
  },
});

/** The one open question, if there is one. */
export const openQuestion = internalQuery({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args): Promise<Doc<"messages"> | null> =>
    await ctx.db
      .query("messages")
      .withIndex("by_customer_and_awaiting", (q) =>
        q.eq("customerId", args.customerId).eq("awaitingAnswer", true)
      )
      .first(),
});

/**
 * Recent history, newest last — the shape a context block wants.
 *
 * Both surfaces read this. The web transcript and the Telegram thread are the
 * same rows, so they can never disagree about what she said.
 */
export const recentHistory = internalQuery({
  args: { customerId: v.id("customers"), limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<Doc<"messages">[]> => {
    const rows = await ctx.db
      .query("messages")
      .withIndex("by_customer_and_ts", (q) => q.eq("customerId", args.customerId))
      .order("desc")
      .take(args.limit ?? 50);
    return rows.reverse();
  },
});

/**
 * How many proactive messages went out today — the counter behind
 * `proactiveMessagesPerDay`.
 *
 * Counts real rows rather than a tally, for the same reason the post budget
 * does: a lost decrement shouldn't quietly grant her another interruption.
 */
export const proactiveSentToday = internalQuery({
  args: { customerId: v.id("customers"), now: v.optional(v.number()) },
  handler: async (ctx, args): Promise<number> => {
    const now = args.now ?? Date.now();
    // ⚠️ The founder's day, not UTC. On the old boundary her daily allowance
    // reset at 20:00 local, so she could spend it during the evening and then
    // spend it again two hours later — the budget silently doubled on exactly
    // the evenings she is most active.
    const customer = (await ctx.db.get(args.customerId)) as Doc<"customers"> | null;
    const timezone = customer?.timezone ?? "UTC";
    const rows = await ctx.db
      .query("messages")
      .withIndex("by_customer_and_ts", (q) =>
        q.eq("customerId", args.customerId).gte("ts", dayScanFloor(now))
      )
      .collect();
    return rows.filter(
      (row) =>
        row.direction === "out" &&
        row.proactive === true &&
        isSameDayInZone(row.ts, now, timezone)
    ).length;
  },
});

/** Re-exported for tests and callers that need to read one row back. */
export { getMessage };

/**
 * ⭐ An unanswered question must not block her forever.
 *
 * ⚠️ **This is the bug that broke the cadence.** Measured 2026-08-10: a
 * question asked on 08-08 — *"Do you want to publish the pending draft…?"* —
 * was never answered. `askFounder` refuses a second question while one is
 * outstanding, so every ask for the next two days returned
 * `{asked: false, blockedBy}`. She woke up, sent her brief, and could not offer
 * anything. Two zero-placement days, and nothing said why.
 *
 * The invariant was already written down. `closeOpenQuestion`'s own comment
 * says: *"Invariant 8: an open question is a non-terminal state, so something
 * has to be able to end it other than an answer that may never come."* The
 * function existed. **Nothing called it.**
 *
 * ## Expiry is by the founder's DAY, not by a fixed number of hours
 *
 * The question she asks is *"shall I post this today"*, and it stops being
 * askable when today ends. A fixed TTL would either expire mid-afternoon —
 * cutting off an answer that was still coming — or survive into a day where the
 * draft it names is already stale.
 *
 * ⚠️ **Expiring is not approval.** The draft stays `pending` and unpublished.
 * All this restores is her ability to ask about something else, which is the
 * thing that was actually broken.
 */
export const expireStaleQuestions = internalMutation({
  args: { customerId: v.id("customers"), now: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<{ expired: number; question?: string }> => {
    const customer = (await ctx.db.get(args.customerId)) as Doc<"customers"> | null;
    if (!customer) return { expired: 0 };

    const now = args.now ?? Date.now();
    const today = dayKeyInZone(now, customer.timezone ?? "UTC");

    const open = (await ctx.db
      .query("messages")
      .withIndex("by_customer_and_awaiting", (q) =>
        q.eq("customerId", args.customerId).eq("awaitingAnswer", true)
      )
      .collect()) as Doc<"messages">[];

    let expired = 0;
    let question: string | undefined;
    for (const row of open) {
      // Asked today, in their timezone — still live, leave it alone.
      if (dayKeyInZone(row.ts, customer.timezone ?? "UTC") === today) continue;

      await ctx.db.patch(row._id, { awaitingAnswer: false });
      expired += 1;
      question ??= row.body?.slice(0, 120);

      /**
       * Logged, not silent. An expiry that leaves no trace makes "she never
       * asked" and "they never answered" indistinguishable afterwards — and
       * those need different fixes.
       */
      console.warn(
        `[messages] expired an unanswered question from ${dayKeyInZone(
          row.ts,
          customer.timezone ?? "UTC"
        )} for ${args.customerId} — she was blocked from asking anything else`
      );
    }

    return { expired, question };
  },
});
