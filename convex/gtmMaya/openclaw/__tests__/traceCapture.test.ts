/**
 * Trace capture — decision-timeline tool-call trace.
 *
 * Five mandatory categories:
 *   1. Cross-tenant — recordAgentTrace writes only under the passed accountId;
 *      agent A's rows are never visible when filtering by account B.
 *   2. Plan-tier — capture is plan-agnostic by design (we want every tier's
 *      decision trace); asserted by capturing under a "coach" account too.
 *   3. Adversarial — unknown category/status fall back to other/error;
 *      oversized args/result strings are clipped; non-string args dropped.
 *   4. Sibling-file — every category the plugin's withTrace() can emit and
 *      every status it derives must be accepted by recordAgentTrace (the
 *      schema union). We round-trip all of them so a drift fails here.
 *   5. TODO grep — clean.
 */

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { internal } from "../../../_generated/api";
import { modules } from "../../../../tests/_modules";
import type { Id } from "../../../_generated/dataModel";
import {
  normalizeCategory,
  normalizeStatus,
  clip,
  MAX_ARGS_CHARS,
} from "../traceCapture";

const NOW = 1_700_000_000_000;

async function insertAccount(
  t: ReturnType<typeof convexTest>,
  suffix: string,
  plan: "coach" | "manager" = "manager"
): Promise<Id<"creators">> {
  return await t.run((ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `u_${suffix}`,
      email: `${suffix}@test.com`,
      channelPreference: "telegram",
      timezone: "UTC",
      status: "active",
      plan,
      accountType: "gtm-agent",
      createdAt: NOW,
    })
  );
}

async function insertAgent(
  t: ReturnType<typeof convexTest>,
  accountId: Id<"creators">
): Promise<Id<"gtmAgents">> {
  return await t.run((ctx) =>
    ctx.db.insert("gtmAgents", {
      accountId,
      onboardingStep: "active",
      channelPreference: "telegram",
      timezone: "UTC",
      telegramChatId: "12345",
      hookToken: `tok_${accountId}`,
      createdAt: NOW,
      updatedAt: NOW,
    })
  );
}

async function tracesFor(
  t: ReturnType<typeof convexTest>,
  accountId: Id<"creators">
) {
  // Collect-and-filter rather than .withIndex: TS index inference truncates on
  // this large schema (the index works at runtime). Matches conversationCapture.
  const all = await t.run((ctx) => ctx.db.query("gtmAgentTrace").collect());
  return all.filter((r) => r.accountId === accountId);
}

type TraceCategory =
  | "research"
  | "draft"
  | "publish"
  | "foundation"
  | "read"
  | "other";
type TraceStatus = "ok" | "blocked" | "failed" | "error";

async function record(
  t: ReturnType<typeof convexTest>,
  accountId: Id<"creators">,
  agentId: Id<"gtmAgents">,
  overrides: {
    tool?: string;
    category?: TraceCategory;
    status?: TraceStatus;
    argsSummary?: string;
    resultSummary?: string;
    latencyMs?: number;
    toolCallId?: string;
    isSubagent?: boolean;
  } = {}
): Promise<{ deduped: boolean }> {
  return await t.mutation(
    internal.gtmMaya.openclaw.traceCapture.recordAgentTrace,
    {
      accountId,
      agentId,
      tool: overrides.tool ?? "research_reddit",
      category: overrides.category ?? "research",
      status: overrides.status ?? "ok",
      argsSummary: overrides.argsSummary,
      resultSummary: overrides.resultSummary,
      latencyMs: overrides.latencyMs,
      toolCallId: overrides.toolCallId,
      isSubagent: overrides.isSubagent,
    }
  );
}

describe("traceCapture — recordAgentTrace", () => {
  it("inserts a trace row under the passed account", async () => {
    const t = convexTest(schema, modules);
    const accountId = await insertAccount(t, "alice");
    const agentId = await insertAgent(t, accountId);

    const res = await record(t, accountId, agentId, {
      tool: "research_reddit",
      category: "research",
      argsSummary: '{"query":"churn"}',
      resultSummary: "OK research_reddit (HTTP 200)",
      status: "ok",
      latencyMs: 1800,
      toolCallId: "call-1",
    });
    expect(res.deduped).toBe(false);

    const rows = await tracesFor(t, accountId);
    expect(rows).toHaveLength(1);
    expect(rows[0].tool).toBe("research_reddit");
    expect(rows[0].category).toBe("research");
    expect(rows[0].latencyMs).toBe(1800);
  });

  it("1. cross-tenant — B's token never sees A's trace", async () => {
    const t = convexTest(schema, modules);
    const a = await insertAccount(t, "alice");
    const aAgent = await insertAgent(t, a);
    const b = await insertAccount(t, "bob");
    const bAgent = await insertAgent(t, b);

    await record(t, a, aAgent, { toolCallId: "a-1" });
    await record(t, b, bAgent, { toolCallId: "b-1", tool: "post_to_channel", category: "publish" });

    const aRows = await tracesFor(t, a);
    const bRows = await tracesFor(t, b);
    expect(aRows).toHaveLength(1);
    expect(bRows).toHaveLength(1);
    expect(aRows[0].accountId).toBe(a);
    expect(bRows[0].accountId).toBe(b);
    expect(aRows.some((r) => r.accountId === b)).toBe(false);
  });

  it("2. plan-tier — capture is plan-agnostic (coach account also records)", async () => {
    const t = convexTest(schema, modules);
    const coach = await insertAccount(t, "carol", "coach");
    const coachAgent = await insertAgent(t, coach);
    await record(t, coach, coachAgent, { toolCallId: "c-1" });
    expect(await tracesFor(t, coach)).toHaveLength(1);
  });

  it("dedups on toolCallId — a retried POST does not double-log", async () => {
    const t = convexTest(schema, modules);
    const accountId = await insertAccount(t, "dana");
    const agentId = await insertAgent(t, accountId);
    const first = await record(t, accountId, agentId, { toolCallId: "dup-1" });
    const second = await record(t, accountId, agentId, { toolCallId: "dup-1" });
    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect(await tracesFor(t, accountId)).toHaveLength(1);
  });

  it("does not dedup when no toolCallId is provided", async () => {
    const t = convexTest(schema, modules);
    const accountId = await insertAccount(t, "evan");
    const agentId = await insertAgent(t, accountId);
    await record(t, accountId, agentId, {});
    await record(t, accountId, agentId, {});
    expect(await tracesFor(t, accountId)).toHaveLength(2);
  });

  it("4. sibling-file — every plugin category + status round-trips through the schema", async () => {
    const t = convexTest(schema, modules);
    const accountId = await insertAccount(t, "frank");
    const agentId = await insertAgent(t, accountId);
    const cats = ["research", "draft", "publish", "foundation", "read", "other"] as const;
    const stats = ["ok", "blocked", "failed", "error"] as const;
    let n = 0;
    for (const category of cats) {
      for (const status of stats) {
        await record(t, accountId, agentId, {
          category,
          status,
          toolCallId: `rt-${n++}`,
        });
      }
    }
    const rows = await tracesFor(t, accountId);
    expect(rows).toHaveLength(cats.length * stats.length);
    expect(new Set(rows.map((r) => r.category))).toEqual(new Set(cats));
    expect(new Set(rows.map((r) => r.status))).toEqual(new Set(stats));
  });
});

describe("traceCapture — adversarial normalization (3)", () => {
  it("unknown category falls back to other", () => {
    expect(normalizeCategory("research")).toBe("research");
    expect(normalizeCategory("bogus")).toBe("other");
    expect(normalizeCategory(undefined)).toBe("other");
    expect(normalizeCategory(42)).toBe("other");
  });

  it("unknown status falls back to error (fail-loud, not silent ok)", () => {
    expect(normalizeStatus("ok")).toBe("ok");
    expect(normalizeStatus("blocked")).toBe("blocked");
    expect(normalizeStatus("nonsense")).toBe("error");
    expect(normalizeStatus(null)).toBe("error");
  });

  it("clip truncates oversized strings and drops non-strings/empties", () => {
    const big = "x".repeat(MAX_ARGS_CHARS + 50);
    const clipped = clip(big, MAX_ARGS_CHARS);
    expect(clipped && clipped.length).toBe(MAX_ARGS_CHARS + 1); // + ellipsis
    expect(clipped?.endsWith("…")).toBe(true);
    expect(clip("", 100)).toBeUndefined();
    expect(clip("   ", 100)).toBeUndefined();
    expect(clip(123, 100)).toBeUndefined();
    expect(clip("fine", 100)).toBe("fine");
  });
});
