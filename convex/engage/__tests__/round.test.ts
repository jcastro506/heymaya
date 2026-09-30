/**
 * The engagement round: fresh posts from accounts she already watches for them, a goal and a streak.
 * Pure picking and streak arithmetic; then rows (only their own round; marking is idempotent and
 * tells her what they did). She never comments for them: there is no send path here to test.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import schema from "../../schema";
import { api } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { addTracked } from "../../agent/manage";
import { afterDone, ENGAGE, localDay, pickRound, type RoundPost } from "../round";
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

  it("she never comments for them: this module has no send, post or reply path", () => {
    const src = readFileSync(new URL("../round.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/messages\.send|inbox|reply|fetch\(/);
  });
});
