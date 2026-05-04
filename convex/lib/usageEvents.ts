/**
 * Creator usage analytics — write helper.
 *
 * Single chokepoint for every Maya behavior to log a usage event + maintain
 * the denormalized scoreboard on the creator doc (`lastEngagedAt`,
 * `engagementScore7d`, `topSkillLast7d`).
 *
 * Cross-tenant isolation: the helper accepts an `Id<"creators">` and writes
 * only to that creator's row + the `usageEvents` table indexed by
 * `creatorId`. There is no path through which creator A's events can mutate
 * creator B's scoreboard.
 *
 * Plan-tier gating: usage logging is plan-agnostic. We log every event
 * regardless of tier so we can answer "what does Starter look like" without
 * special-casing. Read-side aggregation (admin queries) is itself
 * plan-agnostic for now (operator-facing only, no creator-facing UI).
 *
 * Five mandatory test categories (see
 * /Users/joshcastro/.claude/projects/.../memory/feedback_validation_gap_prevention.md):
 *   1. Cross-tenant — `__tests__/usageEvents.test.ts` asserts Creator A's
 *      log writes do NOT touch Creator B's scoreboard.
 *   2. Plan-tier × action — N/A here (plan-agnostic by design).
 *   3. Adversarial — invalid `kind` is rejected by the validator union.
 *   4. Sibling-file scan — schema fields and table indexes match what this
 *      helper reads/writes; the test imports both to keep them in lockstep.
 *   5. TODO(s7): chat-turn label classifier — the only outstanding marker
 *      in this file, justified at the wire-in below.
 */

import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

/* -------------------------------------------------------------------------- */
/* Types + constants                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The 8 locked event kinds. Adding a new kind requires (a) widening the
 * schema literal-union, (b) extending `CREATOR_DRIVEN_KINDS` if applicable,
 * (c) widening this type.
 */
export type UsageEventKind =
  | "cron_fired"
  | "event_fired"
  | "chat_turn_in"
  | "chat_turn_out"
  | "reaction_received"
  | "explicit_feedback"
  | "action_taken"
  | "action_ignored";

/**
 * Kinds that count as creator-driven activity for `lastEngagedAt` updates.
 * Maya-driven kinds (cron_fired, event_fired, chat_turn_out) do NOT bump
 * `lastEngagedAt` — otherwise every Maya cron tick would falsely look like
 * the creator is active.
 */
export const CREATOR_DRIVEN_KINDS: ReadonlySet<UsageEventKind> = new Set([
  "chat_turn_in",
  "reaction_received",
  "explicit_feedback",
  "action_taken",
] as const);

/** 7 days in ms — window for engagementScore7d / topSkillLast7d. */
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Hard cap on how many events we scan when recomputing the scoreboard.
 * 500 is enough for the most active creator (mid-3-figures events/week is
 * an extreme outlier) and keeps the helper O(small).
 */
const SCOREBOARD_SCAN_CAP = 500;

/* -------------------------------------------------------------------------- */
/* Validator union — kept in sync with schema.ts usageEvents.kind             */
/* -------------------------------------------------------------------------- */

const KIND_VALIDATOR = v.union(
  v.literal("cron_fired"),
  v.literal("event_fired"),
  v.literal("chat_turn_in"),
  v.literal("chat_turn_out"),
  v.literal("reaction_received"),
  v.literal("explicit_feedback"),
  v.literal("action_taken"),
  v.literal("action_ignored")
);

/* -------------------------------------------------------------------------- */
/* Public helper                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Log a single usage event.
 *
 * Side effects:
 *   1. Inserts a `usageEvents` row.
 *   2. Updates the denormalized scoreboard on the creator doc:
 *      - `lastEngagedAt`  — bumped only on creator-driven kinds.
 *      - `engagementScore7d`  — recomputed (0-100) from the last 7 days.
 *      - `topSkillLast7d`  — most-fired cron_fired/event_fired label.
 *
 * Recomputation cost: bounded by `SCOREBOARD_SCAN_CAP` events. We use the
 * `by_creator_and_ts` index in descending order so we always scan the
 * most-recent slice.
 *
 * Idempotency: this helper does NOT dedupe. Callers are responsible for
 * not double-firing — a real retry IS a real second event.
 */
export const logUsageEvent = internalMutation({
  args: {
    creatorId: v.id("creators"),
    kind: KIND_VALIDATOR,
    label: v.optional(v.string()),
    signal: v.optional(v.string()),
    meta: v.optional(v.any()),
    /** Defaults to `Date.now()` when omitted. */
    ts: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Id<"usageEvents">> => {
    return await logUsageEventInline(ctx, args);
  },
});

/* -------------------------------------------------------------------------- */
/* Scoreboard recompute (private)                                             */
/* -------------------------------------------------------------------------- */

/**
 * Recompute the three denormalized scoreboard fields on the creator doc.
 *
 * `lastEngagedAt`:
 *   - Bumped to `ts` if `kind` is creator-driven AND `ts > existing`.
 *   - Otherwise left as-is (Maya-driven events do NOT bump it).
 *
 * `engagementScore7d` (0-100):
 *   - Rough heuristic — counts creator-driven events in the last 7d, weighted:
 *       chat_turn_in:        3
 *       action_taken:        4
 *       reaction_received:   2 (+1 if signal is positive)
 *       explicit_feedback:   2 (+/- 2 by signal)
 *       action_ignored:     -2 (penalty for non-engagement on a delivered draft)
 *   - Sum clamped to [0, 100]. The exact weights are heuristic and only
 *     matter for SORTING — the operator looks at this score relative to
 *     other creators, not as an absolute. Fixture-style integers make the
 *     test assertions exact.
 *
 * `topSkillLast7d`:
 *   - Most-fired label across `cron_fired` + `event_fired` in the last 7d.
 *   - Ties: lexicographically smaller label wins (deterministic).
 *   - Empty when no labeled cron/event has fired in the window.
 */
async function recomputeScoreboard(
  ctx: MutationCtx,
  creatorId: Id<"creators">,
  justWroteKind: UsageEventKind,
  justWroteTs: number
): Promise<void> {
  const creator = await ctx.db.get(creatorId);
  if (!creator) {
    // Creator was deleted between the mutation entrypoint and here — drop
    // the scoreboard update. The usageEvents row is already inserted; an
    // orphaned row is acceptable.
    return;
  }

  const windowStart = justWroteTs - SEVEN_DAYS_MS;

  // Pull up to SCOREBOARD_SCAN_CAP most-recent events for this creator.
  // `by_creator_and_ts` index makes this efficient.
  const recent = await ctx.db
    .query("usageEvents")
    .withIndex("by_creator_and_ts", (q) =>
      q.eq("creatorId", creatorId).gte("ts", windowStart)
    )
    .order("desc")
    .take(SCOREBOARD_SCAN_CAP);

  // ── lastEngagedAt: only bump on creator-driven kinds ────────────────────
  const existing = creator.lastEngagedAt ?? 0;
  let newLastEngagedAt: number = existing;
  if (CREATOR_DRIVEN_KINDS.has(justWroteKind) && justWroteTs > existing) {
    newLastEngagedAt = justWroteTs;
  }

  // ── engagementScore7d: weighted-sum heuristic, clamped [0, 100] ─────────
  let score = 0;
  for (const e of recent) {
    score += scoreContribution(e.kind as UsageEventKind, e.signal);
  }
  const engagementScore7d = Math.max(0, Math.min(100, score));

  // ── topSkillLast7d: most-fired label across cron_fired + event_fired ────
  const labelCounts = new Map<string, number>();
  for (const e of recent) {
    if (e.kind !== "cron_fired" && e.kind !== "event_fired") continue;
    if (!e.label) continue;
    labelCounts.set(e.label, (labelCounts.get(e.label) ?? 0) + 1);
  }
  let topSkillLast7d: string | undefined = undefined;
  let topCount = 0;
  for (const [label, count] of labelCounts) {
    if (
      count > topCount ||
      (count === topCount &&
        topSkillLast7d !== undefined &&
        label < topSkillLast7d)
    ) {
      topSkillLast7d = label;
      topCount = count;
    }
  }

  // ── Patch the creator doc ───────────────────────────────────────────────
  const patch: Partial<Doc<"creators">> = {
    engagementScore7d,
    topSkillLast7d,
  };
  if (newLastEngagedAt !== existing) {
    patch.lastEngagedAt = newLastEngagedAt;
  }
  await ctx.db.patch(creatorId, patch);
}

/* -------------------------------------------------------------------------- */
/* Channel bridge stubs (paths d, e, f)                                        */
/* -------------------------------------------------------------------------- */

/**
 * Inbound chat-turn wire-in (path d).
 *
 * Convenience wrapper called from the OpenClaw → Convex bridge whenever a
 * creator sends Maya a message via iMessage / WhatsApp / SMS / web chat.
 * The bridge itself lives in OpenClaw runtime (see
 * `agents/skills/maya-platform/playbook.md` § Chat handling) — this is the
 * Convex-side hook the bridge POSTs to once the operator ships an HTTP
 * endpoint that forwards inbound messages.
 *
 * TODO(s7): wire a small LLM topic classifier in front of this so the
 * `label` field carries an inferred topic ("brand_deal", "post_idea",
 * "stuck_on_X") rather than "unclassified". For now, callers pass label
 * explicitly when known and omit otherwise (defaulted to "unclassified").
 */
export const recordChatTurnIn = internalMutation({
  args: {
    creatorId: v.id("creators"),
    label: v.optional(v.string()),
    meta: v.optional(v.any()),
    ts: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Id<"usageEvents">> => {
    return await logUsageEventInline(ctx, {
      creatorId: args.creatorId,
      kind: "chat_turn_in",
      // TODO(s7): replace "unclassified" with output of a small LLM
      // classifier. See header.
      label: args.label ?? "unclassified",
      meta: args.meta,
      ts: args.ts,
    });
  },
});

/**
 * Outbound chat-turn wire-in (path e).
 *
 * Called whenever Maya sends the creator a message — proactive (cron) or
 * conversational (reply). Plumbing today: Maya calls this through the same
 * OpenClaw → Convex bridge as `recordChatTurnIn`.
 */
export const recordChatTurnOut = internalMutation({
  args: {
    creatorId: v.id("creators"),
    label: v.optional(v.string()),
    meta: v.optional(v.any()),
    ts: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Id<"usageEvents">> => {
    return await logUsageEventInline(ctx, {
      creatorId: args.creatorId,
      kind: "chat_turn_out",
      label: args.label,
      meta: args.meta,
      ts: args.ts,
    });
  },
});

/**
 * iMessage tapback wire-in (path f).
 *
 * STUB: the inbound iMessage tapback handler (Claw Messenger bridge) does
 * not yet expose tapbacks to Convex. When it does, the bridge will POST to
 * a small HTTP route that calls this mutation. Until then, this exists so
 * future-us has the call shape locked + the test harness can exercise it.
 *
 * TODO(s7): wire the Claw Messenger tapback events to a Convex HTTP route
 * and have it call this mutation.
 */
export const recordReactionReceived = internalMutation({
  args: {
    creatorId: v.id("creators"),
    /**
     * One of the 6 standard iMessage tapbacks: "love" | "like" | "dislike"
     * | "laugh" | "emphasize" | "question". Validated by the bridge before
     * forwarding; we keep it `string` here so future tapback variants don't
     * require a schema migration.
     */
    signal: v.string(),
    /** Maya-side message id the tapback applied to, when known. */
    targetMessageId: v.optional(v.string()),
    label: v.optional(v.string()),
    ts: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Id<"usageEvents">> => {
    return await logUsageEventInline(ctx, {
      creatorId: args.creatorId,
      kind: "reaction_received",
      label: args.label,
      signal: args.signal,
      meta: args.targetMessageId
        ? { targetMessageId: args.targetMessageId }
        : undefined,
      ts: args.ts,
    });
  },
});

/**
 * Internal — share write+scoreboard logic across all wrappers without
 * paying for a runMutation hop.
 */
async function logUsageEventInline(
  ctx: MutationCtx,
  args: {
    creatorId: Id<"creators">;
    kind: UsageEventKind;
    label?: string;
    signal?: string;
    meta?: unknown;
    ts?: number;
  }
): Promise<Id<"usageEvents">> {
  const ts = args.ts ?? Date.now();
  const eventId = await ctx.db.insert("usageEvents", {
    creatorId: args.creatorId,
    kind: args.kind,
    label: args.label,
    signal: args.signal,
    meta: args.meta,
    ts,
  });
  await recomputeScoreboard(ctx, args.creatorId, args.kind, ts);
  return eventId;
}

/**
 * Score contribution for one event. Pure function — kept exported for tests.
 */
export function scoreContribution(
  kind: UsageEventKind,
  signal?: string
): number {
  switch (kind) {
    case "chat_turn_in":
      return 3;
    case "action_taken":
      return 4;
    case "reaction_received": {
      const positive =
        signal === "love" || signal === "like" || signal === "laugh";
      const negative = signal === "dislike";
      if (negative) return 0;
      return positive ? 3 : 2;
    }
    case "explicit_feedback": {
      if (signal === "approve") return 4;
      if (signal === "reject" || signal === "stop") return 0;
      // "ignore" or unset → small positive (creator was at least typing).
      return 2;
    }
    case "action_ignored":
      return -2;
    // Maya-driven kinds + chat_turn_out don't move the score.
    case "cron_fired":
    case "event_fired":
    case "chat_turn_out":
    default:
      return 0;
  }
}
