/**
 * Service-side standing-orders catalog for Maya.
 *
 * Mirrors the creator-side catalog at
 * `convex/agents/packs/maya/workspace/standingOrders.ts` but encodes the 15
 * service-business behaviors from `docs/SPRINT_PLAN_SERVICE_V0.md` § 6.
 *
 * Every entry below is one program in the canonical OpenClaw 4-part standing
 * orders format (Scope / Triggers / Approval gates / Escalation rules), per
 * `https://docs.openclaw.ai/automation/standing-orders.md`.
 *
 * The catalog is the single source of truth for behavior names + tier
 * gating + cron expressions. Three downstream consumers read it:
 *   1. `generateAgentsMd.ts` renders one block per program into AGENTS.md
 *      under the `## Standing orders` heading.
 *   2. `buildJobsJson.ts` filters to `kind === "cron"` programs and emits
 *      the runtime `jobs.json` for OpenClaw's cron daemon.
 *   3. `__tests__/siblingFileScan.test.ts` asserts every cron program has a
 *      matching skill folder under `agents/skills/maya-service-{slug}/`.
 *
 * Tier semantics:
 *   - "all"  — every plan runs this program (Starter, Pro, Studio).
 *   - "pro+" — Pro and Studio only (Starter skipped).
 *   - "studio" — Studio only.
 *   - "starter-manual-pro+-auto" — present at all tiers but Starter routes
 *     through manual operator approval; Pro+ may auto-execute per the
 *     business's `approvalRules` table (§ 8 schema).
 *
 * Kind semantics:
 *   - "cron"      — runs on a schedule. `defaultCron` + `session` required.
 *   - "event"     — fires on an external trigger (CRM webhook, Pub/Sub,
 *                   weather alert, inbound media). No cron.
 *   - "on-demand" — operator-initiated; no schedule, no event hook.
 *
 * The 15 programs map 1:1 to § 6 behaviors. Keep this file in lockstep with
 * § 6: every change here is a change to the AGENTS.md prose, the jobs.json
 * runtime config, AND the sibling-file scan.
 */

export type ServiceStandingOrderTier =
  | "all"
  | "pro+"
  | "studio"
  | "starter-manual-pro+-auto";

export type ServiceStandingOrderKind = "cron" | "event" | "on-demand";

export type ServiceCronSession = "isolated" | "main";

export interface ServiceStandingOrderProgram {
  /** Stable id — referenced by `jobs.json`, the sibling-file scan, and tests. */
  id: string;
  /** H3 program title rendered in AGENTS.md. */
  title: string;
  tier: ServiceStandingOrderTier;
  kind: ServiceStandingOrderKind;
  /** 5-field POSIX cron expression. Required for kind === "cron". */
  defaultCron?: string;
  /** Session model for the cron run. Required for kind === "cron". */
  session?: ServiceCronSession;
  /** External event source for kind === "event". */
  event?: string;
  /** Skill folder slug under agents/skills/maya-service-{slug} driven by this program. */
  skill: string;
  /** Scope — what authorized actions Maya may take. */
  scope: string;
  /** Triggers — schedule / event / condition. */
  triggers: string;
  /** Approval gates — what requires operator sign-off. */
  approvalGates: string;
  /** Escalation rules — when to ping operator / stop / fall back. */
  escalation: string;
  /** Message body Maya executes for cron-driven programs. */
  cronMessage?: string;
  /** One-line description for jobs.json + listings. */
  description: string;
}

export const SERVICE_STANDING_ORDERS: ReadonlyArray<ServiceStandingOrderProgram> = [
  {
    id: "morning_brief",
    title: "Morning brief",
    tier: "all",
    kind: "cron",
    defaultCron: "0 7 * * *",
    session: "isolated",
    skill: "maya-service-revenue-snapshot-renderer",
    description:
      "Daily 7am push: today's schedule + overnight reviews + fresh leads, cited.",
    scope:
      "Read today's `serviceJobs` schedule + overnight `reviews` + last-12h `inboundLeads`; assemble a <200-word brief with one cited insight + one action + any pending approvals; write `dailyBriefs`; push to operator's primary channel.",
    triggers: "Cron `morning_brief` at 7:00am operator-tz.",
    approvalGates: "None — the brief is a push. Referenced actions carry their own gates.",
    escalation:
      "If GBP/Zernio API is down, ship the brief without the review section and flag inline ('Google reviews offline this morning — will retry on next heartbeat'). Never invent metrics.",
    cronMessage:
      "Run morning brief: pull today's schedule + overnight reviews + fresh leads, draft brief with one cited insight + one action + pending approvals, write `dailyBriefs`, push to primary channel. Stay under 200 words.",
  },
  {
    id: "job_completion_review_request",
    title: "Job-completion review request",
    tier: "starter-manual-pro+-auto",
    kind: "event",
    event: "crm.job.completed",
    skill: "maya-service-review-request-drafter",
    description:
      "On CRM `job.completed`, draft + queue (Starter) or send 24h after (Pro+) a review request.",
    scope:
      "On CRM webhook `job.completed` (or polling fallback for HCP non-MAX), draft a job-specific review request via `maya-service-review-request-drafter`. Idempotent on `(jobId, kind)`; cancel via cron tag if customer already left a review.",
    triggers:
      "Event-driven: CRM webhook `job.completed`, OR polling fallback every 30 min for HCP non-MAX accounts.",
    approvalGates:
      "Starter: queue with `status='pending_approval'` — operator approves manually before send. Pro+: auto-send 24h after `completedAt` IF the business's `approvalRules` table has `review-request-auto-send` enabled; otherwise queue for approval.",
    escalation:
      "If the same `(jobId, kind)` already has a sent request, no-op silently. If `customers.phone` AND `customers.email` are both missing, log to `mayaActionLog` and skip — never invent a contact channel.",
  },
  {
    id: "review_followup",
    title: "Review followup",
    tier: "starter-manual-pro+-auto",
    kind: "cron",
    defaultCron: "0 11 * * *",
    session: "isolated",
    skill: "maya-service-review-request-drafter",
    description: "Day-3 + day-7 review-followup nudges to customers who haven't reviewed yet.",
    scope:
      "Daily 11am op-tz: scan `reviewRequests` where `sentAt` is 3d or 7d old AND no matching `reviews` row. Draft a softer follow-up via `maya-service-review-request-drafter` (followupVariant='day3' or 'day7'). Append to `reviewRequests.followups[]`.",
    triggers: "Cron `review_followup` 11:00am op-tz daily.",
    approvalGates:
      "Starter: queue for operator approval. Pro+: auto-send if `approvalRules.review-request-auto-send` enabled; otherwise queue.",
    escalation:
      "Auto-cancel if a matching `reviews` row appears between draft and send. Hard-stop after the 7d followup — never a third reminder.",
    cronMessage:
      "Run review followup: scan `reviewRequests` aged 3d or 7d with no matching review, draft softer followup via `maya-service-review-request-drafter`, append to `reviewRequests.followups[]`.",
  },
  {
    id: "review_reply",
    title: "Review reply (drafted, NEVER auto-posted)",
    tier: "all",
    kind: "event",
    event: "gbp.new_review",
    skill: "maya-service-review-reply-drafter",
    description:
      "On a new GBP/FB review, draft a reply within 30 min and ping operator for approval.",
    scope:
      "On Pub/Sub `NEW_REVIEW` (or Zernio webhook fallback) within 30 min, run `maya-service-review-reply-drafter` against `reviews.body` + `businessPicture.brandVoice` + matched `serviceJobs` job context. Write `reviews.draftReply`; ping operator for approval.",
    triggers:
      "Event: Google Pub/Sub `NEW_REVIEW` (post-partner-access) OR Zernio webhook (v0 default) OR 30-min polling fallback.",
    approvalGates:
      "**LOCKED ACROSS ALL TIERS**: NEVER auto-post a review reply. Google's `ReviewReplyState` rejects AI-generated replies without operator approval. Operator approves; on yes, POST to GBP `reviews.updateReply` and write `reviews.replyStatus='posted'`. The `approvalRules` table's `review-reply-auto-publish-allowlist` rule type is FORBIDDEN at all tiers — enforced server-side in `planFeaturesService`.",
    escalation:
      "If review body is profane / threatening / extortionate, flag with `riskFlags=['operator-only']` and skip drafting — surface to operator with 'this one needs you, not me.' If Zernio review-reply API returns `unsupported`, queue for manual operator paste and ping.",
  },
  {
    id: "gbp_cadence_watch",
    title: "GBP cadence watch",
    tier: "all",
    kind: "cron",
    defaultCron: "0 10 */3 * *",
    session: "isolated",
    skill: "maya-service-gbp-post-optimizer",
    description: "Every 3 days at 10am, ensure last GBP post isn't > 5 days old; draft if it is.",
    scope:
      "Every 3 days at 10am op-tz: read `gbpPosts` last-post date. If > 5 days, draft a GBP post via `maya-service-gbp-post-optimizer` using a recent `serviceJobs` photo if available, else a service-tip post. Write to `gbpPosts` with `status='pending_approval'`.",
    triggers: "Cron `gbp_cadence_watch` at 10:00am op-tz every 3 days.",
    approvalGates:
      "Operator approves draft before publish. Studio operators with `approvalRules.gbp-post-auto-publish` enabled on a curated `safeContentClasses[]` allowlist may auto-publish — server-side gated, fail-closed.",
    escalation:
      "If no recent job photos AND no service-tip seed available, surface to operator: 'I don't have material for this post — send me one job photo from the last week and I'll write it.' Never publish a post without a local hook (citation firewall hard rule, § 7).",
    cronMessage:
      "Run GBP cadence watch: if last `gbpPosts` post > 5 days, draft via `maya-service-gbp-post-optimizer` (recent job photo OR service-tip seed), write with `status='pending_approval'`.",
  },
  {
    id: "content_rejuvenation",
    title: "Content rejuvenation",
    tier: "pro+",
    kind: "cron",
    defaultCron: "0 14 * * 0",
    session: "isolated",
    skill: "maya-service-content-rejuvenator",
    description: "Sundays 2pm, surface 3 repurposing ideas from the operator content library.",
    scope:
      "Sundays 2pm op-tz: scan `mediaAssets` for stale-but-quality assets + last 30d `serviceJobs` photos. Run `maya-service-content-rejuvenator` to produce 3 ranked repurposing ideas (before/after pair, customer testimonial, service-tip carousel). Push to `gbpPosts.suggestions[]`.",
    triggers: "Cron `content_rejuvenation` Sundays 2:00pm op-tz.",
    approvalGates: "Operator approves each suggestion individually before draft promotes to `gbpPosts`.",
    escalation:
      "If the operator content library is empty (no `mediaAssets` for this business), skip with `reason='empty-content-library'` — do not pad with fabricated assets.",
    cronMessage:
      "Run content rejuvenation: scan `mediaAssets` + recent job photos, call `maya-service-content-rejuvenator` for 3 repurposing ideas, push to `gbpPosts.suggestions[]`.",
  },
  {
    id: "engagement_watch",
    title: "Engagement watch",
    tier: "pro+",
    kind: "cron",
    defaultCron: "0 8,10,12,14,16,18,20,22 * * *",
    session: "isolated",
    skill: "maya-service-lead-response-nudger",
    description:
      "Every 2h waking hours: GBP/FB/IG inbound DMs unanswered > 2h get a draft reply.",
    scope:
      "Every 2h between 8am-10pm op-tz: pull GBP messages + FB DMs + IG comments via Zernio webhooks. If operator hasn't responded within 2h, draft reply via `maya-service-lead-response-nudger` and ping for approval.",
    triggers: "Cron `engagement_watch` every 2h between 8:00am and 10:00pm op-tz.",
    approvalGates: "Always operator-approval gated. Maya never replies to public comments or DMs autonomously.",
    escalation:
      "Adversarial: rate-limit-inject if Zernio webhook flood (>20 inbound in 5 min) — switch to digest mode and surface a single 'you have N messages waiting' nudge.",
    cronMessage:
      "Run engagement watch: pull GBP + FB + IG inbound, identify operator-unanswered > 2h, draft reply via `maya-service-lead-response-nudger`, ping for approval.",
  },
  {
    id: "lead_response_alarm",
    title: "Lead response alarm",
    tier: "all",
    kind: "cron",
    defaultCron: "*/30 * * * *",
    session: "main",
    skill: "maya-service-lead-response-nudger",
    description:
      "Every 30 min 24/7: missed leads > 2h with no operator response → 1 SMS nudge.",
    scope:
      "Every 30 min 24/7: scan `inboundLeads` (missed GBP message + missed Twilio call + missed FB DM) older than 2h with `operatorRespondedAt=null` AND `mayaNudgedAt=null`. Send single SMS nudge via `maya-service-lead-response-nudger`. Set `mayaNudgedAt`.",
    triggers: "Cron `lead_response_alarm` every 30 minutes, 24/7.",
    approvalGates:
      "None — the nudge IS the action. Maya never sends customer replies; she only notifies the operator.",
    escalation:
      "Hard rate-limit: max 4 unsolicited outbound nudges/day to the operator (R3 § 4 — Hatch/Regal benchmark > 5/day = unsubscribe). Enforced upstream in the rate-limit middleware; this skill confirms `unsolicitedTodayCount < 4` before sending.",
    cronMessage:
      "Run lead response alarm: scan `inboundLeads` aged > 2h with no operator response, send single SMS nudge via `maya-service-lead-response-nudger` (max 4/day total across all unsolicited outbound).",
  },
  {
    id: "daily_content_check",
    title: "Daily content check",
    tier: "all",
    kind: "cron",
    defaultCron: "0 8 * * 1-6",
    session: "isolated",
    skill: "maya-service-asset-cataloger",
    description: "Mon-Sat 8am: if no fresh photos in 48h, soft check-in via primary channel.",
    scope:
      "Mon-Sat 8am op-tz: scan `mediaAssets` received in last 48h for this business. If none, send a soft check-in: 'No new photos from the last two days — anything worth posting?' Skip Sundays.",
    triggers: "Cron `daily_content_check` Mon-Sat 8:00am op-tz.",
    approvalGates: "None — the check-in is a single passive prompt; operator can ignore it.",
    escalation:
      "Counts toward the 4-unsolicited-per-day rate cap. If the cap is already hit, fold into next morning brief instead.",
    cronMessage:
      "Run daily content check: scan `mediaAssets` last 48h; if empty, soft check-in via primary channel. Skip on Sundays.",
  },
  {
    id: "seasonal_nudge",
    title: "Seasonal nudge",
    tier: "pro+",
    kind: "cron",
    defaultCron: "0 9 * * 1",
    session: "isolated",
    skill: "maya-service-content-arc-planner",
    description: "Mondays 9am: 2-3 season-relevant content angles for this service type.",
    scope:
      "Mondays 9am op-tz: read `businessPicture.serviceType` + current month + last 90d `serviceJobs` service-mix. Suggest 2-3 season-relevant content angles via `maya-service-content-arc-planner` (e.g. 'AC tune-ups before the heat wave', 'furnace pre-winter checklist').",
    triggers: "Cron `seasonal_nudge` Mondays 9:00am op-tz.",
    approvalGates: "Operator approves each angle before it promotes to a `contentPlans` draft.",
    escalation:
      "Cite to historical demand from `serviceJobs` where possible. If no historical data in same season for this business, label outputs as 'suggestion' not 'citation' — never fake the grounding.",
    cronMessage:
      "Run seasonal nudge: read serviceType + current month + 90d job-mix, call `maya-service-content-arc-planner` for 2-3 season-relevant angles. Cite historical demand where available.",
  },
  {
    id: "local_event_watch",
    title: "Local event watch",
    tier: "pro+",
    kind: "cron",
    defaultCron: "0 18 * * *",
    session: "isolated",
    skill: "maya-service-content-arc-planner",
    description: "6pm daily: surface 1-2 local hooks (events, weather, sports) for tomorrow's content.",
    scope:
      "6pm op-tz daily: pull ScrapeCreators local-events + weather forecast + sports scores for `localPositioning.servedNeighborhoods`. Surface 1-2 high-fit local hooks for tomorrow's content; fold into evening recap rather than separate ping.",
    triggers: "Cron `local_event_watch` 6:00pm op-tz daily.",
    approvalGates: "None — read surface only.",
    escalation:
      "If the day is quiet (no events, mild weather, no notable sports), skip silently. Never pad with weak hooks — the local-first content rule (§ 9 principle 3) requires real specificity.",
    cronMessage:
      "Run local event watch: pull local events + weather + sports scores for served neighborhoods, surface 1-2 high-fit hooks. Fold into evening recap.",
  },
  {
    id: "weather_triggered_promo",
    title: "Weather-triggered promo",
    tier: "pro+",
    kind: "event",
    event: "weather.alert",
    skill: "maya-service-gbp-post-optimizer",
    description:
      "On NWS storm/heat-wave/freeze alert in service area, draft urgency post for approval.",
    scope:
      "On NWS alert webhook for any zip in `localPositioning.servedZips`, draft urgency-framed GBP/FB post via `maya-service-gbp-post-optimizer` (e.g. 'freeze warning Friday — pre-book pipe insulation now'). Queue for approval.",
    triggers: "Event-driven: weather API webhook for storm forecast, heat wave, freeze warning, etc.",
    approvalGates:
      "Operator approves before publish. Studio operators with `approvalRules.gbp-post-auto-publish` and `weather-promo` in `safeContentClasses[]` may auto-publish.",
    escalation:
      "Idempotency on `(zip, eventId)` — never double-fire on overlapping alerts. If the alert kind isn't relevant to the service type (e.g. heat wave for a roofer), skip silently.",
  },
  {
    id: "competitor_watch",
    title: "Competitor watch",
    tier: "pro+",
    kind: "cron",
    defaultCron: "0 9 * * 0",
    session: "isolated",
    skill: "maya-service-competitor-watcher",
    description: "Sundays 9am: weekly digest of named competitor GBP changes.",
    scope:
      "Sundays 9am op-tz: ScrapeCreators sweep of `localPositioning.namedCompetitors[]` GBPs. Run `maya-service-competitor-watcher` for a weekly digest: rating changes, new posts, promo prices. Fold into Monday's morning brief.",
    triggers: "Cron `competitor_watch` Sundays 9:00am op-tz.",
    approvalGates: "None — read surface.",
    escalation:
      "If a named competitor's GBP is suspended or returns 404, drop with note in next brief. Do not editorialize about whether to copy a competitor move — cite, the operator decides.",
    cronMessage:
      "Run competitor watch: ScrapeCreators sweep of named competitor GBPs, call `maya-service-competitor-watcher` for digest, fold into Monday morning brief.",
  },
  {
    id: "revenue_snapshot",
    title: "Revenue snapshot",
    tier: "pro+",
    kind: "cron",
    defaultCron: "0 9 * * 1",
    session: "isolated",
    skill: "maya-service-revenue-snapshot-renderer",
    description: "Mondays 9am: prior-week revenue snapshot from CRM jobs + invoices (CRM-required).",
    scope:
      "Mondays 9am op-tz: pull `serviceJobs` completed + invoices.paid + invoices.outstanding for last 7d via the CRM adapter. Run `maya-service-revenue-snapshot-renderer` for a one-paragraph snapshot. Push to `revenueSnapshots`; surface in morning brief.",
    triggers: "Cron `revenue_snapshot` Mondays 9:00am op-tz. Conditional — silent no-op if no `crmConnections.provider`.",
    approvalGates: "None — informational read.",
    escalation:
      "Skip silently if no CRM connected. If CRM returned an error mid-pull, surface 'CRM was unreachable this morning, will retry on next heartbeat' — never invent revenue numbers.",
    cronMessage:
      "Run revenue snapshot: CRM pull last 7d completed jobs + paid invoices + outstanding, call `maya-service-revenue-snapshot-renderer`, push to `revenueSnapshots`.",
  },
  {
    id: "manager_readiness_packet",
    title: "Manager-readiness packet",
    tier: "studio",
    kind: "cron",
    defaultCron: "0 14 1 */3 *",
    session: "isolated",
    skill: "maya-service-packet-generator",
    description: "Quarterly auto + on-demand: full packet for hiring a real marketing manager.",
    scope:
      "1st of every quarter, 2pm op-tz (Studio), OR on-demand from chat: run `maya-service-packet-generator` against `businessPicture` + 90d metrics + brand-voice samples + reviews + content cadence + crew names. Render PDF via the Anthropic `pdf` skill. Write `packetGenerations`; push 'your packet is ready' link.",
    triggers: "Cron `manager_readiness_packet` 1st of quarter 2:00pm op-tz; Studio additionally permits on-demand.",
    approvalGates: "None — operator consumes the artifact directly.",
    escalation:
      "Pass content through `maya-service-citation-firewall` before render. Render failures retry once; second failure surfaces 'I couldn't render the packet — try again from the dashboard.' Sub-30s render budget; if exceeded, log to `mayaActionLog`.",
    cronMessage:
      "Run quarterly manager-readiness packet: assemble businessPicture + 90d metrics + brand-voice + reviews + content cadence, call `maya-service-packet-generator`, render PDF, push link.",
  },
];

/**
 * Tier filter for the runtime cron config + AGENTS.md prose.
 */
export type ServicePlan = "starter" | "pro" | "studio";

export function serviceStandingOrdersForPlan(
  plan: ServicePlan
): ReadonlyArray<ServiceStandingOrderProgram> {
  return SERVICE_STANDING_ORDERS.filter((p) => {
    if (p.tier === "all") return true;
    if (p.tier === "starter-manual-pro+-auto") return true;
    if (p.tier === "pro+") return plan === "pro" || plan === "studio";
    if (p.tier === "studio") return plan === "studio";
    return false;
  });
}
