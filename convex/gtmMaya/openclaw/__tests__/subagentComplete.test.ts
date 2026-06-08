/**
 * subagent_complete tolerance — the post-foundation cost-loop fix.
 *
 * A *completion* signal must never fail-closed and strand a worker. In the
 * "Maya owns research natively" model a natively-spawned worker often has no
 * researchJobId in context; the old handler returned 400 "researchJobId
 * required", the worker saw a tool error, retried/flailed (ENOENT reads of
 * non-existent state.json files), and never terminated — a zombie that burned
 * K2 tokens for hours. These tests lock the tolerant behavior: missing or
 * unresolvable jobId => 200, never 400/500.
 */
import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { modules } from "../../../../tests/_modules";
import type { Id } from "../../../_generated/dataModel";

const NOW = 1_700_000_000_000;

async function setupAgentHookToken(
  t: ReturnType<typeof convexTest>,
  suffix: string
): Promise<string> {
  const hookToken = `tok_${suffix}`;
  const accountId: Id<"creators"> = await t.run((ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `u_${suffix}`,
      email: `${suffix}@test.com`,
      channelPreference: "telegram",
      timezone: "UTC",
      status: "active",
      plan: "manager",
      accountType: "gtm-agent",
      createdAt: NOW,
    })
  );
  await t.run((ctx) =>
    ctx.db.insert("gtmAgents", {
      accountId,
      onboardingStep: "active",
      channelPreference: "telegram",
      timezone: "UTC",
      telegramChatId: "12345",
      hookToken,
      createdAt: NOW,
      updatedAt: NOW,
    })
  );
  return hookToken;
}

function post(
  t: ReturnType<typeof convexTest>,
  hookToken: string,
  body: unknown
): Promise<Response> {
  return t.fetch("/lc_gtm/subagent_complete", {
    method: "POST",
    headers: {
      authorization: `Bearer ${hookToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("subagent_complete — never strands a worker", () => {
  it("returns 200 (not 400) when researchJobId is missing", async () => {
    const t = convexTest(schema, modules);
    const hookToken = await setupAgentHookToken(t, "sc_missing");
    const res = await post(t, hookToken, { platform: "reddit" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(true);
  });

  it("returns 200 (best-effort) on a stale/unresolvable researchJobId, never throws", async () => {
    const t = convexTest(schema, modules);
    const hookToken = await setupAgentHookToken(t, "sc_bogus");
    // A malformed/stale id must be accepted so the worker terminates cleanly.
    const res = await post(t, hookToken, { researchJobId: "not-a-real-id" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(true);
  });

  it("still rejects an unauthenticated call", async () => {
    const t = convexTest(schema, modules);
    await setupAgentHookToken(t, "sc_auth");
    const res = await t.fetch("/lc_gtm/subagent_complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ researchJobId: "x" }),
    });
    expect(res.status).toBeGreaterThanOrEqual(401);
  });
});
