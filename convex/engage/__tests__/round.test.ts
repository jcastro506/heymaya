/**
 * The engagement round: fresh posts from accounts she already watches for them, a goal and a streak.
 * Pure picking and streak arithmetic; then rows (only their own round; marking is idempotent and
 * tells her what they did). She never comments for them: there is no send path here to test.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import schema from "../../schema";
import { api, internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { addTracked } from "../../agent/manage";
import { afterDone, ENGAGE, engageText, localDay, pickRound, type RoundPost } from "../round";
import type { Id } from "../../_generated/dataModel";

const H = 3_600_000;
const NOW = Date.UTC(2026, 8, 30, 15, 0);
const post = (handle: string, id: string, hoursAgo: number, comments: number, over: Partial<RoundPost> = {}): RoundPost => ({ platform: "tiktok", handle, postId: id, url: `https://www.tiktok.com/@${handle}/video/${id}`, createTime: NOW - hoursAgo * H, views: 1000, comments, caption: `post ${id}`, ...over });

describe("picking the round (pure)", () => {
  it("fresh and quiet first, at most two per account, five in all, nothing older than three days or without a link", () => {
    const posts = [
      post("a", "1", 2, 5), post("a", "2", 3, 8), post("a", "3", 4, 9),
      post("b", "4", 30, 400), post("c", "5", 10, 12), post("d", "6", 80, 3), post("e", "7", 20, 60), post("f", "8", 5, 2, { url: "" }), post("g", "9", 50, 20),
    ];
    const r = pickRound(posts, NOW);
    expect(r).toHaveLength(ENGAGE.show);
    expect(r.filter((x) => x.handle === "a")).toHaveLength(2);
    expect(r.map((x) => x.postId)).not.toContain("6"); // 80h old
    expect(r.map((x) => x.postId)).not.toContain("8"); // nothing to open
    expect(r[0]).toMatchObject({ postId: "1", hoursAgo: 2, why: "new and still quiet: an early comment gets seen" });
    expect(r.find((x) => x.postId === "7")?.why).toBe("posted today");
    expect(r.find((x) => x.postId === "4")?.why, "30h old and busy: still worth it, but last").toBe("still picking up");
    expect(r.map((x) => x.postId)).not.toContain("9");
  });
  it("the same post sampled twice appears once; no watched posts means an empty round", () => {
    expect(pickRound([post("a", "1", 2, 5), post("a", "1", 2, 9)], NOW)).toHaveLength(1);
    expect(pickRound([], NOW)).toEqual([]);
  });
});

describe("the streak (pure)", () => {
  it("counts days they reached the goal, in a row; a repeat tap changes nothing; a missed day starts over", () => {
    let s = afterDone(undefined, "tiktok:1", "2026-09-30", "2026-09-29");
    s = afterDone(s, "tiktok:1", "2026-09-30", "2026-09-29");
    expect(s).toMatchObject({ done: ["tiktok:1"], streak: 0 });
    s = afterDone(afterDone(s, "tiktok:2", "2026-09-30", "2026-09-29"), "tiktok:3", "2026-09-30", "2026-09-29");
    expect(s).toMatchObject({ streak: 1, lastGoalDay: "2026-09-30" });
    s = afterDone(s, "tiktok:4", "2026-09-30", "2026-09-29");
    expect(s.streak, "a fourth comment doesn't add a second day").toBe(1);
    let next = s;
    for (const id of ["a", "b", "c"]) next = afterDone(next, `tiktok:${id}`, "2026-10-01", "2026-09-30");
    expect(next).toMatchObject({ day: "2026-10-01", done: ["tiktok:a", "tiktok:b", "tiktok:c"], streak: 2 });
    let gap = next;
    for (const id of ["x", "y", "z"]) gap = afterDone(gap, `tiktok:${id}`, "2026-10-05", "2026-10-04");
    expect(gap.streak).toBe(1);
  });
  it("the day is theirs, not UTC's", () => {
    const late = Date.UTC(2026, 9, 1, 2, 30); // 02:30 UTC on Oct 1
    expect(localDay(late, "America/Los_Angeles")).toBe("2026-09-30");
    expect(localDay(late, "Europe/London")).toBe("2026-10-01");
    expect(localDay(late, "Not/AZone")).toBe("2026-10-01");
  });
});

describe("the round on rows", () => {
  async function world(t: ReturnType<typeof convexTest>, suffix: string, watch: string[]) {
    const c = await t.run((ctx) => seedCreator(ctx, suffix, { timezone: "UTC" }));
    await t.run(async (ctx) => { for (const h of watch) await addTracked(ctx as never, c, "tiktok", h, [], { addedBy: "creator" }); });
    return c;
  }
  const observe = (t: ReturnType<typeof convexTest>, handle: string, id: string, hoursAgo: number) => t.run((ctx) => ctx.db.insert("observations", { platform: "tiktok", postId: id, authorHandle: handle, url: `https://www.tiktok.com/@${handle}/video/${id}`, createTime: Date.now() - hoursAgo * H, sampledAt: Date.now(), ageHours: hoursAgo, views: 5000, likes: 10, comments: 4, shares: 0, keywords: [], source: "account.posts", caption: "taper week honesty" } as never));
  const as = async (t: ReturnType<typeof convexTest>, id: Id<"creators">) => t.withIdentity({ subject: (await t.run((ctx) => ctx.db.get(id)))!.clerkUserId });

  it("shows posts only from accounts THEY watch; signed out gets nothing", async () => {
    const t = convexTest(schema, modules);
    const a = await world(t, "ea", ["hillsforbreakfast"]);
    const b = await world(t, "eb", ["someoneelse"]);
    await observe(t, "hillsforbreakfast", "p1", 3);
    await observe(t, "someoneelse", "p2", 3);
    expect(await t.query(api.engage.round.today, {})).toBeNull();
    const ra = (await (await as(t, a)).query(api.engage.round.today, {}))!;
    expect(ra.items.map((i) => i.postId)).toEqual(["p1"]);
    expect(ra.items[0]).toMatchObject({ handle: "hillsforbreakfast", caption: "taper week honesty", done: false });
    expect(ra).toMatchObject({ doneToday: 0, goal: ENGAGE.goal, streak: 0, watching: 1 });
    expect((await (await as(t, b)).query(api.engage.round.today, {}))!.items.map((i) => i.postId)).toEqual(["p2"]);
  });

  it("marking done is idempotent, ticks the item, reaches the goal, and tells her once", async () => {
    const t = convexTest(schema, modules);
    const a = await world(t, "ec", ["one", "two", "three"]);
    for (const [h, id] of [["one", "p1"], ["two", "p2"], ["three", "p3"]] as const) await observe(t, h, id, 2);
    const me = await as(t, a);
    expect(await t.mutation(api.engage.round.markDone, { platform: "tiktok", postId: "p1", handle: "one" })).toEqual({ ok: false });
    await me.mutation(api.engage.round.markDone, { platform: "tiktok", postId: "p1", handle: "one" });
    await me.mutation(api.engage.round.markDone, { platform: "tiktok", postId: "p1", handle: "one" });
    await me.mutation(api.engage.round.markDone, { platform: "tiktok", postId: "p2", handle: "two" });
    const third = await me.mutation(api.engage.round.markDone, { platform: "tiktok", postId: "p3", handle: "three" });
    expect(third).toMatchObject({ ok: true, doneToday: 3, streak: 1 });
    const r = (await me.query(api.engage.round.today, {}))!;
    expect(r).toMatchObject({ doneToday: 3, streak: 1 });
    expect(r.items.every((i) => i.done)).toBe(true);
    const actions = (await t.run((ctx) => ctx.db.query("userActions").collect())).filter((x) => x.creatorId === a && x.kind === "engage.commented");
    expect(actions, "one note for her per post, not per tap").toHaveLength(3);
    expect(actions[0].summary).toBe("commented on @one's post");
  });

  it("she never comments for them: this module has no path to post, reply or like on a platform", () => {
    const src = readFileSync(new URL("../round.ts", import.meta.url), "utf8");
    // She texts THEM the links; nothing here posts, replies or likes on a platform.
    expect(src).not.toMatch(/inbox|\/comments|fetch\(/);
  });
});

describe("her text, and never the same post twice", () => {
  const D = 24 * H;
  const produced = (t: ReturnType<typeof convexTest>, handle: string, id: string, at: number, caption = "taper week honesty") => t.run((ctx) => ctx.db.insert("observations", { platform: "tiktok", postId: id, authorHandle: handle, url: `https://www.tiktok.com/@${handle}/video/${id}`, createTime: at - 2 * H, sampledAt: at, ageHours: 2, views: 5000, likes: 10, comments: 4, shares: 0, keywords: [], source: "account.posts", caption } as never));
  async function paired(t: ReturnType<typeof convexTest>, suffix: string, over: Record<string, unknown> = {}) {
    const c = await t.run((ctx) => seedCreator(ctx, suffix, { timezone: "UTC", channel: { paired: true, pairedAt: NOW - 30 * D, kind: "imessage" }, plan: { status: "active", founding: true }, ...over }));
    await t.run(async (ctx) => { for (const h of ["one", "two", "three", "four"]) await addTracked(ctx as never, c, "tiktok", h, [], { addedBy: "creator" }); });
    return c;
  }
  const texts = async (t: ReturnType<typeof convexTest>, c: Id<"creators">) => (await t.run((ctx) => ctx.db.query("messages").collect())).filter((m) => m.creatorId === c && m.kind === "engage");

  it("the text is an opener and each post with its link; the opener rotates by day; code writes it", () => {
    const items = pickRound([post("one", "1", 2, 4, { caption: "my honest taper week, day by day and why i hate it" }), post("two", "2", 3, 5, { caption: null })], NOW);
    const t = engageText(items, "2026-09-30");
    expect(t.links).toEqual(items.map((i) => i.url));
    const parts = t.body.split("\n---\n");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toMatch(/in your lane/);
    expect(parts[1]).toBe(`@one: my honest taper week, day by day and why i hate it\n${items[0].url}`);
    expect(parts[2]).toBe(`@two\n${items[1].url}`);
    expect(new Set(["2026-09-30", "2026-10-01", "2026-10-02"].map((d) => engageText(items, d).body.split("\n---\n")[0])).size).toBeGreaterThan(1);
  });

  it("sends up to three, once a day, counted toward the daily cap; tomorrow's text has none of today's posts", async () => {
    const t = convexTest(schema, modules);
    const c = await paired(t, "t1");
    for (const [h, id] of [["one", "a"], ["two", "b"], ["three", "c"], ["four", "d"]] as const) await produced(t, h, id, NOW);
    expect(await t.action(internal.engage.round.sendText, { creatorId: c, now: NOW })).toEqual({ sent: true, reason: "sent" });
    expect((await t.action(internal.engage.round.sendText, { creatorId: c, now: NOW + H })).sent, "once a day").toBe(false);
    const [first] = await texts(t, c);
    expect(first).toMatchObject({ kind: "engage", proactive: true, criticSkipped: true });
    expect(first.links).toHaveLength(ENGAGE.textShow);
    const state = (await t.run((ctx) => ctx.db.get(c)))!.engage!;
    expect(state.sent).toHaveLength(3);

    // The next day: one left over from yesterday plus one new post is two, and none of the three already sent.
    await produced(t, "one", "e", NOW + D);
    expect(await t.action(internal.engage.round.sendText, { creatorId: c, now: NOW + D })).toEqual({ sent: true, reason: "sent" });
    const second = (await texts(t, c)).sort((x, y) => x.ts - y.ts)[1];
    for (const url of first.links ?? []) expect(second.body).not.toContain(url);
    expect(second.links).toHaveLength(2);
    // And then there is nothing she hasn't sent: she says nothing.
    expect(await t.action(internal.engage.round.sendText, { creatorId: c, now: NOW + 2 * D })).toEqual({ sent: false, reason: "fewer than two fresh posts she hasn't sent" });
  });

  it("holds: unpaired, already on it today, quiet hours, the weekly cap", async () => {
    const t = convexTest(schema, modules);
    const lone = await paired(t, "t2", { channel: { paired: false } });
    for (const [h, id] of [["one", "a"], ["two", "b"], ["three", "c"]] as const) await produced(t, h, id, NOW);
    expect((await t.action(internal.engage.round.sendText, { creatorId: lone, now: NOW })).reason).toBe("not paired");

    const busy = await paired(t, "t3");
    const me = t.withIdentity({ subject: (await t.run((ctx) => ctx.db.get(busy)))!.clerkUserId });
    await me.mutation(api.engage.round.markDone, { platform: "tiktok", postId: "a", handle: "one" });
    // markDone stamps the real day; ask at the real now so "today" matches.
    expect((await t.action(internal.engage.round.sendText, { creatorId: busy })).reason).toMatch(/already on it today|quiet|fewer than two/);

    const night = await paired(t, "t4");
    const at3am = Date.UTC(2026, 8, 30, 3, 0);
    for (const [h, id] of [["one", "n1"], ["two", "n2"]] as const) await produced(t, h, id, at3am);
    const r = await t.action(internal.engage.round.sendText, { creatorId: night, now: at3am });
    expect(r.sent, `quiet hours hold it: ${r.reason}`).toBe(false);

    const weekly = await paired(t, "t5");
    await t.run(async (ctx) => { for (let i = 1; i <= ENGAGE.textsPerWeek; i++) await ctx.db.insert("messages", { creatorId: weekly, direction: "out", surface: "imessage", kind: "engage", body: "x", proactive: true, ts: NOW - i * D + H } as never); });
    expect((await t.action(internal.engage.round.sendText, { creatorId: weekly, now: NOW })).reason).toMatch(/this week already/);
  });

  it("a post they commented on never comes back, in the app or in a text", async () => {
    const t = convexTest(schema, modules);
    const c = await paired(t, "t6");
    const realNow = Date.now();
    for (const [h, id] of [["one", "a"], ["two", "b"], ["three", "c"]] as const) await produced(t, h, id, realNow);
    const me = t.withIdentity({ subject: (await t.run((ctx) => ctx.db.get(c)))!.clerkUserId });
    await me.mutation(api.engage.round.markDone, { platform: "tiktok", postId: "a", handle: "one" });
    expect((await me.query(api.engage.round.today, {}))!.items.find((i) => i.postId === "a")?.done, "today it stays, ticked").toBe(true);
    // Tomorrow: the state's day rolls over; "a" is remembered and gone.
    await t.run(async (ctx) => { const row = (await ctx.db.get(c))!; await ctx.db.patch(c, { engage: { ...row.engage!, day: "2000-01-01", done: [] } }); });
    expect((await me.query(api.engage.round.today, {}))!.items.map((i) => i.postId).sort()).toEqual(["b", "c"]);
    const f = await t.query(internal.engage.round.textInputs, { creatorId: c, now: realNow });
    expect(f!.items.map((i) => i.postId)).not.toContain("a");
  });

  it("is on the hourly cadence at midday their time, and its kind counts toward the daily cap", async () => {
    const src = readFileSync(new URL("../../agent/cadence.ts", import.meta.url), "utf8");
    expect(src).toMatch(/hour === ENGAGE\.textHourLocal\) out\.push\(\{ creatorId: c\.creatorId, touch: "engage" \}\)/);
    expect(src).toMatch(/d\.touch === "engage" \? internal\.engage\.round\.sendText/);
    const { countsTowardCap } = await import("../../core/messages");
    expect(countsTowardCap({ direction: "out", proactive: true, kind: "engage" } as never)).toBe(true);
  });
});
