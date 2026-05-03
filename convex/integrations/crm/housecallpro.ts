/**
 * Housecall Pro (HCP) integration via Nango.
 *
 * Wave C / Sprint 5. HCP is a REST API, OAuth 2.0. Nango handles the OAuth
 * dance + token refresh; we hit Nango's proxy with our `connectionId`.
 *
 * What this module owns:
 *   - Typed REST wrappers (jobs / customers).
 *   - **MAX-plan detection** post-OAuth — HCP's API + webhooks require the
 *     MAX subscription tier ($329/mo). Non-MAX customers see 403 / 404 on
 *     the API surface; we detect that, persist `crmConnections.planTierWarning`
 *     so the UI can offer "upgrade or polling fallback" without showing a
 *     dead-end "your CRM is connected" page.
 *   - Webhook normalization (HCP `job.completed` → our normalized shape).
 *   - 15-min polling fallback (same cadence as Jobber).
 *
 * Cross-tenant safety: every REST call carries a `connectionId` per the
 * `crmConnections` row scoped by `businessId`.
 *
 * Plan-tier safety: Pro+ only — gated upstream in the Convex action layer.
 */

import {
  NangoApiError,
  NangoAuthError,
  NangoClient,
  type NangoWebhookEnvelope,
} from "./nango";
import type { NormalizedJobEvent } from "./jobber";

/** Nango provider config key for HCP. */
export const HCP_PROVIDER_KEY = "housecallpro";

/**
 * MAX-plan detection sentinel — written to `crmConnections.planTierWarning`
 * when HCP returns 403/404 on the gated endpoints during the post-OAuth
 * preflight.
 */
export const HCP_NOT_MAX_PLAN_WARNING = "hcp-not-max";

/* -------------------------------------------------------------------------- */
/* HCP REST types                                                              */
/* -------------------------------------------------------------------------- */

export interface HcpCustomer {
  id: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  email?: string;
  mobile_number?: string;
  home_number?: string;
  work_number?: string;
  addresses?: Array<{
    street?: string;
    street_line_2?: string;
    city?: string;
    state?: string;
    zip?: string;
  }>;
}

export interface HcpJob {
  id: string;
  invoice_number?: string;
  description?: string;
  work_status?: string;
  schedule?: {
    scheduled_start?: string | null;
    scheduled_end?: string | null;
  };
  /**
   * Some HCP APIs surface `completed_at` directly, others derive it from
   * `work_timestamps.completed_at` — we accept both.
   */
  completed_at?: string | null;
  work_timestamps?: {
    completed_at?: string | null;
    on_my_way_at?: string | null;
  };
  total_amount?: number | null;
  customer?: HcpCustomer;
  customer_id?: string;
  service_address?: HcpCustomer["addresses"] extends Array<infer T> ? T : never;
}

/* -------------------------------------------------------------------------- */
/* MAX-plan detection                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Result of the post-OAuth preflight against HCP. Emitted by `detectHcpPlan`.
 *
 *   - "max"          — full API + webhook access; first-class integration.
 *   - "non-max"      — basic/essentials plan; API gated. We auto-route to
 *                       no-CRM mode (NER extractor) for this operator.
 *   - "auth-failed"  — token unusable; surface re-auth prompt.
 *   - "unknown"      — HCP returned a non-401/403/404 we didn't expect.
 */
export type HcpPlanProbe =
  | { plan: "max" }
  | { plan: "non-max"; detail: string }
  | { plan: "auth-failed"; detail: string }
  | { plan: "unknown"; detail: string };

/**
 * Probe HCP to detect MAX-plan eligibility. We call `GET /jobs?per_page=1`
 * (a cheap read against the gated surface). HCP returns:
 *   - 200      → MAX (or higher).
 *   - 401      → token invalid (re-auth).
 *   - 403/404  → API not enabled for this customer → non-MAX.
 *   - 5xx      → upstream issue, retry-friendly; surface as `unknown`.
 *
 * Caller (Convex action) writes the probe result into
 * `crmConnections.planTierWarning`:
 *   - max          → null (clear warning)
 *   - non-max      → "hcp-not-max"
 *   - auth-failed  → "hcp-auth-failed"
 *   - unknown      → "hcp-probe-unknown"
 */
export async function detectHcpPlan(
  client: NangoClient,
  connectionId: string
): Promise<HcpPlanProbe> {
  try {
    await client.proxy<unknown>({
      connectionId,
      providerConfigKey: HCP_PROVIDER_KEY,
      method: "GET",
      endpoint: "/jobs",
      query: { per_page: 1 },
    });
    return { plan: "max" };
  } catch (err) {
    // The Nango client surfaces 401 AND 403 both as NangoAuthError. For HCP
    // we want to disambiguate: 401 = bad token (auth-failed), 403 = API not
    // enabled for the customer's plan tier (non-max). The error message
    // includes "HTTP 401" or "HTTP 403" which we substring-match against.
    if (err instanceof NangoAuthError) {
      if (/HTTP 403/.test(err.message)) {
        return { plan: "non-max", detail: err.message };
      }
      return { plan: "auth-failed", detail: err.message };
    }
    if (err instanceof NangoApiError) {
      // 404 on this endpoint = API not enabled for this customer's plan.
      // (Nango maps 401/403 → NangoAuthError above; defensive 401 here.)
      if (err.status === 404 || err.status === 403) {
        return { plan: "non-max", detail: err.message };
      }
      if (err.status === 401) {
        return { plan: "auth-failed", detail: err.message };
      }
      return { plan: "unknown", detail: err.message };
    }
    return {
      plan: "unknown",
      detail: err instanceof Error ? err.message : "non-error throw",
    };
  }
}

/* -------------------------------------------------------------------------- */
/* REST wrappers                                                               */
/* -------------------------------------------------------------------------- */

export async function fetchHcpJobById(
  client: NangoClient,
  connectionId: string,
  jobId: string
): Promise<HcpJob | null> {
  try {
    return await client.proxy<HcpJob>({
      connectionId,
      providerConfigKey: HCP_PROVIDER_KEY,
      method: "GET",
      endpoint: `/jobs/${encodeURIComponent(jobId)}`,
    });
  } catch (err) {
    if (err instanceof NangoApiError && err.status === 404) {
      return null;
    }
    throw err;
  }
}

export async function listRecentlyCompletedHcpJobs(
  client: NangoClient,
  connectionId: string,
  opts: { sinceMs?: number; perPage?: number } = {}
): Promise<HcpJob[]> {
  const data = await client.proxy<{ jobs?: HcpJob[] }>({
    connectionId,
    providerConfigKey: HCP_PROVIDER_KEY,
    method: "GET",
    endpoint: "/jobs",
    query: {
      per_page: opts.perPage ?? 25,
      work_status: "completed",
      // HCP supports `scheduled_start_min` for filter; client-filters as
      // a fallback since the api is per-account-quirky.
      ...(opts.sinceMs !== undefined
        ? { updated_at_min: new Date(opts.sinceMs).toISOString() }
        : {}),
    },
  });
  const all = data.jobs ?? [];
  if (opts.sinceMs === undefined) return all;
  return all.filter((j) => {
    const ts = parseHcpCompletedAt(j);
    return ts !== undefined && ts >= (opts.sinceMs ?? 0);
  });
}

/* -------------------------------------------------------------------------- */
/* Normalization helpers                                                       */
/* -------------------------------------------------------------------------- */

function parseHcpCompletedAt(j: HcpJob): number | undefined {
  const candidate =
    j.completed_at ?? j.work_timestamps?.completed_at ?? undefined;
  if (!candidate) return undefined;
  const parsed = Date.parse(candidate);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseHcpScheduledAt(j: HcpJob): number | undefined {
  const candidate = j.schedule?.scheduled_start ?? undefined;
  if (!candidate) return undefined;
  const parsed = Date.parse(candidate);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Map HCP work_status → our 4-status enum.
 *   "scheduled" / "needs scheduling" → scheduled
 *   "in progress" / "on my way"      → in-progress
 *   "completed"                       → completed
 *   "canceled"                        → cancelled
 */
export function mapHcpStatus(
  status: string | undefined | null
): NormalizedJobEvent["status"] {
  if (!status) return "scheduled";
  const s = status.toLowerCase().trim();
  if (s === "completed" || s === "complete") return "completed";
  if (
    s === "in progress" ||
    s === "in_progress" ||
    s === "on my way" ||
    s === "on_my_way"
  ) {
    return "in-progress";
  }
  if (s === "canceled" || s === "cancelled") return "cancelled";
  return "scheduled";
}

function deriveHcpCustomerName(c: HcpCustomer | undefined): {
  name?: string;
  lastName?: string;
} {
  if (!c) return {};
  const lastName =
    c.last_name && c.last_name.trim().length > 0
      ? c.last_name
      : c.company && c.company.trim().length > 0
        ? c.company
        : undefined;
  const fullName =
    [c.first_name, c.last_name].filter(Boolean).join(" ").trim() ||
    c.company ||
    undefined;
  return { name: fullName, lastName };
}

function deriveHcpAddress(c: HcpCustomer | undefined): string | undefined {
  const addr = c?.addresses?.[0];
  if (!addr) return undefined;
  const pieces = [
    addr.street,
    addr.street_line_2,
    addr.city,
    addr.state,
    addr.zip,
  ].filter((p): p is string => Boolean(p));
  return pieces.length > 0 ? pieces.join(", ") : undefined;
}

export function normalizeHcpJob(j: HcpJob): NormalizedJobEvent {
  const { name, lastName } = deriveHcpCustomerName(j.customer);
  return {
    provider: "hcp",
    externalJobId: j.id,
    externalCustomerId: j.customer?.id ?? j.customer_id,
    customerName: name,
    customerLastName: lastName,
    customerPhone:
      j.customer?.mobile_number ??
      j.customer?.home_number ??
      j.customer?.work_number,
    customerEmail: j.customer?.email,
    customerAddress: deriveHcpAddress(j.customer),
    status: mapHcpStatus(j.work_status),
    scheduledAt: parseHcpScheduledAt(j),
    completedAt: parseHcpCompletedAt(j),
    serviceType: j.description ?? undefined,
    ticketAmountUsd:
      typeof j.total_amount === "number" && Number.isFinite(j.total_amount)
        ? j.total_amount
        : undefined,
  };
}

/* -------------------------------------------------------------------------- */
/* Webhook events                                                              */
/* -------------------------------------------------------------------------- */

/**
 * HCP webhook event types we care about for v0. HCP fires `job.completed` on
 * completion (the canonical Sprint 5 trigger) and `job.updated` on
 * mid-lifecycle changes. The full set is much larger — we route the two
 * below and audit-log everything else.
 */
export type HcpWebhookEventType =
  | "job.completed"
  | "job.updated"
  | "estimate.sent"
  | "invoice.created";

export interface HcpWebhookEvent {
  type: HcpWebhookEventType;
  /** HCP-side stable id for the resource that changed. */
  resourceId: string;
  /** HCP company (account) id for cross-tenant safety. */
  companyId?: string;
  occurredAt?: number;
}

export function parseHcpWebhookEvent(
  envelope: NangoWebhookEnvelope
): HcpWebhookEvent | null {
  if (envelope.type !== "forward" || !envelope.payload) return null;
  const typeRaw =
    typeof envelope.providerEventName === "string"
      ? envelope.providerEventName
      : typeof envelope.payload.event === "string"
        ? envelope.payload.event
        : typeof envelope.payload.type === "string"
          ? envelope.payload.type
          : undefined;
  if (!typeRaw) return null;
  const allowed: HcpWebhookEventType[] = [
    "job.completed",
    "job.updated",
    "estimate.sent",
    "invoice.created",
  ];
  if (!allowed.includes(typeRaw as HcpWebhookEventType)) return null;
  const resourceIdRaw =
    envelope.payload.id ??
    (envelope.payload.data as Record<string, unknown> | undefined)?.id ??
    envelope.payload.resourceId;
  const resourceId =
    typeof resourceIdRaw === "string" ? resourceIdRaw : undefined;
  if (!resourceId) return null;
  const companyIdRaw =
    envelope.payload.company_id ?? envelope.payload.companyId;
  const companyId =
    typeof companyIdRaw === "string" ? companyIdRaw : undefined;
  let occurredAt: number | undefined;
  const tsRaw = envelope.payload.occurred_at ?? envelope.payload.timestamp;
  if (typeof tsRaw === "number" && Number.isFinite(tsRaw)) {
    occurredAt = tsRaw;
  } else if (typeof tsRaw === "string") {
    const parsed = Date.parse(tsRaw);
    if (Number.isFinite(parsed)) occurredAt = parsed;
  }
  return {
    type: typeRaw as HcpWebhookEventType,
    resourceId,
    companyId,
    occurredAt,
  };
}
