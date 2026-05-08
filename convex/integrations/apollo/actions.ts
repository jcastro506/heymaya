/**
 * Sprint 11 — Apollo Convex action wrappers.
 *
 * These are the runtime entry points Maya skills call. They gate on
 * APOLLO_API_KEY env presence (no live calls until operator provisions
 * the account + key) and surface a structured result the calling skill
 * can shape into a brandContacts upsert.
 *
 * Cost discipline: every call writes a row to a future `apolloCallLog`
 * table (deferred — not built yet) for cost tracking. For now, the
 * action surfaces the count of records returned so callers can rate-
 * limit themselves.
 */
import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import {
  apolloAvailable,
  searchPeople,
  type ApolloPerson,
  type ApolloSearchResult,
} from "./client";

/**
 * Search Apollo for influencer-marketing contacts at the given brand
 * domains. Returns parsed people array + pagination.
 *
 * Throws when APOLLO_API_KEY is missing — caller should check
 * `apolloAvailable` via the guard query before invoking, OR catch the
 * error and fall back to Hunter / inbox warm-mining.
 */
export const searchPeopleAtBrands = internalAction({
  args: {
    organizationDomains: v.array(v.string()),
    personTitles: v.optional(v.array(v.string())),
    page: v.optional(v.number()),
    perPage: v.optional(v.number()),
  },
  handler: async (
    _ctx,
    args
  ): Promise<{
    available: boolean;
    result: ApolloSearchResult | null;
    error?: string;
  }> => {
    const env = process.env as Record<string, string | undefined>;
    if (!apolloAvailable(env)) {
      return {
        available: false,
        result: null,
        error: "APOLLO_API_KEY not set — operator must provision Apollo Pro account first",
      };
    }
    const apiKey = env.APOLLO_API_KEY!;
    try {
      const result = await searchPeople(apiKey, {
        organizationDomains: args.organizationDomains,
        personTitles: args.personTitles,
        page: args.page,
        perPage: args.perPage,
      });
      return { available: true, result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { available: true, result: null, error: msg };
    }
  },
});

/**
 * Pure projection helper exposed for tests and downstream skill use:
 * filter Apollo people to those with a verified email + a partnership-
 * relevant title. Lets the brand-outreach skill skip the manual
 * post-filter and dedupe at the caller.
 */
export function filterPartnershipReady(
  people: ReadonlyArray<ApolloPerson>
): ReadonlyArray<ApolloPerson> {
  const PARTNERSHIP_TITLE_PATTERNS = [
    /influencer/i,
    /creator partnership/i,
    /brand partnership/i,
    /talent/i,
    /creator marketing/i,
  ];
  return people.filter((p) => {
    if (!p.email) return false;
    if (p.email_status && p.email_status !== "verified") return false;
    const title = p.title ?? "";
    return PARTNERSHIP_TITLE_PATTERNS.some((re) => re.test(title));
  });
}
