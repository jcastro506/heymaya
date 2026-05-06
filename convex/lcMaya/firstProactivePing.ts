/**
 * Sprint 7 Slice D — Day 1 first-proactive-ping event handler.
 *
 * After Sprint 6 stamps `creators.pictureLockedAt` (creator-picture
 * synthesis + verification both complete), Maya's first proactive message
 * fires 15-30 min later. This is THE make-or-break moment for whether the
 * creator opens iMessage tomorrow — voice quality matters more than
 * completeness, so a weak ping is silently skipped rather than shipped.
 *
 * Three-stage flow:
 *
 *   1. `firePictureLockedEvent` — stamps `creators.pictureLockedAt` and
 *      schedules a Convex `runAfter(jitter, runFirstProactivePing)`. Public
 *      mutation; idempotency-guarded by `firstProactivePingSentAt`. The
 *      jitter uniform-random in [15min, 30min] is computed at schedule
 *      time and persisted on the queued `firstProactivePings` row so tests
 *      and ops can confirm it.
 *
 *   2. `runFirstProactivePing` (internal action, fires post-jitter) —
 *      picks top-1 highest-fit trend from `trendObservations`, picks the
 *      top-1 idea grounded in `creatorPicture` + recent posts, composes
 *      the ping body, writes `firstProactivePings` row with status =
 *      "queued" or "skipped". Stamps `firstProactivePingSentAt`
 *      regardless — the event MUST NOT re-fire.
 *
 *   3. Maya the agent (OpenClaw runtime, separate from Convex) reads the
 *      row on her next heartbeat, pushes via claw-messenger, and patches
 *      status → "sent" + sets `sentAt`. This last step is owned by the
 *      agent and is NOT in this file's scope.
 *
 * Empty-input precedence (locked):
 *   trend present AND idea present  → `precedence: "trend+idea"`, status=queued
 *   trend present AND idea empty    → `precedence: "trend-only"`, status=queued
 *   trend empty   AND idea present  → `precedence: "idea-only"`,  status=queued
 *   trend empty   AND idea empty    → `precedence: "skip-empty"`, status=skipped
 *
 * Cross-tenant safety: every mutation/action takes `creatorId` and looks
 * the row up by exact id. The trend pick + idea pick re-query by the same
 * `creatorId` index — there is no path by which Creator A's pictureLocked
 * event composes against Creator B's data.
 *
 * DO NOT modify `convex/lcMaya/lcMayaHttp.ts` (Slice B owns that file's
 * new OAuth endpoint). The OAuth URL composition uses Slice A/B-owned
 * endpoints by URL convention only — actual generation is the agent's job
 * at send time, not ours.
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";

/* -------------------------------------------------------------------------- */
/* Constants — locked Slice D values                                           */
/* -------------------------------------------------------------------------- */

/**
 * Jitter window post-`pictureLockedAt`. 15-30 min is the operator-locked
 * range — long enough that the ping doesn't feel scripted, short enough
 * that the creator is still in the "I just set this up" mental state.
 */
export const FIRST_PING_MIN_DELAY_MS = 15 * 60 * 1000;
export const FIRST_PING_MAX_DELAY_MS = 30 * 60 * 1000;

/**
 * Banned phrases for the first ping. Sourced from the anti-sycophancy
 * principles in `convex/agents/packs/maya/workspace/generateAgentsMd.ts`
 * (no SOUL.md generator exists for the creator product yet — see
 * MEMORY.md). The composer rejects any output that contains any of these
 * (case-insensitive substring match) and falls back to the
 * idea-only / trend-only / skip-empty leg.
 *
 * Why this list is short: trust the LLM. Per
 * `feedback_trust_llm_judgment_no_hardcoded_rules`, hardcoded rules are
 * for mechanical correctness only. These are the few phrases that
 * unambiguously betray sycophancy / chatbot tone in Maya's voice
 * principles. The voice-applier skill catches the rest.
 */
export const BANNED_PHRASES: ReadonlyArray<string> = [
  // No "AI" / "chatbot" framing — operator-locked, see
  // feedback_no_ai_in_marketing_copy. Maya is a manager, not an AI.
  "as an ai",
  "i'm an ai",
  "ai assistant",
  "ai-powered",
  // Anti-sycophancy core. AGENTS.md calls these out by name.
  "amazing work",
  "great job",
  "you're doing great",
  "love this",
  "keep it up",
  // Generic chatbot openings.
  "hey there!",
  "hi there!",
  "happy to help",
  // Marketing-cliche surface (no listicle scaffolding).
  "let me know if",
  "feel free to",
  "i'm here to help",
];

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

export type FirstPingPrecedence =
  | "trend+idea"
  | "trend-only"
  | "idea-only"
  | "skip-empty";

export type FirstPingStatus = "queued" | "sent" | "skipped";

export interface ComposedFirstPing {
  body: string;
  precedence: FirstPingPrecedence;
  citations: {
    trendRef?: string;
    ideaPostIds: string[];
  };
  status: FirstPingStatus;
}

export interface ComposeInputs {
  /**
   * Top-1 highest-fit trend for this creator. Shape mirrors
   * `trendObservations` row. Pass `null` when the trend watcher returned
   * nothing.
   */
  topTrend: {
    observation: string;
    /** First evidence row's `ref` is the cited URL (or hashtag / sound id). */
    primaryRef: string;
  } | null;
  /**
   * Top-1 grounded idea for this creator. Pass `null` when the idea
   * generator returned nothing OR when `creatorPicture` lacks ≥2 source
   * citations to ground the idea.
   */
  topIdea: {
    /** One-line idea text. Authored by the agent runtime / idea-generator skill. */
    text: string;
    /** Post-id citations. Slice D requires ≥2 for the ping to ship. */
    postIds: ReadonlyArray<string>;
  } | null;
  /**
   * OAuth URLs Maya texts the creator. The composer treats these as
   * pre-signed strings; actual URL generation belongs to Slice A/B at
   * send-time. The composer accepts `null` so a future variant (e.g.
   * provider already connected) can omit the offer.
   */
  gmailOAuthUrl: string | null;
  calendarOAuthUrl: string | null;
}

/* -------------------------------------------------------------------------- */
/* Pure helpers — exported for tests                                           */
/* -------------------------------------------------------------------------- */

/**
 * Sample a uniform-random delay in [FIRST_PING_MIN_DELAY_MS,
 * FIRST_PING_MAX_DELAY_MS]. Inclusive on both ends.
 *
 * Tests inject `randomFn` to pin the boundary cases (15min and 30min
 * exact). Production passes `Math.random` (default).
 */
export function pickJitterMs(randomFn: () => number = Math.random): number {
  const r = randomFn();
  // Clamp r into [0, 1] so an out-of-bounds randomFn (test fixtures often
  // pass 0 / 1) maps cleanly to the inclusive bounds.
  const clamped = Math.max(0, Math.min(1, r));
  const span = FIRST_PING_MAX_DELAY_MS - FIRST_PING_MIN_DELAY_MS;
  return Math.round(FIRST_PING_MIN_DELAY_MS + clamped * span);
}

/**
 * True when `body` contains any banned phrase (case-insensitive substring
 * match). Used by the composer to reject sycophantic output.
 */
export function containsBannedPhrase(body: string): boolean {
  const lower = body.toLowerCase();
  return BANNED_PHRASES.some((phrase) => lower.includes(phrase));
}

/**
 * Compose the first-ping body + precedence + citations. Pure function —
 * no Convex, no I/O. Exported so tests can pin the exact output shape
 * without spinning the action.
 *
 * The body is intentionally terse + multi-line; the operator's locked
 * shape per the spec is:
 *
 *     First read on your account.
 *
 *     Trend: <one-line>.
 *     Idea: <one-line>.
 *
 *     Connect Gmail to handle brand emails: <url>
 *     Connect Calendar so I can see what's coming: <url>
 *
 *     Reply when something lands.
 *
 * No emoji clusters (per the ≤5-line rule + § 4.5 playbook). No "Hey
 * [name]!" — channel context already shows it's Maya. No listicle. No
 * menus. Anti-sycophancy is non-negotiable.
 */
export function composeFirstPing(inputs: ComposeInputs): ComposedFirstPing {
  const { topTrend, topIdea, gmailOAuthUrl, calendarOAuthUrl } = inputs;

  const trendOk = topTrend !== null && topTrend.observation.trim().length > 0;
  // Idea must carry ≥2 post-id citations — that's the citation firewall
  // bar from § 4.5 + the locked Slice D rule.
  const ideaOk =
    topIdea !== null &&
    topIdea.text.trim().length > 0 &&
    topIdea.postIds.length >= 2;

  // Empty-input precedence rule.
  if (!trendOk && !ideaOk) {
    return {
      body: "",
      precedence: "skip-empty",
      citations: { ideaPostIds: [] },
      status: "skipped",
    };
  }

  const precedence: FirstPingPrecedence = trendOk
    ? ideaOk
      ? "trend+idea"
      : "trend-only"
    : "idea-only";

  const lines: string[] = [];
  lines.push("First read on your account.");
  lines.push("");
  if (trendOk && topTrend) {
    lines.push(`Trend: ${topTrend.observation.trim()} (${topTrend.primaryRef})`);
  }
  if (ideaOk && topIdea) {
    const cites = topIdea.postIds.slice(0, 3).join(", ");
    lines.push(`Idea: ${topIdea.text.trim()} (cite: ${cites})`);
  }
  lines.push("");
  if (gmailOAuthUrl) {
    lines.push(`Connect Gmail to handle brand emails: ${gmailOAuthUrl}`);
  }
  if (calendarOAuthUrl) {
    lines.push(`Connect Calendar so I can see what's coming: ${calendarOAuthUrl}`);
  }
  lines.push("");
  lines.push("Reply when something lands.");

  const body = lines.join("\n");

  // Sycophancy / chatbot-tone guard. If the composed body trips a banned
  // phrase, fall back to skip-empty. This is defense-in-depth: the
  // upstream skills SHOULD already voice-apply, but the first ping is the
  // make-or-break moment — better silent than off-voice.
  if (containsBannedPhrase(body)) {
    return {
      body: "",
      precedence: "skip-empty",
      citations: { ideaPostIds: [] },
      status: "skipped",
    };
  }

  return {
    body,
    precedence,
    citations: {
      trendRef: trendOk && topTrend ? topTrend.primaryRef : undefined,
      ideaPostIds: ideaOk && topIdea ? [...topIdea.postIds] : [],
    },
    status: "queued",
  };
}

/* -------------------------------------------------------------------------- */
/* Internal helpers (Convex-side)                                              */
/* -------------------------------------------------------------------------- */

/**
 * Pick the top-1 highest-fit trend for this creator.
 *
 * "Highest-fit" = highest `relevanceScore`, ties broken by most-recent
 * `observedAt`. Returns null when no trend rows exist for the creator.
 *
 * Cross-tenant: scoped via `by_creator` index. There is no codepath that
 * reads a different creator's trends.
 */
export const pickTopTrendForCreator = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (
    ctx,
    args
  ): Promise<{
    observation: string;
    primaryRef: string;
  } | null> => {
    const rows = await ctx.db
      .query("trendObservations")
      .withIndex("by_creator", (q) => q.eq("creatorId", args.creatorId))
      .collect();
    if (rows.length === 0) return null;
    const winner = rows.reduce((best, r) => {
      if (r.relevanceScore > best.relevanceScore) return r;
      if (r.relevanceScore < best.relevanceScore) return best;
      return r.observedAt > best.observedAt ? r : best;
    });
    if (!winner.observation.trim()) return null;
    const firstEvidence = winner.evidence[0];
    if (!firstEvidence || !firstEvidence.ref.trim()) return null;
    return {
      observation: winner.observation,
      primaryRef: firstEvidence.ref,
    };
  },
});

/**
 * Pick the top-1 grounded idea. v0 implementation: read the creator's
 * `creatorPicture`, take the top hook + its citation post-ids, and
 * synthesize a one-line idea from `topHooks[0].pattern`. Returns null
 * when:
 *   - no `creatorPicture` row, OR
 *   - `topHooks` is empty, OR
 *   - the first top hook lacks an `examplePostId`, OR
 *   - `creatorPicture.sourceCitations` has fewer than 2 entries to
 *     satisfy the ≥2-citation rule.
 *
 * This is intentionally a stub. When `maya-idea-generator` (Sprint 5
 * skill referenced in the task spec) lands, the agent will call that
 * skill BEFORE writing the row — this Convex helper exists so an empty
 * skill output still degrades gracefully via the precedence rule above.
 */
export const pickTopIdeaForCreator = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (
    ctx,
    args
  ): Promise<{
    text: string;
    postIds: string[];
  } | null> => {
    const picture = await ctx.db
      .query("creatorPicture")
      .withIndex("by_creator", (q) => q.eq("creatorId", args.creatorId))
      .first();
    if (!picture) return null;
    if (picture.topHooks.length === 0) return null;
    const topHook = picture.topHooks[0];
    if (!topHook.pattern.trim()) return null;
    if (!topHook.examplePostId.trim()) return null;
    if (picture.sourceCitations.length < 2) return null;
    // Take up to 3 citations, preferring the ones that mention the top
    // hook + ensuring the example post-id is included.
    const orderedIds: string[] = [];
    if (topHook.examplePostId) orderedIds.push(topHook.examplePostId);
    for (const c of picture.sourceCitations) {
      if (orderedIds.includes(c.postId)) continue;
      orderedIds.push(c.postId);
      if (orderedIds.length >= 3) break;
    }
    if (orderedIds.length < 2) return null;
    return {
      text: `Lean into your ${topHook.pattern} — your last 30 already prove it lands`,
      postIds: orderedIds,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Internal: write the queue row + stamp the cursor                            */
/* -------------------------------------------------------------------------- */

export const writeFirstProactivePingRow = internalMutation({
  args: {
    creatorId: v.id("creators"),
    body: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("sent"),
      v.literal("skipped")
    ),
    precedence: v.union(
      v.literal("trend+idea"),
      v.literal("trend-only"),
      v.literal("idea-only"),
      v.literal("skip-empty")
    ),
    citations: v.object({
      trendRef: v.optional(v.string()),
      ideaPostIds: v.array(v.string()),
    }),
    composedAt: v.number(),
    scheduledFireAt: v.number(),
  },
  handler: async (ctx, args): Promise<Id<"firstProactivePings">> => {
    const creator = await ctx.db.get(args.creatorId);
    if (!creator) throw new Error("creator-not-found");

    // Idempotency: if the cursor is already stamped, do NOT insert a new
    // row. Return the most-recent row id (or throw if it really shouldn't
    // exist). This protects against a re-fire on a pictureLockedAt
    // re-stamp.
    if (creator.firstProactivePingSentAt !== undefined) {
      const existing = await ctx.db
        .query("firstProactivePings")
        .withIndex("by_creator", (q) => q.eq("creatorId", args.creatorId))
        .collect();
      if (existing.length > 0) {
        return existing[existing.length - 1]._id;
      }
      // Cursor stamped but no row exists — stamp again with a stub. This
      // is a rare-but-possible state if a prior run failed mid-mutation.
      // Fall through to insert.
    }

    const rowId = await ctx.db.insert("firstProactivePings", {
      creatorId: args.creatorId,
      status: args.status,
      body: args.body,
      precedence: args.precedence,
      citations: args.citations,
      composedAt: args.composedAt,
      scheduledFireAt: args.scheduledFireAt,
    });

    // Stamp the cursor so the event never re-fires.
    await ctx.db.patch(creator._id, {
      firstProactivePingSentAt: args.composedAt,
    });

    return rowId;
  },
});

/* -------------------------------------------------------------------------- */
/* Internal worker action — fires post-jitter                                   */
/* -------------------------------------------------------------------------- */

/**
 * Internal action — runs at `pictureLockedAt + jitter`. Picks the top
 * trend + idea, composes the body, writes the queue row.
 *
 * Idempotency-guarded at the top: if `firstProactivePingSentAt` is
 * already set, this is a re-fire and the action returns silently without
 * touching anything. This protects against:
 *   - A second `firePictureLockedEvent` call (re-stamp) that races with
 *     the first scheduler firing.
 *   - A retry from the Convex scheduler after a transient failure.
 */
export const runFirstProactivePing = internalAction({
  args: {
    creatorId: v.id("creators"),
    scheduledFireAt: v.number(),
    /**
     * OAuth URLs are passed in by the caller. Slice A/B own URL
     * generation; this action just embeds them. Pass `null` to omit the
     * offer (e.g. provider already connected at fire time).
     */
    gmailOAuthUrl: v.optional(v.union(v.string(), v.null())),
    calendarOAuthUrl: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args): Promise<void> => {
    const creator = await ctx.runQuery(
      internal.lcMaya.firstProactivePing.getCreatorForFirstPing,
      { creatorId: args.creatorId }
    );
    if (!creator) return; // creator deleted between schedule and fire — silent
    if (creator.firstProactivePingSentAt !== undefined) return; // already fired

    const topTrend = await ctx.runQuery(
      internal.lcMaya.firstProactivePing.pickTopTrendForCreator,
      { creatorId: args.creatorId }
    );
    const topIdea = await ctx.runQuery(
      internal.lcMaya.firstProactivePing.pickTopIdeaForCreator,
      { creatorId: args.creatorId }
    );

    const composed = composeFirstPing({
      topTrend,
      topIdea,
      gmailOAuthUrl: args.gmailOAuthUrl ?? null,
      calendarOAuthUrl: args.calendarOAuthUrl ?? null,
    });

    await ctx.runMutation(
      internal.lcMaya.firstProactivePing.writeFirstProactivePingRow,
      {
        creatorId: args.creatorId,
        body: composed.body,
        status: composed.status,
        precedence: composed.precedence,
        citations: composed.citations,
        composedAt: Date.now(),
        scheduledFireAt: args.scheduledFireAt,
      }
    );
  },
});

/* -------------------------------------------------------------------------- */
/* Internal helper queries                                                     */
/* -------------------------------------------------------------------------- */

export const getCreatorForFirstPing = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, args): Promise<Doc<"creators"> | null> => {
    return await ctx.db.get(args.creatorId);
  },
});

/* -------------------------------------------------------------------------- */
/* Internal mutation — fires the event                                         */
/* -------------------------------------------------------------------------- */

/**
 * Internal mutation — stamps `creators.pictureLockedAt` and schedules the
 * first-proactive-ping at `pictureLockedAt + uniformRandom(15min, 30min)`.
 *
 * Internal (not public) because the caller is always server-side: Sprint
 * 6's verification gate (the moment `creatorPicture` synthesis completes
 * AND any `needsVerification[]` items have cleared) invokes this from
 * inside its own internal action / mutation chain. Marking it `internal`
 * fail-closes the public surface — there is no client path that can
 * forge a `pictureLockedAt` stamp.
 *
 * Idempotency:
 *   - If `pictureLockedAt` is already stamped, do NOT re-stamp and do
 *     NOT re-schedule. Return `{ ok: true, alreadyFired: true }`.
 *   - If `firstProactivePingSentAt` is already stamped, even rarer —
 *     same return shape, no double-ping risk.
 *
 * Why a mutation (not action): scheduling work is a `ctx.scheduler`
 * primitive, available in mutations. The action surface is reserved for
 * external API calls.
 */
export const firePictureLockedEvent = internalMutation({
  args: {
    creatorId: v.id("creators"),
    /**
     * Override for tests so they can pin both jitter boundaries
     * deterministically. Production passes nothing and gets `Math.random`.
     */
    _testJitterRandom: v.optional(v.number()),
    /**
     * Override for tests / Sprint 6 to bind the lock timestamp. Production
     * passes nothing and gets `Date.now()`.
     */
    _testNowMs: v.optional(v.number()),
    /**
     * OAuth URLs to embed in the eventual ping. Slice A (Gmail Composio)
     * and Slice B (Google Calendar OAuth) own generation; this caller
     * passes them through if known. `null` is fine and yields a ping
     * without that connect offer.
     */
    gmailOAuthUrl: v.optional(v.union(v.string(), v.null())),
    calendarOAuthUrl: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    ok: boolean;
    alreadyFired: boolean;
    scheduledFireAt: number | null;
    reason?: string;
  }> => {
    const creator = await ctx.db.get(args.creatorId);
    if (!creator) {
      return {
        ok: false,
        alreadyFired: false,
        scheduledFireAt: null,
        reason: "creator-not-found",
      };
    }

    if (creator.firstProactivePingSentAt !== undefined) {
      return { ok: true, alreadyFired: true, scheduledFireAt: null };
    }

    if (creator.pictureLockedAt !== undefined) {
      // Already stamped — but the ping hasn't fired yet (we know because
      // `firstProactivePingSentAt` is still undefined). Don't double-
      // schedule; assume the original schedule is in flight.
      return { ok: true, alreadyFired: true, scheduledFireAt: null };
    }

    const nowMs = args._testNowMs ?? Date.now();
    const randomFn =
      args._testJitterRandom !== undefined
        ? () => args._testJitterRandom!
        : Math.random;
    const jitterMs = pickJitterMs(randomFn);
    const scheduledFireAt = nowMs + jitterMs;

    // Stamp the lock cursor.
    await ctx.db.patch(creator._id, { pictureLockedAt: nowMs });

    // Schedule the ping. Convex scheduler accepts a delay in ms via
    // `runAfter` — we already computed the absolute fire timestamp above
    // for the row.
    await ctx.scheduler.runAfter(
      jitterMs,
      internal.lcMaya.firstProactivePing.runFirstProactivePing,
      {
        creatorId: creator._id,
        scheduledFireAt,
        gmailOAuthUrl: args.gmailOAuthUrl ?? null,
        calendarOAuthUrl: args.calendarOAuthUrl ?? null,
      }
    );

    return {
      ok: true,
      alreadyFired: false,
      scheduledFireAt,
    };
  },
});
