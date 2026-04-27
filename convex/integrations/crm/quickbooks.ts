/**
 * QuickBooks Online (QBO) integration — via Unified.to aggregator.
 *
 * Sprint 5 (service product). Aggregator decision locked at
 * `docs/spikes/qbo-aggregator-decision.md`.
 *
 * Responsibilities:
 *   - Connect / handle-callback / disconnect Convex actions, plan-tier-gated
 *     to Pro+ (matches `planFeaturesService.crmIntegration`).
 *   - Map Unified's normalized accounting entities into our `serviceCustomers`
 *     + `serviceJobs` shape, faithful to QBO's parent/sub-customer hierarchy:
 *       - Top-level QBO Customer (parent_id null OR is_job false) → upsert
 *         a `serviceCustomers` row.
 *       - QBO sub-customer with is_job true (the "Job" pattern QBO uses to
 *         track work within a customer) → upsert a `serviceJobs` row linked
 *         to the parent's `serviceCustomers` row via `customerId`.
 *       - Estimate / Invoice → upsert a `serviceJobs` row keyed on
 *         `crmJobId`. Invoice with non-null amount + `customer_id` populates
 *         `ticketAmountUsd`. Estimate-then-invoice round-trip preserves the
 *         job row across both events (same crmJobId because Unified joins
 *         them on the underlying QBO Estimate's resulting Invoice id).
 *   - Provide internal helpers consumed by `convex/webhooks/qbo.ts`.
 *
 * Cross-tenant safety:
 *   - Every entry point re-resolves the business via Clerk identity →
 *     creators → businessId. The frontend never asserts which business is
 *     active; Clerk subject is the only authority.
 *   - Mapping helpers receive `businessId` as a required parameter and never
 *     read it from the entity payload — Unified's connection metadata is
 *     the source of truth, looked up on the route side.
 *
 * Plan-tier safety:
 *   - `connectQbo` / `handleQboCallback` / `disconnectQbo` ALL gate on
 *     `planFeaturesService(business).crmIntegration === true` via
 *     `requireFeatureService`. Starter is rejected fail-closed.
 *   - Webhook handlers do NOT enforce plan-tier (defense-in-depth boundary
 *     owned by skill consumers; re-gating on the inbound side would orphan
 *     events when an operator downgrades mid-flight).
 *
 * Adversarial:
 *   - `mapCustomerToServiceRow` rejects an entity without `id` or with a
 *     parent_id pointing to itself.
 *   - `mapInvoiceToServiceJob` requires `customer_id` (or graceful-empty
 *     if the invoice was issued to a customer not yet seen — we surface
 *     `customerId: undefined` so the row is still searchable).
 *   - All upserts scope by `(businessId, crmCustomerId)` or
 *     `(businessId, crmJobId)` so an event for Business A can never write
 *     into Business B's rows.
 */

import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
} from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { internal } from "../../_generated/api";
import { encrypt } from "../../lib/encryption";
import {
  PlanServiceGateError,
  planFeaturesService,
  requireFeatureService,
} from "../../planService";
import {
  UnifiedClient,
  readUnifiedApiKey,
  readUnifiedWorkspaceId,
  startConnectionAuth,
} from "../aggregators/unified/client";
import {
  UNIFIED_QBO_PROVIDER,
  UnifiedAccountingCustomer,
  UnifiedAccountingInvoice,
  UnifiedApiError,
  UnifiedAuthError,
} from "../aggregators/unified/types";

const QBO_PROVIDER = "qbo" as const;

/* -------------------------------------------------------------------------- */
/* Mapping helpers                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Decide whether a Unified normalized customer should land in `serviceCustomers`
 * or `serviceJobs`.
 *
 * QBO's "Job" pattern: a sub-customer with `Job: true` represents work
 * tracked under a parent customer. Unified normalizes this to
 * `parent_id !== null && is_job === true`.
 *
 * Returns `"job"` if the row should mirror to `serviceJobs`, `"customer"`
 * otherwise. Top-level customers always map to `serviceCustomers`.
 */
export function classifyCustomerEntity(
  c: UnifiedAccountingCustomer
): "customer" | "job" {
  if (c.parent_id && c.is_job === true) return "job";
  return "customer";
}

/**
 * Synchronous shape of the projected `serviceCustomers` payload — used by
 * upsert mutations and tested directly in unit tests without DB.
 */
export interface ProjectedServiceCustomer {
  crmCustomerId: string;
  name: string;
  phone: string | undefined;
  email: string | undefined;
  address: string | undefined;
  // Maya doesn't see lifetime value yet — populated when invoices land.
  lifetimeValueUsd: number | undefined;
}

export function mapCustomerToServiceRow(
  c: UnifiedAccountingCustomer
): ProjectedServiceCustomer {
  if (!c.id) {
    throw new Error("QBO mapping: customer missing id");
  }
  if (c.parent_id === c.id) {
    throw new Error(
      `QBO mapping: customer ${c.id} has self-referential parent_id`
    );
  }
  // QBO often provides multiple phones / emails. Take the first non-empty.
  const phone = c.telephones?.find((t) => t.telephone && t.telephone.length > 0)
    ?.telephone;
  const email = c.emails?.find((e) => e.email && e.email.length > 0)?.email;
  const address = formatAddress(c.address);
  // Key on Unified's `id` rather than `external_id` because invoice events
  // carry `customer_id` referencing Unified's id (NOT the QBO-side id).
  // Keying on external_id would break cross-reference lookup.
  return {
    crmCustomerId: c.id,
    name: c.name ?? "(unnamed)",
    phone: phone || undefined,
    email: email || undefined,
    address: address || undefined,
    lifetimeValueUsd: undefined,
  };
}

function formatAddress(addr: UnifiedAccountingCustomer["address"]): string {
  if (!addr) return "";
  const line = [addr.address1, addr.address2].filter(Boolean).join(", ");
  const cityRegion = [addr.city, addr.region].filter(Boolean).join(", ");
  return [line, cityRegion, addr.postal_code, addr.country]
    .filter(Boolean)
    .join(" ");
}

/** Projected `serviceJobs` payload from a sub-customer (the QBO "Job" case). */
export interface ProjectedServiceJobFromCustomer {
  crmJobId: string;
  // Linkage to the parent customer's crmCustomerId (NOT Unified id) — the
  // upsert layer translates that to the local serviceCustomers Id.
  parentCrmCustomerId: string | undefined;
  serviceType: string | undefined;
  // No completion timestamp on the sub-customer entity itself — invoice
  // events drive completion.
  notes: string | undefined;
}

export function mapSubCustomerToServiceJob(
  c: UnifiedAccountingCustomer
): ProjectedServiceJobFromCustomer {
  if (!c.id) {
    throw new Error("QBO mapping: sub-customer missing id");
  }
  return {
    // Key on Unified id for the same cross-ref reason as customers above —
    // invoice.customer_id and Customer.parent_id both reference Unified's
    // id, so consistency requires we upsert on it.
    crmJobId: c.id,
    parentCrmCustomerId: c.parent_id ?? undefined,
    serviceType: undefined, // QBO sub-customer has no service-type slot
    notes: c.name && c.name.length > 0 ? c.name : undefined,
  };
}

/** Projected `serviceJobs` payload from an invoice / estimate. */
export interface ProjectedServiceJobFromInvoice {
  /** Stable id we key on for upsert — Unified id by default. */
  crmJobId: string;
  /** Invoice's referenced customer (Unified normalized id). */
  customerCrmId: string | undefined;
  /**
   * "completed" once we see an invoice with a non-zero total; "scheduled"
   * for estimates and unbilled invoices; "in-progress" never set from
   * accounting payloads (FSM-only).
   */
  status: "scheduled" | "completed";
  ticketAmountUsd: number | undefined;
  serviceType: string | undefined;
  scheduledAt: number | undefined;
  completedAt: number | undefined;
  notes: string | undefined;
}

export function mapInvoiceToServiceJob(
  inv: UnifiedAccountingInvoice
): ProjectedServiceJobFromInvoice {
  if (!inv.id) {
    throw new Error("QBO mapping: invoice missing id");
  }
  const isCompleted = inv.type === "invoice" && (inv.total_amount ?? 0) > 0;
  const scheduledAt = inv.invoice_at ? Date.parse(inv.invoice_at) : undefined;
  return {
    // Same Unified-id-as-key rule as customer mapping. The estimate→invoice
    // round-trip preserves the upsert because Unified maintains the same
    // id across the conversion (its internal join on QBO LinkedTxn).
    crmJobId: inv.id,
    customerCrmId: inv.customer_id,
    status: isCompleted ? "completed" : "scheduled",
    ticketAmountUsd: inv.total_amount,
    // Use the first line item description as a coarse service-type signal.
    serviceType:
      inv.line_items && inv.line_items.length > 0
        ? inv.line_items[0].description
        : undefined,
    scheduledAt:
      scheduledAt !== undefined && Number.isFinite(scheduledAt)
        ? scheduledAt
        : undefined,
    completedAt: isCompleted
      ? scheduledAt !== undefined && Number.isFinite(scheduledAt)
        ? scheduledAt
        : Date.now()
      : undefined,
    notes: inv.notes,
  };
}

/* -------------------------------------------------------------------------- */
/* Internal mutations (consumed by the webhook receiver + connect flow)        */
/* -------------------------------------------------------------------------- */

export const upsertServiceCustomerInternal = internalMutation({
  args: {
    businessId: v.id("businesses"),
    projection: v.object({
      crmCustomerId: v.string(),
      name: v.string(),
      phone: v.optional(v.string()),
      email: v.optional(v.string()),
      address: v.optional(v.string()),
      lifetimeValueUsd: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args): Promise<Id<"serviceCustomers">> => {
    const existing = await ctx.db
      .query("serviceCustomers")
      .withIndex("by_business_and_crm_id", (q) =>
        q
          .eq("businessId", args.businessId)
          .eq("crmCustomerId", args.projection.crmCustomerId)
      )
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.projection.name,
        phone: args.projection.phone,
        email: args.projection.email,
        address: args.projection.address,
        // Don't clobber lifetimeValueUsd from a customer-only event; only
        // invoice-derived upserts populate that field.
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("serviceCustomers", {
      businessId: args.businessId,
      crmCustomerId: args.projection.crmCustomerId,
      name: args.projection.name,
      phone: args.projection.phone,
      email: args.projection.email,
      address: args.projection.address,
      lifetimeValueUsd: args.projection.lifetimeValueUsd,
      createdAt: now,
      updatedAt: now,
    });
  },
});

const SERVICE_JOB_STATUS = v.union(
  v.literal("scheduled"),
  v.literal("in-progress"),
  v.literal("completed"),
  v.literal("cancelled")
);

export const upsertServiceJobFromInvoiceInternal = internalMutation({
  args: {
    businessId: v.id("businesses"),
    projection: v.object({
      crmJobId: v.string(),
      customerCrmId: v.optional(v.string()),
      status: SERVICE_JOB_STATUS,
      ticketAmountUsd: v.optional(v.number()),
      serviceType: v.optional(v.string()),
      scheduledAt: v.optional(v.number()),
      completedAt: v.optional(v.number()),
      notes: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args): Promise<Id<"serviceJobs">> => {
    // Resolve the parent customer's local Id (if any) — strictly scoped
    // to businessId so cross-tenant linkage is impossible.
    let customerId: Id<"serviceCustomers"> | undefined = undefined;
    if (args.projection.customerCrmId) {
      const parent = await ctx.db
        .query("serviceCustomers")
        .withIndex("by_business_and_crm_id", (q) =>
          q
            .eq("businessId", args.businessId)
            .eq("crmCustomerId", args.projection.customerCrmId)
        )
        .first();
      customerId = parent?._id;
    }
    const existing = await ctx.db
      .query("serviceJobs")
      .withIndex("by_business_and_crm_id", (q) =>
        q
          .eq("businessId", args.businessId)
          .eq("crmJobId", args.projection.crmJobId)
      )
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        customerId,
        status: args.projection.status,
        scheduledAt: args.projection.scheduledAt,
        completedAt: args.projection.completedAt,
        // Only overwrite ticketAmountUsd when the new value is set —
        // estimate-then-invoice round-trip should not zero out the figure
        // on a follow-up estimate that omits the field.
        ticketAmountUsd:
          args.projection.ticketAmountUsd ?? existing.ticketAmountUsd,
        serviceType: args.projection.serviceType ?? existing.serviceType,
        notes: args.projection.notes ?? existing.notes,
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("serviceJobs", {
      businessId: args.businessId,
      customerId,
      crmJobId: args.projection.crmJobId,
      status: args.projection.status,
      scheduledAt: args.projection.scheduledAt,
      completedAt: args.projection.completedAt,
      technicianName: undefined,
      serviceType: args.projection.serviceType,
      ticketAmountUsd: args.projection.ticketAmountUsd,
      photos: [],
      notes: args.projection.notes,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const upsertServiceJobFromSubCustomerInternal = internalMutation({
  args: {
    businessId: v.id("businesses"),
    projection: v.object({
      crmJobId: v.string(),
      parentCrmCustomerId: v.optional(v.string()),
      serviceType: v.optional(v.string()),
      notes: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args): Promise<Id<"serviceJobs">> => {
    let customerId: Id<"serviceCustomers"> | undefined = undefined;
    if (args.projection.parentCrmCustomerId) {
      const parent = await ctx.db
        .query("serviceCustomers")
        .withIndex("by_business_and_crm_id", (q) =>
          q
            .eq("businessId", args.businessId)
            .eq("crmCustomerId", args.projection.parentCrmCustomerId)
        )
        .first();
      customerId = parent?._id;
    }
    const existing = await ctx.db
      .query("serviceJobs")
      .withIndex("by_business_and_crm_id", (q) =>
        q
          .eq("businessId", args.businessId)
          .eq("crmJobId", args.projection.crmJobId)
      )
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        customerId: customerId ?? existing.customerId,
        serviceType: args.projection.serviceType ?? existing.serviceType,
        notes: args.projection.notes ?? existing.notes,
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("serviceJobs", {
      businessId: args.businessId,
      customerId,
      crmJobId: args.projection.crmJobId,
      // Sub-customer rows arrive without lifecycle status — default to
      // "scheduled" so Today/Jobs HQ surfaces them; invoice events promote
      // to completed later.
      status: "scheduled",
      photos: [],
      serviceType: args.projection.serviceType,
      notes: args.projection.notes,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/* -------------------------------------------------------------------------- */
/* CRM connection table writers + readers                                      */
/* -------------------------------------------------------------------------- */

export const upsertQboConnectionInternal = internalMutation({
  args: {
    businessId: v.id("businesses"),
    encryptedConnectionId: v.string(),
    scopes: v.array(v.string()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Id<"crmConnections">> => {
    const existing = await ctx.db
      .query("crmConnections")
      .withIndex("by_business_and_provider", (q) =>
        q.eq("businessId", args.businessId).eq("provider", QBO_PROVIDER)
      )
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        oauthAccessToken: args.encryptedConnectionId,
        oauthRefreshToken: undefined, // Unified manages refresh — we don't carry it
        scopes: args.scopes,
        expiresAt: args.expiresAt,
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("crmConnections", {
      businessId: args.businessId,
      provider: QBO_PROVIDER,
      // We persist the encrypted Unified `connection_id` in the
      // `oauthAccessToken` slot. Unified is the OAuth principal — we never
      // hold the underlying QBO access/refresh tokens directly. This is by
      // design: aggregator ownership of token refresh is the whole point.
      oauthAccessToken: args.encryptedConnectionId,
      oauthRefreshToken: undefined,
      scopes: args.scopes,
      expiresAt: args.expiresAt,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const findConnectionForBusinessInternal = internalQuery({
  args: { businessId: v.id("businesses") },
  handler: async (
    ctx,
    args
  ): Promise<{
    encryptedConnectionId: string;
    scopes: string[];
  } | null> => {
    const row = await ctx.db
      .query("crmConnections")
      .withIndex("by_business_and_provider", (q) =>
        q.eq("businessId", args.businessId).eq("provider", QBO_PROVIDER)
      )
      .first();
    if (!row || !row.oauthAccessToken) return null;
    return {
      encryptedConnectionId: row.oauthAccessToken,
      scopes: row.scopes,
    };
  },
});

/**
 * Resolve businessId for an inbound webhook by decrypting each QBO
 * connection blob and comparing against the connection id in the event.
 * Called from the webhook receiver action AFTER signature verification.
 *
 * Linear scan is acceptable at our scale. Documented for follow-up: a
 * dedicated `unifiedConnectionId` column + index would make this O(1) but
 * requires a schema change; we deliberately stayed schema-clean for v0.
 */
export const resolveBusinessForUnifiedConnectionInternal = internalQuery({
  args: {},
  handler: async (
    ctx
  ): Promise<
    Array<{ businessId: Id<"businesses">; encryptedConnectionId: string }>
  > => {
    const rows = await ctx.db
      .query("crmConnections")
      .filter((q) => q.eq(q.field("provider"), QBO_PROVIDER))
      .collect();
    return rows
      .filter((r) => !!r.oauthAccessToken)
      .map((r) => ({
        businessId: r.businessId,
        encryptedConnectionId: r.oauthAccessToken!,
      }));
  },
});

/* -------------------------------------------------------------------------- */
/* Public connect / callback / disconnect actions                              */
/* -------------------------------------------------------------------------- */

const getMyBusinessForCrm = internalQuery({
  args: { clerkUserId: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{
    business: Doc<"businesses">;
    accountId: Id<"creators">;
  } | null> => {
    const account = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", args.clerkUserId))
      .first();
    if (!account) return null;
    if (account.accountType !== "service-business" || !account.businessId) {
      return null;
    }
    const business = await ctx.db.get(account.businessId);
    if (!business) return null;
    return { business, accountId: account._id };
  },
});
export { getMyBusinessForCrm };

/**
 * Kick off the Unified-hosted OAuth flow for QuickBooks Online.
 *
 * Plan-tier-gated to Pro+ via `requireFeatureService`. Starter is rejected
 * fail-closed — the rejection lands as a `PlanServiceGateError` which the
 * frontend can map to an upgrade prompt.
 */
export const connectQbo = action({
  args: {
    redirectUri: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ authUrl: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("QBO connect: not authenticated.");
    }
    const ctxRow: {
      business: Doc<"businesses">;
      accountId: Id<"creators">;
    } | null = await ctx.runQuery(internal.integrations.crm.quickbooks.getMyBusinessForCrm, {
      clerkUserId: identity.subject,
    });
    if (!ctxRow) {
      throw new Error("QBO connect: no service-business row for signed-in user.");
    }
    requireFeatureService(
      ctxRow.business,
      (f) => f.crmIntegration === true,
      "qbo:connect",
      "pro"
    );

    const apiKey = readUnifiedApiKey();
    const workspaceId = readUnifiedWorkspaceId();
    const client = new UnifiedClient({ apiKey });
    const { authUrl } = await startConnectionAuth(client, {
      provider: UNIFIED_QBO_PROVIDER,
      workspaceId,
      redirectUri: args.redirectUri,
      state: { businessId: String(ctxRow.business._id) },
    });
    return { authUrl };
  },
});

/**
 * Receive the connection_id from Unified after the operator finishes the
 * hosted-auth flow. Persists the encrypted connection id + scopes in
 * `crmConnections`.
 */
export const handleQboCallback = action({
  args: {
    connectionId: v.string(),
    scopes: v.array(v.string()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ connectionRowId: Id<"crmConnections"> }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("QBO callback: not authenticated.");
    }
    const ctxRow: {
      business: Doc<"businesses">;
      accountId: Id<"creators">;
    } | null = await ctx.runQuery(internal.integrations.crm.quickbooks.getMyBusinessForCrm, {
      clerkUserId: identity.subject,
    });
    if (!ctxRow) {
      throw new Error("QBO callback: no service-business row for signed-in user.");
    }
    requireFeatureService(
      ctxRow.business,
      (f) => f.crmIntegration === true,
      "qbo:callback",
      "pro"
    );

    if (!args.connectionId || args.connectionId.length === 0) {
      throw new UnifiedApiError(
        200,
        "/qbo/callback",
        "Unified callback did not return a connection id."
      );
    }
    const encryptedConnectionId = await encrypt(args.connectionId);
    const rowId: Id<"crmConnections"> = await ctx.runMutation(
      internal.integrations.crm.quickbooks.upsertQboConnectionInternal,
      {
        businessId: ctxRow.business._id,
        encryptedConnectionId,
        scopes: args.scopes,
        expiresAt: args.expiresAt,
      }
    );
    return { connectionRowId: rowId };
  },
});

export const disconnectQbo = action({
  args: {},
  handler: async (
    ctx
  ): Promise<{ disconnected: boolean }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("QBO disconnect: not authenticated.");
    }
    const ctxRow: {
      business: Doc<"businesses">;
      accountId: Id<"creators">;
    } | null = await ctx.runQuery(internal.integrations.crm.quickbooks.getMyBusinessForCrm, {
      clerkUserId: identity.subject,
    });
    if (!ctxRow) {
      throw new Error("QBO disconnect: no service-business row for signed-in user.");
    }
    // Disconnect is allowed at any tier — operator can always sever an
    // existing connection. This avoids stranding paid features on a row.
    return await ctx.runMutation(
      internal.integrations.crm.quickbooks.deleteConnectionInternal,
      { businessId: ctxRow.business._id }
    );
  },
});

export const deleteConnectionInternal = internalMutation({
  args: { businessId: v.id("businesses") },
  handler: async (
    ctx,
    args
  ): Promise<{ disconnected: boolean }> => {
    const row = await ctx.db
      .query("crmConnections")
      .withIndex("by_business_and_provider", (q) =>
        q.eq("businessId", args.businessId).eq("provider", QBO_PROVIDER)
      )
      .first();
    if (!row) return { disconnected: false };
    await ctx.db.delete(row._id);
    return { disconnected: true };
  },
});

/* -------------------------------------------------------------------------- */
/* Re-exports for the webhook receiver                                         */
/* -------------------------------------------------------------------------- */

// Re-export error sniffing for the webhook receiver to identify a token-
// expired condition + queue a refresh prompt. Keeps the dependency tree
// shallow.
export { UnifiedAuthError };
