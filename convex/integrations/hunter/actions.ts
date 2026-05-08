/**
 * Sprint 11 — Hunter Convex action wrappers.
 *
 * Behind feature flag `HUNTER_API_KEY` env. Wraps findEmail / verifyEmail
 * / searchDomain so Maya skills can call them as internal actions.
 */
import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import {
  findEmail,
  hunterAvailable,
  searchDomain,
  verifyEmail,
  type HunterDomainPattern,
  type HunterEmailFinderResult,
  type HunterEmailVerifierResult,
} from "./client";

export const findEmailByName = internalAction({
  args: {
    domain: v.string(),
    firstName: v.string(),
    lastName: v.string(),
  },
  handler: async (
    _ctx,
    args
  ): Promise<{
    available: boolean;
    result: HunterEmailFinderResult | null;
    error?: string;
  }> => {
    const env = process.env as Record<string, string | undefined>;
    if (!hunterAvailable(env)) {
      return {
        available: false,
        result: null,
        error: "HUNTER_API_KEY not set",
      };
    }
    try {
      const result = await findEmail(env.HUNTER_API_KEY!, args);
      return { available: true, result };
    } catch (err) {
      return {
        available: true,
        result: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
});

export const verifyEmailDeliverability = internalAction({
  args: {
    email: v.string(),
  },
  handler: async (
    _ctx,
    args
  ): Promise<{
    available: boolean;
    result: HunterEmailVerifierResult | null;
    error?: string;
  }> => {
    const env = process.env as Record<string, string | undefined>;
    if (!hunterAvailable(env)) {
      return {
        available: false,
        result: null,
        error: "HUNTER_API_KEY not set",
      };
    }
    try {
      const result = await verifyEmail(env.HUNTER_API_KEY!, args.email);
      return { available: true, result };
    } catch (err) {
      return {
        available: true,
        result: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
});

export const searchDomainContacts = internalAction({
  args: {
    domain: v.string(),
    limit: v.optional(v.number()),
    department: v.optional(v.string()),
  },
  handler: async (
    _ctx,
    args
  ): Promise<{
    available: boolean;
    result: HunterDomainPattern | null;
    error?: string;
  }> => {
    const env = process.env as Record<string, string | undefined>;
    if (!hunterAvailable(env)) {
      return {
        available: false,
        result: null,
        error: "HUNTER_API_KEY not set",
      };
    }
    try {
      const result = await searchDomain(env.HUNTER_API_KEY!, args.domain, {
        limit: args.limit,
        department: args.department,
      });
      return { available: true, result };
    } catch (err) {
      return {
        available: true,
        result: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
});

/**
 * Pure projection helper: among verified emails, filter out ones flagged
 * webmail / disposable / catch-all (the bounce-risk class). Used by the
 * brand-outreach skill to pre-flight before sending.
 */
export function isSafeToSend(result: HunterEmailVerifierResult): boolean {
  if (result.status !== "valid") return false;
  if (result.disposable === true) return false;
  if (result.webmail === true) return false;
  if (result.gibberish === true) return false;
  // Hunter's `result` field: prefer "deliverable" over "risky" /
  // "unknown". Block "undeliverable".
  if (result.result === "undeliverable") return false;
  return true;
}
