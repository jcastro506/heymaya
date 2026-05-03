/**
 * Shared session resolver for the 6 service-business HQ queries.
 *
 * Every Convex query under `convex/queries/business/` calls
 * `getCurrentBusinessRow(ctx)` first to resolve the signed-in operator's
 * `businesses` row. The chain is:
 *
 *   1. `ctx.auth.getUserIdentity()`          — Clerk → identity.subject
 *   2. `creators.by_clerk_user`              — identity.subject → creators row
 *   3. `creators.businessId`                 — creators row → businesses row
 *
 * The cross-tenant guard is implicit in the chain: every downstream query
 * filters on `businessId === currentBusiness._id`, and `currentBusiness._id`
 * is derived strictly from the signed-in user's own `creators.businessId`
 * pointer. There is no input path on the client that can supply a different
 * `businessId` and bypass the gate — every public query in this folder
 * either takes no `businessId` arg (resolved internally) or passes it
 * through with a defensive equality check.
 *
 * Failure modes (all return `null`, never throw — UI renders empty/loading):
 *   - Unauthenticated request                 → null
 *   - Authenticated but `creators` row absent → null (webhook still in-flight)
 *   - `creators.businessId` unset             → null (mid-onboarding)
 *   - `accountType !== "service-business"`    → null (creator account; HQ
 *     reads should be no-ops on the wrong product surface)
 *
 * Why this lives at `_session.ts` (underscore prefix):
 *   - Convex's deploy analyzer skips paths beginning with `_`. Treating this
 *     as an internal helper keeps it out of the generated public API
 *     surface; only the per-screen `today.ts` / `jobs.ts` / etc. files in
 *     this folder export public `query`s.
 *   - Mirror: `convex/today.ts` defines its own `getCurrentCreator` for the
 *     creator side. Service side has 6 query files that all need this, so
 *     factoring out into a shared helper is cleaner than duplicating.
 */

import type { QueryCtx } from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";

export interface BusinessSession {
  /** The Clerk-identity-resolved `creators` row (account-level). */
  account: Doc<"creators">;
  /** The `businesses` row pointed to by `account.businessId`. */
  business: Doc<"businesses">;
}

/**
 * Resolve the currently signed-in operator's business session, or null on
 * any failure. See file header for failure modes.
 */
export async function getCurrentBusinessSession(
  ctx: QueryCtx
): Promise<BusinessSession | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;

  const account = await ctx.db
    .query("creators")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
    .first();
  if (!account) return null;

  // Service product surface: only `service-business` rows resolve a session
  // here. A `creator` row hitting these queries returns null so the wrong
  // product surface gets a clean empty render rather than ambiguous data.
  if (account.accountType !== "service-business") return null;
  if (!account.businessId) return null;

  const business = await ctx.db.get(account.businessId);
  if (!business) return null;

  return { account, business };
}

/**
 * Cross-tenant assertion helper. Used by mutations / queries that accept a
 * `businessId` argument from the client (e.g. a deep-linked detail panel).
 * Returns the resolved session iff the supplied `businessId` matches the
 * caller's own; null otherwise. Fails closed without throwing — UI shows
 * empty rather than blowing up on a stale URL.
 */
export async function getSessionForBusiness(
  ctx: QueryCtx,
  businessId: Doc<"businesses">["_id"]
): Promise<BusinessSession | null> {
  const session = await getCurrentBusinessSession(ctx);
  if (!session) return null;
  if (session.business._id !== businessId) return null;
  return session;
}
