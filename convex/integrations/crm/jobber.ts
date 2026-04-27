/**
 * Jobber CRM integration via Nango.
 *
 * Wave C / Sprint 4. Jobber is the easiest CRM in our target stack (R2 § Tier
 * 1), GraphQL-only API. Nango handles OAuth + token refresh; we hit Nango's
 * proxy with our `connectionId` + a GraphQL request body.
 *
 * What this module owns:
 *   - GraphQL client over Nango proxy.
 *   - Webhook event normalization (Jobber WebHookTopicEnum → our shape).
 *   - 15-min polling fallback for operators without webhook delivery.
 *   - Job-event normalization (Jobber's `JOB_COMPLETE` → our serviceJobs shape).
 *
 * Cross-tenant safety: every GraphQL call carries a `connectionId` that maps
 * 1:1 to a `crmConnections` row scoped by `businessId`. Webhook handlers
 * resolve `businessId` via the connection lookup BEFORE any DB write.
 *
 * Plan-tier safety: Pro+ only — gated upstream in the Convex action layer
 * (`convex/jobs.ts`).
 */

import {
  NangoApiError,
  NangoClient,
  type NangoWebhookEnvelope,
} from "./nango";

/** Nango provider config key for Jobber. Matches the dashboard config. */
export const JOBBER_PROVIDER_KEY = "jobber";

/* -------------------------------------------------------------------------- */
/* Jobber GraphQL types                                                        */
/* -------------------------------------------------------------------------- */

export interface JobberGraphQLError {
  message: string;
  path?: string[];
  extensions?: Record<string, unknown>;
}

export interface JobberGraphQLResponse<T> {
  data?: T;
  errors?: JobberGraphQLError[];
}

/**
 * Jobber's GraphQL schema is large; we only model the bits we need to
 * normalize a job-completion event into our `serviceJobs` shape.
 */
export interface JobberJob {
  id: string;
  jobNumber?: number | string;
  title?: string;
  jobStatus?: string;
  startAt?: string | null;
  endAt?: string | null;
  completedAt?: string | null;
  total?: number | null;
  client?: {
    id?: string;
    name?: string;
    firstName?: string;
    lastName?: string;
    companyName?: string;
    phones?: Array<{ number?: string }>;
    emails?: Array<{ address?: string }>;
  };
  property?: {
    address?: {
      street?: string;
      city?: string;
      province?: string;
      postalCode?: string;
    };
  };
}

/* -------------------------------------------------------------------------- */
/* GraphQL client                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Jobber GraphQL endpoint. Per Jobber API docs the path is `/api/graphql` on
 * the public API host; Nango's proxy substitutes the host, so the value we
 * pass to Nango is the path-only.
 */
const JOBBER_GRAPHQL_PATH = "/api/graphql";

/**
 * The Jobber API requires the `X-JOBBER-GRAPHQL-VERSION` header on every
 * request. Pinning a known version keeps us insulated from breaking changes.
 */
const JOBBER_GRAPHQL_VERSION = "2024-04-01";

export interface JobberGraphQLOptions {
  client: NangoClient;
  connectionId: string;
  query: string;
  variables?: Record<string, unknown>;
}

export async function jobberGraphQL<T>(
  opts: JobberGraphQLOptions
): Promise<T> {
  const res = await opts.client.proxy<JobberGraphQLResponse<T>>({
    connectionId: opts.connectionId,
    providerConfigKey: JOBBER_PROVIDER_KEY,
    method: "POST",
    endpoint: JOBBER_GRAPHQL_PATH,
    body: { query: opts.query, variables: opts.variables ?? {} },
    providerHeaders: {
      "x-jobber-graphql-version": JOBBER_GRAPHQL_VERSION,
    },
  });
  if (res.errors && res.errors.length > 0) {
    throw new NangoApiError(
      200,
      JOBBER_GRAPHQL_PATH,
      `Jobber GraphQL errors: ${res.errors.map((e) => e.message).join("; ")}`
    );
  }
  if (!res.data) {
    throw new NangoApiError(
      200,
      JOBBER_GRAPHQL_PATH,
      "Jobber GraphQL response missing `data`."
    );
  }
  return res.data;
}

/* -------------------------------------------------------------------------- */
/* Job-fetch query — used by webhook handler to fetch the full job after the   */
/* "JOB_COMPLETE" notification (which only includes the job id).               */
/* -------------------------------------------------------------------------- */

const JOBBER_JOB_BY_ID_QUERY = `
  query GetJob($id: ID!) {
    job(id: $id) {
      id
      jobNumber
      title
      jobStatus
      startAt
      endAt
      completedAt
      total
      client {
        id
        name
        firstName
        lastName
        companyName
        phones { number }
        emails { address }
      }
      property {
        address { street city province postalCode }
      }
    }
  }
`;

export async function fetchJobberJobById(
  client: NangoClient,
  connectionId: string,
  jobId: string
): Promise<JobberJob | null> {
  const data = await jobberGraphQL<{ job: JobberJob | null }>({
    client,
    connectionId,
    query: JOBBER_JOB_BY_ID_QUERY,
    variables: { id: jobId },
  });
  return data.job ?? null;
}

/* -------------------------------------------------------------------------- */
/* Polling fallback — list jobs completed since `sinceMs`                      */
/* -------------------------------------------------------------------------- */

const JOBBER_RECENT_COMPLETED_JOBS_QUERY = `
  query RecentCompletedJobs($first: Int!, $after: String) {
    jobs(
      filter: { status: COMPLETED }
      first: $first
      after: $after
      sort: { key: COMPLETED_AT, direction: DESCENDING }
    ) {
      edges {
        node {
          id
          jobNumber
          title
          jobStatus
          startAt
          endAt
          completedAt
          total
          client {
            id name firstName lastName companyName
            phones { number }
            emails { address }
          }
          property { address { street city province postalCode } }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export async function listRecentlyCompletedJobs(
  client: NangoClient,
  connectionId: string,
  opts: { sinceMs?: number; first?: number } = {}
): Promise<JobberJob[]> {
  const data = await jobberGraphQL<{
    jobs: {
      edges: Array<{ node: JobberJob }>;
    };
  }>({
    client,
    connectionId,
    query: JOBBER_RECENT_COMPLETED_JOBS_QUERY,
    variables: { first: opts.first ?? 25 },
  });
  const all = data.jobs.edges.map((e) => e.node);
  if (opts.sinceMs === undefined) return all;
  // Client-side filter — Jobber's GraphQL does not expose a generic
  // "completed since" filter without using a relay-style cursor we don't keep.
  // For the 15-min polling cadence the job count is small enough that this is
  // O(25) per poll regardless.
  return all.filter((j) => {
    if (!j.completedAt) return false;
    const ts = Date.parse(j.completedAt);
    return Number.isFinite(ts) && ts >= (opts.sinceMs ?? 0);
  });
}

/* -------------------------------------------------------------------------- */
/* Normalized job-event shape                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The shape we hand to `convex/jobs.ts:upsertJobFromWebhook`. Provider-
 * agnostic; HCP normalizes to the same shape so the upsert mutation has one
 * code path.
 */
export interface NormalizedJobEvent {
  /** Provider that produced the event. */
  provider: "jobber" | "hcp";
  /** Provider-side stable id. Used for `serviceJobs.crmJobId`. */
  externalJobId: string;
  /** Provider-side customer id. Used for `serviceCustomers.crmCustomerId`. */
  externalCustomerId?: string;
  customerName?: string;
  customerLastName?: string;
  customerPhone?: string;
  customerEmail?: string;
  customerAddress?: string;
  status: "scheduled" | "in-progress" | "completed" | "cancelled";
  scheduledAt?: number;
  completedAt?: number;
  serviceType?: string;
  ticketAmountUsd?: number;
  notes?: string;
}

/**
 * Map a Jobber job status string to our 4-status enum. Jobber's enum has
 * many transitional states (`scheduled`, `active`, `late`, `unscheduled`,
 * `archived`, `complete`, etc.); we collapse them.
 */
export function mapJobberStatus(
  status: string | undefined | null
): NormalizedJobEvent["status"] {
  if (!status) return "scheduled";
  const s = status.toLowerCase();
  if (s === "complete" || s === "completed") return "completed";
  if (s === "active" || s === "in_progress" || s === "started") {
    return "in-progress";
  }
  if (s === "archived" || s === "cancelled" || s === "canceled") {
    return "cancelled";
  }
  return "scheduled";
}

function deriveCustomerLastName(client: JobberJob["client"]): string | undefined {
  if (!client) return undefined;
  if (client.lastName) return client.lastName;
  if (client.companyName) return client.companyName;
  if (client.name) {
    const parts = client.name.trim().split(/\s+/);
    return parts.length > 1 ? parts[parts.length - 1] : parts[0];
  }
  return undefined;
}

function joinAddress(addr: JobberJob["property"]): string | undefined {
  const a = addr?.address;
  if (!a) return undefined;
  const pieces = [a.street, a.city, a.province, a.postalCode].filter(
    (p): p is string => Boolean(p)
  );
  return pieces.length > 0 ? pieces.join(", ") : undefined;
}

export function normalizeJobberJob(j: JobberJob): NormalizedJobEvent {
  const status = mapJobberStatus(j.jobStatus);
  const completedAt = j.completedAt ? Date.parse(j.completedAt) : undefined;
  const scheduledAt = j.startAt ? Date.parse(j.startAt) : undefined;
  const customerLastName = deriveCustomerLastName(j.client);
  const customerName =
    j.client?.name ??
    j.client?.companyName ??
    ([j.client?.firstName, j.client?.lastName].filter(Boolean).join(" ") ||
      undefined);
  return {
    provider: "jobber",
    externalJobId: j.id,
    externalCustomerId: j.client?.id,
    customerName: customerName?.trim() || undefined,
    customerLastName,
    customerPhone: j.client?.phones?.[0]?.number,
    customerEmail: j.client?.emails?.[0]?.address,
    customerAddress: joinAddress(j.property),
    status,
    scheduledAt: Number.isFinite(scheduledAt) ? scheduledAt : undefined,
    completedAt: Number.isFinite(completedAt) ? completedAt : undefined,
    serviceType: j.title ?? undefined,
    ticketAmountUsd:
      typeof j.total === "number" && Number.isFinite(j.total)
        ? j.total
        : undefined,
  };
}

/* -------------------------------------------------------------------------- */
/* Webhook event mapping                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Jobber WebHookTopicEnum we care about for v0. Per Jobber developer docs the
 * `JOB_COMPLETE` topic fires on completion (the canonical Sprint 4 trigger).
 * `JOB_UPDATE` covers the rest of the lifecycle. The full enum has more
 * topics — we route only the two below.
 */
export type JobberWebhookTopic =
  | "JOB_COMPLETE"
  | "JOB_UPDATE"
  | "INVOICE_CREATE"
  | "INVOICE_UPDATE"
  | "QUOTE_CREATE";

/**
 * Pull the Jobber event payload out of the Nango envelope. Nango's `forward`
 * webhook type wraps the upstream provider payload under `payload`.
 */
export interface JobberWebhookEvent {
  topic: JobberWebhookTopic;
  /** Jobber-side resource id (job id, invoice id, etc.). */
  resourceId: string;
  /** The originating account id Jobber sent the event for. */
  accountId?: string;
  /** Server-side timestamp Jobber recorded the event. */
  occurredAt?: number;
}

/**
 * Map an inbound Nango webhook envelope to a Jobber webhook event. Returns
 * null if the envelope is for a topic we don't handle (audit-only path).
 */
export function parseJobberWebhookEvent(
  envelope: NangoWebhookEnvelope
): JobberWebhookEvent | null {
  if (envelope.type !== "forward" || !envelope.payload) return null;
  const topic =
    typeof envelope.providerEventName === "string"
      ? envelope.providerEventName
      : typeof envelope.payload.topic === "string"
        ? (envelope.payload.topic as string)
        : undefined;
  const resourceIdRaw =
    envelope.payload.itemId ??
    envelope.payload.resourceId ??
    envelope.payload.id;
  const resourceId =
    typeof resourceIdRaw === "string" ? resourceIdRaw : undefined;
  const accountIdRaw =
    envelope.payload.accountId ?? envelope.payload.account_id;
  const accountId =
    typeof accountIdRaw === "string" ? accountIdRaw : undefined;
  let occurredAt: number | undefined;
  const tsRaw = envelope.payload.occurredAt ?? envelope.payload.timestamp;
  if (typeof tsRaw === "number" && Number.isFinite(tsRaw)) {
    occurredAt = tsRaw;
  } else if (typeof tsRaw === "string") {
    const parsed = Date.parse(tsRaw);
    if (Number.isFinite(parsed)) occurredAt = parsed;
  }
  if (!topic || !resourceId) return null;
  const allowedTopics: JobberWebhookTopic[] = [
    "JOB_COMPLETE",
    "JOB_UPDATE",
    "INVOICE_CREATE",
    "INVOICE_UPDATE",
    "QUOTE_CREATE",
  ];
  if (!allowedTopics.includes(topic as JobberWebhookTopic)) return null;
  return {
    topic: topic as JobberWebhookTopic,
    resourceId,
    accountId,
    occurredAt,
  };
}
