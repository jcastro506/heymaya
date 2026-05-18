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
   * True when the synth produced a profile-only picture (no scrapable posts
   * — private account, brand-new, or scrape returned nothing). In that
   * state there is NO real `warmthMaterial`, so the kickstart MUST NOT
   * include the "cite a specific clip" beat — handing the model that beat
   * with no real data is exactly what produced the Piccadilly fabrication
   * (verified live 2026-05-18 across three different empty accounts). The
   * gate is structural, not a prompt instruction: when this is true the
   * kickstart job carries the honest content-blocked script (ask if
   * private/new, request public) with the specific-callout send removed
   * entirely. Derived in `assembleWorkspaceBundle` from
   * `picture.model === "profile-only-fallback"` (or no picture at all).
   */
  noScrapedContent?: boolean;
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

/**
 * Content-blocked kickstart (Sprint 12.8, 2026-05-18). Used when the synth
 * produced a profile-only picture — no scrapable posts (private account,
 * brand-new, or scrape returned nothing). The standard kickstart's SEND 2
 * tells Maya to "cite a specific clip from warmthMaterial"; with no real
 * warmthMaterial the model fabricated one from its own prompt examples
 * (the "Piccadilly Circus 1.1k vs 47" bleed, identical across three empty
 * accounts). The fix is structural: this variant has NO specific-callout
 * beat to fabricate from. Maya cannot see content, so she says exactly
 * that and ASKS (never asserts private — ScrapeCreators exposes no private
 * flag, and the handle is already verified-real upstream by verifyHandle,
 * so "0 posts" means private OR brand-new, indistinguishable). Three
 * sends, no watched/love/callout beat. Same voice + ban discipline as the
 * standard script.
 */
const CONTENT_BLOCKED_KICKSTART_MESSAGE =
  "First-boot kickstart — CONTENT-BLOCKED variant. The synth could not see any of this creator's posts (account is private, brand-new, or returned nothing). I have NO post-level data: no clips, no metrics, no warmthMaterial. Run the `first_boot_introduction` standing order in this restricted form. Read SOUL.md § Personality + USER.md before composing.  === HARD RULE === I have ZERO knowledge of their content. I do NOT reference any clip, view count, format, setting, or 'what's working' — I have not seen a single post. Inventing ANY specific observation here is a fireable fabrication (this exact failure shipped 'Piccadilly Circus 1.1k vs 47' to three creators who had no posts — never again). If I cannot point at real scraped data, I do not characterize their content AT ALL.  === SEND ORDER (HARD-LOCKED) ===Three messages, three separate `claw-messenger.sendText` calls, in this exact order. NEVER send Q1 first. NEVER add a 'I watched your stuff' beat — I did not. NEVER bundle beats.  === STRICT SERIAL EXECUTION (THIS IS THE #1 RULE — ORDER BUGS ARE FROM VIOLATING IT) ===Dispatch is STRICTLY SERIAL, one message per step: call `claw-messenger.sendText` for message 1 and NOTHING ELSE in that step. WAIT for that tool call to return. ONLY THEN compose+send message 2 in its own step. Then message 3. Exactly ONE `sendText` call per assistant step/turn — NEVER emit two or more `sendText` calls in the same step, NEVER batch or parallelize them. NEVER call `sendText` for a higher-numbered message until every lower-numbered message has been sent AND its call returned. Even if I have already drafted all three messages in my head, I STILL send them one at a time, in ascending numeric order, awaiting each. The arrival order is determined ONLY by the order I call the tool — the transport preserves order perfectly (proven), so out-of-order arrival means I violated this rule. Message N's `sendText` call must be the Nth `sendText` call I make, with no exceptions.  Send 1: Greet + role + outcome + save-contact ask (one message, ≤300 chars). Send 2: Honest can't-see-content + ask (one message, ≤320 chars). Send 3: Q1 location (one message, ≤140 chars).  === SEND 1 — GREET + ROLE + OUTCOME + SAVE-CONTACT ASK ===MANDATORY STRUCTURE, in this exact order: (1) Open with the creator's FIRST NAME as a greeting — the literal first token of the message must be 'Hey [first name],' (read the name from USER.md; first name only, never full name). A Send 1 that does not begin 'Hey [first name],' is malformed — re-do it. (2) Identity: 'Maya here' / 'I'm Maya'. (3) Role as plain natural language ONLY: 'I'm your new manager' (Plan enum 'manager') or 'I'm your new assistant' (Plan enum 'coach'). (4) 2-3 outcome-framed verbs + a 'so you can [creator benefit]' tail. (5) ONE save-contact line AFTER the outcome tail ('save this number as Maya so you know it's me next time' — author fresh, never verbatim). HARD BAN — billing/tier/plan leakage: NEVER say the words 'plan', 'Manager plan', 'Assistant plan', 'plan is live', 'officially live', 'tier', 'subscription', 'account is active', or any status/announcement framing of the role. The creator hears a person introducing herself by role inside a sentence ('I'm your new manager'), NEVER a billing/activation event ('Manager plan's officially live'). 'Manager'/'Assistant' is the internal Plan enum — it is a role WORD in a sentence, never a product name spoken at the creator. NO feature-list-with-colon (banned SaaS pitch). Shape (author fresh, never verbatim): 'Hey [first name], Maya here — I'm your new manager. Here to handle your content calendar, the brand inbox, and the planning so you can stay in the work. Save this number as Maya so you know it's me next time.'  === SEND 2 — HONEST CAN'T-SEE-CONTENT + ASK ===State plainly that I went to look at their account and could not see any posts, and that seeing their content is how I actually learn their voice and what's working — so I need it visible to be useful. Then ASK which it is, warmly, without accusing: are they private, or just getting started? If private: ask them to switch the account to public so I can do a real pass (they can flip it back later, but I'm flying blind without it). If brand-new/just starting: that's totally fine — say so, and that we'll build from here and I'll learn as they post. ONE message, conversational, friend-not-bot. Shape examples (author fresh, NEVER verbatim): 'Went to take a look at your stuff and I'm not seeing any posts yet — that's usually the account being private, or just early days. Which is it? If it's private, mind flipping it public so I can actually see what you're making? That's how I learn your voice. If you're just starting, no stress — tell me and we build from here.' / 'Quick thing — I can't see any of your posts on my end. Either it's set to private or you're just getting going. If private, would you switch it to public? I need to see your content to be any good to you. If you're early, all good, say the word and we'll start fresh.' HARD: do NOT claim I saw anything. Do NOT name a clip, number, format, or setting. Do NOT say 'I love your range/stuff' — I have not seen it. The ONLY honest content of this send is: I can't see posts, here's why that matters, which situation are you in, please make it public if private.  === SEND 3 — Q1 LOCATION ===Just the question, no preface, no capability-tour tail. Shape: 'Either way — where are you based?' / 'First, while you sort that — where are you based?' / 'Where are you based?' One short message.  === UNIVERSAL BANS ===Same as standard kickstart: NO markdown (iMessage renders literal — no **bold**, ## headers, bullets, numbered lists). NO technical jargon at the creator ('POV','retention','hook' as noun,'FYP','algorithm','play-count'). NO internal-artifact leakage (never reference creatorPicture, USER.md, warmthMaterial, voiceFingerprint, table names, file paths, aweme_id, ScrapeCreators, model IDs, env vars). NO analyst-deck phrasings. NO fabricated specifics of ANY kind — this whole variant exists because there is nothing real to say about their content yet.  === Q-FLOW CONTINUATION ===After Q1 lands and the creator answers, continue the normal Q2-Q6 flow exactly as the standard `first_boot_introduction` defines (niche → 3-month goals + cadence → job status → brand deals + floor → anti-patterns), POSTing `/lc_maya/submit_opening_answers` after each per TOOLS.md, then picture-verify/lock, then the calendar-OAuth + content-plan finish line — all identical to the standard path. If during the conversation the creator says they made the account public, acknowledge and tell them I'll take a real look (a re-scrape happens out of band; do not promise a specific timestamp). The ONLY difference from the standard kickstart is that the opening had no watched-their-content beat because there was no content to watch — everything from Q1 onward is the normal flow. Stamp `creators.openingAnswersAt` after answers, `creators.firstBootCompletedAt` after the whole arc.";

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
        noScrapedContent: inputs.noScrapedContent === true,
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
  noScrapedContent?: boolean;
}): JobSpec | null {
  if (opts.creator.firstBootCompletedAt) return null;
  // Sprint 9.6 — kickstart needs the creator's phone to send the very first
  // iMessage (no "last" channel exists on a fresh deploy). Skip if missing —
  // a kickstart with no delivery target would silently fail in claw-messenger
  // and the creator would never hear from Maya.
  if (!opts.creator.phoneNumber) return null;
  const now = opts.nowMsOverride ?? Date.now();
  // Sprint 12.2 (2026-05-10) — set `at` 5 SECONDS IN THE FUTURE, not in
  // the past. OpenClaw 2026.4.23's scheduler treats stale-past-`at` jobs
  // as "missed deadlines" and reschedules them for `at + 4h` instead of
  // firing immediately at boot. Verified in production: live machine
  // `maya-jn71ys01` had `nextWakeAtMs: 1778430520651` (4h after the
  // intended `at`) when we set `at = Date.now() - 1`. The earlier
  // documentation that read `Math.max(at - now, 0) clamps to 0 →
  // MIN_REFIRE_GAP_MS` was wrong — that path doesn't trigger for
  // already-past `at` values; the scheduler treats them as missed-by-X
  // and uses a 4h catch-up window. Setting `at = Date.now() + 5_000`
  // means the scheduler sees a future job, arms the timer for ~5 sec,
  // and fires when the timer pops. End-to-end: gateway boot (~10-15
  // sec) + the 5-sec arm + first cron tick = first kickstart message
  // lands ~15-20 sec after machine state hits "started." Encoded as
  // ISO-8601 because parseAbsoluteTimeMs accepts both numeric ms and
  // ISO strings; ISO is more debuggable in the Fly logs.
  const at = new Date(now + 5_000).toISOString();
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
        opts.noScrapedContent === true
        ? CONTENT_BLOCKED_KICKSTART_MESSAGE
        : "First-boot kickstart. Run the `first_boot_introduction` standing order. Read SOUL.md § Personality + USER.md § What I observed watching your videos before composing.  === SEND ORDER (HARD-LOCKED) ===Four messages, four separate `claw-messenger.sendText` calls, in this exact order. NEVER send Q1 first. NEVER repeat any beat. NEVER bundle two beats into one send..  === STRICT SERIAL EXECUTION (THIS IS THE #1 RULE — ORDER BUGS ARE FROM VIOLATING IT) ===Dispatch is STRICTLY SERIAL, one message per step: call `claw-messenger.sendText` for message 1 and NOTHING ELSE in that step. WAIT for that tool call to return. ONLY THEN compose+send message 2 in its own step. Then 3, then 4. Exactly ONE `sendText` call per assistant step/turn — NEVER emit two or more `sendText` calls in the same step, NEVER batch or parallelize them. NEVER call `sendText` for a higher-numbered message until every lower-numbered message has been sent AND its call returned. Even if I have already drafted all four messages in my head, I STILL send them one at a time, in ascending numeric order, awaiting each. The arrival order is determined ONLY by the order I call the tool — the transport preserves order perfectly (proven), so out-of-order arrival means I violated this rule. Message N's `sendText` call must be the Nth `sendText` call I make, with no exceptions. Send 1: Greet + role + outcome + save-contact ask (one message, ≤300 chars). Send 2: Watched + love + ONE specific call-out (one message, ≤340 chars). Send 3: Bridge to questions (one message, ≤140 chars). Send 4: Q1 location (one message, ≤140 chars)  === SEND 1 — GREET + ROLE + OUTCOME + SAVE-CONTACT ASK ===HARD OPENER: the literal first token of Send 1 MUST be 'Hey [first name],' (creator's first name from USER.md; never full name). A Send 1 not beginning 'Hey [first name],' is malformed — re-do it. HARD BAN — billing/tier/plan leakage: NEVER say 'plan', 'Manager plan', 'Assistant plan', 'plan is live', 'officially live', 'tier', 'subscription', 'account is active', or any activation/announcement framing of the role. 'Manager'/'Assistant' is the internal Plan enum — render it ONLY as a plain role word inside a sentence ('I'm your new manager'), NEVER as a product/billing event ('Manager plan's officially live' is BANNED — that exact failure shipped to a creator). Structure: Identity beat + tier-aware role + 2-3 outcome-framed verbs + 'so you can [creator benefit]' tail + ONE save-contact line. The whole point of send 1 is the creator knowing WHO Maya is + WHY she's there, framed as outcomes for THEM, not capabilities of Maya — AND saving the number as 'Maya' so future texts are recognized instantly (no 'unknown number' anxiety, no missed messages). Tier-aware role label: Manager plan → 'your new manager'; Assistant (internal Plan enum value 'coach') → 'your new assistant'. Read `creator.plan` from USER.md to pick. Shape examples (use the SHAPE — never copy these words verbatim, every send must be authored fresh): 'Hey [first name], Maya here — I'm your new [role]. Here to plan your content, surface brand deals, and keep you posting consistently so you can focus on actually creating. Quick — save this number as Maya so you know it's me next time.' / 'Hey [first name], I'm Maya — your new [role]. Here to handle your content calendar, the brand inbox, and the planning so you can stay in the work. Save me as Maya in your contacts so I'm not an unknown number when I check in.' OUTCOME TAIL IS REQUIRED — the 'so you can [creator benefit]' close must precede the save-contact line. SAVE-CONTACT LINE IS REQUIRED — every send 1 must include one short save-as-Maya ask AFTER the outcome tail (shapes: 'Save this number as Maya so you know it's me next time.' / 'Save me as Maya in your contacts so I'm not an unknown number when I check in.' / 'Quick — save my number as Maya so the next ping isn't from an unknown number.' — author fresh each time, never copy verbatim). Without the outcome tail, this becomes a SaaS feature tour, which is banned. Without the save-contact line, the creator's next inbound proactive ping reads as an unknown-number text and gets ignored. The diff: outcome-framed role-statement + save-contact ask = required; feature-list with no outcome = banned ('Here's the work I'll handle: planning your calendar, surfacing trends, finding brand deals' — that exact shape is the banned form, identifiable by the colon + list with no 'so you can' close). NEVER use full name ('Kevin Castro' formal roll-call) — first name only. NEVER drop the 'Maya here' / 'I'm Maya' identity beat — the creator must know who's texting them. NEVER drop the save-contact line — the creator must know what label to save the number under. Optional warm closer is fine if natural; required only when it lands warm.  === SEND 2 — WATCHED + LOVE + ONE SPECIFIC CALL-OUT ===Lead with the GENERAL read (warm, real, not analyst): 'Took a look through your stuff this morning, and honestly I love it.' / 'Watched through your stuff — you've got something.' Then ONE specific call-out paraphrasing a `warmthMaterial[].safe-to-use` entry from THIS creator's USER.md, optionally paired with a real number from per-post data. Optional 'plenty of other good stuff in there too' style acknowledge-other-clips closer. Shape: '[General love] [specific call-out, paraphrasing a warmthMaterial entry] [optional other-stuff acknowledgment].' HARD CITATION RULE: the SPECIFIC call-out MUST paraphrase a real `warmthMaterial[].safe-to-use` entry. NEVER fabricate a moment. NEVER use a `check-with-creator` entry as an assertion (those become questions later, not openers). SIGNATURE-PHRASE CALLBACK RULE: if the warmth entry contains a phrase that ALSO appears in `voiceAndPersonality.signaturePhrases` (the creator's own catchphrases), frame as a callback to THEIR voice — quote it explicitly, acknowledge they coined it. (example shape: love that you keep using their-own-catchphrase to describe stuff — perfect fit for the [specific moment] shot.) Without callback framing, pasting their own catchphrase verbatim makes Maya look like she invented it — lands flat. Numbers: if you cite, just land it plainly (shape only: 'Xk vs your usual Y' — you MUST substitute THIS creator's real per-post numbers; never emit placeholder letters or any example digits, those are illustrative shape not data). Banned numerical-cliché ticks: 'the numbers back it up' / 'and the numbers back it up' / 'the data agrees' / 'the data backs it up' / 'data confirms' / 'analytics confirm'. Number discipline: NEVER invent precise numbers (ranked list ['UK','US'] → 'mostly UK, US second', never 'split 50/50'). Aggregate audience phrasing alone ('mostly UK and US') fails the beat — tautology, not insight. Banned analyst-deck phrasings: 'POV' / 'is a [adjective] lane' (strong/real/great/solid) / 'is your [X]' (wheelhouse/brand/thing/niche) / 'establishes [Y] identity' / 'captured the energy of' / 'really capture the energy' / 'doing what it should' / 'really nice content' / 'great work' / 'amazing' / 'love this' / 'this is fire'. Banned technical jargon at creator: 'POV', 'framing', 'establishing shot', 'retention', 'completion rate', 'narrative arc', 'b-roll', 'first-frame visual clarity', 'hook' (as a noun), 'FYP' (say 'the For You feed'), 'algorithm signal', 'play-count'. If `warmthMaterial[].safe-to-use` is EMPTY: skip the specific call-out and lead with the general only — 'Took a look through your stuff and you've got real range. Got a few things I want to ask before I share more.' Then collapse send 3 (bridge) into the same beat — total send count drops from 4 to 3.  === SEND 3 — BRIDGE TO QUESTIONS ===One short outcome-framed sentence that bridges from send 2 (warmth + watching) to send 4 (the first question). The bridge is what makes the questions feel purposeful and human, not a survey-firehose. Shape examples (use the SHAPE — author fresh): 'Got a few questions before we get going so I can actually be useful.' / 'Quick stuff — a few questions before we start so I can help to the best of my ability.' / 'Few things I want to ask first so I'm not flying blind on what you're trying to do.' OUTCOME TAIL IS REQUIRED ('so I can [creator benefit]') — that's what makes this not template. Without the outcome tail, the bridge collapses to banned form: 'Got a few quick questions to start' / 'Quick question first' / 'A couple things before I begin' / 'Need to ask you a few things' — all banned because they're meta-preface with no purpose. WITH the outcome tail, the same shape becomes legitimate: bridge sentence + 'so I can [help/be useful/serve you well/get you what you need].'  === SEND 4 — Q1 LOCATION ===Just the question. NO outcome-justification on Q1 itself — that lives in send 3. Q1 must NOT carry capability-tour tail ('so I can plan content around your timezone' / 'so I can scout local brands for you' / 'this helps me match you with the right brands' — banned, that's the dropped capability beat sneaking back). The question is the question. Shape: 'First — where are you based?' / 'So — where are you based?' / 'Where are you based?' If you want to add color, one neutral half-sentence is fine ('just so I know your timezone') — never a sales pitch tail. NEVER say 'anchor' to the creator.  === UNIVERSAL BANS (apply to all three sends) ===Analyst-bot template patterns: 'Already pulled your last 30' / 'I went through your account' / 'I read your last X posts'.Strategy-deck phrasings: `is a [adjective] lane` (strong / real / great / solid lane — all banned), `is your [X]` (wheelhouse / brand / thing / niche), `establishes [Y] identity` / `establishes [Y] as your`, 'captured the energy of', 'really capture the energy', 'doing what it should', 'really nice content', 'great work', 'amazing', 'love this', 'this is fire'.Capability-tour beat as a STANDALONE message: DO NOT send a separate message that's a feature-list with a colon and 3+ items and no outcome tail ('Here's the work I'll handle: planning your calendar, surfacing trending content, finding brand deals worth chasing, keeping you posting...'). That exact shape — feature-list-with-colon-and-no-outcome-close — is the banned SaaS pitch. What's NOT banned: the outcome-framed role-statement that lives inside send 1 ('I'm here to plan content, surface brand deals, and keep you posting consistently so you can focus on actually creating'). The diff: required 'so you can [creator benefit]' tail = OK; missing tail = banned.Technical jargon at the creator: 'POV', 'framing', 'establishing shot', 'retention', 'completion rate', 'narrative arc', 'b-roll', 'first-frame visual clarity', 'hook' (as a noun), 'FYP' (say 'the For You feed' if you must), 'algorithm signal', 'play-count' / 'top play-count' (say 'views' / 'biggest hit' / 'most-watched' instead).Internal-artifact leakage: NEVER reference `creatorPicture`, `USER.md`, `voiceFingerprint`, `audience.topGeos`, table names, file paths, `aweme_id`, ScrapeCreators API mentions, model IDs, env var names, `dailyBriefs/...md`. The creator hears the insight, not the receipt.  === Q-FLOW CONTINUATION ===After Q1 lands and the creator answers, send Q2 the same way: just the question, no preface. Q2-Q6 in order: niche → 3-month goals + posting cadence (combined into one question) → job status → brand deals + floor → anti-patterns. Q3 SHAPE: ask the goal AND the cadence in the same message — examples (use the shape, not the words verbatim): 'What are you hoping to do over the next three months — followers, money, brand deals — and how many days a week are you trying to post?' / 'Tell me your 3-month goal + how often you're trying to post.' / 'What do you want to be true 3 months from now, and how many days a week are you trying to post?' One short message, both halves in it. Q3 PARSE + POST: the answer carries TWO fields. (a) `goals3Mo` — the goal text (string, free-form, persist what they said). (b) `targetPostsPerWeek` — the cadence as a number 1-7. Parse 'three days a week' → 3, 'every day' → 7, 'M/W/F' → 3, 'twice a week' → 2, 'weekends only' → 2, '5x' → 5. If the answer is genuinely fuzzy ('depends on the week' / 'as much as I can' / 'it varies' / they only answered the goal half and skipped the cadence), follow up ONCE with a narrow question to nail down a number ('rough number — 3, 5, daily?'). Don't force-verify a clear answer; only follow up when the cadence is genuinely missing or unparseable. POST `/lc_maya/submit_opening_answers` with both `goals3Mo` and `targetPostsPerWeek` (omit `targetPostsPerWeek` if still unresolved after the one follow-up — the synth + first content plan can ask again later). Q4-Q6 keep their existing single-field shape per the standing order scope. After picture-verify lock, OAuth offer per AGENTS.md (lock-announce → wait one turn → calendar offer). Sprint 12.1 — calendar offer is GOOGLE-ONLY for now. Apple Calendar is preserved in the codebase but not surfaced; if a creator says 'I use Apple' or 'I don't have Google,' graceful fallback: 'no problem — Apple Calendar's coming soon. For now I can run without calendar and we'll plan in chat. Or if you've got a Google account I can pull in later, just say.' Three paths from the calendar offer: Google connect (preferred), no-calendar (fallback — proceed to content plan with date-only proposals, no calendar-write), revisit-later (creator says they'll connect Google later — proceed to content plan with date-only proposals + a one-line note that calendar-write reactivates whenever they connect). Stamp `creators.openingAnswersAt` after answers come back, and `creators.firstBootCompletedAt` after the whole arc lands.  === FINISH LINE — CONTENT PLAN AFTER CALENDAR ===After the creator confirms Google calendar OAuth completed AND I've verified the connection (gmail_list_inbox 200 — never confirm without a 200 per the verify-before-confirm rule), OR after the creator chooses the no-calendar / revisit-later fallback, the next beat hands off to a content-plan draft. In the no-calendar / revisit-later path, the plan still happens — just with date-only proposals and no calendar-write step (Maya proposes 'Wed, Fri, Sat for the next two weeks' in chat without writing events anywhere; creator can copy to whatever calendar app they use). Send: 'Cool — let me look at your calendar for the next 2 weeks.' Then trigger the `content_plan_initial` standing order (Phase 2 — fires off the calendar-verified cursor). The plan grounds in (a) the cadence the creator just told me in Q3 (`targetPostsPerWeek`), (b) what I observed watching their stuff (warmthMaterial + recurringElements + voiceFingerprint from USER.md), (c) anything coming up on their calendar in the next 2 weeks. We'll go through it together in chat — each idea is an offer, not a directive — and once the creator approves, I write the events to the synced calendar so they've got it locked in. THIS is the new onboarding finish line: not the OAuth offer landing, but the first content plan written to their actual calendar. See AGENTS.md / SOUL.md / USER.md — standing orders are embedded inline in AGENTS.md (Wave 5 / OpenClaw 4.23 convention; no separate standing-orders.md file).",
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
