/**
 * 2026-07-22 — the two founder-facing cards.
 *
 * Card A ("I'll post it"): thread context ON the card — target name, link,
 * one honest why — never a blind approval, never boilerplate about channels
 * that aren't on the card.
 *
 * Card B ("you post it" / paste card): deeplink (X = intent link with the
 * reply pre-filled), draft in a <pre> tap-to-copy block, and an
 * "✍️ I posted it" button that flips the event published + stamps the ledger.
 *
 * Degrade: a PLATFORM-rejected publish behind a founder confirm re-arms the
 * event AND sends the paste card — the founder ships by hand instead of
 * retrying into the same wall. Gate blocks (plan/dedup) do NOT degrade.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";
import { buildXIntentLink } from "../telegramConfirm";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface SentTg {
  url: string;
  body: Record<string, unknown>;
}

/** Mock fetch splitting Telegram sends from Zernio calls. */
function stubTransport(opts: {
  zernio?: (url: string) => Response;
}): { tg: SentTg[]; zernio: string[] } {
  const tg: SentTg[] = [];
  const zernio: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: { body?: string }) => {
      const u = String(url);
      if (u.includes("api.telegram.org")) {
        tg.push({ url: u, body: init?.body ? JSON.parse(init.body) : {} });
        return jsonResponse(200, { ok: true, result: { message_id: tg.length } });
      }
      zernio.push(u);
      return opts.zernio
        ? opts.zernio(u)
        : jsonResponse(200, { success: true, data: { commentId: "rc_1" } });
    })
  );
  return { tg, zernio };
}

async function setupAgent(
  t: ReturnType<typeof convexTest>,
  subject: string,
  channel: "reddit" | "x" | "hn"
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
      telegramChatId: "chat_777",
      connectedAccountsJson: JSON.stringify([
        { accountId: `acct_${channel}`, platform: channel },
      ]),
      gtmPlanJson: JSON.stringify({ status: "active", tier: "starter" }),
    });
  });
  return { accountId: started.accountId, agentId: started.agentId };
}

async function seedThreadAndEvent(
  t: ReturnType<typeof convexTest>,
  a: { accountId: Id<"creators">; agentId: Id<"gtmAgents"> },
  channel: "reddit" | "x" | "hn",
  externalId = "thr_1"
): Promise<Id<"gtmCalendarEvents">> {
  await t.run(async (ctx) => {
    await ctx.db.insert("gtmTargetThreads", {
      accountId: a.accountId,
      agentId: a.agentId,
      platform: channel,
      externalId,
      subredditOrCommunity: channel === "reddit" ? "indiehackers" : "buildinpublic",
      currentMetrics: {},
      lastSeenMetricsAtMs: Date.now(),
      whyItFits: "OP is the exact buyer venting the exact pain",
      title: "Making distribution easier... feedback needed",
      url: "https://example.com/thread/thr_1",
      excerpt: "solo dev distribution",
      status: "queued",
      priorityScore: 0.9,
      recommendedAction: "reply",
      grounded: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("gtmCalendarEvents", {
      accountId: a.accountId,
      agentId: a.agentId,
      title: `${channel} reply`,
      draftText: "a genuinely helpful reply with <specifics> & numbers",
      startsAtMs: now,
      endsAtMs: now + 3_600_000,
      timezone: "America/New_York",
      status: "needs_confirm",
      createdBy: "maya",
      autoPostJson: JSON.stringify({
        channel,
        zernioAccountId: `acct_${channel}`,
        mode: "manual_confirm",
        targetExternalId: externalId,
      }),
      createdAt: now,
      updatedAt: now,
    });
  });
}

describe("Card A — thread context on the confirm card", () => {
  beforeEach(() => {
    vi.stubEnv("ZERNIO_API_KEY", "test-key");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "tg-test-token");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("names the target, links the thread, gives the why — no boilerplate", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "c_carda", "reddit");
    const eventId = await seedThreadAndEvent(t, a, "reddit");
    const { tg } = stubTransport({});
    const r = (await t.action(internal.gtmMaya.telegramConfirm.sendPostConfirmCard, {
      eventId,
    })) as { ok: boolean };
    expect(r.ok).toBe(true);
    const card = tg.find((m) => m.url.includes("sendMessage"));
    const text = String(card?.body.text);
    expect(text).toContain("r/indiehackers");
    expect(text).toContain("Making distribution easier");
    expect(text).toContain("https://example.com/thread/thr_1");
    expect(text).toContain("OP is the exact buyer");
    expect(text).not.toContain("Reddit/TikTok"); // the old boilerplate
  });
});

describe("Card B — the paste card", () => {
  beforeEach(() => {
    vi.stubEnv("ZERNIO_API_KEY", "test-key");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "tg-test-token");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reddit: deeplink + <pre> tap-to-copy draft + 'I posted it' button", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "c_cardb", "reddit");
    const eventId = await seedThreadAndEvent(t, a, "reddit");
    const { tg } = stubTransport({});
    const r = (await t.action(internal.gtmMaya.telegramConfirm.sendPasteCard, {
      eventId,
      reasonLine: "this subreddit blocks app posts",
    })) as { ok: boolean };
    expect(r.ok).toBe(true);
    const card = tg[0];
    const text = String(card.body.text);
    expect(card.body.parse_mode).toBe("HTML");
    expect(text).toContain("https://example.com/thread/thr_1");
    expect(text).toContain("<pre>");
    expect(text).toContain("&lt;specifics&gt;"); // draft is HTML-escaped
    const kb = (card.body.reply_markup as { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }).inline_keyboard;
    expect(kb[0][0].callback_data).toBe(`gdone:${eventId}`);
  });

  it("x: intent link pre-fills the reply — no copy block needed", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "c_cardbx", "x");
    const eventId = await seedThreadAndEvent(t, a, "x", "20730663");
    const { tg } = stubTransport({});
    await t.action(internal.gtmMaya.telegramConfirm.sendPasteCard, { eventId });
    const text = String(tg[0].body.text);
    expect(text).toContain("https://x.com/intent/post?");
    expect(text).toContain("in_reply_to=20730663");
    expect(text).not.toContain("<pre>");
  });

  it("'I posted it' tap flips the event published and stamps the ledger", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "c_gdone", "reddit");
    const eventId = await seedThreadAndEvent(t, a, "reddit", "thr_done");
    stubTransport({});
    await t.action(internal.gtmMaya.telegramConfirm.handleConfirmCallback, {
      chatId: "chat_777",
      data: `gdone:${eventId}`,
      callbackQueryId: "cb_done",
      messageId: 9,
    });
    const ev = await t.run(async (ctx) => await ctx.db.get(eventId));
    expect(ev?.status).toBe("published");
    const stamped = await t.run(async (ctx) =>
      (await ctx.db.query("gtmPostResults").collect()).filter(
        (r) => r.targetExternalId === "thr_done"
      )
    );
    expect(stamped).toHaveLength(1);
  });

  it("hn via send_confirm_card HTTP routes to the paste card automatically", async () => {
    const t = convexTest(schema, modules);
    const hookToken = "hk-cards-hn";
    const a = await setupAgent(t, "c_hn", "hn");
    await t.run(async (ctx) => {
      await ctx.db.patch(a.agentId, { hookToken });
    });
    const eventId = await seedThreadAndEvent(t, a, "hn");
    const { tg } = stubTransport({});
    const res = await t.fetch("/lc_gtm/send_confirm_card", {
      method: "POST",
      headers: {
        authorization: `Bearer ${hookToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ eventId }),
    });
    const body = (await res.json()) as { ok: boolean; cardStyle?: string };
    expect(body.ok).toBe(true);
    expect(body.cardStyle).toBe("paste");
    expect(String(tg[0].body.text)).toContain("no posting API");
  });
});

describe("degrade: platform rejection → paste card; gate block → no card", () => {
  beforeEach(() => {
    vi.stubEnv("ZERNIO_API_KEY", "test-key");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "tg-test-token");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("conversational 'post it' on a platform-rejected publish sends the paste card", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "c_degrade", "reddit");
    const eventId = await seedThreadAndEvent(t, a, "reddit", "thr_rej");
    const { tg } = stubTransport({
      zernio: (u) =>
        u.includes("/inbox/comments/")
          ? jsonResponse(200, {
              success: false,
              error: "POST_GUIDANCE_VALIDATION_FAILED: not a question",
            })
          : jsonResponse(200, {}),
    });
    const r = (await t.action(
      internal.gtmMaya.telegramConfirm.confirmEventConversational,
      { eventId, agentId: a.agentId, decision: "post" }
    )) as { ok: boolean; outcome?: string; reason?: string };
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe("paste_card_sent");
    expect(r.reason).toContain("do NOT re-draft");
    // The paste card actually went out, with the copy block.
    const paste = tg.find((m) => String(m.body.text).includes("<pre>"));
    expect(paste).toBeTruthy();
    // Event re-armed, not dead.
    const ev = await t.run(async (ctx) => await ctx.db.get(eventId));
    expect(ev?.status).toBe("needs_confirm");
  });

  it("a gate block (lapsed plan) does NOT send a paste card", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "c_gate2", "reddit");
    await t.run(async (ctx) => {
      await ctx.db.patch(a.agentId, { gtmPlanJson: undefined });
    });
    const eventId = await seedThreadAndEvent(t, a, "reddit", "thr_gate");
    const { tg } = stubTransport({});
    const r = (await t.action(
      internal.gtmMaya.telegramConfirm.confirmEventConversational,
      { eventId, agentId: a.agentId, decision: "post" }
    )) as { ok: boolean; outcome?: string };
    expect(r.outcome).toBe("retryable");
    expect(tg.filter((m) => String(m.body.text ?? "").includes("<pre>"))).toHaveLength(0);
  });
});

describe("buildXIntentLink", () => {
  it("encodes text and threads the reply", () => {
    const link = buildXIntentLink("hello & goodbye", "123");
    expect(link).toContain("https://x.com/intent/post?");
    expect(link).toContain("in_reply_to=123");
    expect(link).toContain(encodeURIComponent("hello & goodbye").replace(/%20/g, "+").slice(0, 5));
  });
});

describe("cards retired (2026-07-25): conversational is the only approval flow", () => {
  beforeEach(() => {
    vi.stubEnv("ZERNIO_API_KEY", "test-key");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "tg-test-token");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("send_confirm_card on Reddit is refused with the conversational instruction", async () => {
    const t = convexTest(schema, modules);
    const hookToken = "hk-retired";
    const a = await setupAgent(t, "c_retired", "reddit");
    await t.run(async (ctx) => {
      await ctx.db.patch(a.agentId, { hookToken });
    });
    const eventId = await seedThreadAndEvent(t, a, "reddit");
    const { tg } = stubTransport({});
    const res = await t.fetch("/lc_gtm/send_confirm_card", {
      method: "POST",
      headers: {
        authorization: `Bearer ${hookToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ eventId }),
    });
    const body = (await res.json()) as { ok: boolean; reason?: string };
    expect(body.ok).toBe(false);
    expect(body.reason).toContain("confirm_event");
    expect(tg).toHaveLength(0); // no card went out
    // The event is untouched — still confirmable by words.
    const ev = await t.run(async (ctx) => await ctx.db.get(eventId));
    expect(ev?.status).toBe("needs_confirm");
  });

  it("TikTok keeps its card (legal preview)", async () => {
    const t = convexTest(schema, modules);
    const hookToken = "hk-tiktok";
    const authed = t.withIdentity({ subject: "c_tt", email: "c_tt@clawlaunch.test" });
    const started = await authed.mutation(
      api.gtmMaya.researchLifecycle.startGtmOnboarding,
      { channelPreference: "telegram", timezone: "America/New_York" }
    );
    await authed.mutation(api.gtmMaya.researchLifecycle.setAppProfile, {
      url: "https://c-tt.test",
      stage: "live-beta",
      weekGoal: "signups",
      canRecordScreen: true,
      canShowFace: false,
      excludedAudiences: [],
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(started.agentId, {
        telegramChatId: "chat_tt",
        hookToken,
        connectedAccountsJson: JSON.stringify([
          { accountId: "acct_tiktok", platform: "tiktok" },
        ]),
        gtmPlanJson: JSON.stringify({ status: "active", tier: "starter" }),
      });
    });
    const eventId = await t.run(async (ctx) => {
      const now = Date.now();
      return await ctx.db.insert("gtmCalendarEvents", {
        accountId: started.accountId,
        agentId: started.agentId,
        title: "tiktok slideshow",
        draftText: "caption for the slides",
        startsAtMs: now,
        endsAtMs: now + 3_600_000,
        timezone: "America/New_York",
        status: "needs_confirm",
        createdBy: "maya",
        autoPostJson: JSON.stringify({
          channel: "tiktok",
          zernioAccountId: "acct_tiktok",
          mode: "manual_confirm",
        }),
        createdAt: now,
        updatedAt: now,
      });
    });
    const { tg } = stubTransport({});
    const res = await t.fetch("/lc_gtm/send_confirm_card", {
      method: "POST",
      headers: {
        authorization: `Bearer ${hookToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ eventId }),
    });
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(tg.length).toBeGreaterThan(0); // the card went out
  });
});
