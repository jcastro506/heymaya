/**
 * LLM metering gateway — the synchronous cost spine. These tests pin the two
 * Convex-side pieces (the fetch-to-OpenRouter proxy is exercised live):
 *   - recordGatewaySpend writes an authoritative per-call ledger row.
 *   - peekGatewayBudget sums ONLY gateway rows in the last 24h + returns the cap,
 *     so the pre-flight gate can refuse (402) when real spend hits the cap.
 *     This is what makes cost known per-call instead of blind/polled.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../../../_generated/api";
import schema from "../../../schema";
import { modules } from "../../../../tests/_modules";
import type { Id } from "../../../_generated/dataModel";

async function setupAgent(t: ReturnType<typeof convexTest>, subject: string) {
  const authed = t.withIdentity({ subject, email: `${subject}@clawlaunch.test` });
  const started = await authed.mutation(
    api.gtmMaya.researchLifecycle.startGtmOnboarding,
    { channelPreference: "telegram", timezone: "America/New_York" }
  );
  return {
    accountId: started.accountId as Id<"creators">,
    agentId: started.agentId as Id<"gtmAgents">,
  };
}

const record = internal.gtmMaya.openclaw.llmGateway.recordGatewaySpend;
const peek = internal.gtmMaya.openclaw.llmGateway.peekGatewayBudget;

describe("llmGateway metering", () => {
  it("records a gateway call and the budget sees it", async () => {
    const t = convexTest(schema, modules);
    const { accountId, agentId } = await setupAgent(t, "gw_record");
    await t.mutation(record, {
      accountId,
      agentId,
      model: "moonshotai/kimi-k2-0905",
      costUsd: 0.012,
      promptTokens: 1500,
      completionTokens: 300,
      upstreamStatus: 200,
    });
    const b = await t.query(peek, { accountId, agentId });
    expect(b.spentUsd).toBeCloseTo(0.012, 6);
  });

  it("sums multiple calls", async () => {
    const t = convexTest(schema, modules);
    const { accountId, agentId } = await setupAgent(t, "gw_sum");
    for (const c of [0.01, 0.02, 0.03]) {
      await t.mutation(record, {
        accountId, agentId, model: "m", costUsd: c,
        promptTokens: 100, completionTokens: 50, upstreamStatus: 200,
      });
    }
    const b = await t.query(peek, { accountId, agentId });
    expect(b.spentUsd).toBeCloseTo(0.06, 6);
  });

  it("counts ONLY gateway rows, not other ledger spend (no double-count with research/poll)", async () => {
    const t = convexTest(schema, modules);
    const { accountId, agentId } = await setupAgent(t, "gw_isolate");
    await t.mutation(record, {
      accountId, agentId, model: "m", costUsd: 0.05,
      promptTokens: 100, completionTokens: 50, upstreamStatus: 200,
    });
    // A non-gateway ledger row (e.g. a read-API or poll row) must NOT count.
    await t.run(async (ctx) => {
      await ctx.db.insert("gtmCostLedger", {
        accountId,
        provider: "scrapecreators",
        operation: "research_read",
        reason: "not a gateway row",
        costUsd: 99,
        cacheStatus: "called",
        createdAt: Date.now(),
      });
    });
    const b = await t.query(peek, { accountId, agentId });
    expect(b.spentUsd).toBeCloseTo(0.05, 6); // the $99 read row is excluded
  });

  it("excludes spend older than 24h (rolling window)", async () => {
    const t = convexTest(schema, modules);
    const { accountId, agentId } = await setupAgent(t, "gw_window");
    await t.run(async (ctx) => {
      await ctx.db.insert("gtmCostLedger", {
        accountId,
        provider: "openrouter",
        operation: "llm_gateway",
        reason: "yesterday",
        costUsd: 5,
        cacheStatus: "called",
        createdAt: Date.now() - 25 * 60 * 60 * 1000, // 25h ago
      });
    });
    await t.mutation(record, {
      accountId, agentId, model: "m", costUsd: 0.07,
      promptTokens: 100, completionTokens: 50, upstreamStatus: 200,
    });
    const b = await t.query(peek, { accountId, agentId });
    expect(b.spentUsd).toBeCloseTo(0.07, 6); // the 25h-old $5 row drops out
  });

  it("reflects the per-agent daily cap (spendKillCapUsd) so $1/day is enforceable", async () => {
    const t = convexTest(schema, modules);
    const { accountId, agentId } = await setupAgent(t, "gw_cap");
    await t.run((ctx) => ctx.db.patch(agentId, { spendKillCapUsd: 1 }));
    const b = await t.query(peek, { accountId, agentId });
    expect(b.capUsd).toBe(1);
    // The gate's decision is spentUsd >= capUsd → over the $1 cap once we cross it.
    await t.mutation(record, {
      accountId, agentId, model: "m", costUsd: 1.01,
      promptTokens: 100, completionTokens: 50, upstreamStatus: 200,
    });
    const after = await t.query(peek, { accountId, agentId });
    expect(after.spentUsd >= after.capUsd).toBe(true);
  });
});
