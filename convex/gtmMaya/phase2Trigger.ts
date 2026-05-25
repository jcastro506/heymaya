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

2. Read what the phase-1 subagents produced: GET /lc_gtm/get_my_target_threads (target threads they queued) — count by platform. If zero threads landed, the subagents are still running OR they failed — fall back to a brief 'still researching, will follow up in 30 min' message and exit.

3. Sprint 2.4 voice-match: for every gtmDraftedContent row in approvalState:'pending_approval', follow skills/maya-voice-matcher/SKILL.md. Score voice + slop + specificity. POST to /lc_gtm/update_draft_voice_match. Only voice-clean drafts make it to the calendar.

4. Sprint 2.3 calendar populator: read skills/maya-calendar-populator/SKILL.md. Compute operator's current Phase (1-4 per PLAYBOOK § 2). Emit typed calendar events (warmup_block / engagement_block / reply_window / etc) for the next 14 days. POST to /lc_gtm/calendar_proposal as status:'draft'. Run maya-slop-critic on every event title before POSTing.

EXTERNAL PHASE (the ONE Telegram message — ≤500 chars).

Research-backed manager-voice plan. Required: greeting (USER.md), primary channel pick in plain words, count of target threads queued ('I've got 23 threads worth replying to'), what's first ('first task is tomorrow at 10am'), honest ask if next-step is fork-decision. HARD BANS: no maya-* slugs, no .md filenames, no internal terms, no AI framing.

Example CORRECT: 'Hey Josh — Maya. Done. Your buyer lives on Reddit (r/ollama, r/LocalLLaMA). I've lined up 23 specific threads worth replying to + 12 accounts to follow over the next 2 weeks. Your calendar's filled — first task is tomorrow at 10am. Want me to walk you through the week before I lock it in?'

Sprint 2.10 — MANDATORY pre-send firewall: POST composed message to /lc_gtm/validate_outbound BEFORE sendMessage. Loop until ok:true.

Do NOT spawn fresh subagents in this turn — phase 1 did that. If a subagent didn't produce results, note it in the message ('Reddit subagent is still running, will follow up') and exit.`;

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
