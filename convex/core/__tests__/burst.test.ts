/**
 * One burst, one reply (2026-11-02). Adina's Halloween burst: two videos, "oh sorry i sent the wrong videos",
 * two more, "this is for halloween", "or should i use housewife?", "which audio track", then "stop trxtimg for
 * a minute pls". She got ten replies, a review of the wrong videos, and three more after "stop".
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { burstOf, burstTranscript, hushed, HUSH_MS, MAX_HOLD_MS, mightBeHush, SETTLE_MS, superseded, turnDecision } from "../burst";

type T = ReturnType<typeof convexTest>;
const id = (s: string) => s as Id<"messages">;
const row = (s: string, direction: "in" | "out", ts: number, kind = direction === "in" ? "inbound" : "reply") => ({ _id: id(s), direction, kind, ts });

beforeEach(() => { process.env.BURST_SETTLE_SCALE = "1"; });
afterEach(() => { process.env.BURST_SETTLE_SCALE = "0"; });

describe("what a burst is", () => {
  it("everything they sent since her last text, taps and reactions left out", () => {
    const rows = [row("o1", "out", 1), row("i1", "in", 2, "file"), row("r", "in", 3, "reaction"), row("i2", "in", 4), row("i3", "in", 5)];
    expect(burstOf(rows, id("i3")).map((m) => m._id)).toEqual(["i1", "i2", "i3"]);
    expect(burstOf(rows, id("i1")).map((m) => m._id)).toEqual(["i1"]);
  });
  it("a reply she withdrew is not a boundary", () => {
    const rows = [row("o1", "out", 1), row("i1", "in", 2), { ...row("o2", "out", 3), withdrawnAt: 4 }, row("i2", "in", 5)];
    expect(burstOf(rows, id("i2")).map((m) => m._id)).toEqual(["i1", "i2"]);
  });
  it("the transcript numbers the videos in the order they came", () => {
    const v = { kind: "file", fileMime: "video/mp4", hasFile: true, body: "" };
    expect(burstTranscript([v, v, { kind: "inbound", fileMime: null, hasFile: false, body: "oh sorry wrong videos" }, v, { ...v, body: "between these 2" }]))
      .toBe("[video 1]\n[video 2]\noh sorry wrong videos\n[video 3]\n[video 4] between these 2");
  });
});

describe("run, wait, or leave it to the newer turn", () => {
  const now = 1_000_000;
  it("waits a few seconds after their last text, longer for a video", () => {
    expect(turnDecision({ target: row("a", "in", now - 2_000), newer: [], burstStartTs: now - 2_000, now, command: false })).toEqual({ act: "wait", ms: SETTLE_MS.text - 2_000 });
    expect(turnDecision({ target: row("a", "in", now - 2_000, "file"), newer: [], burstStartTs: now - 2_000, now, command: false })).toEqual({ act: "wait", ms: SETTLE_MS.file - 2_000 });
    expect(turnDecision({ target: row("a", "in", now - SETTLE_MS.text), newer: [], burstStartTs: now - 9_000, now, command: false })).toEqual({ act: "run" });
  });
  it("a vendor clock ahead of ours never makes her wait longer than one settle", () => {
    expect(turnDecision({ target: row("a", "in", now + 60_000), newer: [], burstStartTs: now, now, command: false })).toEqual({ act: "wait", ms: SETTLE_MS.text });
  });
  it("a newer text means the newer turn answers it all", () => {
    expect(turnDecision({ target: row("a", "in", now - 30_000), newer: [row("b", "in", now - 1_000)], burstStartTs: now - 30_000, now, command: false }).act).toBe("skip");
  });
  it("a reaction or a tap behind it doesn't count as newer", () => {
    expect(turnDecision({ target: row("a", "in", now - 30_000), newer: [row("b", "in", now - 1_000, "reaction"), row("c", "in", now, "button")], burstStartTs: now - 30_000, now, command: false })).toEqual({ act: "run" });
  });
  it("a command always runs, and a burst past the hold gets answered even while they type", () => {
    expect(turnDecision({ target: row("a", "in", now - 1_000), newer: [row("b", "in", now)], burstStartTs: now - 1_000, now, command: true })).toEqual({ act: "run" });
    expect(turnDecision({ target: row("a", "in", now - 20_000), newer: [row("b", "in", now)], burstStartTs: now - MAX_HOLD_MS - 1, now, command: false })).toEqual({ act: "run" });
  });
  it("a tap is never held or skipped", () => {
    expect(turnDecision({ target: row("a", "in", now, "button"), newer: [row("b", "in", now)], burstStartTs: now, now, command: false })).toEqual({ act: "run" });
  });
  it("a reply in the works is stale once they write again", () => {
    expect(superseded({ answering: row("a", "in", now - 40_000), newer: [row("b", "in", now - 5_000)], burstStartTs: now - 40_000, now })).toBe(true);
    expect(superseded({ answering: row("a", "in", now - 40_000), newer: [], burstStartTs: now - 40_000, now })).toBe(false);
  });
});

describe("hold on", () => {
  it("only a short text while she's busy is worth asking about", () => {
    expect(mightBeHush("stop trxtimg for a minute pls", true)).toBe(true);
    expect(mightBeHush("stop trxtimg for a minute pls", false)).toBe(false);
    expect(mightBeHush("https://www.tiktok.com/@x/video/1", true)).toBe(false);
  });
  it("lasts until they write again, and never past the window", () => {
    expect(hushed({ hushedAt: 100 }, null, 200)).toBe(true);
    expect(hushed({ hushedAt: 100 }, 150, 200)).toBe(false);
    expect(hushed({ hushedAt: 100 }, null, 100 + HUSH_MS)).toBe(false);
    expect(hushed({}, null, 200)).toBe(false);
  });
});

async function inbound(t: T, creatorId: Id<"creators">, body: string, ts: number, kind = "inbound") {
  return await t.run((ctx) => ctx.db.insert("messages", { creatorId, direction: "in", surface: "imessage", body, kind, ts }));
}

describe("on the rows (fail-closed)", () => {
  it("a reply is held when they wrote again while it was being written; a fresh one goes", async () => {
    const t = convexTest(schema, modules);
    const c = await t.run((ctx) => seedCreator(ctx, "a"));
    const now = Date.now();
    const first = await inbound(t, c, "which sound should i use", now - 30_000);
    await inbound(t, c, "this is for halloween", now - 2_000);
    const stale = await t.mutation(internal.core.messages.send, { creatorId: c, surface: "telegram", body: "Thriller.", dedupeKey: `reply:${first}`, proactive: false, kind: "reply", answering: first });
    expect(stale).toMatchObject({ sent: false, held: "superseded by their newer message" });
    const latest = await inbound(t, c, "which audio track", now - 1_000);
    const ok = await t.mutation(internal.core.messages.send, { creatorId: c, surface: "telegram", body: "Housewife.", dedupeKey: `reply:${latest}`, proactive: false, kind: "reply", answering: latest });
    expect(ok.sent).toBe(true);
  });

  it("the older turns of a burst skip; the newest runs (after it settles)", async () => {
    const t = convexTest(schema, modules);
    const c = await t.run((ctx) => seedCreator(ctx, "a"));
    const now = Date.now();
    const a = await inbound(t, c, "[video]", now - 20_000, "file");
    const b = await inbound(t, c, "which sound", now - 3_000);
    expect(await t.query(internal.core.burst.decide, { messageId: a, now })).toMatchObject({ act: "skip" });
    expect(await t.query(internal.core.burst.decide, { messageId: b, now })).toMatchObject({ act: "wait" });
    expect(await t.query(internal.core.burst.decide, { messageId: b, now: now + SETTLE_MS.text })).toEqual({ act: "run" });
    const burst = await t.query(internal.core.burst.burstFor, { messageId: b });
    expect(burst.map((m) => m.id)).toEqual([a, b]);
  });

  it("hold on: her undelivered texts are withdrawn, never delivered, out of her context; her first texts wait until they write", async () => {
    const t = convexTest(schema, modules);
    const c = await t.run((ctx) => seedCreator(ctx, "a"));
    const now = Date.now();
    const q = await inbound(t, c, "which sound", now - 60_000);
    const sent = await t.mutation(internal.core.messages.send, { creatorId: c, surface: "telegram", body: "Go with Housewife.", dedupeKey: "reply:x", proactive: false, kind: "reply", answering: q });
    const hush = await inbound(t, c, "stop texting for a minute", now);
    const w = await t.mutation(internal.core.burst.hush, { creatorId: c, messageId: hush, now });
    expect(w.withdrawn).toBe(1);
    const target = await t.query(internal.core.telegram.deliveryTarget, { messageId: sent.messageId! });
    expect(target?.alreadyDelivered, "a withdrawn row counts as done and is never sent").toBe(true);
    expect(await t.query(internal.core.burst.isWithdrawn, { messageId: sent.messageId! })).toBe(true);
    const g = await t.query(internal.agent.context.gather, { creatorId: c });
    expect(g?.recent.some((m) => m._id === sent.messageId), "not in her context").toBe(false);
    const idea = await t.mutation(internal.core.messages.send, { creatorId: c, surface: "telegram", body: "an idea", dedupeKey: "idea:1", proactive: true, kind: "scout", ts: now + 60_000 });
    expect(idea).toMatchObject({ sent: false, held: "they said hold on" });
    await inbound(t, c, "ok i'm back", now + 120_000);
    const after = await t.mutation(internal.core.messages.send, { creatorId: c, surface: "telegram", body: "an idea", dedupeKey: "idea:2", proactive: true, kind: "scout", ts: now + 180_000 });
    expect(after.held).not.toBe("they said hold on");
    expect(await t.query(internal.core.burst.isHushMessage, { creatorId: c, messageId: hush })).toBe(true);
  });

  it("cross-tenant: another creator's newer text never holds this one's reply", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => seedCreator(ctx, "a"));
    const b = await t.run((ctx) => seedCreator(ctx, "b"));
    const now = Date.now();
    const q = await inbound(t, a, "which sound", now - 30_000);
    await inbound(t, b, "hello", now - 1_000);
    const r = await t.mutation(internal.core.messages.send, { creatorId: a, surface: "telegram", body: "Housewife.", dedupeKey: "reply:a", proactive: false, kind: "reply", answering: q });
    expect(r.sent).toBe(true);
    const rows = (await t.run((ctx) => ctx.db.query("messages").collect())) as Doc<"messages">[];
    expect(rows.filter((m) => m.direction === "out" && m.creatorId === a)).toHaveLength(1);
  });
});
