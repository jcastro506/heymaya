/**
 * The first-week simulation: its schedule is deterministic, it refuses anything that is not one of
 * its own creators, a creator is made by the real signup path, the fleet never runs its clones, and
 * the report has the shape the lead reads. No network, no model.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { normalizePhone } from "../../integrations/claw/client";
import { localHourMinute } from "../../scout/gate";
import { MIN_DAYS_BEFORE_REVIEW } from "../../review/weekly";
import { pairedRows } from "../../core/schedule";
import { DEFAULT_SUBJECTS, balanceRefusal, estimateCredits, dayPlan, inspirationPlatform, isFirstWeekSubject, parseJudged, phoneFor, resolveOpts, subjectFor, summarise, timezonesFor, weekdayOf, type CreatorLog, type RunState } from "../firstWeek";

const NOW = Date.UTC(2026, 8, 24, 15, 0, 0);
const H = 3_600_000;

describe("the schedule", () => {
  it("is the same every time for the same inputs, and every day ages first and measures last", () => {
    for (let d = 1; d <= 7; d++) {
      expect(dayPlan(d, { signupWeekday: 1 })).toEqual(dayPlan(d, { signupWeekday: 1 }));
      const p = dayPlan(d, { signupWeekday: 1 });
      expect(p[0]).toBe("age");
      expect(p[p.length - 1]).toBe("snapshot");
      expect(p.filter((s) => s === "age")).toHaveLength(1);
    }
  });

  it("a Monday signup gets its Sunday review and next week's plan on day 6, review before plan", () => {
    expect(weekdayOf(6, 1)).toBe(0);
    const sunday = dayPlan(6, { signupWeekday: 1 });
    expect(sunday.indexOf("review")).toBeGreaterThan(-1);
    expect(sunday.indexOf("review")).toBeLessThan(sunday.indexOf("weekPlan"));
    for (const d of [1, 2, 3, 4, 5, 7]) expect(dayPlan(d, { signupWeekday: 1 })).not.toContain("weekPlan");
  });

  it("no review before they've been here the product's minimum; the plan still comes on Sunday", () => {
    const thursday = 4; // Sunday is day 3
    expect(weekdayOf(3, thursday)).toBe(0);
    expect(3).toBeLessThan(MIN_DAYS_BEFORE_REVIEW);
    expect(dayPlan(3, { signupWeekday: thursday })).not.toContain("review");
    expect(dayPlan(3, { signupWeekday: thursday })).toContain("weekPlan");
  });

  it("the draft invitation goes on day two of their week (sim day 1) only", () => {
    expect(dayPlan(1, { signupWeekday: 1 })).toContain("invite");
    for (let d = 2; d <= 7; d++) expect(dayPlan(d, { signupWeekday: 1 })).not.toContain("invite");
  });

  it("timezones vary, are awake when the run starts, and are the same for the same moment", () => {
    const z = timezonesFor(8, NOW);
    expect(timezonesFor(8, NOW)).toEqual(z);
    expect(new Set(z).size).toBeGreaterThan(1);
    for (const tz of z) { const { hour } = localHourMinute(NOW, tz); expect(hour >= 9 && hour < 17, `${tz} at ${hour}:00`).toBe(true); }
  });

  it("numbers are fictional (555-01xx), valid, distinct per creator and stable per run", () => {
    const a = phoneFor("fw-abc", 0), b = phoneFor("fw-abc", 1);
    expect(a).not.toBe(b);
    expect(phoneFor("fw-abc", 0)).toBe(a);
    for (const p of [a, b, phoneFor("fw-zzz", 7)]) { expect(normalizePhone(p)).toBe(p); expect(p).toMatch(/^\+1[2-9]\d{2}55501\d{2}$/); }
  });

  it("options: defaults filled, bounds refused", () => {
    expect(resolveOpts({}).days).toBe(7);
    expect(resolveOpts({ watchCap: 99 }).watchCap).toBe(40);
    expect(() => resolveOpts({ days: 0 })).toThrow();
    expect(() => resolveOpts({ days: 30 })).toThrow();
    expect(() => resolveOpts({ maxCredits: 10 })).toThrow();
  });

  it("the default subjects cover TikTok-only, Instagram-only and both", () => {
    expect(DEFAULT_SUBJECTS.filter((s) => s.tiktok && !s.instagram).length).toBeGreaterThan(0);
    expect(DEFAULT_SUBJECTS.filter((s) => s.instagram && !s.tiktok).length).toBeGreaterThan(0);
    expect(DEFAULT_SUBJECTS.filter((s) => s.instagram && s.tiktok).length).toBeGreaterThan(0);
  });
});

describe("credits", () => {
  it("the default run's estimate is explicit, and what it may spend is bounded by the ceiling", () => {
    const e = estimateCredits(DEFAULT_SUBJECTS, resolveOpts({}));
    expect(e.perCreator).toEqual([100, 100, 100, 100, 113, 113, 100, 113]);
    expect(e.total).toBe(839);
    expect(e.needed).toBe(600);
    expect(estimateCredits([{ tiktok: "a" }], resolveOpts({ watchCap: 0, transcriptCap: 0, admired: 0, days: 1 })).total).toBe(3 + 22);
  });
  it("start refuses, by name, on an unknown balance or one below what the run may spend", () => {
    expect(balanceRefusal(null, 600)).toMatch(/could not read/);
    expect(balanceRefusal(599, 600)).toMatch(/balance is 599 credits; this run may spend 600/);
    expect(balanceRefusal(600, 600)).toBeNull();
  });
  it("start refuses before creating anyone when the balance can't be read", async () => {
    const t = convexTest(schema, modules);
    await expect(t.action(internal.eval.firstWeek.start, { handles: [{ tiktok: "nobody_here" }] })).rejects.toThrow(/first-week run refused/);
    expect(await t.run((ctx) => ctx.db.query("creators").collect())).toHaveLength(0);
  });
});

describe("pure reads", () => {
  it("an idea's platform comes from its source link, else the own post it rhymes with", () => {
    expect(inspirationPlatform(["https://www.instagram.com/reel/abc/"])).toBe("instagram");
    expect(inspirationPlatform(["https://www.tiktok.com/@x/video/1"])).toBe("tiktok");
    expect(inspirationPlatform([], "instagram")).toBe("own_instagram");
    expect(inspirationPlatform([])).toBe("unknown");
  });
  it("the judge's answer: malformed items are null, never a guess", () => {
    const v = parseJudged('{"items":[{"i":0,"grounded":2,"specific":1,"rightPlatform":"yes","invented":[],"note":"ok"},{"i":1,"grounded":7}]}', 2);
    expect(v[0]).toMatchObject({ grounded: 2, specific: 1, rightPlatform: "yes" });
    expect(v[1]).toBeNull();
    expect(parseJudged("no json", 1)).toEqual([null]);
  });
});

describe("isolation", () => {
  it("every mutation refuses a creator outside the simulation: a real one, a persona, a living-sim clone", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => [
      await seedCreator(ctx, "real"),
      await seedCreator(ctx, "persona", { clerkUserId: "eval:vanessaalopezz" }),
      await seedCreator(ctx, "clone", { clerkUserId: "eval-run:sim-1:x" }),
    ]);
    for (const creatorId of ids) {
      await expect(t.mutation(internal.eval.firstWeek.ageTable, { creatorId, table: "messages", delta: -1 })).rejects.toThrow("first-week");
      await expect(t.mutation(internal.eval.firstWeek.addAdmired, { creatorId, picks: [{ platform: "tiktok", handle: "someone" }] })).rejects.toThrow("first-week");
      await expect(t.mutation(internal.eval.firstWeek.preparePairing, { creatorId, phone: phoneFor("fw-a", 0) })).rejects.toThrow("first-week");
    }
    await expect(t.mutation(internal.eval.firstWeek.writeRun, { runId: "sim-123", state: {} })).rejects.toThrow("first-week run id");
    await expect(t.mutation(internal.eval.firstWeek.clearPage, { runId: "../x" })).rejects.toThrow("first-week run id");
    expect(isFirstWeekSubject("eval-run:fw-abc:0")).toBe(true);
    expect(isFirstWeekSubject("eval-run:sim-abc")).toBe(false);
    expect(isFirstWeekSubject(subjectFor("fw-abc", 3))).toBe(true);
  });

  it("a creator is made by the real signup path: its catalogue job carries the sim's caps, on a trial of the right tier", async () => {
    const t = convexTest(schema, modules);
    const r = await t.mutation(internal.eval.firstWeek.createOne, { runId: "fw-t1", i: 0, handles: { tiktok: "@Cam.Luyckx", instagram: "camruns" }, timezone: "Europe/London", watchCap: 2, transcriptCap: 6 });
    expect(r.ok).toBe(true);
    const { c, job, sched } = await t.run(async (ctx) => ({
      c: await ctx.db.get(r.creatorId as Id<"creators">),
      job: await ctx.db.query("jobs").withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", `ingest:${r.creatorId}:v0`)).first(),
      sched: await ctx.db.query("schedule").withIndex("by_creator", (q) => q.eq("creatorId", r.creatorId as Id<"creators">)).first(),
    }));
    expect(c?.clerkUserId).toBe("eval-run:fw-t1:0");
    expect(c?.handles).toEqual({ tiktok: "cam.luyckx", instagram: "camruns" });
    expect(c?.plan).toMatchObject({ status: "trialing", tier: "duo" });
    expect(JSON.parse(job!.payloadJson!)).toEqual({ reason: "onboarding", watchCap: 2, transcriptCap: 6 });
    expect(sched?.isEval).toBe(true);
    // The real rule: a handle belongs to one creator. A second run with the same handle is refused, and says why.
    const again = await t.mutation(internal.eval.firstWeek.createOne, { runId: "fw-t2", i: 0, handles: { tiktok: "cam.luyckx" }, timezone: "UTC", watchCap: 2, transcriptCap: 6 });
    expect(again.ok).toBe(false);
    expect(again.error).toMatch(/already set up/);
    expect((await t.query(internal.eval.firstWeek.preflight, { handles: [{ tiktok: "cam.luyckx" }, { instagram: "free_one" }] })).map((x) => x.free)).toEqual([false, true]);
  });

  it("the fleet's due lists never include an eval creator, paired or not", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await seedCreator(ctx, "real", { channel: { paired: true } });
      await seedCreator(ctx, "fw", { clerkUserId: "eval-run:fw-x:0", channel: { paired: true } });
      await seedCreator(ctx, "persona", { clerkUserId: "eval:someone", channel: { paired: true } });
      await seedCreator(ctx, "load", { clerkUserId: "eval-load:1", channel: { paired: true } });
    });
    const rows = await t.run((ctx) => pairedRows(ctx));
    const subjects = await t.run(async (ctx) => Promise.all(rows.map(async (r) => (await ctx.db.get(r.creatorId))!.clerkUserId)));
    expect(subjects.sort()).toEqual(["eval-load:1", "u_real"]);
  });

  it("ageing moves only the sim creator's rows, through its indexes", async () => {
    const t = convexTest(schema, modules);
    const r = await t.mutation(internal.eval.firstWeek.createOne, { runId: "fw-t3", i: 0, handles: { instagram: "someone_ig" }, timezone: "UTC", watchCap: 0, transcriptCap: 0 });
    const creatorId = r.creatorId as Id<"creators">;
    const other = await t.run((ctx) => seedCreator(ctx, "other"));
    await t.run(async (ctx) => {
      await ctx.db.insert("messages", { creatorId, direction: "out", surface: "imessage", body: "hi", ts: NOW, dedupeKey: "k:2026-09-24" });
      await ctx.db.insert("messages", { creatorId: other, direction: "out", surface: "imessage", body: "hi", ts: NOW });
    });
    expect(await t.mutation(internal.eval.firstWeek.ageTable, { creatorId, table: "messages", delta: -24 * H })).toBe(1);
    const [mine, theirs] = await t.run(async (ctx) => [
      await ctx.db.query("messages").withIndex("by_creator", (q) => q.eq("creatorId", creatorId)).first(),
      await ctx.db.query("messages").withIndex("by_creator", (q) => q.eq("creatorId", other)).first(),
    ]);
    expect(mine?.ts).toBe(NOW - 24 * H);
    expect(mine?.dedupeKey).toBe("k:2026-09-23");
    expect(theirs?.ts).toBe(NOW);
  });
});

describe("the report", () => {
  it("has a timeline, the week's numbers, Instagram coverage and cost (the simulation's own model calls excluded)", async () => {
    const t = convexTest(schema, modules);
    const runId = "fw-rep1";
    const made = await t.mutation(internal.eval.firstWeek.createOne, { runId, i: 0, handles: { instagram: "ig_only_creator" }, timezone: "UTC", watchCap: 2, transcriptCap: 6 });
    const creatorId = made.creatorId as Id<"creators">;
    const t0 = await t.run(async (ctx) => (await ctx.db.get(creatorId))!.createdAt);
    const state: RunState = { runId, startedAt: t0, opts: resolveOpts({}), creators: [
      { i: 0, subject: subjectFor(runId, 0), handles: { instagram: "ig_only_creator" }, timezone: "UTC", creatorId },
      { i: 1, subject: subjectFor(runId, 1), handles: { tiktok: "taken_one" }, timezone: "UTC", error: "signup refused: @taken_one is already set up with another account" },
    ] };
    const log: CreatorLog = { i: 0, createdRealAt: t0, cursor: { phase: "done", d: 7, k: 0, attempt: 0, since: t0 }, events: [{ name: "dossier", simMs: 0.2 * H }, { name: "catalogue_read", simMs: 0.2 * H, detail: "succeeded" }], actorSeenAt: 0, turns: 2, steps: [{ d: 1, step: "sweep", result: "failed: vendor 500", ms: 10 }], actor: [], failures: [], snapshots: [], judged: [{ what: "first_read", text: "x", verdict: { i: 0, grounded: 2, specific: 2, rightPlatform: "yes", invented: [], note: "" } }] };
    await t.mutation(internal.eval.firstWeek.writeRun, { runId, state, i: 0, log });
    await t.mutation(internal.eval.firstWeek.writeRun, { runId, i: 1, log: { ...log, i: 1, cursor: { ...log.cursor }, events: [], failures: [{ d: 0, step: "signup", error: "signup refused" }], judged: null, steps: [] } });
    await t.run(async (ctx) => {
      const out = (body: string, kind: string, dedupeKey: string, at: number) => ctx.db.insert("messages", { creatorId, direction: "out", surface: "imessage", body, kind, dedupeKey, proactive: true, ts: t0 + at });
      await out("hey — i'm maya", "status", `hello:${creatorId}`, 0.1 * H);
      await out("ok, went through your reels", "first_read", `first_read:${creatorId}`, 0.4 * H);
      await out("here's your week", "plan", "plan:week:2026-09-21", 0.8 * H);
      await out("your week in one line", "review", "review:1", 6 * 24 * H + 10 * H);
      const signalId = await ctx.db.insert("signals", { creatorId, url: "https://www.instagram.com/reel/abc/", kind: "breakout", sourcePostIds: ["abc"], score: 1, corroboration: { accounts: 1, soundRising: false }, verdict: "sent", why: "5x", thresholdsVersion: "t", createdAt: t0 + 20 * H });
      await ctx.db.insert("ideas", { creatorId, signalId, evidenceLinks: ["https://www.instagram.com/reel/abc/"], fit: "yes", fitWhy: "yours", version: { hook: "h" }, messageText: "try this", status: "sent", sentAt: t0 + 20 * H, produced: { skillVersion: "s", model: "m", thresholdsVersion: "t" }, createdAt: t0 + 20 * H });
      await ctx.db.patch((await ctx.db.query("jobs").withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", `ingest:${creatorId}:v0`)).first())!._id, { status: "succeeded", updatedAt: t0 + 0.2 * H });
      const cost = (vendor: "scrapecreators" | "openrouter", kind: string, units: number, costUsd: number) => ctx.db.insert("costEvents", { creatorId, vendor, kind, units, costUsd, costSource: "endpoint_table", environment: "test", at: t0 + H });
      await cost("scrapecreators", "account.posts", 2, 0.004);
      await cost("scrapecreators", "post.info", 10, 0.0188);
      await cost("openrouter", "first_read:model", 1000, 0.01);
      await cost("openrouter", "fw_actor:model", 1000, 0.5);
    });
    const r = await t.action(internal.eval.firstWeek.report, { runId });
    expect(r.creators).toHaveLength(2);
    const c = r.creators[0];
    expect(c).toMatchObject({ helloAtHours: 0.1, firstReadAtHours: 0.4, firstPlanAtHours: 0.8, firstIdeaTextedAtHours: 20, firstIdeaAnyAtHours: 0.8, sundayReviewAtHours: 154, dossierAtHours: 0.2 });
    expect(c.catalogue.status).toBe("succeeded");
    expect(c.ideasWeek1).toEqual({ total: 1, texted: 1, byInspiration: { instagram: 1 } });
    expect(c.instagram).toMatchObject({ hasInstagram: true, instagramOnly: true, gotIgGroundedIdea: true });
    expect(c.cost).toMatchObject({ scrapeCredits: 12, modelUsd: 0.01, simOverheadUsd: 0.5 });
    expect(c.failures.map((f) => f.step)).toContain("sweep");
    expect(c.timeline.map((x) => x.what)).toEqual(expect.arrayContaining(["signed up", "hello", "first read", "first week plan", "first idea texted", "Sunday review"]));
    expect(r.creators[1]).toMatchObject({ creatorId: null, phase: "never started" });
    expect(r.fleet).toMatchObject({ creators: 2, started: 1, onboarded: 1, pctIdeaWithin24h: 100, pctTextedIdeaWithin24h: 100, pctSundayReview: 100, instagram: { creatorsWithInstagram: 1, withIgGroundedIdeas: 1, pct: 100, instagramOnly: 1, instagramOnlyWithIgGroundedIdeas: 1 }, judge: { items: 1, meanGrounded: 2 } });
    expect(r.fleet.failures.some((f) => f.i === 1 && f.step === "signup")).toBe(true);
    expect(r.credits.attributed).toBe(12);
  });

  it("an empty fleet summarises to nulls, not zeros that look like results", () => {
    const s = summarise([]);
    expect(s.medianHoursToFirstIdeaAny).toBeNull();
    expect(s.pctIdeaWithin24h).toBeNull();
    expect(s.costPerOnboardedCreator.totalUsd).toBeNull();
  });
});
