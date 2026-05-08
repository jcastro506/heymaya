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

export const run = internalAction({
  args: {},
  handler: async (ctx): Promise<{ ok: boolean; creatorId: string; deploy: unknown }> => {
    // Sprint 9.7+ — wipe prior test creators + cascade. True new-user
    // simulation: empty creator row, empty picture, empty scrape cache,
    // empty mayaActionLog. The kickstart synth runs from scratch every
    // time; nothing stale leaks from a prior run.
    const wipe = await ctx.runMutation(
      internal._admin.realWorldDeploy.wipeExistingTestCreators,
      {}
    );
    console.log(`[realWorldDeploy] wiped ${wipe.wipedCount} prior test creator(s)`);

    // Fresh clerkUserId per run so even if the wipe missed a corner-case
    // table (e.g. one I forgot to add to the cascade), the new creator
    // doesn't inherit anything.
    const clerkUserId = `${TEST_CLERK_USER_ID_PREFIX}${Date.now().toString(36)}`;
    const creatorId = await ctx.runMutation(
      internal._admin.realWorldDeploy.ensureCreator,
      { clerkUserId }
    );
    console.log(`[realWorldDeploy] new creatorId=${creatorId} (clerkUserId=${clerkUserId})`);

    await ctx.runMutation(
      internal.onboarding.maya.submitOnboarding.persistOnboardingSubmission,
      {
        creatorId,
        displayName: TEST_NAME,
        phoneNumber: TEST_PHONE,
        handle: TEST_HANDLE,
        channelPreference: "imessage",
      }
    );
    console.log(`[realWorldDeploy] persisted submission`);

    const deploy = await ctx.runAction(
      internal.onboarding.maya.deployMaya.deployMaya,
      { creatorId }
    );
    console.log(`[realWorldDeploy] deploy result:`, JSON.stringify(deploy, null, 2));

    return { ok: true, creatorId, deploy };
  },
});

/**
 * Sprint 11.1 — clean-slate wipe. Destroys ALL creators (not filtered to
 * test prefix) + their cascade tables + ALL maya-* Fly apps. Returns
 * a summary of what was wiped. Used to start fresh for a new round of
 * real-world testing.
 *
 * NOT TOUCHED:
 *   - heymaya-openclaw (base image)
 *   - heymaya-video-synth (multimodal worker)
 *   - any non-maya-* Fly app
 *
 * Usage:
 *   npx convex run _admin/realWorldDeploy:wipeEverything '{}'
 */
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
    for (const appName of wipe.appNames) {
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

/**
 * Sprint 11.1 — destroy the existing Fly machine for a creator's Maya
 * app, then re-run deployMaya. Use this when the running Maya bundle
 * is stale (older AGENTS.md / standing orders / skills) and you want
 * the live machine to pick up the latest workspace WITHOUT wiping
 * Convex creator data (picture, opening answers, posts, etc.).
 *
 * Usage:
 *   npx convex run _admin/realWorldDeploy:redeployForCreator '{"creatorId":"<id>"}'
 *
 * The Fly app itself is preserved — only the machine is replaced. The
 * creator's iMessage thread continues; on next inbound message Maya
 * boots into the new bundle.
 */
export const redeployForCreator = internalAction({
  args: { creatorId: v.id("creators") },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: boolean; destroyed: number; deploy: unknown }> => {
    const { FlyClient } = await import("../lib/flyClient");
    const fly = new FlyClient();
    const appName = `maya-${args.creatorId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toLowerCase()}`;
    const machines = await fly.listMachines(appName);
    let destroyed = 0;
    for (const m of machines) {
      console.log(`[redeployForCreator] destroying ${appName}/${m.id} (state=${m.state})`);
      await fly.destroyMachine(appName, m.id, { force: true });
      destroyed += 1;
    }
    const deploy = await ctx.runAction(
      internal.onboarding.maya.deployMaya.deployMaya,
      { creatorId: args.creatorId }
    );
    console.log(`[redeployForCreator] deploy result:`, JSON.stringify(deploy, null, 2));
    return { ok: true, destroyed, deploy };
  },
});
