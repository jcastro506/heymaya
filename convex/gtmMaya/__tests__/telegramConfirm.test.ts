/**
 * S6 — one-tap confirm-to-post, tested OFFLINE (no deploy, no real Telegram/Zernio).
 *
 * The security-critical properties:
 *   - Reddit/TikTok are gated by default (post returns needs_confirm).
 *   - The founder's one-tap confirm OVERRIDES the channel manual-force, but NOT
 *     the plan cap — confirm is consent, not a blank cheque.
 *   - A callback from one chat can't act on another agent's event (cross-tenant).
 *   - Skip cancels; idempotent on a non-pending event.
 *
 * What this does NOT cover (needs a real deploy + a real tap): the Telegram
 * round-trip itself.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function setupAgent(
  t: ReturnType<typeof convexTest>,
  subject: string,
  opts: { chatId?: string; activePlan?: boolean } = {}
): Promise<{ accountId: Id<"creators">; agentId: Id<"gtmAgents"> }> {
  const authed = t.withIdentity({ subject, email: `${subject}@clawlaunch.test` });
  const started = await authed.mutation(
    api.gtmMaya.researchLifecycle.startGtmOnboarding,
    { channelPreference: "telegram", timezone: "America/New_York" }
  );
  await authed.mutation(api.gtmMaya.researchLifecycle.setAppProfile, {
    url: `https://${subject}.test`,
    stage: "live-beta",
    weekGoal: "signups",
    canRecordScreen: true,
    canShowFace: false,
    excludedAudiences: [],
  });
  await t.run(async (ctx) => {
    await ctx.db.patch(started.agentId, {
      telegramChatId: opts.chatId,
      connectedAccountsJson: JSON.stringify([
        { accountId: "acct_rd", platform: "reddit" },
      ]),
      ...(opts.activePlan
        ? { gtmPlanJson: JSON.stringify({ status: "active", tier: "gtm99" }) }
        : {}),
    });
  });
  return { accountId: started.accountId, agentId: started.agentId };
}

async function makeNeedsConfirmEvent(
  t: ReturnType<typeof convexTest>,
  agentId: Id<"gtmAgents">,
  accountId: Id<"creators">
): Promise<Id<"gtmCalendarEvents">> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("gtmCalendarEvents", {
      accountId,
      agentId,
      title: "Reddit reply",
      draftText: "a genuinely helpful reply",
      startsAtMs: now,
      endsAtMs: now + 3_600_000,
      timezone: "America/New_York",
      status: "needs_confirm",
      createdBy: "maya",
      autoPostJson: JSON.stringify({
        channel: "reddit",
        zernioAccountId: "acct_rd",
        mode: "manual_confirm",
      }),
      createdAt: now,
      updatedAt: now,
    });
  });
}

describe("S6 confirm-to-post — publish override", () => {
  beforeEach(() => {
    vi.stubEnv("ZERNIO_API_KEY", "test-key");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("Reddit WITHOUT founder confirm stays gated → needs_confirm (no post fired)", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "c_gate", { activePlan: true });
    const fetchMock = vi.fn(async () => jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    const r = (await t.action(
      internal.gtmMaya.publishEngine.publishContentDirect,
      {
        agentId: a.agentId,
        channel: "reddit",
        zernioAccountId: "acct_rd",
        content: "a reply",
      }
    )) as { action: string };
    expect(r.action).toBe("needs_confirm");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("founder confirm overrides the channel force BUT NOT the plan cap (no plan → still needs_confirm)", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "c_plan", { activePlan: false }); // fail-closed plan
    const fetchMock = vi.fn(async () => jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    const r = (await t.action(
      internal.gtmMaya.publishEngine.publishContentDirect,
      {
        agentId: a.agentId,
        channel: "reddit",
        zernioAccountId: "acct_rd",
        content: "a reply",
        founderConfirmed: true,
      }
    )) as { action: string };
    // Confirm is consent, not a blank cheque — the plan cap (canAutoPost:false)
    // still holds.
    expect(r.action).toBe("needs_confirm");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("founder confirm + plan allows → gets PAST the gate and attempts Zernio (proves the override)", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "c_ok", { activePlan: true });
    // Zernio returns a non-retryable error so the post attempt resolves fast as
    // 'failed' — the point is it's NOT 'needs_confirm' (it got past the gate).
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(400, { error: "bad request" }))
    );
    const r = (await t.action(
      internal.gtmMaya.publishEngine.publishContentDirect,
      {
        agentId: a.agentId,
        channel: "reddit",
        zernioAccountId: "acct_rd",
        content: "a reply",
        founderConfirmed: true,
      }
    )) as { action: string };
    expect(r.action).not.toBe("needs_confirm");
    expect(["auto", "failed"]).toContain(r.action);
  });
});

describe("S6 confirm-to-post — Telegram callback", () => {
  beforeEach(() => {
    vi.stubEnv("ZERNIO_API_KEY", "test-key");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:fake-bot-token");
    // Stub all Telegram API calls.
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { ok: true, result: {} })));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("cross-tenant: a tap from another chat can't act on this agent's event", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "c_ta", { chatId: "111", activePlan: true });
    await setupAgent(t, "c_tb", { chatId: "222", activePlan: true });
    const eventId = await makeNeedsConfirmEvent(t, a.agentId, a.accountId);

    // Agent B's chat (222) tries to post agent A's event.
    await t.action(internal.gtmMaya.telegramConfirm.handleConfirmCallback, {
      chatId: "222",
      data: `gpost:${eventId}`,
      callbackQueryId: "cb1",
      messageId: 1,
    });
    const status = await t.run(async (ctx) => (await ctx.db.get(eventId))?.status);
    expect(status).toBe("needs_confirm"); // untouched
  });

  it("skip cancels the event", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "c_sk", { chatId: "333", activePlan: true });
    const eventId = await makeNeedsConfirmEvent(t, a.agentId, a.accountId);

    await t.action(internal.gtmMaya.telegramConfirm.handleConfirmCallback, {
      chatId: "333",
      data: `gskip:${eventId}`,
      callbackQueryId: "cb2",
      messageId: 2,
    });
    const status = await t.run(async (ctx) => (await ctx.db.get(eventId))?.status);
    expect(status).toBe("cancelled");
  });

  it("idempotent: tapping an already-cancelled event is a no-op", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "c_id", { chatId: "444", activePlan: true });
    const eventId = await makeNeedsConfirmEvent(t, a.agentId, a.accountId);
    await t.run(async (ctx) => {
      await ctx.db.patch(eventId, { status: "cancelled" });
    });
    await t.action(internal.gtmMaya.telegramConfirm.handleConfirmCallback, {
      chatId: "444",
      data: `gpost:${eventId}`,
      callbackQueryId: "cb3",
      messageId: 3,
    });
    const status = await t.run(async (ctx) => (await ctx.db.get(eventId))?.status);
    expect(status).toBe("cancelled"); // unchanged, never published
  });
});
