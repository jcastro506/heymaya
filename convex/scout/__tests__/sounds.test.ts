/** §13.8 sound rail: two or more distinct lane accounts on one sound in a week is a signal; one is not; never twice a week. */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { OBS_PAGE, risingSounds } from "../sounds";
import { laneSounds } from "../trends";

describe("sounds", () => {
  it("groups by sound and keeps only sounds used by two or more accounts", () => {
    const r = risingSounds([
      { clipId: "s1", authorHandle: "a", url: "https://t/1", views: 100, keywords: ["running"] },
      { clipId: "s1", authorHandle: "b", url: "https://t/2", views: 900, keywords: [] },
      { clipId: "s1", authorHandle: "a", url: "https://t/3", views: 50, keywords: [] },
      { clipId: "s2", authorHandle: "c", url: "https://t/4", views: 5000, keywords: [] },
      { authorHandle: "d", url: "https://t/5", views: 5, keywords: [] },
    ]);
    expect(r.map((x) => x.clipId)).toEqual(["s1"]);
    expect(r[0].accounts).toEqual(["a", "b"]);
    expect(r[0].posts).toHaveLength(3);
  });

  it("writes one sound signal per creator in the audience, once a week, and the gate lets it through only when rising", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => seedCreator(ctx, "a", { timezone: "UTC", channel: { paired: true }, dossier: { keywords: ["running"] } }));
    const now = Date.now();
    const sound = { clipId: "s1", accounts: ["x", "y"], posts: [{ url: "https://www.tiktok.com/@x/video/1", authorHandle: "x", views: 10, keywords: ["running"] }, { url: "https://www.tiktok.com/@y/video/2", authorHandle: "y", views: 900, keywords: [] }] };
    expect(await t.query(internal.scout.sounds.audienceFor, { handles: ["x", "y"], keywords: ["running"] })).toEqual([a]);
    expect((await t.mutation(internal.scout.sounds.writeSoundSignals, { creatorIds: [a], sound, now })).written).toBe(1);
    expect((await t.mutation(internal.scout.sounds.writeSoundSignals, { creatorIds: [a], sound, now: now + 3600_000 })).written).toBe(0);
    await t.run((ctx) => ctx.db.insert("signals", { creatorId: a, kind: "sound", sourcePostIds: ["9"], clipId: "lonely", score: 1.5, corroboration: { accounts: 1, soundRising: false }, verdict: "pending", why: "one account", thresholdsVersion: "t", createdAt: now }));
    const g = await t.query(internal.scout.gate.railsFor, { creatorId: a, now: now + 13 * 3600_000 });
    const sounds = g!.candidates.filter((s) => s.kind === "sound");
    expect(sounds.map((s) => s.clipId)).toEqual(["s1"]);
    expect(g!.tasteDropped.some((d) => d.why.includes("sound not rising"))).toBe(true);
  });

  it("reads the week in pages, so a week bigger than one function may read still counts every sound (2026-11-12)", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const n = OBS_PAGE + 40;
    await t.run(async (ctx) => {
      for (let i = 0; i < n; i++) {
        await ctx.db.insert("observations", { platform: "tiktok", postId: `p${i}`, authorHandle: `acct${i % 3}`, url: `https://www.tiktok.com/@acct${i % 3}/video/${i}`, createTime: now - 3_600_000, sampledAt: now - 60_000 - i, ageHours: 1, views: 100 + i, likes: 0, comments: 0, shares: 0, keywords: ["running"], source: "test", ...(i % 2 ? { clipId: i % 4 === 1 ? "hot" : "other" } : {}) });
      }
      // Older than a week: not this week's sound.
      await ctx.db.insert("observations", { platform: "tiktok", postId: "old", authorHandle: "z", url: "https://www.tiktok.com/@z/video/0", createTime: now - 9e8, sampledAt: now - 8 * 86_400_000, ageHours: 1, views: 1, likes: 0, comments: 0, shares: 0, keywords: [], source: "test", clipId: "hot" });
    });
    const first = await t.query(internal.scout.sounds.observationPage, { since: now - 7 * 86_400_000, cursor: null });
    expect(first.done).toBe(false);
    const second = await t.query(internal.scout.sounds.observationPage, { since: now - 7 * 86_400_000, cursor: first.cursor });
    expect(second.done).toBe(true);
    const rows = [...first.rows, ...second.rows];
    // Every observation with a sound, none without, none from last week.
    expect(rows).toHaveLength(n / 2);
    expect(rows.some((r) => r.authorHandle === "z")).toBe(false);
    const lane = laneSounds(rows);
    expect(new Set(lane.map((p) => p.sound?.clipId))).toEqual(new Set(["hot", "other"]));
    expect(lane.every((p) => p.source === "lane" && p.postedAt === now - 3_600_000)).toBe(true);
  });
});
