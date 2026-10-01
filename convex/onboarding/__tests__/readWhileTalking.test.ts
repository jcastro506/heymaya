/**
 * Texting her while she reads (staging, 2026-10-01): her replies know the read is still running and
 * don't judge their posts from the half she's seen; the read never lands over one of her replies;
 * and no text of hers carries an em dash.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { plainDashes } from "../../core/messages";

describe("is her read still running", () => {
  it("until her first-read text exists, with live counts; never another creator's", async () => {
    const t = convexTest(schema, modules);
    const c = await t.run((ctx) => seedCreator(ctx, "rr1"));
    const other = await t.run((ctx) => seedCreator(ctx, "rr2"));
    await t.run(async (ctx) => {
      for (let i = 0; i < 3; i++) await ctx.db.insert("ownPosts", { creatorId: c, platform: "tiktok", postId: `p${i}`, url: `https://t/${i}`, createTime: Date.now() - i, contentType: "video", caption: `post ${i}`, hashtags: [], metrics: { views: 1, likes: 0, comments: 0, shares: 0 }, metricsAsOf: Date.now(), source: "scrape", sample: ["top"] } as never);
    });
    expect(await t.query(internal.onboarding.start.readStillRunning, { creatorId: c })).toEqual({ posts: 3, watched: 0, toWatch: 3 });
    expect(await t.query(internal.onboarding.start.readStillRunning, { creatorId: other })).toEqual({ posts: 0, watched: 0, toWatch: 0 });
    await t.run((ctx) => ctx.db.insert("messages", { creatorId: c, direction: "out", surface: "imessage", body: "the read", ts: Date.now(), dedupeKey: `first_read:${c}`, kind: "first_read" }));
    expect(await t.query(internal.onboarding.start.readStillRunning, { creatorId: c })).toBeNull();
    expect(await t.query(internal.onboarding.start.readStillRunning, { creatorId: other }), "their read is theirs").not.toBeNull();
  });

  it("her reply is told, and told not to judge their posts yet", () => {
    const src = readFileSync(new URL("../../agent/converse.ts", import.meta.url), "utf8");
    expect(src).toMatch(/internal\.onboarding\.start\.readStillRunning/);
    expect(src).toMatch(/do not summarize, rank or judge their posts/);
    expect(src).toMatch(/deleteRule \+ readingRule/);
  });
});

describe("the read waits its turn", () => {
  it("a reply queued or being written counts as in flight; a finished one, or another creator's, doesn't", async () => {
    const t = convexTest(schema, modules);
    const c = await t.run((ctx) => seedCreator(ctx, "tf1"));
    const other = await t.run((ctx) => seedCreator(ctx, "tf2"));
    const job = (creatorId: typeof c, status: string, key: string) => t.run((ctx) => ctx.db.insert("jobs", { kind: "converse", idempotencyKey: key, creatorId, status, attempts: 0, maxAttempts: 3, runAfter: Date.now(), createdAt: Date.now(), updatedAt: Date.now(), deadlineAt: Date.now() + 60_000 } as never));
    expect(await t.query(internal.core.jobs.turnInFlight, { creatorId: c })).toBe(false);
    await job(c, "succeeded", "done");
    await job(other, "running", "theirs");
    expect(await t.query(internal.core.jobs.turnInFlight, { creatorId: c })).toBe(false);
    await job(c, "queued", "mine");
    expect(await t.query(internal.core.jobs.turnInFlight, { creatorId: c })).toBe(true);
  });

  it("the job defers while a reply is in flight, and the read re-checks before it sends", () => {
    const sched = readFileSync(new URL("../../core/scheduler.ts", import.meta.url), "utf8");
    expect(sched).toMatch(/turnInFlight[\s\S]{0,200}defer: 5_000/);
    const read = readFileSync(new URL("../firstRead.ts", import.meta.url), "utf8");
    expect(read).toMatch(/READ_WAIT\.polls[\s\S]{0,200}turnInFlight/);
    expect(read).toMatch(/internal\.onboarding\.firstRead\.since/);
  });
});

describe("no em dashes", () => {
  it("become commas; a range's en dash stays", () => {
    expect(plainDashes("the street pans—like piccadilly—easily beat it")).toBe("the street pans, like piccadilly, easily beat it");
    expect(plainDashes("focus first — posting more")).toBe("focus first, posting more");
    expect(plainDashes("ends with —")).toBe("ends with");
    expect(plainDashes("2–3 posts a week")).toBe("2–3 posts a week");
  });
  it("on every outbound row, through the one writer", async () => {
    const t = convexTest(schema, modules);
    const c = await t.run((ctx) => seedCreator(ctx, "dash"));
    await t.mutation(internal.core.messages.send, { creatorId: c, surface: "telegram", body: "your pans—easily your best", dedupeKey: "dash1", proactive: false, kind: "reply" });
    const row = (await t.run((ctx) => ctx.db.query("messages").collect())).find((m) => m.dedupeKey === "dash1");
    expect(row?.body).toBe("your pans, easily your best");
  });
});

describe("no second 'reading your posts' after the hello", () => {
  it("when the read starts before their posts are in, the hello already said it; without a hello it's said once", async () => {
    const t = convexTest(schema, modules);
    const withHello = await t.run((ctx) => seedCreator(ctx, "nh1", { dossier: undefined }));
    const without = await t.run((ctx) => seedCreator(ctx, "nh2", { dossier: undefined }));
    await t.run((ctx) => ctx.db.insert("messages", { creatorId: withHello, direction: "out", surface: "imessage", body: "hey, it's maya", ts: Date.now(), dedupeKey: `hello:${withHello}`, kind: "status" }));
    await t.action(internal.onboarding.firstRead.run, { creatorId: withHello });
    await t.action(internal.onboarding.firstRead.run, { creatorId: without });
    const pending = (await t.run((ctx) => ctx.db.query("messages").collect())).filter((m) => m.dedupeKey?.startsWith("first_read_pending:"));
    expect(pending.map((m) => m.creatorId)).toEqual([without]);
  });
});
