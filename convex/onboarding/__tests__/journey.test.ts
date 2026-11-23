/**
 * A new person's journey, end to end on rows (operator, 2026-11-23: "test the entire real-world flow"). The
 * app's calls in the app's order: an account, the TikTok connect, her watching their posts, START, her opening.
 * Models are stubbed by purpose; everything else is the product's own code. Each step checks a row, so a
 * failure names the step. The cases are the ones real signups hit: today's included.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { callModel } from "../../core/llm";
import type { Id } from "../../_generated/dataModel";

vi.mock("../../core/llm", async (orig) => ({ ...(await orig<typeof import("../../core/llm")>()), callModel: vi.fn() }));

const HOOK = "the guy on the same treadmill for two years";
const reply = (content: string) => ({ ok: true, content } as Awaited<ReturnType<typeof callModel>>);

function stubModels(cite: () => string) {
  vi.mocked(callModel).mockImplementation(async (_ctx, req) => {
    const purpose = (req as { purpose: string }).purpose;
    if (purpose === "first_read" || purpose === "first_read_rewrite") return reply(`here's how i see you so far: dry humor over real footage. your treadmill clip did ${cite()} views. if that's not you, tell me and i'll rethink everything\n---\nfirst one to make: your gym walk, on screen: "${HOOK}". 3 shots, about 10 seconds.`);
    if (purpose === "opening_idea") return reply(JSON.stringify({ hook: HOOK, why: "real footage, one dry line", shoot: "3 shots, about 10 seconds" }));
    if (purpose.startsWith("critic")) return reply('{"pass": true, "problems": [], "note": ""}');
    return reply("");
  });
}

async function signUp(t: ReturnType<typeof convexTest>, key: string) {
  return await t.run((ctx) => seedCreator(ctx, key, { clerkUserId: `user_${key}`, handles: {}, ownership: "unverified" } as never));
}

async function connectTikTok(t: ReturnType<typeof convexTest>, creatorId: Id<"creators">, username: string) {
  await t.mutation(internal.connections.zernio.ensureProfileRow, { creatorId, zernioProfileId: `prof_${username}` });
  await t.mutation(internal.connections.zernio.applyAccounts, { creatorId, accounts: [{ accountId: `acct_${username}`, platform: "tiktok", username, needsReconnect: false, canFetchAnalytics: true }] });
}

/** What her watching leaves behind: their posts and a dossier (the ingest itself is tested in onboarding/ingest). */
async function watched(t: ReturnType<typeof convexTest>, creatorId: Id<"creators">) {
  await t.run(async (ctx) => {
    const views = [140, 160, 120, 1100, 150, 130];
    for (const [i, v] of views.entries()) await ctx.db.insert("ownPosts", { creatorId, platform: "tiktok", postId: `p${i}`, url: `https://www.tiktok.com/@x/video/${i}`, createTime: Date.now() - i * 86_400_000, contentType: "video", caption: i === 3 ? "same treadmill, two years" : `post ${i}`, hashtags: [], metrics: { views: v, likes: 1, comments: 0, shares: 0 }, metricsAsOf: Date.now(), source: "scrape", sample: ["top"], multiple: v / 140 } as never);
    await ctx.db.patch(creatorId, { dossier: { persona: { humor: "dry" }, strengths: ["real footage with one line"], works: [] } as never });
  });
}

async function pairByStart(t: ReturnType<typeof convexTest>, creatorId: Id<"creators">, chat: string) {
  await t.run((ctx) => ctx.db.patch(creatorId, { pairingToken: `tok_${chat}`, pairingExpiresAt: Date.now() + 60_000 }));
  return await t.mutation(internal.core.pairing.claimPairing, { token: `tok_${chat}`, chatId: chat });
}

const outs = (t: ReturnType<typeof convexTest>, creatorId: Id<"creators">) =>
  t.run(async (ctx) => (await ctx.db.query("messages").collect()).filter((m) => m.creatorId === creatorId && m.direction === "out"));

describe("a new person's journey", () => {
  beforeEach(() => { process.env.APP_URL = "https://staging.hey-maya.ai"; });
  afterEach(() => { vi.mocked(callModel).mockReset(); });

  it("signs up, connects TikTok, she watches, they text START: the opening sees them, gives a finished post saved in their app, asks nothing", async () => {
    const t = convexTest(schema, modules);
    const me = await signUp(t, "j1");
    await connectTikTok(t, me, "treadmill.guy");
    // Step: the connect sets their handle and starts her watching.
    const c1 = await t.run((ctx) => ctx.db.get(me));
    expect(c1?.handles.tiktok, "connect sets the handle").toBe("treadmill.guy");
    expect((await t.run((ctx) => ctx.db.query("jobs").collect())).some((j) => j.kind === "ingest_catalogue" && j.creatorId === me), "watching starts").toBe(true);
    await watched(t, me);
    const best = await t.query(internal.onboarding.standout.forCreator, { creatorId: me });
    expect(best, "a standout post exists").not.toBeNull();
    stubModels(() => best!.cite);
    // Step: her read is written before they've texted (the usual case: they're still in onboarding).
    expect((await t.action(internal.onboarding.firstRead.run, { creatorId: me })).ok).toBe(true);
    const idea = (await t.run((ctx) => ctx.db.query("ideas").collect())).find((i) => i.creatorId === me && (i.version as { from?: string }).from === "first_read");
    expect(idea, "the opening's idea is in their Ideas").toBeTruthy();
    expect((idea!.version as { hook: string }).hook).toBe(HOOK);
    expect(idea!.shotList).toMatch(/3 shots/);
    // Step: START. The waiting read is the opening, introduced once.
    expect((await pairByStart(t, me, "c1")).paired).toBe(true);
    const sent = await outs(t, me);
    expect(sent.filter((m) => m.kind === "hello"), "no second introduction").toHaveLength(0);
    const opening = sent.find((m) => m.kind === "first_read")!;
    const parts = opening.body.split("\n---\n");
    expect(parts[0]).toMatch(/maya.*save this number/i);
    expect(parts[1]).toMatch(/how i see you/i);
    expect(opening.body).toContain(best!.cite);
    expect(opening.body).toContain(`https://staging.hey-maya.ai/o/idea/${idea!._id}`);
    expect(opening.body, "no question in the opening").not.toMatch(/\?/);
    expect(opening.awaitingAnswer ?? false).toBe(false);
    expect(opening.body).not.toMatch(/brand deals/i);
  });

  it("texts START before she's done: she says she's watching, nothing she can't keep, and the read follows once", async () => {
    const t = convexTest(schema, modules);
    const me = await signUp(t, "j2");
    await connectTikTok(t, me, "early.texter");
    expect((await pairByStart(t, me, "c2")).paired).toBe(true);
    const hello = (await outs(t, me)).filter((m) => m.kind === "hello");
    expect(hello).toHaveLength(1);
    expect(hello[0].body).toMatch(/watching your posts now/i);
    await watched(t, me);
    const best = await t.query(internal.onboarding.standout.forCreator, { creatorId: me });
    stubModels(() => best!.cite);
    await t.action(internal.onboarding.firstRead.run, { creatorId: me });
    await t.action(internal.onboarding.firstRead.run, { creatorId: me });
    expect((await outs(t, me)).filter((m) => m.kind === "first_read"), "the read once").toHaveLength(1);
  });

  it("START twice is one hello", async () => {
    const t = convexTest(schema, modules);
    const me = await signUp(t, "j3");
    await connectTikTok(t, me, "double.start");
    await pairByStart(t, me, "c3");
    await t.run((ctx) => ctx.db.patch(me, { pairingToken: "tok_again", pairingExpiresAt: Date.now() + 60_000 }));
    await t.mutation(internal.core.pairing.claimPairing, { token: "tok_again", chatId: "c3" });
    expect((await outs(t, me)).filter((m) => m.kind === "hello")).toHaveLength(1);
  });

  it("never connects TikTok: her hello says how to start, not that she's watching", async () => {
    const t = convexTest(schema, modules);
    const me = await signUp(t, "j4");
    await pairByStart(t, me, "c4");
    const hello = (await outs(t, me)).find((m) => m.kind === "hello")!;
    expect(hello.body).toMatch(/connect your TikTok/i);
    expect(hello.body).not.toMatch(/watching your posts now/i);
  });

  it("deletes their account and signs up again with the same TikTok: the new account gets the handle and her watching starts", async () => {
    const t = convexTest(schema, modules);
    const old = await signUp(t, "j5old");
    await connectTikTok(t, old, "comes.back");
    const fresh = await signUp(t, "j5new");
    await connectTikTok(t, fresh, "comes.back");
    const [o, f] = await t.run(async (ctx) => [await ctx.db.get(old), await ctx.db.get(fresh)]);
    expect(f?.handles.tiktok).toBe("comes.back");
    expect(o?.handles.tiktok).toBeUndefined();
    expect((await t.run((ctx) => ctx.db.query("jobs").collect())).some((j) => j.kind === "ingest_catalogue" && j.creatorId === fresh)).toBe(true);
  });
});
