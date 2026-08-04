/**
 * The wire between Convex and her machine (§18 Sprint 2.9).
 *
 * ## Why this has to exist
 *
 * Her OpenClaw is **not connected to Telegram**, and can't be: one bot token
 * allows exactly one listener, and Convex is it. That's the shared-bot design
 * and it's correct — but it means a founder's message arrives at Convex and
 * stops there unless something carries it across.
 *
 * For a day it didn't. `handleInbound` recorded the message and returned, under
 * a comment claiming "OpenClaw's own Telegram-inbound path picks it up." Her
 * machine had no idea anyone had spoken. She looked broken; she was deaf.
 *
 * ## The shape
 *
 * The gateway exposes an OpenAI-compatible endpoint. Convex POSTs the founder's
 * text with an explicit durable session key and gets **her reply in the same
 * response** — so Convex stays the single writer of the message log rather than
 * the machine talking to Telegram behind our back.
 *
 * ```
 * founder → Telegram → Convex → /v1/chat/completions → her session
 *                        ↑                                  │
 *                        └──────── her reply ───────────────┘
 *                        ↓
 *                     Telegram
 * ```
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";

/**
 * How long to wait on one turn.
 *
 * Generous because a real turn does real work — research, drafting, tool calls.
 * A timeout here does NOT mean the turn failed; it may still be running on the
 * machine, which is why a timeout never retries. Re-sending would inject the
 * founder's words into her session twice.
 */
export const CHAT_TURN_TIMEOUT_MS = 120_000;

/** Everything needed to reach one customer's machine. */
export const machineEndpoint = internalQuery({
  args: { customerId: v.id("customers") },
  handler: async (
    ctx,
    args
  ): Promise<{
    url: string;
    token: string;
    chatId: string;
    ready: boolean;
  } | null> => {
    const customer = (await ctx.db.get(args.customerId)) as Doc<"customers"> | null;
    if (!customer?.machineUrl || !customer.gatewayToken || !customer.telegramChatId) {
      return null;
    }
    return {
      url: customer.machineUrl,
      token: customer.gatewayToken,
      chatId: customer.telegramChatId,
      ready: customer.machineReadyAt !== undefined,
    };
  },
});

export const markReady = internalMutation({
  args: { customerId: v.id("customers"), now: v.optional(v.number()) },
  handler: async (ctx, args): Promise<null> => {
    await ctx.db.patch(args.customerId, {
      machineReadyAt: args.now ?? Date.now(),
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Is her gateway actually serving?
 *
 * The image health-checks `/healthz`; so do we, rather than trusting Fly's
 * machine state. "Fly says started" and "the gateway is answering" are
 * different claims, and the first one was true throughout the boot loop.
 */
export const checkHealth = internalAction({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args): Promise<{ healthy: boolean; detail?: string }> => {
    const endpoint = await ctx.runQuery(internal.maya.handoff.machineEndpoint, {
      customerId: args.customerId,
    });
    if (!endpoint) return { healthy: false, detail: "not deployed or not paired" };

    try {
      const res = await fetch(`${endpoint.url}/healthz`, {
        headers: { Authorization: `Bearer ${endpoint.token}` },
      });
      if (!res.ok) return { healthy: false, detail: `healthz ${res.status}` };
      await ctx.runMutation(internal.maya.handoff.markReady, {
        customerId: args.customerId,
      });
      return { healthy: true };
    } catch (error) {
      return {
        healthy: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  },
});

/**
 * Send the founder's text into her durable session and deliver what comes back.
 *
 * `x-openclaw-session-key: agent:main:main` is load-bearing — without an
 * explicit durable session, OpenClaw's isolated entry points mint a NEW session
 * per call, which is what made v1 amnesiac: five DMs, five conversations, no
 * memory of any of them.
 */
export const routeInboundToMachine = internalAction({
  args: {
    customerId: v.id("customers"),
    text: v.string(),
    messageId: v.optional(v.id("messages")),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ delivered: boolean; reason?: string; timedOut?: boolean }> => {
    const endpoint = await ctx.runQuery(internal.maya.handoff.machineEndpoint, {
      customerId: args.customerId,
    });
    if (!endpoint) {
      return { delivered: false, reason: "no machine or no paired chat" };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHAT_TURN_TIMEOUT_MS);
    try {
      const res = await fetch(`${endpoint.url}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${endpoint.token}`,
          // THE durable session. Not optional — see the header comment.
          "x-openclaw-session-key": "agent:main:main",
          "x-openclaw-message-channel": "telegram",
        },
        body: JSON.stringify({
          model: "openclaw/main",
          messages: [{ role: "user", content: args.text }],
          stream: false,
        }),
        signal: controller.signal,
      });

      const raw = await res.text();
      if (!res.ok) {
        return { delivered: false, reason: `gateway ${res.status}: ${raw.slice(0, 200)}` };
      }

      let reply: string | undefined;
      try {
        reply = (
          JSON.parse(raw) as { choices?: Array<{ message?: { content?: string } }> }
        ).choices?.[0]?.message?.content;
      } catch {
        return { delivered: false, reason: "gateway returned non-JSON" };
      }

      // A silent turn is a real answer — she is allowed to decide nothing needs
      // saying. Delivering an empty message would be worse than delivering
      // nothing.
      if (!reply || !reply.trim() || /^NO_REPLY$/i.test(reply.trim())) {
        await ctx.runMutation(internal.maya.handoff.markReady, {
          customerId: args.customerId,
        });
        return { delivered: true, reason: "she had nothing to add" };
      }

      // Her reply goes out through the SAME path as everything else, so the
      // message log stays the single record of what the founder was told.
      await ctx.runMutation(internal.maya.messages.send, {
        customerId: args.customerId,
        surface: "telegram",
        body: reply,
        dedupeKey: `reply:${args.messageId ?? Date.now()}`,
      });
      await ctx.runMutation(internal.maya.handoff.markReady, {
        customerId: args.customerId,
      });
      return { delivered: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const timedOut = /abort/i.test(message);
      // A timed-out turn may STILL be running on the machine. Retrying would
      // inject the founder's words into her session a second time, so this
      // reports and stops.
      return { delivered: false, reason: message, timedOut };
    } finally {
      clearTimeout(timer);
    }
  },
});
