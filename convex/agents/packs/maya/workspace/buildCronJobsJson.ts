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
 * One entry of `~/.openclaw/cron/jobs.json` for OpenClaw 2026.4.23.
 *
 * OpenClaw used to tolerate the legacy top-level shape
 * `{ cron, tz, session, message }`. The 2026.4.23 scheduler expects the
 * normalized runtime shape used by `openclaw cron add`: `schedule.kind`,
 * `sessionTarget`, `wakeMode`, and `payload.kind`. Emitting the normalized
 * shape prevents boot-time scheduler crashes before `openclaw doctor --fix`
 * has a chance to migrate legacy rows.
 *
 * Sprint 9.5 (2026-05-06) — schedule.kind is a discriminated union now:
 *   - "cron"   — the recurring 5-field POSIX expression we already had.
 *   - "at"     — one-shot fire at an absolute timestamp. Used by the
 *                first-boot kickstart job to trigger the
 *                `first_boot_introduction` standing order immediately on
 *                gateway start, instead of waiting up to 30 min for the
 *                heartbeat. See `buildFirstBootKickstartJob` below.
 */
export interface JobSpec {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  schedule:
    | {
        kind: "cron";
        expr: string;
        tz: string;
      }
    | {
        kind: "at";
        /** ISO-8601 absolute timestamp the OpenClaw scheduler parses with `parseAbsoluteTimeMs`. */
        at: string;
      };
  sessionTarget: CronSession;
  wakeMode: "now";
  /**
   * One-shot jobs (`schedule.kind === "at"`) self-delete after the run
   * completes. OpenClaw's scheduler honors this flag natively so the
   * kickstart doesn't pollute future jobs.json reloads.
   */
  deleteAfterRun?: boolean;
  payload:
    | {
        kind: "systemEvent";
        text: string;
      }
    | {
        kind: "agentTurn";
        message: string;
        lightContext: true;
      };
  delivery?:
    | {
        mode: "announce";
        channel: "last";
        bestEffort: true;
      }
    | {
        // Sprint 9.6 — explicit-target delivery for the first-boot kickstart.
        // The "last" channel doesn't resolve on first deploy because the
        // creator hasn't messaged in yet; claw-messenger errors with
        // "Delivering to Claw Messenger requires target +1XXXXXXXXXX".
        // Pin the recipient to the creator's primary phone number for the
        // kickstart; ongoing crons keep using "last".
        //
        // Field name `to` (NOT `target`) — verified against OpenClaw 2026.4.23
        // `resolveCronDeliveryPlan` in `server-plugin-bootstrap-*.js`. The
        // resolver reads `delivery.to` and ignores any `target` key.
        mode: "announce";
        channel: "claw-messenger";
        to: string;
        bestEffort: true;
      };
}

export interface JobsJson {
  jobs: ReadonlyArray<JobSpec>;
}

export interface BuildCronJobsJsonInputs {
  creator: Pick<
    Doc<"creators">,
    "plan" | "timezone" | "firstBootCompletedAt" | "phoneNumber"
  >;
  /**
   * Optional override for the standing-orders catalog. Tests use this to
   * inject a smaller fixture; production passes nothing and gets the full
   * catalog.
   */
  catalogOverride?: ReadonlyArray<StandingOrderProgram>;
  /**
   * Sprint 9.5 (2026-05-06) — first-boot kickstart switch.
   *
   * When the creator has not yet completed first boot
   * (`firstBootCompletedAt === undefined`), the bundle includes a one-shot
   * `kind: "at"` job whose payload triggers `first_boot_introduction` the
   * moment the gateway scheduler arms. Without this, a fresh creator waits
   * up to 30 min for the next heartbeat before Maya sends her first
   * iMessage — bad UX on a deploy that the operator just paid for.
   *
   * Mechanism (verified against
   * `node_modules/openclaw/dist/jobs-*.js` 2026.4.23 and the package's
   * `plugin-sdk/src/gateway/protocol/schema/cron.d.ts`):
   *
   *   - schedule.kind="at" + a past `at` timestamp → scheduler fires on
   *     the first `armTimer` tick after `activateGatewayScheduledServices`
   *     boots (`Math.max(nextAt - now, 0)` clamps to 0 → `MIN_REFIRE_GAP_MS`).
   *   - sessionTarget="isolated" + payload.kind="agentTurn" → the cron
   *     daemon spawns an isolated agent turn, which loads
   *     AGENTS.md/SOUL.md/USER.md/standing-orders.md, sees
   *     `firstBootCompletedAt === undefined` in USER.md, and runs the
   *     existing `first_boot_introduction` standing order.
   *   - delivery.mode="announce" + channel="last" → the agent's reply
   *     goes to the most recently active channel (claw-messenger
   *     iMessage).
   *   - deleteAfterRun=true → OpenClaw drops the row from the cron store
   *     after the first successful run; subsequent redeploys that
   *     re-stamp jobs.json don't refire because by then
   *     `firstBootCompletedAt` is set and we don't emit the kickstart at
   *     all.
   *
   * This is OpenClaw's NATIVE one-shot mechanism — no plugin hook
   * (`gateway_start` would require shipping a custom plugin), no Convex
   * → gateway HTTP push (would require LAN bind + controlUi config which
   * we deliberately do not enable, see `deployMaya.ts` boot script
   * comments). Native-first per `feedback_openclaw_native_first.md`.
   */
  firstBootKickstart?: {
    /**
     * Test seam — overrides the absolute timestamp emitted on the kickstart
     * job. In production we pass `Date.now() - 1` so the timestamp is
     * deterministically in the past at parse time. Tests pass a fixed value
     * so the bundle hash stays stable across runs.
     */
    nowMsOverride?: number;
  };
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
    const message =
      program.cronMessage ??
      `Run program '${program.title}'. See AGENTS.md / standing-orders.md for the full Scope / Triggers / Approval gates / Escalation rules.`;
    const payload =
      program.session === "main"
        ? ({
            kind: "systemEvent",
            text: message,
          } as const)
        : ({
            kind: "agentTurn",
            message,
            lightContext: true,
          } as const);
    jobs.push({
      id: program.cronEntryId,
      name: program.title,
      description: `Standing order: ${program.id}`,
      enabled: true,
      createdAtMs: 0,
      updatedAtMs: 0,
      schedule: {
        kind: "cron",
        expr: program.defaultCron,
        tz: creator.timezone,
      },
      sessionTarget: program.session,
      wakeMode: "now",
      payload,
      ...(program.session === "isolated"
        ? ({
            delivery: {
              mode: "announce",
              channel: "last",
              bestEffort: true,
            },
          } as const)
        : {}),
    });
  }

  // Sort by name for deterministic output (the deploy pipeline's diff
  // depends on this).
  jobs.sort((a, b) => a.name.localeCompare(b.name));

  // Sprint 9.5 — prepend the first-boot kickstart job (when applicable)
  // AFTER the cron sort so it always sits at index 0. Fresh-deploy UX
  // benefits from the lexical first slot in jobs.json being human-obvious
  // ("0001_first_boot_kickstart"); the cron set above stays alphabetized
  // among itself.
  const kickstart = inputs.firstBootKickstart
    ? buildFirstBootKickstartJob({
        creator,
        nowMsOverride: inputs.firstBootKickstart.nowMsOverride,
      })
    : null;

  return { jobs: kickstart ? [kickstart, ...jobs] : jobs };
}

/**
 * Sprint 9.5 — emit the one-shot `kind: "at"` kickstart job that triggers
 * `first_boot_introduction` immediately on gateway boot.
 *
 * Skipped when `creator.firstBootCompletedAt` is set: the standing order
 * would fall through to a no-op (USER.md says `completed <ts>`), but it's
 * cleaner not to emit a job at all.
 *
 * `nowMs` is set to one millisecond ago so the OpenClaw scheduler clamps
 * the delay to zero on its first armTimer pass — i.e. fires within
 * MIN_REFIRE_GAP_MS of gateway start. We don't pass `0`/epoch because some
 * OpenClaw schedule-validators reject zero / pre-2000 timestamps as
 * obviously-malformed (parseAbsoluteTimeMs guards against `<= 0`).
 */
function buildFirstBootKickstartJob(opts: {
  creator: Pick<
    Doc<"creators">,
    "plan" | "timezone" | "firstBootCompletedAt" | "phoneNumber"
  >;
  nowMsOverride?: number;
}): JobSpec | null {
  if (opts.creator.firstBootCompletedAt) return null;
  // Sprint 9.6 — kickstart needs the creator's phone to send the very first
  // iMessage (no "last" channel exists on a fresh deploy). Skip if missing —
  // a kickstart with no delivery target would silently fail in claw-messenger
  // and the creator would never hear from Maya.
  if (!opts.creator.phoneNumber) return null;
  const now = opts.nowMsOverride ?? Date.now();
  // Use `now - 1` so the schedule is in the past at the moment OpenClaw
  // ingests jobs.json — guarantees a 0-delay arm on the first scheduler
  // tick. Encoded as ISO-8601 because the scheduler's `parseAbsoluteTimeMs`
  // accepts both numeric ms and ISO strings; ISO is more debuggable in the
  // Fly logs.
  const at = new Date(now - 1).toISOString();
  return {
    id: "0001_first_boot_kickstart",
    name: "0001 First-boot kickstart",
    description:
      "One-shot trigger that runs `first_boot_introduction` immediately on gateway start, " +
      "instead of waiting for the next heartbeat (~30 min). Self-deletes after first run; only " +
      "emitted while creators.firstBootCompletedAt is undefined.",
    enabled: true,
    createdAtMs: 0,
    updatedAtMs: 0,
    schedule: { kind: "at", at },
    sessionTarget: "isolated",
    wakeMode: "now",
    deleteAfterRun: true,
    payload: {
      kind: "agentTurn",
      message:
        "First-boot kickstart. Run the `first_boot_introduction` standing order now. Send shape — THREE separate `claw-messenger.sendText` calls, NOT one combined message:\n  (1) Greet ≤80 chars. 'Hey [first name]. I'm Maya, your manager.' Plain human, no exclamation marks, no emoji, no marketing-pitch language.\n  (2) Cited insight ≤300 chars. ONE observation about what you see in their account, grounded in real evidence, in plain human words. The citation must reference what the creator can verify themselves ('your last 30 posts', 'the Piccadilly clips from this week') — NEVER reference internal data structures like `[source: creatorPicture]`, `creatorPicture`, `MEMORY.md`, `SOUL.md`, `USER.md`, `voiceFingerprint`, `audience.topGeos`, table names, or any code-shaped identifier. The creator does not know those exist. NEVER invent precise numbers — if the data is a ranked list of geos like `['UK', 'US']`, say 'mostly UK, US second' (NEVER 'split 50/50' — that number is fabricated; ranked lists are not percentages). No creator-jargon: not 'FYP' (say 'the For You feed'), not 'first-frame visual clarity', not 'share metrics', not 'brand-deal matching', not 'operational weight', not 'lock in your strategy'. Say the plain-human version (see SOUL.md 'Human language only').\n  (3) Q1 location, ≤140 chars. The Q1 message MUST carry a short human lead-in into the question batch — landing 'Where are you based?' cold reads abrupt. Either bundle the lead-in with the question on one line ('Got a few quick questions to start — where are you based?') or open with a short transition before the question on the same send ('Got a few quick questions to start. First — where are you based?'). NEVER use the word 'anchor' to the creator. The lead-in is one short human sentence, not a marketing intro.\nEach send ≤400 chars. After Q1 lands and the creator answers, send Q2 the same way: one message, one question, no 'anchor' wording, no preamble (the Q1 lead-in covers the framing once). Q2-Q6 in order: niche → 3-month goals → job status → brand deals + floor → anti-patterns. After picture-verify lock, offer Gmail + Calendar OAuth opt-ins. Stamp `creators.openingAnswersAt` after answers come back, and `creators.firstBootCompletedAt` after the whole arc lands. See AGENTS.md / SOUL.md / USER.md for the full Scope / Triggers / Approval / Escalation rules — standing orders are embedded inline in AGENTS.md (Wave 5 / OpenClaw 4.23 convention; no separate standing-orders.md file).",
      lightContext: true,
    },
    delivery: {
      mode: "announce",
      channel: "claw-messenger",
      to: opts.creator.phoneNumber,
      bestEffort: true,
    },
  };
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
