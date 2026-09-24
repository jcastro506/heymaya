/**
 * Quality-gate tests, written as a garbage gauntlet.
 *
 * The point of these is not that good input passes — that's easy and proves
 * little. It's that each specific way research degrades gets caught by name.
 * Every `it` below is a real failure mode this product would otherwise ship
 * without noticing, because all of them return HTTP 200 and look like work.
 */

import { describe, expect, it } from "vitest";
import {
  assessInsight,
  assessSweep,
  parseFillerVerdict,
  MIN_AUTHOR_DIVERSITY,
  namesSomethingConcrete,
  similarity,
  type Observation,
} from "../quality";

const NOW = Date.UTC(2026, 6, 31, 12, 0, 0);
const DAY = 86_400_000;

function obs(over: Partial<Observation> = {}, i = 0): Observation {
  return {
    sourceUrl: `https://x.com/dev${i}/status/${1000 + i}`,
    authorHandle: `dev${i}`,
    postedAt: NOW - DAY,
    capturedAt: NOW,
    kind: "post",
    text: "migrations keep failing at 3am",
    metrics: { views: 4000, likes: 120, comments: 14, shares: 3 },
    ...over,
  };
}

function healthySet(n = 10, over: Partial<Observation> = {}): Observation[] {
  return Array.from({ length: n }, (_, i) => obs(over, i));
}

function gates(v: { failures: Array<{ gate: string }> }): string[] {
  return v.failures.map((f) => f.gate);
}

describe("a healthy sweep passes — the control", () => {
  it("ten fresh, sourced, engaged observations from ten authors", () => {
    const verdict = assessSweep({ kind: "trend", observations: healthySet(), now: NOW });
    expect(verdict.ok).toBe(true);
    expect(verdict.failures).toEqual([]);
  });
});

describe("THE GAUNTLET — each way research quietly degrades", () => {
  it("an empty sweep is a failure, not a quiet zero", () => {
    const verdict = assessSweep({ kind: "trend", observations: [], now: NOW });
    expect(gates(verdict)).toEqual(["empty"]);
  });

  it("STALE: a 'trend' from three months ago is history, not a trend", () => {
    // Acting on this is how a feed starts looking six months old.
    const old = healthySet(10, { postedAt: NOW - 90 * DAY, capturedAt: NOW - 90 * DAY });
    const verdict = assessSweep({ kind: "trend", observations: old, now: NOW });
    expect(gates(verdict)).toContain("stale");
    const stale = verdict.failures.find((f) => f.gate === "stale");
    expect(stale && "oldestAgeDays" in stale && stale.oldestAgeDays).toBe(90);
  });

  it("STALE: the same age passes for a buyer map, which moves slower", () => {
    // Windows differ by kind because the underlying reality does.
    const old = healthySet(12, { postedAt: NOW - 60 * DAY, capturedAt: NOW - 60 * DAY });
    const verdict = assessSweep({ kind: "buyer_map", observations: old, now: NOW });
    expect(gates(verdict)).not.toContain("stale");
  });

  it("STALE: undated observations can't be judged fresh, so they aren't", () => {
    const undated = healthySet(10, { postedAt: undefined, capturedAt: undefined });
    const verdict = assessSweep({ kind: "trend", observations: undated, now: NOW });
    expect(gates(verdict)).toContain("stale");
  });

  it("UNGROUNDED: an observation with no source URL can't be checked by anyone", () => {
    const set = healthySet(10);
    set[3] = { ...set[3], sourceUrl: undefined };
    set[7] = { ...set[7], sourceUrl: undefined };
    const verdict = assessSweep({ kind: "trend", observations: set, now: NOW });
    const f = verdict.failures.find((x) => x.gate === "ungrounded");
    expect(f && "missing" in f && f.missing).toBe(2);
  });

  it("MONOCULTURE: twenty posts from one account is not a survey of a niche", () => {
    // Any conclusion drawn from this is really a conclusion about one person.
    const set = Array.from({ length: 20 }, (_, i) => obs({ authorHandle: "sameguy" }, i));
    const verdict = assessSweep({ kind: "trend", observations: set, now: NOW });
    expect(gates(verdict)).toContain("monoculture");
    const f = verdict.failures.find((x) => x.gate === "monoculture");
    expect(f && "distinctAuthors" in f && f.distinctAuthors).toBe(1);
  });

  it("MONOCULTURE: the threshold is a ratio, so a big diverse sweep still passes", () => {
    const set = Array.from({ length: 30 }, (_, i) =>
      obs({ authorHandle: `dev${i % 12}` }, i)
    );
    const verdict = assessSweep({ kind: "trend", observations: set, now: NOW });
    expect(30 > 0 && 12 / 30).toBeGreaterThan(MIN_AUTHOR_DIVERSITY);
    expect(gates(verdict)).not.toContain("monoculture");
  });

  it("SAMPLE SIZE: a benchmark from two posts is noise with a decimal point", () => {
    const verdict = assessSweep({
      kind: "benchmark",
      observations: healthySet(2),
      now: NOW,
    });
    const f = verdict.failures.find((x) => x.gate === "sample_too_small");
    expect(f && "need" in f && f.need).toBe(8);
  });

  it("NO ENGAGEMENT: a 'trend' nobody liked isn't working, it's just recent", () => {
    // The subtlest one. These posts are fresh, sourced, and diverse — and
    // completely unread. A pipeline that only checks presence ships this.
    const dead = healthySet(10, { metrics: { views: 0, likes: 0, comments: 0, shares: 0 } });
    const verdict = assessSweep({ kind: "trend", observations: dead, now: NOW });
    expect(gates(verdict)).toContain("no_engagement");
  });

  it("NO ENGAGEMENT: missing metrics entirely also fails — absence isn't evidence", () => {
    const noMetrics = healthySet(10, { metrics: undefined });
    const verdict = assessSweep({ kind: "trend", observations: noMetrics, now: NOW });
    expect(gates(verdict)).toContain("no_engagement");
  });

  it("reports EVERY failure at once, not just the first", () => {
    // A degraded sweep is usually wrong several ways, and fixing them one run
    // at a time is slow.
    const bad = Array.from({ length: 3 }, (_, i) =>
      obs(
        {
          authorHandle: "sameguy",
          sourceUrl: undefined,
          postedAt: NOW - 200 * DAY,
          capturedAt: NOW - 200 * DAY,
          metrics: undefined,
        },
        i
      )
    );
    const verdict = assessSweep({ kind: "benchmark", observations: bad, now: NOW });
    expect(gates(verdict).sort()).toEqual([
      "monoculture",
      "no_engagement",
      "sample_too_small",
      "stale",
      "ungrounded",
    ]);
  });
});

describe("assessInsight — the anti-generic gate", () => {
  const grounded = { citations: ["https://x.com/dev1/status/1001"] };

  it("a specific, cited insight passes", () => {
    const verdict = assessInsight({
      ...grounded,
      text: "@postgres_dan's thread on 3am rollback failures hit 41000 views in a day",
    });
    expect(verdict.ok).toBe(true);
  });

  it("GENERIC: the sentence that would fit any product in any niche", () => {
    // This is the output that passes every presence check and means nothing —
    // the stock photo of research.
    const verdict = assessInsight({
      ...grounded,
      text: "Engagement is up. Focus on authentic content that resonates with your audience to drive growth.",
    });
    expect(gates(verdict)).toContain("generic");
  });

  it("GENERIC: naming nothing concrete fails even if it reads well", () => {
    const verdict = assessInsight({
      ...grounded,
      text: "Developers are frustrated with database tooling and want simpler workflows.",
    });
    expect(gates(verdict)).toContain("generic");
  });

  it("UNGROUNDED: an insight with no citation is a guess in a finding's clothes", () => {
    const verdict = assessInsight({
      citations: [],
      text: "@postgres_dan's thread hit 41000 views",
    });
    expect(gates(verdict)).toContain("ungrounded");
  });

  it("REPEAT: last week's finding restated in new words", () => {
    // The most common way research output degrades, and invisible unless
    // something compares.
    const lastWeek =
      "@postgres_dan's thread about rollback failures at 3am reached 41000 views quickly";
    const verdict = assessInsight({
      ...grounded,
      text: "@postgres_dan's thread about 3am rollback failures reached 41000 views quickly",
      priorInsights: [lastWeek],
    });
    expect(gates(verdict)).toContain("repeat");
  });

  it("REPEAT: a genuinely different finding is not flagged", () => {
    const verdict = assessInsight({
      ...grounded,
      text: "@vector_kate's benchmark post on pgvector indexing hit 12000 views",
      priorInsights: [
        "@postgres_dan's thread about rollback failures at 3am reached 41000 views",
      ],
    });
    expect(gates(verdict)).not.toContain("repeat");
  });

  it("empty text fails immediately", () => {
    expect(assessInsight({ ...grounded, text: "  " }).ok).toBe(false);
  });
});

describe("the primitives", () => {
  it("namesSomethingConcrete finds handles, URLs and real numbers", () => {
    expect(namesSomethingConcrete("@dan said so")).toBe(true);
    expect(namesSomethingConcrete("see https://x.com/a/1")).toBe(true);
    expect(namesSomethingConcrete("41000 views")).toBe(true);
    expect(namesSomethingConcrete("engagement is trending upward")).toBe(false);
  });

  it("a single digit isn't a number worth citing", () => {
    expect(namesSomethingConcrete("there are 3 things")).toBe(false);
  });

  it("⭐ THE HEDGE WORDLIST IS GONE — a judge reads the sentence", () => {
    /**
     * It was thirteen words deciding whether text was padding, and it was
     * wrong in the obvious direction: "drive engagement" is filler,
     * "3 engagements on that post" is a fact. A wordlist counts both.
     *
     * A word is not filler because of the word. That distinction needs
     * reading, so it needs a model.
     */
    expect(parseFillerVerdict(JSON.stringify({ filler: true, why: "no subject" })))
      .toEqual({ filler: true, why: "no subject" });
    expect(parseFillerVerdict(JSON.stringify({ filler: false, why: "names a post" })))
      .toEqual({ filler: false, why: "names a post" });
  });

  it("⭐ AN UNREADABLE VERDICT IS null, AND THE CALLER FAILS OPEN", () => {
    // A quality nudge that can't run must not silently reject every idea. The
    // gate that DOES fail closed is the safety critic, at the publish boundary.
    expect(parseFillerVerdict("probably filler tbh")).toBeNull();
    expect(parseFillerVerdict(JSON.stringify({ why: "hm" }))).toBeNull();
  });

  it("similarity is symmetric and bounded", () => {
    const a = "rollback failures at 3am on postgres";
    const b = "postgres rollback failures happening at 3am";
    expect(similarity(a, b)).toBe(similarity(b, a));
    expect(similarity(a, a)).toBe(1);
    expect(similarity(a, "completely unrelated vector indexing benchmark")).toBeLessThan(
      0.2
    );
  });

  it("similarity ignores short words, which are noise", () => {
    expect(similarity("the a of and to", "the a of and to")).toBe(1);
  });
});
