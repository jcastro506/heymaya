/**
 * Phase 2 ④ — WATERMARK / DELTA-READ MECHANISM.
 *
 * Today the read workers do full re-pulls every run. This module supplies the
 * primitives the (coming Phase-3) hunt loop will consume so it reads only NEW
 * items per channel — never re-pulling history — and rotates across watch
 * lanes round-robin instead of sweeping every channel each tick.
 *
 * Split into two layers:
 *
 *   1. PURE helpers (no Convex) — unit-testable in isolation:
 *        - `filterNewItems`     : drop everything at/before the watermark.
 *        - `nextWatermarkFrom`  : advance the watermark from a fresh page,
 *                                 monotonically (never moves backward).
 *
 *   2. Convex internal mutations/queries over `gtmChannelWatermarks` and
 *      `gtmWatchLaneState`, every one scoped strictly by `accountId`
 *      (fail-closed cross-tenant isolation).
 *
 * This module delivers the MECHANISM only. It is intentionally NOT wired into
 * the existing platform/research workers — the Phase-3 pulse consumes it.
 */

import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
} from "../_generated/server";

// ---------------------------------------------------------------------------
// 1. Pure helpers (no Convex — directly unit-testable)
// ---------------------------------------------------------------------------

/** The minimal watermark shape the pure helpers reason about. */
export interface WatermarkPosition {
  /** Newest item timestamp (ms) already observed. Items at/before are seen. */
  lastObservedAtMs?: number;
  /** Stable id of the newest observed item — tie-breaker at the boundary. */
  lastSeenId?: string;
}

/**
 * Drop every item at or before the watermark, returning only the genuinely-new
 * ones. Input ordering (newest-first) is preserved in the output.
 *
 * Rules:
 *  - Empty / absent watermark  → every item is new (returned unchanged).
 *  - Item timestamp > watermark.lastObservedAtMs → NEW.
 *  - Item timestamp < watermark.lastObservedAtMs → SEEN (dropped).
 *  - Item timestamp == watermark.lastObservedAtMs (a tie at the boundary):
 *      the item whose id == lastSeenId is the watermark itself → SEEN, and is
 *      the STOP boundary: every other same-ts item is treated as already-seen
 *      too (we cannot prove a same-ms sibling is newer, so fail-closed and
 *      drop it rather than risk re-surfacing history). Items with a missing
 *      timestamp are conservatively dropped once a watermark exists.
 *
 * `getTs` / `getId` are the per-item accessors so this stays platform-agnostic.
 */
export function filterNewItems<T>(
  items: T[],
  watermark: WatermarkPosition | null | undefined,
  getTs: (item: T) => number | undefined,
  getId: (item: T) => string | undefined
): T[] {
  if (!Array.isArray(items) || items.length === 0) return [];

  const wmTs =
    watermark && typeof watermark.lastObservedAtMs === "number" &&
    Number.isFinite(watermark.lastObservedAtMs)
      ? watermark.lastObservedAtMs
      : undefined;
  const wmId =
    watermark && typeof watermark.lastSeenId === "string" && watermark.lastSeenId !== ""
      ? watermark.lastSeenId
      : undefined;

  // No watermark at all → everything is new.
  if (wmTs === undefined && wmId === undefined) return items.slice();

  return items.filter((item) => {
    const ts = getTs(item);
    const id = getId(item);

    // The exact watermark row is, by definition, already seen.
    if (wmId !== undefined && id === wmId) return false;

    // With a timestamp watermark we can decide by time.
    if (wmTs !== undefined) {
      if (typeof ts !== "number" || !Number.isFinite(ts)) {
        // Undated item while a dated watermark exists → can't prove it's new.
        return false;
      }
      // Strictly newer than the watermark = new. At/before = seen.
      return ts > wmTs;
    }

    // Id-only watermark (no timestamp): we already excluded the matching id
    // above; without a timestamp we can't order, so everything before the
    // matching id in a newest-first page is new and everything after is seen.
    // We approximate by keeping items until we hit lastSeenId. Since the id
    // case with no timestamp is rare, treat all non-matching items as new.
    return true;
  });
}

/**
 * Compute the advanced watermark from a fresh page of items. Picks the item
 * with the maximum timestamp and reports its id. Never moves backward: if the
 * page's newest is not strictly newer than the current watermark, the current
 * watermark is returned unchanged.
 *
 * Returns the new {lastObservedAtMs, lastSeenId}. If neither the page nor the
 * current watermark carries a usable timestamp, returns the current watermark
 * (or an empty position).
 */
export function nextWatermarkFrom<T>(
  items: T[],
  current: WatermarkPosition | null | undefined,
  getTs: (item: T) => number | undefined,
  getId: (item: T) => string | undefined
): WatermarkPosition {
  const curTs =
    current && typeof current.lastObservedAtMs === "number" &&
    Number.isFinite(current.lastObservedAtMs)
      ? current.lastObservedAtMs
      : undefined;
  const curId =
    current && typeof current.lastSeenId === "string" && current.lastSeenId !== ""
      ? current.lastSeenId
      : undefined;

  const base: WatermarkPosition = {};
  if (curTs !== undefined) base.lastObservedAtMs = curTs;
  if (curId !== undefined) base.lastSeenId = curId;

  if (!Array.isArray(items) || items.length === 0) return base;

  // Find the page's newest dated item.
  let bestTs: number | undefined;
  let bestId: string | undefined;
  for (const item of items) {
    const ts = getTs(item);
    if (typeof ts !== "number" || !Number.isFinite(ts)) continue;
    if (bestTs === undefined || ts > bestTs) {
      bestTs = ts;
      bestId = getId(item);
    }
  }

  // No dated item in the page → cannot advance, keep current.
  if (bestTs === undefined) return base;

  // Monotonic: only advance if strictly newer than the current watermark.
  if (curTs !== undefined && bestTs <= curTs) return base;

  const next: WatermarkPosition = { lastObservedAtMs: bestTs };
  if (typeof bestId === "string" && bestId !== "") next.lastSeenId = bestId;
  return next;
}

// ---------------------------------------------------------------------------
// 2. Convex internal mutations / queries — per-channel watermark
// ---------------------------------------------------------------------------

/**
 * Read the watermark row for (accountId, channel). Returns null if none.
 * Scoped by accountId via `by_account_and_channel` — cross-tenant safe.
 */
export const getChannelWatermark = internalQuery({
  args: {
    accountId: v.id("creators"),
    channel: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("gtmChannelWatermarks")
      .withIndex("by_account_and_channel", (q) =>
        q.eq("accountId", args.accountId).eq("channel", args.channel)
      )
      .first();
    return row ?? null;
  },
});

/**
 * Upsert the watermark for (accountId, channel). Monotonic in lastObservedAtMs:
 * a regressing timestamp is ignored (the existing newer value is kept), and the
 * matching id/cursor only advance alongside a forward (or first) timestamp.
 * A cursor with no timestamp change is still persisted (opaque pagination).
 */
export const advanceChannelWatermark = internalMutation({
  args: {
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    channel: v.string(),
    lastObservedAtMs: v.optional(v.number()),
    lastSeenId: v.optional(v.string()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("gtmChannelWatermarks")
      .withIndex("by_account_and_channel", (q) =>
        q.eq("accountId", args.accountId).eq("channel", args.channel)
      )
      .first();

    const incomingTs =
      typeof args.lastObservedAtMs === "number" &&
      Number.isFinite(args.lastObservedAtMs)
        ? args.lastObservedAtMs
        : undefined;

    if (!existing) {
      await ctx.db.insert("gtmChannelWatermarks", {
        accountId: args.accountId,
        agentId: args.agentId,
        channel: args.channel,
        lastObservedAtMs: incomingTs,
        lastSeenId: args.lastSeenId,
        cursor: args.cursor,
        updatedAt: now,
      });
      return;
    }

    const existingTs = existing.lastObservedAtMs;
    // Does the timestamp move forward (or set for the first time)?
    const advances =
      incomingTs !== undefined &&
      (existingTs === undefined || incomingTs > existingTs);

    const patch: {
      lastObservedAtMs?: number;
      lastSeenId?: string;
      cursor?: string;
      updatedAt: number;
    } = { updatedAt: now };

    if (advances) {
      // Move the position forward — timestamp + its id travel together.
      patch.lastObservedAtMs = incomingTs;
      if (args.lastSeenId !== undefined) patch.lastSeenId = args.lastSeenId;
    }
    // The cursor is opaque pagination state; persist whenever provided, even
    // when the timestamp didn't advance (e.g. an empty/dry page hands back a
    // fresh cursor to resume from).
    if (args.cursor !== undefined) patch.cursor = args.cursor;

    await ctx.db.patch(existing._id, patch);
  },
});

// ---------------------------------------------------------------------------
// 2b. Convex internal mutations / queries — watch-lane scheduler state
// ---------------------------------------------------------------------------

/**
 * All watch-lane rows for an account (for the scheduler to inspect). Scoped by
 * accountId via `by_account` — cross-tenant safe.
 */
export const getWatchLaneState = internalQuery({
  args: { accountId: v.id("creators") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("gtmWatchLaneState")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .collect();
  },
});

/**
 * Mark a lane as just-run. Sets lastRunAtMs = now and the supplied nextDueAtMs.
 * `dry` controls the dry-run streak: when true the consecutiveDryRuns counter
 * increments (the run produced no new items); when false it resets to 0.
 * Upsert on (accountId, lane).
 */
export const touchWatchLane = internalMutation({
  args: {
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    lane: v.string(),
    nextDueAtMs: v.optional(v.number()),
    dry: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("gtmWatchLaneState")
      .withIndex("by_account_and_lane", (q) =>
        q.eq("accountId", args.accountId).eq("lane", args.lane)
      )
      .first();

    if (!existing) {
      await ctx.db.insert("gtmWatchLaneState", {
        accountId: args.accountId,
        agentId: args.agentId,
        lane: args.lane,
        lastRunAtMs: now,
        nextDueAtMs: args.nextDueAtMs,
        consecutiveDryRuns: args.dry === true ? 1 : 0,
        updatedAt: now,
      });
      return;
    }

    const prevStreak =
      typeof existing.consecutiveDryRuns === "number" &&
      Number.isFinite(existing.consecutiveDryRuns)
        ? existing.consecutiveDryRuns
        : 0;
    const nextStreak = args.dry === true ? prevStreak + 1 : 0;

    await ctx.db.patch(existing._id, {
      lastRunAtMs: now,
      nextDueAtMs: args.nextDueAtMs,
      consecutiveDryRuns: nextStreak,
      updatedAt: now,
    });
  },
});

/**
 * Round-robin selector: from the supplied set of lanes, return the one most
 * due to run now — an UNSEEN lane (no state row yet) always wins first; among
 * seen lanes, the one with the earliest (smallest) nextDueAtMs wins. A seen
 * lane with no nextDueAtMs is treated as immediately due (oldest possible).
 *
 * Returns null only when `lanes` is empty. Scoped by accountId (only this
 * account's lane rows are consulted) — cross-tenant safe.
 *
 * Exposed as a read-side `query` (vs internalQuery) so the pulse scheduler can
 * call it; it still reveals nothing beyond the requested lane names.
 */
export const pickNextDueLane = internalQuery({
  args: {
    accountId: v.id("creators"),
    lanes: v.array(v.string()),
    nowMs: v.number(),
  },
  handler: async (ctx, args): Promise<string | null> => {
    if (args.lanes.length === 0) return null;

    const rows = await ctx.db
      .query("gtmWatchLaneState")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .collect();

    const byLane = new Map<string, (typeof rows)[number]>();
    for (const r of rows) byLane.set(r.lane, r);

    // 1. Any lane we've never run wins immediately (in the caller's order).
    for (const lane of args.lanes) {
      if (!byLane.has(lane)) return lane;
    }

    // 2. Otherwise the lane with the earliest nextDueAtMs (missing = 0 = now,
    //    so a lane that never set a next-due is maximally overdue). Stable:
    //    ties resolve to the lane appearing earliest in the caller's list.
    let best: string | null = null;
    let bestDue = Number.POSITIVE_INFINITY;
    for (const lane of args.lanes) {
      const row = byLane.get(lane);
      const due =
        row && typeof row.nextDueAtMs === "number" &&
        Number.isFinite(row.nextDueAtMs)
          ? row.nextDueAtMs
          : 0;
      if (due < bestDue) {
        bestDue = due;
        best = lane;
      }
    }
    return best;
  },
});
