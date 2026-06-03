/**
 * Sprint 5 (top-tier) — the experiment registry + Thompson allocator surfaces.
 *
 * A registered experiment lives as a JSON entry on `gtmAgents.experimentsJson`
 * (JSON-on-row — NO new table, per the schema ceiling). save_experiment appends
 * one; assign_arm reads its arms' real outcomes and Thompson-allocates the next
 * draft to an arm; the weekly review concludes it with a verdict.
 *
 * Taxonomy discipline is enforced at write time: at most TWO distinct dimensions
 * may be 'running' at once (hook > format > angle > cta > … — don't test six
 * things and learn nothing).
 */
import { v } from "convex/values";
import { httpAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { authenticate } from "./openclaw/inboundCallback";
import { allocateArm } from "./experimentStats";

/** Max distinct dimensions that may be 'running' concurrently. */
export const MAX_RUNNING_DIMENSIONS = 2;

export interface RegisteredExperiment {
  id: string;
  hypothesis: string;
  dimension: string;
  arms: string[];
  metric: string;
  status: "running" | "concluded";
  createdAt: number;
  concludedAt?: number;
  verdict?: string;
}

function parseExperiments(json: string | undefined): RegisteredExperiment[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as RegisteredExperiment[]) : [];
  } catch {
    return [];
  }
}

// ───────────────────────── registry mutations / queries ─────────────────────────

/** Append OR conclude an experiment on the agent's experimentsJson. */
export const writeExperiment = internalMutation({
  args: {
    agentId: v.id("gtmAgents"),
    accountId: v.id("creators"),
    nowMs: v.number(),
    // create
    create: v.optional(
      v.object({
        id: v.string(),
        hypothesis: v.string(),
        dimension: v.string(),
        arms: v.array(v.string()),
        metric: v.string(),
      })
    ),
    // conclude
    concludeId: v.optional(v.string()),
    verdict: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: boolean; reason?: string; experimentId?: string }> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent || agent.accountId !== args.accountId) {
      return { ok: false, reason: "agent_not_found" };
    }
    const experiments = parseExperiments(agent.experimentsJson);

    if (args.concludeId) {
      const exp = experiments.find((e) => e.id === args.concludeId);
      if (!exp) return { ok: false, reason: "experiment_not_found" };
      exp.status = "concluded";
      exp.concludedAt = args.nowMs;
      if (args.verdict) exp.verdict = args.verdict;
      await ctx.db.patch(args.agentId, {
        experimentsJson: JSON.stringify(experiments),
      });
      return { ok: true, experimentId: exp.id };
    }

    if (!args.create) return { ok: false, reason: "nothing_to_write" };
    const c = args.create;
    if (c.arms.length < 2) {
      return { ok: false, reason: "need_at_least_two_arms" };
    }
    // Taxonomy discipline — at most MAX_RUNNING_DIMENSIONS distinct running dims.
    const runningDims = new Set(
      experiments.filter((e) => e.status === "running").map((e) => e.dimension)
    );
    if (!runningDims.has(c.dimension) && runningDims.size >= MAX_RUNNING_DIMENSIONS) {
      return {
        ok: false,
        reason: "too_many_running_dimensions",
      };
    }
    experiments.push({
      id: c.id,
      hypothesis: c.hypothesis,
      dimension: c.dimension,
      arms: c.arms,
      metric: c.metric,
      status: "running",
      createdAt: args.nowMs,
    });
    await ctx.db.patch(args.agentId, {
      experimentsJson: JSON.stringify(experiments),
    });
    return { ok: true, experimentId: c.id };
  },
});

export const readExperiments = internalQuery({
  args: { agentId: v.id("gtmAgents"), accountId: v.id("creators") },
  handler: async (ctx, args): Promise<RegisteredExperiment[]> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent || agent.accountId !== args.accountId) return [];
    return parseExperiments(agent.experimentsJson);
  },
});

// ───────────────────────── httpActions + tools ─────────────────────────

interface SaveExperimentPayload {
  hypothesis?: string;
  dimension?: string;
  arms?: unknown;
  metric?: string;
  concludeId?: string;
  verdict?: string;
  nowMs?: number;
}

/** POST /lc_gtm/save_experiment — create a new experiment, or conclude one. */
export const saveExperimentHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: SaveExperimentPayload;
  try {
    body = (await request.json()) as SaveExperimentPayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  const nowMs = typeof body.nowMs === "number" ? body.nowMs : Date.now();

  if (body.concludeId) {
    const res = await ctx.runMutation(internal.gtmMaya.experiments.writeExperiment, {
      agentId: auth.agentId,
      accountId: auth.accountId,
      nowMs,
      concludeId: body.concludeId,
      verdict: typeof body.verdict === "string" ? body.verdict : undefined,
    });
    return new Response(JSON.stringify(res), {
      status: res.ok ? 200 : 400,
      headers: { "content-type": "application/json" },
    });
  }

  const dimension = typeof body.dimension === "string" ? body.dimension.trim() : "";
  const hypothesis = typeof body.hypothesis === "string" ? body.hypothesis.trim() : "";
  const metric = typeof body.metric === "string" ? body.metric.trim() : "signups";
  const arms = Array.isArray(body.arms)
    ? body.arms.filter((a): a is string => typeof a === "string" && a.trim() !== "").map((a) => a.trim())
    : [];
  if (!dimension || !hypothesis || arms.length < 2) {
    return new Response(
      JSON.stringify({ ok: false, reason: "need_dimension_hypothesis_and_2_arms" }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }
  const id = `exp_${nowMs}_${dimension}`;
  const res = await ctx.runMutation(internal.gtmMaya.experiments.writeExperiment, {
    agentId: auth.agentId,
    accountId: auth.accountId,
    nowMs,
    create: { id, hypothesis, dimension, arms, metric },
  });
  return new Response(JSON.stringify(res), {
    status: res.ok ? 200 : 400,
    headers: { "content-type": "application/json" },
  });
});

interface AssignArmPayload {
  experimentId?: string;
  seed?: number;
}

/**
 * POST /lc_gtm/assign_arm — Thompson-allocate the next draft to an arm of a
 * running experiment, based on the arms' REAL converting outcomes so far.
 * Returns { ok, experimentId, dimension, armLabel, reason }. Maya stamps the
 * draft's attributes.{experimentId, armLabel, [dimension]} with the result.
 */
export const assignArmHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: AssignArmPayload;
  try {
    body = (await request.json()) as AssignArmPayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  const experimentId = typeof body.experimentId === "string" ? body.experimentId : "";
  if (!experimentId) {
    return new Response(JSON.stringify({ ok: false, reason: "missing_experimentId" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  const seed = typeof body.seed === "number" ? body.seed : Date.now();

  const experiments = await ctx.runQuery(
    internal.gtmMaya.experiments.readExperiments,
    { agentId: auth.agentId, accountId: auth.accountId }
  );
  const exp = experiments.find((e) => e.id === experimentId);
  if (!exp || exp.status !== "running") {
    return new Response(
      JSON.stringify({ ok: false, reason: "experiment_not_running" }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  // Pull the arms' real converting outcomes from the attribute join, then map the
  // experiment's declared arms onto them (unseen arms = 0/0 → still get a fair shot).
  const outcomes = await ctx.runQuery(
    internal.gtmMaya.attribution.getAttributeOutcomes,
    { agentId: auth.agentId, accountId: auth.accountId, dimension: exp.dimension }
  );
  const byLabel = new Map(outcomes.arms.map((a) => [a.label, a]));
  const arms = exp.arms.map((label) => {
    const o = byLabel.get(label);
    return { label, trials: o?.trials ?? 0, conversions: o?.conversions ?? 0 };
  });

  const choice = allocateArm(arms, seed);
  if (!choice) {
    return new Response(JSON.stringify({ ok: false, reason: "no_arms" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  return new Response(
    JSON.stringify({
      ok: true,
      experimentId: exp.id,
      dimension: exp.dimension,
      armLabel: choice.label,
      reason: choice.reason,
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
});
