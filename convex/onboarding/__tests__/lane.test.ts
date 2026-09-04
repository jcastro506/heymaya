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
import { driftShare, LANE, laneQuestion, readLane } from "../lane";

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
