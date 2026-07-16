/**
 * Sprint 2.11 — Direct Telegram Bot API send.
 *
 * The OpenClaw-gateway-side `sendMessage` requires the agent's first turn
 * to complete, which is gated by pi-coding-agent's npm install (~28 min on
 * cold start). For deploy-time confirmations ("Hey Josh, I'm spinning up,
 * research in progress, back in an hour") we bypass the gateway entirely
 * and hit Telegram's HTTP API directly with the bot token.
 *
 * The composed text is passed through validateOutboundText (the same
 * voice-contract firewall the agent-side prompts mandate) — if validation
 * fails, we throw and the deploy logs the failure instead of leaking a
 * banned message. The agent-side firewall mandate (Sprint 2.10) is the
 * primary defense; this is structural defense-in-depth for messages that
 * never touch the agent loop.
 */

import {
  detectJargonDrift,
  sanitizeOutboundText,
  validateOutboundText,
} from "../../gtmMaya/outboundFirewall";

/**
 * 2026-07-10 — private-DM firewall policy. This path delivers PRIVATE
 * operator messages (deploy hello, cached-plan push, send_update relay);
 * per the no-regex-enforcement rule, a bounce that reaches no one is worse
 * than an imperfect message that arrives. So:
 *   - punctuation AI-tells are mechanically SANITIZED (never block),
 *   - true leak categories (skill slugs, workspace files, technical
 *     internals) still hard-block,
 *   - AI self-reference, lexical slop + marketing jargon are LOG-ONLY
 *     drift counters.
 * The live failure this fixes: the foundation synthesis said "content
 * angle" + "relationship target" (jargon), the old blanket block
 * blackholed the founder's plan, and every retry hit the same wall.
 *
 * 2026-07-15 — ai_reference demoted from block to log-only ON THIS PRIVATE
 * FOUNDER CHANNEL. Live failure: Maya introduced herself as "your AI growth
 * manager" (SOUL bans the phrasing; the model ignored it that boot), the
 * hard block ate BOTH her hello and her reply to the founder's first
 * message, and onboarding read as dead silence. To the founder — who knows
 * exactly what she is — AI self-reference is embarrassing drift, not a
 * leak; per the never-blackhole doctrine it delivers and gets logged so the
 * prompt can be tuned. Public posts are unaffected (their gate is the
 * critic + auto-publish path, not this function).
 */
const BLOCKING_CATEGORIES = new Set([
  "skill_slug",
  "workspace_file",
  "internal_term",
]);

export interface DirectTelegramSendResult {
  ok: boolean;
  /** HTTP status from Telegram or "firewall_blocked" / "missing_credentials". */
  reason: string;
  /** Telegram's message_id when ok; null otherwise. */
  messageId: number | null;
  /** Captured firewall failures when blocked, for the audit row. */
  firewallFailures?: ReturnType<typeof validateOutboundText>["failures"];
}

export interface DirectTelegramSendInput {
  botToken: string | undefined;
  chatId: string | undefined;
  text: string;
}

export async function sendDirectTelegramMessage(
  input: DirectTelegramSendInput
): Promise<DirectTelegramSendResult> {
  if (!input.botToken || !input.chatId) {
    return {
      ok: false,
      reason: "missing_credentials",
      messageId: null,
    };
  }

  // Sanitize punctuation tells mechanically, THEN validate the clean text.
  const text = sanitizeOutboundText(input.text);
  const firewall = validateOutboundText(text);
  const blocking = firewall.failures.filter((f) =>
    BLOCKING_CATEGORIES.has(f.category)
  );
  if (blocking.length > 0) {
    return {
      ok: false,
      reason: "firewall_blocked",
      messageId: null,
      firewallFailures: blocking,
    };
  }
  // Non-catastrophic drift (lexical slop) + jargon: LOG-ONLY, never drop.
  const drift = [
    ...firewall.failures.filter((f) => !BLOCKING_CATEGORIES.has(f.category)),
    ...detectJargonDrift(text),
  ];
  if (drift.length > 0) {
    console.warn(
      `[sendDirectTelegramMessage] voice-drift (sent anyway): ${drift
        .map((f) => `${f.category}:${f.matched}`)
        .join(", ")}`
    );
  }

  const url = `https://api.telegram.org/bot${input.botToken}/sendMessage`;
  const body = {
    chat_id: input.chatId,
    text,
    disable_web_page_preview: true,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    return {
      ok: false,
      reason: `telegram_${res.status}`,
      messageId: null,
    };
  }

  const json = (await res.json()) as {
    ok: boolean;
    result?: { message_id: number };
  };

  if (!json.ok || !json.result) {
    return { ok: false, reason: "telegram_payload_not_ok", messageId: null };
  }

  return {
    ok: true,
    reason: "sent",
    messageId: json.result.message_id,
  };
}

export interface DirectTelegramMediaInput {
  botToken: string | undefined;
  chatId: string | undefined;
  /** A directly-fetchable URL (a Convex storage URL works — Telegram pulls it). */
  mediaUrl: string;
  isVideo?: boolean;
  caption?: string;
}

/**
 * Slideshow cluster — deliver a generated slide / saved asset back to the
 * user. We hand Telegram the Convex storage URL (it fetches the bytes itself),
 * so no multipart upload from Convex. Photos go via sendPhoto, recordings via
 * sendVideo. Captions are firewall-checked like every other outbound text.
 */
export async function sendDirectTelegramMedia(
  input: DirectTelegramMediaInput
): Promise<DirectTelegramSendResult> {
  if (!input.botToken || !input.chatId || !input.mediaUrl) {
    return { ok: false, reason: "missing_credentials", messageId: null };
  }

  if (input.caption) {
    const firewall = validateOutboundText(input.caption);
    if (!firewall.ok) {
      return {
        ok: false,
        reason: "firewall_blocked",
        messageId: null,
        firewallFailures: firewall.failures,
      };
    }
  }

  const method = input.isVideo ? "sendVideo" : "sendPhoto";
  const mediaField = input.isVideo ? "video" : "photo";
  const url = `https://api.telegram.org/bot${input.botToken}/${method}`;
  const body: Record<string, string> = {
    chat_id: input.chatId,
    [mediaField]: input.mediaUrl,
  };
  if (input.caption) body.caption = input.caption;

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    return { ok: false, reason: `telegram_${res.status}`, messageId: null };
  }
  const json = (await res.json()) as {
    ok: boolean;
    result?: { message_id: number };
  };
  if (!json.ok || !json.result) {
    return { ok: false, reason: "telegram_payload_not_ok", messageId: null };
  }
  return { ok: true, reason: "sent", messageId: json.result.message_id };
}

/**
 * Compose the deploy-time hello in the manager voice. Caller passes the
 * operator's first name (or "" / undefined for synth tests / first-touch
 * before name is known) plus the product name. The output is bounded to
 * ≤500 chars to match the boot_kickoff voice-contract limit.
 *
 * The text deliberately AVOIDS:
 *   - the slop phrases banned in PLAYBOOK § 6 (no "deep dive", no
 *     "supercharge", no "game changer", no "I hope this finds you well")
 *   - any internal terms (no "research lane", no "subagent")
 *   - any .md filename or maya-* skill slug
 *
 * It sets the operator's expectation honestly: "about 15-30 min" — that's
 * the measured wall-clock for Convex-side research already done + Maya's
 * boot turn + subagent work + phase 2 synthesis. Operator-flagged 2026-05-25
 * that vague "back in an hour" caused them to wonder if Maya was alive;
 * a concrete window is the fix.
 */
export function buildDeployTimeHelloText(input: {
  firstName?: string;
  productName: string;
}): string {
  const name =
    input.firstName && input.firstName.trim() !== ""
      ? input.firstName.trim()
      : "there";
  return `Hey ${name}, Maya here. Just spun up for ${input.productName}. Studying where your buyer actually hangs out + lining up your first 2 weeks of moves. End-to-end this takes me about 15-30 min. I'll send your full plan when it's ready. Sit tight.`;
}
