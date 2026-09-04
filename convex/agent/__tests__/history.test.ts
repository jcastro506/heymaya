/**
 * Sprint 4c: she talks differently at six months than at week two, and the prompt does not
 * grow while she does. Both halves matter — a relationship that costs a bigger prompt every
 * month is a relationship with a ceiling.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { HISTORY, historySection, patternLines, pickMilestone, standingLine, type Standing } from "../history";

const base = (over: Partial<Standing> = {}): Standing => ({ postsRead: 40, daysTogether: 120, ideasSent: 60, postedFromHer: 9, confidence: "solid", ...over });

describe("how well she knows them", () => {
  it("week one hedges and says so; month four does not", () => {
    const early = standingLine(base({ postsRead: 4, daysTogether: 3, ideasSent: 2, postedFromHer: 0, confidence: "new" }));
    expect(early).toMatch(/just started/);
    expect(early).toMatch(/barely seen/);
    expect(early).not.toMatch(/without hedging/);
    const late = standingLine(base());
    expect(late).toMatch(/months/);
    expect(late).toMatch(/without hedging/);
    expect(late).toMatch(/posted 9 of your ideas/);
  });

  it("never draws attention to them not posting her ideas", () => {
    expect(standingLine(base({ postedFromHer: 0, ideasSent: 20 }))).toMatch(/do not mention that/);
  });

  it("a pattern needs three wins before it is worth saying", () => {
    expect(patternLines([{ key: "format:list", wins: 2, medianMultiple: 3 }])).toHaveLength(0);
    const said = patternLines([{ key: "format:list", wins: 3, medianMultiple: 2.4 }]);
    expect(said[0]).toMatch(/3 of their posts/);
    expect(said[0]).toMatch(/2.4×/);
    expect(HISTORY.minPatternWins).toBe(3);
  });

  it("the section stays a fixed handful of lines however long they stay", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ key: `format:f${i}`, wins: 9, medianMultiple: 2 }));
    const long = historySection({ standing: base({ daysTogether: 900, ideasSent: 4000 }), patterns: many });
    expect(long.split("\n").length).toBeLessThanOrEqual(7);
    expect(long.length).toBeLessThan(900);
  });
});

describe("milestones", () => {
  const inp = { topViews: 0, ideasSent: 0, monthsTogether: 0, said: [] as string[] };
  it("says the biggest earned one, and each only once ever", () => {
    const m = pickMilestone({ ...inp, topViews: 1_200_000 })!;
    expect(m.key).toBe("views:1000000");
    expect(m.line).toMatch(/million/);
    expect(pickMilestone({ ...inp, topViews: 1_200_000, said: ["views:1000000"] })?.key).toBe("views:100000");
    expect(pickMilestone({ ...inp, topViews: 1_200_000, said: ["views:1000000", "views:100000"] })).toBeNull();
  });

  it("nothing earned means nothing said", () => {
    expect(pickMilestone(inp)).toBeNull();
    expect(pickMilestone({ ...inp, topViews: 4_000, ideasSent: 3, monthsTogether: 0 })).toBeNull();
  });

  it("a month together and fifty ideas each get one line", () => {
    expect(pickMilestone({ ...inp, monthsTogether: 1 })!.line).toMatch(/a month of this/);
    expect(pickMilestone({ ...inp, ideasSent: 60 })!.line).toMatch(/idea number 50/);
  });

  it("rides an existing message rather than taking its own touch", () => {
    const scout = readFileSync(new URL("../../scout/scout.ts", import.meta.url), "utf8");
    expect(scout).toMatch(/signal\.kind === "win"/);
    expect(scout, "and is recorded as said, in a row, not in her memory").toMatch(/history\.markSaid/);
  });
});

describe("on rows", () => {
  it("computes standing and patterns from their own outcomes, and marks a milestone once", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { channel: { paired: true }, createdAt: now - 100 * 86_400_000 }));
    await t.run(async (ctx) => {
      for (let i = 0; i < 3; i++) {
        await ctx.db.insert("ideas", {
          creatorId, evidenceLinks: [], fit: "yes", fitWhy: "x", version: { hook: "h" }, messageText: "m",
          produced: { skillVersion: "t", model: "m", thresholdsVersion: "t" },
          features: { format: "list", topics: ["running"], tone: "deadpan", lengthBucket: "15-30", sound: "none", source: "breakout" },
          status: "posted", postedAt: now - 10 * 86_400_000, outcomeMultiple: 2 + i, outcomeLearnedAt: now,
          sentAt: now - 11 * 86_400_000, createdAt: now - 11 * 86_400_000,
        } as never);
      }
      for (let i = 0; i < 14; i++) {
        await ctx.db.insert("ownPosts", { creatorId, platform: "tiktok", postId: `p${i}`, url: `https://tiktok.com/@a/video/${i}`, createTime: now - i * 86_400_000, contentType: "video", caption: "c", hashtags: [], metrics: { views: i === 0 ? 140_000 : 1000, likes: 1, comments: 1, shares: 1 }, metricsAsOf: now, source: "scrape" } as never);
      }
    });
    const h = (await t.query(internal.agent.history.forCreator, { creatorId }))!;
    expect(h.standing.confidence).toBe("thin");
    expect(h.standing.postedFromHer).toBe(3);
    expect(h.patterns.find((p) => p.key === "format:list")?.wins).toBe(3);

    const mi = (await t.query(internal.agent.history.milestoneInputs, { creatorId }))!;
    const m = pickMilestone(mi)!;
    expect(m.key).toBe("views:100000");
    await t.mutation(internal.agent.history.markSaid, { creatorId, key: m.key });
    const after = (await t.query(internal.agent.history.milestoneInputs, { creatorId }))!;
    // The SAME milestone is never said twice; a different earned one may follow, and this
    // creator is three months in, so "months" is legitimately next.
    expect(after.said).toContain("views:100000");
    expect(pickMilestone(after)?.key).not.toBe("views:100000");
    for (const key of ["views:100000", "months:1", "months:6", "months:12", "ideas:50", "ideas:200"]) {
      await t.mutation(internal.agent.history.markSaid, { creatorId, key });
    }
    const exhausted = (await t.query(internal.agent.history.milestoneInputs, { creatorId }))!;
    expect(pickMilestone(exhausted), "nothing left to say").toBeNull();
  });

  it("every skill sees it, or a new one silently forgets how long she has known them", () => {
    const files = ["opinion", "converse", "profile", "moment"].map((f) => readFileSync(new URL(`../${f}.ts`, import.meta.url), "utf8"))
      .concat([
        readFileSync(new URL("../../scout/scout.ts", import.meta.url), "utf8"),
        readFileSync(new URL("../../review/weekly.ts", import.meta.url), "utf8"),
        readFileSync(new URL("../../onboarding/firstRead.ts", import.meta.url), "utf8"),
      ]);
    for (const src of files) for (const call of src.match(/buildPrefix\(\{[^}]*\}\)/g) ?? []) expect(call, `buildPrefix without history: ${call}`).toMatch(/\bhistory\b/);
  });
});
