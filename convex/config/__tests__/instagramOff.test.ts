/**
 * Instagram off (config/platforms, 2026-10-13): TikTok only, reversibly. Nothing Instagram is read, offered,
 * connected, watched or suggested; nothing Instagram is deleted; turning it back on restores it.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../../schema";
import { api, internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { enabledPlatforms, instagramOn, platformOn } from "../platforms";
import { accountsWithinPlan, entitlementsFor, offeredTiers, planLineFor, tierCopy } from "../../billing/tiers";
import { isInstagramRead } from "../../reads/read";
import { addTracked } from "../../agent/manage";
import { INSTAGRAM_TOOLS, platformBelt, TOOLS } from "../../agent/tools";
import { shareTarget } from "../../share";
import { factsFor } from "../../knowledge/platforms";
import { PLATFORM_SCOPE } from "../../agent/context";

beforeEach(() => { vi.stubEnv("INSTAGRAM_ENABLED", "0"); vi.stubEnv("MODEL_FAKE", "1"); vi.stubEnv("OPENROUTER_API_KEY", "fake"); });
afterEach(() => { vi.unstubAllEnvs(); });

describe("the switch (pure)", () => {
  it("off unless set on; TikTok is always on", () => {
    expect(instagramOn({})).toBe(false);
    expect(instagramOn({ INSTAGRAM_ENABLED: "1" })).toBe(true);
    expect(instagramOn({ INSTAGRAM_ENABLED: "true" })).toBe(true);
    expect(instagramOn({ INSTAGRAM_ENABLED: "yes please" })).toBe(false);
    expect(enabledPlatforms()).toEqual(["tiktok"]);
    expect(platformOn("tiktok")).toBe(true);
    expect(platformOn("instagram")).toBe(false);
  });
  it("plans: two on offer, in TikTok-only words; nobody can read two accounts", () => {
    expect(offeredTiers()).toEqual(["solo", "partner"]);
    expect(tierCopy("solo").label).toBe("Maya");
    expect(tierCopy("partner").label).toBe("Maya + Deals");
    expect(JSON.stringify([tierCopy("solo"), tierCopy("partner")])).not.toMatch(/instagram/i);
    expect(entitlementsFor({ status: "active", tier: "partner" }).accounts).toBe(1);
    expect(planLineFor("solo")).toMatch(/\$29\.99 for Maya \+ Deals/);
    expect(planLineFor("solo")).not.toMatch(/both accounts|24\.99/);
  });
  it("a solo plan's one account is their TikTok, even when Instagram was connected first", () => {
    const accts = [{ platform: "instagram", id: "ig" }, { platform: "tiktok", id: "tt" }];
    expect(accountsWithinPlan(accts, 1).map((a) => a.id)).toEqual(["tt"]);
    vi.stubEnv("INSTAGRAM_ENABLED", "1");
    expect(accountsWithinPlan(accts, 1).map((a) => a.id), "back on: as before").toEqual(["ig"]);
  });
  it("no Instagram read, tool, link or fact gets through", () => {
    expect(isInstagramRead("search.reels", {})).toBe(true);
    expect(isInstagramRead("profile", { platform: "instagram" })).toBe(true);
    expect(isInstagramRead("post.info", { url: "https://www.instagram.com/p/abc/" })).toBe(true);
    expect(isInstagramRead("profile", { platform: "tiktok" })).toBe(false);
    expect(isInstagramRead("ads.meta", { query: "running" }), "the Meta ad library is about brands, not their Instagram").toBe(false);
    const belt = platformBelt(TOOLS);
    expect(belt.some((t) => INSTAGRAM_TOOLS.has(t.function.name))).toBe(false);
    for (const t of belt) expect(JSON.stringify((t.function.parameters as { properties?: { platform?: unknown } }).properties?.platform ?? {})).not.toContain("instagram");
    expect(shareTarget("https://www.instagram.com/reel/abc123/")).toMatchObject({ ok: false, reason: expect.stringMatching(/only TikTok/) });
    expect(shareTarget("https://www.tiktok.com/@sam/video/7395965676629888274")).toMatchObject({ ok: true });
    expect(factsFor("trial reels originality cross-post", "both").every((f) => f.platform !== "instagram")).toBe(true);
    expect(PLATFORM_SCOPE).toMatch(/TikTok only/);
  });
});

describe("on rows", () => {
  it("onboarding needs TikTok, and never wipes an Instagram handle they already had", async () => {
    const t = convexTest(schema, modules);
    const c = await t.run((ctx) => seedCreator(ctx, "ig", { clerkUserId: "user_ig", handles: { tiktok: "sam", instagram: "sam.ig" } }));
    const me = t.withIdentity({ subject: "user_ig", email: "ig@example.com" });
    const fresh = t.withIdentity({ subject: "user_new", email: "new@example.com" });
    expect(await fresh.mutation(api.onboarding.start.start, { handles: { instagram: "only.ig" }, timezone: "UTC" })).toMatchObject({ ok: false, error: "your TikTok handle is required" });
    expect(await me.mutation(api.onboarding.start.start, { handles: { tiktok: "sam2", instagram: "ignored.while.off" }, timezone: "UTC" })).toMatchObject({ ok: true });
    const row = (await t.run((ctx) => ctx.db.get(c)))!;
    expect(row.handles.tiktok).toBe("sam2");
    expect(row.handles.instagram, "kept for when it's back on; a new one isn't taken while off").toBe("sam.ig");
  });
  it("the watch list takes TikTok only; nothing Instagram is retired", async () => {
    const t = convexTest(schema, modules);
    const c = await t.run((ctx) => seedCreator(ctx, "w"));
    expect(await t.run((ctx) => addTracked(ctx as never, c, "instagram", "someone", [], { addedBy: "creator" }))).toMatchObject({ ok: false, error: expect.stringMatching(/TikTok/) });
    expect(await t.run((ctx) => addTracked(ctx as never, c, "tiktok", "someone", [], { addedBy: "creator" }))).toMatchObject({ ok: true });
    await t.run((ctx) => ctx.db.insert("trackedAccounts", { creatorId: c, platform: "instagram", handle: "old.ig", status: "active", addedBy: "creator", baselineN: 0, createdAt: 0 } as never));
    const sampled = await t.query(internal.scout.sampler.distinctTracked, {});
    expect(sampled.map((s) => s.platform)).toEqual(["tiktok"]);
    const ig = (await t.run((ctx) => ctx.db.query("trackedAccounts").collect())).find((r) => r.platform === "instagram")!;
    expect(ig.status, "not retired, so it comes back with the switch").toBe("active");
  });
  it("what the app is told: TikTok only, and the two plans", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => seedCreator(ctx, "app", { clerkUserId: "user_app" }));
    const me = t.withIdentity({ subject: "user_app" });
    const s = await me.query(api.ui.settings, {});
    expect(s).toMatchObject({ instagramEnabled: false, platforms: ["tiktok"] });
    const p = await me.query(api.ui.plans, {});
    expect(p!.tiers.map((x) => [x.tier, x.label])).toEqual([["solo", "Maya"], ["partner", "Maya + Deals"]]);
  });
});

describe("the kit's follower count is today's (2026-10-13)", () => {
  it("a live read is recorded on the connected account's row for today, and the kit shows it", async () => {
    vi.stubEnv("SCRAPE_FIXTURES", "spec");
    const t = convexTest(schema, modules);
    const c = await t.run((ctx) => seedCreator(ctx, "fresh", { handles: { tiktok: "stoolpresidente" }, plan: { status: "active", founding: true, tier: "partner" } }));
    await t.run((ctx) => ctx.db.insert("followerSnapshots", { creatorId: c, platform: "tiktok", accountId: "public:tiktok:stoolpresidente", day: "2000-01-01", followers: 134, at: 0 } as never));
    const r = await t.action(internal.connections.sync.refreshFollowers, { creatorId: c });
    expect(r.ok, r.reason).toBe(true);
    const k = await t.query(internal.partnerships.kitTools.kitFor, { creatorId: c });
    expect(k?.kit.platforms[0].followers).toBe(r.followers);
    expect(r.followers).not.toBe(134);
  });
});
