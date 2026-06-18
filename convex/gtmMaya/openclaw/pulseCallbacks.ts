/**
 * Real-time operator — discovery-PULSE typed-tool endpoints.
 *
 * Phase 2 built the engine internals (discoveryBudgetGate + watermarks); Phase 3
 * (this file) exposes them to Maya as typed OpenClaw tools so the discovery-pulse
 * cron can drive the loop without hand-written curl. Every endpoint mirrors the
 * `save_steering_directive` pattern exactly: bearer `authenticate(ctx, request)`
 * (yields `auth.accountId` + `auth.agentId`), idempotency-claim on the WRITE
 * endpoints, then a call into the already-built internal fn. Reads skip the
 * claim (idempotent by construction).
 *
 *   - `check_discovery_budget` (read) → THE pulse gate. Resolves the agent's
 *     plan tier and reports whether NEW discovery reads are allowed right now;
 *     `mode === "monitoring_only"` means the pulse must do nothing.
 *   - `next_watch_lane` (write — advances rotation) → picks the most-due watch
 *     lane and marks it touched so the round-robin advances.
 *   - `advance_watermark` (write) → persists a channel's read position so the
 *     next pulse bounds its read to only new items.
 *   - `get_watermark` (read) → reads a channel's current position so the pulse
 *     can bound a read before it runs.
 *
 * Five mandatory test categories apply (the internal fns own most of the
 * coverage): cross-tenant rows are written/read only under the resolved
 * accountId; plan-tier is resolved server-side via gatingTierForAgent (fail-
 * closed to the $0.10 floor on a none-status plan); adversarial inputs are
 * rejected at the body-validation step; sibling-file lockstep keeps the
 * CALLBACK_KIND union (inboundCallback.ts), the schema gtmHookCallbacks.kind
 * union (schema.ts), the http routes (http.ts), and the maya-gtm-tools typed
 * tools in sync; no unjustified TODOs.
 */

import { v } from "convex/values";
import { httpAction, internalQuery } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Doc } from "../../_generated/dataModel";
import { gatingTierForAgent } from "../discoveryBudgetGate";

/**
 * Read the gating plan tier for an agent from its `gtmPlanJson`. Internal —
 * the bearer auth already validated the caller owns this agent. Keeps the
 * pulse gate's tier resolution server-side (never trusts a client-supplied
 * tier). Returns `null` for the fail-closed (status "none") default so the
 * budget check applies the $0.10/day floor.
 */
export const resolveAgentGatingTier = internalQuery({
  args: { agentId: v.id("gtmAgents") },
  handler: async (
    ctx,
    args
  ): Promise<"starter" | "growth" | "studio" | null> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return null;
    return gatingTierForAgent({ gtmPlanJson: agent.gtmPlanJson });
  },
});

/**
 * POST /lc_gtm/check_discovery_budget — `check_discovery_budget` typed tool.
 *
 * THE pulse gate. Resolves the agent's plan tier server-side, then runs the
 * SOFT discovery-budget check for this account. Read-only: no idempotency
 * claim. Returns the verdict JSON
 * `{ allowed, mode, spentHourUsd, spentDayUsd, hourCapUsd, dayCapUsd, reason }`.
 * When `mode === "monitoring_only"` the pulse must do nothing (keep watching
 * own posts + inbox, pause new discovery reads).
 */
export const checkDiscoveryBudgetHttp = httpAction(async (ctx, request) => {
  const { authenticate } = await import("./inboundCallback");
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  const planTier = await ctx.runQuery(
    internal.gtmMaya.openclaw.pulseCallbacks.resolveAgentGatingTier,
    { agentId: auth.agentId }
  );

  const verdict = await ctx.runQuery(
    internal.gtmMaya.discoveryBudgetGate.checkDiscoveryBudget,
    {
      accountId: auth.accountId,
      planTier,
      nowMs: Date.now(),
    }
  );
  return new Response(JSON.stringify(verdict), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

/** Default watch lanes the pulse rotates through when none are supplied. */
const DEFAULT_WATCH_LANES: ReadonlyArray<string> = [
  "buyer_intent",
  "switch_intent",
  "competitor",
  "own_perf",
  "go_time",
];

/** 30 minutes — how far out a just-picked lane's next-due is pushed. */
const LANE_REPICK_INTERVAL_MS = 30 * 60 * 1000;

interface NextWatchLanePayload {
  lanes?: string[];
}

/**
 * POST /lc_gtm/next_watch_lane — `next_watch_lane` typed tool.
 *
 * Picks the most-due watch lane (round-robin) from the supplied set (default:
 * the 5 standard lanes), then touches it so the rotation advances. This is a
 * WRITE (touchWatchLane patches state), but it is naturally idempotent within
 * a pulse tick and the rotation is intentionally re-pickable, so it carries no
 * idempotency claim. Returns `{ lane }` (or `{ lane: null }` for an empty set).
 */
export const nextWatchLaneHttp = httpAction(async (ctx, request) => {
  const { authenticate } = await import("./inboundCallback");
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: NextWatchLanePayload = {};
  try {
    const text = await request.text();
    body = text ? (JSON.parse(text) as NextWatchLanePayload) : {};
  } catch {
    return new Response("bad json", { status: 400 });
  }

  const lanes =
    Array.isArray(body.lanes) &&
    body.lanes.length > 0 &&
    body.lanes.every((l) => typeof l === "string")
      ? body.lanes.map((l) => l.trim()).filter((l) => l.length > 0)
      : [...DEFAULT_WATCH_LANES];

  const nowMs = Date.now();
  const lane = await ctx.runQuery(
    internal.gtmMaya.watermarks.pickNextDueLane,
    { accountId: auth.accountId, lanes, nowMs }
  );

  if (lane !== null) {
    await ctx.runMutation(internal.gtmMaya.watermarks.touchWatchLane, {
      accountId: auth.accountId,
      agentId: auth.agentId,
      lane,
      nextDueAtMs: nowMs + LANE_REPICK_INTERVAL_MS,
    });
  }

  return new Response(JSON.stringify({ lane }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

interface AdvanceWatermarkPayload {
  idempotencyKey?: string;
  channel?: string;
  lastObservedAtMs?: number;
  lastSeenId?: string;
  cursor?: string;
}

/**
 * POST /lc_gtm/advance_watermark — `advance_watermark` typed tool.
 *
 * Persists a channel's read position so the next pulse bounds its read to only
 * new items. WRITE → idempotency-claimed (mirrors save_steering_directive).
 * Returns `{ ok: true }`.
 */
export const advanceWatermarkHttp = httpAction(async (ctx, request) => {
  const { authenticate } = await import("./inboundCallback");
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: AdvanceWatermarkPayload;
  try {
    body = (await request.json()) as AdvanceWatermarkPayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (!body.idempotencyKey) {
    return new Response("missing required fields", { status: 400 });
  }
  if (typeof body.channel !== "string" || body.channel.trim().length === 0) {
    return new Response("channel required", { status: 400 });
  }

  const claim = await ctx.runMutation(
    internal.gtmMaya.openclaw.inboundCallback.claimIdempotencyKey,
    {
      agentId: auth.agentId,
      accountId: auth.accountId,
      kind: "advance_watermark",
      idempotencyKey: body.idempotencyKey,
    }
  );
  if (claim === "duplicate") return new Response("ok (replay)", { status: 200 });

  await ctx.runMutation(internal.gtmMaya.watermarks.advanceChannelWatermark, {
    accountId: auth.accountId,
    agentId: auth.agentId,
    channel: body.channel.trim(),
    lastObservedAtMs:
      typeof body.lastObservedAtMs === "number" &&
      Number.isFinite(body.lastObservedAtMs)
        ? body.lastObservedAtMs
        : undefined,
    lastSeenId:
      typeof body.lastSeenId === "string" ? body.lastSeenId : undefined,
    cursor: typeof body.cursor === "string" ? body.cursor : undefined,
  });

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

/**
 * GET /lc_gtm/get_watermark — `get_watermark` typed tool.
 *
 * Reads a channel's current watermark so the pulse can bound a read before it
 * runs. Read-only: no idempotency claim. `channel` is required (query param).
 * Returns the row or null.
 */
export const getWatermarkHttp = httpAction(async (ctx, request) => {
  const { authenticate } = await import("./inboundCallback");
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  const url = new URL(request.url);
  const channel = (url.searchParams.get("channel") ?? "").trim();
  if (channel.length === 0) {
    return new Response("channel required", { status: 400 });
  }

  const row: Doc<"gtmChannelWatermarks"> | null = await ctx.runQuery(
    internal.gtmMaya.watermarks.getChannelWatermark,
    { accountId: auth.accountId, channel }
  );
  return new Response(JSON.stringify(row), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});
