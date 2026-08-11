/**
 * ⭐ `review-strategy` (§16.75.05, Sprint 8) — does anything change this week?
 *
 * > *"Not `DREAMS.md`. Cutting nightly self-reflection was right — 'reflect on
 * > your work' is unbounded, produces insights that change nothing, and runs on
 * > a schedule unrelated to when evidence arrives."*
 *
 * This is the other shape: **a bounded weekly review with a fixed input set,
 * one question, and a required output.** The cron isn't the interesting part —
 * the contract is.
 *
 * ## The default answer is no
 *
 * > *"Thrashing is worse than staleness. A strategy that changes weekly isn't a
 * > strategy."*
 *
 * Same kill-bias as the trend bridge test. *"Nothing's changing — the demo
 * format is still working"* is **a good weekly outcome, not a boring one**, and
 * it is written to the changelog like any other, because a log that only
 * records changes makes a steady month look like an absent one.
 *
 * ## Why the bar is arithmetic and the change is judgment
 *
 * §2.3 — deterministic code watches, the model judges. Whether a rung has been
 * broken two weeks running is a fact about rows; what to do about it is not.
 * `meetsChangeBar` is pure and testable, and nothing downstream can decide to
 * change the strategy without it having said yes first.
 *
 * ## ⚠️ And she may not propose a strategy she cannot execute
 *
 * §16.75.05's feasibility gate: *"'Move to demos' is worthless if there are no
 * product screenshots to demo with."* When the library can't carry it, **the
 * ask comes before the announcement** — announcing a plan you can't deliver is
 * worse than staying put.
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { dayKeyInZone } from "./cadence";

/** §16.75.05: a metric must have moved over at least this long. */
export const MIN_WEEKS_FOR_METRIC = 2;

/** The same rung broken this many weeks running is itself a trigger. */
export const RUNG_STUCK_WEEKS = 2;

export type ChangeTrigger =
  | "metric_moved"
  | "experiment_concluded"
  | "founder_said"
  | "rung_stuck"
  | "no_change";

export interface ChangeBarInput {
  /** The broken rung each week, oldest first. `null` for a healthy week. */
  rungHistory: Array<string | null>;
  /** An experiment that reached a verdict since the last review. */
  experimentConcluded?: { name: string; verdict: string };
  /** A directive the founder set since the last review. */
  founderSaid?: string;
  /** A metric that moved, with how many weeks of movement behind it. */
  metricMoved?: { name: string; detail: string; weeks: number };
}

export interface ChangeBarVerdict {
  change: boolean;
  trigger: ChangeTrigger;
  /** ⭐ The number that caused it. A change with no `because` is a vibe. */
  because: string;
}

/**
 * ⭐ Does anything clear the bar?
 *
 * Pure, so the decision is auditable after the fact — §16.75.05 wants the input
 * set deterministic for exactly that reason.
 *
 * ⚠️ Order is precedence, not preference. The founder saying something outranks
 * any metric: they know things the rows don't, and a system that weighs its own
 * measurements above the person paying for it is the wrong shape regardless of
 * who turns out to be right.
 */
export function meetsChangeBar(input: ChangeBarInput): ChangeBarVerdict {
  if (input.founderSaid) {
    return {
      change: true,
      trigger: "founder_said",
      because: `you told me: "${input.founderSaid}"`,
    };
  }

  if (input.experimentConcluded) {
    return {
      change: true,
      trigger: "experiment_concluded",
      because: `the ${input.experimentConcluded.name} test finished — ${input.experimentConcluded.verdict}`,
    };
  }

  /**
   * The same rung, broken for RUNG_STUCK_WEEKS running.
   *
   * ⚠️ The SAME rung. Alternating breaks are noise, and treating them as a
   * trigger is how a strategy changes every week — which §16.75.05 says is not
   * a strategy at all.
   */
  const recent = input.rungHistory.slice(-RUNG_STUCK_WEEKS);
  if (
    recent.length >= RUNG_STUCK_WEEKS &&
    recent.every((r) => r !== null && r === recent[0])
  ) {
    return {
      change: true,
      trigger: "rung_stuck",
      because: `${recent[0]} has been the broken rung ${recent.length} weeks running`,
    };
  }

  if (input.metricMoved && input.metricMoved.weeks >= MIN_WEEKS_FOR_METRIC) {
    return {
      change: true,
      trigger: "metric_moved",
      because: `${input.metricMoved.detail} over ${input.metricMoved.weeks} weeks`,
    };
  }

  /**
   * ⚠️ A metric that moved for ONE week is explicitly not enough. It is the
   * most tempting trigger and the one most likely to be noise — §16.75.05 sets
   * the floor at two weeks precisely because a single week always has a story.
   */
  return {
    change: false,
    trigger: "no_change",
    because: input.metricMoved
      ? `${input.metricMoved.detail}, but only for ${input.metricMoved.weeks} week — not enough to act on yet`
      : "nothing moved enough to be worth changing",
  };
}

/* -------------------------------------------------------------------------- */

export type Feasibility = "supported" | "partial" | "blocked";

export interface FeasibilityVerdict {
  state: Feasibility;
  /** The one specific ask, when the library can't carry the change. */
  ask?: string;
}

/**
 * ⭐ Can she actually execute this? (§16.75.05)
 *
 * Three outcomes, and the third is the one that matters: **do not announce the
 * change, ask first.** Announcing a plan you can't deliver is worse than
 * staying put.
 *
 * ⚠️ The ask names the number that caused it. §6.4.2's standing pattern — one
 * ask, at the moment of need, with a named purpose — and the number is what
 * makes it persuasive rather than nagging.
 */
export function checkFeasibility(input: {
  needsRealMedia: boolean;
  productScreenshots: number;
  hasRecording: boolean;
  because: string;
}): FeasibilityVerdict {
  if (!input.needsRealMedia) return { state: "supported" };
  if (input.hasRecording || input.productScreenshots >= 3) {
    return { state: "supported" };
  }
  if (input.productScreenshots > 0) {
    return {
      state: "partial",
      ask: `${input.because}, so I'm moving to posts that show the product. I'll start with the shots I have — a 30-second screen recording would let me do it properly.`,
    };
  }
  return {
    state: "blocked",
    /**
     * ⚠️ "I'd switch to those" — the spec's example phrasing — has no
     * antecedent when the reason is a rung rather than a named format. It read
     * as a sentence missing its first half.
     */
    ask: `${input.because}, which means people aren't seeing them. I'd move to posts that show the product working, but all I have is your marketing-site shots — about 30 seconds of screen recording would let me do it properly. Want to send one?`,
  };
}

/* -------------------------------------------------------------------------- */

export const recordChange = internalMutation({
  args: {
    customerId: v.id("customers"),
    day: v.string(),
    change: v.string(),
    because: v.string(),
    trigger: v.union(
      v.literal("metric_moved"),
      v.literal("experiment_concluded"),
      v.literal("founder_said"),
      v.literal("rung_stuck"),
      v.literal("no_change")
    ),
    evidenceJson: v.optional(v.string()),
    feasibility: v.optional(
      v.union(v.literal("supported"), v.literal("partial"), v.literal("blocked"))
    ),
    askedFor: v.optional(v.string()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ recorded: boolean }> => {
    // One entry per day. A weekly review that ran twice must not read as two
    // strategy decisions.
    const existing = (await ctx.db
      .query("strategyChanges")
      .withIndex("by_customer_and_day", (q) =>
        q.eq("customerId", args.customerId).eq("day", args.day)
      )
      .collect()) as Doc<"strategyChanges">[];
    if (existing.length > 0) return { recorded: false };

    await ctx.db.insert("strategyChanges", {
      customerId: args.customerId,
      day: args.day,
      change: args.change,
      because: args.because,
      trigger: args.trigger,
      evidenceJson: args.evidenceJson,
      feasibility: args.feasibility,
      askedFor: args.askedFor,
      createdAt: args.now ?? Date.now(),
    });
    return { recorded: true };
  },
});

/**
 * The changelog, newest first — the Plan screen reads this.
 *
 * ⚠️ Includes `no_change` entries. A log that records only changes makes a
 * steady month look like an absent one, and "nothing changed, here's why" is
 * the entry that proves she was looking.
 */
export const changelogFor = internalQuery({
  args: { customerId: v.id("customers"), limit: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<
    Array<{
      day: string;
      change: string;
      because: string;
      trigger: string;
      askedFor?: string;
    }>
  > => {
    const rows = (await ctx.db
      .query("strategyChanges")
      .withIndex("by_customer_and_created", (q) =>
        q.eq("customerId", args.customerId)
      )
      .order("desc")
      .take(args.limit ?? 20)) as Doc<"strategyChanges">[];

    return rows.map((r) => ({
      day: r.day,
      change: r.change,
      because: r.because,
      trigger: r.trigger,
      askedFor: r.askedFor,
    }));
  },
});

/**
 * ⭐ The weekly review.
 *
 * ⚠️ Returns its finding rather than messaging anyone. §16.75.05: *"strategy
 * changes never get their own ping — interrupting someone to announce that
 * you're doing your job is exactly the noise §11 exists to prevent."* The
 * weekly report relays this; nothing here sends.
 */
export const reviewStrategy = internalAction({
  args: { customerId: v.id("customers"), now: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<{
    changed: boolean;
    trigger: ChangeTrigger;
    because: string;
    /** Plain language for the weekly report to relay unchanged. */
    detail: string;
    ask?: string;
  }> => {
    const now = args.now ?? Date.now();
    const customer = await ctx.runQuery(internal.maya.liveness.timezoneFor, {
      customerId: args.customerId,
    });
    const day = dayKeyInZone(now, customer);

    /**
     * The fixed input set. Deterministic on purpose — §16.75.05 wants the
     * decision auditable after the fact, which means the inputs cannot depend
     * on what she happened to notice.
     */
    /**
     * ⚠️ BY CHANNEL, not pooled — §16.75.05's input set says so, and the live
     * account showed why. Pooled across every channel this customer reads
     * `healthy`; on X alone it is `L1` with 8 views across 6 posts. Pooling
     * averages a broken channel against a quiet one and reports that nothing
     * is wrong, which is the exact failure the ladder exists to prevent.
     */
    const channels = await ctx.runQuery(internal.maya.channels.forCustomer, {
      customerId: args.customerId,
    });
    const channelKeys = channels.map((c: { channel: string }) => c.channel);

    let stuck: { channel: string; rung: string } | null = null;
    const perChannel: Array<{ channel: string; thisWeek: string; lastWeek: string }> = [];

    for (const channel of channelKeys) {
      const thisWeek = await ctx.runQuery(internal.maya.ladder.diagnoseBenchmarked, {
        customerId: args.customerId,
        channel,
        sinceDays: 7,
        now,
      });
      const lastWeek = await ctx.runQuery(internal.maya.ladder.diagnoseBenchmarked, {
        customerId: args.customerId,
        channel,
        sinceDays: 14,
        now,
      });
      perChannel.push({
        channel,
        thisWeek: thisWeek.verdict.rung,
        lastWeek: lastWeek.verdict.rung,
      });

      const broken = (r: string) => r !== "healthy" && r !== "unknown";
      /**
       * The FIRST channel stuck on the same rung wins. §16.75.05 allows
       * exactly one change — picking two would make next week's data
       * unreadable, which is the whole reason for the limit.
       */
      if (
        !stuck &&
        broken(thisWeek.verdict.rung) &&
        thisWeek.verdict.rung === lastWeek.verdict.rung
      ) {
        stuck = { channel, rung: thisWeek.verdict.rung };
      }
    }

    const rungHistory: Array<string | null> = stuck
      ? [stuck.rung, stuck.rung]
      : [null, null];

    /**
     * ⭐ The experiment trigger, finally supplied.
     *
     * `meetsChangeBar` has read `experimentConcluded` since it was written and
     * nothing produced one — a change trigger that could never fire. An
     * experiment that concluded in the last week outranks a stuck rung,
     * because a concluded test is evidence someone deliberately gathered.
     */
    const concluded = await ctx.runQuery(
      internal.maya.experiments.latestConcluded,
      { customerId: args.customerId, sinceDays: 7, now }
    );

    const verdict = meetsChangeBar({
      rungHistory,
      experimentConcluded: concluded ?? undefined,
    });
    // Name the channel, not just the rung — "L1" is not actionable, "L1 on X" is.
    const because = stuck
      ? verdict.because.replace(stuck.rung, `${stuck.rung} on ${stuck.channel}`)
      : verdict.because;

    if (!verdict.change) {
      await ctx.runMutation(internal.maya.strategy.recordChange, {
        customerId: args.customerId,
        day,
        change: "",
        because,
        trigger: "no_change",
        now,
      });
      return {
        changed: false,
        trigger: "no_change",
        because,
        // ⭐ Said as a finding, not an apology. A steady week is a result.
        detail: `nothing's changing this week — ${verdict.because}`,
      };
    }

    /**
     * ⚠️ Feasibility BEFORE announcement. A rung stuck at L1 points at format,
     * and the format worth moving to usually needs real product footage —
     * which is exactly the case §16.75.05 says must ask first.
     */
    const library = await ctx.runQuery(internal.maya.media.libraryHealth, {
      customerId: args.customerId,
    });
    /**
     * ⚠️ The gate may still BLOCK without asking again.
     *
     * A change she can't execute is still a change she shouldn't announce —
     * but §6.4.2 caps how often the reason gets said out loud. Past the cap the
     * verdict is recorded and the ask is dropped.
     */
    const askState = await ctx.runQuery(internal.maya.media.assetAskState, {
      customerId: args.customerId,
      now,
    });

    const feasibility = checkFeasibility({
      needsRealMedia: verdict.trigger === "rung_stuck" && stuck?.rung === "L1",
      productScreenshots: library.productScreenshots,
      hasRecording: library.hasRecording,
      because,
    });

    const change =
      feasibility.state === "blocked"
        ? ""
        : `moving to a format that shows the product on ${stuck?.channel ?? "your channels"}, because ${because}`;

    await ctx.runMutation(internal.maya.strategy.recordChange, {
      customerId: args.customerId,
      day,
      change,
      because,
      trigger: verdict.trigger,
      evidenceJson: JSON.stringify({ perChannel }),
      feasibility: feasibility.state,
      // Recorded either way; only SAID while the policy allows it.
      askedFor: askState === "silent" ? undefined : feasibility.ask,
      now,
    });

    return {
      changed: feasibility.state !== "blocked",
      trigger: verdict.trigger,
      because,
      detail:
        feasibility.state === "blocked"
          ? // Not announced — asked. The change is real and unexecutable.
            (feasibility.ask ?? because)
          : `${change}${feasibility.ask ? ` ${feasibility.ask}` : ""}`,
      ask: feasibility.ask,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* The Plan screen (§16.75)                                                    */
/* -------------------------------------------------------------------------- */

/**
 * ⭐ Everything the Plan screen shows, for the signed-in founder.
 *
 * §16.75: *"I trimmed this out when cutting to six screens. **That was wrong**
 * — the strategy is the most interesting thing she produces, and it's
 * invisible."*
 *
 * Four blocks: who we're targeting · the bet · the current strategy · what
 * changed and why.
 *
 * ⚠️ A PUBLIC query, so it resolves the customer from the Clerk identity and
 * checks ownership by shape — never by trusting an id in the arguments. Same
 * pattern as `productTruth.correct`.
 */
export const planScreen = query({
  // ⚠️ No customerId argument, deliberately. Resolving "my" customer from the
  // identity removes both the client's need to know the id and the chance of
  // an ownership check being written slightly differently at each call site.
  args: {},
  handler: async (
    ctx,
    args
  ): Promise<{
    ok: boolean;
    targeting?: {
      keywords: string[];
      accounts: string[];
      staleDays: number | null;
      /**
       * ⚠️ Surfaced, because "the judge approved everything" and "the judge
       * never ran" produce an identical list. A founder looking at their own
       * targeting is owed the difference.
       */
      relevance: "checked" | "unavailable" | "skipped" | null;
    };
    bet?: { channels: string[] };
    changelog?: Array<{
      day: string;
      change: string;
      because: string;
      trigger: string;
      askedFor?: string;
    }>;
    error?: string;
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { ok: false, error: "sign in first" };

    const creator = (await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first()) as Doc<"creators"> | null;
    if (!creator) return { ok: false, error: "no account yet" };

    const customer = (await ctx.db
      .query("customers")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .first()) as Doc<"customers"> | null;
    if (!customer) return { ok: false, error: "no account yet" };

    const targets = await ctx.runQuery(internal.maya.learnBusiness.targetsFor, {
      customerId: customer._id,
    });

    const channels = (await ctx.db
      .query("channels")
      .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
      .collect()) as Doc<"channels">[];

    const changelog = (await ctx.db
      .query("strategyChanges")
      .withIndex("by_customer_and_created", (q) =>
        q.eq("customerId", customer._id)
      )
      .order("desc")
      .take(20)) as Doc<"strategyChanges">[];

    /**
     * ⚠️ §16.75's own warning, surfaced: *"a stale buyer map silently poisons
     * the idea bank, the format library, and the benchmarks all at once."* The
     * age is shown so it can be acted on rather than silently trusted.
     */
    const updatedAt = targets?.learnedAt ?? null;
    const staleDays =
      updatedAt === null
        ? null
        : Math.floor((Date.now() - updatedAt) / (24 * 3600_000));

    return {
      ok: true,
      targeting: {
        keywords: targets?.keywords ?? [],
        accounts: (targets?.trackedAccounts ?? []).map(
          (a: { handle?: string }) => a.handle ?? ""
        ).filter(Boolean),
        staleDays,
        relevance: targets?.relevance ?? null,
      },
      bet: { channels: channels.map((c) => c.channel) },
      changelog: changelog.map((r) => ({
        day: r.day,
        change: r.change,
        because: r.because,
        trigger: r.trigger,
        askedFor: r.askedFor,
      })),
    };
  },
});
