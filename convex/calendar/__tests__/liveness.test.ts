/**
 * A booked block that no longer means anything (product sim, 2026-09-28): "filming today" for a video
 * posted yesterday, "posting at 11" for one never filmed, two shoots at 5 pm, a "put it back" that left
 * the post behind. Pure rules first, then the rows: retirement on post and film, the reminder that
 * stays quiet, the clash refusal (and another creator's block never clashing), and the move cascade.
 */
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { missedNow, mootReason, type BlockLike } from "../liveness";
import { applyIdeaAct } from "../../core/ideaActs";

const H = 3_600_000;
const D = 24 * H;
const TZ = "America/Chicago";
const NOW = Date.UTC(2026, 8, 8, 15, 0); // 10:00 in Chicago

afterEach(() => vi.useRealTimers());

const blk = (id: string, kind: "film" | "edit" | "post", start: number, extra: Partial<BlockLike> = {}): BlockLike => ({ _id: id as Id<"calendarBlocks">, kind, start, end: start + H, status: "confirmed", ideaId: "idea1" as Id<"ideas">, ...extra });

describe("mootReason (pure)", () => {
  it("a posted idea retires its film and edit, and any post after the post", () => {
    const film = blk("f", "film", NOW + D), edit = blk("e", "edit", NOW + D + H), post = blk("p", "post", NOW + 2 * D);
    const idea = { status: "posted", postedAt: NOW };
    expect(mootReason(film, [film, edit, post], idea)).toBe("already posted");
    expect(mootReason(edit, [film, edit, post], idea)).toBe("already posted");
    expect(mootReason(post, [film, edit, post], idea)).toBe("already posted");
  });

  it("filmed once: a later film block for the same idea is moot, the post is not", () => {
    const f1 = blk("f1", "film", NOW - D, { filmedAt: NOW - D + H / 2 }), f2 = blk("f2", "film", NOW + D), post = blk("p", "post", NOW + 2 * D);
    expect(mootReason(f2, [f1, f2, post], { status: "sent" })).toBe("already filmed");
    expect(mootReason(post, [f1, f2, post], { status: "sent" })).toBeNull();
  });

  it("a missed film leaves its edit and post with nothing to edit or post", () => {
    const film = blk("f", "film", NOW - D, { missedAt: NOW - D + 3 * H }), post = blk("p", "post", NOW + H);
    expect(mootReason(post, [film, post], { status: "sent" })).toBe("nothing filmed for it yet");
  });

  it("put back later, a missed film is live again, and a post after it is fine", () => {
    // markMissed stamps missedAt; "put it back" moves the same block past it.
    const film = blk("f", "film", NOW + D, { missedAt: NOW - 2 * H }), post = blk("p", "post", NOW + 2 * D);
    expect(missedNow(film)).toBe(false);
    expect(mootReason(post, [film, post], { status: "sent" })).toBeNull();
  });

  it("a block with no idea, or a post with no film block ever (their own footage), is never moot", () => {
    expect(mootReason({ ...blk("x", "film", NOW), ideaId: undefined }, [], null)).toBeNull();
    const post = blk("p", "post", NOW + H);
    expect(mootReason(post, [post], { status: "sent" })).toBeNull();
  });
});

async function seed(t: ReturnType<typeof convexTest>, key: string) {
  const creatorId = await t.run((ctx) => seedCreator(ctx, key, { timezone: TZ, channel: { paired: true } }));
  const ideaId = await t.run((ctx) => ctx.db.insert("ideas", { creatorId, evidenceLinks: [], fit: "yes", fitWhy: "x", version: { hook: "mile 1 vs mile 16" }, messageText: "m", produced: { skillVersion: "t", model: "m", thresholdsVersion: "t" }, sentAt: NOW - D, status: "sent", createdAt: NOW - D } as never));
  const book = async (kind: "film" | "edit" | "post", start: number) => {
    const id = await t.mutation(internal.calendar.blocks.propose, { creatorId, kind, start, end: start + (kind === "post" ? 15 * 60_000 : H), title: `${kind}: mile 1 vs mile 16`, ideaId });
    await t.mutation(internal.calendar.blocks.consent, { blockId: id });
    return id;
  };
  return { creatorId, ideaId, book };
}

describe("the rows", () => {
  it("posting an idea takes its other blocks off the plan, and the plan read no longer lists them", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const t = convexTest(schema, modules);
    const { creatorId, ideaId, book } = await seed(t, "a");
    const film = await book("film", NOW + 7 * H), edit = await book("edit", NOW + 8 * H), post = await book("post", NOW + D);
    await t.run((ctx) => applyIdeaAct(ctx, creatorId, ideaId, "posted", { origin: "chat" }));
    for (const id of [film, edit, post]) expect((await t.run((ctx) => ctx.db.get(id)))?.status).toBe("deleted");
    expect(await t.query(internal.calendar.tools.weekRows, { creatorId, now: NOW })).toEqual([]);
  });

  it("the reminder for a video with nothing filmed stays quiet, with the reason", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const t = convexTest(schema, modules);
    const { book } = await seed(t, "a");
    const film = await book("film", NOW - 20 * H);
    await t.run((ctx) => ctx.db.patch(film, { missedAt: NOW - 16 * H }));
    const post = await book("post", NOW + 10 * 60_000 + 5 * 60_000);
    const r = await t.action(internal.calendar.reminders.fire, { blockId: post, touch: "postnudge", expectedStart: NOW + 15 * 60_000 });
    expect(r).toEqual({ sent: false, reason: "moot: nothing filmed for it yet" });
  });

  it("filming it retires a second film block for the same idea", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const t = convexTest(schema, modules);
    const { book } = await seed(t, "a");
    const f1 = await book("film", NOW - H), f2 = await book("film", NOW + D);
    await t.mutation(internal.calendar.reminders.touched, { blockId: f1, touch: "yes", filmedAt: NOW });
    expect((await t.run((ctx) => ctx.db.get(f2)))?.status).toBe("deleted");
  });

  it("a second shoot in a booked hour is refused with a named reason and nothing is booked; another creator's block never clashes", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const t = convexTest(schema, modules);
    const a = await seed(t, "a");
    const b = await seed(t, "b");
    await b.book("film", Date.UTC(2026, 8, 9, 22, 0)); // 17:00 tomorrow, Chicago, but B's
    const first = await t.action(internal.calendar.tools.write, { creatorId: a.creatorId, op: "block_add", args: { kind: "film", whenLocal: "2026-09-09T17:00", minutes: 45, title: "first" } });
    expect(first.ok, first.reason).toBe(true);
    const second = await t.action(internal.calendar.tools.write, { creatorId: a.creatorId, op: "block_add", args: { kind: "film", whenLocal: "2026-09-09T17:15", minutes: 45, title: "second" } });
    expect(second.ok).toBe(false);
    expect(second.reason).toMatch(/already has the film block for "first".*nothing was booked/);
    const films = (await t.run((ctx) => ctx.db.query("calendarBlocks").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).collect())).filter((x) => x.kind === "film");
    expect(films).toHaveLength(1);
    // A post in the same hour is fine: posting takes a minute.
    expect((await t.action(internal.calendar.tools.write, { creatorId: a.creatorId, op: "block_add", args: { kind: "post", whenLocal: "2026-09-09T17:00", minutes: 15, title: "other" } })).ok).toBe(true);
  });

  it("putting a film back later takes its edit and post along, keeping the gap", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const t = convexTest(schema, modules);
    const { book } = await seed(t, "a");
    const film = await book("film", NOW + 7 * H), edit = await book("edit", NOW + 8 * H), post = await book("post", NOW + 22 * H);
    const r = await t.action(internal.calendar.blocks.move, { blockId: film, start: NOW + D + 7 * H, end: NOW + D + 8 * H });
    expect(r.ok).toBe(true);
    expect((await t.run((ctx) => ctx.db.get(edit)))?.start).toBe(NOW + D + 8 * H);
    expect((await t.run((ctx) => ctx.db.get(post)))?.start).toBe(NOW + D + 22 * H);
  });
});
