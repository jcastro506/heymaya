/**
 * Sprint 9.7+ — one-shot inspector for the live-test creator's state.
 * Verifies whether opening answers were captured + whether synth ran +
 * picture has needsVerification.
 */
import { internalQuery } from "../_generated/server";

export const peek = internalQuery({
  args: {},
  handler: async (ctx) => {
    const creators = await ctx.db.query("creators").collect();
    const test = creators.filter((c) => c.clerkUserId.startsWith("test_real_world_kevin_"));
    if (test.length === 0) return { error: "no test creator" };

    const me = test[test.length - 1]; // most recent
    const picture = await ctx.db
      .query("creatorPicture")
      .withIndex("by_creator", (q) => q.eq("creatorId", me._id))
      .first();

    return {
      creator: {
        _id: me._id,
        clerkUserId: me.clerkUserId,
        firstBootCompletedAt: me.firstBootCompletedAt ?? null,
        openingAnswersAt: me.openingAnswersAt ?? null,
        pictureLockedAt: me.pictureLockedAt ?? null,
        firstWeeklyPlanSentAt: me.firstWeeklyPlanSentAt ?? null,
      },
      picture: picture
        ? {
            niche: picture.niche,
            openingAnswers: (picture as unknown as { openingAnswers?: unknown }).openingAnswers ?? null,
            needsVerification: (picture as unknown as { needsVerification?: unknown[] }).needsVerification ?? null,
            sourceCitations: picture.sourceCitations?.length ?? 0,
            generatedAt: picture.generatedAt,
          }
        : null,
    };
  },
});
