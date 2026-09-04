/**
 * The roster grows from the creator's own lane.
 *
 * It used to be set once at onboarding and never change, and both onboarding suggestion
 * sources are unreliable (TikTok's Creative Center is down at the vendor; a following list
 * is often private). So a creator who could not name three accounts watched almost nobody
 * forever, which is the biggest single cause of her having nothing to say.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { ROSTER } from "../roster";

const NOW = Date.UTC(2026, 8, 3, 15, 0);
const DAY = 86_400_000;

async function laneWith(obs: Array<{ handle: string; day: number; views: number; keywords?: string[] }>) {
  const t = convexTest(schema, modules);
  const creatorId = await t.run((ctx) => seedCreator(ctx, "a", {
    timezone: "UTC", channel: { paired: true },
    dossier: { persona: { summary: "runner" }, keywords: ["running"], cadence: { postsPerWeek: 2 } },
    handles: { tiktok: "vanessaalopezz" },
  }));
  await t.run(async (ctx) => {
    let i = 0;
    for (const o of obs) {
      await ctx.db.insert("observations", {
        postId: `p${i++}`, platform: "tiktok", authorHandle: o.handle, url: `https://tiktok.com/@${o.handle}/video/${i}`,
        createTime: NOW - o.day * DAY, sampledAt: NOW - o.day * DAY, ageHours: 10,
        views: o.views, likes: 10, comments: 1, shares: 1, keywords: o.keywords ?? ["running"], source: "sweep",
      } as never);
    }
  });
  return { t, creatorId };
}

describe("roster candidates", () => {
  it("offers an account seen on several days in their lane", async () => {
    const { t, creatorId } = await laneWith([
      { handle: "leahruns", day: 1, views: 40_000 },
      { handle: "leahruns", day: 3, views: 60_000 },
    ]);
    const r = await t.query(internal.scout.roster.candidatesFor, { creatorId, now: NOW });
    expect(r.candidates[0].handle).toBe("leahruns");
    expect(r.candidates[0].days).toBe(2);
  });

  it("one viral post is luck, not a creator worth following", async () => {
    const { t, creatorId } = await laneWith([{ handle: "oneoff", day: 1, views: 9_000_000 }]);
    const r = await t.query(internal.scout.roster.candidatesFor, { creatorId, now: NOW });
    expect(r.candidates).toHaveLength(0);
    expect(ROSTER.minDays).toBeGreaterThan(1);
  });

  it("ONE post sampled on several days is still one post", async () => {
    // The live lane produced exactly this: a single 1.28M-view post counted as two days.
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", {
      timezone: "UTC", channel: { paired: true },
      dossier: { persona: { summary: "runner" }, keywords: ["running"], cadence: { postsPerWeek: 2 } },
      handles: { tiktok: "vanessaalopezz" },
    }));
    await t.run(async (ctx) => {
      for (const sampledAt of [NOW - DAY, NOW]) {
        await ctx.db.insert("observations", {
          postId: "the-same-post", platform: "tiktok", authorHandle: "viralonce",
          url: "https://tiktok.com/@viralonce/video/1", createTime: NOW - 5 * DAY, sampledAt,
          ageHours: 100, views: 1_280_000, likes: 10, comments: 1, shares: 1, keywords: ["running"], source: "sweep",
        } as never);
      }
    });
    const r = await t.query(internal.scout.roster.candidatesFor, { creatorId, now: NOW });
    expect(r.candidates, "sampling is not posting").toHaveLength(0);
  });

  it("never offers someone they already removed, nor the creator themselves", async () => {
    const { t, creatorId } = await laneWith([
      { handle: "dropped", day: 1, views: 10_000 }, { handle: "dropped", day: 2, views: 10_000 },
      { handle: "vanessaalopezz", day: 1, views: 10_000 }, { handle: "vanessaalopezz", day: 2, views: 10_000 },
    ]);
    await t.run((ctx) => ctx.db.insert("trackedAccounts", { creatorId, platform: "tiktok", handle: "dropped", status: "removed", addedBy: "creator", baselineN: 0, createdAt: NOW } as never));
    const r = await t.query(internal.scout.roster.candidatesFor, { creatorId, now: NOW });
    expect(r.candidates.map((c) => c.handle)).toEqual([]);
  });

  it("ignores posts outside their lane", async () => {
    const { t, creatorId } = await laneWith([
      { handle: "chef", day: 1, views: 500_000, keywords: ["cooking"] },
      { handle: "chef", day: 2, views: 500_000, keywords: ["cooking"] },
    ]);
    const r = await t.query(internal.scout.roster.candidatesFor, { creatorId, now: NOW });
    expect(r.candidates).toHaveLength(0);
  });
});

describe("the offer", () => {
  it("asks once, with buttons, and never twice about the same account", async () => {
    const { t, creatorId } = await laneWith([
      { handle: "leahruns", day: 1, views: 40_000 },
      { handle: "leahruns", day: 3, views: 60_000 },
    ]);
    const first = await t.action(internal.scout.roster.offer, { creatorId, now: NOW });
    expect(first.offered).toBe("leahruns");

    const out = (await t.run((ctx) => ctx.db.query("messages").collect())).filter((m) => m.direction === "out");
    expect(out).toHaveLength(1);
    expect(out[0].buttons?.map((b) => b.id)).toEqual(["roster:leahruns:yes", "roster:leahruns:no"]);
    // An optional offer must not hold the day's one open-question slot; an idea outranks it.
    expect(out[0].awaitingAnswer).toBe(false);

    // Never twice: the dedupe key writes nothing, and the offer must say so rather than
    // reporting a send that did not happen.
    const second = await t.action(internal.scout.roster.offer, { creatorId, now: NOW + 60_000 });
    expect(second.offered).toBeNull();
    expect(second.reason).toMatch(/already asked/);
    expect((await t.run((ctx) => ctx.db.query("messages").collect())).filter((m) => m.direction === "out")).toHaveLength(1);
  });

  it("their yes puts the account on the list", async () => {
    const { t, creatorId } = await laneWith([
      { handle: "leahruns", day: 1, views: 40_000 },
      { handle: "leahruns", day: 3, views: 60_000 },
    ]);
    const r = await t.mutation(internal.scout.roster.accept, { creatorId, handle: "leahruns" });
    expect(r.ok).toBe(true);
    const tracked = await t.run((ctx) => ctx.db.query("trackedAccounts").collect());
    expect(tracked.map((x) => x.handle)).toContain("leahruns");
    expect(tracked[0].status).toBe("active");
  });

  it("stops growing on its own once the roster is full", async () => {
    const { t, creatorId } = await laneWith([
      { handle: "leahruns", day: 1, views: 40_000 },
      { handle: "leahruns", day: 3, views: 60_000 },
    ]);
    await t.run(async (ctx) => {
      for (let i = 0; i < ROSTER.max; i++) await ctx.db.insert("trackedAccounts", { creatorId, platform: "tiktok", handle: `a${i}`, status: "active", addedBy: "creator", baselineN: 0, createdAt: NOW } as never);
    });
    const r = await t.action(internal.scout.roster.offer, { creatorId, now: NOW });
    expect(r.offered).toBeNull();
    expect(r.reason).toMatch(/already watching/);
  });
});

describe("weight class", () => {
  it("a tiny account posting often does not outrank a big one posting twice", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", {
      timezone: "UTC", channel: { paired: true },
      dossier: { persona: { summary: "runner" }, keywords: ["running"], cadence: { postsPerWeek: 2 } },
      handles: { tiktok: "vanessaalopezz" },
    }));
    // Her own normal is ~60k, so a 6k account is not in her weight class.
    await t.run(async (ctx) => {
      for (let i = 0; i < 5; i++) {
        await ctx.db.insert("ownPosts", { creatorId, platform: "tiktok", postId: `own${i}`, url: `https://tiktok.com/@vanessaalopezz/video/${i}`, createTime: NOW - i * DAY, contentType: "video", caption: "x", hashtags: [], metrics: { views: 60_000, likes: 1, comments: 1, shares: 1 }, metricsAsOf: NOW, source: "scrape" } as never);
      }
      let n = 0;
      const add = (handle: string, day: number, views: number) => ctx.db.insert("observations", {
        postId: `p${n++}`, platform: "tiktok", authorHandle: handle, url: `https://tiktok.com/@${handle}/video/${n}`,
        createTime: NOW - day * DAY, sampledAt: NOW - day * DAY, ageHours: 20, views, likes: 5, comments: 1, shares: 1,
        keywords: ["running"], source: "sweep",
      } as never);
      for (const d of [1, 2, 3, 4]) await add("tinybutbusy", d, 6_474);
      for (const d of [1, 3]) await add("bigandrelevant", d, 955_927);
    });
    const r = await t.query(internal.scout.roster.candidatesFor, { creatorId, now: NOW });
    expect(r.candidates[0].handle, "reach has to count for something").toBe("bigandrelevant");
    expect(r.candidates.map((c) => c.handle), "and the tiny one is out of her weight class entirely").not.toContain("tinybutbusy");
  });
});
