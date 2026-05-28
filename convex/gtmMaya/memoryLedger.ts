/**
 * Sprint 2.29 — Maya's memory write ledger.
 *
 * Maya writes to her workspace files on Fly disk natively (filesystem
 * tool, no Convex hop). After each successful write she POSTs to
 * /lc_gtm/memory_written so Convex captures:
 *   - When the write happened
 *   - What file got touched (daily / dreams / index)
 *   - What section / op (append / replace / strike)
 *   - A short human-readable summary the operator UI can render
 *
 * This is NOT the content store — content lives on Fly. This is the
 * audit trail. Operator HQ surfaces it as "Maya updated memory at
 * 7:02am: 2 new hypotheses, 1 retired".
 *
 * Auth: hookToken via inboundCallback.authenticate().
 * Idempotency: idempotencyKey in gtmHookCallbacks; same uuid resolves
 * to the same row.
 */

import { v } from "convex/values";
import { httpAction, internalMutation, internalQuery } from "../_generated/server";
import { authenticate } from "./openclaw/inboundCallback";
import { internal } from "../_generated/api";

const TARGETS = ["daily_memory", "dreams", "memory_index"] as const;
type Target = (typeof TARGETS)[number];

const OPS = ["append", "replace_section", "strike"] as const;
type Op = (typeof OPS)[number];

function isTarget(s: unknown): s is Target {
  return typeof s === "string" && (TARGETS as readonly string[]).includes(s);
}

function isOp(s: unknown): s is Op {
  return typeof s === "string" && (OPS as readonly string[]).includes(s);
}

/**
 * Internal mutation — central write helper. Idempotent on
 * idempotencyKey (matches gtmHookCallbacks pattern).
 */
export const recordMemoryWriteInternal = internalMutation({
  args: {
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    idempotencyKey: v.string(),
    target: v.union(
      v.literal("daily_memory"),
      v.literal("dreams"),
      v.literal("memory_index")
    ),
    dateSlot: v.optional(v.string()),
    op: v.union(
      v.literal("append"),
      v.literal("replace_section"),
      v.literal("strike")
    ),
    section: v.optional(v.string()),
    bytes: v.optional(v.number()),
    summary: v.optional(v.string()),
    triggeredBy: v.string(),
    writtenAt: v.number(),
  },
  handler: async (ctx, args) => {
    // Idempotency check.
    const existing = await ctx.db
      .query("gtmHookCallbacks")
      .withIndex("by_idempotency_key", (q) =>
        q.eq("idempotencyKey", args.idempotencyKey)
      )
      .unique();

    if (existing) {
      // Find the corresponding gtmMemoryWrites row (if any) and return.
      const dup = await ctx.db
        .query("gtmMemoryWrites")
        .withIndex("by_idempotency", (q) =>
          q.eq("idempotencyKey", args.idempotencyKey)
        )
        .unique();
      return { rowId: dup?._id ?? null, deduped: true as const };
    }

    const now = Date.now();
    const rowId = await ctx.db.insert("gtmMemoryWrites", {
      accountId: args.accountId,
      agentId: args.agentId,
      idempotencyKey: args.idempotencyKey,
      target: args.target,
      dateSlot: args.dateSlot,
      op: args.op,
      section: args.section,
      bytes: args.bytes,
      summary: args.summary,
      triggeredBy: args.triggeredBy,
      writtenAt: args.writtenAt,
      createdAt: now,
    });

    await ctx.db.insert("gtmHookCallbacks", {
      accountId: args.accountId,
      agentId: args.agentId,
      kind: "memory_written",
      idempotencyKey: args.idempotencyKey,
      receivedAt: now,
    });

    return { rowId, deduped: false as const };
  },
});

export const listMyMemoryWrites = internalQuery({
  args: {
    agentId: v.id("gtmAgents"),
    sinceMs: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    let q = ctx.db
      .query("gtmMemoryWrites")
      .withIndex("by_agent_and_written", (qq) => qq.eq("agentId", args.agentId))
      .order("desc");
    const rows = await q.take(limit);
    if (args.sinceMs == null) return rows;
    return rows.filter((r) => r.writtenAt >= args.sinceMs!);
  },
});

/**
 * HTTP action — POST /lc_gtm/memory_written
 *
 * Body:
 *   {
 *     idempotencyKey: string,                 // uuid
 *     target: "daily_memory" | "dreams" | "memory_index",
 *     dateSlot?: string,                       // YYYY-MM-DD when target=daily_memory
 *     op: "append" | "replace_section" | "strike",
 *     section?: string,                        // e.g. "Open hypotheses"
 *     bytes?: number,
 *     summary?: string,
 *     triggeredBy: string                      // skill that initiated the write
 *   }
 *
 * Validation is intentionally relaxed (Maya is the only caller; she
 * authed via hookToken). Bad body → 200 ok:false reason:invalid_body.
 */
export const memoryWrittenHttp = httpAction(async (ctx, req) => {
  const auth = await authenticate(ctx, req);
  if (!auth.ok) {
    return new Response(
      JSON.stringify({ ok: false, reason: "unauthorized" }),
      { status: 401, headers: { "content-type": "application/json" } }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return new Response(
      JSON.stringify({ ok: false, reason: "invalid_json" }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey : null;
  const target = body.target;
  const op = body.op;
  const triggeredBy = typeof body.triggeredBy === "string" ? body.triggeredBy : null;

  if (!idempotencyKey || !isTarget(target) || !isOp(op) || !triggeredBy) {
    return new Response(
      JSON.stringify({
        ok: false,
        reason: "invalid_body",
        details: {
          missing: [
            !idempotencyKey && "idempotencyKey",
            !isTarget(target) && "target",
            !isOp(op) && "op",
            !triggeredBy && "triggeredBy",
          ].filter(Boolean),
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  const result = await ctx.runMutation(
    internal.gtmMaya.memoryLedger.recordMemoryWriteInternal,
    {
      accountId: auth.accountId,
      agentId: auth.agentId,
      idempotencyKey,
      target,
      dateSlot:
        typeof body.dateSlot === "string" ? body.dateSlot : undefined,
      op,
      section: typeof body.section === "string" ? body.section : undefined,
      bytes: typeof body.bytes === "number" ? body.bytes : undefined,
      summary: typeof body.summary === "string" ? body.summary : undefined,
      triggeredBy,
      writtenAt: Date.now(),
    }
  );

  return new Response(
    JSON.stringify({
      ok: true,
      rowId: result.rowId,
      deduped: result.deduped,
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
});
