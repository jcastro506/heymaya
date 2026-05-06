/**
 * Admin operations — operator-only mutations gated by `ADMIN_TOKEN`.
 *
 * Sprint 9. The admin surface is intentionally minimal: just enough for
 * the operator to onboard friend-cohort beta testers without making them
 * swipe a Stripe card. Auth is a shared-secret pattern (same shape as
 * `convex/lib/webhookSecret.ts`) but a SEPARATE env var so that even if
 * a webhook secret leaks, admin mutations remain locked.
 *
 * Operator usage:
 *   1. Generate the token:
 *        node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *   2. Set in Convex env: `npx convex env set ADMIN_TOKEN <hex>`
 *   3. Comp a creator (Convex CLI):
 *        npx convex run admin:compCreator '{ "token": "<hex>", "creatorId": "..." }'
 *   4. Un-comp later if needed:
 *        npx convex run admin:uncompCreator '{ "token": "<hex>", "creatorId": "..." }'
 *
 * The comp flag flows through `planFeatures(creator)` and
 * `subscriptionActive(creator)` in `convex/lib/planFeatures.ts`. A comped
 * creator gets the full Manager feature set regardless of the stored
 * `plan` value AND regardless of whether they have a Stripe subscription.
 *
 * Cross-tenant safety: each mutation takes one explicit `creatorId`. The
 * caller (operator with the token) is the only authorized writer; there
 * is no Clerk-identity → row resolution in this surface because the
 * operator is acting OUTSIDE the per-creator auth boundary.
 *
 * NOTE: this is a server-side surface; never expose `ADMIN_TOKEN` to the
 * frontend. The frontend has zero need to call admin mutations.
 */

import { mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

/* -------------------------------------------------------------------------- */
/* Token gate                                                                  */
/* -------------------------------------------------------------------------- */

let __injectedAdminTokenForTests: string | null = null;

/**
 * Test-only setter. ALWAYS reset to `null` in `afterEach`. Mirrors the
 * pattern used by `convex/lib/webhookSecret.ts`.
 */
export function _setAdminTokenForTests(token: string | null): void {
  __injectedAdminTokenForTests = token;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function assertAdminToken(provided: string | undefined): void {
  const expected = __injectedAdminTokenForTests ?? process.env.ADMIN_TOKEN;
  if (!expected || expected.length === 0) {
    throw new Error("admin: unauthorized");
  }
  if (typeof provided !== "string" || provided.length === 0) {
    throw new Error("admin: unauthorized");
  }
  if (!constantTimeEqual(expected, provided)) {
    throw new Error("admin: unauthorized");
  }
}

/* -------------------------------------------------------------------------- */
/* Mutations                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Flip `compedByAdmin = true` on a creator row. Idempotent — calling
 * twice is a no-op. After the flag flips, `planFeatures(creator)` returns
 * the Manager feature set and `subscriptionActive(creator)` returns true.
 * No Stripe subscription is created.
 *
 * Returns `{ ok: true, alreadyComped: boolean }` so the operator can tell
 * whether the call had effect.
 */
export const compCreator = mutation({
  args: {
    token: v.string(),
    creatorId: v.id("creators"),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: true; alreadyComped: boolean }> => {
    assertAdminToken(args.token);
    const creator = await ctx.db.get(args.creatorId);
    if (!creator) {
      throw new Error("admin: creator-not-found");
    }
    if (creator.compedByAdmin === true) {
      return { ok: true, alreadyComped: true };
    }
    await ctx.db.patch(creator._id as Id<"creators">, {
      compedByAdmin: true,
    });
    return { ok: true, alreadyComped: false };
  },
});

/**
 * Inverse of `compCreator`. Sets `compedByAdmin = false`. After this, the
 * creator's plan-gating reverts to whatever Stripe + their stored `plan`
 * field say — typically the paywall, unless they also have an active
 * subscription.
 *
 * Idempotent: if the flag is already false/undefined, returns
 * `alreadyUncomped: true` and no-ops the patch.
 */
export const uncompCreator = mutation({
  args: {
    token: v.string(),
    creatorId: v.id("creators"),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: true; alreadyUncomped: boolean }> => {
    assertAdminToken(args.token);
    const creator = await ctx.db.get(args.creatorId);
    if (!creator) {
      throw new Error("admin: creator-not-found");
    }
    if (creator.compedByAdmin !== true) {
      return { ok: true, alreadyUncomped: true };
    }
    await ctx.db.patch(creator._id as Id<"creators">, {
      compedByAdmin: false,
    });
    return { ok: true, alreadyUncomped: false };
  },
});
