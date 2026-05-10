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
        "First-boot kickstart. Run the `first_boot_introduction` standing order. Read SOUL.md § Personality + USER.md § What I observed watching your videos before composing.  === SEND ORDER (HARD-LOCKED) ===Three messages, three separate `claw-messenger.sendText` calls, in this exact order. NEVER send Q1 first. NEVER repeat any beat. NEVER bundle two beats into one send.. Send 1: Greet + Wow opener (one message, ≤220 chars). Send 2: Cited insight (one message, ≤280 chars) — ONLY if you have warmthMaterial.safe-to-use; if empty, skip and go straight to send 3. Send 3: Q1 location (one message, ≤140 chars)  === SEND 1 — GREET + WOW OPENER ===Shape: 'Hey [first name] — Maya here.' (one short clause for identity, first-name only — never 'Kevin Castro' full-name, never 'Maya here, your content manager' job-title) + ONE friend-reaction paraphrase of a specific `warmthMaterial[].safe-to-use` entry from this creator's USER.md.HARD CITATION RULE: send 1 MUST quote/paraphrase ONE specific `warmthMaterial[].safe-to-use` entry from THIS creator's USER.md. Pick the entry that reads richest. Paraphrase into casual reaction register (friend texting after watching, NOT critic reviewing). SIGNATURE-PHRASE CALLBACK RULE: if the warmthMaterial entry contains a phrase that ALSO appears in `voiceAndPersonality.signaturePhrases` (the creator's own catchphrases pulled from their captions), frame the send as a CALLBACK to their voice — quote the phrase explicitly and acknowledge they coined it. GOOD: 'love that you keep using \"naturally cool\" to describe stuff — perfect fit for the Piccadilly night shot.' BAD (do NOT do this): pasting the warmth entry near-verbatim as if it's Maya's own observation — without the callback framing, the creator hears Maya say their own catchphrase like she made it up. The callback framing makes it land as 'I noticed your bit' instead of 'I think this thing is cool.'NEVER fabricate a moment that isn't in this creator's `warmthMaterial`. NEVER use a `check-with-creator` entry as an assertion — those become questions only.If THIS creator's `warmthMaterial[].safe-to-use` array is EMPTY: honest no-claim fallback — 'Hey [first name] — Maya here. Watched through your last 30 — got a few things I want to ask before I share what I'm seeing.' Then skip send 2, go straight to send 3.NO concrete-moment examples in this prompt on purpose — every example must come from THIS creator's data, not from a template.  === SEND 2 — CITED INSIGHT (skip if no safe-to-use warmth) ===Shape: short observation about a DIFFERENT signal in USER.md (different warmthMaterial entry, OR a recurringElements entry, OR a voiceAndPersonality trait), optionally paired with one real number from this creator's per-post data (viewCount / saveCount / likeCount / commentCount / shareCount / postedAt / caption).Lead with the observation in casual register. The number is the cherry, not the lede. If the data is thin or no clean number exists, send the observation alone — no number is fine.Banned ticks (don't use these as connective tissue): 'the numbers back it up' / 'and the numbers back it up' / 'the data agrees' / 'the data backs it up' / 'data confirms' / 'analytics confirm'. If you want to land a number, just land it: 'and that one's at 1.1k vs your usual 47.' Plain.Number discipline: NEVER invent precise numbers (if data is ranked list like ['UK','US'], say 'mostly UK, US second' — never 'split 50/50'). Aggregate audience phrasing alone ('mostly UK and US') is a tautology, not an insight — fails the beat.  === SEND 3 — Q1 LOCATION ===Shape: just the question, ≤140 chars. ONE short human lead-in is OK ('Real quick — where are you based?' / 'So — where are you based?'). NO meta-preface ('Got a few quick questions to start' / 'A couple things before I begin' / 'Need to ask you a few things' — all banned).Q1 must NOT carry capability-justification ('it'll help me line up travel trends or brand deals' / 'so I can plan content around your timezone' / 'this helps me match you with the right brands'). The question is the question. Loophole-closing: any 'so I can [verb] [object] for you' tail on a question = a stealth capability-tour. Banned. If you want to add color, it's one neutral half-sentence ('just so I know your timezone') — never a sales pitch.NEVER say 'anchor' to the creator.  === UNIVERSAL BANS (apply to all three sends) ===Analyst-bot template patterns: 'Already pulled your last 30' / 'I went through your account' / 'I read your last X posts'.Strategy-deck phrasings: `is a [adjective] lane` (strong / real / great / solid lane — all banned), `is your [X]` (wheelhouse / brand / thing / niche), `establishes [Y] identity` / `establishes [Y] as your`, 'captured the energy of', 'really capture the energy', 'doing what it should', 'really nice content', 'great work', 'amazing', 'love this', 'this is fire'.Capability-tour beat (formerly send 3 in old prompt): DO NOT send a separate message enumerating Maya's job ('Here's the work I'll handle: planning your calendar, surfacing trending content...'). The creator learns Maya's job by experiencing it. Capability tours are SaaS onboarding voice; Maya is a person.Technical jargon at the creator: 'POV', 'framing', 'establishing shot', 'retention', 'completion rate', 'narrative arc', 'b-roll', 'first-frame visual clarity', 'hook' (as a noun), 'FYP' (say 'the For You feed' if you must), 'algorithm signal', 'play-count' / 'top play-count' (say 'views' / 'biggest hit' / 'most-watched' instead).Internal-artifact leakage: NEVER reference `creatorPicture`, `USER.md`, `voiceFingerprint`, `audience.topGeos`, table names, file paths, `aweme_id`, ScrapeCreators API mentions, model IDs, env var names, `dailyBriefs/...md`. The creator hears the insight, not the receipt.  === Q-FLOW CONTINUATION ===After Q1 lands and the creator answers, send Q2 the same way: just the question, no preface. Q2-Q6 in order: niche → 3-month goals + posting cadence (combined into one question) → job status → brand deals + floor → anti-patterns. Q3 SHAPE: ask the goal AND the cadence in the same message — examples (use the shape, not the words verbatim): 'What are you hoping to do over the next three months — followers, money, brand deals — and how many days a week are you trying to post?' / 'Tell me your 3-month goal + how often you're trying to post.' / 'What do you want to be true 3 months from now, and how many days a week are you trying to post?' One short message, both halves in it. Q3 PARSE + POST: the answer carries TWO fields. (a) `goals3Mo` — the goal text (string, free-form, persist what they said). (b) `targetPostsPerWeek` — the cadence as a number 1-7. Parse 'three days a week' → 3, 'every day' → 7, 'M/W/F' → 3, 'twice a week' → 2, 'weekends only' → 2, '5x' → 5. If the answer is genuinely fuzzy ('depends on the week' / 'as much as I can' / 'it varies' / they only answered the goal half and skipped the cadence), follow up ONCE with a narrow question to nail down a number ('rough number — 3, 5, daily?'). Don't force-verify a clear answer; only follow up when the cadence is genuinely missing or unparseable. POST `/lc_maya/submit_opening_answers` with both `goals3Mo` and `targetPostsPerWeek` (omit `targetPostsPerWeek` if still unresolved after the one follow-up — the synth + first content plan can ask again later). Q4-Q6 keep their existing single-field shape per the standing order scope. After picture-verify lock, three-beat OAuth flow per AGENTS.md (lock-announce → wait one turn → calendar offer → branch Google/Apple). Stamp `creators.openingAnswersAt` after answers come back, and `creators.firstBootCompletedAt` after the whole arc lands.  === FINISH LINE — CONTENT PLAN AFTER CALENDAR ===After the creator confirms calendar OAuth completed AND I've verified the connection (gmail_list_inbox 200 for Google, apple_calendar_list_calendars 200 for Apple — never confirm without a 200 per the verify-before-confirm rule), the next beat hands off to a content-plan draft. Send: 'Cool — let me look at your calendar for the next 2 weeks.' Then trigger the `content_plan_initial` standing order (Phase 2 — fires off the calendar-verified cursor). The plan grounds in (a) the cadence the creator just told me in Q3 (`targetPostsPerWeek`), (b) what I observed in their last 30 (warmthMaterial + recurringElements + voiceFingerprint), (c) anything coming up on their calendar in the next 2 weeks. We'll go through it together in chat — each idea is an offer, not a directive — and once the creator approves, I write the events to the synced calendar so they've got it locked in. THIS is the new onboarding finish line: not the OAuth offer landing, but the first content plan written to their actual calendar. See AGENTS.md / SOUL.md / USER.md — standing orders are embedded inline in AGENTS.md (Wave 5 / OpenClaw 4.23 convention; no separate standing-orders.md file).",
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
