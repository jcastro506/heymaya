/**
 * The idea stock (2026-11-12): a creator always has a few fresh ideas, grounded in what code gathered, never one
 * they already have or passed on, never a link she wasn't given. Categories: grounding (links, multiples),
 * no repeats, budget (nothing when full), cross-tenant (another creator's ideas don't count or change).
 */
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { STOCK, momentOf, momentsFull, parseStock, stockTarget, upcomingMoments } from "../stock";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("the stock's pure parts", () => {
  it("targets one more than they post a week, between three and six", () => {
    expect(stockTarget(undefined)).toBe(3);
    expect(stockTarget(1)).toBe(3);
    expect(stockTarget(4)).toBe(5);
    expect(stockTarget(12)).toBe(STOCK.max);
  });

  it("drops a link it wasn't given, a hook they have, and a hook too short to be an idea", () => {
    const raw = JSON.stringify({ ideas: [
      { hook: "rate three thrift finds out of 10", why: "like your rating series", shoot: "one take", link: "https://www.tiktok.com/@x/video/1" },
      { hook: "rate three thrift finds out of 10", why: "dup", shoot: "" },
      { hook: "the $4 jacket that won", why: "w", shoot: "", link: "https://invented.example/2" },
      { hook: "hi", why: "too short" },
      { hook: "an old one they already have", why: "" },
    ] });
    const out = parseStock(raw, 5, ["https://www.tiktok.com/@x/video/1"], ["An old one they already have"]);
    expect(out.map((x) => x.hook)).toEqual(["rate three thrift finds out of 10", "the $4 jacket that won"]);
    expect(out[0].link).toBe("https://www.tiktok.com/@x/video/1");
    expect(out[1].link).toBe("");
    expect(parseStock("not json", 3, [], [])).toEqual([]);
  });

  it("a holiday is one idea a batch, and none once they have enough for it (horizon sim)", () => {
    expect(momentOf("Stop ruining your Thanksgiving gravy")).toBe("thanksgiving");
    expect(momentOf("friendsgiving on a budget")).toBe("thanksgiving");
    expect(momentOf("moving to Denver with a kitchen in boxes")).toBeUndefined();
    const raw = JSON.stringify({ ideas: [
      { hook: "Stop serving dry Thanksgiving turkey", why: "timely" },
      { hook: "Fix your gravy before the big day", why: "right before Thanksgiving" },
      { hook: "Cooking my last meal in the old kitchen before Denver", why: "the move" },
      { hook: "Christmas cookies, but fast", why: "" },
    ] });
    expect(parseStock(raw, 5, [], []).map((x) => x.hook)).toEqual(["Stop serving dry Thanksgiving turkey", "Cooking my last meal in the old kitchen before Denver", "Christmas cookies, but fast"]);
    const full = momentsFull(["Thanksgiving turkey fix", "Thanksgiving gravy fix", "christmas once"], ["Thanksgiving", "Christmas"]);
    expect([...full]).toEqual(["Thanksgiving"]);
    expect(parseStock(raw, 5, [], [], full).map((x) => x.hook)).toEqual(["Cooking my last meal in the old kitchen before Denver", "Christmas cookies, but fast"]);
  });

  it("knows the moments in the next six weeks", () => {
    const m = upcomingMoments(Date.UTC(2026, 10, 1));
    expect(m.map((x) => x.name)).toContain("Thanksgiving");
    expect(m.map((x) => x.name)).not.toContain("Valentine's Day");
  });
});

describe("topping up", () => {
  const reply = (ideas: unknown[]) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ideas }) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }), { headers: { "content-type": "application/json" } });

  it("fills a low stock with new ideas, and does nothing when it's full; another creator's ideas don't count", async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const now = Date.now();
    const a = await t.run((ctx) => seedCreator(ctx, "a", { channel: { paired: true } }));
    const b = await t.run((ctx) => seedCreator(ctx, "b", { clerkUserId: "u_b", handles: { tiktok: "tt_b" }, channel: { paired: true } }));
    // b has plenty of fresh ideas; a has one it passed on.
    await t.run(async (ctx) => {
      for (let i = 0; i < 6; i++) await ctx.db.insert("ideas", { creatorId: b, evidenceLinks: [], fit: "yes", fitWhy: "x", version: { hook: `b idea ${i}` }, messageText: `b idea ${i}`, produced: { skillVersion: "t", model: "t", thresholdsVersion: "t" }, sentAt: now, status: "sent", createdAt: now } as never);
      await ctx.db.insert("ideas", { creatorId: a, evidenceLinks: [], fit: "yes", fitWhy: "x", version: { hook: "the one they passed on" }, messageText: "the one they passed on", produced: { skillVersion: "t", model: "t", thresholdsVersion: "t" }, sentAt: now, status: "passed", createdAt: now } as never);
    });
    vi.stubGlobal("fetch", vi.fn(async () => reply([
      { hook: "the one they passed on", why: "again" },
      { hook: "rate three thrift finds out of 10", why: "like your rating series", shoot: "one take, three items" },
      { hook: "the jacket that cost $4 and won", why: "your finds", shoot: "" },
      { hook: "what $20 gets you at goodwill this week", why: "a weekly series", shoot: "" },
    ])));
    const r = await t.action(internal.scout.stock.topUp, { creatorId: a, now });
    expect(r.added).toBe(3);
    const ideas = await t.run((ctx) => ctx.db.query("ideas").withIndex("by_creator", (q) => q.eq("creatorId", a)).collect());
    expect(ideas.filter((i) => i.status === "sent").map((i) => (i.version as { hook: string }).hook).sort()).toEqual(["rate three thrift finds out of 10", "the jacket that cost $4 and won", "what $20 gets you at goodwill this week"]);
    expect(ideas.find((i) => (i.version as { hook: string }).hook.startsWith("rate"))?.shotList).toBe("one take, three items");
    // Full now: no model call, nothing added.
    const fetcher = vi.fn(async () => reply([]));
    vi.stubGlobal("fetch", fetcher);
    expect((await t.action(internal.scout.stock.topUp, { creatorId: a, now })).added).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
    expect((await t.action(internal.scout.stock.topUp, { creatorId: b, now })).reason).toMatch(/full/);
    expect((await t.run((ctx) => ctx.db.query("ideas").withIndex("by_creator", (q) => q.eq("creatorId", b)).collect()))).toHaveLength(6);
  });

  it("their life is in the brief, ahead of holidays: what they told her, and their calendar six weeks out", async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const now = Date.now();
    const a = await t.run((ctx) => seedCreator(ctx, "a", { channel: { paired: true }, notes: [
      { id: "m", text: "moving to Denver in five weeks", kind: "life", at: now, expiresHint: now + 40 * 86_400_000 },
      { id: "x", text: "an old trip", kind: "life", at: 1, expiresHint: now - 1 },
    ] }));
    const b = await t.run((ctx) => seedCreator(ctx, "b", { clerkUserId: "u_b", handles: { tiktok: "tt_b" }, channel: { paired: true }, notes: [{ id: "s", text: "b's secret wedding", kind: "life", at: now }] }));
    await t.run(async (ctx) => {
      await ctx.db.insert("calendarEvents", { creatorId: a, calendarId: "c", externalId: "e1", title: "Denver Half Marathon", start: now + 30 * 86_400_000, end: now + 30 * 86_400_000 + 3_600_000, allDay: false, recurring: false, class: "filmable", classifiedBy: "code", status: "active", updatedAt: now, createdAt: now } as never);
      await ctx.db.insert("calendarEvents", { creatorId: b, calendarId: "c", externalId: "e2", title: "b's dentist", start: now + 3 * 86_400_000, end: now + 3 * 86_400_000 + 3_600_000, allDay: false, recurring: false, class: "filmable", classifiedBy: "code", status: "active", updatedAt: now, createdAt: now } as never);
    });
    const fetcher = vi.fn(async (_u: unknown, _init?: unknown) => reply([{ hook: "packing a whole kitchen into boxes", why: "the move" }]));
    vi.stubGlobal("fetch", fetcher);
    await t.action(internal.scout.stock.topUp, { creatorId: a, now });
    const body = JSON.parse(String((fetcher.mock.calls[0][1] as { body: string }).body)) as { messages: Array<{ role: string; content: string }> };
    const brief = body.messages.find((m) => m.role === "user")!.content;
    expect(brief).toContain("moving to Denver in five weeks");
    expect(brief).toContain("Denver Half Marathon");
    expect(brief).not.toContain("an old trip");
    expect(brief).not.toContain("b's");
    expect(brief.indexOf("Their life right now")).toBeLessThan(brief.indexOf("Holidays coming up"));
  });
});

describe("the stock has its own daily job (2026-11-12: it only ran inside the plan, which stops for non-planners)", () => {
  it("schedules one top-up per paired creator with a dossier, nobody else", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => seedCreator(ctx, "a", { channel: { paired: true }, dossier: { keywords: ["x"] } }));
    await t.run((ctx) => seedCreator(ctx, "b", { clerkUserId: "u_b", handles: { tiktok: "tt_b" }, channel: { paired: false }, dossier: { keywords: ["x"] } }));
    const r = await t.action(internal.scout.stock.runAll, {});
    expect(r.creators).toBe(1);
    const jobs = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(jobs.filter((j) => j.name.includes("stock")).map((j) => String((j.args[0] as { creatorId: string }).creatorId))).toEqual([a]);
  });
});
