import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";

/**
 * Maya v2 §7.6/§7.7 — the cold-strike QUEUE.
 *
 * The heartbeat enqueues tap-channel cold-strikes (the ones we can't autonomously
 * post — Reddit/X/IG/LinkedIn/TikTok); the daily-strike-digest cron drains the
 * top `coldStrikesPerDay` (per the founder's tier) into ONE Telegram message
 * (bare deeplink + tap-to-copy draft). The queue lives as JSON on
 * gtmAgents.coldStrikeQueueJson (schema is at the table ceiling — JSON-on-row).
 *
 * Pure helpers are unit-testable without a Convex ctx; the wrappers are thin.
 */

/** A queued cold-strike opportunity the daily digest will surface. */
export interface StrikeCandidate {
  threadId: string;
  platform: string;
  title: string;
  url: string;
  matchedPhrase?: string;
  /** 0-1 — the hunter's confidence this is a strong target. */
  priorityScore: number;
  /** Funnel tier, reusing gtmTargetThreads' convention: "T1".."T4" (T4 = trash). */
  tier: string;
  addedAt: number;
}

export interface ColdStrikeQueue {
  candidates: StrikeCandidate[];
  lastDigestSentAt?: number;
}

/** Hard cap on the standing queue so it can't grow unbounded. */
export const MAX_STRIKE_QUEUE = 50;

const TIER_RANK: Record<string, number> = { T1: 0, T2: 1, T3: 2, T4: 3 };

export function parseColdStrikeQueue(
  json: string | null | undefined
): ColdStrikeQueue {
  if (!json) return { candidates: [] };
  try {
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== "object") return { candidates: [] };
    const obj = parsed as {
      candidates?: unknown;
      lastDigestSentAt?: unknown;
    };
    const candidates = Array.isArray(obj.candidates)
      ? (obj.candidates.filter(
          (c): c is StrikeCandidate =>
            !!c &&
            typeof (c as StrikeCandidate).threadId === "string" &&
            typeof (c as StrikeCandidate).url === "string"
        ) as StrikeCandidate[])
      : [];
    return {
      candidates,
      lastDigestSentAt:
        typeof obj.lastDigestSentAt === "number"
          ? obj.lastDigestSentAt
          : undefined,
    };
  } catch {
    return { candidates: [] };
  }
}

/** Rank: T1 first, then higher priorityScore, then fresher (newer addedAt). */
export function rankForDigest(
  candidates: StrikeCandidate[]
): StrikeCandidate[] {
  return [...candidates].sort((a, b) => {
    const ta = TIER_RANK[a.tier] ?? 9;
    const tb = TIER_RANK[b.tier] ?? 9;
    if (ta !== tb) return ta - tb;
    if (b.priorityScore !== a.priorityScore)
      return b.priorityScore - a.priorityScore;
    return b.addedAt - a.addedAt;
  });
}

/** Add a candidate, dedup by threadId (newest wins), cap the queue size. */
export function enqueueStrike(
  queue: ColdStrikeQueue,
  candidate: StrikeCandidate
): ColdStrikeQueue {
  const others = queue.candidates.filter(
    (c) => c.threadId !== candidate.threadId
  );
  const next = [...others, candidate];
  const capped =
    next.length > MAX_STRIKE_QUEUE
      ? rankForDigest(next).slice(0, MAX_STRIKE_QUEUE)
      : next;
  return { ...queue, candidates: capped };
}

/** The top `limit` candidates for today's digest (T4 trash excluded). */
export function selectDigest(
  queue: ColdStrikeQueue,
  limit: number
): StrikeCandidate[] {
  const eligible = queue.candidates.filter((c) => c.tier !== "T4");
  return rankForDigest(eligible).slice(0, Math.max(0, limit));
}

// ── Convex wrappers ────────────────────────────────────────────────────────

const candidateValidator = v.object({
  threadId: v.string(),
  platform: v.string(),
  title: v.string(),
  url: v.string(),
  matchedPhrase: v.optional(v.string()),
  priorityScore: v.number(),
  tier: v.string(),
  addedAt: v.number(),
});

/** Heartbeat → enqueue a tap-channel cold-strike for the daily digest. */
export const enqueueColdStrike = internalMutation({
  args: { agentId: v.id("gtmAgents"), candidate: candidateValidator },
  handler: async (ctx, args): Promise<{ queued: number }> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return { queued: 0 };
    const next = enqueueStrike(
      parseColdStrikeQueue(agent.coldStrikeQueueJson),
      args.candidate
    );
    await ctx.db.patch(args.agentId, {
      coldStrikeQueueJson: JSON.stringify(next),
      updatedAt: Date.now(),
    });
    return { queued: next.candidates.length };
  },
});

/** Digest cron → read the top `limit` strikes to surface in the Telegram digest. */
export const getStrikeDigest = internalQuery({
  args: { agentId: v.id("gtmAgents"), limit: v.number() },
  handler: async (ctx, args): Promise<StrikeCandidate[]> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return [];
    return selectDigest(
      parseColdStrikeQueue(agent.coldStrikeQueueJson),
      args.limit
    );
  },
});

/** Digest cron → after sending, drop the surfaced threads + stamp the send. */
export const markStrikeDigestSent = internalMutation({
  args: { agentId: v.id("gtmAgents"), sentThreadIds: v.array(v.string()) },
  handler: async (ctx, args): Promise<void> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return;
    const queue = parseColdStrikeQueue(agent.coldStrikeQueueJson);
    const sent = new Set(args.sentThreadIds);
    const next: ColdStrikeQueue = {
      candidates: queue.candidates.filter((c) => !sent.has(c.threadId)),
      lastDigestSentAt: Date.now(),
    };
    await ctx.db.patch(args.agentId, {
      coldStrikeQueueJson: JSON.stringify(next),
      updatedAt: Date.now(),
    });
  },
});
