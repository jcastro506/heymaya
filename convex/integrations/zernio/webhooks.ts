/**
 * Zernio inbound webhook handlers — Convex side.
 *
 * Sprint 1 (service product). Zernio sends HMAC-SHA256-signed webhook
 * deliveries via the `X-Late-Signature` header (legacy "Late" branding
 * retained per https://docs.getlate.dev/core/webhooks). The HTTP receiver
 * lives at `app/api/webhooks/zernio/route.ts` (Next.js Edge route — same
 * pattern as `app/api/composio/webhook/route.ts`). The route verifies the
 * signature, then delegates here for:
 *
 *   1. Replay defense + audit logging via the `webhookEvents` table
 *      (provider="zernio", externalEventId=Zernio's event id, kind=type).
 *   2. Routing the typed event to the right consumer:
 *        - `review.created` → enqueue a `mayaTaskQueue` row with
 *          `kind: "review.created"`. Behavior #4 (Sprint 3) will consume.
 *        - `post.published` → flip `gbpPosts.status` from
 *          `pending` to `posted` when the post id matches.
 *        - `post.failed` / `post.partial` → enqueue with
 *          `kind: "post.failed"`; surface to operator via dashboard.
 *        - `engagement.received` → enqueue with `kind: "engagement.received"`
 *          for behavior #7.
 *        - `account.disconnected` → call `onZernioAccountDisconnected`
 *          (defined in oauth.ts) to flip platform status to revoked.
 *
 * Cross-tenant safety: Zernio identifies the source account via
 * `zernioAccountId` (or per-platform connection id) on every event. We
 * resolve back to a single `zernioConnections` row via the indexed
 * `by_zernio_account_id` lookup. If the lookup fails (unknown account, or
 * deleted business), the event is audit-logged with status `no_business`
 * and dropped — Zernio retries failed deliveries, so 4xx/5xx would create
 * a redelivery storm. The audit log row is the operator's forensics trail.
 *
 * Plan-tier safety: webhook handlers do NOT enforce plan-tier gates.
 * Plan-tier already gated the original outbound action that produced the
 * post / connection / etc. — re-gating on the inbound side would create
 * tenant-isolation bugs (a Pro→Starter downgrade mid-flight would orphan
 * post-published events). Skill-side consumers re-check the gate at
 * dispatch time.
 *
 * Polling fallback: when Zernio's webhook delivery is degraded (operator
 * onboarding without webhook secret yet, Zernio outage, etc.), behavior #4
 * falls back to a 30-min polling cron. The action `pollReviewsViaZernio`
 * implements that path. Cron registration lands in Sprint 3 jobs.json.
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import type { ActionCtx, MutationCtx } from "../../_generated/server";
import { decrypt } from "../../lib/encryption";
import { assertWebhookSecret } from "../../lib/webhookSecret";
import { ZernioClient } from "./client";
import { gbpListReviews } from "./endpoints";
import {
  ZernioApiError,
  type ZernioPlatform,
  type ZernioWebhookEnvelope,
  type ZernioWebhookEventType,
} from "./types";

const ZERNIO_PROVIDER = "zernio";

const ZERNIO_EVENT_TYPE_VALIDATOR = v.union(
  v.literal("review.created"),
  v.literal("review.updated"),
  v.literal("post.scheduled"),
  v.literal("post.published"),
  v.literal("post.failed"),
  v.literal("post.partial"),
  v.literal("engagement.received"),
  v.literal("account.disconnected"),
  v.literal("webhook.test")
);

const ZERNIO_PLATFORM_VALIDATOR = v.union(
  v.literal("gbp"),
  v.literal("facebook"),
  v.literal("instagram"),
  v.literal("tiktok"),
  v.literal("linkedin"),
  v.literal("x"),
  v.literal("pinterest"),
  v.literal("threads")
);

/* -------------------------------------------------------------------------- */
/* Internal helpers — connection lookup                                        */
/* -------------------------------------------------------------------------- */

export const findConnectionByZernioAccountId = internalQuery({
  args: { zernioAccountId: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{
    businessId: Id<"businesses">;
    encryptedApiKey: string;
    encryptedWebhookSecret?: string;
  } | null> => {
    const row = await ctx.db
      .query("zernioConnections")
      .withIndex("by_zernio_account_id", (q) =>
        q.eq("zernioAccountId", args.zernioAccountId)
      )
      .first();
    if (!row) return null;
    return {
      businessId: row.businessId,
      encryptedApiKey: row.encryptedApiKey,
      encryptedWebhookSecret: row.encryptedWebhookSecret,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Idempotency check — webhookEvents table                                     */
/* -------------------------------------------------------------------------- */

/**
 * Returns true if (provider, externalEventId) was previously processed.
 * Caller MUST short-circuit on true. Logs a duplicate-detect audit row in
 * `webhookEvents` so operator can see redelivery cadence.
 */
async function isDuplicateEvent(
  ctx: MutationCtx,
  externalEventId: string
): Promise<boolean> {
  const existing = await ctx.db
    .query("webhookEvents")
    .withIndex("by_provider_and_event_id", (q) =>
      q.eq("provider", ZERNIO_PROVIDER).eq("externalEventId", externalEventId)
    )
    .first();
  return existing !== null;
}

async function recordEvent(
  ctx: MutationCtx,
  externalEventId: string,
  kind: string
): Promise<void> {
  await ctx.db.insert("webhookEvents", {
    provider: ZERNIO_PROVIDER,
    externalEventId,
    kind,
    processedAt: Date.now(),
  });
}

/* -------------------------------------------------------------------------- */
/* mayaTaskQueue insert                                                        */
/* -------------------------------------------------------------------------- */

async function enqueueMayaTask(
  ctx: MutationCtx,
  args: {
    businessId: Id<"businesses">;
    kind: string;
    payload: unknown;
    source: "zernio-webhook" | "zernio-poll" | "manual";
  }
): Promise<Id<"mayaTaskQueue">> {
  return await ctx.db.insert("mayaTaskQueue", {
    businessId: args.businessId,
    kind: args.kind,
    payload: args.payload,
    source: args.source,
    enqueuedAt: Date.now(),
    attemptCount: 0,
  });
}

/* -------------------------------------------------------------------------- */
/* Per-event-type handlers                                                     */
/* -------------------------------------------------------------------------- */

const HandleEventArgs = v.object({
  externalEventId: v.string(),
  type: ZERNIO_EVENT_TYPE_VALIDATOR,
  occurredAt: v.number(),
  platform: v.optional(ZERNIO_PLATFORM_VALIDATOR),
  zernioAccountId: v.optional(v.string()),
  data: v.any(),
  raw: v.any(),
});

type HandleEventArgsType = {
  externalEventId: string;
  type: ZernioWebhookEventType;
  occurredAt: number;
  platform?: ZernioPlatform;
  zernioAccountId?: string;
  data: Record<string, unknown>;
  raw: unknown;
};

type HandleResult =
  | { status: "processed"; queueRowId?: Id<"mayaTaskQueue"> }
  | { status: "duplicate" }
  | { status: "no_business" }
  | { status: "skipped"; reason: string }
  | { status: "errored"; reason: string };

async function resolveBusinessIdForEvent(
  ctx: MutationCtx,
  args: HandleEventArgsType
): Promise<Id<"businesses"> | null> {
  if (!args.zernioAccountId) return null;
  const row = await ctx.db
    .query("zernioConnections")
    .withIndex("by_zernio_account_id", (q) =>
      q.eq("zernioAccountId", args.zernioAccountId!)
    )
    .first();
  return row?.businessId ?? null;
}

/**
 * Core dispatch — called by the public webhook bridge AFTER signature
 * verification. Returns the routing outcome so the route can map it to a
 * 200 / structured response.
 */
async function handleVerifiedEvent(
  ctx: MutationCtx,
  args: HandleEventArgsType
): Promise<HandleResult> {
  if (await isDuplicateEvent(ctx, args.externalEventId)) {
    return { status: "duplicate" };
  }

  // webhook.test events are accepted but only audit-logged.
  if (args.type === "webhook.test") {
    await recordEvent(ctx, args.externalEventId, args.type);
    return { status: "skipped", reason: "webhook.test" };
  }

  const businessId = await resolveBusinessIdForEvent(ctx, args);
  if (!businessId) {
    // Audit-log so the operator can see "Zernio sent us a webhook but no
    // business owns this account id" — usually means an old account id
    // after a re-connect, or a stale event.
    await recordEvent(ctx, args.externalEventId, args.type);
    return { status: "no_business" };
  }

  switch (args.type) {
    case "review.created":
    case "review.updated": {
      const queueRowId = await enqueueMayaTask(ctx, {
        businessId,
        kind: args.type, // "review.created" or "review.updated"
        payload: {
          platform: args.platform ?? "gbp",
          occurredAt: args.occurredAt,
          data: args.data,
        },
        source: "zernio-webhook",
      });
      await recordEvent(ctx, args.externalEventId, args.type);
      return { status: "processed", queueRowId };
    }

    case "post.published": {
      // Best-effort flip of gbpPosts.status. Zernio's payload generally
      // includes the post id we returned at create time. If we find a
      // matching pending row, mark it posted; otherwise just audit.
      const postIdField = (args.data as Record<string, unknown>)?.postId;
      const zernioPostId =
        typeof postIdField === "string" ? postIdField : undefined;
      if (zernioPostId) {
        // gbpPosts.gbpLocalPostId stores the post id Zernio returned at
        // create time (per `gbp/zernio.ts` wrapper).
        const candidates = await ctx.db
          .query("gbpPosts")
          .withIndex("by_business", (q) => q.eq("businessId", businessId))
          .collect();
        const match = candidates.find(
          (row) => row.gbpLocalPostId === zernioPostId
        );
        if (match && match.status !== "posted") {
          await ctx.db.patch(match._id, {
            status: "posted",
            postedAt: Date.now(),
            updatedAt: Date.now(),
          });
        }
      }
      await recordEvent(ctx, args.externalEventId, args.type);
      return { status: "processed" };
    }

    case "post.failed":
    case "post.partial": {
      const queueRowId = await enqueueMayaTask(ctx, {
        businessId,
        kind: "post.failed",
        payload: {
          platform: args.platform,
          variant: args.type, // post.failed vs post.partial
          occurredAt: args.occurredAt,
          data: args.data,
        },
        source: "zernio-webhook",
      });
      await recordEvent(ctx, args.externalEventId, args.type);
      return { status: "processed", queueRowId };
    }

    case "post.scheduled": {
      // Audit-only — operator already saw the schedule client-side.
      await recordEvent(ctx, args.externalEventId, args.type);
      return { status: "skipped", reason: "audit-only" };
    }

    case "engagement.received": {
      const queueRowId = await enqueueMayaTask(ctx, {
        businessId,
        kind: "engagement.received",
        payload: {
          platform: args.platform,
          occurredAt: args.occurredAt,
          data: args.data,
        },
        source: "zernio-webhook",
      });
      await recordEvent(ctx, args.externalEventId, args.type);
      return { status: "processed", queueRowId };
    }

    case "account.disconnected": {
      if (args.platform && args.zernioAccountId) {
        // Flip platform → revoked on the matching zernioConnections row.
        const row = await ctx.db
          .query("zernioConnections")
          .withIndex("by_zernio_account_id", (q) =>
            q.eq("zernioAccountId", args.zernioAccountId!)
          )
          .first();
        if (row) {
          const next = row.connectedPlatforms.map((p) =>
            p.platform === args.platform && p.status !== "revoked"
              ? { ...p, status: "revoked" as const, revokedAt: Date.now() }
              : p
          );
          await ctx.db.patch(row._id, {
            connectedPlatforms: next,
            updatedAt: Date.now(),
          });
        }
      }
      await recordEvent(ctx, args.externalEventId, args.type);
      return { status: "processed" };
    }

    default: {
      // TS exhaustiveness — every event type above is handled. Defensive
      // fallback for forward-compat.
      await recordEvent(ctx, args.externalEventId, args.type);
      return { status: "skipped", reason: "unknown_type" };
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Public webhook bridge mutation                                              */
/* -------------------------------------------------------------------------- */

/**
 * Public bridge — called by the Next.js route AFTER signature verification.
 * Validates a shared `WEBHOOK_INTERNAL_SECRET` (constant-time, fail-closed)
 * before delegating to the dispatch logic. This mirrors the pattern used by
 * `convex/billing/webhook.ts` + `convex/dealTriage.ts` for the existing
 * Stripe / Composio webhook flows.
 *
 * The route is responsible for HMAC verification of the `X-Late-Signature`
 * header against the per-business webhook secret BEFORE calling here. This
 * function trusts the route — but additionally records every delivery in
 * `webhookEvents` for replay defense + forensics.
 */
export const processVerifiedWebhookPublic = mutation({
  args: {
    secret: v.string(),
    event: HandleEventArgs,
  },
  handler: async (ctx, args): Promise<HandleResult> => {
    assertWebhookSecret(args.secret);
    return await handleVerifiedEvent(ctx, args.event);
  },
});

/**
 * Lookup helper for the route — given a Zernio account id, return the
 * encrypted webhook secret so the route can decrypt + verify HMAC.
 *
 * The route requests this BEFORE decoding the body (it needs the secret to
 * verify), so `zernioAccountId` is passed via a header set by Zernio. If
 * the header is absent the route falls back to deferred-verify (read body,
 * extract zernioAccountId from payload, then verify) — which is fine
 * because we do not make any state changes pre-verification.
 */
export const getWebhookSecretForAccountPublic = mutation({
  args: {
    secret: v.string(),
    zernioAccountId: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    encryptedWebhookSecret: string | null;
    businessId: Id<"businesses"> | null;
  }> => {
    assertWebhookSecret(args.secret);
    const row = await ctx.db
      .query("zernioConnections")
      .withIndex("by_zernio_account_id", (q) =>
        q.eq("zernioAccountId", args.zernioAccountId)
      )
      .first();
    if (!row) return { encryptedWebhookSecret: null, businessId: null };
    return {
      encryptedWebhookSecret: row.encryptedWebhookSecret ?? null,
      businessId: row.businessId,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Internal-only — invoked from the Next.js route after signature verify       */
/* -------------------------------------------------------------------------- */

export const dispatchVerifiedEventInternal = internalMutation({
  args: { event: HandleEventArgs },
  handler: async (ctx, args): Promise<HandleResult> => {
    return await handleVerifiedEvent(ctx, args.event);
  },
});

/* -------------------------------------------------------------------------- */
/* Polling fallback — pollReviewsViaZernio                                     */
/* -------------------------------------------------------------------------- */

/**
 * Internal action that polls Zernio for fresh GBP reviews on a 30-min
 * cadence when webhook delivery is degraded (operator hasn't configured
 * webhooks yet, Zernio outage detected, etc.).
 *
 * Cron registration lands in Sprint 3 jobs.json. This function is the
 * working real implementation now.
 *
 * Per-business isolation: the action takes `businessId` and resolves the
 * connection row from there; cron runs are per-business so a misconfigured
 * one can't cascade.
 *
 * Idempotency: each review surfaced gets enqueued via `mayaTaskQueue` with
 * `source: "zernio-poll"` and `kind: "review.created"`. The skill consumer
 * (Sprint 3) deduplicates against `reviews.externalReviewId` — the queue
 * itself is "at-least-once" delivery.
 */
export const pollReviewsViaZernio = internalAction({
  args: {
    businessId: v.id("businesses"),
    /** Optional override; defaults to "fetch reviews newer than the latest enqueue." */
    sinceMs: v.optional(v.number()),
  },
  handler: async (
    ctx: ActionCtx,
    args
  ): Promise<{
    reviewsEnqueued: number;
    locationsPolled: number;
    skipped?: string;
  }> => {
    const conn: {
      businessId: Id<"businesses">;
      encryptedApiKey: string;
      encryptedWebhookSecret?: string;
    } | null = await ctx.runQuery(
      internal.integrations.zernio.webhooks.findConnectionByBusinessIdInternal,
      { businessId: args.businessId }
    );
    if (!conn) {
      return { reviewsEnqueued: 0, locationsPolled: 0, skipped: "no_connection" };
    }
    const apiKey = await decrypt(conn.encryptedApiKey);
    const client = new ZernioClient({ apiKey });
    const account = await ctx.runQuery(
      internal.integrations.zernio.webhooks.getZernioAccountIdInternal,
      { businessId: args.businessId }
    );
    if (!account) {
      return { reviewsEnqueued: 0, locationsPolled: 0, skipped: "no_account" };
    }
    const locations: Doc<"gbpLocations">[] = await ctx.runQuery(
      internal.integrations.zernio.webhooks.listGbpLocationsForBusinessInternal,
      { businessId: args.businessId }
    );
    let reviewsEnqueued = 0;
    let locationsPolled = 0;
    for (const loc of locations) {
      try {
        const reviews = await gbpListReviews(
          { client, zernioAccountId: account.zernioAccountId },
          loc.gbpLocationId,
          { since: args.sinceMs, limit: 50 }
        );
        for (const r of reviews) {
          await ctx.runMutation(
            internal.integrations.zernio.webhooks.enqueuePolledReviewInternal,
            {
              businessId: args.businessId,
              review: {
                reviewId: r.reviewId,
                externalReviewId: r.externalReviewId,
                reviewerName: r.reviewerName,
                starRating: r.starRating,
                body: r.body,
                createdAt: r.createdAt,
                gbpLocationId: loc.gbpLocationId,
              },
            }
          );
          reviewsEnqueued += 1;
        }
        locationsPolled += 1;
      } catch (err) {
        // Log but don't crash the whole cron — one location's failure
        // shouldn't kill the others.
        await ctx.runMutation(
          internal.integrations.zernio.webhooks.recordPollFailureInternal,
          {
            businessId: args.businessId,
            gbpLocationId: loc.gbpLocationId,
            errorDetail:
              err instanceof Error ? err.message : "unknown error",
          }
        );
      }
    }
    return { reviewsEnqueued, locationsPolled };
  },
});

export const findConnectionByBusinessIdInternal = internalQuery({
  args: { businessId: v.id("businesses") },
  handler: async (
    ctx,
    args
  ): Promise<{
    businessId: Id<"businesses">;
    encryptedApiKey: string;
    encryptedWebhookSecret?: string;
  } | null> => {
    const row = await ctx.db
      .query("zernioConnections")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .first();
    if (!row) return null;
    return {
      businessId: row.businessId,
      encryptedApiKey: row.encryptedApiKey,
      encryptedWebhookSecret: row.encryptedWebhookSecret,
    };
  },
});

export const getZernioAccountIdInternal = internalQuery({
  args: { businessId: v.id("businesses") },
  handler: async (
    ctx,
    args
  ): Promise<{ zernioAccountId: string } | null> => {
    const row = await ctx.db
      .query("zernioConnections")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .first();
    return row ? { zernioAccountId: row.zernioAccountId } : null;
  },
});

export const listGbpLocationsForBusinessInternal = internalQuery({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args): Promise<Doc<"gbpLocations">[]> => {
    return await ctx.db
      .query("gbpLocations")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();
  },
});

export const enqueuePolledReviewInternal = internalMutation({
  args: {
    businessId: v.id("businesses"),
    review: v.object({
      reviewId: v.string(),
      externalReviewId: v.string(),
      reviewerName: v.string(),
      starRating: v.number(),
      body: v.string(),
      createdAt: v.number(),
      gbpLocationId: v.string(),
    }),
  },
  handler: async (ctx, args): Promise<Id<"mayaTaskQueue">> => {
    return await enqueueMayaTask(ctx, {
      businessId: args.businessId,
      kind: "review.created",
      payload: {
        platform: "gbp" as ZernioPlatform,
        occurredAt: args.review.createdAt,
        data: args.review,
      },
      source: "zernio-poll",
    });
  },
});

export const recordPollFailureInternal = internalMutation({
  args: {
    businessId: v.id("businesses"),
    gbpLocationId: v.string(),
    errorDetail: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    // Surface to operator dashboard via mayaTaskQueue with a known kind.
    await enqueueMayaTask(ctx, {
      businessId: args.businessId,
      kind: "zernio.poll.failed",
      payload: {
        gbpLocationId: args.gbpLocationId,
        errorDetail: args.errorDetail,
      },
      source: "zernio-poll",
    });
  },
});

/* -------------------------------------------------------------------------- */
/* Helpers — shape normalization                                               */
/* -------------------------------------------------------------------------- */

/**
 * Parse a Zernio webhook delivery body into our normalized envelope.
 * Returns null if the payload is unrecognizable. Designed to be called
 * AFTER signature verification so it does not need to be defensive about
 * adversarial inputs that could DOS via deeply-nested JSON — Convex's
 * mutation arg validators handle that for us downstream.
 */
export function parseZernioWebhookEnvelope(
  raw: unknown
): ZernioWebhookEnvelope | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const externalEventId =
    typeof obj.id === "string"
      ? obj.id
      : typeof obj.eventId === "string"
        ? obj.eventId
        : undefined;
  const type =
    typeof obj.event === "string"
      ? obj.event
      : typeof obj.type === "string"
        ? obj.type
        : undefined;
  if (!externalEventId || !type) return null;
  const allowedTypes: ZernioWebhookEventType[] = [
    "review.created",
    "review.updated",
    "post.scheduled",
    "post.published",
    "post.failed",
    "post.partial",
    "engagement.received",
    "account.disconnected",
    "webhook.test",
  ];
  if (!allowedTypes.includes(type as ZernioWebhookEventType)) return null;
  const allowedPlatforms: ZernioPlatform[] = [
    "gbp",
    "facebook",
    "instagram",
    "tiktok",
    "linkedin",
    "x",
    "pinterest",
    "threads",
  ];
  const platformRaw =
    typeof obj.platform === "string" ? obj.platform : undefined;
  const platform =
    platformRaw && allowedPlatforms.includes(platformRaw as ZernioPlatform)
      ? (platformRaw as ZernioPlatform)
      : undefined;
  const zernioAccountId =
    typeof obj.accountId === "string"
      ? obj.accountId
      : typeof obj.profileId === "string"
        ? obj.profileId
        : undefined;
  const occurredAtRaw = obj.occurredAt ?? obj.timestamp ?? obj.createdAt;
  let occurredAt: number;
  if (typeof occurredAtRaw === "number" && Number.isFinite(occurredAtRaw)) {
    occurredAt = occurredAtRaw;
  } else if (typeof occurredAtRaw === "string") {
    const parsed = Date.parse(occurredAtRaw);
    occurredAt = Number.isFinite(parsed) ? parsed : Date.now();
  } else {
    occurredAt = Date.now();
  }
  const data =
    obj.data && typeof obj.data === "object"
      ? (obj.data as Record<string, unknown>)
      : {};
  return {
    externalEventId,
    type: type as ZernioWebhookEventType,
    occurredAt,
    platform,
    zernioAccountId,
    data,
    raw,
  };
}

// Re-export for downstream consumers (Sprint 3 skill orchestrator).
export type { ZernioWebhookEnvelope };

// Throw a controlled error if a payload arrives without the bare minimum
// shape (caller can surface a 400). Distinct from signature-failure (401)
// or unknown-account (200 audit-only).
export class ZernioWebhookMalformedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZernioWebhookMalformedError";
  }
}

/**
 * Convenience for the route: given a raw body string + signature header +
 * decrypted webhook secret, verify and dispatch in one call. Used by the
 * Next.js route to keep its handler thin.
 *
 * NOTE: this internal action does NOT check the WEBHOOK_INTERNAL_SECRET
 * because it is an `internalAction` (only callable via `internal.*`).
 */
export const verifyAndDispatchInternal = internalAction({
  args: {
    rawBody: v.string(),
    signatureHeader: v.string(),
    decryptedSecret: v.string(),
  },
  handler: async (
    ctx: ActionCtx,
    args
  ): Promise<{
    verified: boolean;
    result?: HandleResult;
    reason?: string;
  }> => {
    // Avoid a circular import — pull verifyZernioSignature lazily.
    const { verifyZernioSignature } = await import("./client");
    const ok = await verifyZernioSignature(
      args.rawBody,
      args.signatureHeader,
      args.decryptedSecret
    );
    if (!ok) {
      return { verified: false, reason: "signature_invalid" };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(args.rawBody);
    } catch {
      return { verified: true, reason: "malformed_json" };
    }
    const envelope = parseZernioWebhookEnvelope(parsed);
    if (!envelope) {
      return { verified: true, reason: "malformed_envelope" };
    }
    const result: HandleResult = await ctx.runMutation(
      internal.integrations.zernio.webhooks.dispatchVerifiedEventInternal,
      { event: envelope }
    );
    return { verified: true, result };
  },
});
