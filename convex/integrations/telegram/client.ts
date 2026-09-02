/**
 * Telegram Bot API client.
 *
 * Sprint 15 (Part II D1 of CLAWLAUNCH_GTM_MVP_EXECUTION_SPRINT.md). ClawLaunch
 * leads with Telegram for channel pairing because WhatsApp is QR-only (no
 * multi-tenant programmatic provisioning) and iMessage requires a macOS host.
 *
 * This module is the lowest-level layer: HTTPS calls to api.telegram.org and
 * typed envelopes. Higher-level pairing + cron-delivery logic lives in
 * `convex/gtmMaya/telegram/*` and the workspace generator.
 *
 * Env discipline:
 *   - TELEGRAM_BOT_TOKEN — the canonical name (matches OpenClaw native).
 *   - TELEGRAM_BOT_TOKEN_STAGING / _PRODUCTION — optional per-env overrides.
 *
 * Two bots are provisioned per Sprint 15 spec:
 *   @ClawLaunchBot         — production
 *   @ClawLaunchStagingBot  — staging Convex deployment
 *
 * The bot username is needed to build the deep link
 * (https://t.me/<bot>?start=pair_<token>), so we cache it alongside the token.
 */

const TELEGRAM_API_BASE = "https://api.telegram.org";

export interface TelegramBotIdentity {
  /** Bot token used in the URL path. Never log or surface to clients. */
  token: string;
  /** Bot username without @, e.g. "ClawLaunchStagingBot". */
  username: string;
}

export interface TelegramSendMessageArgs {
  chatId: string | number;
  text: string;
  /** Optional. If set, Telegram will format the message accordingly. */
  parseMode?: "MarkdownV2" | "HTML";
  /** Default true. Disable when the message is a structured notification. */
  disableNotification?: boolean;
  /** Reply scope. */
  replyParameters?: { messageId: number; chatId?: string | number };
  /** One-tap options (plan §7 S3). Rendered as an inline keyboard, up to three per row. */
  buttons?: Array<{ id: string; label: string }>;
}

export interface TelegramApiOk<T> {
  ok: true;
  result: T;
}

export interface TelegramApiErr {
  ok: false;
  description: string;
  errorCode?: number;
}

export type TelegramApiResult<T> = TelegramApiOk<T> | TelegramApiErr;

/**
 * Inbound update envelope. We only model the fields we read; Telegram sends
 * many more (edited messages, inline queries, payment events, etc.).
 */
export interface TelegramInboundUpdate {
  update_id: number;
  message?: TelegramInboundMessage;
  /** Present when the user taps an inline-keyboard button. `data` carries our button id. */
  callback_query?: TelegramCallbackQuery;
  /** Present when a reaction changes on a message (needs `message_reaction` in allowed_updates). */
  message_reaction?: TelegramMessageReaction;
}

export interface TelegramMessageReaction {
  chat: { id: number; type: string };
  message_id: number;
  user?: { id: number; username?: string };
  date: number;
  old_reaction: Array<{ type: string; emoji?: string }>;
  new_reaction: Array<{ type: string; emoji?: string }>;
}

export interface TelegramCallbackQuery {
  id: string;
  from?: { id: number; username?: string };
  data?: string;
  message?: {
    message_id: number;
    chat: { id: number; type: string; username?: string };
  };
}

export interface TelegramInboundMessage {
  message_id: number;
  date: number;
  chat: { id: number; type: string; username?: string; title?: string };
  from?: {
    id: number;
    is_bot: boolean;
    first_name?: string;
    last_name?: string;
    username?: string;
  };
  text?: string;
  entities?: Array<{ type: string; offset: number; length: number }>;

  /**
   * ── Attachments ────────────────────────────────────────────────────────
   *
   * ⚠️ On a media message `text` is ALWAYS undefined — the founder's words
   * arrive in `caption`. That single fact is why file uploads were silently
   * dropped: the switchboard forked on `message.text`, so a photo fell off the
   * end of the handler and the founder got no reply at all.
   */
  caption?: string;
  /**
   * Set on every item of an album. Telegram sends N SEPARATE updates for N
   * files sent together, so this is the only thing tying them into one act.
   */
  media_group_id?: string;
  /** Ascending by size — the LAST entry is the largest. Telegram recompresses
   *  these to JPEG; a screenshot sent as a *document* keeps its pixels. */
  photo?: TelegramPhotoSize[];
  document?: TelegramFileMeta & { file_name?: string; mime_type?: string };
  video?: TelegramFileMeta & { mime_type?: string; duration?: number };
  /** ⚠️ The round selfie bubble — NOT a screen recording. See `extractFile`. */
  video_note?: TelegramFileMeta & { duration?: number };
  /** A GIF. ⚠️ Also carries `document`, so it must be matched FIRST. */
  animation?: TelegramFileMeta & { mime_type?: string };
}

export interface TelegramFileMeta {
  file_id: string;
  /** Stable per file across chats and re-sends — the right idempotency key. */
  file_unique_id: string;
  /** Present before any download, which is how an oversize file is refused
   *  without spending the fetch. Optional: Telegram omits it sometimes. */
  file_size?: number;
}

export interface TelegramPhotoSize extends TelegramFileMeta {
  width: number;
  height: number;
}

/**
 * Parse a `/start <payload>` entry. The Bot API delivers the deep-link
 * payload as the message text "/start pair_<token>" (with a bot_command
 * entity). Returns the payload string if the message is a /start command,
 * otherwise null.
 */
export function parseStartCommand(
  message: TelegramInboundMessage | undefined
): string | null {
  if (!message?.text) return null;
  const text = message.text.trim();
  if (!text.startsWith("/start")) return null;
  const parts = text.split(/\s+/);
  if (parts.length < 2) return null;
  return parts.slice(1).join(" ").trim();
}

/**
 * Parse a pairing-token-bearing /start payload. The deep link is
 * `https://t.me/<bot>?start=pair_<token>`, so the payload arrives as
 * `pair_<token>`. Returns the bare token (no prefix) or null.
 */
export function parsePairingPayload(payload: string | null): string | null {
  if (!payload) return null;
  if (!payload.startsWith("pair_")) return null;
  const token = payload.slice("pair_".length).trim();
  return token.length > 0 ? token : null;
}

/**
 * Resolve which Telegram bot identity to use for the current Convex
 * deployment. We support per-env overrides so staging and production can
 * each have their own bot.
 */
export function resolveTelegramBotIdentity(
  env: Partial<Record<string, string | undefined>> = process.env
): TelegramBotIdentity | null {
  const stage = (env.CONVEX_DEPLOYMENT ?? "").includes("precise-canary-781")
    ? "staging"
    : "production";
  const token =
    (stage === "staging" ? env.TELEGRAM_BOT_TOKEN_STAGING : undefined) ??
    (stage === "production" ? env.TELEGRAM_BOT_TOKEN_PRODUCTION : undefined) ??
    env.TELEGRAM_BOT_TOKEN;
  const username =
    (stage === "staging" ? env.TELEGRAM_BOT_USERNAME_STAGING : undefined) ??
    (stage === "production"
      ? env.TELEGRAM_BOT_USERNAME_PRODUCTION
      : undefined) ??
    env.TELEGRAM_BOT_USERNAME;
  if (!token || !username) return null;
  return { token, username };
}

/**
 * Build the `t.me` deep link a user taps to pair their Telegram chat with
 * their ClawLaunch account.
 */
export function buildPairingDeepLink(
  identity: TelegramBotIdentity,
  token: string
): string {
  return `https://t.me/${identity.username}?start=pair_${encodeURIComponent(token)}`;
}

/**
 * Bot API URL builder. Token is in the URL path per Telegram convention; we
 * never log full URLs anywhere.
 */
function apiUrl(token: string, method: string): string {
  return `${TELEGRAM_API_BASE}/bot${token}/${method}`;
}

/**
 * Send a text message. Returns the parsed Telegram envelope.
 */
export async function sendTelegramMessage(
  identity: TelegramBotIdentity,
  args: TelegramSendMessageArgs,
  fetchImpl: typeof fetch = fetch
): Promise<TelegramApiResult<{ message_id: number }>> {
  const body: Record<string, unknown> = {
    chat_id: args.chatId,
    text: args.text,
    disable_notification: args.disableNotification ?? false,
  };
  if (args.parseMode) body.parse_mode = args.parseMode;
  if (args.replyParameters) {
    body.reply_parameters = {
      message_id: args.replyParameters.messageId,
      chat_id: args.replyParameters.chatId,
    };
  }
  if (args.buttons?.length) {
    const rows: Array<Array<{ text: string; callback_data: string }>> = [];
    for (const b of args.buttons) {
      if (!rows.length || rows[rows.length - 1].length >= 3) rows.push([]);
      rows[rows.length - 1].push({ text: b.label, callback_data: b.id.slice(0, 64) });
    }
    body.reply_markup = { inline_keyboard: rows };
  }
  const res = await fetchImpl(apiUrl(identity.token, "sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return {
      ok: false,
      description: `HTTP ${res.status} ${res.statusText}`,
      errorCode: res.status,
    };
  }
  return (await res.json()) as TelegramApiResult<{ message_id: number }>;
}

/**
 * Show the typing indicator (§17.36.2).
 *
 * ## Why one small call is load-bearing
 *
 * The runtime architecture is *"Convex is the always-warm front door, Fly is
 * the cold-startable brain"* — a machine that auto-stops when idle and wakes on
 * demand. That is a **10× cost difference** at 200 customers ($100–400/mo
 * against $1,400–3,000), and it is only viable because a webhook can wake the
 * machine on the ~6–15 occasions a day she actually thinks.
 *
 * Its cost is latency: an OpenClaw boot with a workspace is plausibly 10–30s.
 * For a webhook-driven comment reply, irrelevant. **For a founder texting her,
 * it reads as broken** — and a founder who thinks she's broken is a churn
 * event, not a patient user.
 *
 * This call is what covers that gap. The webhook hits Convex, Convex shows
 * typing *immediately*, then wakes the machine. The founder sees the most
 * ordinary thing in a messenger and the cold start disappears behind it.
 *
 * So the honest framing: without this, the auto-stop architecture doesn't work
 * as designed and the fallback is always-on at ten times the price. It is
 * thirty lines holding up the largest cost line in the model.
 *
 * ## Fire-and-forget, deliberately
 *
 * Never awaited on the critical path and never retried. The indicator is a
 * courtesy — if it fails, the founder waits a beat longer, which is strictly
 * better than delaying the actual wake to retry a cosmetic call.
 *
 * Telegram clears it after ~5s or when a message arrives, so a slow boot needs
 * it re-sent rather than sent once.
 */
export async function sendTelegramChatAction(
  identity: TelegramBotIdentity,
  args: { chatId: string; action?: "typing" | "upload_photo" | "upload_video" },
  fetchImpl: typeof fetch = fetch
): Promise<TelegramApiResult<true>> {
  try {
    const res = await fetchImpl(apiUrl(identity.token, "sendChatAction"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: args.chatId,
        action: args.action ?? "typing",
      }),
    });
    if (!res.ok) {
      return {
        ok: false,
        description: `HTTP ${res.status} ${res.statusText}`,
        errorCode: res.status,
      };
    }
    return (await res.json()) as TelegramApiResult<true>;
  } catch (error) {
    // Swallowed to a result rather than thrown: a network blip on a cosmetic
    // call must never take down the wake path it exists to decorate.
    return {
      ok: false,
      description: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Set the bot's webhook URL. Idempotent. Called once per bot per
 * environment when the operator runs `npm run telegram:set-webhook`.
 */
/**
 * Resolve an uploaded file to bytes.
 *
 * Telegram hands a webhook a `file_id`, never the file. Two calls: `getFile`
 * returns a `file_path`, and the download lives at a DIFFERENT host —
 * `api.telegram.org/file/bot<token>/<path>` — which is the part that catches
 * people, because it looks like the same base URL and isn't.
 *
 * ⚠️ The path is short-lived (Telegram documents ~1 hour) and the URL embeds
 * the bot token. **Fetch immediately, store the bytes, never persist this URL**
 * — a stored one leaks the token and rots within the hour.
 *
 * ⚠️ Bot API downloads cap at **20MB**. A founder's 60-second screen recording
 * can exceed that, which is a real limit to report rather than a rare edge.
 */
export async function fetchTelegramFile(
  identity: TelegramBotIdentity,
  fileId: string
): Promise<
  | { ok: true; bytes: Uint8Array; contentType: string; filePath: string }
  | { ok: false; reason: string }
> {
  try {
    const meta = await fetch(apiUrl(identity.token, "getFile"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: fileId }),
    });
    const metaJson = (await meta.json()) as {
      ok?: boolean;
      description?: string;
      result?: { file_path?: string; file_size?: number };
    };
    if (!metaJson.ok || !metaJson.result?.file_path) {
      return {
        ok: false,
        reason: metaJson.description ?? "Telegram wouldn't give me that file",
      };
    }

    const filePath = metaJson.result.file_path;
    const download = await fetch(
      `${TELEGRAM_API_BASE}/file/bot${identity.token}/${filePath}`
    );
    if (!download.ok) {
      return { ok: false, reason: `download failed (${download.status})` };
    }

    const buffer = new Uint8Array(await download.arrayBuffer());
    return {
      ok: true,
      bytes: buffer,
      contentType:
        download.headers.get("content-type") ?? guessContentType(filePath),
      filePath,
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Acknowledge a button tap immediately so the client stops its spinner; the real
 * work happens in a job. Best-effort, never throws.
 */
export async function answerCallbackQuery(
  identity: TelegramBotIdentity,
  callbackQueryId: string,
  text?: string,
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  try {
    const res = await fetchImpl(apiUrl(identity.token, "answerCallbackQuery"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** A reaction from the bot's side (plan §21.5). Small allowed set; best-effort. */
export async function setMessageReaction(
  identity: TelegramBotIdentity,
  args: { chatId: string | number; messageId: number; emoji: "❤" | "🔥" | "👍" | "😂" | "👀" },
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  try {
    const res = await fetchImpl(apiUrl(identity.token, "setMessageReaction"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: args.chatId, message_id: args.messageId, reaction: [{ type: "emoji", emoji: args.emoji }] }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Telegram omits content-type on some downloads; the extension is all we get. */
function guessContentType(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "mp4" || ext === "mov") return "video/mp4";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/jpeg";
}

export async function setTelegramWebhook(
  identity: TelegramBotIdentity,
  args: {
    url: string;
    secretToken: string;
    allowedUpdates?: string[];
  },
  fetchImpl: typeof fetch = fetch
): Promise<TelegramApiResult<true>> {
  const body: Record<string, unknown> = {
    url: args.url,
    secret_token: args.secretToken,
    allowed_updates: args.allowedUpdates ?? ["message"],
    drop_pending_updates: false,
  };
  const res = await fetchImpl(apiUrl(identity.token, "setWebhook"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return {
      ok: false,
      description: `HTTP ${res.status} ${res.statusText}`,
      errorCode: res.status,
    };
  }
  return (await res.json()) as TelegramApiResult<true>;
}

/**
 * Header name Telegram uses when posting webhook updates. We verify this
 * against `gtmTelegramWebhookSecret` env on every inbound to reject
 * spoofed updates.
 */
export const TELEGRAM_WEBHOOK_SECRET_HEADER = "x-telegram-bot-api-secret-token";
