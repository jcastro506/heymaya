import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { summarizeState } from "../durableConverse";
import { isActionReplyKey, judgeProblems } from "../converse";

describe("durable conversation eval", () => {
  it("explains every model-judge failure", () => {
    expect(judgeProblems({ corny: 2, generic: 3, flattering: 0, toolSpeak: 2, wouldSend: 1 })).toEqual([
      "judge: corny 2",
      "judge: generic 3",
      "judge: toolSpeak 2",
      "judge: wouldSend 1",
    ]);
  });

  it("recognizes state-changing replies from their dedupe key", () => {
    expect(isActionReplyKey("manage:message-id")).toBe(true);
    expect(isActionReplyKey("reply:message-id")).toBe(false);
  });

  it("reports checkpoint progress and real latency percentiles", () => {
    const state = { runId: "r", status: "running" as const, creatorIds: ["a", "b"], sourceCreatorIds: ["sa", "sb"], probes: [{ category: "x", text: "x", expect: "x" }], cursor: 1, startedAt: 1, updatedAt: 2, results: [
      { ordinal: 0, creatorId: "a", category: "x", prompt: "x", pass: true, problems: [], latencyMs: { total: 100, converse: 70, evaluate: 30 } },
    ] };
    expect(summarizeState(state)).toEqual({ status: "running", total: 2, completed: 1, passed: 1, failed: 0, responseP50Ms: 70, responseP95Ms: 70, evaluationP50Ms: 30, evaluationP95Ms: 30, endToEndP95Ms: 100 });
  });

  it("leases one ordinal once and advances it once", async () => {
    const t = convexTest(schema, modules);
    const state = { runId: "lease", status: "running", creatorIds: ["creator"], sourceCreatorIds: ["source"], probes: [{ category: "x", text: "x", expect: "x" }], cursor: 0, results: [], startedAt: 1, updatedAt: 1 };
    await t.mutation(internal.eval.durableConverse.store, { runId: "lease", value: JSON.stringify(state) });
    const first = await t.mutation(internal.eval.durableConverse.claim, { runId: "lease" });
    const duplicate = await t.mutation(internal.eval.durableConverse.claim, { runId: "lease" });
    expect(first?.ordinal).toBe(0);
    expect(duplicate).toBeNull();
    const result = { ordinal: 0, creatorId: "creator", category: "x", prompt: "x", pass: true, problems: [], latencyMs: { total: 10, converse: 7, evaluate: 3 } };
    expect(await t.mutation(internal.eval.durableConverse.finish, { runId: "lease", ordinal: 0, result })).toEqual({ accepted: true, done: true });
    expect(await t.mutation(internal.eval.durableConverse.finish, { runId: "lease", ordinal: 0, result })).toEqual({ accepted: false, done: true });
  });
});
