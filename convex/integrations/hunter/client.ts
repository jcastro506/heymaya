/**
 * Sprint 10 — Hunter.io API client.
 *
 * Hunter is the email-enrichment fallback when Apollo doesn't have a
 * verified email for a target person. Two main endpoints used:
 *   - domain-search:  list emails on a domain + the most common pattern
 *   - email-finder:   given (domain, first, last), return the most
 *                     likely email + confidence
 *   - email-verifier: confirm a specific email is deliverable
 *
 * Behind feature flag `HUNTER_API_KEY` env var. No live calls without it.
 *
 * Used by maya-brand-outreach to verify any Apollo-sourced email with
 * weak confidence, and to discover emails when Apollo returns nothing.
 *
 * Docs: https://hunter.io/api-documentation/v2
 */

const HUNTER_BASE = "https://api.hunter.io/v2";

export class HunterApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly op: string,
    message: string
  ) {
    super(`hunter:${op}:${status}: ${message}`);
    this.name = "HunterApiError";
  }
}

export interface HunterEmailFinderResult {
  email?: string;
  score?: number; // 0-100 confidence
  domain?: string;
  first_name?: string;
  last_name?: string;
  position?: string;
  verification?: {
    status?: "valid" | "invalid" | "accept_all" | "webmail" | "disposable" | string;
    date?: string;
  };
}

export interface HunterEmailVerifierResult {
  email: string;
  status: "valid" | "invalid" | "accept_all" | "webmail" | "disposable" | string;
  result?: "deliverable" | "undeliverable" | "risky" | "unknown" | string;
  score?: number;
  regexp?: boolean;
  gibberish?: boolean;
  disposable?: boolean;
  webmail?: boolean;
  mx_records?: boolean;
  smtp_server?: boolean;
  smtp_check?: boolean;
}

export interface HunterDomainPattern {
  pattern?: string; // "{first}.{last}" etc.
  organization?: string;
  emails?: ReadonlyArray<{
    value: string;
    type?: string;
    confidence?: number;
    first_name?: string;
    last_name?: string;
    position?: string;
    department?: string;
    seniority?: string;
  }>;
}

/**
 * Find an email by (domain, first, last). Returns null when Hunter
 * can't generate a confident guess (score < threshold).
 */
export async function findEmail(
  apiKey: string,
  input: { domain: string; firstName: string; lastName: string }
): Promise<HunterEmailFinderResult | null> {
  if (!apiKey) {
    throw new HunterApiError(401, "find-email", "missing apiKey");
  }
  const params = new URLSearchParams({
    domain: input.domain,
    first_name: input.firstName,
    last_name: input.lastName,
    api_key: apiKey,
  });
  const response = await fetch(`${HUNTER_BASE}/email-finder?${params.toString()}`);
  if (!response.ok) {
    const text = await response.text().catch(() => "<no body>");
    throw new HunterApiError(
      response.status,
      "find-email",
      text.slice(0, 200)
    );
  }
  const json = (await response.json()) as { data?: HunterEmailFinderResult };
  if (!json.data?.email) return null;
  return json.data;
}

/**
 * Verify a specific email's deliverability. Use before sending to any
 * Apollo-sourced contact whose `email_status` was anything other than
 * "verified".
 */
export async function verifyEmail(
  apiKey: string,
  email: string
): Promise<HunterEmailVerifierResult> {
  if (!apiKey) {
    throw new HunterApiError(401, "verify-email", "missing apiKey");
  }
  const params = new URLSearchParams({ email, api_key: apiKey });
  const response = await fetch(`${HUNTER_BASE}/email-verifier?${params.toString()}`);
  if (!response.ok) {
    const text = await response.text().catch(() => "<no body>");
    throw new HunterApiError(
      response.status,
      "verify-email",
      text.slice(0, 200)
    );
  }
  const json = (await response.json()) as { data?: HunterEmailVerifierResult };
  if (!json.data) {
    throw new HunterApiError(
      response.status,
      "verify-email",
      "empty response body"
    );
  }
  return json.data;
}

/**
 * Discover the email pattern + top contacts on a domain. Useful when
 * Apollo returns the wrong company or no people at all — Hunter often
 * has the actual partnership/PR contact when Apollo doesn't.
 */
export async function searchDomain(
  apiKey: string,
  domain: string,
  opts: { limit?: number; department?: string } = {}
): Promise<HunterDomainPattern> {
  if (!apiKey) {
    throw new HunterApiError(401, "search-domain", "missing apiKey");
  }
  const params = new URLSearchParams({
    domain,
    api_key: apiKey,
    limit: String(opts.limit ?? 10),
  });
  if (opts.department) params.set("department", opts.department);
  const response = await fetch(`${HUNTER_BASE}/domain-search?${params.toString()}`);
  if (!response.ok) {
    const text = await response.text().catch(() => "<no body>");
    throw new HunterApiError(
      response.status,
      "search-domain",
      text.slice(0, 200)
    );
  }
  const json = (await response.json()) as { data?: HunterDomainPattern };
  return json.data ?? {};
}

/**
 * Returns whether the Hunter integration is currently usable.
 */
export function hunterAvailable(env: Record<string, string | undefined>): boolean {
  const k = env.HUNTER_API_KEY;
  return typeof k === "string" && k.length > 10;
}
