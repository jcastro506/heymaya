/** §16: the alert says only what is new and never content; retention deletes by age and nothing else. */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { composeAlert } from "../alerts";

const DAY = 86_400_000;

describe("alerts", () => {
  it("is quiet with nothing to say, and names ids not content", () => {
    expect(composeAlert({ deadJobs: [], undelivered: [], smokeFailed: [], attention: [] }, "dev")).toBeNull();
    const text = composeAlert({ deadJobs: [{ id: "j1", kind: "converse", error: "boom" }], undelivered: [{ id: "m1", creatorId: "jn7abcdef", ageMin: 90, error: "chat not found" }], smokeFailed: [{ vendor: "gemini", check: "models" }], attention: [] }, "dev")!;
    expect(text).toContain("dead job");
    expect(text).toContain("abcdef");
    expect(text).toContain("gemini/models");
    expect(text).not.toContain("jn7abcdef1234"); // only a tail of the id
  });

  it("finds only what is new since the last look", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a"));
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("jobs", { creatorId, kind: "converse", idempotencyKey: "old", status: "dead", attempts: 3, maxAttempts: 3, runAfter: now, deadlineAt: now, createdAt: now - 3 * DAY, updatedAt: now - 3 * DAY, lastError: "old" });
      await ctx.db.insert("jobs", { creatorId, kind: "scout", idempotencyKey: "new", status: "dead", attempts: 3, maxAttempts: 3, runAfter: now, deadlineAt: now, createdAt: now - 600_000, updatedAt: now - 600_000, lastError: "fresh" });
      await ctx.db.insert("messages", { creatorId, direction: "out", surface: "telegram", body: "secret text", ts: now - 2 * 3_600_000, proactive: true, deliveryError: "chat not found" });
    });
    const f = await t.query(internal.core.alerts.findings, { since: now - 3_600_000, now });
    expect(f.deadJobs.map((j) => j.error)).toEqual(["fresh"]);
    expect(f.undelivered).toHaveLength(1);
    expect(JSON.stringify(f)).not.toContain("secret text");
  });
});

describe("retention", () => {
  it("deletes messages past a year and calendar rows past ninety days, keeps the rest", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a"));
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("messages", { creatorId, direction: "in", surface: "telegram", body: "old", ts: now - 400 * DAY });
      await ctx.db.insert("messages", { creatorId, direction: "in", surface: "telegram", body: "recent", ts: now - 10 * DAY });
      await ctx.db.insert("calendarEvents", { creatorId, calendarId: "p", externalId: "old", title: "x", start: now - 100 * DAY, end: now - 100 * DAY + 1, allDay: false, recurring: false, class: "routine", classifiedBy: "code", status: "active", updatedAt: now, createdAt: now });
      await ctx.db.insert("calendarEvents", { creatorId, calendarId: "p", externalId: "new", title: "y", start: now + DAY, end: now + DAY + 1, allDay: false, recurring: false, class: "filmable", classifiedBy: "code", status: "active", updatedAt: now, createdAt: now });
    });
    const r = await t.mutation(internal.core.retention.nightly, { now });
    expect(r).toEqual({ messages: 1, calendarEvents: 1, oauthStates: 0 });
    expect((await t.run((ctx) => ctx.db.query("messages").collect())).map((m) => m.body)).toEqual(["recent"]);
    expect((await t.run((ctx) => ctx.db.query("calendarEvents").collect())).map((e) => e.externalId)).toEqual(["new"]);
  });
});
