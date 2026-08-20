/**
 * ⭐ THE FIRST HOUR — she says what she is going to do, then goes and does it.
 *
 * ## What was happening instead
 *
 * `claimPairing` sent one hardcoded line — *"Paired. I'll take it from here."*
 * — and returned. Her earliest cron is the 06:30 checkpoint, so a founder who
 * paired at 2pm heard nothing for SIXTEEN HOURS.
 *
 * ⚠️ And she was not idle in that window. `learnBusiness` is scheduled during
 * onboarding and is the most expensive single call in the product. She was
 * doing the homework and never mentioning it, which is the worst of both: the
 * founder pays for it and gets no credit, and the silence reads as broken.
 *
 * v1 had this and it was lost in the rewrite — `0001_kickstart`, a one-shot
 * `at` cron that fired ~5 minutes after deploy and did nothing but say hello.
 *
 * ## ⚠️ THREE SEPARATE TURNS, AND THAT IS A SCAR NOT A STYLE
 *
 * v1's own comment records what happened when hello + research + planning were
 * packed into one turn: *"6-min agent run, cron killed it with timeout."* Our
 * Convex→machine handoff aborts at `CHAT_TURN_TIMEOUT_MS` (120s), which is
 * shorter still. Every turn here is small enough to finish.
 *
 * ## ⭐ AND THE COLLECTION IS NOT AN AGENT TURN AT ALL
 *
 * The homework runs as deterministic Convex work; only the REPORT is a turn.
 * Two reasons, and the second is the one that matters to the founder:
 *
 * 1. Principle 3 — deterministic code watches, the model judges.
 * 2. **She has to stay reachable while she works.** Her session queues: an
 *    inbound message sent while a long turn is running waits behind it, which
 *    was measured live — sessions stalling for minutes with
 *    `reason=queued_behind_active_work`. A founder who texts her during the
 *    first hour and gets nothing back has learned the wrong thing about her on
 *    day one. Research that never occupies her session cannot block a reply.
 *
 * ## Keyed on PAIRING, not on deploy
 *
 * v1 timed its kickstart from deploy. v2 deploys during `/start`, BEFORE
 * Telegram is linked — so a deploy-timed one-shot can fire when there is no
 * chat to send to. Pairing is the first moment a conversation exists.
 */

import { v } from "convex/values";
import { internal } from "../_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

/** How long to keep waiting for the machine before giving up on the intro. */
export const MACHINE_WAIT_MS = 20 * 60_000;
/** Gap between liveness checks while she boots. */
export const MACHINE_RETRY_MS = 30_000;
/**
 * Long enough for `learnBusiness` to have finished, short enough that the
 * founder is still in the session that started it.
 */
export const HOMEWORK_DELAY_MS = 3 * 60_000;
/** How long the report waits for `learnBusiness` before reporting honestly. */
export const HOMEWORK_WAIT_MS = 25 * 60_000;
/** Gap between checks for the niche work landing. */
export const HOMEWORK_RETRY_MS = 60_000;

/**
 * ⭐ HER INTRO IS WRITTEN BY HER, NOT BY US.
 *
 * ⚠️ A hardcoded intro is exactly the failure v1 named: it called out the
 * template *"getting the foundation for [product] ready to drive [goal]"* as
 * canned because it references nothing real. The founder has just handed over
 * their social accounts; the only thing that earns trust in that moment is a
 * specific true detail about THEIR product, and only she has read it.
 *
 * So this is a brief, not a script.
 */
export const HELLO_BRIEF = `Introduce yourself. This is the first thing you have ever said to this founder — they connected you a moment ago and are looking at their phone right now.

Read APP.md and USER.md first. Then, in two or three sentences, phone-sized:

- Greet them by first name if you know it. Never invent one.
- Say who you are and what you do for them.
- ⭐ PROVE YOU READ THEIR PRODUCT — name one specific, true thing about it. The product's NAME alone is not proof and reads canned. Anchor on what it actually does or who it is for.
- Tell them what you are going off to do RIGHT NOW: work out who their buyers are and how they talk, see who is advertising against them, and watch what is working in their niche.
- Invite them to reply — questions, corrections, anything they want you to know. Make it clear nothing gets locked in without them.

⚠️ Do NOT promise a number of minutes. Say you will come back with what you find.
⚠️ Do NOT list your tools, skills, or internal steps. Say the work in their language.
Send it with \`update\`. That is the whole job — no research on this turn.`;

/**
 * The report. Also deliberately small — it reads rows that already exist.
 */
export const HOMEWORK_BRIEF = `Come back to the founder with what you found. You told them you were going to do the homework; this is you reporting it.

Call \`ad_intel\` FIRST — competitor ads and how many days each has been running. Then look at what you now know about their niche.

In a short message, phone-sized:

- What their buyers actually complain about, in the buyers' own words.
- ⭐ Who is advertising against them and HOW LONG the strongest ad has run. That number is the point — an ad alive for weeks is one somebody keeps paying to keep alive.
- One thing you think is worth making because of it.

⚠️ IF IT IS THIN, SAY SO. A quiet niche is a real finding and honest silence beats fake activity. Never pad this with how much you researched.
⚠️ Nothing is locked in. End by asking whether that is the right read — they know their buyers better than any sweep does.
Send it with \`update\`.`;

export const THIN_BRIEF = `Go back to the founder. You told them you were going off to read their space and it has not come back with anything usable.

Say that plainly, in a sentence or two. A niche that is hard to read is a real finding and they would rather hear it than wait.

Then ask them the one question that would unblock you fastest: who do they lose deals to? Name any competitor you already suspect and ask if that is right.

⚠️ Do not pad this with how much you searched. Do not apologise twice. Send it with \`update\`.`;

/** Records the intro so it can never be sent twice. */
export const markHelloSent = internalMutation({
  args: { customerId: v.id("customers"), now: v.optional(v.number()) },
  handler: async (ctx, args): Promise<null> => {
    await ctx.db.patch(args.customerId, {
      helloSentAt: args.now ?? Date.now(),
    });
    return null;
  },
});

/**
 * ⭐ Beat one: hello.
 *
 * Scheduled the moment pairing succeeds. Waits for the machine — it is usually
 * still booting, because `/start` deploys it only a minute or two earlier — and
 * retries rather than failing, because "she never said anything" is the exact
 * outcome this exists to prevent.
 */
export const kickoff = internalAction({
  args: {
    customerId: v.id("customers"),
    startedAt: v.optional(v.number()),
    now: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: boolean; detail: string }> => {
    const now = args.now ?? Date.now();
    const startedAt = args.startedAt ?? now;

    const customer = (await ctx.runQuery(
      internal.maya.firstRun.customerRow,
      { customerId: args.customerId }
    )) as Doc<"customers"> | null;
    if (!customer) return { ok: false, detail: "no such customer" };

    /**
     * ⚠️ The check that makes a retry loop safe. Without it, every requeue is
     * another introduction.
     */
    if (customer.helloSentAt) {
      return { ok: true, detail: "already introduced" };
    }

    const health = await ctx.runAction(internal.maya.handoff.checkHealth, {
      customerId: args.customerId,
    });

    if (!health.healthy) {
      if (now - startedAt > MACHINE_WAIT_MS) {
        /**
         * ⚠️ Named, not silent. §5 — every job produces a result or a named
         * failure that reaches someone. A founder who never got an intro is
         * invisible otherwise.
         */
        console.error(
          `[firstRun] ${args.customerId}: gave up waiting for the machine — ${health.detail ?? "not healthy"}`
        );
        return { ok: false, detail: "machine never came up" };
      }
      await ctx.scheduler.runAfter(
        MACHINE_RETRY_MS,
        internal.maya.firstRun.kickoff,
        { customerId: args.customerId, startedAt }
      );
      return { ok: false, detail: "still booting — will retry" };
    }

    const sent = await ctx.runAction(
      internal.maya.handoff.routeInboundToMachine,
      { customerId: args.customerId, text: HELLO_BRIEF }
    );

    /**
     * ⚠️ A TIMEOUT IS NOT A FAILURE TO SEND. The handoff aborts at 120s while
     * her turn keeps running on the machine, so she may well have spoken.
     * Marking it sent is the safer error: a founder who hears from her twice on
     * day one is a worse first impression than one who hears from her once.
     */
    await ctx.runMutation(internal.maya.firstRun.markHelloSent, {
      customerId: args.customerId,
      now,
    });

    await ctx.scheduler.runAfter(
      HOMEWORK_DELAY_MS,
      internal.maya.firstRun.homework,
      { customerId: args.customerId }
    );

    return {
      ok: true,
      detail: sent.delivered ? "introduced" : `sent, no ack (${sent.reason ?? "?"})`,
    };
  },
});

/**
 * ⭐ Beat two: the homework, then the report.
 *
 * The collection is Convex work and never touches her session, so a founder
 * texting her during this window still gets answered.
 */
export const homework = internalAction({
  args: {
    customerId: v.id("customers"),
    startedAt: v.optional(v.number()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ ok: boolean; detail: string }> => {
    const now = args.now ?? Date.now();
    const startedAt = args.startedAt ?? now;

    /**
     * ⚠️ WAIT FOR THE HOMEWORK TO EXIST BEFORE REPORTING ON IT.
     *
     * My first draft fired this on a flat three-minute timer, which was a guess
     * dressed as a schedule. `learnBusiness` is ~12 live searches plus model
     * calls and routinely takes longer, so the report would have arrived before
     * the work it describes — she would have told the founder her niche was
     * empty on the one day they were watching. Poll the row instead of trusting
     * a stopwatch.
     */
    const targets = await ctx.runQuery(
      internal.maya.learnBusiness.targetsFor,
      { customerId: args.customerId }
    );
    if (!targets || (targets.keywords ?? []).length === 0) {
      if (now - startedAt > HOMEWORK_WAIT_MS) {
        /**
         * ⚠️ She still speaks. A founder promised a report and given silence
         * has learned something false about her; "the niche was hard to read"
         * is honest and is a finding in itself (§12).
         */
        await ctx.runAction(internal.maya.handoff.routeInboundToMachine, {
          customerId: args.customerId,
          text: THIN_BRIEF,
        });
        return { ok: false, detail: "learn never finished — said so" };
      }
      await ctx.scheduler.runAfter(
        HOMEWORK_RETRY_MS,
        internal.maya.firstRun.homework,
        { customerId: args.customerId, startedAt }
      );
      return { ok: false, detail: "homework still running — will retry" };
    }

    /**
     * Competitor ads are the strongest evidence she can bring on day one, and
     * on the normal schedule they would not arrive until Sunday — a founder who
     * signs up on Tuesday would wait five days for the thing they bought.
     *
     * One customer's sweep, not the fleet's.
     */
    let ads = "no competitor ads yet";
    try {
      const swept = await ctx.runAction(internal.maya.adIntel.sweepAdIntel, {
        customerId: args.customerId,
      });
      ads = swept.detail;
    } catch (error) {
      // A vendor outage must not cost her the introduction she promised.
      console.warn(
        `[firstRun] ad sweep failed: ${error instanceof Error ? error.message : error}`
      );
    }

    const sent = await ctx.runAction(
      internal.maya.handoff.routeInboundToMachine,
      { customerId: args.customerId, text: HOMEWORK_BRIEF }
    );

    return {
      ok: true,
      detail: `${ads}; report ${sent.delivered ? "delivered" : "sent without ack"}`,
    };
  },
});

/** The row, for the idempotency check. Internal — carries tokens. */
export const customerRow = internalQuery({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args): Promise<Doc<"customers"> | null> =>
    (await ctx.db.get(args.customerId)) as Doc<"customers"> | null,
});
