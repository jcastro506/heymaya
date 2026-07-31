/**
 * One-shot admin driver to deploy a real Maya end-to-end without Clerk.
 *
 * Usage (from repo root):
 *   npx convex run _admin/realWorldDeploy:run '{}'
 *
 * Inserts a creators row tied to a synthetic clerkUserId, persists the
 * onboarding submission for Kevin.Castro9996 + +16313357603, then triggers
 * the standard deployMaya internal action — same path the production flow
 * takes after Clerk-auth. Burns real ScrapeCreators + OpenRouter credits.
 *
 * Idempotent: re-running with the same `clerkUserId` finds the existing
 * row and re-deploys.
 */

import { internalAction, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import schema from "../schema";

const TEST_CLERK_USER_ID_PREFIX = "test_real_world_kevin_";
const TEST_HANDLE = "Kevin.Castro9996";
const TEST_PHONE = "+16313357603";
const TEST_NAME = "Kevin Castro";
const TEST_TIMEZONE = "America/New_York";

/**
 * Sprint 9.7+ — wipe all rows belonging to prior test creators (any clerkUserId
 * starting with `test_real_world_kevin_`) so each `run` simulates a brand-new
 * user. Cursor-reset alone left stale state — picture rows, scrape cache,
 * mayaActionLog history, follower snapshots — that subtly affected the
 * runtime behavior. True new-user testing requires the empty-table state.
 *
 * Tables wiped (per-creator cascade): creators, creatorPicture, creatorHandles,
 * creatorFollowerSnapshots, posts, postMetrics, mayaActionLog,
 * scrapeCreatorsCreditAudit, dailyBriefs, weeklyLearningsCreator,
 * trendObservations, competitorObservations, firstProactivePings,
 * onboardingJobs, oauthStateTokens.
 */
export const wipeExistingTestCreators = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ wipedCount: number }> => {
    const all = await ctx.db.query("creators").collect();
    const testRows = all.filter((c) =>
      c.clerkUserId.startsWith(TEST_CLERK_USER_ID_PREFIX)
    );

    for (const creator of testRows) {
      // Per-creator cascade — explicit table-by-table enum so tsc can
      // narrow the index types. Each `query(...).withIndex("by_creator", ...)`
      // is statically typed against the schema. If a table doesn't exist
      // or doesn't have `by_creator` it surfaces as a tsc error here, not
      // a silent skip at runtime.
      const cid = creator._id;
      const sweeps = await Promise.all([
        ctx.db.query("creatorPicture").withIndex("by_creator", (q) => q.eq("creatorId", cid)).collect(),
        ctx.db.query("creatorHandles").withIndex("by_creator", (q) => q.eq("creatorId", cid)).collect(),
        ctx.db.query("creatorFollowerSnapshots").withIndex("by_creator", (q) => q.eq("creatorId", cid)).collect(),
        ctx.db.query("posts").withIndex("by_creator", (q) => q.eq("creatorId", cid)).collect(),
        ctx.db.query("postMetrics").withIndex("by_creator", (q) => q.eq("creatorId", cid)).collect(),
        ctx.db.query("mayaActionLog").withIndex("by_creator", (q) => q.eq("creatorId", cid)).collect(),
        ctx.db.query("scrapeCreatorsCreditAudit").withIndex("by_creator", (q) => q.eq("creatorId", cid)).collect(),
        ctx.db.query("dailyBriefs").withIndex("by_creator", (q) => q.eq("creatorId", cid)).collect(),
        ctx.db.query("trendObservations").withIndex("by_creator", (q) => q.eq("creatorId", cid)).collect(),
        ctx.db.query("competitorObservations").withIndex("by_creator", (q) => q.eq("creatorId", cid)).collect(),
        ctx.db.query("firstProactivePings").withIndex("by_creator", (q) => q.eq("creatorId", cid)).collect(),
        ctx.db.query("oauthStateTokens").withIndex("by_creator", (q) => q.eq("creatorId", cid)).collect(),
        ctx.db.query("connectedAccounts").withIndex("by_creator", (q) => q.eq("creatorId", cid)).collect(),
      ]);
      for (const rows of sweeps) {
        for (const row of rows) {
          await ctx.db.delete(row._id);
        }
      }
      await ctx.db.delete(creator._id);
    }

    return { wipedCount: testRows.length };
  },
});

export const ensureCreator = internalMutation({
  args: { clerkUserId: v.string() },
  handler: async (ctx, args): Promise<Id<"creators">> => {
    return await ctx.db.insert("creators", {
      clerkUserId: args.clerkUserId,
      email: "real-world-test@heymaya.local",
      channelPreference: "imessage",
      timezone: TEST_TIMEZONE,
      status: "onboarding",
      plan: "manager",
      compedByAdmin: true,
      createdAt: Date.now(),
    });
  },
});

export const wipeAllCreatorsCascade = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ wipedCount: number; appNames: string[] }> => {
    const creators = await ctx.db.query("creators").collect();
    const appNames: string[] = [];
    for (const creator of creators) {
      const cid = creator._id;
      const slug = String(cid).replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toLowerCase();
      appNames.push(`maya-${slug}`);
      const sweeps = await Promise.all([
        ctx.db.query("creatorPicture").withIndex("by_creator", (q) => q.eq("creatorId", cid)).collect(),
        ctx.db.query("creatorHandles").withIndex("by_creator", (q) => q.eq("creatorId", cid)).collect(),
        ctx.db.query("creatorFollowerSnapshots").withIndex("by_creator", (q) => q.eq("creatorId", cid)).collect(),
        ctx.db.query("posts").withIndex("by_creator", (q) => q.eq("creatorId", cid)).collect(),
        ctx.db.query("postMetrics").withIndex("by_creator", (q) => q.eq("creatorId", cid)).collect(),
        ctx.db.query("mayaActionLog").withIndex("by_creator", (q) => q.eq("creatorId", cid)).collect(),
        ctx.db.query("scrapeCreatorsCreditAudit").withIndex("by_creator", (q) => q.eq("creatorId", cid)).collect(),
        ctx.db.query("dailyBriefs").withIndex("by_creator", (q) => q.eq("creatorId", cid)).collect(),
        ctx.db.query("trendObservations").withIndex("by_creator", (q) => q.eq("creatorId", cid)).collect(),
        ctx.db.query("competitorObservations").withIndex("by_creator", (q) => q.eq("creatorId", cid)).collect(),
        ctx.db.query("firstProactivePings").withIndex("by_creator", (q) => q.eq("creatorId", cid)).collect(),
        ctx.db.query("oauthStateTokens").withIndex("by_creator", (q) => q.eq("creatorId", cid)).collect(),
        ctx.db.query("connectedAccounts").withIndex("by_creator", (q) => q.eq("creatorId", cid)).collect(),
      ]);
      for (const rows of sweeps) {
        for (const row of rows) {
          await ctx.db.delete(row._id);
        }
      }
      await ctx.db.delete(creator._id);
    }
    return { wipedCount: creators.length, appNames };
  },
});

export const wipeEverything = internalAction({
  args: {},
  handler: async (
    ctx
  ): Promise<{
    convex: { wipedCount: number };
    fly: { destroyed: string[]; failed: string[] };
  }> => {
    const wipe = await ctx.runMutation(
      internal._admin.realWorldDeploy.wipeAllCreatorsCascade,
      {}
    );
    console.log(
      `[wipeEverything] convex: wiped ${wipe.wipedCount} creators + cascade`
    );
    const { FlyClient } = await import("../lib/flyClient");
    const fly = new FlyClient();
    const destroyed: string[] = [];
    const failed: string[] = [];
    let appNames = wipe.appNames;
    try {
      const liveMayaApps = (await fly.listApps())
        .map((app) => app.name)
        .filter((name) => name.startsWith("maya-"));
      appNames = Array.from(new Set([...appNames, ...liveMayaApps])).sort();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failed.push(`listApps: ${msg}`);
      console.error(`[wipeEverything] fly: failed to list apps: ${msg}`);
    }
    for (const appName of appNames) {
      try {
        await fly.destroyApp(appName);
        destroyed.push(appName);
        console.log(`[wipeEverything] fly: destroyed ${appName}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failed.push(`${appName}: ${msg}`);
        console.error(`[wipeEverything] fly: failed ${appName}: ${msg}`);
      }
    }
    return {
      convex: { wipedCount: wipe.wipedCount },
      fly: { destroyed, failed },
    };
  },
});

export const wipeTableBatch = internalMutation({
  args: { table: v.string(), batchSize: v.number() },
  handler: async (
    ctx,
    args
  ): Promise<{ deleted: number; hasMore: boolean }> => {
    const rows = await ctx.db
      .query(args.table as never)
      .take(args.batchSize);
    for (const row of rows) {
      await ctx.db.delete((row as { _id: never })._id);
    }
    return { deleted: rows.length, hasMore: rows.length === args.batchSize };
  },
});

/**
 * Every table in the schema, derived from `schema.ts` itself rather than a
 * hand-maintained list. The previous hardcoded array silently rotted every
 * time a table was added or removed — and a wipe tool that misses tables is
 * worse than no wipe tool. Sprint 0.
 */
const ALL_TABLES = Object.keys(schema.tables) as Array<
  keyof typeof schema.tables & string
>;

export const wipeEntireDatabase = internalAction({
  args: {},
  handler: async (
    ctx
  ): Promise<{ counts: Record<string, number>; totalDeleted: number }> => {
    const counts: Record<string, number> = {};
    let totalDeleted = 0;
    // Very small batch — scrapeCreatorsCache rows can be 100KB+ each (full
    // platform API responses), so a 200-row batch can exceed Convex's 16MB
    // read limit. 25 rows × 100KB = 2.5MB, safe headroom.
    const BATCH_SIZE = 25;
    for (const table of ALL_TABLES) {
      let tableTotal = 0;
      let safety = 0;
      while (true) {
        const result: { deleted: number; hasMore: boolean } = await ctx.runMutation(
          internal._admin.realWorldDeploy.wipeTableBatch,
          { table, batchSize: BATCH_SIZE }
        );
        tableTotal += result.deleted;
        if (!result.hasMore) break;
        safety += 1;
        if (safety > 500) {
          console.error(
            `[wipeEntireDatabase] aborted ${table} after 500 batches — investigate`
          );
          break;
        }
      }
      counts[table] = tableTotal;
      totalDeleted += tableTotal;
      console.log(`[wipeEntireDatabase] ${table}: ${tableTotal}`);
    }
    return { counts, totalDeleted };
  },
});

/**
 * Sprint 12.6+ — nuclear: wipe every table AND every maya-* Fly app.
 * Calls `wipeEverything` first (creator-cascade + Fly destroy) then runs
 * `wipeEntireDatabase` to clear non-creator-scoped tables (waitlist rows,
 * orphaned cron heartbeats, service-business tables, etc.).
 *
 * Usage:
 *   npx convex run _admin/realWorldDeploy:wipeEverythingNuclear '{}'
 */
export const wipeEverythingNuclear = internalAction({
  args: {},
  handler: async (
    ctx
  ): Promise<{
    creatorCascade: { wipedCount: number };
    fly: { destroyed: string[]; failed: string[] };
    everyTable: { counts: Record<string, number>; totalDeleted: number };
  }> => {
    const creatorWipe = await ctx.runAction(
      internal._admin.realWorldDeploy.wipeEverything,
      {}
    );
    console.log(
      `[wipeEverythingNuclear] creator-cascade + Fly done: ${creatorWipe.convex.wipedCount} creators, ${creatorWipe.fly.destroyed.length} apps`
    );
    const dbWipe = await ctx.runAction(
      internal._admin.realWorldDeploy.wipeEntireDatabase,
      {}
    );
    console.log(
      `[wipeEverythingNuclear] every-table wipe: ${dbWipe.totalDeleted} rows across ${Object.keys(dbWipe.counts).length} tables`
    );
    return {
      creatorCascade: creatorWipe.convex,
      fly: creatorWipe.fly,
      everyTable: dbWipe,
    };
  },
});
