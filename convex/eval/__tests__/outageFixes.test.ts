/**
 * What the outage drill found, each fixed, each held here on rows (never on generated prose; the
 * copy compared below is code's own fixed text, exported as constants).
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import type { Id } from "../../_generated/dataModel";
import { REGISTRY } from "../../agent/registry";
import { isOurSide, LINK_OUR_SIDE, LINK_UNOPENABLE, WATCH_OUR_SIDE } from "../../agent/opinion";
import { TURN_DEAD_TEXT } from "../../core/jobs";
import { readHealth } from "../../scout/sampler";
import { resetDefaultClient } from "../../integrations/scrapeCreators/client";
import { resetFixtureClients } from "../../reads/read";

const ENV_KEYS = ["ENVIRONMENT_NAME", "SCRAPE_FIXTURES", "MODEL_FAKE", "SCRAPE_CREATORS_API_KEY"] as const;
let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.ENVIRONMENT_NAME = "local";
  process.env.SCRAPE_FIXTURES = "spec";
  process.env.MODEL_FAKE = "1";
});
afterEach(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } resetFixtureClients(); resetDefaultClient(); });

const LINK = "https://www.tiktok.com/@runwithcarly/video/7395965676629888274";

async function drillWorld() {
  const t = convexTest(schema, modules);
  const creatorId = await t.run((ctx) => seedCreator(ctx, "drill", { clerkUserId: "eval-run:drill-test", handles: { tiktok: "drill.tt", instagram: "drill.ig" }, quietHours: { start: "00:00", end: "00:00" }, dossier: { keywords: ["marathon training"], persona: { summary: "runner" } }, plan: { status: "comped", tier: "partner", founding: false } }));
  return { t, creatorId };
}
const outbound = async (t: ReturnType<typeof convexTest>, creatorId: Id<"creators">) => (await t.run((ctx) => ctx.db.query("messages").withIndex("by_creator", (q) => q.eq("creatorId", creatorId)).collect())).filter((m) => m.direction === "out");

describe("a vendor outage is said as ours, in plain words, never blamed on their link", () => {
  it("classifies the failure", () => {
    expect(isOurSide("read(post.info) failed: ScrapeCreators HTTP 402 for https://api.scrapecreators.com/v1/tiktok/video")).toBe(true);
    expect(isOurSide("ScrapeCreators rate limit for https://api.scrapecreators.com/x")).toBe(true);
    expect(isOurSide("The model is overloaded. Please try again later.")).toBe(true);
    expect(isOurSide("gemini timed out after 150s")).toBe(true);
    expect(isOurSide("read(post.info) failed: ScrapeCreators HTTP 404 for https://api.scrapecreators.com/v1/tiktok/video")).toBe(false);
    expect(isOurSide("no playable url")).toBe(false);
  });

  it("an out-of-credits read answers a link with the our-side line and writes no prediction", async () => {
    const { t, creatorId } = await drillWorld();
    await t.mutation(internal.eval.faults.set, { faults: ["scrape_402"], creatorIds: [creatorId] });
    const { messageId } = await t.mutation(internal.core.messages.recordInbound, { creatorId, surface: "telegram", body: `why did this blow up ${LINK}` });
    const r = await t.action(internal.agent.converse.run, { creatorId, messageId });
    expect(r.ok).toBe(true);
    const out = await outbound(t, creatorId);
    expect(out.map((m) => m.body)).toEqual([LINK_OUR_SIDE]);
    expect(out[0].body).not.toBe(LINK_UNOPENABLE);
    expect(await t.run((ctx) => ctx.db.query("predictions").collect())).toHaveLength(0);
    // The failed reads left named errors and no cached value.
    const cache = await t.run((ctx) => ctx.db.query("readCache").collect());
    expect(cache.length).toBeGreaterThan(0);
    for (const row of cache) { expect(row.value).toBeUndefined(); expect(row.error).toMatch(/402/); expect(row.inFlightSince).toBeUndefined(); }
  });

  it("a Gemini overload on both models answers a camera-roll draft with the our-side line and records no captions", async () => {
    const { t, creatorId } = await drillWorld();
    await t.mutation(internal.eval.faults.set, { faults: ["gemini_overload"], creatorIds: [creatorId] });
    const fileId = await t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(64)], { type: "video/mp4" })));
    const messageId = await t.run((ctx) => ctx.db.insert("messages", { creatorId, direction: "in", surface: "telegram", body: "caption for this?", kind: "file", fileId, fileMime: "video/mp4", ts: Date.now() } as never));
    await t.action(internal.agent.converse.run, { creatorId, messageId });
    expect((await outbound(t, creatorId)).map((m) => m.body)).toEqual([WATCH_OUR_SIDE]);
    expect(await t.run((ctx) => ctx.db.query("finishes").collect())).toHaveLength(0);
    const hits = await t.query(internal.eval.faults.current, {});
    expect(hits.hits.counts["gemini_overload:watch_finish"]).toBe(1); // both models asked through one guarded call
  });
});

describe("the classifier's fallback asks the fallback model", () => {
  it("a classifier outage tries the primary, then the fallback, then answers as plain chat", async () => {
    const { t, creatorId } = await drillWorld();
    await t.mutation(internal.eval.faults.set, { faults: ["classifier_5xx"], creatorIds: [creatorId] });
    const { messageId } = await t.mutation(internal.core.messages.recordInbound, { creatorId, surface: "telegram", body: "what should i post this week?" });
    await t.action(internal.agent.converse.run, { creatorId, messageId });
    const calls = (await t.run((ctx) => ctx.db.query("costEvents").collect())).filter((c) => c.purpose === "classify");
    expect(calls.map((c) => c.resource)).toEqual([REGISTRY.screener.primary, REGISTRY.screener.fallback]);
    expect(calls.every((c) => c.succeeded === false)).toBe(true);
    expect((await outbound(t, creatorId)).some((m) => m.dedupeKey === `reply:${messageId}`)).toBe(true);
  });
});

describe("a dead turn is answered", () => {
  async function deadTurn(t: ReturnType<typeof convexTest>, creatorId: Id<"creators">, messageId: Id<"messages">) {
    const { jobId } = await t.mutation(internal.core.jobs.enqueue, { kind: "converse", idempotencyKey: `converse:${messageId}`, creatorId, payloadJson: JSON.stringify({ messageId }), maxAttempts: 1 });
    await t.mutation(internal.core.jobs.claimNext, { kinds: ["converse"] });
    return await t.mutation(internal.core.jobs.fail, { jobId, error: "converse model_error" });
  }

  it("the last failed attempt tells them once, as status; a second death of the same turn adds nothing", async () => {
    const { t, creatorId } = await drillWorld();
    const { messageId } = await t.mutation(internal.core.messages.recordInbound, { creatorId, surface: "telegram", body: "hey" });
    expect((await deadTurn(t, creatorId, messageId)).status).toBe("dead");
    await deadTurn(t, creatorId, messageId);
    const out = await outbound(t, creatorId);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ body: TURN_DEAD_TEXT, kind: "status", dedupeKey: `turn-dead:${messageId}` });
  });

  it("a turn that already answered and then died says nothing more", async () => {
    const { t, creatorId } = await drillWorld();
    const { messageId } = await t.mutation(internal.core.messages.recordInbound, { creatorId, surface: "telegram", body: "hey" });
    await t.mutation(internal.core.messages.send, { creatorId, surface: "telegram", body: "hi!", dedupeKey: `reply:${messageId}`, proactive: false, kind: "reply" });
    await deadTurn(t, creatorId, messageId);
    expect((await outbound(t, creatorId)).map((m) => m.dedupeKey)).toEqual([`reply:${messageId}`]);
  });

  it("the writer down end to end: the turn dies and they hear it", async () => {
    const { t, creatorId } = await drillWorld();
    await t.mutation(internal.eval.faults.set, { faults: ["writer_5xx"], creatorIds: [creatorId] });
    const { messageId } = await t.mutation(internal.core.messages.recordInbound, { creatorId, surface: "telegram", body: "what should i post this week?" });
    const { jobId } = await t.mutation(internal.core.jobs.enqueue, { kind: "converse", idempotencyKey: `converse:${messageId}`, creatorId, payloadJson: JSON.stringify({ messageId }), maxAttempts: 1 });
    const claimed = await t.mutation(internal.core.jobs.claimNext, { kinds: ["converse"] });
    await t.action(internal.core.scheduler.runJob, { jobId: claimed!._id, attempt: claimed!.attempts });
    expect((await t.query(internal.core.jobs.byId, { jobId }))?.status).toBe("dead");
    expect((await outbound(t, creatorId)).map((m) => m.body)).toEqual([TURN_DEAD_TEXT]);
  });
});

describe("fleet reads write the health row the creator status has always read", () => {
  it("down when at least half the reads failed, retired accounts aside", () => {
    expect(readHealth(0, 0)).toBeNull();
    expect(readHealth(10, 1)?.ok).toBe(true);
    expect(readHealth(10, 5)?.ok).toBe(false);
    expect(readHealth(2, 2, 2)?.ok).toBe(true);
    expect(readHealth(1, 1)?.ok).toBe(false);
  });

  it("a scoped pass under a drill fault writes a drill row: on the console, never in the hourly alert or a creator's status", async () => {
    const { t, creatorId } = await drillWorld();
    await t.run((ctx) => ctx.db.insert("trackedAccounts", { creatorId, platform: "instagram", handle: "nike", addedBy: "creator", baselineN: 0, status: "active", createdAt: Date.now() } as never));
    await t.run((ctx) => ctx.db.insert("trackedAccounts", { creatorId, platform: "tiktok", handle: "runwithcarly", addedBy: "creator", baselineN: 0, status: "active", createdAt: Date.now() } as never));
    await t.mutation(internal.eval.faults.set, { faults: ["scrape_429"], creatorIds: [creatorId] });
    const r = await t.action(internal.scout.sampler.run, { creatorId });
    expect(r).toMatchObject({ accounts: 2, failed: 2, gone: 0 });
    const health = await t.run((ctx) => ctx.db.query("vendorHealth").collect());
    expect(health.map((h) => [h.vendor, h.check, h.ok])).toEqual([["scrapecreators", "read:creator:drill", false]]);
    expect((await t.run((ctx) => ctx.db.query("trackedAccounts").collect())).every((x) => x.status === "active")).toBe(true); // a 429 retires nobody
    const plain = await t.query(internal.core.alerts.findings, { since: 0, now: Date.now() });
    expect(plain.smokeFailed).toEqual([]);
    const withDrill = await t.query(internal.core.alerts.findings, { since: 0, now: Date.now(), includeDrill: true });
    expect(withDrill.smokeFailed).toEqual([{ vendor: "scrapecreators", check: "read:creator:drill" }]);
  });

  it("a writer outage in the scout reaches the operator and leaves the signals pending", async () => {
    const { t, creatorId } = await drillWorld();
    await t.run(async (ctx) => {
      const c = await ctx.db.get(creatorId);
      await ctx.db.patch(creatorId, { channel: { ...c!.channel, paired: true } });
      await ctx.db.insert("signals", { creatorId, kind: "breakout", sourcePostIds: ["7395965676629888274"], score: 6.2, corroboration: { accounts: 0, soundRising: false }, verdict: "pending", url: LINK, why: `6.2x; ${LINK}`, thresholdsVersion: "t", createdAt: Date.now() } as never);
    });
    await t.mutation(internal.eval.faults.set, { faults: ["writer_5xx"], creatorIds: [creatorId] });
    const r = await t.action(internal.scout.scout.run, { creatorId });
    expect(r.sent).toBe(false);
    const health = await t.run((ctx) => ctx.db.query("vendorHealth").collect());
    expect(health.map((h) => [h.vendor, h.check, h.ok])).toEqual([["openrouter", "scout:drill", false]]);
    expect((await t.run((ctx) => ctx.db.query("signals").collect())).map((s) => s.verdict)).toEqual(["pending"]);
    expect(await t.run((ctx) => ctx.db.query("ideas").collect())).toHaveLength(0);
  });
});

describe("a read with no client configured releases its claim", () => {
  it("names the failure and leaves nothing in flight (it used to hold the key for every reader)", async () => {
    delete process.env.SCRAPE_FIXTURES;
    delete process.env.SCRAPE_CREATORS_API_KEY;
    resetDefaultClient();
    const t = convexTest(schema, modules);
    await expect(t.action(internal.reads.read.read, { kind: "post.info", params: { platform: "tiktok", url: LINK } })).rejects.toThrow(/SCRAPE_CREATORS_API_KEY/);
    const rows = await t.run((ctx) => ctx.db.query("readCache").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].inFlightSince).toBeUndefined();
    expect(rows[0].error).toMatch(/SCRAPE_CREATORS_API_KEY/);
  });
});
