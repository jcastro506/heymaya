/**
 * Unified.to (https://unified.to/) — typed surface over the Accounting domain.
 *
 * Sprint 5 (service product). Decision locked at
 * `docs/spikes/qbo-aggregator-decision.md` — Unified.to wins over Apideck for
 * v0 because (1) it normalizes QBO Estimate as a first-class accounting
 * resource, (2) flat $300/mo Pro plan covers 100+ connections without a
 * sales call, (3) `raw` field on every entity preserves QBO concepts we'd
 * otherwise lose (sub-customer parent_id, SyncToken concurrency token, custom
 * fields), and (4) HMAC-SHA256 webhook signature scheme matches Zernio's so
 * our receiver pattern ports cleanly.
 *
 * All types here are HEYMAYA's view of Unified — not raw SDK types — so the
 * implementation behind these can be swapped to Apideck under interface
 * isolation if Unified turns out to mismatch real QBO during live-smoke.
 *
 * Citations + assumed shape:
 *   - https://docs.unified.to/integrations/integration_quickbooks
 *   - https://docs.unified.to/connections/auth
 *   - https://docs.unified.to/webhooks/overview (HMAC-SHA256, x-unified-signature)
 *
 * Every shape below is marked [unverified] where the public docs do not pin
 * the field down — live-smoke against a real Unified workspace + QBO sandbox
 * is the gate that confirms exactness. Operator long-leads documented in the
 * spike memo.
 */

/* -------------------------------------------------------------------------- */
/* Error class hierarchy — mirrors Zernio's pattern                            */
/* -------------------------------------------------------------------------- */

export class UnifiedAuthError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "UnifiedAuthError";
  }
}

export class UnifiedRateLimitError extends Error {
  constructor(
    public readonly url: string,
    public readonly retryAfterSec: number | null
  ) {
    super(
      `Unified.to rate limit for ${url}${
        retryAfterSec !== null ? ` (retry-after: ${retryAfterSec}s)` : ""
      }`
    );
    this.name = "UnifiedRateLimitError";
  }
}

export class UnifiedApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    public readonly bodySnippet: string
  ) {
    super(
      `Unified.to API error ${status} for ${url}: ${bodySnippet.slice(0, 300)}`
    );
    this.name = "UnifiedApiError";
  }
}

export class UnifiedTimeoutError extends Error {
  constructor(public readonly url: string, public readonly timeoutMs: number) {
    super(`Unified.to request to ${url} timed out after ${timeoutMs}ms`);
    this.name = "UnifiedTimeoutError";
  }
}

/**
 * Distinct from `UnifiedAuthError`: token expiration is recoverable via
 * Unified-managed refresh. Connection-revoked is not.
 */
export class UnifiedTokenExpiredError extends UnifiedAuthError {
  constructor(url: string) {
    super(
      `Unified.to access token expired (or refresh failed) for ${url}. ` +
        "Trigger a refresh via the connection metadata endpoint or " +
        "prompt the operator to re-OAuth."
    );
    this.name = "UnifiedTokenExpiredError";
  }
}

/* -------------------------------------------------------------------------- */
/* Provider identifier (Unified normalizes provider strings)                   */
/* -------------------------------------------------------------------------- */

/**
 * Unified.to identifies QBO connections by `provider: "quickbooks"` (lowercase
 * single-word identifier per their documented integration slug). Any other
 * value reaching our QBO wrapper is rejected at runtime — the wrapper is QBO-
 * scoped and conflating providers would be a cross-tenant correctness bug.
 */
export const UNIFIED_QBO_PROVIDER = "quickbooks" as const;
export type UnifiedQboProvider = typeof UNIFIED_QBO_PROVIDER;

/* -------------------------------------------------------------------------- */
/* Normalized accounting entities (subset we actually use)                     */
/* -------------------------------------------------------------------------- */

/**
 * Unified's normalized Customer. Covers QBO Customer with parent/sub
 * preserved via `parent_id`. The `raw` field is the underlying QBO Customer
 * object — we keep a typed slice for the fields we read.
 */
export interface UnifiedAccountingCustomer {
  /** Unified's stable id, scoped to the connection. */
  id: string;
  /** Underlying provider id — for QBO this is `Customer.Id`. */
  external_id?: string;
  /**
   * QBO DisplayName / CompanyName. Optional because Unified omits it on
   * sub-customer rows that inherit from a parent. Mapping helpers default
   * to "(unnamed)" if absent.
   */
  name?: string;
  /**
   * QBO sub-customer hierarchy carrier. Unified normalizes this to a
   * `parent_id` referencing another Unified customer in the same connection.
   * Null for top-level customers.
   */
  parent_id?: string | null;
  /**
   * QBO `Job` flag — when true the customer row represents a job-level
   * sub-customer rather than a top-level customer. Surfaces our serviceJobs
   * mapping decision: parent_id present + is_job true → upsert serviceJobs
   * row; parent_id null OR is_job false → upsert serviceCustomers row.
   * [unverified — Unified's normalized field name; QBO calls it `Job` on
   * the Customer entity. Worst-case fallback uses `raw.Job` as boolean.]
   */
  is_job?: boolean;
  emails?: Array<{ email: string }>;
  telephones?: Array<{ telephone: string }>;
  /**
   * Single-line formatted address. Unified normalizes QBO's
   * BillAddr/ShipAddr to a flat `address` field; we keep both for fidelity.
   */
  address?: {
    address1?: string;
    address2?: string;
    city?: string;
    region?: string;
    postal_code?: string;
    country?: string;
  };
  active?: boolean;
  created_at?: string;
  updated_at?: string;
  /** Always present — passthrough for fidelity. Type is `unknown` by design. */
  raw?: unknown;
}

/**
 * Unified's normalized Invoice / Estimate / Quote — accounting domain.
 * QBO Estimate maps via `type: "estimate"` per provider mapping; QBO Invoice
 * via `type: "invoice"`.
 */
export interface UnifiedAccountingInvoice {
  id: string;
  external_id?: string;
  /** "invoice" | "estimate" | "quote" — Unified normalizes the type field. */
  type: "invoice" | "estimate" | "quote";
  customer_id?: string;
  /** ISO 8601 date strings. */
  invoice_at?: string;
  due_at?: string;
  total_amount?: number;
  paid_amount?: number;
  balance_amount?: number;
  currency?: string;
  status?: string; // open | paid | partially_paid | draft | sent | etc.
  line_items?: Array<{
    id?: string;
    description?: string;
    quantity?: number;
    unit_amount?: number;
    total_amount?: number;
    item_id?: string;
  }>;
  reference?: string;
  notes?: string;
  created_at?: string;
  updated_at?: string;
  raw?: unknown;
}

/* -------------------------------------------------------------------------- */
/* Webhook envelope                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Unified.to webhook event types we subscribe to. Naming follows their
 * dot-namespaced convention. Our wrapper subscribes to all 6 below at
 * connection-create time; downstream consumers route on `type`.
 *
 * [unverified — Unified's exact subscribable event names are documented in
 * their dashboard, not in the open docs. This subset is the strict minimum
 * for HeyMaya's behaviors #2 (review request) + #14 (revenue snapshot).]
 */
export type UnifiedWebhookEventType =
  | "accounting.customer.created"
  | "accounting.customer.updated"
  | "accounting.invoice.created"
  | "accounting.invoice.updated"
  | "accounting.invoice.paid"
  | "accounting.estimate.created";

export interface UnifiedWebhookEnvelope<T = unknown> {
  /** Unified's stable per-event id. Used for idempotency. */
  event_id: string;
  type: UnifiedWebhookEventType;
  /** Connection id — Unified's stable per-business connection identifier. */
  connection_id: string;
  /** Provider — we hard-reject anything that isn't "quickbooks". */
  provider: string;
  /** ISO 8601. */
  occurred_at: string;
  /**
   * Resource entity carried in the event. For invoice.* events this is a
   * UnifiedAccountingInvoice; for customer.* events a UnifiedAccountingCustomer.
   * The route discriminates on `type` before narrowing.
   */
  data: T;
  /** Raw provider payload for forensics. */
  raw?: unknown;
}

/* -------------------------------------------------------------------------- */
/* Token/connection metadata                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Per-connection metadata returned by Unified at OAuth-callback time and
 * available via the connections endpoint thereafter. We persist `id` + the
 * encrypted access token in `crmConnections` (see `quickbooks.ts`).
 */
export interface UnifiedConnection {
  id: string;
  workspace_id: string;
  /** The provider slug — `"quickbooks"` for our wrapper. */
  provider: string;
  /** Per-connection auth blob — Unified manages the underlying tokens. */
  auth?: {
    /** Encrypted with our key before persistence. */
    access_token?: string;
    refresh_token?: string;
    expires_at?: string;
    scope?: string;
  };
  is_active?: boolean;
  /** Timestamp Unified last refreshed the upstream OAuth token. */
  refreshed_at?: string;
  created_at?: string;
  updated_at?: string;
}

/* -------------------------------------------------------------------------- */
/* Header constants                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Webhook signature header. Unified follows the same lower-cased custom-header
 * pattern as Zernio (`x-unified-signature`). The signature is the hex-encoded
 * HMAC-SHA256 of the raw request body, keyed with the per-workspace webhook
 * secret. Constant-time compare on receive side.
 */
export const UNIFIED_SIGNATURE_HEADER = "x-unified-signature";
