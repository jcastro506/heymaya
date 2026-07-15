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
  runMainSessionChat,
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
  /** PR 1 — gateway auth token (distinct from hookToken by runtime rule);
   * authenticates the OpenAI-compatible chat endpoint for main-session DMs. */
  gatewayToken?: string;
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
      gatewayToken: agent.gatewayToken,
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
    // Deletion guard (2026-07-06 audit): a chat still bound to a deleted
    // account's agent (purge in flight, or a failed teardown) must route
    // NOWHERE — not to a machine that may still be running. Fail closed.
    const creator = await ctx.db.get(agent.accountId);
    if (!creator || creator.status === "deleted") return null;
    return {
      agent,
      telegramChatId: agent.telegramChatId,
      hookToken: agent.hookToken,
      gatewayToken: agent.gatewayToken,
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
    /** Threaded through retries so the founder row persists exactly once and
     * the eventual reply pairs with it. Minted on attempt 0. */
    turnId: v.optional(v.string()),
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

    // PR 1 (ARCHITECTURE_OPENCLAW_NATIVE §2) — the founder's DM runs in
    // Maya's ONE durable `agent:main:main` session and her reply is the
    // turn's own final text. No envelope contract, no send_update/log_message
    // choreography, no turnId discipline demanded of the model: Convex owns
    // the transcript on both sides (channel known server-side — the old
    // channel:"unknown" rows die here) and the delivery (leak firewall inside
    // sendDirectTelegramMessage). The old /hooks/agent path ran every message
    // as an ISOLATED session — total conversation amnesia, live 2026-07-15.
    const turnId = args.turnId ?? `chat-${crypto.randomUUID()}`;

    if (attempt === 0) {
      // Transcript truth: the founder's message is recorded even if the
      // machine turns out to be unreachable. Retries skip the insert.
      await ctx.runMutation(
        internal.gtmMaya.openclaw.conversationCapture.persistMayaMessage,
        {
          accountId: ctxRow.agent.accountId,
          agentId: ctxRow.agent._id,
          role: "user",
          body: args.text,
          channel: "telegram",
          turnId,
        }
      );
      // Steering capture — was a side effect of the agent's log_message
      // call on the old path; now runs server-side on the same hot path.
      // Best-effort: a classifier hiccup must never drop the message.
      try {
        const { classifySteeringIntent } = await import("./steering");
        const cls = classifySteeringIntent(args.text);
        if (cls.isSteering) {
          await ctx.runMutation(
            internal.gtmMaya.steering.saveSteeringDirective,
            {
              accountId: ctxRow.agent.accountId,
              agentId: ctxRow.agent._id,
              directive: args.text.slice(0, 2000),
              laneHints: cls.laneHints,
              intent: cls.intent,
              source: "founder",
              turnId,
            }
          );
        }
      } catch (err) {
        console.error(
          `[inbound-route] steering capture failed: ${(err as Error).message}`
        );
      }
    }

    const retryOrGiveUp = async (reason: string): Promise<{
      status: "skipped" | "retrying";
      reason: string;
    }> => {
      if (attempt < INBOUND_RETRY_DELAYS_MS.length) {
        await ctx.scheduler.runAfter(
          INBOUND_RETRY_DELAYS_MS[attempt],
          internal.gtmMaya.telegramHandoff.routeInboundToMachine,
          { ...args, turnId, attempt: attempt + 1 }
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

    if (!ctxRow.hookBaseUrl || !ctxRow.gatewayToken) {
      // Mid-deploy window: the row exists but the machine isn't addressable
      // yet (or predates gateway-token provisioning). Retry — the deploy
      // stamps gatewayToken/flyApp when the machine is up.
      return await retryOrGiveUp("agent not deployed yet");
    }
    const endpoint: HookEndpoint = {
      baseUrl: ctxRow.hookBaseUrl,
      // The GATEWAY token, not hookToken — the runtime requires them to be
      // distinct, and only the gateway token authenticates /v1/*.
      token: ctxRow.gatewayToken,
    };

    const result = await runMainSessionChat(endpoint, { text: args.text });
    if (!result.ok) {
      if (result.timedOut) {
        // The turn may STILL be running on the machine — a retry would
        // re-inject the founder's text into her session as a duplicate.
        // Surface instead of retrying; steer-mode means a follow-up DM from
        // the founder lands in the same (possibly still-active) session.
        console.warn(
          `[inbound-route] chat turn timed out (may still complete): ${result.error}`
        );
        await ctx.runMutation(
          internal.gtmMaya.missionControl.recordAgentActivity,
          {
            accountId: ctxRow.agent.accountId,
            agentId: ctxRow.agent._id,
            kind: "status",
            summary:
              "Maya is taking unusually long on your last message — nudge her again if you don't hear back.",
            detail: "chat turn timeout",
          }
        ).catch(() => {});
        return { status: "skipped", reason: "chat turn timeout" };
      }
      console.warn(
        `[inbound-route] chat ${result.status}: ${result.error ?? "?"}`
      );
      // 0 = network/unreachable, 5xx = machine unhealthy → both retryable.
      if (result.status === 0 || result.status >= 500) {
        return await retryOrGiveUp(`chat ${result.status}`);
      }
      return { status: "skipped", reason: `chat ${result.status}` };
    }

    const reply = (result.text ?? "").trim();
    // Silent-turn sentinels — nothing founder-worthy came out of the turn.
    if (!reply || reply === "NO_REPLY" || reply === "HEARTBEAT_OK") {
      return { status: "ok", reason: "turn completed silently" };
    }

    // Deliver through the shared-bot pipe. sendDirectTelegramMessage runs the
    // private-DM leak firewall (sanitize-and-log; block only true leak
    // categories) before the Bot API call — same guarantees as send_update.
    const { resolveBotForAgent } = await import("./telegramBotPerTenant");
    const bot = await resolveBotForAgent(
      ctx as { runQuery: <T>(ref: unknown, a: unknown) => Promise<T> },
      ctxRow.agent._id,
      {
        sharedToken: process.env.TELEGRAM_BOT_TOKEN,
        sharedUsername: process.env.TELEGRAM_BOT_USERNAME,
      }
    );
    const { sendDirectTelegramMessage } = await import(
      "../integrations/telegram/sendDirectMessage"
    );
    const sent = await sendDirectTelegramMessage({
      botToken: bot.token ?? undefined,
      chatId: args.chatId,
      text: reply,
    });
    // Transcript row regardless of Telegram outcome (matches send_update).
    await ctx.runMutation(
      internal.gtmMaya.openclaw.conversationCapture.persistMayaMessage,
      {
        accountId: ctxRow.agent.accountId,
        agentId: ctxRow.agent._id,
        role: "maya",
        body: reply,
        channel: "telegram",
        turnId,
      }
    ).catch((err) => {
      console.error(
        `[inbound-route] reply transcript write failed: ${(err as Error).message}`
      );
    });
    if (!sent.ok) {
      console.warn(`[inbound-route] reply send failed: ${sent.reason}`);
      return { status: "skipped", reason: `reply send failed: ${sent.reason}` };
    }
    return { status: "ok", reason: "replied in main session" };
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
  // LIFECYCLE_MESSAGING_V1 — the summary is DELIVERED via send_update (the
  // one guarded pipe: firewall + exactly-once synthesis claim + transcript),
  // never via the native announce. Plain turn text is invisible to the user.
  lines.push(
    "RESEARCH COMPLETE — compose the summary and deliver it via the send_update tool (messageClass: 'strategic'). Your plain turn text is NOT delivered; only send_update reaches the user."
  );
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

    try {
      // LIFECYCLE_MESSAGING_V1 — deliver:false (was PIPE B: native announce
      // bypassed the firewall, the exactly-once synthesis claim, and the
      // transcript). The prompt instructs delivery via send_update instead.
      const result = await runAgentTurn(endpoint, {
        message: prompt,
        deliver: false,
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
