import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
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
 * This sweep watches every live agent for three anomalies and ALERTS the
 * operator (auto-kill stays on confirmed spend; "we can't see / it went quiet"
 * is a human-alert, not an auto-destroy):
 *   - DARK BRIEF — lastMorningBriefAt missed a full daily cycle (machine down,
 *     or the LLM silently stopped delivering the brief). Post-onboarding only.
 *   - BLIND COST — zero operational spend over a window while alive past
 *     onboarding. With the derived-cost fix a healthy agent always logs SOME
 *     spend (the 30-min heartbeat alone costs cents); a flat $0 means telemetry
 *     or the machine is dead — the exact blind state the kill-switch can't see.
 *   - STALLED ONBOARDING — deployed but never reached foundationComplete after a
 *     threshold AND showing no recent progress (no new activity rows, no growth
 *     in evidence/foundation rows). This is the cold-boot failure: the agent
 *     dies DURING onboarding, never delivers its first plan, and the two
 *     post-foundation watches above never look at it (they gate on
 *     foundationCompletedAt). This class closes that blind spot.
 *
 * Alerts go to OPERATOR_TELEGRAM_CHAT_ID via the shared bot (Convex→Telegram,
 * the reliable direction — works even when the agent's Fly machine is down).
 * Deduped via gtmAgents.livenessAlertedAt so we alert once per window.
 */

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
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
// Onboarding should complete in a few minutes. After this much wall-clock past
// deploy with foundationComplete still unset, a healthy run would have either
// finished or be clearly mid-progress; if it's BOTH past this AND showing no
// recent progress, it's a cold-boot stall — flag it. 25 min is comfortably past
// the sub-4-min happy path + retries, short enough to catch the stall same-day.
const STALLED_ONBOARDING_MS = 25 * MINUTE_MS;
// "No recent progress" = no activity/evidence/foundation row written in this
// trailing window. A live onboarding pass writes rows continuously (research
// fans out, evidence lands); a flat stretch means the pass is wedged.
const PROGRESS_WINDOW_MS = 15 * MINUTE_MS;

export interface LivenessAnomaly {
  agentId: Id<"gtmAgents">;
  flyAppId: string | null;
  kind: "dark_brief" | "blind_cost" | "stalled_onboarding";
  detail: string;
}

export interface ClassifyLivenessInput {
  now: number;
  killed: boolean;
  hasFlyApp: boolean;
  foundationCompletedAt: number | null;
  deployedAt: number | null;
  lastMorningBriefAt: number | null;
  livenessAlertedAt: number | null;
  recentOperationalSpendUsd: number;
  // STALLED_ONBOARDING progress signal: unix-ms of the most recent sign of
  // forward motion during onboarding (newest gtmAgentActivity row, newest
  // gtmEvidenceCard, or foundationStartedAt). null = nothing observed at all.
  lastProgressAt?: number | null;
}

/**
 * Pure helper — unit-testable without a Convex ctx. Returns the highest-priority
 * anomaly kind for one agent, or null when it looks healthy.
 *
 * Ordering: pre-onboarding agents can only be `stalled_onboarding`;
 * post-onboarding agents can be `dark_brief` (highest-confidence) or
 * `blind_cost`. The two regimes are disjoint by foundationCompletedAt.
 */
export function classifyAgentLiveness(
  input: ClassifyLivenessInput
): LivenessAnomaly["kind"] | null {
  if (!input.hasFlyApp || input.killed) return null;

  const dedupedRecently =
    input.livenessAlertedAt !== null &&
    input.now - input.livenessAlertedAt < ALERT_DEDUP_MS;

  // ── Pre-onboarding regime: only the stalled-onboarding watch applies. ──
  if (input.foundationCompletedAt === null) {
    // Can't be stalled if it was never deployed (still provisioning).
    if (input.deployedAt === null) return null;
    if (dedupedRecently) return null;
    if (input.now - input.deployedAt < STALLED_ONBOARDING_MS) return null;
    // Recent forward motion → still working, not stalled.
    const lastProgress = input.lastProgressAt ?? null;
    if (
      lastProgress !== null &&
      input.now - lastProgress < PROGRESS_WINDOW_MS
    ) {
      return null;
    }
    return "stalled_onboarding";
  }

  // ── Post-onboarding regime: the original dark/blind watches. ──
  const deployedAt = input.deployedAt ?? input.foundationCompletedAt;
  if (input.now - deployedAt < GRACE_AFTER_DEPLOY_MS) return null;
  if (dedupedRecently) return null;
  const lastBrief = input.lastMorningBriefAt ?? 0;
  if (input.now - lastBrief > DARK_BRIEF_MS) return "dark_brief";
  if (input.recentOperationalSpendUsd <= 0) return "blind_cost";
  return null;
}

/**
 * Back-compat alias for the original (post-foundation-only) signature. Existing
 * callers/tests keep working; new code should call `classifyAgentLiveness`.
 */
export function classifyLiveness(
  input: Omit<ClassifyLivenessInput, "lastProgressAt">
): LivenessAnomaly["kind"] | null {
  return classifyAgentLiveness(input);
}

export const listLivenessAnomalies = internalQuery({
  args: {},
  handler: async (ctx): Promise<LivenessAnomaly[]> => {
    const now = Date.now();
    const agents = await ctx.db.query("gtmAgents").collect();
    const out: LivenessAnomaly[] = [];
    for (const a of agents) {
      // Cheap pre-checks shared by every regime.
      if (!a.openClawFlyAppId || a.killedAt) continue;
      if (a.livenessAlertedAt && now - a.livenessAlertedAt < ALERT_DEDUP_MS) {
        continue;
      }

      // ── Pre-onboarding regime: stalled-onboarding watch. ──
      // ENUM REFACTOR: "past onboarding" = the plan was GENERATED. The raw
      // foundationCompletedAt marker can lag plan_ready (the agent generated +
      // sent the plan but crashed before calling mark_lifecycle), so we also
      // accept planGeneratedAt — else a done agent would be mis-flagged "stalled."
      const workDoneAt = a.foundationCompletedAt ?? a.planGeneratedAt ?? null;
      if (!workDoneAt) {
        if (!a.deployedAt) continue; // still provisioning, not yet a stall
        if (now - a.deployedAt < STALLED_ONBOARDING_MS) continue;
        // Most-recent sign of forward motion: foundationStartedAt, or the newest
        // activity/evidence row for this account (each scoped to THIS account —
        // no cross-tenant read). Only look inside the progress window.
        const lastProgressAt = await mostRecentProgressAt(ctx, {
          accountId: a.accountId,
          agentId: a._id,
          foundationStartedAt: a.foundationStartedAt ?? null,
          sinceMs: now - PROGRESS_WINDOW_MS,
        });
        const kind = classifyAgentLiveness({
          now,
          killed: false,
          hasFlyApp: true,
          foundationCompletedAt: null,
          deployedAt: a.deployedAt,
          lastMorningBriefAt: null,
          livenessAlertedAt: a.livenessAlertedAt ?? null,
          recentOperationalSpendUsd: 0,
          lastProgressAt,
        });
        if (kind === "stalled_onboarding") {
          out.push({
            agentId: a._id,
            flyAppId: a.openClawFlyAppId,
            kind: "stalled_onboarding",
            detail: `deployed ${Math.round(
              (now - a.deployedAt) / MINUTE_MS
            )}m ago but never reached foundationComplete, and no onboarding progress in the last ${Math.round(
              PROGRESS_WINDOW_MS / MINUTE_MS
            )}m — cold-boot onboarding stall (the founder never got their first plan)`,
          });
        }
        continue;
      }

      // ── Post-onboarding regime: dark-brief / blind-cost. ──
      const deployedAt = a.deployedAt ?? workDoneAt;
      if (now - deployedAt < GRACE_AFTER_DEPLOY_MS) continue;
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

/**
 * Most-recent onboarding progress timestamp for ONE account, bounded to the
 * progress window. Reads only this account's rows (account-scoped indexes), so
 * it can never see another tenant's activity. Returns null when nothing in the
 * window — i.e. the onboarding pass is wedged.
 */
async function mostRecentProgressAt(
  ctx: Pick<QueryCtx, "db">,
  args: {
    accountId: Id<"creators">;
    agentId: Id<"gtmAgents">;
    foundationStartedAt: number | null;
    sinceMs: number;
  }
): Promise<number | null> {
  let latest: number | null =
    args.foundationStartedAt !== null && args.foundationStartedAt >= args.sinceMs
      ? args.foundationStartedAt
      : null;

  // Newest activity row for this account inside the window.
  const newestActivity = await ctx.db
    .query("gtmAgentActivity")
    .withIndex("by_account_and_created", (q) =>
      q.eq("accountId", args.accountId).gte("createdAt", args.sinceMs)
    )
    .order("desc")
    .first();
  if (newestActivity && (latest === null || newestActivity.createdAt > latest)) {
    latest = newestActivity.createdAt;
  }

  // Newest evidence card WRITTEN for this account (foundation research writes
  // these continuously). The by_account index orders by _creationTime, so the
  // first desc row is the most-recently-written; "progress" is about a row
  // landing recently, so we key off _creationTime, not observedAt.
  const newestEvidence = await ctx.db
    .query("gtmEvidenceCards")
    .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
    .order("desc")
    .first();
  if (
    newestEvidence &&
    newestEvidence._creationTime >= args.sinceMs &&
    (latest === null || newestEvidence._creationTime > latest)
  ) {
    latest = newestEvidence._creationTime;
  }

  return latest;
}

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
