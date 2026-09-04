/**
 * Sprint 4b, on rows: the plan is drafted as blocks and one message, booked on one tap,
 * reminded around, moved and dropped by tools, and every promise in the plan doc is asserted
 * here rather than in a prompt.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { REMINDER } from "../reminders";
import { atLocalHour } from "../postTime";

beforeAll(() => { process.env.MODEL_FAKE = "1"; process.env.SCRAPE_FIXTURES = "spec"; });
afterEach(() => vi.useRealTimers());

const TZ = "America/New_York";
// Sunday 6 Sep 2026, 18:00 New York.
const SUNDAY_6PM = atLocalHour(Date.UTC(2026, 8, 6, 12, 0), 18, TZ);

async function creatorWithIdeas(t: ReturnType<typeof convexTest>, extra: Record<string, unknown> = {}) {
  const creatorId = await t.run((ctx) => seedCreator(ctx, "a", {
    timezone: TZ, channel: { paired: true }, plan: { status: "active", founding: true },
    dossier: { persona: { summary: "runner" }, keywords: ["running"], cadence: { postsPerWeek: 2, filmingDays: [], bestHoursLocal: [] }, fingerprint: { medianCutSeconds: 8 } },
    experiments: [{ id: "e1", text: "open on the shoe rack, not your face", proposedAt: SUNDAY_6PM - 86_400_000 }],
    ...extra,
  }));
  await t.run(async (ctx) => {
    for (const [i, hook] of ["the shoe rack list", "km vs miles"].entries()) {
      await ctx.db.insert("ideas", { creatorId, evidenceLinks: [], fit: "yes", fitWhy: "x", version: { hook }, messageText: hook, produced: { skillVersion: "t", model: "m", thresholdsVersion: "t" }, sentAt: SUNDAY_6PM - (i + 1) * 3_600_000, status: "sent", createdAt: SUNDAY_6PM - (i + 1) * 3_600_000 } as never);
    }
    for (let i = 1; i <= 4; i++) await ctx.db.insert("ownPosts", { creatorId, platform: "tiktok", postId: `p${i}`, url: `https://tiktok.com/@a/video/${i}`, createTime: atLocalHour(SUNDAY_6PM - i * 86_400_000, 19, TZ), contentType: "video", caption: "c", hashtags: [], metrics: { views: 1000, likes: 1, comments: 1, shares: 1 }, metricsAsOf: SUNDAY_6PM, source: "scrape", multiple: 2 } as never);
  });
  return creatorId;
}

describe("the Sunday plan", () => {
  it("drafts film, edit and post blocks per slot, and asks one question with a book button", async () => {
    const t = convexTest(schema, modules);
    vi.useFakeTimers({ now: SUNDAY_6PM, toFake: ["Date"] });
    const creatorId = await creatorWithIdeas(t);
    const r = await t.action(internal.calendar.weekPlan.draft, { creatorId, now: SUNDAY_6PM });
    expect(r.sent, r.reason).toBe(true);
    expect(r.slots).toBe(2);
    const blocks = await t.run((ctx) => ctx.db.query("calendarBlocks").collect());
    expect(blocks.filter((b) => b.kind === "film")).toHaveLength(2);
    expect(blocks.filter((b) => b.kind === "edit"), "editing block is default on").toHaveLength(2);
    expect(blocks.filter((b) => b.kind === "post")).toHaveLength(2);
    expect(blocks.every((b) => b.status === "proposed" && !b.consentAt), "nothing booked before the tap").toBe(true);
    expect(blocks.some((b) => b.title.includes("experiment")), "the experiment always gets a slot").toBe(true);
    const out = (await t.run((ctx) => ctx.db.query("messages").collect())).filter((m) => m.direction === "out");
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("plan");
    expect(out[0].awaitingAnswer).toBe(true);
    expect(out[0].buttons?.map((b) => b.id.split(":").pop())).toEqual(["book", "skip"]);
    expect(out[0].body).toMatch(/post times are your best hours/);
    // Not twice for the same week.
    const again = await t.action(internal.calendar.weekPlan.draft, { creatorId, now: SUNDAY_6PM + 60_000 });
    expect(again.sent).toBe(false);
    expect(again.reason).toMatch(/already planned/);
  });

  it("'i don't edit' removes the editing block", async () => {
    const t = convexTest(schema, modules);
    vi.useFakeTimers({ now: SUNDAY_6PM, toFake: ["Date"] });
    const creatorId = await creatorWithIdeas(t, { noEditBlock: true });
    await t.action(internal.calendar.weekPlan.draft, { creatorId, now: SUNDAY_6PM });
    const blocks = await t.run((ctx) => ctx.db.query("calendarBlocks").collect());
    expect(blocks.filter((b) => b.kind === "edit")).toHaveLength(0);
  });

  it("book consents every block; skip drops them all", async () => {
    const t = convexTest(schema, modules);
    vi.useFakeTimers({ now: SUNDAY_6PM, toFake: ["Date"] });
    const creatorId = await creatorWithIdeas(t);
    const r = await t.action(internal.calendar.weekPlan.draft, { creatorId, now: SUNDAY_6PM });
    const b = await t.action(internal.calendar.weekPlan.book, { creatorId, planKey: r.planKey! });
    expect(b.booked).toBe(6);
    const blocks = await t.run((ctx) => ctx.db.query("calendarBlocks").collect());
    expect(blocks.every((x) => x.consentAt), "consent on every block").toBe(true);
    // No calendar connected: no external ids, and nothing threw.
    expect(blocks.every((x) => !x.externalEventId)).toBe(true);
    await t.mutation(internal.calendar.weekPlan.skip, { creatorId, planKey: r.planKey! });
    expect((await t.run((ctx) => ctx.db.query("calendarBlocks").collect())).every((x) => x.status === "deleted")).toBe(true);
  });

  it("cross-tenant: one creator's plan never touches another's blocks", async () => {
    const t = convexTest(schema, modules);
    vi.useFakeTimers({ now: SUNDAY_6PM, toFake: ["Date"] });
    const a = await creatorWithIdeas(t);
    const b = await t.run((ctx) => seedCreator(ctx, "b", { timezone: TZ, channel: { paired: true } }));
    const r = await t.action(internal.calendar.weekPlan.draft, { creatorId: a, now: SUNDAY_6PM });
    const stolen = await t.action(internal.calendar.weekPlan.book, { creatorId: b, planKey: r.planKey! });
    expect(stolen.booked).toBe(0);
    const blocks = await t.run((ctx) => ctx.db.query("calendarBlocks").collect());
    expect(blocks.every((x) => x.creatorId === a && !x.consentAt)).toBe(true);
  });
});

describe("reminders around a booked block", () => {
  async function booked(t: ReturnType<typeof convexTest>, opts: { start: number; quiet?: { start: string; end: string } }) {
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { timezone: TZ, channel: { paired: true }, plan: { status: "active", founding: true }, ...(opts.quiet ? { quietHours: opts.quiet } : {}) }));
    const ideaId = await t.run((ctx) => ctx.db.insert("ideas", { creatorId, evidenceLinks: [], fit: "yes", fitWhy: "x", version: { hook: "the shoe rack list", onScreenText: "5 things", lengthSec: 25 }, messageText: "m", produced: { skillVersion: "t", model: "m", thresholdsVersion: "t" }, sentAt: opts.start - 86_400_000, status: "sent", createdAt: opts.start - 86_400_000 } as never));
    const blockId = await t.mutation(internal.calendar.blocks.propose, { creatorId, kind: "film", start: opts.start, end: opts.start + 45 * 60_000, title: "film: the shoe rack list", ideaId });
    await t.mutation(internal.calendar.blocks.consent, { blockId });
    return { creatorId, blockId, ideaId };
  }
  const FILM = atLocalHour(Date.UTC(2026, 8, 8, 12, 0), 16, TZ); // Tuesday 4pm NY

  it("the check-in asks with three buttons, supersedes an open question, and never fires twice", async () => {
    const t = convexTest(schema, modules);
    vi.useFakeTimers({ now: FILM - 15 * 60_000, toFake: ["Date"] });
    const { creatorId, blockId } = await booked(t, { start: FILM });
    await t.mutation(internal.core.messages.send, { creatorId, surface: "telegram", body: "want the shot list?", dedupeKey: "q:1", proactive: true, kind: "scout", awaitingAnswer: true });
    const r = await t.action(internal.calendar.reminders.fire, { blockId, touch: "checkin", expectedStart: FILM });
    expect(r.sent, r.reason).toBe(true);
    const out = (await t.run((ctx) => ctx.db.query("messages").collect())).filter((m) => m.direction === "out");
    const ci = out.find((m) => m.kind === "reminder")!;
    expect(ci.buttons?.map((b) => b.id.split(":").pop())).toEqual(["yes", "push", "skip"]);
    expect(ci.awaitingAnswer).toBe(true);
    expect(out.find((m) => m.kind === "scout")?.awaitingAnswer, "this afternoon beats this morning's idea").toBe(false);
    // The shot list rides the check-in when no prep went out.
    expect(ci.body).toMatch(/shoe rack/);
    const twice = await t.action(internal.calendar.reminders.fire, { blockId, touch: "checkin", expectedStart: FILM });
    expect(twice.sent).toBe(false);
    expect(out.filter((m) => m.kind === "reminder")).toHaveLength(1);
  });

  it("a moved or dropped block produces nothing from a stale schedule", async () => {
    const t = convexTest(schema, modules);
    vi.useFakeTimers({ now: FILM - 15 * 60_000, toFake: ["Date"] });
    const { blockId } = await booked(t, { start: FILM });
    await t.mutation(internal.calendar.blocks.setStatus, { blockId, status: "moved", start: FILM + 3_600_000, end: FILM + 3_600_000 + 45 * 60_000 });
    expect((await t.action(internal.calendar.reminders.fire, { blockId, touch: "checkin", expectedStart: FILM })).reason).toMatch(/moved/);
    await t.mutation(internal.calendar.blocks.decline, { blockId });
    expect((await t.action(internal.calendar.reminders.fire, { blockId, touch: "checkin", expectedStart: FILM + 3_600_000 })).reason).toMatch(/dropped/);
  });

  it("refuses inside quiet hours and refuses a third touch", async () => {
    const t = convexTest(schema, modules);
    const night = atLocalHour(Date.UTC(2026, 8, 8, 12, 0), 23, TZ);
    vi.useFakeTimers({ now: night - 15 * 60_000, toFake: ["Date"] });
    const { blockId } = await booked(t, { start: night, quiet: { start: "22:00", end: "07:00" } });
    expect((await t.action(internal.calendar.reminders.fire, { blockId, touch: "checkin", expectedStart: night })).reason).toMatch(/quiet/);
    await t.mutation(internal.calendar.reminders.touched, { blockId, touch: "prep" });
    await t.mutation(internal.calendar.reminders.touched, { blockId, touch: "checkin" });
    vi.setSystemTime(atLocalHour(night, 12, TZ));
    const third = await t.action(internal.calendar.reminders.fire, { blockId, touch: "prep", expectedStart: night });
    expect(third.sent).toBe(false);
    expect(REMINDER.maxTouchesPerBlock).toBe(2);
  });

  it("reminders never spend the daily proactive cap", async () => {
    const t = convexTest(schema, modules);
    vi.useFakeTimers({ now: FILM - 15 * 60_000, toFake: ["Date"] });
    const { creatorId, blockId } = await booked(t, { start: FILM });
    await t.action(internal.calendar.reminders.fire, { blockId, touch: "checkin", expectedStart: FILM });
    expect(await t.query(internal.core.messages.proactiveSentToday, { creatorId, now: FILM })).toBe(0);
  });

  it("the post nudge fires only when she knows they filmed", async () => {
    const t = convexTest(schema, modules);
    const POST = atLocalHour(FILM, 19, TZ);
    vi.useFakeTimers({ now: POST - 10 * 60_000, toFake: ["Date"] });
    const { creatorId, blockId, ideaId } = await booked(t, { start: FILM });
    const postId = await t.mutation(internal.calendar.blocks.propose, { creatorId, kind: "post", start: POST, end: POST + 15 * 60_000, title: "post: the shoe rack list", ideaId });
    await t.mutation(internal.calendar.blocks.consent, { blockId: postId });
    const cold = await t.action(internal.calendar.reminders.fire, { blockId: postId, touch: "postnudge", expectedStart: POST });
    expect(cold.sent).toBe(false);
    expect(cold.reason).toMatch(/no sign they filmed/);
    await t.mutation(internal.calendar.reminders.touched, { blockId, touch: "yes", filmedAt: FILM + 60_000 });
    const warm = await t.action(internal.calendar.reminders.fire, { blockId: postId, touch: "postnudge", expectedStart: POST });
    expect(warm.sent, warm.reason).toBe(true);
  });

  it("'push it' proposes a real gap today and tomorrow at the same hour", async () => {
    const t = convexTest(schema, modules);
    vi.useFakeTimers({ now: FILM - 15 * 60_000, toFake: ["Date"] });
    const { creatorId, blockId } = await booked(t, { start: FILM });
    await t.run((ctx) => ctx.db.insert("calendarEvents", { creatorId, calendarId: "c", externalId: "e", title: "dinner", start: atLocalHour(FILM, 17, TZ), end: atLocalHour(FILM, 19, TZ), allDay: false, recurring: false, class: "routine", classifiedBy: "code", status: "active", updatedAt: FILM, createdAt: FILM } as never));
    const m = (await t.query(internal.calendar.reminders.proposeMove, { blockId, now: FILM - 15 * 60_000 }))!;
    expect(m.today).not.toBeNull();
    expect(m.today!.start >= atLocalHour(FILM, 19, TZ) || m.today!.end <= atLocalHour(FILM, 17, TZ)).toBe(true);
    expect(m.today!.start).toBeGreaterThan(FILM - 15 * 60_000 + 29 * 60_000);
    expect(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hour12: false }).format(m.tomorrow.start)).toBe("16");
  });
});

describe("the plan by text (the belt tools)", () => {
  it("move, drop and add work on their own blocks, refuse the past, and refuse another creator's ids", async () => {
    const t = convexTest(schema, modules);
    const NOW = atLocalHour(Date.UTC(2026, 8, 8, 12, 0), 10, TZ);
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const a = await t.run((ctx) => seedCreator(ctx, "a", { timezone: TZ, channel: { paired: true } }));
    const b = await t.run((ctx) => seedCreator(ctx, "b", { timezone: TZ, channel: { paired: true } }));
    const blockId = await t.mutation(internal.calendar.blocks.propose, { creatorId: a, kind: "film", start: NOW + 6 * 3_600_000, end: NOW + 6 * 3_600_000 + 45 * 60_000, title: "film: x" });
    await t.mutation(internal.calendar.blocks.consent, { blockId });

    const moved = await t.action(internal.calendar.tools.write, { creatorId: a, op: "block_move", args: { blockId, whenLocal: "2026-09-10T18:30" } });
    expect(moved.ok, moved.reason).toBe(true);
    const after = await t.run((ctx) => ctx.db.get(blockId));
    expect(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: false }).format(after!.start)).toBe("18:30");
    expect(after!.status).toBe("moved");

    expect((await t.action(internal.calendar.tools.write, { creatorId: a, op: "block_move", args: { blockId, whenLocal: "2026-09-01T18:30" } })).reason).toMatch(/past/);
    expect((await t.action(internal.calendar.tools.write, { creatorId: b, op: "block_move", args: { blockId, whenLocal: "2026-09-10T19:30" } })).reason).toMatch(/no such block/);

    const added = await t.action(internal.calendar.tools.write, { creatorId: a, op: "block_add", args: { kind: "edit", whenLocal: "2026-09-11T09:00", minutes: 30, title: "the rack cut" } });
    expect(added.ok).toBe(true);
    const rows = await t.query(internal.calendar.tools.weekRows, { creatorId: a, now: NOW });
    expect(rows.map((r) => r.kind).sort()).toEqual(["edit", "film"]);
    expect(rows.find((r) => r.kind === "edit")?.state).toBe("booked");

    const dropped = await t.action(internal.calendar.tools.write, { creatorId: a, op: "block_drop", args: { blockId } });
    expect(dropped.ok).toBe(true);
    expect((await t.run((ctx) => ctx.db.get(blockId)))?.status).toBe("deleted");
  });
});
