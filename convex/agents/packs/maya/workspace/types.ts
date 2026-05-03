/**
 * Shared input types for the per-creator OpenClaw workspace generators.
 *
 * Sprint 3.7 phase A — every generator under
 * `convex/agents/packs/maya/workspace/` consumes a subset of these inputs as
 * a pure function. The Convex action wrapper (phase C) is responsible for
 * loading these from the database; the generators themselves are
 * deterministic and DB-free.
 *
 * Why this file exists separately from the generators:
 *   - Tests construct fixtures here without importing every generator.
 *   - Phase B will add 5 NEW optional fields to `creatorPicture` (career
 *     stage, location, monthly revenue, revenue streams, long-term goals);
 *     this file owns the optional-chaining shim that lets generators work
 *     against both the current schema and the post-phase-B schema.
 */

import type { Doc } from "../../../../_generated/dataModel";
import type { Plan } from "../../../../lib/planFeatures";

/**
 * Shape of `creatorPicture` augmented with the 5 NEW USER.md fields phase B
 * will add. Every new field is optional so generators run against both the
 * pre- and post-phase-B schema without branching.
 *
 * If the schema doesn't yet have a field, generators emit
 * `"not yet provided"` placeholders. Once phase B lands, the same generator
 * code emits the real values.
 */
// Phase B's schema additions are now live — `Doc<"creatorPicture">` already
// includes locationSoul / careerStage / monthlyRevenueUsd / currentRevenueStreams
// / longTermGoals (all optional). Use the schema type directly so we can't drift.
export type CreatorPictureExt = Doc<"creatorPicture">;

/**
 * The full input bundle every workspace generator pulls from. Generators
 * accept narrow subsets of this — only `assembleWorkspaceBundle` needs all
 * fields.
 */
export interface WorkspaceInputs {
  creator: Doc<"creators">;
  picture: CreatorPictureExt | null;
  handles: ReadonlyArray<Doc<"creatorHandles">>;
  connectedAccounts: ReadonlyArray<Doc<"connectedAccounts">>;
  plan: Plan;
  /** Test seam — pinned for determinism in tests. */
  now: number;
}

/** Marker for fields that require phase B schema work. */
export const NOT_YET_PROVIDED = "not yet provided";
