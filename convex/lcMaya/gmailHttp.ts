/**
 * Gmail HTTP endpoints (Sprint 9.8 Workstream A).
 *
 * Maya-callable surface for Gmail. Each endpoint:
 *   1. Validates body + webhook secret
 *   2. Resolves a fresh access token via `resolveGoogleAccessTokenForCreator`
 *      (asserts gmail.modify scope is granted; refreshes token if needed)
 *   3. Calls the corresponding wrapper in `convex/integrations/google/gmail.ts`
 *   4. Returns the wrapper result as JSON
 *
 * Surface (4 endpoints — minimum viable for brand-deal triage + drafting):
 *   POST /lc_maya/gmail_list_inbox    — list latest message refs
 *   POST /lc_maya/gmail_get_message   — fetch headers + snippet for one msg
 *   POST /lc_maya/gmail_draft         — create a draft reply
 *   POST /lc_maya/gmail_send          — send a message (creator-approved only)
 *
 * Status codes:
 *   200 — happy path, body shape per endpoint
 *   400 — malformed body
 *   401 — wrong secret
 *   403 — connection missing required gmail.modify scope (creator needs
 *         to re-consent — Google returned a partial scope grant)
 *   404 — creator has no Google connection (connect flow not completed)
 *   500 — Gmail API error or token refresh failed
 */

import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { assertWebhookSecret } from "../lib/webhookSecret";
import {
  GmailApiError,
  createDraft,
  getMessageDetail,
  listInboxMessages,
  sendMessage,
} from "../integrations/google/gmail";

const GMAIL_REQUIRED_SCOPE = "https://www.googleapis.com/auth/gmail.modify";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface CommonPayload {
  secret: unknown;
  creatorId: unknown;
}

function parseCommon(raw: unknown): {
  secret: string;
  creatorId: string;
} {
  if (!raw || typeof raw !== "object") {
    throw new Error("Body must be a JSON object.");
  }
  const obj = raw as CommonPayload;
  if (typeof obj.secret !== "string") {
    throw new Error("secret must be a string.");
  }
  if (typeof obj.creatorId !== "string" || obj.creatorId.length === 0) {
    throw new Error("creatorId is required.");
  }
  return { secret: obj.secret, creatorId: obj.creatorId };
}

/**
 * Centralized error mapper. Token-resolver throws strings like
 * "no-connection" / "scope-missing" / "refresh-failed: <detail>"; Gmail
 * wrappers throw GmailApiError with a status. This maps to clean HTTP
 * status codes Maya can branch on.
 */
function errToResponse(err: unknown): Response {
  const rawMsg = (err as Error).message ?? "internal-error";
  // Convex wraps thrown errors from runAction with "Uncaught Error: <msg>\n    at handler...".
  // Match against the unwrapped tag so we don't have to track wrap variants.
  const has = (tag: string): boolean => rawMsg.includes(tag);

  if (has("no-connection")) {
    return jsonResponse(
      {
        error: "no-google-connection",
        hint: "Creator has not completed the Google connect flow. Send the OAuth link via /lc_maya/start_oauth provider=gmail.",
      },
      404
    );
  }
  if (has("no-refresh-token")) {
    return jsonResponse(
      {
        error: "no-refresh-token",
        hint: "Connection exists but the refresh token is missing — re-consent required.",
      },
      403
    );
  }
  if (has("scope-missing")) {
    return jsonResponse(
      {
        error: "scope-missing",
        requiredScope: GMAIL_REQUIRED_SCOPE,
        hint: "Creator's connection doesn't include gmail.modify. They need to re-consent through the unified Google OAuth flow.",
      },
      403
    );
  }
  if (has("missing-google-creds")) {
    return jsonResponse(
      {
        error: "missing-google-creds",
        hint: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set in Convex env.",
      },
      500
    );
  }
  if (has("refresh-failed")) {
    return jsonResponse({ error: "refresh-failed", detail: rawMsg }, 500);
  }
  if (err instanceof GmailApiError) {
    return jsonResponse(
      {
        error: "gmail-api-error",
        status: err.status,
        message: err.message,
        body: err.body,
      },
      err.status >= 400 && err.status < 600 ? err.status : 500
    );
  }
  return jsonResponse({ error: rawMsg }, 500);
}

/* -------------------------------------------------------------------------- */
/* Endpoint A — gmail_list_inbox                                                */
/* -------------------------------------------------------------------------- */

export const gmailListInboxHttp = httpAction(async (ctx, request) => {
  let body: { secret: string; creatorId: string };
  let extras: { maxResults?: number; q?: string };
  try {
    const raw = (await request.json()) as Record<string, unknown>;
    body = parseCommon(raw);
    extras = {};
    if (typeof raw.maxResults === "number") extras.maxResults = raw.maxResults;
    if (typeof raw.q === "string") extras.q = raw.q;
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 400);
  }

  try {
    assertWebhookSecret(body.secret);
  } catch {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  try {
    const { accessToken } = await ctx.runAction(
      internal.integrations.google.tokenResolver
        .resolveGoogleAccessTokenForCreator,
      {
        creatorId: body.creatorId as Id<"creators">,
        requiredScope: GMAIL_REQUIRED_SCOPE,
      }
    );
    const result = await listInboxMessages(accessToken, extras);
    return jsonResponse({ ok: true, ...result }, 200);
  } catch (err) {
    return errToResponse(err);
  }
});

/* -------------------------------------------------------------------------- */
/* Endpoint B — gmail_get_message                                               */
/* -------------------------------------------------------------------------- */

export const gmailGetMessageHttp = httpAction(async (ctx, request) => {
  let body: { secret: string; creatorId: string };
  let messageId: string;
  let format: "metadata" | "full";
  try {
    const raw = (await request.json()) as Record<string, unknown>;
    body = parseCommon(raw);
    if (typeof raw.messageId !== "string" || raw.messageId.length === 0) {
      throw new Error("messageId is required.");
    }
    messageId = raw.messageId;
    format =
      raw.format === "full" ? "full" : "metadata"; // default to metadata
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 400);
  }

  try {
    assertWebhookSecret(body.secret);
  } catch {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  try {
    const { accessToken } = await ctx.runAction(
      internal.integrations.google.tokenResolver
        .resolveGoogleAccessTokenForCreator,
      {
        creatorId: body.creatorId as Id<"creators">,
        requiredScope: GMAIL_REQUIRED_SCOPE,
      }
    );
    const message = await getMessageDetail(accessToken, messageId, format);
    return jsonResponse({ ok: true, message }, 200);
  } catch (err) {
    return errToResponse(err);
  }
});

/* -------------------------------------------------------------------------- */
/* Endpoint C — gmail_draft                                                     */
/* -------------------------------------------------------------------------- */

export const gmailDraftHttp = httpAction(async (ctx, request) => {
  let body: { secret: string; creatorId: string };
  let draft: {
    to: string;
    subject?: string;
    bodyText: string;
    threadId?: string;
  };
  try {
    const raw = (await request.json()) as Record<string, unknown>;
    body = parseCommon(raw);
    if (typeof raw.to !== "string" || raw.to.length === 0) {
      throw new Error("to is required.");
    }
    if (typeof raw.bodyText !== "string" || raw.bodyText.length === 0) {
      throw new Error("bodyText is required.");
    }
    draft = {
      to: raw.to,
      subject: typeof raw.subject === "string" ? raw.subject : undefined,
      bodyText: raw.bodyText,
      threadId: typeof raw.threadId === "string" ? raw.threadId : undefined,
    };
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 400);
  }

  try {
    assertWebhookSecret(body.secret);
  } catch {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  try {
    const { accessToken } = await ctx.runAction(
      internal.integrations.google.tokenResolver
        .resolveGoogleAccessTokenForCreator,
      {
        creatorId: body.creatorId as Id<"creators">,
        requiredScope: GMAIL_REQUIRED_SCOPE,
      }
    );
    const draftResult = await createDraft(accessToken, draft);
    return jsonResponse({ ok: true, draft: draftResult }, 200);
  } catch (err) {
    return errToResponse(err);
  }
});

/* -------------------------------------------------------------------------- */
/* Endpoint D — gmail_send                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Send a message immediately. Maya's standing-order rule is "draft first,
 * send only after explicit creator approval." The orchestrating
 * conversation flow enforces that gate; this endpoint is unconditional —
 * it sends whatever it's asked to send. Maya is responsible for:
 *   1. First creating a draft via /lc_maya/gmail_draft
 *   2. Sending the draft preview to the creator via claw-messenger
 *   3. Waiting for explicit approval ("yes send it" / "looks good")
 *   4. Only then calling /lc_maya/gmail_send
 *
 * Audit-trail requirement: every send results in a row Maya logs via
 * mayaActionLog with the message id + thread id; that's a follow-on
 * standing-order tweak, not in this endpoint.
 */
export const gmailSendHttp = httpAction(async (ctx, request) => {
  let body: { secret: string; creatorId: string };
  let message: {
    to: string;
    subject?: string;
    bodyText: string;
    threadId?: string;
  };
  try {
    const raw = (await request.json()) as Record<string, unknown>;
    body = parseCommon(raw);
    if (typeof raw.to !== "string" || raw.to.length === 0) {
      throw new Error("to is required.");
    }
    if (typeof raw.bodyText !== "string" || raw.bodyText.length === 0) {
      throw new Error("bodyText is required.");
    }
    message = {
      to: raw.to,
      subject: typeof raw.subject === "string" ? raw.subject : undefined,
      bodyText: raw.bodyText,
      threadId: typeof raw.threadId === "string" ? raw.threadId : undefined,
    };
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 400);
  }

  try {
    assertWebhookSecret(body.secret);
  } catch {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  try {
    const { accessToken } = await ctx.runAction(
      internal.integrations.google.tokenResolver
        .resolveGoogleAccessTokenForCreator,
      {
        creatorId: body.creatorId as Id<"creators">,
        requiredScope: GMAIL_REQUIRED_SCOPE,
      }
    );
    const sentResult = await sendMessage(accessToken, message);
    return jsonResponse({ ok: true, sent: sentResult }, 200);
  } catch (err) {
    return errToResponse(err);
  }
});
