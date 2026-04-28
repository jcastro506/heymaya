/**
 * Composio v3 universal action runner.
 *
 * Sprint 5 — single invocation primitive shared by every typed action wrapper
 * in `actions/*.ts`. Hides the v3 endpoint shape behind a single function so
 * if Composio renames the action-execute endpoint we change it in one place.
 *
 * v3 endpoint (per Composio v3 quickstart docs):
 *   POST /api/v3/actions/{action_slug}/execute
 *   Body: { connectedAccountId?: string, input: Record<string, unknown>, entityId?: string }
 *   Response: { successful: boolean, data?: unknown, error?: string }
 *
 * The action_slug is provider-namespaced (e.g. `GMAIL_SEND_EMAIL`,
 * `STRIPE_LIST_PAYOUTS`) — Composio's canonical SCREAMING_SNAKE form. We type
 * the typed wrappers to keep callers from inventing slugs.
 *
 * Per-action validation is handled by the caller via the response Zod schema
 * passed in. The runner itself just enforces the envelope: `successful` flag
 * + optional `data` payload + optional error string.
 */

import { z } from "zod";
import {
  ComposioClient,
  ComposioError,
  getDefaultComposioClient,
} from "./client";

/**
 * Composio v3 envelope. Every action returns this shape regardless of which
 * provider/action was invoked. We validate the envelope, then hand `data`
 * to the action-specific Zod schema.
 *
 * NOTE: Composio's exact envelope key names sometimes vary across SDK
 * versions (`successful` vs `success`, `data` vs `result`). We accept both
 * via `union` then normalize.
 */
const ComposioEnvelopeSchema = z
  .object({
    successful: z.boolean().optional(),
    success: z.boolean().optional(),
    data: z.unknown().optional(),
    result: z.unknown().optional(),
    error: z.string().optional(),
    message: z.string().optional(),
  })
  .passthrough();

export type ComposioActionResult<T> = {
  successful: boolean;
  data: T;
};

export interface RunActionOptions<TResponse> {
  /**
   * Provider tag. Used only for diagnostics / logging — the action slug
   * already encodes the provider in Composio v3.
   */
  provider:
    | "gmail"
    | "stripe"
    | "calendar"
    | "apollo"
    | "hunter"
    | "linkedin";
  /** Composio action slug, e.g. "GMAIL_SEND_EMAIL". */
  action: string;
  /** Input params for the action. Caller is responsible for shape correctness. */
  params: Record<string, unknown>;
  /** Composio's connected-account id (decrypted from `connectedAccounts.composioAccountId`). */
  connectedAccountId?: string;
  /** Optional v3 entityId scoping (defaults to per-creator). */
  entityId?: string;
  /** Zod schema to validate the unwrapped `data` field against. */
  responseSchema: z.ZodType<TResponse>;
  /** Test seam — defaults to the cached singleton client. */
  client?: ComposioClient;
}

/**
 * Single runner used by every typed action wrapper. Returns the validated
 * data payload or throws ComposioError with the upstream error string.
 */
export async function runAction<TResponse>(
  opts: RunActionOptions<TResponse>
): Promise<ComposioActionResult<TResponse>> {
  if (!opts.action || opts.action.trim().length === 0) {
    throw new ComposioError("runAction: action slug is required.");
  }
  if (!/^[A-Z][A-Z0-9_]+$/.test(opts.action)) {
    // Composio uses SCREAMING_SNAKE for slugs; fail loud on mistyped slugs
    // before round-tripping to the API.
    throw new ComposioError(
      `runAction: action '${opts.action}' is not in SCREAMING_SNAKE form (e.g. GMAIL_SEND_EMAIL).`
    );
  }

  const client = opts.client ?? getDefaultComposioClient();
  const path = `/api/v3/actions/${encodeURIComponent(opts.action)}/execute`;
  const body: Record<string, unknown> = {
    input: opts.params,
  };
  if (opts.connectedAccountId) {
    body.connectedAccountId = opts.connectedAccountId;
  }
  if (opts.entityId) {
    body.entityId = opts.entityId;
  }

  const raw = await client.request<unknown>(path, {
    method: "POST",
    body,
  });

  const envelope = ComposioEnvelopeSchema.safeParse(raw);
  if (!envelope.success) {
    throw new ComposioError(
      `runAction(${opts.action}): unexpected envelope shape: ${envelope.error.message}`
    );
  }

  // Normalize successful/success.
  const successful = envelope.data.successful ?? envelope.data.success ?? false;
  if (!successful) {
    const detail = envelope.data.error ?? envelope.data.message ?? "unknown error";
    throw new ComposioError(
      `runAction(${opts.action}) failed: ${detail}`
    );
  }

  // Normalize data/result.
  const data = envelope.data.data ?? envelope.data.result ?? {};
  const parsed = opts.responseSchema.safeParse(data);
  if (!parsed.success) {
    throw new ComposioError(
      `runAction(${opts.action}): response did not match schema: ${parsed.error.message}`
    );
  }
  return { successful: true, data: parsed.data };
}
