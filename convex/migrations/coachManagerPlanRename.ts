/**
 * One-time data migration — creator plan rename starter/pro/studio →
 * coach/manager (2026-05-04).
 *
 * Background: the creator product moved from a 3-tier (starter/pro/studio)
 * shape to a 2-tier (coach/manager) shape. The schema enum on `creators.plan`
 * was tightened in the same commit. Live `creators` rows in dev/prod that
 * still carry the old enum values would fail validation against the new
 * schema. This `internalMutation` rewrites them in place.
 *
 * Mapping (per the locked product spec):
 *   - "starter" → "coach"   — Coach is the new advisory-only entry tier.
 *   - "pro"     → "manager" — Pro and Studio collapse into Manager because
 *                              the headline Manager feature (autonomous
 *                              brand-deal back-and-forth) was already the
 *                              Pro shape minus Apollo/Hunter.
 *   - "studio"  → "manager" — Studio's brand-outreach feature IS Manager.
 *
 * Operator workflow:
 *   1. Run `npx convex deploy` so the new schema (coach/manager) is live.
 *      Convex will REJECT the deploy if any existing row still has the old
 *      enum value — that's expected. To unblock the deploy, run this
 *      migration FIRST against the OLD schema:
 *
 *        npx convex run migrations:coachManagerPlanRename:run \
 *          --no-push   # IMPORTANT: against the currently-deployed schema
 *
 *      Then deploy the new schema. The migration is idempotent — running it
 *      again after the schema change is a no-op (no rows match the old
 *      enum values).
 *
 *   2. Spot-check the audit row count vs the rewritten count after running.
 *
 * Idempotency: rows already at "coach"/"manager" are skipped. Re-running is
 * safe — the second invocation patches zero rows.
 *
 * Cross-tenant safety: not applicable — this mutation is global-scoped by
 * design, intentionally rewriting every creator row.
 *
 * Why an `internalMutation` and not a script: Convex internalMutations have
 * the right transactional + cursor-based read semantics for a bulk rewrite
 * and they hot-reload without a redeploy.
 */

import { internalMutation } from "../_generated/server";

type LegacyPlan = "starter" | "pro" | "studio";

const RENAME: Record<LegacyPlan, "coach" | "manager"> = {
  starter: "coach",
  pro: "manager",
  studio: "manager",
};

export const run = internalMutation({
  args: {},
  handler: async (
    ctx
  ): Promise<{
    inspected: number;
    rewritten: number;
    perTier: { starter: number; pro: number; studio: number };
    skippedAlreadyMigrated: number;
  }> => {
    let inspected = 0;
    let rewritten = 0;
    let skippedAlreadyMigrated = 0;
    const perTier = { starter: 0, pro: 0, studio: 0 };

    // We collect first then patch — a single Convex internalMutation is one
    // transaction, so even with a paginated read the patches all commit
    // atomically. For very large tenant counts (>10k creators) the operator
    // should rerun this in batches; the current creator product has <100
    // live rows so a single shot is safe.
    const all = await ctx.db.query("creators").collect();
    for (const row of all) {
      inspected += 1;
      // The schema is the new one (coach/manager) by the time this runs, so
      // `row.plan` is typed as the new union. We cast to a wider runtime type
      // because the actual data may still hold the old enum values until
      // this mutation rewrites them.
      const planRuntime = row.plan as unknown as string;
      if (planRuntime === "coach" || planRuntime === "manager") {
        skippedAlreadyMigrated += 1;
        continue;
      }
      if (
        planRuntime === "starter" ||
        planRuntime === "pro" ||
        planRuntime === "studio"
      ) {
        const next = RENAME[planRuntime as LegacyPlan];
        await ctx.db.patch(row._id, { plan: next });
        perTier[planRuntime as LegacyPlan] += 1;
        rewritten += 1;
        continue;
      }
      // Unknown value — log + skip. Operator should investigate. We don't
      // throw because that would roll back every successful patch in this
      // mutation; a console.warn is the right signal.
      // eslint-disable-next-line no-console: server-side migration log surfaces unexpected plan values to operator without aborting the bulk patch
      console.warn(
        `coachManagerPlanRename: row ${row._id} has unexpected plan='${planRuntime}'; skipping.`
      );
    }

    return {
      inspected,
      rewritten,
      perTier,
      skippedAlreadyMigrated,
    };
  },
});
