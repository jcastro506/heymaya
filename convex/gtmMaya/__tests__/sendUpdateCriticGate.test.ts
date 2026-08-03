/**
 * send_update grounding policy — DELIVERY WINS on operator DMs.
 *
 * Originally (Sprint 2.28) the criticPassed + evidence gates HARD-BLOCKED
 * strategic operator messages. The live dogfood proved that blackholes the
 * single most important message (the synthesis plan "never arrived"). The
 * grounding moat now stays HARD only on PUBLIC posts (post_to_channel /
 * approval-publishing); on operator DMs (send_update, Maya↔founder) a grounding
 * gap is LOGGED and the message is DELIVERED, never dropped.
 *
 * This suite locks that contract: NO strategic-grounding reason
 * (critic_not_passed / evidence_required / evidence_blocked) may ever come back
 * from send_update — the message always proceeds past the gates to delivery.
 *
 * Because /lc_gtm/send_update is an httpAction, we test via convex-test's
 * in-process router. The send fails downstream, so the meaningful assertion is
 * that the response reason is never one of the grounding-block reasons.
 *
 * ## The Telegram stub is load-bearing
 *
 * This comment used to claim "we don't actually reach Telegram (no network in
 * tests)". That was FALSE — the handler resolved the fake bot token and made a
 * real request to api.telegram.org, which normally 401s fast enough that nobody
 * noticed. On a CI runner without egress to Telegram it hung until ETIMEDOUT,
 * failing three tests for reasons unrelated to anything under test.
 *
 * It is invisible locally, because a dev machine HAS egress to Telegram — the
 * test passes either way here. That is exactly why it survived: the environment
 * that could catch it was the only one nobody ran.
 *
 * So the assumption is enforced now rather than asserted in prose. A test whose
 * correctness depends on a network call NOT happening has to make it
 * impossible, or it is a flake waiting for a bad day.
 */

import { convexTest } from "convex-test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";

const GROUNDING_BLOCK_REASONS = [
  "critic_not_passed",
  "evidence_required",
  "evidence_blocked",
];

const realFetch = globalThis.fetch;

beforeAll(() => {
  process.env.ENCRYPTION_KEY = btoa("\0".repeat(32));
  process.env.TELEGRAM_BOT_TOKEN = "fake:shared-bot-token";

  // Telegram never gets called. Everything else passes through, so an unrelated
  // fetch on this path still behaves normally rather than being swallowed by an
  // over-broad stub.
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("api.telegram.org")) {
      return new Response(
        JSON.stringify({ ok: false, error_code: 401, description: "Unauthorized" }),
        { status: 401, headers: { "content-type": "application/json" } }
      );
    }
    return realFetch(input as RequestInfo, init);
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
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
  // Pair telegram (otherwise send_update returns no_telegram_chat_id BEFORE the
  // grounding gates, so we wouldn't be exercising them).
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

async function callSendUpdate(
  t: ReturnType<typeof convexTest>,
  agentId: string,
  body: Record<string, unknown>
): Promise<{ status: number; body: unknown; reason: string | undefined }> {
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
  const reason =
    typeof parsed === "object" && parsed
      ? (parsed as { reason?: string }).reason
      : undefined;
  return { status: response.status, body: parsed, reason };
}

describe("send_update grounding policy — operator DMs never blackhole", () => {
  it("strategic message WITHOUT criticPassed is DELIVERED (grounding gap logged, not blocked)", async () => {
    const t = convexTest(schema, modules);
    const { agentId } = await setupAgent(t, "u_critic_block");

    const result = await callSendUpdate(t, agentId, {
      text: "Your weekly review: Reddit OP-reply rate up 3x this week.",
      messageClass: "strategic",
      claims: [{ claim: "Reddit OP-reply rate up 3x", evidence_ids: ["abc123"] }],
      // criticPassed: NOT set
    });

    expect(result.status).toBe(200);
    expect(GROUNDING_BLOCK_REASONS).not.toContain(result.reason);
  });

  it("strategic message WITH criticPassed: true is DELIVERED past the gates", async () => {
    const t = convexTest(schema, modules);
    const { agentId } = await setupAgent(t, "u_critic_passes");

    const result = await callSendUpdate(t, agentId, {
      text: "Your weekly review: Reddit OP-reply rate up 3x this week.",
      messageClass: "strategic",
      criticPassed: true,
      criticReasons: ["grounding_ok", "voice_ok", "tier_honest"],
      claims: [{ claim: "Reddit OP-reply rate up 3x", evidence_ids: ["abc123"] }],
    });

    expect(result.status).toBe(200);
    expect(GROUNDING_BLOCK_REASONS).not.toContain(result.reason);
  });

  it("strategic message with criticPassed: false is still DELIVERED (gap logged)", async () => {
    const t = convexTest(schema, modules);
    const { agentId } = await setupAgent(t, "u_critic_explicit_false");

    const result = await callSendUpdate(t, agentId, {
      text: "Your weekly review: Reddit OP-reply rate up 3x this week.",
      messageClass: "strategic",
      criticPassed: false,
      claims: [{ claim: "Reddit OP-reply rate up 3x", evidence_ids: ["abc123"] }],
    });

    expect(result.status).toBe(200);
    expect(GROUNDING_BLOCK_REASONS).not.toContain(result.reason);
  });

  it("strategic message with NO claims is DELIVERED (no evidence_required block)", async () => {
    const t = convexTest(schema, modules);
    const { agentId } = await setupAgent(t, "u_no_claims");

    const result = await callSendUpdate(t, agentId, {
      text: "Here's the plan: your buyers live on r/SaaS, I'll start there tomorrow.",
      messageClass: "strategic",
      criticPassed: true,
      // claims: NONE
    });

    expect(result.status).toBe(200);
    expect(GROUNDING_BLOCK_REASONS).not.toContain(result.reason);
  });

  it("tactical message is DELIVERED without any grounding requirement", async () => {
    const t = convexTest(schema, modules);
    const { agentId } = await setupAgent(t, "u_tactical_no_critic");

    const result = await callSendUpdate(t, agentId, {
      text: "Still digging, back to you in ~5 min.",
      messageClass: "tactical",
    });

    expect(result.status).toBe(200);
    expect(GROUNDING_BLOCK_REASONS).not.toContain(result.reason);
  });
});

describe("send_update — internal-chatter + reply safety", () => {
  // REGRESSION (2026-06-21): the foundation-resume safety-net's NO_REPLY status
  // ("Foundation is NOT complete… STEP DOWN… NO_REPLY") leaked to a real
  // founder's Telegram. The NO_REPLY sentinel must be swallowed, never delivered.
  it("suppresses a NO_REPLY internal-status message (lease-coordination leak)", async () => {
    const t = convexTest(schema, modules);
    const { agentId } = await setupAgent(t, "u_no_reply");
    const result = await callSendUpdate(t, agentId, {
      text:
        "Foundation is NOT complete. The lease is currently ACTIVE (held by another tick until 18:20 UTC), so I will STEP DOWN.\n\nNO_REPLY — Foundation resume safety-net standing by.",
      messageClass: "tactical",
    });
    expect(result.status).toBe(200);
    expect((result.body as { suppressed?: string }).suppressed).toBe("no_reply");
  });

  // A REPLY to the founder (turnId present) must NEVER be eaten by the synthesis
  // dedup — that would resurrect the "she never got back to me" bug.
  it("a reply (turnId present) is never suppressed by the synthesis dedup", async () => {
    const t = convexTest(schema, modules);
    const { accountId, agentId } = await setupAgent(t, "u_reply_bypass");
    // Put the agent squarely in the post-handover cooldown, where a PROACTIVE
    // send would be suppressed as a duplicate.
    await t.run(async (ctx) => {
      await ctx.db.insert("gtmBuyerMap", {
        accountId,
        agentId,
        icpDescription: "ICP",
        buyerJourneyStages: [],
        intentPhrases: [],
        trustedVoices: [],
        synthesizedAt: 1,
      });
      await ctx.db.patch(agentId, {
        strategyDeliveredAt: Date.now(),
        foundationCompletedAt: Date.now(),
      });
    });
    const result = await callSendUpdate(t, agentId, {
      text: "Yes — connecting Reddit now, I'll queue those replies.",
      messageClass: "tactical",
      turnId: "turn-123",
    });
    expect(result.status).toBe(200);
    expect((result.body as { suppressed?: string }).suppressed).not.toBe(
      "duplicate_synthesis"
    );
  });
});
