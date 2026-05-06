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

const TEST_CLERK_USER_ID = "test_real_world_kevin_castro_9996";
const TEST_HANDLE = "Kevin.Castro9996";
const TEST_PHONE = "+16313357603";
const TEST_NAME = "Kevin Castro";
const TEST_TIMEZONE = "America/New_York";

export const ensureCreator = internalMutation({
  args: {},
  handler: async (ctx): Promise<Id<"creators">> => {
    const existing: Doc<"creators"> | null = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", TEST_CLERK_USER_ID))
      .unique();
    if (existing) return existing._id;

    return await ctx.db.insert("creators", {
      clerkUserId: TEST_CLERK_USER_ID,
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
    const creatorId = await ctx.runMutation(
      internal._admin.realWorldDeploy.ensureCreator,
      {}
    );
    console.log(`[realWorldDeploy] creatorId=${creatorId}`);

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
