/**
 * §17.2 the simulated fortnight, on fixtures and the fake model: a breakout every day for
 * fourteen days, the scout every day, the review on both Sundays, one inbound text a day.
 * Promises checked as rows: never more than three proactive messages in a creator-day,
 * nothing proactive inside quiet hours, at most one open question at any moment, a
 * dedupe key on every proactive row, and not a cent of model spend.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import schema from "../schema";
import { internal } from "../_generated/api";
import { modules } from "../../tests/_modules";
import { seedCreator } from "../../tests/lib/creatorRow";

beforeAll(() => {
  process.env.MODEL_FAKE = "1";
  process.env.SCRAPE_FIXTURES = "spec";
});
afterEach(() => vi.useRealTimers());

const DAY = 86_400_000;
const TEXTS = ["love it", "not this one", "busy this week, keep them coming", "what did you think of my last one"];
const START = Date.UTC(2026, 8, 1, 13, 0); // Tuesday 1 Sep 2026, 13:00 UTC; Sundays fall on days 6 and 13

describe("a simulated fortnight", () => {
  it("fourteen days of scout and review keep every promise, on rows", async () => {
    const t = convexTest(schema, modules);
    vi.useFakeTimers({ now: START, toFake: ["Date"] });
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { timezone: "UTC", channel: { paired: true }, dossier: { persona: { summary: "runner" }, keywords: ["running"], cadence: { postsPerWeek: 2 } }, plan: { status: "active", founding: true } }));
    const trackedId = await t.run((ctx) => ctx.db.insert("trackedAccounts", { creatorId, platform: "tiktok", handle: "runwithcarly", status: "active", addedBy: "creator", baselineN: 12, medianPace24h: 4000, createdAt: START } as never));
    // A neighbour in the same lane, paired but never given a signal: nothing of A's may reach B.
    const neighbourId = await t.run((ctx) => seedCreator(ctx, "b", { timezone: "UTC", channel: { paired: true }, dossier: { persona: { summary: "runner too" }, keywords: ["running"], cadence: { postsPerWeek: 2 } }, plan: { status: "active", founding: true } }));

    const sentDays: number[] = [];
    for (let day = 0; day < 14; day++) {
      const now = START + day * DAY;
      vi.setSystemTime(now);
      await t.run((ctx) => ctx.db.insert("signals", { creatorId, kind: "breakout", sourcePostIds: [`73959656766298882${(70 + day).toString()}`], trackedAccountId: trackedId, score: 5 + day * 0.1, corroboration: { accounts: 2, soundRising: false }, verdict: "pending", why: `${(5 + day * 0.1).toFixed(1)}x their normal after 9h; https://www.tiktok.com/@runwithcarly/video/73959656766298882${70 + day}`, thresholdsVersion: "t", createdAt: now - 3_600_000 }));
      const r = await t.action(internal.scout.scout.run, { creatorId });
      if (r.sent) sentDays.push(day);
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      // One text from them a day, through the classifier and converse: a reply, never a proactive row.
      vi.setSystemTime(now + 2 * 3_600_000);
      const { messageId } = await t.mutation(internal.core.messages.recordInbound, { creatorId, surface: "telegram", body: TEXTS[day % TEXTS.length] });
      const c = await t.action(internal.agent.converse.run, { creatorId, messageId });
      expect(c.ok, `converse on day ${day}: ${c.reason ?? ""}`).toBe(true);
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      await t.mutation(internal.taste.events.expireIgnored, { now: now + 12 * 3_600_000 });
      // The nightly sweep: a question they never answered stops being askable when their day ends.
      await t.mutation(internal.core.messages.expireStaleQuestionsAll, { now: now + 20 * 3_600_000 });
      if (new Date(now).getUTCDay() === 0) {
        const rv = await t.action(internal.review.weekly.run, { creatorId });
        expect(rv.sent, `review on day ${day}`).toBe(true);
        await t.finishAllScheduledFunctions(vi.runAllTimers);
      }
    }

    const out = (await t.run((ctx) => ctx.db.query("messages").collect())).filter((m) => m.direction === "out");
    const proactive = out.filter((m) => m.proactive);
    expect(proactive.length).toBeGreaterThanOrEqual(10);
    // Fourteen replies, none of them proactive, none carrying a dedupe key of the scout's.
    const replies = out.filter((m) => !m.proactive);
    expect(replies.length).toBeGreaterThanOrEqual(14);
    expect((await t.run((ctx) => ctx.db.query("messages").collect())).filter((m) => m.direction === "in")).toHaveLength(14);

    // Never more than three proactive in a creator-day; nothing inside quiet hours (22:00–07:00 UTC here).
    const perDay = new Map<string, number>();
    for (const m of proactive) {
      const d = new Date(m.ts);
      perDay.set(d.toISOString().slice(0, 10), (perDay.get(d.toISOString().slice(0, 10)) ?? 0) + 1);
      expect(d.getUTCHours() >= 7 && d.getUTCHours() < 22, `sent at ${d.toISOString()}`).toBe(true);
      expect(m.dedupeKey, "every proactive row carries a dedupe key").toBeTruthy();
    }
    for (const [day, n] of perDay) expect(n, day).toBeLessThanOrEqual(3);

    // At most one open question at any moment.
    expect(out.filter((m) => m.awaitingAnswer).length).toBeLessThanOrEqual(1);

    // Two Sunday reviews, each with an experiment on the ledger; ideas one per sent day, verdicts on the signals.
    expect(out.filter((m) => m.kind === "review")).toHaveLength(2);
    const c = await t.run((ctx) => ctx.db.get(creatorId));
    expect(c?.experiments.length).toBeGreaterThanOrEqual(2);
    const ideas = await t.run((ctx) => ctx.db.query("ideas").collect());
    expect(ideas.length).toBe(sentDays.length);
    const signals = await t.run((ctx) => ctx.db.query("signals").collect());
    expect(signals.filter((s) => s.verdict === "pending")).toHaveLength(0);

    // Cross-tenant: the neighbour got nothing, and every row of A's names A.
    const nb = await t.action(internal.scout.scout.run, { creatorId: neighbourId });
    expect(nb.sent).toBe(false);
    for (const table of ["ideas", "messages", "signals", "tasteEvents"] as const) {
      const rows = await t.run((ctx) => ctx.db.query(table).collect());
      expect(rows.filter((r) => r.creatorId === neighbourId), table).toHaveLength(0);
      expect(rows.every((r) => r.creatorId === creatorId), table).toBe(true);
    }

    // Not a cent of model spend, and every cost row names a vendor.
    const costs = await t.run((ctx) => ctx.db.query("costEvents").collect());
    for (const e of costs) { expect(e.costUsd).toBe(0); expect(e.vendor).toBeTruthy(); }
  });
});
