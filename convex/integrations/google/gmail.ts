/**
 * Gmail API v1 wrappers (Sprint 9.8 Workstream A).
 *
 * Pure stateless API surface — every function takes an access token and
 * returns parsed JSON. No Convex deps, no token refresh, no DB lookup.
 * The orchestrating Convex actions own connection-row resolution +
 * `refreshGoogleAccessToken` round-trips before calling these wrappers.
 *
 * We use raw `fetch` instead of the `googleapis` npm package because:
 *   - Calendar already uses raw fetch (`fetchGoogleCalendarEvents` /
 *     `createGoogleCalendarEvent` in `convex/creatorMayaV0/backend.ts`).
 *     Same shape, same access token, same auth header.
 *   - The `googleapis` package is ~5MB and pulls a generated client for
 *     every Google API. Maya only needs Gmail messages + drafts +
 *     send + Calendar events — keeping the dep count down.
 *
 * Scope: requires `https://www.googleapis.com/auth/gmail.modify` (read +
 * send + draft + label, NOT permanent delete). The unified Google OAuth
 * scope list in `convex/lcMaya/lcMayaHttp.ts` (`GOOGLE_OAUTH_SCOPES`)
 * already requests this. Existing Calendar connections that pre-date
 * Sprint 9.8 will NOT have gmail.modify and must re-consent.
 */

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

/**
 * Common Gmail message metadata. Returned by listInboxMessages; the full
 * message body / payload is fetched separately via getMessageDetail.
 */
export interface GmailMessageRef {
  id: string;
  threadId: string;
}

export interface GmailListResponse {
  messages: GmailMessageRef[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

/**
 * Detail-format response. We always request `format=metadata` for the
 * common path (subject + from + snippet + labels) — full bodies are
 * heavier and only needed when Maya is drafting a reply.
 */
export interface GmailMessageMetadata {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string; // ms since epoch as string
  payload?: {
    mimeType?: string;
    headers?: Array<{ name: string; value: string }>;
    parts?: Array<{
      mimeType?: string;
      body?: { data?: string; size?: number };
      headers?: Array<{ name: string; value: string }>;
    }>;
    body?: { data?: string; size?: number };
  };
}

export class GmailApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: string
  ) {
    super(message);
    this.name = "GmailApiError";
  }
}

async function gmailFetch(
  accessToken: string,
  path: string,
  init?: RequestInit
): Promise<Response> {
  const url = `${GMAIL_BASE}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
  });
  return response;
}

async function readJsonOrThrow<T>(response: Response, op: string): Promise<T> {
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new GmailApiError(
      response.status,
      `Gmail ${op} failed: ${response.status}`,
      text.slice(0, 400)
    );
  }
  return (await response.json()) as T;
}

/**
 * List inbox messages. Default: latest 10 unread + read messages from the
 * INBOX label (most recent first by Gmail's internal ordering). Caller can
 * pass a Gmail search query (`q`) to narrow — e.g.
 * `q: "from:partnerships OR from:brand newer_than:7d"` to find brand
 * outreach.
 *
 * Returns ONLY the message id + thread id. Use `getMessageDetail` to
 * fetch headers / body / labels for any specific message.
 */
export async function listInboxMessages(
  accessToken: string,
  opts: {
    maxResults?: number;
    q?: string;
    labelIds?: string[];
    pageToken?: string;
  } = {}
): Promise<GmailListResponse> {
  const params = new URLSearchParams();
  if (typeof opts.maxResults === "number") {
    params.set("maxResults", String(opts.maxResults));
  } else {
    params.set("maxResults", "10");
  }
  if (opts.q) params.set("q", opts.q);
  if (opts.labelIds && opts.labelIds.length > 0) {
    for (const l of opts.labelIds) params.append("labelIds", l);
  } else {
    params.append("labelIds", "INBOX");
  }
  if (opts.pageToken) params.set("pageToken", opts.pageToken);
  const response = await gmailFetch(
    accessToken,
    `/messages?${params.toString()}`
  );
  const json = await readJsonOrThrow<{
    messages?: GmailMessageRef[];
    nextPageToken?: string;
    resultSizeEstimate?: number;
  }>(response, "list-inbox");
  return {
    messages: json.messages ?? [],
    nextPageToken: json.nextPageToken,
    resultSizeEstimate: json.resultSizeEstimate,
  };
}

/**
 * Fetch a single message's metadata + headers (default format). The
 * caller can pass `format: "full"` to also pull message body parts; the
 * `metadata` default is enough for "is this a brand-deal email?" triage.
 */
export async function getMessageDetail(
  accessToken: string,
  messageId: string,
  format: "metadata" | "full" = "metadata"
): Promise<GmailMessageMetadata> {
  const params = new URLSearchParams({ format });
  if (format === "metadata") {
    // Limit to the headers Maya needs for triage. Reduces payload size +
    // signals to the API we don't need full body parts.
    for (const h of ["From", "To", "Subject", "Date"]) {
      params.append("metadataHeaders", h);
    }
  }
  const response = await gmailFetch(
    accessToken,
    `/messages/${encodeURIComponent(messageId)}?${params.toString()}`
  );
  return await readJsonOrThrow<GmailMessageMetadata>(response, "get-message");
}

export interface GmailDraftCreate {
  to: string;
  /** Optional reply-to context — when set, the draft becomes a reply in
   *  the matching thread. */
  threadId?: string;
  /** RFC2822 subject. Required for new drafts; replies inherit from the
   *  thread when omitted. */
  subject?: string;
  /** Plain-text body. We don't support HTML in v0; Maya drafts in plain
   *  text so the creator sees what's going out. */
  bodyText: string;
  /** Optional explicit From — Gmail uses the connected account's primary
   *  send-as address by default; only set this if the creator has a
   *  configured Send-As that they want Maya to use. */
  from?: string;
}

export interface GmailDraftResponse {
  id: string;
  message: { id: string; threadId: string };
}

/**
 * Build an RFC 2822 message from the simple `GmailDraftCreate` shape and
 * base64url-encode for the Gmail API. Headers MUST be CRLF-terminated;
 * the API rejects LF-only.
 */
function buildRfc2822(opts: GmailDraftCreate): string {
  const lines: string[] = [];
  if (opts.from) lines.push(`From: ${opts.from}`);
  lines.push(`To: ${opts.to}`);
  if (opts.subject) lines.push(`Subject: ${opts.subject}`);
  lines.push("MIME-Version: 1.0");
  lines.push("Content-Type: text/plain; charset=UTF-8");
  lines.push("Content-Transfer-Encoding: 7bit");
  lines.push("");
  lines.push(opts.bodyText);
  return lines.join("\r\n");
}

function base64UrlEncode(input: string): string {
  // Convex's runtime exposes `btoa` (URL-unsafe base64). Convert to
  // URL-safe by swapping `+/` → `-_` and stripping trailing `=`.
  // For Unicode safety (creators may include emoji in drafts), encode to
  // UTF-8 first via TextEncoder.
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  const b64 = btoa(binary);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function createDraft(
  accessToken: string,
  draft: GmailDraftCreate
): Promise<GmailDraftResponse> {
  const raw = base64UrlEncode(buildRfc2822(draft));
  const body = JSON.stringify({
    message: {
      raw,
      ...(draft.threadId ? { threadId: draft.threadId } : {}),
    },
  });
  const response = await gmailFetch(accessToken, "/drafts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  return await readJsonOrThrow<GmailDraftResponse>(response, "create-draft");
}

export interface GmailSendResponse {
  id: string;
  threadId: string;
  labelIds?: string[];
}

/**
 * Send a message immediately. Maya should NEVER call this on a creator's
 * behalf without explicit creator approval; the standing-order rule is
 * "draft first, send only after the creator says go." The orchestrating
 * Convex action enforces that gate; this wrapper is unconditional.
 */
export async function sendMessage(
  accessToken: string,
  message: GmailDraftCreate
): Promise<GmailSendResponse> {
  const raw = base64UrlEncode(buildRfc2822(message));
  const body = JSON.stringify({
    raw,
    ...(message.threadId ? { threadId: message.threadId } : {}),
  });
  const response = await gmailFetch(accessToken, "/messages/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  return await readJsonOrThrow<GmailSendResponse>(response, "send-message");
}

/* -------------------------------------------------------------------------- */
/* Test seam                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Internal handle for tests — exposes the RFC 2822 builder so we can
 * assert header shape without round-tripping through fetch. NOT part of
 * the public surface; production callers MUST go through the wrappers
 * above so the auth header + URL are uniform.
 */
export const _internal = {
  buildRfc2822,
  base64UrlEncode,
};
