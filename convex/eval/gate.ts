/**
 * The regression gate (plan §18 gate 9, Sprint 3c).
 *
 * ⚠️ WHY THIS EXISTS. On 2026-09-02 I changed three prompts in an afternoon and told the
 * operator the output was better, on the evidence of two examples I had chosen myself.
 * That is an anecdote, and it is precisely the way a system gets quietly worse: each change
 * looks fine in the two cases its author looked at.
 *
 * WHAT IT HOLDS FIXED, so that a difference means something:
 *  - the scenarios, declared in `SCENARIO_HANDLES`, never "whatever is in the database";
 *  - the vendor, replayed from recorded fixtures, so a lane going quiet is not a regression;
 *  - the number of runs, because one sample of a stochastic model is not a measurement.
 * What is deliberately NOT held fixed is the model and the prompts. Those are the thing
 * under test.
 *
 * WHAT IT IS NOT. Nine of the twelve checks and most of the judge score FORM, not outcome.
 * This gate can tell you she got worse at sounding like a person. It cannot tell you the
 * idea was good. Only the prediction scoring and the posted-rate can do that, and both need
 * weeks of a live pilot. Do not let a green gate stand in for that.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { SCENARIO_HANDLES } from "./run";
import { RUBRIC_VERSION } from "./checks";

/**
 * How far each number may move before it counts as a regression rather than noise.
 *
 * These are deliberately loose. With a handful of scenarios and a temperature above zero,
 * a few points of movement is the model breathing, not a change in quality. A gate that
 * cries wolf gets ignored, and an ignored gate is worse than none.
 */
export const TOLERANCE = {
  passRate: 0.15,        // 15 points of pass rate
  judgeBad: 0.5,         // corny / generic: half a point worse on a 0-3 scale
  judgeGood: 0.5,        // specific / wouldSend / soundsLikeThem: half a point worse
  sentRate: 0.3,         // how often she says anything at all; a gate that silences her is a regression too
} as const;

export interface Summary {
  n: number;
  sent: number;
  /**
   * How many messages a judge actually scored. Load-bearing: an unavailable judge yields
   * zeros, and a zero reads as "not corny" AND as "not specific at all". Comparing those
   * against a judged baseline reports a swing in either direction that is purely the
   * judge's availability. Judge dimensions are only compared when both sides were judged.
   */
  judged: number;
  passRate: number;
  sentRate: number;
  scenarios: string[];
  judge: { corny: number; generic: number; specific: number; wouldSend: number; soundsLikeThem: number };
}

export interface Delta { name: string; before: number; after: number; change: number; regressed: boolean }

const round = (x: number) => Math.round(x * 100) / 100;

/** Aggregate the eval rows a suite produced. Pure. */
export function summarize(rows: Array<Pick<Doc<"evalRuns">, "pass" | "judge">>, runs: number, scenarios: string[]): Summary {
  const n = rows.length;
  const mean = (pick: (j: NonNullable<Doc<"evalRuns">["judge"]>) => number): number => {
    const judged = rows.map((r) => r.judge).filter(Boolean) as Array<NonNullable<Doc<"evalRuns">["judge"]>>;
    return judged.length ? round(judged.reduce((s, j) => s + pick(j), 0) / judged.length) : 0;
  };
  const judgedCount = rows.filter((r) => r.judge).length;
  return {
    n: runs,
    sent: n,
    judged: judgedCount,
    // Of the messages she actually wrote, how many were clean.
    passRate: n ? round(rows.filter((r) => r.pass).length / n) : 0,
    // Of the chances she had, how often she said anything. Falling silent is not a pass.
    sentRate: runs ? round(n / runs) : 0,
    scenarios,
    judge: {
      corny: mean((j) => j.corny),
      generic: mean((j) => j.generic),
      specific: mean((j) => j.specific),
      wouldSend: mean((j) => j.wouldSend),
      soundsLikeThem: mean((j) => j.soundsLikeThem ?? 3),
    },
  };
}

/** Compare a run to a baseline. Pure. `regressed` is per-number so a report can name the one that moved. */
export function compare(before: Summary, after: Summary): { pass: boolean; deltas: Delta[] } {
  const d = (name: string, b: number, a: number, tol: number, higherIsBetter: boolean): Delta => {
    const change = round(a - b);
    const regressed = higherIsBetter ? change < -tol : change > tol;
    return { name, before: b, after: a, change, regressed };
  };
  const deltas = [
    d("passRate", before.passRate, after.passRate, TOLERANCE.passRate, true),
    d("sentRate", before.sentRate, after.sentRate, TOLERANCE.sentRate, true),
  ];
  // Only compare the judge when a judge was actually there on both sides.
  if (before.judged > 0 && after.judged > 0) {
    deltas.push(
      d("corny", before.judge.corny, after.judge.corny, TOLERANCE.judgeBad, false),
      d("generic", before.judge.generic, after.judge.generic, TOLERANCE.judgeBad, false),
      d("specific", before.judge.specific, after.judge.specific, TOLERANCE.judgeGood, true),
      d("wouldSend", before.judge.wouldSend, after.judge.wouldSend, TOLERANCE.judgeGood, true),
      d("soundsLikeThem", before.judge.soundsLikeThem, after.judge.soundsLikeThem, TOLERANCE.judgeGood, true),
    );
  }
  return { pass: !deltas.some((x) => x.regressed), deltas };
}

export const latestBaseline = internalQuery({
  args: { suite: v.string() },
  handler: async (ctx, a): Promise<Doc<"evalBaselines"> | null> =>
    (await ctx.db.query("evalBaselines").withIndex("by_suite_at", (q) => q.eq("suite", a.suite)).order("desc").first()) as Doc<"evalBaselines"> | null,
});

export const rowsSince = internalQuery({
  args: { since: v.number(), suite: v.string() },
  handler: async (ctx, a): Promise<Array<Pick<Doc<"evalRuns">, "pass" | "judge">>> =>
    ((await ctx.db.query("evalRuns").withIndex("by_at", (q) => q.gte("at", a.since)).collect()) as Doc<"evalRuns">[])
      .filter((r) => r.suite === a.suite)
      .map((r) => ({ pass: r.pass, judge: r.judge })),
});

export const saveBaseline = internalMutation({
  args: { suite: v.string(), rubricVersion: v.string(), gitSha: v.string(), note: v.string(), summary: v.any() },
  handler: async (ctx, a): Promise<{ id: string }> => {
    const s = a.summary as Summary;
    // Write only the fields the table declares, and coerce them: `summary` arrives through
    // v.any(), so a stray undefined or an extra key from a future Summary field would be
    // rejected by the schema validator as an opaque failure at insert time.
    const id = await ctx.db.insert("evalBaselines", {
      suite: a.suite,
      rubricVersion: a.rubricVersion,
      gitSha: a.gitSha,
      note: a.note,
      n: Number(s.n ?? 0),
      scenarios: (s.scenarios ?? []).map(String),
      passRate: Number(s.passRate ?? 0),
      sent: Number(s.sent ?? 0),
      judged: Number(s.judged ?? 0),
      judge: {
        corny: Number(s.judge?.corny ?? 0),
        generic: Number(s.judge?.generic ?? 0),
        specific: Number(s.judge?.specific ?? 0),
        wouldSend: Number(s.judge?.wouldSend ?? 0),
        soundsLikeThem: Number(s.judge?.soundsLikeThem ?? 0),
      },
      at: Date.now(),
    });
    return { id };
  },
});

/**
 * Run the suite and either compare it to the standing baseline, or become the baseline.
 *
 * `record: true` freezes this reading. Do that on a commit you are happy with, never to
 * make a red gate go green: that is how a baseline drifts down one accepted regression at
 * a time until it certifies nothing.
 */
export const run = internalAction({
  args: { suite: v.optional(v.string()), n: v.optional(v.number()), record: v.optional(v.boolean()), gitSha: v.optional(v.string()), note: v.optional(v.string()) },
  handler: async (ctx, a): Promise<{
    ok: boolean;
    comparable: boolean;
    reason: string;
    summary: Summary;
    baseline: { at: number; gitSha: string; note: string } | null;
    deltas: Delta[];
  }> => {
    const suite = a.suite ?? "scout";

    /**
     * ⚠️ Reset the signals first, or the gate measures a different question each time.
     * A scout run writes a verdict on every candidate it judges, so the second run sees an
     * empty board and sends nothing — which reads as "she went quiet", a regression that is
     * really just the first run having eaten the evidence. Reopening restores the same
     * starting position, which is what makes two readings comparable at all.
     */
    const set = await ctx.runQuery(internal.eval.run.scenarioCreators, {});
    for (const creatorId of set.ids) await ctx.runMutation(internal.onboarding.dev.reopenSignals, { creatorId });

    const started = Date.now();
    const r = await ctx.runAction(internal.eval.run.scout, { n: a.n ?? 2 });

    const rows = await ctx.runQuery(internal.eval.gate.rowsSince, { since: started, suite });
    const summary = summarize(rows, r.runs, [...SCENARIO_HANDLES]);

    // A suite missing a scenario is not comparable to one that had it. Say so and stop.
    if (!r.comparable) {
      return { ok: false, comparable: false, reason: `scenario set incomplete: missing ${r.missing.join(", ")}`, summary, baseline: null, deltas: [] };
    }

    /**
     * A reading nothing judged is not a baseline. Recording one would freeze zeros that
     * later read as a collapse in specificity the moment the judge is back.
     */
    if (a.record && summary.sent > 0 && summary.judged === 0) {
      return { ok: false, comparable: false, reason: "the judge scored nothing this run — fix the judge before freezing a baseline", summary, baseline: null, deltas: [] };
    }

    if (a.record) {
      await ctx.runMutation(internal.eval.gate.saveBaseline, { suite, rubricVersion: RUBRIC_VERSION, gitSha: a.gitSha ?? "unknown", note: a.note ?? "", summary });
      return { ok: true, comparable: true, reason: "recorded as the new baseline", summary, baseline: null, deltas: [] };
    }

    const b = await ctx.runQuery(internal.eval.gate.latestBaseline, { suite });
    if (!b) return { ok: true, comparable: false, reason: "no baseline yet — run with record:true on a commit you trust", summary, baseline: null, deltas: [] };

    /**
     * ⚠️ Same ruler, or no comparison. A baseline taken with different checks will report a
     * change in the checks as a change in quality, which is the fastest way to make a gate
     * worthless.
     */
    if ((b.rubricVersion ?? "1") !== RUBRIC_VERSION) {
      return { ok: true, comparable: false, reason: `baseline was measured with rubric ${b.rubricVersion ?? "1"}, this run is rubric ${RUBRIC_VERSION} — re-record a baseline before comparing`, summary, baseline: { at: b.at, gitSha: b.gitSha, note: b.note }, deltas: [] };
    }

    const before: Summary = { n: b.n, sent: b.sent, judged: b.judged ?? 0, passRate: b.passRate, sentRate: b.n ? round(b.sent / b.n) : 0, scenarios: b.scenarios, judge: b.judge };
    const { pass, deltas } = compare(before, summary);
    const moved = deltas.filter((x) => x.regressed).map((x) => `${x.name} ${x.before}→${x.after}`);
    return {
      ok: pass,
      comparable: true,
      reason: pass ? "no regression beyond tolerance" : `regressed: ${moved.join(", ")}`,
      summary,
      baseline: { at: b.at, gitSha: b.gitSha, note: b.note },
      deltas,
    };
  },
});
