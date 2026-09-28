/**
 * A fake Linq (X1), served by our own HTTP router so the real channel code runs end to end on dev
 * before we have an account: sends, typing, the contact card, onboarding's line pick, and signed
 * inbound webhooks. Same rules as the other fakes (eval/fakes.ts): it answers only when EVAL_FAKES=1
 * on a local deployment, and a deployment reaches it only through LINQ_BASE_URL pointing at itself,
 * so nothing it does can text a real phone. The e2e run's creator has a fictional 555-01xx number.
 *
 * It behaves as Linq's docs say: `to` array and no `from`; the idempotency key returns the original
 * send; a recipient who texted STOP is refused with 403 / 2024 unless `override_optout`; one chat per
 * person; typing and card shares answer 204.
 */
import { v } from "convex/values";
import { httpAction, internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { signWebhook } from "../integrations/linq/client";

const fakesOn = () => process.env.EVAL_FAKES === "1" && process.env.ENVIRONMENT_NAME === "local";
const KEY = "eval:fake_linq";
const LINE = "+15550100000";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

type Sent = { at: number; to: string; key: string; text: string; media: number; override: boolean; id: string };
type Log = { sends: Sent[]; typing: Array<{ at: number; chatId: string }>; cards: Array<{ at: number; chatId: string }>; optedOut: string[] };
const empty = (): Log => ({ sends: [], typing: [], cards: [], optedOut: [] });

export const log = internalQuery({ args: {}, handler: async (ctx): Promise<Log> => {
  const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", KEY)).unique();
  return row ? (JSON.parse(row.value) as Log) : empty();
} });
export const writeLog = internalMutation({ args: { value: v.string() }, handler: async (ctx, a): Promise<null> => {
  const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", KEY)).unique();
  if (row) await ctx.db.patch(row._id, { value: a.value, updatedAt: Date.now() }); else await ctx.db.insert("syncState", { key: KEY, value: a.value, updatedAt: Date.now() });
  return null;
} });

/** One atomic change to the log (read-modify-write from actions raced: a STOP write erased a card share). */
export const logOp = internalMutation({ args: { op: v.union(v.literal("send"), v.literal("typing"), v.literal("card"), v.literal("optout"), v.literal("optin")), entry: v.optional(v.any()), phone: v.optional(v.string()) }, handler: async (ctx, a): Promise<null> => {
  const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", KEY)).unique();
  const l: Log = row ? JSON.parse(row.value) : empty();
  if (a.op === "send") l.sends.push(a.entry as Sent);
  if (a.op === "typing") l.typing.push(a.entry as { at: number; chatId: string });
  if (a.op === "card") l.cards.push(a.entry as { at: number; chatId: string });
  if (a.op === "optout" && a.phone && !l.optedOut.includes(a.phone)) l.optedOut.push(a.phone);
  if (a.op === "optin" && a.phone) l.optedOut = l.optedOut.filter((x) => x !== a.phone);
  if (row) await ctx.db.patch(row._id, { value: JSON.stringify(l), updatedAt: Date.now() }); else await ctx.db.insert("syncState", { key: KEY, value: JSON.stringify(l), updatedAt: Date.now() });
  return null;
} });

export const linq = httpAction(async (ctx, request) => {
  if (!fakesOn()) return new Response("fakes off", { status: 404 });
  if (request.headers.get("authorization") !== "Bearer fake-linq") return json({ code: 2004, message: "Unauthorized" }, 401);
  const path = new URL(request.url).pathname.replace(/^.*\/fake\/linq/, "");
  const l = await ctx.runQuery(internal.eval.fakeLinq.log, {});
  if (path === "/v3/messages" && request.method === "POST") {
    const b = (await request.json()) as { to?: string[]; from?: string; message?: { parts?: Array<{ type: string; value?: string }>; idempotency_key?: string }; override_optout?: boolean };
    const to = b.to?.[0] ?? "";
    if (b.from) return json({ code: 1003, message: "the fake refuses `from`: Linq should pick the line" }, 400);
    const parts = b.message?.parts ?? [];
    const texts = parts.filter((p) => p.type === "text");
    if (texts.length > 1 && parts.every((p) => p.type === "text")) return json({ code: 1004, message: "Consecutive text parts are not allowed" }, 400);
    const key = b.message?.idempotency_key ?? "";
    const again = l.sends.find((s) => s.key === key && key);
    const id = again?.id ?? `fmsg-${l.sends.length + 1}`;
    if (!again) {
      if (l.optedOut.includes(to) && !b.override_optout) return json({ code: 2024, message: "Recipient asked you to stop messaging them" }, 403);
      await ctx.runMutation(internal.eval.fakeLinq.logOp, { op: "send", entry: { at: Date.now(), to, key, text: texts.map((p) => p.value ?? "").join(" "), media: parts.filter((p) => p.type === "media").length, override: Boolean(b.override_optout), id } });
    }
    return json({ chat_id: `fchat${to.replace(/\D/g, "")}`, created_new_chat: !again && l.sends.filter((s) => s.to === to).length === 1, from: LINE, from_selection: { reason: "reused_active_chat" }, service: "iMessage", message: { id } }, 202);
  }
  const chat = /^\/v3\/chats\/([^/]+)\/(typing|share_contact_card)$/.exec(path);
  if (chat && request.method === "POST") {
    await ctx.runMutation(internal.eval.fakeLinq.logOp, { op: chat[2] === "typing" ? "typing" : "card", entry: { at: Date.now(), chatId: chat[1] } });
    return new Response(null, { status: 204 });
  }
  if (path.startsWith("/v3/available_number")) return json({ phone_number: LINE, vcf_url: "https://fake.invalid/maya.vcf" });
  if (path === "/v3/phone_numbers") return json({ phone_numbers: [{ id: "pn1", phone_number: LINE, reputation: { status: "HEALTHY" } }] });
  return json({ code: 2011, message: `the fake doesn't know ${request.method} ${path}` }, 404);
});

/** Plant an inbound text as Linq would deliver it: a signed `message.received` to our own webhook. STOP also opts them out on the fake's side. */
export const inbound = internalAction({
  args: { from: v.string(), text: v.string() },
  handler: async (ctx, a): Promise<{ status: number }> => {
    if (!fakesOn()) throw new Error("fakes off");
    const secret = process.env.LINQ_WEBHOOK_SECRET ?? "";
    const site = process.env.CONVEX_SITE_URL ?? "";
    // Linq's own opt-out: STOP opts them out; any other text opts them back in.
    await ctx.runMutation(internal.eval.fakeLinq.logOp, { op: ["STOP", "UNSUBSCRIBE", "OPTOUT", "CANCEL", "END", "QUIT"].includes(a.text.trim()) ? "optout" : "optin", phone: a.from });
    const id = `fin-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const body = JSON.stringify({ api_version: "v3", webhook_version: "2026-02-03", event_type: "message.received", event_id: id, created_at: new Date().toISOString(), trace_id: "fake", partner_id: "fake", data: { chat: { id: `fchat${a.from.replace(/\D/g, "")}`, is_group: false, health_status: { status: "HEALTHY" } }, id: `lm-${id}`, direction: "inbound", sender_handle: { handle: a.from, is_me: false }, parts: [{ type: "text", value: a.text }], service: "iMessage", sent_at: new Date().toISOString() } });
    const ts = Math.floor(Date.now() / 1000);
    const r = await fetch(`${site}/linq/webhook`, { method: "POST", headers: { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": await signWebhook(secret, id, ts, body) }, body });
    return { status: r.status };
  },
});

const E2E_SUBJECT = "dev:linq-e2e";
const E2E_PHONE = "+12015550142"; // NPA 201, 555-01xx: reserved for fiction

export const e2eCreator = internalMutation({ args: {}, handler: async (ctx): Promise<Id<"creators">> => {
  const existing = (await ctx.db.query("creators").withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", E2E_SUBJECT)).first()) as Doc<"creators"> | null;
  const now = Date.now();
  if (existing) {
    await ctx.db.patch(existing._id, { phone: E2E_PHONE, channel: { paired: true, kind: "imessage", pairedAt: now } });
    return existing._id;
  }
  // No handles: the fleet's jobs have nothing to read for it, so it can't spend ScrapeCreators credits.
  return await ctx.db.insert("creators", { clerkUserId: E2E_SUBJECT, email: "linq-e2e@eval.invalid", handles: {}, ownership: "unverified", niche: "running and marathon training", timezone: "America/Chicago", quietHours: { start: "22:00", end: "07:00" }, tone: "friend", mode: "full", dossierVersion: 0, notes: [], affinities: [], experiments: [], phone: E2E_PHONE, messageConsentAt: now, channel: { paired: true, kind: "imessage", pairedAt: now }, plan: { status: "trialing", tier: "solo", founding: false }, createdAt: now, updatedAt: now } as never);
} });
/** Unpaired when the run ends, so no fleet job picks it up. */
export const e2eDone = internalMutation({ args: { creatorId: v.id("creators") }, handler: async (ctx, a): Promise<null> => {
  const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
  if (c?.clerkUserId === E2E_SUBJECT) await ctx.db.patch(a.creatorId, { channel: { ...c.channel, paired: false } });
  return null;
} });
export const e2eState = internalQuery({ args: { creatorId: v.id("creators") }, handler: async (ctx, a) => {
  const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
  const msgs = (await ctx.db.query("messages").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(20)) as Doc<"messages">[];
  return { channel: c?.channel ?? null, messages: msgs.map((m) => ({ dir: m.direction, kind: m.kind ?? "", body: m.body.slice(0, 140), delivered: Boolean(m.deliveredAt), error: m.deliveryError ?? null })) };
} });

/**
 * The live loop, on dev only: they text, she replies through Linq with typing and her card; STOP gets
 * one goodbye with the override and silence after; their next text lifts it. Poll the result with
 * `e2eReport`. Refuses unless the fake is the only Linq this deployment can reach.
 */
export const e2e = internalAction({ args: {}, handler: async (ctx): Promise<{ creatorId: Id<"creators">; steps: Array<{ step: string; ok: boolean; detail: string }> }> => {
  if (!fakesOn()) throw new Error("fakes off: set EVAL_FAKES=1 on a local deployment");
  if (!(process.env.LINQ_BASE_URL ?? "").includes("/fake/linq") || process.env.LINQ_API_KEY !== "fake-linq") throw new Error("LINQ_BASE_URL must point at this deployment's /fake/linq and LINQ_API_KEY must be fake-linq");
  await ctx.runMutation(internal.eval.fakeLinq.writeLog, { value: JSON.stringify(empty()) });
  const creatorId = await ctx.runMutation(internal.eval.fakeLinq.e2eCreator, {});
  const steps: Array<{ step: string; ok: boolean; detail: string }> = [];
  const wait = async (until: (l: Log) => boolean, ms: number) => { const t0 = Date.now(); let l = await ctx.runQuery(internal.eval.fakeLinq.log, {}); while (!until(l) && Date.now() - t0 < ms) { await new Promise((r) => setTimeout(r, 3000)); l = await ctx.runQuery(internal.eval.fakeLinq.log, {}); } return l; };

  const s1 = await ctx.runAction(internal.eval.fakeLinq.inbound, { from: E2E_PHONE, text: "hey! what should i post this week?" });
  steps.push({ step: "webhook accepts a signed text", ok: s1.status === 200, detail: `HTTP ${s1.status}` });
  const l1 = await wait((l) => l.sends.some((s) => s.to === E2E_PHONE && !s.override), 150_000);
  const reply = l1.sends.find((s) => s.to === E2E_PHONE && !s.override);
  steps.push({ step: "she replies through Linq", ok: Boolean(reply), detail: reply ? reply.text.slice(0, 160) : "no send within 150 s" });
  steps.push({ step: "typing shown while she thought", ok: l1.typing.length > 0, detail: `${l1.typing.length} typing call(s)` });
  steps.push({ step: "her contact card offered once", ok: l1.cards.length === 1, detail: `${l1.cards.length} share(s)` });
  steps.push({ step: "every send had an idempotency key", ok: l1.sends.every((s) => s.key.length > 0), detail: l1.sends.map((s) => s.key).join(", ").slice(0, 160) });

  const before = l1.sends.length;
  await ctx.runAction(internal.eval.fakeLinq.inbound, { from: E2E_PHONE, text: "STOP" });
  const l2 = await wait((l) => l.sends.some((s) => s.override), 60_000);
  const bye = l2.sends.filter((s) => s.override);
  steps.push({ step: "STOP: one goodbye with override_optout", ok: bye.length === 1, detail: bye.map((s) => s.text).join(" | ").slice(0, 160) });
  const held = await ctx.runMutation(internal.core.messages.send, { creatorId, surface: "imessage", body: "a new idea for you", dedupeKey: `e2e:held:${Date.now()}`, proactive: true, kind: "scout" });
  steps.push({ step: "after STOP a proactive text is held", ok: !held.sent && /opted out/.test(held.held ?? ""), detail: held.held ?? "sent (wrong)" });
  await ctx.runAction(internal.eval.fakeLinq.inbound, { from: E2E_PHONE, text: "sorry, i'm back. what's good?" });
  const l3 = await wait((l) => l.sends.length > before + bye.length, 150_000);
  const st = await ctx.runQuery(internal.eval.fakeLinq.e2eState, { creatorId });
  steps.push({ step: "their next text lifts the opt-out, and she answers", ok: !st.channel?.optedOutAt && l3.sends.length > before + bye.length, detail: `optedOut ${String(st.channel?.optedOutAt ?? "cleared")}; sends ${l3.sends.length}` });
  steps.push({ step: "chat and line kept on the creator", ok: Boolean(st.channel?.chatId && st.channel?.line), detail: `chat ${st.channel?.chatId ?? "none"} · line ${st.channel?.line ?? "none"}` });
  await ctx.runMutation(internal.eval.fakeLinq.e2eDone, { creatorId });
  return { creatorId, steps };
} });
