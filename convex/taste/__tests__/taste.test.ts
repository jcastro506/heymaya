/**
 * §13.10 (7): "she learns" made observable. Decay and weights · three "not me" on one
 * account rail-drops that account's next breakout with the reason · a posted idea
 * outweighs hearts · a reaction on an idea message writes one event and flips the
 * idea · silence expires at 72 h with a small negative · cross-tenant events refuse.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { api, internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { applyEvent, decayFactor, featureKeys, rankMultiplier, tasteHint, TASTE, WEIGHTS } from "../affinities";
import type { Id } from "../../_generated/dataModel";

const DAY = 86_400_000;
const produced = { skillVersion: "t", model: "t", thresholdsVersion: "t" };

async function seedIdea(t: ReturnType<typeof convexTest>, creatorId: Id<"creators">, over: Record<string, unknown> = {}) {
  return await t.run((ctx) =>
    ctx.db.insert("ideas", {
      creatorId,
      evidenceLinks: ["https://www.tiktok.com/@x/video/1"],
      fit: "yes",
      fitWhy: "fits",
      version: { hook: "the hook" },
      messageText: "an idea",
      status: "sent",
      produced,
      createdAt: Date.now(),
      sentAt: Date.now(),
      features: { format: "skit", topics: ["running"], tone: "deadpan", lengthBucket: "15-30", sound: "none", source: "breakout", account: "@fastguy" },
      ...over,
    }),
  );
}

describe("arithmetic", () => {
  it("decays with a 45-day half-life and respects event order", () => {
    expect(decayFactor(0)).toBe(1);
    expect(decayFactor(TASTE.halfLifeDays * DAY)).toBeCloseTo(0.5, 5);
    const t0 = Date.UTC(2026, 0, 1);
    let a = applyEvent([], ["format:skit"], WEIGHTS.notme, t0);
    a = applyEvent(a, ["format:skit"], WEIGHTS.heart, t0 + 45 * DAY);
    expect(a[0].n).toBe(2);
    expect(a[0].score).toBeCloseTo(-1 + 1, 1); // −2 halved, plus one heart
  });

  it("features fan out and normalise", () => {
    expect(featureKeys({ format: "Talking Head", topics: ["Run club"], tone: "warm", lengthBucket: "<15", sound: "none", source: "shape", account: "@FastGuy" })).toEqual(["format:talking-head", "topic:run-club", "tone:warm", "length:<15", "sound:none", "source:shape", "account:@fastguy"]);
  });

  it("a hard no needs three events; one is noise; rank re-orders but never erases", () => {
    const now = Date.now();
    const one = applyEvent([], ["account:@x"], WEIGHTS.notme, now);
    expect(tasteHint(one, ["account:@x"], now).hardNo).toBeNull();
    let three = one;
    three = applyEvent(three, ["account:@x"], WEIGHTS.notme, now);
    three = applyEvent(three, ["account:@x"], WEIGHTS.notme, now);
    const h = tasteHint(three, ["account:@x"], now);
    expect(h.hardNo).toMatch(/passed on the last 3/);
    expect(rankMultiplier(-100)).toBe(0.5);
    expect(rankMultiplier(100)).toBe(2);
    expect(rankMultiplier(0)).toBe(1);
  });

  it("three passes on day 1 still rail-drop on day 30 and have faded by day 90 (§15.7 simulated month)", () => {
    const day1 = Date.UTC(2026, 0, 1);
    let a: ReturnType<typeof applyEvent> = [];
    for (let i = 0; i < 3; i++) a = applyEvent(a, ["account:@x"], WEIGHTS.notme, day1);
    expect(tasteHint(a, ["account:@x"], day1 + 30 * DAY).hardNo).toMatch(/passed on the last 3/);
    expect(tasteHint(a, ["account:@x"], day1 + 90 * DAY).hardNo).toBeNull();
    expect(tasteHint(a, ["account:@x"], day1 + 90 * DAY).score).toBeLessThan(0); // still remembered, no longer a wall
  });

  it("one posted idea outweighs two hearts", () => {
    const now = Date.now();
    const hearts = applyEvent(applyEvent([], ["format:skit"], WEIGHTS.heart, now), ["format:skit"], WEIGHTS.heart, now);
    const posted = applyEvent([], ["format:vlog"], WEIGHTS.posted, now);
    expect(posted[0].score).toBeGreaterThan(hearts[0].score);
  });
});

describe("events", () => {
  it("three 'not me' on one account rail-drop its next breakout, with the reason on the signal", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { timezone: "UTC", channel: { paired: true } }));
    const trackedId = await t.run((ctx) => ctx.db.insert("trackedAccounts", { creatorId, platform: "tiktok", handle: "fastguy", status: "active", addedBy: "creator", baselineN: 10, medianPace24h: 1000, createdAt: Date.now() } as never));
    for (let i = 0; i < 3; i++) {
      const ideaId = await seedIdea(t, creatorId);
      const r = await t.mutation(internal.taste.events.record, { creatorId, kind: "notme", ideaId });
      expect(r.ok).toBe(true);
    }
    const now = Date.now();
    const signalId = await t.run((ctx) => ctx.db.insert("signals", { creatorId, kind: "breakout", sourcePostIds: ["p9"], trackedAccountId: trackedId, score: 4, corroboration: { accounts: 1, soundRising: false }, verdict: "pending", why: "4x; https://www.tiktok.com/@fastguy/video/9", thresholdsVersion: "t", createdAt: now }));
    const g = await t.query(internal.scout.gate.railsFor, { creatorId, now: now + 13 * 3_600_000 }); // 13:00 UTC, outside quiet hours
    expect(g?.candidates.map((c) => c._id)).not.toContain(signalId);
    expect(g?.tasteDropped).toEqual([{ signalId, why: expect.stringMatching(/taste: passed on the last 3 like this \(@fastguy\)/) }]);
    const ideas = await t.run((ctx) => ctx.db.query("ideas").collect());
    expect(ideas.every((i) => i.status === "passed")).toBe(true);
  });

  it("a reaction on an idea message writes exactly one event and flips the idea to hearted", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a"));
    const ideaId = await seedIdea(t, creatorId);
    await t.run((ctx) => ctx.db.insert("messages", { creatorId, direction: "out", surface: "telegram", body: "an idea", ts: Date.now(), proactive: true, kind: "scout", ideaId, telegramMessageId: "555" }));
    const found = await t.query(internal.agent.converse.messageByTelegramId, { creatorId, telegramMessageId: "555" });
    expect(found?.ideaId).toBe(ideaId);
    await t.mutation(internal.taste.events.record, { creatorId, kind: "heart", ideaId, reaction: "🔥" });
    const idea = await t.run((ctx) => ctx.db.get(ideaId));
    expect(idea?.status).toBe("hearted");
    expect(idea?.reaction).toBe("🔥");
    expect(await t.run((ctx) => ctx.db.query("tasteEvents").collect())).toHaveLength(1);
    const c = await t.run((ctx) => ctx.db.get(creatorId));
    expect(c?.affinities.find((a) => a.key === "format:skit")?.score).toBe(1);
  });

  it("posted never regresses to passed; 'posted it' from the web is tenant-scoped", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { clerkUserId: "user_a" }));
    const ideaId = await seedIdea(t, creatorId);
    expect(await t.withIdentity({ subject: "user_zzz" }).mutation(api.taste.events.markPosted, { ideaId })).toEqual({ ok: false });
    expect(await t.withIdentity({ subject: "user_a" }).mutation(api.taste.events.markPosted, { ideaId })).toEqual({ ok: true });
    await t.mutation(internal.taste.events.record, { creatorId, kind: "notme", ideaId });
    const idea = await t.run((ctx) => ctx.db.get(ideaId));
    expect(idea?.status).toBe("posted");
    const c = await t.run((ctx) => ctx.db.get(creatorId));
    expect(c?.affinities.find((a) => a.key === "format:skit")?.n).toBe(2); // both events counted, status held
  });

  it("an event can never attach to another creator's idea", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => seedCreator(ctx, "a"));
    const b = await t.run((ctx) => seedCreator(ctx, "b", { clerkUserId: "u_b", handles: { tiktok: "tt_b" } }));
    const ideaId = await seedIdea(t, b);
    const r = await t.mutation(internal.taste.events.record, { creatorId: a, kind: "heart", ideaId });
    expect(r.ok).toBe(false);
    expect(await t.run((ctx) => ctx.db.query("tasteEvents").collect())).toHaveLength(0);
  });

  it("silence expires an idea at 72 h with a −0.3 event; an explore idea's silence costs nothing", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a"));
    const old = Date.now() - 4 * DAY;
    const quiet = await seedIdea(t, creatorId, { createdAt: old, sentAt: old });
    const explore = await seedIdea(t, creatorId, { createdAt: old, sentAt: old, newForYou: true, features: { format: "vlog", topics: [], tone: "warm", lengthBucket: "60+", sound: "none", source: "shape" } });
    const fresh = await seedIdea(t, creatorId);
    const r = await t.mutation(internal.taste.events.expireIgnored, {});
    expect(r.expired).toBe(2);
    expect((await t.run((ctx) => ctx.db.get(quiet)))?.status).toBe("expired");
    expect((await t.run((ctx) => ctx.db.get(explore)))?.status).toBe("expired");
    expect((await t.run((ctx) => ctx.db.get(fresh)))?.status).toBe("sent");
    const events = await t.run((ctx) => ctx.db.query("tasteEvents").collect());
    expect(events.map((e) => [e.ideaId, e.weight])).toEqual(expect.arrayContaining([[quiet, WEIGHTS.ignored], [explore, 0]]));
    const c = await t.run((ctx) => ctx.db.get(creatorId));
    expect(c?.affinities.find((a) => a.key === "format:skit")?.score).toBe(WEIGHTS.ignored);
    expect(c?.affinities.find((a) => a.key === "format:vlog")).toBeUndefined();
  });

  it("the prefix carries the taste note and the computed likes", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { taste: { text: "you take deadpan skits and ignore vlogs", version: 1, updatedAt: Date.now(), eventsSeen: 5 } }));
    for (let i = 0; i < 2; i++) await t.mutation(internal.taste.events.record, { creatorId, kind: "heart", ideaId: await seedIdea(t, creatorId) });
    const g = await t.query(internal.agent.context.gather, { creatorId });
    const { buildPrefix } = await import("../../agent/context");
    const prefix = buildPrefix({ creator: g!.creator, directives: g!.directives, skill: "x" });
    expect(prefix).toContain("you take deadpan skits and ignore vlogs");
    expect(prefix).toMatch(/took .*format skit \(\+2, 2\)/);
  });
});
