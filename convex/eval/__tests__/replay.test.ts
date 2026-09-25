/**
 * Replay mode: a simulation reads the dev cache and never the vendor. Categories: fail-closed (production,
 * a real creator, an expired row), cross-tenant (another creator's read is untouched), adversarial (a
 * phone that only looks fictional), budget (a miss is a named failure, not a paid call).
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { cacheKeyFor, isFictionalPhone, isReplayableCreator, parseReplay, REPLAY_KEY, replayApplies } from "../replay";
import { fixtureCallCount, resetFixtureClients } from "../../reads/read";

const SIM = { clerkUserId: "eval-run:ps-1:0", phone: "+12025550142" };
const params = { platform: "tiktok", handle: "Runner", sort: "latest", slot: "onboarding" };

async function world() {
  const t = convexTest(schema, modules);
  const sim = await t.run((ctx) => seedCreator(ctx, "sim", SIM));
  const real = await t.run((ctx) => seedCreator(ctx, "real", { clerkUserId: "user_2abc", phone: "+12025550142" }));
  const key = cacheKeyFor("account.posts", params);
  // A cached read from days ago: long expired, still the real posts.
  await t.run((ctx) => ctx.db.insert("readCache", { kind: "account.posts", key, params, value: [{ postId: "p1", caption: "long run recap" }], fetchedAt: 1, expiresAt: 2 }));
  return { t, sim, real, key };
}

describe("replay: the dev cache answers, the vendor is never called", () => {
  beforeEach(() => { vi.stubEnv("ENVIRONMENT_NAME", "dev"); vi.stubEnv("SCRAPE_FIXTURES", "spec"); resetFixtureClients(); });
  afterEach(() => { vi.unstubAllEnvs(); resetFixtureClients(); });

  it("an armed sim creator gets the cached read whatever its age; a miss is named and costs nothing", async () => {
    const { t, sim } = await world();
    expect(await t.mutation(internal.eval.replay.arm, { creatorIds: [sim], runId: "ps-1" })).toMatchObject({ ok: true });
    const r = await t.action(internal.reads.read.read, { kind: "account.posts", params, creatorId: sim });
    expect(r.cached).toBe(true);
    expect(r.value).toEqual([{ postId: "p1", caption: "long run recap" }]);
    await expect(t.action(internal.reads.read.read, { kind: "account.posts", params: { ...params, handle: "nobody" }, creatorId: sim })).rejects.toThrow(/replay/);
    expect(fixtureCallCount(), "no vendor (or fixture) call at all").toBe(0);
    expect(await t.query(internal.eval.replay.missesFor, { creatorId: sim })).toEqual([expect.objectContaining({ kind: "account.posts", n: 1 })]);
  });

  it("a real creator's read is untouched while a run is armed (cross-tenant)", async () => {
    const { t, sim, real } = await world();
    await t.mutation(internal.eval.replay.arm, { creatorIds: [sim], runId: "ps-1" });
    await t.action(internal.reads.read.read, { kind: "account.posts", params, creatorId: real });
    expect(fixtureCallCount(), "the expired row is refetched for a real creator, as always").toBe(1);
  });

  it("refuses to arm a real creator, and refuses everything in production (fail-closed)", async () => {
    const { t, sim, real } = await world();
    expect(await t.mutation(internal.eval.replay.arm, { creatorIds: [real], runId: "x" })).toMatchObject({ ok: false });
    vi.stubEnv("ENVIRONMENT_NAME", "production");
    expect(await t.mutation(internal.eval.replay.arm, { creatorIds: [sim], runId: "x" })).toMatchObject({ ok: false });
    expect(await t.run((ctx) => ctx.db.query("syncState").collect())).toEqual([]);
  });

  it("an expired arming is off; disarm removes the creator and then the row", async () => {
    const { t, sim } = await world();
    await t.mutation(internal.eval.replay.arm, { creatorIds: [sim], runId: "ps-1", ttlMs: 1 });
    await new Promise((r) => setTimeout(r, 5));
    expect(await t.query(internal.eval.replay.active, { creatorId: sim })).toBe(false);
    await t.mutation(internal.eval.replay.arm, { creatorIds: [sim], runId: "ps-2" });
    expect(await t.query(internal.eval.replay.active, { creatorId: sim })).toBe(true);
    await t.mutation(internal.eval.replay.disarm, { creatorIds: [sim] });
    expect(await t.run((ctx) => ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", REPLAY_KEY)).first())).toBeNull();
  });

  it("candidates lists only accounts whose onboarding reads are all cached", async () => {
    const { t } = await world();
    const add = (kind: string, p: Record<string, unknown>) => t.run((ctx) => ctx.db.insert("readCache", { kind, key: cacheKeyFor(kind as never, p), params: p, value: { followerCount: 1200 }, expiresAt: 1 }));
    await add("profile", { platform: "tiktok", handle: "runner" });
    await add("account.posts", { platform: "tiktok", handle: "runner", sort: "popular", slot: "onboarding" });
    await add("profile", { platform: "instagram", handle: "halfdone" }); // no posts cached
    expect(await t.query(internal.eval.replay.candidates, {})).toEqual([{ platform: "tiktok", handle: "runner", followers: 1200 }]);
  });
});

describe("replay: the guard, pure (adversarial)", () => {
  it("only the 555-01XX fiction range counts as a fictional phone", () => {
    expect(isFictionalPhone("+12025550142")).toBe(true);
    expect(isFictionalPhone("+12025550200")).toBe(false); // 555-0200 is a real line
    expect(isFictionalPhone("+12025551234")).toBe(false);
    expect(isFictionalPhone("+442025550142")).toBe(false);
    expect(isFictionalPhone(undefined)).toBe(false);
  });

  it("never a person: a chat id, a real phone or a customer subject refuses", () => {
    expect(isReplayableCreator({ clerkUserId: "eval-run:a", telegramChatId: undefined, phone: undefined })).toBe(true);
    expect(isReplayableCreator({ clerkUserId: "eval-run:a", telegramChatId: "123", phone: undefined })).toBe(false);
    expect(isReplayableCreator({ clerkUserId: "eval-run:a", telegramChatId: undefined, phone: "+12025551234" })).toBe(false);
    expect(isReplayableCreator({ clerkUserId: "user_eval-run:a", telegramChatId: undefined, phone: undefined })).toBe(false);
    expect(isReplayableCreator({ clerkUserId: "eval:persona", telegramChatId: undefined, phone: undefined }), "scenario personas are shared; only per-run clones").toBe(false);
  });

  it("a malformed or expired config is off", () => {
    const c = { _id: "c1", clerkUserId: "eval-run:a", telegramChatId: undefined, phone: undefined } as never;
    expect(parseReplay("{not json")).toBeNull();
    expect(replayApplies(parseReplay(JSON.stringify({ creatorIds: ["c1"], expiresAt: 10 })), c, 20, { ENVIRONMENT_NAME: "dev" })).toBe(false);
    expect(replayApplies(parseReplay(JSON.stringify({ creatorIds: ["c1"], expiresAt: 30 })), c, 20, { ENVIRONMENT_NAME: "dev" })).toBe(true);
    expect(replayApplies(parseReplay(JSON.stringify({ creatorIds: ["c1"], expiresAt: 30 })), c, 20, {})).toBe(false);
  });
});
