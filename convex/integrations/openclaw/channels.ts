/**
 * Channel pairing — Sprint 6C.
 *
 * Public Convex actions/queries that orchestrate iMessage / WhatsApp / SMS
 * pair-requests through OpenClaw's CLI. We do NOT reimplement message routing
 * (project_openclaw_alignment.md): OpenClaw owns runtime channel handling.
 * Convex's job here is:
 *   1. Plan-tier-gate the pair-request (fail-closed, server-side)
 *   2. Validate the phone number (E.164)
 *   3. Shell out to OpenClaw via cliClient (test-injectable)
 *   4. Persist a `pairedChannels` row mirroring the OpenClaw-side state
 *
 * Cross-tenant safety: every action re-resolves the creators row from Clerk
 * identity. Confirm/unpair verify the pairingId belongs to the requester
 * before any state change.
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
  v.literal("sms")
);

export type PairableChannel = "imessage" | "whatsapp" | "sms";

/**
 * E.164 phone number regex.
 *   ^\+              — leading +
 *   [1-9]            — country code first digit cannot be 0
 *   \d{1,14}$        — up to 14 more digits (15 total max per E.164)
 *
 * Tightening rationale (anti-footgun):
 *   - rejects `12345` (no leading +)
 *   - rejects `+0123` (leading zero in country code)
 *   - rejects `+1234567890123456789` (too long)
 *   - rejects `<script>` and other non-digit junk
 *   - rejects bare `+`
 */
const E164_REGEX = /^\+[1-9]\d{1,14}$/;

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
    if (!E164_REGEX.test(args.phoneNumber)) {
      throw new Error(
        "recordPairingRequest: phoneNumber must be in E.164 format."
      );
    }
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
  expiresAt?: number;
}

interface OpenclawPairResponse {
  pairingId?: string;
  pairing_id?: string;
  qrCodeDataUrl?: string;
  qr_code_data_url?: string;
  smsConfirmationCode?: string;
  sms_confirmation_code?: string;
  expiresAt?: number;
  expires_at?: number;
}

export const requestPairing = action({
  args: {
    channel: CHANNEL_VALIDATOR,
    phoneNumber: v.string(),
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

    validateE164(args.phoneNumber);

    if (!me.mayaFlyAppId) {
      throw new Error(
        "requestPairing: deploy your Maya first — no Fly app id on the creator row."
      );
    }

    // Shell out to OpenClaw. Args are passed via execFile argv array (see
    // cliClient.ts) so creator-controlled phoneNumber CANNOT escape into a
    // shell. The E.164 regex above is also a content-level guard.
    const cliRes = await runOpenclawChannelCommand<OpenclawPairResponse>({
      command: "pair",
      args: [
        "--agent",
        me.mayaFlyAppId,
        "--channel",
        args.channel,
        "--identifier",
        args.phoneNumber,
        "--format",
        "json",
      ],
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

    await ctx.runMutation(
      internal.integrations.openclaw.channels.recordPairingRequest,
      {
        creatorId: me._id as Id<"creators">,
        channel: args.channel,
        phoneNumber: args.phoneNumber,
        externalPairingId,
        expiresAt,
      }
    );

    return {
      pairingId: externalPairingId,
      qrCodeDataUrl:
        cliRes.data.qrCodeDataUrl ?? cliRes.data.qr_code_data_url,
      smsConfirmationCode:
        cliRes.data.smsConfirmationCode ??
        cliRes.data.sms_confirmation_code,
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

    // SMS requires a confirmation code; iMessage/WhatsApp do not.
    if (row.channel === "sms") {
      const code = args.confirmationCode?.trim();
      if (!code) {
        throw new Error(
          "confirmPairing: confirmationCode is required for SMS pairing."
        );
      }
      // Light syntactic guard — block obvious junk before shelling out.
      if (!/^[A-Z0-9]{4,12}$/.test(code)) {
        throw new Error(
          "confirmPairing: confirmationCode must be 4-12 uppercase alphanumeric chars."
        );
      }
    }

    const cliArgs: string[] = [
      row.channel,
      args.confirmationCode ?? "",
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

    // Promote the now-active channel to the creator's preferred channel +
    // canonicalize the phone number we have on file. Web is still always
    // available; this just routes proactive pings to the new channel.
    await ctx.runMutation(
      internal.integrations.openclaw.channels.patchCreatorChannelPreference,
      {
        creatorId: me._id as Id<"creators">,
        channelPreference: row.channel,
        phoneNumber: row.phoneNumber,
      }
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
    const cliRes = await runOpenclawChannelCommand({
      command: "unpair",
      args: [
        "--agent",
        me.mayaFlyAppId,
        "--channel",
        args.channel,
        "--identifier",
        row.phoneNumber,
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
