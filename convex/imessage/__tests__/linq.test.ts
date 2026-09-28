/**
 * X1: Linq direct, built from their public docs before we had an account. Linq's own audit list is
 * the spec (docs: Best Practices, Chat Health, Webhooks): no `from` on sends, an idempotency key on
 * each, one text per message, exact opt-out keywords with one override courtesy, a 2024 honoured and
 * never retried, Standard Webhooks signatures with a replay window, dedupe on redelivery, typing while
 * she thinks, the contact card at most daily, health as a pre-send gate, the silence ladder, and
 * line-status alerts. Five categories: cross-tenant (a chat id finds only its creator), fail-closed
 * (no secret, bad signature, stale timestamp), adversarial (keywords inside sentences, malformed
 * events, lookalike keywords), sibling coherence (Claw untouched when Linq is off), no TODOs.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { classifyError, isOptOutKeyword, parseLinqEvent, parseSendResult, sendBody, signWebhook, verifyWebhook } from "../../integrations/linq/client";
import { phoneRailHold, PHONE_RAIL, type RailInput } from "../../core/phoneRail";
import { phoneVendor } from "../../core/imessage";

const PHONE = "+15551234567";
const SECRET = `whsec_${Buffer.from("a-very-secret-key-for-tests-0001").toString("base64")}`;
const H = 3_600_000;

describe("Linq client (pure)", () => {
  it("a send has no `from`, the recipient as an array, and the idempotency key inside `message`", () => {
    const b = sendBody({ to: PHONE, parts: [{ type: "text", value: "hi" }], idempotencyKey: "row1:0" });
    expect(b).toEqual({ to: [PHONE], message: { parts: [{ type: "text", value: "hi" }], idempotency_key: "row1:0" } });
    expect("from" in b).toBe(false);
    expect(sendBody({ to: PHONE, parts: [{ type: "text", value: "bye" }], idempotencyKey: "k", overrideOptout: true }).override_optout).toBe(true);
  });

  it("the send answer is read from the documented shape; anything else is a named failure", () => {
    expect(parseSendResult({ chat_id: "c1", created_new_chat: true, from: "+15550001111", from_selection: { reason: "new_best_number" }, service: "iMessage", message: { id: "m1" } })).toMatchObject({ ok: true, messageId: "m1", chatId: "c1", from: "+15550001111", newChat: true, selection: "new_best_number", service: "iMessage" });
    expect(parseSendResult({ ok: true })).toMatchObject({ ok: false, reason: "the vendor answered in a shape I do not recognise" });
  });

  it("errors map to what we do about them: opted out is terminal, a restricted line and 429 retry, auth doesn't", () => {
    expect(classifyError(403, { code: 2024, message: "Recipient asked you to stop messaging them" }, null)).toMatchObject({ kind: "opted_out", retryable: false });
    expect(classifyError(403, { code: 2027, message: "restricted" }, null)).toMatchObject({ kind: "line_restricted", retryable: true });
    expect(classifyError(409, {}, null)).toMatchObject({ kind: "line_restricted", retryable: true });
    expect(classifyError(429, { code: 1007 }, "12")).toMatchObject({ kind: "rate_limited", retryable: true, retryAfterS: 12 });
    expect(classifyError(401, { code: 2004 }, null)).toMatchObject({ kind: "auth", retryable: false });
    expect(classifyError(500, { code: 3006 }, null)).toMatchObject({ kind: "server", retryable: true });
  });

  it("opt-out keywords are Linq's exact list, whole message; a sentence is not one (adversarial)", () => {
    for (const k of ["STOP", "UNSUBSCRIBE", "OPTOUT", "CANCEL", "END", "QUIT", " STOP ", "opt out", "Opt-Out", "OPTOUT", "optout"]) expect(isOptOutKeyword(k), k).toBe(true);
    for (const k of ["stop", "Stop", "please stop", "STOP IT", "cancel my plan", "the end", "quit my job lol", "STOPPED"]) expect(isOptOutKeyword(k), k).toBe(false);
  });

  it("signatures are Standard Webhooks, checked against an independent HMAC; stale, forged and missing are refused", async () => {
    const body = JSON.stringify({ event_type: "message.received", event_id: "e1", data: {} });
    const ts = 1_790_000_000;
    const sig = await signWebhook(SECRET, "msg_1", ts, body);
    const independent = `v1,${createHmac("sha256", Buffer.from(SECRET.slice(6), "base64")).update(`msg_1.${ts}.${body}`).digest("base64")}`;
    expect(sig).toBe(independent);
    expect(await verifyWebhook(SECRET, body, { id: "msg_1", timestamp: String(ts), signature: `v0,xyz ${sig}` }, ts + 30)).toEqual({ ok: true });
    expect(await verifyWebhook(SECRET, body, { id: "msg_1", timestamp: String(ts), signature: sig }, ts + 301)).toMatchObject({ ok: false });
    expect(await verifyWebhook(SECRET, `${body} `, { id: "msg_1", timestamp: String(ts), signature: sig }, ts)).toMatchObject({ ok: false, reason: "signature mismatch" });
    expect(await verifyWebhook(SECRET, body, { id: "msg_2", timestamp: String(ts), signature: sig }, ts)).toMatchObject({ ok: false });
    expect(await verifyWebhook(SECRET, body, { id: null, timestamp: String(ts), signature: sig }, ts)).toMatchObject({ ok: false });
  });

  it("events parse from the 2026-02-03 envelope; our own echo and unknown types are ignored", () => {
    const received = parseLinqEvent({ event_type: "message.received", event_id: "e1", data: { chat: { id: "c1", is_group: false, health_status: { status: "AT_RISK" } }, id: "m1", direction: "inbound", sender_handle: { handle: PHONE, is_me: false }, parts: [{ type: "text", value: "hey" }, { type: "media", url: "https://cdn.linqapp.com/a/v.mov", mime_type: "video/quicktime", size_bytes: 1234 }], service: "iMessage", sent_at: "2026-09-28T12:00:00Z" } });
    expect(received).toMatchObject({ type: "message", chatId: "c1", from: PHONE, text: "hey", health: "AT_RISK", media: [{ url: "https://cdn.linqapp.com/a/v.mov", mimeType: "video/quicktime", sizeBytes: 1234 }] });
    expect(parseLinqEvent({ event_type: "message.received", event_id: "e2", data: { direction: "inbound", sender_handle: { handle: "+1", is_me: true }, parts: [] } }).type).toBe("ignored");
    expect(parseLinqEvent({ event_type: "reaction.added", event_id: "e3", data: { chat_id: "c1", message_id: "m9", reaction_type: "love", is_from_me: false, from: PHONE } })).toMatchObject({ type: "reaction", reactionType: "love", added: true });
    expect(parseLinqEvent({ event_type: "phone_number.status_updated", event_id: "e4", data: { phone_number: "+15550001111", new_status: "FLAGGED", previous_status: "ACTIVE", new_reputation: "CRITICAL" } })).toMatchObject({ type: "line", status: "FLAGGED", reputation: "CRITICAL" });
    expect(parseLinqEvent({ event_type: "poll.sent", event_id: "e5", data: {} }).type).toBe("ignored");
    expect(parseLinqEvent({ nope: true }).type).toBe("ignored");
  });
});

describe("the phone rail (pure): Linq's chat health and back-off ladder", () => {
  const base: RailInput = { now: 10 * 24 * H, kind: "scout", health: "HEALTHY", lineState: null, optedOutAt: undefined, lastInboundAt: 9 * 24 * H, unanswered: [], proactiveToday: 0 };
  it("opted out, critical chat or line, or a flagged line holds every proactive text", () => {
    expect(phoneRailHold({ ...base, optedOutAt: 1 })).toMatch(/opted out/);
    expect(phoneRailHold({ ...base, health: "OPTED_OUT" })).toMatch(/opted out/);
    expect(phoneRailHold({ ...base, health: "CRITICAL" })).toMatch(/critical/);
    expect(phoneRailHold({ ...base, lineState: { status: "FLAGGED", reputation: null } })).toMatch(/critical/);
  });
  it("at risk: one proactive text a day", () => {
    expect(phoneRailHold({ ...base, health: "AT_RISK", proactiveToday: 0 })).toBeNull();
    expect(phoneRailHold({ ...base, health: "AT_RISK", proactiveToday: 1 })).toMatch(/at risk/);
  });
  it("silence: one follow-up after about a day, one more after a few days, one last quiet check-in, then nothing", () => {
    const t0 = base.now;
    expect(phoneRailHold({ ...base, unanswered: [] })).toBeNull();
    expect(phoneRailHold({ ...base, unanswered: [{ ts: t0 - 2 * H, kind: "scout" }] })).toMatch(/about a day/);
    expect(phoneRailHold({ ...base, kind: "reminder", unanswered: [{ ts: t0 - 2 * H, kind: "plan" }] }), "a reminder for a shoot they booked").toBeNull();
    // The flaker on shoot day: prep and check-in unanswered, then "how'd it go" still goes, and the
    // next morning's "didn't happen, put it back?" counts only the how'd-it-go.
    const shootDay = [{ ts: t0 - 10 * H, kind: "reminder" }, { ts: t0 - 3 * H, kind: "reminder" }];
    expect(phoneRailHold({ ...base, kind: "checkin", unanswered: shootDay })).toBeNull();
    expect(phoneRailHold({ ...base, kind: "morning", unanswered: shootDay })).toBeNull();
    // Silent for over three days: shoot texts count and wait like everything else.
    const silent = { ...base, lastInboundAt: t0 - 4 * 24 * H };
    expect(phoneRailHold({ ...silent, kind: "checkin", unanswered: [...shootDay, { ts: t0 - 2 * H, kind: "scout" }] })).toMatch(/quiet until they write/);
    expect(phoneRailHold({ ...base, unanswered: [{ ts: t0 - PHONE_RAIL.firstFollowUpAfterMs, kind: "scout" }] })).toBeNull();
    const two = [{ ts: t0 - 4 * 24 * H, kind: "scout" }, { ts: t0 - 2 * 24 * H, kind: "morning" }];
    expect(phoneRailHold({ ...base, unanswered: two })).toMatch(/few days/);
    expect(phoneRailHold({ ...base, unanswered: [two[0], { ts: t0 - PHONE_RAIL.secondFollowUpAfterMs, kind: "morning" }] })).toBeNull();
    const three = [...two, { ts: t0 - 24 * H, kind: "scout" }];
    expect(phoneRailHold({ ...base, unanswered: three })).toMatch(/quiet until they write/);
    expect(phoneRailHold({ ...base, kind: "quiet", unanswered: three }), "the one last easy-out check-in").toBeNull();
    expect(phoneRailHold({ ...base, kind: "quiet", unanswered: [...three, { ts: t0 - H, kind: "quiet" }] })).toMatch(/quiet until they write/);
  });
});

type Sent = { url: string; method: string; body: Record<string, unknown> | null };

describe("Linq on the rows, with the vendor's HTTP faked at fetch", () => {
  let sent: Sent[] = [];
  let reply: (url: string, body: Record<string, unknown> | null) => Response = () => new Response("{}", { status: 200 });
  beforeEach(() => {
    process.env.MODEL_FAKE = "1";
    process.env.LINQ_API_KEY = "linq_test_key";
    process.env.LINQ_WEBHOOK_SECRET = SECRET;
    sent = [];
    reply = (url, body) => url.endsWith("/v3/messages") ? Response.json({ chat_id: "chat-1", created_new_chat: false, from: "+15550001111", from_selection: { reason: "reused_active_chat" }, service: "iMessage", message: { id: `m-${String((body?.message as { idempotency_key?: string })?.idempotency_key)}` } }, { status: 202 }) : new Response(null, { status: 204 });
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith("https://api.linqapp.com/")) throw new Error(`unexpected fetch ${url}`);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      sent.push({ url, method: init?.method ?? "GET", body });
      return reply(url, body);
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); delete process.env.LINQ_API_KEY; delete process.env.LINQ_WEBHOOK_SECRET; });

  async function paired(t: ReturnType<typeof convexTest>, key = "a", phone = PHONE, extra: Record<string, unknown> = {}) {
    return await t.run((ctx) => seedCreator(ctx, key, { phone, channel: { paired: true, kind: "imessage", pairedAt: Date.now() - 24 * H, ...extra } }));
  }

  it("with a Linq key, Linq carries the channel; without one, Claw does, as before (sibling coherence)", () => {
    expect(phoneVendor()).toBe("linq");
    delete process.env.LINQ_API_KEY;
    process.env.CLAW_API_KEY = "cm";
    expect(phoneVendor()).toBe("claw");
    delete process.env.CLAW_API_KEY;
    expect(phoneVendor()).toBeNull();
  });

  it("delivery: one text per message, no `from`, a key per part, the chat kept, the card offered once a day", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await paired(t);
    const messageId = await t.run((ctx) => ctx.db.insert("messages", { creatorId, direction: "out", surface: "imessage", body: "first part\n---\nsecond part", ts: Date.now() } as never)) as Id<"messages">;
    const r = await t.action(internal.core.imessage.deliver, { messageId, phone: PHONE, body: "first part\n---\nsecond part", buttons: [{ id: "a:1", label: "yes" }, { id: "a:2", label: "later" }] });
    expect(r.delivered).toBe(true);
    const sends = sent.filter((s) => s.url.endsWith("/v3/messages"));
    expect(sends).toHaveLength(2);
    for (const s of sends) {
      expect("from" in (s.body ?? {})).toBe(false);
      expect(((s.body!.message as { parts: unknown[] }).parts)).toHaveLength(1);
    }
    expect(sends.map((s) => (s.body!.message as { idempotency_key: string }).idempotency_key)).toEqual([`${messageId}:0`, `${messageId}:1`]);
    expect(((sends[1].body!.message as { parts: Array<{ value: string }> }).parts[0].value)).toMatch(/\(reply 1 for yes, 2 for later/);
    const c = await t.run((ctx) => ctx.db.get(creatorId));
    expect(c?.channel).toMatchObject({ chatId: "chat-1", line: "+15550001111" });
    expect(sent.filter((s) => s.url.endsWith("/share_contact_card"))).toHaveLength(1);
    // A second delivery the same day doesn't offer the card again.
    const m2 = await t.run((ctx) => ctx.db.insert("messages", { creatorId, direction: "out", surface: "imessage", body: "later", ts: Date.now() } as never)) as Id<"messages">;
    await t.action(internal.core.imessage.deliver, { messageId: m2, phone: PHONE, body: "later" });
    expect(sent.filter((s) => s.url.endsWith("/share_contact_card"))).toHaveLength(1);
  });

  it("a 2024 refusal marks them opted out and is not retried; the rail then holds every proactive text", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await paired(t);
    reply = () => Response.json({ code: 2024, message: "Recipient asked you to stop messaging them" }, { status: 403 });
    const messageId = await t.run((ctx) => ctx.db.insert("messages", { creatorId, direction: "out", surface: "imessage", body: "an idea", ts: Date.now() } as never)) as Id<"messages">;
    const r = await t.action(internal.core.imessage.deliver, { messageId, phone: PHONE, body: "an idea" });
    expect(r.delivered).toBe(false);
    expect(r.reason).toMatch(/not retryable/);
    expect((await t.run((ctx) => ctx.db.get(creatorId)))?.channel.optedOutAt).toBeTypeOf("number");
    const held = await t.mutation(internal.core.messages.send, { creatorId, surface: "telegram", body: "another idea", dedupeKey: "idea:2", proactive: true, kind: "scout" });
    expect(held.held).toMatch(/phone rail: they opted out/);
  });

  it("STOP: recorded, opted out, one courtesy with override_optout, no turn; their next text lifts it", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await paired(t);
    const r = await t.action(internal.core.imessage.handleText, { from: PHONE, text: "STOP", channelMessageId: "in-1" });
    expect(r.reason).toBe("opted out");
    expect((await t.run((ctx) => ctx.db.get(creatorId)))?.channel.optedOutAt).toBeTypeOf("number");
    const courtesy = sent.filter((s) => s.url.endsWith("/v3/messages"));
    expect(courtesy).toHaveLength(1);
    expect(courtesy[0].body?.override_optout).toBe(true);
    expect((await t.run((ctx) => ctx.db.query("jobs").collect())).some((j) => j.kind === "converse"), "a keyword is not a conversation").toBe(false);
    // A second STOP sends nothing more (the override is used once per opt-out, never in a loop).
    await t.action(internal.core.imessage.handleText, { from: PHONE, text: "STOP", channelMessageId: "in-2" });
    expect(sent.filter((s) => s.url.endsWith("/v3/messages"))).toHaveLength(1);
    await t.action(internal.core.imessage.handleText, { from: PHONE, text: "ok i'm back", channelMessageId: "in-3" });
    expect((await t.run((ctx) => ctx.db.get(creatorId)))?.channel.optedOutAt).toBeUndefined();
  });

  it("the webhook: a signed text becomes a turn with typing; a redelivery is a no-op; forged, stale and unconfigured are refused", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // Linq answers a send in the chat the person is already in.
    const base = reply;
    reply = (url, b) => url.endsWith("/v3/messages") ? Response.json({ chat_id: "chat-9", created_new_chat: false, from: "+15550001111", from_selection: { reason: "reused_active_chat" }, service: "iMessage", message: { id: `m-${String((b?.message as { idempotency_key?: string })?.idempotency_key)}` } }, { status: 202 }) : base(url, b);
    const t = convexTest(schema, modules);
    const creatorId = await paired(t);
    const body = JSON.stringify({ event_type: "message.received", event_id: "ev-1", data: { chat: { id: "chat-9", is_group: false, health_status: { status: "HEALTHY" } }, id: "lm-1", direction: "inbound", sender_handle: { handle: PHONE, is_me: false }, parts: [{ type: "text", value: "what should i post today?" }], service: "iMessage", sent_at: new Date().toISOString() } });
    const ts = Math.floor(Date.now() / 1000);
    const headers = { "webhook-id": "ev-1", "webhook-timestamp": String(ts), "webhook-signature": await signWebhook(SECRET, "ev-1", ts, body) };
    expect((await t.fetch("/linq/webhook", { method: "POST", headers, body })).status).toBe(200);
    expect((await t.fetch("/linq/webhook", { method: "POST", headers, body })).status, "redelivery is acknowledged").toBe(200);
    // The webhook schedules handleText, which schedules typing and queues her turn: a few rounds.
    for (let i = 0; i < 4; i++) { vi.advanceTimersByTime(1); await t.finishInProgressScheduledFunctions(); }
    const rows = await t.run((ctx) => ctx.db.query("messages").collect());
    expect(rows.filter((m) => m.direction === "in"), "one row, however many deliveries").toHaveLength(1);
    expect(rows.some((m) => m.direction === "out" && m.deliveredAt && m.surface === "imessage"), "her reply went out through Linq").toBe(true);
    expect((await t.run((ctx) => ctx.db.get(creatorId)))?.channel).toMatchObject({ chatId: "chat-9", health: "HEALTHY" });
    expect(sent.some((s) => s.url.endsWith("/v3/chats/chat-9/typing"))).toBe(true);
    expect((await t.fetch("/linq/webhook", { method: "POST", headers: { ...headers, "webhook-signature": "v1,AAAA" }, body })).status).toBe(401);
    expect((await t.fetch("/linq/webhook", { method: "POST", headers: { ...headers, "webhook-timestamp": String(ts - 3600) }, body })).status).toBe(401);
    delete process.env.LINQ_WEBHOOK_SECRET;
    expect((await t.fetch("/linq/webhook", { method: "POST", headers, body })).status).toBe(503);
  });

  it("health from a chat event reaches only that chat's creator (cross-tenant); a flagged line alerts the operator", async () => {
    const t = convexTest(schema, modules);
    const a = await paired(t, "a", PHONE, { chatId: "chat-a" });
    const b = await paired(t, "b", "+15557654321", { chatId: "chat-b" });
    await t.mutation(internal.imessage.linqEvents.healthByChat, { chatId: "chat-a", health: "CRITICAL" });
    expect((await t.run((ctx) => ctx.db.get(a)))?.channel.health).toBe("CRITICAL");
    expect((await t.run((ctx) => ctx.db.get(b)))?.channel.health).toBeUndefined();
    expect((await t.mutation(internal.core.messages.send, { creatorId: a, surface: "telegram", body: "idea", dedupeKey: "i:a", proactive: true, kind: "scout" })).held).toMatch(/critical/);
    expect((await t.mutation(internal.core.messages.send, { creatorId: a, surface: "telegram", body: "a reply", dedupeKey: "r:a", proactive: false, kind: "reply" })).sent, "a reply to them always goes").toBe(true);
    const r = await t.mutation(internal.imessage.linqEvents.line, { phoneNumber: "+15550001111", status: "FLAGGED", reputation: "CRITICAL", previousStatus: "ACTIVE" });
    expect(r.bad).toBe(true);
    const health = await t.run((ctx) => ctx.db.query("vendorHealth").collect());
    expect(health.some((h) => h.vendor === "linq" && !h.ok)).toBe(true);
  });

  it("the silence ladder, on rows: after one unanswered idea the next waits; their reply resets it", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await paired(t);
    await t.run((ctx) => ctx.db.insert("messages", { creatorId, direction: "in", surface: "imessage", body: "hi", ts: Date.now() - 3 * H } as never));
    expect((await t.mutation(internal.core.messages.send, { creatorId, surface: "telegram", body: "idea 1", dedupeKey: "i1", proactive: true, kind: "scout" })).sent).toBe(true);
    expect((await t.mutation(internal.core.messages.send, { creatorId, surface: "telegram", body: "idea 2", dedupeKey: "i2", proactive: true, kind: "scout" })).held).toMatch(/about a day/);
    await t.run((ctx) => ctx.db.insert("messages", { creatorId, direction: "in", surface: "imessage", body: "ooh yes", ts: Date.now() } as never));
    expect((await t.mutation(internal.core.messages.send, { creatorId, surface: "telegram", body: "idea 3", dedupeKey: "i3", proactive: true, kind: "scout" })).sent).toBe(true);
  });

  it("a Telegram creator never meets the phone rail (sibling coherence)", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "tg", { channel: { paired: true, kind: "telegram" } }));
    expect((await t.mutation(internal.core.messages.send, { creatorId, surface: "telegram", body: "idea 1", dedupeKey: "i1", proactive: true, kind: "scout" })).sent).toBe(true);
    expect((await t.mutation(internal.core.messages.send, { creatorId, surface: "telegram", body: "idea 2", dedupeKey: "i2", proactive: true, kind: "scout" })).sent).toBe(true);
  });
});
