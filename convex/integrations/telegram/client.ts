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
 * Set the bot's webhook URL. Idempotent. Called once per bot per
 * environment when the operator runs `npm run telegram:set-webhook`.
 */
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
