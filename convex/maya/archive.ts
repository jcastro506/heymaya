/**
 * The archive (§16.8) — everything she ever did, searchable.
 *
 * > A founder who can scroll a year of work sees an asset they own, not a
 * > subscription they rent.
 *
 * Two fields do disproportionate work here, and both are about the archive
 * outliving the platform:
 *
 * **`snapshotText`** — posts get deleted, accounts get restricted, links 404.
 * If a row were only a URL, a year of history would silently become a year of
 * dead links. Storing what actually went out means the archive is ours,
 * permanently, whatever the platform does.
 *
 * **`linkStatus`** — a dead link is shown as "no longer live" with the text
 * preserved, never as a broken tap. An archive that renders a 404 as a normal
 * entry is worse than no archive: it looks like a record and behaves like a
 * lie.
 *
 * ## Provenance (§16.8.4) — the chain nobody stores
 *
 * ```
 * the live post
 *   ← the draft, and the founder's edit to it
 *     ← the idea, and the comment or trend that produced it
 *       ← the format card it borrowed
 * ```
 *
 * The spec's own note is that "all of that is already being stored — it just
 * needs to be joined." That's what `provenance` does. It's also the most
 * persuasive thing the product can show: *this post exists because someone in
 * your niche asked this question.*
 */

import { v } from "convex/values";
import { internalQuery, query } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";

/* -------------------------------------------------------------------------- */
/* Search                                                                      */
/* -------------------------------------------------------------------------- */

const CHANNEL = v.union(
  v.literal("tiktok"),
  v.literal("instagram"),
  v.literal("youtube"),
  v.literal("x"),
);

/**
 * Search the archive.
 *
 * §16.8.2: *"Find that post about pricing" has to work, or the archive is a
 * scroll rather than a resource.* At four placements a day, one customer-year
 * is ~1,500 rows — past the point where scrolling is a substitute.
 *
 * The customer filter rides inside the search index rather than being applied
 * afterwards. Filtering post-hoc would mean the *ranking* is computed across
 * every tenant's rows, so a popular phrase in another account could push a
 * customer's own post off their results.
 */
export const search = internalQuery({
  args: {
    customerId: v.id("customers"),
    query: v.string(),
    channel: v.optional(CHANNEL),
    kind: v.optional(
      v.union(v.literal("post"), v.literal("reply"), v.literal("cold_reply")),
    ),
    since: v.optional(v.number()),
    until: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Doc<"placements">[]> => {
    if (args.query.trim().length === 0) return [];

    const rows = (await ctx.db
      .query("placements")
      .withSearchIndex("search_snapshot_text", (q) => {
        const scoped = q
          .search("snapshotText", args.query)
          .eq("customerId", args.customerId);
        return args.channel ? scoped.eq("channel", args.channel) : scoped;
      })
      .take(args.limit ?? 50)) as Doc<"placements">[];

    // Date and kind are applied after the search because the index filters on
    // customer and channel only. Bounded by `take` above, so this stays cheap.
    return rows.filter((row) => {
      if (args.kind && row.kind !== args.kind) return false;
      if (args.since !== undefined && row.publishedAt < args.since)
        return false;
      if (args.until !== undefined && row.publishedAt > args.until)
        return false;
      return true;
    });
  },
});

/** Reverse-chronological archive, for scrolling rather than searching. */
export const timeline = internalQuery({
  args: {
    customerId: v.id("customers"),
    since: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Doc<"placements">[]> => {
    const rows = (await ctx.db
      .query("placements")
      .withIndex("by_customer_and_publishedAt", (q) =>
        args.since !== undefined
          ? q.eq("customerId", args.customerId).gte("publishedAt", args.since)
          : q.eq("customerId", args.customerId),
      )
      .order("desc")
      .take(args.limit ?? 50)) as Doc<"placements">[];
    return rows;
  },
});

/* -------------------------------------------------------------------------- */
/* Presentation                                                                */
/* -------------------------------------------------------------------------- */

export interface ArchiveEntry {
  placementId: Id<"placements">;
  channel: string;
  text: string;
  publishedAt: number;
  /** Present only when the post is actually reachable. */
  url?: string;
  /** What the UI should say instead of rendering a tappable link. */
  linkNote?: string;
  tappable: boolean;
}

/**
 * How one placement should be shown.
 *
 * The rule from §16.8.1: a dead link is *"no longer live"* with the text
 * preserved, never a broken tap. `tappable` exists so a surface cannot
 * accidentally render a 404 as a normal entry — which is the failure that
 * makes an archive feel like a lie rather than a record.
 */
export function toEntry(placement: Doc<"placements">): ArchiveEntry {
  const base = {
    placementId: placement._id,
    channel: placement.channel,
    text: placement.snapshotText,
    publishedAt: placement.publishedAt,
  };

  if (placement.linkStatus === "live" && placement.url) {
    return { ...base, url: placement.url, tappable: true };
  }
  if (placement.linkStatus === "gone") {
    return { ...base, linkNote: "no longer live", tappable: false };
  }
  return { ...base, linkNote: "link not resolved yet", tappable: false };
}

/* -------------------------------------------------------------------------- */
/* Provenance — §16.8.4                                                        */
/* -------------------------------------------------------------------------- */

export interface Provenance {
  placement: {
    id: Id<"placements">;
    channel: string;
    text: string;
    url?: string;
    publishedAt: number;
  };
  /** The draft, and what the founder changed about it. */
  draft?: {
    id: Id<"drafts">;
    proposedText: string;
    outcome: string;
    /** The voice-training signal (§10.5) — kept even for rejected drafts. */
    editDiff?: string;
  };
  /** The idea, and the evidence that produced it. */
  idea?: {
    id: Id<"ideas">;
    angle: string;
    evidenceJson?: string;
  };
  formatCardId?: string;
  /**
   * Where the chain stopped, and why. An honest gap beats a silent one — a
   * placement with no idea behind it is a real thing (a founder-directed
   * post), not a bug, and the UI should be able to tell the difference.
   */
  brokenAt?: "draft" | "idea";
}

/**
 * Walk the chain back from a live post.
 *
 * Degrades link by link rather than all-or-nothing: a placement whose draft
 * was deleted still shows the placement, and says the chain broke at the
 * draft. Returning nothing because one hop is missing would hide the parts we
 * do have.
 */
export const provenance = internalQuery({
  args: { customerId: v.id("customers"), placementId: v.id("placements") },
  handler: async (ctx, args): Promise<Provenance | null> => {
    const placement = (await ctx.db.get(
      args.placementId,
    )) as Doc<"placements"> | null;
    // Cross-tenant guard: another account's placement never resolves.
    if (!placement || placement.customerId !== args.customerId) return null;

    const result: Provenance = {
      placement: {
        id: placement._id,
        channel: placement.channel,
        text: placement.snapshotText,
        url: placement.url,
        publishedAt: placement.publishedAt,
      },
      formatCardId: placement.formatCardId,
    };

    if (!placement.draftId) return result;
    const draft = (await ctx.db.get(placement.draftId)) as Doc<"drafts"> | null;
    if (!draft) return { ...result, brokenAt: "draft" };

    result.draft = {
      id: draft._id,
      proposedText: draft.snapshotText,
      outcome: draft.outcome,
      editDiff: draft.editDiff,
    };

    const ideaId = placement.ideaId ?? draft.ideaId;
    if (!ideaId) return result;
    const idea = (await ctx.db.get(ideaId)) as Doc<"ideas"> | null;
    if (!idea) return { ...result, brokenAt: "idea" };

    result.idea = {
      id: idea._id,
      angle: idea.angle,
      evidenceJson: idea.evidenceJson,
    };
    return result;
  },
});

/* -------------------------------------------------------------------------- */
/* On the thumbnail field that used to be here                                 */
/* -------------------------------------------------------------------------- */

/**
 * `placements.thumbnailId` was deleted, and no pipeline replaced it.
 *
 * The spec asked for a thumbnail "generated on ingest," which smuggled in two
 * assumptions that turned out to be false:
 *
 * 1. **That anything is ingested.** Nothing is. We author 100% of the archive's
 *    media — every placement is something we made, so the original is already
 *    in our own pipeline before it is published. There is no foreign asset
 *    arriving from anywhere, and nothing is ever fetched back off a platform.
 *
 * 2. **That a derived copy must be stored.** It doesn't: the feed asks for a
 *    display size in the URL and gets one. Pre-generating a second artifact is
 *    a pattern from before on-the-fly image serving, and it costs a field, a
 *    job, an image worker, and a failure mode to buy nothing.
 *
 * `mediaAssetIds` holds the originals; sizing is a serving concern. Left as a
 * note rather than silence because the deleted field is still named 16 times in
 * prose, and the next person to read that will reasonably assume it was an
 * oversight.
 */

/* -------------------------------------------------------------------------- */

/**
 * ⭐ The Activity feed, for the founder's own screen (§16.8.6).
 *
 * > *"Every placement, newest first, with the real thumbnail and its live
 * > metrics, linking out to the actual post… **the trust engine** — they scroll
 * > it and *see* her being native."*
 *
 * ⚠️ Everything above this line is `internalQuery` — reachable by her runtime
 * and by nothing the founder can open. So the archive existed, was correct, and
 * had **zero readers**: Mission Control's Activity screen reads
 * `gtmMaya.missionControl.getMyAgentActivity`, backed by the frozen product's
 * tables, which the live module never writes.
 *
 * ⭐ Reuses `toEntry` rather than re-deriving the link rule. §16.8.1 says a dead
 * link is *"no longer live"* with the text preserved, never a broken tap — and
 * a second implementation of that is a second place it can be got wrong. The
 * `tappable` flag is what stops a surface rendering a 404 as a normal entry,
 * which is the failure that makes an archive feel like a lie.
 */
export interface ActivityEntry extends ArchiveEntry {
  views: number;
  /**
   * ⭐ Clicks on this post's tracked product link (§14.45 rung 1).
   *
   * `undefined` means the post carried no link at all — a different fact from
   * `0`, which means it had one and nobody clicked. §16.4's rule applied to
   * attribution: never let "not measured" render as "measured zero".
   */
  clicks?: number;
  /** ⚠️ When those metrics were last true (§16.4). Never implied. */
  metricsAsOf?: number;
}

export const myActivity = query({
  args: { limit: v.optional(v.number()) },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: boolean; entries?: ActivityEntry[]; error?: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { ok: false, error: "sign in first" };

    const creator = (await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first()) as Doc<"creators"> | null;
    if (!creator) return { ok: false, error: "no account yet" };

    const customer = (await ctx.db
      .query("customers")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .first()) as Doc<"customers"> | null;
    if (!customer) return { ok: false, error: "no account yet" };

    const rows = (await ctx.db
      .query("placements")
      .withIndex("by_customer_and_publishedAt", (q) =>
        q.eq("customerId", customer._id),
      )
      .order("desc")
      .take(Math.min(args.limit ?? 50, 100))) as Doc<"placements">[];

    const clicks = await ctx.runQuery(
      internal.maya.attribution.clicksForPlacements,
      { customerId: customer._id },
    );

    return {
      ok: true,
      entries: rows.map((p) => ({
        ...toEntry(p),
        views: viewsOfPlacement(p),
        // Present only when this post actually carried a tracked link.
        clicks: clicks[String(p._id)],
        metricsAsOf: p.metricsAsOf,
      })),
    };
  },
});

/**
 * Views off the metrics blob, defensively.
 *
 * ⚠️ Returns 0 rather than throwing on a shape we don't recognise — but 0 and
 * "not measured yet" are different claims, which is why `metricsAsOf` rides
 * alongside and the screen says which one it is.
 */
function viewsOfPlacement(p: Doc<"placements">): number {
  if (!p.metricsJson) return 0;
  try {
    const m = JSON.parse(p.metricsJson) as { views?: unknown };
    return typeof m.views === "number" ? m.views : 0;
  } catch {
    return 0;
  }
}
