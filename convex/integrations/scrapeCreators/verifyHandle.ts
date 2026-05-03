/**
 * verifyHandle — lightweight, single-platform handle confirmation used by the
 * Sprint 2 onboarding UI before a handle gets accepted into the in-progress
 * creator's handle list.
 *
 * Why this exists separately from `runFullScrapePull`:
 *   - Bulk pull is a 30s parallel sweep across N platforms; this is a
 *     single-platform profile fetch with a tighter timeout, fast-failing on
 *     unknown handles so the UI can surface the error in <2s.
 *   - The bulk pull also writes `creatorHandles` and the cache. Verification
 *     is read-only and explicitly does not persist — the user may keep typing
 *     and remove the handle before deploy. Only the bulk pull (after step 1
 *     "handles" is finalized) writes to the database.
 *
 * Account-takeover guard: every handle the creator types is round-tripped
 * through the platform's public profile lookup. We never trust raw input.
 *
 * Auth: this is a `public` action (callable from the React client) but it
 * requires a signed-in Clerk user. Onboarding happens behind the Clerk
 * middleware so any caller without a Clerk identity is rejected fail-closed.
 *
 * Returns the canonical platform handle + display name + follower count so
 * the UI can show a confirmed signal next to the row. The matching internal
 * variant `verifyHandleInternal` exists for unit-test invocation that doesn't
 * need to flow through the auth layer.
 */

import { v } from "convex/values";
import { action, internalAction } from "../../_generated/server";
import {
  PLATFORM_READERS,
  type EndpointDeps,
  type Platform,
} from "./endpoints";
import { ScrapeCreatorsClient } from "./client";

export interface VerifyHandleResult {
  verified: true;
  platform: Platform;
  handle: string;
  displayName: string | null;
  followerCount: number;
  avatarUrl: string | null;
}

const PlatformValidator = v.union(
  v.literal("tiktok"),
  v.literal("instagram"),
  v.literal("youtube"),
  v.literal("linkedin"),
  v.literal("x")
);

export class HandleNotFoundError extends Error {
  constructor(platform: Platform, handle: string) {
    super(`Handle '${handle}' was not found on ${platform}.`);
    this.name = "HandleNotFoundError";
  }
}

/**
 * Strip leading `@` and surrounding whitespace. ScrapeCreators endpoints accept
 * the bare handle for every platform we support; passing `@` through can
 * trigger 404s on stricter normalizers.
 */
export function normalizeHandle(input: string): string {
  return input.trim().replace(/^@+/, "");
}

const VERIFY_TIMEOUT_MS = 12_000;

/** Shared implementation used by both the public and internal action. */
export async function verifyHandleImpl(
  args: { platform: Platform; handle: string },
  deps?: EndpointDeps
): Promise<VerifyHandleResult> {
  const handle = normalizeHandle(args.handle);
  if (handle.length === 0) {
    throw new HandleNotFoundError(args.platform, args.handle);
  }
  const client = deps?.client ?? new ScrapeCreatorsClient({ timeoutMs: VERIFY_TIMEOUT_MS });
  const reader = PLATFORM_READERS[args.platform];
  const profile = await reader.profile(handle, { client });
  if (!profile) {
    throw new HandleNotFoundError(args.platform, handle);
  }
  return {
    verified: true,
    platform: args.platform,
    handle: profile.handle,
    displayName: profile.displayName,
    followerCount: profile.followerCount,
    avatarUrl: profile.avatarUrl,
  };
}

/**
 * Public action — invoked from the onboarding UI. Auth-gated: any caller
 * without a signed-in Clerk identity is rejected immediately. Cross-tenant
 * concerns don't apply because this action neither reads nor writes per-creator
 * state — it only proxies a public ScrapeCreators read.
 */
export const verifyHandle = action({
  args: {
    platform: PlatformValidator,
    handle: v.string(),
  },
  handler: async (ctx, args): Promise<VerifyHandleResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("verifyHandle: signed-in Clerk user required.");
    }
    return await verifyHandleImpl(args);
  },
});

/**
 * Internal twin used by tests + by other Convex actions that need handle
 * verification without round-tripping through Clerk auth (e.g. fixture-corpus
 * sims).
 */
export const verifyHandleInternal = internalAction({
  args: {
    platform: PlatformValidator,
    handle: v.string(),
  },
  handler: async (_ctx, args): Promise<VerifyHandleResult> => {
    return await verifyHandleImpl(args);
  },
});
