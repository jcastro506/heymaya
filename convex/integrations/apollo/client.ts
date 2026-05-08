/**
 * Sprint 10 — Apollo.io API client.
 *
 * Behind feature flag `APOLLO_API_KEY` env var. No live calls happen
 * unless the env var is set. The client is stateless and pure — every
 * function takes the API key as an argument and returns the API
 * response shape.
 *
 * Used by maya-pitch-strategy to enrich a target brand list (from
 * Layer 1 LLM output) with verified influencer-marketing contacts.
 *
 * Apollo Pro plan is the recommended tier ($99/mo at time of writing,
 * unlimited credits). Operator must provision the account + key before
 * any live runs.
 *
 * Docs: https://apolloio.github.io/apollo-api-docs/
 */

const APOLLO_BASE = "https://api.apollo.io/v1";

export class ApolloApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly op: string,
    message: string
  ) {
    super(`apollo:${op}:${status}: ${message}`);
    this.name = "ApolloApiError";
  }
}

export interface ApolloPerson {
  id: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  email?: string;
  email_status?: "verified" | "guessed" | "unavailable" | string;
  organization?: {
    id: string;
    name: string;
    primary_domain?: string;
  };
  linkedin_url?: string;
}

export interface ApolloSearchResult {
  people: ReadonlyArray<ApolloPerson>;
  pagination: {
    page: number;
    per_page: number;
    total_entries: number;
    total_pages: number;
  };
}

export interface ApolloSearchInput {
  /** Job titles to filter on. Default Maya targets:
   *   "Influencer Marketing Manager"
   *   "Creator Partnerships Manager"
   *   "Brand Partnerships"
   *   "Talent Manager"
   *   "Director of Influencer Marketing"
   */
  personTitles?: ReadonlyArray<string>;
  /** Restrict to specific company domains (e.g., "patagonia.com"). */
  organizationDomains?: ReadonlyArray<string>;
  /** Restrict to specific company names. */
  organizationNames?: ReadonlyArray<string>;
  page?: number;
  perPage?: number;
}

export const DEFAULT_INFLUENCER_MARKETER_TITLES: ReadonlyArray<string> = [
  "Influencer Marketing Manager",
  "Influencer Marketing",
  "Creator Partnerships Manager",
  "Creator Partnerships",
  "Brand Partnerships Manager",
  "Brand Partnerships",
  "Talent Manager",
  "Director of Influencer Marketing",
  "Head of Creator Marketing",
  "Influencer Relations",
];

/**
 * Search people on Apollo. Pure stateless API call.
 *
 * @returns Candidate contacts at the requested companies whose role
 *   matches `personTitles`. Email may be null when Apollo doesn't have
 *   a verified email — caller should fall back to Hunter for those.
 */
export async function searchPeople(
  apiKey: string,
  input: ApolloSearchInput
): Promise<ApolloSearchResult> {
  if (!apiKey) {
    throw new ApolloApiError(401, "search-people", "missing apiKey");
  }
  const body: Record<string, unknown> = {
    page: input.page ?? 1,
    per_page: input.perPage ?? 25,
  };
  if (input.personTitles && input.personTitles.length > 0) {
    body.person_titles = input.personTitles;
  } else {
    body.person_titles = DEFAULT_INFLUENCER_MARKETER_TITLES;
  }
  if (input.organizationDomains && input.organizationDomains.length > 0) {
    body.q_organization_domains = input.organizationDomains.join("\n");
  }
  if (input.organizationNames && input.organizationNames.length > 0) {
    body.q_organization_names = input.organizationNames.join("\n");
  }

  const response = await fetch(`${APOLLO_BASE}/mixed_people/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "X-Api-Key": apiKey,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "<no body>");
    throw new ApolloApiError(
      response.status,
      "search-people",
      text.slice(0, 200)
    );
  }
  const json = (await response.json()) as {
    people?: ApolloPerson[];
    pagination?: ApolloSearchResult["pagination"];
  };
  return {
    people: json.people ?? [],
    pagination: json.pagination ?? {
      page: 1,
      per_page: 25,
      total_entries: 0,
      total_pages: 0,
    },
  };
}

/**
 * Returns whether the Apollo integration is currently usable. False
 * when the API key isn't set — caller should fall through to Hunter
 * or skip the cold-outreach path entirely.
 */
export function apolloAvailable(env: Record<string, string | undefined>): boolean {
  const k = env.APOLLO_API_KEY;
  return typeof k === "string" && k.length > 10;
}
