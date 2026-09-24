/**
 * Claw Messenger (plan §23, Sprint 6): the vendor call and nothing else. Claw is a relay in
 * front of Linq's iMessage fleet; one API sends as iMessage, RCS or SMS, whichever the
 * recipient's phone can take. This file knows how to send a message, register a recipient,
 * verify an inbound signature, and read the vendor's event shapes. It does not know what a
 * creator is, what a menu is, or what a heart means.
 *
 * Never throws: every failure is a named reason, because the callers are Convex actions
 * where an uncaught throw retries work that may already have sent a text.
 *
 * ⚠️ The REST send shape below mirrors the documented WebSocket `send` frame (to, parts,
 * service). Verified against the docs on 2026-09-08, not yet against a live line; the first
 * live send is the sprint's exit criterion, and `parseSendResult` is where a differing shape
 * would show up as a named reason rather than a silent success.
 */

export interface ClawIdentity { apiKey: string; baseUrl: string; lineNumber: string | null }

/** From the environment, or null when the channel is not configured on this deployment. */
export function resolveClawIdentity(): ClawIdentity | null {
  const apiKey = process.env.CLAW_API_KEY ?? "";
  if (!apiKey) return null;
  return { apiKey, baseUrl: (process.env.CLAW_BASE_URL ?? "https://claw-messenger.onrender.com").replace(/\/+$/, ""), lineNumber: process.env.CLAW_LINE_NUMBER ?? null };
}

export type ClawService = "iMessage" | "RCS" | "SMS";

export interface ClawSendArgs { to: string; text: string; service?: ClawService; mediaUrls?: string[] }

export type ClawSendResult =
  | { ok: true; messageId: string | null; status: string; service: ClawService | null; setupProofPending: boolean }
  | { ok: false; reason: string; retryable: boolean };

/** The outbound body: text parts, and media parts the vendor may or may not honour (undocumented). Pure. */
export function sendBody(args: ClawSendArgs): Record<string, unknown> {
  const parts: Array<Record<string, unknown>> = [{ type: "text", value: args.text }];
  for (const url of args.mediaUrls ?? []) parts.push({ type: "media", url });
  return { to: args.to, parts, ...(args.service ? { service: args.service } : {}) };
}

/** The vendor's send answer → ours. Pure; a shape we do not recognise is a named failure, never a success. */
export function parseSendResult(status: number, json: unknown): ClawSendResult {
  const r = (json ?? {}) as { ok?: boolean; status?: string; messageId?: string; service?: string; error?: string | { message?: string }; retryable?: boolean | null; setupProof?: { required?: boolean; status?: string } };
  const err = typeof r.error === "string" ? r.error : r.error?.message;
  if (status === 429) return { ok: false, reason: `rate limited: ${err ?? "too many new recipients"}`, retryable: true };
  if (status === 401 || status === 403) return { ok: false, reason: `refused by the vendor: ${err ?? `HTTP ${status}`}`, retryable: false };
  if (status >= 500) return { ok: false, reason: `vendor error HTTP ${status}`, retryable: true };
  if (status >= 400) return { ok: false, reason: err ?? `HTTP ${status}`, retryable: false };
  if (r.ok === false) return { ok: false, reason: err ?? r.status ?? "the vendor said no", retryable: r.retryable === true };
  if (r.ok !== true && !r.messageId && !r.status) return { ok: false, reason: "the vendor answered in a shape I do not recognise", retryable: false };
  const service = r.service === "iMessage" || r.service === "RCS" || r.service === "SMS" ? r.service : null;
  return { ok: true, messageId: r.messageId ?? null, status: r.status ?? "accepted", service, setupProofPending: Boolean(r.setupProof?.required && r.setupProof.status !== "satisfied") };
}

/** CLAW_FAKE=1: every send succeeds with a stable id and nothing leaves the box (the simulated day on an iMessage creator). */
export function clawFakeEnabled(): boolean {
  return process.env.CLAW_FAKE === "1";
}

export async function sendClawMessage(identity: ClawIdentity, args: ClawSendArgs, fetchImpl: typeof fetch = fetch): Promise<ClawSendResult> {
  if (clawFakeEnabled()) return { ok: true, messageId: `fake_${Math.random().toString(36).slice(2, 10)}`, status: "accepted", service: "iMessage", setupProofPending: false };
  try {
    const res = await fetchImpl(`${identity.baseUrl}/api/agent/send-message`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${identity.apiKey}` },
      body: JSON.stringify(sendBody(args)),
    });
    let json: unknown = null;
    try { json = await res.json(); } catch { json = null; }
    return parseSendResult(res.status, json);
  } catch (error) {
    return { ok: false, reason: `send failed: ${error instanceof Error ? error.message : String(error)}`, retryable: true };
  }
}

/** Register a recipient on the line (self-serve lines only reach registered numbers). Idempotent on the vendor side. */
export async function registerClawRoute(identity: ClawIdentity, phone: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (clawFakeEnabled()) return { ok: true };
  try {
    const res = await fetchImpl(`${identity.baseUrl}/api/routes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${identity.apiKey}` },
      body: JSON.stringify({ phone }),
    });
    if (res.ok || res.status === 409) return { ok: true };
    let detail = `HTTP ${res.status}`;
    try { const j = (await res.json()) as { error?: string; detail?: string }; detail = j.error ?? j.detail ?? detail; } catch { /* the status is the detail */ }
    return { ok: false, reason: detail };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/* -------------------------------------------------------------------------- */
/* Inbound: the signature and the event shapes                                */
/* -------------------------------------------------------------------------- */

/** Our relay signs every POST: `t=<unix seconds>,v1=<hex sha256 hmac of "<t>.<raw body>">`. Five minutes of skew; the replay guard is the vendor message id. */
export const SIGNATURE_HEADER = "x-maya-signature";
export const SIGNATURE_MAX_SKEW_S = 5 * 60;

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** What the relay puts in the header, so a test (and the relay) share one definition. */
export async function signPayload(secret: string, rawBody: string, nowS: number): Promise<string> {
  return `t=${nowS},v1=${await hmacHex(secret, `${nowS}.${rawBody}`)}`;
}

export async function verifySignature(secret: string, rawBody: string, header: string | null, nowS: number): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!header) return { ok: false, reason: "no signature" };
  const m = header.match(/^t=(\d+),v1=([0-9a-f]{64})$/);
  if (!m) return { ok: false, reason: "malformed signature" };
  const t = Number(m[1]);
  if (!Number.isFinite(t) || Math.abs(nowS - t) > SIGNATURE_MAX_SKEW_S) return { ok: false, reason: "signature too old" };
  const expected = await hmacHex(secret, `${t}.${rawBody}`);
  // Constant-time compare so the secret's prefix does not leak through timing.
  let acc = expected.length === m[2].length ? 0 : 1;
  for (let i = 0; i < expected.length; i++) acc |= expected.charCodeAt(i) ^ (m[2].charCodeAt(i) || 0);
  return acc === 0 ? { ok: true } : { ok: false, reason: "bad signature" };
}

/** Claw's tapback vocabulary. Anything else is `custom` with an emoji, or unknown. */
export type ClawReactionType = "love" | "like" | "dislike" | "laugh" | "emphasize" | "question" | "custom";

export type ClawEvent =
  | { type: "message"; messageId: string; from: string; text: string; attachments: Array<{ url: string; mimeType: string }>; service: ClawService | null; sentAt: number; isGroup: boolean }
  | { type: "reaction"; from: string; messageId: string; reactionType: ClawReactionType | "unknown"; emoji: string | null; added: boolean }
  | { type: "status"; messageId: string; status: string }
  | { type: "ignored"; why: string };

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** The vendor's JSON → one of ours. Pure. Never throws; a shape we do not know is `ignored` with a reason, so the webhook still answers 200. */
export function parseClawEvent(json: unknown): ClawEvent {
  const e = (json ?? {}) as Record<string, unknown>;
  const type = str(e.type);
  if (type === "message") {
    const from = str(e.from);
    const messageId = str(e.messageId) || str(e.id);
    if (!from || !messageId) return { type: "ignored", why: "message without from or messageId" };
    const raw = Array.isArray(e.attachments) ? (e.attachments as Array<Record<string, unknown>>) : [];
    const attachments = raw.map((a) => ({ url: str(a.url), mimeType: str(a.mimeType) || "application/octet-stream" })).filter((a) => /^https?:\/\//.test(a.url));
    const s = str(e.service);
    const sentAtMs = Date.parse(str(e.sentAt));
    return { type: "message", messageId, from, text: str(e.text).slice(0, 4000), attachments, service: s === "iMessage" || s === "RCS" || s === "SMS" ? s : null, sentAt: Number.isFinite(sentAtMs) ? sentAtMs : Date.now(), isGroup: e.isGroup === true };
  }
  if (type === "reaction") {
    const from = str(e.from);
    const messageId = str(e.messageId);
    if (!from || !messageId) return { type: "ignored", why: "reaction without from or messageId" };
    const rt = str(e.reactionType);
    const known: ClawReactionType[] = ["love", "like", "dislike", "laugh", "emphasize", "question", "custom"];
    return { type: "reaction", from, messageId, reactionType: (known as string[]).includes(rt) ? (rt as ClawReactionType) : "unknown", emoji: str(e.emoji) || null, added: e.added !== false && e.remove !== true };
  }
  if (type === "status") return { type: "status", messageId: str(e.messageId), status: str(e.status) || str(e.deliveryStatus) };
  if (type === "typing" || type === "read" || type === "pong" || type === "sync.done" || type === "group.name.updated") return { type: "ignored", why: type };
  return { type: "ignored", why: type ? `unknown event type ${type}` : "no event type" };
}

/** E.164, the only phone shape the product stores. Pure. */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, "");
  const m = digits.match(/^\+?(\d{10,15})$/);
  if (!m) return null;
  // A bare ten-digit number is North American; anything with a plus is taken as written.
  const n = m[1];
  if (!digits.startsWith("+") && n.length === 10) return `+1${n}`;
  if (!digits.startsWith("+") && n.length === 11 && n.startsWith("1")) return `+${n}`;
  if (!digits.startsWith("+")) return null;
  return `+${n}`;
}
