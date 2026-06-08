import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import {
  buildDeployTimeHelloText,
  sendDirectTelegramMessage,
} from "../sendDirectMessage";

/**
 * Sprint 2.11 — deploy-time Telegram hello.
 *
 * Tests cover the 5 mandatory categories from CLAUDE.md:
 * 1. Cross-tenant isolation — N/A (pure function over passed inputs)
 * 2. Plan-tier gating — N/A (callable from any tier; gated upstream
 *    in deployMayaGtm.ts which is action-level auth-gated)
 * 3. Adversarial inputs — missing credentials, banned phrases in the
 *    composed text, Telegram non-200, non-ok payload
 * 4. Sibling-file scan — hello text uses no slop, no skill slugs, no
 *    workspace file names (verified against outboundFirewall ban list)
 * 5. TODO grep — zero offenders in sendDirectMessage.ts
 */

describe("buildDeployTimeHelloText", () => {
  it("uses the operator's first name when present", () => {
    const text = buildDeployTimeHelloText({
      firstName: "Josh",
      productName: "ModelHub",
    });
    expect(text).toContain("Hey Josh");
    expect(text).toContain("ModelHub");
  });

  it("falls back to 'Hey there' when firstName is undefined", () => {
    const text = buildDeployTimeHelloText({ productName: "ModelHub" });
    expect(text).toContain("Hey there");
  });

  it("falls back to 'Hey there' when firstName is empty", () => {
    const text = buildDeployTimeHelloText({
      firstName: "",
      productName: "ModelHub",
    });
    expect(text).toContain("Hey there");
  });

  it("trims whitespace from firstName", () => {
    const text = buildDeployTimeHelloText({
      firstName: "  Josh  ",
      productName: "ModelHub",
    });
    expect(text).toContain("Hey Josh");
    expect(text).not.toContain("Hey   Josh");
  });

  it("passes the outbound firewall (no slop, no skill slugs, no .md filenames)", async () => {
    const { validateOutboundText } = await import(
      "../../../gtmMaya/outboundFirewall"
    );
    const text = buildDeployTimeHelloText({
      firstName: "Josh",
      productName: "ModelHub",
    });
    const result = validateOutboundText(text);
    expect(result.ok, JSON.stringify(result.failures)).toBe(true);
  });

  it("stays under 500 chars (boot_kickoff voice-contract limit)", () => {
    const text = buildDeployTimeHelloText({
      firstName: "AnExtremelyLongFirstName",
      productName: "ProductWithAVeryLongName",
    });
    expect(text.length).toBeLessThanOrEqual(500);
  });
});

describe("sendDirectTelegramMessage", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    // default fetch mock — overridden per test
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), {
        status: 200,
      })
    );
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns missing_credentials when botToken absent", async () => {
    const result = await sendDirectTelegramMessage({
      botToken: undefined,
      chatId: "8376373926",
      text: "Hey there — Maya here.",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing_credentials");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("returns missing_credentials when chatId absent", async () => {
    const result = await sendDirectTelegramMessage({
      botToken: "bot-token",
      chatId: undefined,
      text: "Hey there — Maya here.",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing_credentials");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("blocks via firewall when text contains a banned skill slug", async () => {
    const result = await sendDirectTelegramMessage({
      botToken: "bot-token",
      chatId: "8376373926",
      text: "I'll be using maya-app-inspector to break down the product.",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("firewall_blocked");
    expect(result.firewallFailures).toBeTruthy();
    expect(
      result.firewallFailures!.some((f) => f.matched === "maya-app-inspector")
    ).toBe(true);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("returns telegram_<status> when Telegram returns non-200", async () => {
    globalThis.fetch = vi.fn(async () => new Response("", { status: 401 }));
    const result = await sendDirectTelegramMessage({
      botToken: "bad-token",
      chatId: "8376373926",
      text: "Hey there — Maya here.",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("telegram_401");
  });

  it("returns telegram_payload_not_ok when Telegram returns ok:false", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, description: "blocked" }), {
        status: 200,
      })
    );
    const result = await sendDirectTelegramMessage({
      botToken: "bot-token",
      chatId: "8376373926",
      text: "Hey there — Maya here.",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("telegram_payload_not_ok");
  });

  it("returns ok with message_id on success", async () => {
    const result = await sendDirectTelegramMessage({
      botToken: "bot-token",
      chatId: "8376373926",
      text: "Hey there — Maya here.",
    });
    expect(result.ok).toBe(true);
    expect(result.reason).toBe("sent");
    expect(result.messageId).toBe(42);
  });

  it("POSTs to the correct Telegram URL with chat_id + text body", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), {
        status: 200,
      })
    );
    globalThis.fetch = fetchMock;
    await sendDirectTelegramMessage({
      botToken: "bot-123",
      chatId: "8376373926",
      text: "Hey there — Maya here.",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("https://api.telegram.org/botbot-123/sendMessage");
    const body = JSON.parse(call[1].body as string);
    expect(body.chat_id).toBe("8376373926");
    expect(body.text).toBe("Hey there — Maya here.");
    expect(body.disable_web_page_preview).toBe(true);
  });
});
