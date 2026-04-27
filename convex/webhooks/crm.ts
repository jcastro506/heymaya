/**
 * CRM webhook receiver — Nango-bridged Jobber + HCP webhooks.
 *
 * Wave C / Sprint 4-5. The Next.js route at `app/api/webhooks/nango/route.ts`
 * (created in a follow-up) is the public HTTP entry; it verifies the Nango
 * HMAC signature and forwards the verified envelope here.
 *
 * Idempotency: every event records a row in `webhookEvents` keyed on
 * `(provider="nango", externalEventId, kind)`. A redelivery short-circuits
 * with status `duplicate` — no second upsert.
 *
 * Cross-tenant safety: the `connectionId` on the inbound envelope maps 1:1 to
 * a `crmConnections` row scoped by `businessId`. We verify the row exists +
 * the provider matches before any DB write.
 *
 * Webhook ack budget: per R2 the receiver must return 200 in <1s. The
 * mutation here only does:
 *   - dedupe lookup
 *   - business resolution
 *   - mayaTaskQueue insert (for `forward` events with `JOB_*` topics)
 *   - webhookEvents insert
 *
 * It does NOT call the upstream provider to fetch the full job — that is
 * done asynchronously by the `enrichAndUpsertJobFromWebhook` action on the
 * mayaTaskQueue consumer side. This keeps the receiver under the 1s budget.
 */

import { v } from "convex/values";
import {
  httpAction,
  internalAction,
  internalMutation,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { ActionCtx, MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import {
  parseNangoWebhookEnvelope,
  verifyNangoSignature,
  NANGO_SIGNATURE_HEADER,
  type NangoWebhookEnvelope,
} from "../integrations/crm/nango";
import {
  parseJobberWebhookEvent,
  fetchJobberJobById,
  normalizeJobberJob,
  JOBBER_PROVIDER_KEY,
} from "../integrations/crm/jobber";
import {
  parseHcpWebhookEvent,
  fetchHcpJobById,
  normalizeHcpJob,
  HCP_PROVIDER_KEY,
} from "../integrations/crm/housecallpro";

const NANGO_WEBHOOK_PROVIDER = "nango";

/* -------------------------------------------------------------------------- */
/* Idempotency helpers                                                         */
/* -------------------------------------------------------------------------- */

async function isDuplicateEvent(
  ctx: MutationCtx,
  externalEventId: string
): Promise<boolean> {
  const existing = await ctx.db
    .query("webhookEvents")
    .withIndex("by_provider_and_event_id", (q) =>
      q
        .eq("provider", NANGO_WEBHOOK_PROVIDER)
        .eq("externalEventId", externalEventId)
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
    provider: NANGO_WEBHOOK_PROVIDER,
    externalEventId,
    kind,
    processedAt: Date.now(),
  });
}

/* -------------------------------------------------------------------------- */
/* Dispatch — internal mutation                                                */
/* -------------------------------------------------------------------------- */

const NANGO_ENVELOPE_VALIDATOR = v.object({
  eventId: v.string(),
  type: v.union(v.literal("auth"), v.literal("sync"), v.literal("forward")),
  providerConfigKey: v.string(),
  connectionId: v.string(),
  payload: v.optional(v.any()),
  providerEventName: v.optional(v.string()),
  receivedAt: v.optional(v.number()),
});

type CrmWebhookResult =
  | { status: "processed"; queueRowId?: Id<"mayaTaskQueue"> }
  | { status: "duplicate" }
  | { status: "no_business" }
  | { status: "skipped"; reason: string }
  | { status: "errored"; reason: string };

/**
 * Dispatch a verified envelope. Returns the routing outcome so the route can
 * map it to a 200 / structured response.
 *
 * The dispatch ONLY enqueues a `mayaTaskQueue` row — we do NOT fetch the full
 * job from the provider here (would breach the 1s ack budget). The consumer
 * action `enrichAndUpsertCrmJob` runs asynchronously to do the GraphQL/REST
 * fetch + upsert.
 */
async function dispatchEnvelope(
  ctx: MutationCtx,
  envelope: NangoWebhookEnvelope
): Promise<CrmWebhookResult> {
  if (await isDuplicateEvent(ctx, envelope.eventId)) {
    return { status: "duplicate" };
  }

  // `auth` and `sync` events get audit-logged; we don't trigger any work.
  if (envelope.type === "auth" || envelope.type === "sync") {
    await recordEvent(ctx, envelope.eventId, envelope.type);
    return { status: "skipped", reason: envelope.type };
  }

  // Resolve business from connectionId. Cross-tenant safety invariant.
  const resolved = await ctx.db.get;
  // Inline the resolver logic since we can't call the internalQuery from
  // within a mutation context — same shape as
  // `convex/jobs.ts:resolveBusinessIdFromConnectionInternal`.
  void resolved;
  const idx = envelope.connectionId.indexOf("_");
  if (idx <= 0) {
    await recordEvent(ctx, envelope.eventId, envelope.type);
    return { status: "no_business" };
  }
  const providerPrefix = envelope.connectionId.slice(0, idx);
  if (providerPrefix !== envelope.providerConfigKey) {
    await recordEvent(ctx, envelope.eventId, envelope.type);
    return { status: "no_business" };
  }
  const rest = envelope.connectionId.slice(idx + 1);
  const lastUnderscore = rest.lastIndexOf("_");
  const businessIdStr =
    lastUnderscore > 0 ? rest.slice(0, lastUnderscore) : rest;
  let business;
  try {
    business = await ctx.db.get(businessIdStr as Id<"businesses">);
  } catch {
    business = null;
  }
  if (!business) {
    await recordEvent(ctx, envelope.eventId, envelope.type);
    return { status: "no_business" };
  }
  // Verify connection row exists.
  const expectedProvider =
    envelope.providerConfigKey === JOBBER_PROVIDER_KEY ? "jobber" : "hcp";
  const conn = await ctx.db
    .query("crmConnections")
    .withIndex("by_business_and_provider", (q) =>
      q.eq("businessId", business._id).eq("provider", expectedProvider)
    )
    .first();
  if (!conn) {
    await recordEvent(ctx, envelope.eventId, envelope.type);
    return { status: "no_business" };
  }

  // Normalize provider event.
  let providerEventKind: string;
  let resourceId: string;
  if (envelope.providerConfigKey === JOBBER_PROVIDER_KEY) {
    const evt = parseJobberWebhookEvent(envelope);
    if (!evt) {
      await recordEvent(ctx, envelope.eventId, envelope.type);
      return { status: "skipped", reason: "unknown_jobber_topic" };
    }
    providerEventKind = `jobber.${evt.topic.toLowerCase()}`;
    resourceId = evt.resourceId;
  } else if (envelope.providerConfigKey === HCP_PROVIDER_KEY) {
    const evt = parseHcpWebhookEvent(envelope);
    if (!evt) {
      await recordEvent(ctx, envelope.eventId, envelope.type);
      return { status: "skipped", reason: "unknown_hcp_event" };
    }
    providerEventKind = `hcp.${evt.type}`;
    resourceId = evt.resourceId;
  } else {
    await recordEvent(ctx, envelope.eventId, envelope.type);
    return { status: "skipped", reason: "unsupported_provider" };
  }

  // Enqueue an enrichment task for the consumer action to fetch + upsert.
  const queueRowId = await ctx.db.insert("mayaTaskQueue", {
    businessId: business._id,
    kind: providerEventKind,
    payload: {
      provider: expectedProvider,
      connectionId: envelope.connectionId,
      resourceId,
      occurredAt: envelope.receivedAt ?? Date.now(),
    },
    source: "crm-webhook",
    enqueuedAt: Date.now(),
    attemptCount: 0,
  });

  await recordEvent(ctx, envelope.eventId, providerEventKind);
  return { status: "processed", queueRowId };
}

export const dispatchCrmEnvelopeInternal = internalMutation({
  args: { envelope: NANGO_ENVELOPE_VALIDATOR },
  handler: async (ctx, args): Promise<CrmWebhookResult> => {
    return await dispatchEnvelope(ctx, args.envelope as NangoWebhookEnvelope);
  },
});

/* -------------------------------------------------------------------------- */
/* Enrichment — internal action runs after the receiver returns 200            */
/* -------------------------------------------------------------------------- */

/**
 * Consumer-side action: pulls the resourceId from the queue row's payload,
 * fetches the full job from the provider via Nango, normalizes, and calls
 * `internal.jobs.upsertJobFromWebhook`. Invoked by the mayaTaskQueue
 * consumer (Sprint 3 already wired) when it sees a `kind: "jobber.job_complete"`
 * or `kind: "hcp.job.completed"` row.
 */
export const enrichAndUpsertCrmJob = internalAction({
  args: {
    queueRowId: v.id("mayaTaskQueue"),
    businessId: v.id("businesses"),
    provider: v.union(v.literal("jobber"), v.literal("hcp")),
    connectionId: v.string(),
    resourceId: v.string(),
  },
  handler: async (
    ctx: ActionCtx,
    args
  ): Promise<{
    upserted: boolean;
    jobId?: Id<"serviceJobs">;
    skipped?: string;
  }> => {
    const secret = process.env.NANGO_SECRET_KEY;
    if (!secret) {
      return { upserted: false, skipped: "missing_nango_secret" };
    }
    const { NangoClient } = await import("../integrations/crm/nango");
    const client = new NangoClient({ secretKey: secret });

    if (args.provider === "jobber") {
      const job = await fetchJobberJobById(
        client,
        args.connectionId,
        args.resourceId
      );
      if (!job) return { upserted: false, skipped: "provider_404" };
      const normalized = normalizeJobberJob(job);
      const result = await ctx.runMutation(internal.jobs.upsertJobFromWebhook, {
        businessId: args.businessId,
        normalizedJob: normalized,
        source: "crm-webhook",
      });
      return { upserted: true, jobId: result.jobId };
    }
    const job = await fetchHcpJobById(
      client,
      args.connectionId,
      args.resourceId
    );
    if (!job) return { upserted: false, skipped: "provider_404" };
    const normalized = normalizeHcpJob(job);
    const result = await ctx.runMutation(internal.jobs.upsertJobFromWebhook, {
      businessId: args.businessId,
      normalizedJob: normalized,
      source: "crm-webhook",
    });
    return { upserted: true, jobId: result.jobId };
  },
});

/* -------------------------------------------------------------------------- */
/* HTTP entry — Convex httpAction (Convex-native HTTP endpoint)                */
/* -------------------------------------------------------------------------- */

/**
 * Convex-native HTTP action receiver for Nango webhooks. Operator-side wiring:
 * point Nango's webhook URL at `https://<deployment>.convex.site/webhooks/crm`.
 * Convex routes the path through this handler.
 *
 * Why also Convex-native (vs only Next.js route at `app/api/webhooks/nango/`):
 *   - Convex HTTP actions can call internal mutations directly (one trip).
 *   - The Next.js route still exists for parity with composio/zernio (and
 *     because some operators may run Next.js standalone). Both verify
 *     signature against the same `NANGO_WEBHOOK_SECRET`.
 *
 * 1-second ack budget: handler does signature verify → parse → enqueue, then
 * returns 200. The 1s budget is asserted by the test in `__tests__/webhook.test.ts`.
 */
export const nangoWebhookHttp = httpAction(async (ctx, request) => {
  const secret = process.env.NANGO_WEBHOOK_SECRET;
  if (!secret) {
    return new Response(
      JSON.stringify({ error: "NANGO_WEBHOOK_SECRET not configured" }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
  const rawBody = await request.text();
  const signature = request.headers.get(NANGO_SIGNATURE_HEADER);
  const valid = await verifyNangoSignature(rawBody, signature, secret);
  if (!valid) {
    return new Response(JSON.stringify({ error: "invalid signature" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: "malformed json" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  const envelope = parseNangoWebhookEnvelope(parsed);
  if (!envelope) {
    return new Response(JSON.stringify({ error: "malformed envelope" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  const result = await ctx.runMutation(
    internal.webhooks.crm.dispatchCrmEnvelopeInternal,
    { envelope }
  );
  return new Response(JSON.stringify({ ok: true, result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

// reason: convex/http.ts is the canonical place to register HTTP routes;
// when the operator creates that file later, they import `nangoWebhookHttp`
// and call `router.route({ path: "/webhooks/crm", method: "POST", handler:
// nangoWebhookHttp })`. We export the action only; no router instance here.
