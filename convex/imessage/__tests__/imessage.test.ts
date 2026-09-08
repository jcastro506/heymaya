/**
 * Her number (plan §23, Sprint 6). The five categories: cross-tenant (a phone belongs to one
 * creator), budget × action fail-closed (no key, bad signature, replay), adversarial input
 * (menus, tapbacks, malformed events, bad phones), sibling coherence (every writer lands on
 * the creator's channel; the reaction path finds the reacted message), and no TODOs.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { menuLine, menuPick, pairingSmsLink, parseStartText, reactionEmoji } from "../../core/imessage";
import { normalizePhone, parseClawEvent, parseSendResult, sendBody, signPayload, verifySignature } from "../../integrations/claw/client";

const NOW = Date.now();
const PHONE = "+15551234567";

describe("her number: the pure parts", () => {
  it("phones are E.164 or nothing (adversarial)", () => {
    expect(normalizePhone("(555) 123-4567")).toBe(PHONE);
    expect(normalizePhone("1 555 123 4567")).toBe(PHONE);
    expect(normalizePhone("+44 7700 900123")).toBe("+447700900123");
    expect(normalizePhone("+1 555 123 4567")).toBe(PHONE);
    expect(normalizePhone("555-1234")).toBeNull();
    expect(normalizePhone("hello")).toBeNull();
    expect(normalizePhone("+")).toBeNull();
    expect(normalizePhone("123456789012345678")).toBeNull();
  });

  it("a menu line stands in for buttons; a pick is a number, a yes/no, or the exact label", () => {
    const buttons = [{ id: "idea:x:shotlist", label: "shot list" }, { id: "idea:x:notme", label: "not me" }, { id: "idea:x:save", label: "save" }];
    expect(menuLine(buttons)).toBe("(reply 1 for shot list, 2 for not me, 3 for save, or just tell me)");
    expect(menuPick("1", buttons)).toBe("idea:x:shotlist");
    expect(menuPick(" 3! ", buttons)).toBe("idea:x:save");
    expect(menuPick("Shot List", buttons)).toBe("idea:x:shotlist");
    expect(menuPick("4", buttons)).toBeNull();
    expect(menuPick("1", undefined), "a number with no menu is text").toBeNull();
    expect(menuPick("love it, filming tomorrow", buttons)).toBeNull();
    expect(menuPick("10", buttons)).toBeNull();
    const yn = [{ id: "block:b:yes", label: "block it" }, { id: "block:b:no", label: "not now" }];
    expect(menuLine(yn)).toBe("(reply yes or no, or just tell me)");
    expect(menuPick("yes", yn)).toBe("block:b:yes");
    expect(menuPick("Yeah.", yn)).toBe("block:b:yes");
    expect(menuPick("nope", yn)).toBe("block:b:no");
    expect(menuPick("2", yn)).toBe("block:b:no");
    expect(menuPick("maybe thursday", yn)).toBeNull();
    expect(menuLine([])).toBe("");
  });

  it("tapbacks map to the emoji the reaction path knows, and the rest are nothing", () => {
    expect(reactionEmoji("love", null, true)).toBe("❤");
    expect(reactionEmoji("like", null, true)).toBe("👍");
    expect(reactionEmoji("laugh", null, true)).toBe("😂");
    expect(reactionEmoji("dislike", null, true)).toBe("👎");
    expect(reactionEmoji("custom", "🔥", true)).toBe("🔥");
    expect(reactionEmoji("custom", "x".repeat(40), true), "a custom reaction that is not an emoji is nothing").toBeNull();
    expect(reactionEmoji("emphasize", null, true)).toBeNull();
    expect(reactionEmoji("question", null, true)).toBeNull();
    expect(reactionEmoji("unknown", null, true)).toBeNull();
    expect(reactionEmoji("love", null, false)).toBe("removed");
  });

  it("the pairing text and link", () => {
    expect(parseStartText("START abc123abc123abc123")).toBe("abc123abc123abc123");
    expect(parseStartText("  start   ABCDEF0123456789  ")).toBe("abcdef0123456789");
    expect(parseStartText("start")).toBeNull();
    expect(parseStartText("hey")).toBeNull();
    expect(pairingSmsLink("+15550001111", "tok", "ios")).toBe("sms:+15550001111&body=START%20tok");
    expect(pairingSmsLink("+15550001111", "tok", "android")).toBe("sms:+15550001111?body=START%20tok");
  });

  it("the vendor's events are read defensively: a shape we do not know is ignored, never a throw", () => {
    expect(parseClawEvent({ type: "message", messageId: "m1", from: PHONE, text: "hi", service: "iMessage", sentAt: "2026-09-08T11:22:33Z" })).toMatchObject({ type: "message", messageId: "m1", from: PHONE, text: "hi", service: "iMessage", attachments: [] });
    expect(parseClawEvent({ type: "message", from: PHONE, text: "no id" })).toMatchObject({ type: "ignored" });
    expect(parseClawEvent({ type: "message", messageId: "m2", from: PHONE, text: "", attachments: [{ url: "https://x/a.jpg", mimeType: "image/jpeg" }, { url: "javascript:alert(1)", mimeType: "x" }] })).toMatchObject({ type: "message", attachments: [{ url: "https://x/a.jpg", mimeType: "image/jpeg" }] });
    expect(parseClawEvent({ type: "reaction", from: PHONE, messageId: "m1", reactionType: "love", added: true })).toMatchObject({ type: "reaction", reactionType: "love", added: true });
    expect(parseClawEvent({ type: "reaction", from: PHONE, messageId: "m1", reactionType: "sparkle", remove: true })).toMatchObject({ type: "reaction", reactionType: "unknown", added: false });
    expect(parseClawEvent({ type: "typing", from: PHONE })).toMatchObject({ type: "ignored" });
    expect(parseClawEvent({ type: "whatever" })).toMatchObject({ type: "ignored", why: "unknown event type whatever" });
    expect(parseClawEvent(null)).toMatchObject({ type: "ignored" });
    expect(parseClawEvent("string")).toMatchObject({ type: "ignored" });
    const long = parseClawEvent({ type: "message", messageId: "m3", from: PHONE, text: "x".repeat(9000) });
    expect(long.type === "message" && long.text.length).toBe(4000);
  });

  it("the send body and the vendor's answer", () => {
    expect(sendBody({ to: PHONE, text: "hi" })).toEqual({ to: PHONE, parts: [{ type: "text", value: "hi" }] });
    expect(sendBody({ to: PHONE, text: "hi", mediaUrls: ["https://x/1.png"], service: "SMS" })).toMatchObject({ service: "SMS", parts: [{ type: "text", value: "hi" }, { type: "media", url: "https://x/1.png" }] });
    expect(parseSendResult(200, { ok: true, messageId: "abc", status: "accepted", service: "iMessage" })).toMatchObject({ ok: true, messageId: "abc", service: "iMessage" });
    expect(parseSendResult(200, { ok: false, error: "Monthly message limit reached" })).toMatchObject({ ok: false, reason: "Monthly message limit reached" });
    expect(parseSendResult(429, { error: "slow down" })).toMatchObject({ ok: false, retryable: true });
    expect(parseSendResult(401, {})).toMatchObject({ ok: false, retryable: false });
    expect(parseSendResult(200, { weird: true }), "an unknown shape is never a success").toMatchObject({ ok: false });
  });

  it("the signature: ours verifies, a stale or forged one does not (fail-closed)", async () => {
    const secret = "s3cret";
    const body = JSON.stringify({ type: "message", messageId: "m1", from: PHONE, text: "hi" });
    const nowS = Math.floor(NOW / 1000);
    const header = await signPayload(secret, body, nowS);
    expect(await verifySignature(secret, body, header, nowS + 10)).toEqual({ ok: true });
    expect(await verifySignature("other", body, header, nowS)).toMatchObject({ ok: false, reason: "bad signature" });
    expect(await verifySignature(secret, body + " ", header, nowS)).toMatchObject({ ok: false, reason: "bad signature" });
    expect(await verifySignature(secret, body, header, nowS + 600)).toMatchObject({ ok: false, reason: "signature too old" });
    expect(await verifySignature(secret, body, null, nowS)).toMatchObject({ ok: false, reason: "no signature" });
    expect(await verifySignature(secret, body, "garbage", nowS)).toMatchObject({ ok: false, reason: "malformed signature" });
  });

  it("sibling coherence: the route, the writer's channel switch, the smoke check, the deletion, no TODOs", () => {
    const http = readFileSync(new URL("../../http.ts", import.meta.url), "utf8");
    expect(http).toMatch(/\/imessage\/webhook/);
    const messages = readFileSync(new URL("../../core/messages.ts", import.meta.url), "utf8");
    expect(messages, "the one writer resolves the surface to the creator's channel").toMatch(/owner\?\.channel\.kind === "imessage" \? "imessage" : "telegram"/);
    const telegram = readFileSync(new URL("../../core/telegram.ts", import.meta.url), "utf8");
    expect(telegram, "deliverMessage delegates, it never has a second path").toMatch(/target\.surface === "imessage"/);
    const deletion = readFileSync(new URL("../../account/deletion.ts", import.meta.url), "utf8");
    expect(deletion).toMatch(/creator\.channel\.kind === "imessage" && creator\.phone/);
    const smoke = readFileSync(new URL("../../core/smoke.ts", import.meta.url), "utf8");
    expect(smoke).toMatch(/vendor: "claw"/);
    for (const f of ["../../core/imessage.ts", "../../integrations/claw/client.ts", "../webhook.ts", "../../../services/claw-relay/index.mjs"]) expect(readFileSync(new URL(f, import.meta.url), "utf8")).not.toMatch(/TODO|FIXME/);
  });
});

describe("her number: rows and doors, on the fake vendor", () => {
  beforeEach(() => { process.env.MODEL_FAKE = "1"; process.env.CLAW_FAKE = "1"; process.env.CLAW_API_KEY = "cm_live_test"; process.env.CLAW_LINE_NUMBER = "+15550009999"; });
  afterEach(() => { delete process.env.CLAW_FAKE; delete process.env.CLAW_API_KEY; delete process.env.CLAW_LINE_NUMBER; });

  it("a creator who gave a number pairs by texting START, hears hello, and every row after is on the phone", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { phone: PHONE, channel: { paired: false, kind: "imessage" } }));
    const creator = await t.run((ctx) => ctx.db.get(creatorId));
    const minted = await t.run(async (ctx) => { const { mintPairing } = await import("../../core/pairing"); return await mintPairing(ctx, creator!); });
    expect(minted.ok && minted.kind).toBe("imessage");
    expect(minted.ok && minted.deepLink).toMatch(/^sms:\+15550009999&body=START%20/);
    const token = minted.ok ? minted.token : "";
    const r = await t.action(internal.core.imessage.handleText, { from: "(555) 123-4567", text: `START ${token}`, channelMessageId: "v1" });
    expect(r).toMatchObject({ ok: true, reason: "paired" });
    const after = await t.run((ctx) => ctx.db.get(creatorId));
    expect(after?.channel).toMatchObject({ paired: true, kind: "imessage" });
    expect(after?.pairingToken).toBeUndefined();
    const rows = await t.run((ctx) => ctx.db.query("messages").collect());
    const hello = rows.find((m) => m.dedupeKey === `hello:${creatorId}`);
    expect(hello?.surface, "the writer was told telegram; the row is the creator's channel").toBe("imessage");
    expect(rows.every((m) => m.surface !== "telegram")).toBe(true);
    const jobs = await t.run((ctx) => ctx.db.query("jobs").collect());
    expect(jobs.some((j) => j.kind === "first_read")).toBe(true);
    expect(jobs.some((j) => j.kind === "deliver_message")).toBe(true);
  });

  it("a number they typed pairs on any first text, and a stranger's number is told where to sign up", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { phone: PHONE, channel: { paired: false, kind: "imessage" } }));
    const r = await t.action(internal.core.imessage.handleText, { from: PHONE, text: "hey maya", channelMessageId: "v2" });
    expect(r).toMatchObject({ ok: true, reason: "paired" });
    expect((await t.run((ctx) => ctx.db.get(creatorId)))?.channel.paired).toBe(true);
    const stranger = await t.action(internal.core.imessage.handleText, { from: "+15559990000", text: "hi", channelMessageId: "v3" });
    expect(stranger).toMatchObject({ ok: false, reason: "unknown number" });
    expect((await t.run((ctx) => ctx.db.query("messages").collect())).some((m) => m.channelMessageId === "v3")).toBe(false);
  });

  it("a phone belongs to one creator: pairing it to B moves it off A and marks A broken (cross-tenant)", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => seedCreator(ctx, "a", { phone: PHONE, channel: { paired: true, kind: "imessage", pairedAt: NOW } }));
    const b = await t.run((ctx) => seedCreator(ctx, "b", { channel: { paired: false, kind: "imessage" } }));
    const rowB = await t.run((ctx) => ctx.db.get(b));
    const minted = await t.run(async (ctx) => { const { mintPairing } = await import("../../core/pairing"); return await mintPairing(ctx, rowB!); });
    const token = minted.ok ? minted.token : "";
    const r = await t.action(internal.core.imessage.handleText, { from: PHONE, text: `start ${token}`, channelMessageId: "v4" });
    expect(r).toMatchObject({ ok: true, reason: "paired" });
    const rowA = await t.run((ctx) => ctx.db.get(a));
    expect(rowA?.phone).toBeUndefined();
    expect(rowA?.channel).toMatchObject({ paired: false, broken: true });
    expect((await t.run((ctx) => ctx.db.get(b)))?.phone).toBe(PHONE);
    // A's token cannot pair B's phone: the token names the creator, the phone follows it.
    const rowA2 = await t.run((ctx) => ctx.db.get(a));
    const mintedA = await t.run(async (ctx) => { const { mintPairing } = await import("../../core/pairing"); return await mintPairing(ctx, rowA2!); });
    expect(mintedA.ok).toBe(true);
    const back = await t.action(internal.core.imessage.handleText, { from: PHONE, text: `START ${mintedA.ok ? mintedA.token : ""}`, channelMessageId: "v5" });
    expect(back).toMatchObject({ ok: true });
    expect((await t.run((ctx) => ctx.db.get(b)))?.phone, "the phone moved back; it never lives on two rows").toBeUndefined();
  });

  it("a text is a turn; a number is a tap when there is a live menu and text when there is not; a replay is dropped", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { phone: PHONE, channel: { paired: true, kind: "imessage", pairedAt: NOW } }));
    const one = await t.action(internal.core.imessage.handleText, { from: PHONE, text: "1", channelMessageId: "v6" });
    expect(one.ok).toBe(true);
    let rows = await t.run((ctx) => ctx.db.query("messages").collect());
    expect(rows.find((m) => m.channelMessageId === "v6")?.kind, "no menu: a bare number is text").toBe("inbound");
    await t.mutation(internal.core.messages.send, { creatorId, surface: "telegram", body: "an idea", dedupeKey: "idea:1", proactive: true, kind: "scout", buttons: [{ id: "idea:x:shotlist", label: "shot list" }, { id: "idea:x:notme", label: "not me" }] });
    const two = await t.action(internal.core.imessage.handleText, { from: PHONE, text: "2", channelMessageId: "v7" });
    expect(two.ok).toBe(true);
    rows = await t.run((ctx) => ctx.db.query("messages").collect());
    const tap = rows.find((m) => m.channelMessageId === "v7");
    expect(tap?.kind).toBe("button");
    expect(tap?.body).toBe("idea:x:notme");
    const label = await t.action(internal.core.imessage.handleText, { from: PHONE, text: "Shot list", channelMessageId: "v8" });
    expect(label.ok).toBe(true);
    expect((await t.run((ctx) => ctx.db.query("messages").collect())).find((m) => m.channelMessageId === "v8")?.body).toBe("idea:x:shotlist");
    const replay = await t.action(internal.core.imessage.handleText, { from: PHONE, text: "2", channelMessageId: "v7" });
    expect(replay).toMatchObject({ ok: true, reason: "duplicate" });
    expect((await t.run((ctx) => ctx.db.query("messages").collect())).filter((m) => m.channelMessageId === "v7").length).toBe(1);
    const jobs = (await t.run((ctx) => ctx.db.query("jobs").collect())).filter((j) => j.kind === "converse");
    expect(jobs.length).toBe(3);
    const long = await t.action(internal.core.imessage.handleText, { from: PHONE, text: "y".repeat(3000), channelMessageId: "v9" });
    expect(long.ok).toBe(true);
  });

  it("a tapback on an idea is a taste event; an unknown tapback, or one on a message we cannot find, breaks nothing", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { phone: PHONE, channel: { paired: true, kind: "imessage", pairedAt: NOW } }));
    const ideaId = await t.run((ctx) => ctx.db.insert("ideas", { creatorId, evidenceLinks: [], fit: "yes", fitWhy: "x", version: { hook: "h" }, messageText: "m", produced: { skillVersion: "t", model: "m", thresholdsVersion: "t" }, sentAt: NOW, status: "sent", createdAt: NOW } as never));
    const { messageId } = await t.mutation(internal.core.messages.send, { creatorId, surface: "telegram", body: "an idea", dedupeKey: "idea:2", proactive: true, kind: "scout" });
    await t.run((ctx) => ctx.db.patch(messageId, { ideaId, channelMessageId: "vendor-out-1" }));
    const heart = await t.action(internal.core.imessage.handleReaction, { from: PHONE, aboutChannelMessageId: "vendor-out-1", reactionType: "love", added: true });
    expect(heart.ok).toBe(true);
    const rx = (await t.run((ctx) => ctx.db.query("messages").collect())).find((m) => m.kind === "reaction");
    expect(rx?.body).toBe("❤");
    expect(rx?.telegramMessageId).toBe("vendor-out-1");
    const found = await t.query(internal.agent.converse.messageByTelegramId, { creatorId, telegramMessageId: "vendor-out-1" });
    expect(found?.ideaId, "the reaction path finds the reacted message by the vendor id").toBe(ideaId);
    // Run her turn on it: a taste event lands, no reply is written.
    await t.action(internal.agent.converse.run, { creatorId, messageId: rx!._id });
    const taste = await t.run((ctx) => ctx.db.query("tasteEvents").collect());
    expect(taste.map((e) => e.kind)).toEqual(["heart"]);
    const shrug = await t.action(internal.core.imessage.handleReaction, { from: PHONE, aboutChannelMessageId: "vendor-out-1", reactionType: "emphasize", added: true });
    expect(shrug).toMatchObject({ ok: true, reason: expect.stringContaining("noticed") });
    const nowhere = await t.action(internal.core.imessage.handleReaction, { from: PHONE, aboutChannelMessageId: "never-sent", reactionType: "dislike", added: true });
    expect(nowhere.ok).toBe(true);
    const stranger = await t.action(internal.core.imessage.handleReaction, { from: "+15550000000", aboutChannelMessageId: "vendor-out-1", reactionType: "love", added: true });
    expect(stranger.ok).toBe(false);
    expect((await t.run((ctx) => ctx.db.query("tasteEvents").collect())).length).toBe(1);
  });

  it("delivery: the menu line rides on the last text; no key is a named failure on the row (fail-closed)", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { phone: PHONE, channel: { paired: true, kind: "imessage", pairedAt: NOW } }));
    const { messageId } = await t.mutation(internal.core.messages.send, { creatorId, surface: "telegram", body: "first\n---\nsecond", dedupeKey: "d:1", proactive: false, kind: "reply", buttons: [{ id: "idea:x:save", label: "save" }] });
    const r = await t.action(internal.core.telegram.deliverMessage, { messageId });
    expect(r).toEqual({ delivered: true });
    const row = await t.run((ctx) => ctx.db.get(messageId));
    expect(row?.surface).toBe("imessage");
    expect(typeof row?.deliveredAt).toBe("number");
    expect(row?.channelMessageId).toMatch(/^fake_/);
    delete process.env.CLAW_API_KEY;
    const { messageId: m2 } = await t.mutation(internal.core.messages.send, { creatorId, surface: "telegram", body: "again", dedupeKey: "d:2", proactive: false, kind: "reply" });
    const r2 = await t.action(internal.core.telegram.deliverMessage, { messageId: m2 });
    expect(r2).toMatchObject({ delivered: false, reason: "the phone channel isn't configured" });
    expect((await t.run((ctx) => ctx.db.get(m2)))?.deliveryError).toBe("the phone channel isn't configured");
  });

  it("a creator without a number still goes to Telegram: nothing existing changes", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { channel: { paired: true, pairedAt: NOW }, telegramChatId: "42" }));
    const { messageId } = await t.mutation(internal.core.messages.send, { creatorId, surface: "telegram", body: "hi", dedupeKey: "t:1", proactive: false, kind: "reply" });
    expect((await t.run((ctx) => ctx.db.get(messageId)))?.surface).toBe("telegram");
  });
});
