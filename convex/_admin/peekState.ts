/**
 * Sprint 9.7+ — one-shot inspector for the live-test creator's state.
 * Verifies whether opening answers were captured + whether synth ran +
 * picture has needsVerification.
 */
import { internalQuery } from "../_generated/server";

export const listAll = internalQuery({
  args: {},
  handler: async (ctx) => {
    const creators = await ctx.db.query("creators").collect();
    return creators.map((c) => ({
      _id: c._id,
      clerkUserId: c.clerkUserId,
      email: c.email,
      channelPreference: c.channelPreference,
      status: c.status,
      firstBootCompletedAt: c.firstBootCompletedAt ?? null,
      openingAnswersAt: c.openingAnswersAt ?? null,
    }));
  },
});

export const peekVideoUrls = internalQuery({
  args: {},
  handler: async (ctx) => {
    const creators = await ctx.db.query("creators").collect();
    const test = creators.filter((c) =>
      c.clerkUserId.startsWith("test_real_world_kevin_")
    );
    if (test.length === 0) return { error: "no test creator" };
    const me = test[test.length - 1];
    const cache = await ctx.db.query("scrapeCreatorsCache").collect();
    const myCache = cache.filter((row) => row.creatorId === me._id);
    const summary: Array<{
      cacheKey: string;
      payloadKeys: string[];
      postCount: number;
      firstPost?: unknown;
    }> = [];
    for (const row of myCache) {
      const payload = row.payload as Record<string, unknown>;
      const payloadKeys = Object.keys(payload ?? {});
      // The cache payload for posts endpoint may be a top-level array (keyed
      // 0,1,2,...). Reconstitute as an array.
      const isIndexedObject =
        payload &&
        typeof payload === "object" &&
        Object.keys(payload).every((k) => /^\d+$/.test(k));
      const indexedAsArray = isIndexedObject
        ? Object.keys(payload)
            .sort((a, b) => Number(a) - Number(b))
            .map((k) => (payload as Record<string, unknown>)[k] as Record<string, unknown>)
        : undefined;
      const posts =
        indexedAsArray ??
        (payload?.posts as Array<Record<string, unknown>> | undefined) ??
        (payload?.aweme_list as Array<Record<string, unknown>> | undefined) ??
        (payload?.itemList as Array<Record<string, unknown>> | undefined) ??
        [];
      const first = Array.isArray(posts) && posts.length > 0 ? posts[0] : undefined;
      // Extract TikTok play URL from raw aweme_detail shape.
      const firstAweme = first as Record<string, unknown> | undefined;
      const video = firstAweme?.video as Record<string, unknown> | undefined;
      const playAddr = video?.play_addr as Record<string, unknown> | undefined;
      const urlList = playAddr?.url_list as string[] | undefined;
      const downloadAddr = video?.download_addr as Record<string, unknown> | undefined;
      const downloadUrl = (downloadAddr?.url_list as string[] | undefined)?.[0];
      summary.push({
        cacheKey: row.cacheKey,
        payloadKeys,
        postCount: Array.isArray(posts) ? posts.length : 0,
        firstPost: first
          ? {
              awemeId: firstAweme?.aweme_id,
              playUrlSample: urlList?.[0]?.slice(0, 300),
              downloadUrlSample: downloadUrl?.slice(0, 300),
              videoFieldKeys: video ? Object.keys(video).slice(0, 20) : undefined,
            }
          : undefined,
      });
    }
    return { creatorId: me._id, cacheRowCount: myCache.length, summary };
  },
});

export const recentActions = internalQuery({
  args: {},
  handler: async (ctx) => {
    const creators = await ctx.db.query("creators").collect();
    const test = creators.filter((c) => c.clerkUserId.startsWith("test_real_world_kevin_"));
    if (test.length === 0) return { error: "no test creator" };
    const me = test[test.length - 1];
    const rows = await ctx.db
      .query("mayaActionLog")
      .withIndex("by_creator", (q) => q.eq("creatorId", me._id))
      .order("desc")
      .take(20);
    return rows.map((r) => ({
      _creationTime: r._creationTime,
      entryId: (r as unknown as { entryId?: string }).entryId ?? null,
      outcome: (r as unknown as { outcome?: string }).outcome ?? null,
      pushed: (r as unknown as { pushed?: boolean }).pushed ?? null,
      tickKind: (r as unknown as { tickKind?: string }).tickKind ?? null,
      summary: (r as unknown as { summary?: string }).summary ?? null,
    }));
  },
});

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
            // Sprint 10 — multimodal fields
            voiceAndPersonality: (picture as unknown as { voiceAndPersonality?: unknown }).voiceAndPersonality ?? null,
            visualStyle: (picture as unknown as { visualStyle?: unknown }).visualStyle ?? null,
            recurringElements: (picture as unknown as { recurringElements?: unknown[] }).recurringElements ?? [],
            warmthMaterial: (picture as unknown as { warmthMaterial?: unknown[] }).warmthMaterial ?? [],
          }
        : null,
    };
  },
});
