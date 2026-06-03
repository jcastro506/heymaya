/**
 * Sprint 7 (top-tier) — the real-time intent strike GATE. The highest-converting
 * GTM action is answering a buyer the MOMENT they ask "is there a tool that does
 * X". The strike mechanism (draft → ban-safety → post / one-tap card) already
 * exists; this is the trigger's GATE — and the gate is the whole ballgame.
 *
 * Pipeline (cheapest filter first, so the expensive LLM check runs on almost
 * nothing): dedup against already-seen threads → non-LLM pre-filter (keyword
 * match + freshness + velocity + author quality) → strike-budget cap. Only the
 * survivors are worth a Flash-Lite "real buyer? we answer it?" confirm (done by
 * the agent/worker) and then a strike.
 *
 * The watcher itself lives in Convex (agents can't poll cheaply). The live
 * poll cron + agent-wake latency are OPERATOR-BLOCKED on the spike; this module
 * ships the deterministic gate + watch compile + budget so the moment the poll
 * is wired, the filtering is correct and tested.
 *
 * All functions here are PURE (nowMs passed in) — deterministic + unit-testable.
 */

export interface IntentWatch {
  phrases: string[];
  channels: string[];
  dailyStrikeBudget: number;
  strikesToday: number;
  strikeDayStamp: string; // YYYY-MM-DD (UTC)
  seenThreadIds: string[];
  lastPolledAt?: number;
}

export interface IntentCandidate {
  threadId: string;
  channel: string;
  text: string;
  authorKarma?: number; // or follower count — author quality proxy
  authorAgeDays?: number;
  postedAtMs: number;
  /** comments/upvotes accruing — a "still hot" proxy. */
  velocity?: number;
}

export interface PrefilterResult {
  threadId: string;
  channel: string;
  matchedPhrase: string;
  score: number; // 0-1 priority among survivors
  ageMinutes: number;
}

export interface PrefilterOutcome {
  survivors: PrefilterResult[];
  dropped: Array<{ threadId: string; reason: string }>;
  /** strikes still available today after the budget cap. */
  remainingBudget: number;
}

const DEFAULT_DAILY_STRIKE_BUDGET = 3;
/** A thread older than this is no longer a "real-time" strike — let the daily
 *  research pass handle it instead. */
const FRESHNESS_MAX_MINUTES = 180;
/** Below this, an author looks like a throwaway/spam account — skip (a strike on
 *  a bot thread wastes a strike + risks our account). */
const MIN_AUTHOR_KARMA = 5;
const MIN_AUTHOR_AGE_DAYS = 2;

export function dayStamp(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** Compile a watch from the buyer map's intent phrases + the bet channels. */
export function compileIntentWatch(input: {
  intentPhrases: ReadonlyArray<string>;
  betChannels: ReadonlyArray<string>;
  dailyStrikeBudget?: number;
  prior?: IntentWatch;
  nowMs: number;
}): IntentWatch {
  const phrases = Array.from(
    new Set(
      input.intentPhrases
        .map((p) => p.trim().toLowerCase())
        .filter((p) => p.length >= 3)
    )
  ).slice(0, 80);
  const channels = Array.from(
    new Set(input.betChannels.map((c) => c.trim().toLowerCase()).filter(Boolean))
  );
  const today = dayStamp(input.nowMs);
  const prior = input.prior;
  // Preserve today's strike count + seen ids across recompiles; reset at day roll.
  const sameDay = prior?.strikeDayStamp === today;
  return {
    phrases,
    channels,
    dailyStrikeBudget:
      input.dailyStrikeBudget ?? prior?.dailyStrikeBudget ?? DEFAULT_DAILY_STRIKE_BUDGET,
    strikesToday: sameDay ? prior!.strikesToday : 0,
    strikeDayStamp: today,
    seenThreadIds: prior?.seenThreadIds?.slice(-2000) ?? [],
    lastPolledAt: prior?.lastPolledAt,
  };
}

function matchPhrase(text: string, phrases: ReadonlyArray<string>): string | null {
  const hay = text.toLowerCase();
  for (const p of phrases) {
    if (hay.includes(p)) return p;
  }
  return null;
}

/**
 * The gate. Dedup → keyword → freshness → author-quality → velocity-priority →
 * budget cap. Returns survivors (ranked) + why each drop happened + remaining
 * budget. The caller marks survivors seen + records strikes via recordStrike.
 */
export function prefilterIntentCandidates(
  candidates: ReadonlyArray<IntentCandidate>,
  watch: IntentWatch,
  nowMs: number
): PrefilterOutcome {
  const today = dayStamp(nowMs);
  const sameDay = watch.strikeDayStamp === today;
  const usedToday = sameDay ? watch.strikesToday : 0;
  let remainingBudget = Math.max(0, watch.dailyStrikeBudget - usedToday);

  const seen = new Set(watch.seenThreadIds);
  const dropped: Array<{ threadId: string; reason: string }> = [];
  const candidatePool: PrefilterResult[] = [];

  for (const c of candidates) {
    if (seen.has(c.threadId)) {
      dropped.push({ threadId: c.threadId, reason: "already_seen" });
      continue;
    }
    if (watch.channels.length > 0 && !watch.channels.includes(c.channel.toLowerCase())) {
      dropped.push({ threadId: c.threadId, reason: "off_channel" });
      continue;
    }
    const matched = matchPhrase(c.text, watch.phrases);
    if (!matched) {
      dropped.push({ threadId: c.threadId, reason: "no_intent_phrase" });
      continue;
    }
    const ageMinutes = (nowMs - c.postedAtMs) / 60_000;
    if (ageMinutes > FRESHNESS_MAX_MINUTES || ageMinutes < 0) {
      dropped.push({ threadId: c.threadId, reason: "stale" });
      continue;
    }
    if (
      (c.authorKarma !== undefined && c.authorKarma < MIN_AUTHOR_KARMA) ||
      (c.authorAgeDays !== undefined && c.authorAgeDays < MIN_AUTHOR_AGE_DAYS)
    ) {
      dropped.push({ threadId: c.threadId, reason: "low_author_quality" });
      continue;
    }
    // Priority score: fresher + higher velocity = strike sooner. Bounded 0-1.
    const freshness = 1 - ageMinutes / FRESHNESS_MAX_MINUTES;
    const velocityScore = Math.min(1, (c.velocity ?? 0) / 10);
    const score = 0.6 * freshness + 0.4 * velocityScore;
    candidatePool.push({
      threadId: c.threadId,
      channel: c.channel,
      matchedPhrase: matched,
      score: Math.round(score * 1000) / 1000,
      ageMinutes: Math.round(ageMinutes),
    });
  }

  // Rank by score, then apply the hard daily budget — the rest spill to one-tap
  // (the caller decides), they are NOT auto-struck.
  candidatePool.sort((a, b) => b.score - a.score);
  const survivors = candidatePool.slice(0, remainingBudget);
  for (const overflow of candidatePool.slice(remainingBudget)) {
    dropped.push({ threadId: overflow.threadId, reason: "over_daily_budget" });
  }
  remainingBudget = Math.max(0, remainingBudget - survivors.length);

  return { survivors, dropped, remainingBudget };
}

/** Fold strikes + freshly-seen ids back into the watch (dedup + budget upkeep). */
export function recordStrike(
  watch: IntentWatch,
  struckThreadIds: ReadonlyArray<string>,
  seenThreadIds: ReadonlyArray<string>,
  nowMs: number
): IntentWatch {
  const today = dayStamp(nowMs);
  const sameDay = watch.strikeDayStamp === today;
  const strikesToday = (sameDay ? watch.strikesToday : 0) + struckThreadIds.length;
  const seen = new Set([...watch.seenThreadIds, ...seenThreadIds, ...struckThreadIds]);
  return {
    ...watch,
    strikeDayStamp: today,
    strikesToday,
    seenThreadIds: Array.from(seen).slice(-2000),
    lastPolledAt: nowMs,
  };
}

// ───────────────────────── persistence + httpActions ─────────────────────────
//
// NOTE: the LIVE intent poll cron (every 2-3 min against the social APIs) and
// the low-latency agent-wake are OPERATOR-BLOCKED on the agent-wake spike. What
// ships here: compile/read the watch + run the deterministic gate over candidates
// + record strikes (dedup + budget). When the poller is wired, it calls
// evaluateIntentCandidatesHttp with what it pulled and wakes the agent on survivors.

import { v } from "convex/values";
import { httpAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { authenticate } from "./openclaw/inboundCallback";

function parseWatch(json: string | undefined): IntentWatch | undefined {
  if (!json) return undefined;
  try {
    return JSON.parse(json) as IntentWatch;
  } catch {
    return undefined;
  }
}

export const readIntentWatchInternal = internalQuery({
  args: { agentId: v.id("gtmAgents"), accountId: v.id("creators") },
  handler: async (ctx, args): Promise<IntentWatch | null> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent || agent.accountId !== args.accountId) return null;
    return parseWatch(agent.intentWatchJson) ?? null;
  },
});

export const writeIntentWatchInternal = internalMutation({
  args: { agentId: v.id("gtmAgents"), accountId: v.id("creators"), watch: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent || agent.accountId !== args.accountId) return;
    await ctx.db.patch(args.agentId, { intentWatchJson: args.watch });
  },
});

interface BuildWatchPayload {
  phrases?: unknown;
  channels?: unknown;
  dailyStrikeBudget?: unknown;
  nowMs?: number;
}

/** POST /lc_gtm/build_intent_watch — compile the watchlist from the agent's
 *  intent phrases + bet channels (preserving today's strike count + seen ids). */
export const buildIntentWatchHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });
  let body: BuildWatchPayload;
  try {
    body = (await request.json()) as BuildWatchPayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  const phrases = Array.isArray(body.phrases)
    ? body.phrases.filter((p): p is string => typeof p === "string")
    : [];
  const channels = Array.isArray(body.channels)
    ? body.channels.filter((c): c is string => typeof c === "string")
    : [];
  if (phrases.length === 0 || channels.length === 0) {
    return new Response(
      JSON.stringify({ ok: false, reason: "need_phrases_and_channels" }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }
  const nowMs = typeof body.nowMs === "number" ? body.nowMs : Date.now();
  const prior = await ctx.runQuery(internal.gtmMaya.intentStrike.readIntentWatchInternal, {
    agentId: auth.agentId,
    accountId: auth.accountId,
  });
  const watch = compileIntentWatch({
    intentPhrases: phrases,
    betChannels: channels,
    dailyStrikeBudget:
      typeof body.dailyStrikeBudget === "number" ? body.dailyStrikeBudget : undefined,
    prior: prior ?? undefined,
    nowMs,
  });
  await ctx.runMutation(internal.gtmMaya.intentStrike.writeIntentWatchInternal, {
    agentId: auth.agentId,
    accountId: auth.accountId,
    watch: JSON.stringify(watch),
  });
  return new Response(
    JSON.stringify({ ok: true, phrases: watch.phrases.length, channels: watch.channels, dailyStrikeBudget: watch.dailyStrikeBudget }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
});

interface EvaluatePayload {
  candidates?: IntentCandidate[];
  nowMs?: number;
}

/** POST /lc_gtm/evaluate_intent — run the deterministic gate over candidate
 *  threads (dedup → keyword → freshness → author → velocity → budget). Returns
 *  the ranked survivors worth a strike + the drop reasons. The expensive LLM
 *  "real buyer?" confirm runs on survivors only (caller's job). */
export const evaluateIntentCandidatesHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });
  let body: EvaluatePayload;
  try {
    body = (await request.json()) as EvaluatePayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  const nowMs = typeof body.nowMs === "number" ? body.nowMs : Date.now();
  const watch = await ctx.runQuery(internal.gtmMaya.intentStrike.readIntentWatchInternal, {
    agentId: auth.agentId,
    accountId: auth.accountId,
  });
  if (!watch) {
    return new Response(JSON.stringify({ ok: false, reason: "no_watch" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  const candidates = Array.isArray(body.candidates) ? body.candidates : [];
  const outcome = prefilterIntentCandidates(candidates, watch, nowMs);
  return new Response(JSON.stringify({ ok: true, ...outcome }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

interface RecordStrikePayload {
  struckThreadIds?: string[];
  seenThreadIds?: string[];
  nowMs?: number;
}

/** POST /lc_gtm/record_strike — after striking, fold the strikes + seen ids back
 *  into the watch (decrements budget, prevents re-striking the same thread). */
export const recordStrikeHttp = httpAction(async (ctx, request) => {
  const auth = await authenticate(ctx, request);
  if (!auth.ok) return new Response(auth.reason, { status: auth.status });
  let body: RecordStrikePayload;
  try {
    body = (await request.json()) as RecordStrikePayload;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  const nowMs = typeof body.nowMs === "number" ? body.nowMs : Date.now();
  const watch = await ctx.runQuery(internal.gtmMaya.intentStrike.readIntentWatchInternal, {
    agentId: auth.agentId,
    accountId: auth.accountId,
  });
  if (!watch) {
    return new Response(JSON.stringify({ ok: false, reason: "no_watch" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  const next = recordStrike(
    watch,
    Array.isArray(body.struckThreadIds) ? body.struckThreadIds : [],
    Array.isArray(body.seenThreadIds) ? body.seenThreadIds : [],
    nowMs
  );
  await ctx.runMutation(internal.gtmMaya.intentStrike.writeIntentWatchInternal, {
    agentId: auth.agentId,
    accountId: auth.accountId,
    watch: JSON.stringify(next),
  });
  return new Response(
    JSON.stringify({ ok: true, strikesToday: next.strikesToday, budget: next.dailyStrikeBudget }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
});
