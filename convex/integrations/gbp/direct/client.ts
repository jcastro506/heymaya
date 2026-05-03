/**
 * Direct Google Business Profile API client — PARKED.
 *
 * Status: NOT USED IN V0. See ./README.md.
 *
 * Operator pivoted on 2026-04-27 mid-Sprint 1: Zernio is the v0 GBP path
 * because direct GBP API requires partner access (2-8 wk wait, no SLA).
 * This file holds the error-class hierarchy + the (unimplemented) OAuth +
 * retry skeleton so the post-partner-access re-activation agent has a
 * coherent starting point. Do not import from this file in v0 code.
 *
 * The error classes here are exported because they are part of the public
 * contract for behavior #4 (review reply) — the moderation-rejected path
 * (`GbpModerationRejectedError` thrown when `ReviewReplyState === "REJECTED"`)
 * is a real product behavior that re-prompts the operator. Whichever GBP
 * provider ends up active (Zernio in v0, direct API later) must surface
 * the equivalent failure mode through this same shape.
 */

/* -------------------------------------------------------------------------- */
/* Error class hierarchy — re-usable across Zernio + direct paths             */
/* -------------------------------------------------------------------------- */

/**
 * Auth-layer failure. Missing keys, invalid OAuth token, scope revoked,
 * or refresh-token exchange failure. Behavior: re-prompt operator to
 * reconnect the GBP location.
 */
export class GbpAuthError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "GbpAuthError";
  }
}

/**
 * Rate-limit hit. Surfaces `retryAfterSec` from the `Retry-After` header.
 * Caller should back off and retry; the client implementation will retry
 * up to `maxAttempts` automatically before throwing this.
 */
export class GbpRateLimitError extends Error {
  constructor(
    public readonly url: string,
    public readonly retryAfterSec: number | null
  ) {
    super(
      `GBP rate limit for ${url}${
        retryAfterSec !== null ? ` (retry-after: ${retryAfterSec}s)` : ""
      }`
    );
    this.name = "GbpRateLimitError";
  }
}

/**
 * Google ReviewReplyState moderation rejection. Thrown by `replyToReview`
 * when Google returns `ReviewReplyState: REJECTED` for the proposed reply.
 *
 * CRITICAL: behavior #4 (review reply) re-prompts the operator on this
 * specific failure mode. Do NOT swallow or normalize away. The reply text
 * is retained on the error so the operator can see what was rejected.
 */
export class GbpModerationRejectedError extends Error {
  constructor(
    public readonly reviewName: string,
    public readonly proposedReply: string,
    public readonly reason: string | null
  ) {
    super(
      `GBP moderation rejected reply for ${reviewName}` +
        (reason ? `: ${reason}` : "")
    );
    this.name = "GbpModerationRejectedError";
  }
}

/**
 * Generic GBP API error — anything not covered by the more-specific classes.
 * Carries the HTTP status + URL + a body excerpt so callers can build useful
 * diagnostics without dumping the full response.
 */
export class GbpApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    public readonly body: string
  ) {
    super(`GBP HTTP ${status} for ${url}: ${body.slice(0, 500)}`);
    this.name = "GbpApiError";
  }
}

/* -------------------------------------------------------------------------- */
/* Client skeleton — NOT IMPLEMENTED                                           */
/* -------------------------------------------------------------------------- */

/**
 * Construction throws `GbpAuthError` because partner-access keys are not
 * available in v0. The constructor signature is preserved so the
 * re-activation agent can wire env-driven config without re-designing the
 * surface. See ./README.md "Files NOT yet written" for the full endpoint
 * + Pub/Sub + OAuth surface to flesh out.
 */
export interface GbpClientOptions {
  oauthClientId?: string;
  oauthClientSecret?: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  baseBackoffMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export class GbpClient {
  constructor(_options: GbpClientOptions = {}) {
    throw new GbpAuthError(
      "Direct GBP API client is parked: operator is awaiting GBP API partner " +
        "access (decision 2026-04-27). Use convex/integrations/zernio/ for v0 " +
        "GBP read/write/review-reply. See convex/integrations/gbp/direct/README.md."
    );
  }
}
