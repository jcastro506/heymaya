/**
 * Conversation capture — persist every user↔Maya turn to Convex.
 *
 * THE PROBLEM THIS SOLVES: before this module, inbound user messages lived
 * only on the ephemeral OpenClaw Fly machine, and Maya's replies went
 * straight to Telegram via the Bot API. Neither reached Convex, so the
 * conversation transcript was unrecoverable — we could count that a turn
 * happened (`usageEvents`) but never read what was actually said. This is
 * the spine of the data-collection sprint: capturing content is the
 * prerequisite for the quality grader (Wave 4) and any "make Maya better"
 * loop.
 *
 * TWO CAPTURE PATHS, both hookToken-authed (Bearer), both tenant-scoped by
 * the token-derived agentId/accountId (bodies cannot claim another tenant):
 *   - role:"maya" — written inline from /lc_gtm/send_update after a
 *     successful Telegram send (see inboundCallback.ts sendUpdateHttp).
 *   - role:"user" — written from /lc_gtm/log_message (this file), which
 *     Maya's runtime calls as the FIRST action of every inbound turn.
 *
 * Idempotency: the inbound path reuses the gtmHookCallbacks claim pattern
 * (kind:"log_message") so a retried turn does not double-log.
 *
 * Five mandatory test categories (see conversationCapture tests):
 *   1. Cross-tenant — a row is only ever written under the token-derived
 *      accountId; agent A's token can never write agent B's transcript.
 *   2. Plan-tier — capture is plan-agnostic by design (we want to see what
 *      every tier says); read-side gating lives in the dashboard queries.
 *   3. Adversarial — oversized bodies are truncated (MAX_BODY_CHARS),
 *      empty bodies rejected, malformed JSON → 400.
 *   4. Sibling-file — the /lc_gtm/log_message route (http.ts), the
 *      gtmHookCallbacks "log_message" kind (schema.ts), the CALLBACK_KIND
 *      validator (inboundCallback.ts), and the maya-gtm-tools log_message
 *      typed tool must all stay in lockstep.
 *   5. TODO grep — no unjustified TODOs.
 */

import { v } from "convex/values";
import { httpAction } from "../../_generated/server";
import { internalMutation, internalQuery } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { recordChatTurnInline } from "../../lib/usageEvents";
import { authenticate } from "./inboundCallback";
import { captureAiGeneration } from "../../lib/posthog";

/**
 * Hard cap on stored body length. Telegram messages top out at 4096 chars;
 * Maya progress updates are capped at 1500 upstream. 8000 leaves headroom
 * for multi-part web-chat turns while bounding a single adversarial row.
 */
export const MAX_BODY_CHARS = 8000;

const CHANNEL_VALIDATOR = v.union(
  v.literal("telegram"),
  v.literal("claw-messenger"),
  v.literal("sms"),
  v.literal("web"),
  v.literal("unknown")
);

type Channel =
  | "telegram"
  | "claw-messenger"
  | "sms"
  | "web"
  | "unknown";

function normalizeChannel(raw: unknown): Channel {
  switch (raw) {
    case "telegram":
    case "claw-messenger":
    case "sms":
    case "web":
      return raw;
    default:
      return "unknown";
  }
}

/**
 * Persist one transcript row + fire the matching usage event inline (so the
 * engagement scoreboard stays accurate). Internal — both capture paths
 * (send_update inline, log_message HTTP) runMutation into this.
 *
 * The mutation never reads cross-tenant state: it inserts under the
 * caller-resolved accountId/agentId only.
 */
export const persistMayaMessage = internalMutation({
  args: {
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    role: v.union(v.literal("user"), v.literal("maya")),
    body: v.string(),
    channel: CHANNEL_VALIDATOR,
    turnId: v.string(),
    ts: v.optional(v.number()),
    messageClass: v.optional(v.string()),
    criticPassed: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<Id<"mayaMessages">> => {
    const ts = args.ts ?? Date.now();
    // Defensive truncation — the HTTP layer also guards, but a direct
    // internal caller could pass an unbounded body.
    const body =
      args.body.length > MAX_BODY_CHARS
        ? args.body.slice(0, MAX_BODY_CHARS)
        : args.body;

    const messageId = await ctx.db.insert("mayaMessages", {
      accountId: args.accountId,
      agentId: args.agentId,
      role: args.role,
      body,
      channel: args.channel,
      turnId: args.turnId,
      ts,
      messageClass: args.messageClass,
      criticPassed: args.criticPassed,
    });

    // Engagement scoreboard: inbound bumps lastEngagedAt, outbound does not.
    // accountId === Id<"creators"> for GTM agents, so it feeds directly.
    await recordChatTurnInline(ctx, {
      creatorId: args.accountId,
      direction: args.role === "user" ? "in" : "out",
      label: args.role === "user" ? "unclassified" : undefined,
      meta: { turnId: args.turnId, channel: args.channel, messageId },
      ts,
    });

    return messageId;
  },
});

/**
 * Wave 2 — per-turn LLM telemetry. Patches the maya-role transcript row for
 * a turn with the model usage that produced it (tokens / latency / cost /
 * thinking budget), and mirrors the spend into gtmCostLedger so the founder
 * dashboard can roll up cost-per-user. Token usage only exists inside the
 * agent runtime, so it is agent-emitted (same trust model as log_cost).
 *
 * Joins by turnId: we patch the MOST RECENT maya row for the turn (a turn
 * can produce multiple sends; the telemetry attaches to the latest). If no
 * maya row exists yet (telemetry raced ahead of send_update), we still
 * record the cost-ledger row — the spend is real even if the transcript
 * row is a beat behind.
 */
export const recordTurnTelemetry = internalMutation({
  args: {
    accountId: v.id("creators"),
    turnId: v.string(),
    model: v.optional(v.string()),
    tokensIn: v.optional(v.number()),
    tokensOut: v.optional(v.number()),
    cacheReadTokens: v.optional(v.number()),
    latencyMs: v.optional(v.number()),
    costUsd: v.optional(v.number()),
    thinkingBudget: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ patched: boolean }> => {
    // Find the most-recent maya row for this turn, scoped to the caller's
    // account (cross-tenant defense: never patch another account's row).
    const rows = await ctx.db
      .query("mayaMessages")
      .withIndex("by_turn", (q) => q.eq("turnId", args.turnId))
      .collect();
    const mayaRows = rows
      .filter((r) => r.accountId === args.accountId && r.role === "maya")
      .sort((a, b) => b.ts - a.ts);

    let patched = false;
    if (mayaRows.length > 0) {
      await ctx.db.patch(mayaRows[0]._id, {
        model: args.model,
        tokensIn: args.tokensIn,
        tokensOut: args.tokensOut,
        cacheReadTokens: args.cacheReadTokens,
        latencyMs: args.latencyMs,
        costUsd: args.costUsd,
        thinkingBudget: args.thinkingBudget,
      });
      patched = true;
    }

    // Mirror spend into the aggregate cost ledger (founder cost-per-user).
    if (typeof args.costUsd === "number" && args.costUsd >= 0) {
      const units =
        (args.tokensIn ?? 0) + (args.tokensOut ?? 0) || undefined;
      await ctx.db.insert("gtmCostLedger", {
        accountId: args.accountId,
        provider: "openrouter",
        operation: "turn_completion",
        reason: "maya conversation turn",
        costUsd: args.costUsd,
        units,
        cacheStatus: (args.cacheReadTokens ?? 0) > 0 ? "hit" : "called",
        metadata: {
          turnId: args.turnId,
          model: args.model,
          tokensIn: args.tokensIn,
          tokensOut: args.tokensOut,
          latencyMs: args.latencyMs,
        },
        createdAt: Date.now(),
      });
    }

    return { patched };
  },
});

/** Resolve the Clerk user id for an account so server events stitch onto the
 *  same PostHog person the browser SDK identifies. */
export const getAccountDistinctId = internalQuery({
  args: { accountId: v.id("creators") },
  handler: async (ctx, args): Promise<string> => {
    const creator = await ctx.db.get(args.accountId);
    return creator?.clerkUserId ?? `account:${args.accountId}`;
  },
});

interface LogMessagePayload {
  idempotencyKey?: string;
  turnId?: string;
  body?: string;
  channel?: string;
}

interface LogTurnTelemetryPayload {
  idempotencyKey?: string;
  turnId?: string;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  cacheReadTokens?: number;
  latencyMs?: number;
  costUsd?: number;
  thinkingBudget?: number;
}

/**
 * POST /lc_gtm/log_message — inbound user-turn capture.
 *
 * Maya's runtime calls this as the first action of every inbound turn,
 * passing { idempotencyKey, turnId, body, channel, role:"user" implied }.
 * The role is always "user" here — Maya's own replies are captured inline
 * by send_update, never through this endpoint.
 */
export const logMessageHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: LogMessagePayload;
  try {
    body = (await request.json()) as LogMessagePayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }

  if (typeof body.idempotencyKey !== "string" || !body.idempotencyKey) {
    return new Response("idempotencyKey required", { status: 400 });
  }
  if (typeof body.turnId !== "string" || !body.turnId) {
    return new Response("turnId required", { status: 400 });
  }
  if (typeof body.body !== "string" || body.body.length === 0) {
    return new Response("body required", { status: 400 });
  }

  // Idempotency claim — reuse the shared gtmHookCallbacks pattern. A retried
  // POST with the same key is a no-op (returns ok without a second row).
  const claim = await ctx.runMutation(
    internal.gtmMaya.openclaw.inboundCallback.claimIdempotencyKey,
    {
      agentId: auth.agentId,
      accountId: auth.accountId,
      kind: "log_message",
      idempotencyKey: body.idempotencyKey,
    }
  );
  if (claim === "duplicate") {
    return new Response(JSON.stringify({ ok: true, deduped: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  const messageId = await ctx.runMutation(
    internal.gtmMaya.openclaw.conversationCapture.persistMayaMessage,
    {
      accountId: auth.accountId,
      agentId: auth.agentId,
      role: "user",
      body: body.body.slice(0, MAX_BODY_CHARS),
      channel: normalizeChannel(body.channel),
      turnId: body.turnId,
    }
  );

  return new Response(JSON.stringify({ ok: true, messageId }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

/**
 * POST /lc_gtm/log_turn_telemetry — Wave 2 per-turn LLM telemetry.
 *
 * Maya's runtime calls this after a turn completes, passing the same turnId
 * she used for log_message/send_update plus the model usage stats. Numeric
 * fields are clamped to non-negative; a NaN/garbage value is dropped rather
 * than stored.
 */
export const logTurnTelemetryHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: LogTurnTelemetryPayload;
  try {
    body = (await request.json()) as LogTurnTelemetryPayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (typeof body.idempotencyKey !== "string" || !body.idempotencyKey) {
    return new Response("idempotencyKey required", { status: 400 });
  }
  if (typeof body.turnId !== "string" || !body.turnId) {
    return new Response("turnId required", { status: 400 });
  }

  // Drop non-finite / negative numerics instead of persisting garbage.
  const num = (x: unknown): number | undefined =>
    typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : undefined;

  const claim = await ctx.runMutation(
    internal.gtmMaya.openclaw.inboundCallback.claimIdempotencyKey,
    {
      agentId: auth.agentId,
      accountId: auth.accountId,
      kind: "log_message",
      idempotencyKey: body.idempotencyKey,
    }
  );
  if (claim === "duplicate") {
    return new Response(JSON.stringify({ ok: true, deduped: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  const result = await ctx.runMutation(
    internal.gtmMaya.openclaw.conversationCapture.recordTurnTelemetry,
    {
      accountId: auth.accountId,
      turnId: body.turnId,
      model: typeof body.model === "string" ? body.model : undefined,
      tokensIn: num(body.tokensIn),
      tokensOut: num(body.tokensOut),
      cacheReadTokens: num(body.cacheReadTokens),
      latencyMs: num(body.latencyMs),
      costUsd: num(body.costUsd),
      thinkingBudget: num(body.thinkingBudget),
    }
  );

  // Native LLM observability in PostHog ($ai_generation). Best-effort; never
  // blocks the response. distinctId = the account's Clerk id so it stitches
  // onto the same person the browser SDK identifies.
  const distinctId = await ctx.runQuery(
    internal.gtmMaya.openclaw.conversationCapture.getAccountDistinctId,
    { accountId: auth.accountId }
  );
  await captureAiGeneration({
    distinctId,
    turnId: body.turnId,
    model: typeof body.model === "string" ? body.model : undefined,
    tokensIn: num(body.tokensIn),
    tokensOut: num(body.tokensOut),
    latencyMs: num(body.latencyMs),
    costUsd: num(body.costUsd),
    accountId: auth.accountId,
  });

  return new Response(JSON.stringify({ ok: true, patched: result.patched }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});
