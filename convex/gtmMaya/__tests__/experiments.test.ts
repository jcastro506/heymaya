/**
 * Sprint 5 (top-tier) — experiment registry + Thompson allocator + honest
 * re-weight. The allocator math is covered in experimentStats.test.ts; here we
 * test the registry write rules (≤2 running dimensions, conclude), assign_arm
 * end-to-end against real outcomes, cross-tenant isolation, and the server-side
 * confidence clamp + auto-retire on save_learning.
 */
import { convexTest } from "convex-test";
import { beforeAll, describe, expect, it } from "vitest";
import { api, internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = btoa("\0".repeat(32));
});

async function setupAgent(t: ReturnType<typeof convexTest>, subject: string) {
  const authed = t.withIdentity({ subject, email: `${subject}@clawlaunch.test` });
  const started = await authed.mutation(
    api.gtmMaya.researchLifecycle.startGtmOnboarding,
    {}
  );
  const hookToken = "fake-hook-" + subject;
  const accountId = await t.run(async (ctx) => {
    await ctx.db.patch(started.agentId, { hookToken });
    const agent = await ctx.db.get(started.agentId);
    return agent!.accountId;
  });
  return { agentId: started.agentId, accountId, hookToken };
}

function post(
  t: ReturnType<typeof convexTest>,
  path: string,
  hookToken: string,
  body: Record<string, unknown>
) {
  return t.fetch(path, {
    method: "POST",
    headers: {
      authorization: `Bearer ${hookToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function saveExperiment(
  t: ReturnType<typeof convexTest>,
  hookToken: string,
  body: Record<string, unknown>
) {
  return (await post(t, "/lc_gtm/save_experiment", hookToken, body).then((r) =>
    r.json()
  )) as { ok: boolean; reason?: string; experimentId?: string };
}

describe("Sprint 5 — experiment registry", () => {
  it("registers an experiment and rejects a 3rd running dimension", async () => {
    const t = convexTest(schema, modules);
    const { hookToken } = await setupAgent(t, "u_reg_dims");

    const a = await saveExperiment(t, hookToken, {
      hypothesis: "lowercase hooks convert better",
      dimension: "hookType",
      arms: ["lowercase", "polished"],
      metric: "signups",
      nowMs: 1000,
    });
    expect(a.ok).toBe(true);
    expect(a.experimentId).toBeTruthy();

    const b = await saveExperiment(t, hookToken, {
      hypothesis: "short beats long",
      dimension: "lengthBucket",
      arms: ["short", "long"],
      metric: "signups",
      nowMs: 2000,
    });
    expect(b.ok).toBe(true);

    // 3rd DISTINCT running dimension → rejected (taxonomy discipline).
    const c = await saveExperiment(t, hookToken, {
      hypothesis: "casual tone wins",
      dimension: "tone",
      arms: ["casual", "formal"],
      metric: "signups",
      nowMs: 3000,
    });
    expect(c.ok).toBe(false);
    expect(c.reason).toBe("too_many_running_dimensions");

    // But a SECOND experiment on an already-running dimension is fine.
    const d = await saveExperiment(t, hookToken, {
      hypothesis: "question hooks",
      dimension: "hookType",
      arms: ["question", "statement"],
      metric: "signups",
      nowMs: 4000,
    });
    expect(d.ok).toBe(true);
  });

  it("rejects fewer than two arms", async () => {
    const t = convexTest(schema, modules);
    const { hookToken } = await setupAgent(t, "u_reg_arms");
    const r = await saveExperiment(t, hookToken, {
      hypothesis: "x",
      dimension: "hookType",
      arms: ["only"],
      metric: "signups",
    });
    expect(r.ok).toBe(false);
  });

  it("conclude frees the dimension for a new one", async () => {
    const t = convexTest(schema, modules);
    const { hookToken, agentId, accountId } = await setupAgent(t, "u_reg_conc");
    const a = await saveExperiment(t, hookToken, {
      hypothesis: "h", dimension: "hookType", arms: ["x", "y"], metric: "signups", nowMs: 1,
    });
    await saveExperiment(t, hookToken, {
      hypothesis: "h", dimension: "lengthBucket", arms: ["s", "l"], metric: "signups", nowMs: 2,
    });
    // conclude the hookType one
    const concluded = await saveExperiment(t, hookToken, {
      concludeId: a.experimentId,
      verdict: "lowercase won, 8/20 vs 1/18",
      nowMs: 3,
    });
    expect(concluded.ok).toBe(true);

    const stored = await t.run(async (ctx) => {
      const agent = await ctx.db.get(agentId as Id<"gtmAgents">);
      return JSON.parse(agent!.experimentsJson ?? "[]");
    });
    const hook = stored.find((e: { dimension: string }) => e.dimension === "hookType");
    expect(hook.status).toBe("concluded");
    expect(hook.verdict).toContain("lowercase won");

    // now a 3rd dimension is allowed (only lengthBucket still running)
    const c = await saveExperiment(t, hookToken, {
      hypothesis: "h", dimension: "tone", arms: ["a", "b"], metric: "signups", nowMs: 4,
    });
    expect(c.ok).toBe(true);
    expect(accountId).toBeTruthy();
  });

  it("assign_arm allocates one of the experiment's arms", async () => {
    const t = convexTest(schema, modules);
    const { hookToken } = await setupAgent(t, "u_reg_assign");
    const a = await saveExperiment(t, hookToken, {
      hypothesis: "h", dimension: "hookType", arms: ["lowercase", "polished"], metric: "signups", nowMs: 1,
    });
    const res = (await post(t, "/lc_gtm/assign_arm", hookToken, {
      experimentId: a.experimentId,
      seed: 42,
    }).then((r) => r.json())) as {
      ok: boolean;
      armLabel: string;
      dimension: string;
      reason: string;
    };
    expect(res.ok).toBe(true);
    expect(["lowercase", "polished"]).toContain(res.armLabel);
    expect(res.dimension).toBe("hookType");
    expect(res.reason).toBeTruthy();
  });

  it("assign_arm refuses an unknown / concluded experiment", async () => {
    const t = convexTest(schema, modules);
    const { hookToken } = await setupAgent(t, "u_reg_assign_bad");
    const res = (await post(t, "/lc_gtm/assign_arm", hookToken, {
      experimentId: "exp_nope",
      seed: 1,
    }).then((r) => r.json())) as { ok: boolean; reason?: string };
    expect(res.ok).toBe(false);
  });

  it("one agent's experiments never leak into another's registry", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "u_reg_xa");
    const b = await setupAgent(t, "u_reg_xb");
    await saveExperiment(t, a.hookToken, {
      hypothesis: "h", dimension: "hookType", arms: ["x", "y"], metric: "signups", nowMs: 1,
    });
    const bExps = await t.run(async (ctx) => {
      const agent = await ctx.db.get(b.agentId as Id<"gtmAgents">);
      return JSON.parse(agent!.experimentsJson ?? "[]");
    });
    expect(bExps).toEqual([]);
  });
});

describe("Sprint 5 — honest re-weight (confidence clamp + auto-retire)", () => {
  it("clamps an overconfident learning down to what the evidence supports", async () => {
    const t = convexTest(schema, modules);
    const { agentId, accountId } = await setupAgent(t, "u_learn_clamp");
    const id = await t.mutation(internal.gtmMaya.managerStore.upsertNicheLearning, {
      accountId,
      agentId,
      learningKey: "hook-lowercase",
      learningKind: "hook_pattern",
      learning: "lowercase hooks convert better",
      confidenceScore: 0.99, // claimed
      evidenceCount: 1, // …off ONE data point
    });
    const stored = await t.run(async (ctx) => ctx.db.get(id));
    expect(stored!.confidenceScore).toBeLessThanOrEqual(0.5); // clamped honest
  });

  it("allows high confidence when the evidence is actually there", async () => {
    const t = convexTest(schema, modules);
    const { agentId, accountId } = await setupAgent(t, "u_learn_ok");
    const id = await t.mutation(internal.gtmMaya.managerStore.upsertNicheLearning, {
      accountId,
      agentId,
      learningKey: "hook-lowercase",
      learningKind: "hook_pattern",
      learning: "lowercase hooks convert better",
      confidenceScore: 0.9,
      evidenceCount: 12,
    });
    const stored = await t.run(async (ctx) => ctx.db.get(id));
    expect(stored!.confidenceScore).toBeGreaterThanOrEqual(0.85);
  });

  it("auto-retires a learning whose confidence has collapsed", async () => {
    const t = convexTest(schema, modules);
    const { agentId, accountId } = await setupAgent(t, "u_learn_retire");
    const id = await t.mutation(internal.gtmMaya.managerStore.upsertNicheLearning, {
      accountId,
      agentId,
      learningKey: "hook-lowercase",
      learningKind: "hook_pattern",
      learning: "lowercase hooks convert better",
      confidenceScore: 0.1, // contradicted into the ground
      evidenceCount: 8,
    });
    const stored = await t.run(async (ctx) => ctx.db.get(id));
    expect(stored!.retired).toBe(true);
  });
});
