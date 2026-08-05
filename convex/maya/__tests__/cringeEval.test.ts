/**
 * The cringe eval — and the eval's own eval.
 *
 * Sprint 4's exit is "a stranger can't tell it isn't the founder writing" and
 * nothing measured it. The trap in building that measurement is **an eval that
 * always passes**: a judge answering "human" to everything scores a perfect
 * 50% and is measuring nothing, while quietly blessing whatever we ship.
 *
 * So most of what follows tests that this file can FAIL.
 */

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import {
  scoreRun,
  parseJudgement,
  buildJudgePrompt,
  SYNTHETIC_CONTROL,
  MIN_PAIRS,
  DETECTABLE_AT,
  JUDGE_MODEL,
  scoreVariety,
  MAX_MEAN_SIMILARITY,
  MAX_TOPIC_COVERAGE,
} from "../cringeEval";
import type { Id } from "../../_generated/dataModel";

const NOW = Date.UTC(2026, 7, 5, 12, 0, 0);
const pairs = (correct: number, total: number) =>
  Array.from({ length: total }, (_, i) => ({ correct: i < correct }));

describe("⭐ THE EVAL MUST BE ABLE TO FAIL", () => {
  it("A RUN IS VOID IF THE JUDGE MISSES THE CONTROL", () => {
    // The whole design. A judge that can't spot marketing copy stuffed with
    // every §7.5.2 tell is not judging — and its 50% would read as a pass.
    const result = scoreRun(pairs(5, 10), false);
    expect(result.verdict).toBe("void");
    expect(result.detail).toMatch(/synthetic|isn't judging/i);
  });

  it("a void run is NOT reported as indistinguishable", () => {
    // The failure mode that matters: void and pass must never look alike,
    // because one means "she's good" and the other means "we don't know".
    expect(scoreRun(pairs(5, 10), false).verdict).not.toBe("indistinguishable");
  });

  it("the control is genuinely full of tells", () => {
    // If someone softens this over time the eval quietly loses its floor.
    const c = SYNTHETIC_CONTROL.toLowerCase();
    expect(c).toContain("unlock");
    expect(c).toContain("in today's");
    expect(c).toContain("game-changer");
    expect(c).toMatch(/it's not .* — it's/); // the reversal
    expect(c).toMatch(/fast, simple, and powerful/); // triadic list
    expect(c).toMatch(/\?|👇/); // engagement bait
  });

  it("too few pairs is void, not a lucky pass", () => {
    // Five pairs at 50% looks perfect and is a coin landing flat.
    const result = scoreRun(pairs(2, MIN_PAIRS - 1), true);
    expect(result.verdict).toBe("void");
    expect(result.detail).toMatch(/too few/i);
  });
});

describe("50% IS THE TARGET, NOT ZERO", () => {
  it("chance means she is indistinguishable", () => {
    const result = scoreRun(pairs(5, 10), true);
    expect(result.verdict).toBe("indistinguishable");
    expect(result.accuracy).toBe(0.5);
  });

  it("⭐ RELIABLY WRONG IS ALSO DETECTABLE", () => {
    // A judge that picks hers 0% of the time is just as informative as one
    // that picks 100% — her posts are systematically distinguishable and we
    // had the sign backwards. Scoring only one direction would call this a
    // triumph.
    const result = scoreRun(pairs(0, 10), true);
    expect(result.verdict).toBe("detectable");
  });

  it("a judge that always finds her is detectable", () => {
    expect(scoreRun(pairs(10, 10), true).verdict).toBe("detectable");
  });

  it("near-chance survives — one extra correct call is not a signal", () => {
    // 60% on 10 pairs is a single coin flip away from 50%. Treating that as
    // failure would make the eval fire constantly and get ignored.
    expect(scoreRun(pairs(6, 10), true).verdict).toBe("indistinguishable");
  });

  it("the threshold is stated, not implied", () => {
    expect(DETECTABLE_AT).toBeGreaterThan(0.5);
    expect(DETECTABLE_AT).toBeLessThanOrEqual(0.9);
  });
});

describe("THE JUDGE", () => {
  it("is a different family from the writer", () => {
    // Luna judging Luna is the critic trap one level up: a model asked whether
    // text sounds machine-made, on text it wrote, is being asked to see its
    // own defaults.
    expect(JUDGE_MODEL).not.toMatch(/^openai\//);
    expect(JUDGE_MODEL).not.toMatch(/^openrouter\//); // direct REST call
  });

  it("reads a verdict, fenced or bare", () => {
    expect(parseJudgement('{"ai":"A","why":"triadic list"}')).toBe("A");
    expect(parseJudgement('```json\n{"ai":"B","why":"too complete"}\n```')).toBe("B");
  });

  it("an unreadable verdict is null, and drops the pair", () => {
    // Better to lose a pair than to score a guess as data.
    expect(parseJudgement("I think both look human")).toBeNull();
    expect(parseJudgement('{"ai":"C"}')).toBeNull();
  });

  it("the prompt shows both posts and nothing about which is which", () => {
    const prompt = buildJudgePrompt("hers", "theirs");
    expect(prompt).toContain("POST A:");
    expect(prompt).toContain("POST B:");
    expect(prompt).not.toMatch(/maya|agent|generated|ours/i);
  });
});

describe("THE HUMAN SIDE IS REAL NICHE WRITING", () => {
  async function seed(t: ReturnType<typeof convexTest>, texts: string[]) {
    return await t.run(async (ctx) => {
      const accountId = await ctx.db.insert("creators", {
        clerkUserId: "u_eval",
        email: "eval@example.com",
        channelPreference: "telegram",
        timezone: "UTC",
        status: "active",
        plan: "manager",
        createdAt: NOW,
      });
      const customerId = await ctx.db.insert("customers", {
        accountId,
        agentVersion: "v2",
        plan: "mvp",
        state: "active",
        timezone: "UTC",
        createdAt: NOW,
        updatedAt: NOW,
      });
      for (const [i, text] of texts.entries()) {
        await ctx.db.insert("observations", {
          customerId,
          channel: "tiktok",
          sourceUrl: `https://tiktok.com/@a/video/${i}`,
          kind: "post",
          text,
          capturedAt: NOW + i,
          velocity: 10,
        });
      }
      return customerId as Id<"customers">;
    });
  }

  it("takes real captions from what she actually scrolled", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, [
      "spent all weekend on a feature nobody asked for. classic. shipping it anyway because i like it",
      "the hardest part of building solo isn't the code it's deciding what not to build",
    ]);
    const samples = await t.query(internal.maya.cringeEval.humanSamples, {
      customerId,
    });
    expect(samples).toHaveLength(2);
  });

  it("⭐ DROPS HASHTAG SOUP — pairing against it would flatter her", () => {
    // A caption that's mostly tags isn't writing. Beating it proves nothing,
    // and it would drag the score toward a false pass.
    return (async () => {
      const t = convexTest(schema, modules);
      const customerId = await seed(t, [
        "#fyp #viral #foryou #solofounder #buildinpublic #startup #tech #saas #indie",
        "the hardest part of building solo isn't the code it's deciding what not to build",
      ]);
      const samples = await t.query(internal.maya.cringeEval.humanSamples, {
        customerId,
      });
      expect(samples).toHaveLength(1);
      expect(samples[0]).toMatch(/hardest part/);
    })();
  });

  it("drops one-liners and essays", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, [
      "nice",
      "word ".repeat(200),
      "the hardest part of building solo isn't the code it's deciding what not to build",
    ]);
    const samples = await t.query(internal.maya.cringeEval.humanSamples, {
      customerId,
    });
    expect(samples).toHaveLength(1);
  });
});

describe("⭐ SOUNDING HUMAN IS NOT THE SAME AS BEING WORTH POSTING", () => {
  it("ONE IDEA WRITTEN TEN TIMES FAILS, EVEN THOUGH IT READS HUMAN", () => {
    // Measured live 2026-08-05. Asked for ten VARIED posts she returned one
    // idea ten times, and the pairwise judge scored them at exactly chance —
    // correctly, because each one reads like a person wrote it.
    //
    // The register was fine and the week was still empty. A judge comparing
    // one post to one caption cannot see that the other nine were the same
    // post, so the eval passed something no founder would accept.
    const real = [
      "Building solo is hard enough. Widgetly turns a CSV into a dashboard in one paste.",
      "CSV in. Dashboard out.",
      "One less dashboard project for solo founders.",
      "Your data is already in a CSV. Widgetly gives it a dashboard in one paste.",
      "Building alone means every extra step counts. Widgetly keeps CSV-to-dashboard work to one paste.",
      "Widgetly is for the moment when your CSV is ready, but your dashboard still isn't.",
      "One paste between your CSV and a dashboard.",
    ];
    const result = scoreVariety(real);
    expect(result.varied).toBe(false);
    expect(result.detail).toMatch(/one idea/i);
    // Names the term rather than asserting a number, so a human can check it.
    expect(result.dominantTerm).toBe("dashboard");
    expect(result.topicCoverage).toBe(1);
  });

  it("genuinely different posts pass", () => {
    const varied = scoreVariety([
      "spent the morning reading comment sections instead of writing. best decision this week.",
      "nobody warns you that the hardest part of shipping alone is deciding what not to build",
      "someone asked why we don't have a free tier. honest answer: i haven't figured out the math yet.",
      "three people this week described the same problem in almost the same words. that's a post, not a coincidence.",
    ]);
    expect(varied.varied).toBe(true);
    expect(varied.detail).toMatch(/different posts/i);
  });

  it("one post has nothing to compare against", () => {
    expect(scoreVariety(["a single post"]).varied).toBe(true);
  });

  it("⭐ THE THRESHOLDS WERE MEASURED, AND THE FIRST GUESS WAS WRONG", () => {
    // 0.35 was invented and PASSED the seven-identical-posts batch, because
    // Jaccard punishes length differences — "CSV in. Dashboard out." shares one
    // long word with the full sentence. Measured: 0.170 for the same-idea batch
    // against 0.019 for a varied one.
    expect(MAX_MEAN_SIMILARITY).toBeLessThan(0.17);
    expect(MAX_MEAN_SIMILARITY).toBeGreaterThan(0.019);
    // Coverage separates 1.00 from 0.50 with room on both sides.
    expect(MAX_TOPIC_COVERAGE).toBeLessThan(1);
    expect(MAX_TOPIC_COVERAGE).toBeGreaterThan(0.5);
  });
});
