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
description: After deep-research subagents land target threads + accounts + drafts, generate the rolling 7-day plan (today through Sunday) of calendar events on Google Calendar (provisional, status="draft") mapped to the operator's current phase of the PLAYBOOK 4-phase arc. Each event links to a target thread + draft + cites the playbook rule. Not a 14-day dump — a tight rolling week, regenerated weekly.
---

# maya-calendar-populator

## Purpose

The deep-research subagents (reddit_research, x_research, etc.) surface specific target threads + accounts + drafts. This skill turns those raw artifacts into a real **calendar** — the rolling next 7 days (today→Sunday) of scheduled, time-blocked work the operator can actually do, regenerated each week (NOT a 14-day dump). Each event has a title, what-to-do, link to the target thread/draft, success metric, why-it-matters citation.

Without this skill, the target list lives in the database and nobody acts on it. With it, the operator opens Google Calendar and sees their week.

## When to invoke

- IF deep-research subagents have just completed AND \`/lc_gtm/get_my_target_threads\` returned >0 rows THEN run. This is the canonical first invocation, right at the end of FIRST WAKE.
- IF weekly review (\`gtm_weekly_review\` cron) ran AND new target threads were surfaced THEN regenerate the rolling next 7 days (today→Sunday).
- IF format-market-fit detected (Phase 4 cadence change) THEN re-balance the cadence (more metric posts, fewer build updates, etc.).
- IF operator approves a draft via Telegram THEN that drafted_content's calendar event flips from \`draft\` → \`scheduled\` (and gets pushed to Google Calendar via Sprint 9).

## Required reads

1. **PLAYBOOK.md § 2** — The 4-Phase Launch Sequence (Phase 1 cold-start / Phase 2 soft launch / Phase 3 hard launch / Phase 4 compound). Determines the SHAPE of the rolling 7-day plan.
2. **PLAYBOOK.md § 4** — BUILD / ENGAGE / OFFER triad ratios. Determines the MIX of event kinds per platform.
3. **APP.md + USER.md** — product context, week goal, operator constraints (canPostTikTokManually, canShowFace, etc.).
4. **GTM.md** — active channel picks. Only generates calendar events for primary + secondary channels.
5. **Per-platform playbook**: \`playbook/reddit.md\`, \`playbook/x.md\`, etc. for time-window + frequency rules per channel.
6. **Target list** via \`GET /lc_gtm/get_my_target_threads\` — the raw material. Top 30 by priorityScore.
7. **Optionally** \`GET /lc_gtm/get_my_target_accounts\` for follow-and-engage events.

## Decision rules

### 1. Phase detection — what week are we in?

Phase is determined by the STRONGER signal of two inputs:

**Stage signal (from APP.md \`stage\`):**
- \`prelaunch\` → Phase 1 (cold-start)
- \`live-beta\` → **Phase 2 (active launch)** — REGARDLESS of creator account age
- \`live\` AND week-goal IN (signups, users, revenue) → **Phase 2 (active launch)**
- \`live\` AND week-goal = "compound" → Phase 4 (sustaining)

**Date signal (from \`creator.createdAt\`):**
- Day -30 to Day -1 → Phase 1
- Day 0 to Day 7 → Phase 2
- Day 7 to Day 14 → Phase 3 (hard launch anchor)
- Day 14+ → Phase 4

**The stage signal wins when they conflict.** An operator who says "I am in live-beta trying to get signups" is in active-launch mode even if the agent was created today. Account age is a heuristic; stated stage is fact.

Phase definitions:
- **Phase 1 (cold-start)**: account warmup + audience building. *If primary channel's audience minimum (PLAYBOOK § 2) is NOT met, stay in Phase 1.* No promotional posts. Heavy on engagement_block + warmup_block.
- **Phase 2 (active launch)**: the operator HAS a product they want signups for. Aggressive multi-channel cadence per § 3. Daily X build-in-public, near-daily Reddit/HN engagement, soft_launch_post + reply_window mixed.
- **Phase 3 (hard launch anchor)**: ONE Tuesday hard_launch_anchor + first_50_dms blocked the day before + reply_window events in the 2-hour engagement window after the anchor.
- **Phase 4 (compound)**: sustained weekly cadence — 1 metric post + 2 build-update/insight + 1 demo + reply-mining 4-5 days/week.

### 2. Per-platform cadence — research-backed numbers (2026)

The PRINCIPLE everywhere: replies + native engagement compound 5-150x faster than original posts. Heavy on engagement, original posts kept high quality.

**Reddit** ([source](https://www.teract.ai/resources/reddit-subreddit-marketing-2026), [source](https://getupvotes.com/reddit-self-promotion/)):
- 9:1 ratio (Reddit's actual published rule — 1 promotional post per 9 non-promotional contributions). Active marketers tilt toward 95:5.
- Karma floor: 100 (unlocks ~80% of subs), 500 ideal (~90%). If operator under 100, all events default to engagement_block + comment-reply only.
- Frequency: at least 7-14 days between promotional posts in the same subreddit. Newer accounts wait 2-3 weeks.
- Post-time windows: Tue/Wed/Thu 8-11am ET. Mandatory 2-hour engagement window block immediately after any post.
- Designated promo threads: r/Entrepreneur Monday, r/SaaS Saturday, r/SideProject daily, r/IMadeThis daily.
- Phase 2 weekly cadence: **5-7 comment-reply events** (in target subs, substantive, no product mention) + **1 original substantive post** in r/SideProject (or operator's bet sub) + **6-8 engagement-block lurk slots** for opportunistic replies. = 12-16 Reddit events/week.

**Hacker News** ([source](https://www.myriade.ai/blogs/when-is-it-the-best-time-to-post-on-show-hn), [source](https://syften.com/blog/hacker-news-marketing/)):
- Show HN: ONE per project, one-shot. Best windows Tue/Wed/Thu 14:00-17:00 UTC (7-10am PT / 10am-1pm ET); contrarian: Sun midnight PT (lower competition).
- Breakout threshold: 30+ votes. Below = invisible to most.
- Comments any weekday — engaging on others' Show HN / Ask HN threads is high-leverage. Aim for substantive (no plug) comments where your expertise applies.
- 72h post-launch window is critical: reply to every comment, every upvote.
- Phase 2 weekly cadence: **4-6 HN comment events** (on relevant Show HN / Ask HN threads in the niche) + (when ModelHub is ready) **1 Show HN launch** in week 3-4 (NOT week 1).

**X / Twitter** ([source](https://www.tweetarchivist.com/how-often-to-post-on-twitter-2025), [source](https://posteverywhere.ai/blog/how-the-x-twitter-algorithm-works)):
- Optimal frequency: **3-5 posts per day** for accounts under 5K followers (build-in-public mode). Reply weight is 150x like weight in 2026 algorithm.
- Reply that gets a reply from the author: +75 ranking weight (vs +0.5 for a like).
- "30 minutes after posting are sacred engagement time" — block immediately after each post.
- Best post windows: Tue morning operator-tz 8-10am for build-in-public threads; daily 5pm-7pm for reply-mining other founders' threads.
- Quality > volume — 3-5 high-engagement posts beats 10 low-engagement (low-engagement damages authority score and reduces future reach).
- Phase 2 weekly cadence: **1 build-in-public post per day = 7/week** + **4-5 reply-mining slots/week** (15-30 min each, finding 5-10 conversations to add to per slot) + **2 longer-form threads per week** (Tue/Thu mornings, 4-6 tweets, on a learning or decision from the week). = 13-14 X events/week.

**LinkedIn** ([source](https://buffer.com/resources/how-often-to-post-on-linkedin/), [source](https://pipelineroad.com/agency/blog/saas-linkedin-marketing)):
- Optimal frequency: **3-5 posts/week**. Diminishing returns past 5 — 5th post gets 60% of 1st's engagement, 7th post 30%.
- Best windows: Tue-Thu 7-8:30am local. Tue/Wed = highest. Friday -20-30% below midweek. Weekends dead for B2B.
- Engagement format: text-only outperforms images on LinkedIn (counterintuitive). Native video performs much better than external video links. PDF carousels = strong dwell time.
- Founder posts about product-development process = 3.4x engagement of third-party industry reports. Employee content = 8x company-page content.
- Hashtags: 3-5 niche. Reply to every comment within first hour.
- Phase 2 weekly cadence: **3 posts** (Tue + Thu + one flex day, founder build-in-public format) + **2-3 comment-engagement slots/week** (15 min, reply on others' posts in niche). Only schedule if LinkedIn is a bet channel.

**TikTok** ([source](https://joinbrands.com/blog/how-often-to-post-on-tiktok/), [source](https://monolit.sh/blog/tiktok-algorithm-how-it-works-for-business-accounts-2026)):
- Optimal frequency: **4-6 per WEEK** for business accounts (not per day — that's a consumer-FYP fallacy). Quality compounds faster than volume.
- Save + share weighted higher than like or comment in 2026. Tutorial/checklist/data-backed formats save best.
- Niche consistency: 3+ unrelated topics = -45% reach. Stay focused on one persona.
- Best windows: 7-9am + 6-9pm local audience time.
- Phase 2 weekly cadence: **4 posts/week** ONLY IF \`canPostTikTokManually === true\` AND \`tiktokWarmupState === "ready"\`. Otherwise: 0 TikTok events (skip channel; do warmup separately).

**Instagram**:
- Reels for reach. Save rate = primary metric (algorithm weights saves > likes).
- Phase 2 weekly cadence: **2-3 Reels/week** ONLY IF \`canPostInstagramManually === true\`. Carousels (10-slide educational) for save rate.

### 3. Slot allocation — how many events per channel per phase?

**Phase 1 (warmup)** — operator has no audience yet:
- Primary channel: 5-7 reply_window + 2-3 engagement_block. **NO posts.**
- Secondary channel: 3-4 reply_window + 1-2 engagement_block.
- Total: ~10-15 events/week. All passive-engagement.

**Phase 2 (active launch — the high-velocity week)** — operator has product, wants signups:
- Primary channel: **per § 2 numbers above for the specific channel.**
- Secondary channel: half of primary.
- Tertiary (X build-in-public ALWAYS, if operator can write): 1 post/day + 4-5 reply-mining/week.
- 1 weekly_review (Sun or Mon, 30 min).
- **Total target: 18-25 events for the week.** Sub-15 = under-prescribed. Over-30 = unrealistic for a solo founder.

**Phase 3 (hard launch)**:
- 1 hard_launch_anchor (Tuesday primary channel) + 2-3 reply_window in the engagement window + 1 first_50_dms (Monday) + 1-2 X threads pre-anchor + 4-5 reply-mining/week.
- Total: ~10-12 events centered on the anchor week.

**Phase 4 (compound)**:
- Primary: 1 metric + 2 build/insight + 1 demo + 4-5 reply_window/week + 1 weekly_review.
- X build-in-public: 1 post/day continues.
- Total: ~12-15 events/week sustained.

### 3a. Channel-tier rule for active-launch mode (Phase 2/3)

For ModelHub-class products (dev tool, niche audience, founder-led):
- **Primary** = whichever channel has highest channelScorecard \`audienceFit + cadenceFit\` AND operator has voice match for. Typically Reddit for dev tools.
- **Secondary** = next-best. Typically HN for dev tools.
- **Tertiary build-in-public** = **X is the always-included build-in-public channel** UNLESS operator explicitly excluded X. Daily founder cadence happens here regardless of primary/secondary.
- **LinkedIn** = scheduled ONLY if explicitly a bet channel.
- **TikTok / Instagram** = scheduled ONLY if \`canPostTikTokManually\` / \`canPostInstagramManually\` true AND warmup ready.

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
- the rolling 7-day calendar is exclusively warmup_block + engagement_block + reply_window (replies allowed during warmup if they're substantive, not promotional) — the warmup PERIOD still runs its full 2-4 weeks; we just plan it a rolling week at a time
- Maya signals to user: "We're in warmup. No public product mentions yet. Tomorrow's first task is X."

### 8b. Hard-launch / Show HN preconditions (HARD GATE — kills the 48h-cold-launch bug)

**NEVER emit a \`hard_launch_anchor\` or a Show HN event until ALL THREE preconditions pass.** A cold launch into a tiny audience is a guaranteed void (PLAYBOOK rule 9.8) — it burns the one-shot launch moment. Before slotting either:

1. **Account maturity** — \`creator.createdAt\` is old enough that the account isn't brand-new, AND warmup is done (TikTok \`tiktokWarmupState === "ready"\` for TikTok; for Reddit/HN/X/LI the account has real history, not days-old). A <48h-old account launching this week → NO. Tell the operator: "your accounts need to warm up first — here's this week's warm-up plan; we launch once you've got a baseline."
2. **Audience floor** — the primary channel's Phase-1 audience minimum (PLAYBOOK § 2) is MET. No floor → stay in warmup, don't launch into the void.
3. **Days-in-phase** — the operator has actually spent the soft-launch (Phase 2) time building credibility; we don't skip Phase 2. (Manager-mode founders with an existing warmed audience can clear 1+2 immediately — judgment, not a fixed timer.)

If any precondition fails, do NOT slot the launch; slot the warm-up/soft-launch work that earns it, and say so plainly. **This gate is also re-checked at publish time** (\`publishApprovedDraft\`) — a launch draft that reaches publish without preconditions met is blocked, not posted.

### 8c. The launch bundle (one approval-gated unit, never a lone post)

A hard launch ships as ONE coordinated, approval-gated bundle — not a single anchor post:
- **5-piece launch kit** — the anchor post + the supporting assets (e.g. the demo/proof artifact, the first-comment context, the cross-post variants, the reply-ready FAQ). Drafted together.
- **first_50_dms** — the warm-outreach block the day before, so the launch doesn't drop into silence.
- **staggered multi-channel** — the anchor + the same-day cross-posts/threads, time-staggered, as one unit.

Maya proposes the whole bundle for approval (per the strategy approval gate); the operator approves once, and it executes as a unit. Launches are **proposed + approved, never auto-scheduled**.

### 8d. 72-hour post-launch engagement window (auto-seed + auto-diagnose)

When a \`hard_launch_anchor\` is published, auto-seed the **72h engagement window**: reply_window + engagement_block events across the next 72h so the operator stays in the thread (the #1 launch-failure cause is post-and-pray, PLAYBOOK rule 9.29). At T+24h, check engagement: if it's **<1%** (a void by rule 9.8 — reached only the founder circle), do NOT recommend doubling down with paid promotion. Auto-flag a **reposition/replan**: the format or positioning is wrong, not the distribution — retry with a different angle in ~14 days (hand to maya-results-reviewer's positioning-vs-distribution diagnosis).

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
- **Phase 1 floor unmet on ALL channels.** Pure warmup mode — the rolling 7-day plan is all warmup. Maya is explicit that the warmup PERIOD runs longer: "Your accounts need 2-4 weeks of warmup before launch. Here's this week's plan."
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

The operator's competitors are also their best lead sources. Users complaining about competitor X are pre-qualified buyers for product Y. This skill maps the substitute landscape, mines complaint patterns, ranks by switch-intent and complaint acuteness, and feeds reply-target candidates back to platform-specific researchers.

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
5. **Channel-segmented mining.** Reddit (subreddit reviews + r/SaaSAlternatives + dedicated product subreddits), X (frustration tweets + reply mining), App Store reviews (mobile), G2/Capterra/Trustpilot (B2B), LinkedIn comments on competitor posts. For each source, mine RECENCY-sorted first — a complaint that appeared two weeks ago is far more actionable than the "helpful" review from 2021.
6. **Complaint-quality judgment over complaint count.** Don't gate on a fixed complaint count. Judge whether each complaint cluster carries acute switch-intent: does the user express urgency, frustration with a specific workflow blocker, or active searching for alternatives? A single acute complaint thread ("I'm evaluating switching right now") outranks many low-stakes gripes ("could be a bit nicer"). Rank patterns by acuteness + switch-intent, not raw volume.
7. **Complaint velocity / trend awareness.** For each pattern, judge whether the complaint is accelerating: same subreddit or product review page seeing increasing frequency month-over-month? Trend direction matters — a pain accelerating in recency-sorted reviews is a better fishing hole than a stable old complaint. Flag \`trendDirection: "rising" | "stable" | "declining" | "unknown"\` per pattern based on your best judgment of the evidence.
8. **Reddit comment-tree descent.** Never stop at the top-level post. Descend into comment trees: the most actionable quotes are usually in replies where the OP explains what they tried, what broke, and what they switched to. Descend at least 2 levels. If a comment thread is visibly long and the parent post is complaint-shaped, paginate / load more until you've read the branching path where alternatives are discussed.
9. **Pricing-complaint surfacing.** "Too expensive" is the #1 switcher signal. Tag pricing complaints separately. For pricing complaints also check whether recent price changes (plan restructuring, seat-pricing shifts) have triggered a spike — that is a time-bounded wedge window.
10. **Don't name competitors in operator drafts.** reddit.md rule 8.18. Reply drafts say "the dominant tool in this space" or describe the category.
11. **Substitute → ICP feedback loop.** If substitute is "spreadsheets", ICP includes "currently using spreadsheets" — pass to icp-hypothesis.
12. **Follow the substitute chain.** If the dominant substitute is a workaround tool (Notion, spreadsheets, Airtable), don't stop at the competitor. Also mine that workaround tool's own complaints in the same niche — those users are also switchable and may not know the operator's category exists. Each link in the chain is its own complaint source.
13. **Competitor sentiment direction.** For each named competitor, form a directional read: is their NPS/review trajectory improving or worsening? Product updates that remove features, pricing restructures that anger long-term users, or viral complaint threads are all signals that sentiment is trending negative — meaning the fishing hole is actively getting better. Document what you found that supports the direction call.
14. **No fabricated complaints.** If search returns thin, \`confidence: "weak"\`. No training-data filling.

## Output schema

\`\`\`ts
interface CompetitorReport {
  substitutes: Array<{ name: string; tier: "direct_saas" | "adjacent_tool" | "status_quo_workaround"; pricingBand?: string; channelPresence: string[] }>;
  complaintPatterns: Array<{
    pattern: string;
    competitorName?: string;
    switchIntentRank: number;           // 1 = highest. LLM judgment of switch-intent + acuteness, not raw frequency
    acutenessNote: string;              // one-sentence judgment of why this pain is acute or switchable
    trendDirection: "rising" | "stable" | "declining" | "unknown";
    trendEvidence: string;              // what you actually saw that informed the direction call
    sampleCards: Array<{ sourceUrl: string; channel: "reddit" | "x" | "appstore" | "g2" | "linkedin" | "google_search"; userQuoteVerbatim: string; ageDays: number; commentDepth?: number }>;
  }>;
  pricingComplaintCount: number;
  pricingTrendNote?: string;            // any evidence of recent pricing changes that spiked complaints
  substituteChain: Array<{ toolName: string; tier: string; chainedFrom: string; complaintSummary: string; }>;
  switcherSignals: Array<{ competitorName: string; queryProbe: string; threadsFound: number; samplePostUrls: string[]; sentimentDirection: "worsening" | "stable" | "improving" | "unknown" }>;
  workaroundsInUse: string[];
  recommendedReplyHandoffs: Array<{ channel: "reddit" | "x" | "linkedin"; threadUrl: string; handoffTo: string }>;
  icpRefinements: string[];
  confidence: "high" | "medium" | "weak";
}
\`\`\`

## Failure modes

- **No competitors named, no substitutes detectable.** Run Google probe \`"alternative to {productCategory}"\`. If still empty, \`categoryNoveltyHigh: true\` — recommend HN/Show HN positioning.
- **ScrapeCreators returns zero across all channels.** Try broader category terms.
- **All complaints are 2+ years old.** Don't recommend reply targets from stale threads. Flag \`dataRecencyWeak: true\` and note what the freshest evidence you could find was.
- **Complaint trees are shallow.** If Reddit threads have locked comments or low reply count, supplement with App Store / G2 recency-sorted reviews for depth.

## Cost discipline

Max 15 ScrapeCreators calls to allow for comment-tree depth and substitute-chain extension: 2-3 Google search probes, 3-4 Reddit subreddit/post searches (including comment-tree fetches), 2 X searches, 1-2 App Store or G2 recency-sorted review fetches, 1-2 LinkedIn company-posts, 1-2 substitute-chain tool searches. 3-4 WebFetches. 1 hard_research_beta + 1 main_maya. Timeout 22 min.

## Anti-slop check

User-quotes-verbatim. Slop-critic NOT invoked on output. Pattern summary labels must be plain operator-language — not "value misalignment" / "ROI concerns" / corporate-speak. \`switchIntentRank\` ordering must be defensible from the verbatim quotes attached, not from abstract judgment alone.
`;

// Source: agents/skills/maya-gtm/maya-content-format-miner/SKILL.md
const ENTRY_6_maya_content_format_miner = `---
name: maya-content-format-miner
description: Extract reusable hook patterns, proof beats, CTA patterns from real competitor / niche content. Output is a remix kit for drafts.
---

# maya-content-format-miner

## Purpose

Don't write content from scratch. Mine what's already winning in the niche, extract the format skeleton, remix the operator's product into it (tiktok.md § 7 "format remix doctrine"). Emits hook templates + proof-beat structures + CTA patterns that downstream draft skills consume. NEVER ships final copy — that's the operator + slop-critic loop.

Winning means buyer conversation, not engagement theater. A pattern that generates "great post!" replies is worthless. A pattern that generates "where do I sign up" or "I've been struggling with exactly this — what's your process?" is gold. Every extraction decision flows from that distinction.

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

1. **Buyer-conversation validation over example count.** Before a pattern enters the library, judge whether its real example threads generated buyer conversation: replies that ask "how does this work", "where can I try this", "I have this exact problem" — or DM floods, "link in comments?" signals. A handful of examples that provably generated buyer conversations beats many examples that generated vanity praise. Vanity patterns ("this is so good!" "fire content!") are explicitly rejected regardless of how many examples exist.
2. **Verbatim hook capture.** Hooks recorded verbatim with source URL. No paraphrase, no "improved" version.
3. **Anti-slop on extraction.** Reject candidates that depend on banned phrases (PLAYBOOK § 6) or anti-pattern structures.
4. **Pattern-mode tagging.** Tag each: BUILD (post-shaped) / ENGAGE (reply-shaped) / OFFER (CTA-shaped).
5. **Channel-specific hook taxonomy.** Use the channel's own catalog (x.md § 5 1-15, tiktok.md § 2 a-j, reddit.md § 3, linkedin.md § 3).
6. **Proof beats separately from hooks.** A proof beat is a specific concrete claim ("$10K MRR in 3 weeks") — extract as substitution-slots.
7. **CTA taxonomy.** Catalog: search-by-name / pinned-URL-comment / DM-keyword / soft-DM / link-in-first-comment. Tag channel compatibility.
8. **Voice-fingerprint from reply threads, not just polished posts.** The real voice fingerprint lives where niche winners defend, clarify, or follow up in replies — not in the highly-edited top-level hook. Mine reply threads: how do they explain themselves when challenged? How do they handle "this doesn't work for me"? How do they follow up with someone interested? That's the authentic rhythm, sentence length, and vocabulary that built their audience. Capture it from replies, not just the hook post.
9. **Mimicry concentration judgment.** If most of the niche patterns trace back to one or two accounts, flag \`mimicryRisk: "high"\` and note who dominates. Don't gate on a fixed percentage — judge whether the pattern diversity is real or essentially one person's format spread across reposts.
10. **No final-copy generation.** Patterns + slots + examples, never final drafts.
11. **Style-exemplar capture (native-voice fidelity — Sprint I).** Separate from hook templates, capture **5-10 real, top-performing, HUMAN native posts verbatim** for the chosen channel — whole posts/replies that read like a real participant wrote them, not just extractable hook skeletons. These are few-shot **voice/register anchors** for \`maya-voice-matcher\` + drafting (cadence, vocabulary, length, format, how natives open and close). Distinct from \`hookPatterns[].realExamples\` (which prove a *pattern* won): exemplars are full-text register references. Match cadence/vocab/length/format; **never copy content.** Skip anything that reads templated/AI. Emit in \`styleExemplars[]\`. Honest framing: no platform AI-detector to dodge — the enemy is generic content the community ignores and the algorithm starves.
12. **Caption-craft per channel (Sprint I).** Roll up the channel's caption conventions into \`captionCraft\` so drafting has them inline. Encode each platform's native craft where relevant to the chosen channel: **TikTok** hook-line + small native hashtag set; **Instagram** story-shaped caption + one CTA; **YouTube** title = the CTR lever (curiosity/specific, front-loaded) + a description that does light SEO and carries the link; **Reddit** the title is everything; **X** the post text IS the caption; **LinkedIn** hook first line + link in first comment. Draw conventions from the captured exemplars, not generic advice.

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
    realExamples: Array<{
      url: string;
      verbatim: string;
      metrics: { likes?: number; views?: number; replies?: number };
      buyerConversationEvidence: string;    // what happened in the replies — buyer questions, DM floods, etc.
      vanitySignal: boolean;                // true if replies were primarily praise with no buyer signal
    }>;
    voiceFingerprint: string;               // captured from reply threads, not just the hook post
    voiceFingerprintSource: string;         // url(s) of reply threads where this fingerprint was drawn from
    buyerConversionJudgment: "strong" | "moderate" | "vanity" | "unknown";
  }>;
  proofBeats: Array<{ beatId: string; template: string; slots: string[]; realExamples: Array<{ url: string; verbatim: string }> }>;
  ctaPatterns: Array<{
    ctaId: string;
    template: string;
    channelCompatibility: { x: boolean; reddit: boolean; tiktok: boolean; linkedin: boolean; instagram: boolean };
    bannedOn?: string[];
  }>;
  rejectedPatterns: Array<{ reason: "vanity_engagement" | "slop_phrase" | "mimicry_concentration" | "banned_phrase" | "other"; description: string; exampleUrl?: string }>;
  mimicryRisk: "low" | "medium" | "high";
  mimicryNote?: string;                     // who dominates if mimicryRisk is medium/high
  /** 5-10 real, top-performing, HUMAN native FULL posts/replies captured VERBATIM
   *  for this channel — the few-shot voice/register anchors for maya-voice-matcher
   *  + drafting (distinct from hookPatterns.realExamples, which prove a pattern).
   *  Match cadence/vocab/length/format; NEVER copy content. */
  styleExemplars: Array<{
    url: string;
    verbatim: string;
    whyExemplary: string;                   // why this reads native to the channel/niche
    landedSignal: string;                   // engagement / standing that shows it landed
  }>;
  /** Per-channel caption conventions rolled up for inline use by drafting. */
  captionCraft: {
    channel: string;
    convention: string;                     // the channel's caption craft (e.g. YouTube title=CTR lever + SEO description; Reddit title-is-everything; X post-is-the-caption; LinkedIn hook + link-in-first-comment; TikTok hook-line + hashtags; IG story + CTA)
    antiPatterns: string[];
  };
  rulesCited: string[];
}
\`\`\`

## Failure modes

- **No patterns reach buyer-conversation threshold.** Flag \`confidence: "library_underweight"\`. Do not populate the library with vanity patterns as a fallback — an empty library is more honest. Request more example pulls targeting threads with high reply-to-like ratios, which correlate with discussion rather than passive consumption.
- **All examples from one creator.** \`mimicryRisk: "high"\`. Recommend operator build authority from scratch or pick a niche where format ownership is distributed.
- **Slop pattern detected.** Reject explicitly. Document in \`rejectedPatterns[]\`.
- **Reply threads unavailable.** If the platform or upstream data doesn't surface replies, note \`voiceFingerprintSourceLimited: true\` and flag that the voice fingerprint is inferred from post-level phrasing only — lower confidence.

## Cost discipline

0 new ScrapeCreators (consumes upstream researcher outputs). Up to 3 WebFetches if reply threads need to be loaded directly to validate buyer-conversation evidence. 1 main_maya synthesis. Timeout 12 min.

## Anti-slop check

Each \`template\` must pass \`maya-slop-critic\` on the template-skeleton itself — including the structural AI-tell pass (no tidy tricolons, "it's not X it's Y", em-dash cadence, uniform rhythm baked into a template). Real verbatim examples with banned phrases stay in \`realExamples\` (as evidence of what won) but DO NOT promote into templates. Every pattern in the final library must have \`buyerConversionJudgment: "strong" | "moderate"\` — patterns rated "vanity" or "unknown" are moved to \`rejectedPatterns[]\`. \`styleExemplars[].verbatim\` is a voice/register reference only — never copy an exemplar's content into a draft; drop any exemplar that itself reads templated/AI.
`;

// Source: agents/skills/maya-gtm/maya-continuous-research/SKILL.md
const ENTRY_7_maya_continuous_research = `---
name: maya-continuous-research
description: The daily research loop. Maya spawns per-channel workers for target threads, competitor moves, and niche pulse, watches them via native session tools, and stops the moment she has enough for a strong morning brief. Decides "thin day" honestly when signal is dead.
---

# maya-continuous-research

## Purpose

Foundation research builds the operating model. Continuous research feeds the daily cadence. Each cycle answers: are there new buyer-pain threads worth engaging with, did competitors ship anything important, is the niche moving (new sub, rising account, dying topic)? The skill is the framework for orchestrating + judging the continuous workers.

## When to invoke

- IF the morning-brief cron is about to fire AND last-research \`observedAt\` > 6h ago THEN spawn continuous workers.
- IF the operator pings Maya outside the cadence and the brief-data is stale (>4h) THEN spawn.
- IF a hot-alert HEARTBEAT condition fires (e.g., a competitor moved) THEN spawn targeted worker — not the full set.
- NEVER spawn during the engagement window of a queued T1 thread (avoid distracting Maya from time-sensitive action).

## Required reads

1. **GTM.md** — bet channels from the scorecard. Only spawn workers for bet=true channels by default. Maya may sweep a non-bet channel monthly for verification.
2. **APP.md** — pain framing, keywords, exclusion list.
3. **USER.md** — operator timezone, capacity (don't propose 5 events if they have 30 min).
4. **TOOLS.md** — \`/lc_gtm/target_thread\`, \`/lc_gtm/competitor_move\`, \`/lc_gtm/niche_pulse_signal\`.

## Native-tool orchestration

The same control-plane discipline as foundation:

1. \`sessions_spawn\` per-channel target-thread workers (\`reddit_continuous_worker\`, \`x_continuous_worker\`, \`hn_continuous_worker\`, etc.) with task strings containing API endpoints + return-shape (must include \`painQuote\`, \`postedAt\`, \`velocityScore\`, \`engagementWindow\` (the worker's read on whether the OP is still replying and new comments are still landing), \`authorContext\`, \`commentTreeSummary\`, \`audienceSize\`, \`recommendedAction\`, \`draftReply\`, \`tier\`). **Comment-tree mining is mandatory for Reddit + HN workers, and it goes deep.** The worker MUST descend the **full comment tree, including nested replies** (Reddit: fetch the \`/comments/<id>.json\` endpoint via ScrapeCreators or the public JSON, and follow \`replies\` down; HN: recurse \`kids[]\` on the Algolia HN item endpoint) — **do not stop at the top few comments.** The sharpest buyer language (someone restating the pain in better words, naming the competitor they're escaping, rejecting a workaround) usually sits *deeper* in the thread, not in the top-voted comments. Go as deep as it takes to be confident, then populate \`commentTreeSummary.mineableComments[]\` with the strongest comments scored against these kinds: \`buyer_intent\` (someone asked a follow-up the product answers), \`pain_restatement\` (re-articulates OP's pain in sharper buyer language), \`competitor_mention\` (specific competitor named, with \`competitorName\`), \`op_rejection\` (OP responded "tried that, didn't work"), \`high_velocity\` (a comment gaining traction unusually fast for the thread's age — Maya's judgment, never a fixed number). Workers without \`mineableComments[]\` on threads they tier T1/T2 get steered: "I need the comment-tree mining — descend the comments endpoint (all the way down, not just the top), score the strongest against the mining kinds, return as \`commentTreeSummary.mineableComments\`."
2. Spawn \`competitor_move_worker\` only if foundation \`competitiveMap\` is non-empty.
3. Spawn \`niche_pulse_worker\` once per day max (rate-limited at the prompt level — Maya checks \`gtmNichePulse.observedAt\` before spawning).
4. \`sessions_yield\`. Workers run.
5. Watch via \`subagents list\`. Kill anything stuck longer than its task warrants in Maya's judgment. Steer anything returning thin/wrong-shape output.
6. As \`gtmTargetThreads\` accumulate, decide "complete enough" against the gates below.

## The questioning loop — Maya audits every thread before it surfaces

**Workers POST target threads with their own judgment of why a thread fits.** Maya doesn't trust that on its face. She reads the actual \`painQuote\`, \`excerpt\`, \`currentMetrics\`, \`whyItFits\` fields and questions:

- *"You marked this T1, but the velocityScore is 0.3 likes/hour. Why is this a hot strike vs a substance reply?"*
- *"You drafted a reply that leads with the product. Did you read OP's actual question? Lead with the answer to what they asked."*
- *"This thread was posted 6 days ago. Why are you surfacing it as a reply target now? What's the engagement window?"*
- *"Your painQuote is paraphrased, not verbatim. Pull the exact sentence from the post body."*

Maya uses \`subagents action=steer\` to send pointed refinements. Workers re-extract from their existing context and re-POST. Maya re-reads. If satisfied → keep the thread. If steering doesn't help → drop the thread (don't surface low-confidence work to the operator). If a worker keeps producing slop after multiple steers → kill it and ship without its lane.

The morning brief contains ONLY threads Maya has personally vetted.

## Quality gates — what Maya is checking for

Judgment, not a score:

- **Thread depth gate** — every target thread has \`painQuote\` populated (verbatim from post body, not from title). If a worker writes a thread with \`painQuote: null\` or \`painQuote === title\`, steer with "I need the actual buyer-pain phrase from the post body, not the title."
- **Comment-tree mining gate (Reddit + HN)** — any T1/T2 thread MUST have \`commentTreeSummary.mineableComments[]\` carrying at least one *substantive* buyer signal (\`buyer_intent\`, \`pain_restatement\`, \`competitor_mention\`, or \`op_rejection\`). A thread whose only mined signal is \`high_velocity\` is loud but not necessarily a buyer conversation — it caps at T3 unless Maya sees a real reply angle. Threads where the worker only scraped OP + ignored comments are missing the most valuable intel. If a worker tiers T1/T2 with no mineable comments → steer: "descend the comments tree (all the way, not just the top), score the strongest against the mining kinds, re-POST". If still empty after 1 steer → drop to T3.
- **Freshness + engagement-window gate** — age matters (\`postedAt\` within ~7 days for substance plays, ~48h for engagement plays), but the sharper question is whether the thread is *still alive*: is the OP still replying, are new comments still landing? A 5-day-old thread where the OP is actively answering today beats a 12-hour-old thread that already went quiet. A thread that's gone cold (OP absent, comments stalled) drops to T3 even if it's recent — replying into a dead thread is theater.
- **Platform-norm gate** — HN Show HNs are competitor launches, not reply targets (Tier T4 automatic). Reddit hardware-budget threads are wrong buyer stage (Tier T3 max). X analyst takes with no buyer pain (Tier T4).
- **Author-quality gate** — \`authorContext.followerCount\` < 50 + zero post history = likely bot. Drop.
- **Coverage gate** — Maya looks at what landed across the bet channels and decides: is this enough good signal for today to be a "strong" day, or honest to call it "thin"? Never pad with low-tier threads to look busy.

## Tier assignment (Maya's call, no hardcoded thresholds)

Each surviving thread gets a tier based on judgment, not a score formula:

- **T1 Hot Strike** — fresh (<4h), high velocity, in bet channel, draft reply lands naturally, pain quote bites. Surface to morning brief with "hit in 30 min" calendar event.
- **T2 Substance Reply** — older but active, OP still engaging, draft reply adds real value. Surface with "reply by EOD" event.
- **T3 Lurk & Learn** — pain match present but no strong reply angle, or audience too small to matter. Stored for context, not surfaced.
- **T4 Trash** — fails platform-norm or author-quality. Stored for learning purposes (so the worker doesn't re-surface it) but never shown.

Write \`tier\` to each row via the \`/lc_gtm/target_thread\` re-POST (the mutation update path preserves prior fields you don't overwrite).

## Stop-and-ship signal

Maya stops the loop when she has enough good signal for an honest morning brief, OR when every spawned worker has returned/been killed. She judges "enough" against what the operator actually needs today — not a count.

If workers are still active but the signal so far is dead and re-spawning wouldn't change that, kill them and ship a thin-day brief. Don't burn budget waiting for signal that isn't there.

## Failure modes

- **Worker scrapes raw URLs and gets rate-limited.** Steer with "use api.scrapecreators.com / api.twitterapi.io / hn.algolia.com — never raw reddit.com / x.com." Re-spawn only if steering fails.
- **All workers return T3/T4 only.** Honest thin day. Morning brief leads with warmup + content-draft task instead of replies.
- **One worker dominates the lane.** If \`subagents list\` shows others have wrapped but one is still grinding past its useful budget in Maya's judgment, kill it. Lane unblocks immediately — proceed to synthesis with what you have.

## Cost discipline

Maya watches call volume vs value returned via \`gtmCostLedger\`. Per-channel workers route through ScrapeCreators / TwitterAPI.io / Algolia HN per \`TOOLS.md\`. Continuous research runs before the morning brief and on event-driven hot-alerts. Maya decides when to slow down — there's no fixed cap.

## Anti-slop check

Tier rationales are Maya's notes to herself in \`gtmActionLog\`, but if surfaced to the operator they must be plain ("active thread, OP is replying, draft has a real hook") — no "high-velocity high-engagement opportunity."
`;

// Source: agents/skills/maya-gtm/maya-distribution-motion-tester/SKILL.md
const ENTRY_8_maya_distribution_motion_tester = `---
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

// Source: agents/skills/maya-gtm/maya-evening-recap/SKILL.md
const ENTRY_9_maya_evening_recap = `---
name: maya-evening-recap
description: 8pm-local one-message recap. What got done, how it performed in numbers, what's carrying to tomorrow, what we cut. Reads gtmActionLog + gtmPostResults to ground every claim.
---

# maya-evening-recap

## Purpose

The bookend to the morning brief. The operator knows what they did today and how it landed — without scrolling through Telegram or remembering. This is where Maya proves the loop closed.

## When to invoke

- Native cron at 20:00 operator-local. Self-scheduled via \`cron add\` after foundation completes.
- NEVER from a heartbeat.

## Pre-conditions

1. Today's morning brief in \`gtmActionLog\` (the planned actions for today are known).
2. \`gtmPostResults\` checked for any owned posts shipped today — 72h performance tracking is already in flight.
3. \`gtmCalendarEvents\` for today checked — which ones were marked done? Which got skipped?
4. \`gtmActionLog\` filtered for any \`inbound_triage\` rows today (Maya helped triage replies).

## Required reads

1. **USER.md** — operator timezone.
2. **SOUL.md** — voice contract.
3. **memory/{today}.md** — Maya wrote \`Today's plan\` at morning_brief; she's now extending the same file with end-of-day sections.

## Write triggers (after send)

After Telegram delivery succeeds and \`/lc_gtm/action_logged\` has been posted, append these sections to \`memory/{today}.md\` using the OpenClaw filesystem tool:

1. **What got done** — bullet list of every event marked done (with the gtmPostResults numbers I cited).
2. **Operator interactions** — anything the operator sent me in chat today (approvals, push-backs, ad-hoc questions). One line per interaction.
3. **Notable observations** — threads that blew up unexpectedly, competitor moves I clocked, drafts that flopped vs landed.
4. **Tomorrow's adjustment** — what I'm changing for tomorrow's brief based on today's signal. THIS is the section morning_brief reads tomorrow.

If today's day-grade was Strong, also do a DREAMS.md write decision:
- If a pattern across ≥3 days now looks like it might be real but I don't have enough proof yet → append a row under \`Open hypotheses\` with date + the evidence I'd need before acting.
- If a previously-open hypothesis just got disconfirmed → strike it (replace with \`~~old text~~ — disconfirmed YYYY-MM-DD\`).

POST \`/lc_gtm/memory_written\` (idempotent uuid per write) after each successful write so Convex ledger tracks it.

If a write fails (filesystem error, disk pressure), recap is already delivered — log \`kind: "memory_write_failed"\` to action log and move on.

## The recap structure

As tight as Maya can make it while still useful. Three blocks:

### Block 1 — What got done (1-2 sentences, grounded) + the planned-vs-done tally

"You shipped the LocalLLaMA reply (got 3 upvotes in 90 min, OP hasn't replied yet) and posted the disk-bloat hook on X (12 likes, 2 replies)."

Numbers come from \`gtmPostResults\`. If results haven't propagated yet (Maya is checking < 4h after post), say so: "Numbers will be more solid in the morning."

**Daily-presence integrity (always run, even when it's awkward).** Tally today's planned calendar events vs what's marked done: "3 of 5 planned today." This keeps the founder honest without nagging.

- **Silence flag — the most important one.** If NOTHING got done today (0 of N), do not let it slide quietly. Name it plainly and ask one direct question: "Nothing shipped today — that's the thing that kills launches (absence, not bad posts). Was today just busy, or is something about the plan not working for you? Tell me and I'll adjust." Consistency is the whole job; a silent zero-day is the failure mode to catch early.
- **Bump missed priorities.** The highest-priority undone item carries to tomorrow's top slot (see "carried vs cut" below) — surface it: "Your top one from today (the Show HN warm-up comment) moves to first thing tomorrow."
- Don't moralize or pile on. One honest line, one question, then move on.

### Block 2 — Performance read (1-2 sentences)

Maya's interpretation: was this a good day? Use the same Strong / OK / Thin grade language.

- "Good day — the Reddit reply is performing better than your average reply."
- "Average — the X post is below your typical engagement; might be a timing miss."
- "Quiet day — neither post moved, niche feels slow right now."

If the day was thin/warmup, this block credits the warmup work ("you did the 10 min sub-warmup — that compounds").

### Block 3 — Tomorrow setup (1 sentence)

"Tomorrow I'm watching [X subreddit / account] — they posted a related thread tonight that should be hot by 9am."

If nothing's queued, say "Nothing queued yet — I'll scan again at 6am."

## What gets carried vs cut

For each calendar event today that wasn't marked done:

- **Carry**: T1/T2 events still in their freshness window. Push to tomorrow's morning brief with a note.
- **Cut**: anything where the thread aged out (past peak, no realistic engagement window left) or got buried (heavy newer comments since surfacing). Mark \`gtmTargetThreads.status = "expired"\`. Maya judges "aged out" vs "still active."

Recap mentions the cuts briefly only if they're meaningful ("Cut the second X reply — thread cooled overnight").

## Learnings extraction

After a strong-grade day, Maya checks if a pattern emerged worth saving as a learning:

- A clear pattern across multiple owned posts in the same channel at the same time-of-day, performing meaningfully above baseline → \`learning_extracted\` of kind \`timing\`. Maya decides when she has enough evidence to call it a pattern; one or two posts isn't.
- A specific community-handle keeps producing T1s → kind \`community_quality\`.
- A particular hook structure keeps landing → kind \`hook_pattern\`.

Don't manufacture learnings. One day of data is not a pattern. Maya only extracts when she has ≥3 evidence points AND the pattern is strong enough to confidently shift tomorrow's weighting.

POST to \`/lc_gtm/learning_extracted\` when triggering.

## Action-log write

POST to \`/lc_gtm/action_logged\`:

\`\`\`json
{
  "idempotencyKey": "<uuid>",
  "kind": "evening_recap",
  "summary": "Good day — 3 actions done, Reddit reply got 3 upvotes, X hook got 12 likes.",
  "linkedEntities": [<links to gtmActionLog rows for today's morning_brief + any draft_proposed>],
  "sentAt": <Date.now()>,
  "userResponse": "pending"
}
\`\`\`

If the operator replies to the recap with feedback ("the X angle didn't land — let's drop it"), Maya patches the morning_brief row's \`userResponse\` to \`acknowledged\` and writes a learning.

## Quality gate

\`maya-output-critic\` runs over the recap before send:

- Grounding — every number cites a \`gtmPostResults\` row or a calendar event ID.
- Voice — no "great work today!" or "way to crush it." Manager voice, not coach voice.
- Time-box — as tight as it can be while useful, operator reads on phone.

## Failure modes

- **Operator didn't act on the morning brief.** Recap acknowledges: "You didn't get to today's plan — anything I can adjust tomorrow?" Do not lecture. Do not pretend it didn't happen.
- **Post performance can't be scraped** (private profile, deleted, rate-limited). Note: "Numbers pending — will update in morning recap."
- **Multiple cuts.** If 3+ events got cut, the recap leads with that signal — "Today didn't hit. Refocusing tomorrow's plan."

## Cost discipline

0 ScrapeCreators if \`maya-continuous-research\` already updated post-results. 1 main_maya call (compose + critic). Sub-minute.

## Anti-slop check

Banned: "you crushed it," "great hustle today," "tomorrow we level up." Recap reads like a manager's end-of-day note to their report.
`;

// Source: agents/skills/maya-gtm/maya-foundation-research/SKILL.md
const ENTRY_10_maya_foundation_research = `---
name: maya-foundation-research
description: The onboarding + monthly deep-research pass. Maya orchestrates 5 parallel foundation workers (buyer map, competitive map, channel scorecard, content angles, relationship targets) using OpenClaw native session tools, decides when she has enough across the board, and persists synthesis to Convex.
---

# maya-foundation-research

## Purpose

The operating model. Before Maya can do daily work, she needs an answer to: who buys this, who else is in the market, where do the buyers live, what angles can the founder run from, and who should they build with over 90 days. This skill is the framework for spawning + supervising the 5 foundation workers and deciding when synthesis is complete enough to ship.

## When to invoke

- IF this is the very first wake AND \`gtmBuyerMap\` is empty for this agent THEN spawn the full foundation pass.
- IF a \`/lc_gtm/get_my_foundation\` GET returns \`buyerMap: null\` THEN spawn the full foundation pass.
- IF the monthly cron fires (1st of month, 6am operator local) THEN spawn the full foundation pass and announce diffs. **Also refresh PLATFORM_ALGO.md** (shared platform-algorithm intelligence): run a \`web_search\` pass per active platform for the current algorithm + what's-working, update its sections, and append a dated line to its Refresh log. This keeps format/timing/draft decisions current month-over-month.
- IF the operator pivots positioning ("we actually serve X now, not Y") THEN spawn refresh.
- NEVER invoke from a continuous heartbeat — foundation is a budgeted event, not a tick.

## Required reads

1. **APP.md** — product diagnosis (what we sell, who's it for).
2. **USER.md** — operator profile, voice, capacity, comfort zones (will they post video? cold DM?).
3. **GTM.md** — current strategic state (will be empty on first run; that's the cue to populate it).
4. **TOOLS.md** — the \`/lc_gtm/foundation_*\` endpoints, hookToken, API keys.
5. **PLAYBOOK.md § 6** — voice rules every drafted content angle must clear.

## Phase 0 — manager mode: start from their own accounts

Check APP.md "Entry mode" first. If **manager mode** (already-launched founder), before any niche research, ingest the founder's OWN existing accounts: pull each handle in APP.md/USER.md via the scrapecreators-api skill (their recent posts + engagement), and judge what's already working for THEM — which formats/angles/cadence land, where their audience already is, their actual voice. This is where you pick up; it seeds the buyer map, content angles, and the voice profile with real first-party signal instead of a cold start. In **launch mode**, skip this (glance at any existing handles for voice only) and build from the niche. If the mode is unresolved, pull their accounts if handles exist and use what you find to propose the mode at synthesis.

## Native-tool orchestration

The lifecycle uses OpenClaw native tools — **do not hand-roll watchdog state.**

1. \`agents_list\` to confirm the 5 worker agentIds exist in AGENTS.md: \`buyer_map_worker\`, \`competitive_worker\`, \`channel_worker\`, \`content_angle_worker\`, \`relationship_worker\`.
2. \`sessions_spawn\` 5 workers in parallel, each with a \`task:\` string containing: product context, API endpoint mandates (ScrapeCreators / TwitterAPI.io / Algolia HN — never raw curl on platform domains), and the specific \`/lc_gtm/foundation_*\` POST shape they must use.
3. \`sessions_yield\` and let them run. Check back via \`subagents list\` + \`sessions_history\`.
4. While they run, poll \`/lc_gtm/get_my_foundation\` to see what's landed.
5. As each worker completes or self-terminates (returns NO_REPLY), evaluate quality against the gates below.
6. If a worker has been in \`processing\` state for longer than the work warrants in Maya's judgment (a small buyer-map sweep shouldn't take as long as a deep competitive scan), \`subagents kill\` it. The lane unblocks immediately — verified from OpenClaw source.
7. If a worker returned thin output, \`subagents steer\` it with a refinement message — preserves accumulated context. Do not respawn unless steering fails.
8. Once Maya judges all 5 outputs meet the bar, announce synthesis to the operator via Telegram + write \`action_logged\` with kind=\`foundation_complete\`.

## The questioning loop — Maya is the boss, not a passive receiver

**Maya does not blindly accept worker output.** Every worker POST is a claim; Maya treats it as one. She reads what landed in Convex, looks at the actual data, and questions:

- *"Why did you call Ollama a 'direct' competitor? Show me the customer-complaint quotes you anchored that on."*
- *"Your buyer journey is missing the decision stage — you've shown me where buyers discover the pain and where they compare tools, but where's the evidence of buyers at the point of trying something new? What threads show buyers who just switched, just asked 'is X worth it', or just posted a win after making a move? I need 2-3 real URLs for that stage before I'll accept this map."*
- *"You marked Reddit as a bet channel. What threads did you scan? How recent? How many?"*
- *"Three trusted voices feels light for a niche this active. Steer to look harder."*

For each questionable claim, Maya uses \`subagents action=steer\` to send the worker a specific, pointed follow-up. Example:

\`\`\`
subagents action=steer target=<buyer_map_worker run id>
  message: "Your buyer map is missing buyerJourney stages — that
  field must not be empty. I need the full awareness → consideration
  → decision → advocacy path, each stage grounded in 2-3 real URLs
  + verbatim quotes from buyers at that stage. Focus especially on
  decision-stage evidence: threads where buyers are close to trying
  something new, comparing options, or reporting they just switched.
  Those are the signup-path moments this product needs to show up in.
  POST a refined buyer_map with all journey stages populated when done."
\`\`\`

Worker reads the steer, re-extracts from its existing research (no new API budget), refines the POST. Maya re-reads. If satisfied → accept that piece. If still thin → steer again. If a worker fails to converge after a few rounds → ship that piece with the gap surfaced honestly to the operator ("competitive map's substitute behaviors are still thin — I'll watch and refine over the first week").

**The operator hears NOTHING until Maya is convinced the research reflects reality.** She is the editorial gate, not the post office.

## Quality framework — what Maya is checking for

This is Maya's judgment, not a checklist. Numbers below are not thresholds — they're context for what "useful" looks like. Apply judgment to your specific niche.

- **Buyer map** — \`icpDescription\` reads like a specific person, not a category. **Buyer journey stages are mandatory — a buyer map without them is incomplete and Maya will steer until they exist.** Journey must cover the full path to a converted signup: awareness (buyer first feels the pain), consideration (buyer actively looks for solutions), decision (buyer is close to trying something new), and advocacy (buyer tells others). Each stage must be grounded in 2-3 real cited quotes and URLs showing buyers at that stage — actual thread excerpts where you can see the buyer's mindset, not paraphrase. Intent phrases are real phrases buyers say (not paraphrased). Trusted voices are accounts with verifiable handles + platforms.
- **Competitive map** — covers the direct competitors a buyer would seriously evaluate, plus the substitute behaviors / adjacent tools they default to today. Every complaint quotes a real post + URL. Note which competitor pain threads are accelerating — a complaint volume that was thin six months ago but is now a flood is a wedge signal, and Maya should call it out explicitly in synthesis.
- **Channel scorecard** — rates the channels worth rating for this product. Bets are channels with both audience-fit and operator-cadence-fit, justified in \`uniqueUnlock\`. Maya picks the bet count — usually small.
- **Content angles** — enough angles that the operator can run for weeks without repeating, each grounded in a specific quoted pain + URL. Hook variants are in the operator's voice (verify against USER.md).
- **Relationship targets** — specific accounts worth building with over 90 days. Mix of cadences. **This lane is not optional — a zero-target output means the worker did not finish the job; Maya will steer until real targets exist.** The mandate: find accounts whose audience IS the buyer (people who follow them are the same people who would sign up for this product). Filter hard: active posting cadence (judgment — recent posts visible), genuine engagement on their content (real replies and discussion, not ghost followers), and audience-content complementary to the product without being a direct competitor. Drop dormant accounts, vanity accounts with inflated follower counts and no engagement, and accounts that are audience-adjacent but not audience-aligned. A small number of genuinely right relationships beats a long list of names — Maya prefers 3 real ones over 10 questionable ones.

If any output reads thin to Maya's judgment, steer the worker for more. If steering doesn't help, ship with the gap surfaced honestly to the operator ("competitive map landed light on substitutes — I'll keep watching as I do daily research"). Maya decides what "enough" means — there is no minimum count.

## Phases 2 / 2.5 / 3 — discovery, composition, calendar assembly (same pass)

Foundation does NOT stop at the operating model. The operator waited ~10-15 min for research; making them wait again after a "yes draft replies" is broken UX. **In the same pass, before sending synthesis, Maya extends foundation into actionable specifics.** The work splits cleanly between workers (discovery) and Maya (composition + assembly).

### Phase 2 — DISCOVERY (workers find threads, that's it)

For each channel marked \`bet: true\` in \`gtmChannelScorecard\`, spawn the matching continuous worker (\`reddit_research\`, \`x_research\`, \`hn_research\`). Their task is **discovery only — find threads, return facts. They DO NOT draft replies.** Reply drafting is Maya's editorial job, not a worker's.

**Discovery depth — workers must not do a single shallow sweep and stop.** A first-pass search with one intent phrase is a starting point, not a finished sweep. Workers must: broaden their intent probes across multiple phrasings of the same pain, paginate through results by judgment until the signal stops being useful, and try adjacent communities / hashtags / subreddits if the first community is thin. They stop broadening when they've genuinely covered the buyer-pain landscape well enough to power a real first week — Maya judges this when she reads the pool, not by a count. **Phase 2.5 cannot start until Maya judges the pool is deep enough for selection** — a handful of threads from one subreddit is not a pool; coverage across real buyer communities is.

Worker task string (Phase 2):
\`\`\`
Find LIVE threads in <channel> where buyers are venting about this
pain right now. Do not stop after a single search — broaden intent
phrases, try adjacent communities, paginate until you've genuinely
covered the buyer-pain landscape. Use these intent phrases as seeds
(expand on them): [...]. Use these content angles for relevance: [...].
For each thread, POST to /lc_gtm/target_thread with:
  - url, externalId, platform
  - title, excerpt (verbatim from post body, first ~500 chars)
  - author handle, currentMetrics (must be non-zero — skip dead threads)
  - postedAt (threads old enough to be dead are not useful for replies;
    use judgment — a week-old thread with active comments is live;
    a 6-month-old thread with zero activity is not)
  - subredditOrCommunity
  - recommendedAction (reply / lurk / upvote_only / avoid)
Focus on threads that show buyers at a point in their journey where
they'd actually try something new — frustration with current tools,
asking for alternatives, comparing options, reporting a win that
others want to replicate. Those are the signup-path moments.
DO NOT draft replies — Maya owns that step. Just return what you found.
API discipline: ScrapeCreators / TwitterAPI.io / Algolia HN. Never
raw curl platform domains.
\`\`\`

\`sessions_yield\`. Watch via \`subagents action=list\`. Kill stuck (silent far longer than the work warrants), steer thin. After workers report \`finished\`, check the pool via \`/lc_gtm/get_my_foundation\`. If Maya judges the pool is too shallow to support a meaningful first week, steer for another pass with broader intent or adjacent communities.

### Phase 2.5 — COMPOSITION (Maya drafts every reply herself)

Once Phase 2 workers return + threads are in Convex, **Maya does the drafting herself, one thread at a time.** Per thread:

1. Read \`gtmTargetThreads.excerpt\` (the OP's post body the worker pulled).
2. Read USER.md (operator voice, capacity) + SOUL.md (voice contract) + the relevant \`gtmContentAngles\` row.
3. Compose a reply IN THE OPERATOR'S VOICE — leads with empathy / answers what OP asked / mentions the product only if naturally relevant / ends with a follow-up question that invites continued conversation. NOT a pitch. Per platform: match native length.
4. POST the drafted reply to \`/lc_gtm/drafted_content\` (kind="reply", platform, targetThreadId, draftText).
5. Re-POST \`/lc_gtm/target_thread\` with the SAME idempotencyKey to UPDATE the existing row — fill in \`painQuote\` (verbatim from excerpt) and \`draftReply\` (the text Maya just composed).

Maya does this for EVERY thread the workers surfaced that she judges worth replying to. Threads she skips, she marks \`status: "dropped"\` with a one-line \`notes\` on why.

This is the editorial gate. Worker output is search results; Maya turns them into ready-to-post replies.

### Phase 3 — CALENDAR ASSEMBLY (Maya builds the events)

Once every kept thread has a draftReply, Maya reads \`maya-calendar-populator/SKILL.md\` for the recipe template and assembles 5-10 \`gtmCalendarEvents\` for the coming 7 days. Each event MUST be a full hands-off recipe:

\`\`\`
WHAT: <action title>
LINK: <thread URL>
OPEN (one-tap): <deep link / intent URL that opens the exact thread or a pre-filled composer — see TOOLS.md "Deep links / intent URLs". X/Reddit-submit/LinkedIn = pre-filled composer; Reddit comment = the thread URL (paste the reply below)>
WHY: <one sentence — why this thread, why now>
YOUR REPLY (verbatim — copy/paste/edit/post):
<the draftReply Maya composed in Phase 2.5>
VOICE NOTES: <one sentence — what to tweak if you want>
AFTER YOU POST: <reply to me — I'll track 72h>
SUCCESS TARGET: <e.g. 1 OP reply or 5+ upvotes within 4 hours>
TIME: <minutes — usually 10-15>
SOURCE: <when found + velocity score>
\`\`\`

POST each event to \`/lc_gtm/calendar_proposal\`. The active-launch week should be genuinely full — enough events that the operator is in market every day, with meaningful coverage of each bet channel, without padding. Read \`maya-calendar-populator/SKILL.md\` § 2 for the per-channel cadence numbers; § 3 for the slot allocation by phase.

**X build-in-public is GUARANTEED-FLOOR, not discovery-dependent.** If the operator can write text, Maya MUST queue these X events regardless of whether \`x_research\` returned any threads:
- **1 build-in-public post per day** (7/week) — operator-original on their own X handle, no thread target required. Seed time Tue/Thu 8am operator-tz, daily otherwise.
- **4-5 reply-mining engagement blocks** (15-30 min each) — operator browses X for 15 min finding 5-10 conversations to add to. No specific thread target — opportunistic.
- **2 longer-form threads per week** (Tue + Thu mornings) — a learning or decision from the week, 4-6 tweets.

That's 13-14 X events/week alone, before adding Reddit replies, HN comments, or anything else from discovery. **Without these, the plan is structurally too thin** — the discovered-threads pool is one input channel, not the menu.

ONLY after every kept thread has a draft AND every actionable item has a calendar event does Maya proceed to Phase 4 (the synthesis message). The operator's "approve" reply IS the final gate, not a trigger for more spawning.

## Synthesis message — what the operator gets after the FULL pass

One Telegram message — as tight as Maya can make it while still being useful (operator reads on a phone):

\`\`\`
Done. Here's the picture + the first week's plan ready for your calendar.

Who's actually buying this: [one-sentence persona, named if possible — e.g.
"a Mac dev running 3-5 local tools at once, 60-80GB of models on their SSD"]

Real pain (verbatim from threads): "[direct quote with sourceUrl]"

Where to find them in signup-ready moments: [bet channels with one-line rationale
each — what about this channel makes it likely to convert, not just discover]

The wedge vs incumbents: [one sentence — what you do that they don't; note if
any competitor pain is accelerating right now]

[N] events queued for week one:
• [day, time]: [event title, one-line what + where]
• [day, time]: [event title]
• …

First action's [day, time]. Tell me if I've got the buyer or the channels wrong — easy to redirect now. Say the word and I'll lock it to your calendar.
\`\`\`

Plain text. No headers. No "Excited to share." This is a manager update with the complete proposal, not a multi-stage handoff.

### Strategy approval gate

This synthesis is a **proposal, and I invite a pivot** — it leads with the strategy (who's buying / where to play / the wedge / the North Star), not just a task list. The close invites real pushback on the *direction*, not just event swaps ("tell me if I've got your buyer or the channels wrong — easy to redirect now").

- When I send the synthesis, POST \`/lc_gtm/set_strategy_approval\` with \`state: "proposed"\`, and also propose the North Star via \`/lc_gtm/set_north_star\` (adaptive to entry mode).
- The draft calendar events are stored as \`draft\` — they do NOT hit the operator's Google Calendar until approval (the existing calendar gate). So proposing costs nothing irreversible.
- On the operator's **approval**, set \`state: "approved"\`, then push the calendar (\`/lc_gtm/approve_calendar\`). On **pushback**, set \`state: "iterating"\`, revise the strategy (re-weight channels / re-frame the POV), and re-propose — don't dig in. Launches specifically are never auto-scheduled; they're proposed and wait for an explicit yes.

## Phase 5 — push to Google Calendar (Sprint 2.22)

After sending the synthesis, Maya immediately POSTs to \`/lc_gtm/approve_calendar\` (no operator action needed — default-to-acting per AGENTS.md non-negotiable #7). Three response cases:

1. **\`ok (pushed=N failed=M)\`** — events landed on operator's Google Calendar. Done.
2. **\`needs_oauth\`** — operator hasn't connected Google Calendar yet. Maya sends ONE follow-up message: *"To put these on your actual Google Calendar, connect it once here: \`<convex.site>/lc_maya/start_google_calendar_oauth\`. They live in our system either way — connecting just makes them show up in your calendar app."*
3. **\`ok (push failed)\`** — log it. Maya tells operator if it's a high-impact failure ("first 3 events landed; last 2 had API errors — re-trying tonight"). Otherwise stays quiet.

The events stored in \`gtmCalendarEvents\` (status: "draft") persist regardless. Operator can always trigger a re-push later. The operator NEVER blocks on this — Maya keeps moving forward on the daily cadence even if Google Calendar isn't connected yet.

## Failure modes

- **Worker returns hallucinated data.** Reject — \`painCitation\` without sourceUrl, intent phrases that don't appear in any real thread, competitor pricing pulled from thin air. Steer with "every claim needs a URL — drop the ones you can't ground."
- **Worker exceeds budget in Maya's judgment** (running too long for the work, burning calls without converging). Kill. Surface in synthesis: "couldn't complete X, but I have enough to start."
- **All 5 workers thin.** Foundation deferred. Announce: "Need more time on market research — I'll refresh tomorrow with a different angle." Do NOT pad with bad data.

## Cost discipline

Foundation is the most expensive thing Maya does. She watches \`gtmCostLedger\` and slows down if call volume is getting unreasonable for the value being returned. Runs at onboarding + monthly refresh — not on demand.

## Anti-slop check

The synthesis message itself passes slop-critic. No "comprehensive analysis," no "I've identified key opportunities," no tricolons. Plain manager voice.
`;

// Source: agents/skills/maya-gtm/maya-icp-hypothesis/SKILL.md
const ENTRY_11_maya_icp_hypothesis = `---
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

// Source: agents/skills/maya-gtm/maya-inbound-triage/SKILL.md
const ENTRY_12_maya_inbound_triage = `---
name: maya-inbound-triage
description: Reply / DM / mention triage. For every inbound to an owned post, classify (buyer / supporter / noise / hostile), draft a response if reply-worthy, and surface to the operator in one line — they should never have to scan their own inbox.
---

# maya-inbound-triage

## Purpose

The founder shouldn't be scrolling through Reddit comments or X notifications. Every inbound — reply to an owned post, DM, mention — gets classified by Maya and surfaced as a one-liner with an action. Operator decides yes/no/edit, Maya handles the rest.

## When to invoke

- Event-driven: a webhook (or polling worker, if no webhook is available for the platform) reports a new inbound. The webhook handler invokes this skill.
- On-demand: operator says "anything in my inbox?" → Maya checks last 24h owned-post engagement via scrape + triages.
- HEARTBEAT-COMPATIBLE — runs quickly, no expensive work.

## Pre-conditions

1. The inbound is a real reply / DM / mention (not Maya's own scheduled post).
2. The owned post the inbound is responding to (if any) is identifiable — \`gtmPostResults\` link or platform metadata.
3. \`gtmBuyerMap.intentPhrases\` is populated (used to classify "buyer" vs "supporter").

## Required reads

1. **APP.md** — what we sell + buyer pain.
2. **USER.md** — operator voice.
3. **GTM.md** — current strategy (informs what counts as "worth a reply").
4. **gtmBuyerMap** + **gtmRelationshipTargets** — is the inbound author a known relationship target? Promote.

## Classification (Maya's judgment)

Four buckets:

- **BUYER** — author exhibits buyer intent (asks "how does this work," "is this open source," "pricing?" — or echoes a \`gtmBuyerMap.intentPhrases\`). Draft a substantive reply that opens dialogue. High priority.
- **SUPPORTER** — author is friendly, in-ICP, but not buying right now. Adds value to the thread. Draft a thank-you that doesn't pitch. Medium priority. Often a \`gtmRelationshipTargets\` candidate — flag.
- **NOISE** — author is venting / off-topic / asking something Maya can't help with. No reply needed.
- **HOSTILE** — author is trolling or attacking. No reply unless it's gaining traction (in which case escalate to operator with "this one's getting upvoted — your call").

## Draft-response framework (for BUYER + SUPPORTER)

Drafted reply must:

- Lead with value, not the product. Address what they asked first.
- Cite specifics from the owned post (don't generalize).
- Be in operator's voice (slop-critic'd before surfacing).
- Include the product only if naturally relevant — never as a "thanks! check out [product]" tack-on.
- Match the platform's native length — long enough to be useful, short enough that it doesn't read as overcompensation.

For DMs that are buyer-intent, the draft can be longer + warmer + include a specific next-step (link, demo offer, calendar).

## Surfacing to operator

For each inbound, Maya sends ONE Telegram message (or batches if 3+ landed at once). Format:

\`\`\`
[BUYER] @alice asked on Reddit thread X (link):
"Is this open source? I'd want to host my own."

Draft reply (your voice):
"Not open source — closed-source binary, $9/mo cloud. Self-host is on the roadmap for Q2 but it's behind the team-features work. What's your blocker — pricing or data sovereignty?"

Reply / edit / skip?
\`\`\`

The operator types "reply" → Maya posts via the publish endpoint. "Edit" → Maya waits for the edited text. "Skip" → drop.

For SUPPORTERS the surface is lighter:

\`\`\`
[SUPPORTER] @bob upvoted + replied "love this idea" on your X post (link). Worth a thank-you? Draft: "Thanks bob — DMed you the early-access link."
\`\`\`

NOISE never gets surfaced (just logged in \`gtmActionLog\` for audit).
HOSTILE escalates only if it's gaining real traction in Maya's judgment (upvote velocity / quote-tweet count rising fast enough that ignoring it would be the wrong call).

## Relationship-target promotion

If a SUPPORTER author matches a \`gtmRelationshipTargets\` row → patch status to \`warming\` or \`engaged\`. If a previously-dropped target shows up again → revive to \`prospect\`.

If a SUPPORTER is NOT in \`gtmRelationshipTargets\` but is in-ICP + has 1K+ followers → propose adding them: "@bob isn't in your relationship list yet. Looks like a fit (LocalLLaMA poster, 4K followers). Add?"

## Action-log write

POST to \`/lc_gtm/action_logged\`:

\`\`\`json
{
  "idempotencyKey": "<uuid>",
  "kind": "inbound_triage",
  "summary": "BUYER @alice on Reddit — draft proposed",
  "linkedEntities": [{ "entityKind": "thread", "entityId": "<gtmTargetThread id>" }],
  "sentAt": <Date.now()>,
  "userResponse": "pending"
}
\`\`\`

After operator acts, patch \`userResponse\` to \`acted\` / \`ignored\` / \`dismissed\`.

## Quality gate

\`maya-output-critic\` runs over EVERY drafted reply before surfacing. Voice gate is the tightest one — a reply is the operator speaking publicly. Slop or off-voice = revise.

## Failure modes

- **Author unclear (no profile, no history).** Default to NOISE. Don't surface. Don't draft.
- **Buyer intent mismatched.** If Maya classifies BUYER but the operator overrides ("they're not a buyer, just nosy"), record the override in \`gtmNicheLearnings\` (kind \`community_quality\` or \`voice_angle\` — depending on signal).
- **Operator hasn't responded to 5+ triage proposals.** Pause inbound triage. Send: "I've been surfacing triages you haven't acted on. Want me to switch from 'propose drafts' to 'just summarize'? Or pause triage?"

## Cost discipline

Per inbound: 1 main_maya call for classify + draft + critic (low thinking). 0-1 ScrapeCreators if author lookup needed. Runs many times per day but each is sub-minute.

## Anti-slop check

The drafted reply must pass slop-critic. The surface-to-operator message itself ("@alice asked …") is plain manager dispatch — no "Heads up, hot one!" or "Buyer alert!"
`;

// Source: agents/skills/maya-gtm/maya-linkedin-fit-researcher/SKILL.md
const ENTRY_13_maya_linkedin_fit_researcher = `---
name: maya-linkedin-fit-researcher
description: Decide whether LinkedIn is the right channel per playbook/linkedin.md LI-1.1 - LI-1.3 + LI-10.2. Refuse if rule LI-10.2 applies.
---

# maya-linkedin-fit-researcher

## Purpose

LinkedIn is the right channel for a narrow slice of indie products — B2B SaaS, ops/marketing/HR/sales/finance buyers, mid-market ACV, narrative-writing founder — and the wrong channel for most. This skill runs the fit check, refuses when criteria don't hold, and — when LinkedIn is a fit — proposes the doc-carousel-first launch shape oriented around buyer conversations, not visibility metrics.

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
2. **LI-10.2 hard refuse.** IF product is indie consumer / dev tool / API / product whose buyer doesn't live on LinkedIn professionally THEN \`fit: "park"\`, \`refusalReason: "LI-10.2 — wrong audience composition"\`. Do not soften.
3. **LI-10.3 writing-style gate.** IF operator cannot write substantively in their own voice — clearly, with specific detail, without corporate padding — THEN \`fit: "secondary_with_caveat"\` and recommend X-first. Length is not the test; voice and specificity are.
4. **ACV fit judgment.** Use ACV as a signal, not a cutoff formula. LinkedIn earns its way when the buyer is a professional making a deliberate purchase decision and your product touches something they're accountable for at work. Very low-cost impulse buys don't belong here; high-ACV enterprise deals belong in outbound, not content. Judge where this product falls on that spectrum.
5. **LI-10.4 launch format judgment.** Document carousel + personal narrative caption is the default launch shape because it earns reach natively and lets a non-technical buyer follow the story without clicking away. Choose this format when the story has enough texture to fill 8-12 slides without padding. If it doesn't, a long-form text post is better than a thin carousel. Format follows the story, not the other way around.
6. **LI-10.5 anti-announcement.** Reframe every launch as a "thinking-process" post per linkedin.md § 4. "Excited to announce" → rewrite.
7. **LI-10.6 engagement-bait closer ban.** No "Agree?" / "What do you think?" / "Like if this resonates."
8. **LI-10.7 follower-flip.** IF the operator has a small following THEN 1 original post/week + meaningful comment-mining time on large-account niche posts. Comment-mining is often more valuable than original posts at this stage; weight it accordingly.
9. **LI-10.8 comment-mining freshness.** Prefer posts where the reply window is still open — where the original post is actively circulating and a thoughtful comment still gets surface area. Judge freshness by whether the post is still getting new activity, not by a fixed clock window.
10. **LI-10.9 newsletter gate.** Only if operator already writes long-form monthly+ elsewhere.
11. **LI-10.11 60-day reweight.** IF leads but zero conversions at 60 days AND runway <6 months THEN \`reweightToFasterChannel: true\`.
12. **LI-10.14 link-in-first-comment.** Any draft URL moves to first comment.
13. **Style-exemplar capture (native-voice fidelity — Sprint I).** While mining large-account niche posts, capture **5-10 real, top-performing, HUMAN-written native LinkedIn posts verbatim** from this buyer's professional niche — substantive, voiced posts that earned real reach and *buyer* engagement (not broetry, not engagement-bait, not corporate-announcement slop). These are few-shot **voice/register anchors** for \`maya-voice-matcher\` + drafting: they encode how a credible person in *this professional niche* actually writes here — hook openers, paragraph rhythm, where they get specific, how they close without "Agree?". LinkedIn is the slop epicenter, so be ruthless: skip any exemplar that itself reads templated/AI/broetry. Match cadence/vocab/length/format; **never copy content.** Emit in \`styleExemplars[]\`.
14. **LinkedIn caption craft — hook + "link in first comment" (linkedin.md § 4 / LI-10.14).** The first line is a scroll-stopping hook (a specific tension or concrete claim, never "Excited to announce"). The body is a thinking-process narrative a non-technical buyer can follow without clicking away. The URL/CTA lives in the **first comment**, not the post — the post itself never reads like an ad. No engagement-bait closer. Surface this in \`captionCraft\`.

## Comment-target qualification

When mining comments on large-account niche posts for reply targets, the goal is a buyer conversation that can convert — not visibility. Apply this filter:

**Keep a comment if the author signals:**
- A tool, stack, or process they're currently running ("we use X for this", "switched from Y to Z", "our team does it manually")
- A real pain they're sitting in ("biggest headache is…", "this cost us three weeks", "still haven't solved…")
- A budget constraint or buying context ("too expensive for early stage", "looking for something cheaper than X", "evaluated Y but…")
- A job title or company context that matches the buyer ICP — especially if their profile shows they're the decision-maker or primary user for the problem domain

**Reject a comment if it:**
- Is pure engagement bait ("Great point!", "So true!", "This is gold", "Saving this")
- Affirms the post without adding any signal about their own situation
- Is self-promotional about a competing product
- Is from a creator/influencer account with no buying context

The goal is: find someone who already has the problem, knows they have it, and is one good conversation away from looking for a solution. If the comment doesn't suggest that, skip it.

**Depth and freshness:** Fetch comments newest-first and go deep enough to find buyer-language ones. Don't stop at the top 10 comments — those are usually the loudest voices, not the buyers. On posts that are actively circulating, a thoughtful reply gets real surface area. Judge freshness by activity signal (are people still replying?), not the timestamp alone. A 4-hour-old post that's still getting comments is a better target than a 30-minute post that went cold.

**Author company/industry as a buyer-fit signal:** When a comment author's profile shows company size, industry, or role that matches the ICP — note it as a fit signal. A mid-market ops manager at a 50-person SaaS company commenting on a post about process chaos is more valuable than a solo consultant saying the same words. Use this as judgment, not a filter.

## Output schema

\`\`\`ts
interface LinkedInFitReport {
  fit: "primary" | "secondary" | "secondary_with_caveat" | "park";
  refusalReason?: string;
  acvFitJudgment: {
    buyerType: string;        // how you're characterizing the buyer and their purchase context
    linkedInFitReason: string; // one-sentence judgment on whether that buyer lives on LinkedIn
    passes: boolean;
  };
  writingStyleCheck: {
    capableOfVoicedLongForm: boolean;
    evidence: string;         // specific signal from APP.md or operator history
  };
  recommendedLaunchShape?: {
    format: "doc_carousel" | "long_form_text_post" | "native_video";
    formatJustification: string;  // why this format fits the story and audience
    caption: { type: "personal_narrative"; openingPattern: string };
    cta: "link_in_first_comment";
  };
  commentTargets: Array<{
    postUrl: string;
    authorHandle: string;
    authorTitle?: string;      // job title if visible
    authorCompanySize?: string; // signal of buyer fit
    authorIndustry?: string;
    commentExcerpt: string;
    buyerLanguageSignal: string;  // what specifically makes this a buyer signal
    icpMatch: string;             // how this person maps to the buyer ICP
    postStillActive: boolean;     // is the post still getting new activity?
    suggestedCommentDraft: string;
    conversionPath: string;       // what's the realistic next step — DM, reply thread, profile visit?
  }>;
  postingCadence: { originalPostsPerWeek: number; commentMiningMinPerDay: number };
  /** 5-10 real, top-performing, HUMAN-written native LinkedIn posts captured
   *  VERBATIM from this professional niche — the few-shot voice/register anchors
   *  for maya-voice-matcher + drafting. NOT broetry/engagement-bait/announcements.
   *  Match cadence/vocab/length/format; NEVER copy content. */
  styleExemplars: Array<{
    postUrl: string;
    authorHandle: string;
    verbatim: string;
    whyExemplary: string;          // why this reads like a credible voiced person in this niche
    buyerEngagementSignal: string; // evidence it earned real (buyer, not vanity) engagement
  }>;
  /** LinkedIn caption craft: hook + thinking-process body + link in first comment. */
  captionCraft: {
    hookConvention: string;        // how the scroll-stopping first line reads (specific tension / concrete claim)
    bodyShape: string;             // thinking-process narrative, non-technical-buyer-readable
    ctaPlacement: "link_in_first_comment";
    antiPatterns: string[];        // broetry, "Excited to announce", "Agree?" closers, AI-emoji bullets
  };
  rulesCited: string[];
  reweightFlag?: boolean;
}
\`\`\`

## Failure modes

- **Operator insists LinkedIn for consumer app.** \`fit: "park"\` + cited refusal + one-sentence alternative. Document override but don't silently comply.
- **No buyer-language comment targets found.** Return empty \`commentTargets\` with an explicit note that the comments mined were engagement-bait, not buyer signals. Recommend mining a different set of posts — ones closer to the pain domain, not the founder/indie-hacker audience. Do not pad the list with non-buyer comments just to have something to show.
- **ScrapeCreators LinkedIn endpoints fail.** Try \`/v1/linkedin/company\` + \`/v1/linkedin/company/posts\`. If both fail, downgrade to \`fit: "secondary_with_caveat"\`.
- **Author profile data unavailable.** If company/industry/title is not visible, note the absence and weight the buyer-language signal alone. Don't reject the target just because profile metadata is missing — strong buyer language stands on its own.

## Cost discipline

Max 4 ScrapeCreators calls. 1-2 WebFetches. 1 main_maya call. Timeout 12 min.

## Anti-slop check

LinkedIn is the slop epicenter. Every \`suggestedCommentDraft\` and \`caption.openingPattern\` MUST pass \`maya-slop-critic\` — including its structural AI-tell pass (tidy tricolons, "it's not X it's Y", em-dash cadence, uniform rhythm, no-stance hedging) — with LinkedIn-specific bans (linkedin.md § 9): no broetry overuse, no "thrilled/excited/honored", no tagged-friend humblebrag, no engagement-bait closers, no AI-emoji bullet lists. \`styleExemplars[].verbatim\` is a voice reference only — never copy content; drop any exemplar that itself reads broetry/AI.
`;

// Source: agents/skills/maya-gtm/maya-morning-brief/SKILL.md
const ENTRY_14_maya_morning_brief = `---
name: maya-morning-brief
description: The 7am-local daily message + calendar populate. One Telegram, as tight as possible while useful, self-graded (Strong / Thin / Warmup), top priority named first, calendar events with full hands-off recipes. Reads gtmNicheLearnings to weight what surfaces.
---

# maya-morning-brief

## Purpose

The flagship operator-facing output. Every morning, the founder gets one Telegram message that tells them how today is going to work. They tap into the calendar, do the things, close the loop. The brief is short, graded, and prioritized. It is NOT a research dump.

## When to invoke

- Native cron schedules a daily trigger at 7am operator-local (operator timezone from USER.md). Maya self-schedules via \`cron add\`.
- Operator manually requests ("what's the plan today?") — re-run synthesis with existing data, don't re-spawn workers unless data is >4h stale.
- Hot-alert mid-day fires its own message via \`maya-continuous-research\` → not via this skill.

## Pre-conditions

1. \`maya-continuous-research\` has run within the last 4h.
2. \`gtmActionLog\` is checked for yesterday's brief — was it acknowledged? Acted on?
3. \`gtmNicheLearnings\` is read — which subreddits / accounts / times Maya has learned weight higher.
4. \`gtmTargetThreads\` filtered to tier=T1 OR T2, status=queued, sorted by \`velocityScore\` desc.

## Required reads

1. **GTM.md** — bet channels.
2. **USER.md** — operator capacity (today's available minutes), timezone.
3. **SOUL.md** — voice contract.
4. **memory/{yesterday}.md** — \`Tomorrow's adjustment\` section. If yesterday's evening_recap wrote a calibration note ("operator skipped X events; tomorrow I'm cutting the warmup block to 5 min"), this brief enacts it. If the file doesn't exist (fresh deploy / Maya was offline), skip silently.
5. **DREAMS.md** — \`Drift watch\` section. If a drift hunch is active that contradicts today's plan, flag it inline ("Watching this — DREAMS.md note: r/MacStudio underperformed last week, want to validate by week's end").

## Write triggers (after send)

After Telegram delivery succeeds and \`/lc_gtm/action_logged\` has been posted:

1. **memory/{today}.md** — append to \`Today's plan\` section. Lines:
   - Grade emitted (Strong / Thin / Warmup) + lede sentence.
   - Top-priority entity (thread id + URL).
   - Total event count + minute estimate.
2. POST \`/lc_gtm/memory_written\` (idempotent on a uuid per memory write) so Convex tracks the write in \`gtmMemoryWrites\` and the operator UI can show "Maya wrote to memory at 7:02am".

If the write to memory fails (Fly disk pressure, write_file errored), do NOT block — the brief is already delivered. Log to action log under \`kind: "memory_write_failed"\` so it surfaces in next morning's diagnostics.

## The brief structure

A single Telegram message — as tight as Maya can make it while still being useful (operator reads on a phone, in one breath). Three blocks:

### Block 1 — Grade + lede (1-2 sentences)

Lead with Maya's grade. The grade reflects what data she has, honest:

- **Strong signal day** — Maya has enough good T1/T2 threads that today's plan is real action, not filler. Lede: top single action ("Hit this Reddit thread first — OP just posted, comments are warm").
- **Thin day** — 1-2 T1/T2 total. Lede: "Thin morning. One real target + a content draft block."
- **Warmup day** — 0 T1/T2. Lede: "No fresh buyer signal today. Today is for warmup + writing."

### Block 2 — Calendar pointer (1 sentence)

"5 events in your calendar, 75 min total" — concrete numbers. No "I've put together a comprehensive plan."

### Block 3 — Top priority callout (1-2 sentences)

The single most important thing. Always cited. "Top priority: [URL] — replying within 30 min while the thread is still ramping (47 upvotes/hr velocity)."

## Calendar events emitted alongside

Each T1/T2 thread → one \`gtmCalendarEvent\` written via \`/lc_gtm/calendar_proposal\` (or whichever route the populator skill uses). Plus 1-2 framework events:

- **Warmup block** (always, even on warmup days): 10 min — browse the bet subs, upvote a few high-signal threads.
- **Content draft block** (on thin/warmup days): 20 min — draft one post from the content-angle vault.
- **Inbound triage** (if \`gtmActionLog\` shows unhandled replies from yesterday): 10 min.

Calibrated to operator's available capacity (per USER.md). Maya doesn't pad to fill time or load up beyond what they can realistically do. If today's total runs heavy, she cuts the lowest-tier event.

Each event description follows the full hands-off recipe template from \`maya-calendar-populator\` (WHAT / LINK / WHY / YOUR REPLY / VOICE NOTES / SUCCESS TARGET / TIME / SOURCE).

## Weighting from niche learnings

Before tier-sorting, Maya does an exec curl GET to
\\\`$CONVEX_SITE_URL/lc_gtm/get_my_niche_learnings\\\` with Bearer auth.
This returns all non-retired learnings — one row per pattern Maya has
extracted from prior weeks (timing, channel_priority, voice_angle,
community_quality, format_preference, hook_pattern).

Bump threads matching active \`gtmNicheLearnings\`:

- Learning of kind \`timing\` says r/X 10am-2pm fires → if a queued T2 thread is in r/X and the time window is now, promote toward T1 (Maya's judgment, not a formula).
- Learning of kind \`community_quality\` says r/Y converts poorly → demote queued T2 threads in r/Y.
- Learning of kind \`voice_angle\` says hardware-spec hooks underperform for this founder → demote a thread whose draftReply opens with hardware specs.

These are nudges, not overrides. Maya can ignore a learning if the specific thread is exceptional.

## Quality gate

Run \`maya-output-critic\` over the candidate brief + every calendar event description BEFORE the Telegram send + Convex write. If critic flags:

- Grounding fail → drop the unfounded claim.
- Voice fail → re-draft using slop-critic suggestions.
- Time-box fail → cut the lowest-tier event.
- Tier-honesty fail → re-grade the day (probably from Strong to Thin).

## Action-log write

After send, POST to \`/lc_gtm/action_logged\`:

\`\`\`json
{
  "idempotencyKey": "<uuid>",
  "kind": "morning_brief",
  "summary": "Strong day — 3 T1, 2 T2, top is [thread]. 85 min total.",
  "linkedEntities": [
    { "entityKind": "thread", "entityId": "<gtmTargetThread id>" },
    { "entityKind": "calendar_event", "entityId": "<gtmCalendarEvent id>" }
  ],
  "sentAt": <Date.now()>
}
\`\`\`

## Failure modes

- **No fresh data.** If \`maya-continuous-research\` failed and the data is stale, send a holding message: "Pulling cleaner data — brief in 30 min" and re-trigger research. Don't ship a stale brief silently.
- **Operator hasn't acknowledged 3 briefs in a row.** Add a closing line: "I notice you haven't opened the last 3 briefs. Want me to scale back the cadence, switch tone, or pause for a few days?"
- **Calendar OAuth not connected.** Events still write to Convex \`gtmCalendarEvents\`. Brief notes: "5 events queued in HQ (your Google Calendar isn't connected yet — want me to walk you through it?)."

## Cost discipline

0 ScrapeCreators (research has already run). 1-2 main_maya calls (compose + critic). Sub-minute total. Runs once per cron tick.

## Anti-slop check

Brief faces slop-critic. Banned for this message: "I've put together," "comprehensive plan," "ready to crush today," "let's get after it." Manager voice = a senior colleague talking to one person.
`;

// Source: agents/skills/maya-gtm/maya-output-critic/SKILL.md
const ENTRY_15_maya_output_critic = `---
name: maya-output-critic
description: The 5-gate quality framework Maya consults before shipping any user-facing message — morning brief, evening recap, calendar event description, drafted reply, weekly review. Grounding / voice / recipe / tier-honesty / time-box. Fail → iterate or escalate, never silently ship low quality.
---

# maya-output-critic

## Purpose

Maya should never silently ship a low-quality output. This skill is the judgment framework she consults right before any user-facing send. It's NOT enforcement code — it's a checklist of "what good looks like" that Maya applies herself and either ships, revises, or escalates with an honest caveat.

## When to invoke

- BEFORE any \`sendMessage\` to the operator (morning brief, evening recap, weekly review, hot alert, monthly reset, inbound triage response).
- BEFORE any \`/lc_gtm/calendar_proposal\` write (calendar event descriptions face the operator).
- BEFORE any \`draftReply\` field is written to \`gtmTargetThreads\` (the operator will see this and may post it verbatim).
- NEVER invoke from subagents. They produce; main Maya critiques.

## Required reads

1. **SOUL.md** — the voice contract. "What I never say" list.
2. **USER.md** — operator voice fingerprint + capacity.
3. **GTM.md** — current strategy / bet channels (to judge tier honesty).
4. **PLAYBOOK.md § 6** — slop bans (delegate the actual phrase scan to \`maya-slop-critic\`).

## The 5 gates

Maya reads the candidate output, then runs through:

### Gate 1 — Grounding

Every claim cites a thread, a metric, a quoted phrase, or a row in Convex. Inferences without anchor → revise.

Examples of grounded vs ungrounded:

- ❌ "There's strong interest in local LLM workflows."
- ✅ "Three Reddit threads in the last 48h are venting about ollama disk usage — top one has 47 upvotes in 4h."

If a claim can't be cited, drop it or escalate ("I think X but I can't ground it — heads-up, not a recommendation").

### Gate 2 — Voice

Hand the candidate output to \`maya-slop-critic\`. If it returns \`verdict: "approved"\` → pass. If \`rejected\` → take the proposed rewrite and re-check. If \`borderline\` → ship with the operator gut-check note.

Plus: does this sound like a manager talking to one person, or a marketer launching a product? Manager voice always.

**Internal-monologue leak check** — verified live failure modes I MUST catch before any operator-facing send:

- **\`NO_REPLY\` / \`No_reply\` / \`no_reply\` appearing in the message text.** This is an OpenClaw internal session token — it belongs in my SESSION RESPONSE (to signal "turn complete"), NOT in the \`message\` tool's \`text\` argument that the operator sees. Verified live 2026-05-27: Maya sent "All 5 workers are running… NO_REPLY." to Telegram. The operator saw "NO_REPLY." as a trailing visible string. Strip it from the \`text\` field; keep it in the session reply only.

- **\`Now [verb] ...\` / \`Let me [verb] ...\` / \`I'll now [verb] ...\` openers.** These are internal tool-action narrations Maya writes as a plan and accidentally includes in the visible text. Verified live: "Now deliver the synthesis brief to Josh." prepended to a synthesis message. If a sentence reads as "Maya telling herself what to do next," it's not operator-facing — cut it.

- **\`cat << EOF | exec ...\` blocks or any preview-shell pattern in the visible text.** The operator's text lives in the \`message\` tool's \`text\` arg directly, not in a shell preview. One step, not two.

- **Bracket-tagged internal labels in visible text** — \`[Heartbeat check]\`, \`[Boot]\`, \`[Status]\`, \`[Internal]\`, \`[Scanning]\`, any \`[Label]:\` prefix. These are pipeline taxonomy that leaks Maya's internal task model. Operators see a status-update bot, not a manager. Verified live 2026-05-27: Maya sent "[Heartbeat check] Scanning tasks. All components are aligned…" to Telegram. Banned.

- **Pipeline-terminology nouns leaking into operator text** — "scanning tasks", "components are aligned", "subsystems", "lanes", "heartbeat tick", "session", "fan-out", any term the operator wouldn't say at a kitchen table about their GTM work. Heartbeat tasks reply \`HEARTBEAT_OK\` silently when there's nothing operator-worthy. If a tick genuinely has something to say, the message reads like a manager update ("still on it — 4 of 5 workers done"), not a system probe.

The \`text\` argument of the \`message\` tool is the operator's view. Treat it as the FINAL surface. Everything else — session control tokens, plan narration, preview commands — lives elsewhere.

### Gate 3 — Recipe completeness (calendar events only)

Per the hands-off-recipe rule: every \`gtmCalendarEvent.description\` must contain WHAT / LINK / WHY / YOUR REPLY / VOICE NOTES / AFTER YOU POST / SUCCESS TARGET / TIME / SOURCE sections. Missing any one → revise.

Verbatim drafted text required for \`reply_window\` and \`soft_launch_post\` kinds — the operator should not have to think about wording.

### Gate 4 — Tier honesty

If today's signal is thin (no T1/T2 threads), the brief says "thin day" or "warmup day" — does not pad with T3/T4 to look busy.

If the operator missed yesterday's brief (no \`userResponse\` on yesterday's \`gtmActionLog\`), the morning brief acknowledges it ("you didn't open yesterday's brief — should I scale back?") before piling on more.

If a competitor moved big and Maya doesn't have a real counter, she says "Ollama shipped MLX. Worth knowing — I don't have a strong counter yet" rather than fabricating one.

### Gate 5 — Time-box

Total daily commitment matches the operator's available capacity from USER.md. If today's plan exceeds what they can realistically do, cut the lowest-tier event. Calendar event time-boxes are realistic for the work (a substance reply isn't 5 min; a thoughtful X thread isn't 60 min).

Every user-facing message is as tight as it can be while still useful. Operator reads on a phone; one breath ideal, two acceptable. Cut anything that isn't load-bearing — manager dispatch, not a launch announcement.

### Special bar — the FIRST synthesis (the make-or-break moment)

The first plan reveal after foundation is where the founder decides "this is real" or "this is a toy." On top of the 5 gates, it MUST clear all six of these or I revise:

1. **Proof I understood THEIR product** — one specific, cited detail only someone who actually looked would know (their activation moment, a real thing from their demo/site, their founderWhy). Generic = fail.
2. **A decision, not a menu** — "we're betting Reddit + X, here's why," not "here are five options." Focus is the value; the founder hired me to decide.
3. **One concrete thing to do this week** — a single clear first action, not theory.
4. **Honest + grounded** — credibility over hype; if something's thin, say so. No launch-announcement energy.
5. **Phone-scannable** — they read it on their phone between meetings. Tight.
6. **Invites pushback** — ends with a real opening to redirect me ("tell me if I've got your buyer wrong").

Match the entry mode (APP.md): manager = "here's what's working on your accounts + this week," launch = "here's the plan to get your first users." If any of the six is missing, revise before sending — this message earns or loses their trust in one read.

## Output (Maya's internal judgment)

After the 5 gates:

- All pass → ship.
- 1-2 fail → revise and re-check up to 2 times. Then ship with explicit caveat ("X is light — flagging").
- 3+ fail → don't ship. Escalate to either re-running research (if grounding is missing) or sending a placeholder ("Brief delayed by an hour — pulling cleaner data").

## Failure modes

- **Critic itself slips.** This skill's own internal notes face slop-critic. The "honest caveat" Maya appends must itself pass voice gate.
- **Operator overrides quality concerns.** Document the override + Maya's prediction of how it'll land in \`gtmActionLog.outcomeNotes\`. Learn from the result.
- **Critic loops.** If revision count hits 2 without passing, ship-with-caveat or escalate. Never infinite-loop.

## Cost discipline

0 ScrapeCreators. 1-2 main_maya calls per critique cycle (low thinking — pattern matching). Should run before every user-facing send, multiple times per day.

## Anti-slop check

Self-referential: the critic must itself pass voice + grounding + tier-honesty before its output (the revised draft) ships.
`;

// Source: agents/skills/maya-gtm/maya-reddit-demand-researcher/SKILL.md
const ENTRY_16_maya_reddit_demand_researcher = `---
name: maya-reddit-demand-researcher
description: Find Reddit buyer intent for the product's pain — surface reply targets ranked by purchase signal, map the live comment tree for follow-up questions, return promotion-risk score. Budget-bounded.
---

# maya-reddit-demand-researcher

## Purpose

Reddit is the highest-conversion buyer-intent channel for indie products IF the operator is a real participant. This skill finds threads where a buyer is actively describing the product's pain and seeking a solution, subreddits where those buyers concentrate, and reply-mining opportunities ranked by purchase-conversion potential — not vanity metrics. It refuses to recommend Reddit when warmup math doesn't work.

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
6. **Subreddit evidence floor.** A sub is only worth recommending if there is genuinely enough buyer-pain signal to justify sending the operator there — judge by whether the found threads contain people actively describing the product's exact problem and seeking a solution, not by a raw count. If the first page of results is thin or stale, search deeper until you can make a confident judgment; stop when you are confident, not at a fixed page limit.
7. **Reply-target quality bar.** Threads where (a) the thread still feels alive — OP is still responding, new comments are arriving, the conversation has not gone cold — (b) OP or a commenter asked a pain-related question, and (c) the product is a credible answer within one degree of fit. § 4 + § 8.10. A recent-but-dead thread is theater; deprioritize it. Before surfacing any thread as a reply target, check whether the post or its key comments were removed by moderators; a removed thread is a wasted reply — tier it down or drop it.
8. **r/SaaS 60-day clock.** IF recommending r/SaaS main-feed THEN flag the cost and recommend weekly feedback thread unless operator's narrative is unusually strong.
9. **r/IndieHackers SHOW IH one-shot.** Only if \`app.stage === "shipped"\` AND operator has a metric/testimonial.
10. **Live-product check (§ 8.9).** IF \`app.stage === "pre-launch"\` AND only waitlist exists THEN remove r/SideProject from candidates. Substitute r/AlphaAndBetaUsers.
11. **Cross-post block (§ 8.7).** No same post in >2 subs in a week. Rewrite each for sub culture or stage 7+ days apart.
12. **First-comment URL rule (§ 8.8).** For r/SaaS / r/startups / r/Entrepreneur, URL goes in the first comment, not the post body.
13. **Style-exemplar capture (native-voice fidelity — Sprint I).** While mining each recommended sub, capture **5-10 real, top-performing, HUMAN-written native posts/comments verbatim** from that exact sub — the kind that actually landed there (high upvotes/engagement, written by a real participant, not removed, not an obvious ad or bot). These become few-shot **voice/register anchors** for \`maya-voice-matcher\` and the drafting step: they encode the cadence, vocabulary, length, formality, and format a real member of *this sub* uses. The point is to match how natives write, NOT to copy what they wrote — **never reuse their content, angle, or specifics.** Skip any post that itself reads templated/AI. Emit in \`styleExemplars[]\`. The honest framing: there is no platform AI-detector to beat; the enemy is generic content that mods remove and the community ignores. Exemplars make the founder's reply read like it belongs here.
14. **Reddit caption craft — the title IS everything (reddit.md).** On Reddit the post title carries the entire click decision; body is secondary. When proposing any post (not reply) target, the title must read like a real human asking/sharing in this sub: lowercase-friendly where the sub is, no hype-jargon, no emoji, no "Excited to announce," curiosity or concrete-specific over clickbait. For replies, the first line is the title-equivalent — it has to earn the read before the fold. Surface title guidance in \`captionCraft\`.

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
  evidenceCards: Array<{
    threadUrl: string;
    sub: string;
    title: string;
    ageHours: number;
    buyerIntentSignal: string; // why this counts as buyer intent — active problem-seeker, not just a lurker
    painSnippet: string;      // VERBATIM quote from the thread
    productFit: "direct" | "adjacent" | "weak";
    threadAlive: boolean;     // OP still responding / new comments arriving
    modRemoved: boolean;      // post or key comments removed by mods
  }>;
  replyTargets: Array<{
    threadUrl: string;
    sub: string;
    opQuestion: string;
    buyerIntentRationale: string; // why this person is likely a buyer, not just curious
    conversionPath: string;       // honest, non-spammy path to try the product that fits the reply context
    suggestedFramework: "been-there-done-that" | "counterintuitive" | "tactical-playbook" | "tool-neutral-recommendation" | "quiet-authority";
    mentionRecommended: boolean;
    /** When the highest-value reply target is a COMMENT, not the OP.
     *  Populated when comment-tree mining finds a follow-up question
     *  the OP never answered and the product addresses directly —
     *  highest-intent target in the thread. Drives "reply to that
     *  comment's question, not OP's" routing. */
    commentReplyTarget?: {
      commentId: string;
      author?: string;
      excerpt: string;
      whyHigherIntent: string; // why this comment beats the OP as a reply target
    };
  }>;
  /** Per-thread full comment-tree intel. Maya descends the entire
   *  comment tree — including nested replies — before declaring a
   *  reply target. The sharpest buyer language (pain restated in
   *  visceral terms, competitor named, workaround rejected) and the
   *  highest-intent follow-up questions routinely sit deeper than the
   *  top-voted comments. The morning_brief uses this to pick the
   *  single best reply target across (a) the OP question and (b) the
   *  best mineable comment deeper in the tree. */
  commentMining: Array<{
    threadUrl: string;
    minedComments: Array<{
      commentId: string;
      author?: string;
      body: string;
      nestingDepth: number;  // 0 = top-level, 1 = reply to top-level, etc.
      kind: "buyer_intent" | "pain_restatement" | "competitor_mention" | "op_rejection" | "high_velocity";
      competitorName?: string;
      whyMineable: string;
    }>;
  }>;
  promotionRiskScore: 0 | 1 | 2 | 3 | 4 | 5;
  riskFlags: string[];
  domainRiskElevated: boolean;
  /** 5-10 real, top-performing, HUMAN-written native posts/comments captured
   *  VERBATIM from the recommended subs — the few-shot voice/register anchors
   *  maya-voice-matcher + drafting use to make the founder's reply read native
   *  to THIS sub. Match cadence/vocab/length/format; NEVER copy content. */
  styleExemplars: Array<{
    sub: string;
    url: string;
    kind: "post" | "comment";
    verbatim: string;           // the real native text, unedited
    whyExemplary: string;       // why this reads like a real member of this sub (cadence, register, format)
    upvotesOrSignal: string;    // engagement / standing signal that it landed here
  }>;
  /** Reddit caption craft: the title is the whole click decision. */
  captionCraft: {
    titleConvention: string;    // how titles read in THIS sub (case, length, curiosity vs concrete, jargon tolerance)
    titleAntiPatterns: string[];// e.g. emoji-in-title, hype-jargon, "Excited to announce"
    firstLineGuidance: string;  // for replies: the title-equivalent first line that earns the read
  };
  parkReasons?: string[];
}
\`\`\`

## Failure modes

- **No evidence threads found.** Park. Surface to channel-judge.
- **All candidate subs are decision-stage.** Return \`replyTargets\` only, \`recommendation: "go"\` constrained to reply-only.
- **ScrapeCreators Reddit endpoint fails.** Return HTTP status; do NOT degrade to training-data recommendations.
- **Domain blacklist detected.** \`domainBlacklisted: true\` + recommend domain change (reddit.md § 6).

## Comment-tree mining (mandatory for every replyTarget)

For each thread in \`replyTargets\` (and any direct/adjacent \`evidenceCard\`), Maya descends the **full** comment tree — including all nested reply chains — before declaring the reply target. Do not stop at top-level comments. The sharpest buyer language and the highest-intent follow-up questions routinely sit in nested replies that never bubbled to the top.

1. **Fetch the comments endpoint.** Use ScrapeCreators Reddit comments endpoint OR the public \`<thread_url>.json\` (no auth, polite UA). Pull the full tree. If the thread is large, go as deep as needed until you are confident you have seen all subtrees that could contain the five mining kinds below.
2. **Mine the full tree** against the 5 kinds at every nesting level:
   - \`buyer_intent\` — a commenter asked a follow-up question that the product directly answers and that OP never addressed. This is typically the **highest-intent reply target in the thread** because the person is still actively seeking a solution. Note the nesting depth; a question buried three levels deep that went unanswered for days is a better target than a top-level comment that already has five replies.
   - \`pain_restatement\` — a comment that re-articulates the buyer's pain in sharper, more visceral language than OP did. Mine the VERBATIM phrasing; it becomes the lede of the drafted reply.
   - \`competitor_mention\` — a commenter names a specific competitor or alternative ("I've been using ToolX but it keeps breaking because…"). Set \`competitorName\`. Drives differentiation angle in the draft.
   - \`op_rejection\` — OP (or another commenter) explicitly said a class of solution "didn't work" or "I already tried X." Flags what NOT to recommend in the reply.
   - \`high_velocity\` — a comment that has gathered unusual traction relative to the thread's typical engagement pace and its own age, judged by whether it reads as a thread that is actively heating up right now, not just one that happened to be posted recently.
3. **Emit \`commentMining[]\`** with the scored comments including \`nestingDepth\`, AND populate \`commentReplyTarget\` on the corresponding \`replyTarget\` entry when the best reply target is a comment, not OP.
4. **Follow-up-question routing.** When a \`buyer_intent\` comment surfaces an unanswered question, that comment — not OP's original post — becomes the primary reply target. Surface this clearly in \`commentReplyTarget.whyHigherIntent\`.

Skipping full-tree descent on direct/adjacent threads is a failure — \`maya-continuous-research\` will steer the worker to re-run mining before accepting the output.

## Cost discipline

Max 8 ScrapeCreators calls: 3 × subreddit/search, 2 × general search, 2 × subreddit details, 1 reserve. Comment-tree mining adds 1 call per thread that gets to T1/T2 (typically 2-3 threads per run, so +2-3 calls). 1 main_maya synthesis. Timeout 20 min.

## Anti-slop check

- \`painSnippet\`, \`opQuestion\`, and every \`body\` in \`commentMining\` are VERBATIM from Reddit. Do not paraphrase. Quote and link.
- \`buyerIntentRationale\` must state specifically why this person is likely a buyer seeking a solution — not just "they mentioned the topic." If you cannot articulate a purchase-intent signal, drop the thread.
- \`conversionPath\` must be honest and non-spammy: a way to mention the product or offer a trial that fits naturally in a helpful reply. "Link in bio" or naked URL dumps are not acceptable.
- \`whyHigherIntent\` on \`commentReplyTarget\` must explain concretely why that comment beats OP as a reply target — e.g., "OP's question was answered; this nested reply from 3 days later is still unanswered and directly names the product's pain."
- Never surface a thread as a reply target and leave \`modRemoved: true\` without explicitly flagging it to the caller as low-priority.
- \`styleExemplars[].verbatim\` is captured VERBATIM as a voice/register reference only. Downstream drafting matches cadence/vocab/length/format — it must NEVER copy an exemplar's content, angle, or specifics. Drop any exemplar that itself reads templated or AI-written; it can't anchor native voice.
`;

// Source: agents/skills/maya-gtm/maya-results-reviewer/SKILL.md
const ENTRY_17_maya_results_reviewer = `---
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
2b. **Content-attribute correlation (the deeper "what SPECIFICALLY worked" — Sprint C).** Don't stop at coarse format. Each draft carries \`attributes\` (hookType / format / tone / lengthBucket / hasFace / captionStyle / postingWindow — my own tags). Correlate those attributes against OUTCOMES — clicks → conversions FIRST (from the attribution data / \`record_conversion\`), then engagement — to find what specifically lands for THIS founder: "your punchy 0-3s hooks convert 4x your explainer intros," "lowercase casual captions outperform polished ones on Reddit," "Tue-morning posts beat Thu." Feed the winners into next week's drafting (which hooks/tones/lengths to favor). Same counter-overfitting discipline as #3 — an attribute pattern needs repeated signal, not one post. Optimize for the converting attribute, not the most-liked one.
3. **Counter-overfitting check.** If a single post crushes (5-10x normal), DO NOT immediately recommend "do 10 of these." Require 3+ format-confirming wins before double-down.
4. **Buyer-vs-founder analysis.** Classify each commenter/replier. If >70% founder, flag skip-launch regardless of raw count.
5. **Unprompted-demand signal.** "Where can I try this?" replies are highest-value. 1 from a non-founder >100-follower account = Phase 2 green light.
6. **Churn-confession opportunity (rule 9.24).** Recommend churn-confession post only if something actually broke. Never fabricate.
7. **Algorithm penalty detection (x.md § 11 Failure 3).** If account-level reach drops on last 5 posts despite consistent format, \`algorithmPenaltyRisk: true\`.
8. **No paid-amplification recommendation pre-FMF (rule 9.21).** Even if a post is performing, organic CAC > 50% LTV = refuse.
9. **Compounding-cadence check (PLAYBOOK § 2 Phase 4).** Expected: 1 metric + 2 build/insight + 1 demo/proof per week + reply-mining 4-5d/week. Surface gaps.
10. **Citation-firewall on numbers.** Every metric must come from a live API pull or be marked \`staleFromCacheAt: ts\`.
11. **No "we're learning a lot" sycophancy.** If verdict is "this isn't working", say so.
12. **Positioning-vs-distribution diagnosis (the honest-diagnosis core — the moat).** This is the one most founders get wrong, and a yes-bot can't do it. When a post underperforms, separate **"they saw it and didn't want it"** from **"they never saw it."** It's a judgment call across the signals I have — NO threshold table, NO "if views > N":
    - **Read the signals as a contrast, not absolutes.** For each underperforming post, look at the *shape* across the funnel: reach/views (the proxy — see caveat) → engagement (likes/replies/upvotes) → clicks → conversions. The diagnosis lives in *where the funnel breaks*, judged relative to THIS founder's own baselines (playbook/{channel}.md) and this venue's norms.
    - **POSITIONING problem** (\`diagnosis: "positioning"\`): the post got real reach/views — people demonstrably saw it — but engagement/clicks/conversions stayed flat. They saw it and didn't care. That's a **messaging / product-market-fit / who-it's-for** problem. The hook didn't land, the value wasn't legible, or the thing genuinely isn't wanted by this audience. **Say it plainly: "This is a messaging problem, not a reach problem. More posting won't fix it — the same message in front of more people gets the same shrug."** Tie it to the existing failure-mode read: a "cringe" (high impressions + low engagement) or "feature" (replies ask "but what does it do?") post is almost always a positioning problem, not a distribution one.
    - **DISTRIBUTION problem** (\`diagnosis: "distribution"\`): the post got almost no reach/views — it never got in front of people — so engagement/clicks were never given a chance. That's a **channel / timing / venue / algorithm** problem, not a message problem. The fix is where/when/how we post (wrong subreddit, dead hour, account-silence/algo penalty per rule 7), not what we say. Don't let a distribution failure masquerade as "the idea is bad" — we can't judge the message until it's actually seen.
    - **MIXED / can't-tell** (\`diagnosis: "mixed" | "insufficient_signal"\`): say which signal you'd need to call it. Don't force a verdict you can't ground.
    - **The honest framing is the value.** Most founders reflexively blame distribution ("I just need more reach") when the evidence says positioning. Naming that — "you don't have a reach problem, you have a 'nobody wants this framing' problem" — is exactly the hard truth they're paying for. Inversely, if they're about to rewrite a message that simply never got seen, stop them: "the message is untested — it didn't reach anyone. Fix the channel first, *then* we'll know if the message works."
    - **Tier-2 caveat (signal honesty — MUST state when soft).** We are Tier 1 + Tier 3 (public engagement + our own click/conversion attribution); we do NOT have owner-only reach/impressions without per-platform OAuth. So **reach is a proxy = public views/impressions-proxy** (strong on Reddit/HN upvote+view surfaces, *soft/vanity* on TikTok/IG/YT/X/LI). When the reach signal is soft, SAY SO in the message and lower confidence: "I'm inferring reach from public view counts, which are noisy on IG — so call this a lean, not a verdict; connect the account later if you want the real reach number." Never present a proxy as a measured reach number. Clicks → conversions (Tier 3, ours) are the *reliable* leg — weight them hardest when present.

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
    // Positioning-vs-distribution diagnosis (rule 12). "positioning" = saw-but-didn't-want
    // (messaging/PMF problem); "distribution" = never-saw (channel/time/venue problem).
    diagnosis: "positioning" | "distribution" | "mixed" | "insufficient_signal" | "not_applicable";
    diagnosisRationale: string;         // evidence-cited: the funnel shape that drove the call
    reachSignalConfidence: "measured" | "proxy_strong" | "proxy_soft"; // Tier-2 caveat — proxy unless OAuth
  }>;
  formatPerformance: Array<{
    formatPatternId: string;
    sampleCount: number;
    medianEngagementPct: number;
    recommendation: "double_down" | "iterate" | "drop" | "more_data_needed";
    counterOverfittingNote?: string;
  }>;
  formatMarketFitVerdict: "not_yet" | "candidate" | "confirmed";
  // Week-level positioning-vs-distribution rollup (rule 12) — consumed by maya-weekly-review Block 3.
  // When the pattern across posts is "real reach, no want", positioningProblem=true and more posting won't fix it.
  positioningVsDistribution: {
    dominantDiagnosis: "positioning" | "distribution" | "mixed" | "insufficient_signal";
    positioningProblem: boolean;        // true = messaging/PMF, NOT a reach problem; more posting won't fix it
    evidenceSummary: string;            // cited funnel shape across the week's posts
    reframeToTest?: string;             // if positioning: the messaging/audience reframe Maya would test next
  };
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

\`recommendedNextActions[].action\`, \`verdict\`, and \`diagnosisRationale\` strings are operator-facing. Run \`maya-slop-critic\`. Must not read "let's iterate and learn from this exciting first launch!" — must read "this was a void launch by rule 9.8; the format reached only the founder circle; we change channel or sharpen the hook within 14 days." Terse, honest, cited. The positioning-vs-distribution call must be equally blunt: "1,400 people saw this and 6 engaged — that's a messaging problem, not a reach problem. Posting it again won't change the answer; the framing has to change," vs "this got 40 views — it never had a chance. The message is untested; we fix the channel before we touch the copy." Never soften a positioning verdict into a distribution one to spare feelings.
`;

// Source: agents/skills/maya-gtm/maya-slop-critic/SKILL.md
const ENTRY_18_maya_slop_critic = `---
name: maya-slop-critic
description: The anti-slop / AI-tell critic. Apply PLAYBOOK § 6 banned-phrase list + banned-structure scan + LLM-judgment structural AI-tell pass + voice match + read-aloud test. Returns "rejected with reasons" on any trip. The bar is native-voice fidelity, NOT detector-dodging.
---

# maya-slop-critic

## Purpose

Every draft prose output in the system passes through this skill before shipping. The job is to detect writing that reads like a generic AI / templated marketer wrote it and surface specific rewrites — banned phrases, banned structures, *structural AI-tells*, voice divergence, generic-template feel. PLAYBOOK § 6 codifies the lexical rules; this skill enforces them AND adds an LLM-judgment structural pass.

## The honest framing (read before judging anything)

The enemy is **not an AI detector**. There is no reliable platform AI-detector demoting text as a ranking signal — detectors are noisy and platforms don't run them at scale. We never chase "undetectable." The real penalties are concrete: Reddit/HN **community + mod rejection** (and founder-account ban risk), and TikTok/IG/YT **engagement starvation** of generic, voiceless content. So the single question this skill answers, on every draft, is:

> **"Would a real person from this community have actually written this?"**

A draft that reads as native, specific, and opinionated passes — even if it happens to trip a hypothetical detector. A draft that is smooth, tidy, hedged, and voiceless FAILS — even if it has zero banned phrases. Structural tidiness is the giveaway, not vocabulary alone.

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

3. **Rule 9.11b — STRUCTURAL AI-tell critic (LLM JUDGMENT, not regex).** This is the load-bearing addition. The banned-phrase and banned-structure lists above catch known surface patterns; this pass catches the *shape* of AI-generated prose that no phrase list can enumerate. **Do NOT implement this as regex, counts, or hardcoded thresholds** (per the no-heuristics rule) — read the draft as a human from the target community would and judge whether it has the telltale smoothness of machine-written or template-marketer text. Look for, and reason about, these tells together (any one is a yellow flag; a cluster is a REJECT):
   - **Em-dash as default connective.** AI reaches for em-dashes to glue clauses where a real person would use a period, a comma, or just two sentences. Over-reliance — especially the rhythmic "X — Y — Z" cadence — reads machine-made. Judge by feel, not a per-paragraph count.
   - **Suspiciously tidy tricolons / rule-of-three.** "Faster, cheaper, and more reliable." Real people don't naturally land on three balanced items this often. One deliberate tricolon is fine; a draft built out of them is a tell.
   - **"It's not just X, it's Y" (and "not only… but also").** The signature AI pivot-to-profundity construction. Almost always a tell. Flag every instance.
   - **Uniform sentence rhythm.** Real writing has burstiness — a fragment, then a long winding sentence, then three words. AI defaults to a metronome of medium-length, evenly-weighted sentences. If every sentence is the same length and shape, REJECT.
   - **Over-hedging / no stance.** "It can be helpful in many cases." "This might be worth considering." A real founder in their niche has an *opinion*. Hedged, both-sides, committee-safe prose reads bot-written. Flag absence of a clear point of view.
   - **Zero opinion / zero specifics.** Prose that could be about any product, sent to anyone, citing nothing concrete (no real number, no proper noun, no lived detail). Generic-to-anyone = REJECT. This is the symptom the whole skill exists to kill.
   - **Suspicious symmetry / tidiness.** Perfectly parallel clause structure, every list item the same grammatical shape, a clean intro-body-closer arc on a casual reply. Humans are messier; native posts have texture, asides, and asymmetry.
   - **Pivot-to-uplift closer.** A neat motivational/aspirational wrap-up sentence ("And that's how you turn a setback into a setup.") that a real person wouldn't tack on. Tell.
   For each tell found, emit a \`hit\` with \`type: "structural_ai_tell"\`, the offending \`snippet\`, and a \`suggestion\` that makes it read like a real person from this niche — break the rhythm, take a side, swap the em-dash for a period, add a concrete specific, cut the tidy closer. The verdict question is always: *would someone in {community} have written this, or does it read like generic AI?*

4. **Rule 9.12 — voice-match scan.** Compare draft to operator's last-5 authentic posts. Diverges = REJECT. Check: sentence length variance, capitalization, emoji frequency, parenthetical-aside frequency, first-vs-third-person, profanity tolerance.
5. **Rule 9.13 — "Excited to announce" auto-reject.** No re-read needed. Reject immediately, propose rewrite as thinking-process post (linkedin.md § 4).
6. **Read-aloud test.** Sounds like a press release = REJECT.
7. **Channel-specific bans.**
   - LinkedIn: broetry overuse, "Agree?" closers, tagged-friend humblebrag, fake humility, "founder" 3x in first paragraph, stock-photo selfies.
   - TikTok: literal "link in bio", "Hey guys" / "What's up everyone", "follow for more" in first 70%.
   - Reddit: "DM me" / PM solicitation in promo-sensitive subs, naming competitors in promo-adjacent comments, hype-jargon in title, emoji in title.
   - X: hype emoji clusters (🚀🔥), "RT for reach", "Like if you agree", "Comment YES and I'll DM you", dunk-quote-RTs.
8. **Number-presence (x.md rule 8).** X posts must contain ≥1 concrete number. No number = REJECT (or surface to operator for the number).
9. **CTA singularity.** Multiple CTAs in one post = REJECT.
10. **Operator's-instinct final filter (PLAYBOOK rule 6.1).** If uncertain, return \`verdict: "borderline"\` with: "read this like a stranger sent it to you — do you sound like this?"
11. **No invented voice.** Slop-critic rejects; it doesn't write the operator's voice from scratch. If voice fingerprint missing, mark \`voiceMatch: "no_fingerprint_available"\` and apply only banned-phrase + structure + structural-AI-tell scans.

## Output schema

\`\`\`ts
interface SlopCriticVerdict {
  verdict: "approved" | "rejected" | "borderline";
  hits: Array<{
    rule: string;
    type: "banned_phrase" | "banned_structure" | "structural_ai_tell" | "voice_divergence" | "channel_ban" | "missing_number" | "multiple_ctas";
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
- **No voice fingerprint.** Apply banned-phrase + structure + structural-AI-tell + channel-ban scans only. Mark \`voiceMatch: "no_fingerprint_available"\`. The structural-AI-tell pass still runs — it needs no fingerprint, only the "would a real person from this community have written this?" judgment.

## Cost discipline

0 ScrapeCreators / 0 WebFetches / 1 main_maya call (low thinking — pattern matching, not synthesis). Heartbeat-safe. Timeout: 3 min.

## Anti-slop check

Self-referential: this skill IS the anti-slop check. The \`suggestion\` strings inside \`hits[]\` must themselves pass the rules — don't suggest "leverage your voice" as the rewrite for "leverage X". Suggest plain English instead.
`;

// Source: agents/skills/maya-gtm/maya-tiktok-demo-strategist/SKILL.md
const ENTRY_19_maya_tiktok_demo_strategist = `---
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

1. **tiktok.md rule 1 — V1 manual-post gate.** IF \`canPostTikTokManually !== true\` THEN \`recommendation: "park_tiktok"\`. This is a hard platform constraint: ClawLaunch V1 does not have TikTok API posting rights; the operator must post from their own account. No workaround exists.
2. **tiktok.md rule 2 — restricted-state block.** IF \`tiktokWarmupState === "restricted"\` THEN return resolve-Account-Check instructions. Restricted accounts cannot post; resolve first.
3. **tiktok.md rule 3 — warmup gate.** IF \`tiktokAccountAgeDays < 14\` OR state !== "ready" THEN return warmup sequence (§ 6). TikTok's own risk system suppresses new accounts; warming is a platform reality, not a discretionary suggestion.
4. **tiktok.md rule 4 — unshowable + no-slideshow refuse.** IF showability === "unshowable" AND operator refuses slideshow THEN park.
5. **tiktok.md rule 5 — faceless default.** IF product has a clear UI moment that lands quickly OR a meaningful before/after transformation THEN default faceless screen-record for launch posts. Cite Cal AI / Daze / Pushscroll as proof-of-concept. Operator familiarity and comfort with screen-recording matters — confirm before recommending.
6. **tiktok.md rule 6 — camera-shy routing.** IF \`onCameraOk === false\` AND showable THEN faceless screen-record only.
7. **tiktok.md rule 7 — slideshow for text-heavy niches.** When niche research (format-researcher output) shows dev tools / B2B / finance / education content over-indexing on carousels, Photo Mode is primary. Let the research data lead; don't assume by niche label alone.
8. **tiktok.md rule 8 — talking-head trust products.** Agency / coaching / consulting products where the founder IS the credibility signal — if operator is comfortable on camera AND niche research confirms talking-head formats get traction, recommend founder talking-head.
9. **tiktok.md rule 10 — "link in bio" ban.** Shot plan and CTA NEVER include "link in bio". Choose between search-by-name, pinned-comment URL, and DM-keyword based on what makes the most sense for how a viewer would act on this specific product: if the product is searchable by a distinctive name, search-by-name removes friction most cleanly; if the product needs context (landing page, demo video), pinned-comment with a URL is stronger; if the goal is a conversation (consultative product, waitlist), DM-keyword builds intent-qualified leads. Pick the one that creates the shortest path from "I just watched this" to "I'm trying it."
10. **tiktok.md rule 11 — format confidence.** Chosen format must be supported by evidence from \`maya-tiktok-format-researcher\` showing clear recurrence in the niche. If format-researcher returned \`confidence: "insufficient_evidence"\`, set \`formatConfidence: "low"\` and flag \`formatResearchNeeded: true\` before committing to a format.
11. **tiktok.md rule 13 — Personal Account preference.** First 30-60 days, Personal Account > Business Account (full music catalog). This is a platform-behavior reality: Business Accounts have a restricted commercial sound library.
12. **tiktok.md rule 15 — cadence cap.** For accounts under 30 days old: post conservatively, 1-2/day ceiling. For warmed accounts: 2-3/day comfortable ceiling. Hard cap 4/day regardless — above this, TikTok's risk system flags accounts. These caps are platform-behavior constraints, not style preferences.
13. **Length judgment.** Lead with the format-researcher's length distribution for the niche. Short-form (under 30s) works best for demo-cold-opens and pattern-interrupts; slightly longer works when the before/after requires setup. Don't impose a number — use the niche's revealed preference as the anchor.
14. **Safe zones.** Every shot plan keeps key text and CTA elements clear of TikTok's persistent UI overlay zones (bottom of frame, right edge). Exact pixel values vary by device; the goal is ensuring nothing load-bearing gets obscured. Use judgment to confirm beats are centered in the safe area.
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
- **Showability disagreement.** IF operator insists TikTok for unshowable + won't do slideshow THEN park + cite rule 4 + offer X / LinkedIn / Reddit instead.

## Cost discipline

0 ScrapeCreators (format research is separate). 0-1 WebFetch. 1 main_maya. Timeout 10 min.

## Anti-slop check

\`onScreenText\` and \`voiceOver\` strings must pass slop-critic (banned phrases). Hook copy itself comes from \`maya-content-format-miner\` with full slop-critic pass.
`;

// Source: agents/skills/maya-gtm/maya-tiktok-format-researcher/SKILL.md
const ENTRY_20_maya_tiktok_format_researcher = `---
name: maya-tiktok-format-researcher
description: Find what's working in the operator's niche on TikTok RIGHT NOW. Identify the format that clearly recurs across the strongest recent videos in the niche (tiktok.md § 7).
---

# maya-tiktok-format-researcher

## Purpose

TikTok rewards format-remix, not content-copy. This skill mines the operator's niche on TikTok to find the dominant winning format — hook structure, length, on-screen-text style, music, CTA pattern — and certifies it by identifying clear recurrence across the strongest recent videos in the niche (tiktok.md § 7). Demo-strategist consumes the output to pick faceless / talking-head / slideshow with confidence.

A format that goes viral but pulls the wrong audience is actively harmful. The goal is buyer-pull: formats that produce comments like "where do I get this", "does it do X", or "finally" from people who look like your target buyer. Raw view count is a vanity metric; retention momentum (the algorithm continuing to push a video after the first day) + buyer-language in comments together tell you whether a format converts audience into pipeline.

## When to invoke

- IF \`maya-tiktok-demo-strategist\` returned \`formatResearchNeeded: true\` THEN run.
- IF channel-judge is weighing TikTok and \`formatConfidence\` is unknown THEN run.
- IF results-reviewer detects operator's current TikTok format underperforming THEN re-run.
- NEVER from heartbeat; most ScrapeCreators-intensive skill (cap 12 calls).

## Required reads

1. APP.md, GTM.md.
2. PLAYBOOK.md § 3 step 1-3, § 7.
3. **playbook/tiktok.md — MANDATORY § 7 (niche-format mining), § 2 (hook catalog), § 3-5 (format anatomies).**
4. MEMORY.md.

## Decision rules

1. **Format recurrence (tiktok.md § 7).** A format is "winning" when it clearly recurs across a meaningful share of the strongest recent videos in the niche — not because it hits an arbitrary count threshold, but because you can see the same hook structure, visual rhythm, and CTA pattern playing out independently across multiple creators. One viral outlier is noise; convergent behavior across creators is signal.
2. **Retention + watch-momentum over raw views.** Prefer formats that show signs of sustained algorithmic push (high share-to-view ratio, comments arriving days after publish, reuse by multiple creators) over formats with a single spike. A moderate-reach format that keeps getting distributed beats a flash-in-the-pan hit.
3. **Top-by-keyword sampling + deep pagination.** For each candidate keyword, pull the top batch via \`/v1/tiktok/search/top\`. If the niche signal is thin (few results, dominated by one creator, or mostly ads), paginate deeper and try adjacent keywords before concluding \`insufficient_evidence\`. Don't let a shallow first-page pull misrepresent a niche that does have signal.
4. **Recency judgment.** Prefer recent videos — algorithm drift is real. How recent "recent enough" is depends on how fast-moving the niche is: a trend-driven niche goes stale in weeks; a utility/tool niche has slower drift. Use judgment; don't mechanically discard by calendar date.
5. **Diversity check.** If the top results are dominated by 1-2 accounts, surface \`nicheCreatorConcentration: "high"\`. Convergent behavior across many independent creators is a more reliable signal than one prolific account.
6. **Format taxonomy.** Tag each video: \`faceless_screen_record\`, \`founder_talking_head\`, \`slideshow_photo_mode\`, \`mixed\`. Aggregate.
7. **Hook taxonomy.** Tag each hook against tiktok.md § 2 catalog (pattern-interrupt, outcome-promise, question, demo-cold-open, pain-validation, proof-first, POV, contrarian, before/after, comment-bait).
8. **Length sampling.** Median + p25/p75 per niche.
9. **Sound velocity.** Flag audio that appears to be accelerating — spreading fast across multiple unrelated accounts in the niche — as a potential early-adoption opportunity (tiktok.md § 10 — 12-24h sweet spot). Also flag sounds you see spreading to competitor products: if a sound already has market saturation in the niche, its uplift window may be closing.
10. **CTA pattern.** Aggregate: search-by-name / pinned-comment / DM-keyword. Refuse "link in bio" recommendations.
11. **Buyer-language comment mining.** For the top confirming videos in the identified format, pull comments and scan for buyer-language signals: intent phrases ("where do I get this", "how do I sign up", "does it work with X"), problem-validation phrases ("I've been looking for this", "finally"), and objection phrases ("is it free", "how much"). A format with strong buyer-language in comments ranks above a format with the same reach and no buyer-language. Surface the best-signal comment excerpts verbatim in \`buyerLanguageExamples\`.
12. **No recommendation without clear evidence.** If no format shows clear recurrence across independent creators, \`confidence: "insufficient_evidence"\`. Do not force a recommendation from thin data.
13. **Style-exemplar capture (native-voice fidelity — Sprint I).** From the confirming videos in the winning format, capture **5-10 real, top-performing, HUMAN native examples verbatim** — the on-screen-text hook line, the spoken/written caption, and the hashtag set — from real creators in this niche (not ads, not one dominant account). These are few-shot **voice/register anchors** for \`maya-voice-matcher\` + caption drafting: they encode how a real creator in *this niche* phrases a hook, how casual/punchy the caption is, which hashtags actually run here. Match cadence/length/format; **never copy content.** Skip anything that reads templated/AI. Emit in \`styleExemplars[]\`. The honest framing: there's no TikTok AI-detector — the penalty for generic captions is engagement starvation, the algorithm simply doesn't push voiceless content.
14. **TikTok / IG caption craft (tiktok.md).** Encode this niche's caption conventions in \`captionCraft\`. **TikTok:** the **hook line** (first ~3 words / on-screen text) does the work — pattern-interrupt or outcome-promise, never "Hey guys"; caption is short and human; hashtags are a small native set (broad + niche + intent), not a wall. CTA is search-by-name / pinned-comment, never "link in bio". **Instagram (Reels/story):** a short **story-shaped** caption + one clear **CTA** (the IG convention), hashtags in the niche's normal count. Pull the actual hook-line and hashtag norms from the captured exemplars, not from generic advice.

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
    retentionMomentumSignal: string; // qualitative description of sustained-push evidence
    buyerPullRating: "strong" | "moderate" | "weak" | "unknown"; // based on comment mining
  };
  hookPatternCounts: Record<string, number>;
  formatCounts: Record<string, number>;
  acceleratingSounds: Array<{
    soundId: string;
    title: string;
    artist?: string;
    usageLast7d: number;
    firstSeenHoursAgo: number;
    velocityVerdict: "pre_peak_0_24h" | "early_24_72h" | "post_peak_skip" | "competitor_saturated";
  }>;
  exampleVideos: Array<{ url: string; handle: string; views: number; likes: number; durationSec: number; format: string; hookPattern: string; ctaPattern: string; soundId?: string; excerpt?: string }>;
  buyerLanguageExamples: Array<{ videoUrl: string; comment: string; signalType: "intent" | "problem_validation" | "objection" | "buyer_adjacent" }>;
  ctaTaxonomy: Record<"search_by_name" | "pinned_comment" | "dm_keyword" | "other", number>;
  searchQueriesUsed: string[];
  paginationDepth: string; // describe how many pages / adjacent keywords were tried
  /** 5-10 real, top-performing, HUMAN native examples captured VERBATIM from the
   *  niche — the few-shot voice/register anchors for maya-voice-matcher + caption
   *  drafting. Match hook cadence/length/format + hashtag norms; NEVER copy content. */
  styleExemplars: Array<{
    videoUrl: string;
    handle: string;
    hookLineVerbatim: string;     // the on-screen / opening hook, verbatim
    captionVerbatim: string;      // the real caption, verbatim
    hashtagsVerbatim: string[];   // the real hashtag set used
    whyExemplary: string;         // why this reads native to the niche
  }>;
  /** TikTok + IG caption craft drawn from the exemplars, not generic advice. */
  captionCraft: {
    tiktok: {
      hookLineConvention: string; // first-3-words / on-screen-text pattern that wins here
      captionStyle: string;       // short/human register
      hashtagNorm: string;        // the native hashtag set shape (broad + niche + intent)
      ctaPattern: "search_by_name" | "pinned_comment" | "dm_keyword";
    };
    instagram: {
      captionShape: string;       // story-shaped caption convention
      cta: string;                // the one clear CTA
      hashtagNorm: string;
    };
    antiPatterns: string[];       // "Hey guys", "link in bio", hashtag walls, "follow for more" early
  };
  rulesCited: string[];
}
\`\`\`

## Failure modes

- **Niche has no English-language TikTok activity.** \`confidence: "insufficient_evidence"\`. Recommend channel-judge demote TikTok.
- **ScrapeCreators returns zero results.** Check param shape (tiktok.md § 7). If still empty, request operator-narrowed keywords.
- **All top videos are paid ads.** \`topResultsAreAds: true\`. Recommend broader keyword.
- **A single creator is behind most of the winning examples.** \`nicheCreatorConcentration: "high"\` — remix risky (you'd be copying one person, not a format the niche has converged on).

## Cost discipline

Max 12 ScrapeCreators calls: 3-5 keywords × 1 \`/search/top\` + 2-3 \`/search/hashtag\` + 1 \`/hashtags/popular\` + 1-2 \`/profile/videos\`. 1 hard_research_beta keyword expansion + 1 main_maya. Timeout 20 min. No heartbeat spend.

## Anti-slop check

Structured taxonomy output, slop-critic NOT invoked. \`excerpt\` strings and every \`styleExemplars[]\` field (\`hookLineVerbatim\`, \`captionVerbatim\`, \`hashtagsVerbatim\`) from real videos are VERBATIM — do not paraphrase. Exemplars are voice/register references only; downstream caption drafting matches their cadence/length/hashtag-shape but NEVER copies an exemplar's content. Drop any exemplar whose caption itself reads templated/AI.
`;

// Source: agents/skills/maya-gtm/maya-ugc-system-advisor/SKILL.md
const ENTRY_21_maya_ugc_system_advisor = `---
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
const ENTRY_22_maya_viral_demo_moment_miner = `---
name: maya-viral-demo-moment-miner
description: Find showable app moments — before/after contrasts, screenshot sequences. Source: walkthrough + product UI.
---

# maya-viral-demo-moment-miner

## Purpose

TikTok / Reels / native LinkedIn video rewards a specific kind of moment: a UI change a stranger can comprehend almost immediately, without context, without audio. Cal AI's "point camera at food → calories appear" is the textbook example (tiktok.md § 1). This skill mines the operator's product for those moments.

The goal is not to showcase features — it is to find the activation moment: the instant where a viewer thinks "I want to try that." That moment is almost always a transformation (before → after), a reveal (input → surprising output), or a relief (problem → gone). Rank beats by how powerfully they create that want-to-try reaction in a cold viewer, not by how much functionality they demonstrate.

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

1. **Comprehension speed as judgment, not stopwatch.** Every demo beat is a UI change a cold stranger can comprehend quickly — ideally within a few seconds — without audio. The standard is: could someone who has never heard of this product understand what just happened? If you need to answer "yes but only if they watch it twice," the beat fails. Speed of comprehension matters; the specific threshold depends on the complexity of the change.
2. **Before/after > before-only.** Beats with explicit before→after framing rank higher. The contrast is what makes a stranger stop scrolling.
3. **Output-object detection.** If the product produces an interesting output that stands alone (image, video, code, doc, chart), the output IS the demo beat. Show the output first; let the viewer reverse-engineer the value.
4. **Mute-test.** Every beat must communicate with sound off — the majority of social video is watched muted, especially on first scroll. If a beat requires audio to be understood, it is a weak beat unless founder talking-head is the chosen format.
5. **Activation-moment prioritization.** Rank beats by how strongly they produce the "I want to try this" reaction. Transformation beats (something changes), relief beats (problem disappears), and reveal beats (unexpected output appears) outrank informational beats (feature described or listed). The viewer's emotional reaction — not how much the product does — determines rank.
6. **Hook moment in frame 1.** No "let me explain" intro. The change or reveal is already happening when the video starts. Context comes after, if at all.
7. **Safe-zone awareness.** TikTok's persistent UI elements (like/comment/share, video info bar) cover the bottom and right edges of the frame. De-rank beats where the key UI change happens in those overlay zones — a viewer may never see it. The goal is that the load-bearing visual is clearly in the unobscured center of frame. Don't need exact pixels; use judgment to confirm nothing critical is in the danger zones.
8. **Beat count judgment.** Produce enough beats to give demo-strategist real options — typically 3 to 7 is the useful range. Below that there's nothing to work with; above that you're padding. Return the top ranked beats, not everything you found.
9. **Anti-feature-list.** "Opens app → navigates to dashboard → shows settings" is a tutorial, not a demo beat. Beats represent moments of *change* the viewer can have a reaction to. No reaction = no beat.
10. **Pre-launch products.** IF \`app.stage === "pre-launch"\` AND only mockups exist THEN mark beats \`mockupOnly: true\` — mockup-based demos have worked (Pushscroll precedent) but operator must disclose if directly asked.
11. **Citation-firewall.** Each beat describes a real observable change grounded in the walkthrough or screenshots provided. If operator claims "the app does X" but it isn't visible in any provided material, do NOT mine X as a beat. Mark \`unverifiable: true\` and ask for a recording that shows it.

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

// Source: agents/skills/maya-gtm/maya-voice-matcher/SKILL.md
const ENTRY_23_maya_voice_matcher = `---
name: maya-voice-matcher
description: Score how well a drafted reply/post/thread matches the operator's actual voice — drawn from their existing public writing (X/Reddit/LinkedIn) or onboarding answers as fallback. Combines with maya-slop-critic for a final ship-or-revise gate. Each gtmDraftedContent row gets a voiceMatchScore + slopCriticPassed flag.
---

# maya-voice-matcher

## Purpose

When subagents (reddit_research, x_research, etc.) draft replies to surface as user-facing content, the drafts default to LLM-tone. Two failure modes show up:
1. **AI slop** — banned phrases ("game changer," "unlock," "supercharge"), MBA-deck cadence, fake certainty.
2. **Off-voice** — technically correct content that doesn't sound like the operator. Friends would clock it as bot output.

This skill is the pre-publish quality gate. Every draft goes through it before the calendar-populator surfaces it as an actionable event. Failed drafts go back to the originating subagent for a rewrite.

## When to invoke

- IF a \`_research\` subagent just landed a gtmDraftedContent row THEN run on it.
- IF the operator rejected a previous draft with feedback ("too formal") THEN re-run with that feedback in the voice profile.
- IF format-market-fit shifts (Phase 4 detection) THEN re-score the cadence library against the new winning format's voice.

## Required reads

1. **USER.md** — operator's name, constraints, founderWhy (their own words for why they built it — strong voice signal).
2. **SOUL.md** — Maya's voice contract for the operator-facing layer; ban list applies to drafts that will ship as the operator's content.
3. **PLAYBOOK.md § 6** — Anti-slop section. The canonical ban list.
4. **gtmDraftedContent row** for the draft being scored.
5. **Any prior approved drafts** for the same platform (the live voice fingerprint).
6. **Operator's existing public writing** — the founder's OWN real posts. In manager mode these were **ingested during onboarding (APP.md Phase 0 / existing-account ingestion)** and are already on disk; otherwise pull via Composio (last 20 X tweets, last 10 Reddit comments, last 5 LinkedIn posts). Highest-fidelity voice source. Prefer same-platform samples.
7. **Venue style exemplars** (\`styleExemplars[]\` from the per-channel research skill for this platform): 5-10 real top-performing HUMAN native posts captured verbatim from the exact venue. The register anchor — what "native here" sounds like. Match cadence/vocab/length/format; never copy content.

## Decision rules

### 1. Build the voice fingerprint — condition on BOTH the founder's own posts AND the venue exemplars

The match is conditioned on two independent anchors. A draft that sounds like the founder but ignores how the venue talks reads out of place; a draft that nails the venue register but isn't in the founder's voice reads ghost-written. The target is the **intersection**: the founder's voice, expressed in a register native to this specific venue.

**Anchor A — the founder's OWN real posts (the voice anchor).** Where the founder already has accounts, **manager mode ingested their real posts during onboarding (APP.md Phase 0 / existing-account ingestion)** — this is the highest-fidelity source and is already on disk; you don't have to re-pull it. Input tiers, in order of preference:

1. **Founder's ingested / existing public writing** (highest signal). The manager-mode Phase 0 ingestion captured their real posts per platform; where it didn't (or to supplement), pull the operator's last N posts via Composio. Look for: average sentence length and its *variance* (burstiness), contraction usage, technical-vs-casual register, characteristic phrases, how they open and sign off, em-dash habit, single-sentence-paragraph habit, profanity tolerance, emoji frequency. Note 5-8 distinctive features. **Prefer same-platform samples** — how the founder writes on X is not how they write on LinkedIn.

2. **Approved prior drafts** (medium signal). Use the operator's accept/reject history on previous drafts as a voice signal. Drafts the operator approved unchanged represent voice fit. Drafts the operator EDITED tell you what to avoid.

3. **Onboarding answers + USER.md \`founderWhy\`** (lowest signal, but always available). Their own answers about why they built the product capture their natural tone. Use as fallback when 1+2 are empty.

**Anchor B — the venue style exemplars (the register anchor).** The per-channel research skills (\`maya-reddit-demand-researcher\`, \`maya-x-founder-led-researcher\`, \`maya-linkedin-fit-researcher\`, \`maya-tiktok-format-researcher\`, \`maya-content-format-miner\`) each capture **5-10 real, top-performing, HUMAN native posts verbatim from the exact venue** as style exemplars (\`styleExemplars[]\`). These are the few-shot voice/register anchors: they encode the cadence, vocabulary, length, and format a real participant in *this specific subreddit / niche / feed* uses. Read them. Match cadence/vocab/length/format — **never copy their content** (that's plagiarism and a slop tell in itself). They tell you what "native here" sounds like; Anchor A tells you what "the founder" sounds like.

**When the two conflict** (founder writes long essays, the venue rewards 2-line replies): bend register toward the venue, keep voice (word choice, stance, characteristic phrases) toward the founder. Note the tension in \`userFeedback\` so the operator can confirm.

### 2. Score each draft on three dimensions

For every draft, produce three numeric scores in [0,1]:

- **Slop score** (PLAYBOOK § 6 ban list compliance). 1.0 = no banned phrases, no MBA-deck structure, no AI-paragraph rhythm. <0.7 = fail.
- **Voice match** (fingerprint similarity to Anchor A — the founder's own posts). 1.0 = reads like the operator wrote it. Compare sentence length distribution and burstiness, vocabulary, characteristic phrases, stance. <0.6 = fail.
- **Native-register fit** (similarity to Anchor B — the venue style exemplars). 1.0 = reads like a real participant in this exact venue wrote it (right length, cadence, format, vocabulary for the subreddit/niche/feed). A grammatically perfect post that's the wrong shape for the venue fails here. <0.6 = fail. (When exemplars are unavailable for the venue, default this dimension to neutral 0.5 and note it.)
- **Specificity** (concrete-vs-generic ratio). Drafts referencing specific URLs / numbers / proper nouns from the source thread score higher. Drafts that could be sent to any product score lower. <0.5 = fail.

Combine the four dimensions into a single \`voiceMatchScore\` using judgment (this is a weighting heuristic for the score field, not a hard gate): roughly \`0.3*voice + 0.25*nativeRegister + 0.3*specificity + 0.15*slop\`, but let the lowest dimension dominate — a draft that aces voice and specificity but is the wrong shape for the venue (low native-register) should not score "ship." Persist in \`gtmDraftedContent.voiceMatchScore\`.

### 3. Slop-critic pass

Run \`maya-slop-critic\` (existing skill) on draftText + every draftSegments entry. Collect all banned-phrase hits + structural critiques.

- \`slopCriticPassed: true\` if zero hits AND structural critique empty.
- \`slopCriticPassed: false\` otherwise. Populate \`slopCriticFailures: string[]\` with the specific reasons.

### 4. Routing

After scoring:
- **All-pass (voiceMatchScore ≥ 0.7 AND slopCriticPassed)** → mark \`approvalState: "pending_approval"\`. The calendar-populator picks it up. Operator sees it in Telegram queue.
- **Voice fail only (slopCriticPassed but voiceMatchScore < 0.7)** → revise. Send back to originating subagent with feedback: "Tone shift — these specific edits to match founder's voice." Re-spawn subagent with the edit instructions.
- **Slop fail** → revise. Send specific banned phrases that triggered the fail. Re-spawn subagent.
- **Both fail** → drop the draft entirely (mark \`approvalState: "rejected"\`, \`userFeedback: "auto-rejected: slop + off-voice"\`). Surface to user via Telegram only if the target thread is unique enough to be worth flagging.

### 5. Voice contract enforcement

This skill itself produces user-facing content (the voice fingerprint may surface in operator messages). Apply SOUL.md voice contract:
- **OK to say**: "I tightened a few things — your replies usually start with a question, so I matched that pattern."
- **BANNED**: "I ran maya-voice-matcher on the gtmDraftedContent row and the voiceMatchScore was 0.62 so I rejected the draft."

## Output

POST scoring results to \`/lc_gtm/update_draft_voice_match\` (Sprint 2.4 endpoint):

\`\`\`ts
{
  idempotencyKey: string,           // hash of (draftId + version)
  draftId: Id<"gtmDraftedContent">,
  voiceMatchScore: number,          // 0-1
  slopCriticPassed: boolean,
  slopCriticFailures?: string[],    // populated when not passed
  approvalStateUpdate?: "pending_approval" | "rejected",  // routing decision
  userFeedback?: string,            // when rejected
}
\`\`\`

## Failure modes

- **No voice signal available** (no ingested posts, no public writing, no prior drafts, no onboarding answers beyond minimal). Voice score (Anchor A) defaults to neutral 0.5 — but **the venue style exemplars (Anchor B) still give you a register floor**, so don't ship voiceless: match the native cadence/length/format of the exemplars and lean on specificity. Surface to user via Telegram: "I need a sample of how you write so my drafts sound like you. Reply with 2-3 sentences in your usual voice."
- **All drafts failing both gates.** Likely the subagent is producing template-y output. Reset: re-spawn the subagent with a tighter prompt + explicit voice samples from USER.md.
- **Operator approval inconsistency** (approves draft A, rejects functionally-identical draft B). Surface the contradiction: "I noticed you approved [link] but rejected [link] which read very similarly. Want to tell me what's different about them?" Voice profile updates from the answer.

## Cost discipline

0 ScrapeCreators. Optional 1 Composio call (fetch public writing — cached after first pull). 1-2 main_maya LLM calls per draft (scoring is mostly structured-output work; voice analysis can use medium thinking budget). Timeout 3 min per draft.

## Anti-slop check

Yes — this skill itself outputs operator-facing copy (when surfacing voice feedback). All output passes the same slop-critic gate it enforces on drafts.
`;

// Source: agents/skills/maya-gtm/maya-weekly-review/SKILL.md
const ENTRY_24_maya_weekly_review = `---
name: maya-weekly-review
description: Sunday-19:00-local strategic review. Last week's score across channels + North-Star on-track/at-risk, what we learned (extracted to gtmNicheLearnings), strategic shift for next week if any, and a regenerated next-week plan re-weighted by what actually converted.
---

# maya-weekly-review

## Purpose

Daily cadence is tactical. Weekly review is strategic. Once a week, Maya looks at the prior 7 days as one block: did the channels we bet on actually convert, are the angles working, did relationships warm. Then she shifts strategy for the coming week — that's how the product compounds.

## When to invoke

- Native cron Sunday 19:00 operator-local. Self-scheduled.
- Operator manually requests ("how'd this week go?") — re-synthesize from existing data.

## Pre-conditions

1. ≥ 7 days of \`gtmActionLog\` rows (skip first weekly review until 7 days have elapsed; surface a placeholder message instead).
2. ≥ 7 days of \`gtmPostResults\` for owned posts.
3. Foundation tables (\`gtmBuyerMap\`, \`gtmChannelScorecard\`, etc.) are populated.

## Required reads

1. **GTM.md** — current bet channels.
2. **USER.md** — operator goals (signups? eyeballs? specific deal?).
3. **SOUL.md** — voice contract.
4. Last 7 days of \`gtmActionLog\` (Maya reads via \`/lc_gtm/get_my_action_log?since_ms=<7d ago>\`).
5. Last 7 days of \`gtmPostResults\` (per-channel performance).
6. Existing \`gtmNicheLearnings\` (don't re-extract what's already known).
7. **\`maya-results-reviewer/SKILL.md\` § rule 12 (positioning-vs-distribution).** Run the reviewer over the week's underperforming posts (cached reads — no fresh API spend) and read its \`positioningVsDistribution\` rollup. The week-level diagnosis feeds Block 3 below.

## The review structure

As tight as Maya can make it while still useful. Four blocks:

### Block 1 — Last week's score

"Week 3: 12 replies sent, 4 owned posts, 8 calendar events completed (of 14 planned). Reddit hit hardest — 47 total upvotes across replies + 2 OP responses. X is quiet — 1 reply with traction, the rest under 10 likes."

Numbers grounded in \`gtmActionLog\` + \`gtmPostResults\`. If a metric isn't available, say so — don't fabricate.

**North-Star status (always).** Read the North Star off GTM.md (the \`northStarMetric\` / target / deadline) and the real outcome numbers from \`/lc_gtm/get_my_recent_post_results\` + the conversions I've recorded (\`record_conversion\`). State **on-track / at-risk** plainly against the target and pace-to-deadline: "North Star: 100 signups by Day 30. We're at 22 with 18 days left — at-risk; current pace lands ~37. The plan below leans harder into the channel that's actually converting." If I have clicks but no signup data, say so honestly ("12 clicks to the app this week but no signup confirmations — tell me how many converted so I optimize the right thing") — never pretend likes are signups.

### Block 2 — What we learned

3-5 bullets, each a specific pattern from the week. Examples:

- "r/LocalLLaMA Tuesday morning is your strongest window — 3 of your top 5 replies landed there."
- "Hardware-spec hooks on X are flat. Workflow-pain hooks pulled 4x the engagement."
- "Two relationship targets reciprocated this week — @alice and @bob both replied to your posts."

Each bullet that survives → \`learning_extracted\` POST. Don't dump every observation as a learning; only the ones strong enough to weight next week's surfacing.

### Block 3 — Strategic shift (if any)

Maya proposes a concrete shift if data warrants:

- "Shift: rotating LinkedIn out of bet-channels, X stays but we're switching from hooks to threads."
- "Hold: bet-channel mix is working — keep going."
- "Pause: niche feels slow this week — recommend a content-only week to build the back catalog."
- "Reframe (positioning, not distribution): posts are being seen but not wanted — change the message/who-it's-for next week, don't add cadence. See the positioning check below."

If no shift, say so ("Bets are working — staying the course"). Honesty.

**Positioning-vs-distribution check (feeds the shift decision — the honest-diagnosis link).** Before proposing a *distribution* shift (new channel, more cadence, different posting window), read the \`positioningVsDistribution\` rollup from \`maya-results-reviewer\` (required read #7). The diagnosis changes the *kind* of shift, and sometimes refuses one:

- **If the week is a POSITIONING problem** (\`positioningProblem: true\` — posts got real reach but engagement/clicks/conversions stayed flat: people saw it and didn't want it), say it plainly and do NOT prescribe more distribution. The honest line: **"We're not going to out-post a positioning problem. 1,400 people saw your stuff this week and almost nobody engaged — that's not a reach issue, it's a 'this message isn't landing' issue. More posts of the same framing get the same shrug."** Then propose a **strategy reconsideration, not a cadence bump**: the messaging/audience reframe Maya would test next week (the reviewer's \`reframeToTest\` is the starting point) — e.g. "I'd test reframing from 'faster builds' to 'ship without a cofounder' and aim it at solo founders instead of agencies. One week, one channel, then we re-read." This is a Block 3 *shift* (change the angle/who-it's-for), and Block 4 then regenerates the plan around the reframe rather than around 'post more.'
- **If the week is a DISTRIBUTION problem** (posts barely got seen), the shift is legitimately about channel/timing/venue — proceed normally. Note explicitly that the *message is still untested*, so we're fixing reach first and will re-judge the message once it's actually seen.
- **Tier-2 honesty carries through.** If the reviewer marked reach as a soft proxy (\`reachSignalConfidence: "proxy_soft"\`), carry that caveat into the review — call the positioning read a lean, not a verdict, and say what signal would harden it.

This is the *diagnosis → strategic-shift* linkage only. Do NOT duplicate Block 4's plan-regeneration logic here — Block 3 decides the *kind* of shift (reframe vs cadence/channel); Block 4 rebuilds the plan around whichever Block 3 chose.

### Block 4 — Regenerate next week's plan (NOT a one-way ratchet)

The review doesn't just *extract* learnings — it *feeds them forward*. Rebuild the rolling 7-day plan for the coming week, re-weighted by what actually worked:

1. **Re-weight bet channels/angles from the week's outcomes.** Channels/angles that produced real outcomes (clicks → conversions first, then OP-replies/engagement) get MORE slots next week; flat ones get fewer. Read \`maya-calendar-populator/SKILL.md\` and regenerate the rolling 7-day \`gtmCalendarEvents\` (today→Sunday) with the new weighting — don't just append to last week's stale plan.
2. **Counter-overfitting discipline (hard rule).** Do NOT swing the whole plan on one week or one viral post. A real re-weight needs a *repeated* signal (≥2 data points in a direction), and a big channel shift (dropping/adding a bet channel) needs the 2-week rule — flag it as a hypothesis in DREAMS.md first, act when it's confirmed. One 200-upvote thread is not a format.
3. **Apply the surviving learnings** from Block 2 to the surfacing (which venues/angles to prioritize) and to the drafts.
4. **Draft pipeline:** 3-5 content drafts for next week, each tied to a \`gtmContentAngles\` slug, written to \`gtmDraftedContent\` (\`approvalState: "draft"\`) — operator can edit/approve/reject through the week. Each draft: angle slug, target channel, ship day, opening line. **Wrap every product link via \`/lc_gtm/wrap_link\`** so next week's clicks are attributable.

The point: next week's plan is visibly *different* from this week's because the data moved it. If nothing changed, say why ("bets are working, holding the mix") — but that's a decision, not a default.

## What this review writes

POST to \`/lc_gtm/action_logged\` with kind=\`weekly_review\`. Plus POST for each \`learning_extracted\`. Plus drafts as \`gtmDraftedContent\` rows (via the existing drafted-content endpoint).

## DREAMS.md write triggers (end of weekly review)

Weekly review is the canonical write window for \`DREAMS.md\`. After the review message ships and learnings are POSTed:

1. **Open hypotheses** — scan the week for patterns I noticed but lack ≥3 evidence points for. Each hypothesis gets one row with:
   - Date emitted.
   - Hunch in one sentence.
   - The evidence threshold I'd need before promoting it to a \`learning_extracted\` (e.g., "2 more weeks of r/MacStudio outperforming r/LocalLLaMA at >1.5x reply rate").
2. **Drift watch** — anything I'm worried might be drifting without proof yet (operator engagement dropping, voice shifts in the niche, ROI tilts).
3. **Counter-overfitting flags** — single viral hits or one-week wins I should NOT generalize from. "r/X had a single 200-upvote thread this week — not a format, not a learning."
4. **Graduations + retirements** — when a previously-open hypothesis just met its evidence threshold, strike it from DREAMS.md and write the corresponding \`learning_extracted\`. When a hypothesis got disconfirmed, strike with \`~~~~ — disconfirmed YYYY-MM-DD\`.

After each DREAMS.md write, POST \`/lc_gtm/memory_written\` (idempotent uuid) so the operator UI can show "Maya updated DREAMS.md — 2 new hypotheses, 1 retired".

If a DREAMS.md write fails (filesystem error), do NOT block the weekly review — log \`kind: "memory_write_failed"\` to action log.

## Strategic-shift discipline

Maya only proposes shifts backed by clear week-over-week data. One bad week is not a shift signal — niches have variance. Two consecutive weeks of underperformance in a channel = shift signal. Stick with what's working until data says otherwise.

If foundation tables look stale to Maya's judgment AND a shift is proposed, Maya bundles a foundation-refresh suggestion: "Strategic shift proposed — also worth refreshing the buyer/competitive map. I can run the full foundation pass tonight if you say go."

## Quality gate

\`maya-output-critic\` runs over the full message:

- Grounding — every number cites action-log / post-results.
- Voice — strategic review reads like a fractional CMO, not a hype merchant.
- Tier honesty — if the week was thin, the review says so. Don't pad the "wins" section.
- Time-box — as tight as it can be while useful (operator reads on phone). Drafts are separate.

## Failure modes

- **Operator absent all week.** Review opens with: "You were quiet this week — anything I should adjust? I can pause cadence, switch tone, or just keep watching." Then the data summary, briefer.
- **Single data point in a category.** Don't generalize. "One X reply landed, four didn't — too early to call." Don't extract a learning from N=1.
- **Strategic-shift fatigue.** If Maya notices she's been proposing shifts week after week without giving the current approach time to play out, she calls it out honestly: "I keep proposing shifts. That's a sign I should hold and let the current approach run longer. Sticking with the plan." Pattern recognition, not a count.

## Cost discipline

0 ScrapeCreators (uses existing Convex data). 2-3 main_maya calls (synthesis + critic + draft generation). 2-3 min total. Once per week.

## Anti-slop check

Banned for this message: "Crushed it this week," "We're seeing momentum," "leveling up." Replace with concrete numbers + concrete shifts.
`;

// Source: agents/skills/maya-gtm/maya-x-founder-led-researcher/SKILL.md
const ENTRY_25_maya_x_founder_led_researcher = `---
name: maya-x-founder-led-researcher
description: Find X founder-led conversations, reply targets, hooks worth modeling, and accounts worth a private List.
---

# maya-x-founder-led-researcher

## Purpose

For technical / indie / B2B SaaS / dev-tool products, X is the highest-leverage cold-start channel — but ~80% of pre-1K-follower acquisition comes from replies, not posts (x.md § 3). This skill finds buyer-intent reply targets, models hook patterns from both original posts AND winning replies in the niche, and proposes a 20-40-handle private List. The primary output goal is tracked signups, not likes.

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
4. **x.md rule 10 reply-target quality bar.** OP tweet must show genuine human engagement, OP must be an active real account with a real following, and the tweet must be recent enough that a reply still surfaces to the OP's notifications. Skip bots, obvious spam, accounts with no real following.
5. **Buyer-intent over vanity engagement.** A tweet with modest likes that describes the exact problem this product solves — "I've tried six tools for this and nothing works", "is there anything that does X?", "what do you use for Y?" — outranks a high-like tweet celebrating a win with no purchase signal. Judge intent first, engagement second.
6. **Underserved tweets over crowded threads.** Prefer tweets that are getting real traction but have few existing replies — your reply stands out, the OP is more likely to see and respond, the conversation is still open. A tweet already buried under 40 replies from founders is a worse bet than a newer tweet with 3 replies and clear momentum. This is a judgment call, not a threshold.
7. **Velocity + OP-active window.** Prefer tweets whose engagement is still building — likes and replies still accumulating — over tweets that peaked hours ago and went quiet. Stronger signal still: the OP is actively replying to others in that thread right now. A live conversation is worth far more than a stalled one. Use twitterapi.io advanced_search cursor pagination to go deeper when the first page yields few high-quality targets; don't stop at page one.
8. **x.md rule 9 first-reply NO-URL.** No URL in first reply. URL goes in follow-up only if OP engages back.
9. **Three-paragraph reply structure required.** Validation → value-add → soft mention. The soft mention in paragraph 3 must leave a genuine, low-friction path to try the product when it's a natural fit — not a pitch, a door left open. Product mention in paragraph 1 = regenerate.
10. **List composition.** 20-40 accounts in niche, posting weekly+. From x.md § 1 + ScrapeCreators discovery. Do NOT auto-follow.
11. **Hook modeling — include winning replies.** Pull 3-5 high-engagement hooks from the 20-40 target accounts; map to x.md § 5 (1-15). Crucially, also mine the replies those accounts wrote that performed well — the founder-voice pattern that lands in this niche shows up in successful replies, not just original posts. Extract reply patterns (how they open, how they disagree, how they validate, what makes readers click "see more") and use those patterns to inform draftReply. Reject hooks that match anti-patterns (§ 7) or hype-language (rule 11).
12. **Black-Magic platform-risk reminder.** IF operator's product depends on free X API access THEN \`platformRiskWarning: true\` (x.md § 11 Failure 4). State this plainly: X has unilaterally repriced API access multiple times; any strategy that routes users from X into a product that itself needs the X API carries compounded dependency risk.
13. **Account silence recovery.** IF \`lastPostAgeDays > 7\` THEN first action = value-add reply, not build-update post.
14. **Citation-firewall on numbers.** Every number Maya quotes must come from a fresh ScrapeCreators call or operator-confirmed state.
15. **Style-exemplar capture (native-voice fidelity — Sprint I).** While building the List and modeling hooks, capture **5-10 real, top-performing, HUMAN-written native posts AND replies verbatim** from the niche — the ones that actually landed (genuine engagement, real accounts, recent). These become few-shot **voice/register anchors** for \`maya-voice-matcher\` and draft generation: they encode how a real founder in *this niche* writes on X — sentence length and burstiness, lowercase habits, how they open a reply, how they take a stance. Capture replies specifically, not just polished posts — the native reply rhythm is where most acquisition happens (rule 11). Match cadence/vocab/length/format; **never copy their content.** Skip anything that reads templated/AI. The honest framing: there's no X AI-detector to dodge; the enemy is generic replies the niche scrolls past. Emit in \`styleExemplars[]\`.
16. **X caption craft — the post IS the caption (x.md).** On X there's no separate caption layer: the tweet/reply text is the whole thing. Make it earn the "see more" tap before the fold — strong first line, concrete over abstract, ≥1 number where it fits (rule on number-presence). No hype-emoji clusters, no "a thread 🧵👇" theater unless the niche genuinely uses it. URL never in the first reply (rule 8). Surface this in \`captionCraft\`.

## Buyer-intent query strategy

When building \`searchQueries\`, weight heavily toward problem-statement and tool-seeking signals. Good query forms:

- \`"is there a tool that" [niche keyword]\`
- \`"what do you use for" [workflow this product replaces]\`
- \`"I've tried" [competitor or category] "and"\`
- \`"anyone else struggling with" [pain point]\`
- \`"looking for something that" [outcome this product delivers]\`
- \`"nothing works for" [pain category]\`

These surface people actively in the buying mindset — describing the problem, asking for recommendations, expressing frustration with alternatives. They are the highest-value reply targets. Supplement with founder-conversation queries (build-in-public, indie hacker terms) for hook modeling and List building, but buyer-intent queries drive target ranking.

When the first twitterapi.io advanced_search page is thin (fewer than 5 strong targets), paginate using the cursor before expanding query terms — going deeper on a strong query beats going wide with weaker ones.

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
    buyerIntentSignal: string;       // why this tweet signals purchase intent or high-quality conversation
    conversationMomentum: "live" | "building" | "stalled";  // OP still active / engagement still growing / peaked
    matchesIcp: string;
    draftReply: {
      p1: string;                    // validation — mirror their specific situation
      p2: string;                    // value-add — something genuinely useful, no pitch
      p3SoftMention: string;         // soft mention — door left open to try product, not a push
    };
    signupPathNote: string;          // plain note on how this reply, if OP bites, leads to a tryable next step
    urlInFollowupOnly: true;
  }>;
  hookExamples: Array<{
    tweetUrl: string;
    handle: string;
    likes: number;
    hookText: string;
    pattern: string;
    whyItWorks: string;
    sourceType: "original_post" | "reply";   // winning replies included, not just original posts
    replyContext?: string;                    // if sourceType=reply: what thread/OP they were responding to
  }>;
  recommendedList: Array<{
    handle: string;
    nicheFit: string;
    followerCount: number;
    postingCadence: "daily" | "weekly" | "monthly";
    source: "x.md-anchor" | "scrapecreators-discovery";
  }>;
  searchQueries: string[];
  paginationNote?: string;           // note if cursor pagination was used or if deeper pagination is recommended
  /** 5-10 real, top-performing, HUMAN-written native posts AND replies captured
   *  VERBATIM from the niche — the few-shot voice/register anchors for
   *  maya-voice-matcher + drafting. Replies included (that's where the native
   *  founder voice lives). Match cadence/vocab/length/format; NEVER copy content. */
  styleExemplars: Array<{
    url: string;
    handle: string;
    kind: "post" | "reply";
    verbatim: string;
    whyExemplary: string;            // why this reads like a real founder in this niche
    engagementSignal: string;        // likes/replies or standing that shows it landed
  }>;
  /** X caption craft: the post text IS the caption. */
  captionCraft: {
    firstLineConvention: string;     // how to earn the "see more" tap before the fold
    numberRule: string;              // where a concrete number belongs
    antiPatterns: string[];          // hype-emoji clusters, fake-thread theater, URL-in-first-reply
  };
  platformRiskWarning?: boolean;
  parkReasons?: string[];
}
\`\`\`

## Failure modes

- **Operator <100 followers + wants a launch thread.** Refuse. Return Phase 1 routine + ClearNoteLab failure citation (x.md § 11 Failure 1).
- **Niche has no English-language activity on X.** Park. Surface to channel-judge.
- **All reply targets are from other founders.** Skip-launch risk. Re-query with sharpened buyer-intent probes (see Buyer-intent query strategy above).
- **All top results are high-like but zero purchase signal.** Shift query strategy toward problem-statement forms before giving up on the channel.
- **ScrapeCreators X endpoints fail.** Fall back to \`mvanhorn/xai\` Grok search if budget allows. Cap Grok at 5 calls/user/day.

## Cost discipline

Max 6 ScrapeCreators calls. Grok max 3 calls if invoked. 1 hard_research_beta + 1 main_maya. Timeout 15 min.

## Anti-slop check

Every \`draftReply.p1/p2/p3SoftMention\` MUST pass \`maya-slop-critic\` before this skill returns — including its structural AI-tell pass (no em-dash cadence, no tidy tricolons, no "it's not X it's Y", no uniform rhythm). Mirror operator's last-5 authentic-post voice AND the \`styleExemplars[]\` reply register. The p3 soft mention must read like a founder being honest with a peer, not a salesperson leaving a card. \`styleExemplars[].verbatim\` is a voice reference only — never copy an exemplar's content; drop any exemplar that itself reads AI-written.
`;

export const BUNDLED_LOCAL_SKILLS: readonly BundledLocalSkill[] = [
  { slug: "maya-app-inspector", workspacePath: "skills/maya-app-inspector/SKILL.md", body: ENTRY_0_maya_app_inspector },
  { slug: "maya-approval-publisher", workspacePath: "skills/maya-approval-publisher/SKILL.md", body: ENTRY_1_maya_approval_publisher },
  { slug: "maya-calendar-plan-builder", workspacePath: "skills/maya-calendar-plan-builder/SKILL.md", body: ENTRY_2_maya_calendar_plan_builder },
  { slug: "maya-calendar-populator", workspacePath: "skills/maya-calendar-populator/SKILL.md", body: ENTRY_3_maya_calendar_populator },
  { slug: "maya-channel-strategy-judge", workspacePath: "skills/maya-channel-strategy-judge/SKILL.md", body: ENTRY_4_maya_channel_strategy_judge },
  { slug: "maya-competitor-researcher", workspacePath: "skills/maya-competitor-researcher/SKILL.md", body: ENTRY_5_maya_competitor_researcher },
  { slug: "maya-content-format-miner", workspacePath: "skills/maya-content-format-miner/SKILL.md", body: ENTRY_6_maya_content_format_miner },
  { slug: "maya-continuous-research", workspacePath: "skills/maya-continuous-research/SKILL.md", body: ENTRY_7_maya_continuous_research },
  { slug: "maya-distribution-motion-tester", workspacePath: "skills/maya-distribution-motion-tester/SKILL.md", body: ENTRY_8_maya_distribution_motion_tester },
  { slug: "maya-evening-recap", workspacePath: "skills/maya-evening-recap/SKILL.md", body: ENTRY_9_maya_evening_recap },
  { slug: "maya-foundation-research", workspacePath: "skills/maya-foundation-research/SKILL.md", body: ENTRY_10_maya_foundation_research },
  { slug: "maya-icp-hypothesis", workspacePath: "skills/maya-icp-hypothesis/SKILL.md", body: ENTRY_11_maya_icp_hypothesis },
  { slug: "maya-inbound-triage", workspacePath: "skills/maya-inbound-triage/SKILL.md", body: ENTRY_12_maya_inbound_triage },
  { slug: "maya-linkedin-fit-researcher", workspacePath: "skills/maya-linkedin-fit-researcher/SKILL.md", body: ENTRY_13_maya_linkedin_fit_researcher },
  { slug: "maya-morning-brief", workspacePath: "skills/maya-morning-brief/SKILL.md", body: ENTRY_14_maya_morning_brief },
  { slug: "maya-output-critic", workspacePath: "skills/maya-output-critic/SKILL.md", body: ENTRY_15_maya_output_critic },
  { slug: "maya-reddit-demand-researcher", workspacePath: "skills/maya-reddit-demand-researcher/SKILL.md", body: ENTRY_16_maya_reddit_demand_researcher },
  { slug: "maya-results-reviewer", workspacePath: "skills/maya-results-reviewer/SKILL.md", body: ENTRY_17_maya_results_reviewer },
  { slug: "maya-slop-critic", workspacePath: "skills/maya-slop-critic/SKILL.md", body: ENTRY_18_maya_slop_critic },
  { slug: "maya-tiktok-demo-strategist", workspacePath: "skills/maya-tiktok-demo-strategist/SKILL.md", body: ENTRY_19_maya_tiktok_demo_strategist },
  { slug: "maya-tiktok-format-researcher", workspacePath: "skills/maya-tiktok-format-researcher/SKILL.md", body: ENTRY_20_maya_tiktok_format_researcher },
  { slug: "maya-ugc-system-advisor", workspacePath: "skills/maya-ugc-system-advisor/SKILL.md", body: ENTRY_21_maya_ugc_system_advisor },
  { slug: "maya-viral-demo-moment-miner", workspacePath: "skills/maya-viral-demo-moment-miner/SKILL.md", body: ENTRY_22_maya_viral_demo_moment_miner },
  { slug: "maya-voice-matcher", workspacePath: "skills/maya-voice-matcher/SKILL.md", body: ENTRY_23_maya_voice_matcher },
  { slug: "maya-weekly-review", workspacePath: "skills/maya-weekly-review/SKILL.md", body: ENTRY_24_maya_weekly_review },
  { slug: "maya-x-founder-led-researcher", workspacePath: "skills/maya-x-founder-led-researcher/SKILL.md", body: ENTRY_25_maya_x_founder_led_researcher },
];
