import { v } from "convex/values";
import { mutation } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

const PLATFORM = v.union(
  v.literal("reddit"),
  v.literal("x"),
  v.literal("linkedin"),
  v.literal("tiktok")
);

export interface ResultInterpretation {
  signal: "strong" | "weak" | "inconclusive";
  summary: string;
  recommendation: "double_down" | "iterate" | "do_not_overfit";
}

export interface LearningLoopDecision extends ResultInterpretation {
  nextAction: string;
  contentBankOutcome: "winner" | "loser" | "inconclusive";
  memoryPromotionAllowed: boolean;
}

interface ResultTotals {
  replies: number;
  clicks: number;
  signups: number;
  demos: number;
  feedbackItems: number;
}

export const recordResultSnapshot = mutation({
  args: {
    draftId: v.id("gtmContentDrafts"),
    platform: PLATFORM,
    replies: v.optional(v.number()),
    clicks: v.optional(v.number()),
    signups: v.optional(v.number()),
    demos: v.optional(v.number()),
    feedbackItems: v.optional(v.number()),
    raw: v.optional(v.any()),
  },
  handler: async (ctx, args): Promise<Id<"gtmResultSnapshots">> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("signed-in user required");
    const creator = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first();
    if (!creator || creator.accountType !== "gtm-agent") {
      throw new Error("GTM account not found");
    }
    const draft = await ctx.db.get(args.draftId);
    if (!draft || draft.accountId !== creator._id) {
      throw new Error("draft does not belong to this account");
    }
    return await ctx.db.insert("gtmResultSnapshots", {
      accountId: creator._id,
      draftId: args.draftId,
      platform: args.platform,
      replies: args.replies,
      clicks: args.clicks,
      signups: args.signups,
      demos: args.demos,
      feedbackItems: args.feedbackItems,
      raw: args.raw,
      capturedAt: Date.now(),
    });
  },
});

export function interpretResults(
  snapshots: ReadonlyArray<
    Pick<
      Doc<"gtmResultSnapshots">,
      "replies" | "clicks" | "signups" | "demos" | "feedbackItems"
    >
  >
): ResultInterpretation {
  const totals = snapshots.reduce<ResultTotals>(
    (sum, row) => ({
      replies: sum.replies + (row.replies ?? 0),
      clicks: sum.clicks + (row.clicks ?? 0),
      signups: sum.signups + (row.signups ?? 0),
      demos: sum.demos + (row.demos ?? 0),
      feedbackItems: sum.feedbackItems + (row.feedbackItems ?? 0),
    }),
    { replies: 0, clicks: 0, signups: 0, demos: 0, feedbackItems: 0 }
  );
  const customerMovement =
    totals.signups + totals.demos * 2 + totals.feedbackItems + totals.replies * 0.25;

  if (customerMovement >= 3) {
    return {
      signal: "strong",
      summary: `Strong signal: ${totals.signups} signups, ${totals.demos} demos, ${totals.feedbackItems} feedback items, ${totals.replies} replies.`,
      recommendation: "double_down",
    };
  }
  if (snapshots.length < 3 || customerMovement < 1) {
    return {
      signal: "inconclusive",
      summary: "Not enough customer movement yet. Do not overfit this result.",
      recommendation: "do_not_overfit",
    };
  }
  return {
    signal: "weak",
    summary: `Weak signal: some engagement, but not enough customer movement to double down.`,
    recommendation: "iterate",
  };
}

export function decideLearningLoop(
  snapshots: Parameters<typeof interpretResults>[0]
): LearningLoopDecision {
  const interpretation = interpretResults(snapshots);
  if (interpretation.recommendation === "double_down") {
    return {
      ...interpretation,
      nextAction:
        "Promote the format as a provisional winner, reuse the same demo moment, and run the next variant with one changed hook.",
      contentBankOutcome: "winner",
      memoryPromotionAllowed: true,
    };
  }
  if (interpretation.recommendation === "iterate") {
    return {
      ...interpretation,
      nextAction:
        "Revise the hook or audience angle, keep the channel active, and require another result snapshot before changing strategy.",
      contentBankOutcome: "inconclusive",
      memoryPromotionAllowed: false,
    };
  }
  return {
    ...interpretation,
    nextAction:
      "Collect more samples before changing strategy. Do not promote this format or update memory from vanity metrics alone.",
    contentBankOutcome: "inconclusive",
    memoryPromotionAllowed: false,
  };
}
