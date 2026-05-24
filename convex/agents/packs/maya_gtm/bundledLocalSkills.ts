/**
 * AUTO-GENERATED. DO NOT EDIT BY HAND.
 *
 * Run `npm run sync:bundled-local-skills` to regenerate from
 * `agents/skills/maya-gtm/<slug>/SKILL.md`.
 *
 * Sprint 17 part B — Maya GTM's 17 locally-authored skill bodies.
 * Every workspace bundle ships these so Maya has real per-skill SOPs
 * (vs the 7-line stubs the generator used to emit).
 */

export interface BundledLocalSkill {
  slug: string;
  /** Workspace-relative path the SKILL.md lands at. */
  workspacePath: string;
  body: string;
}

// Source: agents/skills/maya-gtm/maya-app-inspector/SKILL.md
const ENTRY_0_maya_app_inspector = `---
name: maya-app-inspector
description: Inspect a product URL + walkthrough and emit a structured ProductDiagnosis (promise, target action, activation moment, showable demo beats).
---

# maya-app-inspector

## Purpose

Before any channel decision, ICP hypothesis, or draft, Maya needs to know what the product actually does — in the operator's terms, not marketing copy. This skill converts a URL (and optional walkthrough video / screenshots) into a \`ProductDiagnosis\` other skills consume. Without a clean diagnosis, every downstream subagent guesses.

## When to invoke

- IF a new GTM job starts AND \`productDiagnosis\` is null in MEMORY THEN run this first.
- IF the operator says "actually it does X" and APP.md disagrees THEN re-run to update the diagnosis.
- IF the app URL changes (new landing, repositioning) THEN re-run.
- IF a downstream skill (channel-judge, slop-critic, viral-demo-miner) reports \`failure_reason: "diagnosis_too_thin"\` THEN re-run with deeper walkthrough request.
- NEVER invoke from heartbeat. App inspection is a research-job action; it spends budget.

## Required inputs

- \`app.url\` — public landing or product URL.
- \`app.name\` — verbatim string the operator uses.
- \`app.stage\` — \`pre-launch | soft-launched | shipped | post-FMF\`.
- Optional: \`walkthroughVideoUrl\` (R2/Drive), 1-5 \`screenshotUrls\`, free-text founder description.
- \`operatorIntent\` — one-line statement the operator already gave (verbatim, do not normalize).

## Required reads

1. \`APP.md\` in the workspace (current snapshot — your diagnosis may overwrite it).
2. \`PLAYBOOK.md\` § 1.2 (positioning sentence: "buyer + outcome in one sentence with a named verb").
3. \`PLAYBOOK.md\` § 5 Failure Mode 4 (the "feature launch" — describing the product as features instead of an outcome).
4. \`MEMORY.md\` for prior diagnoses if this is a re-run.

## Decision rules

1. **Rule 9.2 enforcement.** IF you cannot produce \`oneSentencePromise = "<product> helps <named buyer> <named verb-outcome>"\` from the evidence THEN return \`status: "needs_walkthrough"\` and a 3-question intake. Do not fabricate a buyer. PLAYBOOK rule 9.2.
2. **Rule 9.1 grounding.** IF the operator's stated intent is "I want to go viral" / "make me famous" THEN ignore that input for the diagnosis (it is not a product fact) and note it in \`operatorAmbiguities\`. Rule 9.1.
3. **Showability gate.** IF you cannot identify a \`showableDemoBeat\` (a UI moment ≤10s, a before/after, or a tangible output) THEN mark \`showability: "unshowable"\`. This is decision-grade input for \`maya-tiktok-demo-strategist\`.
4. **Feature-vs-outcome scan.** IF the product description leads with feature names ("webhook router", "AI agent platform") instead of a user outcome THEN populate \`featureLanguageRisk: true\`. Failure Mode 4. Pass this to slop-critic so it knows to rewrite operator drafts that mirror it.
5. **Activation moment required.** Every diagnosis must name the **single user action that produces the "aha" moment** (Cal AI: point camera at food). IF you cannot name it THEN return \`status: "needs_walkthrough"\`.
6. **Audience-not-buyer trap.** "Devs", "creators", "builders" are NOT buyers — they are audiences. The buyer is the specific person with the specific pain. IF the diagnosis only names an audience THEN flag \`buyerSpecificityWeak: true\` so \`maya-icp-hypothesis\` runs deeper.
7. **Stage-gates downstream.** IF \`app.stage === "pre-launch"\` AND the landing page is a waitlist with no live product THEN add \`redditSubReco: "r/AlphaAndBetaUsers"\` (reddit.md rule 9 — r/SideProject requires live URL).
8. **No invented numbers.** Never write metrics into the diagnosis (signups, MRR, DAU) unless they appear verbatim on the landing page or operator transcript. Rule 9.10 / citation-firewall.
9. **One sentence per field.** Verbose diagnoses signal that you didn't understand the product. Target: every field ≤ 25 words. If you can't, the product is unclear and the diagnosis is \`status: "needs_walkthrough"\`.
10. **No anti-slop wrapping yet.** This skill emits structured data, not draft prose, so the slop-critic is not invoked. The diagnosis is read by humans + skills only.

## Output schema

\`\`\`ts
interface ProductDiagnosis {
  status: "ok" | "needs_walkthrough" | "blocked";
  oneSentencePromise: string;          // "<product> helps <buyer> <verb-outcome>"
  targetAction: string;                 // the single user action that triggers value
  activationMoment: string;             // the "aha" — what the user sees / feels
  showability: "screen-recordable" | "screenshot-only" | "unshowable";
  showableDemoBeats: string[];          // 1-5 specific moments ≤10s each
  buyerHypotheses: string[];            // 2-4 candidate buyers (raw; icp-hypothesis sharpens)
  buyerSpecificityWeak: boolean;
  featureLanguageRisk: boolean;
  competitorMentions: string[];         // names found on landing or in walkthrough
  pricingSignals: string | null;        // verbatim or null
  unansweredQuestions: string[];        // ask-the-operator queue
  evidence: Array<{ source: "landing" | "walkthrough" | "operator"; url?: string; excerpt: string }>;
  redditSubReco?: string;               // optional fast-route hint
  operatorAmbiguities: string[];
}
\`\`\`

## Failure modes

- **\`needs_walkthrough\`** — landing page is too thin (≤3 sentences of body copy, no demo, no screenshots). Return a 3-question intake: (a) what's the single thing a user does that makes them say "oh"; (b) what would you show a friend in 30 seconds; (c) name one user (or imagined user) and what they were doing before they found you.
- **\`blocked\` — URL unreachable.** Don't guess from the name. Return the HTTP status and stop.
- **Operator-supplied marketing copy.** Treat their landing page as a primary source but their *pitch deck phrasing* as suspect. Strip "game-changing" / "supercharge" / "unlock" before quoting in \`evidence.excerpt\`.

## Cost discipline

- 0 ScrapeCreators calls. App inspection is operator-data + landing-page fetch only.
- 1 WebFetch on the landing URL. 1 more allowed for \`/about\` or \`/pricing\` IF the diagnosis needs it.
- 1 model call (main_maya, default thinking) to synthesize. Re-run only on \`needs_walkthrough\`.
- Hard cap: 12 minutes wall-clock. If you spend longer, the diagnosis is structurally unclear — stop and return \`needs_walkthrough\`.

## Anti-slop check

This skill produces structured data, not draft prose. Slop-critic is NOT invoked on the diagnosis output. However: when populating \`oneSentencePromise\`, do a single-pass slop scan against the PLAYBOOK.md § 6 banned-phrase list. If you find yourself writing "supercharge", "unlock", "empower", "leverage" — rewrite using the operator's own vocabulary. The diagnosis is the seed for every downstream draft; if it's slop here, it propagates.
`;

// Source: agents/skills/maya-gtm/maya-approval-publisher/SKILL.md
const ENTRY_1_maya_approval_publisher = `---
name: maya-approval-publisher
description: Handle approval → publish flow. Composio for LinkedIn/Reddit; manual handoff for TikTok / IG / X-without-API.
---

# maya-approval-publisher

## Purpose

The ONE place where Maya turns approved drafts into live posts. Enforces the approval gate, picks the right write-path (Composio for some platforms, manual handoff for others), refuses to publish when PLAYBOOK rules say not to.

## When to invoke

- IF a calendar event is at scheduled time AND \`approvalState === "APPROVED"\` THEN publish.
- IF operator explicitly says "post this now" AND draft is approved + slop-clean THEN publish.
- NEVER from heartbeat.
- NEVER for TikTok / IG Stories / X-without-API write — manual handoffs (tiktok.md § 12).

## Required reads

1. APP.md, GTM.md.
2. **PLAYBOOK.md § 6 (anti-slop last check), § 8 (when NOT to launch), § 9 (rules 9.5/9.6/9.7/9.9/9.22).**
3. playbook/{channel}.md.
4. MEMORY.md.

## Decision rules

1. **Pre-publish slop re-check.** Invoke \`maya-slop-critic\` ONE more time on final draft. Drafts can drift between approval and publish. Anything other than \`approved\` = refuse, move event to \`NEEDS REVISION\`.
2. **Phase-gate refusal.** IF \`channelStrategy.primaryPhase === "phase_1"\` AND draft is mode=OFFER THEN refuse (rule 9.5). Cold-start is BUILD + ENGAGE only.
3. **Audience-minimum refusal.** IF channel doesn't meet Phase 1 minimums THEN refuse with \`refusalReason: "rule_9.3"\`.
4. **Hard-launch precondition (rules 9.6/9.7/9.22).** Verify: 5-piece kit complete, first-50 DM list seeded, ≥1 unprompted testimonial. Any missing → refuse with \`pushBy7Days: true\`.
5. **Day-of-week refusal.** Mon/Fri/weekend + not explicit override → flag + require re-confirmation.
6. **Channel-write-path routing.**
   - **LinkedIn** → Composio publish (text + document + first-comment URL).
   - **Reddit** → Composio post + auto-post pre-drafted first comment within 60 sec.
   - **X** → write only if operator on Basic/PAYG/Pro tier AND opt-in; else manual handoff.
   - **TikTok** → ALWAYS manual handoff.
   - **Instagram Stories / Reels** → manual handoff.
   - **Gmail / Calendar** → Composio (operational, not social).
7. **URL-in-first-comment for strict subs.** r/Entrepreneur / r/startups / r/SaaS → URL in first comment.
8. **Cross-post block.** Identical text to >1 channel in <7 days → refuse. Each channel needs a rewrite.
9. **Operator-override documented.** In MEMORY.md with predicted failure mode.
10. **Post-publish state machine.** On success: write back to calendar event (approvalState = PUBLISHED), record \`publishedAt\` + live URL, register results-reviewer follow-up at T+2h, T+24h, T+7d.

## Output schema

\`\`\`ts
interface PublishResult {
  status: "published" | "manual_handoff_sent" | "refused" | "deferred";
  liveUrl?: string;
  channel: string;
  refusalReason?: string;
  manualHandoffPacket?: {
    deliveredTo: "imessage" | "whatsapp" | "sms" | "email";
    pasteableDraft: string;
    attachmentLinks: string[];
    postingInstructions: string[];
  };
  postPublishFollowups: Array<{ triggerAtUtc: string; skill: "maya-results-reviewer" }>;
  rulesCited: string[];
}
\`\`\`

## Failure modes

- **Composio token expired / OAuth disconnected.** \`refused\` + reconnect URL. Don't silently retry.
- **Platform-API write failure (e.g. LinkedIn 401, Reddit AutoMod removal).** Capture error code/body verbatim. Mark event \`NEEDS REVISION\`. No auto-retry without operator approval.
- **Slop-drift between approval and publish.** Refuse, return to slop-critic.
- **PLAYBOOK § 8 hard-refuse case detected late.** Refuse with rule 9.14.

## Cost discipline

Composio: 1-2 calls per publish. 0 ScrapeCreators. 1 main_maya (low thinking — orchestration). 1 slop-critic invocation. Timeout 5 min.

## Anti-slop check

INVOKES \`maya-slop-critic\` as final gate. \`postingInstructions\` strings in manual-handoff packets pass slop-critic too: write "post at 9am Tue, first comment URL", not "Excited to schedule your launch! 🚀".
`;

// Source: agents/skills/maya-gtm/maya-calendar-plan-builder/SKILL.md
const ENTRY_2_maya_calendar_plan_builder = `---
name: maya-calendar-plan-builder
description: Convert approved drafts into rich Google Calendar events. Each event carries platform / script / hook / source links / assets / approval state / success metric.
---

# maya-calendar-plan-builder

## Purpose

Drafts aren't useful until they're scheduled with full context the operator can act on at posting time. Takes approved drafts + channel strategy + distribution motion plan and builds rich Google Calendar events (Sprint 9 calendar OAuth).

## When to invoke

- IF \`distributionExperimentSet\` is approved AND drafts have passed slop-critic THEN schedule.
- IF a post is replanned THEN re-run to update.
- IF a hard launch is scheduled (PLAYBOOK § 2 Phase 3) THEN build the full launch-day event sequence.
- IF results-reviewer recommends "double down on metric posts" THEN extend cadence.
- **Sprint 1.2 — IF a platform skill (maya-tiktok-demo-strategist § rule 3, maya-reddit-demand-researcher § rule 1, maya-x-founder-led-researcher) returns \`recommendation: "warmup_first"\` with a \`warmupPlan\`, THEN immediately schedule each \`dayBands[].actions\` as \`kind: "warmup_block"\` events on the operator's calendar.** Warmup blocks are self-driven operator tasks (not posts) — they are approval-by-default. Do NOT wait for slop-critic, drafts, or distribution-experiment approval. The operator needs these on their calendar today, not at the end of a multi-step approval loop.
- NEVER auto-publish — events are scheduling. Publishing is \`maya-approval-publisher\`.

## Required reads

1. APP.md, GTM.md.
2. PLAYBOOK.md § 2 (Phase 2/3 timing — Tuesday default, rule 9.17), § 4.
3. playbook/{channel}.md for channel-specific timing.
4. MEMORY.md.

## Decision rules

1. **Day-of-week enforcement (rule 9.17).** No Mon/Fri/weekend launch posts. Hard-launch default Tuesday; Phase 2 default Tue/Wed/Thu.
2. **Holiday / industry-event check.** Verify before scheduling (rule 2.3.1).
3. **Channel-specific time windows.**
   - X: Tue morning operator-tz, 8-10am.
   - LinkedIn: Tue-Thu 8-10am operator-tz.
   - Reddit: Tue/Wed/Thu 8-11am ET.
   - TikTok: niche-FYP-time from TikTokFormatResearch; default 6-9pm operator-tz B2C, 12-2pm B2B.
4. **2-hour engagement window required (Reddit).** Operator available 2h after posting. If booked, push.
5. **Pre-write first comment for Reddit posts.** Always attached.
6. **One CTA per event.**
7. **All assets attached / linked.** Screenshots, demo videos, alt-text. R2 URL or Drive link.
8. **Approval-state visible.** Title prefix: \`[DRAFT]\` / \`[APPROVED]\` / \`[PUBLISHED]\` / \`[NEEDS REVISION]\`.
9. **Success metric in event description.** Copy-paste from distribution-motion-tester.
10. **Stop / double-down trigger noted.**
11. **Native reminders.** 30 min before (push), 24h before (email).
12. **Sidecar gtmCalendarEvents row.** Every calendar write also writes a sidecar (kind: "warmup_block" | "engagement_block" | "soft_launch_post" | "hard_launch_anchor" | "reply_window" | "weekly_review" | "first_50_dms") for HEARTBEAT calendar-scan check.
13. **Sprint 1.2 — warmup_block scheduling rules.** When converting a \`warmupPlan\` from a platform skill:
    - One event per \`dayBands\` entry (NOT per action — group actions into a single block).
    - **Default time**: 10:00am operator-local. Operator can move it; the point is the block is on the calendar.
    - **Duration**: 30 min default for ≤4 actions, 45 min for 5+ actions.
    - **Title format**: \`[Warmup] {Platform} Day N of M — {primary action}\`. Example: \`[Warmup] TikTok Day 1 of 14 — Scroll 20 min niche FYP\`.
    - **Description**: full action list as a checklist + cite the playbook rule (\`tiktok.md § 6\` / \`reddit.md § 6\`). Example: \`Per tiktok.md § 6 (account warm-up doctrine). Today: ☐ Scroll 20 min niche FYP at slow-thumb pace ☐ Like 10 niche posts ☐ Comment on 3 posts with substance ☐ Save 5 posts you'd actually use. Why: brand-new accounts that post commercial content on day 1 get algorithmically suppressed (tiktok.md § 13 Failure 1).\`
    - **No slop-critic gate** — these are operator self-tasks, not public content.
    - **Reminders**: 30 min popup + 24h email (same as posts).
    - **Approval state**: \`APPROVED\` (warmup is the doctrine, not optional).

## Output schema

\`\`\`ts
interface CalendarPlan {
  events: Array<{
    googleEventId?: string;
    sidecarRowId?: string;
    kind: "warmup_block" | "engagement_block" | "soft_launch_post" | "hard_launch_anchor" | "reply_window" | "weekly_review" | "first_50_dms";
    channel: string;
    titleWithApprovalPrefix: string;
    startLocal: string;
    durationMin: number;
    description: string;
    attachments: Array<{ kind: "image" | "video" | "doc"; url: string }>;
    draftText: string;
    sourceLinks: string[];
    successMetric: string;
    stopOrDoubleDownTrigger: string;
    reminders: { popupMin: number; emailMin: number };
    approvalState: "DRAFT" | "APPROVED" | "PUBLISHED" | "NEEDS REVISION";
    mode: "BUILD" | "ENGAGE" | "OFFER";
  }>;
  weekSummary: string;
  conflicts: string[];
  rulesCited: string[];
}
\`\`\`

## Failure modes

- **OAuth not connected.** \`status: "oauth_required"\` with connect URL.
- **Draft hasn't passed slop-critic.** Refuse to schedule. Send back.
- **Calendar fully booked.** Propose next-best per channel rules.
- **Asset URL is local-path-only.** Refuse until upload complete (Sprint A.1 fix).

## Cost discipline

0 ScrapeCreators. Calendar API writes only. 0-1 main_maya. Heartbeat-safe (reads only). Timeout 5 min.

## Anti-slop check

Event titles and descriptions are operator-facing. Run \`maya-slop-critic\` on every \`titleWithApprovalPrefix\` and \`description\`. No "🚀 Launch Day — Crush It". Write like "Tue 9am: post X thread (5 tweets), pinned hook + Stripe screenshot attached, target 3% engagement, stop at <1%".
`;

// Source: agents/skills/maya-gtm/maya-calendar-populator/SKILL.md
const ENTRY_3_maya_calendar_populator = `---
name: maya-calendar-populator
description: After deep-research subagents land target threads + accounts + drafts, generate the next 14 days of calendar events on Google Calendar (provisional, status="draft") mapped to the operator's current phase of the PLAYBOOK 4-phase arc. Each event links to a target thread + draft + cites the playbook rule.
---

# maya-calendar-populator

## Purpose

The deep-research subagents (reddit_research, x_research, etc.) surface specific target threads + accounts + drafts. This skill turns those raw artifacts into a real **calendar** — 14 days of scheduled, time-blocked work the operator can actually do. Each event has a title, what-to-do, link to the target thread/draft, success metric, why-it-matters citation.

Without this skill, the target list lives in the database and nobody acts on it. With it, the operator opens Google Calendar and sees their week.

## When to invoke

- IF deep-research subagents have just completed AND \`/lc_gtm/get_my_target_threads\` returned >0 rows THEN run. This is the canonical first invocation, right at the end of FIRST WAKE.
- IF weekly review (\`gtm_weekly_review\` cron) ran AND new target threads were surfaced THEN refresh rolling next-14-days.
- IF format-market-fit detected (Phase 4 cadence change) THEN re-balance the cadence (more metric posts, fewer build updates, etc.).
- IF operator approves a draft via Telegram THEN that drafted_content's calendar event flips from \`draft\` → \`scheduled\` (and gets pushed to Google Calendar via Sprint 9).

## Required reads

1. **PLAYBOOK.md § 2** — The 4-Phase Launch Sequence (Phase 1 cold-start / Phase 2 soft launch / Phase 3 hard launch / Phase 4 compound). Determines the SHAPE of the 14 days.
2. **PLAYBOOK.md § 4** — BUILD / ENGAGE / OFFER triad ratios. Determines the MIX of event kinds per platform.
3. **APP.md + USER.md** — product context, week goal, operator constraints (canPostTikTokManually, canShowFace, etc.).
4. **GTM.md** — active channel picks. Only generates calendar events for primary + secondary channels.
5. **Per-platform playbook**: \`playbook/reddit.md\`, \`playbook/x.md\`, etc. for time-window + frequency rules per channel.
6. **Target list** via \`GET /lc_gtm/get_my_target_threads\` — the raw material. Top 30 by priorityScore.
7. **Optionally** \`GET /lc_gtm/get_my_target_accounts\` for follow-and-engage events.

## Decision rules

### 1. Phase detection — what week are we in?

Compute current phase from \`(now - creator.createdAt)\`:
- **Phase 1 (Day -30 to Day -1)**: account warmup + cold-start audience building. *If any active channel's Phase-1 minimum (PLAYBOOK § 2) is NOT met, stay in Phase 1 until it is.* Default 14-day plan is heavy on engagement_block + warmup_block; NO soft_launch_post events.
- **Phase 2 (Day 0 to Day 7)**: soft launch. 5-piece kit drafted, 1-2 soft_launch_post events scheduled for Tue/Wed/Thu mornings, the rest is reply_window + engagement_block.
- **Phase 3 (Day 7 to Day 14)**: hard launch. ONE Tuesday hard_launch_anchor + first_50_dms blocked the day before + reply_window events in the 2-hour engagement window after the anchor.
- **Phase 4 (Day 14+)**: weekly cadence per § 4 — 1 metric post + 2 build-update/insight + 1 demo + reply-mining 4-5 days/week.

### 2. Per-platform time windows (PLAYBOOK § 4.X channel rules)

- **Reddit**: Tue/Wed/Thu 8-11am ET for posts. Replies any weekday morning/afternoon. 2-hour engagement window MANDATORY after any post — block it explicitly. Personal-account-only; never auto-publish.
- **X / Twitter**: Tue morning operator-tz 8-10am for posts. Replies throughout the day (reply-mining is 4-5x leverage of posting).
- **LinkedIn**: Tue-Thu 8-10am operator-tz.
- **TikTok**: niche-FYP-time from format research; default 6-9pm operator-tz B2C, 12-2pm B2B. Posts ONLY scheduled if \`tiktokWarmupState === "ready"\` AND \`canPostTikTokManually === true\`.
- **Hacker News**: Tue-Thu 7am-10am PT for Show HN. Comments any weekday.
- **Instagram**: Tue-Thu late afternoon / evening for Reels. Stories any time.

### 3. Slot allocation — how many events per channel per week?

For PRIMARY channel:
- Phase 1: 4-5 reply_window events (15-30 min each), 1-2 engagement_block events (30-60 min lurking + saving posts), 0 posts.
- Phase 2: 3-4 reply_window, 1-2 soft_launch_post (drafted, status:draft until operator approves), 1-2 engagement_block.
- Phase 3: 1 hard_launch_anchor (Tuesday) + 2-3 reply_window in the engagement window + 1 first_50_dms (Monday).
- Phase 4: 1 metric_post + 2 build_or_insight_post + 1 demo_post + 4-5 reply_window/week + 1 weekly_review.

For SECONDARY channel: roughly half the cadence of primary. No hard_launch_anchor unless the secondary is X (where founder threads tied to the launch make sense).

### 4. Event linking

Every event MUST link to its source:
- reply_window events: \`targetThreadId\` references the gtmTargetThreads row.
- post events (soft_launch_post / hard_launch_anchor): \`draftedReplyId\` references the gtmDraftedContent row.
- warmup_block: cites the specific playbook section (tiktok.md § 6 / reddit.md § 6).
- engagement_block: cites the priority subreddit/community to lurk in (from gtmTargetSubreddits or per-channel playbook).

### 5. Status semantics

All events default to \`status: "draft"\`. They are visible to the operator but NOT yet on Google Calendar. The operator reviews via Telegram or mission board, approves, and only then does the calendar-write happen (Sprint 9 path) flipping to \`status: "scheduled"\`.

### 6. Voice contract (per SOUL.md)

Every event title + description is operator-facing. Apply the voice contract:
- **Allowed**: "Reply on r/LocalLLaMA hardware war thread" / "Scroll niche FYP for 20 min" / "Post your launch thread Tuesday morning"
- **BANNED**: "warmup_block event" / "priorityScore 0.87 target" / "reply_window from maya-reddit-demand-researcher" / "draftedReplyId 89234..." — these all leak internals to the operator.

The title is what the operator sees in their calendar app. Make it sound like a teammate's note, not a database row.

### 7. Holiday + industry-event check (PLAYBOOK § 2.3.1)

Maya checks before slotting hard_launch_anchor or soft_launch_post events. Skip US holidays, known industry events (re:Invent, WWDC, etc. if relevant to the niche), Black Friday week, end-of-year freeze.

### 8. Account warmup gating

If primary channel has unmet Phase-1 audience minimum (PLAYBOOK § 2):
- ALL post-kind events get pushed to Phase 1 schedule (no posts until warmup done)
- 14-day calendar is exclusively warmup_block + engagement_block + reply_window (replies allowed during warmup if they're substantive, not promotional)
- Maya signals to user: "We're in warmup. No public product mentions yet. Tomorrow's first task is X."

## Output

POST events one-at-a-time to \`/lc_gtm/calendar_proposal\` per the TOOLS.md spec. Each event must include:

\`\`\`ts
{
  idempotencyKey: string,            // hash of (kind + startsAtMs + targetThreadId)
  researchJobId: string,             // current job
  events: [{
    title: string,                   // operator-facing, voice-contract clean
    description: string,             // includes link to target URL + draft (if any) + playbook citation
    startsAtMs: number,
    endsAtMs: number,
    kind: "warmup_block" | "engagement_block" | "reply_window" | "soft_launch_post" | "hard_launch_anchor" | "first_50_dms" | "weekly_review",
  }],
}
\`\`\`

Default durations:
- reply_window: 20-30 min
- engagement_block: 30-60 min
- warmup_block: 20-30 min
- soft_launch_post: 30 min (post + immediate engagement)
- hard_launch_anchor: 2 hours (post + engagement window)
- first_50_dms: 60-90 min
- weekly_review: 30 min

## Failure modes

- **No target threads landed.** This skill is no-op. Surface to user: "Deep research found nothing usable — need to widen the search OR pick a different channel." Push retry to next research cycle.
- **Calendar OAuth not connected.** Events still get drafted (status:draft). Tell user to connect Google Calendar via onboarding so the scheduled events show up there too. The Telegram nudge cron still works without Google Calendar.
- **Phase 1 floor unmet on ALL channels.** Pure warmup mode for 14 days. Maya is explicit about this in the user message: "Your accounts need 2-4 weeks of warmup before launch. Here's the plan."
- **Operator overrides Phase 1 + insists on launching.** Document the override per AGENTS.md operating contract rule 1. Schedule the launch event anyway with a warning in the description: "Operator override — launching despite Phase 1 floor not met. Recover path: if engagement <1%, repositioning required."

## Cost discipline

0 ScrapeCreators. 0 paid external APIs. Pure synthesis of existing target list + playbook rules into calendar events. 1-2 main_maya LLM calls (no thinking budget needed; this is structured-output work). Timeout 5 min.

## Anti-slop check

Run maya-slop-critic on every event \`title\` and \`description\`. Banned phrases (PLAYBOOK § 6). Event titles must be operator-natural — not "engagement_block #4" or "Reply 1/15".
`;

// Source: agents/skills/maya-gtm/maya-channel-strategy-judge/SKILL.md
const ENTRY_4_maya_channel_strategy_judge = `---
name: maya-channel-strategy-judge
description: THE channel-judge subagent. Returns one primary, at most one secondary, and parked-with-reasons. Surfaces rule conflicts.
---

# maya-channel-strategy-judge

## Purpose

This is the load-bearing decision skill. Takes product diagnosis, ICPs, per-platform researcher reports, competitor data and decides where the operator will spend Phase 1-2 effort. The doctrine is the default: when evidence and PLAYBOOK rules conflict, the playbook wins unless the operator explicitly overrides — and Maya documents the override.

## When to invoke

- IF all upstream researchers have reported AND \`channelStrategy\` is null THEN run.
- IF the operator says "I want to switch channels" THEN re-run.
- IF results-reviewer flags skip-launch / void-launch / cringe-launch THEN re-run with the new diagnostic input.
- NEVER from heartbeat.

## Required reads

1. \`APP.md\`, \`GTM.md\`.
2. **PLAYBOOK.md — MANDATORY full read.** Especially § 3 (decision tree), § 5 (failure-mode pre-check), § 7 (affinity table), § 8 (no-social cases), § 9 (all 30 rules).
3. All four playbook/{reddit,x,linkedin,tiktok}.md files if relevant.
4. MEMORY.md.

## Decision rules

1. **Run the failure-mode pre-check first (PLAYBOOK § 5).** Is this product/operator at risk of void / skip / cringe / feature / post-and-pray? Surface in the verdict.
2. **PLAYBOOK § 3 channel tree runs before any affinity table.** First match wins.
3. **PLAYBOOK § 8 hard refuse cases.** Enterprise (>$25k ACV) / hardware / regulated / hyper-local / pre-PMF-thin → refuse social-channel launch. Route to outbound / SEO / partnerships per rule 9.14.
4. **Rule 9.4 single-platform focus.** Phase 1 has ONE primary channel. Multi-channel is for Phase 3 hard launch only.
5. **Rule 9.3 audience-minimum gate.** IF Phase 1 minimums unmet THEN recommendation = "warm 30 days OR pick second-best where they have baseline."
6. **Affinity-table cross-check (PLAYBOOK § 7).** After tree picks, verify the channel appears in the product-type row's Primary/Secondary column. If Parked, surface conflict.
7. **Per-platform rule fire.** Each per-platform researcher's verdict (linkedin.md LI-10.2 park, tiktok.md rule 4 park, reddit.md § 8.1 warmup) is BINDING unless operator overrides with documented reason.
8. **Operator preference is one input, not the answer.** Surface divergence in \`operatorPreferenceConflict\`.
9. **Output exactly one primary + at most one secondary.** Anything else gets parked with cited reasons.
10. **Cross-channel coherence.** The primary's BUILD/ENGAGE/OFFER ratio (PLAYBOOK § 4) must match operator's available time.
11. **Phase-aware verdict.** Tag Phase 1 / 2 / 3 / 4. PLAYBOOK § 2.
12. **14-day re-evaluation clause.** Every recommendation has a re-evaluation trigger (PLAYBOOK rule 9.8 / 9.29).

## Output schema

\`\`\`ts
interface ChannelStrategyVerdict {
  primaryChannel: "x" | "reddit" | "linkedin" | "tiktok" | "instagram" | "hn" | "ph" | "no_social";
  primaryRationale: string;
  primaryPhase: "phase_1" | "phase_2" | "phase_3" | "phase_4";
  primaryRoutine: { daily: string[]; weekly: string[]; buildEngageOfferRatio: string };
  secondaryChannel?: typeof primaryChannel;
  secondaryRationale?: string;
  parked: Array<{ channel: typeof primaryChannel; reason: string; revisitTrigger?: string }>;
  failureModeRisks: Array<{
    mode: "void" | "skip" | "cringe" | "feature" | "post_and_pray";
    severity: "low" | "medium" | "high";
    mitigation: string;
  }>;
  operatorPreferenceConflict?: { operatorWanted: string; judgeRecommended: string; resolution: string };
  audienceMinimumsCheck: { channel: string; minThreshold: string; operatorActual: string; passes: boolean };
  reEvaluationTriggers: string[];
  rulesCited: string[];
}
\`\`\`

## Failure modes

- **No researcher reports yet.** Return \`status: "researchers_must_run_first"\`.
- **All channels parked by their own researchers.** Recommendation: \`no_social_route_to_outbound_or_seo\` (PLAYBOOK § 8).
- **Operator override.** Document; predict likely outcome.
- **Two channels tie on score.** Tiebreaker: (1) operator baseline, (2) PLAYBOOK § 7 Primary column, (3) operator preference. Document tiebreak.

## Cost discipline

0 ScrapeCreators / 0 WebFetches / 1 main_maya synthesis call. Timeout: 10 min.

## Anti-slop check

\`primaryRationale\`, \`secondaryRationale\`, and \`failureModeRisks[].mitigation\` get surfaced to operator. Run \`maya-slop-critic\` (banned-phrase + structural scan) before returning. The verdict should sound like an opinion delivered by someone who's read the playbook — terse, cited, decisive.
`;

// Source: agents/skills/maya-gtm/maya-competitor-researcher/SKILL.md
const ENTRY_5_maya_competitor_researcher = `---
name: maya-competitor-researcher
description: Find substitutes + what their users complain about. Sources: Reddit, X, App Store, G2, LinkedIn comments.
---

# maya-competitor-researcher

## Purpose

The operator's competitors are also their best lead sources. Users complaining about competitor X are pre-qualified buyers for product Y. This skill maps the substitute landscape, mines complaint patterns, and feeds reply-target candidates back to platform-specific researchers.

## When to invoke

- IF \`productDiagnosis.competitorMentions[]\` is non-empty OR can be inferred THEN run.
- IF \`maya-icp-hypothesis\` flagged \`buyerSpecificityWeak: true\` THEN run.
- IF reddit / x researchers need "alternative to X" reply targets THEN this skill seeds them.
- NEVER from heartbeat.

## Required reads

1. APP.md, GTM.md.
2. PLAYBOOK.md § 3 (competitor's channel = operator's channel), § 7 affinity.
3. Relevant playbook/{platform}.md files.
4. MEMORY.md.

## Decision rules

1. **Substitute > direct-competitor.** What the operator's user does TODAY (workaround) is more important than named competitors. Mine for workaround patterns ("I just use spreadsheets", "I do it manually", "I pay Fiverr").
2. **Three substitute tiers.** Direct (named SaaS) / Adjacent (different shape, same job) / Status-quo (Excel, paper, manual, do-nothing).
3. **Pain mining must cite the user verbatim.** Every complaint card has \`userQuoteVerbatim\` + \`sourceUrl\`. No paraphrasing.
4. **"Alternative to {competitor}" is highest-intent search probe.** Always include for top 1-2 competitors.
5. **Channel-segmented mining.** Reddit (subreddit reviews + r/SaaSAlternatives), X (frustration tweets + reply mining), App Store reviews (mobile), G2/Capterra/Trustpilot (B2B), LinkedIn comments on competitor posts.
6. **3-complaint floor.** A competitor is only "actionable" with ≥3 distinct complaint patterns. Below that = brand-mention, not buyer signal.
7. **Pricing-complaint surfacing.** "Too expensive" is the #1 switcher signal. Tag pricing complaints separately.
8. **Don't name competitors in operator drafts.** reddit.md rule 8.18. Reply drafts say "the dominant tool in this space" or describe the category.
9. **Substitute → ICP feedback loop.** If substitute is "spreadsheets", ICP includes "currently using spreadsheets" — pass to icp-hypothesis.
10. **No fabricated complaints.** If search returns thin, \`confidence: "weak"\`. No training-data filling.

## Output schema

\`\`\`ts
interface CompetitorReport {
  substitutes: Array<{ name: string; tier: "direct_saas" | "adjacent_tool" | "status_quo_workaround"; pricingBand?: string; channelPresence: string[] }>;
  complaintPatterns: Array<{
    pattern: string;
    competitorName?: string;
    frequency: number;
    sampleCards: Array<{ sourceUrl: string; channel: "reddit" | "x" | "appstore" | "g2" | "linkedin" | "google_search"; userQuoteVerbatim: string; ageDays: number }>;
  }>;
  pricingComplaintCount: number;
  switcherSignals: Array<{ competitorName: string; queryProbe: string; threadsFound: number; samplePostUrls: string[] }>;
  workaroundsInUse: string[];
  recommendedReplyHandoffs: Array<{ channel: "reddit" | "x" | "linkedin"; threadUrl: string; handoffTo: string }>;
  icpRefinements: string[];
  confidence: "high" | "medium" | "weak";
}
\`\`\`

## Failure modes

- **No competitors named, no substitutes detectable.** Run Google probe \`"alternative to {productCategory}"\`. If still empty, \`categoryNoveltyHigh: true\` — recommend HN/Show HN positioning.
- **ScrapeCreators returns zero across all channels.** Try broader category terms.
- **All complaints are 2+ years old.** Don't recommend reply targets from stale threads.

## Cost discipline

Max 10 ScrapeCreators calls: 2-3 Google search probes, 2-3 Reddit subreddit searches, 2 X searches, 1-2 LinkedIn company-posts. 2-3 WebFetches. 1 hard_research_beta + 1 main_maya. Timeout 18 min.

## Anti-slop check

User-quotes-verbatim. Slop-critic NOT invoked on output. Pattern summary labels must be plain operator-language — not "value misalignment" / "ROI concerns" / corporate-speak.
`;

// Source: agents/skills/maya-gtm/maya-content-format-miner/SKILL.md
const ENTRY_6_maya_content_format_miner = `---
name: maya-content-format-miner
description: Extract reusable hook patterns, proof beats, CTA patterns from real competitor / niche content. Output is a remix kit for drafts.
---

# maya-content-format-miner

## Purpose

Don't write content from scratch. Mine what's already winning in the niche, extract the format skeleton, remix the operator's product into it (tiktok.md § 7 "format remix doctrine"). Emits hook templates + proof-beat structures + CTA patterns that downstream draft skills consume. NEVER ships final copy — that's the operator + slop-critic loop.

## When to invoke

- IF channel-strategy-judge has picked a primary channel THEN run to seed the draft library.
- IF results-reviewer detects a winning format AND recommends doubling down THEN re-run for more examples.
- IF a draft fails slop-critic 3x THEN re-run — operator's voice isn't matching the format used.
- NEVER from heartbeat.

## Required reads

1. APP.md, GTM.md.
2. PLAYBOOK.md § 4 (BUILD/ENGAGE/OFFER), § 6 (anti-slop — patterns that read AI get rejected on extraction).
3. playbook/{channel}.md hook catalogs (x.md § 5, tiktok.md § 2, reddit.md § 3, linkedin.md § 3).
4. MEMORY.md.

## Decision rules

1. **5-example floor per pattern.** A pattern enters the library only if ≥5 real examples confirm it.
2. **Verbatim hook capture.** Hooks recorded verbatim with source URL. No paraphrase, no "improved" version.
3. **Anti-slop on extraction.** Reject candidates that depend on banned phrases (PLAYBOOK § 6) or anti-pattern structures.
4. **Pattern-mode tagging.** Tag each: BUILD (post-shaped) / ENGAGE (reply-shaped) / OFFER (CTA-shaped).
5. **Channel-specific hook taxonomy.** Use the channel's own catalog (x.md § 5 1-15, tiktok.md § 2 a-j, reddit.md § 3, linkedin.md § 3).
6. **Proof beats separately from hooks.** A proof beat is a specific concrete claim ("$10K MRR in 3 weeks") — extract as substitution-slots.
7. **CTA taxonomy.** Catalog: search-by-name / pinned-URL-comment / DM-keyword / soft-DM / link-in-first-comment. Tag channel compatibility.
8. **Voice-fingerprint extraction.** Capture 1-2 sentence-length and rhythm characteristics per example.
9. **Mimicry risk flagging.** If >40% of niche winners from a single account, \`mimicryRisk: "high"\`.
10. **No final-copy generation.** Patterns + slots + examples, never final drafts.

## Output schema

\`\`\`ts
interface ContentFormatLibrary {
  channel: string;
  hookPatterns: Array<{
    patternId: string;
    name: string;
    catalogRef: string;
    mode: "BUILD" | "ENGAGE" | "OFFER";
    template: string;
    slots: string[];
    realExamples: Array<{ url: string; verbatim: string; metrics: { likes?: number; views?: number } }>;
    voiceFingerprint: string;
  }>;
  proofBeats: Array<{ beatId: string; template: string; slots: string[]; realExamples: Array<{ url: string; verbatim: string }> }>;
  ctaPatterns: Array<{
    ctaId: string;
    template: string;
    channelCompatibility: { x: boolean; reddit: boolean; tiktok: boolean; linkedin: boolean; instagram: boolean };
    bannedOn?: string[];
  }>;
  mimicryRisk: "low" | "medium" | "high";
  rulesCited: string[];
}
\`\`\`

## Failure modes

- **Fewer than 5 examples per pattern.** Drop. If <2 patterns reach the floor, \`confidence: "library_underweight"\` + request more pulls.
- **All examples from one creator.** \`mimicryRisk: "high"\`. Recommend operator build authority from scratch or pick a niche where format ownership is distributed.
- **Slop pattern detected.** Reject explicitly. Document in \`rejectedPatterns[]\`.

## Cost discipline

0 new ScrapeCreators (consumes upstream researcher outputs). 0 WebFetches. 1 main_maya synthesis. Timeout 10 min.

## Anti-slop check

Each \`template\` must pass \`maya-slop-critic\` on the template-skeleton itself. Real verbatim examples with banned phrases stay in \`realExamples\` (as evidence of what won) but DO NOT promote into templates.
`;

// Source: agents/skills/maya-gtm/maya-distribution-motion-tester/SKILL.md
const ENTRY_7_maya_distribution_motion_tester = `---
name: maya-distribution-motion-tester
description: Design first-week experiments per PLAYBOOK § 2 Phase 2 (5-piece soft-launch kit). Define stop/double-down metrics.
---

# maya-distribution-motion-tester

## Purpose

Soft launch is not 1 post — it's a 5-piece coordinated motion (PLAYBOOK § 2 Phase 2). This skill turns the channel-judge's verdict into concrete week-1 experiments with explicit stop / double-down thresholds.

## When to invoke

- IF \`channelStrategyVerdict.primaryPhase === "phase_2"\` AND no \`distributionExperiments\` THEN run.
- IF operator is moving from Phase 1 to Phase 2 (warmup done) THEN run.
- IF results-reviewer says "Week 1 experiments inconclusive" THEN re-run with sharper metrics.
- NEVER design Phase 3 hard launch from this skill alone.

## Required reads

1. APP.md, GTM.md.
2. **PLAYBOOK.md § 2 Phase 2 (5-piece kit), § 4, § 5 failure modes (especially Mode 5 post-and-pray).**
3. playbook/{primaryChannel}.md.
4. MEMORY.md.

## Decision rules

1. **All 5 pieces of soft-launch kit (PLAYBOOK § 2 Phase 2).** Thread/long-post + demo video + carousel/document + Reddit post + 5 reply opportunities. Don't ship until all 5 designed.
2. **5-piece designs are channel-aware.** For X-primary: thread = X thread, demo = native video tweet, carousel = X image carousel, Reddit post = secondary handoff, 5 replies = reply-mining seed.
3. **CTA cap.** No "Sign up now" in Phase 2. Soft asks only.
4. **Each experiment has a hypothesis.** "If X format hits >3% engagement-to-followers, that's the FMF candidate; if <1%, void-launch risk."
5. **Day-of-week timing.** No Mondays, Fridays, weekends (rule 9.17). Tuesday/Wednesday default.
6. **First-50-DM list seeded.** Even in Phase 2 (rule 9.7). Identify 50 candidate humans pre-launch.
7. **Reply-opportunity inventory.** Reuse \`XResearchReport.replyTargets\` / \`RedditDemandReport.replyTargets\`. Pre-identified, drafted, ready-to-post.
8. **Stop signal: engagement-to-followers <1%** (rule 9.8). Halt and reposition.
9. **Skip-launch signal: >70% engagement from other founders** (rule 9.9). Recommend channel change.
10. **Phase 2 success signal: 1+ unprompted "where can I try this?" reply OR DM from non-founder >100-follower account.**
11. **No paid amplification in Phase 2** (rule 9.21).
12. **Time-bounded experiment.** 7-day window per experiment. Threshold fires or doesn't by day 7.

## Output schema

\`\`\`ts
interface DistributionExperimentSet {
  softLaunchKit: {
    threadOrLongPost: { channel: string; hypothesis: string; formatPatternId: string; successMetric: string; stopMetric: string; scheduledDay: "tue" | "wed"; scheduledTimeLocal: string; draftReadyByDate: string };
    demoVideo: { /* same shape */ };
    carouselOrDocument: { /* same shape */ };
    redditPost: { /* same shape, includes targetSub + warmupSatisfied check */ };
    fiveReplyOpportunities: Array<{ threadUrl: string; channel: string; draftReady: boolean }>;
  };
  first50DmList: { targetCount: number; seedSources: string[]; populatedCount: number; populatedBy: string };
  weeklySchedule: Array<{ day: string; activity: string; channelMode: "BUILD" | "ENGAGE" | "OFFER" }>;
  stopAndDoubleDownRules: Array<{ metric: string; threshold: string; action: "stop_and_reposition" | "switch_channel" | "double_down" | "continue_observing"; playbookRule: string }>;
  estimatedOperatorHoursPerDay: number;
  rulesCited: string[];
}
\`\`\`

## Failure modes

- **5-piece kit cannot be designed.** \`status: "missing_inputs"\` with list.
- **Operator hours/day < required.** Phase 2 typical = 60-90 min/day. Below = recommend Phase 1 continuation or lower-hours channel.
- **No Reddit warmup satisfied AND Reddit in the kit.** Substitute different secondary-channel piece.

## Cost discipline

0 new ScrapeCreators / 0 WebFetches / 1 main_maya. Timeout 10 min.

## Anti-slop check

\`hypothesis\` strings and any draft fragments pass \`maya-slop-critic\`. Specifically banned in distribution-design: "iterate", "optimize", "leverage", "supercharge". Hypothesis should sound like a bet a real operator would make.
`;

// Source: agents/skills/maya-gtm/maya-icp-hypothesis/SKILL.md
const ENTRY_8_maya_icp_hypothesis = `---
name: maya-icp-hypothesis
description: Generate 3-5 ICP hypotheses from product evidence + walkthrough — never from asking the founder, who usually doesn't know.
---

# maya-icp-hypothesis

## Purpose

Founders rarely know their real buyer when they ship. "Devs" / "creators" / "small businesses" are audiences, not ICPs. This skill turns a ProductDiagnosis + walkthrough + competitor evidence into 3-5 concrete buyer hypotheses, each scored on convertibility and channel-locatability. Channel-judge consumes these directly.

## When to invoke

- IF \`productDiagnosis.status === "ok"\` AND no \`icpHypotheses\` exist THEN run.
- IF channel-judge returned \`failure_reason: "no_locatable_buyer"\` THEN re-run with broader hypothesis set.
- IF results-reviewer flags \`pattern: "engagement_from_other_founders_only"\` (skip launch) THEN re-run — the buyer was wrong.
- NEVER prompt the operator with "who is your customer?" as the primary input. Use product evidence first; ask the operator only to disambiguate between scored candidates.

## Required reads

1. \`APP.md\`, \`PLAYBOOK.md\` § 1 (success-metric ladder), § 5 Failure Mode 2 (skip launch), § 7 (channel affinity — ICP must map to one row).
2. \`MEMORY.md\` for prior hypothesis attempts.

## Decision rules

1. **Rule 9.2 hard requirement.** Each hypothesis must include \`buyer = "{role} at {context} who is currently {behavior}"\`. "Indie devs" is not a buyer; "Indie devs building solo SaaS who have shipped but have <100 followers" is.
2. **No founder-circle hypotheses unless the product targets founders.** Otherwise it's auto-rejected as Failure Mode 2 bait. Rule 9.9.
3. **Each hypothesis must be locatable on a specific channel.** Cite the PLAYBOOK § 7 row.
4. **Minimum 3, maximum 5.** Fewer = under-explored; more = spray.
5. **Score on \`painSpecificity\` (0-3) + \`channelLocatability\` (0-3).** Drop hypotheses scoring ≤2 total to \`discarded[]\`.
6. **Operator-supplied buyer is one hypothesis, not the answer.** Label \`source: "operator-stated"\` and compare to product-evidence hypotheses. Surface divergences.
7. **Adjacent-buyer rule.** For each primary, generate one adjacent (same pain, different context).
8. **Pre-launch trap.** IF \`app.stage === "pre-launch"\` THEN mark all \`hypothesisGrade: "speculative"\`.
9. **No demographic-only ICPs.** Must include a *behavior* the buyer is doing today.
10. **One sentence of evidence per hypothesis.** Where it came from: landing copy verbatim / competitor reviews / walkthrough scene / operator transcript.

## Output schema

\`\`\`ts
interface IcpHypotheses {
  hypotheses: Array<{
    id: string;
    buyer: string;
    currentPain: string;
    currentWorkaround: string;
    locatableOn: { channel: string; searchProbe: string; affinityRow: string };
    painSpecificity: 0 | 1 | 2 | 3;
    channelLocatability: 0 | 1 | 2 | 3;
    totalScore: number;
    hypothesisGrade: "speculative" | "evidence-anchored" | "validated";
    evidenceAnchor: { source: string; excerpt: string };
    source: "product-evidence" | "operator-stated" | "competitor-adjacent";
  }>;
  discarded: Array<{ candidate: string; reason: string }>;
  operatorDivergence: string | null;
  recommendedPrimary: string;
}
\`\`\`

## Failure modes

- **No hypothesis scores ≥3.** Return \`status: "diagnosis_too_thin"\`. Request maya-app-inspector re-run with deeper walkthrough.
- **All converge on the same channel.** Surface as \`convergedChannel: "X"\` — channel-judge has a head start.
- **Operator-stated wildly diverges.** Return both, flag \`operatorDivergence\`. Don't silently override.

## Cost discipline

0-2 ScrapeCreators calls (only to validate channel-locatability). 0-2 WebFetches (competitor sites). 1 model call. No heartbeat spend.

## Anti-slop check

Invoke \`maya-slop-critic\` (banned-phrase scan only) on every \`buyer\` and \`currentPain\` string before returning. If "leverage" / "supercharge" / "unlock" appears, rewrite to operator's vocabulary from APP.md.
`;

// Source: agents/skills/maya-gtm/maya-linkedin-fit-researcher/SKILL.md
const ENTRY_9_maya_linkedin_fit_researcher = `---
name: maya-linkedin-fit-researcher
description: Decide whether LinkedIn is the right channel per playbook/linkedin.md LI-1.1 - LI-1.3 + LI-10.2. Refuse if rule LI-10.2 applies.
---

# maya-linkedin-fit-researcher

## Purpose

LinkedIn is the right channel for a narrow slice of indie products (B2B SaaS, ops/marketing/HR/sales/finance buyers, $500-5000 ACV, narrative-writing founder) and the wrong channel for most. This skill runs the fit check, refuses when criteria don't hold, and — when LinkedIn is a fit — proposes the doc-carousel-first launch shape.

## When to invoke

- IF channel-judge is considering LinkedIn THEN run.
- IF operator says "I want to post on LinkedIn" AND product is consumer/dev-tool/sub-$500-ACV THEN run specifically to refuse with a cited rule.
- IF \`icpHypotheses[].locatableOn.channel === "linkedin"\` THEN run.
- NEVER recommend LinkedIn ads in V1 (linkedin.md LI-7.1, PLAYBOOK rule 9.21).

## Required reads

1. APP.md, GTM.md.
2. PLAYBOOK.md § 3 step 5 (LinkedIn primary conditions), § 4 (40/50/10), § 7 affinity.
3. **playbook/linkedin.md — MANDATORY full read.** Cite LI-* rules.
4. MEMORY.md.

## Decision rules

1. **LI-1.1 channel-tree gate.** Run PLAYBOOK § 3 first. LinkedIn-primary only when steps 4-5 explicitly route there.
2. **LI-10.2 hard refuse.** IF product is indie consumer / dev tool / API / sub-$500-ACV THEN \`fit: "park"\`, \`refusalReason: "LI-10.2 — wrong audience composition"\`. Do not soften.
3. **LI-10.3 writing-style gate.** IF operator cannot write 200+ words in their own voice THEN \`fit: "secondary_with_caveat"\` and recommend X-first.
4. **ACV band check.** Valid LinkedIn-primary band is $500-$5000. Below → LI-10.2 fires. Above → LinkedIn helps trust but doesn't ignite (enterprise outbound is the real channel).
5. **LI-10.4 launch format default.** Document carousel (10 slides) + 400-word personal narrative caption. Documents hit 6.6% engagement.
6. **LI-10.5 anti-announcement.** Reframe every launch as a "thinking-process" post per linkedin.md § 4. "Excited to announce" → rewrite.
7. **LI-10.6 engagement-bait closer ban.** No "Agree?" / "What do you think?" / "Like if this resonates."
8. **LI-10.7 follower-flip.** IF \`followerCount < 500\` THEN 1 original post/week + 30 min/day comment-mining on large-account niche posts.
9. **LI-10.8 comment-mining freshness.** Comment targets must be <2 hours old.
10. **LI-10.9 newsletter gate.** Only if operator already writes long-form monthly+ elsewhere.
11. **LI-10.11 60-day reweight.** IF leads but zero conversions at 60 days AND runway <6 months THEN \`reweightToFasterChannel: true\`.
12. **LI-10.14 link-in-first-comment.** Any draft URL moves to first comment.

## Output schema

\`\`\`ts
interface LinkedInFitReport {
  fit: "primary" | "secondary" | "secondary_with_caveat" | "park";
  refusalReason?: string;
  acvBandCheck: { band: string; passes: boolean };
  writingStyleCheck: { capableOfLongForm: boolean; evidence: string };
  recommendedLaunchShape?: {
    format: "doc_carousel_10_slide_plus_400w_caption";
    caption: { type: "personal_narrative"; openingPattern: string };
    cta: "link_in_first_comment";
    nativeVideoOption: boolean;
  };
  commentTargets: Array<{
    postUrl: string;
    authorHandle: string;
    authorFollowers: number;
    postAgeMinutes: number;
    excerpt: string;
    suggestedCommentDraft: string;
  }>;
  postingCadence: { originalPostsPerWeek: number; commentMiningMinPerDay: number };
  rulesCited: string[];
  reweightFlag?: boolean;
}
\`\`\`

## Failure modes

- **Operator insists LinkedIn for consumer app.** \`fit: "park"\` + cited refusal + one-sentence alternative. Document override but don't silently comply.
- **No comment targets fresh enough.** Empty list + recommend different posting time (8-10 AM operator-tz weekdays).
- **ScrapeCreators LinkedIn endpoints fail.** Try \`/v1/linkedin/company\` + \`/v1/linkedin/company/posts\`. If both fail, downgrade to \`fit: "secondary_with_caveat"\`.

## Cost discipline

Max 4 ScrapeCreators calls. 1-2 WebFetches. 1 main_maya call. Timeout 12 min.

## Anti-slop check

LinkedIn is the slop epicenter. Every \`suggestedCommentDraft\` and \`caption.openingPattern\` MUST pass \`maya-slop-critic\` with LinkedIn-specific bans (linkedin.md § 9): no broetry overuse, no "thrilled/excited/honored", no tagged-friend humblebrag, no engagement-bait closers, no AI-emoji bullet lists.
`;

// Source: agents/skills/maya-gtm/maya-reddit-demand-researcher/SKILL.md
const ENTRY_10_maya_reddit_demand_researcher = `---
name: maya-reddit-demand-researcher
description: Find Reddit demand for the product's pain — score evidence, identify reply targets, return promotion-risk score. Budget-bounded.
---

# maya-reddit-demand-researcher

## Purpose

Reddit is the highest-conversion buyer-intent channel for indie products IF the operator is a real participant. This skill finds threads expressing the pain, subreddits where the buyer hangs out, reply-mining opportunities, and a hard risk score for the operator's account state. It refuses to recommend Reddit when warmup math doesn't work.

## When to invoke

- IF channel-judge is considering Reddit (primary or secondary) THEN run.
- IF \`icpHypotheses[].locatableOn.channel === "reddit"\` THEN run.
- IF the operator says "let me post on Reddit" THEN run BEFORE drafting.
- IF a results-reviewer flags a Reddit post got removed THEN re-run to find a different sub.
- NEVER from heartbeat. Each invocation spends up to 8 ScrapeCreators calls.

## Required reads

1. \`APP.md\`, \`GTM.md\`.
2. PLAYBOOK.md § 1, § 3 (channel tree steps 4-7), § 4 (BUILD/ENGAGE/OFFER — Reddit is 10/80/10).
3. **playbook/reddit.md — MANDATORY full read.** Every decision must trace to a numbered rule in § 8.
4. MEMORY.md for prior Reddit attempts.

## Decision rules

1. **Warmup gate (reddit.md § 8.1).** IF \`operator.reddit.accountAgeDays < 30\` OR no recent comment history THEN return \`recommendation: "warmup_first"\`. No reply targets surfaced.
2. **Karma floor (§ 8.2).** IF karma in best-fit niche sub < 10 THEN add precondition: "5-10 helpful comments in {sub} first."
3. **Domain age check (§ 8.14).** IF \`app.domain\` < 30 days old THEN \`domainRiskElevated: true\`.
4. **Subreddit selection.** 2-3 candidate subs per ICP. From reddit.md § 1 or niche subs the founder already participates in. NEVER recommend r/marketing, r/programming, r/technology, r/AskReddit for product mention (§ 8.12).
5. **Funnel-stage tagging.** Awareness / consideration / decision per reddit.md § 1. Decision-stage subs (r/Notion, r/Obsidian) are reply-only.
6. **The 5-thread floor.** A sub is only worth recommending if ≥5 buyer-intent threads in last 60 days.
7. **Reply-target quality bar.** Threads (a) <7 days old, (b) OP asked a pain-related question, (c) product is a credible answer within 1 degree of fit. § 4 + § 8.10.
8. **r/SaaS 60-day clock.** IF recommending r/SaaS main-feed THEN flag the cost and recommend weekly feedback thread unless operator's narrative is unusually strong.
9. **r/IndieHackers SHOW IH one-shot.** Only if \`app.stage === "shipped"\` AND operator has a metric/testimonial.
10. **Live-product check (§ 8.9).** IF \`app.stage === "pre-launch"\` AND only waitlist exists THEN remove r/SideProject from candidates. Substitute r/AlphaAndBetaUsers.
11. **Cross-post block (§ 8.7).** No same post in >2 subs in a week. Rewrite each for sub culture or stage 7+ days apart.
12. **First-comment URL rule (§ 8.8).** For r/SaaS / r/startups / r/Entrepreneur, URL goes in the first comment, not the post body.

## Output schema

\`\`\`ts
interface RedditDemandReport {
  recommendation: "go" | "warmup_first" | "park";
  warmupPlanWeeks?: number;
  warmupActions?: string[];
  candidateSubs: Array<{
    name: string;
    funnelStage: "awareness" | "consideration" | "decision";
    rationale: string;
    rulesCited: string[];
    karmaRequired: number | "unstated";
    postFreqCap: string;
    flairRequired: string | null;
    evidenceThreadCount: number;
  }>;
  evidenceCards: Array<{ threadUrl: string; sub: string; title: string; upvotes: number; ageHours: number; painSnippet: string; productFit: "direct" | "adjacent" | "weak" }>;
  replyTargets: Array<{
    threadUrl: string;
    sub: string;
    opQuestion: string;
    suggestedFramework: "been-there-done-that" | "counterintuitive" | "tactical-playbook" | "tool-neutral-recommendation" | "quiet-authority";
    mentionRecommended: boolean;
  }>;
  promotionRiskScore: 0 | 1 | 2 | 3 | 4 | 5;
  riskFlags: string[];
  domainRiskElevated: boolean;
  parkReasons?: string[];
}
\`\`\`

## Failure modes

- **No evidence threads found.** Park. Surface to channel-judge.
- **All candidate subs are decision-stage.** Return \`replyTargets\` only, \`recommendation: "go"\` constrained to reply-only.
- **ScrapeCreators Reddit endpoint fails.** Return HTTP status; do NOT degrade to training-data recommendations.
- **Domain blacklist detected.** \`domainBlacklisted: true\` + recommend domain change (reddit.md § 6).

## Cost discipline

Max 8 ScrapeCreators calls: 3 × subreddit/search, 2 × general search, 2 × subreddit details, 1 reserve. 1 main_maya synthesis. Timeout 20 min.

## Anti-slop check

\`painSnippet\` and \`opQuestion\` are VERBATIM from Reddit. Do not paraphrase. Quote and link.
`;

// Source: agents/skills/maya-gtm/maya-results-reviewer/SKILL.md
const ENTRY_11_maya_results_reviewer = `---
name: maya-results-reviewer
description: Review published results. Recommend double_down / iterate / do_not_overfit per PLAYBOOK format-market-fit detection. Counter-overfitting checks.
---

# maya-results-reviewer

## Purpose

Posts are useless without a feedback loop. Consumes post engagement data (T+2h / T+24h / T+7d) and feeds back recommendations: keep, iterate, drop. Also the failure-mode detector — void / skip / cringe / feature / post-and-pray spotted here.

## When to invoke

- IF a post hit a follow-up trigger (T+2h, T+24h, T+7d) THEN run.
- IF operator says "how did this perform?" THEN run.
- IF channel-strategy is being reconsidered THEN run on recent posts first.
- IF distribution-motion-tester thresholds need a check THEN run.
- HEARTBEAT-COMPATIBLE for cached/local reads only — fresh API pulls spend budget; come from explicit job triggers.

## Required reads

1. APP.md, GTM.md.
2. **PLAYBOOK.md § 2 Phase 4 (format-market-fit), § 5 (all 5 failure modes — retroactive detection), § 4.**
3. playbook/{channel}.md baselines.
4. MEMORY.md for prior reviews — counter-overfitting depends on history.

## Decision rules

1. **Failure-mode retrospective check (PLAYBOOK § 5).** For every post >24h old:
   - **Void**: <30 likes + <5 replies on <1k-follower account → rule 9.8 / Failure 1.
   - **Skip**: >70% engagement from other founders → Failure 2 / rule 9.9.
   - **Cringe**: high impressions + low engagement → Failure 3.
   - **Feature**: replies ask "but what does it do?" → Failure 4.
   - **Post-and-pray**: no follow-up within 48h → Failure 5.
2. **Format-market-fit detection (PLAYBOOK § 2 Phase 4).** After 2-3 weeks, winning format should visibly outperform. Name it. "Metric posts get 4x engagement → 2/week, reduce build updates to 1." Rule 9.23.
3. **Counter-overfitting check.** If a single post crushes (5-10x normal), DO NOT immediately recommend "do 10 of these." Require 3+ format-confirming wins before double-down.
4. **Buyer-vs-founder analysis.** Classify each commenter/replier. If >70% founder, flag skip-launch regardless of raw count.
5. **Unprompted-demand signal.** "Where can I try this?" replies are highest-value. 1 from a non-founder >100-follower account = Phase 2 green light.
6. **Churn-confession opportunity (rule 9.24).** Recommend churn-confession post only if something actually broke. Never fabricate.
7. **Algorithm penalty detection (x.md § 11 Failure 3).** If account-level reach drops on last 5 posts despite consistent format, \`algorithmPenaltyRisk: true\`.
8. **No paid-amplification recommendation pre-FMF (rule 9.21).** Even if a post is performing, organic CAC > 50% LTV = refuse.
9. **Compounding-cadence check (PLAYBOOK § 2 Phase 4).** Expected: 1 metric + 2 build/insight + 1 demo/proof per week + reply-mining 4-5d/week. Surface gaps.
10. **Citation-firewall on numbers.** Every metric must come from a live API pull or be marked \`staleFromCacheAt: ts\`.
11. **No "we're learning a lot" sycophancy.** If verdict is "this isn't working", say so.

## Output schema

\`\`\`ts
interface ResultsReview {
  perPostResults: Array<{
    liveUrl: string;
    channel: string;
    publishedAt: string;
    metrics: { likes: number; replies: number; reposts: number; impressions?: number; engagementToFollowersPct: number };
    failureModeMatch: "none" | "void" | "skip" | "cringe" | "feature" | "post_and_pray";
    buyerVsFounderEstimate: { buyer: number; founder: number; unclear: number };
    unpromptedDemandReplies: number;
    verdict: "void" | "weak" | "ok" | "strong" | "outlier";
  }>;
  formatPerformance: Array<{
    formatPatternId: string;
    sampleCount: number;
    medianEngagementPct: number;
    recommendation: "double_down" | "iterate" | "drop" | "more_data_needed";
    counterOverfittingNote?: string;
  }>;
  formatMarketFitVerdict: "not_yet" | "candidate" | "confirmed";
  channelLevelHealth: { last5PostsReach: "rising" | "flat" | "falling"; algorithmPenaltyRisk: boolean; accountSilenceRisk: boolean };
  recommendedNextActions: Array<{ action: string; rulesCited: string[]; severity: "advisory" | "blocking" }>;
  churnConfessionOpportunity?: { realChurnEvent: string };
  rulesCited: string[];
}
\`\`\`

## Failure modes

- **Live engagement data unavailable.** Mark \`staleFromCacheAt\`.
- **Sample size too small.** N<3 per format = \`more_data_needed\`.
- **One viral outlier.** \`counterOverfittingNote: "N=1; need 2 more confirming posts"\`.
- **Operator wants validation, not review.** Return the honest verdict anyway. Anti-sycophancy is non-negotiable.

## Cost discipline

Max 4 ScrapeCreators calls (1 per platform). Cache aggressively. 1 main_maya synthesis + buyer-vs-founder classification. Heartbeat reads cached only. Timeout 12 min.

## Anti-slop check

\`recommendedNextActions[].action\` and \`verdict\` strings are operator-facing. Run \`maya-slop-critic\`. Must not read "let's iterate and learn from this exciting first launch!" — must read "this was a void launch by rule 9.8; the format reached only the founder circle; we change channel or sharpen the hook within 14 days." Terse, honest, cited.
`;

// Source: agents/skills/maya-gtm/maya-slop-critic/SKILL.md
const ENTRY_12_maya_slop_critic = `---
name: maya-slop-critic
description: The anti-slop enforcer. Apply PLAYBOOK § 6 banned-phrase list + banned-structure scan + voice match + read-aloud test. Returns "rejected with reasons" on any trip.
---

# maya-slop-critic

## Purpose

Every draft prose output in the system passes through this skill before shipping. The job is to detect AI-flavored writing and surface specific rewrites — banned phrases, banned structures, voice divergence, generic-template feel. PLAYBOOK § 6 codifies the rules; this skill enforces them.

## When to invoke

- IF any other skill produces draft prose (post body, reply, caption, hook, CTA, calendar event description) THEN invoke before the parent skill returns.
- IF the operator drafts something and asks Maya to review THEN invoke.
- IF results-reviewer detects "high impressions + low engagement" (cringe-launch symptom, Failure Mode 3) THEN re-invoke retroactively on last 5 posts.
- HEARTBEAT-COMPATIBLE — local-state-only, no external API spend.

## Required reads

1. **PLAYBOOK.md § 6 — MANDATORY full read.**
2. USER.md (operator voice fingerprint: Stated lane / Observed signal).
3. playbook/{channel}.md for channel-specific bans (LinkedIn broetry, TikTok "link in bio", Reddit "DM me").
4. MEMORY.md for repeat traps.

## Decision rules

1. **Rule 9.10 — banned-phrase scan.** Any hit on PLAYBOOK § 6 list = REJECT and rewrite. The list:
   - "game changer", "game-changing"
   - "unlock", "unlock the power of"
   - "supercharge", "turbocharge"
   - "empower", "empowers you to"
   - "leverage" (as verb), "leveraging"
   - "delve into", "dive deep into"
   - "tapestry", "landscape", "ecosystem" (metaphorical)
   - "testament to"
   - "vibrant", "robust", "seamless"
   - "pivotal", "crucial", "vital" (dramatized)
   - "In today's competitive landscape", "In today's fast-paced world"
   - "It's worth noting that", "It's important to note"
   - "Not just X, but Y" (structural pep)
   - "comprehensive", "endeavour", "optimise"
   - "furthermore", "moreover", "additionally" (as openers)
   - "Excited to announce", "Thrilled to share", "Beyond excited"
   - "We are pleased to", "I'm proud to"
   - "Whether you're X, Y, or Z" (tricolon-of-personas opener)
   - "Game-changer.", "Mind-blowing.", "Absolute fire." (one-word punch closes)

2. **Rule 9.11 — banned-structure scan.** Any hit = REJECT:
   - Em-dash cadence (>1 em-dash per paragraph).
   - Stacked one-line takes (3 single-line statements pretending to be profound).
   - Emoji-bullet lists.
   - X-Y-Z tricolon ("Faster, better, and cheaper.").
   - "I'm building [adjective] [adjective] [thing]" structure.
   - Hedging seesaw ("It's not just X — it's Y. But it's also Z.").
   - Uniform sentence length (4 in a row at 12-18 words).
   - Passive voice as default.
   - Em-dash + colon stacking in the same line.

3. **Rule 9.12 — voice-match scan.** Compare draft to operator's last-5 authentic posts. Diverges = REJECT. Check: sentence length variance, capitalization, emoji frequency, parenthetical-aside frequency, first-vs-third-person, profanity tolerance.
4. **Rule 9.13 — "Excited to announce" auto-reject.** No re-read needed. Reject immediately, propose rewrite as thinking-process post (linkedin.md § 4).
5. **Read-aloud test.** Sounds like a press release = REJECT.
6. **Channel-specific bans.**
   - LinkedIn: broetry overuse, "Agree?" closers, tagged-friend humblebrag, fake humility, "founder" 3x in first paragraph, stock-photo selfies.
   - TikTok: literal "link in bio", "Hey guys" / "What's up everyone", "follow for more" in first 70%.
   - Reddit: "DM me" / PM solicitation in promo-sensitive subs, naming competitors in promo-adjacent comments, hype-jargon in title, emoji in title.
   - X: hype emoji clusters (🚀🔥), "RT for reach", "Like if you agree", "Comment YES and I'll DM you", dunk-quote-RTs.
7. **Number-presence (x.md rule 8).** X posts must contain ≥1 concrete number. No number = REJECT (or surface to operator for the number).
8. **CTA singularity.** Multiple CTAs in one post = REJECT.
9. **Operator's-instinct final filter (PLAYBOOK rule 6.1).** If uncertain, return \`verdict: "borderline"\` with: "read this like a stranger sent it to you — do you sound like this?"
10. **No invented voice.** Slop-critic rejects; it doesn't write the operator's voice from scratch. If voice fingerprint missing, mark \`voiceMatch: "no_fingerprint_available"\` and apply only banned-phrase + structure scans.

## Output schema

\`\`\`ts
interface SlopCriticVerdict {
  verdict: "approved" | "rejected" | "borderline";
  hits: Array<{
    rule: string;
    type: "banned_phrase" | "banned_structure" | "voice_divergence" | "channel_ban" | "missing_number" | "multiple_ctas";
    snippet: string;
    suggestion: string;
  }>;
  voiceMatch: "match" | "diverge" | "no_fingerprint_available";
  readAloudTest: "passes" | "press_release_tone";
  rewrittenDraft?: string;
  finalAdvice: string;
}
\`\`\`

## Failure modes

- **Passes all scans but feels off.** Return \`verdict: "borderline"\` with \`finalAdvice: "Operator gut-check before posting"\`.
- **Operator overrides rejection.** Document override + predict failure mode. Surface to MEMORY.md.
- **No voice fingerprint.** Apply banned-phrase + structure + channel-ban scans only. Mark \`voiceMatch: "no_fingerprint_available"\`.

## Cost discipline

0 ScrapeCreators / 0 WebFetches / 1 main_maya call (low thinking — pattern matching, not synthesis). Heartbeat-safe. Timeout: 3 min.

## Anti-slop check

Self-referential: this skill IS the anti-slop check. The \`suggestion\` strings inside \`hits[]\` must themselves pass the rules — don't suggest "leverage your voice" as the rewrite for "leverage X". Suggest plain English instead.
`;

// Source: agents/skills/maya-gtm/maya-tiktok-demo-strategist/SKILL.md
const ENTRY_13_maya_tiktok_demo_strategist = `---
name: maya-tiktok-demo-strategist
description: Pick TikTok format (faceless screen-record vs founder-on-camera vs slideshow) given showability + constraints. Refuse if user can't post manually (V1 constraint).
---

# maya-tiktok-demo-strategist

## Purpose

V1 of ClawLaunch does NOT auto-post to TikTok (tiktok.md § 12). This skill picks the right TikTok format given operator constraints — or refuses TikTok entirely when constraints don't add up. Produces a shot plan and CTA strategy. Does NOT produce hook copy (that's \`maya-content-format-miner\`).

## When to invoke

- IF channel-judge picks TikTok as primary or secondary THEN run.
- IF \`productDiagnosis.showability\` is screen-recordable or screenshot-only AND target buyer is consumer/prosumer THEN run.
- IF operator's TikTok account is \`tiktokWarmupState === "new_needs_warmup"\` THEN return warmup plan, not shot plan.
- NEVER auto-post.

## Required reads

1. APP.md, GTM.md.
2. PLAYBOOK.md § 3 step 1-3 (showability tree), § 7.
3. **playbook/tiktok.md — MANDATORY full read.** Cite tiktok.md rules 1-15 (§ 11).
4. MEMORY.md.

## Decision rules

1. **tiktok.md rule 1 — V1 manual-post gate.** IF \`canPostTikTokManually !== true\` THEN \`recommendation: "park_tiktok"\`.
2. **tiktok.md rule 2 — restricted-state block.** IF \`tiktokWarmupState === "restricted"\` THEN return resolve-Account-Check instructions.
3. **tiktok.md rule 3 — warmup gate.** IF \`tiktokAccountAgeDays < 14\` OR state !== "ready" THEN return warmup sequence (§ 6).
4. **tiktok.md rule 4 — unshowable + no-slideshow refuse.** IF showability === "unshowable" AND operator refuses slideshow THEN park.
5. **tiktok.md rule 5 — faceless default.** IF product has clear UI moment ≤10s OR before/after THEN default faceless screen-record for first 10 launch posts. Cite Cal AI / Daze / Pushscroll.
6. **tiktok.md rule 6 — camera-shy routing.** IF \`onCameraOk === false\` AND showable THEN faceless screen-record only.
7. **tiktok.md rule 7 — slideshow for text-heavy niches.** Dev tools / B2B / finance / education niches over-indexing on carousels → Photo Mode primary.
8. **tiktok.md rule 8 — talking-head trust products.** Agency / coaching / consulting AND operator comfortable on camera → founder talking-head.
9. **tiktok.md rule 10 — "link in bio" ban.** Shot plan and CTA NEVER include "link in bio". Substitute search-by-name / pinned-comment / DM-keyword.
10. **tiktok.md rule 11 — 5-video format rule.** Chosen format must have ≥5 winning examples in operator's niche (verified by \`maya-tiktok-format-researcher\`). If <5, \`formatConfidence: "low"\`.
11. **tiktok.md rule 13 — Personal Account preference.** First 30-60 days, Personal Account > Business Account (full music catalog).
12. **tiktok.md rule 15 — cadence cap.** 1-2/day for <30d accounts, 2-3/day for warmed. Never >4/day.
13. **Length sweet spot.** 22-28 seconds for first 10 hero posts. Carousel default 6 slides.
14. **Safe zones.** Every shot plan places text/CTA inside central safe zone (≥150px top, ≥250px bottom, ≥130px right).
15. **No polished-ad recommendation.** No logo intros, motion graphics, lower-thirds (tiktok.md § 13 Failure 5). Authenticity > polish.

## Output schema

\`\`\`ts
interface TikTokStrategy {
  recommendation: "go_faceless_screen_record" | "go_founder_talking_head" | "go_slideshow_photo_mode" | "warmup_first" | "park_tiktok";
  refusalReason?: string;
  warmupPlan?: { dayBands: Array<{ days: string; actions: string[] }> };
  shotPlan?: {
    format: "faceless_screen_record" | "founder_talking_head" | "slideshow_photo_mode";
    durationSec: number;
    beats: Array<{ tSec: number; onScreenText: string; visualAction: string; voiceOver?: string; safeZoneOk: boolean }>;
    aspectRatio: "9:16";
    soundStrategy: { kind: "original_voiceover" | "trending_sound" | "evergreen_loop"; trendingSoundFreshness?: "0-24h" | "24-48h" | "post_peak" };
    cta: { kind: "search_by_name" | "pinned_comment_url" | "dm_keyword"; text: string };
    safeZoneNotes: string;
  };
  postingCadence: { perDay: number; ceiling: number };
  accountTypeRec: "personal" | "business";
  formatConfidence: "high" | "medium" | "low";
  formatResearchNeeded?: boolean;
  rulesCited: string[];
}
\`\`\`

## Failure modes

- **Operator wants TikTok but \`canPostTikTokManually !== true\`.** Park. No shot plan. Cite § 12.
- **Account in \`restricted\`.** Return resolve-Studio-Account-Check instructions only.
- **Niche has no winning examples.** \`formatResearchNeeded: true\`. Run \`maya-tiktok-format-researcher\` first.
- **Showability disagreement.** IF operator insists TikTok for unshowable + won't do slideshow THEN park + cite rule 4 + offer X/LinkedIn/YouTube.

## Cost discipline

0 ScrapeCreators (format research is separate). 0-1 WebFetch. 1 main_maya. Timeout 10 min.

## Anti-slop check

\`onScreenText\` and \`voiceOver\` strings must pass slop-critic (banned phrases). Hook copy itself comes from \`maya-content-format-miner\` with full slop-critic pass.
`;

// Source: agents/skills/maya-gtm/maya-tiktok-format-researcher/SKILL.md
const ENTRY_14_maya_tiktok_format_researcher = `---
name: maya-tiktok-format-researcher
description: Find what's working in the operator's niche on TikTok RIGHT NOW. Apply the 5-video rule from playbook/tiktok.md § 7.
---

# maya-tiktok-format-researcher

## Purpose

TikTok rewards format-remix, not content-copy. This skill mines the operator's niche on TikTok to find the dominant winning format — hook structure, length, on-screen-text style, music, CTA pattern — and certifies it via the 5-video rule (tiktok.md § 7). Demo-strategist consumes the output to pick faceless / talking-head / slideshow with confidence.

## When to invoke

- IF \`maya-tiktok-demo-strategist\` returned \`formatResearchNeeded: true\` THEN run.
- IF channel-judge is weighing TikTok and \`formatConfidence\` is unknown THEN run.
- IF results-reviewer detects operator's current TikTok format underperforming (<5K views over 5 posts) THEN re-run.
- NEVER from heartbeat; most ScrapeCreators-intensive skill (cap 12 calls).

## Required reads

1. APP.md, GTM.md.
2. PLAYBOOK.md § 3 step 1-3, § 7.
3. **playbook/tiktok.md — MANDATORY § 7 (niche-format mining), § 2 (hook catalog), § 3-5 (format anatomies).**
4. MEMORY.md.

## Decision rules

1. **5-video rule (tiktok.md § 7).** A format is "winning" only if ≥5 of top 20 videos for a niche keyword share a hook structure.
2. **Top-by-keyword sampling.** For each candidate keyword, pull top 20 via \`/v1/tiktok/search/top\`. Catalog hook + length + format + sound + CTA.
3. **Recency filter.** Discard videos >90 days old; algorithm drift makes them weak signals.
4. **Diversity check.** If top 20 are all from 1-2 accounts, surface \`nicheCreatorConcentration: "high"\`.
5. **Format taxonomy.** Tag each video: \`faceless_screen_record\`, \`founder_talking_head\`, \`slideshow_photo_mode\`, \`mixed\`. Aggregate.
6. **Hook taxonomy.** Tag each hook against tiktok.md § 2 catalog (pattern-interrupt, outcome-promise, question, demo-cold-open, pain-validation, proof-first, POV, contrarian, before/after, comment-bait).
7. **Length sampling.** Median + p25/p75 per niche.
8. **Sound velocity.** Flag any audio appearing in ≥3 videos in last 7 days — accelerating niche sound (tiktok.md § 10 — 12-24h sweet spot).
9. **CTA pattern.** Aggregate: search-by-name / pinned-comment / DM-keyword. Refuse "link in bio" recommendations.
10. **No recommendation without ≥5 confirming videos.** If no format hits 5, \`confidence: "insufficient_evidence"\`.

## Output schema

\`\`\`ts
interface TikTokFormatResearch {
  confidence: "high" | "medium" | "low" | "insufficient_evidence";
  primaryFormat?: {
    label: "faceless_screen_record" | "founder_talking_head" | "slideshow_photo_mode";
    confirmingVideoCount: number;
    dominantHookPattern: string;
    medianLengthSec: number;
    p25LengthSec: number;
    p75LengthSec: number;
    nicheCreatorConcentration: "low" | "medium" | "high";
  };
  hookPatternCounts: Record<string, number>;
  formatCounts: Record<string, number>;
  acceleratingSounds: Array<{
    soundId: string;
    title: string;
    artist?: string;
    usageLast7d: number;
    firstSeenHoursAgo: number;
    velocityVerdict: "pre_peak_0_24h" | "early_24_72h" | "post_peak_skip";
  }>;
  exampleVideos: Array<{ url: string; handle: string; views: number; likes: number; durationSec: number; format: string; hookPattern: string; ctaPattern: string; soundId?: string; excerpt?: string }>;
  ctaTaxonomy: Record<"search_by_name" | "pinned_comment" | "dm_keyword" | "other", number>;
  searchQueriesUsed: string[];
  rulesCited: string[];
}
\`\`\`

## Failure modes

- **Niche has no English-language TikTok activity.** \`confidence: "insufficient_evidence"\`. Recommend channel-judge demote TikTok.
- **ScrapeCreators returns zero results.** Check param shape (tiktok.md § 7). If still empty, request operator-narrowed keywords.
- **All top videos are paid ads.** \`topResultsAreAds: true\`. Recommend broader keyword.
- **Single creator dominates >50%.** \`nicheCreatorConcentration: "high"\` — remix risky.

## Cost discipline

Max 12 ScrapeCreators calls: 3-5 keywords × 1 \`/search/top\` + 2-3 \`/search/hashtag\` + 1 \`/hashtags/popular\` + 1-2 \`/profile/videos\`. 1 hard_research_beta keyword expansion + 1 main_maya. Timeout 20 min. No heartbeat spend.

## Anti-slop check

Structured taxonomy output, slop-critic NOT invoked. \`excerpt\` strings from real videos are verbatim — do not paraphrase.
`;

// Source: agents/skills/maya-gtm/maya-ugc-system-advisor/SKILL.md
const ENTRY_15_maya_ugc_system_advisor = `---
name: maya-ugc-system-advisor
description: ADVISORY-ONLY in V1. UGC creators are a Phase 4+ lever per PLAYBOOK. Refuse to recommend before format-market-fit.
---

# maya-ugc-system-advisor

## Purpose

The operator will eventually ask about UGC creators (paid TikTok/IG creators making sponsored demos). This skill answers — but refuses to recommend the lever before format-market-fit is confirmed. PLAYBOOK § 2 Phase 4 is explicit: organic must produce at least one non-operator video that converted before a UGC creator brief has a proven template to copy.

## When to invoke

- IF operator asks about UGC creators, paid TikTok creators, or influencer-style outreach THEN run.
- IF \`maya-results-reviewer\` confirms format-market-fit AND organic has produced ≥1 non-operator-driven conversion THEN reconsider the gate.
- NEVER recommend UGC as a launch lever. UGC amplifies; it doesn't ignite.

## Required reads

1. APP.md, GTM.md.
2. **PLAYBOOK.md § 2 Phase 4 "When to start paid ads / UGC creators" — MANDATORY full read.**
3. PLAYBOOK.md rule 9.21 (paid amplification gate), § 5 Failure Mode 1.
4. playbook/tiktok.md § 1, § 11 rule 13.
5. MEMORY.md.

## Decision rules

1. **Pre-FMF refuse.** IF \`formatMarketFitVerdict !== "confirmed"\` THEN \`verdict: "premature"\` with \`refusalReason: "PLAYBOOK_phase_4_gate_unmet"\`. Do not soften.
2. **Organic-CAC math (rule 9.21).** IF organic CAC > 50% LTV THEN refuse paid (UGC included).
3. **Non-operator-conversion requirement.** UGC creators need a proven template. Until ≥1 organic non-operator-driven video has converted, there is no template. Cite Stronger's 6-second fade-in format (tiktok.md § 3) — they ran ~300 variants AFTER organic proved the format.
4. **Showability is mandatory.** UGC creators are primarily TikTok/IG. IF \`productDiagnosis.showability === "unshowable"\` THEN UGC is wrong even at scale.
5. **Brief template requires concrete elements.** When the gate opens: (a) proven hook structure, (b) proven demo beat, (c) proven CTA pattern, (d) proven length. All four from organic FMF data.
6. **Authentic ≠ polished.** UGC briefs asking for "polished cinematic ads with logo intro" reproduce tiktok.md § 13 Failure 5. Brief must explicitly ask for rough/authentic.
7. **Compliance flag.** UGC creators must disclose paid partnerships. No undisclosed sponsorship — regulatory exposure.
8. **Anti-pattern: UGC as Phase 1 short-cut.** Founders ask "can I pay creators to launch this for me?" Refuse — void launch with extra steps.
9. **Budget-bound recommendation when eventually approved.** Start 3-5 creator videos, $200-500 each, single-creator-per-test, NOT a 20-creator blast.
10. **LinkedIn ads is the closest non-UGC paid exception (rule 9.21).** LinkedIn ads can work pre-FMF if organic LinkedIn already shows signal. UGC does NOT have this exception.

## Output schema

\`\`\`ts
interface UgcAdvisoryVerdict {
  verdict: "premature" | "consider_in_n_weeks" | "ready_with_brief";
  refusalReason?: string;
  gatesUnmet?: Array<{
    gate: "format_market_fit" | "organic_non_operator_conversion" | "organic_cac_under_50pct_ltv" | "showability";
    detail: string;
  }>;
  whenToReconsider?: { trigger: string; estimatedWeeksFromNow?: number };
  proposedBriefTemplate?: {
    hookStructure: string;
    demoBeat: string;
    ctaPattern: string;
    lengthSec: number;
    productionStyle: "rough_authentic";
    disclosureRequired: true;
    budgetPerCreator: number;
    initialBatchSize: number;
  };
  rulesCited: string[];
}
\`\`\`

## Failure modes

- **Operator insists UGC pre-FMF.** Document override + predict outcome (likely $1-2k burned, low conversion).
- **Operator has FMF on X (textual) but asks about TikTok UGC.** Refuse — X FMF doesn't transfer to TikTok.
- **Showability is "unshowable" but operator asks anyway.** Refuse + cite rule 4. Suggest slideshow-Photo-Mode UGC as possibility (if niche supports + FMF data).
- **Operator wants "viral on demand" agency.** Cite Stronger's variant-testing approach — viral-on-demand is post-FMF systematization, not pre-FMF shortcut.

## Cost discipline

0 ScrapeCreators (read-only on existing reports). 0 WebFetches. 1 main_maya (low thinking — gate-checking). Heartbeat-safe. Timeout 5 min.

## Anti-slop check

Mostly structured refusals. \`refusalReason\` and \`gatesUnmet[].detail\` pass through \`maya-slop-critic\`. Banned: "scale up", "amplify the win", "synergize with paid", "double down on virality". Use plain operator-language: "we don't know what's working yet; paying creators to repeat an unknown is burning money."
`;

// Source: agents/skills/maya-gtm/maya-viral-demo-moment-miner/SKILL.md
const ENTRY_16_maya_viral_demo_moment_miner = `---
name: maya-viral-demo-moment-miner
description: Find showable app moments — before/after contrasts, screenshot sequences. Source: walkthrough + product UI.
---

# maya-viral-demo-moment-miner

## Purpose

TikTok / Reels / native LinkedIn video rewards a specific kind of moment: a UI change a stranger can comprehend in 2 seconds. Cal AI's "point camera at food → calories appear" is the textbook example (tiktok.md § 1). This skill mines the operator's product for those moments.

## When to invoke

- IF \`productDiagnosis.showability\` is screen-recordable or screenshot-only THEN run.
- IF channel-strategy chose TikTok / Reels / native-LinkedIn-video as primary THEN run.
- IF first demo video underperforms THEN re-run to find a different beat.
- IF a new feature ships THEN re-run.
- NEVER from heartbeat (multimodal walkthrough analysis is expensive).

## Required reads

1. APP.md, GTM.md.
2. PLAYBOOK.md § 3 step 1-3 (showability), § 5 Failure Mode 4 (demos must SHOW outcomes, not list features).
3. playbook/tiktok.md § 1, § 2, § 3 (faceless demo anatomy).
4. MEMORY.md.

## Decision rules

1. **The 10-second comprehension rule.** Every demo beat is a UI change a stranger can comprehend in <10 seconds without audio.
2. **Before/after > before-only.** Beats with explicit before→after framing rank higher.
3. **Output-object detection.** If product produces an interesting output standalone (image, video, code, doc), the output IS a demo beat.
4. **Mute-test.** Every beat readable with sound off (~85% of social video watched without sound initially).
5. **Hook moment in frame 1.** No "let me explain" intro. Demo opens with the action.
6. **Safe-zone awareness.** Bottom 250px / right 130px are TikTok UI overlay zones — de-rank beats with key UI there.
7. **3-beat minimum, 7-beat maximum.** Below 3 = nothing to mine; above 7 = over-shopping. Return top 5 by rank.
8. **Anti-feature-list.** "1. opens app, 2. shows dashboard" fails. Beats represent moments of *change* the viewer can react to.
9. **Pre-launch products.** IF \`app.stage === "pre-launch"\` AND only mockups exist THEN mark beats \`mockupOnly: true\` — fake-demo TikToks worked for Pushscroll but operator must disclose if asked.
10. **Citation-firewall.** Each beat describes a real observable change. If operator says "the app does X" but walkthrough doesn't show X, do NOT mine X. Mark \`unverifiable: true\`.

## Output schema

\`\`\`ts
interface ViralDemoBeatLibrary {
  beats: Array<{
    beatId: string;
    label: string;
    sequence: Array<{ tSec: number; visualState: string; uiChange: string; muteReadable: boolean }>;
    durationSec: number;
    beatType: "before_after" | "demo_cold_open" | "output_reveal" | "pattern_interrupt";
    hookRank: number;
    safeZoneOk: boolean;
    mockupOnly: boolean;
    unverifiable: boolean;
    sourceFrame?: string;
    recommendedHookCatalog: string;
  }>;
  rejectedCandidates: Array<{ candidate: string; reason: string }>;
  overallShowabilityVerdict: "rich" | "thin" | "unshowable";
  rulesCited: string[];
}
\`\`\`

## Failure modes

- **No walkthrough + thin landing page.** \`status: "walkthrough_required"\`. Operator intake: "Record one 30-second screen recording of you doing the single thing that makes a user say 'oh'."
- **All candidates fail mute-test.** Product is voice/audio-dependent. Recommend founder-talking-head (tiktok.md rule 8).
- **All candidates are dashboards.** Dashboards-with-numbers don't perform on TikTok. \`overallShowabilityVerdict: "thin"\`, recommend slideshow Photo Mode.
- **Multimodal extraction worker 409.** Fall back to screenshot-only. Mark \`multimodalDegraded: true\`. No fabrication.

## Cost discipline

0 ScrapeCreators. 1 extraction_worker pass over walkthrough if available. 1 main_maya synthesis. Timeout 15 min.

## Anti-slop check

\`label\` and \`uiChange\` strings go to demo-strategist + format-miner. Run \`maya-slop-critic\` (banned-phrase scan). Specifically banned: "seamlessly", "magically", "instantly transforms", "effortlessly". Describe literal UI change in operator's vocabulary.
`;

// Source: agents/skills/maya-gtm/maya-x-founder-led-researcher/SKILL.md
const ENTRY_17_maya_x_founder_led_researcher = `---
name: maya-x-founder-led-researcher
description: Find X founder-led conversations, reply targets, hooks worth modeling, and accounts worth a private List.
---

# maya-x-founder-led-researcher

## Purpose

For technical / indie / B2B SaaS / dev-tool products, X is the highest-leverage cold-start channel — but ~80% of pre-1K-follower acquisition comes from replies, not posts (x.md § 3). This skill finds buyer-intent reply targets, models hook patterns, and proposes a 20-40-handle private List.

## When to invoke

- IF channel-judge is considering X (primary or secondary) THEN run.
- IF \`icpHypotheses[].locatableOn.channel === "x"\` THEN run.
- IF operator follower count <1K AND they ask "should I post a thread?" THEN run to surface reply targets.
- NEVER auto-post (x.md § 8 / rule 14).

## Required reads

1. APP.md, GTM.md.
2. PLAYBOOK.md § 3 step 4, § 4 (X is 20/70/10), § 7 affinity.
3. **playbook/x.md — MANDATORY full read.** Cite x.md § 10 rules in every recommendation.
4. MEMORY.md.

## Decision rules

1. **x.md rule 1.** Target buyer consumer/lifestyle/local → demote X to secondary. Push to TikTok/IG.
2. **x.md rule 2.** Dev-tools/B2B SaaS/AI → X primary, especially below $5K MRR.
3. **Follower-phase routing.** <100 followers = Phase 1 reply-guy routine (x.md § 4). 100-500 = Phase 2 (1 build-update/day + replies). 500+ = launch ramp.
4. **x.md rule 10 reply-target quality bar.** ≥5 likes on OP tweet, <48h old, OP has >50 followers, OP not a bot. Skip if any miss.
5. **Sweet-spot timing.** Prefer 10-50 likes, <6h old, <20 existing replies (x.md § 3).
6. **x.md rule 9 first-reply NO-URL.** No URL in first reply. URL goes in follow-up if OP engages.
7. **Three-paragraph reply structure required.** Validation → value-add → soft mention. Product mention in paragraph 1 = regenerate.
8. **List composition.** 20-40 accounts in niche, 5K-100K followers each, posting weekly+. From x.md § 1 + ScrapeCreators discovery. Do NOT auto-follow.
9. **Hook modeling.** Pull 3-5 high-engagement hooks; map to x.md § 5 (1-15). Reject if matches anti-patterns (§ 7) or hype-language (rule 11).
10. **Black-Magic platform-risk reminder.** IF operator's product depends on free X API access THEN \`platformRiskWarning: true\` (x.md § 11 Failure 4).
11. **Account silence recovery.** IF \`lastPostAgeDays > 7\` THEN first action = value-add reply, not build-update post.
12. **Citation-firewall on numbers.** Every number Maya quotes must come from a fresh ScrapeCreators call or operator-confirmed state.

## Output schema

\`\`\`ts
interface XResearchReport {
  phase: "phase_1_reply_guy" | "phase_2_in_public" | "phase_3_launch_ready" | "warmup_required";
  channelVerdict: "primary" | "secondary" | "parked";
  channelVerdictReason: string;
  replyTargets: Array<{
    tweetUrl: string;
    authorHandle: string;
    authorFollowers: number;
    likes: number;
    ageHours: number;
    existingReplies: number;
    opText: string;
    matchesIcp: string;
    draftReply: { p1: string; p2: string; p3SoftMention: string };
    urlInFollowupOnly: true;
  }>;
  hookExamples: Array<{ tweetUrl: string; handle: string; likes: number; hookText: string; pattern: string; whyItWorks: string }>;
  recommendedList: Array<{ handle: string; nicheFit: string; followerCount: number; postingCadence: "daily" | "weekly" | "monthly"; source: "x.md-anchor" | "scrapecreators-discovery" }>;
  searchQueries: string[];
  platformRiskWarning?: boolean;
  parkReasons?: string[];
}
\`\`\`

## Failure modes

- **Operator <100 followers + wants a launch thread.** Refuse. Return Phase 1 routine + ClearNoteLab failure citation (x.md § 11 Failure 1).
- **Niche has no English-language activity on X.** Park. Surface to channel-judge.
- **All reply targets are from other founders.** Skip-launch risk. Re-query with sharpened ICP probes.
- **ScrapeCreators X endpoints fail.** Fall back to \`mvanhorn/xai\` Grok search if budget allows. Cap Grok at 5 calls/user/day.

## Cost discipline

Max 6 ScrapeCreators calls. Grok max 3 calls if invoked. 1 hard_research_beta + 1 main_maya. Timeout 15 min.

## Anti-slop check

Every \`draftReply.p1/p2/p3SoftMention\` MUST pass \`maya-slop-critic\` before this skill returns. Specifically ban hype emoji, "Great post!" / "So true!", "Excited to share". Mirror operator's last-5 authentic-post voice.
`;

export const BUNDLED_LOCAL_SKILLS: readonly BundledLocalSkill[] = [
  { slug: "maya-app-inspector", workspacePath: "skills/maya-app-inspector/SKILL.md", body: ENTRY_0_maya_app_inspector },
  { slug: "maya-approval-publisher", workspacePath: "skills/maya-approval-publisher/SKILL.md", body: ENTRY_1_maya_approval_publisher },
  { slug: "maya-calendar-plan-builder", workspacePath: "skills/maya-calendar-plan-builder/SKILL.md", body: ENTRY_2_maya_calendar_plan_builder },
  { slug: "maya-calendar-populator", workspacePath: "skills/maya-calendar-populator/SKILL.md", body: ENTRY_3_maya_calendar_populator },
  { slug: "maya-channel-strategy-judge", workspacePath: "skills/maya-channel-strategy-judge/SKILL.md", body: ENTRY_4_maya_channel_strategy_judge },
  { slug: "maya-competitor-researcher", workspacePath: "skills/maya-competitor-researcher/SKILL.md", body: ENTRY_5_maya_competitor_researcher },
  { slug: "maya-content-format-miner", workspacePath: "skills/maya-content-format-miner/SKILL.md", body: ENTRY_6_maya_content_format_miner },
  { slug: "maya-distribution-motion-tester", workspacePath: "skills/maya-distribution-motion-tester/SKILL.md", body: ENTRY_7_maya_distribution_motion_tester },
  { slug: "maya-icp-hypothesis", workspacePath: "skills/maya-icp-hypothesis/SKILL.md", body: ENTRY_8_maya_icp_hypothesis },
  { slug: "maya-linkedin-fit-researcher", workspacePath: "skills/maya-linkedin-fit-researcher/SKILL.md", body: ENTRY_9_maya_linkedin_fit_researcher },
  { slug: "maya-reddit-demand-researcher", workspacePath: "skills/maya-reddit-demand-researcher/SKILL.md", body: ENTRY_10_maya_reddit_demand_researcher },
  { slug: "maya-results-reviewer", workspacePath: "skills/maya-results-reviewer/SKILL.md", body: ENTRY_11_maya_results_reviewer },
  { slug: "maya-slop-critic", workspacePath: "skills/maya-slop-critic/SKILL.md", body: ENTRY_12_maya_slop_critic },
  { slug: "maya-tiktok-demo-strategist", workspacePath: "skills/maya-tiktok-demo-strategist/SKILL.md", body: ENTRY_13_maya_tiktok_demo_strategist },
  { slug: "maya-tiktok-format-researcher", workspacePath: "skills/maya-tiktok-format-researcher/SKILL.md", body: ENTRY_14_maya_tiktok_format_researcher },
  { slug: "maya-ugc-system-advisor", workspacePath: "skills/maya-ugc-system-advisor/SKILL.md", body: ENTRY_15_maya_ugc_system_advisor },
  { slug: "maya-viral-demo-moment-miner", workspacePath: "skills/maya-viral-demo-moment-miner/SKILL.md", body: ENTRY_16_maya_viral_demo_moment_miner },
  { slug: "maya-x-founder-led-researcher", workspacePath: "skills/maya-x-founder-led-researcher/SKILL.md", body: ENTRY_17_maya_x_founder_led_researcher },
];
