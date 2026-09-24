/**
 * B3: the real world. Categories: adversarial/privacy (a query never carries the creator's own
 * handles or email; a non-public URL is never fetched), budget fail-closed (2 web calls a turn;
 * no key → a named refusal, never a guess), sibling coherence (every tool on the belt is priced;
 * every platform fact has an official source and a date), cross-tenant (the scrub uses the
 * asking creator's identity).
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { scrubQuery } from "../web";
import { DEFAULT_BUDGET, priceFor, runTool, TOOLS, type ToolCallRecord } from "../tools";
import { factsFor, PLATFORM_FACTS, staleDays } from "../../knowledge/platforms";

describe("privacy: queries never carry who's asking", () => {
  it("strips their handles (with or without @) and email, keeps the public words", () => {
    expect(scrubQuery("vanessaalopezz brisbane half marathon date", { handles: ["vanessaalopezz"], email: "v@x.com" })).toBe("brisbane half marathon date");
    expect(scrubQuery("@VanessaALopezz v@x.com tiktok shop rules", { handles: ["vanessaalopezz"], email: "v@x.com" })).toBe("tiktok shop rules");
    expect(scrubQuery("someone@else.com password=hunter2 events", { handles: [] })).toBe("events");
    expect(scrubQuery("@vanessaalopezz", { handles: ["vanessaalopezz"] })).toBeNull();
  });
});

describe("platform facts", () => {
  it("every fact has an official https source and a real date", () => {
    for (const f of PLATFORM_FACTS) {
      expect(f.source, f.id).toMatch(/^https:\/\/([a-z-]+\.)?(tiktok|instagram)\.com\//);
      expect(Number.isNaN(Date.parse(f.verifiedOn)), f.id).toBe(false);
    }
    expect(new Set(PLATFORM_FACTS.map((f) => f.id)).size).toBe(PLATFORM_FACTS.length);
  });
  it("finds the right note for what creators actually ask", () => {
    expect(factsFor("how many followers do i need to get paid by tiktok", "tiktok")[0].id).toBe("tt-creator-rewards");
    expect(factsFor("am i shadowbanned? my views died").map((f) => f.id)).toEqual(expect.arrayContaining(["tt-fyf-ineligible", "ig-account-status"]));
    expect(factsFor("does instagram hide reels with a tiktok watermark", "instagram")[0].id).toBe("ig-originality");
    expect(factsFor("what's the weather")).toEqual([]);
  });
  it("a fact older than 60 days reads as possibly changed", () => {
    expect(staleDays("2026-09-24", Date.parse("2026-12-01T00:00:00Z"))).toBeGreaterThan(60);
  });
});

describe("the web tools, through her belt", () => {
  beforeEach(() => { vi.stubEnv("TAVILY_API_KEY", "tvly-test"); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  async function setup() {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => seedCreator(ctx, "a", { clerkUserId: "user_a", handles: { tiktok: "vanessaalopezz" }, email: "v@x.com" }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- adapter over convex-test's typed callers for runTool's action ctx
    const any = t as any;
    const ctx = { runQuery: (f: unknown, x: unknown) => any.query(f, x), runMutation: (f: unknown, x: unknown) => any.mutation(f, x), runAction: (f: unknown, x: unknown) => any.action(f, x) } as never;
    return { t, a, ctx };
  }

  it("a search is scrubbed, costed, labelled untrusted with the day checked; two a turn", async () => {
    const { t, a, ctx } = await setup();
    const sent: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body).query);
      return new Response(JSON.stringify({ results: [{ url: "https://www.brisbanemarathon.com.au/", title: "Brisbane Marathon Festival", content: "Sunday 3 August 2026", published_date: "2026-07-01" }] }), { status: 200 });
    }));
    const trace: ToolCallRecord[] = [];
    const out = await runTool(ctx, a, { name: "web_search", args: { query: "vanessaalopezz brisbane marathon date", why: "w" } }, DEFAULT_BUDGET(), trace);
    expect(sent[0]).toBe("brisbane marathon date");
    expect(out).toMatch(/untrusted web text, checked \d{4}-\d{2}-\d{2}/);
    expect(out).toContain("https://www.brisbanemarathon.com.au/");
    await runTool(ctx, a, { name: "web_search", args: { query: "brisbane events", why: "w" } }, DEFAULT_BUDGET(), trace);
    expect(await runTool(ctx, a, { name: "web_read", args: { url: "https://www.brisbanemarathon.com.au/", why: "w" } }, DEFAULT_BUDGET(), trace)).toMatch(/^refused: 2 web lookups a turn/);
    const costs = await t.run((c) => c.db.query("costEvents").collect());
    expect(costs.filter((x) => x.vendor === "tavily").length).toBe(2);
  });

  it("fails closed: no key is a named refusal, and a private URL is never fetched", async () => {
    const { a, ctx } = await setup();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubEnv("TAVILY_API_KEY", "");
    expect(await runTool(ctx, a, { name: "web_search", args: { query: "tiktok creator rewards", why: "w" } }, DEFAULT_BUDGET(), [])).toMatch(/^refused: web search isn't set up/);
    vi.stubEnv("TAVILY_API_KEY", "tvly-test");
    for (const url of ["http://example.com/x", "https://localhost/admin", "https://10.0.0.1/", "file:///etc/passwd"]) expect(await runTool(ctx, a, { name: "web_read", args: { url, why: "w" } }, DEFAULT_BUDGET(), [])).toMatch(/^refused: that isn't a public web page/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("every tool on the belt is priced (sibling coherence)", () => {
    for (const tool of TOOLS) if (!tool.function.name.startsWith("partnership_")) expect(priceFor(tool.function.name, {}), tool.function.name).toBeDefined();
  });

  it("platform_fact answers with the source and 'as of'", async () => {
    const { a, ctx } = await setup();
    const out = await runTool(ctx, a, { name: "platform_fact", args: { topic: "how many followers to get paid", platform: "tiktok", why: "w" } }, DEFAULT_BUDGET(), []);
    expect(out).toMatch(/10,000 followers.*as of 2026-09-24.*https:\/\/www\.tiktok\.com/);
  });
});
