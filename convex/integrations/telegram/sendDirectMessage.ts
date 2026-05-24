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

import { validateOutboundText } from "../../gtmMaya/outboundFirewall";

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

  const firewall = validateOutboundText(input.text);
  if (!firewall.ok) {
    return {
      ok: false,
      reason: "firewall_blocked",
      messageId: null,
      firewallFailures: firewall.failures,
    };
  }

  const url = `https://api.telegram.org/bot${input.botToken}/sendMessage`;
  const body = {
    chat_id: input.chatId,
    text: input.text,
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
 * It also sets the right expectation: "back in about an hour" — matches
 * the realistic 60-90 min wall-clock for the cron-driven research +
 * voice-match + calendar populator + follow-up message.
 */
export function buildDeployTimeHelloText(input: {
  firstName?: string;
  productName: string;
}): string {
  const name =
    input.firstName && input.firstName.trim() !== ""
      ? input.firstName.trim()
      : "there";
  return `Hey ${name} — Maya here. I just spun up for ${input.productName}. I'm going to spend the next hour studying where your buyer actually hangs out and lining up your first two weeks of moves. I'll come back when I've got your week ready. Talk soon.`;
}
