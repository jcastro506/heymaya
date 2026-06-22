/**
 * LLM metering gateway — the synchronous cost spine (Phase: real-time-operator
 * "principle #2", retrofitted UNDER OpenClaw, which is unchanged).
 *
 * OpenClaw is configured to send its `openrouter/<slug>` calls here instead of
 * straight to OpenRouter (we repoint its provider base URL at deploy; see
 * deployMayaGtm). On every call we:
 *
 *   1. AUTH by the per-agent hookToken → agentId. (Bonus: the raw OpenRouter
 *      key never ships to a tenant machine — it lives only here, server-side.)
 *   2. PRE-FLIGHT BUDGET — sum the agent's real LLM spend over the last 24h
 *      (the gateway's own ledger rows — authoritative, no poll, no blind gap)
 *      and refuse with 402 when it's at/over the daily cap. OpenClaw sees an
 *      error and backs off — we degrade gracefully instead of letting it run
 *      and destroying the machine after the fact.
 *   3. FORWARD to OpenRouter with `usage:{include:true}` so the response carries
 *      the REAL cost, and `stream:false` (Maya's turns are background → whole
 *      messages, not live token streams, so non-streaming keeps this a simple
 *      request→response within httpAction limits).
 *   4. METER — read `usage.cost` from the response and write the ledger row
 *      SYNCHRONOUSLY (before returning). Spend is known per-call, per-agent, in
 *      real time. This retires the 20-min OpenRouter poll + the blind-ledger
 *      kill-switch hack for gateway-routed agents.
 *
 * NOTE (scaling): authenticate() table-scans agents per call (O(N)); fine at
 * the current agent count, index the token later if N grows. The budget sum is
 * indexed (by_account_and_created), so it's cheap.
 */
import { httpAction, internalMutation, internalQuery } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { v } from "convex/values";
import type { Id } from "../../_generated/dataModel";
import { authenticate } from "./inboundCallback";
import { agentKillDailyUsd } from "../spendKill";

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const DAY_MS = 24 * 60 * 60 * 1000;

function jsonError(message: string, status: number): Response {
  return new Response(
    JSON.stringify({ error: { message, code: status } }),
    { status, headers: { "content-type": "application/json" } }
  );
}

/** Sum the agent account's real gateway LLM spend over the last 24h + the cap. */
export const peekGatewayBudget = internalQuery({
  args: { accountId: v.id("creators"), agentId: v.id("gtmAgents") },
  handler: async (
    ctx,
    args
  ): Promise<{ spentUsd: number; capUsd: number }> => {
    const since = Date.now() - DAY_MS;
    const rows = await ctx.db
      .query("gtmCostLedger")
      .withIndex("by_account_and_created", (q) =>
        q.eq("accountId", args.accountId).gte("createdAt", since)
      )
      .collect();
    const spentUsd = rows.reduce<number>(
      (sum, r) => (r.operation === "llm_gateway" ? sum + r.costUsd : sum),
      0
    );
    const agent = await ctx.db.get(args.agentId);
    const capUsd = agent?.spendKillCapUsd ?? agentKillDailyUsd();
    return { spentUsd, capUsd };
  },
});

/** Write one gateway LLM-call cost row. Synchronous — awaited before the
 *  gateway returns the model's response, so spend is never lost. */
export const recordGatewaySpend = internalMutation({
  args: {
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    model: v.string(),
    costUsd: v.number(),
    promptTokens: v.number(),
    completionTokens: v.number(),
    upstreamStatus: v.number(),
  },
  handler: async (ctx, args): Promise<void> => {
    await ctx.db.insert("gtmCostLedger", {
      accountId: args.accountId,
      provider: "openrouter",
      operation: "llm_gateway",
      reason: `llm ${args.model} (${args.promptTokens}+${args.completionTokens} tok, http ${args.upstreamStatus})`,
      costUsd: args.costUsd,
      units: args.promptTokens + args.completionTokens,
      cacheStatus: args.upstreamStatus >= 200 && args.upstreamStatus < 300 ? "called" : "failed",
      metadata: {
        model: args.model,
        promptTokens: args.promptTokens,
        completionTokens: args.completionTokens,
        agentId: args.agentId,
        gateway: true,
      },
      createdAt: Date.now(),
    });
  },
});

/**
 * OpenAI-compatible `/chat/completions` proxy. OpenClaw points its OpenRouter
 * base URL here; this forwards to the real OpenRouter, meters, and returns.
 */
export const llmGatewayHttp = httpAction(async (ctx, request) => {
  // 1. Auth (per-agent hookToken). The machine presents its hookToken as the
  //    bearer — so it never needs the real OpenRouter key.
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return jsonError(auth.reason, auth.status);

  // 2. Parse the OpenAI-compatible request.
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonError("invalid JSON body", 400);
  }

  // 3. Pre-flight budget gate — the real, synchronous ledger. Over → 402 so
  //    OpenClaw degrades (backs off) instead of us reaping the machine later.
  const budget = await ctx.runQuery(
    internal.gtmMaya.openclaw.llmGateway.peekGatewayBudget,
    { accountId: auth.accountId, agentId: auth.agentId }
  );
  if (budget.spentUsd >= budget.capUsd) {
    console.warn(
      JSON.stringify({
        event: "llm_gateway.budget_exceeded",
        agentId: auth.agentId,
        spentUsd: budget.spentUsd,
        capUsd: budget.capUsd,
      })
    );
    return jsonError(
      `daily LLM budget reached ($${budget.spentUsd.toFixed(2)} of $${budget.capUsd.toFixed(2)})`,
      402
    );
  }

  const orKey = process.env.OPENROUTER_API_KEY;
  if (!orKey) return jsonError("gateway misconfigured: no upstream key", 500);

  // 4. Forward to the real OpenRouter — force non-streaming + ask for the real
  //    cost in the usage block (the authoritative number, no pricing-map drift).
  const upstreamBody = { ...body, stream: false, usage: { include: true } };
  let upstream: Response;
  try {
    upstream = await fetch(OPENROUTER_CHAT_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${orKey}`,
        "HTTP-Referer": "https://hey-maya.ai",
        "X-Title": "HeyMaya",
      },
      body: JSON.stringify(upstreamBody),
    });
  } catch {
    return jsonError("upstream request failed", 502);
  }

  const text = await upstream.text();

  // 5. Meter — pull the real cost + tokens, write the ledger row synchronously.
  let costUsd = 0;
  let model = typeof body.model === "string" ? body.model : "unknown";
  let promptTokens = 0;
  let completionTokens = 0;
  try {
    const parsed = JSON.parse(text) as {
      model?: string;
      usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number };
    };
    if (parsed.model) model = parsed.model;
    const u = parsed.usage ?? {};
    if (typeof u.cost === "number") costUsd = u.cost;
    if (typeof u.prompt_tokens === "number") promptTokens = u.prompt_tokens;
    if (typeof u.completion_tokens === "number") completionTokens = u.completion_tokens;
  } catch {
    // Non-JSON (an upstream error body) — record a zero-cost failed row below.
  }

  await ctx.runMutation(
    internal.gtmMaya.openclaw.llmGateway.recordGatewaySpend,
    {
      accountId: auth.accountId,
      agentId: auth.agentId,
      model,
      costUsd,
      promptTokens,
      completionTokens,
      upstreamStatus: upstream.status,
    }
  );

  return new Response(text, {
    status: upstream.status,
    headers: { "content-type": "application/json" },
  });
});
