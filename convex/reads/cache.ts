/**
 * readCache rows: the cache half of `read()` (plan §3.2). Internal-only.
 *
 * Claiming marks a key in-flight so N concurrent readers produce one vendor call
 * (the thundering-herd rule, §3.75). A claim older than `STALE_CLAIM_MS` is
 * treated as abandoned and re-claimed.
 */

import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

export const STALE_CLAIM_MS = 90_000;

export const getFresh = internalQuery({
  args: { kind: v.string(), key: v.string(), now: v.number() },
  handler: async (ctx, { kind, key, now }) => {
    const row = await ctx.db
      .query("readCache")
      .withIndex("by_key", (q) => q.eq("kind", kind).eq("key", key))
      .unique();
    if (!row) return { state: "missing" as const };
    const fresh = row.value !== undefined && row.expiresAt > now;
    const inFlight = row.inFlightSince !== undefined && now - row.inFlightSince < STALE_CLAIM_MS;
    if (fresh) return { state: "fresh" as const, value: row.value, fetchedAt: row.fetchedAt, fixture: row.fixture };
    if (inFlight) return { state: "inFlight" as const };
    return { state: "stale" as const, value: row.value };
  },
});

export const claim = internalMutation({
  args: { kind: v.string(), key: v.string(), params: v.any(), now: v.number() },
  handler: async (ctx, { kind, key, params, now }) => {
    const row = await ctx.db
      .query("readCache")
      .withIndex("by_key", (q) => q.eq("kind", kind).eq("key", key))
      .unique();
    if (row) {
      const fresh = row.value !== undefined && row.expiresAt > now;
      if (fresh) return { claimed: false as const, value: row.value };
      const inFlight = row.inFlightSince !== undefined && now - row.inFlightSince < STALE_CLAIM_MS;
      if (inFlight) return { claimed: false as const, inFlight: true as const };
      await ctx.db.patch(row._id, { inFlightSince: now, error: undefined });
      return { claimed: true as const };
    }
    await ctx.db.insert("readCache", { kind, key, params, expiresAt: 0, inFlightSince: now });
    return { claimed: true as const };
  },
});

export const store = internalMutation({
  args: {
    kind: v.string(),
    key: v.string(),
    value: v.any(),
    now: v.number(),
    ttlMs: v.number(),
    credits: v.number(),
    costUsd: v.number(),
    costSource: v.union(v.literal("vendor_reported"), v.literal("endpoint_table")),
    fixture: v.optional(v.union(v.literal("recorded"), v.literal("spec-example"))),
    creatorId: v.optional(v.id("creators")),
    environment: v.string(),
  },
  handler: async (ctx, a) => {
    const row = await ctx.db
      .query("readCache")
      .withIndex("by_key", (q) => q.eq("kind", a.kind).eq("key", a.key))
      .unique();
    const patch = {
      value: a.value,
      fetchedAt: a.now,
      expiresAt: a.now + a.ttlMs,
      inFlightSince: undefined,
      error: undefined,
      credits: a.credits,
      fixture: a.fixture,
    };
    if (row) await ctx.db.patch(row._id, patch);
    else await ctx.db.insert("readCache", { kind: a.kind, key: a.key, params: {}, ...patch });
    if (a.credits > 0 || a.costUsd > 0) {
      await ctx.db.insert("costEvents", {
        creatorId: a.creatorId,
        vendor: "scrapecreators",
        kind: a.kind,
        units: a.credits,
        costUsd: a.costUsd,
        costSource: a.costSource,
        environment: a.environment,
        at: a.now,
      });
    }
  },
});

export const fail = internalMutation({
  args: { kind: v.string(), key: v.string(), error: v.string(), now: v.number() },
  handler: async (ctx, { kind, key, error, now }) => {
    const row = await ctx.db
      .query("readCache")
      .withIndex("by_key", (q) => q.eq("kind", kind).eq("key", key))
      .unique();
    if (row) await ctx.db.patch(row._id, { inFlightSince: undefined, error, expiresAt: now + 5 * 60 * 1000 });
  },
});
