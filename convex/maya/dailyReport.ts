/**
 * The morning brief and the evening recap (§8, §18 Sprint 3).
 *
 * Steady state is exactly two proactive messages a day. Watchers are silent;
 * the agent talks. Everything else has to earn an interruption.
 *
 * ## Send-first, and why it's a code property rather than a habit
 *
 * §8's daily rhythm is explicit:
 *
 * > Morning brief — composed and sent **before any other work in the run**.
 * > Three briefs have orphaned historically because the message came last.
 *
 * A run that produces content and then sends the brief loses the brief every
 * time the run dies partway. So `runMorningRun` sends first and enqueues
 * second, and a test asserts that order by observation rather than by reading
 * the code.
 *
 * ## Grounded or silent, applied to reporting
 *
 * The recap is a **receipt**: what went live, the links, what it got. It is
 * built by reading `placements`, never by asking a model what happened. A
 * report that can invent a placement is worse than no report, because the
 * founder's trust in every future number depends on this one never lying.
 *
 * And it is honest about zero days. A day with nothing published says so in
 * one line — padding a quiet day is how a report stops being read.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { namesSomethingConcrete } from "./quality";
import { dayKeyInZone } from "./cadence";

/**
 * ⭐ The founder's day key — the dedupe scope for both messages.
 *
 * ⚠️ This was UTC until 2026-08-06, and it broke the evening recap silently.
 * The recap fires at 20:00 local; in `America/New_York` that is **00:00 UTC
 * the next day**, so every recap was filed under TOMORROW's key. The liveness
 * check then looked for `recap:<today UTC>` — a key only yesterday's recap had
 * ever written — found it, and concluded the recap had gone out. Permanently.
 * `recap_missed` could never fire.
 *
 * The trap is documented in {@link dayKeyInZone}; this file simply hadn't been
 * brought along. A day boundary has to mean the same thing everywhere or the
 * watchdogs quietly agree with each other about the wrong day.
 */
export function dayKey(now: number, timezone: string): string {
  return dayKeyInZone(now, timezone);
}

/* -------------------------------------------------------------------------- */
/* Composition — pure, so the shape is testable without a database             */
/* -------------------------------------------------------------------------- */

export interface BriefInput {
  plannedPosts: Array<{ channel: string; angle: string }>;
  openQuestionCount: number;
  /** Channels that can't be posted to today, with the reason. */
  blockedChannels: Array<{ channel: string; reason: string }>;
}

export interface RecapInput {
  placements: Array<{
    channel: string;
    url?: string;
    linkStatus: "live" | "gone" | "unknown";
    metricsJson?: string;
  }>;
  /** Why nothing went out, when nothing did. Never invented — passed in. */
  zeroDayReason?: string;
}

export interface Composed {
  text: string;
  /** False when there is genuinely nothing worth an interruption. */
  worthSending: boolean;
}

/**
 * The morning brief: what she's doing today, in one message.
 *
 * Leads with the plan, not a greeting. Names channels and angles, because a
 * brief that says "working on some content today" is indistinguishable from a
 * brief that means nothing — see the `specific and true` exit criterion.
 */
export function composeBrief(input: BriefInput): Composed {
  const { plannedPosts, openQuestionCount, blockedChannels } = input;
  const lines: string[] = [];

  if (plannedPosts.length === 0) {
    lines.push("Nothing scheduled to go out today.");
  } else {
    const byChannel = new Map<string, string[]>();
    for (const post of plannedPosts) {
      byChannel.set(post.channel, [...(byChannel.get(post.channel) ?? []), post.angle]);
    }
    const parts = [...byChannel.entries()].map(
      ([channel, angles]) =>
        `${channel}: ${angles.length === 1 ? angles[0] : `${angles.length} posts — ${angles.join("; ")}`}`
    );
    lines.push(`Today — ${parts.join(" · ")}`);
  }

  for (const blocked of blockedChannels) {
    lines.push(`${blocked.channel} is on hold: ${blocked.reason}`);
  }

  // One open question at a time is invariant 5; if one is already outstanding
  // the brief mentions it rather than adding a second.
  if (openQuestionCount > 0) {
    lines.push("Still waiting on your answer to the question from earlier.");
  }

  return { text: lines.join("\n"), worthSending: true };
}

/**
 * The evening recap: the receipt.
 *
 * Every line traces to a placement row. A placement with no URL is reported as
 * exactly that — "posted, link not resolved yet" — never as a success with the
 * URL quietly omitted (invariant 1).
 */
export function composeRecap(input: RecapInput): Composed {
  const { placements, zeroDayReason } = input;

  if (placements.length === 0) {
    // Honest about zero days. One line, the real reason, no padding.
    return {
      text: zeroDayReason
        ? `Nothing went out today — ${zeroDayReason}`
        : "Nothing went out today.",
      worthSending: true,
    };
  }

  const lines: string[] = [
    placements.length === 1 ? "One post went out:" : `${placements.length} posts went out:`,
  ];

  for (const p of placements) {
    let line = `${p.channel}`;
    if (p.linkStatus === "live" && p.url) {
      line += ` — ${p.url}`;
    } else if (p.linkStatus === "gone") {
      line += " — the post is no longer up";
    } else {
      line += " — posted, link not resolved yet";
    }

    if (p.metricsJson) {
      try {
        const m = JSON.parse(p.metricsJson) as Record<string, number>;
        const bits = (["views", "likes", "comments", "shares"] as const)
          .filter((k) => typeof m[k] === "number" && m[k] > 0)
          .map((k) => `${m[k]} ${k}`);
        if (bits.length > 0) line += ` (${bits.join(", ")})`;
      } catch {
        // Corrupt metrics are silently omitted rather than reported as zero.
        // A wrong number is worse than a missing one.
      }
    }
    lines.push(line);
  }

  return { text: lines.join("\n"), worthSending: true };
}

/**
 * Would this report read as generic filler?
 *
 * Reuses the research quality floor: a report naming no channel, number or URL
 * is one that would read identically on any day for any customer. The brief's
 * exit criterion is "specific and true every day for a week", and this is the
 * specific half — truth comes from building it out of rows.
 */
export function isSpecific(text: string): boolean {
  return namesSomethingConcrete(text) || /\b(x|tiktok|instagram|youtube)\b/i.test(text);
}

/* -------------------------------------------------------------------------- */
/* Convex                                                                      */
/* -------------------------------------------------------------------------- */

/** Today's placements, which is what the recap is built from. */
export const todaysPlacements = internalQuery({
  args: { customerId: v.id("customers"), now: v.optional(v.number()) },
  handler: async (ctx, args): Promise<Doc<"placements">[]> => {
    const now = args.now ?? Date.now();
    const customer = (await ctx.db.get(args.customerId)) as Doc<"customers"> | null;
    const timezone = customer?.timezone ?? "UTC";
    const today = dayKey(now, timezone);

    /**
     * ⚠️ This filtered on `publishedAt >= floor(now / 86_400_000) * 86_400_000`
     * — UTC midnight. The recap fires at 20:00 local, which in
     * `America/New_York` IS 00:00 UTC, so `since` equalled `now` almost
     * exactly and the window was a few milliseconds wide. A recap built from
     * this query would have reported "Nothing went out today" on a day with
     * four live posts.
     *
     * Comparing day KEYS rather than doing millisecond arithmetic is what
     * cadence.ts does, and it is correct across DST too — the offset is
     * resolved per timestamp instead of assumed constant.
     */
    const window = (await ctx.db
      .query("placements")
      .withIndex("by_customer_and_publishedAt", (q) =>
        q
          .eq("customerId", args.customerId)
          // Two days back covers every timezone offset; the key filter below
          // is what actually decides membership.
          .gte("publishedAt", now - 2 * 86_400_000)
      )
      .collect()) as Doc<"placements">[];

    return window.filter((p) => dayKeyInZone(p.publishedAt, timezone) === today);
  },
});

/**
 * The morning run. **Sends the brief, then does the work.**
 *
 * Returns the ordering it performed so a test can assert it by observation.
 * The dedupe key is scoped to the day, so a re-run — a retry, a second cron
 * firing, a restart — re-sends nothing.
 */
export const runMorningRun = internalMutation({
  args: {
    customerId: v.id("customers"),
    plannedPosts: v.array(v.object({ channel: v.string(), angle: v.string() })),
    blockedChannels: v.optional(
      v.array(v.object({ channel: v.string(), reason: v.string() }))
    ),
    now: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    briefSent: boolean;
    messageId: Id<"messages"> | null;
    jobsEnqueued: number;
    order: string[];
  }> => {
    const now = args.now ?? Date.now();
    const order: string[] = [];
    const customer = (await ctx.db.get(args.customerId)) as Doc<"customers"> | null;
    const today = dayKey(now, customer?.timezone ?? "UTC");

    const open = await ctx.db
      .query("messages")
      .withIndex("by_customer_and_awaiting", (q) =>
        q.eq("customerId", args.customerId).eq("awaitingAnswer", true)
      )
      .collect();

    const brief = composeBrief({
      plannedPosts: args.plannedPosts,
      openQuestionCount: open.length,
      blockedChannels: args.blockedChannels ?? [],
    });

    // ── SEND FIRST. Nothing above this line produces content. ──────────────
    const sent = await ctx.runMutation(internal.maya.messages.send, {
      customerId: args.customerId,
      surface: "telegram",
      body: brief.text,
      dedupeKey: `brief:${today}`,
      proactive: true,
      ts: now,
    });
    order.push("brief");

    // ── Then the work. If this dies, the brief already landed. ─────────────
    let jobsEnqueued = 0;
    for (const [i, post] of args.plannedPosts.entries()) {
      const res = await ctx.runMutation(internal.maya.jobs.enqueue, {
        kind: "produce_post",
        idempotencyKey: `produce:${args.customerId}:${today}:${i}`,
        customerId: args.customerId,
        payloadJson: JSON.stringify(post),
      });
      if (res.created) jobsEnqueued += 1;
    }
    if (args.plannedPosts.length > 0) order.push("work");

    return {
      briefSent: sent.sent,
      messageId: sent.messageId,
      jobsEnqueued,
      order,
    };
  },
});

/** The evening recap, built from rows and deduped per day. */
export const sendEveningRecap = internalMutation({
  args: {
    customerId: v.id("customers"),
    zeroDayReason: v.optional(v.string()),
    now: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ sent: boolean; messageId: Id<"messages"> | null; count: number }> => {
    const now = args.now ?? Date.now();
    const customer = (await ctx.db.get(args.customerId)) as Doc<"customers"> | null;
    const timezone = customer?.timezone ?? "UTC";
    const today = dayKey(now, timezone);

    /**
     * ⚠️ This read `publishedAt >= floor(now / 86_400_000) * 86_400_000` — and
     * this is the site where that hurt most. The recap fires at **20:00
     * local**, which for `America/New_York` is 00:00 UTC exactly, so `since`
     * equalled `now` to within milliseconds: a window a few ms wide.
     *
     * The recap would have said *"Nothing went out today."* on a day with four
     * live posts, and been believed — it is the receipt, and §2.7 says the
     * founder's trust in every future number depends on it never lying.
     *
     * It has not bitten yet only because the live agent composes her own recap
     * rather than calling this. That is luck, not design.
     */
    const placements = (
      (await ctx.db
        .query("placements")
        .withIndex("by_customer_and_publishedAt", (q) =>
          q
            .eq("customerId", args.customerId)
            .gte("publishedAt", now - 2 * 86_400_000)
        )
        .collect()) as Doc<"placements">[]
    ).filter((p) => dayKeyInZone(p.publishedAt, timezone) === today);

    const recap = composeRecap({
      placements: placements.map((p) => ({
        channel: p.channel,
        url: p.url,
        linkStatus: p.linkStatus,
        metricsJson: p.metricsJson,
      })),
      zeroDayReason: args.zeroDayReason,
    });

    const sent = await ctx.runMutation(internal.maya.messages.send, {
      customerId: args.customerId,
      surface: "telegram",
      body: recap.text,
      dedupeKey: `recap:${today}`,
      proactive: true,
      ts: now,
    });

    return { sent: sent.sent, messageId: sent.messageId, count: placements.length };
  },
});

/**
 * ⭐ Send the brief the machine didn't.
 *
 * The liveness contract's `reenqueue_brief` action had nowhere to go: the
 * sweep recorded it and stopped. On 2026-08-08 the morning brief never went
 * out, the sweep noticed at 09:00, and the founder heard nothing.
 *
 * Deliberately thin. It does NOT reconstruct the day's plan — that needs the
 * agent, and if the agent is why the brief is missing, asking it again is the
 * loop §12 warns about ("a re-enqueue loop on a broken brief is a message
 * storm"). It sends the honest short version instead: nothing has gone out
 * yet, and here is what she does know from rows.
 *
 * Once per day by construction — `send` dedupes on `brief:<founder's day>`, so
 * if the real brief lands later it is the SAME key and only one arrives. And
 * if the machine recovers first, this becomes a no-op rather than a duplicate.
 */
export const sendLateBrief = internalAction({
  args: { customerId: v.id("customers"), now: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ sent: boolean }> => {
    const now = args.now ?? Date.now();
    const cadence = await ctx.runQuery(internal.maya.cadence.cadence, {
      customerId: args.customerId,
      now,
    });
    const timezone = await ctx.runQuery(internal.maya.liveness.timezoneFor, {
      customerId: args.customerId,
    });

    const streak =
      cadence.streak > 0
        ? `${cadence.streak} day${cadence.streak === 1 ? "" : "s"} in a row so far`
        : "nothing live in the last few days";

    const result = await ctx.runMutation(internal.maya.messages.send, {
      customerId: args.customerId,
      surface: "telegram",
      body: `Morning — running late today, that one's on me. Nothing has gone out yet. Where things stand: ${streak}. I'll come back with today's post shortly.`,
      proactive: true,
      dedupeKey: `brief:${dayKey(now, timezone)}`,
      ts: now,
    });
    return { sent: result.sent };
  },
});
