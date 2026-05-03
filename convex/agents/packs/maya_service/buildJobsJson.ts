/**
 * buildJobsJson — emit the runtime cron config for `~/.openclaw/cron/jobs.json`
 * for the per-business service Maya.
 *
 * Mirror of creator-side `convex/agents/packs/maya/workspace/buildCronJobsJson.ts`.
 * Per OpenClaw spec (`https://docs.openclaw.ai/automation/cron-jobs.md`), the
 * cron daemon reads `~/.openclaw/cron/jobs.json` at boot. Each entry is one
 * job spec.
 *
 * The catalog is `SERVICE_STANDING_ORDERS` in `./standingOrders.ts` — this
 * builder filters to `kind === "cron"` programs, plan-tier-gates each one,
 * and emits a deterministic `ServiceJobSpec[]` sorted by name.
 *
 * Pure function. No `Date.now()` — generator is deterministic.
 */

import {
  SERVICE_STANDING_ORDERS,
  type ServiceCronSession,
  type ServiceStandingOrderProgram,
} from "./standingOrders";
import type { ServicePlan } from "./types";

export interface ServiceJobSpec {
  /** Human-readable name; we use the program's title. */
  name: string;
  /** 5-field POSIX cron expression. */
  cron: string;
  /** IANA timezone string (operator-tz). */
  tz: string;
  /** Session model: "isolated" (fresh transcript) or "main" (enqueue system event). */
  session: ServiceCronSession;
  /** Prompt text Maya executes for this tick. */
  message: string;
  /** Stable id cross-referencing standingOrders.ts + sibling-file scan. */
  entryId: string;
  /** Skill folder under agents/skills/maya-service-{slug} driven by this entry. */
  skill: string;
  /** Tier scoping for this entry (audit + observability). */
  tier: ServiceStandingOrderProgram["tier"];
  /** Description for jobs.json + UI listings. */
  description: string;
}

export interface ServiceJobsJson {
  jobs: ReadonlyArray<ServiceJobSpec>;
  /** Event-driven entries — not cron, but bundled so the deploy pipeline knows. */
  events: ReadonlyArray<ServiceEventSpec>;
}

export interface ServiceEventSpec {
  name: string;
  event: string;
  entryId: string;
  skill: string;
  tier: ServiceStandingOrderProgram["tier"];
  description: string;
}

export interface BuildServiceJobsJsonInputs {
  business: {
    timezone: string;
  };
  plan: ServicePlan;
  /** Optional override for the catalog (tests inject smaller fixtures). */
  catalogOverride?: ReadonlyArray<ServiceStandingOrderProgram>;
}

const FIVE_FIELD_CRON = /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)$/;
const IANA_TZ =
  /^([A-Z][a-zA-Z_]+\/[A-Z][a-zA-Z_]+(?:\/[A-Z][a-zA-Z_]+)?|UTC)$/;

export function buildJobsJson(
  inputs: BuildServiceJobsJsonInputs
): ServiceJobsJson {
  const { business, plan, catalogOverride } = inputs;
  const catalog = catalogOverride ?? SERVICE_STANDING_ORDERS;

  if (!IANA_TZ.test(business.timezone)) {
    throw new Error(
      `buildJobsJson: invalid IANA timezone '${business.timezone}'.`
    );
  }

  const jobs: ServiceJobSpec[] = [];
  const events: ServiceEventSpec[] = [];

  for (const program of catalog) {
    if (!isPlanAllowed(program.tier, plan)) continue;

    if (program.kind === "cron") {
      if (!program.defaultCron || !program.session) {
        throw new Error(
          `buildJobsJson: program '${program.id}' has kind='cron' but is missing defaultCron / session.`
        );
      }
      if (!FIVE_FIELD_CRON.test(program.defaultCron)) {
        throw new Error(
          `buildJobsJson: program '${program.id}' has invalid 5-field cron expression: '${program.defaultCron}'.`
        );
      }
      jobs.push({
        name: program.title,
        cron: program.defaultCron,
        tz: business.timezone,
        session: program.session,
        message:
          program.cronMessage ??
          `Run program '${program.title}'. See AGENTS.md for the full Scope / Triggers / Approval gates / Escalation rules.`,
        entryId: program.id,
        skill: program.skill,
        tier: program.tier,
        description: program.description,
      });
    } else if (program.kind === "event") {
      if (!program.event) {
        throw new Error(
          `buildJobsJson: program '${program.id}' has kind='event' but is missing event source.`
        );
      }
      events.push({
        name: program.title,
        event: program.event,
        entryId: program.id,
        skill: program.skill,
        tier: program.tier,
        description: program.description,
      });
    }
    // kind === "on-demand" is not bundled into jobs.json — operator-initiated.
  }

  jobs.sort((a, b) => a.name.localeCompare(b.name));
  events.sort((a, b) => a.name.localeCompare(b.name));

  return { jobs, events };
}

function isPlanAllowed(
  tier: ServiceStandingOrderProgram["tier"],
  plan: ServicePlan
): boolean {
  if (tier === "all") return true;
  if (tier === "starter-manual-pro+-auto") return true;
  if (tier === "pro+") return plan === "pro" || plan === "studio";
  if (tier === "studio") return plan === "studio";
  return false;
}
