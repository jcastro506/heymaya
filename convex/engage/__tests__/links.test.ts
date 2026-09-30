/**
 * Which posts from her engagement text they opened: each post goes out as our short link, the first
 * real open becomes a noticed action on THEIR row, and previews, bots, HEAD requests and the seconds
 * right after the send never count. The link only ever forwards to a TikTok or Instagram post.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import schema from "../../schema";
import { api, internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { addTracked } from "../../agent/manage";
import { unseenActions } from "../../core/act";
import { goUrl, LINKS, newCode, safeTarget } from "../links";
import type { Id } from "../../_generated/dataModel";

const H = 3_600_000;
const NOW = Date.UTC(2026, 8, 30, 15, 0);
const PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const IMESSAGE_PREVIEW = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) AppleWebKit/601.2.4 (KHTML, like Gecko) Version/9.0.1 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0";

describe("the link (pure)", () => {
  it("codes are ten lowercase letters or digits and don't repeat", () => {
    const codes = Array.from({ length: 200 }, () => newCode());
    for (const c of codes) expect(c).toMatch(/^[a-z0-9]{10}$/);
    expect(new Set(codes).size).toBe(codes.length);
    expect(LINKS.codeLength).toBe(10);
  });
  it("lives under /go/ on our site, never a path the app claims", () => {
    expect(goUrl("abc1234567", "https://staging.hey-maya.ai/")).toBe("https://staging.hey-maya.ai/go/abc1234567");
    expect(goUrl("abc1234567", undefined)).toBe("https://hey-maya.ai/go/abc1234567");
  });
  it("forwards only to a TikTok or Instagram post over https", () => {
    for (const ok of ["https://www.tiktok.com/@a/video/1", "https://tiktok.com/@a/video/1", "https://vm.tiktok.com/ZM123/", "https://www.instagram.com/p/abc/", "https://instagram.com/reel/x/"]) expect(safeTarget(ok), ok).not.toBeNull();
    for (const bad of ["https://evil.com/x", "https://tiktok.com.evil.com/x", "https://eviltiktok.com/x", "http://www.tiktok.com/@a/video/1", "javascript:alert(1)", "not a url", ""]) expect(safeTarget(bad), bad).toBeNull();
  });
});

async function world(t: ReturnType<typeof convexTest>, suffix: string) {
  const c = await t.run((ctx) => seedCreator(ctx, suffix, { timezone: "UTC", channel: { paired: true, pairedAt: NOW - 30 * 24 * H, kind: "imessage" }, plan: { status: "active", founding: true } }));
  await t.run(async (ctx) => {
    for (const h of ["one", "two", "three"]) await addTracked(ctx as never, c, "tiktok", h, [], { addedBy: "creator" });
    await ctx.db.insert("messages", { creatorId: c, direction: "in", surface: "imessage", kind: "inbound", body: "ok", ts: NOW - 20 * H } as never);
    for (const [h, id] of [["one", `${suffix}a`], ["two", `${suffix}b`], ["three", `${suffix}c`]]) await ctx.db.insert("observations", { platform: "tiktok", postId: id, authorHandle: h, url: `https://www.tiktok.com/@${h}/video/${id}`, createTime: NOW - 4 * H, sampledAt: NOW - 2 * H, ageHours: 2, views: 5000, likes: 10, comments: 4, shares: 0, keywords: [], source: "account.posts", caption: "taper week" } as never);
  });
  return c;
}
const linksOf = (t: ReturnType<typeof convexTest>, c: Id<"creators">) => t.run(async (ctx) => (await ctx.db.query("engageLinks").collect()).filter((r) => r.creatorId === c));
const actionsOf = (t: ReturnType<typeof convexTest>, c: Id<"creators">) => t.run(async (ctx) => (await ctx.db.query("userActions").collect()).filter((r) => r.creatorId === c && r.kind === "engage.opened"));
/** Move the send far enough into the past that an open is a person, not the phone's preview. */
const aged = (t: ReturnType<typeof convexTest>, c: Id<"creators">) => t.run(async (ctx) => { for (const r of (await ctx.db.query("engageLinks").collect()).filter((x) => x.creatorId === c)) await ctx.db.patch(r._id, { sentAt: Date.now() - 60_000 }); });

describe("the text carries our links", () => {
  it("each post goes out as a /go link to its own row; the raw post link isn't in the text", async () => {
    const t = convexTest(schema, modules);
    const c = await world(t, "l1");
    expect(await t.action(internal.engage.round.sendText, { creatorId: c, now: NOW })).toEqual({ sent: true, reason: "sent" });
    const msg = (await t.run((ctx) => ctx.db.query("messages").collect())).find((m) => m.creatorId === c && m.kind === "engage")!;
    const rows = await linksOf(t, c);
    expect(rows).toHaveLength(3);
    expect(msg.links).toEqual(rows.map((r) => goUrl(r.code)));
    for (const r of rows) {
      expect(msg.body).toContain(`/go/${r.code}`);
      expect(msg.body).not.toContain(r.url);
      expect(r).toMatchObject({ sentAt: NOW, opens: 0 });
      expect(r.key).toMatch(/^tiktok:l1[abc]$/);
    }
  });

  it("a held text leaves no link rows behind", async () => {
    const t = convexTest(schema, modules);
    const c = await world(t, "l2");
    await t.run((ctx) => ctx.db.patch(c, { channel: { paired: false } } as never));
    expect((await t.action(internal.engage.round.sendText, { creatorId: c, now: NOW })).sent).toBe(false);
    expect(await linksOf(t, c)).toHaveLength(0);
  });
});

describe("an open", () => {
  it("a person's first open is noticed once, on their row only; later opens only count", async () => {
    const t = convexTest(schema, modules);
    const c = await world(t, "o1");
    const other = await world(t, "o2");
    await t.action(internal.engage.round.sendText, { creatorId: c, now: NOW });
    await t.action(internal.engage.round.sendText, { creatorId: other, now: NOW });
    await aged(t, c);
    const [r] = await linksOf(t, c);
    expect(await t.mutation(api.engage.links.open, { code: r.code, userAgent: PHONE })).toEqual({ url: r.url, counted: true });
    expect(await t.mutation(api.engage.links.open, { code: r.code, userAgent: PHONE })).toEqual({ url: r.url, counted: true });
    const after = (await linksOf(t, c)).find((x) => x.code === r.code)!;
    expect(after.opens).toBe(2);
    expect(after.openedAt).toBeGreaterThan(0);
    const acts = await actionsOf(t, c);
    expect(acts).toHaveLength(1);
    expect(acts[0]).toMatchObject({ source: "chat", objectId: r.key });
    expect(acts[0].summary).toContain(`@${r.handle}`);
    expect(await actionsOf(t, other), "nobody else's row").toHaveLength(0);
    // She sees it next time she talks to them, once.
    const unseen = await t.run((ctx) => unseenActions(ctx as never, c, Date.now()));
    expect(unseen.map((u) => u.kind)).toContain("engage.opened");
  });

  it("previews, bots, HEAD requests and the first seconds after the send forward but never count", async () => {
    const t = convexTest(schema, modules);
    const c = await world(t, "o3");
    await t.action(internal.engage.round.sendText, { creatorId: c, now: NOW });
    const [r] = await linksOf(t, c);
    await t.run((ctx) => ctx.db.patch(r._id, { sentAt: Date.now() }));
    expect(await t.mutation(api.engage.links.open, { code: r.code, userAgent: PHONE }), "the phone fetching a preview right after the send").toEqual({ url: r.url, counted: false });
    await aged(t, c);
    for (const ua of [IMESSAGE_PREVIEW, "WhatsApp/2.23", "TelegramBot (like TwitterBot)", "Slackbot-LinkExpanding 1.0", "curl/8.4", undefined]) {
      expect(await t.mutation(api.engage.links.open, { code: r.code, userAgent: ua }), String(ua)).toEqual({ url: r.url, counted: false });
    }
    expect(await t.mutation(api.engage.links.open, { code: r.code, userAgent: PHONE, count: false }), "HEAD").toEqual({ url: r.url, counted: false });
    expect((await linksOf(t, c)).find((x) => x.code === r.code)!.opens).toBe(0);
    expect(await actionsOf(t, c)).toHaveLength(0);
  });

  it("an unknown, malformed or tampered link goes nowhere and records nothing", async () => {
    const t = convexTest(schema, modules);
    const c = await world(t, "o4");
    await t.action(internal.engage.round.sendText, { creatorId: c, now: NOW });
    await aged(t, c);
    for (const code of ["zzzzzzzzzz", "../../etc", "ABCDEFGHIJ", "", "a".repeat(500)]) expect(await t.mutation(api.engage.links.open, { code, userAgent: PHONE })).toEqual({ url: null, counted: false });
    const [r] = await linksOf(t, c);
    await t.run((ctx) => ctx.db.patch(r._id, { url: "https://evil.example/phish" }));
    expect(await t.mutation(api.engage.links.open, { code: r.code, userAgent: PHONE })).toEqual({ url: null, counted: false });
    expect(await actionsOf(t, c)).toHaveLength(0);
  });
});

describe("the web side", () => {
  const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
  it("/go is a public route handler the app doesn't claim, and HEAD never counts", () => {
    const route = read("app/go/[code]/route.ts");
    expect(route).toMatch(/api\.engage\.links\.open/);
    expect(route).toMatch(/export async function HEAD[\s\S]*forward\(req, \(await params\)\.code, false\)/);
    expect(read("proxy.ts")).toContain('"/go/(.*)"');
    const aasa = read("app/.well-known/apple-app-site-association/route.ts");
    expect(aasa).not.toMatch(/\/go\//);
  });
});
