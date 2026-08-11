/**
 * ⭐ `run-experiment` (§15.3, Sprint 8) — declare it, watch it, call it.
 *
 * > **Judgment:** one hypothesis worth two weeks, at the right rung ·
 * > **Hard rules:** one live experiment per channel · pre-declared window and
 * > metric · **"inconclusive" is a legitimate verdict** and is said out loud.
 *
 * ## Why this exists now rather than later
 *
 * `review-strategy` already reads `experimentConcluded` as one of its four
 * change triggers, and **nothing supplied it** — a dangling input I left when
 * building the bar. An experiment that can never conclude is a trigger that can
 * never fire.
 *
 * ## ⚠️ The window and metric are declared BEFORE the data arrives
 *
 * That is the whole discipline. Choosing the metric after seeing the numbers is
 * how you always find a win — you pick the column that moved. Pre-declaring
 * them means the experiment can fail, which is the only thing that makes it
 * worth running.
 *
 * ## ⚠️ "Inconclusive" is said out loud
 *
 * `summarizeExperiment` returns `not_enough_data`, and it is reported as a real
 * answer rather than swallowed or rounded into a lean. Two weeks of posting at
 * this volume often genuinely cannot separate two hooks (§14.3 — own data
 * answers coarse questions only), and pretending otherwise is how a system
 * starts optimising noise.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import {
  MIN_CONVERSIONS,
  summarizeExperiment,
  type Arm,
} from "../gtmMaya/experimentStats";

/** §15.3: "one hypothesis worth two weeks". */
export const WINDOW_DAYS = 14;

export interface Experiment {
  id: string;
  channel: string;
  hypothesis: string;
  /** Declared up front. Changing it after the fact is the failure this prevents. */
  metric: "views" | "engagements";
  arms: string[];
  startedAt: number;
  endsAt: number;
  verdict?: { kind: string; detail: string; calledAt: number };
}

export function parseExperiments(json: string | undefined): Experiment[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? (parsed as Experiment[]) : [];
  } catch {
    return [];
  }
}

/**
 * ⭐ One live experiment per channel.
 *
 * Two at once on the same surface makes both unreadable: a post is in both, and
 * neither verdict can be attributed. Same reasoning as §16.75.05's one-change
 * rule, one level down.
 */
export function liveOn(experiments: Experiment[], channel: string, now: number): Experiment | null {
  return (
    experiments.find(
      (e) => e.channel === channel && !e.verdict && e.endsAt > now
    ) ?? null
  );
}

/**
 * Experiments whose window has closed and which have no verdict yet.
 *
 * ⚠️ Closed, not "closed and successful". An experiment that ran its two weeks
 * and gathered nothing still needs its verdict called — leaving it open forever
 * is how a registry fills with things nobody will ever conclude.
 */
export function dueForVerdict(experiments: Experiment[], now: number): Experiment[] {
  return experiments.filter((e) => !e.verdict && e.endsAt <= now);
}

/**
 * Call it, including the honest non-answer.
 *
 * Reuses `summarizeExperiment` rather than reimplementing the maths — it
 * already encodes the win and lean thresholds and the minimum-conversions
 * floor, and a second implementation would eventually disagree with the first.
 */
export function callVerdict(
  experiment: Experiment,
  arms: Arm[]
): { kind: string; detail: string } {
  const summary = summarizeExperiment(arms);

  /**
   * ⭐ A lean below the conversions floor is INCONCLUSIVE here.
   *
   * `summarizeExperiment` gates `MIN_CONVERSIONS` on a *winner* call only, and
   * will return `leaning` off a single conversion — deliberately, since a lean
   * there is described as "provisional, not a promotion".
   *
   * ⚠️ That is the wrong default for THIS caller. A verdict from here feeds
   * `review-strategy`'s change trigger, so a lean off one conversion could move
   * the whole strategy — which is precisely what the two-week bar exists to
   * prevent (§14.3: own data answers coarse questions only).
   *
   * The shared summariser is left alone; other callers may legitimately want a
   * provisional lean. This one raises its own floor.
   */
  const leaderConversions = Math.max(
    ...summary.arms.map((a) => a.conversions),
    0
  );
  const tooThin =
    summary.verdict === "leaning" && leaderConversions < MIN_CONVERSIONS;

  if (summary.verdict === "not_enough_data" || tooThin) {
    // ⚠️ Said out loud, per §15.3. Not softened into a lean.
    return {
      kind: "inconclusive",
      /**
       * ⚠️ "Still an open question, not a no." An inconclusive result read as
       * a rejection quietly kills ideas that were never actually tested —
       * which at this volume (§14.3) is most of them.
       */
      detail: `two weeks wasn't enough to tell — ${experiment.hypothesis} is still an open question, not a no.${
        summary.conversionsNeeded > 0
          ? ` I'd need about ${summary.conversionsNeeded} more to call it.`
          : ""
      }`,
    };
  }

  const leader = summary.winner ?? summary.leader ?? "neither";
  return {
    kind: summary.verdict,
    detail:
      summary.verdict === "winner"
        ? `${leader} won — ${experiment.hypothesis}`
        : `${leader} is ahead but not decisively — ${experiment.hypothesis}`,
  };
}

/* -------------------------------------------------------------------------- */

export const declare = internalMutation({
  args: {
    customerId: v.id("customers"),
    channel: v.string(),
    hypothesis: v.string(),
    metric: v.union(v.literal("views"), v.literal("engagements")),
    arms: v.array(v.string()),
    now: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: boolean; id?: string; reason?: string }> => {
    const customer = (await ctx.db.get(args.customerId)) as Doc<"customers"> | null;
    if (!customer) return { ok: false, reason: "no such account" };
    if (args.arms.length < 2) {
      return { ok: false, reason: "an experiment needs at least two arms" };
    }

    const now = args.now ?? Date.now();
    const experiments = parseExperiments(customer.experimentsJson);

    const already = liveOn(experiments, args.channel, now);
    if (already) {
      // Named, so she can say WHICH one is in the way rather than just "no".
      return {
        ok: false,
        reason: `already running one on ${args.channel}: ${already.hypothesis}`,
      };
    }

    const id = `x_${now.toString(36)}`;
    experiments.push({
      id,
      channel: args.channel,
      hypothesis: args.hypothesis,
      metric: args.metric,
      arms: args.arms,
      startedAt: now,
      endsAt: now + WINDOW_DAYS * 86_400_000,
    });

    await ctx.db.patch(args.customerId, {
      // Keep the last 20 — a registry is a working set, not an archive.
      experimentsJson: JSON.stringify(experiments.slice(-20)),
      updatedAt: now,
    });
    return { ok: true, id };
  },
});

export const recordVerdict = internalMutation({
  args: {
    customerId: v.id("customers"),
    id: v.string(),
    kind: v.string(),
    detail: v.string(),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const customer = (await ctx.db.get(args.customerId)) as Doc<"customers"> | null;
    if (!customer) return { ok: false };
    const now = args.now ?? Date.now();
    const experiments = parseExperiments(customer.experimentsJson);

    const target = experiments.find((e) => e.id === args.id);
    // A verdict already called is not overwritten — the first answer is the
    // one that was true at the window's close.
    if (!target || target.verdict) return { ok: false };

    target.verdict = { kind: args.kind, detail: args.detail, calledAt: now };
    await ctx.db.patch(args.customerId, {
      experimentsJson: JSON.stringify(experiments),
      updatedAt: now,
    });
    return { ok: true };
  },
});

/**
 * ⭐ The verdict `review-strategy` reads.
 *
 * Returns the most recently concluded experiment, so its change trigger finally
 * has a source. Null when nothing concluded — which is the common case, and
 * the reason the strategy default stays "no".
 */
export const latestConcluded = internalQuery({
  args: { customerId: v.id("customers"), sinceDays: v.optional(v.number()), now: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<{ name: string; verdict: string } | null> => {
    const customer = (await ctx.db.get(args.customerId)) as Doc<"customers"> | null;
    if (!customer) return null;
    const now = args.now ?? Date.now();
    const since = now - (args.sinceDays ?? 7) * 86_400_000;

    const concluded = parseExperiments(customer.experimentsJson)
      .filter((e) => e.verdict && e.verdict.calledAt >= since)
      .sort((a, b) => (b.verdict?.calledAt ?? 0) - (a.verdict?.calledAt ?? 0));

    const latest = concluded[0];
    if (!latest?.verdict) return null;
    return { name: latest.channel, verdict: latest.verdict.detail };
  },
});
