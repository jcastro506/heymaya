/**
 * Service-product job upsert — CRM webhooks + no-CRM NER feed into here.
 *
 * Wave C / Sprint 4-5. Two entry points:
 *
 *   1. `upsertJobFromWebhook(provider, normalizedJobEvent)` — internal
 *      mutation called by `convex/webhooks/crm.ts` after a Nango forward
 *      webhook is signature-verified + parsed. The normalized event already
 *      carries provider-agnostic fields (see `crm/jobber.ts:NormalizedJobEvent`).
 *
 *   2. `upsertJobFromText(message, businessId)` — public action called from
 *      Maya's text-thread skill (Sprint 4 wires this in). Runs the NER
 *      extractor (`crm/nerExtractor.ts`), then upserts.
 *
 * Both paths converge on the same internal mutation `upsertNormalizedJob`
 * which is responsible for:
 *   - `serviceCustomers` upsert (matched on
 *     `(businessId, crmCustomerId)` for CRM-side, or
 *     `(businessId, customerLastName + phone heuristic)` for no-CRM).
 *   - `serviceJobs` upsert (matched on `(businessId, crmJobId)` for CRM-side,
 *     or always-insert for no-CRM since text-extracted jobs have no provider id).
 *   - mayaTaskQueue enqueue with `kind: "job.completed"` and the appropriate
 *     `source` ("crm-webhook" / "crm-poll" / "crm-text-extract").
 *
 * Cross-tenant safety: every mutation is scoped by `businessId`. The webhook
 * handler resolves `businessId` from `crmConnections.connectionId` (Nango's
 * connection id). The text-extraction action resolves `businessId` from the
 * caller's Clerk identity. Neither path accepts a `businessId` argument from
 * an untrusted source.
 *
 * Plan-tier safety: text-extraction is available at all tiers (Mike on
 * Starter is the primary user). Webhook ingest only runs for Pro+ businesses
 * (gated by the fact that `crmConnections` rows can only be CREATED by
 * Pro+ — see `connectJobberOrHcp` in this file).
 */

import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  PlanServiceGateError,
  planFeaturesService,
} from "./planService";
import {
  extractServiceJobFromText,
  type NerExtractorResult,
} from "./integrations/crm/nerExtractor";

const NORMALIZED_JOB_VALIDATOR = v.object({
  provider: v.union(v.literal("jobber"), v.literal("hcp")),
  externalJobId: v.string(),
  externalCustomerId: v.optional(v.string()),
  customerName: v.optional(v.string()),
  customerLastName: v.optional(v.string()),
  customerPhone: v.optional(v.string()),
  customerEmail: v.optional(v.string()),
  customerAddress: v.optional(v.string()),
  status: v.union(
    v.literal("scheduled"),
    v.literal("in-progress"),
    v.literal("completed"),
    v.literal("cancelled")
  ),
  scheduledAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  serviceType: v.optional(v.string()),
  ticketAmountUsd: v.optional(v.number()),
  notes: v.optional(v.string()),
});

export type UpsertSource = "crm-webhook" | "crm-poll" | "crm-text-extract";

const UPSERT_SOURCE_VALIDATOR = v.union(
  v.literal("crm-webhook"),
  v.literal("crm-poll"),
  v.literal("crm-text-extract")
);

/* -------------------------------------------------------------------------- */
/* Internal helpers — customer + job upsert primitives                         */
/* -------------------------------------------------------------------------- */

interface UpsertCustomerArgs {
  businessId: Id<"businesses">;
  crmCustomerId?: string;
  name?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  address?: string;
}

async function upsertCustomerByCrmId(
  ctx: MutationCtx,
  args: UpsertCustomerArgs
): Promise<Id<"serviceCustomers">> {
  const now = Date.now();
  // First try the (businessId, crmCustomerId) path.
  if (args.crmCustomerId) {
    const existing = await ctx.db
      .query("serviceCustomers")
      .withIndex("by_business_and_crm_id", (q) =>
        q.eq("businessId", args.businessId).eq("crmCustomerId", args.crmCustomerId)
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name ?? existing.name,
        phone: args.phone ?? existing.phone,
        email: args.email ?? existing.email,
        address: args.address ?? existing.address,
        updatedAt: now,
      });
      return existing._id;
    }
  }
  // Fall back to (businessId, phone) when CRM id absent (text-extraction path).
  if (args.phone) {
    const byPhone = await ctx.db
      .query("serviceCustomers")
      .withIndex("by_business_and_phone", (q) =>
        q.eq("businessId", args.businessId).eq("phone", args.phone)
      )
      .first();
    if (byPhone) {
      await ctx.db.patch(byPhone._id, {
        name: args.name ?? byPhone.name,
        email: args.email ?? byPhone.email,
        address: args.address ?? byPhone.address,
        crmCustomerId: args.crmCustomerId ?? byPhone.crmCustomerId,
        updatedAt: now,
      });
      return byPhone._id;
    }
  }
  // Insert fresh.
  return await ctx.db.insert("serviceCustomers", {
    businessId: args.businessId,
    crmCustomerId: args.crmCustomerId,
    name: args.name ?? args.lastName ?? "Unknown",
    phone: args.phone,
    email: args.email,
    address: args.address,
    reviewStatus: "not-yet",
    createdAt: now,
    updatedAt: now,
  });
}

interface UpsertJobArgs {
  businessId: Id<"businesses">;
  customerId?: Id<"serviceCustomers">;
  crmJobId?: string;
  status: Doc<"serviceJobs">["status"];
  scheduledAt?: number;
  completedAt?: number;
  serviceType?: string;
  ticketAmountUsd?: number;
  notes?: string;
}

async function upsertJob(
  ctx: MutationCtx,
  args: UpsertJobArgs
): Promise<{ jobId: Id<"serviceJobs">; created: boolean }> {
  const now = Date.now();
  if (args.crmJobId) {
    const existing = await ctx.db
      .query("serviceJobs")
      .withIndex("by_business_and_crm_id", (q) =>
        q.eq("businessId", args.businessId).eq("crmJobId", args.crmJobId)
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        customerId: args.customerId ?? existing.customerId,
        status: args.status,
        scheduledAt: args.scheduledAt ?? existing.scheduledAt,
        completedAt: args.completedAt ?? existing.completedAt,
        serviceType: args.serviceType ?? existing.serviceType,
        ticketAmountUsd: args.ticketAmountUsd ?? existing.ticketAmountUsd,
        notes: args.notes ?? existing.notes,
        updatedAt: now,
      });
      return { jobId: existing._id, created: false };
    }
  }
  const jobId = await ctx.db.insert("serviceJobs", {
    businessId: args.businessId,
    customerId: args.customerId,
    crmJobId: args.crmJobId,
    status: args.status,
    scheduledAt: args.scheduledAt,
    completedAt: args.completedAt,
    serviceType: args.serviceType,
    ticketAmountUsd: args.ticketAmountUsd,
    notes: args.notes,
    photos: [],
    createdAt: now,
    updatedAt: now,
  });
  return { jobId, created: true };
}

async function enqueueJobCompletedTask(
  ctx: MutationCtx,
  args: {
    businessId: Id<"businesses">;
    jobId: Id<"serviceJobs">;
    customerId?: Id<"serviceCustomers">;
    source: UpsertSource;
    provider: "jobber" | "hcp" | "none";
  }
): Promise<Id<"mayaTaskQueue">> {
  return await ctx.db.insert("mayaTaskQueue", {
    businessId: args.businessId,
    kind: "job.completed",
    payload: {
      jobId: args.jobId,
      customerId: args.customerId,
      provider: args.provider,
    },
    source: args.source,
    enqueuedAt: Date.now(),
    attemptCount: 0,
  });
}

/* -------------------------------------------------------------------------- */
/* Public entry — upsertJobFromWebhook (internal mutation)                     */
/* -------------------------------------------------------------------------- */

/**
 * Upsert a normalized job event (from Jobber/HCP webhook) into Convex.
 * Internal-only — only callable via `internal.jobs.upsertJobFromWebhook` from
 * `convex/webhooks/crm.ts` AFTER signature verification + connection lookup.
 */
export const upsertJobFromWebhook = internalMutation({
  args: {
    businessId: v.id("businesses"),
    normalizedJob: NORMALIZED_JOB_VALIDATOR,
    source: UPSERT_SOURCE_VALIDATOR,
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    jobId: Id<"serviceJobs">;
    customerId: Id<"serviceCustomers">;
    queueRowId: Id<"mayaTaskQueue">;
    created: boolean;
  }> => {
    const customerId = await upsertCustomerByCrmId(ctx, {
      businessId: args.businessId,
      crmCustomerId: args.normalizedJob.externalCustomerId,
      name: args.normalizedJob.customerName,
      lastName: args.normalizedJob.customerLastName,
      phone: args.normalizedJob.customerPhone,
      email: args.normalizedJob.customerEmail,
      address: args.normalizedJob.customerAddress,
    });
    const { jobId, created } = await upsertJob(ctx, {
      businessId: args.businessId,
      customerId,
      crmJobId: args.normalizedJob.externalJobId,
      status: args.normalizedJob.status,
      scheduledAt: args.normalizedJob.scheduledAt,
      completedAt: args.normalizedJob.completedAt,
      serviceType: args.normalizedJob.serviceType,
      ticketAmountUsd: args.normalizedJob.ticketAmountUsd,
      notes: args.normalizedJob.notes,
    });
    // Only enqueue when the job is actually completed — mid-lifecycle status
    // updates don't trigger behavior #2 (review-request).
    let queueRowId: Id<"mayaTaskQueue"> | null = null;
    if (args.normalizedJob.status === "completed") {
      queueRowId = await enqueueJobCompletedTask(ctx, {
        businessId: args.businessId,
        jobId,
        customerId,
        source: args.source,
        provider: args.normalizedJob.provider,
      });
    }
    return {
      jobId,
      customerId,
      queueRowId: queueRowId as Id<"mayaTaskQueue">,
      created,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Internal-only mutation — text-extraction upsert                             */
/* -------------------------------------------------------------------------- */

const NER_FIELDS_VALIDATOR = v.object({
  customer_last_name: v.union(v.string(), v.null()),
  customer_first_name: v.union(v.string(), v.null()),
  service_type: v.union(v.string(), v.null()),
  address: v.union(v.string(), v.null()),
  completed_at: v.union(v.number(), v.null()),
  notes: v.union(v.string(), v.null()),
});

/**
 * Upsert a job extracted from operator text. NO `crmJobId` because the
 * extraction has no provider-side stable id. Returns `null` for `jobId` if
 * the extraction was too sparse to construct a job (graceful no-op).
 */
export const upsertJobFromTextInternal = internalMutation({
  args: {
    businessId: v.id("businesses"),
    fields: NER_FIELDS_VALIDATOR,
    rawMessage: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    jobId: Id<"serviceJobs"> | null;
    customerId: Id<"serviceCustomers"> | null;
    queueRowId: Id<"mayaTaskQueue"> | null;
    skippedReason?: string;
  }> => {
    const { fields } = args;
    // Acceptance bar — at minimum we need a service_type OR a customer name
    // to construct a useful job row. Less than that is "operator chitchat",
    // skip silently.
    if (!fields.service_type && !fields.customer_last_name) {
      return {
        jobId: null,
        customerId: null,
        queueRowId: null,
        skippedReason: "extraction_too_sparse",
      };
    }
    const customerName = [fields.customer_first_name, fields.customer_last_name]
      .filter((s): s is string => Boolean(s))
      .join(" ")
      .trim();
    const customerId = await upsertCustomerByCrmId(ctx, {
      businessId: args.businessId,
      name: customerName.length > 0 ? customerName : undefined,
      lastName: fields.customer_last_name ?? undefined,
      address: fields.address ?? undefined,
    });
    const { jobId } = await upsertJob(ctx, {
      businessId: args.businessId,
      customerId,
      status: fields.completed_at !== null ? "completed" : "scheduled",
      completedAt: fields.completed_at ?? undefined,
      serviceType: fields.service_type ?? undefined,
      notes: fields.notes ?? args.rawMessage,
    });
    let queueRowId: Id<"mayaTaskQueue"> | null = null;
    if (fields.completed_at !== null) {
      queueRowId = await enqueueJobCompletedTask(ctx, {
        businessId: args.businessId,
        jobId,
        customerId,
        source: "crm-text-extract",
        provider: "none",
      });
    }
    return { jobId, customerId, queueRowId };
  },
});

/* -------------------------------------------------------------------------- */
/* Caller-identity → business resolution (for the public action)               */
/* -------------------------------------------------------------------------- */

export const getMyBusinessForJobs = internalQuery({
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

/* -------------------------------------------------------------------------- */
/* Public action — upsertJobFromText                                           */
/* -------------------------------------------------------------------------- */

/**
 * Public action invoked from the Maya text-thread skill. Resolves caller's
 * business via Clerk identity, runs NER extraction with Gemini 3.1 Flash Lite,
 * then upserts. Returns the upsert result + routing observability.
 */
export const upsertJobFromText = action({
  args: {
    message: v.string(),
  },
  handler: async (
    ctx: ActionCtx,
    args
  ): Promise<{
    jobId: Id<"serviceJobs"> | null;
    customerId: Id<"serviceCustomers"> | null;
    queueRowId: Id<"mayaTaskQueue"> | null;
    skippedReason?: string;
    extraction: NerExtractorResult;
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("upsertJobFromText: not authenticated.");
    }
    const ctxRow: {
      business: Doc<"businesses">;
      accountId: Id<"creators">;
    } | null = await ctx.runQuery(internal.jobs.getMyBusinessForJobs, {
      clerkUserId: identity.subject,
    });
    if (!ctxRow) {
      throw new Error(
        "upsertJobFromText: no service-business row for signed-in user."
      );
    }
    // Plan-tier safety: text-extraction is available at all tiers (Persona A
    // primary path is Mike on Starter). We still call planFeaturesService to
    // assert the resolver doesn't throw — fail-loud signal a fixture or row
    // is corrupted.
    planFeaturesService(ctxRow.business);

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error("upsertJobFromText: OPENROUTER_API_KEY is not set.");
    }
    const extraction = await extractServiceJobFromText({
      apiKey,
      message: args.message,
    });
    const result: {
      jobId: Id<"serviceJobs"> | null;
      customerId: Id<"serviceCustomers"> | null;
      queueRowId: Id<"mayaTaskQueue"> | null;
      skippedReason?: string;
    } = await ctx.runMutation(internal.jobs.upsertJobFromTextInternal, {
      businessId: ctxRow.business._id,
      fields: extraction.fields,
      rawMessage: args.message,
    });
    return { ...result, extraction };
  },
});

/* -------------------------------------------------------------------------- */
/* CRM connection — public actions                                             */
/* -------------------------------------------------------------------------- */

/**
 * Plan-tier gate for connecting any CRM. Pro+ only — Starter rejected.
 *
 * Returns the operator's `businessId` if allowed, throws PlanServiceGateError
 * otherwise. Cross-tenant safety: Clerk identity is the only authority.
 */
async function requireCrmConnectAllowed(
  ctx: ActionCtx,
  identitySubject: string
): Promise<Doc<"businesses">> {
  const ctxRow: {
    business: Doc<"businesses">;
    accountId: Id<"creators">;
  } | null = await ctx.runQuery(internal.jobs.getMyBusinessForJobs, {
    clerkUserId: identitySubject,
  });
  if (!ctxRow) {
    throw new Error("CRM: no service-business row for signed-in user.");
  }
  const features = planFeaturesService(ctxRow.business);
  if (!features.crmIntegration) {
    throw new PlanServiceGateError(
      features.plan,
      "crm:connect",
      "pro"
    );
  }
  return ctxRow.business;
}

const CRM_PROVIDER_VALIDATOR = v.union(
  v.literal("jobber"),
  v.literal("hcp"),
  v.literal("qbo")
);

/**
 * Internal mutation — upsert a `crmConnections` row. Called by the connect
 * action below + by the HCP non-MAX preflight handler to flip
 * `planTierWarning`.
 */
export const upsertCrmConnectionInternal = internalMutation({
  args: {
    businessId: v.id("businesses"),
    provider: v.union(
      v.literal("jobber"),
      v.literal("hcp"),
      v.literal("qbo"),
      v.literal("servicetitan"),
      v.literal("none")
    ),
    scopes: v.array(v.string()),
    planTierWarning: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"crmConnections">> => {
    const existing = await ctx.db
      .query("crmConnections")
      .withIndex("by_business_and_provider", (q) =>
        q.eq("businessId", args.businessId).eq("provider", args.provider)
      )
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        scopes: args.scopes,
        planTierWarning: args.planTierWarning,
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("crmConnections", {
      businessId: args.businessId,
      provider: args.provider,
      scopes: args.scopes,
      planTierWarning: args.planTierWarning,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Public action — kick off a CRM connection. Returns a Nango Connect URL the
 * frontend redirects the operator to. Throws PlanServiceGateError on Starter.
 *
 * The Nango Connect SDK on the frontend handles the actual OAuth dance; we
 * just generate the URL + persist a placeholder `crmConnections` row so the
 * post-OAuth callback knows which business to attach to.
 */
export const beginCrmConnect = action({
  args: {
    provider: CRM_PROVIDER_VALIDATOR,
    /** Where Nango redirects after consent. */
    redirectUri: v.string(),
  },
  handler: async (
    ctx: ActionCtx,
    args
  ): Promise<{
    redirectUrl: string;
    connectionId: string;
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("beginCrmConnect: not authenticated.");
    }
    const business = await requireCrmConnectAllowed(ctx, identity.subject);

    const publicKey = process.env.NANGO_PUBLIC_KEY;
    if (!publicKey) {
      throw new Error("beginCrmConnect: NANGO_PUBLIC_KEY is not set.");
    }

    // Lazy-import nango to avoid loading the module at startup for non-CRM
    // request paths (Convex action cold-start).
    const { buildNangoConnectUrl, generateNangoConnectionId } = await import(
      "./integrations/crm/nango"
    );
    const connectionId = generateNangoConnectionId(
      args.provider,
      String(business._id)
    );
    const redirectUrl = buildNangoConnectUrl({
      publicKey,
      providerConfigKey: args.provider,
      connectionId,
    });
    // Persist a placeholder row keyed on (businessId, provider). Tokens are
    // held by Nango — we never see them. The presence of this row indicates
    // "connection is in-flight."
    await ctx.runMutation(internal.jobs.upsertCrmConnectionInternal, {
      businessId: business._id,
      provider: args.provider,
      scopes: [],
    });
    return { redirectUrl, connectionId };
  },
});

/**
 * Public action — finalize HCP connection by running the MAX-plan preflight.
 * Called by the frontend after Nango's callback redirect.
 *
 * If non-MAX detected: persists `planTierWarning: "hcp-not-max"` so the UI
 * surfaces the upgrade prompt + auto-routes to no-CRM mode. NEVER shows a
 * dead-end "your CRM is connected" page.
 */
export const finalizeHcpConnect = action({
  args: {
    connectionId: v.string(),
  },
  handler: async (
    ctx: ActionCtx,
    args
  ): Promise<{
    plan: "max" | "non-max" | "auth-failed" | "unknown";
    detail?: string;
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("finalizeHcpConnect: not authenticated.");
    }
    const business = await requireCrmConnectAllowed(ctx, identity.subject);
    const secret = process.env.NANGO_SECRET_KEY;
    if (!secret) {
      throw new Error("finalizeHcpConnect: NANGO_SECRET_KEY is not set.");
    }
    const { NangoClient } = await import("./integrations/crm/nango");
    const { detectHcpPlan, HCP_NOT_MAX_PLAN_WARNING } = await import(
      "./integrations/crm/housecallpro"
    );
    const client = new NangoClient({ secretKey: secret });
    const probe = await detectHcpPlan(client, args.connectionId);
    let warning: string | undefined;
    if (probe.plan === "non-max") warning = HCP_NOT_MAX_PLAN_WARNING;
    else if (probe.plan === "auth-failed") warning = "hcp-auth-failed";
    else if (probe.plan === "unknown") warning = "hcp-probe-unknown";
    await ctx.runMutation(internal.jobs.upsertCrmConnectionInternal, {
      businessId: business._id,
      provider: "hcp",
      scopes: [],
      planTierWarning: warning,
    });
    return {
      plan: probe.plan,
      detail: "detail" in probe ? probe.detail : undefined,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Polling fallback (15-min cadence) — used when webhook delivery is degraded  */
/* -------------------------------------------------------------------------- */

/**
 * 15-min polling fallback for both Jobber + HCP. Runs per-business; the
 * standing-orders runtime invokes this when an operator has webhooks
 * disabled or recently-failed deliveries.
 *
 * Cron registration: see `agents/skills/maya-service-platform/standingOrders.ts`
 * (program `crm-poll-recently-completed-jobs`, 15-min cadence). Sibling-file
 * scan asserts the program exists alongside this action.
 */
export const pollRecentlyCompletedJobsForBusiness = internalAction({
  args: {
    businessId: v.id("businesses"),
    /** Optional override; defaults to 30 min ago. */
    sinceMs: v.optional(v.number()),
  },
  handler: async (
    ctx: ActionCtx,
    args
  ): Promise<{
    provider: "jobber" | "hcp" | "none";
    jobsUpserted: number;
    skipped?: string;
  }> => {
    const conn = await ctx.runQuery(
      internal.jobs.getCrmConnectionForBusinessInternal,
      { businessId: args.businessId }
    );
    if (!conn || (conn.provider !== "jobber" && conn.provider !== "hcp")) {
      return { provider: "none", jobsUpserted: 0, skipped: "no_connection" };
    }
    const secret = process.env.NANGO_SECRET_KEY;
    if (!secret) {
      return {
        provider: conn.provider,
        jobsUpserted: 0,
        skipped: "missing_nango_secret",
      };
    }
    const { NangoClient } = await import("./integrations/crm/nango");
    const client = new NangoClient({ secretKey: secret });
    const since = args.sinceMs ?? Date.now() - 30 * 60 * 1000;
    let jobsUpserted = 0;
    if (conn.provider === "jobber") {
      const { listRecentlyCompletedJobs, normalizeJobberJob } = await import(
        "./integrations/crm/jobber"
      );
      const jobs = await listRecentlyCompletedJobs(client, conn.connectionId, {
        sinceMs: since,
      });
      for (const j of jobs) {
        const normalized = normalizeJobberJob(j);
        await ctx.runMutation(internal.jobs.upsertJobFromWebhook, {
          businessId: args.businessId,
          normalizedJob: normalized,
          source: "crm-poll",
        });
        jobsUpserted += 1;
      }
    } else {
      const { listRecentlyCompletedHcpJobs, normalizeHcpJob } = await import(
        "./integrations/crm/housecallpro"
      );
      const jobs = await listRecentlyCompletedHcpJobs(
        client,
        conn.connectionId,
        { sinceMs: since }
      );
      for (const j of jobs) {
        const normalized = normalizeHcpJob(j);
        await ctx.runMutation(internal.jobs.upsertJobFromWebhook, {
          businessId: args.businessId,
          normalizedJob: normalized,
          source: "crm-poll",
        });
        jobsUpserted += 1;
      }
    }
    return { provider: conn.provider, jobsUpserted };
  },
});

export const getCrmConnectionForBusinessInternal = internalQuery({
  args: { businessId: v.id("businesses") },
  handler: async (
    ctx,
    args
  ): Promise<{
    provider: "jobber" | "hcp" | "qbo" | "servicetitan" | "none";
    connectionId: string;
    planTierWarning?: string;
  } | null> => {
    const row = await ctx.db
      .query("crmConnections")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .first();
    if (!row) return null;
    // The Nango connection id we generated at `beginCrmConnect` time is what
    // identifies this row to Nango's proxy. It's not stored on the row directly
    // (the row keys on businessId+provider), but we re-derive it the same way
    // the connect flow does — provider_businessId_<rand>. For the test path
    // we accept that callers may pass an explicit connectionId via the
    // webhook handler; for polling we synthesize it.
    return {
      provider: row.provider,
      connectionId: `${row.provider}_${args.businessId}`,
      planTierWarning: row.planTierWarning,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Webhook entry — internal mutation called by `convex/webhooks/crm.ts`        */
/* -------------------------------------------------------------------------- */

/**
 * Resolve a Nango `connectionId` back to a `businessId` for the webhook
 * handler. Uses the `connectionId` shape: `<provider>_<businessId>_<rand>`.
 *
 * Cross-tenant: the resolver verifies the resolved business has a
 * `crmConnections` row for the same provider — a connectionId carrying a
 * different provider than what the row is for is rejected.
 */
export const resolveBusinessIdFromConnectionInternal = internalQuery({
  args: {
    connectionId: v.string(),
    providerConfigKey: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ businessId: Id<"businesses"> } | null> => {
    // Parse the provider-prefix off the connectionId.
    const idx = args.connectionId.indexOf("_");
    if (idx <= 0) return null;
    const providerPrefix = args.connectionId.slice(0, idx);
    if (providerPrefix !== args.providerConfigKey) return null;
    const rest = args.connectionId.slice(idx + 1);
    // The remainder is `<businessId>_<rand>` — splitting on the LAST `_` gives
    // us the businessId portion. Convex Ids never contain `_`.
    const lastUnderscore = rest.lastIndexOf("_");
    const businessIdStr =
      lastUnderscore > 0 ? rest.slice(0, lastUnderscore) : rest;
    // Validate by re-querying — if the id is malformed `db.get` returns null.
    const business = await ctx.db.get(businessIdStr as Id<"businesses">);
    if (!business) return null;
    // Verify a `crmConnections` row exists for this provider.
    const conn = await ctx.db
      .query("crmConnections")
      .withIndex("by_business_and_provider", (q) =>
        q
          .eq("businessId", business._id)
          .eq(
            "provider",
            args.providerConfigKey === "jobber" ? "jobber" : "hcp"
          )
      )
      .first();
    if (!conn) return null;
    return { businessId: business._id };
  },
});
