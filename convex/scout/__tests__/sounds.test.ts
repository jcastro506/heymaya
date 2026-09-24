/** §13.8 sound rail: two or more distinct lane accounts on one sound in a week is a signal; one is not; never twice a week. */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { risingSounds } from "../sounds";

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
});
