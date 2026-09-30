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
    await ctx.db.insert("partnershipProfiles", { creatorId, data: {}, updatedAt: now });
    const opportunityId = await ctx.db.insert("partnershipOpportunities", { creatorId, brandDomain: "brand.com", data: {}, updatedAt: now });
    await ctx.db.insert("partnershipDrafts", { creatorId, opportunityId, data: {}, updatedAt: now });
    await ctx.db.insert("partnershipEvents", { creatorId, opportunityId, key: "event", kind: "test", text: "test", at: now });
    await ctx.db.insert("partnershipResearch", { creatorId, month: "2026-09", calls: 1, data: [], updatedAt: now });
    await ctx.db.insert("partnershipMailboxes", { creatorId, email: "me@example.com", tokenRef: "encrypted", generation: "test", updatedAt: now });
    await ctx.db.insert("mediaKits", { creatorId, showAudience: false, updatedAt: now });
    await ctx.db.insert("kitVariants", { creatorId, opportunityId, slug: `slug${String(creatorId).slice(-8)}`, brand: "Brand", postUrls: [], idea: "an idea for them", createdAt: now });
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
    await ctx.db.insert("memories", { creatorId, kind: "note", refId: `n_${creatorId}`, text: "x", embedding: Array.from({ length: 768 }, () => 0.01), at: now });
    const draft = await ctx.db.insert("messages", { creatorId, direction: "in", surface: "telegram", body: "", ts: now });
    await ctx.db.insert("finishes", { creatorId, messageId: draft, card: {}, captions: [], sounds: [], lookups: [], createdAt: now });
    await ctx.db.insert("personalRecords", { creatorId, key: "decision", kind: "decision", text: "a decision", sourceMessageIds: [], sourcePostIds: [], sourceNoteIds: [], active: true, at: now });
    await ctx.db.insert("laneReads", { creatorId, token: "t1", keywords: ["running"], at: now });
    await ctx.db.insert("followerSnapshots", { creatorId, platform: "tiktok", accountId: "acc", day: "2026-09-05", followers: 2, at: now });
    await ctx.db.insert("accountInsights", { creatorId, platform: "instagram", accountId: "acc", kind: "audience", status: "ok", audience: { gender: [{ label: "F", value: 2, share: 1 }] }, fetchedAt: now });
    const run = await ctx.db.insert("evalRuns", { suite: "recent", skill: "reply", creatorId, text: "x", checks: [], pass: true, at: now });
    await ctx.db.insert("evalLabels", { evalRunId: run, creatorId, skill: "reply", label: "good", reason: "", by: "operator", at: now });
    await ctx.db.insert("userActions", { creatorId, kind: "idea.pass", source: "app", summary: "passed on an idea", at: now });
    await ctx.db.insert("engageLinks", { creatorId, code: `c${String(creatorId).slice(-9)}`, key: "tiktok:1", handle: "someone", url: "https://www.tiktok.com/@someone/video/1", sentAt: now, opens: 0 });
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

describe("deleting the sign-in (step 8)", () => {
  it("deletes the Clerk user by id; 404 is already gone; sims and a missing key never call out", async () => {
    const { deleteClerkUser } = await import("../deletion");
    const calls: Array<{ url: string; method?: string }> = [];
    const fake = (status: number) => (async (url: string, init?: RequestInit) => { calls.push({ url, method: init?.method }); return new Response(null, { status }); }) as unknown as typeof fetch;
    const prev = process.env.CLERK_SECRET_KEY;
    process.env.CLERK_SECRET_KEY = "sk_test_x";
    try {
      expect(await deleteClerkUser("user_abc123", fake(200))).toBe("deleted");
      expect(calls[0]).toEqual({ url: "https://api.clerk.com/v1/users/user_abc123", method: "DELETE" });
      expect(await deleteClerkUser("user_abc123", fake(404))).toBe("already gone");
      expect(await deleteClerkUser("user_abc123", fake(500))).toBe("delete failed: HTTP 500");
      calls.length = 0;
      for (const id of ["eval:partner", "eval-load:1", "user_../../x", ""]) expect(await deleteClerkUser(id, fake(200))).toBe("no sign-in to delete");
      expect(calls).toHaveLength(0);
      delete process.env.CLERK_SECRET_KEY;
      expect(await deleteClerkUser("user_abc123", fake(200))).toBe("not configured; the sign-in remains");
      expect(calls).toHaveLength(0);
    } finally {
      if (prev === undefined) delete process.env.CLERK_SECRET_KEY; else process.env.CLERK_SECRET_KEY = prev;
    }
  });
});
