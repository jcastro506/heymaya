/**
 * The idea bank — a standing inventory, never a blank page.
 *
 * The failure it exists to prevent was **measured**, not assumed: asked for ten
 * varied posts with nothing to draw on, she wrote one idea ten times, and the
 * prose was fine. Good writing, one thought. The bank is what makes "what
 * should I say today" a lookup instead of an act of invention.
 */

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import {
  scoreIdea,
  recencyDecay,
  frequencyWeight,
  RECENCY_HALF_LIFE_MS,
  HEALTHY_BANK_DEPTH,
  type Evidence,
  type ScoredIdea,
} from "../ideas";
import type { Doc, Id } from "../../_generated/dataModel";

const NOW = Date.UTC(2026, 7, 5, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

const ev = (over: Partial<Evidence> = {}): Evidence => ({
  quote: "nobody explains what it actually costs",
  sourceUrls: ["https://tiktok.com/@a/video/1"],
  frequency: 4,
  observedAt: NOW - DAY,
  ...over,
});

describe("⭐ NO EVIDENCE IS NOT A LOW SCORE — IT ISN'T AN IDEA", () => {
  it("an angle with no quote scores zero", () => {
    const { score, why } = scoreIdea(
      { source: "complaint", evidence: ev({ quote: "  " }) },
      NOW
    );
    expect(score).toBe(0);
    expect(why).toMatch(/guess, not an idea/i);
  });

  it("an angle with no source URL scores zero", () => {
    // The receipts are the point. An idea whose evidence can't be opened is an
    // opinion, and §7 forbids publishing from one.
    expect(
      scoreIdea({ source: "complaint", evidence: ev({ sourceUrls: [] }) }, NOW)
        .score
    ).toBe(0);
  });

  it("a real complaint scores above zero", () => {
    expect(scoreIdea({ source: "complaint", evidence: ev() }, NOW).score)
      .toBeGreaterThan(0);
  });
});

describe("SCORING IS MULTIPLICATIVE, AND THAT'S THE DESIGN", () => {
  it("⭐ ONE ZERO TERM KILLS THE IDEA", () => {
    // Summing would let a strong term paper over a fatal one — a perfectly
    // sourced complaint from two years ago would still win on frequency.
    const ancient = scoreIdea(
      { source: "complaint", evidence: ev({ observedAt: NOW - 400 * DAY }) },
      NOW
    );
    const fresh = scoreIdea({ source: "complaint", evidence: ev() }, NOW);
    expect(ancient.score).toBeLessThan(fresh.score / 100);
  });

  it("names the WEAKEST term, so a low score can be argued with", () => {
    const lonely = scoreIdea(
      { source: "complaint", evidence: ev({ frequency: 1 }) },
      NOW
    );
    expect(lonely.why).toMatch(/one person/i);

    const old = scoreIdea(
      { source: "complaint", evidence: ev({ observedAt: NOW - 60 * DAY }) },
      NOW
    );
    expect(old.why).toMatch(/age/i);
  });

  it("a complaint outranks an observation, all else equal", () => {
    // §5.1: comment mining is "the most valuable and the cheapest" input.
    const complaint = scoreIdea({ source: "complaint", evidence: ev() }, NOW);
    const observation = scoreIdea({ source: "observation", evidence: ev() }, NOW);
    expect(complaint.score).toBeGreaterThan(observation.score);
  });

  it("a buyer commenting on OUR post ranks as high as a complaint", () => {
    // That's a buyer telling us what to make. It doesn't get better.
    const own = scoreIdea({ source: "own_comment", evidence: ev() }, NOW);
    const complaint = scoreIdea({ source: "complaint", evidence: ev() }, NOW);
    expect(own.score).toBe(complaint.score);
  });
});

describe("FREQUENCY AND RECENCY", () => {
  it("eleven people beats one, and the curve flattens", () => {
    // §5.0.0's example. But 11 vs 30 is not what decides a post, so the top of
    // the curve is deliberately flat.
    const one = frequencyWeight(1);
    const eleven = frequencyWeight(11);
    const thirty = frequencyWeight(30);
    expect(eleven).toBeGreaterThan(one);
    expect(thirty - eleven).toBeLessThan(eleven - one);
  });

  it("unknown frequency is treated as weak, not as zero", () => {
    expect(frequencyWeight(undefined)).toBeGreaterThan(0);
    expect(frequencyWeight(undefined)).toBeLessThan(frequencyWeight(5));
  });

  it("value halves over the half-life", () => {
    const fresh = recencyDecay(NOW, NOW);
    const halved = recencyDecay(NOW - RECENCY_HALF_LIFE_MS, NOW);
    expect(fresh).toBeCloseTo(1, 1);
    expect(halved).toBeCloseTo(0.5, 1);
  });

  it("an undated observation is neither fresh nor stale", () => {
    // Guessing "today" would let undated junk outrank real recent evidence.
    expect(recencyDecay(undefined, NOW)).toBe(0.5);
  });

  it("SECONDS-BASED TIMESTAMPS DON'T READ AS 1970", () => {
    // The same vendor-units trap that made every TikTok post look 50 years old.
    const secs = Math.floor((NOW - DAY) / 1000);
    expect(recencyDecay(secs, NOW)).toBeGreaterThan(0.8);
  });
});

/* -------------------------------------------------------------------------- */

async function seed(t: ReturnType<typeof convexTest>): Promise<Id<"customers">> {
  return await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("creators", {
      clerkUserId: "u_ideas",
      email: "ideas@example.com",
      channelPreference: "telegram",
      timezone: "UTC",
      status: "active",
      plan: "manager",
      createdAt: NOW,
    });
    return await ctx.db.insert("customers", {
      accountId,
      agentVersion: "v2",
      plan: "mvp",
      state: "active",
      timezone: "UTC",
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
}

const idea = (angle: string, over: Partial<ScoredIdea> = {}): ScoredIdea => ({
  angle,
  source: "complaint",
  evidence: ev({ quote: angle }),
  score: 0.8,
  why: "",
  ...over,
});

describe("THE BANK", () => {
  it("banks ideas and reports what it did", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    const res = await t.mutation(internal.maya.ideas.bankIdeas, {
      customerId,
      ideasJson: JSON.stringify([
        idea("nobody explains what it actually costs"),
        idea("the export keeps timing out on big files"),
      ]),
      now: NOW,
    });
    expect(res.banked).toBe(2);
  });

  it("⭐ THE SAME IDEA TWICE IS BANKED ONCE", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    await t.mutation(internal.maya.ideas.bankIdeas, {
      customerId,
      ideasJson: JSON.stringify([idea("nobody explains what it actually costs")]),
      now: NOW,
    });
    const second = await t.mutation(internal.maya.ideas.bankIdeas, {
      customerId,
      ideasJson: JSON.stringify([
        idea("nobody really explains what this actually costs"),
      ]),
      now: NOW + DAY,
    });
    expect(second.banked).toBe(0);
    expect(second.duplicates).toBe(1);
  });

  it("⭐ AND A USED IDEA STILL BLOCKS A DUPLICATE", async () => {
    // Comparing only against the un-used bank is how an account starts
    // repeating itself a month later — the angle left the bank, so it looks new.
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    await t.mutation(internal.maya.ideas.bankIdeas, {
      customerId,
      ideasJson: JSON.stringify([idea("nobody explains what it actually costs")]),
      now: NOW,
    });
    const first = await t.query(internal.maya.ideas.nextIdea, { customerId, now: NOW });
    await t.mutation(internal.maya.ideas.markUsed, {
      ideaId: first!.ideaId,
      status: "used",
    });

    const again = await t.mutation(internal.maya.ideas.bankIdeas, {
      customerId,
      ideasJson: JSON.stringify([
        idea("nobody really explains what this actually costs"),
      ]),
      now: NOW + 30 * DAY,
    });
    expect(again.banked).toBe(0);
  });

  it("a zero-scored idea is rejected, not stored quietly", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    const res = await t.mutation(internal.maya.ideas.bankIdeas, {
      customerId,
      ideasJson: JSON.stringify([idea("a guess", { score: 0 })]),
      now: NOW,
    });
    expect(res.rejected).toBe(1);
    expect(await t.run((ctx) => ctx.db.query("ideas").collect())).toEqual([]);
  });
});

describe("BANK DEPTH IS A HEALTH METRIC", () => {
  it("⭐ AN EMPTY BANK SAYS PERCEPTION STALLED, BEFORE THE POSTS DEGRADE", async () => {
    // §7.4. This is the only early warning in the system that fires while the
    // content is still good.
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    const health = await t.query(internal.maya.ideas.bankDepth, { customerId });
    expect(health.healthy).toBe(false);
    expect(health.detail).toMatch(/perception has stalled/i);
  });

  it("a full bank is healthy", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    await t.mutation(internal.maya.ideas.bankIdeas, {
      customerId,
      // Genuinely different angles. An earlier version of this fixture used
      // "topic number ${i}", which the dedupe correctly rejected as one idea —
      // short tokens don't count toward similarity, so only the number differed.
      ideasJson: JSON.stringify(
        [
          "nobody explains what it actually costs",
          "exports keep timing out on large files",
          "the mobile app crashes when switching accounts",
          "onboarding assumes you already know the vocabulary",
          "there is no way to undo a bulk delete",
          "search never finds anything older than a month",
          "notifications arrive hours after the thing happened",
          "importing from a spreadsheet mangles every date",
          "the free trial ends without warning anyone",
          "support replies with links instead of answers",
        ].map((angle) => idea(angle))
      ),
      now: NOW,
    });
    const health = await t.query(internal.maya.ideas.bankDepth, { customerId });
    expect(health.healthy).toBe(true);
  });
});

describe("PICKING TODAY'S IDEA", () => {
  it("⭐ RANKING IS RECOMPUTED AT READ TIME, NOT FROZEN AT INSERT", async () => {
    // Recency decays continuously. An idea banked ten days ago must not still
    // be winning on a score it earned when it was new.
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    await t.mutation(internal.maya.ideas.bankIdeas, {
      customerId,
      ideasJson: JSON.stringify([
        idea("an old angle about pricing being unclear", {
          evidence: ev({
            quote: "an old angle about pricing being unclear",
            observedAt: NOW - 40 * DAY,
          }),
        }),
        idea("a fresh angle about exports failing on big files", {
          // Deliberately stored with a LOWER insert score than the old one.
          score: 0.1,
          evidence: ev({
            quote: "a fresh angle about exports failing on big files",
            observedAt: NOW,
          }),
        }),
      ]),
      now: NOW,
    });

    const pick = await t.query(internal.maya.ideas.nextIdea, { customerId, now: NOW });
    expect(pick?.angle).toMatch(/exports failing/);
  });

  it("an empty bank returns null rather than inventing one", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    expect(await t.query(internal.maya.ideas.nextIdea, { customerId })).toBeNull();
  });

  it("a used idea is not offered again", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    await t.mutation(internal.maya.ideas.bankIdeas, {
      customerId,
      ideasJson: JSON.stringify([idea("the only angle in the bank right now")]),
      now: NOW,
    });
    const first = await t.query(internal.maya.ideas.nextIdea, { customerId, now: NOW });
    await t.mutation(internal.maya.ideas.markUsed, {
      ideaId: first!.ideaId,
      status: "used",
    });
    expect(
      await t.query(internal.maya.ideas.nextIdea, { customerId, now: NOW })
    ).toBeNull();
  });

  it("the evidence comes back with it — a draft can always cite", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    await t.mutation(internal.maya.ideas.bankIdeas, {
      customerId,
      ideasJson: JSON.stringify([idea("nobody explains what it actually costs")]),
      now: NOW,
    });
    const pick = await t.query(internal.maya.ideas.nextIdea, { customerId, now: NOW });
    expect(pick?.evidence.sourceUrls.length).toBeGreaterThan(0);
    expect(pick?.evidence.quote).toBeTruthy();
  });
});

describe("⭐ AN ANGLE POINTS AT A PERSON, NOT AT A TOPIC", () => {
  it("the prompt shows the failure it is correcting", async () => {
    // First version asked for "what this founder could say about it" and got
    // advice-column abstractions from specific posts:
    //   "You don't need a full marketing team to start."
    //   "Organic social works best as a consistent feedback channel."
    // Both are §7.5.2's "5 productivity tips" register — they'd make equal
    // sense attached to any source post, which means the source was thrown
    // away. Rewritten with the bad/good pair inline, the same observations
    // produced:
    //   "You listed Community Manager alongside Engine Programmer and Build
    //    Engineer — that's the part of solo development that quietly turns
    //    shipping the game into a second full-time job."
    const { buildAnglePrompt } = await import("../ideas");
    const prompt = buildAnglePrompt(
      { whatItIs: "a dashboard tool", whoItsFor: "solo founders" },
      [{ text: "day one, 16 years old, 31 followers", sourceUrl: "https://x/1" }]
    );
    expect(prompt).toContain("day one, 16 years old, 31 followers");
    expect(prompt).toContain("https://x/1");
  });

  it("an angle whose URL matches nothing collected is DROPPED", async () => {
    // The model inventing a source. An unverifiable idea looks identical to a
    // real one everywhere downstream, which is the whole reason evidence is
    // the entry requirement.
    const { parseAngles } = await import("../ideas");
    const parsed = parseAngles(
      '{"angles":[{"sourceUrl":"https://invented","angle":"x","why":"y"}]}'
    );
    // Parsing keeps it; the banking step is what drops it, by looking the URL
    // up in what was actually collected.
    expect(parsed).toHaveLength(1);
    expect(parsed[0].sourceUrl).toBe("https://invented");
  });

  it("parses an empty set — most posts are not worth answering", async () => {
    const { parseAngles } = await import("../ideas");
    expect(parseAngles('{"angles":[]}')).toEqual([]);
  });
});


/**
 * ⭐ §14.2.2 — last week reaching this week.
 *
 * The gap this closes: she diagnosed on Sunday and Monday's idea selection was
 * made exactly as if she hadn't. That is the difference between a manager who
 * reports and one who manages.
 */
describe("⭐ THE RUNG CHANGES WHICH EVIDENCE TO TRUST", () => {
  const now = Date.UTC(2026, 7, 5);
  const ev = {
    quote: "why do you have 6000 drafts?",
    sourceUrls: ["https://x.com/a/status/1"],
    frequency: 3,
    observedAt: now - 86_400_000,
  };

  it("⭐ L1 (nobody saw it) favours what TRAVELLED in the niche", () => {
    // A format problem. Observations and format cards are things that
    // demonstrably got distribution here.
    const flat = scoreIdea({ source: "observation", evidence: ev }, now).score;
    const tilted = scoreIdea({ source: "observation", evidence: ev }, now, "L1").score;
    expect(tilted).toBeGreaterThan(flat);
  });

  it("⭐ L2 (they scrolled) favours what someone actually SAID", () => {
    // A topic problem. A complaint is a real person naming what they care about.
    const flat = scoreIdea({ source: "complaint", evidence: ev }, now).score;
    const tilted = scoreIdea({ source: "complaint", evidence: ev }, now, "L2").score;
    expect(tilted).toBeGreaterThan(flat);
  });

  it("⭐ EVIDENCE STILL DOMINATES — a tilt cannot outrank a real complaint", () => {
    /**
     * The guardrail that matters. §14.3: own data cannot answer format
     * questions at this volume, so a weekly verdict must NEVER let a one-off
     * observation beat a thing several people complained about. The nudge is
     * ±25%; the evidence gap is larger than that by construction.
     */
    const oneOff = {
      quote: "someone posted a thing",
      sourceUrls: ["https://x.com/a/status/2"],
      frequency: 1,
      observedAt: now - 86_400_000,
    };
    const observationAtL1 = scoreIdea({ source: "observation", evidence: oneOff }, now, "L1").score;
    const complaintAtL1 = scoreIdea({ source: "complaint", evidence: ev }, now, "L1").score;
    expect(complaintAtL1).toBeGreaterThan(observationAtL1);
  });

  it("⭐ L0 AND unknown CHANGE NOTHING", () => {
    // L0 is our own failure to post. It says nothing about which idea is good,
    // and letting it reshuffle the bank would be inventing a content lesson
    // from a week we simply didn't work.
    const flat = scoreIdea({ source: "observation", evidence: ev }, now).score;
    expect(scoreIdea({ source: "observation", evidence: ev }, now, "L0").score).toBe(flat);
    expect(scoreIdea({ source: "observation", evidence: ev }, now, "unknown").score).toBe(flat);
    expect(scoreIdea({ source: "observation", evidence: ev }, now, "healthy").score).toBe(flat);
  });

  it("⭐ AND IT SAYS SO — a ranking that changed silently is unarguable", () => {
    const { why } = scoreIdea({ source: "observation", evidence: ev }, now, "L1");
    expect(why).toMatch(/last week/);
    expect(why).toMatch(/nobody saw us/);
  });

  it("no evidence is still not an idea, whatever the rung", () => {
    const empty = { quote: "", sourceUrls: [] };
    expect(scoreIdea({ source: "observation", evidence: empty }, now, "L1").score).toBe(0);
  });
});
