/**
 * Sprint 2.16j — Evidence guard for outbound strategic messages.
 *
 * The product principle "Grounded or silent" (CLAUDE.md) was previously
 * advisory — Maya's prompts said cite-your-sources, but nothing on the
 * server enforced it. This module makes the guarantee real:
 *
 *   - Strategic claims must carry `evidence_ids` that resolve to real
 *     gtmEvidenceCards rows scoped to this agent's account.
 *   - Missing or invalid evidence → ok:false, Maya rewrites or drops.
 *   - Tactical/accountability messages skip the guard (no claim to ground).
 *
 * The graceful-degradation policy ("never silent") lives in the prompt:
 * after N failed validations, Maya is instructed to send a degraded
 * "checking my sources" message. The server's job is to hard-block;
 * the agent's job is to recover gracefully.
 */

import { v } from "convex/values";
import { internalAction, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";

export type MessageClass = "strategic" | "tactical" | "accountability";

export interface ClaimInput {
  claim: string;
  evidence_ids: string[];
}

export interface EvidenceGuardFailure {
  claim: string;
  reason:
    | "missing_evidence_ids"
    | "evidence_not_found"
    | "evidence_wrong_account"
    | "evidence_id_malformed";
  missingIds?: string[];
}

export interface EvidenceGuardResult {
  ok: boolean;
  failures: EvidenceGuardFailure[];
  // Number of claims validated; useful for telemetry.
  claimsCount: number;
  // Number of distinct evidence cards referenced.
  evidenceCount: number;
}

/**
 * Validate that every strategic claim has at least one evidence_id and
 * that every evidence_id resolves to a gtmEvidenceCards row owned by
 * this account.
 *
 * Returns ok:true only if ALL claims pass.
 */
export const validateClaims = internalAction({
  args: {
    accountId: v.id("creators"),
    claims: v.array(
      v.object({
        claim: v.string(),
        evidence_ids: v.array(v.string()),
      })
    ),
  },
  handler: async (ctx, args): Promise<EvidenceGuardResult> => {
    const failures: EvidenceGuardFailure[] = [];
    const allEvidenceIds = new Set<string>();

    // First pass: structural validation.
    for (const claim of args.claims) {
      if (claim.evidence_ids.length === 0) {
        failures.push({
          claim: claim.claim,
          reason: "missing_evidence_ids",
        });
        continue;
      }
      for (const id of claim.evidence_ids) {
        allEvidenceIds.add(id);
      }
    }

    if (allEvidenceIds.size === 0) {
      return {
        ok: failures.length === 0,
        failures,
        claimsCount: args.claims.length,
        evidenceCount: 0,
      };
    }

    // Resolve evidence cards. Convex IDs are strings of a specific shape;
    // we use the typed query which will surface malformed IDs as missing.
    const resolved = await ctx.runQuery(
      internal.gtmMaya.evidenceGuard.resolveEvidenceCards,
      {
        accountId: args.accountId,
        ids: Array.from(allEvidenceIds),
      }
    );

    const validIds = new Set(resolved.validIds);
    const wrongAccountIds = new Set(resolved.wrongAccountIds);
    const malformedIds = new Set(resolved.malformedIds);

    // Second pass: per-claim verdict.
    for (const claim of args.claims) {
      if (claim.evidence_ids.length === 0) continue; // already failed above

      const missing: string[] = [];
      let wrongAccount = false;
      let malformed = false;

      for (const id of claim.evidence_ids) {
        if (malformedIds.has(id)) {
          malformed = true;
        } else if (wrongAccountIds.has(id)) {
          wrongAccount = true;
        } else if (!validIds.has(id)) {
          missing.push(id);
        }
      }

      if (malformed) {
        failures.push({
          claim: claim.claim,
          reason: "evidence_id_malformed",
          missingIds: claim.evidence_ids.filter((id) => malformedIds.has(id)),
        });
      } else if (wrongAccount) {
        failures.push({
          claim: claim.claim,
          reason: "evidence_wrong_account",
          missingIds: claim.evidence_ids.filter((id) =>
            wrongAccountIds.has(id)
          ),
        });
      } else if (missing.length > 0) {
        failures.push({
          claim: claim.claim,
          reason: "evidence_not_found",
          missingIds: missing,
        });
      }
    }

    return {
      ok: failures.length === 0,
      failures,
      claimsCount: args.claims.length,
      evidenceCount: validIds.size,
    };
  },
});

/**
 * Resolve evidence card IDs into three buckets: valid (exists + owned),
 * wrong-account (exists but belongs to another account — cross-tenant
 * defense), and malformed (didn't parse as an ID at all).
 *
 * We use `ctx.db.normalizeId` to distinguish malformed IDs (wrong shape,
 * wrong table) from valid-but-missing rows. Malformed returns null
 * synchronously; well-formed but missing rows return null from `get`.
 */
export const resolveEvidenceCards = internalQuery({
  args: {
    accountId: v.id("creators"),
    ids: v.array(v.string()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    validIds: string[];
    wrongAccountIds: string[];
    malformedIds: string[];
  }> => {
    const validIds: string[] = [];
    const wrongAccountIds: string[] = [];
    const malformedIds: string[] = [];

    for (const rawId of args.ids) {
      // normalizeId validates table membership + ID shape in one call.
      // Returns the typed Id if valid for THIS table, else null.
      const normalized = ctx.db.normalizeId("gtmEvidenceCards", rawId);
      if (normalized === null) {
        malformedIds.push(rawId);
        continue;
      }
      const card = await ctx.db.get(normalized);
      if (!card) continue; // counted as missing by caller
      if (card.accountId !== args.accountId) {
        wrongAccountIds.push(rawId);
        continue;
      }
      validIds.push(rawId);
    }

    return { validIds, wrongAccountIds, malformedIds };
  },
});

/**
 * Classification helpers used by callers that want to decide whether
 * a message needs guarding before constructing claims. Strategic
 * messages MUST carry claims; tactical/accountability are exempt.
 *
 * Keep this list tight — over-classifying as strategic creates friction;
 * under-classifying defeats the moat. Defaults to strategic on ambiguity.
 */
export function classifyMessage(messageClass: string | undefined): MessageClass {
  if (messageClass === "tactical") return "tactical";
  if (messageClass === "accountability") return "accountability";
  return "strategic";
}
