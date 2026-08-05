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
import { checkPlainLanguage } from "./plainLanguage";

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

    /**
     * ⭐ THE LAST THING BETWEEN HER MACHINERY AND THEIR CHAT.
     *
     * Every outbound message funnels through this function, which makes it the
     * only place a guard can be complete. It catches the class the prompt
     * structurally cannot — strings she never wrote, interpolated in by code:
     * an exception, a vendor's name, a bucket error, an id.
     *
     * That is not hypothetical. `ingestFromTelegram` returned `error.message`
     * and `telegramFiles` put it straight into a body, so an R2 failure would
     * have reached a founder as "The specified bucket does not exist". Fixed
     * at the source; this is the backstop for the next one.
     *
     * Redacted, never dropped (§2.5) — and the LOG keeps the original, so an
     * operator can find the source instead of guessing from a sanitized
     * sentence.
     */
    const plain = checkPlainLanguage(args.body);
    if (!plain.ok) {
      console.error(
        `[messages] redacted ${plain.redacted.join(", ")} from ${args.dedupeKey}: ${args.body}`
      );
    }

    const messageId = await ctx.db.insert("messages", {
      customerId: args.customerId,
      direction: "out",
      surface: args.surface,
      body: plain.clean,
      dedupeKey: args.dedupeKey,
      proactive: args.proactive,
      turnId: args.turnId,
      ts: args.ts ?? Date.now(),
    });

    // Delivery is a JOB, not a side effect of writing. Sending inline would
    // mean a transient Telegram 502 silently loses a brief; through the queue
    // it retries with backoff and, if it never lands, ends up in the
    // dead-letter view where someone can see it.
    if (args.surface === "telegram") {
      await ctx.runMutation(internal.maya.jobs.enqueue, {
        kind: "deliver_message",
        idempotencyKey: `deliver:${messageId}`,
        customerId: args.customerId,
        payloadJson: JSON.stringify({ messageId }),
      });

      /**
       * ⭐ Delivery latency is the CALLER's call, not this function's.
       *
       * `drainJobs` had exactly one caller — a **5-minute** interval cron — so
       * every message written here sat in the queue an average of two and a
       * half minutes. Including her replies: `handoff` routes those through
       * here too, so a founder could ask a question, watch the typing
       * indicator stop, and get the answer four minutes later.
       *
       * Measured on staging 2026-08-05: two messages created 22s apart were
       * delivered 316ms apart — one sweep — and the gap to the previous sweep
       * was exactly 1,200,000ms. Cron-only, confirmed.
       *
       * The cron was never *meant* to be the delivery path. The comment above
       * it says what it's for: work that must survive *"the machine being
       * unreachable."* It stays exactly that — a backstop.
       *
       * So anything with a human waiting calls `deliverNow()` (scheduler.ts)
       * straight after this, which drains inline and returns once the message
       * is actually out. Batch work — a brief, a recap — just lets the cron
       * pick it up, because five minutes there is invisible.
       */
    }

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

    const messageId = await ctx.db.insert("messages", {
      customerId: args.customerId,
      direction: "out",
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
    const since = Math.floor(now / 86_400_000) * 86_400_000;
    const rows = await ctx.db
      .query("messages")
      .withIndex("by_customer_and_ts", (q) =>
        q.eq("customerId", args.customerId).gte("ts", since)
      )
      .collect();
    return rows.filter((row) => row.direction === "out" && row.proactive === true)
      .length;
  },
});

/** Re-exported for tests and callers that need to read one row back. */
export { getMessage };
