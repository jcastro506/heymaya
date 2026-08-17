/**
 * ⭐ Every sweep that gets SCHEDULED must have a function to run.
 *
 * ## The bug
 *
 * `watchers.ts` had two tables:
 *
 * - `weeklyRefs`, declared inside the scheduling loop and **never read** — pure
 *   decoration that documented the intent.
 * - `refs`, inside `sweepOne`, which did the actual dispatch.
 *
 * They disagreed. `refs` was missing `benchmarks` and `strategy`, so both hit
 * `no such sweep`, returned `ok: false`, and — because that branch returns
 * before the catch — **kept their claim**. Claimed means done. Done means never
 * retried.
 *
 * ⚠️ So the niche medians never refreshed and the strategy review never ran.
 * Every week. Silently. The dashboard's benchmark column was reading a
 * `nicheCache` row nothing was updating, and §16.3 calls that column "the part
 * no competitor can copy".
 *
 * This is the mandated sibling-file coherence category, and it is exactly the
 * shape that category exists for: two lists that must agree, with nothing
 * checking that they do.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SWEEPS, WEEKLY_SWEEPS, sweepRefs } from "../convex/maya/watchers";

describe("sweep dispatch covers every scheduled sweep", () => {
  it("⭐ every daily sweep has a function", () => {
    const refs = sweepRefs();
    const missing = SWEEPS.filter((name) => !refs[name]);
    expect(
      missing,
      `These sweeps are scheduled and would log "no such sweep", keep their ` +
        `claim, and never run again: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("⭐ every WEEKLY sweep has a function — the two that didn't", () => {
    const refs = sweepRefs();
    const missing = WEEKLY_SWEEPS.filter((name) => !refs[name]);
    expect(missing).toEqual([]);
    // Named explicitly, because these are the two that were broken.
    expect(refs.benchmarks).toBeTruthy();
    expect(refs.strategy).toBeTruthy();
  });

  it("has no handler for a sweep nobody schedules", () => {
    /**
     * The other direction. A ref with no schedule is dead weight that reads
     * like coverage — and the next person adding a sweep copies the pattern
     * and wonders why theirs never fires.
     */
    const scheduled = new Set<string>([...SWEEPS, ...WEEKLY_SWEEPS]);
    const orphans = Object.keys(sweepRefs()).filter((n) => !scheduled.has(n));
    expect(orphans).toEqual([]);
  });

  it("⚠️ the weekly report is chained to `strategy`, not scheduled beside it", () => {
    /**
     * The sweeps are dispatched with `runAfter(0)` in a loop, so they run
     * CONCURRENTLY — list order guarantees nothing. As a sibling sweep the
     * report could compose before `strategy` wrote its changelog entry and
     * relay LAST week's verdict, which looks exactly like working.
     *
     * Asserted on the source because the alternative is scheduling a real
     * sweep and racing it, and the property worth protecting is one line.
     */
    const source = require("node:fs").readFileSync(
      require("node:path").join(
        __dirname,
        "..",
        "convex",
        "maya",
        "watchers.ts",
      ),
      "utf8",
    );
    expect(source).toMatch(/args\.sweep === "strategy"/);
    expect(source).toMatch(/weeklyReport\.sendWeeklyReview/);
    // And it must NOT be a sibling entry — that would reintroduce the race.
    expect(WEEKLY_SWEEPS as readonly string[]).not.toContain("report");
  });

  it("⚠️ the dead `weeklyRefs` table is gone", () => {
    /**
     * A second table that documents intent while a different one dispatches is
     * how the two drifted apart in the first place. One source, or the drift
     * comes back.
     */
    const source = require("node:fs").readFileSync(
      require("node:path").join(
        __dirname,
        "..",
        "convex",
        "maya",
        "watchers.ts",
      ),
      "utf8",
    );
    expect(source).not.toMatch(/const weeklyRefs/);
  });
});

/* -------------------------------------------------------------------------- */

/**
 * ⭐⭐ THE MOAT HAD NO PRODUCER.
 *
 * CLAUDE.md's pitch, verbatim: *"she watches what's actually working in the
 * niche, MINES WHAT BUYERS ARE COMPLAINING ABOUT, and then writes."*
 *
 * ⚠️ `mineComplaints` ran daily and stored what it found. `bankFromComplaints`
 * turns those into ideas and had **no caller**, so complaints accumulated in a
 * table and never became a post. Measured live 2026-08-17 across 193 ideas:
 * `observation` 101, `format_card` 92, **`complaint` 0** — while
 * `SOURCE_WEIGHT.complaint` is 1.0, the ceiling of the scoring function.
 */
describe("the scroll banks complaints as well as observations", () => {
  it("⭐ scroll calls bankFromComplaints", () => {
    const src = readFileSync(
      join(process.cwd(), "convex/maya/hooks.ts"),
      "utf8",
    );
    expect(src).toContain("ideas.bankFromComplaints");
  });

  it("⚠️ and still banks observations — this is an addition, not a swap", () => {
    // Both sources or the bank narrows instead of widening. The standing rule
    // for the daily niche cron is ADD, never replace.
    const src = readFileSync(
      join(process.cwd(), "convex/maya/hooks.ts"),
      "utf8",
    );
    expect(src).toContain("ideas.bankFromObservations");
  });

  it("⚠️ complaint outranks every other source in scoring", async () => {
    /**
     * Why the missing wire mattered so much. A complaint is not one input among
     * several — it is the ceiling, because someone typed it about a real problem
     * they actually have.
     */
    const { scoreIdea } = await import("../convex/maya/ideas");
    const now = 1_800_000_000_000;
    const evidence = {
      quote: "nobody explains what it actually costs",
      sourceUrls: ["https://example.com/thread"],
      observedAt: now,
    };
    const complaint = scoreIdea({ source: "complaint", evidence }, now).score;
    const observation = scoreIdea({ source: "observation", evidence }, now).score;
    const card = scoreIdea({ source: "format_card", evidence }, now).score;
    expect(complaint).toBeGreaterThan(observation);
    expect(complaint).toBeGreaterThan(card);
  });
});
