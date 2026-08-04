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
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";

/** Everything the vendor call needs, resolved in one read. */
export const publishContext = internalQuery({
  args: { customerId: v.id("customers"), draftId: v.optional(v.id("drafts")) },
  handler: async (
    ctx,
    args
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

    if (!row) return { ok: false, reason: `no ${channelKey} channel connected` };
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
      return { ok: false, reason: `the ${channelKey} connection has no account id` };
    }

    return { ok: true, channel: channelKey, zernioAccountId: row.zernioAccountId };
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
  },
  handler: async (ctx, args): Promise<{ placementId: Id<"placements"> }> => {
    // The queue retries; a retry must not mint a second placement for a post
    // that already went out.
    const existing = (await ctx.db
      .query("placements")
      .withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", args.idempotencyKey))
      .first()) as Doc<"placements"> | null;
    if (existing) return { placementId: existing._id };

    const placementId = await ctx.db.insert("placements", {
      customerId: args.customerId,
      kind: "post",
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
  },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: boolean; error?: string; url?: string; deduped?: boolean }> => {
    const context = await ctx.runQuery(internal.maya.publish.publishContext, {
      customerId: args.customerId,
      draftId: args.draftId,
    });
    if (!context.ok) return { ok: false, error: context.reason };

    const apiKey = process.env.ZERNIO_API_KEY;
    if (!apiKey) return { ok: false, error: "Zernio isn't configured" };

    const { ZernioClient } = await import("../integrations/zernio/client");
    const { publishText } = await import("../integrations/zernio/publish");

    const outcome = await publishText({
      client: new ZernioClient({ apiKey }),
      accountId: context.zernioAccountId,
      channel: context.channel,
      text: args.snapshotText,
      idempotencyKey: args.idempotencyKey,
    });

    if (!outcome.ok) return { ok: false, error: outcome.reason };

    await ctx.runMutation(internal.maya.publish.recordPlacement, {
      customerId: args.customerId,
      channel: context.channel,
      // ⭐ The text we publish is the text that was approved. Re-generating or
      // re-formatting here would break the snapshot guarantee — the founder
      // said yes to a specific string.
      snapshotText: args.snapshotText,
      idempotencyKey: args.idempotencyKey,
      url: outcome.url ?? undefined,
      draftId: args.draftId,
    });

    return { ok: true, url: outcome.url ?? undefined, deduped: outcome.deduped };
  },
});
