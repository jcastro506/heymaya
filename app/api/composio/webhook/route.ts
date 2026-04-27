/**
 * Composio v3 inbound webhook handler.
 *
 * Sprint 5. Receives Composio's outbound webhooks (gmail.message.received and
 * eventually other types) → resolves the owning creator → fetches the full
 * Gmail thread → fires `internal.dealTriage.triageInboundEmail`.
 *
 * Security: Composio v3 signs webhook deliveries with HMAC-SHA256 using a
 * per-workspace shared secret. The signature lives in the
 * `x-composio-signature` header (some versions also send `x-composio-timestamp`).
 * We verify in constant time via crypto.subtle. The operator must set
 * `COMPOSIO_WEBHOOK_SECRET` in the Next.js env (NOT just Convex — this route
 * runs on the Next.js server, not in Convex).
 *
 * Plan-tier defense: the route gates upstream — Starter creators are dropped
 * silently because they shouldn't have Gmail connected in the first place.
 * The triage action gates again (defense in depth) so even if a Starter
 * somehow has a Gmail row, no triage runs.
 *
 * Cross-tenant: every event is routed through `findCreatorByComposioAccount`
 * keyed on the SHA-256 of the Composio account id from the payload. If the
 * account id isn't recognized (e.g. operator's own test account, deleted
 * creator), we land an audit row with status `resolved_no_creator` and
 * return 200 — Composio retries failed deliveries, so 4xx/5xx would create
 * a redelivery storm.
 */

import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

/**
 * Bridge secret for the internal handlers exposed via public wrappers.
 * Convex public APIs are reachable from anywhere on the internet, so each
 * `*Public` handler validates this shared secret via `assertWebhookSecret`
 * before delegating. Operator MUST set in BOTH .env.local (here) and
 * `npx convex env set WEBHOOK_INTERNAL_SECRET <hex>` (in Convex). See
 * `convex/lib/webhookSecret.ts` header for full setup.
 */
function bridgeSecret(): string {
  const s = process.env.WEBHOOK_INTERNAL_SECRET;
  if (!s) {
    throw new Error("WEBHOOK_INTERNAL_SECRET is not configured.");
  }
  return s;
}

/* -------------------------------------------------------------------------- */
/* Signature verification                                                      */
/* -------------------------------------------------------------------------- */

const SIGNATURE_HEADER = "x-composio-signature";
const TIMESTAMP_HEADER = "x-composio-timestamp";
const MAX_TIMESTAMP_SKEW_SEC = 5 * 60; // 5min window — replay defense

async function verifyComposioSignature(opts: {
  secret: string;
  payload: string;
  signature: string;
  timestamp: string | null;
}): Promise<boolean> {
  if (!opts.signature) return false;

  // Optional timestamp skew check. Composio v3 sends `x-composio-timestamp`
  // (unix seconds) on most webhook variants. Reject anything older than 5min
  // to defang replay attacks.
  if (opts.timestamp) {
    const ts = parseInt(opts.timestamp, 10);
    if (!Number.isFinite(ts)) return false;
    const skewSec = Math.abs(Math.floor(Date.now() / 1000) - ts);
    if (skewSec > MAX_TIMESTAMP_SKEW_SEC) return false;
  }

  // Composio v3 HMAC scheme: signature = hex(HMAC_SHA256(secret, `${ts}.${body}`))
  // when timestamp is present, otherwise hex(HMAC_SHA256(secret, body)).
  const signedPayload = opts.timestamp
    ? `${opts.timestamp}.${opts.payload}`
    : opts.payload;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(opts.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(signedPayload));
  const expectedHex = bufferToHex(mac);

  // Some Composio versions prefix the signature with `sha256=`; tolerate.
  const provided = opts.signature.replace(/^sha256=/, "").trim().toLowerCase();
  return constantTimeEqual(expectedHex, provided);
}

function bufferToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return bufferToHex(buf);
}

/* -------------------------------------------------------------------------- */
/* Payload shape                                                               */
/* -------------------------------------------------------------------------- */

interface ComposioWebhookPayload {
  /** Composio event id — globally unique, used for replay defense. */
  id?: string;
  /** Event type, e.g. "gmail.message.received" or "GMAIL_NEW_MESSAGE". */
  type?: string;
  /** Connected-account id whose state changed. */
  connectedAccountId?: string;
  /** Per-creator entity id we passed at OAuth time (string version of creators._id). */
  entityId?: string;
  /** Event payload — provider-specific; for gmail it carries threadId / messageId. */
  data?: {
    threadId?: string;
    messageId?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/* -------------------------------------------------------------------------- */
/* POST handler                                                                */
/* -------------------------------------------------------------------------- */

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.COMPOSIO_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "COMPOSIO_WEBHOOK_SECRET not configured" },
      { status: 500 }
    );
  }

  // Read raw body for signature verification BEFORE JSON.parse — otherwise
  // any normalization (e.g. key reordering) breaks the HMAC.
  const rawBody = await req.text();
  const signature = req.headers.get(SIGNATURE_HEADER) ?? "";
  const timestamp = req.headers.get(TIMESTAMP_HEADER);

  const valid = await verifyComposioSignature({
    secret,
    payload: rawBody,
    signature,
    timestamp,
  });
  if (!valid) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let event: ComposioWebhookPayload;
  try {
    event = JSON.parse(rawBody) as ComposioWebhookPayload;
  } catch {
    return NextResponse.json({ error: "malformed json" }, { status: 400 });
  }

  const eventId = event.id;
  const eventType = (event.type ?? "").toLowerCase();
  const composioAccountId = event.connectedAccountId;
  if (!eventId || !eventType || !composioAccountId) {
    return NextResponse.json(
      { error: "missing required fields (id, type, connectedAccountId)" },
      { status: 400 }
    );
  }

  // Only handle gmail-message events in v0. Other event types (Stripe, Calendar
  // delta, etc.) get audit-logged but no further routing.
  const isGmailReceived =
    eventType === "gmail.message.received" ||
    eventType === "gmail_new_message" ||
    eventType === "gmail.thread.received";

  const bridge = bridgeSecret();

  if (!isGmailReceived) {
    await convex.mutation(api.dealTriage.recordWebhookEventPublic, {
      secret: bridge,
      eventId,
      eventType,
      composioAccountId,
      status: "processed",
      detail: `event type '${eventType}' is not a gmail-receive — audit-only`,
      rawPayload: event,
    });
    return NextResponse.json({ ok: true, skipped: "not-gmail-receive" });
  }

  // Resolve creator. Lookup by SHA-256 hash of the composio account id (see
  // schema.ts `connectedAccounts.composioAccountIdHash` for rationale).
  const accountHash = await sha256Hex(composioAccountId);
  const owner = await convex.query(
    api.dealTriage.findCreatorByComposioAccountPublic,
    { secret: bridge, composioAccountIdHash: accountHash }
  );

  if (!owner) {
    await convex.mutation(api.dealTriage.recordWebhookEventPublic, {
      secret: bridge,
      eventId,
      eventType,
      composioAccountId,
      threadId: event.data?.threadId,
      messageId: event.data?.messageId,
      status: "resolved_no_creator",
      detail: "no connectedAccounts row matched the composio account id hash",
      rawPayload: event,
    });
    // 200 OK so Composio doesn't retry — there's nothing we can do.
    return NextResponse.json({ ok: true, skipped: "unknown-account" });
  }

  // Plan-tier gate. Starter creators get silently dropped here. Defense in
  // depth: the triage action gates again on `gmailDealDeskEnabled`.
  if (owner.plan === "starter") {
    await convex.mutation(api.dealTriage.recordWebhookEventPublic, {
      secret: bridge,
      eventId,
      eventType,
      composioAccountId,
      creatorId: owner.creatorId,
      threadId: event.data?.threadId,
      messageId: event.data?.messageId,
      status: "plan_dropped",
      detail: "starter plan — gmail deal desk not available",
      rawPayload: event,
    });
    return NextResponse.json({ ok: true, skipped: "plan-tier" });
  }

  // Replay defense + audit log. If we've seen this eventId before, the
  // recorder returns alreadySeen=true and we short-circuit (no double-triage).
  const audit = await convex.mutation(api.dealTriage.recordWebhookEventPublic, {
    secret: bridge,
    eventId,
    eventType,
    composioAccountId,
    creatorId: owner.creatorId,
    threadId: event.data?.threadId,
    messageId: event.data?.messageId,
    status: "processed",
    rawPayload: event,
  });
  if (audit.alreadySeen) {
    return NextResponse.json({ ok: true, skipped: "replay" });
  }

  // Fire the triage action. The webhook returns 200 immediately; any failure
  // inside triage is logged to mayaActionLog by the action itself.
  if (!event.data?.threadId) {
    await convex.mutation(api.dealTriage.recordWebhookEventPublic, {
      secret: bridge,
      eventId: `${eventId}.dispatch-failed`,
      eventType,
      composioAccountId,
      creatorId: owner.creatorId,
      status: "errored",
      detail: "event payload missing data.threadId",
      rawPayload: event,
    });
    return NextResponse.json({ ok: true, error: "missing threadId" });
  }

  // The triage action is the canonical entry point — invoking it from the
  // webhook bridges through the public wrapper which validates the shared
  // secret before delegating to the internal action. Any failure inside
  // triage is logged to mayaActionLog by the action itself.
  await convex.action(api.dealTriage.triageInboundEmailFromWebhookPublic, {
    secret: bridge,
    creatorId: owner.creatorId,
    composioAccountId,
    threadId: event.data.threadId,
  });

  return NextResponse.json({ ok: true });
}
