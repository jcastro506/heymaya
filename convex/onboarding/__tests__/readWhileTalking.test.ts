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
    // Nothing under way (an account read long ago with no first-read text on record): not "still reading".
    expect(await t.query(internal.onboarding.start.readStillRunning, { creatorId: c })).toBeNull();
    const reading = (id: typeof c) => t.run((ctx) => ctx.db.insert("jobs", { kind: "ingest_catalogue", idempotencyKey: `ingest:${id}`, creatorId: id, status: "running", attempts: 0, maxAttempts: 3, runAfter: Date.now(), createdAt: Date.now(), updatedAt: Date.now(), deadlineAt: Date.now() + 60_000 } as never));
    await reading(c);
    await reading(other);
    expect(await t.query(internal.onboarding.start.readStillRunning, { creatorId: c })).toEqual({ posts: 3, watched: 0, toWatch: 3 });
    expect(await t.query(internal.onboarding.start.readStillRunning, { creatorId: other })).toEqual({ posts: 0, watched: 0, toWatch: 0 });
    await t.run((ctx) => ctx.db.insert("messages", { creatorId: c, direction: "out", surface: "imessage", body: "the read", ts: Date.now(), dedupeKey: `first_read:${c}`, kind: "first_read" }));
    expect(await t.query(internal.onboarding.start.readStillRunning, { creatorId: c })).toBeNull();
    expect(await t.query(internal.onboarding.start.readStillRunning, { creatorId: other }), "their read is theirs").not.toBeNull();
  });

  it("every reply path is told (the shared context), the read itself and proactive texts are not", async () => {
    const t = convexTest(schema, modules);
    const c = await t.run((ctx) => seedCreator(ctx, "ctx1"));
    await t.run((ctx) => ctx.db.insert("jobs", { kind: "first_read", idempotencyKey: `first_read:${c}`, creatorId: c, status: "queued", attempts: 0, maxAttempts: 3, runAfter: Date.now(), createdAt: Date.now(), updatedAt: Date.now(), deadlineAt: Date.now() + 60_000 } as never));
    const msg = await t.run((ctx) => ctx.db.insert("messages", { creatorId: c, direction: "in", surface: "imessage", body: "is the london stuff working?", ts: Date.now() }));
    const reply = await t.query(internal.agent.context.gather, { creatorId: c, messageId: msg });
    expect(reply?.history).toMatch(/still going through their posts/);
    expect(reply?.history).toMatch(/do not summarize, rank or judge their posts/);
    const proactive = await t.query(internal.agent.context.gather, { creatorId: c });
    expect(proactive?.history ?? "").not.toMatch(/still going through their posts/);
    await t.run((ctx) => ctx.db.insert("messages", { creatorId: c, direction: "out", surface: "imessage", body: "the read", ts: Date.now(), dedupeKey: `first_read:${c}`, kind: "first_read" }));
    const after = await t.query(internal.agent.context.gather, { creatorId: c, messageId: msg });
    expect(after?.history ?? "").not.toMatch(/still going through their posts/);
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

describe("day one and quiet hours, at send", () => {
  const H = 3_600_000;
  const DAY = Date.UTC(2026, 9, 1, 14, 0);
  it("day one: nothing waits on the silence ladder, and day one's texts never count toward it after", async () => {
    const { phoneRailHold, PHONE_RAIL } = await import("../../core/phoneRail");
    const base = { kind: "idea", health: "HEALTHY", lineState: null, optedOutAt: undefined, proactiveToday: 1 };
    const pairedAt = DAY;
    // The read went out unanswered: inside day one the plan still goes.
    expect(phoneRailHold({ ...base, now: DAY + 20 * 60_000, pairedAt, lastInboundAt: DAY, unanswered: [{ ts: DAY + 4 * 60_000, kind: "first_read" }] })).toBeNull();
    // Day two: the read and the plan don't count, so the next idea isn't held for "two unanswered".
    expect(phoneRailHold({ ...base, now: pairedAt + PHONE_RAIL.dayOneMs + H, pairedAt, lastInboundAt: DAY, unanswered: [{ ts: DAY + 4 * 60_000, kind: "first_read" }, { ts: DAY + 20 * 60_000, kind: "plan" }] })).toBeNull();
    // A day-two text that goes unanswered still starts the ladder.
    expect(phoneRailHold({ ...base, now: pairedAt + PHONE_RAIL.dayOneMs + 3 * H, pairedAt, lastInboundAt: DAY, unanswered: [{ ts: pairedAt + PHONE_RAIL.dayOneMs + H, kind: "idea" }] })).toMatch(/waits about a day/);
    // Without a pairing time the ladder works as before.
    expect(phoneRailHold({ ...base, now: DAY + 20 * 60_000, pairedAt: null, lastInboundAt: DAY, unanswered: [{ ts: DAY + 4 * 60_000, kind: "first_read" }] })).toMatch(/waits about a day/);
  });

  it("a proactive text in quiet hours is held, unless they're texting right now; a reply always goes", async () => {
    const t = convexTest(schema, modules);
    const night = Date.UTC(2026, 9, 1, 23, 30); // their quiet hours are 22:00–07:00 UTC
    const c = await t.run((ctx) => seedCreator(ctx, "qh1", { timezone: "UTC", channel: { paired: true, pairedAt: night - 48 * H, kind: "telegram", chatId: "1" } }));
    const send = (key: string, proactive: boolean, ts: number) => t.mutation(internal.core.messages.send, { creatorId: c, surface: "telegram", body: "x", dedupeKey: key, proactive, kind: proactive ? "plan" : "reply", ts });
    expect(await send("p1", true, night)).toMatchObject({ sent: false, held: "quiet hours" });
    expect((await send("r1", false, night)).sent).toBe(true);
    await t.run((ctx) => ctx.db.insert("messages", { creatorId: c, direction: "in", surface: "telegram", body: "still up", ts: night - 10 * 60_000 }));
    expect((await send("p2", true, night)).sent, "they wrote 10 minutes ago").toBe(true);
    expect((await send("p3", true, Date.UTC(2026, 9, 2, 9, 0))).sent, "morning").toBe(true);
  });
});

describe("the read asks nothing while her question waits", () => {
  it("tells her, from the row, that a question is still open", () => {
    const src = readFileSync(new URL("../firstRead.ts", import.meta.url), "utf8");
    expect(src).toMatch(/internal\.core\.messages\.openQuestion/);
    expect(src).toMatch(/they haven't answered yet: ask NOTHING in this text/);
    expect(src).toMatch(/content: `\$\{waitingLine\}/);
  });
});
