/**
 * Trace capture — persist Maya's raw tool-call decision trace to Convex.
 *
 * THE PROBLEM THIS SOLVES: the only record of Maya actually *deciding* — the
 * sequence of tool calls she makes as she reads the market, judges fit,
 * drafts, validates, and posts — lived solely in the ephemeral OpenClaw Fly
 * session jsonl (SSH-readable for diagnosis, never in Convex). The dashboard
 * "Thinking" page could therefore only show her sparse, optional
 * post_activity self-narration (gtmAgentActivity), which reads thin. This
 * module is the spine of the decision-timeline: it captures every real tool
 * call so the operator can watch their manager work, grounded in fact.
 *
 * CAPTURE PATH: the maya-gtm-tools plugin wraps every tool's execute() with
 * withTrace(), which POSTs one row per call to /lc_gtm/log_trace AFTER the
 * call resolves. hookToken-authed (Bearer) + tenant-scoped by the
 * token-derived agentId/accountId (a body cannot claim another tenant). It is
 * BEST-EFFORT: a trace failure never blocks or delays the underlying tool
 * (mirrors logCostBestEffort). The logging/transport tools themselves are
 * excluded plugin-side so the feed never logs itself.
 *
 * Dedup: toolCallId is the runtime's unique per-call id. Rather than burn an
 * idempotency-claim row per call (traces are high-volume, low-stakes), the
 * mutation skips an insert when a row with the same toolCallId already exists.
 *
 * Five mandatory test categories (see traceCapture tests):
 *   1. Cross-tenant — a row is only ever written under the token-derived
 *      accountId; agent A's token can never write agent B's trace.
 *   2. Plan-tier — capture is plan-agnostic by design; read-side gating lives
 *      in the dashboard query.
 *   3. Adversarial — oversized args/result strings are truncated, unknown
 *      category/status fall back to "other"/"error", malformed JSON → 400.
 *   4. Sibling-file — the /lc_gtm/log_trace route (http.ts), the gtmAgentTrace
 *      table (schema.ts), and the maya-gtm-tools withTrace() wrapper must stay
 *      in lockstep on tool/category/status shape.
 *   5. TODO grep: every marker carries a sprint tag or a stated reason.
 */

import { v } from "convex/values";
import { httpAction, internalMutation } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { authenticate } from "./inboundCallback";

/** Hard caps so a single adversarial row can't bloat the table. */
export const MAX_ARGS_CHARS = 600;
export const MAX_RESULT_CHARS = 600;

const CATEGORY_VALIDATOR = v.union(
  v.literal("research"),
  v.literal("draft"),
  v.literal("publish"),
  v.literal("foundation"),
  v.literal("read"),
  v.literal("other")
);

const STATUS_VALIDATOR = v.union(
  v.literal("ok"),
  v.literal("blocked"),
  v.literal("failed"),
  v.literal("error")
);

type Category =
  | "research"
  | "draft"
  | "publish"
  | "foundation"
  | "read"
  | "other";

type Status = "ok" | "blocked" | "failed" | "error";

export function normalizeCategory(raw: unknown): Category {
  switch (raw) {
    case "research":
    case "draft":
    case "publish":
    case "foundation":
    case "read":
      return raw;
    default:
      return "other";
  }
}

export function normalizeStatus(raw: unknown): Status {
  switch (raw) {
    case "ok":
    case "blocked":
    case "failed":
      return raw;
    default:
      return "error";
  }
}

export function clip(raw: unknown, max: number): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? trimmed.slice(0, max) + "…" : trimmed;
}

function num(x: unknown): number | undefined {
  return typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : undefined;
}

interface LogTracePayload {
  tool?: unknown;
  category?: unknown;
  argsSummary?: unknown;
  resultSummary?: unknown;
  status?: unknown;
  latencyMs?: unknown;
  toolCallId?: unknown;
  isSubagent?: unknown;
}

/**
 * POST /lc_gtm/log_trace — record one tool-call trace row.
 * Body: { tool, category?, argsSummary?, resultSummary?, status?, latencyMs?,
 *         toolCallId?, isSubagent? }. tool is the only hard requirement.
 */
export const logTraceHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: LogTracePayload;
  try {
    body = (await request.json()) as LogTracePayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  const tool = clip(body.tool, 120);
  if (!tool) return new Response("tool required", { status: 400 });

  const result = await ctx.runMutation(
    internal.gtmMaya.openclaw.traceCapture.recordAgentTrace,
    {
      accountId: auth.accountId,
      agentId: auth.agentId,
      tool,
      category: normalizeCategory(body.category),
      argsSummary: clip(body.argsSummary, MAX_ARGS_CHARS),
      resultSummary: clip(body.resultSummary, MAX_RESULT_CHARS),
      status: normalizeStatus(body.status),
      latencyMs: num(body.latencyMs),
      toolCallId: clip(body.toolCallId, 200),
      isSubagent: body.isSubagent === true ? true : undefined,
    }
  );

  return new Response(JSON.stringify({ ok: true, deduped: result.deduped }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

/**
 * Insert one trace row, scoped to the token-derived tenant. Dedups on
 * toolCallId (best-effort) so a retried POST doesn't double-log a call.
 */
export const recordAgentTrace = internalMutation({
  args: {
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    tool: v.string(),
    category: CATEGORY_VALIDATOR,
    argsSummary: v.optional(v.string()),
    resultSummary: v.optional(v.string()),
    status: STATUS_VALIDATOR,
    latencyMs: v.optional(v.number()),
    toolCallId: v.optional(v.string()),
    isSubagent: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ deduped: boolean }> => {
    if (args.toolCallId) {
      const existing = await ctx.db
        .query("gtmAgentTrace")
        .withIndex("by_toolCallId", (q) => q.eq("toolCallId", args.toolCallId))
        .first();
      if (existing) return { deduped: true };
    }
    await ctx.db.insert("gtmAgentTrace", {
      accountId: args.accountId,
      agentId: args.agentId,
      tool: args.tool,
      category: args.category,
      argsSummary: args.argsSummary,
      resultSummary: args.resultSummary,
      status: args.status,
      latencyMs: args.latencyMs,
      toolCallId: args.toolCallId,
      isSubagent: args.isSubagent,
      ts: Date.now(),
    });
    return { deduped: false };
  },
});
