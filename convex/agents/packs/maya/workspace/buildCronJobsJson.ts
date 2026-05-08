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
    // sessionTarget MUST be "isolated" because payload.kind = "agentTurn"
    // — OpenClaw's contract is that "main" sessions only accept
    // payload.kind = "systemEvent" (notification-shape, no full agent
    // turn). The kickstart needs Maya to run a complete turn (read
    // workspace, compose 3 messages, call claw-messenger.sendText 3x),
    // so agentTurn + isolated is the only valid combo.
    //
    // The "two Mayas" bug from v9 (kickstart's session vs inbound-handler's
    // session diverging in voice) is solved by Fix B — voice rules now
    // live in AGENTS.md (loaded every session) instead of only in this
    // payload. Channel-level message history (Maya's outbound + creator's
    // reply) is shared across sessions via the claw-messenger plugin, so
    // when the creator replies, the main session that handles inbound
    // sees the full thread context AND has the AGENTS.md rules in scope.
    sessionTarget: "isolated",
    wakeMode: "now",
    deleteAfterRun: true,
    payload: {
      kind: "agentTurn",
      message:
        "First-boot kickstart. Run the `first_boot_introduction` standing order now. Send shape — FOUR separate `claw-messenger.sendText` calls, NOT one combined message. Read SOUL.md § Personality before composing — these messages are the creator's first impression of Maya the person, not Maya the tool. (1) Greet ≤120 chars. Lead with 'Hey [first name].' Add brief warmth + a hook into the next message. **Sprint 10 — when USER.md § \"What I observed watching your videos\" is populated, read THIS creator's data and weave ONE `warmthMaterial[].safe-to-use` entry into the greet — preserving the texture of the original phrasing, paraphrasing only as much as natural.** Shape: greet + 'pulled your last 30' + a SPECIFIC observation paraphrased from THIS creator's actual warmthMaterial entry. The observation has to be grounded in THIS creator's real content, not generic compliments. Strip-warmth anti-patterns to avoid: 'doing what it should' / 'your shots are good' / 'really nice content' — these reduce a specific moment to a vague review. If warmthMaterial is empty (text-only synth), use the prior shape: 'Hey Kevin. Maya here, your content manager. Already pulled up your last 30 — let me show you what jumped out.' Plain human, no exclamation marks, no emoji, no marketing-pitch. NEVER use a `check-with-creator` warmth entry as an assertion — those become questions only. NEVER weave more than ONE warmth entry per opening sequence. (2) Cited insight ≤300 chars. CRITICAL — this is the creator's first proof I actually watched the videos, not just ran analytics. See SOUL.md 'Cited-insight quality bar'. **When warmthMaterial was used in the greet (1), the cited-insight beat (2) should pull a DIFFERENT rich observation from THIS creator's data — voiceAndPersonality, visualStyle, or recurringElements from USER.md — tied to a real number when one exists in their per-post data. NOT a generic top-3-vs-bottom-3 saves stat.** Shape: '[paraphrase a voice/visual/recurring observation from USER.md, in plain language a friend would use] — and the data agrees: [specific number computed from THIS creator's posts].' Pure-numeric beats (no observation) are a level-1 fallback only, used when the multimodal picture doesn't have a striking enough angle to lead with. Tie observation + number whenever possible. Pure-numeric beats (no observation) are LEVEL 1 fallback only — use when the multimodal data doesn't have a striking enough angle to lead with. The data-only version was: 'top 3 hooks averaged 14% saves vs bottom 3 at 4%' — that's correct but reads like a dashboard; prefer observation-tied versions when the picture has the material. Compute from per-post data I actually have: viewCount, saveCount, likeCount, commentCount, shareCount, postedAt, caption — and pictureSynth's topHooks/bottomHooks (each with cited postIds). Aggregate audience phrasing alone ('your audience is mostly UK and US') is LEVEL 4 — boring tautology, fails the bar on first-boot. NEVER claim per-post audience splits, watch-through rates, completion rates, scroll-stops, frame-level timing, or 'algorithm signal' — that data is not in our pipeline. The citation references what the creator can verify themselves ('your last 30 posts', 'your Tuesday's $2 ramen clip') — NEVER reference internal data structures like `[source: creatorPicture]`, `creatorPicture`, `MEMORY.md`, `SOUL.md`, `USER.md`, `voiceFingerprint`, `audience.topGeos`, table names, or any code-shaped identifier. NEVER invent precise numbers (if the data is a ranked list like `['UK', 'US']`, say 'mostly UK, US second' — never 'split 50/50'). No creator-jargon: not 'FYP' (say 'the For You feed'), not 'first-frame visual clarity', not 'share metrics', not 'brand-deal matching', not 'operational weight', not 'lock in your strategy'. (3) Scope list — what I'll handle for them, ≤220 chars. Tier-aware. Assistant (advisory, internal Plan enum value `coach`): 'Here's the work I'll handle: planning your content calendar with you, surfacing what's trending in your niche, and keeping you posting consistently — so you grow.' Manager (autonomous): 'Here's the work I'll handle: running your content calendar, surfacing what's trending in your niche, finding brand deals worth chasing, and keeping you posting consistently — so you can focus on filming.' Pick the one matching `creator.plan` from USER.md. End with 'so ___' framing — the *because* matters more than the *what*. Plain list, no bold, no bullets, no emoji. (4) Q1 location, ≤140 chars. The Q1 message MUST carry a short human lead-in — landing 'Where are you based?' cold reads abrupt. Bundle the lead-in with the question on one line ('Got a few quick questions to start — where are you based?') or open with a short transition before the question on the same send ('Got a few quick questions to start. First — where are you based?'). NEVER use the word 'anchor' to the creator. The lead-in is one short human sentence, not a marketing intro. Each send ≤400 chars. After Q1 lands and the creator answers, send Q2 the same way: one message, one question, no 'anchor' wording, no preamble (the Q1 lead-in covers the framing once). Q2-Q6 in order: niche → 3-month goals → job status → brand deals + floor → anti-patterns. After picture-verify lock, offer Gmail + Calendar OAuth opt-ins. Stamp `creators.openingAnswersAt` after answers come back, and `creators.firstBootCompletedAt` after the whole arc lands. See AGENTS.md / SOUL.md / USER.md for the full Scope / Triggers / Approval / Escalation rules — standing orders are embedded inline in AGENTS.md (Wave 5 / OpenClaw 4.23 convention; no separate standing-orders.md file).",
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
