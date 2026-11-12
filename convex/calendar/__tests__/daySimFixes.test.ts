/**
 * The calendar day sim's findings (2026-11-12), each held: a go-ahead for a clash counts only after she asked,
 * "cancel everything this week" drops every block at once (only theirs), and a post on another day says the day.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { composeWeek } from "../weekPlan";

describe("asking first is code", () => {
  it("overlapOk counts only when her last text raised the clash; quiet hours likewise; never across creators", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const a = await t.run((ctx) => seedCreator(ctx, "a"));
    const b = await t.run((ctx) => seedCreator(ctx, "b", { clerkUserId: "u_b", handles: { tiktok: "tt_b" } }));
    const said = async (who: typeof a, dir: "in" | "out", body: string, ts: number) => await t.run((ctx) => ctx.db.insert("messages", { creatorId: who, direction: dir, surface: "telegram", body, kind: dir === "in" ? "inbound" : "reply", ts } as never));
    await said(a, "out", "that overlaps your dinner with sam (sun 12–2). want it anyway?", now - 3000);
    const yes = await said(a, "in", "yeah go ahead", now - 2000);
    expect(await t.query(internal.calendar.tools.askedBefore, { creatorId: a, messageId: yes })).toEqual({ overlap: true, quiet: false });
    const fresh = await said(b, "in", "move it to the same time as my dinner", now - 1000);
    expect(await t.query(internal.calendar.tools.askedBefore, { creatorId: b, messageId: fresh })).toEqual({ overlap: false, quiet: false });
    expect(await t.query(internal.calendar.tools.askedBefore, { creatorId: b, messageId: yes }), "not theirs").toEqual({ overlap: false, quiet: false });
  });
});

describe("dropping several at once", () => {
  it("drops every id they meant, refuses another creator's", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const a = await t.run((ctx) => seedCreator(ctx, "a"));
    const b = await t.run((ctx) => seedCreator(ctx, "b", { clerkUserId: "u_b", handles: { tiktok: "tt_b" } }));
    const block = (who: typeof a, h: number) => t.run((ctx) => ctx.db.insert("calendarBlocks", { creatorId: who, kind: "film", start: now + h * 3_600_000, end: now + h * 3_600_000 + 2_700_000, title: "film: x", status: "proposed", createdAt: now } as never));
    const mine = [await block(a, 20), await block(a, 44), await block(a, 68)];
    const theirs = await block(b, 30);
    const r = await t.action(internal.calendar.tools.write, { creatorId: a, op: "block_drop", args: { blockIds: [...mine, theirs] } });
    expect(r.ok).toBe(true);
    expect(r.detail).toMatch(/dropped 3/);
    expect(r.detail).toMatch(/not theirs/);
    const rows = await t.run((ctx) => ctx.db.query("calendarBlocks").collect());
    expect(rows.filter((x) => x.creatorId === a).every((x) => x.status === "deleted")).toBe(true);
    expect(rows.find((x) => x._id === theirs)?.status).toBe("proposed");
  });
});

describe("the plan line says the post's day when it differs", () => {
  it("film fri 5 pm, post sat 4 pm; same day says nothing extra", () => {
    const tz = "America/Los_Angeles";
    const fri5 = Date.UTC(2026, 10, 14, 1, 0), sat4 = Date.UTC(2026, 10, 15, 0, 0), fri8 = Date.UTC(2026, 10, 14, 4, 0);
    const slot = (post: number) => ({ day: 5, film: { start: fri5, end: fri5 + 2_700_000 }, edit: null, post: { at: post, hour: 0, fromHistory: true }, ideaId: null, hook: "the hill", experiment: false });
    expect(composeWeek([slot(sat4)], tz, true)).toMatch(/film 5 pm, post sat 4 pm/);
    expect(composeWeek([slot(fri8)], tz, true)).toMatch(/film 5 pm, post 8 pm/);
  });
});
