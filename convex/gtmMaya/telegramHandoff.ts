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
