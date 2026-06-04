/**
 * Sprint 8 (top-tier) — the compounding archetype brain. The k-ANONYMITY property
 * is the load-bearing privacy guard, so it's tested directly + exhaustively on
 * the pure aggregator. The convex-test side proves the rollup publishes only
 * k-anon-passing, PII-free tuples and that get_archetype_playbook reads them.
 */
import { convexTest } from "convex-test";
import { beforeAll, describe, expect, it } from "vitest";
import { api, internal } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import {
  aggregateArchetypeLearnings,
  K_ANON_MIN_TENANTS,
  type TenantLearning,
} from "../archetypeBrain";

function row(tenantId: string, venue: string, confidence = 0.8): TenantLearning {
  return { tenantId, archetype: "dev-tool", structured: { venue }, confidence };
}

describe("aggregateArchetypeLearnings — k-anonymity is non-negotiable", () => {
  it("does NOT publish a pattern backed by fewer than 5 distinct tenants", () => {
    const rows = [row("t1", "r/localllama"), row("t2", "r/localllama"), row("t3", "r/localllama")];
    expect(aggregateArchetypeLearnings(rows)).toEqual([]);
  });

  it("publishes once ≥5 DISTINCT tenants back it", () => {
    const rows = Array.from({ length: 5 }, (_, i) => row(`t${i}`, "r/localllama"));
    const out = aggregateArchetypeLearnings(rows);
    expect(out).toHaveLength(1);
    expect(out[0].value).toBe("r/localllama");
    expect(out[0].distinctTenantCount).toBe(5);
  });

  it("counts DISTINCT tenants, not rows — 5 rows from 2 tenants does NOT pass", () => {
    const rows = [
      row("t1", "r/x"), row("t1", "r/x"), row("t1", "r/x"),
      row("t2", "r/x"), row("t2", "r/x"),
    ];
    expect(aggregateArchetypeLearnings(rows)).toEqual([]); // only 2 distinct tenants
  });

  it("emits NO tenant identifiers — output is PII-free by construction", () => {
    const rows = Array.from({ length: 6 }, (_, i) => row(`tenant-${i}`, "hn"));
    const out = aggregateArchetypeLearnings(rows);
    const serialized = JSON.stringify(out);
    expect(serialized).not.toMatch(/tenant-/);
    expect(out[0]).not.toHaveProperty("tenantId");
    expect(out[0]).not.toHaveProperty("tenants");
  });

  it("aggregates across dimensions and orders by support", () => {
    // venue r/a: 6 tenants · hook 'founder-story': 5 tenants
    const rows: TenantLearning[] = [
      ...Array.from({ length: 6 }, (_, i) => ({
        tenantId: `t${i}`, archetype: "dev-tool", structured: { venue: "r/a" }, confidence: 0.9,
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        tenantId: `t${i}`, archetype: "dev-tool", structured: { hook: "founder-story" }, confidence: 0.7,
      })),
    ];
    const out = aggregateArchetypeLearnings(rows);
    expect(out).toHaveLength(2);
    expect(out[0].kind).toBe("venue"); // 6 tenants, sorted first
    expect(out[0].distinctTenantCount).toBe(6);
    expect(out[1].kind).toBe("hook");
  });

  it("keeps different archetypes separate", () => {
    const rows: TenantLearning[] = [
      ...Array.from({ length: 5 }, (_, i) => ({
        tenantId: `a${i}`, archetype: "dev-tool", structured: { venue: "r/x" }, confidence: 0.8,
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        tenantId: `b${i}`, archetype: "consumer-mobile", structured: { venue: "r/x" }, confidence: 0.8,
      })),
    ];
    const out = aggregateArchetypeLearnings(rows);
    expect(out).toHaveLength(2);
    expect(new Set(out.map((o) => o.archetype))).toEqual(
      new Set(["dev-tool", "consumer-mobile"])
    );
  });

  it("the k-anon floor matches the documented constant", () => {
    expect(K_ANON_MIN_TENANTS).toBe(5);
  });
});

// ───────────────────────── convex-test (rollup + warm-start read) ─────────────────────────

beforeAll(() => {
  process.env.ENCRYPTION_KEY = btoa("\0".repeat(32));
});

async function seedTenant(
  t: ReturnType<typeof convexTest>,
  subject: string,
  hookToken: string,
  archetype: string,
  venue: string | null
): Promise<void> {
  const authed = t.withIdentity({ subject, email: `${subject}@clawlaunch.test` });
  const started = await authed.mutation(api.gtmMaya.researchLifecycle.startGtmOnboarding, {});
  await authed.mutation(api.gtmMaya.researchLifecycle.setAppProfile, {
    url: `https://${subject}.test`,
    stage: "live-beta",
    weekGoal: "signups",
    canRecordScreen: true,
    canShowFace: false,
    excludedAudiences: [],
  });
  await t.run(async (ctx) => {
    await ctx.db.patch(started.agentId, { hookToken });
    const agent = await ctx.db.get(started.agentId);
    if (agent?.appId) await ctx.db.patch(agent.appId, { archetype });
    if (venue) {
      await ctx.db.insert("gtmNicheLearnings", {
        accountId: agent!.accountId,
        agentId: started.agentId,
        learningKey: "venue-localllama",
        learningKind: "channel_priority",
        learning: "r/LocalLLaMA converts",
        confidenceScore: 0.8,
        evidenceCount: 3,
        firstObservedAt: 1,
        lastReinforcedAt: 1,
        retired: false,
        structuredJson: JSON.stringify({ venue }),
        createdAt: 1,
        updatedAt: 1,
      });
    }
  });
}

describe("Sprint 8 — rollup + get_archetype_playbook (server)", () => {
  it("rolls up ≥5-tenant patterns and serves them PII-free to the agent", async () => {
    const t = convexTest(schema, modules);

    // Seed 5 distinct dev-tool tenants, each with a converting venue learning.
    for (let i = 0; i < 5; i++) {
      await seedTenant(t, `arch_t${i}`, `fake-hook-arch-${i}`, "dev-tool", "r/localllama");
    }

    // Run the monthly rollup.
    await t.action(internal.gtmMaya.archetypeBrain.runArchetypeRollup, {});

    // The 6th founder (also dev-tool) reads the warm-start prior.
    const newHook = "fake-hook-arch-new";
    await seedTenant(t, "arch_new", newHook, "dev-tool", null);

    const res = (await t
      .fetch("/lc_gtm/get_archetype_playbook", {
        method: "GET",
        headers: { authorization: `Bearer ${newHook}` },
      })
      .then((r) => r.json())) as {
      ok: boolean;
      archetype: string;
      playbook: Array<{ kind: string; learning: string; supportingTenantCount: number }>;
    };

    expect(res.ok).toBe(true);
    expect(res.archetype).toBe("dev-tool");
    expect(res.playbook.length).toBeGreaterThanOrEqual(1);
    const venue = res.playbook.find((p) => p.learning.includes("r/localllama"));
    expect(venue!.supportingTenantCount).toBe(5);
    // PII-free: no agent/account ids anywhere in the response.
    expect(JSON.stringify(res)).not.toMatch(/creators|gtmAgents|accountId/);
  });

  it("returns an empty playbook below the k-anon floor (no warm-start)", async () => {
    const t = convexTest(schema, modules);
    // Only 2 dev-tool tenants with the same learning → below floor.
    for (let i = 0; i < 2; i++) {
      await seedTenant(t, `few_t${i}`, `few-${i}`, "dev-tool", "r/x");
    }
    await t.action(internal.gtmMaya.archetypeBrain.runArchetypeRollup, {});

    await seedTenant(t, "few_new", "few-new", "dev-tool", null);
    const res = (await t
      .fetch("/lc_gtm/get_archetype_playbook", {
        method: "GET",
        headers: { authorization: "Bearer few-new" },
      })
      .then((r) => r.json())) as { playbook: unknown[] };
    expect(res.playbook).toEqual([]);
  });
});
