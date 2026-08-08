/**
 * Drafts — the only way text becomes something that can be posted (Sprint 3).
 *
 * ## The gap this closes
 *
 * `publish` requires a `draftId`, and until now **nothing in the codebase
 * created a draft.** Found live on 2026-08-04: asked to post a specific
 * sentence, she answered
 *
 * > "I can't post it because this exact text doesn't have a draft record."
 *
 * Her tools were complete, the publish path worked end to end, and the sprint
 * could not move because there was no way to write down a sentence. The task
 * list assumed this existed — it names `publish`, `reply`, `ask_founder` and no
 * draft tool.
 *
 * ## Why preflight runs HERE, not only at publish
 *
 * A 300-character tweet should be rejected while she's writing it, when the fix
 * is free, rather than after the founder has read and approved it — at which
 * point the only options are silently editing text they said yes to, or going
 * back and asking again for something we could have caught immediately.
 *
 * Publish still checks. This is the earlier of two gates, not a replacement:
 * the channel can go stale between writing and posting.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { check as preflightCheck } from "./preflight";
import type { Doc, Id } from "../_generated/dataModel";

/**
 * How long a pending draft stays offerable.
 *
 * Invariant 8: a pending draft cannot sit forever. A day-old "want me to post
 * this?" is worse than nothing — the moment it was written for has passed, and
 * answering it commits the founder to something stale.
 */
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

export const create = internalMutation({
  args: {
    customerId: v.id("customers"),
    channel: v.string(),
    text: v.string(),
    kind: v.optional(
      v.union(v.literal("post"), v.literal("reply"), v.literal("cold_reply"))
    ),
    ideaId: v.optional(v.id("ideas")),
    now: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<
    | {
        ok: true;
        draftId: Id<"drafts">;
        weightedLength: number;
        /** Was the founder actually shown it? See the block below. */
        shown: boolean;
        shownBlockedBy?: Id<"messages">;
      }
    | { ok: false; message: string; failure: string }
  > => {
    const channels = (await ctx.db
      .query("channels")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .collect()) as Doc<"channels">[];
    const channelRow = channels.find((c) => c.channel === args.channel) ?? null;

    const verdict = preflightCheck({
      channel: args.channel,
      text: args.text,
      channelRow,
    });
    if (!verdict.ok) {
      // Named in words a founder could read, because she relays this rather
      // than reporting a code.
      return { ok: false, message: verdict.message, failure: verdict.failure.kind };
    }

    const now = args.now ?? Date.now();
    const draftId = await ctx.db.insert("drafts", {
      customerId: args.customerId,
      channel: args.channel,
      kind: args.kind ?? "post",
      snapshotText: args.text,
      ideaId: args.ideaId,
      outcome: "pending",
      proposedAt: now,
      expiresAt: now + DRAFT_TTL_MS,
    });

    /**
     * ⭐ THE IDEA IS SPENT. Marked here, at the moment it becomes a draft.
     *
     * `markUsed` existed with **zero callers**, so no idea ever left `bank` —
     * and `nextIdea` returns the highest-scored banked idea. With nothing
     * moving them out, the same idea won every single day.
     *
     * That is not theoretical. The cringe eval's first run (2026-08-07) found
     * four near-duplicate posts among sixteen, closest pair at 0.87:
     *
     *   "When you're building alone, a CSV shouldn't BECOME a dashboard project"
     *   "When you're building alone, a CSV shouldn't TURN INTO a dashboard project"
     *
     * 51 ideas banked, one of them used forever. §3.2: saying the same thing
     * twice "is how she stops sounding like an employee."
     *
     * ⚠️ Spent at DRAFT time, not at publish. A draft that sits pending for a
     * day would otherwise let tomorrow pick the same idea again — which is
     * exactly how four variations of one post got written. The bank holds 51;
     * burning one on a draft the founder rejects is cheap, and `bankDepth`
     * already watches for the bank running dry.
     */
    if (args.ideaId) {
      // Through `markUsed` rather than a direct patch, so there is one writer
      // of an idea's terminal state.
      await ctx.runMutation(internal.maya.ideas.markUsed, {
        ideaId: args.ideaId,
        status: "used",
      });
    }

    /**
     * ⭐ SHOWING IT IS PART OF CREATING IT.
     *
     * On `show_me_first` the draft is a promise — *"I'll show you this one
     * first"* — and principle 4 says anything promised to the user is enforced
     * by the server. This used to insert the row and return, leaving the
     * sending to the model remembering to do it next turn.
     *
     * It didn't. Observed 2026-08-06: she told the founder at 07:17 she would
     * draft an X post and show it, created the draft at 11:04, and never sent
     * a word. A second draft from the previous evening was hours from expiring
     * unseen. Both rows said `pending`; the founder had no idea either existed.
     *
     * Prompts drift; rows don't. So the message goes out in the same mutation
     * as the insert, keyed to the draft id so it can be sent exactly once.
     */
    const needsApproval =
      channelRow?.postingMode === "show_me_first" || args.channel === "tiktok";

    let shown = false;
    let shownBlockedBy: Id<"messages"> | undefined;

    if (needsApproval) {
      // `askFounder`, not `send` — this awaits an answer, so it has to respect
      // invariant 5 (one open question at a time) rather than talk over one.
      const asked = await ctx.runMutation(internal.maya.messages.askFounder, {
        customerId: args.customerId,
        surface: "telegram",
        body: `${args.text}\n\nWant this to go out?`,
        dedupeKey: `draft:${draftId}`,
        ts: now,
      });
      shown = asked.asked;
      // ⚠️ Blocked is NOT silent. The draft exists and the founder hasn't seen
      // it, which is the exact state this fix exists to end — so it is
      // reported here and re-offered by the hourly sweep once the open
      // question closes.
      shownBlockedBy = asked.blockedBy;
    }

    return {
      ok: true,
      draftId,
      weightedLength: verdict.weightedLength,
      shown,
      shownBlockedBy,
    };
  },
});

/**
 * What she's written and not yet posted.
 *
 * Expired drafts are filtered rather than deleted — the text is still worth
 * having as voice signal even once it's too stale to offer.
 */
export const pending = internalQuery({
  args: { customerId: v.id("customers"), now: v.optional(v.number()) },
  handler: async (ctx, args): Promise<Doc<"drafts">[]> => {
    const now = args.now ?? Date.now();
    const rows = (await ctx.db
      .query("drafts")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .collect()) as Doc<"drafts">[];
    return rows.filter((d) => d.outcome === "pending" && d.expiresAt > now);
  },
});

export const byId = internalQuery({
  args: { draftId: v.id("drafts") },
  handler: async (ctx, args): Promise<Doc<"drafts"> | null> =>
    (await ctx.db.get(args.draftId)) as Doc<"drafts"> | null,
});

/**
 * Record what the founder did with it.
 *
 * An edit stores the diff, because `{what I wrote → what they changed it to}`
 * is the highest-signal voice data in the system (§7.5.2 layer 2) and it costs
 * nothing to keep — the edit already happened.
 */
export const decide = internalMutation({
  args: {
    draftId: v.id("drafts"),
    outcome: v.union(
      v.literal("approved"),
      v.literal("edited"),
      v.literal("rejected")
    ),
    editedText: v.optional(v.string()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ ok: boolean; error?: string }> => {
    const draft = (await ctx.db.get(args.draftId)) as Doc<"drafts"> | null;
    if (!draft) return { ok: false, error: "no such draft" };

    const patch: Partial<Doc<"drafts">> = {
      outcome: args.outcome,
      decidedAt: args.now ?? Date.now(),
    };

    if (args.outcome === "edited" && args.editedText) {
      patch.editDiff = JSON.stringify({
        before: draft.snapshotText,
        after: args.editedText,
      });
      // ⭐ The edited text BECOMES the draft. Publishing reads snapshotText, so
      // leaving the original here would post the version they rejected.
      patch.snapshotText = args.editedText;
    }

    await ctx.db.patch(args.draftId, patch);
    return { ok: true };
  },
});

/**
 * ⭐ Show any pending draft the founder has never actually seen.
 *
 * The companion to the create-time send. `askFounder` refuses while another
 * question is open (invariant 5), so a draft written during one is created
 * unshown — and a draft nobody sees expires in 24h having achieved nothing.
 *
 * Detection is by the absence of the draft's own message, not by a flag on the
 * draft: the message row IS the record of having shown it, and a second flag
 * would be a second source of truth that drifts the first time a send fails.
 *
 * Called hourly by `livenessSweep`. Oldest first, one per pass — the invariant
 * allows exactly one open question, so offering two would be a no-op anyway.
 */
export const reofferUnshown = internalMutation({
  args: { customerId: v.id("customers"), now: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<{ pending: number; unshown: number; shown: number }> => {
    const now = args.now ?? Date.now();
    const drafts = (
      (await ctx.db
        .query("drafts")
        .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
        .collect()) as Doc<"drafts">[]
    ).filter((d) => d.outcome === "pending" && d.expiresAt > now);

    const channels = (await ctx.db
      .query("channels")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .collect()) as Doc<"channels">[];

    let unshown = 0;
    let shown = 0;

    for (const draft of [...drafts].sort((a, b) => a.proposedAt - b.proposedAt)) {
      const channelRow = channels.find((c) => c.channel === draft.channel) ?? null;
      const needsApproval =
        channelRow?.postingMode === "show_me_first" || draft.channel === "tiktok";
      if (!needsApproval) continue;

      const key = `draft:${draft._id}`;
      const already = await ctx.db
        .query("messages")
        .withIndex("by_customer_and_dedupe", (q) =>
          q.eq("customerId", args.customerId).eq("dedupeKey", key)
        )
        .first();
      if (already) continue;

      unshown += 1;
      if (shown > 0) continue; // One open question at a time.

      const asked = await ctx.runMutation(internal.maya.messages.askFounder, {
        customerId: args.customerId,
        surface: "telegram",
        body: `${draft.snapshotText}\n\nWant this to go out?`,
        dedupeKey: key,
        ts: now,
      });
      if (asked.asked) shown += 1;
    }

    return { pending: drafts.length, unshown, shown };
  },
});
