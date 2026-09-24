/**
 * Checkpointed live conversation bank. One scheduled action owns one probe, so a dropped
 * CLI connection or an action timeout cannot restart the whole bank or overlap cleanup.
 * State lives in syncState because it is operator metadata, not creator memory.
 */
import { v } from "convex/values";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { PROBES, type Probe } from "./converse";

type Result = {
  ordinal: number;
  creatorId: string;
  category: string;
  prompt: string;
  reply?: string;
  pass: boolean;
  problems: string[];
  latencyMs: { total: number; converse: number; evaluate: number };
  error?: string;
};

type State = {
  runId: string;
  status: "running" | "complete" | "failed";
  creatorIds: string[];
  sourceCreatorIds: string[];
  probes: Probe[];
  cursor: number;
  claimedOrdinal?: number;
  leaseUntil?: number;
  results: Result[];
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
};

const keyFor = (runId: string) => `eval:durable-converse:${runId}`;

export function summarizeState(state: State): { status: State["status"]; total: number; completed: number; passed: number; failed: number; responseP50Ms: number | null; responseP95Ms: number | null; evaluationP50Ms: number | null; evaluationP95Ms: number | null; endToEndP95Ms: number | null } {
  const percentile = (values: number[], p: number) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] : null;
  };
  const response = state.results.map((r) => r.latencyMs.converse);
  const evaluation = state.results.map((r) => r.latencyMs.evaluate);
  const total = state.results.map((r) => r.latencyMs.total);
  return { status: state.status, total: state.creatorIds.length * state.probes.length, completed: state.results.length, passed: state.results.filter((r) => r.pass).length, failed: state.results.filter((r) => !r.pass).length, responseP50Ms: percentile(response, 0.5), responseP95Ms: percentile(response, 0.95), evaluationP50Ms: percentile(evaluation, 0.5), evaluationP95Ms: percentile(evaluation, 0.95), endToEndP95Ms: percentile(total, 0.95) };
}

export const load = internalQuery({
  args: { runId: v.string() },
  handler: async (ctx, a): Promise<State | null> => {
    const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", keyFor(a.runId))).first();
    if (!row) return null;
    try { return JSON.parse(row.value) as State; } catch { return null; }
  },
});

export const store = internalMutation({
  args: { runId: v.string(), value: v.string() },
  handler: async (ctx, a): Promise<null> => {
    const key = keyFor(a.runId);
    const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", key)).first();
    if (row) await ctx.db.patch(row._id, { value: a.value, updatedAt: Date.now() });
    else await ctx.db.insert("syncState", { key, value: a.value, updatedAt: Date.now() });
    return null;
  },
});

export const claim = internalMutation({
  args: { runId: v.string() },
  handler: async (ctx, a): Promise<{ state: State; ordinal: number } | null> => {
    const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", keyFor(a.runId))).first();
    if (!row) return null;
    let state: State;
    try { state = JSON.parse(row.value) as State; } catch { return null; }
    const total = state.creatorIds.length * state.probes.length;
    if (state.status === "complete" || state.cursor >= total) return null;
    const now = Date.now();
    if (state.claimedOrdinal !== undefined && (state.leaseUntil ?? 0) > now) return null;
    const ordinal = state.cursor;
    state.claimedOrdinal = ordinal;
    state.leaseUntil = now + 5 * 60_000;
    state.updatedAt = now;
    await ctx.db.patch(row._id, { value: JSON.stringify(state), updatedAt: now });
    // If the action disappears mid-probe, this wakes after the lease and resumes it.
    await ctx.scheduler.runAfter(5 * 60_000 + 1_000, internal.eval.durableConverse.step, { runId: a.runId });
    return { state, ordinal };
  },
});

export const finish = internalMutation({
  args: { runId: v.string(), ordinal: v.number(), result: v.any() },
  handler: async (ctx, a): Promise<{ accepted: boolean; done: boolean }> => {
    const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", keyFor(a.runId))).first();
    if (!row) return { accepted: false, done: true };
    let state: State;
    try { state = JSON.parse(row.value) as State; } catch { return { accepted: false, done: true }; }
    if (state.claimedOrdinal !== a.ordinal || state.cursor !== a.ordinal) return { accepted: false, done: state.status === "complete" };
    const result = a.result as Result;
    state.results = [...state.results.filter((r) => r.ordinal !== a.ordinal), result].sort((x, y) => x.ordinal - y.ordinal);
    state.cursor = a.ordinal + 1;
    delete state.claimedOrdinal;
    delete state.leaseUntil;
    state.updatedAt = Date.now();
    const total = state.creatorIds.length * state.probes.length;
    if (state.cursor >= total) {
      state.status = "complete";
      state.completedAt = Date.now();
      await ctx.scheduler.runAfter(24 * 60 * 60_000, internal.eval.durableConverse.cleanup, { runId: a.runId });
    }
    await ctx.db.patch(row._id, { value: JSON.stringify(state), updatedAt: state.updatedAt });
    return { accepted: true, done: state.status === "complete" };
  },
});

/** Retain live rows for one day of inspection, then remove every synthetic creator. */
export const cleanup = internalAction({
  args: { runId: v.string() },
  handler: async (ctx, a): Promise<{ deleted: number }> => {
    const state = await ctx.runQuery(internal.eval.durableConverse.load, a);
    if (!state || state.status !== "complete") return { deleted: 0 };
    let deleted = 0;
    for (const creatorId of new Set(state.results.map((result) => result.creatorId))) {
      const result = await ctx.runMutation(internal.account.deletion.purgeRows, { creatorId: creatorId as Id<"creators"> });
      deleted += result.deleted;
    }
    return { deleted };
  },
});

export const start = internalAction({
  args: { runId: v.optional(v.string()), category: v.optional(v.string()), categories: v.optional(v.array(v.string())), limit: v.optional(v.number()) },
  handler: async (ctx, a): Promise<{ runId: string; summary: ReturnType<typeof summarizeState> }> => {
    const runId = a.runId?.trim() || `${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}`;
    const existing = await ctx.runQuery(internal.eval.durableConverse.load, { runId });
    if (existing) {
      if (existing.status !== "complete") await ctx.scheduler.runAfter(0, internal.eval.durableConverse.step, { runId });
      return { runId, summary: summarizeState(existing) };
    }
    const sourceCreatorIds = (await ctx.runQuery(internal.eval.run.scenarioCreators, {})).ids;
    // These IDs define the matrix size. Each probe receives its own clone in `step`, so
    // an earlier test cannot manufacture the pending item a later test assumes is absent.
    const creatorIds = sourceCreatorIds.map(String);
    const selected = a.categories ? new Set(a.categories) : null;
    const probes = PROBES.filter((p) => (!a.category || p.category === a.category) && (!selected || selected.has(p.category))).slice(0, a.limit ?? PROBES.length);
    const now = Date.now();
    const state: State = { runId, status: "running", creatorIds, sourceCreatorIds: sourceCreatorIds.map(String), probes: [...probes], cursor: 0, results: [], startedAt: now, updatedAt: now };
    await ctx.runMutation(internal.eval.durableConverse.store, { runId, value: JSON.stringify(state) });
    await ctx.scheduler.runAfter(0, internal.eval.durableConverse.step, { runId });
    return { runId, summary: summarizeState(state) };
  },
});

export const step = internalAction({
  args: { runId: v.string() },
  handler: async (ctx, a): Promise<{ done: boolean }> => {
    const claimed = await ctx.runMutation(internal.eval.durableConverse.claim, a);
    if (!claimed) {
      const state = await ctx.runQuery(internal.eval.durableConverse.load, a);
      return { done: !state || state.status === "complete" };
    }
    const { state, ordinal } = claimed;
    const sourceId = (state.sourceCreatorIds?.[Math.floor(ordinal / state.probes.length)] ?? state.creatorIds[Math.floor(ordinal / state.probes.length)]) as Id<"creators">;
    const creatorId = await ctx.runMutation(internal.eval.scenarios.cloneForRun, { sourceId, runId: `${a.runId}:probe:${ordinal}` });
    const probe = state.probes[ordinal % state.probes.length];
    const t0 = Date.now();
    let result: Result;
    try {
      const { messageId } = await ctx.runMutation(internal.core.messages.recordInbound, { creatorId, surface: "telegram", body: probe.text });
      const converseAt = Date.now();
      const turn = await ctx.runAction(internal.agent.converse.run, { creatorId, messageId });
      const converseMs = Date.now() - converseAt;
      const replies = await ctx.runQuery(internal.eval.converse.repliesTo, { creatorId, inboundId: messageId, since: t0 });
      if (!turn.ok || replies.length === 0) throw new Error(turn.reason ?? "no reply row");
      const reply = replies[0];
      const context = await ctx.runQuery(internal.agent.context.gather, { creatorId, messageId });
      const evaluateAt = Date.now();
      const scored = await ctx.runAction(internal.eval.run.evaluate, { suite: `converse:${a.runId}`, skill: "reply", text: reply.text, evidence: { theirMessage: probe.text, category: probe.category, expect: probe.expect, creatorContext: context?.personal ?? "", conversation: context?.history ?? "" }, creatorId, messageId: reply.messageId, creatorUsesEmoji: !/\b0% use an emoji\b/.test(context?.voice ?? ""), actionTaken: reply.actionTaken, trace: { runId: a.runId, ordinal, converseMs } });
      const evaluateMs = Date.now() - evaluateAt;
      const problems = scored.pass ? [] : await ctx.runQuery(internal.eval.converse.failedChecks, { id: scored.id });
      result = { ordinal, creatorId, category: probe.category, prompt: probe.text, reply: reply.text, pass: scored.pass, problems, latencyMs: { total: Date.now() - t0, converse: converseMs, evaluate: evaluateMs } };
    } catch (error) {
      result = { ordinal, creatorId, category: probe.category, prompt: probe.text, pass: false, problems: ["execution"], latencyMs: { total: Date.now() - t0, converse: 0, evaluate: 0 }, error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300) };
    }
    const finished = await ctx.runMutation(internal.eval.durableConverse.finish, { runId: a.runId, ordinal, result });
    if (finished.accepted && !finished.done) await ctx.scheduler.runAfter(0, internal.eval.durableConverse.step, { runId: a.runId });
    return { done: finished.done };
  },
});

export const report = internalQuery({
  args: { runId: v.string() },
  handler: async (ctx, a): Promise<{ summary: ReturnType<typeof summarizeState>; results: Result[] } | null> => {
    const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", keyFor(a.runId))).first();
    if (!row) return null;
    try { const state = JSON.parse(row.value) as State; return { summary: summarizeState(state), results: state.results }; } catch { return null; }
  },
});
