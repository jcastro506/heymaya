/**
 * Vendor fakes for the partnership gauntlet (2026-09-12), served by our own HTTP router so the
 * real code path runs end to end: research.ts fetches Tavily's shape from TAVILY_BASE_URL, and
 * mailbox.ts fetches Gmail's shape from GMAIL_BASE_URL. Both refuse unless EVAL_FAKES=1, and a
 * real deployment never sets the base urls. State lives in syncState rows (the sent mail, the
 * injected replies), so a brand's reply can be planted between turns and read by the real sync.
 */
import { httpAction, internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { providerBase } from "../partnerships/providerConfig";
import { NORTHLINE_PAGE, worldPage, worldSearch } from "./dealsWorldData";

/** A fictional brand with an official creator page and a published partnerships address. */
export const FAKE_BRAND = {
  domain: "northlinerunning.com",
  name: "Northline Running",
  programUrl: "https://northlinerunning.com/creators",
  email: "creators@northlinerunning.com",
  page: NORTHLINE_PAGE,
} as const;

const fakesOn = () => process.env.EVAL_FAKES === "1" && process.env.ENVIRONMENT_NAME === "local";
export const isFixture = internalQuery({ args: { creatorId: v.id("creators") }, handler: async (ctx, a): Promise<boolean> => {
  const c = await ctx.db.get(a.creatorId);
  return Boolean(c?.clerkUserId.startsWith("eval:partnership:") && !c.telegramChatId && !c.phone);
} });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export const tavily = httpAction(async (_ctx, request) => {
  if (!fakesOn()) return new Response("fakes off", { status: 404 });
  if (request.headers.get("authorization") !== "Bearer fake-research") return new Response("unauthorized", { status: 401 });
  const url = new URL(request.url);
  const body = (await request.json().catch(() => ({}))) as { query?: string; urls?: string[] };
  // 2026-09-24: the deals world (eval/dealsWorldData.ts) answers both; Northline stays first for running searches.
  if (url.pathname.endsWith("/search")) return json({ query: body.query, results: worldSearch(body.query ?? "") });
  if (url.pathname.endsWith("/extract")) {
    const urls = body.urls ?? [];
    const results = urls.flatMap((u) => { const p = worldPage(u); return p ? [{ url: u, raw_content: p.content }] : []; });
    return json({ results, failed_results: urls.filter((u) => !worldPage(u)).map((u) => ({ url: u, error: "not in the fake" })) });
  }
  return json({ error: "unknown fake path" }, 404);
});

interface Box { sent: Array<{ id: string; threadId: string; raw: string; at: number }>; replies: Array<{ id: string; threadId: string; text: string; at: number; from?: string }> }
const KEY = "eval:fake_gmail";
export function mimeMessageId(raw: string): string | null {
  try {
    const decoded = atob(raw.replace(/-/g, "+").replace(/_/g, "/"));
    return /^Message-ID:\s*(<[^\r\n>]+>)/im.exec(decoded)?.[1] ?? null;
  } catch { return null; }
}

export const acceptMail = internalMutation({ args: { raw: v.string(), threadId: v.optional(v.string()) }, handler: async (ctx, a): Promise<{ id: string; threadId: string }> => {
  const row = await ctx.db.query("syncState").withIndex("by_key", q => q.eq("key", KEY)).unique();
  const b: Box = row ? JSON.parse(row.value) : { sent: [], replies: [] };
  const id = `fake_msg_${b.sent.length + 1}`;
  const threadId = a.threadId ?? `fake_thread_${b.sent.length + 1}`;
  b.sent.push({ id, threadId, raw: a.raw, at: Date.now() });
  if (row) await ctx.db.patch(row._id, { value: JSON.stringify(b), updatedAt: Date.now() });
  else await ctx.db.insert("syncState", { key: KEY, value: JSON.stringify(b), updatedAt: Date.now() });
  return { id, threadId };
} });

export const box = internalQuery({ args: {}, handler: async (ctx): Promise<Box> => {
  const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", KEY)).unique();
  return row ? (JSON.parse(row.value) as Box) : { sent: [], replies: [] };
} });
export const setBox = internalMutation({ args: { value: v.string() }, handler: async (ctx, a): Promise<null> => {
  const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", KEY)).unique();
  if (row) await ctx.db.patch(row._id, { value: a.value, updatedAt: Date.now() }); else await ctx.db.insert("syncState", { key: KEY, value: a.value, updatedAt: Date.now() });
  return null;
} });
/** The gauntlet plants a brand's reply in the tracked thread; the real sync reads it. */
export const reply = internalMutation({ args: { threadId: v.string(), text: v.string(), from: v.optional(v.string()) }, handler: async (ctx, a): Promise<{ id: string }> => {
  const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", KEY)).unique();
  const b: Box = row ? JSON.parse(row.value) : { sent: [], replies: [] };
  const id = `fake_reply_${b.replies.length + 1}`;
  b.replies.push({ id, threadId: a.threadId, text: a.text, at: Date.now(), ...(a.from ? { from: a.from } : {}) });
  if (row) await ctx.db.patch(row._id, { value: JSON.stringify(b), updatedAt: Date.now() }); else await ctx.db.insert("syncState", { key: KEY, value: JSON.stringify(b), updatedAt: Date.now() });
  return { id };
} });
/** Compressed time (deals world): the mailbox's clock moves with the fixture's rows, so "later" stays later. */
export const shiftBox = internalMutation({ args: { ms: v.number() }, handler: async (ctx, a): Promise<null> => {
  const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", KEY)).unique();
  if (!row) return null;
  const b = JSON.parse(row.value) as Box;
  const value: Box = { sent: b.sent.map((m) => ({ ...m, at: m.at - a.ms })), replies: b.replies.map((m) => ({ ...m, at: m.at - a.ms })) };
  await ctx.db.patch(row._id, { value: JSON.stringify(value), updatedAt: Date.now() });
  return null;
} });
export const resetBox = internalMutation({ args: {}, handler: async (ctx): Promise<null> => {
  const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", KEY)).unique();
  if (row) await ctx.db.delete(row._id);
  return null;
} });

const b64 = (s: string) => btoa(Array.from(new TextEncoder().encode(s), (c) => String.fromCharCode(c)).join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

export const gmail = httpAction(async (ctx, request) => {
  if (!fakesOn()) return new Response("fakes off", { status: 404 });
  if (request.headers.get("authorization") !== "Bearer fake-access") return new Response("unauthorized", { status: 401 });
  const url = new URL(request.url);
  const path = url.pathname.replace(/^.*\/fake\/gmail\//, "");
  const b = await ctx.runQuery(internal.eval.fakes.box, {});
  if (path === "profile") return json({ emailAddress: "creator@example.com" });
  if (path === "messages/send" && request.method === "POST") {
    const body = (await request.json()) as { raw: string; threadId?: string };
    const { id, threadId } = await ctx.runMutation(internal.eval.fakes.acceptMail, body);
    return json({ id, threadId, labelIds: ["SENT"] });
  }
  const thread = /^threads\/([^?]+)/.exec(path);
  if (thread) {
    const threadId = decodeURIComponent(thread[1]);
    const sent = b.sent.filter((m) => m.threadId === threadId).map((m) => ({ id: m.id, threadId, internalDate: String(m.at), labelIds: ["SENT"], snippet: "sent by the creator", payload: { mimeType: "text/plain", body: { data: b64("(sent)") }, headers: [{ name: "Message-ID", value: mimeMessageId(m.raw) ?? `<${m.id}@example.com>` }] } }));
    const replies = b.replies.filter((m) => m.threadId === threadId).map((m) => ({ id: m.id, threadId, internalDate: String(m.at), labelIds: ["INBOX"], snippet: m.text.slice(0, 80), payload: { mimeType: "text/plain", body: { data: b64(m.text) }, headers: [{ name: "Message-ID", value: `<${m.id}@${m.from?.split("@")[1] ?? "northlinerunning.com"}>` }] } }));
    return json({ id: threadId, messages: [...sent, ...replies].sort((x, y) => Number(x.internalDate) - Number(y.internalDate)) });
  }
  if (path.startsWith("messages")) {
    const q = url.searchParams.get("q") ?? "";
    const m = /rfc822msgid:<?([^\s>]+)>?/.exec(q);
    const found = m ? b.sent.filter(s => mimeMessageId(s.raw) === `<${m[1]}>`) : [];
    return json({ messages: found.map((s) => ({ id: s.id, threadId: s.threadId })) });
  }
  return json({ error: "unknown fake path" }, 404);
});

/** Dev: can an action on this deployment reach its own fake router? (Convex self-fetch is not guaranteed.) */
export const probe = internalAction({ args: {}, handler: async (): Promise<{ ok: boolean; status?: number; error?: string }> => {
  try {
    const r = await fetch(`${providerBase("gmail", true)}/profile`, { headers: { Authorization: "Bearer fake-access" }, signal: AbortSignal.timeout(10_000) });
    return { ok: r.ok, status: r.status };
  } catch (e) { return { ok: false, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) }; }
} });
