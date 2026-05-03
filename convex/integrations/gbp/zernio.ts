/**
 * GBP-shaped API exposed by the Zernio v0 routing layer.
 *
 * Sprint 1 (service product). Thin wrapper around `convex/integrations/zernio/
 * endpoints.ts`. The point: when partner-access lands and we activate
 * `convex/integrations/gbp/direct/`, the swap is a one-line import change
 * inside `convex/integrations/gbp/index.ts`:
 *
 *   // convex/integrations/gbp/index.ts
 *   export * from "./zernio";   // v0 default
 *   // export * from "./direct"; // post-partner-access upgrade
 *
 * Skill code (Sprint 3+) and behaviors MUST import from
 * `convex/integrations/gbp/` — NEVER from `convex/integrations/zernio/`
 * directly. That's the interface-isolation contract from R1 § Verdict
 * + service plan § 3 layer table.
 *
 * The function shapes here are the STABLE contract. Any change to a name,
 * arg shape, or return shape requires a corresponding direct-path update
 * so the swap stays one-line.
 */

import { decrypt } from "../../lib/encryption";
import { ZernioClient } from "../zernio/client";
import {
  gbpCreateLocalPost as zernioGbpCreateLocalPost,
  gbpDeleteLocalPost as zernioGbpDeleteLocalPost,
  gbpGetInsights as zernioGbpGetInsights,
  gbpListLocations as zernioGbpListLocations,
  gbpListReviews as zernioGbpListReviews,
  gbpReplyToReview as zernioGbpReplyToReview,
  gbpUpdateLocalPost as zernioGbpUpdateLocalPost,
  makeZernioContext,
} from "../zernio/endpoints";
import type {
  GbpInsightsRequest,
  GbpInsightsResult,
  GbpLocalPostInput,
  GbpLocalPostResult,
  GbpLocationSummary,
  GbpReviewSummary,
} from "../zernio/types";

/**
 * Stable GBP context that callers construct from a decrypted Zernio API key
 * + the umbrella zernio account id. Hides the Zernio-specific shape behind
 * a GBP-shaped surface.
 */
export interface GbpContext {
  /** Decrypted Zernio API key for THIS business. */
  zernioApiKey: string;
  /** Zernio umbrella account id for THIS business. */
  zernioAccountId: string;
}

function buildContext(ctx: GbpContext) {
  const client = new ZernioClient({ apiKey: ctx.zernioApiKey });
  return makeZernioContext(client, ctx.zernioAccountId);
}

/**
 * Convenience builder — call sites that already loaded the encrypted blob
 * from `zernioConnections` use this to skip the manual decrypt step.
 */
export async function buildGbpContextFromEncrypted(args: {
  encryptedZernioApiKey: string;
  zernioAccountId: string;
}): Promise<GbpContext> {
  const apiKey = await decrypt(args.encryptedZernioApiKey);
  return { zernioApiKey: apiKey, zernioAccountId: args.zernioAccountId };
}

/* -------------------------------------------------------------------------- */
/* Stable GBP-shaped API                                                       */
/* -------------------------------------------------------------------------- */

export function listLocations(ctx: GbpContext): Promise<GbpLocationSummary[]> {
  return zernioGbpListLocations(buildContext(ctx));
}

export function listReviews(
  ctx: GbpContext,
  locationId: string,
  options: { since?: number; limit?: number } = {}
): Promise<GbpReviewSummary[]> {
  return zernioGbpListReviews(buildContext(ctx), locationId, options);
}

export function replyToReview(
  ctx: GbpContext,
  args: { locationId: string; reviewId: string; replyText: string }
): Promise<{ replyState: GbpReviewSummary["replyState"]; publishedAt?: number }> {
  return zernioGbpReplyToReview(buildContext(ctx), args);
}

export function createLocalPost(
  ctx: GbpContext,
  locationId: string,
  post: GbpLocalPostInput
): Promise<GbpLocalPostResult> {
  return zernioGbpCreateLocalPost(buildContext(ctx), locationId, post);
}

export function updateLocalPost(
  ctx: GbpContext,
  locationId: string,
  postId: string,
  patch: Partial<GbpLocalPostInput>
): Promise<GbpLocalPostResult> {
  return zernioGbpUpdateLocalPost(buildContext(ctx), locationId, postId, patch);
}

export function deleteLocalPost(
  ctx: GbpContext,
  locationId: string,
  postId: string
): Promise<{ deleted: true }> {
  return zernioGbpDeleteLocalPost(buildContext(ctx), locationId, postId);
}

export function getInsights(
  ctx: GbpContext,
  locationId: string,
  request: GbpInsightsRequest
): Promise<GbpInsightsResult> {
  return zernioGbpGetInsights(buildContext(ctx), locationId, request);
}

/* -------------------------------------------------------------------------- */
/* Re-export the GBP-shaped types so callers don't need to know about Zernio   */
/* at all. When the direct path lands, it will re-export the same types       */
/* from its own module.                                                        */
/* -------------------------------------------------------------------------- */

export type {
  GbpInsightsRequest,
  GbpInsightsResult,
  GbpLocalPostInput,
  GbpLocalPostResult,
  GbpLocationSummary,
  GbpReviewSummary,
};
export {
  ZernioPlatformError as GbpModerationError,
  ZernioAuthError as GbpAuthError,
  ZernioRateLimitError as GbpRateLimitError,
  ZernioApiError as GbpApiError,
} from "../zernio/types";
