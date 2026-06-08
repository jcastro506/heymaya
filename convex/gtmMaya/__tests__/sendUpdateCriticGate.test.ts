/**
 * Sprint 2.28 — /lc_gtm/send_update criticPassed gate.
 *
 * Validates:
 *   1. Strategic message WITHOUT criticPassed → 200 ok:false reason:critic_not_passed
 *   2. Strategic message WITH criticPassed: true + claims → goes to firewall (next step)
 *   3. Tactical message WITHOUT criticPassed → does NOT block on critic gate
 *   4. Tactical message WITH criticPassed → still allowed
 *   5. Strategic + claims but criticPassed:false → blocked
 *
 * Because /lc_gtm/send_update is an httpAction, we test via Convex's
 * action.run + a mocked Convex test instance. The handler itself calls
 * runAction for the outboundFirewall + runQuery for the agent — those
 * still run via convex-test's in-process router.
 *
 * Tests use SHARED TELEGRAM_BOT_TOKEN env var so the per-tenant bot
 * resolver picks up the dev fallback. We don't actually send to
 * Telegram (no network access in tests) — we just verify the critic
 * gate path resolves correctly before the send.
 */

import { convexTest } from "convex-test";
import { beforeAll, describe, expect, it } from "vitest";
import { api, internal } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = btoa("\0".repeat(32));
  process.env.TELEGRAM_BOT_TOKEN = "fake:shared-bot-token";
});

async function setupAgent(t: ReturnType<typeof convexTest>, subject: string) {
  const authed = t.withIdentity({
    subject,
    email: `${subject}@clawlaunch.test`,
  });
  const started = await authed.mutation(
    api.gtmMaya.researchLifecycle.startGtmOnboarding,
    {}
  );
  await authed.mutation(api.gtmMaya.researchLifecycle.setAppProfile, {
    name: `App for ${subject}`,
    url: `https://${subject}.test`,
    stage: "live-beta",
    weekGoal: "signups",
    canRecordScreen: true,
    canShowFace: false,
    excludedAudiences: [],
  });
  // Pair telegram (otherwise send_update returns no_telegram_chat_id
  // BEFORE hitting the critic gate, so we wouldn't be testing the gate).
  await t.run(async (ctx) => {
    const agent = await ctx.db.get(started.agentId);
    if (agent) {
      await ctx.db.patch(started.agentId, {
        telegramChatId: "8376373926",
        telegramPairedAt: Date.now(),
      });
    }
  });
  return { authed, accountId: started.accountId, agentId: started.agentId };
}

/**
 * Hit the send_update httpAction with a hookToken-authenticated body.
 * The function expects a fetch Request — we build one with the auth
 * header set to the agent's hookToken.
 */
async function callSendUpdate(
  t: ReturnType<typeof convexTest>,
  agentId: string,
  body: Record<string, unknown>
): Promise<{ status: number; body: unknown }> {
  // Mint a hookToken for this agent so authenticate() passes.
  const hookToken = "fake-test-hook-token-" + Math.random().toString(36).slice(2);
  await t.run(async (ctx) => {
    await ctx.db.patch(agentId as never, { hookToken });
  });

  const response = await t.fetch("/lc_gtm/send_update", {
    method: "POST",
    headers: {
      authorization: `Bearer ${hookToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    parsed = await response.text();
  }
  return { status: response.status, body: parsed };
}

describe("Sprint 2.28 — send_update criticPassed gate", () => {
  it("strategic message WITHOUT criticPassed is blocked", async () => {
    const t = convexTest(schema, modules);
    const { agentId } = await setupAgent(t, "u_critic_block");

    const result = await callSendUpdate(t, agentId, {
      text: "Your weekly review: Reddit OP-reply rate up 3x this week.",
      messageClass: "strategic",
      claims: [
        { claim: "Reddit OP-reply rate up 3x", evidence_ids: ["abc123"] },
      ],
      // criticPassed: NOT set
    });

    expect(result.status).toBe(200);
    expect(
      typeof result.body === "object" && result.body && (result.body as { reason?: string }).reason
    ).toBe("critic_not_passed");
  });

  it("strategic message WITH criticPassed: true passes the critic gate", async () => {
    const t = convexTest(schema, modules);
    const { agentId } = await setupAgent(t, "u_critic_passes");

    const result = await callSendUpdate(t, agentId, {
      text: "Your weekly review: Reddit OP-reply rate up 3x this week.",
      messageClass: "strategic",
      criticPassed: true,
      criticReasons: ["grounding_ok", "voice_ok", "tier_honest"],
      claims: [
        { claim: "Reddit OP-reply rate up 3x", evidence_ids: ["abc123"] },
      ],
    });

    // The critic gate passes — the next step is evidence guard which
    // will fail because evidence_ids point to non-existent cards.
    // So we expect a 200 with a NON-critic-not-passed reason
    // (evidence_blocked OR firewall_blocked OR success path).
    expect(result.status).toBe(200);
    const reason =
      typeof result.body === "object" && result.body
        ? (result.body as { reason?: string }).reason
        : undefined;
    expect(reason).not.toBe("critic_not_passed");
  });

  it("strategic message with criticPassed: false is blocked (explicit reject)", async () => {
    const t = convexTest(schema, modules);
    const { agentId } = await setupAgent(t, "u_critic_explicit_false");

    const result = await callSendUpdate(t, agentId, {
      text: "Your weekly review: Reddit OP-reply rate up 3x this week.",
      messageClass: "strategic",
      criticPassed: false,
      claims: [
        { claim: "Reddit OP-reply rate up 3x", evidence_ids: ["abc123"] },
      ],
    });

    expect(result.status).toBe(200);
    expect(
      typeof result.body === "object" && result.body && (result.body as { reason?: string }).reason
    ).toBe("critic_not_passed");
  });

  it("tactical message does NOT require criticPassed", async () => {
    const t = convexTest(schema, modules);
    const { agentId } = await setupAgent(t, "u_tactical_no_critic");

    const result = await callSendUpdate(t, agentId, {
      text: "Still digging — back to you in ~5 min.",
      messageClass: "tactical",
      // criticPassed: NOT set
    });

    expect(result.status).toBe(200);
    // The critic gate doesn't block tactical. The next step is the
    // firewall (which will pass for this clean text), then Telegram
    // send (which fails because we don't actually have a bot). So the
    // response shouldn't be "critic_not_passed".
    const reason =
      typeof result.body === "object" && result.body
        ? (result.body as { reason?: string }).reason
        : undefined;
    expect(reason).not.toBe("critic_not_passed");
  });
});
