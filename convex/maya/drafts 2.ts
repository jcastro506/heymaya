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
    | { ok: true; draftId: Id<"drafts">; weightedLength: number }
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

    return { ok: true, draftId, weightedLength: verdict.weightedLength };
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
