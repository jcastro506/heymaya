import { convexTest } from "convex-test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { subjectFor } from "../scenarios";
import { PROBES } from "../converse";

describe("scenario creators are their own rows, never customers (2026-09-06)", () => {
  it("seeding is idempotent, paused, unpaired, and runs the real onboarding path (the catalogue job is enqueued)", async () => {
    const t = convexTest(schema, modules);
    const a = await t.mutation(internal.eval.scenarios.seedOne, { handle: "vanessaalopezz", admired: ["andi.renay"], niche: "" });
    const b = await t.mutation(internal.eval.scenarios.seedOne, { handle: "vanessaalopezz", admired: ["andi.renay"], niche: "" });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.creatorId).toBe(a.creatorId);
    const c = await t.run((ctx) => ctx.db.get(a.creatorId));
    expect(c?.clerkUserId).toBe(subjectFor("vanessaalopezz"));
    expect(c?.plan.status).toBe("paused");
    expect(c?.channel.paired).toBe(false);
    const jobs = await t.run((ctx) => ctx.db.query("jobs").collect());
    expect(jobs.some((j) => j.kind === "ingest_catalogue" && j.creatorId === a.creatorId)).toBe(true);
    const set = await t.query(internal.eval.run.scenarioCreators, {});
    expect(set.missing, "no dossier yet is loud, not silent").toContain("vanessaalopezz (no dossier yet)");
  });

  it("a customer with the same handle is never picked as the scenario", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert("creators", { clerkUserId: "user_real", email: "", handles: { tiktok: "vanessaalopezz" }, ownership: "unverified", niche: "", timezone: "UTC", quietHours: { start: "22:00", end: "07:00" }, tone: "friend", mode: "full", dossierVersion: 1, dossier: { persona: {} }, notes: [], affinities: [], experiments: [], channel: { paired: true }, plan: { status: "active", founding: true }, createdAt: Date.now() } as never));
    const set = await t.query(internal.eval.run.scenarioCreators, {});
    expect(set.ids).toEqual([]);
    expect(set.missing).toContain("vanessaalopezz");
  });
});

describe("the conversation gauntlet", () => {
  beforeAll(() => { process.env.MODEL_FAKE = "1"; });
  afterAll(() => { delete process.env.MODEL_FAKE; });

  it("the bank covers the categories a creator actually texts", () => {
    const cats = new Set(PROBES.map((p) => p.category));
    for (const c of ["commit", "calendar", "opinion", "numbers", "growth", "manage", "hostile", "delete"]) expect(cats.has(c), c).toBe(true);
    expect(PROBES.length).toBeGreaterThanOrEqual(12);
  });

  it("runs the bank through the real path and records a judged row per reply under suite converse", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => ctx.db.insert("creators", { clerkUserId: subjectFor("vanessaalopezz"), email: "", handles: { tiktok: "vanessaalopezz" }, ownership: "unverified", niche: "running", timezone: "UTC", quietHours: { start: "22:00", end: "07:00" }, tone: "friend", mode: "full", dossierVersion: 1, dossier: { persona: { summary: "runner" }, keywords: ["running"] }, notes: [], affinities: [], experiments: [], channel: { paired: false }, plan: { status: "paused", founding: true }, createdAt: Date.now() } as never));
    const r = await t.action(internal.eval.converse.run, { creatorId, limit: 2 });
    expect(r.turns).toBe(2);
    expect(r.replied).toBeGreaterThanOrEqual(1);
    const rows = await t.run((ctx) => ctx.db.query("evalRuns").collect());
    expect(rows.filter((x) => x.suite === "converse").length).toBeGreaterThanOrEqual(1);
    const outs = await t.run((ctx) => ctx.db.query("messages").collect());
    expect(outs.filter((m) => m.direction === "out").every((m) => !m.deliveredAt), "nothing is delivered: no chat is paired").toBe(true);
  });
});
