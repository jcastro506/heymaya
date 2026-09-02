/**
 * The directive ledger (§10) — every rule the founder ever gave.
 *
 * The problem this solves: the founder gives instructions in passing, forever.
 * *"don't post before 9."* *"stop saying game-changer."* *"we pivoted to
 * agencies."* A human employee absorbs these permanently. A model absorbs them
 * until the context rolls or the model changes — and on 2026-07-26 a model
 * ignored a verbatim workspace instruction twice in a row.
 *
 * So rules live in rows, not in a prompt.
 *
 * ## Invariant 3, and how it's actually enforced
 *
 * > A directive is never mutated. Superseding writes a NEW row pointing at the
 * > old one.
 *
 * `verbatim` is what they actually typed, and it must survive verbatim,
 * because the payoff is being able to say:
 *
 *   "You told me on July 3: 'stop posting on linkedin its dead.' Want it back on?"
 *
 * — not a paraphrase. A paraphrase is a summary of a rule; the quote is proof
 * you were listening. §10.2 claims this single behavior does more for trust
 * than the entire dashboard.
 *
 * Enforcement is not a convention. This module exposes NO mutation that can
 * write `verbatim` on an existing row — supersession only ever patches
 * `active` and `supersededAt` — and a sibling-file test greps the whole
 * `convex/maya` module for any patch that touches `verbatim`. Adding one fails
 * the suite.
 */

import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

const DIRECTIVE_KIND = v.union(
  v.literal("posting_mode"),
  v.literal("channel_toggle"),
  v.literal("cadence"),
  v.literal("timing_window"),
  v.literal("topic"),
  v.literal("phrase_ban"),
  v.literal("voice"),
  v.literal("entity_rule"),
  v.literal("approved_claim"),
  v.literal("product_truth"),
  v.literal("icp_correction"),
  v.literal("notification_pref"),
  v.literal("pause"),
  v.literal("escalation"),
  v.literal("standing_task"),
  v.literal("campaign"),
  v.literal("other"),
);

async function getDirective(
  ctx: QueryCtx,
  id: Id<"directives">,
): Promise<Doc<"directives"> | null> {
  // Schema is at the TS instantiation ceiling; `db.get` no longer narrows.
  return (await ctx.db.get(id)) as Doc<"directives"> | null;
}

/**
 * Record a new rule.
 *
 * `verbatim` is stored exactly as given — never cleaned up, never summarized,
 * never sentence-cased. Our reading of it goes in `interpretationJson`, which
 * is a separate field precisely so the quote stays pristine.
 *
 * `supersedesId` marks this as replacing an earlier rule. The earlier row is
 * deactivated and stamped — never rewritten, never deleted — so it can still
 * be quoted months later when the founder asks why something changed.
 */
export const append = internalMutation({
  args: {
    creatorId: v.id("creators"),
    kind: DIRECTIVE_KIND,
    verbatim: v.string(),
    interpretationJson: v.optional(v.string()),
    supersedesId: v.optional(v.id("directives")),
    sourceMessageId: v.optional(v.id("messages")),
    now: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    directiveId: Id<"directives">;
    superseded: Id<"directives"> | null;
  }> => {
    const now = args.now ?? Date.now();

    let superseded: Id<"directives"> | null = null;
    if (args.supersedesId) {
      const old = (await ctx.db.get(
        args.supersedesId,
      )) as Doc<"directives"> | null;
      // Cross-tenant guard: you cannot supersede another account's rule.
      if (old && old.creatorId === args.creatorId) {
        // ONLY these two fields. `verbatim` is never touched.
        await ctx.db.patch(args.supersedesId, {
          active: false,
          supersededAt: now,
        });
        superseded = args.supersedesId;
      }
    }

    const directiveId = await ctx.db.insert("directives", {
      creatorId: args.creatorId,
      kind: args.kind,
      verbatim: args.verbatim,
      interpretationJson: args.interpretationJson,
      active: true,
      supersedesId: superseded ?? undefined,
      sourceMessageId: args.sourceMessageId,
      createdAt: now,
    });

    return { directiveId, superseded };
  },
});

/**
 * "forget that" — one of the three commands that always work.
 *
 * Deactivates without deleting. The row stays quotable, because "why did you
 * stop doing X?" is a question that can come months after the forgetting, and
 * "you asked me to drop it on July 3" is the answer.
 */
export const forget = internalMutation({
  args: {
    creatorId: v.id("creators"),
    directiveId: v.id("directives"),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ forgotten: boolean }> => {
    const row = (await ctx.db.get(
      args.directiveId,
    )) as Doc<"directives"> | null;
    if (!row || row.creatorId !== args.creatorId) return { forgotten: false };
    if (!row.active) return { forgotten: false };
    await ctx.db.patch(args.directiveId, {
      active: false,
      supersededAt: args.now ?? Date.now(),
    });
    return { forgotten: true };
  },
});

/**
 * "what rules are you following?" — the second command that always works.
 *
 * Newest first, because precedence is recency: safety floor → platform/plan
 * limits → most recent directive → older directive → learned preference →
 * default.
 */
export const activeRules = internalQuery({
  args: { creatorId: v.id("creators"), kind: v.optional(DIRECTIVE_KIND) },
  handler: async (ctx, args): Promise<Doc<"directives">[]> => {
    const rows = (await ctx.db
      .query("directives")
      .withIndex("by_creator_and_active", (q) =>
        q.eq("creatorId", args.creatorId).eq("active", true),
      )
      .collect()) as Doc<"directives">[];
    const filtered = args.kind
      ? rows.filter((r) => r.kind === args.kind)
      : rows;
    return filtered.sort((a, b) => b.createdAt - a.createdAt);
  },
});

/**
 * The winning rule for one kind, plus what it replaced.
 *
 * Recency wins, **but never silently** — the caller gets the superseded row so
 * it can name it in a clause: *"I moved you to 10am, which replaces the 9am
 * you asked for in July."* Silently applying the newer rule is how a founder
 * loses track of what their own employee is doing.
 */
export const effectiveRule = internalQuery({
  args: { creatorId: v.id("creators"), kind: DIRECTIVE_KIND },
  handler: async (
    ctx,
    args,
  ): Promise<{
    winning: Doc<"directives"> | null;
    supersededChain: Doc<"directives">[];
  }> => {
    const active = (await ctx.db
      .query("directives")
      .withIndex("by_creator_and_active", (q) =>
        q.eq("creatorId", args.creatorId).eq("active", true),
      )
      .collect()) as Doc<"directives">[];
    const ofKind = active
      .filter((r) => r.kind === args.kind)
      .sort((a, b) => b.createdAt - a.createdAt);
    const winning = ofKind[0] ?? null;
    if (!winning) return { winning: null, supersededChain: [] };

    // Walk back through what this rule replaced, so the whole history is
    // quotable rather than just the current state.
    const chain: Doc<"directives">[] = [];
    let cursor = winning.supersedesId;
    while (cursor) {
      const prev = await getDirective(ctx, cursor);
      if (!prev) break;
      chain.push(prev);
      cursor = prev.supersedesId;
    }
    return { winning, supersededChain: chain };
  },
});

/**
 * The full history for one kind, active and retired, newest first.
 *
 * This is what answers "why did/didn't you do X?" from a stored record rather
 * than a reconstruction. §10.2 is explicit that the answer must never be
 * regenerated — a model asked to explain its own past behavior will produce a
 * plausible story, which is worse than saying "I don't know".
 */
export const history = internalQuery({
  args: { creatorId: v.id("creators"), kind: v.optional(DIRECTIVE_KIND) },
  handler: async (ctx, args): Promise<Doc<"directives">[]> => {
    const rows = (await ctx.db
      .query("directives")
      .withIndex("by_creator", (q) => q.eq("creatorId", args.creatorId))
      .collect()) as Doc<"directives">[];
    const filtered = args.kind
      ? rows.filter((r) => r.kind === args.kind)
      : rows;
    return filtered.sort((a, b) => b.createdAt - a.createdAt);
  },
});

/* -------------------------------------------------------------------------- */

/**
 * ⭐ The House Rules screen (§16.2, §18.9.3 ⑥).
 *
 * > *"House Rules earns a top-level slot even though it's not 'data.' Seeing
 * > your own sentences listed back with dates — "July 3: stop posting on
 * > Sundays" — is what convinces someone the agent actually remembers. It's the
 * > single cheapest trust-building screen in the product."*
 *
 * ⚠️ Everything above this line is `internal*`, callable only by her runtime.
 * The screen needs a browser-callable pair, and they are the only two in this
 * file — read your own rules, revoke one. There is deliberately no "add" and no
 * "edit": §18.9.3 says *"Nothing else — no editing, no categories, no
 * explanation."* A rule is something you told her in chat; a form for writing
 * rules would make it configuration, which is the workbench this product
 * refuses to be (§2.1).
 */

/** One rule, as the screen shows it. Nothing the screen doesn't render. */
export interface HouseRule {
  id: Id<"directives">;
  /** ⭐ THEIR sentence. Never our paraphrase — the verbatim IS the feature. */
  verbatim: string;
  createdAt: number;
}

export const myHouseRules = query({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ ok: boolean; rules?: HouseRule[]; error?: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { ok: false, error: "sign in first" };

    const creator = (await ctx.db
      .query("creators")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", identity.subject))
      .first()) as Doc<"creators"> | null;
    if (!creator) return { ok: false, error: "no account yet" };


    const rows = (await ctx.db
      .query("directives")
      .withIndex("by_creator_and_active", (q) =>
        q.eq("creatorId", creator._id).eq("active", true),
      )
      .collect()) as Doc<"directives">[];

    return {
      ok: true,
      /**
       * Newest first — the same precedence order `activeRules` uses, so the
       * screen reads top-to-bottom in the order she actually applies them.
       */
      rules: rows
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((r) => ({
          id: r._id,
          verbatim: r.verbatim,
          createdAt: r.createdAt,
        })),
    };
  },
});

/**
 * The ✕.
 *
 * ⚠️ Ownership is re-derived from the signed-in identity and compared against
 * the row — the `directiveId` arrives from the browser and is not trusted. A
 * revoke that took the client's word for whose rule it was would let anyone
 * with an id delete another founder's instructions.
 *
 * Reuses `forget`'s semantics (deactivate, stamp `supersededAt`) rather than
 * deleting: her runtime asks "what replaced this?", and a deleted row cannot
 * answer.
 */
export const revokeMyHouseRule = mutation({
  args: { directiveId: v.id("directives") },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: boolean; revoked: boolean; error?: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { ok: false, revoked: false, error: "sign in first" };

    const creator = (await ctx.db
      .query("creators")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", identity.subject))
      .first()) as Doc<"creators"> | null;
    if (!creator) return { ok: false, revoked: false, error: "no account yet" };


    const row = (await ctx.db.get(
      args.directiveId,
    )) as Doc<"directives"> | null;
    // Same answer for "doesn't exist" and "isn't yours": a distinguishable
    // response would confirm that someone else's directive id is real.
    if (!row || row.creatorId !== creator._id) {
      return { ok: true, revoked: false };
    }
    if (!row.active) return { ok: true, revoked: false };

    await ctx.db.patch(args.directiveId, {
      active: false,
      supersededAt: Date.now(),
    });
    return { ok: true, revoked: true };
  },
});
