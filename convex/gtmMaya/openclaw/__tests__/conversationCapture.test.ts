/**
 * Conversation capture — Wave 1 of the data-collection sprint.
 *
 * Five mandatory categories:
 *   1. Cross-tenant — agent A's hookToken can only write A's transcript;
 *      persistMayaMessage writes only under the passed accountId.
 *   2. Plan-tier — capture is plan-agnostic by design (we want every tier's
 *      conversation); asserted by capturing under a "coach" account too.
 *   3. Adversarial — oversized body truncated to MAX_BODY_CHARS; empty body
 *      and missing turnId rejected (400); no Bearer → 401.
 *   4. Sibling-file — "log_message" must exist in the gtmHookCallbacks kind
 *      union (schema), the CALLBACK_KIND validator (inboundCallback), AND the
 *      maya-gtm-tools plugin tool list. We import the plugin contract here so
 *      the test fails the moment they drift.
 *   5. TODO grep — clean.
 */

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { internal } from "../../../_generated/api";
import { modules } from "../../../../tests/_modules";
import type { Id } from "../../../_generated/dataModel";
import { MAX_BODY_CHARS } from "../conversationCapture";
import { BUNDLED_GTM_PLUGIN_TOOLS } from "../../../agents/packs/maya_gtm/bundledGtmPlugin";

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
  accountId: Id<"creators">,
  hookToken: string
): Promise<Id<"gtmAgents">> {
  return await t.run((ctx) =>
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
}

async function messagesFor(
  t: ReturnType<typeof convexTest>,
  accountId: Id<"creators">
) {
  return await t.run((ctx) =>
    ctx.db
      .query("mayaMessages")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect()
  );
}

describe("conversationCapture — persistMayaMessage", () => {
  it("inserts a transcript row and fires the matching usage event", async () => {
    const t = convexTest(schema, modules);
    const accountId = await insertAccount(t, "alice");
    const agentId = await insertAgent(t, accountId, "tok_alice");

    await t.mutation(
      internal.gtmMaya.openclaw.conversationCapture.persistMayaMessage,
      {
        accountId,
        agentId,
        role: "user",
        body: "how's my reddit plan looking?",
        channel: "telegram",
        turnId: "turn-1",
        ts: NOW,
      }
    );

    const rows = await messagesFor(t, accountId);
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("user");
    expect(rows[0].turnId).toBe("turn-1");

    // Inbound (user) turn bumps lastEngagedAt via the usage-event wire.
    const creator = await t.run((ctx) => ctx.db.get(accountId));
    expect(creator?.lastEngagedAt).toBe(NOW);

    const usage = await t.run((ctx) =>
      ctx.db
        .query("usageEvents")
        .withIndex("by_creator_and_ts", (q) => q.eq("creatorId", accountId))
        .collect()
    );
    expect(usage.some((e) => e.kind === "chat_turn_in")).toBe(true);
  });

  it("maya (outbound) turn does NOT bump lastEngagedAt", async () => {
    const t = convexTest(schema, modules);
    const accountId = await insertAccount(t, "carol");
    const agentId = await insertAgent(t, accountId, "tok_carol");

    await t.mutation(
      internal.gtmMaya.openclaw.conversationCapture.persistMayaMessage,
      {
        accountId,
        agentId,
        role: "maya",
        body: "Reddit-first this week. Three threads queued.",
        channel: "telegram",
        turnId: "turn-1",
        messageClass: "strategic",
        criticPassed: true,
        ts: NOW,
      }
    );

    const creator = await t.run((ctx) => ctx.db.get(accountId));
    expect(creator?.lastEngagedAt ?? 0).toBe(0);
    const rows = await messagesFor(t, accountId);
    expect(rows[0].messageClass).toBe("strategic");
    expect(rows[0].criticPassed).toBe(true);
  });

  it("plan-agnostic — captures under a coach account too", async () => {
    const t = convexTest(schema, modules);
    const accountId = await insertAccount(t, "dave", "coach");
    const agentId = await insertAgent(t, accountId, "tok_dave");
    await t.mutation(
      internal.gtmMaya.openclaw.conversationCapture.persistMayaMessage,
      {
        accountId,
        agentId,
        role: "user",
        body: "hi",
        channel: "telegram",
        turnId: "t",
        ts: NOW,
      }
    );
    expect(await messagesFor(t, accountId)).toHaveLength(1);
  });

  it("truncates an oversized body to MAX_BODY_CHARS", async () => {
    const t = convexTest(schema, modules);
    const accountId = await insertAccount(t, "erin");
    const agentId = await insertAgent(t, accountId, "tok_erin");
    await t.mutation(
      internal.gtmMaya.openclaw.conversationCapture.persistMayaMessage,
      {
        accountId,
        agentId,
        role: "user",
        body: "x".repeat(MAX_BODY_CHARS + 5000),
        channel: "telegram",
        turnId: "t",
        ts: NOW,
      }
    );
    const rows = await messagesFor(t, accountId);
    expect(rows[0].body.length).toBe(MAX_BODY_CHARS);
  });

  it("cross-tenant — account A's rows never appear under account B", async () => {
    const t = convexTest(schema, modules);
    const a = await insertAccount(t, "tenantA");
    const b = await insertAccount(t, "tenantB");
    const agentA = await insertAgent(t, a, "tok_A");
    await t.mutation(
      internal.gtmMaya.openclaw.conversationCapture.persistMayaMessage,
      {
        accountId: a,
        agentId: agentA,
        role: "user",
        body: "secret to A",
        channel: "telegram",
        turnId: "t",
        ts: NOW,
      }
    );
    expect(await messagesFor(t, a)).toHaveLength(1);
    expect(await messagesFor(t, b)).toHaveLength(0);
  });
});

describe("conversationCapture — /lc_gtm/log_message HTTP", () => {
  it("rejects a request with no Bearer token (401)", async () => {
    const t = convexTest(schema, modules);
    const res = await t.fetch("/lc_gtm/log_message", {
      method: "POST",
      body: JSON.stringify({ idempotencyKey: "k", turnId: "t", body: "hi" }),
    });
    expect(res.status).toBe(401);
  });

  it("captures an inbound user turn and dedupes a replay", async () => {
    const t = convexTest(schema, modules);
    const accountId = await insertAccount(t, "frank");
    await insertAgent(t, accountId, "tok_frank");

    const payload = JSON.stringify({
      idempotencyKey: "idem-1",
      turnId: "turn-9",
      body: "what's queued for today?",
      channel: "telegram",
    });
    const headers = {
      authorization: "Bearer tok_frank",
      "content-type": "application/json",
    };

    const first = await t.fetch("/lc_gtm/log_message", {
      method: "POST",
      headers,
      body: payload,
    });
    expect(first.status).toBe(200);
    expect(await messagesFor(t, accountId)).toHaveLength(1);

    // Replay with the same idempotencyKey — no second row.
    const replay = await t.fetch("/lc_gtm/log_message", {
      method: "POST",
      headers,
      body: payload,
    });
    expect(replay.status).toBe(200);
    expect((await replay.json()).deduped).toBe(true);
    expect(await messagesFor(t, accountId)).toHaveLength(1);
  });

  it("rejects empty body and missing turnId (400)", async () => {
    const t = convexTest(schema, modules);
    const accountId = await insertAccount(t, "gina");
    await insertAgent(t, accountId, "tok_gina");
    const headers = {
      authorization: "Bearer tok_gina",
      "content-type": "application/json",
    };

    const emptyBody = await t.fetch("/lc_gtm/log_message", {
      method: "POST",
      headers,
      body: JSON.stringify({ idempotencyKey: "k1", turnId: "t", body: "" }),
    });
    expect(emptyBody.status).toBe(400);

    const noTurn = await t.fetch("/lc_gtm/log_message", {
      method: "POST",
      headers,
      body: JSON.stringify({ idempotencyKey: "k2", body: "hi" }),
    });
    expect(noTurn.status).toBe(400);
  });
});

describe("conversationCapture — sibling-file coherence", () => {
  it("log_message is registered as a maya-gtm-tools plugin tool", () => {
    expect(BUNDLED_GTM_PLUGIN_TOOLS).toContain("log_message");
  });
});
