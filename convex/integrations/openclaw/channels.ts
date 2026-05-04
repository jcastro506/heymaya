/**
 * Channel pairing — Sprint 6C + Telegram extension (2026-05-03).
 *
 * Public Convex actions/queries that orchestrate iMessage / WhatsApp / SMS /
 * Telegram pair-requests through OpenClaw's CLI. We do NOT reimplement message
 * routing (project_openclaw_alignment.md): OpenClaw owns runtime channel
 * handling. Convex's job here is:
 *   1. Plan-tier-gate the pair-request (fail-closed, server-side)
 *   2. Validate the channel-native identifier (E.164 phone for sms/imessage/
 *      whatsapp; chat_id or @username for telegram)
 *   3. Shell out to OpenClaw via cliClient (test-injectable)
 *   4. Persist a `pairedChannels` row mirroring the OpenClaw-side state
 *
 * Cross-tenant safety: every action re-resolves the creators row from Clerk
 * identity. Confirm/unpair verify the pairingId belongs to the requester
 * before any state change.
 *
 * Telegram pair flow differs from phone-channels (verified against
 * https://docs.openclaw.ai/channels/telegram, 2026-05-03):
 *   - No phone number is collected up-front. The bot is configured at the
 *     OpenClaw org level (`openclaw channels add --channel telegram --token
 *     <bot-token>`). Per-creator pair: we allocate a pair code, the user opens
 *     `https://t.me/<bot>?start=<code>`, the bot intercepts the start_param,
 *     OpenClaw approves and webhooks back the chat_id.
 *   - We store `phoneNumber = "tg:pending"` until pair-active, then update to
 *     `phoneNumber = "tg:<chat_id>"`. `externalIdentifier` carries the chat_id
 *     once active.
 */

import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  query,
} from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { internal } from "../../_generated/api";
import { planFeatures } from "../../lib/planFeatures";
import { runOpenclawChannelCommand } from "./cliClient";

/* -------------------------------------------------------------------------- */
/* Validators + types                                                         */
/* -------------------------------------------------------------------------- */

const CHANNEL_VALIDATOR = v.union(
  v.literal("imessage"),
  v.literal("whatsapp"),
  v.literal("sms"),
  v.literal("telegram")
);

export type PairableChannel = "imessage" | "whatsapp" | "sms" | "telegram";

/**
 * Channel-native identifier formats by channel.
 *
 * Phone channels (imessage / whatsapp / sms): E.164 phone number.
 *   ^\+[1-9]\d{1,14}$  — leading +, country code 1-9, up to 14 more digits.
 *   Rejects: no-+, leading-zero CC, too-long, non-digit junk, bare +.
 *
 * Telegram: stored as `tg:<chat_id>` or `tg:pending`. The chat_id is a
 * positive integer for user DMs (e.g. "8376373926") or negative for groups
 * (e.g. "-100123456789"). After pair, may also be `tg:@username` if OpenClaw
 * resolves the username form. We accept both numeric chat_id and @username
 * suffixes after the `tg:` prefix.
 *   - tg:pending                 — placeholder before user DMs the bot
 *   - tg:8376373926              — user DM chat_id
 *   - tg:-100123456789           — group chat_id
 *   - tg:@joshcastro             — username form (5-32 chars, [a-zA-Z0-9_])
 */
const E164_REGEX = /^\+[1-9]\d{1,14}$/;
const TELEGRAM_PHONE_FIELD_REGEX =
  /^tg:(pending|-?\d{1,20}|@[a-zA-Z][a-zA-Z0-9_]{4,31})$/;

/**
 * Telegram pair codes per OpenClaw `/channels/telegram` (2026-05-03):
 * 6-12 chars, uppercase alphanumeric, no ambiguous chars (0/O, 1/I/L). We
 * accept the broader [A-Z0-9] character class — defense against operator
 * mistyping is the user's UX problem, not a security boundary. Lowercase is
 * normalized to uppercase before forwarding to OpenClaw.
 */
const TELEGRAM_PAIR_CODE_REGEX = /^[A-Z0-9]{6,12}$/;

function validateE164(phoneNumber: string): void {
  if (typeof phoneNumber !== "string") {
    throw new Error("phoneNumber must be a string in E.164 format.");
  }
  if (!E164_REGEX.test(phoneNumber)) {
    throw new Error(
      "phoneNumber must be E.164 format: '+' followed by country code (1-9) and up to 14 more digits."
    );
  }
}

function validateTelegramPhoneField(value: string): void {
  if (typeof value !== "string") {
    throw new Error("telegram identifier must be a string.");
  }
  if (!TELEGRAM_PHONE_FIELD_REGEX.test(value)) {
    throw new Error(
      "telegram identifier must be 'tg:pending', 'tg:<numeric-chat-id>', or 'tg:@username'."
    );
  }
}

/**
 * Channel-aware identifier validator. Phone channels still validate as
 * E.164. Telegram validates the `tg:`-prefixed form. Defense-in-depth — both
 * the action layer and recordPairingRequest call this.
 */
function validateChannelIdentifier(
  channel: PairableChannel,
  identifier: string
): void {
  if (channel === "telegram") {
    validateTelegramPhoneField(identifier);
  } else {
    validateE164(identifier);
  }
}

/* -------------------------------------------------------------------------- */
/* Internal helpers — re-resolve creator from Clerk identity                  */
/* -------------------------------------------------------------------------- */

export const getMeForChannels = internalQuery({
  args: { clerkUserId: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<Pick<
    Doc<"creators">,
    "_id" | "plan" | "mayaFlyAppId" | "channelPreference" | "phoneNumber"
  > | null> => {
    const c = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", args.clerkUserId))
      .first();
    if (!c) return null;
    return {
      _id: c._id,
      plan: c.plan,
      mayaFlyAppId: c.mayaFlyAppId,
      channelPreference: c.channelPreference,
      phoneNumber: c.phoneNumber,
    };
  },
});

export const getPairingRowForCreator = internalQuery({
  args: {
    creatorId: v.id("creators"),
    externalPairingId: v.string(),
  },
  handler: async (ctx, args): Promise<Doc<"pairedChannels"> | null> => {
    // Look up by externalPairingId index, then verify creator ownership in
    // the same query — this is the cross-tenant gate. NEVER trust the
    // pairingId alone.
    const row = await ctx.db
      .query("pairedChannels")
      .withIndex("by_external_pairing_id", (q) =>
        q.eq("externalPairingId", args.externalPairingId)
      )
      .first();
    if (!row) return null;
    if (row.creatorId !== args.creatorId) return null;
    return row;
  },
});

export const getPairingRowByChannel = internalQuery({
  args: {
    creatorId: v.id("creators"),
    channel: CHANNEL_VALIDATOR,
  },
  handler: async (ctx, args): Promise<Doc<"pairedChannels"> | null> => {
    const rows = await ctx.db
      .query("pairedChannels")
      .withIndex("by_creator_and_channel", (q) =>
        q.eq("creatorId", args.creatorId).eq("channel", args.channel)
      )
      .collect();
    // Most recent wins — there can be multiple historic rows for a given
    // (creator, channel) pair (each unpair-then-repair adds a row).
    rows.sort((a, b) => b.requestedAt - a.requestedAt);
    return rows[0] ?? null;
  },
});

/* -------------------------------------------------------------------------- */
/* Internal mutations                                                         */
/* -------------------------------------------------------------------------- */

export const recordPairingRequest = internalMutation({
  args: {
    creatorId: v.id("creators"),
    channel: CHANNEL_VALIDATOR,
    phoneNumber: v.string(),
    externalPairingId: v.string(),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Id<"pairedChannels">> => {
    // Defense in depth — re-validate inside the mutation so a future caller
    // that bypasses the action's regex still hits a fail-closed check.
    // Channel-aware: E.164 for phone channels, tg:* for telegram.
    validateChannelIdentifier(
      args.channel as PairableChannel,
      args.phoneNumber
    );
    return await ctx.db.insert("pairedChannels", {
      creatorId: args.creatorId,
      channel: args.channel,
      phoneNumber: args.phoneNumber,
      externalPairingId: args.externalPairingId,
      status: "pending",
      requestedAt: Date.now(),
      expiresAt: args.expiresAt,
    });
  },
});

export const markPairingActive = internalMutation({
  args: {
    rowId: v.id("pairedChannels"),
    externalIdentifier: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const row = await ctx.db.get(args.rowId);
    if (!row) {
      throw new Error(`markPairingActive: row ${args.rowId} not found.`);
    }
    await ctx.db.patch(args.rowId, {
      status: "active",
      externalIdentifier: args.externalIdentifier,
      pairedAt: Date.now(),
    });
  },
});

export const patchTelegramIdentifier = internalMutation({
  args: {
    rowId: v.id("pairedChannels"),
    chatId: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const row = await ctx.db.get(args.rowId);
    if (!row) {
      throw new Error(`patchTelegramIdentifier: row ${args.rowId} not found.`);
    }
    if (row.channel !== "telegram") {
      throw new Error(
        `patchTelegramIdentifier: row ${args.rowId} is not a telegram channel.`
      );
    }
    // chatId may be "8376373926" or "@username" — both are valid suffixes
    // after the "tg:" prefix per TELEGRAM_PHONE_FIELD_REGEX.
    const phoneNumber = `tg:${args.chatId}`;
    validateTelegramPhoneField(phoneNumber);
    await ctx.db.patch(args.rowId, { phoneNumber });
  },
});

export const markPairingRevoked = internalMutation({
  args: {
    rowId: v.id("pairedChannels"),
  },
  handler: async (ctx, args): Promise<void> => {
    const row = await ctx.db.get(args.rowId);
    if (!row) return; // idempotent — already gone
    await ctx.db.patch(args.rowId, { status: "revoked" });
  },
});

export const patchCreatorChannelPreference = internalMutation({
  args: {
    creatorId: v.id("creators"),
    channelPreference: v.union(
      v.literal("imessage"),
      v.literal("whatsapp"),
      v.literal("sms"),
      v.literal("telegram"),
      v.literal("web")
    ),
    phoneNumber: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const creator = await ctx.db.get(args.creatorId);
    if (!creator) {
      throw new Error(
        `patchCreatorChannelPreference: creator ${args.creatorId} not found.`
      );
    }
    const patch: {
      channelPreference: typeof args.channelPreference;
      phoneNumber?: string;
    } = { channelPreference: args.channelPreference };
    if (args.phoneNumber !== undefined) {
      patch.phoneNumber = args.phoneNumber;
    }
    await ctx.db.patch(args.creatorId, patch);
  },
});

/* -------------------------------------------------------------------------- */
/* requestPairing — public action                                             */
/* -------------------------------------------------------------------------- */

export interface RequestPairingResult {
  pairingId: string;
  qrCodeDataUrl?: string;
  smsConfirmationCode?: string;
  /** Telegram-only: pair code the user must paste back (shown after deep-link tap). */
  telegramPairCode?: string;
  /** Telegram-only: bot username the user opens (e.g. "mayatesstteest_bot"). */
  telegramBotUsername?: string;
  /** Telegram-only: deep-link the user taps — `https://t.me/<bot>?start=<code>`. */
  telegramDeepLink?: string;
  expiresAt?: number;
}

interface OpenclawPairResponse {
  pairingId?: string;
  pairing_id?: string;
  qrCodeDataUrl?: string;
  qr_code_data_url?: string;
  smsConfirmationCode?: string;
  sms_confirmation_code?: string;
  /** Telegram-only — the start_param code the bot expects via /start <code>. */
  telegramPairCode?: string;
  telegram_pair_code?: string;
  /** Telegram-only — bot username (without @) for the deep-link. */
  telegramBotUsername?: string;
  telegram_bot_username?: string;
  expiresAt?: number;
  expires_at?: number;
}

export const requestPairing = action({
  args: {
    channel: CHANNEL_VALIDATOR,
    /**
     * E.164 phone number — REQUIRED for imessage/whatsapp/sms. Optional for
     * telegram (we don't know the chat_id until the user DMs the bot, so we
     * record `tg:pending` and let OpenClaw fill it in on confirmation).
     */
    phoneNumber: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<RequestPairingResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("requestPairing: not authenticated.");
    }
    const me = await ctx.runQuery(
      internal.integrations.openclaw.channels.getMeForChannels,
      { clerkUserId: identity.subject }
    );
    if (!me) {
      throw new Error("requestPairing: creator row not found.");
    }

    // Plan-tier gate (fail-closed, server-side). Per the revised
    // 2026-04-26 matrix, channels are OpenClaw-native and ungated for every
    // tier — so this check is effectively a no-op today. Kept as
    // defense-in-depth in case a future tier configuration re-introduces a
    // channel paywall (e.g. an internal-only channel).
    if (!planFeatures(me).allowedChannels.includes(args.channel)) {
      throw new Error(
        `Plan '${me.plan}' cannot pair channel '${args.channel}'.`
      );
    }

    if (!me.mayaFlyAppId) {
      throw new Error(
        "requestPairing: deploy your Maya first — no Fly app id on the creator row."
      );
    }

    const isTelegram = args.channel === "telegram";

    // Phone-channel pre-validation: E.164 required up-front. Telegram skips
    // this — chat_id is only known after the user DMs the bot.
    if (!isTelegram) {
      if (!args.phoneNumber) {
        throw new Error(
          "requestPairing: phoneNumber (E.164) is required for imessage/whatsapp/sms pairing."
        );
      }
      validateE164(args.phoneNumber);
    }

    // Shell out to OpenClaw. Args are passed via execFile argv array (see
    // cliClient.ts) so creator-controlled phoneNumber CANNOT escape into a
    // shell. The E.164 regex above is also a content-level guard.
    const cliArgs: string[] = [
      "--agent",
      me.mayaFlyAppId,
      "--channel",
      args.channel,
    ];
    if (!isTelegram && args.phoneNumber) {
      cliArgs.push("--identifier", args.phoneNumber);
    }
    cliArgs.push("--format", "json");

    const cliRes = await runOpenclawChannelCommand<OpenclawPairResponse>({
      command: "pair",
      args: cliArgs,
    });
    if (!cliRes.ok || !cliRes.data) {
      throw new Error(
        `requestPairing: OpenClaw refused — ${cliRes.stderr ?? "no detail"}`
      );
    }

    const externalPairingId =
      cliRes.data.pairingId ?? cliRes.data.pairing_id;
    if (!externalPairingId) {
      throw new Error(
        "requestPairing: OpenClaw did not return a pairingId."
      );
    }
    const expiresAt = cliRes.data.expiresAt ?? cliRes.data.expires_at;

    // For telegram, persist the placeholder; for phone channels, persist the
    // creator-supplied E.164 number. recordPairingRequest does its own
    // channel-aware validation.
    const persistedIdentifier = isTelegram
      ? "tg:pending"
      : (args.phoneNumber as string);

    await ctx.runMutation(
      internal.integrations.openclaw.channels.recordPairingRequest,
      {
        creatorId: me._id as Id<"creators">,
        channel: args.channel,
        phoneNumber: persistedIdentifier,
        externalPairingId,
        expiresAt,
      }
    );

    const telegramBotUsername =
      cliRes.data.telegramBotUsername ?? cliRes.data.telegram_bot_username;
    const telegramPairCode =
      cliRes.data.telegramPairCode ?? cliRes.data.telegram_pair_code;
    const telegramDeepLink =
      isTelegram && telegramBotUsername && telegramPairCode
        ? `https://t.me/${telegramBotUsername}?start=${telegramPairCode}`
        : undefined;

    return {
      pairingId: externalPairingId,
      qrCodeDataUrl:
        cliRes.data.qrCodeDataUrl ?? cliRes.data.qr_code_data_url,
      smsConfirmationCode:
        cliRes.data.smsConfirmationCode ??
        cliRes.data.sms_confirmation_code,
      telegramPairCode,
      telegramBotUsername,
      telegramDeepLink,
      expiresAt,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* confirmPairing — public action                                             */
/* -------------------------------------------------------------------------- */

export interface ConfirmPairingResult {
  channel: PairableChannel;
  externalIdentifier: string;
}

interface OpenclawConfirmResponse {
  externalIdentifier?: string;
  external_identifier?: string;
}

export const confirmPairing = action({
  args: {
    pairingId: v.string(),
    /**
     * Required for SMS pairing (creator types the code Maya texted them).
     * Ignored for iMessage/WhatsApp where confirmation is the QR scan
     * itself — in that case the pair-request transitions to active server-
     * side and the client polls. We accept the param for both flows so the
     * frontend has a single confirm path.
     */
    confirmationCode: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ConfirmPairingResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("confirmPairing: not authenticated.");
    }
    const me = await ctx.runQuery(
      internal.integrations.openclaw.channels.getMeForChannels,
      { clerkUserId: identity.subject }
    );
    if (!me) {
      throw new Error("confirmPairing: creator row not found.");
    }

    // Cross-tenant gate: pairingId MUST belong to this creator. The internal
    // query verifies ownership and returns null otherwise — never trust the
    // pairingId alone.
    const row = await ctx.runQuery(
      internal.integrations.openclaw.channels.getPairingRowForCreator,
      {
        creatorId: me._id as Id<"creators">,
        externalPairingId: args.pairingId,
      }
    );
    if (!row) {
      throw new Error(
        "confirmPairing: pairing not found for this creator (or already finalized)."
      );
    }
    if (row.status !== "pending") {
      throw new Error(
        `confirmPairing: pairing is in '${row.status}' state, not 'pending'.`
      );
    }

    // SMS + Telegram require a confirmation code; iMessage/WhatsApp do not.
    // Telegram code regex is tighter — 6-12 uppercase alphanumeric — to match
    // OpenClaw's `/channels/telegram` start_param format.
    if (row.channel === "sms") {
      const code = args.confirmationCode?.trim();
      if (!code) {
        throw new Error(
          "confirmPairing: confirmationCode is required for SMS pairing."
        );
      }
      if (!/^[A-Z0-9]{4,12}$/.test(code)) {
        throw new Error(
          "confirmPairing: confirmationCode must be 4-12 uppercase alphanumeric chars."
        );
      }
    } else if (row.channel === "telegram") {
      const code = args.confirmationCode?.trim().toUpperCase();
      if (!code) {
        throw new Error(
          "confirmPairing: confirmationCode is required for Telegram pairing — paste the code the bot replied with after you tapped Start."
        );
      }
      if (!TELEGRAM_PAIR_CODE_REGEX.test(code)) {
        throw new Error(
          "confirmPairing: telegram pair code must be 6-12 uppercase alphanumeric chars."
        );
      }
    }

    // Normalize telegram code to uppercase before forwarding (OpenClaw is
    // case-sensitive per docs).
    const normalizedCode =
      row.channel === "telegram"
        ? args.confirmationCode?.trim().toUpperCase() ?? ""
        : args.confirmationCode ?? "";

    const cliArgs: string[] = [
      row.channel,
      normalizedCode,
      "--pairing-id",
      args.pairingId,
      "--format",
      "json",
    ];
    // Drop the empty positional code arg if it's not present (iMessage/
    // WhatsApp). execFile is happy with a zero-length positional but the
    // OpenClaw CLI parses positional args strictly.
    const filteredArgs = cliArgs.filter((a, i) => !(i === 1 && a === ""));

    const cliRes = await runOpenclawChannelCommand<OpenclawConfirmResponse>({
      command: "confirm",
      args: filteredArgs,
    });
    if (!cliRes.ok || !cliRes.data) {
      throw new Error(
        `confirmPairing: OpenClaw refused — ${cliRes.stderr ?? "no detail"}`
      );
    }

    const externalIdentifier =
      cliRes.data.externalIdentifier ?? cliRes.data.external_identifier;
    if (!externalIdentifier) {
      throw new Error(
        "confirmPairing: OpenClaw did not return externalIdentifier."
      );
    }

    await ctx.runMutation(
      internal.integrations.openclaw.channels.markPairingActive,
      { rowId: row._id, externalIdentifier }
    );

    // For telegram, also patch the pairedChannels.phoneNumber from
    // "tg:pending" to "tg:<chat_id>" so the row is self-describing without
    // needing to JOIN externalIdentifier.
    if (row.channel === "telegram") {
      await ctx.runMutation(
        internal.integrations.openclaw.channels.patchTelegramIdentifier,
        { rowId: row._id, chatId: externalIdentifier }
      );
    }

    // Promote the now-active channel to the creator's preferred channel.
    // For phone channels we also canonicalize the creator's phoneNumber
    // (used by SMS / iMessage gateways). For telegram we leave creator
    // phoneNumber untouched — chat_id lives on pairedChannels.
    const prefPatch: {
      creatorId: Id<"creators">;
      channelPreference:
        | "imessage"
        | "whatsapp"
        | "sms"
        | "telegram"
        | "web";
      phoneNumber?: string;
    } = {
      creatorId: me._id as Id<"creators">,
      channelPreference: row.channel,
    };
    if (row.channel !== "telegram") {
      prefPatch.phoneNumber = row.phoneNumber;
    }
    await ctx.runMutation(
      internal.integrations.openclaw.channels.patchCreatorChannelPreference,
      prefPatch
    );

    return {
      channel: row.channel as PairableChannel,
      externalIdentifier,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* unpairChannel — public action                                              */
/* -------------------------------------------------------------------------- */

export interface UnpairChannelResult {
  channel: PairableChannel;
  status: "revoked";
}

export const unpairChannel = action({
  args: {
    channel: CHANNEL_VALIDATOR,
  },
  handler: async (ctx, args): Promise<UnpairChannelResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("unpairChannel: not authenticated.");
    }
    const me = await ctx.runQuery(
      internal.integrations.openclaw.channels.getMeForChannels,
      { clerkUserId: identity.subject }
    );
    if (!me) {
      throw new Error("unpairChannel: creator row not found.");
    }

    if (!me.mayaFlyAppId) {
      throw new Error(
        "unpairChannel: no Maya deploy on file — nothing to unpair."
      );
    }

    const row = await ctx.runQuery(
      internal.integrations.openclaw.channels.getPairingRowByChannel,
      {
        creatorId: me._id as Id<"creators">,
        channel: args.channel,
      }
    );
    if (!row || row.status === "revoked") {
      throw new Error(
        `unpairChannel: no active pairing for channel '${args.channel}'.`
      );
    }

    // `--delete` is REQUIRED by OpenClaw 2026.4.23+ (`channels remove`
    // otherwise no-ops with a would-delete preview). Verified against
    // https://docs.openclaw.ai/cli/channels in Wave 5. See cliClient.ts
    // header.
    //
    // Telegram quirk: identifier passed to OpenClaw is the bare chat_id
    // (no "tg:" prefix) since OpenClaw owns its own internal namespacing.
    // We strip the prefix here. For phone channels, identifier IS the
    // phoneNumber as stored.
    const cliIdentifier =
      args.channel === "telegram"
        ? row.externalIdentifier ?? row.phoneNumber.replace(/^tg:/, "")
        : row.phoneNumber;
    const cliRes = await runOpenclawChannelCommand({
      command: "unpair",
      args: [
        "--agent",
        me.mayaFlyAppId,
        "--channel",
        args.channel,
        "--identifier",
        cliIdentifier,
        "--delete",
        "--format",
        "json",
      ],
    });
    if (!cliRes.ok) {
      throw new Error(
        `unpairChannel: OpenClaw refused — ${cliRes.stderr ?? "no detail"}`
      );
    }

    await ctx.runMutation(
      internal.integrations.openclaw.channels.markPairingRevoked,
      { rowId: row._id }
    );

    // If this was the active channel preference, fall back to web. The
    // creator can re-pair anytime; we don't auto-promote a sibling channel
    // because that's a surprising side effect.
    if (me.channelPreference === args.channel) {
      await ctx.runMutation(
        internal.integrations.openclaw.channels.patchCreatorChannelPreference,
        {
          creatorId: me._id as Id<"creators">,
          channelPreference: "web",
        }
      );
    }

    return {
      channel: args.channel as PairableChannel,
      status: "revoked",
    };
  },
});

/* -------------------------------------------------------------------------- */
/* listPairedChannels — public query                                          */
/* -------------------------------------------------------------------------- */

export interface ListPairedChannelsRow {
  channel: PairableChannel;
  status: "pending" | "active" | "revoked" | "expired";
  phoneNumber: string;
  externalPairingId: string;
  externalIdentifier?: string;
  requestedAt: number;
  pairedAt?: number;
  expiresAt?: number;
  /** Whether the creator's plan currently allows this channel — UI hint. */
  allowedByPlan: boolean;
}

export const listPairedChannels = query({
  args: {},
  handler: async (ctx): Promise<ReadonlyArray<ListPairedChannelsRow>> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const me = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) =>
        q.eq("clerkUserId", identity.subject)
      )
      .first();
    if (!me) return [];

    const rows = await ctx.db
      .query("pairedChannels")
      .withIndex("by_creator", (q) => q.eq("creatorId", me._id))
      .collect();

    const allowed = new Set(planFeatures(me).allowedChannels);
    // Sort newest-first so the UI's "active" candidate naturally lands on top.
    rows.sort((a, b) => b.requestedAt - a.requestedAt);

    return rows.map((r) => ({
      channel: r.channel as PairableChannel,
      status: r.status,
      phoneNumber: r.phoneNumber,
      externalPairingId: r.externalPairingId,
      externalIdentifier: r.externalIdentifier,
      requestedAt: r.requestedAt,
      pairedAt: r.pairedAt,
      expiresAt: r.expiresAt,
      allowedByPlan: allowed.has(r.channel),
    }));
  },
});
