/**
 * The editor (core/editor, 2026-10-12): one pick a day, or none, chosen from what she noticed, at the hour
 * they reply; mid-conversation it rides along; it learns which kinds each person answers and backs off.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import type { Id } from "../../_generated/dataModel";
import { backingOff, carried, commentCandidates, EDITOR, holdToday, kindWeight, outcomes, parsePick, rank, type Noticed } from "../editor";

const H = 3_600_000, D = 24 * H;
const T0 = Date.UTC(2026, 9, 13, 12, 0); // Tuesday noon UTC

beforeEach(() => { vi.stubEnv("MODEL_FAKE", "1"); vi.stubEnv("OPENROUTER_API_KEY", "fake"); });
afterEach(() => { vi.unstubAllEnvs(); });

const cand = (over: Partial<Noticed>): Noticed => ({ id: "c1", kind: "idea", sourceKey: "s1", summary: "an idea", link: "https://t/1", base: 2, createdAt: T0 - H, expiresAt: T0 + 2 * D, status: "open", ...over });

describe("the editor (pure)", () => {
  it("outcomes: answered within a day is landed; only her own finds count", () => {
    const msgs = [
      { direction: "out", proactive: true, kind: "scout", ts: T0 - 3 * D },
      { direction: "in", proactive: false, kind: "inbound", ts: T0 - 3 * D + H },
      { direction: "out", proactive: true, kind: "comment", ts: T0 - 2 * D },
      { direction: "out", proactive: true, kind: "reminder", ts: T0 - D },
    ] as never;
    expect(outcomes(msgs, T0)).toEqual([{ kind: "scout", ts: T0 - 3 * D, landed: true }, { kind: "comment", ts: T0 - 2 * D, landed: false }]);
  });

  it("weights: kinds they answer go up, kinds they ignore go down, nothing known is neutral", () => {
    const h = [{ kind: "scout", ts: 1, landed: false }, { kind: "scout", ts: 2, landed: false }, { kind: "comment", ts: 3, landed: true }, { kind: "comment", ts: 4, landed: true }];
    expect(kindWeight(h, "comment")).toBeGreaterThan(1.2);
    expect(kindWeight(h, "scout")).toBeLessThan(0.8);
    expect(kindWeight([], "for_you")).toBe(1);
    expect(backingOff(h.slice(0, 2).concat([{ kind: "x", ts: 5, landed: false }]))).toBe(true);
    expect(backingOff(h)).toBe(false);
  });

  it("rank: fresh beats stale, the same kind twice running loses, decided and expired drop out", () => {
    const fresh = cand({ id: "fresh", createdAt: T0 });
    const stale = cand({ id: "stale", createdAt: T0 - 2 * D + H, expiresAt: T0 + H });
    expect(rank([stale, fresh], [], T0).map((s) => s.c.id)).toEqual(["fresh", "stale"]);
    const idea = cand({ id: "idea", base: 2.5 });
    const comment = cand({ id: "comment", kind: "comment", base: 2.5 });
    expect(rank([idea, comment], [{ kind: "scout", ts: T0 - D, landed: true }], T0)[0].c.id).toBe("comment");
    expect(rank([cand({ status: "sent" }), cand({ id: "old", expiresAt: T0 - 1 })], [], T0)).toHaveLength(0);
  });

  it("holds: nothing good enough, mid-conversation, and backing off after three ignored", () => {
    const top = { c: cand({}), score: 2 };
    expect(holdToday({ history: [], top: undefined, now: T0, lastInboundAt: null })).toMatch(/nothing worth/);
    expect(holdToday({ history: [], top: { ...top, score: EDITOR.bar - 0.1 }, now: T0, lastInboundAt: null })).toMatch(/nothing worth/);
    expect(holdToday({ history: [], top, now: T0, lastInboundAt: T0 - H })).toMatch(/mid-conversation/);
    expect(holdToday({ history: [], top, now: T0, lastInboundAt: T0 - 4 * H })).toBeNull();
    const ignored = [3, 2, 1].map((n) => ({ kind: "scout", ts: T0 - n * 2 * D, landed: false }));
    expect(holdToday({ history: ignored, top, now: T0, lastInboundAt: null })).toMatch(/backing off/);
    expect(holdToday({ history: ignored.map((h) => ({ ...h, ts: h.ts - 8 * D })), top, now: T0, lastInboundAt: null }), "one good one a week").toBeNull();
    expect(holdToday({ history: ignored, top: { ...top, score: EDITOR.strong }, now: T0, lastInboundAt: null })).toBeNull();
    expect(holdToday({ history: [...ignored, { kind: "scout", ts: T0 - D, landed: false }], top: { ...top, score: 4 }, now: T0, lastInboundAt: null })).toMatch(/two days running/);
  });

  it("comments: questions and liked ones on their posts, never their own, never without a post link, never old", () => {
    const base = { commentId: "1", text: "where are your rings from?", question: true, likeCount: 0, isOwner: false, postUrl: "https://t/p", createdAt: T0 - H };
    expect(commentCandidates([base], T0)).toHaveLength(1);
    expect(commentCandidates([{ ...base, question: false, likeCount: 9 }], T0)[0].base).toBe(2);
    expect(commentCandidates([{ ...base, isOwner: true }, { ...base, postUrl: undefined }, { ...base, createdAt: T0 - 2 * D }, { ...base, question: false, likeCount: 1 }], T0)).toHaveLength(0);
  });

  it("her answer is held to the shortlist; a made-up id is a quiet day", () => {
    expect(parsePick('{"pick":"a","why":"x","text":""}', ["a"]).pick).toBe("a");
    expect(parsePick('{"pick":"zzz","why":"x"}', ["a"]).pick).toBeNull();
    expect(parsePick("not json", ["a"]).pick).toBeNull();
    expect(carried("oh also\nhttps://t/1", "https://t/1")).toBe(true);
    expect(carried("oh also t/1", "https://t/1"), "the link without its scheme still counts").toBe(true);
    expect(carried("oh also, a cool post", "https://t/1")).toBe(false);
  });
});

async function seed(t: ReturnType<typeof convexTest>, key: string, extra: Record<string, unknown> = {}) {
  return await t.run((ctx) => seedCreator(ctx, key, { timezone: "UTC", channel: { paired: true, pairedAt: T0 - 30 * D }, dossier: { persona: { summary: "fashion" }, keywords: ["outfits"], cadence: { postsPerWeek: 3 } }, plan: { status: "active", founding: true }, ...extra }));
}
const noticeIdea = (t: ReturnType<typeof convexTest>, creatorId: Id<"creators">, n: string, now: number, base = 2) =>
  t.mutation(internal.core.editor.notice, { creatorId, now, c: { id: `idea:${n}`, kind: "idea", sourceKey: `scout:${n}`, base, ttlMs: 2 * D, summary: `an idea ${n}`, link: `https://t/${n}`, draft: { body: `idea ${n}\n\nhttps://t/${n}`, links: [`https://t/${n}`] } } });
const comment = (t: ReturnType<typeof convexTest>, creatorId: Id<"creators">, n: string, at: number) =>
  t.run((ctx) => ctx.db.insert("postComments", { creatorId, platform: "instagram", accountId: "acc", platformPostId: "p1", postUrl: "https://ig/p1", commentId: n, text: "where are your rings from??", authorKey: "k", isOwner: false, question: true, createdAt: at, fetchedAt: at, source: "sync" } as never));

describe("the editor on rows", () => {
  it("picks the best of the day once, sends it as her one text, and writes the decision down", async () => {
    const t = convexTest(schema, modules);
    const a = await seed(t, "a");
    await noticeIdea(t, a, "1", T0 - 2 * H);
    await noticeIdea(t, a, "2", T0 - H, 3);
    const r = await t.action(internal.core.editor.pick, { creatorId: a, now: T0 });
    expect(r).toMatchObject({ sent: true, picked: "idea:2" });
    const out = (await t.run((ctx) => ctx.db.query("messages").collect())).filter((m) => m.direction === "out");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "scout", proactive: true });
    const c = (await t.run((ctx) => ctx.db.get(a)))!;
    expect(c.noticed!.find((n) => n.id === "idea:2")?.status).toBe("sent");
    expect(c.pickedDay).toBe("2026-10-13");
    expect((await t.action(internal.core.editor.pick, { creatorId: a, now: T0 + H })).reason).toBe("today is decided");
  });

  it("a comment on their post is written by her, checked, with the post link", async () => {
    const t = convexTest(schema, modules);
    const a = await seed(t, "a");
    await comment(t, a, "c1", T0 - 2 * H);
    const r = await t.action(internal.core.editor.pick, { creatorId: a, now: T0 });
    expect(r).toMatchObject({ sent: true, picked: "comment:c1" });
    const m = (await t.run((ctx) => ctx.db.query("messages").collect())).find((x) => x.kind === "comment")!;
    expect(m.body).toContain("https://ig/p1");
    expect(m.body).not.toMatch(/where are your rings from\?\?/); // their audience's words aren't pasted in whole
  });

  it("a quiet day when nothing clears the bar, and mid-conversation it waits without deciding", async () => {
    const t = convexTest(schema, modules);
    const q = await seed(t, "q");
    await noticeIdea(t, q, "weak", T0 - H, 1);
    expect((await t.action(internal.core.editor.pick, { creatorId: q, now: T0 })).reason).toMatch(/nothing worth/);
    expect((await t.run((ctx) => ctx.db.get(q)))!.pickedDay).toBe("2026-10-13");
    const chat = await seed(t, "chat");
    await noticeIdea(t, chat, "1", T0 - 2 * H, 3);
    await t.run((ctx) => ctx.db.insert("messages", { creatorId: chat, direction: "in", surface: "imessage", kind: "inbound", body: "hey", ts: T0 - 30 * 60_000 } as never));
    expect((await t.action(internal.core.editor.pick, { creatorId: chat, now: T0 })).reason).toMatch(/mid-conversation/);
    expect((await t.run((ctx) => ctx.db.get(chat)))!.pickedDay, "not decided: a later hour or her reply can use it").toBeUndefined();
    expect((await t.action(internal.core.editor.pick, { creatorId: chat, now: T0 + 3 * H })).sent).toBe(true);
  });

  it("cross-tenant: one person's finds never reach another; the first three days stay quiet", async () => {
    const t = convexTest(schema, modules);
    const a = await seed(t, "a");
    const b = await seed(t, "b");
    await noticeIdea(t, a, "1", T0 - H, 3);
    expect((await t.action(internal.core.editor.pick, { creatorId: b, now: T0 })).reason).toMatch(/nothing worth/);
    const fresh = await seed(t, "fresh", { channel: { paired: true, pairedAt: T0 - D } });
    await noticeIdea(t, fresh, "1", T0 - H, 3);
    expect((await t.action(internal.core.editor.pick, { creatorId: fresh, now: T0 })).sent, "held by the first three days inside send").toBe(false);
    expect(await t.query(internal.core.editor.rideAlong, { creatorId: fresh, now: T0 })).toBeNull();
  });

  it("notice keeps one per source and at most twenty", async () => {
    const t = convexTest(schema, modules);
    const a = await seed(t, "a");
    expect((await noticeIdea(t, a, "1", T0)).added).toBe(true);
    expect((await noticeIdea(t, a, "1", T0)).added).toBe(false);
    for (let i = 2; i < 30; i++) await noticeIdea(t, a, String(i), T0 + i);
    expect((await t.run((ctx) => ctx.db.get(a)))!.noticed).toHaveLength(EDITOR.max);
  });

  it("the ride-along: mid-conversation, her reply carries it and the day is decided with no extra text", async () => {
    const t = convexTest(schema, modules);
    const a = await seed(t, "a");
    vi.useFakeTimers({ now: T0, toFake: ["Date"] });
    try {
      await noticeIdea(t, a, "1", T0 - H, 3);
      const ride = await t.query(internal.core.editor.rideAlong, { creatorId: a, now: T0 });
      expect(ride?.id).toBe("idea:1");
      await t.mutation(internal.core.editor.decide, { creatorId: a, day: ride!.day, id: ride!.id, status: "folded", candidate: ride!.candidate, now: T0 });
      expect(await t.query(internal.core.editor.rideAlong, { creatorId: a, now: T0 + H })).toBeNull();
      expect((await t.action(internal.core.editor.pick, { creatorId: a, now: T0 + 4 * H })).reason).toBe("today is decided");
      expect((await t.run((ctx) => ctx.db.get(a)))!.noticed!.find((n) => n.id === "idea:1")?.status).toBe("folded");
    } finally { vi.useRealTimers(); }
  });
});

/**
 * A month for three people, on rows and the fake model. Each day she notices an idea, some days a comment
 * on their post, every third day a "thought of you". Mia answers comments and ignores ideas; Kevin answers
 * ideas, ignores comments and is often mid-conversation at noon; Sam answers nothing. The editor runs at
 * noon, then again at 4pm.
 */
describe("a simulated month for three creators", () => {
  it("one a day at most, quiet days, variety, learning who answers what, and backing off", { timeout: 60_000 }, async () => {
    const t = convexTest(schema, modules);
    const people = { mia: await seed(t, "mia"), kevin: await seed(t, "kevin"), sam: await seed(t, "sam") };
    const answers: Record<keyof typeof people, string[]> = { mia: ["comment"], kevin: ["scout", "for_you"], sam: [] };
    const log: Record<string, string[]> = { mia: [], kevin: [], sam: [] };
    for (let day = 0; day < 30; day++) {
      const morning = T0 + day * D - 4 * H;
      for (const [name, id] of Object.entries(people) as Array<[keyof typeof people, Id<"creators">]>) {
        await noticeIdea(t, id, `${name}-${day}`, morning, 2 + (day % 3) * 0.4);
        if (day % 2 === 0) await comment(t, id, `${name}-c${day}`, morning);
        if (day % 3 === 0) await t.mutation(internal.core.editor.notice, { creatorId: id, now: morning, c: { id: `foryou:${name}${day}`, kind: "for_you", sourceKey: `foryou:${name}${day}`, base: 1.5, ttlMs: 2 * D, summary: "thought of you", link: `https://t/fy${day}`, draft: { body: `thought of you\n\nhttps://t/fy${day}` } } });
        if (name === "kevin" && day % 3 === 1) await t.run((ctx) => ctx.db.insert("messages", { creatorId: id, direction: "in", surface: "imessage", kind: "inbound", body: "yo", ts: T0 + day * D - H } as never));
        let r = await t.action(internal.core.editor.pick, { creatorId: id, now: T0 + day * D });
        if (!r.sent && /mid-conversation/.test(r.reason)) r = await t.action(internal.core.editor.pick, { creatorId: id, now: T0 + day * D + 4 * H });
        const sent = r.sent ? (await t.run((ctx) => ctx.db.query("messages").collect())).filter((m) => m.creatorId === id && m.direction === "out").sort((x, y) => x.ts - y.ts).at(-1)! : null;
        log[name].push(sent?.kind ?? "·");
        if (sent && answers[name].includes(sent.kind!)) await t.run((ctx) => ctx.db.insert("messages", { creatorId: id, direction: "in", surface: "imessage", kind: "inbound", body: "ooh", ts: sent.ts + 2 * H } as never));
      }
    }
    if (process.env.SHOW_MONTH) for (const [n, l] of Object.entries(log)) console.log(n.padEnd(6), l.map((k) => ({ scout: "I", comment: "C", for_you: "F", "·": "·" } as Record<string, string>)[k] ?? k).join(""));
    const all = await t.run((ctx) => ctx.db.query("messages").collect());
    for (const id of Object.values(people)) {
      const byDay = new Map<string, number>();
      for (const m of all.filter((x) => x.creatorId === id && x.direction === "out" && x.proactive)) byDay.set(new Date(m.ts).toISOString().slice(0, 10), (byDay.get(new Date(m.ts).toISOString().slice(0, 10)) ?? 0) + 1);
      for (const [d, n] of byDay) expect(n, d).toBeLessThanOrEqual(1);
    }
    const share = (l: string[], k: string, from: number, to: number) => l.slice(from, to).filter((x) => x === k).length;
    // Mia: comments land, ideas don't. By the second half, comments are most of what she gets.
    expect(share(log.mia, "comment", 15, 30)).toBeGreaterThan(share(log.mia, "scout", 15, 30));
    // Kevin: ideas land, comments don't.
    expect(share(log.kevin, "scout", 15, 30)).toBeGreaterThan(share(log.kevin, "comment", 15, 30));
    // Sam answers nothing: after three she backs off to about one a week, never to nothing.
    const samLater = log.sam.slice(5).filter((k) => k !== "·").length;
    expect(samLater).toBeGreaterThanOrEqual(2);
    expect(samLater).toBeLessThanOrEqual(5);
    // People who don't answer everything get quiet days; Mia never gets the ideas she ignores five days running.
    for (const l of [log.mia, log.sam]) expect(l.filter((k) => k === "·").length).toBeGreaterThan(0);
    expect(/(scout)(,\1){4}/.test(log.mia.join(","))).toBe(false);
  });
});
