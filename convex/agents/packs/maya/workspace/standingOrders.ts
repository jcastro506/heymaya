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
 * `competitor_watch`, `manager_readiness_packet_quarterly`,
 * `revenue_snapshot`, `calendar_lookahead`, `industry_intel_daily`, and the
 * `algo_research_*` family — have since been corrected back to `all`. They
 * are pure cost-optimization gates (Brave / Composio per-query reads), not
 * autonomy gates, and the cost ceiling is well within both tiers' margin.
 *
 * Kind semantics:
 *   - "cron"        — runs on a schedule. `cronEntryId` and `defaultCron`
 *                     are required; the cron generator consumes them.
 *   - "event"       — fires on an external trigger; no schedule.
 *   - "on-demand"   — creator-initiated; no schedule, no event.
 *   - "folded"      — composed into another program's run (e.g. growth
 *                     coaching folds into morning brief); no separate
 *                     schedule.
 */

import type { Plan } from "../../../../lib/planFeatures";

export type StandingOrderTier = "all" | "manager";
export type StandingOrderKind = "cron" | "event" | "on-demand" | "folded";

/**
 * Session semantics per OpenClaw's `~/.openclaw/cron/jobs.json`:
 *   - "isolated" — fresh transcript per run; preferred for proactive
 *                  generative behaviors so prior-tick context doesn't bleed.
 *   - "main"     — enqueue a system event into the main session; preferred
 *                  for accountability nudges where Maya should reference the
 *                  ongoing conversation thread.
 */
export type CronSession = "isolated" | "main";

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
}

export const STANDING_ORDERS: ReadonlyArray<StandingOrderProgram> = [
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
    title: "Evening recap",
    tier: "all",
    kind: "cron",
    cronEntryId: "evening_recap",
    defaultCron: "0 19 * * *",
    session: "isolated",
    scope:
      "Three lines: one cited fact from today + one pending overnight + one thing for tomorrow. On no-post days say so plainly. Write `dailyBriefs` with kind='evening_recap'.",
    triggers: "Cron `evening_recap` 7:00pm local.",
    approvalGates: "None.",
    escalation:
      "If quiet day with no pending work, recap is one line; do not pad. If under-performance was diagnosed, route through `maya-underperformance-diagnoser` first.",
    cronMessage:
      "Run evening recap: 3 lines max — one cited fact + one pending + one for tomorrow. Write `dailyBriefs` with kind='evening_recap'.",
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
      "Pass aggressively through citation firewall — highest-stakes weekly output. Drop unsupported claims rather than ship them. Coach receives a stripped-down low-thinking version.",
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
    kind: "cron",
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
    kind: "cron",
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
    kind: "cron",
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
    kind: "cron",
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
    triggers: "Event: ScrapeCreators delta. Latency cap by tier (Coach 600s, Manager 300s).",
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
    kind: "cron",
    cronEntryId: "competitor_watch",
    defaultCron: "0 9 * * *",
    session: "isolated",
    scope:
      "Pull each named peer's last 24h posts + metric deltas; write `competitorObservations`; surface to Trends.",
    triggers:
      "Cron 9:00am local. Conditional — silent no-op if `creators.namedPeers` empty. Coach caps at 5 peers; Manager at 10.",
    approvalGates: "None — read surface.",
    escalation: "Do not editorialize about whether to copy a peer's move. Cite the post; the creator decides.",
    cronMessage:
      "Run competitor watch: pull last 24h posts + deltas for each named peer (Coach: 5, Manager: 10), write `competitorObservations`, surface to Trends.",
  },
  {
    id: "calendar_lookahead",
    title: "Calendar-aware content planning",
    tier: "all",
    kind: "cron",
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
  {
    id: "manager_readiness_packet_quarterly",
    title: "Manager-readiness packet (quarterly)",
    tier: "all",
    kind: "cron",
    cronEntryId: "manager_readiness_packet_quarterly",
    defaultCron: "0 14 1 */3 *",
    session: "isolated",
    scope:
      "Run `maya-packet-generator` against full creatorPicture + 90d metrics + brandDeals + audience + top hooks. Render PDF via `pdf` skill. Write `packetGenerations`; push 'your packet is ready' with link.",
    triggers: "Cron 1st of every quarter 2:00pm local. Manager additionally permits on-demand.",
    approvalGates: "None — creator consumes the artifact.",
    escalation:
      "Pass content through citation firewall before render. Render failures retry once; second failure surfaces to operator.",
    cronMessage:
      "Run quarterly manager-readiness packet: full creatorPicture + 90d metrics + brandDeals + audience + top hooks, render PDF, write `packetGenerations`, push link.",
  },
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
    kind: "cron",
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
  {
    id: "algo_research_tiktok",
    title: "Platform algorithm research — TikTok",
    tier: "all",
    kind: "cron",
    cronEntryId: "algo_research_tiktok",
    defaultCron: "0 4 * * 1",
    session: "isolated",
    scope:
      "Call `maya-platform-algo-researcher` for TikTok via Brave Search across allowlisted creator-economy publications. Update global `platformAlgoCache`.",
    triggers: "Cron Monday 4:00am local. Manager gets a second weekly run Thursday 4am.",
    approvalGates: "None — cache write.",
    escalation: "If Brave returns 0 results, retain prior cache; log to `mayaActionLog`.",
    cronMessage:
      "Run TikTok algo research: call `maya-platform-algo-researcher` platform=tiktok, write to global platformAlgoCache.",
  },
  {
    id: "algo_research_instagram",
    title: "Platform algorithm research — Instagram",
    tier: "all",
    kind: "cron",
    cronEntryId: "algo_research_instagram",
    defaultCron: "15 4 * * 1",
    session: "isolated",
    scope: "Same as TikTok algo research, scoped to Instagram.",
    triggers: "Cron Monday 4:15am local. Offset 15min from TikTok.",
    approvalGates: "None.",
    escalation: "Same as TikTok algo research.",
    cronMessage: "Run Instagram algo research: platform=instagram, write to global platformAlgoCache.",
  },
  {
    id: "algo_research_youtube",
    title: "Platform algorithm research — YouTube",
    tier: "all",
    kind: "cron",
    cronEntryId: "algo_research_youtube",
    defaultCron: "30 4 * * 1",
    session: "isolated",
    scope: "Same as TikTok algo research, scoped to YouTube.",
    triggers: "Cron Monday 4:30am local.",
    approvalGates: "None.",
    escalation: "Same as TikTok algo research.",
    cronMessage: "Run YouTube algo research: platform=youtube, write to global platformAlgoCache.",
  },
  {
    id: "algo_research_linkedin",
    title: "Platform algorithm research — LinkedIn",
    tier: "all",
    kind: "cron",
    cronEntryId: "algo_research_linkedin",
    defaultCron: "45 4 * * 1",
    session: "isolated",
    scope: "Same as TikTok algo research, scoped to LinkedIn.",
    triggers: "Cron Monday 4:45am local.",
    approvalGates: "None.",
    escalation: "Same as TikTok algo research.",
    cronMessage: "Run LinkedIn algo research: platform=linkedin, write to global platformAlgoCache.",
  },
  {
    id: "algo_research_x",
    title: "Platform algorithm research — X",
    tier: "all",
    kind: "cron",
    cronEntryId: "algo_research_x",
    defaultCron: "0 5 * * 1",
    session: "isolated",
    scope: "Same as TikTok algo research, scoped to X.",
    triggers: "Cron Monday 5:00am local.",
    approvalGates: "None.",
    escalation: "Same as TikTok algo research.",
    cronMessage: "Run X algo research: platform=x, write to global platformAlgoCache.",
  },
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
      "Strict citation discipline. Never invent expectedOutcome — be explicit about uncertainty. Manager only; Coach gets lighter coaching in evening recap.",
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
      "Manager benefits from richer hook-pattern data in `posts.mayaAnnotation`; Coach falls back to first-line-of-caption as opener proxy.",
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
    kind: "cron",
    cronEntryId: "opportunity_scout_daily",
    defaultCron: "0 6 * * *",
    session: "isolated",
    scope:
      "Call `maya-opportunity-scout`: scan UGC marketplaces + X creator-call hashtags + local-brand Brave search per niche/location. Dedupe via `opportunityScoutSeen`. Surface top 3 to morning brief; full list to Today.",
    triggers: "Cron 6:00am local — runs before morning brief so the top-3 fold in. Manager also permits on-demand from chat.",
    approvalGates: "None on the scan. Creator marks 'pursue' before it flows to `pitch_strategy` + `brand_outreach`.",
    escalation: "Manager unlocks larger `maxResults` + Apollo/Hunter discovery on confirmed opportunities; Coach stops at 'creator decides'.",
    cronMessage:
      "Run opportunity scout: scan UGC marketplaces + creator-call hashtags + local brands per niche/location, dedupe, surface top 3 to brief + full list to Today.",
  },
  {
    id: "collab_matchmaker_weekly",
    title: "Collab matchmaker",
    tier: "all",
    kind: "cron",
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
    escalation: "Manager-only — Coach skips entirely (Coach's pitch path stops at 'consider these brands').",
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
    escalation: "Manager-only — Coach never composes cold outbound. Gmail revoke → 15-min-poll-for-2h fallback like `brand_email_triage`.",
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
