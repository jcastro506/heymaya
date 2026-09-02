/**
 * §17.2 the simulated day, on fixtures and the fake model, for free: a breakout in the
 * lane → the gate → the scout → an idea row and a message with buttons → the verdict on
 * the signal → the cap holds → a reaction is a taste event → the review on Sunday. Every
 * assertion is on rows; no prose is matched.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import schema from "../schema";
import { internal } from "../_generated/api";
import { modules } from "../../tests/_modules";
import { seedCreator } from "../../tests/lib/creatorRow";
import type { Id } from "../_generated/dataModel";

beforeAll(() => {
  process.env.MODEL_FAKE = "1";
  process.env.SCRAPE_FIXTURES = "spec";
});
afterEach(() => vi.useRealTimers());

async function scenario() {
  const t = convexTest(schema, modules);
  const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { timezone: "UTC", channel: { paired: true }, dossier: { persona: { summary: "runner" }, keywords: ["running"], cadence: { postsPerWeek: 2 } }, plan: { status: "active", founding: true } }));
  const trackedId = await t.run((ctx) => ctx.db.insert("trackedAccounts", { creatorId, platform: "tiktok", handle: "runwithcarly", status: "active", addedBy: "creator", baselineN: 12, medianPace24h: 4000, createdAt: Date.now() } as never));
  const now = Date.UTC(2026, 8, 2, 13, 0); // 13:00 UTC, a Wednesday, outside quiet hours
  vi.useFakeTimers({ now, toFake: ["Date"] });
  const signalId = await t.run((ctx) => ctx.db.insert("signals", { creatorId, kind: "breakout", sourcePostIds: ["7395965676629888274"], trackedAccountId: trackedId, score: 6.2, corroboration: { accounts: 2, soundRising: false }, verdict: "pending", why: "6.2x their normal after 9h; https://www.tiktok.com/@runwithcarly/video/7395965676629888274", thresholdsVersion: "t", createdAt: now - 3_600_000 }));
  return { t, creatorId, signalId, now };
}

describe("a simulated day", () => {
  it("breakout → scout → idea and message rows → verdict → cap → reaction → taste", async () => {
    const { t, creatorId, signalId } = await scenario();
    const r = await t.action(internal.scout.scout.run, { creatorId });
    expect(r.sent).toBe(true);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const ideas = await t.run((ctx) => ctx.db.query("ideas").collect());
    expect(ideas).toHaveLength(1);
    expect(ideas[0].status).toBe("sent");
    expect(ideas[0].evidenceLinks[0]).toContain("tiktok.com");
    expect(ideas[0].features?.format).toBe("talking-head");
    const signal = await t.run((ctx) => ctx.db.get(signalId));
    expect(signal?.verdict).toBe("sent");

    const outbound = (await t.run((ctx) => ctx.db.query("messages").collect())).filter((m) => m.direction === "out");
    expect(outbound).toHaveLength(1);
    expect(outbound[0].kind).toBe("scout");
    expect(outbound[0].buttons?.map((b) => b.id.split(":").pop())).toEqual(["shotlist", "notme", "save"]);
    expect(outbound[0].links?.[0]).toContain("tiktok.com");
    expect(outbound[0].proactive).toBe(true);

    // Nothing new to judge: the same run again sends nothing.
    const again = await t.action(internal.scout.scout.run, { creatorId });
    expect(again.sent).toBe(false);

    // Their heart on the idea is a taste event and flips the row.
    await t.mutation(internal.taste.events.record, { creatorId, kind: "heart", ideaId: ideas[0]._id as Id<"ideas">, reaction: "🔥" });
    expect((await t.run((ctx) => ctx.db.get(ideas[0]._id)))?.status).toBe("hearted");
    const creator = await t.run((ctx) => ctx.db.get(creatorId));
    expect(creator?.affinities.find((a) => a.key === "format:talking-head")?.score).toBe(1);

    // The day's budget row carries the proactive message.
    const budgets = await t.run((ctx) => ctx.db.query("budgets").collect());
    expect(budgets.some((b) => b.messages >= 1)).toBe(true);
  });

  it("the cap holds: three proactive sends today and the rails refuse a fourth", async () => {
    const { t, creatorId, now } = await scenario();
    await t.run(async (ctx) => {
      for (let i = 0; i < 3; i++) await ctx.db.insert("messages", { creatorId, direction: "out", surface: "telegram", body: `idea ${i}`, ts: now - (i + 1) * 60_000, proactive: true, kind: "scout", deliveredAt: now });
    });
    const g = await t.query(internal.scout.gate.railsFor, { creatorId, now });
    expect(g?.rails.ok).toBe(false);
    expect(g?.rails.reason).toMatch(/daily cap/);
    const r = await t.action(internal.scout.scout.run, { creatorId });
    expect(r.sent).toBe(false);
    expect((await t.run((ctx) => ctx.db.query("ideas").collect()))).toHaveLength(0);
  });

  it("a link from them → the opinion skill → a prediction on the record and a reply, no proactive row", async () => {
    const { t, creatorId } = await scenario();
    const { messageId } = await t.mutation(internal.core.messages.recordInbound, { creatorId, surface: "telegram", body: "what do you think https://www.tiktok.com/@runwithcarly/video/7395965676629888274" });
    const c = await t.action(internal.agent.converse.run, { creatorId, messageId });
    expect(c.ok, c.reason ?? "").toBe(true);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const preds = await t.run((ctx) => ctx.db.query("predictions").collect());
    expect(preds).toHaveLength(1);
    expect(preds[0].subject.url).toContain("7395965676629888274");
    expect(preds[0].confidence).toBe("solid");
    expect(preds[0].expectedMultiple).toBeGreaterThan(0);
    const out = (await t.run((ctx) => ctx.db.query("messages").collect())).filter((m) => m.direction === "out");
    expect(out).toHaveLength(1);
    expect(out[0].proactive).toBeFalsy();
    // Every vendor read on the way was a fixture: cost rows carry zero dollars but name the vendor.
    const costs = await t.run((ctx) => ctx.db.query("costEvents").collect());
    expect(costs.every((e) => e.costUsd === 0 && e.vendor)).toBe(true);
  });

  it("the review runs on the fake model and writes the experiment ledger and a review message", async () => {
    const { t, creatorId } = await scenario();
    const r = await t.action(internal.review.weekly.run, { creatorId });
    expect(r.sent).toBe(true);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const c = await t.run((ctx) => ctx.db.get(creatorId));
    expect(c?.experiments[0]?.text).toContain("opens on an object");
    const review = (await t.run((ctx) => ctx.db.query("messages").collect())).find((m) => m.kind === "review");
    expect(review?.proactive).toBe(true);
    // No survey follows the review (Josh's rule).
    expect((await t.run((ctx) => ctx.db.query("messages").collect())).filter((m) => m.kind === "checkin")).toHaveLength(0);
  });
});
