/**
 * K1: the app's kit (ui:kit) and its door (appUpdate). Categories: sibling coherence (the app's
 * fixture, apps/ios/Fixtures/kit.json, has the query's real shape, field by field and type by type,
 * so the Swift contract test decodes what the server sends), fail-closed (null below the plan; an op
 * the app doesn't make is refused), cross-tenant (B's session sees B's kit).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { api, internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";

const FIXTURE = JSON.parse(readFileSync(join(__dirname, "../../../apps/ios/Fixtures/kit.json"), "utf8"));

/** Pure: a value's shape (types, keys, the first element of arrays); null matches anything nullable. */
function shape(x: unknown): unknown {
  if (x === null) return "null";
  if (Array.isArray(x)) return x.length ? [shape(x[0])] : [];
  if (typeof x === "object") return Object.fromEntries(Object.entries(x as object).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, shape(v)]));
  return typeof x;
}
function compatible(server: unknown, fixture: unknown): string[] {
  if (server === "null" || fixture === "null") return [];
  if (Array.isArray(server) && Array.isArray(fixture)) return server.length && fixture.length ? compatible(server[0], fixture[0]) : [];
  if (typeof server === "object" && typeof fixture === "object" && server && fixture) {
    const s = server as Record<string, unknown>, f = fixture as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(s), ...Object.keys(f)])];
    return keys.flatMap((k) => (k in s && k in f ? compatible(s[k], f[k]).map((e) => `${k}.${e}`) : [`${k}: ${k in s ? "missing from the fixture" : "not sent by the server"}`]));
  }
  return server === fixture ? [] : [`${String(server)} vs ${String(fixture)}`];
}

async function world(tier: "solo" | "partner") {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const a = await seedCreator(ctx, "a", { clerkUserId: "user_a", plan: { status: "active", founding: false, tier } } as never);
    const b = await seedCreator(ctx, "b", { clerkUserId: "user_b", plan: { status: "active", founding: false, tier: "partner" } } as never);
    for (let i = 0; i < 4; i++) await ctx.db.insert("ownPosts", { creatorId: a, platform: "instagram", postId: `p${i}`, url: `https://www.instagram.com/reel/p${i}/`, createTime: Date.now() - (i + 1) * 86_400_000, contentType: "video", caption: `run ${i}`, hashtags: [], metrics: { views: 1000 * (i + 1), likes: 50, comments: 5, shares: 2 }, metricsAsOf: Date.now(), source: "scrape" } as never);
    await ctx.db.insert("followerSnapshots", { creatorId: a, platform: "instagram", accountId: "x", day: new Date().toISOString().slice(0, 10), followers: 8050, at: Date.now() });
    const opp = await ctx.db.insert("partnershipOpportunities", { creatorId: a, brandDomain: "pacefern.com", data: { brand: "Pacefern", status: "contacted" }, updatedAt: Date.now() });
    await ctx.db.insert("kitVariants", { creatorId: a, opportunityId: opp, slug: "abcdefgh1234", brand: "Pacefern", postUrls: [], idea: "an idea for them", createdAt: Date.now(), openedAt: Date.now() });
    return { a, b };
  });
  return { t, ...ids, asA: t.withIdentity({ subject: "user_a" }), asB: t.withIdentity({ subject: "user_b" }) };
}

describe("ui:kit (the app's contract)", () => {
  it("the fixture has the server's shape, so the Swift decode test means something", async () => {
    const w = await world("partner");
    await w.t.mutation(internal.partnerships.kitSettings.change, { creatorId: w.a, change: { op: "propose_one_line", text: "Honest early-morning running" } });
    await w.t.mutation(internal.partnerships.kitPage.kitLinkFor, { creatorId: w.a, on: true });
    const k = await w.asA.query(api.ui.kit, {});
    expect(k).not.toBeNull();
    expect(compatible(shape(k), shape(FIXTURE))).toEqual([]);
    expect(k?.brandLinks).toEqual([{ brand: "Pacefern", url: expect.stringMatching(/\/k\/abcdefgh1234$/), opened: true, live: true }]);
    expect(k?.oneLine).toEqual({ text: "Honest early-morning running", approved: false });
  });
  it("null below the plan; B sees B's kit", async () => {
    expect(await (await world("solo")).asA.query(api.ui.kit, {})).toBeNull();
    const w = await world("partner");
    expect((await w.asB.query(api.ui.kit, {}))?.brandLinks).toEqual([]);
  });
});

describe("appUpdate (the app's door)", () => {
  it("approve, audience, no photo: the same row the chat changes", async () => {
    const w = await world("partner");
    await w.t.mutation(internal.partnerships.kitSettings.change, { creatorId: w.a, change: { op: "propose_one_line", text: "Honest early-morning running" } });
    await w.asA.mutation(api.partnerships.kitSettings.appUpdate, { op: "approve_one_line" });
    await w.asA.mutation(api.partnerships.kitSettings.appUpdate, { op: "audience", on: true });
    await w.asA.mutation(api.partnerships.kitSettings.appUpdate, { op: "photo", source: "none" });
    const k = await w.asA.query(api.ui.kit, {});
    expect(k).toMatchObject({ oneLine: { approved: true }, showAudience: true, photoSource: "none", photo: null });
  });
  it("refuses what the app doesn't do, and anyone off the plan", async () => {
    const w = await world("partner");
    await expect(w.asA.mutation(api.partnerships.kitSettings.appUpdate, { op: "tiktok_audience" })).rejects.toThrow(/Not an app action/);
    await expect(w.asA.mutation(api.partnerships.kitSettings.appUpdate, { op: "edit_one_line", text: "10k followers" })).rejects.toThrow(/No numbers/);
    const solo = await world("solo");
    await expect(solo.asA.mutation(api.partnerships.kitSettings.appUpdate, { op: "audience", on: true })).rejects.toThrow(/partnerships plan/);
    await expect(solo.asA.mutation(api.partnerships.kitSettings.photoUploadUrl, {})).rejects.toThrow(/partnerships plan/);
  });
});
