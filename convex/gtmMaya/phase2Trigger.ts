/**
 * Sprint 2.14a.10 — event-driven phase 2 trigger.
 *
 * Replaces the hardcoded +60min wait between boot_phase_1 and
 * boot_phase_2 with a real event signal:
 *
 *   1. Phase 1 prompt instructs Maya to POST /lc_gtm/phase_1_announce
 *      with the count of subagents she spawned. We persist
 *      subagentsExpected on the research job row.
 *
 *   2. Each subagent's prompt (composed inside Maya phase 1) ends
 *      with: "POST /lc_gtm/subagent_complete when you finish."
 *      Subagents call it via the hookToken auth pattern.
 *
 *   3. When subagentsCompleted >= subagentsExpected, Convex
 *      immediately POSTs the phase 2 prompt to OpenClaw via the
 *      runAgentTurn webhook. No timer waiting.
 *
 *   4. The cron-scheduled boot_phase_2 at deploy+2hr is a safety
 *      net — if subagents never complete (one crashed, network
 *      failed, etc.) phase 2 still fires eventually. Phase 2
 *      itself reads phase2TriggeredAt + exits early if already
 *      triggered (idempotency).
 *
 * Per [[feedback-trust-llm-judgment-no-hardcoded-rules]] — the
 * agent's subagent count + actual completion drive the schedule,
 * not threshold rules.
 */

import { runAgentTurn } from "./openclaw/hookClient";

/**
 * The phase 2 prompt — kept in sync with the corresponding cron job
 * in generators.ts. When the cron-scheduled phase 2 cron fires, it
 * runs an identical prompt. When the event-driven trigger fires, it
 * sends THIS string. Keep them word-for-word identical so behavior
 * is the same regardless of which path fired.
 *
 * (Yes, this is duplication between two files. The alternative is
 * extracting the prompt to a shared module which both generators.ts
 * and this file import — same outcome, more indirection. Single
 * source-of-truth on the cron itself would be better but requires
 * an OpenClaw "fire this specific cron now" hook that doesn't exist.)
 */
export const PHASE_2_PROMPT_BODY = `BOOT PHASE 2 — synthesize phase-1 research into operator's plan.

INTERNAL PHASE (silent).

1. Read SOUL.md (voice contract), AGENTS.md, USER.md, APP.md, GTM.md, TOOLS.md, PLAYBOOK.md, HEARTBEAT.md.

2. Read what the phase-1 subagents produced: GET /lc_gtm/get_my_target_threads (target threads they queued) — count by platform. RECORD the actual evidence_ids (gtmEvidenceCards row IDs) the subagents wrote — you'll need them for STEP 6's strategic send. If zero threads landed, the subagents are still running OR they failed — fall back to a TACTICAL message: { text: 'Hey — still on it. First pass turned up thinner signal than I want before I commit to a plan. Going deeper, will have something solid in ~30 min.', messageClass: 'tactical' } and exit.

3. Sprint 2.4 voice-match: for every gtmDraftedContent row in approvalState:'pending_approval', follow skills/maya-voice-matcher/SKILL.md. Score voice + slop + specificity. POST to /lc_gtm/update_draft_voice_match. Only voice-clean drafts make it to the calendar.

4. Sprint 2.3 calendar populator: read skills/maya-calendar-populator/SKILL.md. Compute operator's current Phase (1-4 per PLAYBOOK § 2). Emit typed calendar events (warmup_block / engagement_block / reply_window / etc) for the next 14 days. POST to /lc_gtm/calendar_proposal as status:'draft'. Run maya-slop-critic on every event title before POSTing.

5. **EVIDENCE PREP** (Sprint 2.16j — load-bearing for STEP 6).
For the strategic plan message you're about to send, identify ≤3 concrete claims you intend to make. For each claim, gather the evidence_ids that justify it:
  - "Your buyers are on <channel>" → 2-5 highest-painMatch evidence_card IDs from that platform
  - "I've queued N threads worth replying to" → the gtmTargetThreads IDs (numeric assertion only — count is verifiable)
  - "First task is <day> at <time>" → the gtmCalendarEvents ID

Hold these as a structured list. STEP 6's send_update call MUST include them in the \`claims\` field or the server hard-blocks the send. No bypass.

EXTERNAL PHASE (the ONE Telegram message — ≤500 chars).

6. **SEND THE PLAN** via POST /lc_gtm/send_update with this body shape:
\`\`\`json
{
  "text": "<your composed message ≤500 chars>",
  "messageClass": "strategic",
  "claims": [
    { "claim": "Your buyers are on Reddit (r/ollama, r/LocalLLaMA)", "evidence_ids": ["<card_id_1>", "<card_id_2>"] },
    { "claim": "23 threads queued worth replying to over 2 weeks", "evidence_ids": ["<thread_id_1>", "<thread_id_2>"] },
    { "claim": "First task tomorrow at 10am", "evidence_ids": ["<calendar_event_id_1>"] }
  ]
}
\`\`\`

Required text ingredients: greeting (USER.md), primary channel pick in plain words, count of target threads ACTUALLY queued (verify by counting /lc_gtm/get_my_target_threads — never invent), what's first IF AND ONLY IF you successfully wrote calendar events, honest ask if next-step is fork-decision.

HARD BANS in the text: no maya-* slugs, no .md filenames, no internal terms, no AI framing.

Example CORRECT: 'Hey Josh — Maya. Done. Your buyer lives on Reddit (r/ollama, r/LocalLLaMA). I've lined up 23 specific threads worth replying to + 12 accounts to follow over the next 2 weeks. Your calendar's filled — first task is tomorrow at 10am. Want me to walk you through the week before I lock it in?'

If the server returns ok:false with reason 'evidence_blocked', read failures[]. For each failure:
  - reason 'missing_evidence_ids' → either find real evidence_ids or DROP that claim from the text and resend
  - reason 'evidence_not_found' → typo in the ID; double-check against /lc_gtm/get_my_target_threads
  - reason 'evidence_wrong_account' → never happens unless a bug; surface to operator as a system note

After 2 failed validations, fall back to a degraded TACTICAL message: { text: 'Hey — I have the research but I'm checking my sources before I commit to a plan. Back in ~10 min with the grounded version.', messageClass: 'tactical' } and exit. Never silent.

Sprint 2.10 — pre-send VOICE firewall still runs on every send_update internally; if voice fails you'll see failures[] with category 'skill_slug' etc. Same loop: rewrite + resend.

Do NOT spawn fresh subagents in this turn — phase 1 did that. If a subagent didn't produce results, note it in the tactical message and exit.`;

export interface TriggerPhase2Result {
  fired: boolean;
  reason:
    | "fired"
    | "already_triggered"
    | "missing_endpoint"
    | "missing_token"
    | "missing_chat"
    | "webhook_failed";
  webhookStatus?: number;
  triggeredAt?: number;
}

/**
 * Attempt to fire boot_phase_2 via the OpenClaw runAgentTurn webhook.
 * Caller (the subagent-complete HTTP route OR the safety-net cron)
 * already determined readiness; this just does the fire + records the
 * idempotency timestamp.
 *
 * Idempotency note: the caller MUST check phase2TriggeredAt is empty
 * BEFORE calling this. We don't double-check inside the action because
 * Convex queries inside actions are eventually-consistent; the caller
 * should use a transactional mutation to claim the trigger right.
 */
export async function fireBootPhase2Webhook(input: {
  flyAppName: string;
  hookToken: string;
  telegramChatId: string | undefined;
  source: "subagent_complete" | "safety_net_cron";
  fetchImpl?: typeof fetch;
}): Promise<TriggerPhase2Result> {
  if (!input.flyAppName) {
    return { fired: false, reason: "missing_endpoint" };
  }
  if (!input.hookToken) {
    return { fired: false, reason: "missing_token" };
  }

  const baseUrl = `https://${input.flyAppName}.fly.dev/hooks`;
  const result = await runAgentTurn(
    { baseUrl, token: input.hookToken },
    {
      message: PHASE_2_PROMPT_BODY,
      deliver: true,
      channel: input.telegramChatId ? "telegram" : undefined,
      to: input.telegramChatId,
      thinking: "medium",
      // No timeoutSeconds — Sprint 2.14a.11 removed cron-level
      // caps; webhook-triggered turns follow the same policy.
    },
    input.fetchImpl ?? fetch
  );

  if (!result.ok) {
    return {
      fired: false,
      reason: "webhook_failed",
      webhookStatus: result.status,
    };
  }

  return {
    fired: true,
    reason: "fired",
    triggeredAt: Date.now(),
    webhookStatus: result.status,
  };
}
