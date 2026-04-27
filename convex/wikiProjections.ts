/**
 * wikiProjections — thin Convex read-projection over the OpenClaw memory-wiki
 * vault that lives on each per-business Fly machine.
 *
 * Per `docs/SPRINT_PLAN_SERVICE_V0.md` § 9.5: the wiki itself is OpenClaw-
 * native; the source of truth for claims + provenance + dreaming-fed pages
 * lives in the per-business vault on the Fly machine. Convex stores ONLY
 * page summaries + claim text + provenance pointers so HQ screens (Profile
 * "What Maya knows", Library tab, Reports dashboards) can subscribe via
 * Convex queries instead of round-tripping to the agent runtime.
 *
 * Critically — per `feedback_openclaw_native_first.md` + `project_openclaw_
 * alignment.md` — this is NOT a parallel wiki. Maya tools (`wiki_apply`,
 * `wiki_get`, `wiki_search`, `wiki_lint`, `wiki_status`) interact with the
 * Fly-side vault directly. This module exists only to mirror page summaries
 * for UI reactivity.
 *
 * Cross-tenant safety:
 *   - Every public query takes `businessId`; the Convex caller must resolve
 *     it from Clerk identity → creators row → businessId. There is no global
 *     index, so Business A's vault never appears in Business B's queries.
 *   - Mutations validate `businessId` against the projection row's
 *     `businessId` on every upsert / archive — a vaultPath collision across
 *     businesses cannot leak data.
 *
 * Plan-tier:
 *   - Storage layer is plan-agnostic — the projection mirrors what the
 *     plugin emits regardless of plan. Per § 9.5 ("Wiki itself is plan-
 *     agnostic infrastructure. The PLUGIN is enabled in workspace bundle for
 *     all tiers.")
 *   - Read access surfacing in HQ varies by tier — that gating lives in the
 *     query layer that THIS module backs (e.g. Studio-only Reports
 *     dashboards), enforced where the HQ-UI agent's queries call us.
 *   - Mutation gating: `applyProjection` is INTERNAL-only — Maya's runtime
 *     calls it via an HTTP endpoint after `wiki_apply` succeeds on the Fly
 *     side, not from operator-facing code. Operator-side correction flows
 *     route through Maya, never directly to this mutation.
 */

import { v } from "convex/values";
import {
  internalMutation,
  query,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

const KIND_VALUES = ["entity", "concept", "synthesis", "source", "report"] as const;
type WikiKind = (typeof KIND_VALUES)[number];

/** Soft cap on a single claim's character length. The wiki itself can hold
 * larger pages; this cap protects the projection from runaway upserts that
 * a malicious skill might trigger. Per § 14 adversarial-input rule. */
const MAX_CLAIM_CHARS = 32_000;

/** Soft cap on provenance entries per row. The vault can carry more; for
 * the projection 64 is plenty for HQ summary rendering. */
const MAX_PROVENANCE_ENTRIES = 64;

/* -------------------------------------------------------------------------- */
/* Cross-tenant guards                                                         */
/* -------------------------------------------------------------------------- */

async function assertBusinessExists(
  ctx: QueryCtx,
  businessId: Id<"businesses">
): Promise<Doc<"businesses">> {
  const row = await ctx.db.get(businessId);
  if (!row) {
    throw new Error(
      `wikiProjections: business ${businessId} not found (cross-tenant guard).`
    );
  }
  return row;
}

function validateVaultPath(p: string): string {
  // Vault paths follow `<section>/<...>`. Reject empty, leading slashes,
  // path traversal, or absurdly-long paths. Adversarial-input regression.
  const trimmed = p.trim();
  if (trimmed.length === 0 || trimmed.length > 256) {
    throw new Error(
      `wikiProjections: vaultPath length out of range (got ${trimmed.length}).`
    );
  }
  if (trimmed.startsWith("/")) {
    throw new Error("wikiProjections: vaultPath must not start with '/'.");
  }
  if (trimmed.includes("..") || trimmed.includes("\\")) {
    throw new Error(
      "wikiProjections: vaultPath must not contain '..' or backslashes."
    );
  }
  return trimmed;
}

function validateConfidence(c: number): number {
  if (!Number.isFinite(c) || c < 0 || c > 1) {
    throw new Error(
      `wikiProjections: confidence must be a finite number in [0..1] (got ${c}).`
    );
  }
  return c;
}

function validateClaim(c: string): string {
  if (typeof c !== "string") {
    throw new Error("wikiProjections: claim must be a string.");
  }
  if (c.length === 0) {
    throw new Error("wikiProjections: claim must be non-empty.");
  }
  if (c.length > MAX_CLAIM_CHARS) {
    throw new Error(
      `wikiProjections: claim exceeds ${MAX_CLAIM_CHARS}-char cap (got ${c.length}).`
    );
  }
  return c;
}

interface ProvenanceEntry {
  sourceId: string;
  path: string;
  lines?: string;
  weight?: number;
  note?: string;
}

function validateProvenance(
  p: ReadonlyArray<ProvenanceEntry>,
  kind: WikiKind
): ProvenanceEntry[] {
  if (p.length > MAX_PROVENANCE_ENTRIES) {
    throw new Error(
      `wikiProjections: provenance has ${p.length} entries (max ${MAX_PROVENANCE_ENTRIES}).`
    );
  }
  // Non-report kinds REQUIRE at least one provenance entry per § 9.5 +
  // citation-firewall hard rule. Reports may be empty seeds.
  if (kind !== "report" && p.length === 0) {
    throw new Error(
      `wikiProjections: kind='${kind}' requires at least one provenance entry.`
    );
  }
  for (const entry of p) {
    if (
      typeof entry.sourceId !== "string" ||
      entry.sourceId.length === 0 ||
      entry.sourceId.length > 256
    ) {
      throw new Error(
        "wikiProjections: each provenance entry needs a non-empty sourceId ≤256 chars."
      );
    }
    if (
      typeof entry.path !== "string" ||
      entry.path.length === 0 ||
      entry.path.length > 256
    ) {
      throw new Error(
        "wikiProjections: each provenance entry needs a non-empty path ≤256 chars."
      );
    }
    if (
      entry.weight !== undefined &&
      (!Number.isFinite(entry.weight) ||
        entry.weight < 0 ||
        entry.weight > 1)
    ) {
      throw new Error(
        `wikiProjections: provenance.weight must be in [0..1] when present (got ${entry.weight}).`
      );
    }
  }
  return p.map((e) => ({ ...e }));
}

/* -------------------------------------------------------------------------- */
/* Mutations                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Upsert a single projection row. Called by Maya's runtime after a
 * `wiki_apply` succeeds on the Fly side. Internal-only — the HTTP endpoint
 * that fronts this mutation enforces auth + the businessId match.
 */
export const applyProjection = internalMutation({
  args: {
    businessId: v.id("businesses"),
    vaultPath: v.string(),
    kind: v.union(
      v.literal("entity"),
      v.literal("concept"),
      v.literal("synthesis"),
      v.literal("source"),
      v.literal("report")
    ),
    claim: v.string(),
    provenance: v.array(
      v.object({
        sourceId: v.string(),
        path: v.string(),
        lines: v.optional(v.string()),
        weight: v.optional(v.number()),
        note: v.optional(v.string()),
      })
    ),
    confidence: v.number(),
  },
  handler: async (ctx, args): Promise<Id<"wikiProjections">> => {
    await assertBusinessExists(ctx, args.businessId);
    const vaultPath = validateVaultPath(args.vaultPath);
    const claim = validateClaim(args.claim);
    const confidence = validateConfidence(args.confidence);
    const provenance = validateProvenance(args.provenance, args.kind);
    const now = Date.now();
    // Upsert by (businessId, vaultPath). Note: index `by_business_and_path`
    // is the canonical lookup; we assert it returns at most one row in
    // practice (vaultPath is unique within a business — the wiki guarantees
    // this on its end).
    const existing = await ctx.db
      .query("wikiProjections")
      .withIndex("by_business_and_path", (q) =>
        q.eq("businessId", args.businessId).eq("vaultPath", vaultPath)
      )
      .first();
    if (existing) {
      // Cross-tenant defensive check — even though the index already pins
      // businessId, re-check the row's value before patching to bullet-proof
      // against any future indexer behavior change.
      if (existing.businessId !== args.businessId) {
        throw new Error(
          "wikiProjections.applyProjection: cross-tenant violation on upsert."
        );
      }
      await ctx.db.patch(existing._id, {
        kind: args.kind,
        claim,
        provenance,
        confidence,
        archivedAt: undefined, // un-archive on re-apply
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("wikiProjections", {
      businessId: args.businessId,
      vaultPath,
      kind: args.kind,
      claim,
      provenance,
      confidence,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Soft-delete a projection. Called when the Fly-side wiki garbage-collects
 * a stale page (or operator removes a claim through HQ "What Maya knows"
 * correction flow). Idempotent — re-archiving an already-archived row is a
 * no-op that bumps `updatedAt`.
 */
export const removeProjection = internalMutation({
  args: {
    businessId: v.id("businesses"),
    vaultPath: v.string(),
  },
  handler: async (ctx, args): Promise<{ archived: boolean }> => {
    await assertBusinessExists(ctx, args.businessId);
    const vaultPath = validateVaultPath(args.vaultPath);
    const existing = await ctx.db
      .query("wikiProjections")
      .withIndex("by_business_and_path", (q) =>
        q.eq("businessId", args.businessId).eq("vaultPath", vaultPath)
      )
      .first();
    if (!existing) {
      return { archived: false };
    }
    if (existing.businessId !== args.businessId) {
      throw new Error(
        "wikiProjections.removeProjection: cross-tenant violation."
      );
    }
    await ctx.db.patch(existing._id, {
      archivedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { archived: true };
  },
});

/* -------------------------------------------------------------------------- */
/* Queries                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * List projections for a business, optionally filtered by kind. Cross-tenant:
 * caller MUST resolve `businessId` from auth identity → creators →
 * businesses; this query trusts the businessId arg. The HQ-UI agent's query
 * wrappers in `convex/queries/business/*` enforce the auth check.
 */
export const listProjections = query({
  args: {
    businessId: v.id("businesses"),
    kindFilter: v.optional(
      v.union(
        v.literal("entity"),
        v.literal("concept"),
        v.literal("synthesis"),
        v.literal("source"),
        v.literal("report")
      )
    ),
    includeArchived: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Array<Doc<"wikiProjections">>> => {
    await assertBusinessExists(ctx, args.businessId);
    const limit = Math.max(1, Math.min(args.limit ?? 100, 500));
    const rows = args.kindFilter
      ? await ctx.db
          .query("wikiProjections")
          .withIndex("by_business_and_kind", (q) =>
            q.eq("businessId", args.businessId).eq("kind", args.kindFilter!)
          )
          .take(limit)
      : await ctx.db
          .query("wikiProjections")
          .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
          .take(limit);
    if (args.includeArchived) return rows;
    return rows.filter((r) => r.archivedAt === undefined);
  },
});

/**
 * Get a single projection by vaultPath. Returns null on miss OR
 * cross-tenant mismatch (treat-as-miss semantics — never throw on a missing
 * page; the HQ surface decides how to render absence).
 */
export const getProjection = query({
  args: {
    businessId: v.id("businesses"),
    vaultPath: v.string(),
  },
  handler: async (ctx, args): Promise<Doc<"wikiProjections"> | null> => {
    await assertBusinessExists(ctx, args.businessId);
    let vaultPath: string;
    try {
      vaultPath = validateVaultPath(args.vaultPath);
    } catch {
      return null;
    }
    const row = await ctx.db
      .query("wikiProjections")
      .withIndex("by_business_and_path", (q) =>
        q.eq("businessId", args.businessId).eq("vaultPath", vaultPath)
      )
      .first();
    if (!row) return null;
    if (row.businessId !== args.businessId) return null;
    return row;
  },
});

/**
 * Bulk-apply helper for the onboarding pipeline. Takes the array of pages
 * generated by `wikiInitialPages.generateWikiInitialPages` + writes them
 * all in a single mutation. Used once at deploy; not a per-call surface.
 */
export const applyInitialPages = internalMutation({
  args: {
    businessId: v.id("businesses"),
    pages: v.array(
      v.object({
        vaultPath: v.string(),
        kind: v.union(
          v.literal("entity"),
          v.literal("concept"),
          v.literal("synthesis"),
          v.literal("source"),
          v.literal("report")
        ),
        claim: v.string(),
        provenance: v.array(
          v.object({
            sourceId: v.string(),
            path: v.string(),
            lines: v.optional(v.string()),
            weight: v.optional(v.number()),
            note: v.optional(v.string()),
          })
        ),
        confidence: v.number(),
      })
    ),
  },
  handler: async (ctx, args): Promise<{ written: number }> => {
    await assertBusinessExists(ctx, args.businessId);
    let written = 0;
    const now = Date.now();
    for (const p of args.pages) {
      const vaultPath = validateVaultPath(p.vaultPath);
      const claim = validateClaim(p.claim);
      const confidence = validateConfidence(p.confidence);
      const provenance = validateProvenance(p.provenance, p.kind);
      const existing = await ctx.db
        .query("wikiProjections")
        .withIndex("by_business_and_path", (q) =>
          q.eq("businessId", args.businessId).eq("vaultPath", vaultPath)
        )
        .first();
      if (existing) {
        if (existing.businessId !== args.businessId) {
          throw new Error(
            "wikiProjections.applyInitialPages: cross-tenant violation on upsert."
          );
        }
        await ctx.db.patch(existing._id, {
          kind: p.kind,
          claim,
          provenance,
          confidence,
          archivedAt: undefined,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("wikiProjections", {
          businessId: args.businessId,
          vaultPath,
          kind: p.kind,
          claim,
          provenance,
          confidence,
          createdAt: now,
          updatedAt: now,
        });
      }
      written += 1;
    }
    return { written };
  },
});
