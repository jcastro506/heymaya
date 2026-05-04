/**
 * buildCronJobsJson — emit the runtime cron config for `~/.openclaw/cron/jobs.json`.
 *
 * Sprint 3.7 phase A. Per OpenClaw spec
 * (`https://docs.openclaw.ai/automation/cron-jobs.md`), the cron daemon
 * reads `~/.openclaw/cron/jobs.json` at boot. Each entry is one job spec.
 * Our deploy variant pipes this config in at machine create time (or runs
 * `openclaw cron add` per entry).
 *
 * The catalog is `STANDING_ORDERS` in `./standingOrders.ts` — this builder
 * filters to `kind === "cron"` programs, plan-tier-gates each one, and
 * emits a deterministic `JobSpec[]` sorted by name.
 *
 * Pure function. No `Date.now()` — generator is deterministic.
 */

import type { Doc } from "../../../../_generated/dataModel";
import { planFeatures, type Plan } from "../../../../lib/planFeatures";
import {
  STANDING_ORDERS,
  type CronSession,
  type StandingOrderProgram,
} from "./standingOrders";

/**
 * One entry of `~/.openclaw/cron/jobs.json` per the OpenClaw spec.
 * Field reference:
 *   - `name`        — human-readable; we use the program's title.
 *   - `cron`        — 5-field POSIX cron expression.
 *   - `tz`          — IANA timezone string (creator's `creators.timezone`).
 *   - `session`     — "isolated" (fresh transcript per run) or "main"
 *                     (enqueue system event into main session).
 *   - `message`     — prompt text Maya executes for this tick.
 *   - `entryId`     — internal cross-reference back to standingOrders.ts +
 *                     `agents/skills/maya-platform/cron.md`. Not required
 *                     by OpenClaw, but lets the deploy pipeline tag jobs
 *                     with stable ids for observability.
 *
 * Optional fields the OpenClaw CLI accepts but we don't emit by default:
 *   - `at`, `every`, `wake`, `model`, `thinking`, `announce`,
 *     `delete-after-run`, `delivery.failureDestination`. Per our
 *     architecture lock (`project_openclaw_alignment.md`), thinking-budget
 *     overrides go via standing-order prose, not via job-level overrides.
 */
export interface JobSpec {
  name: string;
  cron: string;
  tz: string;
  session: CronSession;
  message: string;
  entryId: string;
}

export interface JobsJson {
  jobs: ReadonlyArray<JobSpec>;
}

export interface BuildCronJobsJsonInputs {
  creator: Pick<Doc<"creators">, "plan" | "timezone">;
  /**
   * Optional override for the standing-orders catalog. Tests use this to
   * inject a smaller fixture; production passes nothing and gets the full
   * catalog.
   */
  catalogOverride?: ReadonlyArray<StandingOrderProgram>;
}

const FIVE_FIELD_CRON = /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)$/;

/**
 * IANA timezone format check — heuristic, not exhaustive. Accepts strings
 * like "America/Los_Angeles", "Europe/London", "Asia/Tokyo", "UTC".
 * We don't ship the full tzdata to validate exhaustively; we just reject
 * obviously-wrong inputs (empty, lowercase-only, contains spaces).
 */
const IANA_TZ = /^([A-Z][a-zA-Z_]+\/[A-Z][a-zA-Z_]+(?:\/[A-Z][a-zA-Z_]+)?|UTC)$/;

export function buildCronJobsJson(inputs: BuildCronJobsJsonInputs): JobsJson {
  const { creator, catalogOverride } = inputs;
  const catalog = catalogOverride ?? STANDING_ORDERS;
  const features = planFeatures(creator);

  const jobs: JobSpec[] = [];
  for (const program of catalog) {
    if (program.kind !== "cron") continue;
    if (!program.defaultCron || !program.session || !program.cronEntryId) {
      // Defensive: should never happen given the catalog shape, but enforce.
      throw new Error(
        `buildCronJobsJson: program '${program.id}' has kind='cron' but is missing defaultCron / session / cronEntryId.`
      );
    }
    if (!FIVE_FIELD_CRON.test(program.defaultCron)) {
      throw new Error(
        `buildCronJobsJson: program '${program.id}' has invalid 5-field cron expression: '${program.defaultCron}'.`
      );
    }
    if (!isPlanAllowed(program.tier, creator.plan, features.proactiveCronAll)) {
      continue;
    }
    if (!IANA_TZ.test(creator.timezone)) {
      throw new Error(
        `buildCronJobsJson: invalid IANA timezone '${creator.timezone}'.`
      );
    }
    jobs.push({
      name: program.title,
      cron: program.defaultCron,
      tz: creator.timezone,
      session: program.session,
      message:
        program.cronMessage ??
        `Run program '${program.title}'. See AGENTS.md / standing-orders.md for the full Scope / Triggers / Approval gates / Escalation rules.`,
      entryId: program.cronEntryId,
    });
  }

  // Sort by name for deterministic output (the deploy pipeline's diff
  // depends on this).
  jobs.sort((a, b) => a.name.localeCompare(b.name));

  return { jobs };
}

function isPlanAllowed(
  tier: StandingOrderProgram["tier"],
  plan: Plan,
  _proactiveCronAll: boolean
): boolean {
  if (tier === "all") return true;
  // tier === "manager" (post-coach/manager migration; was "pro+" pre-migration).
  // Coach skips Manager-only entries.
  //
  // NOTE: per the locked product spec, many currently-Manager-tagged programs
  // are actually advisory and should be tier="all" with autonomy-checks moved
  // into the skill prose. The skill-audit agent will reclassify; until then
  // this gating is a strict superset of what's permitted on Coach
  // (false-positive denials for Coach are safer than false-positive grants
  // on the autonomy boundary).
  if (plan === "coach") return false;
  return true;
}
