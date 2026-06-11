import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { sumLedgerForAccountSince } from "./costCap";

/**
 * Liveness / dark-day watchdog — the "did Maya go silent?" alarm.
 *
 * The dramatic failures (runaway loop, double-message, fabricated history) are
 * fixed by durable lifecycle state + the spend kill-switch. The remaining gap
 * the audit flagged: over weeks the likely failure is NOT a crash but quiet
 * degradation — the Fly machine dies, or the LLM returns NO_REPLY for days, and
 * NOTHING watches. Two weeks of silence looks identical to two weeks of working.
 *
 * This sweep watches every live, past-onboarding agent for two anomalies and
 * ALERTS the operator (auto-kill stays on confirmed spend; "we can't see / it
 * went quiet" is a human-alert, not an auto-destroy):
 *   - DARK BRIEF — lastMorningBriefAt missed a full daily cycle (machine down,
 *     or the LLM silently stopped delivering the brief).
 *   - BLIND COST — zero operational spend over a window while alive past
 *     onboarding. With the derived-cost fix a healthy agent always logs SOME
 *     spend (the 30-min heartbeat alone costs cents); a flat $0 means telemetry
 *     or the machine is dead — the exact blind state the kill-switch can't see.
 *
 * Alerts go to OPERATOR_TELEGRAM_CHAT_ID via the shared bot (Convex→Telegram,
 * the reliable direction — works even when the agent's Fly machine is down).
 * Deduped via gtmAgents.livenessAlertedAt so we alert once per window.
 */

const HOUR_MS = 60 * 60 * 1000;
// Flag "dark" only after a full daily cycle is missed (28h) so a slightly-late
// brief or a timezone edge never false-alarms.
const DARK_BRIEF_MS = 28 * HOUR_MS;
// "Blind" = zero operational spend over this window while alive past onboarding.
const BLIND_WINDOW_MS = 4 * HOUR_MS;
// Don't re-alert the same agent more than once per this window.
const ALERT_DEDUP_MS = 12 * HOUR_MS;
// Give a freshly-deployed agent time to finish onboarding + hit its first brief
// before we judge it dark.
const GRACE_AFTER_DEPLOY_MS = 28 * HOUR_MS;

export interface LivenessAnomaly {
  agentId: Id<"gtmAgents">;
  flyAppId: string | null;
  kind: "dark_brief" | "blind_cost";
  detail: string;
}

/** Pure helper — unit-testable without a Convex ctx. */
export function classifyLiveness(input: {
  now: number;
  killed: boolean;
  hasFlyApp: boolean;
  foundationCompletedAt: number | null;
  deployedAt: number | null;
  lastMorningBriefAt: number | null;
  livenessAlertedAt: number | null;
  recentOperationalSpendUsd: number;
}): LivenessAnomaly["kind"] | null {
  if (!input.hasFlyApp || input.killed) return null;
  if (input.foundationCompletedAt === null) return null;
  const deployedAt = input.deployedAt ?? input.foundationCompletedAt;
  if (input.now - deployedAt < GRACE_AFTER_DEPLOY_MS) return null;
  if (
    input.livenessAlertedAt !== null &&
    input.now - input.livenessAlertedAt < ALERT_DEDUP_MS
  ) {
    return null;
  }
  const lastBrief = input.lastMorningBriefAt ?? 0;
  if (input.now - lastBrief > DARK_BRIEF_MS) return "dark_brief";
  if (input.recentOperationalSpendUsd <= 0) return "blind_cost";
  return null;
}

export const listLivenessAnomalies = internalQuery({
  args: {},
  handler: async (ctx): Promise<LivenessAnomaly[]> => {
    const now = Date.now();
    const agents = await ctx.db.query("gtmAgents").collect();
    const out: LivenessAnomaly[] = [];
    for (const a of agents) {
      // Cheap pre-checks before the per-agent ledger sum.
      if (!a.openClawFlyAppId || a.killedAt) continue;
      if (!a.foundationCompletedAt) continue;
      const deployedAt = a.deployedAt ?? a.foundationCompletedAt;
      if (now - deployedAt < GRACE_AFTER_DEPLOY_MS) continue;
      if (a.livenessAlertedAt && now - a.livenessAlertedAt < ALERT_DEDUP_MS) {
        continue;
      }
      const lastBrief = a.lastMorningBriefAt ?? 0;
      // Dark brief is the higher-confidence signal — check it without a ledger read.
      if (now - lastBrief > DARK_BRIEF_MS) {
        out.push({
          agentId: a._id,
          flyAppId: a.openClawFlyAppId,
          kind: "dark_brief",
          detail:
            lastBrief === 0
              ? "no morning brief has ever fired since onboarding completed"
              : `last morning brief ${Math.round((now - lastBrief) / HOUR_MS)}h ago (missed a full daily cycle)`,
        });
        continue; // one anomaly per agent per sweep
      }
      // Blind cost: zero operational spend over the window = telemetry/machine dead.
      const spend = await sumLedgerForAccountSince(
        ctx,
        a.accountId,
        now - BLIND_WINDOW_MS,
        { excludeResearchJobSpend: true }
      );
      if (spend <= 0) {
        out.push({
          agentId: a._id,
          flyAppId: a.openClawFlyAppId,
          kind: "blind_cost",
          detail: `zero operational spend in the last ${Math.round(
            BLIND_WINDOW_MS / HOUR_MS
          )}h while alive — telemetry or the machine may be dead (kill-switch is flying blind)`,
        });
      }
    }
    return out;
  },
});

export const markLivenessAlerted = internalMutation({
  args: { agentId: v.id("gtmAgents") },
  handler: async (ctx, args): Promise<void> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return;
    await ctx.db.patch(args.agentId, {
      livenessAlertedAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

/**
 * Backstop cron: flag every silent/blind live agent and alert the operator.
 * Deduped per agent via livenessAlertedAt. Never auto-kills — silence is a
 * human-investigate signal, not a destroy signal.
 */
export const sweepLiveness = internalAction({
  args: {},
  handler: async (
    ctx
  ): Promise<{ flagged: number; alerted: number }> => {
    const anomalies = await ctx.runQuery(
      internal.gtmMaya.livenessWatch.listLivenessAnomalies,
      {}
    );
    const operatorChatId = process.env.OPERATOR_TELEGRAM_CHAT_ID;
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    let alerted = 0;
    for (const anomaly of anomalies) {
      const msg = `HeyMaya liveness alert — agent ${anomaly.agentId} (${
        anomaly.flyAppId ?? "no-fly-app"
      }): ${anomaly.detail}.`;
      // Always log loudly so it surfaces in Convex logs even without a chat id.
      console.error(`[livenessWatch] ${anomaly.kind}: ${msg}`);
      if (operatorChatId && botToken) {
        const { sendDirectTelegramMessage } = await import(
          "../integrations/telegram/sendDirectMessage"
        );
        const r = await sendDirectTelegramMessage({
          botToken,
          chatId: operatorChatId,
          text: msg,
        });
        if (r.ok) alerted += 1;
      }
      // Stamp dedup even if no operator chat is configured, so logs aren't spammed.
      await ctx.runMutation(
        internal.gtmMaya.livenessWatch.markLivenessAlerted,
        { agentId: anomaly.agentId }
      );
    }
    if (anomalies.length > 0) {
      console.log(
        `[livenessWatch] flagged ${anomalies.length}, alerted ${alerted}`
      );
    }
    return { flagged: anomalies.length, alerted };
  },
});
