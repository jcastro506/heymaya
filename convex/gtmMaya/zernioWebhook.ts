/**
 * Maya v2 — Zernio inbound webhook (the reliable connection signal).
 *
 * WHY THIS EXISTS: the OAuth callback (zernioConnect.ts) only persists accounts
 * when the founder's browser redirect makes it back AND our single-use token is
 * still live. That happy path is fragile — a dropped redirect, a re-tapped link,
 * or a moment of Zernio eventual-consistency lag all leave us with 0 accounts
 * persisted and no idea a connection happened. Zernio's `account.connected`
 * webhook is the source-of-truth signal: it fires when the platform OAuth
 * actually completes, independent of the browser. We verify it, route it to the
 * owning agent by profile id, and run the SAME authoritative reconcile the
 * callback uses (reconcileAccountsForAgent → listAccounts → connectedAccountsJson).
 *
 * ARCHITECTURE: HeyMaya v2 uses ONE shared Zernio account (`ZERNIO_API_KEY`)
 * with one profile per founder (`gtmAgents.zernioProfileId`). So there is ONE
 * webhook for the whole account, signed with ONE shared secret
 * (`ZERNIO_WEBHOOK_SECRET`). Each delivery carries the profile id; we resolve it
 * to exactly one agent via the `by_zernio_profile` index. Run
 * `ensureZernioGtmWebhook` once (operator) to register it.
 *
 * SECURITY: every delivery is HMAC-SHA256 verified against ZERNIO_WEBHOOK_SECRET
 * (constant-time, in client.ts). An unverified body is rejected 401 and nothing
 * is read or written. Replay defense via the shared `webhookEvents` table
 * (provider `zernio-gtm`). We return 200 on everything we accept (including
 * unknown profiles / event types) so Zernio doesn't enter a redelivery storm —
 * the audit row is the forensics trail.
 */

import { v } from "convex/values";
import { httpAction, internalAction, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  ZERNIO_SIGNATURE_HEADER,
  X_LATE_SIGNATURE_HEADER,
  verifyZernioSignature,
  ZernioClient,
} from "../integrations/zernio/client";
import { createWebhook, listWebhooks } from "../integrations/zernio/endpoints";
import type { ZernioWebhookSubscribableEvent } from "../integrations/zernio/types";

const PROVIDER = "zernio-gtm";

/** The events the GTM webhook subscribes to. account.* drives the reliable
 *  connection signal; post.* are audit-logged for now (future post-status sync). */
const GTM_WEBHOOK_EVENTS: ReadonlyArray<ZernioWebhookSubscribableEvent> = [
  "account.connected",
  "account.disconnected",
  "post.published",
  "post.failed",
];

/* ────────────────────────────────────────────────────────────────────────
 * Replay defense — reuse the shared webhookEvents table (provider scoped).
 * ──────────────────────────────────────────────────────────────────────── */

export const recordGtmWebhookEventIfNew = internalMutation({
  args: { externalEventId: v.string(), kind: v.string() },
  handler: async (ctx, args): Promise<{ isNew: boolean }> => {
    const existing = await ctx.db
      .query("webhookEvents")
      .withIndex("by_provider_and_event_id", (q) =>
        q.eq("provider", PROVIDER).eq("externalEventId", args.externalEventId)
      )
      .first();
    if (existing) return { isNew: false };
    await ctx.db.insert("webhookEvents", {
      provider: PROVIDER,
      externalEventId: args.externalEventId,
      kind: args.kind,
      processedAt: Date.now(),
    });
    return { isNew: true };
  },
});

/* ────────────────────────────────────────────────────────────────────────
 * Payload helpers — defensive extraction (live shape unconfirmed).
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Find a Zernio profile id anywhere in the payload. Zernio reports profileId
 * either as a bare string or a nested `{ _id, name, slug }` object (the accounts
 * list uses the nested form), and the webhook may nest the account under
 * `account` / `data`. We scan defensively (bounded depth) rather than guess the
 * exact path, since the live `account.connected` payload shape isn't pinned.
 */
export function extractProfileId(value: unknown, depth = 0): string | null {
  if (depth > 6 || value === null || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const pid = obj.profileId;
  if (typeof pid === "string" && pid.length > 0) return pid;
  if (pid && typeof pid === "object") {
    const nested = (pid as Record<string, unknown>)._id;
    if (typeof nested === "string" && nested.length > 0) return nested;
  }
  for (const key of Object.keys(obj)) {
    if (key === "profileId") continue;
    const found = extractProfileId(obj[key], depth + 1);
    if (found) return found;
  }
  return null;
}

function eventId(obj: Record<string, unknown>): string | null {
  if (typeof obj.id === "string" && obj.id) return obj.id;
  if (typeof obj.eventId === "string" && obj.eventId) return obj.eventId;
  return null;
}

function eventType(obj: Record<string, unknown>): string | null {
  if (typeof obj.event === "string" && obj.event) return obj.event;
  if (typeof obj.type === "string" && obj.type) return obj.type;
  return null;
}

/* ────────────────────────────────────────────────────────────────────────
 * Best-effort Telegram confirmation ("Reddit connected ✓").
 * ──────────────────────────────────────────────────────────────────────── */

async function sendConnectConfirm(
  ctx: Parameters<Parameters<typeof httpAction>[0]>[0],
  agentId: import("../_generated/dataModel").Id<"gtmAgents">,
  telegramChatId: string | null,
  text: string
): Promise<void> {
  if (!telegramChatId) return;
  try {
    const { resolveBotForAgent } = await import("./telegramBotPerTenant");
    const bot = await resolveBotForAgent(
      ctx as { runQuery: <T>(ref: unknown, args: unknown) => Promise<T> },
      agentId,
      {
        sharedToken: process.env.TELEGRAM_BOT_TOKEN,
        sharedUsername: process.env.TELEGRAM_BOT_USERNAME,
      }
    );
    if (!bot.token) return;
    const { sendDirectTelegramMessage } = await import(
      "../integrations/telegram/sendDirectMessage"
    );
    await sendDirectTelegramMessage({
      botToken: bot.token,
      chatId: telegramChatId,
      text,
    });
  } catch {
    /* confirmation is best-effort — never fail the webhook over it */
  }
}

/* ────────────────────────────────────────────────────────────────────────
 * Public webhook receiver — POST /lc_gtm/zernio_webhook
 * ──────────────────────────────────────────────────────────────────────── */

export const zernioWebhookHttp = httpAction(async (ctx, request) => {
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  const secret = process.env.ZERNIO_WEBHOOK_SECRET;
  // No secret configured → we can't verify, so we must not act. 200 (not 4xx)
  // to avoid a Zernio redelivery storm; the operator sets the secret + runs
  // ensureZernioGtmWebhook to turn this on.
  if (!secret) return json({ ok: false, reason: "webhook-secret-not-configured" });

  const rawBody = await request.text();
  const signature =
    request.headers.get(ZERNIO_SIGNATURE_HEADER) ??
    request.headers.get(X_LATE_SIGNATURE_HEADER);

  const verified = await verifyZernioSignature(rawBody, signature, secret);
  if (!verified) return json({ ok: false, reason: "signature-invalid" }, 401);

  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object") throw new Error("not-object");
    payload = parsed as Record<string, unknown>;
  } catch {
    return json({ ok: true, reason: "malformed-json" });
  }

  const id = eventId(payload);
  const type = eventType(payload);
  if (!id || !type) return json({ ok: true, reason: "missing-id-or-type" });

  // Replay defense — at-least-once delivery means duplicates are normal.
  const { isNew } = await ctx.runMutation(
    internal.gtmMaya.zernioWebhook.recordGtmWebhookEventIfNew,
    { externalEventId: id, kind: type }
  );
  if (!isNew) return json({ ok: true, reason: "duplicate" });

  // Only account.* events drive connection state; everything else is audited.
  if (type !== "account.connected" && type !== "account.disconnected") {
    return json({ ok: true, reason: "audited", type });
  }

  const profileId = extractProfileId(payload);
  if (!profileId) return json({ ok: true, reason: "no-profile-in-payload", type });

  const agent = await ctx.runQuery(
    internal.gtmMaya.zernioConnect.lookupAgentByZernioProfile,
    { zernioProfileId: profileId }
  );
  if (!agent) return json({ ok: true, reason: "unknown-profile", type });

  // Authoritative reconcile — the SAME path the OAuth callback uses. Whether the
  // event is connect or disconnect, re-reading listAccounts is the truth.
  const result = await ctx.runAction(
    internal.gtmMaya.zernioConnect.reconcileAccountsForAgent,
    { agentId: agent.agentId }
  );

  if (type === "account.connected" && result.ok) {
    await sendConnectConfirm(
      ctx,
      agent.agentId,
      agent.telegramChatId,
      "An account just connected — I can post there for you now."
    );
  }

  return json({ ok: result.ok, type, connectedCount: result.connectedCount });
});

/* ────────────────────────────────────────────────────────────────────────
 * Operator-run — register the shared GTM webhook (idempotent).
 *
 *   npx convex run gtmMaya/zernioWebhook:ensureZernioGtmWebhook
 *
 * Requires ZERNIO_API_KEY + ZERNIO_WEBHOOK_SECRET + CONVEX_SITE_URL in the
 * Convex deployment env. Safe to run repeatedly — finds an existing webhook by
 * URL and returns it instead of creating a duplicate.
 * ──────────────────────────────────────────────────────────────────────── */

export const ensureZernioGtmWebhook = internalAction({
  args: {},
  handler: async (): Promise<{ ok: boolean; webhookId?: string; reason?: string; created?: boolean }> => {
    const apiKey = process.env.ZERNIO_API_KEY;
    if (!apiKey) return { ok: false, reason: "ZERNIO_API_KEY not set" };
    const secret = process.env.ZERNIO_WEBHOOK_SECRET;
    if (!secret) return { ok: false, reason: "ZERNIO_WEBHOOK_SECRET not set" };
    const site = (process.env.CONVEX_SITE_URL ?? "").replace(/\/+$/, "");
    if (!site) return { ok: false, reason: "CONVEX_SITE_URL not set" };

    const url = `${site}/lc_gtm/zernio_webhook`;
    const client = new ZernioClient({ apiKey });

    try {
      const existing = await listWebhooks(client);
      const match = existing.find((w) => w.url === url);
      if (match && match.id) {
        return { ok: true, webhookId: match.id, created: false };
      }
    } catch {
      // listing failed (endpoint shape / permissions) — fall through to create.
    }

    const created = await createWebhook(client, {
      name: "heymaya-gtm",
      url,
      events: GTM_WEBHOOK_EVENTS,
      secret,
      isActive: true,
    });
    return { ok: true, webhookId: created.id, created: true };
  },
});
