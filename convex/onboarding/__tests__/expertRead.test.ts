/**
 * Reading a creator like an expert (2026-11-04): the whole history with saves and shares, holidays as moments,
 * a correction that changes everything downstream, and a day one that waits for their answer.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { momentFor, nextOf } from "../moments";
import { EXPERT_READ, evidenceOf } from "../evidence";
import { standout } from "../standout";
import { nextMorning, openingUnanswered } from "../hold";
import { conflictingIds } from "../redirect";
import { coerceDossier } from "../ingest";
import { FIRST_IDEAS_SKILL } from "../../calendar/firstIdeas";
import type { Id } from "../../_generated/dataModel";

const at = (s: string) => Date.parse(`${s}T18:00:00Z`);
const clip = (s: string, n: number) => s.slice(0, n);

describe("moments", () => {
  it("a post on or just before a holiday sits on it; a week earlier doesn't; it knows when it comes round next", () => {
    expect(momentFor(at("2026-10-31"))?.name).toBe("Halloween");
    expect(momentFor(at("2026-10-25"))?.name).toBe("Halloween");
    expect(momentFor(at("2026-11-02"))?.name).toBe("Halloween");
    expect(momentFor(at("2026-10-10"))).toBeNull();
    expect(momentFor(at("2026-11-26"))?.name).toBe("Thanksgiving");
    expect(momentFor(at("2026-12-29"))?.name).toBe("New Year's Eve");
    expect(nextOf("Halloween", at("2026-11-04"))).toBe("2027-10-31");
  });
});

describe("the evidence she reads from", () => {
  const row = (when: string, views: number, extra: { saves?: number; shares?: number; comments?: number; caption?: string; multiple?: number } = {}) => ({
    postId: when, platform: "tiktok" as const, createTime: at(when), contentType: "video" as const, durationSec: 10, caption: extra.caption ?? "", transcript: undefined, sample: undefined, connected: undefined,
    metrics: { views, likes: 10, comments: extra.comments ?? 5, shares: extra.shares ?? 1, saves: extra.saves }, multiple: extra.multiple,
  });
  it("saves and shares per 1K views next to their usual, the whole span, holidays marked", () => {
    const { posts, usual } = evidenceOf([row("2026-09-03", 10_000, { saves: 127, shares: 43 }), row("2026-09-10", 900, { saves: 1 }), row("2026-10-31", 22_500, { saves: 9 }), row("2026-08-08", 1_300, { saves: 1 })] as never, at("2026-11-04"), clip);
    expect(posts.map((p) => p.when)).toEqual(["2026-10-31", "2026-09-10", "2026-09-03", "2026-08-08"]);
    const cafe = posts.find((p) => p.when === "2026-09-03")!;
    expect(cafe.savesPer1k).toBe(12.7);
    expect(cafe.sharesPer1k).toBe(4.3);
    expect(posts[0].moment).toBe("Halloween 2026 (next: 2027-10-31)");
    expect(usual).toMatchObject({ posts: 4, from: "2026-08-08", to: "2026-10-31" });
    expect(usual.medianViews).toBe(10_000);
  });
  it("the lens: saves over views, format apart from topic, the whole history, holidays as one-offs", () => {
    for (const k of [/Saves and shares say more than views/, /Separate the FORMAT from the TOPIC/, /Never reduce a person to the topic of their best format/, /not the last few weeks/, /holiday/, /Consistency beats a peak/]) expect(EXPERT_READ).toMatch(k);
  });
  it("her opening's standout says when a spike was a holiday", () => {
    const s = standout([{ caption: "this took days of bedazzling", views: 22_500, comments: 19, multiple: 24, moment: "Halloween" }, { caption: "a", views: 900, comments: 3, multiple: 1 }, { caption: "b", views: 950, comments: 3, multiple: 1 }])!;
    expect(s.line).toMatch(/Halloween post, a moment to plan for next time rather than a direction/);
  });
});

describe("day one waits for their answer", () => {
  const H = 3_600_000;
  const NOW = at("2026-11-04");
  it("unanswered until they reply or tap; a reaction or START isn't an answer", () => {
    const opening = { direction: "out" as const, kind: "first_read", ts: NOW - H, deliveredAt: NOW - H };
    expect(openingUnanswered([opening], NOW)).toBe(true);
    expect(openingUnanswered([opening, { direction: "in" as const, kind: "reaction", ts: NOW - 30 * 60_000, deliveredAt: undefined }], NOW)).toBe(true);
    expect(openingUnanswered([opening, { direction: "in" as const, kind: "inbound", ts: NOW - 30 * 60_000, deliveredAt: undefined }], NOW)).toBe(false);
    expect(openingUnanswered([opening, { direction: "in" as const, kind: "button", ts: NOW - 30 * 60_000, deliveredAt: undefined }], NOW)).toBe(false);
    expect(openingUnanswered([], NOW), "no opening yet: nothing to wait for").toBe(false);
  });
  it("the next morning is half past nine on their clock", () => {
    const t = nextMorning(Date.parse("2026-11-04T03:43:00Z"), "America/New_York"); // 10:43 pm in New York
    expect(new Date(t).toISOString()).toBe("2026-11-04T14:30:00.000Z");
  });
  it("on the rows: waits while unanswered; goes once they've written", async () => {
    const t = convexTest(schema, modules);
    const c = await t.run((ctx) => seedCreator(ctx, "h1", { timezone: "UTC", channel: { paired: true, pairedAt: Date.now() - H, kind: "imessage" } }));
    await t.run((ctx) => ctx.db.insert("messages", { creatorId: c, direction: "out", surface: "imessage", body: "hey", ts: Date.now() - 50 * 60_000, kind: "first_read", deliveredAt: Date.now() - 50 * 60_000 }));
    expect((await t.query(internal.onboarding.hold.openingWaits, { creatorId: c, now: Date.now() })).wait).toBe(true);
    await t.run((ctx) => ctx.db.insert("messages", { creatorId: c, direction: "in", surface: "imessage", body: "i don't want to be a food creator", ts: Date.now() - 40 * 60_000, kind: "inbound" }));
    expect((await t.query(internal.onboarding.hold.openingWaits, { creatorId: c, now: Date.now() })).wait).toBe(false);
  });
});

describe("a correction changes what's downstream", () => {
  it("only ids that were really candidates are passed, whatever the model wrote", () => {
    const a = "j57aaaaaaaaaaaaaaaaaaaaa", b = "j57bbbbbbbbbbbbbbbbbbbbb";
    expect(conflictingIds(`${a}, j57zzzzzzzzzzzzzzzzzzzzz`, [a, b])).toEqual([a]);
    expect(conflictingIds("none", [a, b])).toEqual([]);
  });
  it("passes their conflicting ideas and the slots she only proposed; a booked session and another creator's idea are untouched", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const c = await t.run((ctx) => seedCreator(ctx, "r1"));
    const other = await t.run((ctx) => seedCreator(ctx, "r2"));
    const idea = (creatorId: Id<"creators">, hook: string) => t.run((ctx) => ctx.db.insert("ideas", { creatorId, evidenceLinks: [], fit: "yes", fitWhy: "x", version: { hook }, messageText: hook, produced: { skillVersion: "t", model: "m", thresholdsVersion: "t" }, status: "sent", createdAt: now } as never));
    const food = await idea(c, "breakfast sandwich test");
    const theirs = await idea(other, "dinner spot");
    const block = (creatorId: Id<"creators">, ideaId: Id<"ideas">, consentAt?: number) => t.run((ctx) => ctx.db.insert("calendarBlocks", { creatorId, kind: "film", start: now + 86_400_000, end: now + 90_000_000, title: "film", ideaId, status: consentAt ? "confirmed" : "proposed", consentAt, createdAt: now } as never));
    const proposed = await block(c, food);
    const booked = await block(c, food, now);
    const r = await t.mutation(internal.onboarding.redirect.pass, { creatorId: c, ideaIds: [food, theirs], now });
    expect(r).toEqual({ ideas: 1, blocks: 1 });
    expect((await t.run((ctx) => ctx.db.get(food)))!.status).toBe("passed");
    expect((await t.run((ctx) => ctx.db.get(theirs)))!.status).toBe("sent");
    expect((await t.run((ctx) => ctx.db.get(proposed)))!.status).toBe("deleted");
    expect((await t.run((ctx) => ctx.db.get(booked)))!.status).toBe("confirmed");
  });
  it("once in 12 hours", async () => {
    const t = convexTest(schema, modules);
    const c = await t.run((ctx) => seedCreator(ctx, "r3"));
    const now = Date.now();
    expect((await t.query(internal.onboarding.redirect.inputs, { creatorId: c, now }))!.recent).toBe(false);
    await t.mutation(internal.onboarding.redirect.mark, { creatorId: c, now });
    expect((await t.query(internal.onboarding.redirect.inputs, { creatorId: c, now: now + 3_600_000 }))!.recent).toBe(true);
    expect((await t.query(internal.onboarding.redirect.inputs, { creatorId: c, now: now + 13 * 3_600_000 }))!.recent).toBe(false);
  });
});

describe("the history comes in", () => {
  it("a reconnect of an account that never had its history pulled pulls it, once", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "b1", { channel: { paired: true } }));
    await t.mutation(internal.connections.zernio.ensureProfileRow, { creatorId, zernioProfileId: "p1" });
    const acct = (needsReconnect: boolean) => ({ accountId: "a1", platform: "tiktok", username: "x", needsReconnect, canFetchAnalytics: true });
    // First connect flagged (no backfill), then the same account healthy, as the tester's went.
    expect((await t.mutation(internal.connections.zernio.applyAccounts, { creatorId, accounts: [acct(true)] })).backfill).toBe(false);
    await t.run(async (ctx) => { const conn = (await ctx.db.query("connections").collect())[0]; await ctx.db.patch(conn._id, { zernioAccounts: [{ accountId: "a1", platform: "tiktok", canFetchAnalytics: true, needsReconnect: false, username: "x" }] }); });
    expect((await t.mutation(internal.connections.zernio.applyAccounts, { creatorId, accounts: [acct(false)] })).backfill, "never pulled").toBe(true);
    expect((await t.mutation(internal.connections.zernio.applyAccounts, { creatorId, accounts: [acct(false)] })).backfill, "once").toBe(false);
  });
});


describe("small things the live run caught", () => {
  it("a format's multiple written as text is read as a number; nonsense is unknown, never a thrown-away read", () => {
    const out = coerceDossier({ formatsUsed: [{ label: "rating", medianMultiple: "2.5×" }, { label: "ootd", medianMultiple: "n/a" }, { label: "x", medianMultiple: 1.2 }] }) as { formatsUsed: Array<{ medianMultiple: number | null }> };
    expect(out.formatsUsed.map((f) => f.medianMultiple)).toEqual([2.5, null, 1.2]);
  });
  it("first ideas: what they said beats what worked; the format stays, the topic they ruled out goes", () => {
    expect(FIRST_IDEAS_SKILL).toMatch(/What they told you beats what worked/);
    expect(FIRST_IDEAS_SKILL).toMatch(/Keep the FORMAT that works/);
  });
});
