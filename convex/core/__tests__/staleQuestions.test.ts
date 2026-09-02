/**
 * The open-question rail only works if something ever closes the question. Two things do:
 * an inbound message (both doors), and their day ending (the nightly sweep). The sweep
 * existed with no caller, which is what muted the scout for thirteen days in the fortnight.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";

const NOON = Date.UTC(2026, 8, 2, 12, 0);

describe("an open question always gets closed", () => {
  it("answering closes it, through the plain inbound door too", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { timezone: "UTC", channel: { paired: true } }));
    await t.mutation(internal.core.messages.send, { creatorId, surface: "telegram", body: "want the shot list?", dedupeKey: "q:1", proactive: true, kind: "scout", awaitingAnswer: true });
    expect(await t.query(internal.core.messages.openQuestion, { creatorId })).not.toBeNull();
    await t.mutation(internal.core.messages.recordInbound, { creatorId, surface: "telegram", body: "yeah go on" });
    expect(await t.query(internal.core.messages.openQuestion, { creatorId })).toBeNull();
  });

  it("their day ending closes it, in THEIR timezone, and the sweep reaches every creator", async () => {
    const t = convexTest(schema, modules);
    // 12:00 UTC on 2 Sep is still 2 Sep in UTC but already 3 Sep in Tokyo.
    const utc = await t.run((ctx) => seedCreator(ctx, "a", { timezone: "UTC", channel: { paired: true } }));
    const tokyo = await t.run((ctx) => seedCreator(ctx, "b", { timezone: "Asia/Tokyo", channel: { paired: true } }));
    for (const creatorId of [utc, tokyo]) {
      await t.mutation(internal.core.messages.send, { creatorId, surface: "telegram", body: "want the shot list?", dedupeKey: "q:1", proactive: true, kind: "scout", awaitingAnswer: true, ts: NOON });
    }
    // Later the same UTC day: the Tokyo creator has rolled over, the UTC one has not.
    const r = await t.mutation(internal.core.messages.expireStaleQuestionsAll, { now: NOON + 6 * 3_600_000 });
    expect(r.expired).toBe(1);
    expect(await t.query(internal.core.messages.openQuestion, { creatorId: tokyo })).toBeNull();
    expect(await t.query(internal.core.messages.openQuestion, { creatorId: utc })).not.toBeNull();
    // Next UTC day: the last one closes too, so nothing stays open forever.
    await t.mutation(internal.core.messages.expireStaleQuestionsAll, { now: NOON + 30 * 3_600_000 });
    expect(await t.query(internal.core.messages.openQuestion, { creatorId: utc })).toBeNull();
  });

  it("the sweep is actually scheduled — the whole defect was a function with no caller", async () => {
    const { readFileSync } = await import("node:fs");
    const crons = readFileSync(new URL("../../crons.ts", import.meta.url), "utf8");
    expect(crons).toMatch(/expireStaleQuestionsAll/);
  });
});
