/**
 * ⭐ Complaint → content tracking (§5.0.0, Sprint 5).
 *
 * > *"% of posts traceable to a real buyer complaint, surfaced weekly."*
 *
 * This is the number that tests the product's central claim. CLAUDE.md states
 * the pitch in one line:
 *
 * > *"The pitch is **not** 'she posts for you' — open-source schedulers do that
 * > for free. It's that **she does the homework**."*
 *
 * A scheduler cannot produce this number at all, because it has no idea where
 * anything came from. If it sits near zero, we are a scheduler with better
 * prose — and that is worth knowing early rather than at churn.
 *
 * ## What counts, and what would be cheating
 *
 * A placement is traceable when its idea came from something a real person
 * **actually said**, with a URL that can be opened:
 *
 * | source | counts? | |
 * |---|---|---|
 * | `complaint` | ✅ | mined from real comments — the strongest |
 * | `own_comment` | ✅ | a buyer telling us what to make, on our post |
 * | `observation` | ✅ | something a real person posted, with a link |
 * | `format_card` | ❌ | a shape, not a thing anyone said |
 * | `founder` | ❌ | real, but it's the founder's idea, not a buyer's |
 * | `performance` | ❌ | our own past post; circular |
 *
 * ⚠️ **And the evidence must be openable.** An idea whose `sourceUrls` is empty
 * is an opinion with a source label on it — counting those would let the number
 * rise by relabelling rather than by doing the work, which is exactly the
 * failure mode a self-reported metric has.
 *
 * §14.3 applies: at a founder's volume this is a handful of posts a week, so it
 * is reported as a fraction with its denominator visible, never as a trend.
 */

import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

/** Idea sources that represent something a real buyer said. */
export const BUYER_SOURCES = ["complaint", "own_comment", "observation"] as const;

/** The strongest of them — mined from what people actually complain about. */
export const COMPLAINT_SOURCES = ["complaint", "own_comment"] as const;

export interface TraceabilityReport {
  /** Live placements in the window. The denominator, always shown. */
  posts: number;
  /** How many trace to something a real person said, with an openable link. */
  traceable: number;
  /** The subset that trace specifically to a complaint. */
  fromComplaints: number;
  /** 0–1, or null when there is nothing to divide. */
  share: number | null;
  /** Posts with no idea behind them at all — replies, or ideas that expired. */
  untraced: number;
  /** One example, so the number can be checked rather than believed. */
  example?: { text: string; quote: string; sourceUrl: string };
  detail: string;
}

/**
 * How much of what she posted came from listening?
 *
 * Deliberately computed at read time from rows rather than kept as a counter:
 * a stored percentage is a second source of truth, and this number's whole
 * value is that it cannot be talked up.
 */
export const traceability = internalQuery({
  args: {
    customerId: v.id("customers"),
    now: v.optional(v.number()),
    windowDays: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<TraceabilityReport> => {
    const now = args.now ?? Date.now();
    const windowDays = args.windowDays ?? 7;
    const since = now - windowDays * 86_400_000;

    const placements = (
      (await ctx.db
        .query("placements")
        .withIndex("by_customer_and_publishedAt", (q) =>
          q.eq("customerId", args.customerId).gte("publishedAt", since)
        )
        .collect()) as Doc<"placements">[]
    ).filter((p) => p.linkStatus === "live" && p.kind === "post");

    let traceable = 0;
    let fromComplaints = 0;
    let untraced = 0;
    let example: TraceabilityReport["example"];

    for (const placement of placements) {
      const ideaId = placement.ideaId;
      if (!ideaId) {
        untraced += 1;
        continue;
      }
      const idea = (await ctx.db.get(ideaId as Id<"ideas">)) as Doc<"ideas"> | null;
      if (!idea) {
        untraced += 1;
        continue;
      }

      const source = idea.sourceKind ?? "";
      if (!(BUYER_SOURCES as readonly string[]).includes(source)) {
        untraced += 1;
        continue;
      }

      // ⚠️ The evidence has to be openable. Without this the number rises by
      // relabelling an idea rather than by doing the work.
      let quote = "";
      let sourceUrl = "";
      try {
        const evidence = idea.evidenceJson
          ? (JSON.parse(idea.evidenceJson) as {
              quote?: unknown;
              sourceUrls?: unknown;
            })
          : {};
        quote = typeof evidence.quote === "string" ? evidence.quote : "";
        const urls = Array.isArray(evidence.sourceUrls) ? evidence.sourceUrls : [];
        sourceUrl = typeof urls[0] === "string" ? urls[0] : "";
      } catch {
        /* a corrupt row counts as untraced rather than throwing */
      }
      if (!quote || !sourceUrl) {
        untraced += 1;
        continue;
      }

      traceable += 1;
      if ((COMPLAINT_SOURCES as readonly string[]).includes(source)) {
        fromComplaints += 1;
      }
      if (!example) {
        example = { text: placement.snapshotText, quote, sourceUrl };
      }
    }

    const posts = placements.length;
    const share = posts === 0 ? null : traceable / posts;

    return {
      posts,
      traceable,
      fromComplaints,
      share,
      untraced,
      example,
      detail:
        posts === 0
          ? `nothing went live in the last ${windowDays} days`
          : // The denominator is always in the sentence. "71%" of seven posts
            // is five, and five is a number a founder can argue with.
            `${traceable} of ${posts} post${posts === 1 ? "" : "s"} came from something a real person said${
              fromComplaints > 0
                ? `, ${fromComplaints} of them from a complaint`
                : ""
            }`,
    };
  },
});

/**
 * The fleet view — which is a statement about US, not about them.
 *
 * §16.9.3: aggregate learning. If traceability is low across every customer,
 * the perception layer isn't feeding the writer, and that is a product defect
 * rather than a set of coincidences.
 */
export const fleetTraceability = internalQuery({
  args: { now: v.optional(v.number()), windowDays: v.optional(v.number()) },
  handler: async (
    ctx,
    args
  ): Promise<{ customers: number; posts: number; traceable: number; share: number | null }> => {
    const now = args.now ?? Date.now();
    const windowDays = args.windowDays ?? 7;
    const since = now - windowDays * 86_400_000;

    /**
     * Per customer rather than one scan: `placements` has no fleet-wide
     * `by_publishedAt` index, and adding one for a weekly operator query would
     * be a write cost on every publish to serve a read nobody runs hourly.
     */
    const customerRows = (await ctx.db
      .query("customers")
      .collect()) as Doc<"customers">[];

    const placements: Doc<"placements">[] = [];
    for (const customer of customerRows) {
      const rows = (await ctx.db
        .query("placements")
        .withIndex("by_customer_and_publishedAt", (q) =>
          q.eq("customerId", customer._id).gte("publishedAt", since)
        )
        .collect()) as Doc<"placements">[];
      placements.push(
        ...rows.filter((p) => p.linkStatus === "live" && p.kind === "post")
      );
    }

    const customers = new Set(placements.map((p) => p.customerId)).size;
    let traceable = 0;
    for (const placement of placements) {
      if (!placement.ideaId) continue;
      const idea = (await ctx.db.get(
        placement.ideaId as Id<"ideas">
      )) as Doc<"ideas"> | null;
      if (!idea) continue;
      if (!(BUYER_SOURCES as readonly string[]).includes(idea.sourceKind ?? "")) {
        continue;
      }
      try {
        const evidence = idea.evidenceJson
          ? (JSON.parse(idea.evidenceJson) as { sourceUrls?: unknown })
          : {};
        const urls = Array.isArray(evidence.sourceUrls) ? evidence.sourceUrls : [];
        if (typeof urls[0] === "string" && urls[0]) traceable += 1;
      } catch {
        /* untraced */
      }
    }

    return {
      customers,
      posts: placements.length,
      traceable,
      share: placements.length === 0 ? null : traceable / placements.length,
    };
  },
});
