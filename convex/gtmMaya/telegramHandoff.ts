import { v } from "convex/values";
import {
  internalAction,
  internalQuery,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  deriveHookBaseUrl,
  runAgentTurn,
  type HookEndpoint,
} from "./openclaw/hookClient";

/**
 * Sprint 10 — Telegram handoff after research completes.
 *
 * Once runBudgetedResearchJob (Sprint 1) returns, we want Maya to
 * actually message the user with a short summary + ask for approval.
 * We do this via the Sprint 16 native webhook hooks bridge — POST
 * /hooks/agent on the agent's Fly machine with deliver:true,
 * channel:telegram, to:<chatId>. OpenClaw's native announce delivery
 * sends the final agent text via the Telegram adapter (Sprint 14 cron
 * delivery uses the same channel-routing primitive).
 *
 * Failure modes:
 *   - Agent not deployed yet → skip (no Fly machine to call).
 *   - Telegram not paired → still call the hook but with deliver:false
 *     so we don't burn an undeliverable announce. Mission board will
 *     surface the un-summarized research.
 *   - hookToken missing → skip + warn (S16 provisioning didn't run).
 *   - HTTP failure → log but don't throw (orchestrator already wrote
 *     the evidence; handoff is best-effort).
 */

export interface GtmHandoffContext {
  agent: Doc<"gtmAgents">;
  telegramChatId?: string;
  hookToken?: string;
  hookBaseUrl?: string;
}

export const getHandoffContext = internalQuery({
  args: { agentId: v.id("gtmAgents") },
  handler: async (ctx, args): Promise<GtmHandoffContext | null> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return null;
    return {
      agent,
      telegramChatId: agent.telegramChatId,
      hookToken: agent.hookToken,
      hookBaseUrl: agent.openClawFlyAppId
        ? deriveHookBaseUrl(agent.openClawFlyAppId)
        : undefined,
    };
  },
});

/**
 * SWITCHBOARD INBOUND ROUTER — the scalable shared-bot model.
 *
 * One shared @HeyMaya bot; its webhook points at CONVEX (never at a machine).
 * Convex looks up which agent owns the chat and forwards the user's message to
 * THAT agent's Fly machine as an agent turn. The machine answers via the
 * `send_update` tool → Convex → Telegram (the single outbound pipe). This is the
 * only model that works with a shared bot across many tenants — a per-machine
 * webhook means only the LAST-deployed agent ever receives inbound.
 */
export const getInboundContextByChat = internalQuery({
  args: { chatId: v.string() },
  handler: async (ctx, args): Promise<GtmHandoffContext | null> => {
    const agent = await ctx.db
      .query("gtmAgents")
      .withIndex("by_telegram_chat", (q) => q.eq("telegramChatId", args.chatId))
      .first();
    if (!agent) return null;
    return {
      agent,
      telegramChatId: agent.telegramChatId,
      hookToken: agent.hookToken,
      hookBaseUrl: agent.openClawFlyAppId
        ? deriveHookBaseUrl(agent.openClawFlyAppId)
        : undefined,
    };
  },
});

/**
 * Retry schedule for inbound forwards. A founder's message must NEVER be
 * silently dropped because the machine is mid-boot/redeploy (root-caused live
 * 2026-07-06: messages sent during a deploy window hit a dead hostname and
 * vanished). Machine boots take ~1-2 min; a redeploy up to ~5. Backoff spans
 * ~6.5 min total, then we surface the failure to the founder's activity feed
 * instead of pretending nothing happened.
 */
const INBOUND_RETRY_DELAYS_MS = [30_000, 60_000, 120_000, 180_000];

export const routeInboundToMachine = internalAction({
  args: {
    chatId: v.string(),
    text: v.string(),
    username: v.optional(v.string()),
    attempt: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ status: "ok" | "skipped" | "retrying"; reason: string }> => {
    const attempt = args.attempt ?? 0;
    const ctxRow = await ctx.runQuery(
      internal.gtmMaya.telegramHandoff.getInboundContextByChat,
      { chatId: args.chatId }
    );
    if (!ctxRow) return { status: "skipped", reason: "no agent for this chat" };

    const retryOrGiveUp = async (reason: string): Promise<{
      status: "skipped" | "retrying";
      reason: string;
    }> => {
      if (attempt < INBOUND_RETRY_DELAYS_MS.length) {
        await ctx.scheduler.runAfter(
          INBOUND_RETRY_DELAYS_MS[attempt],
          internal.gtmMaya.telegramHandoff.routeInboundToMachine,
          { ...args, attempt: attempt + 1 }
        );
        return { status: "retrying", reason: `${reason} — retry ${attempt + 1}` };
      }
      // Out of retries — leave a visible trace so the drop is never silent.
      console.warn(
        `[inbound-route] giving up after ${attempt} retries: ${reason}`
      );
      await ctx.runMutation(internal.gtmMaya.missionControl.recordAgentActivity, {
        accountId: ctxRow.agent.accountId,
        agentId: ctxRow.agent._id,
        kind: "status",
        summary:
          "A Telegram message from you couldn't reach Maya's machine — she may have missed it. Say it again and she'll pick it up.",
        detail: reason,
      }).catch(() => {});
      return { status: "skipped", reason };
    };

    if (!ctxRow.hookBaseUrl || !ctxRow.hookToken) {
      // Mid-deploy window: the row exists but the machine isn't addressable
      // yet. Retry — the deploy stamps hookToken/flyApp when the machine is up.
      return await retryOrGiveUp("agent not deployed yet");
    }
    const endpoint: HookEndpoint = {
      baseUrl: ctxRow.hookBaseUrl,
      token: ctxRow.hookToken,
    };
    try {
      // deliver:false — Maya replies via her `send_update` tool (→ Convex →
      // Telegram), the single outbound pipe; we only inject the inbound turn.
      //
      // ENVELOPE (2026-07-06): hook turns run as ISOLATED sessions, and live
      // machines showed them completing "without announcement" — Maya answered
      // in plain turn text (invisible) instead of calling send_update, so the
      // founder saw silence. The contract now rides ON the turn itself instead
      // of relying on whatever workspace context the isolated session loaded.
      const envelope = [
        "INBOUND TELEGRAM DM FROM YOUR FOUNDER (verbatim below).",
        "Non-negotiable: your reply ONLY reaches their phone through the send_update tool. Plain turn text is invisible to them and reads as you ghosting.",
        "Before this turn ends you MUST call send_update with your actual answer (short, in your voice, per SOUL.md). If the work needs time, send_update a one-line ack now and the substance when done.",
        "Also call log_message with their text first, per AGENTS.md.",
        "FOUNDER SAYS:",
        args.text,
      ].join("\n");
      const result = await runAgentTurn(endpoint, {
        message: envelope,
        deliver: false,
        thinking: "medium",
        timeoutSeconds: 90,
      });
      if (!result.ok) {
        console.warn(
          `[inbound-route] runAgentTurn ${result.status}: ${result.error ?? "?"}`
        );
        // 0 = network/unreachable, 5xx = machine unhealthy → both retryable.
        if (result.status === 0 || result.status >= 500) {
          return await retryOrGiveUp(`hook ${result.status}`);
        }
        return { status: "skipped", reason: `hook ${result.status}` };
      }
      return { status: "ok", reason: "forwarded to machine" };
    } catch (err) {
      console.warn(
        `[inbound-route] forward failed: ${(err as Error).message}`
      );
      return await retryOrGiveUp("forward error");
    }
  },
});

export interface ResearchHandoffSummary {
  researchJobId: Id<"gtmResearchJobs">;
  primaryChannel?: string;
  secondaryChannel?: string;
  evidenceCount: number;
  spentUsd: number;
  status: string;
  /** Number of platforms that returned succeeded vs insufficient evidence. */
  succeededPlatformCount: number;
  insufficientPlatformCount: number;
  /** Top 1-3 evidence URLs we cite in the user-facing summary. */
  topEvidenceUrls: string[];
}

function buildHandoffPrompt(summary: ResearchHandoffSummary): string {
  const lines: string[] = [];
  lines.push("RESEARCH COMPLETE — summarize to the user via Telegram now.");
  lines.push("");
  lines.push("State the operator must read (do not invent anything):");
  lines.push(`- Research job: ${summary.researchJobId}`);
  lines.push(`- Status: ${summary.status}`);
  lines.push(`- Evidence cards: ${summary.evidenceCount}`);
  lines.push(`- Spent: $${summary.spentUsd.toFixed(2)}`);
  if (summary.primaryChannel) {
    lines.push(`- Recommended primary channel: ${summary.primaryChannel}`);
  }
  if (summary.secondaryChannel) {
    lines.push(`- Recommended secondary channel: ${summary.secondaryChannel}`);
  }
  lines.push(
    `- Platforms with usable evidence: ${summary.succeededPlatformCount}`
  );
  lines.push(
    `- Platforms with insufficient evidence: ${summary.insufficientPlatformCount}`
  );
  if (summary.topEvidenceUrls.length > 0) {
    lines.push(`- Top evidence URLs: ${summary.topEvidenceUrls.join(", ")}`);
  }
  lines.push("");
  lines.push("Required actions:");
  lines.push(
    "1. READ PLAYBOOK.md § 6 (anti-slop) before drafting. Banned: 'Excited to announce', 'supercharge', emoji-bullet lists, 'game changer'."
  );
  lines.push(
    "2. READ APP.md + GTM.md + the relevant playbook/<platform>.md."
  );
  lines.push(
    "3. Write a 3-sentence Telegram message: (a) what you found, (b) recommended primary channel + 1-sentence why, (c) one specific question for approval."
  );
  lines.push(
    "4. Use the operator's voice — terse, opinion-led, no slop. Cite evidence-card URLs inline if you reference numbers."
  );
  lines.push(
    "5. End with a clear ask: 'reply approve' / 'reply iterate' / 'reply more research'."
  );
  lines.push(
    "6. Do NOT spend ScrapeCreators / Gemini / Composio budget on this turn — synthesis only."
  );
  return lines.join("\n");
}

/**
 * Public entry — orchestrator calls this after runBudgetedResearchJob
 * returns. Always returns ok-shape; handoff is best-effort. Logs
 * failure reasons so operator can debug.
 */
export const handoffResearchToTelegram = internalAction({
  args: {
    agentId: v.id("gtmAgents"),
    summary: v.object({
      researchJobId: v.id("gtmResearchJobs"),
      primaryChannel: v.optional(v.string()),
      secondaryChannel: v.optional(v.string()),
      evidenceCount: v.number(),
      spentUsd: v.number(),
      status: v.string(),
      succeededPlatformCount: v.number(),
      insufficientPlatformCount: v.number(),
      topEvidenceUrls: v.array(v.string()),
    }),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ status: "ok" | "skipped"; reason: string }> => {
    const ctxRow = await ctx.runQuery(
      internal.gtmMaya.telegramHandoff.getHandoffContext,
      { agentId: args.agentId }
    );
    if (!ctxRow) {
      return { status: "skipped", reason: "agent row not found" };
    }
    if (!ctxRow.hookBaseUrl) {
      return {
        status: "skipped",
        reason: "agent not deployed yet (openClawFlyAppId missing)",
      };
    }
    if (!ctxRow.hookToken) {
      return {
        status: "skipped",
        reason: "hookToken missing — Sprint 16 provisioning didn't run",
      };
    }

    const endpoint: HookEndpoint = {
      baseUrl: ctxRow.hookBaseUrl,
      token: ctxRow.hookToken,
    };
    const prompt = buildHandoffPrompt(args.summary);
    const wantsDelivery = Boolean(ctxRow.telegramChatId);

    try {
      const result = await runAgentTurn(endpoint, {
        message: prompt,
        deliver: wantsDelivery,
        channel: wantsDelivery ? "telegram" : undefined,
        to: wantsDelivery ? ctxRow.telegramChatId : undefined,
        thinking: "medium",
        timeoutSeconds: 90,
      });
      if (!result.ok) {
        console.warn(
          `[handoff] runAgentTurn returned ${result.status}: ${result.error ?? "unknown"}`
        );
        return {
          status: "skipped",
          reason: `hook returned ${result.status}: ${result.error ?? "unknown"}`,
        };
      }
      return { status: "ok", reason: "handoff dispatched" };
    } catch (err) {
      console.error("[handoff] threw:", (err as Error).message);
      return {
        status: "skipped",
        reason: `handoff threw: ${(err as Error).message}`,
      };
    }
  },
});

export { buildHandoffPrompt };
