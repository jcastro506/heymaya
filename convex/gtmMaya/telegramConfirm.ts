/**
 * S6 — Telegram one-tap confirm-to-post (the ban-safety channels: Reddit / TikTok).
 *
 * THE FLOW (no web UI, no Google Calendar, no deep-links, no native drafts):
 *   1. Maya composes a Reddit/TikTok post; it's stored `needs_confirm`.
 *   2. She calls `send_confirm_card({ eventId, mediaAssetIds? })` → the founder
 *      gets a Telegram card: a preview (text, and the slideshow images for
 *      TikTok) + a `✅ Post it` button.
 *   3. The founder taps. The tap IS the human consent (and for TikTok it's what
 *      satisfies the content_preview_confirmed / express_consent_given legal
 *      flags — they previewed it right in Telegram). Telegram POSTs a
 *      callback_query to our webhook → `handleConfirmCallback`.
 *   4. We publish via Zernio server-side (`publishContentDirect` with
 *      `founderConfirmed: true`, which overrides the manual-confirm force) and
 *      edit the card to "✅ Posted to <channel>." The user never leaves Telegram.
 *
 * Cross-tenant: the callback's chatId resolves to exactly one agent; the event
 * must belong to that agent or we refuse. Idempotent: a second tap on an event
 * that's no longer `needs_confirm` is a no-op.
 *
 * Media: when Maya passes `mediaAssetIds` to `send_confirm_card` (the TikTok/IG
 * slideshow she generated), they're shown in the card AND persisted on the event,
 * so the tap posts the actual carousel/photo-mode slides through Zernio — not
 * just the caption. Reddit (text) and TikTok/IG (media) both post end-to-end.
 */

import {
  httpAction,
  internalAction,
  internalQuery,
  internalMutation,
} from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { authenticate } from "./openclaw/inboundCallback";
import type { Id } from "../_generated/dataModel";

// ───────────────────── raw Telegram helpers ─────────────────────
// (sendDirectMessage doesn't support inline keyboards / callbacks, so these
//  hit the Bot API directly. best-effort — never throw into the webhook.)
const TG = "https://api.telegram.org";

async function tgSendCard(
  botToken: string,
  chatId: string,
  text: string,
  eventId: string
): Promise<number | null> {
  try {
    const res = await fetch(`${TG}/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ Post it", callback_data: `gpost:${eventId}` }],
            [
              { text: "✏️ Edit", callback_data: `gedit:${eventId}` },
              { text: "✕ Skip", callback_data: `gskip:${eventId}` },
            ],
          ],
        },
      }),
    });
    const j = (await res.json().catch(() => null)) as {
      result?: { message_id?: number };
    } | null;
    return j?.result?.message_id ?? null;
  } catch {
    return null;
  }
}

async function tgSendPhoto(
  botToken: string,
  chatId: string,
  photoUrl: string,
  caption?: string
): Promise<void> {
  try {
    await fetch(`${TG}/bot${botToken}/sendPhoto`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, photo: photoUrl, caption }),
    });
  } catch {
    /* best-effort preview */
  }
}

async function tgAnswerCallback(
  botToken: string,
  callbackQueryId: string,
  text: string
): Promise<void> {
  try {
    await fetch(`${TG}/bot${botToken}/answerCallbackQuery`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
    });
  } catch {
    /* best-effort */
  }
}

async function tgEditText(
  botToken: string,
  chatId: string,
  messageId: number,
  text: string,
  // Re-armed cards (publish failed, event back to needs_confirm) keep their
  // buttons so "tap again" is literally possible; acted cards strip them.
  keepButtonsForEventId?: string
): Promise<void> {
  try {
    await fetch(`${TG}/bot${botToken}/editMessageText`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text,
        reply_markup: keepButtonsForEventId
          ? {
              inline_keyboard: [
                [{ text: "✅ Post it", callback_data: `gpost:${keepButtonsForEventId}` }],
                [
                  { text: "✏️ Edit", callback_data: `gedit:${keepButtonsForEventId}` },
                  { text: "✕ Skip", callback_data: `gskip:${keepButtonsForEventId}` },
                ],
              ],
            }
          : { inline_keyboard: [] }, // strip the buttons once acted
      }),
    });
  } catch {
    /* best-effort */
  }
}

// ───────────────────── queries / mutations ─────────────────────

interface ConfirmEventView {
  agentId: Id<"gtmAgents">;
  accountId: Id<"creators">;
  channel: string | null;
  zernioAccountId: string | null;
  targetExternalId: string | null;
  targetCommentId: string | null;
  content: string;
  status: string;
  chatId: string | null;
  /** Slideshow/carousel media (storage ids) persisted on the event so the tap
   *  path posts the actual slides, not just the caption. */
  mediaAssetIds: string[];
  /** Dedup-ledger stamp + link-in-first-comment, persisted at event creation so
   *  the founder-approved publish is byte-identical to the auto path. */
  draftId: string | null;
  firstComment: string | null;
}

interface ParsedAutoPost {
  channel?: string;
  zernioAccountId?: string;
  targetExternalId?: string;
  targetCommentId?: string;
  mediaAssetIds?: string[];
  draftId?: string;
  firstComment?: string;
}

function parseAutoPost(json: string | undefined): ParsedAutoPost {
  if (!json) return {};
  try {
    return JSON.parse(json) as ParsedAutoPost;
  } catch {
    return {};
  }
}

/** Read everything needed to send a card OR publish on tap, scoped to one event. */
export const getConfirmEvent = internalQuery({
  args: { eventId: v.id("gtmCalendarEvents") },
  handler: async (ctx, args): Promise<ConfirmEventView | null> => {
    const event = await ctx.db.get(args.eventId);
    if (!event) return null;
    const agent = await ctx.db.get(event.agentId);
    const ap = parseAutoPost(event.autoPostJson);
    return {
      agentId: event.agentId,
      accountId: event.accountId,
      channel: ap.channel ?? null,
      zernioAccountId: ap.zernioAccountId ?? null,
      targetExternalId: ap.targetExternalId ?? null,
      targetCommentId: ap.targetCommentId ?? null,
      content: event.draftText ?? event.description ?? event.title,
      status: event.status,
      chatId: agent?.telegramChatId ?? null,
      mediaAssetIds: Array.isArray(ap.mediaAssetIds) ? ap.mediaAssetIds : [],
      draftId: ap.draftId ?? null,
      firstComment: ap.firstComment ?? null,
    };
  },
});

/** Persist the slideshow/carousel media (storage ids) onto the event so the
 *  founder's tap posts the actual slides through Zernio, not just the caption. */
export const setConfirmEventMedia = internalMutation({
  args: {
    eventId: v.id("gtmCalendarEvents"),
    mediaAssetIds: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const event = await ctx.db.get(args.eventId);
    if (!event) return;
    const ap = parseAutoPost(event.autoPostJson);
    ap.mediaAssetIds = args.mediaAssetIds;
    await ctx.db.patch(args.eventId, {
      autoPostJson: JSON.stringify(ap),
      updatedAt: Date.now(),
    });
  },
});

/**
 * The pending-confirm queue, agent-readable. Rides the get_agent_lifecycle
 * response so a fresh session (restart, redeploy) can always answer "what's
 * waiting on the founder?" and bind a chat "post it" to a real eventId
 * instead of guessing.
 */
export const listPendingConfirms = internalQuery({
  args: { agentId: v.id("gtmAgents") },
  handler: async (
    ctx,
    args
  ): Promise<
    Array<{
      eventId: Id<"gtmCalendarEvents">;
      channel: string | null;
      title: string;
      excerpt: string;
      createdAt: number;
    }>
  > => {
    const rows = await ctx.db
      .query("gtmCalendarEvents")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .filter((q) => q.eq(q.field("status"), "needs_confirm"))
      .order("desc")
      .take(10);
    return rows.map((ev) => {
      const ap = parseAutoPost(ev.autoPostJson);
      return {
        eventId: ev._id,
        channel: ap.channel ?? null,
        title: ev.title,
        excerpt: (ev.draftText ?? ev.description ?? ev.title).slice(0, 140),
        createdAt: ev.createdAt,
      };
    });
  },
});

/** Resolve the agent paired to a Telegram chat (for callback cross-tenant check). */
export const getAgentIdByChatId = internalQuery({
  args: { chatId: v.string() },
  handler: async (ctx, args): Promise<Id<"gtmAgents"> | null> => {
    const agent = await ctx.db
      .query("gtmAgents")
      .withIndex("by_telegram_chat", (q) => q.eq("telegramChatId", args.chatId))
      .first();
    return agent?._id ?? null;
  },
});

/** Flip a confirm event's state after a tap. `needs_confirm` is the re-arm:
 *  a publish that failed (or was gate-blocked) goes BACK to needs_confirm so
 *  the founder's next "post it" / tap can retry — never a terminal dead end. */
export const setConfirmEventStatus = internalMutation({
  args: {
    eventId: v.id("gtmCalendarEvents"),
    status: v.union(
      v.literal("posting"),
      v.literal("published"),
      v.literal("cancelled"),
      v.literal("failed"),
      v.literal("needs_confirm")
    ),
  },
  handler: async (ctx, args): Promise<void> => {
    await ctx.db.patch(args.eventId, {
      status: args.status,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Atomic compare-and-set claim for the founder-confirm → publish path. Flips
 * `needs_confirm` → `posting` in a SINGLE serializable mutation and reports
 * whether THIS caller won. This is the double-tap / callback-redelivery guard:
 * without it the action reads status, then patches in a SEPARATE mutation, so
 * two concurrent taps both pass the read-check and both publish the same content
 * twice — a duplicate comment on Reddit/TikTok, the exact ban signal. Only the
 * caller that gets `{ claimed: true }` may proceed to publish.
 */
export const claimConfirmEventForPublish = internalMutation({
  args: { eventId: v.id("gtmCalendarEvents"), expectedAgentId: v.id("gtmAgents") },
  handler: async (
    ctx,
    args
  ): Promise<{ claimed: boolean; status?: string }> => {
    const ev = await ctx.db.get(args.eventId);
    if (!ev) return { claimed: false, status: "gone" };
    if (ev.agentId !== args.expectedAgentId) {
      return { claimed: false, status: "not_yours" };
    }
    if (ev.status !== "needs_confirm") {
      return { claimed: false, status: ev.status };
    }
    await ctx.db.patch(args.eventId, { status: "posting", updatedAt: Date.now() });
    return { claimed: true };
  },
});

// ───────────────────── send the card ─────────────────────

export const sendPostConfirmCard = internalAction({
  args: {
    eventId: v.id("gtmCalendarEvents"),
    mediaAssetIds: v.optional(v.array(v.string())),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: boolean; reason?: string; messageId?: number }> => {
    const ev = await ctx.runQuery(internal.gtmMaya.telegramConfirm.getConfirmEvent, {
      eventId: args.eventId,
    });
    if (!ev) return { ok: false, reason: "event not found" };
    if (ev.status !== "needs_confirm") {
      return { ok: false, reason: `event is ${ev.status}, not needs_confirm` };
    }
    if (!ev.chatId) return { ok: false, reason: "no telegram chat for agent" };

    const { resolveBotForAgent } = await import("./telegramBotPerTenant");
    const bot = await resolveBotForAgent(
      ctx as { runQuery: <T>(ref: unknown, args: unknown) => Promise<T> },
      ev.agentId,
      {
        sharedToken: process.env.TELEGRAM_BOT_TOKEN,
        sharedUsername: process.env.TELEGRAM_BOT_USERNAME,
      }
    );
    if (!bot.token) return { ok: false, reason: "no telegram bot token" };

    const channelLabel = ev.channel ? ev.channel[0].toUpperCase() + ev.channel.slice(1) : "this channel";

    // Slideshow / image preview (TikTok/IG): show the founder exactly what
    // posts, AND persist the ids on the event so the tap actually posts the
    // slides through Zernio (not just the caption).
    if (args.mediaAssetIds && args.mediaAssetIds.length > 0) {
      await ctx.runMutation(
        internal.gtmMaya.telegramConfirm.setConfirmEventMedia,
        { eventId: args.eventId, mediaAssetIds: args.mediaAssetIds }
      );
      for (const id of args.mediaAssetIds.slice(0, 10)) {
        const url = await ctx.storage.getUrl(id as Id<"_storage">).catch(() => null);
        if (url) await tgSendPhoto(bot.token, ev.chatId, url);
      }
    }

    const text =
      `Ready to post to ${channelLabel} — I'll send it for you, tap to OK:\n\n` +
      `${ev.content}\n\n` +
      `(Reddit/TikTok need your tap so your account stays safe — one tap and I post it.)`;
    const messageId = await tgSendCard(bot.token, ev.chatId, text, args.eventId);
    return messageId
      ? { ok: true, messageId }
      : { ok: false, reason: "telegram send failed" };
  },
});

// ───────────────────── handle the tap (callback) ─────────────────────

export const handleConfirmCallback = internalAction({
  args: {
    chatId: v.string(),
    data: v.string(),
    callbackQueryId: v.string(),
    messageId: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<void> => {
    const m = /^g(post|skip|edit):(.+)$/.exec(args.data);
    if (!m) return; // not one of ours
    const action = m[1];
    const eventIdRaw = m[2];

    // Resolve the bot first so we can always answer the callback.
    const agentIdByChat = await ctx.runQuery(
      internal.gtmMaya.telegramConfirm.getAgentIdByChatId,
      { chatId: args.chatId }
    );
    if (!agentIdByChat) return;
    const { resolveBotForAgent } = await import("./telegramBotPerTenant");
    const bot = await resolveBotForAgent(
      ctx as { runQuery: <T>(ref: unknown, args: unknown) => Promise<T> },
      agentIdByChat,
      {
        sharedToken: process.env.TELEGRAM_BOT_TOKEN,
        sharedUsername: process.env.TELEGRAM_BOT_USERNAME,
      }
    );
    const token = bot.token;
    const ans = (t: string) =>
      token ? tgAnswerCallback(token, args.callbackQueryId, t) : Promise.resolve();
    const edit = (t: string, keepButtonsForEventId?: string) =>
      token && args.messageId
        ? tgEditText(token, args.chatId, args.messageId, t, keepButtonsForEventId)
        : Promise.resolve();

    const ev = await ctx.runQuery(internal.gtmMaya.telegramConfirm.getConfirmEvent, {
      eventId: eventIdRaw as Id<"gtmCalendarEvents">,
    });
    if (!ev) {
      await ans("That post is gone.");
      return;
    }
    // Cross-tenant: the event must belong to the agent paired to THIS chat.
    if (ev.agentId !== agentIdByChat) {
      await ans("Not yours.");
      return;
    }
    // Idempotent: a second tap after it's already acted is a no-op.
    if (ev.status !== "needs_confirm") {
      await ans(`Already ${ev.status}.`);
      return;
    }

    if (action === "skip") {
      await ctx.runMutation(internal.gtmMaya.telegramConfirm.setConfirmEventStatus, {
        eventId: eventIdRaw as Id<"gtmCalendarEvents">,
        status: "cancelled",
      });
      await ans("Skipped.");
      await edit("✕ Skipped — I won't post this.");
      return;
    }

    if (action === "edit") {
      // Full edit-reply loop is owned by Maya (OpenClaw) on the next inbound
      // message; here we just leave the post pending + tell them how.
      await ans("Tell me the change.");
      await edit(
        "✏️ Reply here with what to change and I'll redo it, then send a fresh one to OK."
      );
      return;
    }

    // action === "post"
    if (!ev.channel || !ev.zernioAccountId) {
      await ans("That channel isn't connected.");
      await edit(
        `⚠️ I can't post this — your ${ev.channel ?? "account"} isn't connected. Connect it and I'll take it over.`
      );
      return;
    }
    // ATOMIC CLAIM (needs_confirm → posting). A double-tap or Telegram callback
    // redelivery would otherwise pass the read-check above twice and publish the
    // same post twice (a ban signal on Reddit/TikTok). Only the winner proceeds.
    const claim = await ctx.runMutation(
      internal.gtmMaya.telegramConfirm.claimConfirmEventForPublish,
      {
        eventId: eventIdRaw as Id<"gtmCalendarEvents">,
        expectedAgentId: agentIdByChat,
      }
    );
    if (!claim.claimed) {
      await ans(`Already ${claim.status ?? "handled"}.`);
      return;
    }
    await ans("Posting…");
    // founderConfirmed overrides the Reddit/TikTok manual-force; dedup + plan
    // caps still apply. The slideshow media persisted on the event posts through
    // Zernio as the actual carousel/photo-mode slides (S6.1).
    const result = await ctx.runAction(
      internal.gtmMaya.publishEngine.publishContentDirect,
      {
        agentId: ev.agentId,
        channel: ev.channel,
        zernioAccountId: ev.zernioAccountId,
        content: ev.content,
        targetExternalId: ev.targetExternalId ?? undefined,
        targetCommentId: ev.targetCommentId ?? undefined,
        founderConfirmed: true,
        mediaAssetIds: ev.mediaAssetIds.length > 0 ? ev.mediaAssetIds : undefined,
        draftId: ev.draftId ? (ev.draftId as Id<"gtmDraftedContent">) : undefined,
        firstComment: ev.firstComment ?? undefined,
      }
    );
    if (result.action === "auto") {
      await ctx.runMutation(internal.gtmMaya.telegramConfirm.setConfirmEventStatus, {
        eventId: eventIdRaw as Id<"gtmCalendarEvents">,
        status: "published",
      });
      const channelLabel =
        ev.channel[0].toUpperCase() + ev.channel.slice(1);
      await edit(`✅ Posted to ${channelLabel}. I'll confirm it's live shortly.`);
    } else {
      // Publish failed or a gate (plan/dedup) blocked it. RE-ARM, never
      // dead-end: the founder already approved, so the approval must survive a
      // transient failure (expired token, Zernio blip) — flip back to
      // needs_confirm so the next tap / "post it" retries.
      await ctx.runMutation(internal.gtmMaya.telegramConfirm.setConfirmEventStatus, {
        eventId: eventIdRaw as Id<"gtmCalendarEvents">,
        status: "needs_confirm",
      });
      await edit(
        `⚠️ Couldn't post it: ${result.reasons[0] ?? "unknown error"}. ` +
          `It's still queued — tap again or say "post it" to retry.`,
        eventIdRaw
      );
    }
  },
});

// ───────────────── conversational confirm (the "post it" path) ─────────────────
//
// The founder saying "post it" / "yes, send it" / "skip that" in the Telegram
// thread IS the approval — same consent as tapping the card, so it runs the
// IDENTICAL server chain: cross-tenant check → atomic claim → publish with
// founderConfirmed. Without this path Maya has no legal move when the founder
// approves in words instead of a tap (the dead-end the operator hit live).
//
// ONE exception: TikTok stays card-only. The card's inline preview is what
// legally satisfies content_preview_confirmed / express_consent_given — a
// conversational yes doesn't prove they saw the actual slides.

export const confirmEventConversational = internalAction({
  args: {
    eventId: v.id("gtmCalendarEvents"),
    agentId: v.id("gtmAgents"),
    decision: v.union(v.literal("post"), v.literal("skip")),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: boolean; outcome?: string; reason?: string }> => {
    const ev = await ctx.runQuery(internal.gtmMaya.telegramConfirm.getConfirmEvent, {
      eventId: args.eventId,
    });
    if (!ev) return { ok: false, reason: "event not found" };
    // Cross-tenant: the event must belong to the calling agent.
    if (ev.agentId !== args.agentId) {
      return { ok: false, reason: "event not found for this agent" };
    }
    if (ev.status !== "needs_confirm") {
      // Idempotent: already acted (a tap or an earlier "post it" won).
      return { ok: false, reason: `already ${ev.status}` };
    }

    if (args.decision === "skip") {
      await ctx.runMutation(internal.gtmMaya.telegramConfirm.setConfirmEventStatus, {
        eventId: args.eventId,
        status: "cancelled",
      });
      return { ok: true, outcome: "cancelled" };
    }

    // decision === "post"
    if (ev.channel === "tiktok") {
      return {
        ok: false,
        reason:
          "tiktok is card-only — send_confirm_card so the founder previews the actual slides (TikTok's legal consent flags require it)",
      };
    }
    if (!ev.channel || !ev.zernioAccountId) {
      return { ok: false, reason: "channel not connected" };
    }
    // Same atomic claim as the tap path: a concurrent tap + "post it" can't
    // both publish (double-post = the ban signal this whole flow exists to avoid).
    const claim = await ctx.runMutation(
      internal.gtmMaya.telegramConfirm.claimConfirmEventForPublish,
      { eventId: args.eventId, expectedAgentId: args.agentId }
    );
    if (!claim.claimed) {
      return { ok: false, reason: `already ${claim.status ?? "handled"}` };
    }
    const result = await ctx.runAction(
      internal.gtmMaya.publishEngine.publishContentDirect,
      {
        agentId: ev.agentId,
        channel: ev.channel,
        zernioAccountId: ev.zernioAccountId,
        content: ev.content,
        targetExternalId: ev.targetExternalId ?? undefined,
        targetCommentId: ev.targetCommentId ?? undefined,
        founderConfirmed: true,
        mediaAssetIds: ev.mediaAssetIds.length > 0 ? ev.mediaAssetIds : undefined,
        draftId: ev.draftId ? (ev.draftId as Id<"gtmDraftedContent">) : undefined,
        firstComment: ev.firstComment ?? undefined,
      }
    );
    if (result.action === "auto") {
      await ctx.runMutation(internal.gtmMaya.telegramConfirm.setConfirmEventStatus, {
        eventId: args.eventId,
        status: "published",
      });
      return { ok: true, outcome: "published" };
    }
    // RE-ARM, never dead-end: the founder's approval survives a transient
    // failure (expired token, Zernio blip) or a gate block (plan/dedup). The
    // event goes back to needs_confirm so a retry "post it" / tap can land.
    await ctx.runMutation(internal.gtmMaya.telegramConfirm.setConfirmEventStatus, {
      eventId: args.eventId,
      status: "needs_confirm",
    });
    return {
      ok: false,
      outcome: "retryable",
      reason:
        `publish did not go through: ${result.reasons?.[0] ?? "unknown error"} — ` +
        `the event is still approved-and-queued; retry confirm_event after the blocker clears (do NOT re-draft)`,
    };
  },
});

export const confirmEventHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });
  let body: { eventId?: string; decision?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (!body.eventId) return new Response("missing eventId", { status: 400 });
  // Publishing under the founder's name is the destructive branch — a missing
  // or malformed decision must NEVER default into it. Exact match or re-ask.
  if (body.decision !== "post" && body.decision !== "skip") {
    return new Response(
      JSON.stringify({
        ok: false,
        reason: `invalid decision ${JSON.stringify(body.decision ?? null)} — pass exactly "post" or "skip"`,
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }
  const decision = body.decision;
  let result: { ok: boolean; outcome?: string; reason?: string };
  try {
    result = await ctx.runAction(
      internal.gtmMaya.telegramConfirm.confirmEventConversational,
      {
        eventId: body.eventId as Id<"gtmCalendarEvents">,
        agentId: auth.agentId,
        decision,
      }
    );
  } catch {
    // A malformed/foreign id fails Convex validation — tell the agent what to
    // do about it instead of leaking a 500 stack she can only guess at.
    result = {
      ok: false,
      reason:
        "unknown eventId — use the eventId returned by post_to_channel/propose_calendar (or get_agent_lifecycle's pendingConfirms), never an external post id",
    };
  }
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

// ───────────────────── agent-facing route (send_confirm_card) ─────────────────────

export const sendConfirmCardHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });
  let body: { eventId?: string; mediaAssetIds?: string[] };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (!body.eventId) return new Response("missing eventId", { status: 400 });

  // Cross-tenant: the event must belong to the calling agent.
  const ev = await ctx.runQuery(internal.gtmMaya.telegramConfirm.getConfirmEvent, {
    eventId: body.eventId as Id<"gtmCalendarEvents">,
  });
  if (!ev || ev.agentId !== auth.agentId) {
    return new Response(
      JSON.stringify({ ok: false, reason: "event not found for this agent" }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }
  const result = await ctx.runAction(
    internal.gtmMaya.telegramConfirm.sendPostConfirmCard,
    {
      eventId: body.eventId as Id<"gtmCalendarEvents">,
      mediaAssetIds: body.mediaAssetIds,
    }
  );
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});
