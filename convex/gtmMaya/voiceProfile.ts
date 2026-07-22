/**
 * Ideal-product Pillar 1 (VOICE) — founder voice fingerprint + per-channel
 * native-style exemplars store.
 *
 * Anchor A = gtmAgents.voiceProfileJson (the founder's own voice, built in
 * Phase 0 by pulling their accounts: watch media + read text).
 * Anchor B = gtmChannelScorecard.styleExemplarsJson (5-10 verbatim native
 * posts per bet channel — the register the channel rewards).
 *
 * Both are JSON-string fields on existing rows (NO new table — the schema is
 * at the 138-table TypeScript DataModel ceiling, see schema.ts:4717-4720).
 *
 * Backs the /lc_gtm/save_voice_profile + /lc_gtm/save_style_exemplars HTTP
 * routes. Cross-tenant safety mirrors managerStore.ts: callers derive
 * (accountId, agentId) from the hookToken; every mutation re-verifies via
 * assertAgentBelongsToAccount() as defense-in-depth. JSON.parse validation
 * on every write so we never persist a malformed fingerprint.
 */

import { v } from "convex/values";
import {
  httpAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { authenticate } from "./openclaw/inboundCallback";

// Channel strings accepted by the style-exemplars route. Mirrors the
// gtmChannelScorecard enum (includes youtube — Pillar 2 un-excises it).
const CHANNEL_VALUES = [
  "reddit",
  "x",
  "hn",
  "linkedin",
  "youtube",
  "tiktok",
  "instagram",
  "threads",
  "podcasts",
  "newsletters",
  "discord",
  "blog",
] as const;
type Channel = (typeof CHANNEL_VALUES)[number];
function isChannel(s: unknown): s is Channel {
  return (
    typeof s === "string" && (CHANNEL_VALUES as readonly string[]).includes(s)
  );
}

// Mirror the CHANNEL union used across managerStore.ts / gtmChannelScorecard.
const CHANNEL = v.union(
  v.literal("reddit"),
  v.literal("x"),
  v.literal("hn"),
  v.literal("linkedin"),
  v.literal("youtube"),
  v.literal("tiktok"),
  v.literal("instagram"),
  v.literal("threads"),
  v.literal("podcasts"),
  v.literal("newsletters"),
  v.literal("discord"),
  v.literal("blog")
);

/** Defense-in-depth cross-tenant guard — identical contract to
 *  managerStore.assertAgentBelongsToAccount(). HTTP callers already derive
 *  (accountId, agentId) from the hookToken; this re-verifies the link. */
async function assertAgentBelongsToAccount(
  ctx: { db: { get: <T>(id: T) => Promise<unknown> } },
  accountId: Id<"creators">,
  agentId: Id<"gtmAgents">
): Promise<void> {
  const agent = (await ctx.db.get(agentId)) as Doc<"gtmAgents"> | null;
  if (!agent || agent.accountId !== accountId) {
    throw new Error("voiceProfile mutation: agent does not belong to account.");
  }
}

/** Reject non-JSON / non-object payloads before they reach the row. A voice
 *  profile we can't parse back is worse than none — the daily cron renders it
 *  straight into USER.md. */
function assertValidJsonObject(label: string, json: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(`${label}: not valid JSON`);
  }
  if (parsed === null || typeof parsed !== "object") {
    throw new Error(`${label}: must be a JSON object/array`);
  }
}

// ───────────────────── Anchor A: voice fingerprint ─────────────────────

/** Singleton-per-agent overwrite of the founder voice fingerprint. Built at
 *  onboarding (Phase 0) and refreshed monthly. Each pass replaces the prior
 *  value whole. */
export const saveVoiceProfile = internalMutation({
  args: {
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    voiceProfileJson: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"gtmAgents">> => {
    await assertAgentBelongsToAccount(ctx, args.accountId, args.agentId);
    assertValidJsonObject("voiceProfileJson", args.voiceProfileJson);
    await ctx.db.patch(args.agentId, {
      voiceProfileJson: args.voiceProfileJson,
      updatedAt: Date.now(),
    });
    return args.agentId;
  },
});

// ───────────────────── Anchor B: per-channel exemplars ─────────────────────

/** Upsert the verbatim native posts for one (agent, channel) onto the
 *  channel's scorecard row. If the scorecard hasn't been synthesized yet,
 *  inserts a thin placeholder row so the exemplars are never dropped — the
 *  full scorecard fields backfill when foundation research lands. */
export const saveStyleExemplars = internalMutation({
  args: {
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    channel: CHANNEL,
    styleExemplarsJson: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"gtmChannelScorecard">> => {
    await assertAgentBelongsToAccount(ctx, args.accountId, args.agentId);
    assertValidJsonObject("styleExemplarsJson", args.styleExemplarsJson);
    const now = Date.now();
    const existing = await ctx.db
      .query("gtmChannelScorecard")
      .withIndex("by_agent_and_channel", (q) =>
        q.eq("agentId", args.agentId).eq("channel", args.channel)
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        styleExemplarsJson: args.styleExemplarsJson,
        updatedAt: now,
      });
      return existing._id;
    }
    // No scorecard yet — persist a thin placeholder so the exemplars survive
    // until foundation research backfills audienceFit/cadenceFit/etc.
    return await ctx.db.insert("gtmChannelScorecard", {
      accountId: args.accountId,
      agentId: args.agentId,
      channel: args.channel,
      audienceFit: 0,
      cadenceFit: 0,
      uniqueUnlock: "",
      bet: false,
      styleExemplarsJson: args.styleExemplarsJson,
      synthesizedAt: now,
      updatedAt: now,
    });
  },
});

// ───────────────────── Read-back for the daily cron ─────────────────────

/** One-shot read of both voice anchors. The morning cron / voice-matcher
 *  reads this to render Anchor A (founder fingerprint) + Anchor B (per-channel
 *  exemplars) before drafting. voiceProfile is returned parsed (null when
 *  unbuilt or malformed); per-channel exemplars are keyed by channel. */
export const getVoiceAnchors = internalQuery({
  args: { agentId: v.id("gtmAgents") },
  handler: async (
    ctx,
    args
  ): Promise<{
    voiceProfile: unknown | null;
    styleExemplarsByChannel: Record<string, unknown>;
  }> => {
    const agent = (await ctx.db.get(args.agentId)) as Doc<"gtmAgents"> | null;
    let voiceProfile: unknown | null = null;
    if (agent?.voiceProfileJson) {
      try {
        voiceProfile = JSON.parse(agent.voiceProfileJson);
      } catch {
        voiceProfile = null;
      }
    }

    const scorecards = await ctx.db
      .query("gtmChannelScorecard")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .collect();
    const styleExemplarsByChannel: Record<string, unknown> = {};
    for (const sc of scorecards) {
      if (!sc.styleExemplarsJson) continue;
      try {
        styleExemplarsByChannel[sc.channel] = JSON.parse(sc.styleExemplarsJson);
      } catch {
        // Skip a malformed exemplar blob rather than poison the whole read.
      }
    }

    return { voiceProfile, styleExemplarsByChannel };
  },
});

// ───────────────────── HTTP handlers ─────────────────────
//
// hookToken-authed, idempotency-keyed. (accountId, agentId) come from the
// authenticated token — the body NEVER names them, the mutation re-verifies.
// Mirrors managerCallbacks.ts foundation_* / set_north_star wiring.

interface SaveVoiceProfilePayload {
  idempotencyKey: string;
  voiceProfileJson: string;
}

export const saveVoiceProfileHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: SaveVoiceProfilePayload;
  try {
    body = (await request.json()) as SaveVoiceProfilePayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  // The model reaches for `voiceProfile` (often as an object) at least as
  // often as the declared `voiceProfileJson` string — accept both. A tool
  // that rejects the natural spelling with an unnamed-fields error just
  // taught the live agent to give up on building a voice profile entirely
  // (2026-07-21: two failed attempts, then "I'll work with what I have").
  const alias = (body as { voiceProfile?: unknown }).voiceProfile;
  if ((typeof body.voiceProfileJson !== "string" || !body.voiceProfileJson.trim()) && alias != null) {
    body.voiceProfileJson =
      typeof alias === "string" ? alias : JSON.stringify(alias);
  }
  if (
    !body.idempotencyKey ||
    typeof body.voiceProfileJson !== "string" ||
    !body.voiceProfileJson.trim()
  ) {
    return new Response(
      JSON.stringify({
        ok: false,
        reason:
          "missing required fields — pass voiceProfileJson (a JSON STRING of the voice profile) and idempotencyKey",
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }
  // NOTE: no claimIdempotencyKey() here. The CALLBACK_KIND union (schema +
  // inboundCallback.ts) is closed and frozen for this slice (schema is locked),
  // so we can't register a dedicated 'save_voice_profile' kind. Instead the
  // underlying mutation is inherently idempotent: saveVoiceProfile is a
  // whole-value patch — replaying the same body converges to the same row.
  // idempotencyKey is still required (callers must send it) for forward-compat.

  try {
    await ctx.runMutation(internal.gtmMaya.voiceProfile.saveVoiceProfile, {
      accountId: auth.accountId,
      agentId: auth.agentId,
      voiceProfileJson: body.voiceProfileJson,
    });
  } catch (err) {
    return new Response((err as Error).message, { status: 400 });
  }
  return new Response("ok", { status: 200 });
});

interface SaveStyleExemplarsPayload {
  idempotencyKey: string;
  channel: string;
  styleExemplarsJson: string;
}

export const saveStyleExemplarsHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: SaveStyleExemplarsPayload;
  try {
    body = (await request.json()) as SaveStyleExemplarsPayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (
    !body.idempotencyKey ||
    !isChannel(body.channel) ||
    typeof body.styleExemplarsJson !== "string" ||
    !body.styleExemplarsJson.trim()
  ) {
    return new Response("missing required fields", { status: 400 });
  }
  // No claimIdempotencyKey() — see saveVoiceProfileHttp. saveStyleExemplars is
  // an upsert keyed by (agentId, channel): replaying the same body converges.

  try {
    await ctx.runMutation(internal.gtmMaya.voiceProfile.saveStyleExemplars, {
      accountId: auth.accountId,
      agentId: auth.agentId,
      channel: body.channel,
      styleExemplarsJson: body.styleExemplarsJson,
    });
  } catch (err) {
    return new Response((err as Error).message, { status: 400 });
  }
  return new Response("ok", { status: 200 });
});
