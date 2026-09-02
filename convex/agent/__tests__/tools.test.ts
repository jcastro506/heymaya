/**
 * §13.11 (5): the budget holds (the seventh call is refused and the model is told) ·
 * an unknown tool is refused · own_rhymes never crosses a tenant · a summary never
 * exceeds its cap · every call, refused or not, leaves a trace row.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import type { ActionCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { DEFAULT_BUDGET, runTool, SUMMARY_CAP, TOOL_CREDITS, TOOLS, type ToolCallRecord } from "../tools";
import { LOOKUPS } from "../playbooks";
import { tokens } from "../toolsData";

function fakeCtx(overrides: Partial<{ runAction: (ref: unknown, args: unknown) => Promise<unknown>; runQuery: (ref: unknown, args: unknown) => Promise<unknown> }> = {}): ActionCtx {
  return { runAction: overrides.runAction ?? (async () => ({ value: null, cached: false, key: "k" })), runQuery: overrides.runQuery ?? (async () => []) } as unknown as ActionCtx;
}
const creatorId = "j57abc" as Id<"creators">;

describe("runTool", () => {
  it("refuses the seventh call and says so; every call leaves a trace row", async () => {
    const trace: ToolCallRecord[] = [];
    const ctx = fakeCtx({ runAction: async () => ({ value: { transcript: "hello" }, cached: false, key: "k" }) });
    const budget = DEFAULT_BUDGET();
    for (let i = 0; i < 6; i++) expect(await runTool(ctx, creatorId, { name: "post_transcript", args: { url: "https://www.tiktok.com/@a/video/1", why: "w" } }, budget, trace)).toBe("hello");
    const seventh = await runTool(ctx, creatorId, { name: "post_transcript", args: { url: "https://www.tiktok.com/@a/video/1", why: "w" } }, budget, trace);
    expect(seventh).toMatch(/refused: the call budget/);
    expect(trace).toHaveLength(7);
    expect(trace[6].ok).toBe(false);
    expect(trace.slice(0, 6).every((t) => t.ok && t.credits === 1)).toBe(true);
  });

  it("refuses an unknown tool and a call over the credit budget", async () => {
    const trace: ToolCallRecord[] = [];
    expect(await runTool(fakeCtx(), creatorId, { name: "publish_post", args: { why: "w" } }, DEFAULT_BUDGET(), trace)).toMatch(/refused: no tool named/);
    const tight = { calls: 6, credits: 0, deadlineAt: Date.now() + 60_000 };
    expect(await runTool(fakeCtx(), creatorId, { name: "post_info", args: { url: "https://www.tiktok.com/@a/video/1", why: "w" } }, tight, trace)).toMatch(/credit budget/);
    expect(await runTool(fakeCtx(), creatorId, { name: "own_rhymes", args: { query: "x", why: "w" } }, tight, trace)).toBe("nothing of theirs rhymes with that"); // free tools still run
  });

  it("caps a summary and never passes the raw payload", async () => {
    const trace: ToolCallRecord[] = [];
    const ctx = fakeCtx({ runAction: async () => ({ value: { transcript: "x".repeat(10_000) }, cached: true, key: "k" }) });
    const out = await runTool(ctx, creatorId, { name: "post_transcript", args: { url: "https://www.tiktok.com/@a/video/1", why: "w" } }, DEFAULT_BUDGET(), trace);
    expect(out.length).toBeLessThanOrEqual(SUMMARY_CAP + 10);
    expect(trace[0].credits).toBe(0); // cached: free
  });

  it("every tool in the belt has a price and a why parameter; the belt covers the catalogue", () => {
    for (const t of TOOLS) {
      expect((t.function.parameters as { required: string[] }).required).toContain("why");
      expect(TOOL_CREDITS[t.function.name], t.function.name).toBeDefined();
    }
    const names = TOOLS.map((t) => t.function.name);
    for (const n of ["post_info", "post_transcript", "post_comments", "sound_info", "sound_videos", "sound_reels", "profile", "account_posts", "search_keyword", "search_hashtag", "search_reels", "search_ig_hashtag", "ig_popular", "trending_tiktok", "trending_reels", "suggestions", "discover_creators", "discover_profiles", "own_rhymes", "calendar_upcoming", "recall"]) expect(names).toContain(n);
  });

  it("every judgment skill carries its lookup playbook", () => {
    for (const k of ["scout", "opinion", "explainPost", "profile", "review"] as const) expect(LOOKUPS[k].length).toBeGreaterThan(200);
  });
});

describe("own_rhymes", () => {
  it("ranks the creator's own posts by word overlap and never returns another creator's", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => seedCreator(ctx, "a"));
    const b = await t.run((ctx) => seedCreator(ctx, "b", { clerkUserId: "u_b", handles: { tiktok: "tt_b" } }));
    const now = Date.now();
    const post = (creator: Id<"creators">, caption: string, id: string, multiple?: number) => ({ creatorId: creator, platform: "tiktok" as const, postId: id, url: `https://t/${id}`, createTime: now, contentType: "video" as const, hashtags: [], caption, metrics: { views: 1, likes: 0, comments: 0, shares: 0 }, metricsAsOf: now, source: "scrape" as const, multiple });
    await t.run(async (ctx) => {
      await ctx.db.insert("ownPosts", post(a, "shoe rack tour before the marathon", "1", 2.1));
      await ctx.db.insert("ownPosts", post(a, "mile repeats are a scam", "2", 0.8));
      await ctx.db.insert("ownPosts", post(b, "my shoe rack is bigger", "3", 5));
    });
    const rows = await t.query(internal.agent.toolsData.ownRhymes, { creatorId: a, query: "shoe rack" });
    expect(rows.map((r) => r.url)).toEqual(["https://t/1"]);
    expect(tokens("the shoe rack, my post")).toEqual(["shoe", "rack"]);
  });
});
