/**
 * The typing indicator and the v1/v2 webhook fork (§17.36.2, §18 Sprint 2).
 *
 * The indicator looks cosmetic and isn't. The machine auto-stops when idle —
 * a 10× cost difference at 200 customers ($100–400/mo against $1,400–3,000) —
 * and auto-stop is only survivable because a boot hides behind an indicator
 * that appears instantly. Without it the fallback is always-on.
 *
 * So what's pinned here is ORDER and ISOLATION, not pixels: typing before the
 * wake, errors that can never fail the webhook, and a v1 chat that still
 * reaches the frozen agent untouched.
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import { convexTest } from "convex-test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { sendTelegramChatAction } from "../../integrations/telegram/client";
import type { Doc, Id } from "../../_generated/dataModel";

const NOW = Date.UTC(2026, 7, 1, 9, 0, 0);
const IDENTITY = { token: "bot-token", username: "HeyMaya" };

afterEach(() => {
  vi.restoreAllMocks();
});

async function seed(
  t: ReturnType<typeof convexTest>,
  suffix: string,
  chatId: string
): Promise<Id<"customers">> {
  return await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("creators", {
      clerkUserId: `u_${suffix}`,
      email: `${suffix}@example.com`,
      channelPreference: "web",
      timezone: "UTC",
      status: "active",
      plan: "manager",
      createdAt: NOW,
    });
    return await ctx.db.insert("customers", {
      accountId,
      agentVersion: "v2",
      plan: "mvp",
      state: "active",
      timezone: "UTC",
      telegramChatId: chatId,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
}

describe("sendTelegramChatAction", () => {
  it("posts to sendChatAction with the typing action", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, result: true }), { status: 200 })
    );
    const result = await sendTelegramChatAction(
      IDENTITY,
      { chatId: "42" },
      fetchMock as unknown as typeof fetch
    );

    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/sendChatAction");
    expect(JSON.parse(init.body as string)).toEqual({
      chat_id: "42",
      action: "typing",
    });
  });

  it("A NETWORK FAILURE IS A RESULT, NEVER A THROW", async () => {
    // This decorates the wake path. If it could throw, a cosmetic call would
    // take down the thing it exists to make feel fast.
    const fetchMock = vi.fn(async () => {
      throw new Error("socket hang up");
    });
    const result = await sendTelegramChatAction(
      IDENTITY,
      { chatId: "42" },
      fetchMock as unknown as typeof fetch
    );
    if (result.ok) throw new Error("expected the call to fail");
    expect(result.description).toMatch(/socket hang up/);
  });

  it("an HTTP error is reported, not swallowed into a false success", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 429 }));
    const result = await sendTelegramChatAction(
      IDENTITY,
      { chatId: "42" },
      fetchMock as unknown as typeof fetch
    );
    if (result.ok) throw new Error("expected the call to fail");
    expect(result.errorCode).toBe(429);
  });
});

describe("showTyping never breaks the caller", () => {
  it("returns shown:false when the bot isn't configured", async () => {
    // No token in the test environment. The wake must proceed regardless.
    const t = convexTest(schema, modules);
    const result = await t.action(internal.maya.telegram.showTyping, {
      chatId: "chat_1",
    });
    expect(result.shown).toBe(false);
  });
});

describe("handleInbound records, then wakes", () => {
  it("records the message and enqueues exactly one wake", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "wake", "chat_w");

    const result = await t.action(internal.maya.telegram.handleInbound, {
      chatId: "chat_w",
      text: "how's it going",
      ts: NOW,
    });
    expect(result.recorded).toBe(true);

    const messages = (await t.run((ctx) =>
      ctx.db.query("messages").collect()
    )) as Doc<"messages">[];
    expect(messages).toHaveLength(1);
    expect(messages[0].direction).toBe("in");

    const wakes = (
      (await t.run((ctx) => ctx.db.query("jobs").collect())) as Doc<"jobs">[]
    ).filter((j) => j.kind === "wake_agent");
    expect(wakes).toHaveLength(1);
    expect(wakes[0].customerId).toBe(customerId);
  });

  it("an unpaired chat wakes nothing", async () => {
    // Someone who found the bot. Must not mint a customer or boot a machine.
    const t = convexTest(schema, modules);
    await seed(t, "other", "chat_known");

    const result = await t.action(internal.maya.telegram.handleInbound, {
      chatId: "chat_stranger",
      text: "hello?",
    });
    expect(result.recorded).toBe(false);
    expect(await t.run((ctx) => ctx.db.query("jobs").collect())).toEqual([]);
  });

  it("two messages produce two wakes, not one collapsed by dedupe", async () => {
    // The warm window makes the second wake free, so collapsing them would only
    // risk dropping the second message's turn.
    const t = convexTest(schema, modules);
    await seed(t, "two", "chat_two");
    await t.action(internal.maya.telegram.handleInbound, {
      chatId: "chat_two",
      text: "first",
      ts: NOW,
    });
    await t.action(internal.maya.telegram.handleInbound, {
      chatId: "chat_two",
      text: "second",
      ts: NOW + 1000,
    });

    const wakes = (
      (await t.run((ctx) => ctx.db.query("jobs").collect())) as Doc<"jobs">[]
    ).filter((j) => j.kind === "wake_agent");
    expect(wakes).toHaveLength(2);
  });
});

describe("THE WEBHOOK FORK — order and isolation", () => {
  const source = readFileSync(
    join(__dirname, "..", "..", "gtmMaya", "telegramWebhook.ts"),
    "utf8"
  );

  it("TYPING IS AWAITED BEFORE THE WAKE IS SCHEDULED", () => {
    // The load-bearing ordering. Scheduling the indicator instead would race
    // the wake and could show it AFTER the reply — worse than not showing it.
    const fork = source.slice(source.indexOf("v2Customer"));
    const typingAt = fork.indexOf("maya.telegram.showTyping");
    const wakeAt = fork.indexOf("maya.telegram.handleInbound");
    expect(typingAt).toBeGreaterThan(-1);
    expect(wakeAt).toBeGreaterThan(-1);
    expect(typingAt).toBeLessThan(wakeAt);
    // Awaited, not fire-and-forget — otherwise the ordering above is cosmetic.
    expect(fork).toMatch(
      /await ctx\.runAction\(\s*internal\.maya\.telegram\.showTyping/
    );
  });

  it("the v2 fork returns before reaching the v1 switchboard", () => {
    // A v2 chat routed to BOTH agents would double-answer the founder from two
    // different brains — the worst possible symptom of a half-done migration.
    const fork = source.slice(source.indexOf("v2Customer"));
    const returnAt = fork.indexOf('return new Response("ok"');
    const v1At = fork.indexOf("telegramHandoff.routeInboundToMachine");
    expect(returnAt).toBeGreaterThan(-1);
    expect(v1At).toBeGreaterThan(-1);
    expect(returnAt).toBeLessThan(v1At);
  });

  it("the v1 path is still reached when there is no v2 customer", () => {
    // gtmMaya is frozen, not deleted. Every existing customer must keep working
    // — migration is per-customer, not a flag day.
    expect(source).toMatch(/telegramHandoff\.routeInboundToMachine/);
    expect(source).toMatch(/if \(v2Customer\)/);
  });
});

describe("the cold-start budget is real, and this is what buys it", () => {
  it("the client exposes sendChatAction at all", () => {
    // It didn't, until now. The spec's own gap table called this a Sprint 2
    // blocker: "the entire 30-second cold-start UX rests on this one call."
    const client = readFileSync(
      join(__dirname, "..", "..", "integrations", "telegram", "client.ts"),
      "utf8"
    );
    expect(client).toMatch(/export async function sendTelegramChatAction/);
    expect(client).toMatch(/"sendChatAction"/);
  });
});
