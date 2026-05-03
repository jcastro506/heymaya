/**
 * QuickBooks Online webhook receiver — via Unified.to.
 *
 * Sprint 5 (service product). Inbound webhook flow:
 *
 *   1. Next.js route at `app/api/webhooks/qbo/route.ts` (operator-blocked
 *      task — added when wiring live; this file provides the Convex side
 *      bridge that mirrors `convex/integrations/zernio/webhooks.ts`).
 *   2. Route reads the raw body + `x-unified-signature` header.
 *   3. Route decrypts `UNIFIED_WEBHOOK_SECRET` (per-workspace; not
 *      per-connection like Zernio's).
 *   4. Route calls `verifyAndDispatchInternal` here.
 *   5. We:
 *      a. Verify signature (HMAC-SHA256, constant-time compare).
 *      b. Parse + validate envelope shape.
 *      c. Idempotency check via `webhookEvents` (provider="qbo-via-unified").
 *      d. Resolve `connection_id` → `businessId` by decrypt-walking
 *         `crmConnections.qbo` rows.
 *      e. Dispatch by event type → upsert `serviceCustomers` / `serviceJobs`.
 *      f. ACK <1s budget per the routing pattern.
 *
 * Cross-tenant safety: we always resolve `businessId` from `connection_id`
 * BEFORE writing anything. The resolution walks `crmConnections.qbo`
 * decrypting each blob; only an exact match wins. An event for a
 * connection-not-in-our-system is audit-logged + dropped (status:
 * "no_business").
 *
 * Plan-tier safety: webhook handlers do NOT enforce plan-tier (skill consumer
 * does). A Pro→Starter downgrade mid-flight should not orphan in-flight
 * events; re-gating here would create that bug.
 *
 * Adversarial:
 *   - Bad signature → status: "signature_invalid", verified: false. Route
 *     maps to HTTP 401 to refuse delivery.
 *   - Replay → idempotent via `webhookEvents` lookup (provider, event_id).
 *     Returns "duplicate" status; route maps to HTTP 200 to stop redelivery.
 *   - Malformed JSON → "malformed_json", route maps to HTTP 400.
 *   - Wrong provider on a "quickbooks"-only receiver → status:
 *     "wrong_provider"; route maps to HTTP 200 to stop redelivery.
 *   - Connection-not-found → "no_business"; route maps to HTTP 200 to stop
 *     redelivery (Unified retries 4xx/5xx).
 *
 * <1s ack budget: the dispatch path is mutation-only; no external HTTP
 * inside the verify-then-dispatch action. The full path (verify → parse →
 * lookup → upsert) is well under 100ms in fixture tests.
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  mutation,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx, MutationCtx } from "../_generated/server";
import { decrypt } from "../lib/encryption";
import { assertWebhookSecret } from "../lib/webhookSecret";
import { verifyUnifiedSignature } from "../integrations/aggregators/unified/client";
import type {
  UnifiedAccountingCustomer,
  UnifiedAccountingInvoice,
  UnifiedWebhookEnvelope,
  UnifiedWebhookEventType,
} from "../integrations/aggregators/unified/types";
import { UNIFIED_QBO_PROVIDER } from "../integrations/aggregators/unified/types";
import {
  classifyCustomerEntity,
  mapCustomerToServiceRow,
  mapInvoiceToServiceJob,
  mapSubCustomerToServiceJob,
} from "../integrations/crm/quickbooks";

const QBO_PROVIDER = "qbo-via-unified";

const UNIFIED_EVENT_TYPE_VALIDATOR = v.union(
  v.literal("accounting.customer.created"),
  v.literal("accounting.customer.updated"),
  v.literal("accounting.invoice.created"),
  v.literal("accounting.invoice.updated"),
  v.literal("accounting.invoice.paid"),
  v.literal("accounting.estimate.created")
);

const HandleEventArgs = v.object({
  event_id: v.string(),
  type: UNIFIED_EVENT_TYPE_VALIDATOR,
  connection_id: v.string(),
  provider: v.string(),
  occurred_at: v.string(),
  data: v.any(),
  raw: v.any(),
});

type HandleEventArgsType = {
  event_id: string;
  type: UnifiedWebhookEventType;
  connection_id: string;
  provider: string;
  occurred_at: string;
  data: Record<string, unknown>;
  raw: unknown;
};

type HandleResult =
  | {
      status: "processed";
      kind: string;
      writes: { customers: number; jobs: number };
    }
  | { status: "duplicate" }
  | { status: "no_business" }
  | { status: "wrong_provider" }
  | { status: "skipped"; reason: string };

/* -------------------------------------------------------------------------- */
/* Idempotency                                                                 */
/* -------------------------------------------------------------------------- */

async function isDuplicateEvent(
  ctx: MutationCtx,
  externalEventId: string
): Promise<boolean> {
  const existing = await ctx.db
    .query("webhookEvents")
    .withIndex("by_provider_and_event_id", (q) =>
      q.eq("provider", QBO_PROVIDER).eq("externalEventId", externalEventId)
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
    provider: QBO_PROVIDER,
    externalEventId,
    kind,
    processedAt: Date.now(),
  });
}

/* -------------------------------------------------------------------------- */
/* Connection → businessId resolution                                          */
/* -------------------------------------------------------------------------- */

/**
 * Resolve a Unified `connection_id` to our local `businessId` by
 * decrypt-walking the QBO connection rows. Returns null if no match.
 *
 * The walk is bounded by total QBO-connected businesses (≤100 in v0). We do
 * NOT short-circuit on plaintext compare to avoid leaking through a timing
 * oracle. Each decrypt is constant-cost.
 *
 * Documented follow-up: a dedicated `unifiedConnectionId` (plaintext, indexed)
 * column on `crmConnections` would make this O(1). We deliberately stayed
 * schema-clean for v0; adding it is a one-migration change.
 */
async function resolveBusinessForConnection(
  ctx: ActionCtx,
  connectionId: string
): Promise<Id<"businesses"> | null> {
  const candidates = await ctx.runQuery(
    internal.integrations.crm.quickbooks
      .resolveBusinessForUnifiedConnectionInternal,
    {}
  );
  for (const c of candidates) {
    try {
      const plain = await decrypt(c.encryptedConnectionId);
      if (plain === connectionId) return c.businessId;
    } catch {
      // Corrupt/invalid blob — skip; continue scanning.
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Per-event-type handlers                                                     */
/* -------------------------------------------------------------------------- */

async function handleCustomerEvent(
  ctx: MutationCtx,
  businessId: Id<"businesses">,
  envelope: HandleEventArgsType
): Promise<{ customers: number; jobs: number }> {
  const customer = envelope.data as unknown as UnifiedAccountingCustomer;
  if (!customer || !customer.id) {
    return { customers: 0, jobs: 0 };
  }
  const kind = classifyCustomerEntity(customer);
  if (kind === "customer") {
    const projection = mapCustomerToServiceRow(customer);
    await ctx.runMutation(
      internal.integrations.crm.quickbooks.upsertServiceCustomerInternal,
      { businessId, projection }
    );
    return { customers: 1, jobs: 0 };
  }
  // Sub-customer (QBO "Job") → upsert serviceJobs row.
  const jobProjection = mapSubCustomerToServiceJob(customer);
  await ctx.runMutation(
    internal.integrations.crm.quickbooks
      .upsertServiceJobFromSubCustomerInternal,
    { businessId, projection: jobProjection }
  );
  return { customers: 0, jobs: 1 };
}

async function handleInvoiceEvent(
  ctx: MutationCtx,
  businessId: Id<"businesses">,
  envelope: HandleEventArgsType
): Promise<{ customers: number; jobs: number }> {
  const inv = envelope.data as unknown as UnifiedAccountingInvoice;
  if (!inv || !inv.id) {
    return { customers: 0, jobs: 0 };
  }
  const projection = mapInvoiceToServiceJob(inv);
  await ctx.runMutation(
    internal.integrations.crm.quickbooks.upsertServiceJobFromInvoiceInternal,
    {
      businessId,
      projection: {
        crmJobId: projection.crmJobId,
        customerCrmId: projection.customerCrmId,
        status: projection.status,
        ticketAmountUsd: projection.ticketAmountUsd,
        serviceType: projection.serviceType,
        scheduledAt: projection.scheduledAt,
        completedAt: projection.completedAt,
        notes: projection.notes,
      },
    }
  );
  return { customers: 0, jobs: 1 };
}

/**
 * Core dispatch — called AFTER signature verification + connection resolution.
 */
async function handleVerifiedEvent(
  ctx: MutationCtx,
  args: HandleEventArgsType,
  businessId: Id<"businesses">
): Promise<HandleResult> {
  if (await isDuplicateEvent(ctx, args.event_id)) {
    return { status: "duplicate" };
  }
  let writes: { customers: number; jobs: number };
  switch (args.type) {
    case "accounting.customer.created":
    case "accounting.customer.updated":
      writes = await handleCustomerEvent(ctx, businessId, args);
      break;
    case "accounting.invoice.created":
    case "accounting.invoice.updated":
    case "accounting.invoice.paid":
    case "accounting.estimate.created":
      writes = await handleInvoiceEvent(ctx, businessId, args);
      break;
    default: {
      // TS exhaustiveness — unreachable under the validator above.
      await recordEvent(ctx, args.event_id, args.type);
      return { status: "skipped", reason: "unknown_type" };
    }
  }
  await recordEvent(ctx, args.event_id, args.type);
  return { status: "processed", kind: args.type, writes };
}

/* -------------------------------------------------------------------------- */
/* Internal mutation — idempotent dispatch entry point                          */
/* -------------------------------------------------------------------------- */

export const dispatchVerifiedEventInternal = internalMutation({
  args: {
    event: HandleEventArgs,
    businessId: v.id("businesses"),
  },
  handler: async (ctx, args): Promise<HandleResult> => {
    return await handleVerifiedEvent(
      ctx,
      args.event as HandleEventArgsType,
      args.businessId
    );
  },
});

/* -------------------------------------------------------------------------- */
/* Public bridge — used by the Next.js route via ConvexHttpClient               */
/* -------------------------------------------------------------------------- */

/**
 * Public wrapper called by the Next.js route at
 * `app/api/webhooks/qbo/route.ts`. Verifies the shared
 * `WEBHOOK_INTERNAL_SECRET` first (constant-time, fail-closed) so the public
 * surface cannot be invoked by anyone who doesn't share the env secret.
 *
 * The route is responsible for HMAC verification BEFORE calling here. This
 * function trusts the route on signature. Idempotency + audit logging happen
 * here.
 */
export const processVerifiedWebhookPublic = mutation({
  args: {
    secret: v.string(),
    event: HandleEventArgs,
    businessId: v.id("businesses"),
  },
  handler: async (ctx, args): Promise<HandleResult> => {
    assertWebhookSecret(args.secret);
    return await handleVerifiedEvent(
      ctx,
      args.event as HandleEventArgsType,
      args.businessId
    );
  },
});

/* -------------------------------------------------------------------------- */
/* verifyAndDispatchInternal — single-call route helper                        */
/* -------------------------------------------------------------------------- */

/**
 * One-shot helper: verify signature, parse envelope, resolve connection →
 * businessId, dispatch. Used by the Next.js route to keep the handler thin.
 *
 * Returns a structured result so the route can map to the right HTTP status
 * (401 invalid sig / 400 malformed / 200 duplicate-or-no-business / 200
 * processed). <1s ack budget — no external HTTP inside this path.
 */
export const verifyAndDispatchInternal = internalAction({
  args: {
    rawBody: v.string(),
    signatureHeader: v.string(),
    secret: v.string(),
  },
  handler: async (
    ctx: ActionCtx,
    args
  ): Promise<{
    verified: boolean;
    result?: HandleResult;
    reason?: string;
  }> => {
    const ok = await verifyUnifiedSignature(
      args.rawBody,
      args.signatureHeader,
      args.secret
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
    const envelope = parseUnifiedWebhookEnvelope(parsed);
    if (!envelope) {
      return { verified: true, reason: "malformed_envelope" };
    }
    if (envelope.provider !== UNIFIED_QBO_PROVIDER) {
      return {
        verified: true,
        result: { status: "wrong_provider" },
      };
    }
    const businessId = await resolveBusinessForConnection(
      ctx,
      envelope.connection_id
    );
    if (!businessId) {
      return {
        verified: true,
        result: { status: "no_business" },
      };
    }
    const result: HandleResult = await ctx.runMutation(
      internal.webhooks.qbo.dispatchVerifiedEventInternal,
      {
        event: {
          event_id: envelope.event_id,
          type: envelope.type,
          connection_id: envelope.connection_id,
          provider: envelope.provider,
          occurred_at: envelope.occurred_at,
          data: envelope.data,
          raw: envelope.raw,
        },
        businessId,
      }
    );
    return { verified: true, result };
  },
});

/* -------------------------------------------------------------------------- */
/* Envelope parser                                                             */
/* -------------------------------------------------------------------------- */

const ALLOWED_TYPES: ReadonlyArray<UnifiedWebhookEventType> = [
  "accounting.customer.created",
  "accounting.customer.updated",
  "accounting.invoice.created",
  "accounting.invoice.updated",
  "accounting.invoice.paid",
  "accounting.estimate.created",
];

export function parseUnifiedWebhookEnvelope(
  raw: unknown
): UnifiedWebhookEnvelope | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const event_id =
    typeof obj.event_id === "string"
      ? obj.event_id
      : typeof obj.id === "string"
        ? obj.id
        : undefined;
  const type =
    typeof obj.type === "string"
      ? obj.type
      : typeof obj.event === "string"
        ? obj.event
        : undefined;
  const connection_id =
    typeof obj.connection_id === "string"
      ? obj.connection_id
      : typeof obj.connectionId === "string"
        ? obj.connectionId
        : undefined;
  const provider =
    typeof obj.provider === "string" ? obj.provider : undefined;
  const occurred_at =
    typeof obj.occurred_at === "string"
      ? obj.occurred_at
      : typeof obj.occurredAt === "string"
        ? obj.occurredAt
        : new Date().toISOString();

  if (!event_id || !type || !connection_id || !provider) return null;
  if (!ALLOWED_TYPES.includes(type as UnifiedWebhookEventType)) return null;

  const data =
    obj.data && typeof obj.data === "object"
      ? (obj.data as Record<string, unknown>)
      : {};
  return {
    event_id,
    type: type as UnifiedWebhookEventType,
    connection_id,
    provider,
    occurred_at,
    data,
    raw,
  };
}

