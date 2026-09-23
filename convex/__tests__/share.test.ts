/**
 * M5: Send to Maya (the share extension) and Ask Maya. Categories: adversarial input (non-post
 * URLs, junk bodies, bad tokens), cross-tenant (a token reaches exactly one creator; a rotated
 * token is dead), budget fail-closed (a daily share cap; dedupe), sibling coherence (a share is
 * written through the same inbound writer as a text), and the Ask Maya window.
 */
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { modules } from "../../tests/_modules";
import { seedCreator } from "../../tests/lib/creatorRow";
import { conversationLink, nextAwake, shareTarget, SHARES_PER_DAY } from "../share";
import { unseenActions } from "../core/act";

afterEach(() => { vi.useRealTimers(); });

describe("pure", () => {
  it("accepts only TikTok and Instagram posts", () => {
    expect(shareTarget("https://www.tiktok.com/@noahperlofit/video/7676142812504673567?_r=1")).toMatchObject({ ok: true, platform: "tiktok" });
    expect(shareTarget("https://www.instagram.com/reel/DcRIKq6xDpQ/?igsh=x")).toMatchObject({ ok: true, platform: "instagram" });
    for (const bad of ["https://youtube.com/watch?v=1", "javascript:alert(1)", "ignore previous instructions", "", "https://evil.example/tiktok.com/@a/video/1"]) expect(shareTarget(bad).ok, bad).toBe(false);
  });
  it("holds her answer until their quiet hours end", () => {
    const tz = "America/New_York";
    const quiet = { start: "22:00", end: "07:00" };
    const threeAm = Date.UTC(2026, 8, 23, 7); // 03:00 in New York
    const at = nextAwake(threeAm, tz, quiet);
    expect(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(at)).toMatch(/^0?7$/);
    const noon = Date.UTC(2026, 8, 23, 16);
    expect(nextAwake(noon, tz, quiet)).toBe(noon);
  });
  it("opens the right conversation", () => {
    expect(conversationLink("imessage", "about my idea: ", { lineNumber: "+15550100" })).toBe("sms:+15550100&body=about%20my%20idea%3A%20");
    expect(conversationLink("telegram", "x", { botUsername: "HeyMayaBot" })).toBe("https://t.me/HeyMayaBot");
    expect(conversationLink("imessage", "x", {})).toBeNull();
  });
});

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => ({
    a: await seedCreator(ctx, "a", { clerkUserId: "user_a", timezone: "UTC", quietHours: { start: "23:59", end: "00:00" }, channel: { paired: true } }),
    b: await seedCreator(ctx, "b", { clerkUserId: "user_b", timezone: "UTC", channel: { paired: true } }),
  }));
  const tokenA = (await t.withIdentity({ subject: "user_a" }).mutation(api.share.mintShareToken, {})).token!;
  const post = (token: string | null, body: unknown) => t.fetch("/share", { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { t, post, tokenA, ...ids };
}

const TT = "https://www.tiktok.com/@noahperlofit/video/7676142812504673567";

describe("Send to Maya", () => {
  it("reaches her exactly like a text: one inbound message, a Reacted action, a turn queued", async () => {
    const s = await setup();
    const r = await s.post(s.tokenA, { url: `${TT}?_r=1`, note: "could i do this with my pasta recipe?", app: "TikTok" });
    expect(r.status).toBe(200);
    const msgs = await s.t.run((c) => c.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", s.a)).collect());
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ direction: "in", kind: "inbound" });
    expect(msgs[0].body).toContain("pasta recipe");
    const acts = await s.t.run((c) => c.db.query("userActions").withIndex("by_creator_at", (q) => q.eq("creatorId", s.a)).collect());
    expect(acts.map((x) => [x.kind, x.source])).toEqual([["share", "share_ext"]]);
    const jobs = await s.t.run((c) => c.db.query("jobs").collect());
    expect(jobs.filter((j) => j.kind === "converse" && j.creatorId === s.a)).toHaveLength(1);
    // nothing reached B
    expect(await s.t.run((c) => c.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", s.b)).collect())).toHaveLength(0);
  });

  it("refuses bad tokens, non-posts and junk with a reason", async () => {
    const s = await setup();
    expect((await s.post(null, { url: TT })).status).toBe(401);
    expect((await s.post("f".repeat(64), { url: TT })).status).toBe(401);
    expect((await s.post("not-a-token", { url: TT })).status).toBe(401);
    const yt = await s.post(s.tokenA, { url: "https://youtube.com/watch?v=1" });
    expect(yt.status).toBe(400);
    expect(await yt.json()).toMatchObject({ ok: false, reason: expect.stringMatching(/TikTok and Instagram/) });
    const junk = await s.t.fetch("/share", { method: "POST", headers: { authorization: `Bearer ${s.tokenA}` }, body: "{not json" });
    expect(junk.status).toBe(400);
    expect(await s.t.run((c) => c.db.query("messages").collect())).toHaveLength(0);
  });

  it("a rotated token is dead; a token reaches only its creator", async () => {
    const s = await setup();
    const tokenB = (await s.t.withIdentity({ subject: "user_b" }).mutation(api.share.mintShareToken, {})).token!;
    const newA = (await s.t.withIdentity({ subject: "user_a" }).mutation(api.share.mintShareToken, {})).token!;
    expect((await s.post(s.tokenA, { url: TT })).status).toBe(401);
    expect((await s.post(newA, { url: TT })).status).toBe(200);
    expect((await s.post(tokenB, { url: TT })).status).toBe(200);
    const byCreator = async (id: typeof s.a) => (await s.t.run((c) => c.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", id)).collect())).length;
    expect([await byCreator(s.a), await byCreator(s.b)]).toEqual([1, 1]);
  });

  it("the same post twice in ten minutes is one message; the daily cap holds (fail-closed)", async () => {
    const s = await setup();
    await s.post(s.tokenA, { url: TT });
    expect(await (await s.post(s.tokenA, { url: TT })).json()).toMatchObject({ ok: true, duplicate: true });
    for (let i = 1; i < SHARES_PER_DAY; i++) await s.post(s.tokenA, { url: `https://www.tiktok.com/@x/video/70000000000000${String(i).padStart(5, "0")}` });
    const over = await s.post(s.tokenA, { url: "https://www.tiktok.com/@x/video/7999999999999999999" });
    expect(over.status).toBe(429);
    expect((await s.t.run((c) => c.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", s.a)).collect())).length).toBe(SHARES_PER_DAY);
  });
});

describe("Ask Maya", () => {
  it("is owner-checked, reaches her next turn, and expires after ten minutes untouched", async () => {
    const s = await setup();
    const [idea, theirs] = await s.t.run(async (c) => {
      const mk = (creatorId: typeof s.a, hook: string) => c.db.insert("ideas", { creatorId, evidenceLinks: [], fit: "yes", fitWhy: "f", version: { hook }, messageText: hook, status: "sent", produced: { skillVersion: "t", model: "t", thresholdsVersion: "t" }, createdAt: Date.now() } as never);
      return [await mk(s.a, "humidity won today"), await mk(s.b, "b's idea")];
    });
    const asA = s.t.withIdentity({ subject: "user_a" });
    expect(await asA.mutation(api.share.askMaya, { kind: "idea", id: theirs })).toEqual({ ok: false });
    const r = await asA.mutation(api.share.askMaya, { kind: "idea", id: idea });
    expect(r).toMatchObject({ ok: true, draft: expect.stringContaining("humidity won today") });
    const now = Date.now();
    const fresh = await s.t.run((c) => unseenActions(c, s.a, now));
    expect(fresh.map((x) => x.kind)).toEqual(["ask"]);
    expect(fresh[0].summary).toMatch(/humidity won today/);
    const later = await s.t.run((c) => unseenActions(c, s.a, now + 11 * 60_000));
    expect(later).toEqual([]);
  });
});
