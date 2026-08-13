/**
 * ⭐ Who we've stopped being able to reach.
 *
 * ## The bug this exists for
 *
 * `telegram.ts` records a named reason every time a send fails — *"Recorded,
 * not swallowed."* And that was true of the write. **Nothing read it.**
 * `deliveryError` had zero readers anywhere in the codebase, so a failure was
 * swallowed into a column rather than into nothing, which is the same outcome
 * with better paperwork.
 *
 * §2.5: *"Nothing fails silently. Every job produces a result or a named
 * failure **that reaches the user**."* The last clause is the one that was
 * missing.
 *
 * ## Why it matters most for billing
 *
 * §18 Sprint 10 asks for an *"email fallback for billing failure (a paused
 * agent can't message you)"*.
 *
 * ⚠️ **The premise is wrong for this architecture, and the real gap is worse.**
 * Outbound Telegram is sent by Convex directly (`maya/telegram.ts` →
 * `api.telegram.org`), not through the agent's Fly machine — so a paused or
 * stopped agent does *not* stop us messaging the founder.
 *
 * What does stop us is having no chat to send to: a founder who never finished
 * pairing, or who blocked the bot. Then the card-failure warning is written,
 * fails, is marked with a reason, and **nobody is told** — not the founder, who
 * has no idea their card failed, and not the operator, who could have emailed
 * them in thirty seconds.
 *
 * That is what this surfaces. It does not send email, and deliberately: the
 * fix for a founder we cannot reach is a human noticing, and Stripe's own
 * dunning mail already covers the card itself without us owning a sending
 * domain.
 */

import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

/**
 * ⚠️ Bounded. This runs inside the operator's one-read dashboard query, and an
 * unbounded scan of every undelivered message in the fleet is how that screen
 * stops loading at exactly the moment it is most needed.
 */
const SCAN_LIMIT = 500;

export interface UnreachableCustomer {
  customerId: Id<"customers">;
  /** How many messages are sitting undelivered. */
  pending: number;
  /**
   * The reason, verbatim from the transport. Relayed unchanged — "no Telegram
   * chat paired for this account" and "bot was blocked by the user" need
   * completely different responses from the operator.
   */
  reason: string;
  /** The oldest one, which is how long we have actually been mute. */
  since: number;
  /**
   * ⚠️ True when the founder is the one not being heard. Ranked above an
   * undelivered brief: they are waiting on a reply that will never come.
   */
  founderUnheard?: boolean;
  /**
   * ⭐ True when any of them was proactive — she was reaching out unprompted,
   * which is the class that carries card failures and daily recaps. An
   * undelivered reply is bad; an undelivered warning is the one that costs the
   * account.
   */
  proactive: boolean;
}

/**
 * Group undelivered outbound messages by customer.
 *
 * Uses the existing `by_delivery` index (`direction`, `deliveredAt`), so this
 * costs no new index on a schema already at TypeScript's instantiation ceiling.
 * A failed send clears `deliveredAt` and sets `deliveryError`, so the two
 * together are exactly "we tried and couldn't".
 */
export const fleetUnreachable = internalQuery({
  args: { now: v.optional(v.number()) },
  handler: async (ctx): Promise<UnreachableCustomer[]> => {
    const pending = (await ctx.db
      .query("messages")
      .withIndex("by_delivery", (q) =>
        q.eq("direction", "out").eq("deliveredAt", undefined),
      )
      .take(SCAN_LIMIT)) as Doc<"messages">[];

    /**
     * ⭐ And the other direction — the founder's messages that never reached
     * HER.
     *
     * ⚠️ Worse than the outbound case, not lesser. A founder who is not heard
     * concludes she is ignoring them; on 2026-08-12 one approved a draft, got
     * silence, and she reported "I don't yet know why" because the failure
     * reason was computed and discarded.
     */
    const inbound = (await ctx.db
      .query("messages")
      .withIndex("by_delivery", (q) =>
        q.eq("direction", "in").eq("deliveredAt", undefined),
      )
      .take(SCAN_LIMIT)) as Doc<"messages">[];

    const byCustomer = new Map<Id<"customers">, UnreachableCustomer>();

    for (const message of [...pending, ...inbound]) {
      /**
       * ⚠️ Only messages that actually FAILED. An outbound message with no
       * `deliveredAt` and no error is simply queued and about to send —
       * counting those would report a healthy fleet as unreachable every time
       * the dashboard loaded mid-flush.
       */
      if (!message.deliveryError) continue;

      const existing = byCustomer.get(message.customerId);
      if (!existing) {
        byCustomer.set(message.customerId, {
          customerId: message.customerId,
          pending: 1,
          reason: message.deliveryError,
          since: message.ts,
          proactive: Boolean(message.proactive),
          founderUnheard: message.direction === "in",
        });
        continue;
      }

      existing.pending += 1;
      existing.proactive = existing.proactive || Boolean(message.proactive);
      existing.founderUnheard =
        existing.founderUnheard || message.direction === "in";
      if (message.ts < existing.since) {
        existing.since = message.ts;
        // The oldest failure's reason: the one that started it, rather than
        // whichever retry happened to be scanned last.
        existing.reason = message.deliveryError;
      }
    }

    // Longest-mute first — that is the ranking the operator acts on.
    return [...byCustomer.values()].sort((a, b) => a.since - b.since);
  },
});
