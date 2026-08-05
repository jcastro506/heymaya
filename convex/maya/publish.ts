/**
 * Publishing — the vendor call, and the row that proves it happened (Sprint 3).
 *
 * ## Where this sits
 *
 * `publishDecision.ts` decides publish-or-hold. `preflight.ts` decides whether
 * the text is postable. This does neither. By the time a `publish_placement`
 * job reaches here **the decision is already made**, and re-deciding would
 * reintroduce exactly the silent-hold class the iron rule exists to eliminate.
 *
 * ## What "it worked" means
 *
 * Not a 200. Zernio publish calls returned 200 for **six days** while nothing
 * was published — a lenient schema parsed a changed response into nothing, and
 * every dashboard stayed green.
 *
 * So the unit of work is a **placement**: a row with a URL (§ principle 6). A
 * publish that cannot produce one is recorded as `unknown`, never as live, and
 * never as a URL we assembled ourselves.
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";

/** Everything the vendor call needs, resolved in one read. */
export const publishContext = internalQuery({
  args: { customerId: v.id("customers"), draftId: v.optional(v.id("drafts")) },
  handler: async (
    ctx,
    args,
  ): Promise<
    | {
        ok: true;
        channel: string;
        zernioAccountId: string;
      }
    | { ok: false; reason: string }
  > => {
    const draft = args.draftId
      ? ((await ctx.db.get(args.draftId)) as Doc<"drafts"> | null)
      : null;
    if (args.draftId && !draft) return { ok: false, reason: "draft not found" };

    const channelKey = draft?.channel ?? "x";
    const channel = (await ctx.db
      .query("channels")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .collect()) as Doc<"channels">[];
    const row = channel.find((c) => c.channel === channelKey);

    if (!row)
      return { ok: false, reason: `no ${channelKey} channel connected` };
    if (row.status !== "connected") {
      return {
        ok: false,
        reason: `the ${channelKey} connection is ${row.status}${
          row.failureReason ? ` — ${row.failureReason}` : ""
        }`,
      };
    }
    if (!row.zernioAccountId) {
      // Connected with no account id is a broken row, not a transient fault.
      return {
        ok: false,
        reason: `the ${channelKey} connection has no account id`,
      };
    }

    return {
      ok: true,
      channel: channelKey,
      zernioAccountId: row.zernioAccountId,
    };
  },
});

/**
 * Record what actually went out.
 *
 * `linkStatus` is the honest field. A publish Zernio accepted but gave no URL
 * for is `unknown` — it is not `live`, because we have not seen it, and the
 * whole point of a placement is that someone can go look.
 */
export const recordPlacement = internalMutation({
  args: {
    customerId: v.id("customers"),
    channel: v.string(),
    snapshotText: v.string(),
    idempotencyKey: v.string(),
    url: v.optional(v.string()),
    draftId: v.optional(v.id("drafts")),
    publishedAt: v.optional(v.number()),
    /** A reply is a different KIND of placement, and the archive cares. */
    kind: v.optional(
      v.union(v.literal("post"), v.literal("reply"), v.literal("cold_reply")),
    ),
  },
  handler: async (ctx, args): Promise<{ placementId: Id<"placements"> }> => {
    // The queue retries; a retry must not mint a second placement for a post
    // that already went out.
    const existing = (await ctx.db
      .query("placements")
      .withIndex("by_idempotency_key", (q) =>
        q.eq("idempotencyKey", args.idempotencyKey),
      )
      .first()) as Doc<"placements"> | null;
    if (existing) return { placementId: existing._id };

    const placementId = await ctx.db.insert("placements", {
      customerId: args.customerId,
      kind: args.kind ?? "post",
      channel: args.channel,
      url: args.url,
      linkStatus: args.url ? "live" : "unknown",
      publishedAt: args.publishedAt ?? Date.now(),
      snapshotText: args.snapshotText,
      draftId: args.draftId,
      idempotencyKey: args.idempotencyKey,
    });
    return { placementId };
  },
});

/**
 * The `publish_placement` job handler.
 *
 * Returns rather than throws, so a permanent refusal (the platform rejected the
 * text) lands in the dead-letter view with its reason instead of burning five
 * retries on something that will never succeed.
 */
export const publishPlacement = internalAction({
  args: {
    customerId: v.id("customers"),
    snapshotText: v.string(),
    idempotencyKey: v.string(),
    draftId: v.optional(v.id("drafts")),
    /** Present for a reply or a cold reply. Dropping it posts into the void. */
    inReplyTo: v.optional(v.string()),
    /** Set when this reply answers someone from the inbox — see below. */
    inboxItemId: v.optional(v.id("inboxItems")),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    ok: boolean;
    error?: string;
    url?: string;
    deduped?: boolean;
  }> => {
    const context = await ctx.runQuery(internal.maya.publish.publishContext, {
      customerId: args.customerId,
      draftId: args.draftId,
    });
    if (!context.ok) return { ok: false, error: context.reason };

    const apiKey = process.env.ZERNIO_API_KEY;
    if (!apiKey) return { ok: false, error: "Zernio isn't configured" };

    /**
     * ⭐ THE SAFETY CHECK, IMMEDIATELY BEFORE THE IRREVERSIBLE ACT.
     *
     * `convex/maya/outbound.ts` had **zero callers** — every export in it,
     * including `critiqueSafety` and `checkPublicPost`. The note that removed
     * the critique SUBAGENT said the guarantee had moved server-side and
     * *"FAILS CLOSED — at the publish gate."* It never got wired.
     *
     * Nothing unsafe shipped, for an accidental reason: her workspace still
     * described `critique` as a subagent with veto power, so the 11:00 job
     * drafted a post every day, couldn't reach a critic that no longer
     * existed, and held. Live, in her words:
     *
     *   "It did run at 11am... but did not post because the required
     *    independent critique model wasn't available. It didn't bypass that
     *    check."
     *
     * Two bugs cancelling out. Fixing the prompt alone would have published
     * unchecked posts on day one.
     *
     * ## Why HERE and not at the tool
     *
     * `decidePublish` is a query and cannot make a model call, so the check
     * has to live in an action. Of the two candidates, this one is the only
     * unbypassable one: a hold at the tool leaves an enqueued job that still
     * posts, whereas nothing reaches the vendor except through this line. §2.9
     * wants exactly one function deciding publish-or-hold; this is where the
     * publish actually happens.
     *
     * Fail-closed is deliberate and it has teeth: no OpenRouter key, or a
     * vendor outage, means nothing posts. That is the correct trade — but it
     * is also why the failure below is NAMED and reaches the founder, rather
     * than the silence that hid this for a day.
     */
    const check = (await ctx.runAction(internal.maya.outbound.checkPublicPost, {
      text: args.snapshotText,
    })) as {
      ok: boolean;
      findings: Array<{ label?: string; detail?: string }>;
      drift: Array<{ label?: string; detail?: string }>;
    };

    // Drift is LOGGED, never blocking — the standing rule is that
    // non-catastrophic drift never drops a post.
    if (check.drift.length > 0) {
      console.warn(
        `[publish] drift on ${args.draftId ?? "draft"}: ${check.drift
          .map((d) => d.label ?? d.detail ?? "?")
          .join(", ")}`
      );
    }

    if (!check.ok) {
      const why =
        check.findings.map((f) => f.detail ?? f.label).filter(Boolean)[0] ??
        "it didn't pass the safety check";
      return { ok: false, error: `held: ${why}` };
    }

    const { ZernioClient } = await import("../integrations/zernio/client");
    const { publishText } = await import("../integrations/zernio/publish");

    const outcome = await publishText({
      client: new ZernioClient({ apiKey }),
      accountId: context.zernioAccountId,
      channel: context.channel,
      text: args.snapshotText,
      inReplyTo: args.inReplyTo,
      idempotencyKey: args.idempotencyKey,
    });

    if (!outcome.ok) return { ok: false, error: outcome.reason };

    const { placementId } = await ctx.runMutation(
      internal.maya.publish.recordPlacement,
      {
        customerId: args.customerId,
        channel: context.channel,
        // ⭐ The text we publish is the text that was approved. Re-generating or
        // re-formatting here would break the snapshot guarantee — the founder
        // said yes to a specific string.
        snapshotText: args.snapshotText,
        idempotencyKey: args.idempotencyKey,
        url: outcome.url ?? undefined,
        draftId: args.draftId,
        kind: args.inReplyTo ? "reply" : "post",
      },
    );

    /**
     * ⭐ Close the inbox item — AFTER the placement exists, never before.
     *
     * Marking it answered at enqueue time would lose the person entirely if
     * the publish then failed: the item reads "answered", nothing is live, and
     * nobody ever finds out. Ordered this way the worst case is an item that
     * stays open and gets answered twice, which is recoverable; the other way
     * round is silent abandonment, which is not.
     */
    if (args.inboxItemId) {
      await ctx.runMutation(internal.maya.inbox.resolve, {
        itemId: args.inboxItemId,
        status: "answered",
        placementId,
      });
    }

    return {
      ok: true,
      url: outcome.url ?? undefined,
      deduped: outcome.deduped,
    };
  },
});
