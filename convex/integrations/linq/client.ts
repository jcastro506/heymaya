/**
 * Linq Partner API v3 (iMessage, RCS and SMS): the vendor calls and nothing else. Written against
 * the public docs (docs.linqapp.com/channel/imessage, OpenAPI linq-api-v3.yaml), read 2026-09-28,
 * before we had an account: every shape below is from the docs, and the first live send is the
 * exit criterion. A response we don't recognise is a named failure, never a success.
 *
 * What their best-practices page asks of us, and where this file does its part:
 *  - Send with POST /v3/messages and NO `from`: Linq picks the line, reuses the chat's line,
 *    and fails over off a flagged line (`sendMessage`).
 *  - An `idempotency_key` on every send, inside `message` (`sendMessage`).
 *  - One message per text part: consecutive text parts in one message are rejected.
 *  - Opt-out keywords are exact whole messages (`isOptOutKeyword`); a 2024 is honoured, never
 *    retried (`classifyError`).
 *  - 429 carries Retry-After; 2027/409 mean the line can't send right now (`classifyError`).
 *  - Webhooks are Standard Webhooks: HMAC-SHA256 over "{id}.{timestamp}.{body}" with the
 *    base64 key after `whsec_`, 5-minute replay window, constant-time compare (`verifyWebhook`).
 *  - Typing while she composes; the contact card shared at most once a day (callers decide when).
 * It never throws: callers are Convex actions, where an uncaught throw retries work that may
 * already have sent a text.
 */

export interface LinqIdentity { apiKey: string; baseUrl: string }

/** From the environment, or null when the channel is not configured on this deployment. */
export function resolveLinqIdentity(): LinqIdentity | null {
  const apiKey = process.env.LINQ_API_KEY ?? "";
  if (!apiKey) return null;
  return { apiKey, baseUrl: (process.env.LINQ_BASE_URL ?? "https://api.linqapp.com/api/partner").replace(/\/+$/, "") };
}

export type LinqService = "iMessage" | "RCS" | "SMS";
export type ChatHealth = "HEALTHY" | "AT_RISK" | "CRITICAL" | "OPTED_OUT";

export type LinqPart = { type: "text"; value: string } | { type: "media"; url: string };

export interface LinqSendArgs {
  to: string;
  parts: LinqPart[];
  /** Required in practice: the same key on a retry returns the original send instead of a second text. */
  idempotencyKey: string;
  /** The one courtesy message after an opt-out ("reply any time to resume"). Once per opt-out, never in a retry loop. */
  overrideOptout?: boolean;
}

export type LinqError = { ok: false; code: number | null; reason: string; retryable: boolean; retryAfterS?: number; kind: "opted_out" | "line_restricted" | "rate_limited" | "auth" | "bad_request" | "server" | "delivery" | "unknown" };
export type LinqSendResult =
  | { ok: true; messageId: string; chatId: string; from: string | null; service: LinqService | null; newChat: boolean; selection: string | null; health: ChatHealth | null }
  | LinqError;

/** Pure: the POST /v3/messages body. No `from`, ever: Linq picks the line. */
export function sendBody(args: LinqSendArgs): Record<string, unknown> {
  return {
    to: [args.to],
    message: { parts: args.parts, idempotency_key: args.idempotencyKey.slice(0, 255) },
    ...(args.overrideOptout ? { override_optout: true } : {}),
  };
}

/**
 * Pure: an error response → a named failure. Codes from the docs' error reference:
 * 2024 opted out (terminal, never retried) · 2026 blocked · 2027 / HTTP 409 no line can send right
 * now · 1007 rate limited (Retry-After) · 2004/2005/2006 auth · 1xxx bad request · 3xxx server
 * (retry) · 4xxx delivery · 5xxx file.
 */
export function classifyError(status: number, json: unknown, retryAfterHeader: string | null): LinqError {
  const r = (json ?? {}) as { code?: number; message?: string; error?: { code?: number; message?: string }; retry_after?: number };
  const code = r.code ?? r.error?.code ?? null;
  const message = r.message ?? r.error?.message ?? `HTTP ${status}`;
  const retryAfterS = Number(retryAfterHeader ?? r.retry_after ?? NaN);
  const base = { ok: false as const, code, reason: `${message}${code ? ` (${code})` : ""}` };
  if (code === 2024) return { ...base, retryable: false, kind: "opted_out" };
  if (code === 2026 || code === 2008) return { ...base, retryable: false, kind: "opted_out" };
  if (code === 2027 || status === 409) return { ...base, retryable: true, kind: "line_restricted" };
  if (status === 429 || code === 1007) return { ...base, retryable: true, kind: "rate_limited", ...(Number.isFinite(retryAfterS) ? { retryAfterS } : {}) };
  if (status === 401 || status === 403 || code === 2004 || code === 2005 || code === 2006) return { ...base, retryable: false, kind: "auth" };
  if (status >= 500 || (code !== null && code >= 3000 && code < 4000)) return { ...base, retryable: true, kind: "server" };
  if (code !== null && code >= 4000 && code < 5000) return { ...base, retryable: code === 4004 || code === 4006, kind: "delivery" };
  if (status >= 400) return { ...base, retryable: false, kind: "bad_request" };
  return { ...base, retryable: false, kind: "unknown" };
}

/** Pure: a 2xx send answer → ours. A shape we don't recognise is a named failure. */
export function parseSendResult(json: unknown): LinqSendResult {
  const r = (json ?? {}) as Record<string, unknown>;
  const msg = (r.message ?? r) as Record<string, unknown>;
  const chat = (r.chat ?? msg.chat ?? {}) as Record<string, unknown>;
  const messageId = typeof msg.id === "string" ? msg.id : typeof r.message_id === "string" ? r.message_id : null;
  const chatId = typeof r.chat_id === "string" ? r.chat_id : typeof chat.id === "string" ? chat.id : null;
  if (!messageId || !chatId) return { ok: false, code: null, reason: "the vendor answered in a shape I do not recognise", retryable: false, kind: "unknown" };
  const svc = (msg.service ?? r.service) as string | undefined;
  const health = ((chat.health_status as { status?: string } | undefined)?.status ?? null) as ChatHealth | null;
  return {
    ok: true,
    messageId,
    chatId,
    from: typeof r.from === "string" ? r.from : null,
    service: svc === "iMessage" || svc === "RCS" || svc === "SMS" ? svc : null,
    newChat: r.created_new_chat === true,
    selection: ((r.from_selection as { reason?: string } | undefined)?.reason) ?? null,
    health,
  };
}

async function call(identity: LinqIdentity, method: string, path: string, body: unknown, fetchImpl: typeof fetch): Promise<{ ok: true; json: unknown } | LinqError> {
  let res: Response;
  try {
    res = await fetchImpl(`${identity.baseUrl}${path}`, { method, headers: { authorization: `Bearer ${identity.apiKey}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  } catch (e) {
    return { ok: false, code: null, reason: `network: ${e instanceof Error ? e.message.slice(0, 120) : "failed"}`, retryable: true, kind: "server" };
  }
  const text = await res.text().catch(() => "");
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!res.ok) return classifyError(res.status, json, res.headers.get("retry-after"));
  return { ok: true, json };
}

/** One message to one person. Linq picks the line and the chat. */
export async function sendMessage(identity: LinqIdentity, args: LinqSendArgs, fetchImpl: typeof fetch = fetch): Promise<LinqSendResult> {
  if (!args.parts.length) return { ok: false, code: null, reason: "nothing to send", retryable: false, kind: "bad_request" };
  const r = await call(identity, "POST", "/v3/messages", sendBody(args), fetchImpl);
  return r.ok ? parseSendResult(r.json) : r;
}

/** "…is typing" while she composes. iMessage only (RCS/SMS accept it and show nothing). Best effort. */
export async function startTyping(identity: LinqIdentity, chatId: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: boolean; reason?: string }> {
  const r = await call(identity, "POST", `/v3/chats/${encodeURIComponent(chatId)}/typing`, undefined, fetchImpl);
  return r.ok ? { ok: true } : { ok: false, reason: r.reason };
}

/** Prompt them to save her name and photo. Needs a prior outbound in the chat and an active card on the line. */
export async function shareContactCard(identity: LinqIdentity, chatId: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: boolean; reason?: string; code?: number | null }> {
  const r = await call(identity, "POST", `/v3/chats/${encodeURIComponent(chatId)}/share_contact_card`, undefined, fetchImpl);
  return r.ok ? { ok: true } : { ok: false, reason: r.reason, code: r.code };
}

/** Onboarding only (never per message): the best line for a NEW person, and its time-limited contact card. */
export async function availableNumber(identity: LinqIdentity, to: string | null, fetchImpl: typeof fetch = fetch): Promise<{ ok: true; phoneNumber: string; vcfUrl: string | null } | LinqError> {
  const r = await call(identity, "GET", `/v3/available_number${to ? `?to=${encodeURIComponent(to)}` : ""}`, undefined, fetchImpl);
  if (!r.ok) return r;
  const j = (r.json ?? {}) as { phone_number?: string; vcf_url?: string };
  return j.phone_number ? { ok: true, phoneNumber: j.phone_number, vcfUrl: j.vcf_url ?? null } : { ok: false, code: null, reason: "no available number in the answer", retryable: false, kind: "unknown" };
}

/** Create (once per line) or update her contact card: the name and photo people save. */
export async function upsertContactCard(identity: LinqIdentity, card: { phoneNumber: string; firstName: string; lastName?: string; imageUrl?: string }, fetchImpl: typeof fetch = fetch): Promise<{ ok: boolean; reason?: string; updated?: boolean }> {
  const body = { phone_number: card.phoneNumber, first_name: card.firstName, ...(card.lastName ? { last_name: card.lastName } : {}), ...(card.imageUrl ? { image_url: card.imageUrl } : {}) };
  const created = await call(identity, "POST", "/v3/contact_card", body, fetchImpl);
  if (created.ok) return { ok: true, updated: false };
  if (created.code !== 2014) return { ok: false, reason: created.reason }; // 2014: one already exists → update it
  const patched = await call(identity, "PATCH", "/v3/contact_card", body, fetchImpl);
  return patched.ok ? { ok: true, updated: true } : { ok: false, reason: patched.reason };
}

/** Every line on the account, with its sending status and reputation. */
export async function listPhoneNumbers(identity: LinqIdentity, fetchImpl: typeof fetch = fetch): Promise<{ ok: true; lines: Array<{ phoneNumber: string; status: string | null; reputation: string | null }> } | LinqError> {
  const r = await call(identity, "GET", "/v3/phone_numbers", undefined, fetchImpl);
  if (!r.ok) return r;
  const j = (r.json ?? {}) as { phone_numbers?: Array<Record<string, unknown>>; data?: Array<Record<string, unknown>> };
  const rows = j.phone_numbers ?? j.data ?? [];
  return { ok: true, lines: rows.map((x) => ({ phoneNumber: String(x.phone_number ?? x.number ?? ""), status: typeof x.status === "string" ? x.status : null, reputation: typeof x.reputation === "string" ? x.reputation : ((x.reputation as { status?: string } | undefined)?.status ?? null) })) };
}

/** The webhook subscription: our URL, pinned to a payload version, the events we handle. Returns the signing secret ONCE. */
export const WEBHOOK_VERSION = "2026-02-03";
export const WEBHOOK_EVENTS = ["message.received", "message.sent", "message.delivered", "message.failed", "reaction.added", "reaction.removed", "chat.typing_indicator.started", "phone_number.status_updated"] as const;
export async function createWebhookSubscription(identity: LinqIdentity, targetUrl: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: true; id: string | null; signingSecret: string } | LinqError> {
  const url = targetUrl.includes("version=") ? targetUrl : `${targetUrl}${targetUrl.includes("?") ? "&" : "?"}version=${WEBHOOK_VERSION}`;
  const r = await call(identity, "POST", "/v3/webhook-subscriptions", { target_url: url, subscribed_events: WEBHOOK_EVENTS }, fetchImpl);
  if (!r.ok) return r;
  const j = (r.json ?? {}) as { id?: string; signing_secret?: string };
  return j.signing_secret ? { ok: true, id: j.id ?? null, signingSecret: j.signing_secret } : { ok: false, code: null, reason: "no signing secret in the answer", retryable: false, kind: "unknown" };
}

/* -------------------------------------------------------------------------- */
/* Inbound                                                                     */
/* -------------------------------------------------------------------------- */

export const REPLAY_WINDOW_S = 5 * 60;

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Standard Webhooks signature for (id, timestamp, body): "v1,<base64>". Exported for tests and the fake. */
export async function signWebhook(secret: string, id: string, timestampS: number, rawBody: string): Promise<string> {
  const keyBytes = b64ToBytes(secret.startsWith("whsec_") ? secret.slice(6) : secret);
  const key = await crypto.subtle.importKey("raw", keyBytes as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestampS}.${rawBody}`)));
  return `v1,${bytesToB64(mac)}`;
}

/** Verify over the RAW body (never re-serialised). Any of the space-separated v1 signatures may match. */
export async function verifyWebhook(secret: string, rawBody: string, headers: { id: string | null; timestamp: string | null; signature: string | null }, nowS: number): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!headers.id || !headers.timestamp || !headers.signature) return { ok: false, reason: "missing webhook signature headers" };
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowS - ts) > REPLAY_WINDOW_S) return { ok: false, reason: "stale or bad timestamp" };
  let expected: string;
  try { expected = (await signWebhook(secret, headers.id, ts, rawBody)).slice(3); } catch { return { ok: false, reason: "bad signing secret" }; }
  const match = headers.signature.split(" ").some((s) => s.startsWith("v1,") && constantTimeEqual(s.slice(3), expected));
  return match ? { ok: true } : { ok: false, reason: "signature mismatch" };
}

export type LinqReaction = "love" | "like" | "dislike" | "laugh" | "emphasize" | "question" | "custom" | "sticker";

export type LinqEvent =
  | { type: "message"; eventId: string; messageId: string; chatId: string; from: string; text: string; media: Array<{ url: string; mimeType: string; sizeBytes: number | null }>; isGroup: boolean; service: LinqService | null; health: ChatHealth | null; sentAt: number }
  | { type: "sent"; eventId: string; messageId: string; chatId: string; health: ChatHealth | null; service: LinqService | null }
  | { type: "failed"; eventId: string; messageId: string; chatId: string; code: number | null; reason: string }
  | { type: "reaction"; eventId: string; chatId: string; messageId: string; from: string; reactionType: LinqReaction | "unknown"; emoji: string | null; added: boolean }
  | { type: "typing"; eventId: string; chatId: string }
  | { type: "line"; eventId: string; phoneNumber: string; status: string | null; reputation: string | null; previousStatus: string | null; previousReputation: string | null }
  | { type: "ignored"; eventId: string | null; why: string };

const svc = (s: unknown): LinqService | null => (s === "iMessage" || s === "RCS" || s === "SMS" ? s : null);
const ms = (s: unknown): number => { const t = typeof s === "string" ? Date.parse(s) : NaN; return Number.isFinite(t) ? t : Date.now(); };

/** Pure: a `2026-02-03` envelope → ours. Anything else is `ignored` with the reason. */
export function parseLinqEvent(json: unknown): LinqEvent {
  const e = (json ?? {}) as { event_type?: string; event_id?: string; data?: Record<string, unknown> };
  const eventId = typeof e.event_id === "string" ? e.event_id : null;
  const d = e.data ?? {};
  if (!e.event_type || !eventId) return { type: "ignored", eventId, why: "no event type or id" };
  const chat = (d.chat ?? {}) as { id?: string; is_group?: boolean; health_status?: { status?: string } };
  const health = (chat.health_status?.status ?? null) as ChatHealth | null;
  const chatId = String(chat.id ?? d.chat_id ?? "");
  switch (e.event_type) {
    case "message.received": {
      if (d.direction && d.direction !== "inbound") return { type: "ignored", eventId, why: "not inbound" };
      const parts = Array.isArray(d.parts) ? (d.parts as Array<Record<string, unknown>>) : [];
      const sender = (d.sender_handle ?? {}) as { handle?: string; is_me?: boolean };
      if (sender.is_me) return { type: "ignored", eventId, why: "our own message" };
      return {
        type: "message", eventId, chatId, health, isGroup: chat.is_group === true,
        messageId: String(d.id ?? ""), from: String(sender.handle ?? ""),
        text: parts.filter((p) => p.type === "text").map((p) => String(p.value ?? "")).join("\n"),
        media: parts.filter((p) => p.type === "media" && typeof p.url === "string").map((p) => ({ url: String(p.url), mimeType: String(p.mime_type ?? "application/octet-stream"), sizeBytes: typeof p.size_bytes === "number" ? p.size_bytes : null })),
        service: svc(d.service), sentAt: ms(d.sent_at),
      };
    }
    case "message.sent":
    case "message.delivered":
      return { type: "sent", eventId, chatId, health, messageId: String(d.id ?? ""), service: svc(d.service) };
    case "message.failed":
      return { type: "failed", eventId, chatId, messageId: String(d.message_id ?? ""), code: typeof d.code === "number" ? d.code : null, reason: String(d.reason ?? "delivery failed") };
    case "reaction.added":
    case "reaction.removed": {
      const rt = String(d.reaction_type ?? "unknown");
      if (d.is_from_me === true) return { type: "ignored", eventId, why: "our own reaction" };
      return { type: "reaction", eventId, chatId, messageId: String(d.message_id ?? ""), from: String(d.from ?? (d.from_handle as { handle?: string } | undefined)?.handle ?? ""), reactionType: (["love", "like", "dislike", "laugh", "emphasize", "question", "custom", "sticker"].includes(rt) ? rt : "unknown") as LinqReaction | "unknown", emoji: typeof d.custom_emoji === "string" ? d.custom_emoji : null, added: e.event_type === "reaction.added" };
    }
    case "chat.typing_indicator.started":
      return { type: "typing", eventId, chatId };
    case "phone_number.status_updated":
      return { type: "line", eventId, phoneNumber: String(d.phone_number ?? ""), status: (d.new_status as string) ?? null, reputation: (d.new_reputation as string) ?? null, previousStatus: (d.previous_status as string) ?? null, previousReputation: (d.previous_reputation as string) ?? null };
    default:
      return { type: "ignored", eventId, why: `unhandled event type ${e.event_type}` };
  }
}

/**
 * Pure: a Linq opt-out keyword, exactly as their docs define it: the WHOLE message, case-sensitive
 * (STOP, UNSUBSCRIBE, OPTOUT, CANCEL, END, QUIT), except OPT OUT, which matches in any casing,
 * spaced, hyphenated or not. "please stop" is not a keyword: conversational stop requests are
 * ours to catch (the classifier's pause), and Linq does not block on them.
 */
export function isOptOutKeyword(text: string): boolean {
  const t = text.trim();
  if (["STOP", "UNSUBSCRIBE", "OPTOUT", "CANCEL", "END", "QUIT"].includes(t)) return true;
  return /^opt[\s-]?out$/i.test(t);
}
