/**
 * THE function that decides publish-or-hold (§9.1, §17.85.2).
 *
 * There is exactly one, and this is it. That's the whole point.
 *
 * ## Why this file exists
 *
 * The old system needed ~TEN independent conditions to agree before a post
 * could go out: `lifecycleState`, `strategyApprovalState`, `engagementReady`,
 * `autonomousPosting`, the ramp, `spendThrottledUntil`, plan state, channel
 * token, voice profile, and event status. Any one of them stale blocked
 * everything, silently. That is why "post it" did nothing for days at a time.
 *
 * The fix is not a cleanup. It's a rule:
 *
 * > On `just_go`, NOTHING may hold a publish except the safety floor or the
 * > platform itself. Any code path that can hold a post for a third reason is
 * > a defect.
 *
 * ## What is deliberately NOT checked here
 *
 * **Budgets.** The daily post cap, the video allowance, spend — none are
 * consulted. They belong to the pre-spend gate (§7.5.7), which runs *before
 * the founder ever sees the idea*, precisely so an approved idea can never
 * fail on budget. Failing after a yes is the worst possible sequence, and
 * re-checking a budget here would reintroduce exactly the class of silent hold
 * this function exists to eliminate.
 *
 * **Ramps, trust scores, "this one seems sensitive."** Gone. Calibration on a
 * new channel is a separate, self-terminating behavior (§9.1) that shows the
 * first three and then stops — it is not a gate and it is not here.
 *
 * ## The closed set
 *
 * `HoldReason` is a closed union and a test asserts its exact membership. If
 * someone needs a new reason to hold a post, they have to add a member here,
 * and that test fails until a human agrees the new reason is legitimate. That
 * is the enforcement mechanism — not a convention, not a code comment.
 */

import { v } from "convex/values";
import { internalQuery, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/**
 * Every legitimate reason a publish may be held. THE CLOSED SET.
 *
 * - `show_me_first` — the founder's switch, and the only mode-based hold.
 * - `safety_floor` — §9.2. Never done at any setting, including "never posts
 *   while paused or cancelled" (rule 8). Asking permission to say something
 *   ungrounded is the wrong shape; the answer is to write something else.
 * - `channel_unavailable` — no live grant to post with. This is the platform
 *   refusing, discovered one step early rather than as a 401. Not a policy
 *   gate: you cannot post to an account you hold no token for.
 * - `tiktok_preview_consent` — the one carve-out (§9.1). TikTok's rendered-
 *   preview confirmation is a platform consent requirement, and it is stated
 *   to the founder as such, not as our caution.
 *
 * Platform rejection proper isn't here because it isn't a decision — it's an
 * outcome. We return `publish: true`, attempt it, and report exactly what came
 * back.
 */
export type HoldReason =
  | "show_me_first"
  | "safety_floor"
  | "channel_unavailable"
  | "tiktok_preview_consent";

export const HOLD_REASONS: readonly HoldReason[] = [
  "show_me_first",
  "safety_floor",
  "channel_unavailable",
  "tiktok_preview_consent",
] as const;

export type PublishDecision =
  | {
      publish: true;
      /** Invariant 2: the snapshot, never a regeneration. */
      snapshotText: string;
      idempotencyKey: string;
    }
  | {
      publish: false;
      reason: HoldReason;
      /** Plain language — this reaches the founder. */
      detail: string;
    };

/**
 * The safety floor (§9.2), in its mechanically-enforceable half.
 *
 * The judgment half — unsourceable claims, competitor trashing, trend-jacking
 * a tragedy — is the Critique model's job and runs before a draft exists. What
 * lands here is what a server can decide alone and must decide regardless of
 * what any model thinks.
 */
function floorViolation(customer: Doc<"customers">): string | null {
  // §9.2 rule 8. A paused account is not a quiet account — it is an account
  // that does not act on the world at all.
  if (customer.state === "paused") {
    return "you have me paused, so I'm not posting";
  }
  if (customer.state === "cancelled") {
    return "the account is cancelled, so I'm not posting";
  }
  if (customer.state === "onboarding") {
    return "we haven't finished setting up yet";
  }
  return null;
}

async function get<T>(ctx: QueryCtx, id: Id<never> | string): Promise<T | null> {
  // The schema is at TypeScript's instantiation ceiling, so `db.get` returns a
  // union of every table's doc type instead of narrowing.
  return (await ctx.db.get(id as Id<"customers">)) as T | null;
}

/**
 * Decide. One function, one answer.
 *
 * `alreadyApproved` is the founder having said yes to THIS draft — a word in
 * chat, a tap in Mission Control. It's an argument rather than a lookup so the
 * caller can't accidentally satisfy it with some other kind of state.
 */
export function decide(input: {
  customer: Doc<"customers"> | null;
  channel: Doc<"channels"> | null;
  draft: Doc<"drafts"> | null;
  alreadyApproved: boolean;
}): PublishDecision {
  const { customer, channel, draft, alreadyApproved } = input;

  if (!customer) {
    return {
      publish: false,
      reason: "safety_floor",
      detail: "account not found",
    };
  }
  if (!draft) {
    return {
      publish: false,
      reason: "safety_floor",
      detail: "there's nothing written to post",
    };
  }

  const floor = floorViolation(customer);
  if (floor) {
    return { publish: false, reason: "safety_floor", detail: floor };
  }

  if (!channel || channel.status === "disconnected" || channel.status === "error") {
    return {
      publish: false,
      reason: "channel_unavailable",
      detail: "that account isn't connected right now — reconnect and I'll post it",
    };
  }
  if (channel.status === "dormant") {
    return {
      publish: false,
      reason: "channel_unavailable",
      detail: "that channel is switched off at the moment",
    };
  }

  // A rejected or expired draft is not a hold — there is simply nothing to
  // publish. Treated as floor rather than inventing a fifth reason.
  if (draft.outcome === "rejected" || draft.outcome === "expired") {
    return {
      publish: false,
      reason: "safety_floor",
      detail: `that draft was ${draft.outcome}`,
    };
  }

  // THE SWITCH. The only mode-based hold there is.
  if (channel.postingMode === "show_me_first" && !alreadyApproved) {
    return {
      publish: false,
      reason: "show_me_first",
      detail: "showing you this one first — say the word and it goes",
    };
  }

  // The one carve-out. Stated as the platform's requirement, because that is
  // what it is — not our caution dressed up as theirs.
  if (channel.channel === "tiktok" && !alreadyApproved) {
    return {
      publish: false,
      reason: "tiktok_preview_consent",
      detail:
        "TikTok needs you to confirm the preview before I can post it — that's their rule, not mine",
    };
  }

  // On `just_go`, everything else is a report, not a gate.
  return {
    publish: true,
    // Invariant 2: what the founder saw is what goes out. Never regenerated.
    snapshotText: draft.snapshotText,
    // Invariant 4: every publish carries one, derived from the draft so a
    // retry of the same draft can never double-publish.
    idempotencyKey: `draft:${draft._id}`,
  };
}

/** The Convex entry point. Loads the three rows and calls `decide`. */
export const decidePublish = internalQuery({
  args: {
    customerId: v.id("customers"),
    draftId: v.id("drafts"),
    alreadyApproved: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<PublishDecision> => {
    const customer = await get<Doc<"customers">>(ctx, args.customerId);
    const draft = await get<Doc<"drafts">>(ctx, args.draftId);

    // Cross-tenant guard: a draft id from another account never resolves.
    if (draft && draft.customerId !== args.customerId) {
      return {
        publish: false,
        reason: "safety_floor",
        detail: "that draft belongs to a different account",
      };
    }

    const channel = draft
      ? ((
          await ctx.db
            .query("channels")
            .withIndex("by_customer_and_channel", (q) =>
              q
                .eq("customerId", args.customerId)
                .eq(
                  "channel",
                  draft.channel as "tiktok" | "instagram" | "youtube" | "x"
                )
            )
            .first()
        ) as Doc<"channels"> | null)
      : null;

    return decide({
      customer,
      channel,
      draft,
      alreadyApproved: args.alreadyApproved ?? false,
    });
  },
});

/**
 * Has this draft already been published?
 *
 * Double-publish prevention reads the placements table by the same
 * idempotency key `decide` mints, so the check and the write agree by
 * construction rather than by two call sites remembering the same format.
 */
export const alreadyPublished = internalQuery({
  args: { draftId: v.id("drafts") },
  handler: async (ctx, args): Promise<boolean> => {
    const existing = await ctx.db
      .query("placements")
      .withIndex("by_idempotency_key", (q) =>
        q.eq("idempotencyKey", `draft:${args.draftId}`)
      )
      .first();
    return existing !== null;
  },
});
