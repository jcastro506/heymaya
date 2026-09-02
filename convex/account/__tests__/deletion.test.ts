/**
 * §16.5: deletion is one procedure. The test creates a creator with a row in every
 * table keyed by creatorId (and checks the list covers the schema), freezes, asserts
 * a job enqueued after the freeze is rejected, purges, and asserts zero rows remain
 * while another creator's rows are untouched.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../../schema";
import { api, internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { TABLES_BY_CREATOR } from "../deletion";
import type { Id } from "../../_generated/dataModel";

const produced = { skillVersion: "t", model: "t", thresholdsVersion: "t" };

async function oneRowEverywhere(t: ReturnType<typeof convexTest>, creatorId: Id<"creators">) {
  await t.run(async (ctx) => {
    const now = Date.now();
    const tracked = await ctx.db.insert("trackedAccounts", { creatorId, platform: "tiktok", handle: "x", status: "active", addedBy: "creator", baselineN: 0, createdAt: now } as never);
    const post = await ctx.db.insert("ownPosts", { creatorId, platform: "tiktok", postId: "p1", url: "https://t", createTime: now, contentType: "video", hashtags: [], caption: "", metrics: { views: 1, likes: 0, comments: 0, shares: 0 }, metricsAsOf: now, source: "scrape" });
    await ctx.db.insert("ownPostReads", { creatorId, ownPostId: post, card: {}, depth: "read", produced, createdAt: now });
    const signal = await ctx.db.insert("signals", { creatorId, kind: "breakout", sourcePostIds: ["a"], trackedAccountId: tracked, score: 2, corroboration: { accounts: 1, soundRising: false }, verdict: "pending", why: "w", thresholdsVersion: "t", createdAt: now });
    const idea = await ctx.db.insert("ideas", { creatorId, signalId: signal, evidenceLinks: ["https://x"], fit: "yes", fitWhy: "f", version: {}, messageText: "m", status: "sent", produced, createdAt: now });
    await ctx.db.insert("predictions", { creatorId, subject: { ownPostId: post }, confidence: "fine", expectedMultiple: 1, opinion: {}, produced, createdAt: now });
    await ctx.db.insert("calendarBlocks", { creatorId, kind: "film", start: now, end: now + 1, title: "b", ideaId: idea, status: "proposed", createdAt: now });
    await ctx.db.insert("calendarEvents", { creatorId, calendarId: "primary", externalId: "e", title: "t", start: now, end: now + 1, allDay: false, recurring: false, class: "unknown", classifiedBy: "code", status: "active", updatedAt: now, createdAt: now });
    await ctx.db.insert("tasteEvents", { creatorId, ideaId: idea, kind: "heart", weight: 1, features: [], at: now });
    await ctx.db.insert("oauthStates", { creatorId, provider: "google", token: `tok_${creatorId}`, expiresAt: now + 1000, createdAt: now });
    await ctx.db.insert("connections", { creatorId, provider: "google_calendar", status: "connected", tokenRef: "enc", updatedAt: now });
    await ctx.db.insert("directives", { creatorId, kind: "rule", verbatim: "never dance", active: true, source: "chat", createdAt: now });
    await ctx.db.insert("messages", { creatorId, direction: "out", surface: "telegram", body: "hi", ts: now, proactive: false });
    await ctx.db.insert("jobs", { creatorId, kind: "converse", idempotencyKey: `j_${creatorId}`, status: "succeeded", attempts: 1, maxAttempts: 3, runAfter: now, deadlineAt: now + 1000, createdAt: now, updatedAt: now });
    await ctx.db.insert("budgets", { creatorId, day: "2026-09-02", screenerTokens: 0, writerTokens: 0, watches: 0, marginalCredits: 0, messages: 0, spentUsd: 0 });
    await ctx.db.insert("costEvents", { creatorId, vendor: "openrouter", kind: "m", units: 1, costUsd: 0.001, costSource: "endpoint_table", environment: "test", at: now });
  });
}

async function countFor(t: ReturnType<typeof convexTest>, creatorId: Id<"creators">): Promise<Record<string, number>> {
  return await t.run(async (ctx) => {
    const out: Record<string, number> = {};
    for (const table of TABLES_BY_CREATOR) out[table] = (await ctx.db.query(table).filter((q) => q.eq(q.field("creatorId"), creatorId)).collect()).length;
    out.creators = (await ctx.db.get(creatorId)) ? 1 : 0;
    return out;
  });
}

describe("deletion", () => {
  // requestDelete schedules the run; with fake timers it stays scheduled, so each step is asserted on its own.
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("TABLES_BY_CREATOR names every table in the schema that has a creatorId field", () => {
    const tables = Object.entries(schema.tables) as Array<[string, { validator?: { fields?: Record<string, unknown> } }]>;
    const withCreator = tables.filter(([name, t]) => name !== "creators" && t.validator?.fields && "creatorId" in t.validator.fields).map(([name]) => name).sort();
    expect(withCreator.length).toBeGreaterThan(10);
    expect([...TABLES_BY_CREATOR].sort()).toEqual(withCreator);
  });

  it("freezes, refuses new jobs, purges every row for one creator and none for another", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => seedCreator(ctx, "a", { clerkUserId: "user_a" }));
    const b = await t.run((ctx) => seedCreator(ctx, "b", { clerkUserId: "user_b", handles: { tiktok: "tt_b" } }));
    await oneRowEverywhere(t, a);
    await oneRowEverywhere(t, b);
    const before = await countFor(t, a);
    for (const table of TABLES_BY_CREATOR) expect(before[table], table).toBeGreaterThanOrEqual(1);

    // Typed confirmation, or nothing happens.
    expect((await t.withIdentity({ subject: "user_a" }).mutation(api.account.deletion.requestDelete, { confirm: "delete me" })).ok).toBe(false);
    expect((await t.run((ctx) => ctx.db.get(a)))?.plan.status).not.toBe("deleting");
    expect((await t.withIdentity({ subject: "user_a" }).mutation(api.account.deletion.requestDelete, { confirm: "DELETE" })).ok).toBe(true);
    expect((await t.run((ctx) => ctx.db.get(a)))?.plan.status).toBe("deleting");
    await expect(t.mutation(internal.core.jobs.enqueue, { kind: "converse", idempotencyKey: "after-freeze", creatorId: a })).rejects.toThrow(/deleting/);

    const purged = await t.mutation(internal.account.deletion.purgeRows, { creatorId: a });
    expect(purged.deleted).toBeGreaterThan(TABLES_BY_CREATOR.length);
    const after = await countFor(t, a);
    for (const [table, n] of Object.entries(after)) expect(n, table).toBe(0);
    const other = await countFor(t, b);
    for (const table of TABLES_BY_CREATOR) expect(other[table], table).toBeGreaterThanOrEqual(1);
    expect(other.creators).toBe(1);
  });
});
