/**
 * ⭐ The weekly review (§15.3's `report`, Sprint 8).
 *
 * The daily brief and recap already exist. The weekly one does not — and it is
 * the message that carries everything Sprint 8 built: the ladder, the niche
 * benchmark, the traceability percentage, and the strategy verdict.
 *
 * ⚠️ `review-strategy` deliberately sends nothing (§16.75.05: *"strategy
 * changes never get their own ping — interrupting someone to announce that
 * you're doing your job is exactly the noise §11 exists to prevent"*). Without
 * this, its verdict reached nobody at all.
 *
 * ## The four hard rules, and which one is easiest to break
 *
 * §15.3's contract for `report`:
 *
 * > **never report inventory as results** · a zero week is stated plainly with
 * > its cause · **lead with the rung, not a number dump** · composed and sent
 * > before any other work in the run
 *
 * ⚠️ The first is the one that goes wrong quietly. §2.6: *"the unit of work is
 * a placement — something live, with a URL. Drafts and found threads are
 * inventory, not results."* A week that drafted nine posts and published none
 * had a bad week, and a report counting drafts would say it was busy. So this
 * composer is given placements and never touches the drafts table.
 *
 * The second is the one that matters most for trust. §12: *"honest silence
 * beats fake activity."* A zero week says so, first, with the reason.
 */

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { compareToNiche } from "./benchmarks";
import { bioLinkUrl } from "./attribution";
import { dayKeyInZone } from "./cadence";

export interface WeeklyInput {
  placements: number;
  /** ⚠️ NOT drafts. §2.6 — inventory is not a result. */
  views: number;
  rung: string;
  rungDetail: string;
  /** Per-post views against the niche median, when there is one. */
  nicheMedian: number | null;
  nichePosts: number;
  /** §5.0.0 — how much of the week traced to something a real person said. */
  tracedPlacements: number;
  /** The strategy verdict, relayed here rather than pinged separately. */
  strategy: { changed: boolean; detail: string };
  /** Signups we could attribute, and those we couldn't. */
  conversions: { total: number; traced: number };
  /**
   * The bio link to ask for, when they haven't been asked yet. Absent once
   * asked — §14.45: "Ask once, then work with whatever they gave."
   */
  bioLink?: { url: string; channel: string };
}

/**
 * ⭐ Compose the week. Pure, so the hard rules are testable without a founder,
 * a model, or a clock.
 *
 * Order is the contract: rung first, never a number dump. §15.3 is explicit,
 * and the reason is that a founder reading a list of numbers has to work out
 * what's wrong themselves — which is the job they hired her for.
 */
/**
 * ⭐ §14.45 rung 4 — the weekly self-report ask.
 *
 * > *"Rung 4 is the floor, and it runs forever. **Even with a pixel installed,
 * > ask the weekly question.** One line in the recap. It catches signups the
 * > pixel missed, it validates the pixel against reality, and it works for the
 * > founder who'll never paste a snippet."*
 *
 * ⚠️ It was never asked. Of the five rungs, **none were running**: no post
 * carries a wrapped link (0 of 10 published, verified 2026-08-12), there is no
 * pixel, and this question — the one described as universal and frictionless —
 * had no code anywhere. §14.45 calls attribution "the one the whole wedge
 * rests on".
 *
 * ⭐ Asked EVERY week, including a week with nothing published. Signups arrive
 * from posts that went out earlier, and a report that only asks on busy weeks
 * would systematically miss the tail — which is exactly the founder whose
 * results are compounding.
 */
/**
 * ⭐ §14.45 rung 1's ask — the bio link, with its reason attached.
 *
 * > *"You got 61 clicks this week. I can't see what happened after — drop this
 * > one line on your site and I'll be able to tell you which posts actually
 * > brought signups."*
 *
 * Same shape here: the value is demonstrated first, so this reads as a way to
 * learn something rather than as a setup step. §14.45 — *"That converts far
 * better than a setup step, because the value is already demonstrated. Ask
 * once, then work with whatever they gave."*
 */
export function bioLinkAsk(url: string, channel: string): string {
  return `One thing that would help me a lot: put this link in your ${channel} bio — ${url} — and I'll be able to tell you which posts are actually sending people, instead of guessing.`;
}

export function selfReportAsk(): string {
  // One sentence, no preamble, easy to answer with a number and nothing else.
  return "Roughly how many signups did you get this week? A rough number is fine — it's the only way I can tell whether any of this is landing.";
}

export function composeWeekly(input: WeeklyInput): string {
  const lines: string[] = [];

  /**
   * ⚠️ A zero week leads, and says why. §12: honest silence beats fake
   * activity — and a report that opens with "engagement was up 12%" on a week
   * with nothing published is the exact dishonesty this rule exists to stop.
   */
  if (input.placements === 0) {
    lines.push(`nothing went out this week. ${input.rungDetail}`);
    if (input.strategy.detail) lines.push(input.strategy.detail);
    // ⚠️ Asked even here. Last week's posts can still be producing signups,
    // and skipping the question on a quiet week loses exactly the tail that
    // proves the work compounds.
    lines.push(selfReportAsk());
    return lines.join("\n\n");
  }

  const perPost = input.placements > 0 ? input.views / input.placements : 0;
  const cmp =
    input.nicheMedian !== null && input.nicheMedian > 0
      ? compareToNiche(perPost, input.nicheMedian)
      : null;

  /**
   * ⭐ The rung and the benchmark can DISAGREE, and the first live run did.
   *
   * The ladder is arithmetic against absolute floors (`SEEN_FLOOR`,
   * `ENGAGED_FLOOR`), so 153 views across 9 posts reads as "distribution and
   * interest are both working" — while being **96% under this niche's median**.
   * Both statements are true and printing them in sequence is incoherent: it
   * congratulates and then contradicts.
   *
   * §16.3 is the resolution — *"is 4.1% good? Nobody knows. Context is the
   * product."* When the niche says otherwise, the niche wins the headline, and
   * the floor is reported as what it is: a floor, cleared.
   */
  if (cmp?.verdict === "below") {
    lines.push(
      `the numbers clear my floor, but they're well under what your niche does — ${Math.round(perPost)} views a post against a median of ${input.nicheMedian}, from ${input.nichePosts} posts.`,
    );
  } else {
    // 1. The rung, in her words. Not a number.
    lines.push(input.rungDetail);
    // 2. The benchmark — what makes the number readable at all (§16.3).
    if (cmp) {
      lines.push(
        `${Math.round(perPost)} views a post — ${cmp.detail}, from ${input.nichePosts} posts in your niche.`,
      );
    }
  }

  /**
   * 3. Traceability. §5.0.0's sentence, stated plainly: "4 of 6 posts this week
   * came from something your buyers actually said." It is the difference
   * between posting and doing the homework.
   */
  lines.push(
    `${input.tracedPlacements} of ${input.placements} posts came from something a real person said.`,
  );

  // 4. Results, and only results.
  if (input.conversions.total > 0) {
    const untraced = input.conversions.total - input.conversions.traced;
    lines.push(
      untraced > 0
        ? `${input.conversions.total} signups — I can point to the post for ${input.conversions.traced}${
            untraced > 0 ? `, and can't for the other ${untraced}` : ""
          }.`
        : `${input.conversions.total} signups, and I can point to the post for each one.`,
    );
  }

  // 5. The strategy verdict, relayed — never its own ping.
  if (input.strategy.detail) lines.push(input.strategy.detail);

  /**
   * 6. ⭐ Rung 1's ask, once. Before the rung-4 question so the report ends on
   * the thing that is easiest to answer.
   */
  if (input.bioLink) {
    lines.push(bioLinkAsk(input.bioLink.url, input.bioLink.channel));
  }

  /**
   * 7. ⭐ Rung 4. Last, because it is a question and the report should inform
   * before it asks — but always present, because §14.45 makes it the floor.
   */
  lines.push(selfReportAsk());

  return lines.join("\n\n");
}

/* -------------------------------------------------------------------------- */

/**
 * Build and send the week.
 *
 * ⚠️ Sends through `messages.send`, which carries the plain-language guard — so
 * a rung name or a vendor word can't reach the founder through this path any
 * more than through any other.
 */
export const sendWeeklyReview = internalAction({
  args: { customerId: v.id("customers"), now: v.optional(v.number()) },
  handler: async (
    ctx,
    args,
  ): Promise<{
    ok: boolean;
    sent: boolean;
    body?: string;
    reason?: string;
  }> => {
    const now = args.now ?? Date.now();
    const timezone = await ctx.runQuery(internal.maya.liveness.timezoneFor, {
      customerId: args.customerId,
    });

    const ladder = await ctx.runQuery(internal.maya.ladder.diagnose, {
      customerId: args.customerId,
      sinceDays: 7,
      now,
    });
    const benchmarks = await ctx.runQuery(
      internal.maya.benchmarks.benchmarksFor,
      {
        customerId: args.customerId,
        now,
      },
    );
    const trace = await ctx.runQuery(internal.maya.traceability.traceability, {
      customerId: args.customerId,
      now,
      windowDays: 7,
    });
    const conversions = await ctx.runQuery(
      internal.maya.attribution.recentConversions,
      { customerId: args.customerId, limit: 50 },
    );

    /**
     * ⚠️ The strategy verdict is READ, not run. `reviewStrategy` already ran in
     * the weekly sweep and wrote its entry; running it again here would either
     * duplicate the changelog or — because it dedupes per day — silently
     * return nothing. The report relays; it does not decide.
     */
    const changelog = await ctx.runQuery(internal.maya.strategy.changelogFor, {
      customerId: args.customerId,
      limit: 1,
    });
    const latest = changelog[0];

    /**
     * ⭐ Rung 1, ensured here rather than at signup so EXISTING accounts get
     * one too — this runs weekly per customer, so no account can go without.
     *
     * ⚠️ Asked once. §14.45: "Ask once, then work with whatever they gave." A
     * weekly nag for a thing they've already declined is the noise §11 exists
     * to prevent, so the ask rides only on the first report that has a link.
     */
    let bioLink: { url: string; channel: string } | undefined;
    const primaryChannel = (
      await ctx.runQuery(internal.maya.channels.forCustomer, {
        customerId: args.customerId,
      })
    ).find((c: { status: string }) => c.status === "connected");

    if (primaryChannel) {
      const minted = await ctx.runMutation(
        internal.maya.attribution.ensureBioLink,
        { customerId: args.customerId, channel: primaryChannel.channel },
      );
      if (minted.ok && minted.token) {
        const url = bioLinkUrl(process.env.APP_URL ?? "", minted.token);
        // Only ask on the report where it was first minted — `alreadyAsked`
        // is the previous week's message carrying the same link.
        const asked = await ctx.runQuery(internal.maya.messages.recentHistory, {
          customerId: args.customerId,
          limit: 40,
        });
        const seen = asked.some((m: { body: string }) =>
          m.body.includes(`/r/${minted.token}`),
        );
        if (url && !seen) bioLink = { url, channel: primaryChannel.channel };
      }
    }

    const weekAgo = now - 7 * 86_400_000;
    const recent = conversions.filter(
      (c: { occurredAt: number }) => c.occurredAt >= weekAgo,
    );

    // Pick the channel with the most placements — the week's main surface.
    const usable = benchmarks.channels.filter((c) => c.usable);
    const primary = usable[0] ?? null;

    const body = composeWeekly({
      placements: ladder.placements,
      views: ladder.views,
      rung: ladder.rung,
      rungDetail: ladder.detail,
      nicheMedian: primary?.medianViews ?? null,
      nichePosts: primary?.posts ?? 0,
      tracedPlacements: trace.traceable,
      strategy: {
        changed: Boolean(latest && latest.trigger !== "no_change"),
        detail: latest ? (latest.askedFor ?? latest.because) : "",
      },
      bioLink,
      conversions: {
        total: recent.reduce(
          (sum: number, c: { count: number }) => sum + c.count,
          0,
        ),
        traced: recent
          .filter((c: { traced: boolean }) => c.traced)
          .reduce((sum: number, c: { count: number }) => sum + c.count, 0),
      },
    });

    const sent = await ctx.runMutation(internal.maya.messages.send, {
      customerId: args.customerId,
      surface: "telegram",
      body,
      // One review per week, per customer — the key makes a double-fire a
      // no-op rather than two reports.
      /**
       * ⚠️ The founder's day, via `dayKeyInZone`. A UTC key rolls over at a
       * different moment than their week does, so a Sunday-evening review and
       * a Monday-morning one would land on different keys and send twice.
       */
      dedupeKey: `weekly:${dayKeyInZone(now, timezone)}`,
      proactive: true,
      /**
       * ⭐ This report ends with a question (§14.45 rung 4), so it IS the open
       * one. `telegram.receiveInbound` closes it on their next message and
       * reads the number out of their answer — which is what turns the ask
       * from a polite noise into a recorded result.
       */
      awaitingAnswer: true,
      ts: now,
    });

    return { ok: true, sent: Boolean(sent), body };
  },
});
