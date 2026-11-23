/**
 * Connected sims (2026-11-23). The sims never touched Zernio, and staging's delta feed stopped for seven weeks
 * unnoticed. One sim can now borrow a real creator's connected TikTok, read only, through the product's own code.
 * Categories: cross-tenant isolation (only the named source, only a sim) · adversarial input (a sim or a
 * creator without TikTok as the source) · sibling coherence (delta feeds every owner; the daily alert names
 * stale connections) · fail-closed (refusals are named, nothing half-made).
 */
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { composeAlert } from "../../core/alerts";
import type { Id } from "../../_generated/dataModel";

const H = 3_600_000;

async function realConnected(t: ReturnType<typeof convexTest>, key = "me", accounts?: Array<Record<string, unknown>>) {
  return await t.run(async (ctx) => {
    const creatorId = await seedCreator(ctx, key, { clerkUserId: `user_${key}`, handles: { tiktok: `tt_${key}` } } as never);
    await ctx.db.insert("connections", { creatorId, provider: "zernio", status: "connected", zernioProfileId: `prof_${key}`, updatedAt: Date.now(),
      zernioAccounts: accounts ?? [
        { accountId: `tt_${key}`, platform: "tiktok", username: `tt_${key}`, needsReconnect: false, canFetchAnalytics: true },
        { accountId: `ig_${key}`, platform: "instagram", username: `ig_${key}`, needsReconnect: false, canFetchAnalytics: true },
      ] } as never);
    return creatorId;
  });
}

const create = (t: ReturnType<typeof convexTest>, runId: string, handle: string, connectedFrom?: Id<"creators">) =>
  t.mutation(internal.eval.firstWeek.createOne, { runId, i: 0, handles: { tiktok: handle }, timezone: "UTC", watchCap: 0, transcriptCap: 0, ...(connectedFrom ? { connectedFrom } : {}) });

describe("a connected sim borrows one real connection", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("signs up with the source's handle and gets its TikTok account, nothing else", async () => {
    const t = convexTest(schema, modules);
    const me = await realConnected(t);
    const r = await create(t, "fw-c1", "tt_me", me);
    expect(r.ok, r.error).toBe(true);
    const conn = await t.run((ctx) => ctx.db.query("connections").withIndex("by_creator", (q) => q.eq("creatorId", r.creatorId as Id<"creators">).eq("provider", "zernio")).first());
    expect(conn?.zernioProfileId).toBe("prof_me");
    expect(conn?.zernioAccounts?.map((x) => x.platform)).toEqual(["tiktok"]);
    // The source is untouched.
    const mine = await t.run((ctx) => ctx.db.query("connections").withIndex("by_creator", (q) => q.eq("creatorId", me).eq("provider", "zernio")).first());
    expect(mine?.zernioAccounts).toHaveLength(2);
  });

  it("without connectedFrom the real rule holds: the handle is taken", async () => {
    const t = convexTest(schema, modules);
    await realConnected(t);
    const r = await create(t, "fw-c2", "tt_me");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/already set up/);
  });

  it("a different creator's handle can't ride on someone else's connection", async () => {
    const t = convexTest(schema, modules);
    const me = await realConnected(t);
    const other = await t.run((ctx) => seedCreator(ctx, "o", { clerkUserId: "user_o", handles: { tiktok: "tt_o" } } as never));
    void other;
    const r = await create(t, "fw-c3", "tt_o", me);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/already set up/);
  });

  it("refuses a source that is a sim, or has no TikTok connected", async () => {
    const t = convexTest(schema, modules);
    const igOnly = await realConnected(t, "ig", [{ accountId: "ig_x", platform: "instagram", username: "ig_x", needsReconnect: false, canFetchAnalytics: true }]);
    expect((await create(t, "fw-c4", "tt_ig", igOnly)).error).toMatch(/connected TikTok/);
    const me = await realConnected(t);
    const sim = await create(t, "fw-c5", "tt_me", me);
    expect((await create(t, "fw-c6", "tt_me", sim.creatorId as Id<"creators">)).error).toMatch(/connected TikTok/);
  });

  it("a real person's signup can never borrow a handle, whatever it passes", async () => {
    const t = convexTest(schema, modules);
    const me = await realConnected(t);
    const { startCreator } = await import("../../onboarding/start");
    const r = await t.run((ctx) => startCreator(ctx as never, { subject: "user_someone", email: "x@example.invalid", handles: { tiktok: "tt_me" }, sharesHandleWith: me }));
    expect(r.ok).toBe(false);
  });

  it("the hourly delta writes a borrowed account's rows to both owners", async () => {
    process.env.ZERNIO_API_KEY = "test_key_not_real";
    const t = convexTest(schema, modules);
    const me = await realConnected(t);
    const sim = (await create(t, "fw-c7", "tt_me", me)).creatorId as Id<"creators">;
    await t.mutation(internal.connections.sync.setCursor, { key: "zernio:analytics:delta", value: "c1" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [{ _id: "z1", platform: "tiktok", platformPostUrl: "https://www.tiktok.com/@tt_me/video/7000000000000000001", content: "a post", platforms: [{ platform: "tiktok", accountId: "tt_me", platformPostId: "7000000000000000001", platformPostUrl: "https://www.tiktok.com/@tt_me/video/7000000000000000001", publishedAt: new Date().toISOString() }], analytics: { views: 1200, likes: 80, comments: 4, shares: 2 } }], nextCursor: "c2", hasMore: false }), { status: 200 })));
    const r = await t.action(internal.connections.sync.delta, {});
    expect(r.rows).toBe(1);
    const owners = await t.run(async (ctx) => (await ctx.db.query("ownPosts").collect()).map((p) => p.creatorId).sort());
    expect(owners).toEqual([me, sim].sort());
  });
});

describe("the daily alert names a connection whose numbers stopped", () => {
  it("names it at noon, two days stale; quiet when fresh, disconnected or off the hour", async () => {
    const t = convexTest(schema, modules);
    const stale = await realConnected(t, "s");
    const fresh = await realConnected(t, "f");
    const now = Date.now() + 5 * 24 * H;
    const noon = new Date(now); noon.setUTCHours(12, 5, 0, 0);
    await t.run(async (ctx) => {
      await ctx.db.insert("accountInsights", { creatorId: stale, platform: "tiktok", accountId: "tt_s", kind: "insights", status: "ok", fetchedAt: noon.getTime() - 3 * 24 * H } as never);
      await ctx.db.insert("accountInsights", { creatorId: fresh, platform: "tiktok", accountId: "tt_f", kind: "insights", status: "ok", fetchedAt: noon.getTime() - 2 * H } as never);
    });
    const f = await t.query(internal.core.alerts.findings, { since: noon.getTime() - H, now: noon.getTime() });
    expect(f.staleConnected?.map((x) => x.creatorId)).toEqual([stale]);
    expect(composeAlert(f, "staging")).toMatch(/connected numbers not updating for 1 creator: .* \(3 days\)/);
    const offHour = await t.query(internal.core.alerts.findings, { since: noon.getTime(), now: noon.getTime() + 2 * H });
    expect(offHour.staleConnected).toEqual([]);
  });
});
