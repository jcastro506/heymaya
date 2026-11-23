/**
 * Sprint 4d: the lane is read from behaviour, not asked for.
 *
 * Everything downstream inherits it — the sweep's keywords, the roster's filter, the scout's
 * fit test — so a creator who cannot write a niche sentence otherwise gets a weak product
 * with no path back. Same failure shape as the thin roster.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { driftShare, hookPhrase, LANE, laneQuestion, readLane } from "../lane";

const post = (caption: string, hashtags: string[], multiple: number | null = 1) => ({ caption, hashtags, multiple });

describe("reading the lane", () => {
  it("weights the hashtags they use by how those posts did", () => {
    const r = readLane([
      post("morning run", ["running", "runtok"], 3),
      post("another run", ["running", "runtok"], 2.5),
      post("random", ["baking"], 0.3),
      post("one more", ["running", "marathontraining"], 2),
      post("and one", ["marathontraining", "runtok"], 1.8),
    ]);
    expect(r.keywords[0]).toBe("running");
    expect(r.keywords).toContain("runtok");
    expect(r.keywords, "a single weak post does not make a lane").not.toContain("baking");
    expect(r.confidence).toBe("solid");
    expect(r.basis).toMatch(/hashtags/);
  });

  it("falls back to repeated caption words when they barely hashtag", () => {
    const r = readLane([
      post("marathon training week one", [], 2),
      post("marathon training week two", [], 2),
      post("marathon training week three", [], 2),
      post("marathon pace work", [], 1.5),
      post("pace work again", [], 1.5),
    ]);
    expect(r.keywords).toContain("marathon");
    expect(r.basis).toMatch(/words and hashtags/);
  });

  it("strips the noise everyone uses", () => {
    const r = readLane([post("x", ["fyp", "viral", "running"], 2), post("y", ["fyp", "foryou", "running"], 2)]);
    expect(r.keywords).toEqual(["running"]);
  });

  it("says none rather than inventing a lane from nothing", () => {
    expect(readLane([]).confidence).toBe("none");
    expect(readLane([post("hello", [])]).confidence).toBe("none");
  });

  it("states it back for one tap, citing their own best post", () => {
    const q = laneQuestion(["running", "runtok", "marathontraining"], ["i run so i can rot the rest of the day"]);
    expect(q).toMatch(/running, runtok, marathontraining/);
    expect(q).toMatch(/rot the rest of the day/);
    expect(q.trim().endsWith("right?"), "one tap, not an essay").toBe(true);
  });
});

describe("drift", () => {
  it("measures how much of the lane is new, and only a real move counts", () => {
    expect(driftShare(["running", "runtok"], ["running", "runtok"])).toBe(0);
    expect(driftShare(["running", "runtok"], ["travel", "brisbane", "solotravel", "running"])).toBeCloseTo(0.75);
    expect(driftShare(["running"], ["running", "runtok"])).toBeCloseTo(0.5);
    expect(driftShare(["running"], [])).toBe(0);
    expect(LANE.driftShare).toBeGreaterThanOrEqual(0.5);
  });
});

describe("confirming it", () => {
  it("repoints the dossier keywords, which is what the sweep and roster read", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { niche: "", dossier: { persona: { summary: "x" }, keywords: ["old"] } }));
    const r = await t.mutation(internal.onboarding.lane.confirm, { creatorId, keywords: ["Running", "#runtok", "marathontraining", "ab"] });
    expect(r.ok).toBe(true);
    expect(r.keywords, "normalised, deduped, junk dropped").toEqual(["running", "runtok", "marathontraining"]);
    const c = await t.run((ctx) => ctx.db.get(creatorId));
    expect((c!.dossier as { keywords: string[] }).keywords).toEqual(r.keywords);
    expect(c!.laneConfirmedAt).toBeTypeOf("number");
    expect(c!.niche, "an empty niche is filled from the lane so nothing downstream is blank").toBe("running, runtok, marathontraining");
  });

  it("refuses an empty lane rather than blanking what they had", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { dossier: { persona: { summary: "x" }, keywords: ["running"] } }));
    expect((await t.mutation(internal.onboarding.lane.confirm, { creatorId, keywords: ["a", ""] })).ok).toBe(false);
    expect(((await t.run((ctx) => ctx.db.get(creatorId)))!.dossier as { keywords: string[] }).keywords).toEqual(["running"]);
  });

  it("the tap confirms what she actually proposed, not a fresh read", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", {}));
    await t.mutation(internal.onboarding.lane.stashRead, { creatorId, token: "tok", keywords: ["running", "runtok"] });
    await t.mutation(internal.onboarding.lane.stashRead, { creatorId, token: "tok", keywords: ["changed"] });
    const stash = await t.query(internal.onboarding.lane.readByToken, { creatorId, token: "tok" });
    expect(stash?.keywords, "the first read stands").toEqual(["running", "runtok"]);
  });

  it("cross-tenant: another creator's stashed read is not readable", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => seedCreator(ctx, "a", {}));
    const b = await t.run((ctx) => seedCreator(ctx, "b", {}));
    await t.mutation(internal.onboarding.lane.stashRead, { creatorId: a, token: "tok", keywords: ["running"] });
    expect(await t.query(internal.onboarding.lane.readByToken, { creatorId: b, token: "tok" })).toBeNull();
  });
});

describe("what a live first read taught the lane (2026-09-05)", () => {
  it("glue words never become a lane, however often they repeat", () => {
    const posts = Array.from({ length: 6 }, (_, i) => ({ caption: `best part of traveling is seeing people who have no idea ${i}`, hashtags: ["travel", "londonlife"], multiple: 1 }));
    const r = readLane(posts);
    expect(r.keywords).not.toContain("have");
    expect(r.keywords).not.toContain("best");
    expect(r.keywords).not.toContain("part");
    expect(r.keywords.slice(0, 2)).toEqual(["travel", "londonlife"]);
  });

  it("the hook she quotes is a short first clause, not a truncated caption", () => {
    expect(hookPhrase("Best part of traveling is seeing people who have no idea how kind strangers are. #travel")).toBe("best part of traveling is seeing people who have no idea");
    expect(hookPhrase("i run so i can rot the rest of the day, honestly")).toBe("i run so i can rot the rest of the day");
    const q = laneQuestion(["travel", "londonlife"], ["Best part of traveling is seeing people who have no idea how kind strangers are."]);
    expect(q.length).toBeLessThan(160);
    expect(q.endsWith("right?")).toBe(true);
  });
});

import { distinctWords, proposeLane } from "../lane";
import type { Lanes } from "../clusters";

const lanesOf = (clusters: Lanes["clusters"], posts: number, state: Lanes["state"]): Lanes => ({ readAt: 1, posts, scatter: 1 - (clusters[0]?.share ?? 0), state, clusters });
const cl = (label: string, keywords: string[], n: number, share: number, medianMultiple: number | null) => ({ label, keywords, postIds: Array.from({ length: n }, (_, i) => `${label}${i}`), share, medianMultiple });

describe("the lane proposal for an account that may have none (Sprint 4f)", () => {
  it("rewarded and admired disagree: one question, two candidates, the rewarded one first", () => {
    const lanes = lanesOf([cl("food reviews", ["food", "restaurant"], 3, 0.25, 0.8), cl("london runs", ["running", "london"], 2, 0.17, 2.4), cl("travel days", ["travel", "brisbane"], 2, 0.17, 0.9)], 12, "scattered");
    const p = proposeLane({ lanes, laneKeywords: ["travel", "london"], admiredKeywords: ["travel", "backpacking"], stated: "", laneConfidence: "thin" });
    expect(p.state).toBe("scattered");
    expect(p.candidates[0].source).toBe("rewarded");
    expect(p.candidates[0].label).toBe("london runs");
    expect(p.candidates[1].source).toBe("admired");
    expect(p.question).toMatch(/london runs/);
    expect(p.question).toMatch(/travel days/);
    expect(p.question).toMatch(/which one/);
    expect(p.read).toMatch(/directions/);
  });

  it("rewarded and admired agree: a recommendation with a go-with-that question, never a quiz", () => {
    const lanes = lanesOf([cl("food reviews", ["food"], 3, 0.25, 0.8), cl("london runs", ["running", "london"], 2, 0.17, 2.4)], 12, "scattered");
    const p = proposeLane({ lanes, laneKeywords: [], admiredKeywords: ["running", "marathon"], stated: "", laneConfidence: "none" });
    expect(p.candidates.length).toBe(1);
    expect(p.recommendation?.label).toBe("london runs");
    expect(p.question).toMatch(/go with that/);
    expect(p.question).not.toMatch(/what's your niche/);
  });

  it("known: the sentence and the biggest group agree; unnamed: biggest group, no question", () => {
    const lanes = lanesOf([cl("london runs", ["running", "london"], 8, 0.7, 1.3), cl("travel", ["travel"], 2, 0.17, 0.9)], 12, "unnamed");
    expect(proposeLane({ lanes, laneKeywords: [], admiredKeywords: [], stated: "running content in london", laneConfidence: "solid" }).state).toBe("known");
    const u = proposeLane({ lanes, laneKeywords: [], admiredKeywords: [], stated: "", laneConfidence: "solid" });
    expect(u.state).toBe("unnamed");
    expect(u.question).toBeNull();
    expect(u.recommendation?.label).toBe("london runs");
  });

  it("nothing read is none, with no candidates invented", () => {
    const p = proposeLane({ lanes: null, laneKeywords: [], admiredKeywords: ["x"], stated: "cooking", laneConfidence: "none" });
    expect(p.state).toBe("none");
    expect(p.candidates).toEqual([]);
  });
});

describe("what the live proposal taught it (2026-09-06)", () => {
  it("a group at 0× is never rewarded; the admired lane is a candidate with no posts there yet, so the split question fires", () => {
    const lanes = lanesOf([cl("pipeline tests", ["pipeline", "testing"], 2, 0.2, 0), cl("travel awe", ["travel", "sights"], 3, 0.3, 1.29)], 10, "scattered");
    const p = proposeLane({ lanes, laneKeywords: [], admiredKeywords: ["running", "runtok", "marathon"], stated: "", laneConfidence: "thin" });
    expect(p.candidates.map((c) => c.source)).toEqual(["rewarded", "admired"]);
    expect(p.candidates[0].label).toBe("travel awe");
    expect(p.candidates[1].label).toBe("running marathon");
    expect(p.candidates[1].evidence).toMatch(/no posts there yet/);
    expect(p.question).toMatch(/travel awe/);
    expect(p.question).toMatch(/running marathon/);
    expect(distinctWords(["runner", "running", "runtok", "track", "injury"], 2)).toEqual(["runner", "track"]);
    const none = proposeLane({ lanes: lanesOf([cl("pipeline tests", ["pipeline"], 2, 0.2, 0)], 10, "scattered"), laneKeywords: [], admiredKeywords: [], stated: "", laneConfidence: "none" });
    expect(none.candidates[0].source, "with nothing rewarded and nothing admired, the biggest group is offered as what it is").toBe("biggest");
  });
});

import { candidatesNamed, ensureCandidatesNamed } from "../firstRead";

describe("buttons and the question agree (live 2026-09-06)", () => {
  it("a message that names every candidate stands; one that dropped them gets the proposal line appended", () => {
    const line = "your best posts are the travel moments ones, but the accounts you admire make runner track. which one do you want to be?";
    expect(candidatesNamed("Travel Moments or runner track?", ["travel moments", "runner track"])).toBe(true);
    expect(candidatesNamed("are we aiming to grow around the software builds?", ["travel moments", "runner track"])).toBe(false);
    const fixed = ensureCandidatesNamed("i went through your feeds. are we aiming for software builds?", ["travel moments", "runner track"], line);
    expect(fixed.endsWith(line)).toBe(true);
    expect(ensureCandidatesNamed(`fine. ${line}`, ["travel moments", "runner track"], line)).toBe(`fine. ${line}`);
  });
});

import { firstReadSkill } from "../firstRead";

describe("first contact: how she sees them, proved by their standout post, then a finished first post; no question (2026-11-23)", () => {
  it("every shape: how she sees them as a correctable statement, the standout with its numbers, a finished idea with a word-for-word hook, no question, no hedging", () => {
    for (const [said, conv] of [[true, false], [false, false], [true, true]] as const) {
      const sk = firstReadSkill(said, conv);
      expect(sk).toMatch(/standout post/);
      expect(sk).toMatch(/copied exactly/);
      expect(sk).toMatch(/How you see them, said as a statement, never a question/);
      expect(sk).toMatch(/if that's not you, tell me/);
      expect(sk).toMatch(/The first post to make, finished/);
      expect(sk).toMatch(/word for word/);
      expect(sk).toMatch(/No question anywhere/);
      expect(sk).toMatch(/never a trait you weren't given/);
      expect(sk).toMatch(/hold me loosely/); // named as banned
      expect(sk).not.toMatch(/whatever's happening that week|keep their content calendar/);
    }
    expect(firstReadSkill(true)).toMatch(/No name, no introduction/);
    expect(firstReadSkill(false)).toMatch(/Say hi and your name/);
  });
});

describe("the opening's idea lands in their app, linked (2026-11-23)", () => {
  it("parses the idea from her text and refuses an empty one", async () => {
    const { parseOpeningIdea, withIdeaLink } = await import("../firstRead");
    expect(parseOpeningIdea('{"hook":"the guy on the same treadmill for two years","why":"real footage, one dry line","shoot":"3 shots, 10 sec"}')).toEqual({ hook: "the guy on the same treadmill for two years", why: "real footage, one dry line", shoot: "3 shots, 10 sec" });
    expect(parseOpeningIdea('{"hook":""}')).toBeNull();
    expect(parseOpeningIdea("not json")).toBeNull();
    const t = withIdeaLink("how i see you\n---\nfirst one to make: …", "https://staging.hey-maya.ai/o/idea/abc");
    expect(t.split("\n---\n")).toHaveLength(2);
    expect(t.split("\n---\n")[1]).toMatch(/in your Maya app.*https:\/\/staging\.hey-maya\.ai\/o\/idea\/abc$/s);
  });

  it("day one's plan leads with it, and the plan text links the app and, without a calendar, how to connect one", async () => {
    const { openingFirst, composeWeek } = await import("../../calendar/weekPlan");
    const picked = [{ ideaId: "a" }, { ideaId: "open" }, { ideaId: null }];
    expect(openingFirst(picked, [{ ideaId: "a" }, { ideaId: "open", opening: true }]).map((p) => p.ideaId)).toEqual(["open", "a", null]);
    const slot = { day: 1, film: { start: Date.UTC(2026, 10, 26, 23), end: Date.UTC(2026, 10, 27, 0) }, edit: null, post: { at: Date.UTC(2026, 10, 27, 23), hour: 18, fromHistory: false }, ideaId: "open", hook: "the treadmill guy", experiment: false };
    const none = composeWeek([slot], "America/New_York", false, "this week", undefined, true, { app: "https://x/app/today", calendar: "https://x/app/calendar" });
    expect(none).toMatch(/connect your calendar there.*https:\/\/x\/app\/calendar/s);
    expect(none).toMatch(/https:\/\/x\/app\/today/);
    const has = composeWeek([slot], "America/New_York", false, "this week", undefined, true, { app: "https://x/app/today" });
    expect(has).toMatch(/your week's in the app: https:\/\/x\/app\/today want them on your calendar\?/);
    expect(composeWeek([slot], "America/New_York", false, "next week", undefined, false)).not.toMatch(/https?:/);
  });
});

describe("the opening reads right as one message (sim, 2026-11-23)", () => {
  it("an inline break becomes a real one; a real one is left alone", async () => {
    const { splitMarks } = await import("../firstRead");
    expect(splitMarks("how i see you. --- A 30-second dinner.")).toBe("how i see you.\n---\nA 30-second dinner.");
    expect(splitMarks("a\n---\nb")).toBe("a\n---\nb");
    expect(splitMarks("a well-made post -- not a break")).toBe("a well-made post -- not a break");
  });
  it("as the opening, 'ok, done going through your posts' goes: she never said she was looking", async () => {
    const { openingWithRead } = await import("../hello");
    const o = openingWithRead("hi, it's Maya!", "Ok, done going through your posts. People stay for the honest panic.\n---\nNext up: …").split("\n---\n");
    expect(o[1]).toBe("People stay for the honest panic.");
  });
});

describe("a plan never has the same idea twice (sim, 2026-11-23)", () => {
  it("near-identical hooks are one idea", async () => {
    const { pickIdeas } = await import("../../calendar/planning");
    const ideas = [
      { ideaId: "a", hook: "Okay, I'm freaking out.", status: "sent", sentAt: 2 },
      { ideaId: "b", hook: "Okay, I'm freaking out..", status: "sent", sentAt: 3 },
      { ideaId: "c", hook: "Mile 1 vs mile 16", status: "sent", sentAt: 1 },
    ];
    const got = pickIdeas(ideas as never, 3, null).map((x) => x.ideaId);
    expect(got).toHaveLength(2);
    expect(got).toContain("c");
  });
});

describe("a plan never says to post in the middle of the night (sim, 2026-11-23)", () => {
  it("history at 3 am still plans a post when they're awake", async () => {
    const { draftWeek } = await import("../../calendar/planning");
    const slots = draftWeek({ now: Date.UTC(2026, 10, 23, 17), timeZone: "America/Denver", postsPerWeek: 2, filmDays: [], filmHour: null, editMinutes: 0, busy: [], model: { hours: [{ hour: 3, score: 2, n: 4 }], confidence: "solid", defaultHour: 3 } as never, ideas: [{ ideaId: "a", hook: "x", experiment: false }, { ideaId: "b", hook: "y", experiment: false }], days: 7 });
    for (const s of slots) expect(s.post.hour, "a waking hour").toBeGreaterThanOrEqual(7);
  });
});
