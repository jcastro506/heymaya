/**
 * First-week lessons (2026-11-04): what they can do with her, one thing at a time, only at a moment it fits,
 * never on its own text, never what they've already found, at most one a day, only in the first week.
 */
import { convexTest } from "convex-test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { carriesLesson, LESSON_TEXT, LESSONS, lessonKey, lessonsSaid, momentLesson, replyLesson, withLesson } from "../lessons";
import { saveContactLine } from "../conversation";
import { summarize, weekOf } from "../firstWeekMetrics";

const D = 86_400_000;
const NOW = Date.UTC(2026, 10, 4, 18, 0);
const none = { sentVideo: false, sentTiktok: false, openedInApp: false };

describe("which lesson, when (pure)", () => {
  it("drafts first, then shares; never one they've found themselves", () => {
    expect(replyLesson({ usage: none, said: [], now: NOW, pairedAt: NOW - D })?.id).toBe("drafts");
    expect(replyLesson({ usage: { ...none, sentVideo: true }, said: [], now: NOW, pairedAt: NOW - D })?.id).toBe("shares");
    expect(replyLesson({ usage: { ...none, sentVideo: true, sentTiktok: true }, said: [], now: NOW, pairedAt: NOW - D })).toBeNull();
    expect(replyLesson({ usage: none, said: [lessonKey("drafts", "2026-11-01")], now: NOW, pairedAt: NOW - 4 * D })?.id).toBe("shares");
  });
  it("one a day, and only in the first week", () => {
    expect(replyLesson({ usage: none, said: [lessonKey("pace", "2026-11-04")], now: NOW, pairedAt: NOW - D }), "taught one today").toBeNull();
    expect(replyLesson({ usage: none, said: [], now: NOW, pairedAt: NOW - LESSONS.windowMs - 1 })).toBeNull();
    expect(replyLesson({ usage: none, said: [], now: NOW })).toBeNull();
  });
  it("the app on the first save, until they've opened an idea there; pace once, with her first find", () => {
    expect(momentLesson("app", { usage: none, said: [], now: NOW, pairedAt: NOW - D })).toBe(LESSON_TEXT.app);
    expect(momentLesson("app", { usage: { ...none, openedInApp: true }, said: [], now: NOW, pairedAt: NOW - D })).toBeNull();
    expect(momentLesson("app", { usage: none, said: [lessonKey("app", "2026-11-02")], now: NOW, pairedAt: NOW - 3 * D })).toBeNull();
    expect(momentLesson("pace", { said: [], now: NOW, pairedAt: NOW - D })).toBe(LESSON_TEXT.pace);
    expect(momentLesson("pace", { said: [lessonKey("pace", "2026-11-03")], now: NOW, pairedAt: NOW - 2 * D })).toBeNull();
    expect(momentLesson("pace", { said: [], now: NOW, pairedAt: NOW - LESSONS.momentWindowMs - 1 })).toBeNull();
  });
  it("she can reword the punctuation, not the lesson; only the lesson keys are read back", () => {
    expect(carriesLesson(`got it.\n---\nAnytime you film something, send it here before you post, and I'll tell you what I'd change!`, LESSON_TEXT.drafts)).toBe(true);
    expect(carriesLesson("got it, love that idea", LESSON_TEXT.drafts)).toBe(false);
    expect(lessonsSaid(["months:1", "cap:book:2026-11-01", lessonKey("shares", "2026-11-02")]).map((l) => l.id)).toEqual(["shares"]);
  });
  it("a lesson never buries her question: it goes before it, or last", () => {
    expect(withLesson("found one.\n---\nwant the shot list?", "L")).toBe("found one.\n---\nL\n---\nwant the shot list?");
    expect(withLesson("found one.", "L")).toBe("found one.\n---\nL");
  });
  it("the opening's save line says what she does in the background, in one clause", () => {
    expect(saveContactLine()).toMatch(/save this number, i'll text you when i find something worth making/);
  });
});

describe("on the rows", () => {
  const paired = (t: ReturnType<typeof convexTest>, s: string, pairedAt: number) =>
    t.run((ctx) => seedCreator(ctx, s, { timezone: "UTC", channel: { paired: true, pairedAt, kind: "imessage" }, plan: { status: "active", founding: true }, dossier: { persona: { summary: "runner" }, keywords: ["running"] } }));
  const inbound = (t: ReturnType<typeof convexTest>, creatorId: Awaited<ReturnType<typeof paired>>, body: string, extra: Record<string, unknown> = {}) =>
    t.run((ctx) => ctx.db.insert("messages", { creatorId, direction: "in", surface: "imessage", body, ts: Date.now(), kind: "inbound", ...extra } as never));

  it("her reply context offers one lesson in the first week, none to a proactive turn, none after the week", async () => {
    const t = convexTest(schema, modules);
    const fresh = await paired(t, "l1", Date.now() - D);
    const m = await inbound(t, fresh, "what should i post today");
    const g = await t.query(internal.agent.context.gather, { creatorId: fresh, messageId: m });
    expect(g?.lesson?.id).toBe("drafts");
    expect(g?.history).toContain(LESSON_TEXT.drafts);
    expect((await t.query(internal.agent.context.gather, { creatorId: fresh }))?.lesson, "proactive paths get none").toBeNull();
    const old = await paired(t, "l2", Date.now() - 9 * D);
    const m2 = await inbound(t, old, "hey");
    expect((await t.query(internal.agent.context.gather, { creatorId: old, messageId: m2 }))?.lesson).toBeNull();
  });

  it("what they've done themselves is never taught; another creator's activity doesn't count (cross-tenant)", async () => {
    const t = convexTest(schema, modules);
    const a = await paired(t, "l3", Date.now() - D);
    const b = await paired(t, "l4", Date.now() - D);
    await inbound(t, a, "[video]", { kind: "file", fileMime: "video/mp4" });
    await inbound(t, a, "https://www.tiktok.com/@someone/video/123");
    await t.run((ctx) => ctx.db.insert("ideas", { creatorId: a, evidenceLinks: [], fit: "yes", fitWhy: "x", version: { hook: "h" }, messageText: "h", produced: { skillVersion: "t", model: "m", thresholdsVersion: "t" }, status: "sent", createdAt: Date.now(), seenAt: Date.now() } as never));
    expect(await t.query(internal.onboarding.lessons.usageFor, { creatorId: a })).toEqual({ sentVideo: true, sentTiktok: true, openedInApp: true });
    expect(await t.query(internal.onboarding.lessons.usageFor, { creatorId: b })).toEqual(none);
  });

  describe("the first save teaches the app, once", () => {
    beforeAll(() => { process.env.MODEL_FAKE = "1"; });
    afterAll(() => { delete process.env.MODEL_FAKE; });

    it("first save: where it lives; second save: just saved", async () => {
      const t = convexTest(schema, modules);
      const c = await paired(t, "l5", Date.now() - D);
      const idea = (hook: string) => t.run((ctx) => ctx.db.insert("ideas", { creatorId: c, evidenceLinks: [], fit: "yes", fitWhy: "x", version: { hook }, messageText: hook, produced: { skillVersion: "t", model: "m", thresholdsVersion: "t" }, status: "sent", sentAt: Date.now(), createdAt: Date.now() } as never));
      const saveReplies = async () => (await t.run((ctx) => ctx.db.query("messages").collect())).filter((m) => m.direction === "out" && /^saved/i.test(m.body)).map((m) => m.body);
      const i1 = await idea("the shoe rack list");
      await t.action(internal.agent.converse.run, { creatorId: c, messageId: await inbound(t, c, `idea:${i1}:save`, { kind: "button" }) });
      expect((await saveReplies())[0]).toMatch(/Maya app under Ideas/);
      expect(lessonsSaid((await t.run((ctx) => ctx.db.get(c)))!.milestonesSaid ?? []).map((l) => l.id)).toEqual(["app"]);
      const i2 = await idea("the bagel ranking");
      await t.action(internal.agent.converse.run, { creatorId: c, messageId: await inbound(t, c, `idea:${i2}:save`, { kind: "button" }) });
      const replies = await saveReplies();
      expect(replies).toHaveLength(2);
      expect(replies[1]).not.toMatch(/Maya app/);
    });
  });
});


describe("is the opening working (the four numbers)", () => {
  const P = Date.UTC(2026, 10, 1, 12);
  const out = (ts: number, kind = "first_read") => ({ direction: "out" as const, kind, ts, deliveredAt: ts, body: "", fileMime: undefined });
  const inn = (ts: number, body = "ok", kind = "inbound", fileMime?: string) => ({ direction: "in" as const, kind, ts, deliveredAt: undefined, body, fileMime });
  it("a creator who replied in 12 minutes, sent a TikTok on day 2, and was back on day 7", () => {
    const w = weekOf(P, [inn(P, "START", "pairing"), out(P + 60_000), inn(P + 13 * 60_000), inn(P + 2 * 86_400_000, "https://www.tiktok.com/@x/video/1"), inn(P + 6.5 * 86_400_000)], P + 10 * 86_400_000);
    expect(w).toMatchObject({ firstReplyMin: 12, brought: true, day7: true });
  });
  it("silence: no reply, nothing brought; day 7 isn't counted until it has happened", () => {
    expect(weekOf(P, [out(P)], P + 3 * 86_400_000)).toMatchObject({ firstReplyMin: null, brought: false, day7: null });
    expect(summarize([weekOf(P, [out(P), inn(P + 5 * 60_000)], P + 9 * 86_400_000), weekOf(P, [out(P)], P + 9 * 86_400_000)])).toEqual({ creators: 2, replied: "1/2 (50%)", medianFirstReplyMin: 5, brought: "0/2 (0%)", day7: "0/2 (0%)" });
  });
});
