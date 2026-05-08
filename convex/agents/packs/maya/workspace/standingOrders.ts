/**
 * Canonical standing-orders catalog for Maya.
 *
 * Each entry below is one program in OpenClaw's canonical 4-part standing
 * orders format (Scope / Triggers / Approval gates / Escalation rules), per
 * `https://docs.openclaw.ai/automation/standing-orders.md`.
 *
 * The catalog is the single source of truth for behavior names + tier
 * gating. Both `generateAgentsMd.ts` (renders the prose) and
 * `buildCronJobsJson.ts` (emits the runtime cron) consult this file so we
 * never drift between "what AGENTS.md tells Maya to do" and "what the
 * scheduler actually fires."
 *
 * Tier semantics (post-coach/manager migration):
 *   - "all"     — every plan runs this program (both Coach and Manager).
 *   - "manager" — Manager-only autonomous behavior (Coach skipped).
 *
 * The boundary is **autonomy on the creator's behalf**, not breadth or
 * compute. A program is `tier:"manager"` only when running it requires Maya
 * to take an autonomous action OUTBOUND on behalf of the creator (auto-send
 * a brand email, draft a cold outreach pitch, fire Apollo/Hunter discovery,
 * negotiate a deal back-and-forth). Every read/advisory program — even when
 * it consumes paid third-party APIs (Brave, Composio Stripe/Calendar pulls)
 * — is `tier:"all"` because the ceiling on cost is tiny per-creator and the
 * advisory value compounds over the relationship.
 *
 * NOTE: pre-migration "pro+" was a breadth gate (more platforms, more
 * thinking budget, more proactive crons). Post-migration the only behaviors
 * tagged `manager` are autonomy gates — `brand_email_triage` (auto-send
 * arm), `hook_library_build` (folded into the autonomous post-reaction
 * loop), and the autonomous-outbound programs that ship in subsequent
 * patches (`brand_outreach`, `pitch_strategy`). Read/advisory programs that
 * were briefly tagged `manager` during the mechanical pro+→manager rename —
 * `competitor_watch`, `revenue_snapshot`, `calendar_lookahead`,
 * `industry_intel_daily` — have since been corrected back to `all`. They
 * are pure cost-optimization gates (Brave / Composio per-query reads), not
 * autonomy gates, and the cost ceiling is well within both tiers' margin.
 * (Sprint 3 Slice 1 dropped `manager_readiness_packet_quarterly` and the
 * `algo_research_*` family entirely for MVP.)
 *
 * Kind semantics:
 *   - "cron"        — runs on a schedule. `cronEntryId` and `defaultCron`
 *                     are required; the cron generator consumes them. After
 *                     Sprint 3 Slice 1 the cron set collapses to exactly six
 *                     precise-timing entries: morning_brief, evening_recap,
 *                     weekly_content_plan, weekly_review,
 *                     accountability_nudge, revenue_snapshot.
 *   - "heartbeat"   — fires off OpenClaw's heartbeat tick during waking
 *                     hours; LLM decides whether the trigger condition is
 *                     met. Retains `defaultCron` / `session` / `cronEntryId`
 *                     / `cronMessage` for prose/telemetry continuity, but
 *                     `buildCronJobsJson` skips these. Slice 2's
 *                     `generateHeartbeatMd.ts` consumes them.
 *   - "event"       — fires on an external trigger; no schedule.
 *   - "on-demand"   — creator-initiated; no schedule, no event.
 *   - "folded"      — composed into another program's run (e.g. growth
 *                     coaching folds into morning brief); no separate
 *                     schedule.
 */

import type { Plan } from "../../../../lib/planFeatures";

export type StandingOrderTier = "all" | "manager";
/**
 * Sprint 3 Slice 1: introduced "heartbeat" alongside "cron".
 *
 * "heartbeat" entries used to be `kind: "cron"`; they retain `defaultCron`,
 * `session`, `cronEntryId`, `cronMessage` etc. (so Slice 2's
 * `generateHeartbeatMd.ts` can read them), but they are NOT emitted into
 * `~/.openclaw/cron/jobs.json`. The cron daemon collapses to exactly the
 * six precise-timing entries (morning_brief, evening_recap,
 * weekly_content_plan, weekly_review, accountability_nudge,
 * revenue_snapshot). Everything else fires from heartbeat ticks during
 * waking hours, where the LLM decides whether the trigger condition is met.
 */
export type StandingOrderKind =
  | "cron"
  | "heartbeat"
  | "event"
  | "on-demand"
  | "folded";

/**
 * Session semantics per OpenClaw's `~/.openclaw/cron/jobs.json`:
 *   - "isolated" — fresh transcript per run; preferred for proactive
 *                  generative behaviors so prior-tick context doesn't bleed.
 *   - "main"     — enqueue a system event into the main session; preferred
 *                  for accountability nudges where Maya should reference the
 *                  ongoing conversation thread.
 */
export type CronSession = "isolated" | "main";

/**
 * Thinking-budget hint for the runtime model router. Optional; default
 * routing keys off the program's task class via `PER_TASK_DEFAULT_BUDGET`.
 * Use this only when a specific program needs an explicit override (Sprint
 * 7 Slice D's `first_proactive_ping` is the first such program — voice-
 * critical first-impression content needs `medium` regardless of the
 * generic chat default).
 */
export type StandingOrderThinkingBudget = "none" | "low" | "medium" | "high";

/**
 * Structured metadata for `kind: "event"` programs whose firing is driven
 * by a Convex-side cursor flip (vs Maya the agent self-detecting state).
 * `eventTrigger` names the cursor; `delayMs` describes a uniform-random
 * jitter window applied at schedule time. The Convex scheduler honors
 * these — Maya the agent does not consult them at heartbeat time.
 */
export interface EventScheduleSpec {
  /**
   * Name of the Convex-side cursor that fires this event. Stable string,
   * cross-referenced by `convex/lcMaya/firstProactivePing.ts:fire*Event`
   * helpers + the playbook prose.
   */
  eventTrigger: string;
  /**
   * Inclusive lower bound on the post-trigger delay, in ms.
   */
  minDelayMs: number;
  /**
   * Inclusive upper bound on the post-trigger delay, in ms. Must be >=
   * `minDelayMs`.
   */
  maxDelayMs: number;
}

export interface StandingOrderProgram {
  /** Program id — used as a stable handle in tests + cross-references. */
  id: string;
  /** H3 program title rendered in AGENTS.md. */
  title: string;
  /** Tier gating. "manager" excludes Coach; "all" includes everyone. */
  tier: StandingOrderTier;
  kind: StandingOrderKind;
  /** Matches `entryId` in `agents/skills/maya-platform/cron.md` § 2. */
  cronEntryId?: string;
  /** 5-field POSIX cron expression. Required for kind === "cron". */
  defaultCron?: string;
  /** Session model for the cron run. Required for kind === "cron". */
  session?: CronSession;
  /** Scope — what authorized actions Maya may take. */
  scope: string;
  /** Triggers — schedule / event / condition. */
  triggers: string;
  /** Approval gates — what requires creator sign-off. */
  approvalGates: string;
  /** Escalation rules — when to ping operator / stop. */
  escalation: string;
  /** Message body Maya executes for cron-driven programs. */
  cronMessage?: string;
  /**
   * Optional explicit thinking-budget override. Most programs leave this
   * undefined and let the per-task default budget apply.
   */
  thinkingBudget?: StandingOrderThinkingBudget;
  /**
   * Optional event-schedule metadata. Required for `kind: "event"` programs
   * that are fired by a Convex-side cursor stamp + jitter (vs `kind:
   * "event"` programs that Maya self-detects on heartbeat). Sprint 7 Slice
   * D's `first_proactive_ping` is the canonical example.
   */
  eventSchedule?: EventScheduleSpec;
}

export const STANDING_ORDERS: ReadonlyArray<StandingOrderProgram> = [
  {
    id: "first_boot_introduction",
    title: "First-boot introduction",
    tier: "all",
    kind: "event",
    // Sprint 9.7+ (rewritten 2026-05-07 after live test caught the
    // inbound-handler session reading the LEGACY 2-questions+tone script
    // embedded in this scope text — Wave 5 inlines standing orders into
    // AGENTS.md, so this prose has to match the current Sprint 6 / 9.7+
    // onboarding flow exactly. Drift here re-creates the "second Maya"
    // bug.)
    scope:
      "Six-question first-boot flow. Hard-locked question order — DO NOT reorder, DO NOT skip, DO NOT bundle. Q1=LOCATION (city/country) → Q2=NICHE IN THEIR OWN WORDS (their phrasing of what they make content about; 'I don't know yet' is a valid answer; do NOT skip this even if the synth picture has a niche guess — the creator's words are the anchor) → Q3=3-MONTH GOALS → Q4=JOB STATUS (full-time creator / transitioning / side-hustle / hobby) → Q5=BRAND DEALS interest + optional floor → Q6=ANTI-PATTERNS (no-go topics or brands). The kickstart sends greet + cited insight + scope list + Q1 (4 sends). Then for each subsequent answer, I do exactly two things in order: (a) call `POST /lc_maya/submit_opening_answers` via the curl pattern in TOOLS.md § 1 with the parsed field(s) — Q1 → {locationCity, locationState, locationCountry, timezone}; Q2 → {nicheInOwnWords}; Q3 → {goals3Mo}; Q4 → {jobStatus: 'full-time-creator'|'transitioning-full-time'|'side-hustle'|'hobby'}; Q5 → {dealsInterest: 'yes'|'maybe'|'no', dealsFloorUsd?: number}; Q6 → {antiNiches: string[]}; (b) send the next question as a single short claw-messenger.sendText. Without (a), creators.openingAnswersAt never stamps and the next inbound re-triggers the kickstart — which means I would re-greet the creator from scratch, which they will hate. After Q6 + its submit_opening_answers call lands ok, I post the picture summary + 1-3 verification questions drawn from creatorPicture.needsVerification (already populated by the synth that ran at deploy). Wait for confirmation. Apply any corrections via `POST /lc_maya/lock_picture` (corrections array, or empty for clean-confirm). Lock stamps pictureLockedAt. THEN — and only then — a CALENDAR-first three-step OAuth flow per AGENTS.md § Calendar-first OAuth flow: (a) lock-announce stands alone; (b) wait one turn; (c) ask 'want me to connect your calendar? helps me plan content around your actual schedule + spot anything coming up worth making content over'; (d) if yes, ask 'Google Calendar or Apple Calendar?'; (e) branch — Google → POST /lc_maya/start_oauth provider=`gmail` (unified consent covers Calendar + Gmail; mention Gmail as side benefit when sending link); Apple → text the appleid.apple.com/account/manage/section/security deep link + paste-back instructions, then POST /lc_maya/apple_calendar_connect when password arrives. Apple users do NOT get Gmail bundled — that's a separate beat later. After connection lands, VERIFY it via gmail_list_inbox (Google) or apple_calendar_list_calendars (Apple) before telling the creator it worked. Never confirm without a 200. NEVER ask the meta-tone-question ('supportive / strategic / tough-love') — Sprint 6 deleted that beat; tone is calibrated FROM the answers. NEVER use 'anchor' / 'anchor questions' wording to the creator (internal-dev only). NO brand-deal floor pressure on first boot beyond Q5; floor calibration happens later when a real brand email lands. Stamp firstBootCompletedAt (via lc_maya.update_creator) after the OAuth offers ship — that's the arc-complete signal. See playbook.md § 4.5 for full send-shape spec + voice rules + anti-fabrication / no-jargon / no-internal-name rules. Read SOUL.md § Personality before composing — these are the creator's first messages from Maya the person, not Maya the tool.",
    triggers: "Session start, `firstBootCompletedAt === undefined`. Partial completion resumes — if creator has already answered Q1-Q3 in prior session, pick up at Q4. NEVER restart the introduction or re-greet.",
    approvalGates: "None. Tap-skipping OAuth is fine; never nag.",
    escalation: "Skip cited insight beat if picture incomplete (still send the greet + scope list + Q1; the cited insight is a level-2 beat from SOUL.md § Cited-insight quality bar — no real per-post data → skip rather than fabricate). Composio 5xx → defer + retry next heartbeat.",
  },
  {
    id: "first_weekly_plan",
    title: "First weekly plan (immediate, after picture lock)",
    tier: "all",
    kind: "event",
    scope:
      "`maya-content-arc-planner` immediately AFTER `pictureLockedAt` is stamped. Persist + push + stamp `firstWeeklyPlanSentAt`.",
    // Sprint 6 — re-keyed from `openingAnswersAt` to `pictureLockedAt`.
    // The original trigger was premature: it fired before the picture
    // was verified against openingAnswers anchors, so the plan could read
    // unverified data (e.g. London-bug location). Lock first, plan second.
    triggers:
      "`pictureLockedAt` set, `firstWeeklyPlanSentAt === undefined`. Calendar not gating.",
    approvalGates: "Creator approves each idea card in Plan. No auto-publish.",
    escalation: "Picture missing → handles-only plan; 'v2 Sunday has full picture.' Don't defer.",
  },
  {
    id: "first_proactive_ping",
    title: "Day 1 first-touch",
    tier: "all",
    kind: "event",
    thinkingBudget: "medium",
    eventSchedule: {
      eventTrigger: "pictureLockedAt",
      minDelayMs: 15 * 60 * 1000,
      maxDelayMs: 30 * 60 * 1000,
    },
    scope:
      "Within 15-30 min of `pictureLockedAt`, push 1 cited trend + 1 grounded idea + a single Google-connect offer (Sprint 9.8 — covers Gmail + Calendar in one consent) to the creator's primary channel. Voice-critical first-impression content — medium thinking budget. The composer (`convex/lcMaya/firstProactivePing.ts:runFirstProactivePing`) picks the top-1 trend from `trendObservations` and the top-1 idea grounded in `creatorPicture` + recent posts; result lands in `firstProactivePings` for the agent heartbeat to send via claw-messenger. Stamp `firstProactivePingSentAt`. Empty-input precedence: BOTH empty → silent no-op (status='skipped'); ONE empty → ping with the leg that worked. Trend has URL citation; idea has ≥2 post-id citations from `creatorPicture.sourceCitations`.",
    triggers:
      "Event: `creators.pictureLockedAt` is stamped (Sprint 6 verification gate) AND `firstProactivePingSentAt === undefined`. The Convex scheduler fires `runFirstProactivePing` at `pictureLockedAt + uniformRandom(15min, 30min)`.",
    approvalGates:
      "None — first-touch is the action. Connect offers are tap-to-OAuth, never auto-grant.",
    escalation:
      "If `trendObservations` and `creatorPicture` are BOTH thin (no top trend AND no idea citations), write `firstProactivePings` row with status='skipped' and stamp `firstProactivePingSentAt` so the event doesn't re-fire. Silent no-op > bad first impression. If ONE leg fails, ship with the other (prose precedence rule documented in the row).",
  },
  {
    id: "morning_brief",
    title: "Morning brief",
    tier: "all",
    kind: "cron",
    cronEntryId: "morning_brief",
    defaultCron: "0 7 * * *",
    session: "isolated",
    scope:
      "Read yesterday's metrics + open commitments + pending deals + today's plan; assemble a <200-word brief with one cited insight + one action + any pending approvals; write `dailyBriefs`; push to primary channel.",
    triggers: "Cron `morning_brief` at 7:00am local.",
    approvalGates: "None — the brief is a push. Referenced actions carry their own gates.",
    escalation:
      "If citation firewall fails on every recommendation, ship without the recommendation block and log a `mayaActionLog` warning.",
    cronMessage:
      "Run morning brief: pull yesterday's metrics, draft brief with one cited insight + one action + pending approvals, write `dailyBriefs`, push to primary channel. Stay under 200 words.",
  },
  {
    id: "evening_recap",
    title: "Evening signal check (silent unless something real surfaced)",
    tier: "all",
    kind: "cron",
    cronEntryId: "evening_recap",
    // Sprint 11 (2026-05-08) — operator-locked rewrite. Was 7:00pm fixed
    // recap; now 6:00pm scan with conditional send. Creators don't operate
    // on a 9-5 timetable, and a "Today's recap" template at 7pm reads
    // corporate / out of voice / fills with filler when nothing happened.
    // Hard cutoff 8:00pm local — no sends after that under any condition;
    // the prompt enforces it because a 6pm cron tick can run long if the
    // gateway is queued. Idea-driven, not clock-driven.
    defaultCron: "0 18 * * *",
    session: "isolated",
    scope:
      "Signal-conditional, NOT clock-conditional. At 6:00pm local I scan; I do NOT send by default. Send only if AT LEAST ONE hit: (a) post crossed 1.5x or 0.5x trailing-30d median engagement (good or bad — both matter); (b) high-value brand email landed today (`brandDeals` row since 00:00 local, value ≥ floor or unknown-treated-as-above); (c) a `commitments` content commitment scheduled today was missed; (d) a `trendObservations` trend I flagged earlier today actually accelerated (delta ≥1.5x vs morning capture); (e) tomorrow has a `calendarEvents` event needing ≥1 prep beat (filming, brand call, podcast, livestream). None hit → stay silent. No filler, no \"nothing to report today\". Silence is the right answer most days. **Hard cutoff: never send after 8:00pm local under any condition** — if the tick lands after 8pm (queue lag, restart), abort even if a signal hit. Voice = friend who watched the day, NOT corporate end-of-day report. Cite specifically: post id + % vs median, brand name, commitment text, trend handle/URL, event title. Banned phrases: \"Today's recap\", \"End-of-day summary\", \"Quick update on your day\", \"Daily wrap\", \"Here's what happened today\" — corporate-bot tells. Lead with the thing: \"Your morning post is at 12K, that's 2.3x your median for that format.\" / \"A brand email from [name] hit — draft tonight or fold into tomorrow's brief?\" Write `dailyBriefs` kind='evening_recap' ONLY when a send goes out. Silent days = no row. Absence is the data.",
    triggers: "Cron `evening_recap` 6:00pm local. Send is conditional on at least one signal crossing the threshold; silence is fine. Hard 8:00pm cutoff under all conditions.",
    approvalGates: "None when silent. None when sending — informational push.",
    escalation:
      "If under-performance was diagnosed earlier today, route through `maya-underperformance-diagnoser` first and fold its output into the send (don't ping twice). If `claw-messenger.sendText` fails 5xx, log and stay silent — no retry, no apology message tomorrow morning. If the local hour at send time is ≥20 (8pm), abort and log a `mayaActionLog` row with reason='past-cutoff'.",
    cronMessage:
      "Run evening signal check (NOT a guaranteed send). (1) Silent unless one of {1.5x/0.5x outlier post vs 30d median, high-value brand email today, missed commitment today, trend accelerated since morning, tomorrow's calendar event needing prep} fires. (2) Never send after 8:00pm local — abort if local clock ≥20:00. (3) Voice = friend who watched the day; banned: \"Today's recap\" / \"End-of-day summary\" / \"Quick update\". Cite the signal (post id + % vs median, brand, commitment, trend, event). Silent days: no row, no send, no apology.",
  },
  {
    id: "weekly_review",
    title: "Weekly review",
    tier: "all",
    kind: "cron",
    cronEntryId: "weekly_review",
    defaultCron: "0 21 * * 0",
    session: "isolated",
    scope:
      "Synthesize the week: top posts cited, what worked, what didn't, hypothesis + experiment for next week. Write `weeklyReviews`; push 3-line summary.",
    triggers: "Cron `weekly_review` Sunday 9:00pm local.",
    approvalGates: "None — creator consumes; they don't approve.",
    escalation:
      "Pass aggressively through citation firewall — highest-stakes weekly output. Drop unsupported claims rather than ship them. Assistant tier receives a stripped-down low-thinking version.",
    cronMessage:
      "Run weekly review: synthesize 7 days — top posts, what worked, what didn't, one hypothesis + one experiment. Write `weeklyReviews`, push 3-line summary.",
  },
  {
    id: "weekly_content_plan",
    title: "Weekly content plan",
    tier: "all",
    kind: "cron",
    cronEntryId: "weekly_content_plan",
    defaultCron: "0 16 * * 0",
    session: "isolated",
    scope:
      "Generate 7-day per-platform plan via `maya-content-arc-planner`. Fold Manager calendar arcs. Write `contentPlans`; push 'review your Sunday plan'.",
    triggers: "Cron `weekly_content_plan` Sunday 4:00pm local.",
    approvalGates: "Creator approves each idea card in the Plan screen before it leaves draft. Maya never auto-publishes.",
    escalation:
      "Both tiers reach all 5 platforms; if maxHandles cap is hit. If `creatorPicture` missing, fall back to handles-only plan and surface the gap.",
    cronMessage:
      "Run weekly content plan: read 30d metrics + hookLibrary + trends + Manager calendar arcs, call `maya-content-arc-planner` per theme, write `contentPlans`, push review message.",
  },
  {
    id: "performance_check_2h",
    title: "2-hour performance check",
    tier: "all",
    // Sprint 3 Slice 1: moved from cron → heartbeat. The 2-hour cadence is
    // approximate; the heartbeat tick decides whether to surface anything.
    kind: "heartbeat",
    cronEntryId: "performance_check_2h",
    defaultCron: "0 8,10,12,14,16,18,20,22 * * *",
    session: "isolated",
    scope:
      "Pull metrics on today's posts; if >1.5× or <0.5× vs trailing baseline, write `posts.mayaAnnotation` and ping. Otherwise silent.",
    triggers: "Cron every 2h 8am-10pm local. Skip silently if no `posts.postedAt` in last 24h.",
    approvalGates: "None — read-only signal.",
    escalation:
      "If same post triggers underperformance flag twice in a row, route through `maya-underperformance-diagnoser` and fold into evening recap rather than messaging again.",
    cronMessage:
      "Run 2h performance check: compare today's posts to 30-post trailing baseline at matched time-window, ping only on >1.5× or <0.5× outliers, otherwise silent.",
  },
  {
    id: "daily_niche_scan",
    title: "Daily niche scan",
    tier: "all",
    // Sprint 3 Slice 1: moved from cron → heartbeat.
    kind: "heartbeat",
    cronEntryId: "daily_niche_scan",
    defaultCron: "0 18 * * *",
    session: "isolated",
    scope:
      "ScrapeCreators trending search across creator's niche + same-bracket peers. Write `trendObservations`; surface top 3 to Trends.",
    triggers: "Cron `daily_niche_scan` 6:00pm local.",
    approvalGates: "None — Trends is a read surface.",
    escalation:
      "No primary-channel push unless trend is exceptionally high-fit. Fit beats novelty.",
    cronMessage:
      "Run daily niche scan: ScrapeCreators trending across niche + same-bracket peers, write `trendObservations`, surface top 3 to Trends.",
  },
  {
    id: "trend_watcher",
    title: "Trend watcher",
    tier: "all",
    // Sprint 3 Slice 1: moved from cron → heartbeat.
    kind: "heartbeat",
    cronEntryId: "trend_watcher",
    defaultCron: "5 9 * * *",
    session: "isolated",
    scope:
      "Watch broader cross-niche trends (hashtags, sounds, formats). Write `trendObservations` with source='platform-wide'.",
    triggers: "Cron `trend_watcher` 9:05am local. Offset 5min from competitor watch to spread load.",
    approvalGates: "None.",
    escalation:
      "If a fast-rising trend fits voiceFingerprint, batch into tomorrow's morning brief; never push as its own message.",
    cronMessage:
      "Run trend watcher: pull trending across creator's primary platform, write `trendObservations` with source='platform-wide'. Batch into next brief if high-fit.",
  },
  {
    id: "comment_triage",
    title: "Comment triage",
    tier: "all",
    // Sprint 3 Slice 1: moved from cron → heartbeat.
    kind: "heartbeat",
    cronEntryId: "comment_triage",
    defaultCron: "0 11,17 * * *",
    session: "isolated",
    scope:
      "Pull comments on last 5 posts; classify (question/compliment/troll/business-inquiry/friend); write `commentTriage`. Flag unanswered questions in next brief or recap.",
    triggers: "Cron `comment_triage` 11am and 5pm local.",
    approvalGates: "Maya never replies to comments — creator owns those relationships.",
    escalation:
      "A `business-inquiry` matching brand-DM heuristics gets routed into deal-triage only if creator opted in.",
    cronMessage:
      "Run comment triage: pull comments on last 5 posts, classify, write `commentTriage`, flag unanswered questions or business inquiries.",
  },
  {
    id: "accountability_nudge",
    title: "Accountability nudge",
    tier: "all",
    kind: "cron",
    cronEntryId: "accountability_nudge",
    defaultCron: "0 10 * * *",
    session: "main",
    scope:
      "If `commitments` row from prior 24h has status='committed' and no follow-through, send one tone-adjusted nudge. Never nag the same commitment twice without a new angle.",
    triggers: "Cron `accountability_nudge` 10:00am local. Conditional — silent no-op if no past-due commitment.",
    approvalGates: "None — the nudge is the action.",
    escalation:
      "Zero retries. If first attempt fails, next morning brief absorbs it. Never ask 'did you do anything yesterday?' — that is interrogation.",
    cronMessage:
      "Check `checkIns` for status='committed' in last 24h with no follow-through; if found and not already nudged, send one tone-adjusted nudge per soul.md toneSlider. Zero retries.",
  },
  {
    id: "post_publish_reaction",
    title: "Post-publish reaction",
    tier: "all",
    kind: "event",
    scope:
      "On a new post, run `maya-hook-extractor` (multimodal both tiers), write `posts.mayaAnnotation`, append novel patterns to `hookLibrary`, ping with one-sentence hook read + one suggestion.",
    triggers: "Event: ScrapeCreators delta. Latency cap by tier (Assistant 600s, Manager 300s).",
    approvalGates: "None — first-impression read is a push.",
    escalation:
      "If platform-fetch fails twice, drop to caption-only rather than skip. Hold judgment for the 2h check — early metrics are noise.",
  },
  {
    id: "brand_email_triage",
    title: "Brand email triage",
    tier: "manager",
    kind: "event",
    scope:
      "Triage inbound brand email via `maya-brand-deal-triager`: classify, extract offer, run `maya-rate-calculator`, draft 4 reply variants tuned to floor rate. Write `brandDeals`; ping with summary.",
    triggers: "Event: Composio Gmail webhook delivers an inbound thread classified as brand-deal.",
    approvalGates:
      "Creator picks variant before send. Auto-send only when `autoSendThreshold` is set AND deal value falls under it AND citation firewall + voice applier both pass.",
    escalation:
      "If Gmail OAuth revokes mid-task, poll once per 15min for up to 2h, then surface reconnect prompt on Today (the one non-silent connection alert). Treat unknown deal value as above-threshold.",
  },
  {
    id: "contract_redflag_scan",
    title: "Contract red-flag scan",
    tier: "all",
    kind: "event",
    scope:
      "Parse contract via `pdf` skill, run `maya-contract-redflag` across exclusivity, IP, payment terms, kill fees, term length, FTC compliance. Write `dealContracts`; push summary.",
    triggers: "Event: PDF uploaded to Deals or attached in chat.",
    approvalGates:
      "None — report is a flag, not legal advice. Always end with 'this is a flag, not legal advice — get a lawyer if anything feels off.'",
    escalation:
      "On parse failure, surface plainly: 'I couldn't parse this — might be a scan PDF.' Never guess at unparsed clauses. Never call a clause 'fine' — only 'no flag detected here.'",
  },
  {
    id: "rate_suggestion",
    title: "Rate suggestion",
    tier: "all",
    kind: "on-demand",
    scope:
      "Run `maya-rate-calculator` against follower count + niche + deliverables + prior deals + soul floor. Return rate range (low/target/stretch) with cited reasoning + 3-5 comparables if available.",
    triggers: "On-demand: chat ('what should I charge for X?') or auto-folded inside `brand_email_triage`.",
    approvalGates: "None — informational; creator decides what to charge.",
    escalation:
      "If calculator returns low confidence, say so plainly and recommend a human gut-check. Never invent comparables — cite or omit.",
  },
  {
    id: "hook_library_build",
    title: "Hook library auto-build",
    tier: "manager",
    kind: "event",
    scope:
      "On an outlier post (>2× baseline), run `maya-hook-extractor`; append to `hookLibrary` with citation + repeat-it suggestion.",
    triggers:
      "Event: 2h check identifies outlier. Wait 6h after `posts.postedAt` for engagement to settle.",
    approvalGates: "None — internal record, not creator-facing.",
    escalation:
      "Surface novel patterns in next morning brief; not a separate message. Flash-in-the-pan posts that flatten by hour 6 do not enter the library.",
  },
  {
    id: "competitor_watch",
    title: "Competitor watch",
    tier: "all",
    // Sprint 3 Slice 1: moved from cron → heartbeat.
    kind: "heartbeat",
    cronEntryId: "competitor_watch",
    defaultCron: "0 9 * * *",
    session: "isolated",
    scope:
      "Pull each named peer's last 24h posts + metric deltas; write `competitorObservations`; surface to Trends.",
    triggers:
      "Cron 9:00am local. Conditional — silent no-op if `creators.namedPeers` empty. Assistant caps at 5 peers; Manager at 10.",
    approvalGates: "None — read surface.",
    escalation: "Do not editorialize about whether to copy a peer's move. Cite the post; the creator decides.",
    cronMessage:
      "Run competitor watch: pull last 24h posts + deltas for each named peer (Assistant: 5, Manager: 10), write `competitorObservations`, surface to Trends.",
  },
  {
    id: "calendar_lookahead",
    title: "Calendar-aware content planning",
    tier: "all",
    // Sprint 3 Slice 1: moved from cron → heartbeat.
    kind: "heartbeat",
    cronEntryId: "calendar_lookahead",
    defaultCron: "0 8 * * *",
    session: "isolated",
    scope:
      "Composio Calendar pull for events 1-14d out. Run `maya-calendar-classifier` per event; for relevant events run `maya-content-arc-planner` for build-up / day-of / morning-after / evergreen variants.",
    triggers: "Cron 8:00am local. Conditional — silent no-op if Calendar not connected.",
    approvalGates: "Creator confirms 'plan around this' before locking the arc.",
    escalation:
      "Privacy: drop private events from cache 24h after they pass; never read attendee identities. If creator says 'don't plan around this,' remember per-creator.",
    cronMessage:
      "Run calendar lookahead: pull events 1-14d out, classify via `maya-calendar-classifier`, propose content-arc variants for relevant events. Wait for creator confirmation.",
  },
  // Sprint 3 Slice 1: deleted manager_readiness_packet_quarterly for MVP.
  {
    id: "revenue_snapshot",
    title: "Revenue snapshot",
    tier: "all",
    kind: "cron",
    cronEntryId: "revenue_snapshot",
    defaultCron: "0 9 * * 1",
    session: "isolated",
    scope:
      "Composio Stripe pull for prior week + MTD; cross-reference `brandDeals` with status='paid'. Write `revenueSnapshots`; push one-liner.",
    triggers:
      "Cron Monday 9:00am local. Conditional — silent no-op if Stripe not connected. No recurring 'connect Stripe' nag.",
    approvalGates: "None — informational.",
    escalation:
      "If revenue is materially up or down vs trailing 4-week average, name it. No commentary on whether numbers are 'good.'",
    cronMessage:
      "Run revenue snapshot: Stripe pull prior week + MTD, cross-reference brandDeals paid, write `revenueSnapshots`, push one-liner with cited deal IDs.",
  },
  {
    id: "industry_intel_daily",
    title: "Industry intel",
    tier: "all",
    // Sprint 3 Slice 1: moved from cron → heartbeat.
    kind: "heartbeat",
    cronEntryId: "industry_intel_daily",
    defaultCron: "30 7 * * *",
    session: "isolated",
    scope:
      "Call `maya-industry-intel` (creator niche + platforms). Dedupe via `industryIntelSeen`. Inline relevance≥0.7 items into morning brief with cited URL.",
    triggers: "Cron 7:30am local — folds into morning brief.",
    approvalGates: "None.",
    escalation: "If no items above threshold, no inline; never pad the brief with low-relevance items.",
    cronMessage:
      "Run industry intel: call `maya-industry-intel` with creator's niche+platforms, dedupe, inline items with relevance>=0.7 into morning brief.",
  },
  // Sprint 3 Slice 1: deleted algo_research_{tiktok,instagram,youtube,linkedin,x}
  // for MVP. Platform algorithm research returns post-MVP if needed.
  {
    id: "growth_coach",
    title: "Growth coaching",
    tier: "manager",
    kind: "folded",
    scope:
      "Call `maya-growth-coach` (creatorPicture + last-30-post metrics + soul goals + optional currentStruggle). Output prioritized moves with cited evidence + anti-patterns.",
    triggers: "Folded into morning brief daily; on-demand from chat.",
    approvalGates: "None — coaching is suggestion.",
    escalation:
      "Strict citation discipline. Never invent expectedOutcome — be explicit about uncertainty. Manager only; Assistant tier gets lighter coaching in evening recap.",
  },
  {
    id: "cross_post_distribution",
    title: "Cross-platform content distribution",
    tier: "all",
    kind: "on-demand",
    scope:
      "Call `maya-content-cross-poster` for per-platform variants — TikTok 9:16 ≤60s, IG 9:16 Reel/4:5 carousel, YT 9:16 Short/16:9 long, LinkedIn native video/text+thread, X 3-5 tweet thread. Each variant: voice-applied caption, duration cut, aspect ratio, hashtags, posting time, optional one-tap deep link.",
    triggers: "On-demand: creator approves a piece, OR auto-folded into weekly content plan.",
    approvalGates: "Maya never auto-publishes. Variants are prepared for the creator to publish.",
    escalation:
      "Both tiers reach all 5 platforms. If deep-link scheme unavailable, fall back to 'open composer with caption pre-filled.'",
  },
  {
    id: "underperformance_diagnosis",
    title: "Underperformance diagnosis",
    tier: "all",
    kind: "folded",
    scope:
      "Call `maya-underperformance-diagnoser` on a bombed post. Diagnose hook drift, off-peak posting, format mismatch, topic fatigue, audience drift, or recent algo cooling. Persist to `postPostmortems`.",
    triggers: "Folded into evening recap when posts underperformed; on-demand from chat ('why did [post] flop?').",
    approvalGates: "None — diagnosis is informational.",
    escalation:
      "Manager benefits from richer hook-pattern data in `posts.mayaAnnotation`; Assistant tier falls back to first-line-of-caption as opener proxy.",
  },
  {
    id: "pre_post_review",
    title: "Pre-post review",
    tier: "all",
    kind: "on-demand",
    scope:
      "Call `maya-pre-post-scorer` on a draft (caption + hookCandidate + format + platform + posting time + optional media). Return predicted-tier + signal breakdown + prioritized recommendations + goNoGo verdict.",
    triggers: "Event: 'Maya score this' in chat OR future `/draft` route. Wrapper at `convex/prePostReview.ts:scoreDraft`.",
    approvalGates: "None — scoring is a read; creator decides whether to post. Honesty over flattery.",
    escalation: "Read-only — does NOT persist. Recommendations failing citation firewall are dropped.",
  },
  {
    id: "opportunity_scout_daily",
    title: "Opportunity scout",
    tier: "all",
    // Sprint 3 Slice 1: moved from cron → heartbeat.
    kind: "heartbeat",
    cronEntryId: "opportunity_scout_daily",
    defaultCron: "0 6 * * *",
    session: "isolated",
    scope:
      "Call `maya-opportunity-scout`: scan UGC marketplaces + X creator-call hashtags + local-brand Brave search per niche/location. Dedupe via `opportunityScoutSeen`. Surface top 3 to morning brief; full list to Today.",
    triggers: "Cron 6:00am local — runs before morning brief so the top-3 fold in. Manager also permits on-demand from chat.",
    approvalGates: "None on the scan. Creator marks 'pursue' before it flows to `pitch_strategy` + `brand_outreach`.",
    escalation: "Manager unlocks larger `maxResults` + Apollo/Hunter discovery on confirmed opportunities; Assistant tier stops at 'creator decides'.",
    cronMessage:
      "Run opportunity scout: scan UGC marketplaces + creator-call hashtags + local brands per niche/location, dedupe, surface top 3 to brief + full list to Today.",
  },
  {
    id: "collab_matchmaker_weekly",
    title: "Collab matchmaker",
    tier: "all",
    // Sprint 3 Slice 1: moved from cron → heartbeat.
    kind: "heartbeat",
    cronEntryId: "collab_matchmaker_weekly",
    defaultCron: "0 17 * * 0",
    session: "isolated",
    scope:
      "Call `maya-collab-matchmaker`: expand `soul.md` namedPeers via ScrapeCreators creator-search, score audience overlap, propose per-match format + first-message DM via `maya-voice-applier`. Exclude direct competitors (overlap > 0.85) + recent same-format collabs.",
    triggers: "Cron Sunday 5:00pm local — pairs with weekly content plan + review. On-demand from chat.",
    approvalGates: "Maya never DMs. Surfaced as tap-to-DM cards on Today.",
    escalation: "Manager unlocks larger `maxMatches` + richer overlap scoring. Writes `collabMatchLog` with `creatorActedOn=pending`.",
    cronMessage:
      "Run weekly collab matchmaker: expand namedPeers + niche-search, score overlap, propose format + first-message DM per match.",
  },
  {
    id: "monetization_diversifier",
    title: "Monetization diversifier",
    tier: "all",
    kind: "folded",
    scope:
      "Call `maya-monetization-diversifier`: per-niche playbook of stream proposals (affiliate / merch / courses / subs / ad-rev / email-list / live-events / consulting). Fold into morning brief on milestone hits (10K/50K/100K/500K); into evening recap on `revenue-flat-90d`.",
    triggers: "Three triggers — milestone events, revenue-flat-90d, on-demand chat. No standalone cron.",
    approvalGates: "None — advisory.",
    escalation: "Manager pulls cross-creator anchors when peer benchmarks opt-in. Email-list recommendation is universal across niches.",
  },
  {
    id: "pitch_strategy",
    title: "Pitch strategy",
    tier: "manager",
    kind: "folded",
    scope:
      "Call `maya-pitch-strategy`: free / gifted / paid / decline decision + suggested rate. Pure-logic engine on creator size + revenue + prior deals. Feeds `brand_outreach` and `maya-rate-calculator`.",
    triggers: "Folded BEFORE every outbound pitch and BEFORE replying to inbound emails with no proposed dollars.",
    approvalGates: "None on the decision. Downstream `brand_outreach` enforces the creator-approval gate.",
    escalation: "Manager-only — Assistant tier skips entirely (Assistant's pitch path stops at 'consider these brands').",
  },
  {
    id: "brand_outreach",
    title: "Brand outreach",
    tier: "manager",
    kind: "event",
    scope:
      "Call `maya-brand-outreach`: compose cold-pitch subject + body + follow-up cadence (gentle/firm/final) tuned to creator voice + pitch angle (partnership/gifted/paid-content/ambassador/event-coverage). Pre-pitch `maya-pitch-strategy` set angle + rate. Always firewalled + voice-applied.",
    triggers: "Event — creator-confirmed opportunity from `opportunity_scout_daily`, or creator manually adds a brand.",
    approvalGates: "Creator-approved by default. Auto-send only when `autoSendThreshold` set + ask under threshold + firewall pass. Manager unlocks Apollo/Hunter discovery via `brandContactDiscoveryEnabled`.",
    escalation: "Manager-only — Assistant tier never composes cold outbound. Gmail revoke → 15-min-poll-for-2h fallback like `brand_email_triage`.",
  },
  {
    id: "wiki_mirror_sync",
    title: "Wiki → Convex projection mirror sync",
    tier: "all",
    kind: "folded",
    scope:
      "Sprint 8.5: scan the memory-wiki (`wiki_search` for entries written since last mirror tick) for new trend observations, competitor observations, and weekly learnings. Batch into one POST to `lc_maya.sync_wiki_observations` (idempotent on `(creatorId, wikiVaultPath)`). The endpoint dedupes — same wiki entry never round-trips into a duplicate row. Cap one tick at 200 rows; if more, drop oldest (the wiki is the source of truth, the projection is for HQ reactivity).",
    triggers:
      "Folded into the heartbeat (cadence: every 6h). Silent no-op when nothing new in the wiki. Never fires more than once per 6h per creator — the heartbeat tick decision function enforces the cooldown.",
    approvalGates: "None — projection writes only; the wiki itself was already the source of truth.",
    escalation:
      "On 5xx from the sync endpoint, retry on the next heartbeat (zero per-tick retry; backoff is 'wait 6h'). On 4xx (validator reject), log the offending row to `mayaActionLog` with detail and skip. Never block heartbeat completion on this entry.",
  },
];

/**
 * Returns standing orders enabled for the given plan tier.
 * Coach excludes "manager" entries; Manager includes all.
 */
export function standingOrdersForPlan(plan: Plan): ReadonlyArray<StandingOrderProgram> {
  if (plan === "coach") {
    return STANDING_ORDERS.filter((p) => p.tier !== "manager");
  }
  return STANDING_ORDERS;
}
