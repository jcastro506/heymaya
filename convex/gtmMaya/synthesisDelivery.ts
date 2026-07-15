/**
 * Deterministic synthesis safety-net — the #1 onboarding deliverable.
 *
 * The "plan" (who buys / WHERE I post + why / WHAT to post / connect ask) is
 * normally composed and sent by the agent's LLM turn after foundation research
 * completes. Observed failure: research finishes (foundationCompletedAt set),
 * but the LLM turn flakes and the founder NEVER receives a plan. That's a dead
 * onboarding — the worst outcome.
 *
 * This watchdog closes the loop: when foundation is complete but no strategy
 * has been proposed within a grace window, it ASSEMBLES the plan from stored
 * research data (buyer map + active channels + working formats + content
 * angles) and sends it directly via Telegram. The plan always reaches the user.
 *
 * Delivery signal (2026-07-15): `strategyDeliveredAt` on the agent row — the
 * same field the cached-plan pipe (pushCachedPlan) stamps — plus the upstream
 * composition signals (`planGeneratedAt` / `cachedSynthesisText`), which mean
 * a real agent-composed plan exists and pushCachedPlan owns delivering it.
 * Only when research is done, the grace window passed, and NONE of those are
 * set did the agent truly never deliver → fire. The watchdog then stamps
 * strategyDeliveredAt + synthesisSafetyNetFiredAt so nothing double-sends.
 * (It used to key on the research job's `strategyApprovalState` — a FOUNDER
 * DECISION field nothing sets on the happy path anymore — which made it
 * re-send a second plan ~20min after every healthy onboarding.)
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { selectActiveChannels } from "./channelSelection";
import { MAX_PLAN_DELIVERY_ATTEMPTS } from "./agentLifecycle";
import { planFeaturesGtm } from "./planGtm";
import type { GtmChannel } from "./channelScoring";
import type { WorkingFormat } from "./formatIntel";

/** Grace period after foundationCompletedAt before the watchdog assumes the
 * agent's own synthesis turn flaked and steps in. Synthesis normally lands in
 * minutes; 20m is comfortably past a healthy run without leaving the founder
 * waiting long. */
export const SYNTHESIS_GRACE_MS = 20 * 60 * 1000;

const CHANNEL_LABEL: Record<string, string> = {
  reddit: "Reddit",
  x: "X",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
  hn: "Hacker News",
  product_hunt: "Product Hunt",
};

export interface SynthesisPlanInput {
  productName: string;
  icpDescription: string | null;
  intentPhrases: string[];
  /** Channel scores (channel/decision/score/reasons/workingFormats), judged. */
  channelScores: Array<{
    channel: GtmChannel;
    decision: "primary" | "secondary" | "parked" | "blocked";
    score: number;
    confidence: "low" | "medium" | "high";
    qualityGate: { passed: boolean };
    reasons: string[];
    workingFormats?: WorkingFormat[];
  }>;
  contentAngles: Array<{ angle: string; hookVariants: string[] }>;
  /**
   * Plan-tier ceiling on active channels (from
   * `planFeaturesGtm.maxActiveChannels`). Optional: omit for no cap (legacy
   * floor-of-3 behavior). Threaded into selectActiveChannels so the safety-net
   * plan never lists more channels than the founder's tier paid for.
   */
  maxActiveChannels?: number;
}

/**
 * Pure plan composer — deterministic, unit-testable. Returns the Telegram
 * message text, or null if there isn't enough stored research to say anything
 * grounded (in which case the watchdog stays silent rather than send a stub —
 * grounded-or-silent).
 */
export function assembleDeterministicPlan(
  input: SynthesisPlanInput
): string | null {
  const selection = selectActiveChannels(input.channelScores, {
    maxActiveChannels: input.maxActiveChannels,
  });
  // Grounded-or-silent: if we have neither a buyer picture nor any active
  // channel, there's nothing honest to send.
  if (!input.icpDescription && selection.active.length === 0) return null;

  const lines: string[] = [];
  lines.push(`Here's your GTM plan for ${input.productName} 🌱`);
  lines.push("");

  if (input.icpDescription) {
    lines.push("*Who's buying*");
    lines.push(input.icpDescription.slice(0, 600));
    if (input.intentPhrases.length > 0) {
      lines.push(
        `They signal intent with things like: ${input.intentPhrases
          .slice(0, 3)
          .map((p) => `"${p}"`)
          .join(", ")}.`
      );
    }
    lines.push("");
  }

  if (selection.active.length > 0) {
    lines.push("*Where I'll post (and why)*");
    const scoreByChannel = new Map(
      input.channelScores.map((s) => [s.channel, s])
    );
    selection.active.forEach((channel, i) => {
      const s = scoreByChannel.get(channel);
      const label = CHANNEL_LABEL[channel] ?? channel;
      const role = i === 0 ? "primary" : i === 1 ? "secondary" : "also";
      const why = s?.reasons?.[0] ? ` — ${s.reasons[0]}` : "";
      lines.push(`• *${label}* (${role})${why}`);
      // Working formats: this is the "how to post" payload, grounded in the
      // niche's top-performing content.
      if (s?.workingFormats && s.workingFormats.length > 0) {
        const f = s.workingFormats[0]!;
        lines.push(`   ↳ what's working: ${f.formatName} (${f.engagementSignal})`);
      }
    });
    if (selection.belowFloor) {
      lines.push("");
      lines.push(
        "_I'm starting with only the channels the evidence clearly supports — I'll widen as I learn what converts._"
      );
    }
    lines.push("");
  }

  if (input.contentAngles.length > 0) {
    lines.push("*What I'll post*");
    input.contentAngles.slice(0, 3).forEach((a) => {
      const hook = a.hookVariants?.[0] ? ` e.g. "${a.hookVariants[0]}"` : "";
      lines.push(`• ${a.angle}${hook}`);
    });
    lines.push("");
  }

  lines.push(
    "*Next:* connect your accounts and I'll start posting for you. Reply here and I'll send the connect links."
  );
  lines.push("");
  lines.push(
    "_(I put this together from your research while my live planning step was catching up — tell me to adjust anything.)_"
  );

  return lines.join("\n");
}

export interface SynthesisCandidate {
  agentId: Id<"gtmAgents">;
  accountId: Id<"creators">;
  appId: Id<"gtmApps"> | null;
  productName: string;
  openClawFlyAppId: string | null;
  telegramChatId: string | null;
  foundationCompletedAt: number | null;
  // Decoupled trigger (2026-06-28): the safety-net now fires on RESEARCH being
  // done + grace, NOT on foundationCompletedAt — because the completion gate now
  // requires the actionable pool (threads + drafts), so a thin/flaked agent may
  // never reach foundationCompletedAt yet the founder still needs a plan.
  researchCompletedAt: number | null;
  killedAt: number | null;
  synthesisSafetyNetFiredAt: number | null;
  // 2026-07-15 — the "did a plan reach the founder?" signals. The watchdog
  // previously keyed on the research job's `strategyApprovalState` being null,
  // but under LIFECYCLE_MESSAGING_V1 the agent no longer calls
  // set_strategy_approval on send — Convex delivers the cached plan and stamps
  // `strategyDeliveredAt`. approvalState stayed null after every HEALTHY
  // delivery, so the safety net re-sent a second, differently-worded plan
  // ~20min later on every onboarding (live repro: plan 01:13, dupe 01:38).
  strategyDeliveredAt: number | null;
  planGeneratedAt: number | null;
  hasCachedPlan: boolean;
  latestResearchJobId: Id<"gtmResearchJobs"> | null;
  plan: SynthesisPlanInput | null;
}

async function buildCandidate(
  ctx: Pick<QueryCtx, "db">,
  agentId: Id<"gtmAgents">
): Promise<SynthesisCandidate | null> {
  const agent = await ctx.db.get(agentId);
  if (!agent) return null;

  const app = agent.appId ? await ctx.db.get(agent.appId) : null;
  const latestJob = agent.appId
    ? await ctx.db
        .query("gtmResearchJobs")
        .withIndex("by_app", (q) => q.eq("appId", agent.appId!))
        .collect()
        .then((jobs) => jobs.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null)
    : null;

  const [buyerMap, channelScoreRows, contentAngles] = await Promise.all([
    ctx.db
      .query("gtmBuyerMap")
      .withIndex("by_agent", (q) => q.eq("agentId", agentId))
      .first(),
    latestJob
      ? ctx.db
          .query("gtmChannelScores")
          .withIndex("by_research_job", (q) =>
            q.eq("researchJobId", latestJob._id)
          )
          .collect()
      : Promise.resolve([]),
    ctx.db
      .query("gtmContentAngles")
      .withIndex("by_agent", (q) => q.eq("agentId", agentId))
      .collect(),
  ]);

  const plan: SynthesisPlanInput | null =
    buyerMap || channelScoreRows.length > 0
      ? {
          productName: app?.name ?? "your product",
          icpDescription: buyerMap?.icpDescription ?? null,
          intentPhrases: buyerMap?.intentPhrases ?? [],
          channelScores: channelScoreRows.map((s) => ({
            channel: s.channel,
            decision: s.decision,
            score: s.score,
            confidence: s.confidence,
            qualityGate: s.qualityGate,
            reasons: s.reasons,
            workingFormats: s.workingFormatsJson
              ? (safeParse(s.workingFormatsJson) as WorkingFormat[])
              : undefined,
          })),
          contentAngles: contentAngles.map((a) => ({
            angle: a.angle,
            hookVariants: a.hookVariants,
          })),
          // Plan-tier cap (starter 3 / growth 6 / studio 6; fail-closed 0) so
          // the safety-net plan never lists more channels than the tier paid
          // for.
          maxActiveChannels: planFeaturesGtm({
            gtmPlanJson: agent.gtmPlanJson,
          }).maxActiveChannels,
        }
      : null;

  return {
    agentId,
    accountId: agent.accountId,
    appId: agent.appId ?? null,
    productName: app?.name ?? "your product",
    openClawFlyAppId: agent.openClawFlyAppId ?? null,
    telegramChatId: agent.telegramChatId ?? null,
    foundationCompletedAt: agent.foundationCompletedAt ?? null,
    researchCompletedAt: agent.researchCompletedAt ?? null,
    killedAt: agent.killedAt ?? null,
    synthesisSafetyNetFiredAt: agent.synthesisSafetyNetFiredAt ?? null,
    strategyDeliveredAt: agent.strategyDeliveredAt ?? null,
    planGeneratedAt: agent.planGeneratedAt ?? null,
    hasCachedPlan: Boolean(agent.cachedSynthesisText),
    latestResearchJobId: latestJob?._id ?? null,
    plan,
  };
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

/** Is this candidate overdue for synthesis (agent failed to deliver)? Keys on
 *  RESEARCH being done + grace (not foundationCompletedAt) — so it still fires
 *  when the completion gate is blocked by a thin pool but the founder needs a
 *  plan.
 *
 *  The "already handled" gate is the DELIVERY chain, not approval state:
 *  - `strategyDeliveredAt` — a plan reached the founder (any pipe).
 *  - `planGeneratedAt` / `hasCachedPlan` — the agent composed a plan and
 *    `pushCachedPlan` owns its delivery (idempotent, attempt-capped, re-fired
 *    on connect + by its own sweep). Firing the deterministic fallback under
 *    it would race the better, agent-composed plan.
 *  The safety net's true job is only the case where the agent never composed
 *  ANYTHING: research done, grace passed, no delivery, no cache, no claim.
 *  (`strategyApprovalState` is deliberately NOT consulted — it means "founder
 *  decision", and reading it as "delivered" caused the live double-plan.) */
export function isOverdue(c: SynthesisCandidate, now: number): boolean {
  return (
    !c.killedAt &&
    !c.synthesisSafetyNetFiredAt &&
    c.researchCompletedAt !== null &&
    now - c.researchCompletedAt > SYNTHESIS_GRACE_MS &&
    c.strategyDeliveredAt === null &&
    c.planGeneratedAt === null &&
    !c.hasCachedPlan &&
    Boolean(c.telegramChatId)
  );
}

export const peekSynthesisCandidate = internalQuery({
  args: { agentId: v.id("gtmAgents") },
  handler: async (ctx, args): Promise<SynthesisCandidate | null> => {
    return await buildCandidate(ctx, args.agentId);
  },
});

/** Agents with a live machine + completed foundation — the sweep's work list. */
export const listAgentsForSynthesisCheck = internalQuery({
  args: {},
  handler: async (ctx): Promise<Array<Id<"gtmAgents">>> => {
    const agents = await ctx.db.query("gtmAgents").collect();
    return agents
      .filter(
        (a) =>
          a.openClawFlyAppId &&
          !a.killedAt &&
          a.researchCompletedAt &&
          !a.synthesisSafetyNetFiredAt
      )
      .map((a) => a._id);
  },
});

export const markSynthesisDelivered = internalMutation({
  args: {
    agentId: v.id("gtmAgents"),
    researchJobId: v.optional(v.id("gtmResearchJobs")),
  },
  handler: async (ctx, args): Promise<void> => {
    const now = Date.now();
    // `strategyDeliveredAt` is THE canonical "a plan reached the founder"
    // signal (same field pushCachedPlan stamps) — every delivery pipe
    // registers on the same row, so no watchdog can double-send.
    //
    // Deliberately does NOT touch the research job's `strategyApprovalState`:
    // that field means "founder decision" (set by the agent's
    // set_strategy_approval tool or the web approveMyPlan). The old write of
    // "proposed" here overloaded approval as a delivery flag — the only reason
    // the old isOverdue check ever worked — and polluted tryActivateAgent /
    // getMyPlanDoc semantics.
    await ctx.db.patch(args.agentId, {
      synthesisSafetyNetFiredAt: now,
      strategyDeliveredAt: now,
      updatedAt: now,
    });
  },
});

// ───────────────────── Deliver-on-connect (the enum refactor) ─────────────────
//
// The agent's OWN synthesis plan is cached on `gtmAgents.cachedSynthesisText`
// when it sends (send_update). If that send couldn't land (no channel paired
// yet), the plan is held — NOT re-generated by the agent. Convex re-pushes the
// CACHED text the moment a channel connects (telegram pairing event) or on a
// bounded sweep. This is what makes a failed/again delivery cost cents (one push)
// instead of dollars (a full strategy rebuild) — the loop the $22 run exposed.

interface CachedPlanPushTarget {
  accountId: Id<"creators">;
  cachedText: string | null;
  telegramChatId: string | null;
  alreadyDelivered: boolean;
  attempts: number;
  capped: boolean;
  killed: boolean;
}

export const peekCachedPlanForPush = internalQuery({
  args: { agentId: v.id("gtmAgents") },
  handler: async (ctx, args): Promise<CachedPlanPushTarget | null> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return null;
    const attempts = agent.planDeliveryAttempts ?? 0;
    return {
      accountId: agent.accountId,
      cachedText:
        typeof agent.cachedSynthesisText === "string" &&
        agent.cachedSynthesisText.trim().length > 0
          ? agent.cachedSynthesisText
          : null,
      telegramChatId: agent.telegramChatId ?? null,
      alreadyDelivered: agent.strategyDeliveredAt != null,
      attempts,
      capped: attempts >= MAX_PLAN_DELIVERY_ATTEMPTS,
      killed: agent.killedAt != null,
    };
  },
});

/**
 * Re-push the agent's CACHED synthesis plan to the founder's channel. Called
 * from the channel-connected (telegram pairing) event and a bounded sweep.
 * Idempotent + cheap: a single Telegram send of already-composed text, no LLM.
 * Stamps strategyDeliveredAt on success; stays silent (and dormant past the cap)
 * if there's no channel / no cached plan / already delivered.
 */
export const pushCachedPlan = internalAction({
  args: { agentId: v.id("gtmAgents") },
  handler: async (
    ctx,
    args
  ): Promise<{ delivered: boolean; reason: string }> => {
    const t = await ctx.runQuery(
      internal.gtmMaya.synthesisDelivery.peekCachedPlanForPush,
      { agentId: args.agentId }
    );
    if (!t) return { delivered: false, reason: "agent not found" };
    if (t.killed) return { delivered: false, reason: "agent killed" };
    if (t.alreadyDelivered) return { delivered: false, reason: "already delivered" };
    if (!t.cachedText) return { delivered: false, reason: "no cached plan" };
    if (!t.telegramChatId) return { delivered: false, reason: "no channel yet" };
    if (t.capped) return { delivered: false, reason: "delivery cap reached (dormant)" };

    // Bound the blind retries BEFORE attempting (so a hard-failing send still
    // counts toward the cap and we can't loop the sweep forever).
    await ctx.runMutation(
      internal.gtmMaya.agentLifecycle.bumpPlanDeliveryAttempt,
      { agentId: args.agentId }
    );

    const { resolveBotForAgent } = await import("./telegramBotPerTenant");
    const bot = await resolveBotForAgent(
      ctx as { runQuery: <T>(ref: unknown, args: unknown) => Promise<T> },
      args.agentId,
      {
        sharedToken: process.env.TELEGRAM_BOT_TOKEN,
        sharedUsername: process.env.TELEGRAM_BOT_USERNAME,
      }
    );
    const { sendDirectTelegramMessage } = await import(
      "../integrations/telegram/sendDirectMessage"
    );
    const result = await sendDirectTelegramMessage({
      botToken: bot.token ?? undefined,
      chatId: t.telegramChatId,
      text: t.cachedText,
    });
    if (!result.ok) {
      console.warn(
        `[pushCachedPlan] send failed for ${args.agentId}: ${result.reason}`
      );
      return { delivered: false, reason: `send failed: ${result.reason}` };
    }

    await ctx.runMutation(
      internal.gtmMaya.agentLifecycle.markStrategyDelivered,
      { agentId: args.agentId }
    );
    // Record the re-pushed plan in the transcript so the founder thread is
    // coherent (the original send may have produced no transcript row).
    try {
      await ctx.runMutation(
        internal.gtmMaya.openclaw.conversationCapture.persistMayaMessage,
        {
          accountId: t.accountId,
          agentId: args.agentId,
          role: "maya",
          body: t.cachedText,
          channel: "telegram",
          turnId: `cached-plan-${args.agentId}`,
          messageClass: "strategic",
        }
      );
    } catch (err) {
      console.error(
        `[pushCachedPlan] transcript persist failed for ${args.agentId}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
    console.log(
      `[pushCachedPlan] delivered cached plan for ${args.agentId} (msg ${result.messageId})`
    );
    return { delivered: true, reason: "delivered" };
  },
});

/** Agents holding a cached plan that hasn't reached the founder yet, with a
 *  channel now present and retries left — the cached-plan sweep's work list. The
 *  pairing event is the primary deliver-on-connect trigger; this sweep is the
 *  backstop for a transient send failure where the channel already existed. */
export const listAgentsWithUndeliveredCachedPlan = internalQuery({
  args: {},
  handler: async (ctx): Promise<Array<Id<"gtmAgents">>> => {
    const agents = await ctx.db.query("gtmAgents").collect();
    return agents
      .filter(
        (a) =>
          !a.killedAt &&
          typeof a.cachedSynthesisText === "string" &&
          a.cachedSynthesisText.trim().length > 0 &&
          a.strategyDeliveredAt == null &&
          Boolean(a.telegramChatId) &&
          (a.planDeliveryAttempts ?? 0) < MAX_PLAN_DELIVERY_ATTEMPTS
      )
      .map((a) => a._id);
  },
});

/** Sweep: re-push every cached-but-undelivered plan whose channel now exists.
 *  Bounded by planDeliveryAttempts (per agent) so a dead channel can't loop. */
export const sweepCachedPlanDelivery = internalAction({
  args: {},
  handler: async (ctx): Promise<{ checked: number; delivered: number }> => {
    const agentIds = await ctx.runQuery(
      internal.gtmMaya.synthesisDelivery.listAgentsWithUndeliveredCachedPlan,
      {}
    );
    let delivered = 0;
    for (const agentId of agentIds) {
      const res = await ctx.runAction(
        internal.gtmMaya.synthesisDelivery.pushCachedPlan,
        { agentId }
      );
      if (res.delivered) delivered += 1;
    }
    if (delivered > 0) {
      console.log(
        `[cachedPlanSweep] delivered ${delivered} of ${agentIds.length} held plans`
      );
    }
    return { checked: agentIds.length, delivered };
  },
});

/**
 * Deliver the safety-net plan for ONE agent if it's overdue. Idempotent.
 */
export const deliverSynthesisSafetyNet = internalAction({
  args: { agentId: v.id("gtmAgents") },
  handler: async (
    ctx,
    args
  ): Promise<{ delivered: boolean; reason: string }> => {
    const c = await ctx.runQuery(
      internal.gtmMaya.synthesisDelivery.peekSynthesisCandidate,
      { agentId: args.agentId }
    );
    if (!c) return { delivered: false, reason: "agent not found" };
    if (!isOverdue(c, Date.now())) {
      return { delivered: false, reason: "not overdue" };
    }
    if (!c.plan) return { delivered: false, reason: "no stored research to assemble" };

    const text = assembleDeterministicPlan(c.plan);
    if (!text) return { delivered: false, reason: "plan not groundable" };

    const { resolveBotForAgent } = await import("./telegramBotPerTenant");
    const bot = await resolveBotForAgent(
      ctx as { runQuery: <T>(ref: unknown, args: unknown) => Promise<T> },
      args.agentId,
      {
        sharedToken: process.env.TELEGRAM_BOT_TOKEN,
        sharedUsername: process.env.TELEGRAM_BOT_USERNAME,
      }
    );
    const { sendDirectTelegramMessage } = await import(
      "../integrations/telegram/sendDirectMessage"
    );
    const result = await sendDirectTelegramMessage({
      botToken: bot.token ?? undefined,
      chatId: c.telegramChatId ?? undefined,
      text,
    });
    if (!result.ok) {
      console.warn(
        `[synthesisSafetyNet] send failed for ${args.agentId}: ${result.reason}`
      );
      return { delivered: false, reason: `send failed: ${result.reason}` };
    }

    await ctx.runMutation(
      internal.gtmMaya.synthesisDelivery.markSynthesisDelivered,
      {
        agentId: args.agentId,
        researchJobId: c.latestResearchJobId ?? undefined,
      }
    );
    console.log(
      `[synthesisSafetyNet] delivered plan for ${args.agentId} (msg ${result.messageId})`
    );
    return { delivered: true, reason: "delivered" };
  },
});

/**
 * Watchdog sweep: deliver the safety-net plan for every overdue agent. Runs on
 * a Convex cron.
 */
export const sweepSynthesisSafetyNet = internalAction({
  args: {},
  handler: async (
    ctx
  ): Promise<{ checked: number; delivered: number }> => {
    const agentIds = await ctx.runQuery(
      internal.gtmMaya.synthesisDelivery.listAgentsForSynthesisCheck,
      {}
    );
    let delivered = 0;
    for (const agentId of agentIds) {
      const res = await ctx.runAction(
        internal.gtmMaya.synthesisDelivery.deliverSynthesisSafetyNet,
        { agentId }
      );
      if (res.delivered) delivered += 1;
    }
    if (delivered > 0) {
      console.log(
        `[synthesisSafetyNet] sweep delivered ${delivered} of ${agentIds.length} candidates`
      );
    }
    return { checked: agentIds.length, delivered };
  },
});
