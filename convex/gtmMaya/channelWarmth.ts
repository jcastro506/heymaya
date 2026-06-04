/**
 * Ideal-product Pillar 4 (WARMUP, generalized to all six channels).
 *
 * Warmth is a per-channel arc — new -> warming -> warm/ready — the daily and
 * weekly crons read (channelWarmthJson on gtmAgents) and advance over time. A
 * cold channel gets warmup_block + substantive engagement only; a warm/ready
 * channel skips warmup and posts in the founder's voice.
 *
 * Stored as a single JSON-string field on the existing gtmAgents row (NO new
 * table — the schema is at the 138-table TypeScript DataModel ceiling, see
 * schema.ts:4717-4720). Keyed by channel:
 *   { reddit:{ state, accountAgeDays?, baseline:{karma?,followers?,postCount?},
 *              warmTargetMs?, note?, lastUpdatedMs }, x:{...}, ... }
 *
 * state reuses the tiktokWarmupState values + 'warm':
 *   unknown | new_needs_warmup | warming | ready | warm | restricted
 * state in (warm | ready) = skip warmup for that channel.
 *
 * Backs the /lc_gtm/set_channel_warmth route. Idempotent (merges one channel,
 * re-writing the same state is a no-op-equivalent overwrite) and
 * cross-tenant-guarded (mirrors managerStore.ts).
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

// Channel strings accepted by the warmth route. Mirrors the gtmChannelScorecard
// enum (includes youtube — Pillar 2 un-excises it).
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

// State strings accepted by the warmth route (tiktokWarmupState values + warm).
const WARMTH_STATE_VALUES = [
  "unknown",
  "new_needs_warmup",
  "warming",
  "ready",
  "warm",
  "restricted",
] as const;
type WarmthStateLiteral = (typeof WARMTH_STATE_VALUES)[number];
function isWarmthState(s: unknown): s is WarmthStateLiteral {
  return (
    typeof s === "string" &&
    (WARMTH_STATE_VALUES as readonly string[]).includes(s)
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

// Reuse the tiktokWarmupState enum values + 'warm' as the per-channel state.
const WARMTH_STATE = v.union(
  v.literal("unknown"),
  v.literal("new_needs_warmup"),
  v.literal("warming"),
  v.literal("ready"),
  v.literal("warm"),
  v.literal("restricted")
);

interface ChannelWarmth {
  state: string;
  accountAgeDays?: number;
  baseline?: { karma?: number; followers?: number; postCount?: number };
  warmTargetMs?: number;
  note?: string;
  lastUpdatedMs: number;
}

type ChannelWarmthMap = Record<string, ChannelWarmth>;

/** Defense-in-depth cross-tenant guard — identical contract to
 *  managerStore.assertAgentBelongsToAccount(). */
async function assertAgentBelongsToAccount(
  ctx: { db: { get: <T>(id: T) => Promise<unknown> } },
  accountId: Id<"creators">,
  agentId: Id<"gtmAgents">
): Promise<void> {
  const agent = (await ctx.db.get(agentId)) as Doc<"gtmAgents"> | null;
  if (!agent || agent.accountId !== accountId) {
    throw new Error("channelWarmth mutation: agent does not belong to account.");
  }
}

/** Parse the stored channelWarmthJson into a map, tolerating null/malformed
 *  blobs (returns {} so a corrupt field never blocks an advance). */
function parseWarmthMap(json: string | undefined): ChannelWarmthMap {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as ChannelWarmthMap;
    }
  } catch {
    // fall through to empty map
  }
  return {};
}

/** Merge one channel's warmth update into channelWarmthJson and write back.
 *  Read-modify-write of a single JSON field; only the named channel's entry
 *  changes, every other channel is preserved. Idempotent — re-running with the
 *  same args just re-stamps lastUpdatedMs. Cross-tenant-guarded. */
export const setChannelWarmth = internalMutation({
  args: {
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    channel: CHANNEL,
    state: WARMTH_STATE,
    accountAgeDays: v.optional(v.number()),
    baselineKarma: v.optional(v.number()),
    baselineFollowers: v.optional(v.number()),
    baselinePostCount: v.optional(v.number()),
    warmTargetMs: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"gtmAgents">> => {
    await assertAgentBelongsToAccount(ctx, args.accountId, args.agentId);
    const agent = (await ctx.db.get(args.agentId)) as Doc<"gtmAgents"> | null;
    if (!agent) {
      throw new Error("channelWarmth: agent not found");
    }
    const now = Date.now();

    const map = parseWarmthMap(agent.channelWarmthJson);
    const prior = map[args.channel];

    // Merge baselines field-by-field so a partial update (e.g. only followers)
    // doesn't wipe a previously-recorded karma/postCount.
    const baseline = {
      ...(prior?.baseline ?? {}),
      ...(args.baselineKarma !== undefined ? { karma: args.baselineKarma } : {}),
      ...(args.baselineFollowers !== undefined
        ? { followers: args.baselineFollowers }
        : {}),
      ...(args.baselinePostCount !== undefined
        ? { postCount: args.baselinePostCount }
        : {}),
    };

    const next: ChannelWarmth = {
      state: args.state,
      accountAgeDays: args.accountAgeDays ?? prior?.accountAgeDays,
      baseline: Object.keys(baseline).length > 0 ? baseline : prior?.baseline,
      warmTargetMs: args.warmTargetMs ?? prior?.warmTargetMs,
      note: args.note ?? prior?.note,
      lastUpdatedMs: now,
    };
    map[args.channel] = next;

    await ctx.db.patch(args.agentId, {
      channelWarmthJson: JSON.stringify(map),
      updatedAt: now,
    });
    return args.agentId;
  },
});

/** Read + parse the per-channel warmth map for the daily/weekly cron. Returns
 *  {} when nothing has been recorded yet (fresh deploy) — the cron treats an
 *  absent channel as 'unknown'/cold. */
export const getChannelWarmth = internalQuery({
  args: { agentId: v.id("gtmAgents") },
  handler: async (ctx, args): Promise<ChannelWarmthMap> => {
    const agent = (await ctx.db.get(args.agentId)) as Doc<"gtmAgents"> | null;
    return parseWarmthMap(agent?.channelWarmthJson);
  },
});

// ───────────────────── HTTP handler ─────────────────────
//
// hookToken-authed, idempotency-keyed. (accountId, agentId) come from the
// authenticated token — the body NEVER names them, the mutation re-verifies.
// Mirrors managerCallbacks.ts set_north_star wiring; idempotent + fail-closed.

interface SetChannelWarmthPayload {
  idempotencyKey: string;
  channel: string;
  state: string;
  accountAgeDays?: number;
  baselineKarma?: number;
  baselineFollowers?: number;
  baselinePostCount?: number;
  warmTargetMs?: number;
  note?: string;
}

export const setChannelWarmthHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });

  let body: SetChannelWarmthPayload;
  try {
    body = (await request.json()) as SetChannelWarmthPayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (
    !body.idempotencyKey ||
    !isChannel(body.channel) ||
    !isWarmthState(body.state)
  ) {
    return new Response("missing required fields", { status: 400 });
  }
  // No claimIdempotencyKey() — the CALLBACK_KIND union (schema +
  // inboundCallback.ts) is closed and frozen for this slice, so we can't
  // register a dedicated 'set_channel_warmth' kind. setChannelWarmth is
  // inherently idempotent: it merges one channel into channelWarmthJson and
  // re-stamps lastUpdatedMs — replaying the same body converges to the same
  // map. idempotencyKey stays required for forward-compat.

  try {
    await ctx.runMutation(internal.gtmMaya.channelWarmth.setChannelWarmth, {
      accountId: auth.accountId,
      agentId: auth.agentId,
      channel: body.channel,
      state: body.state,
      accountAgeDays: body.accountAgeDays,
      baselineKarma: body.baselineKarma,
      baselineFollowers: body.baselineFollowers,
      baselinePostCount: body.baselinePostCount,
      warmTargetMs: body.warmTargetMs,
      note: body.note,
    });
  } catch (err) {
    return new Response((err as Error).message, { status: 400 });
  }
  return new Response("ok", { status: 200 });
});
