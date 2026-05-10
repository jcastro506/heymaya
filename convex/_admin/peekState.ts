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

export const fullDump = internalQuery({
  args: {},
  handler: async (ctx) => {
    const creators = await ctx.db.query("creators").collect();
    const test = creators.filter((c) =>
      c.clerkUserId.startsWith("test_real_world_kevin_")
    );
    if (test.length === 0) return { error: "no test creator" };
    const me = test[test.length - 1];
    const picture = await ctx.db
      .query("creatorPicture")
      .withIndex("by_creator", (q) => q.eq("creatorId", me._id))
      .first();
    const calendar = await ctx.db
      .query("creatorMayaV0CalendarConnections")
      .withIndex("by_creator", (q) => q.eq("creatorId", me._id))
      .collect();
    const connectedAccounts = await ctx.db
      .query("connectedAccounts")
      .withIndex("by_creator", (q) => q.eq("creatorId", me._id))
      .collect();
    const handles = await ctx.db
      .query("creatorHandles")
      .withIndex("by_creator", (q) => q.eq("creatorId", me._id))
      .collect();
    const aiCalls = await ctx.db
      .query("aiCallLog")
      .withIndex("by_creator_and_ts", (q) => q.eq("creatorId", me._id))
      .order("desc")
      .take(10);
    const trendObservations = await ctx.db
      .query("trendObservations")
      .withIndex("by_creator", (q) => q.eq("creatorId", me._id))
      .collect();
    const oauthTokens = await ctx.db
      .query("oauthStateTokens")
      .withIndex("by_creator", (q) => q.eq("creatorId", me._id))
      .collect();
    return {
      creator: {
        _id: me._id,
        clerkUserId: me.clerkUserId,
        plan: me.plan,
        status: me.status,
        firstBootCompletedAt: me.firstBootCompletedAt ?? null,
        openingAnswersAt: me.openingAnswersAt ?? null,
        pictureLockedAt: me.pictureLockedAt ?? null,
        firstWeeklyPlanSentAt: me.firstWeeklyPlanSentAt ?? null,
      },
      handles: handles.map((h) => ({
        platform: h.platform,
        handle: h.handle,
        followerCount: h.followerCount,
      })),
      picture: picture
        ? {
            niche: picture.niche,
            audience: picture.audience,
            voiceFingerprint: picture.voiceFingerprint,
            topHooks: picture.topHooks?.length ?? 0,
            bottomHooks: picture.bottomHooks?.length ?? 0,
            postingCadence: picture.postingCadence,
            sourceCitations: picture.sourceCitations?.length ?? 0,
            careerStage: (picture as unknown as { careerStage?: string }).careerStage,
            growthPlan: (picture as unknown as { growthPlan?: unknown }).growthPlan
              ? "present"
              : "missing",
            needsVerification: (picture as unknown as { needsVerification?: unknown[] }).needsVerification?.length ?? 0,
            openingAnswers: (picture as unknown as { openingAnswers?: unknown }).openingAnswers ?? null,
            voiceAndPersonality: (picture as unknown as { voiceAndPersonality?: unknown }).voiceAndPersonality ?? null,
            visualStyle: (picture as unknown as { visualStyle?: unknown }).visualStyle ?? null,
            recurringElements: (picture as unknown as { recurringElements?: unknown[] }).recurringElements ?? [],
            warmthMaterial: (picture as unknown as { warmthMaterial?: unknown[] }).warmthMaterial ?? [],
            model: picture.model,
            generatedAt: picture.generatedAt,
          }
        : null,
      calendarConnections: calendar.map((c) => ({
        externalAccountId: (c as unknown as { externalAccountId?: string }).externalAccountId ?? null,
        scope: (c as unknown as { oauthScope?: string }).oauthScope ?? null,
        hasAccessToken: Boolean((c as unknown as { oauthAccessToken?: string }).oauthAccessToken),
        hasRefreshToken: Boolean((c as unknown as { oauthRefreshToken?: string }).oauthRefreshToken),
        expiresAt: (c as unknown as { oauthExpiresAt?: number }).oauthExpiresAt ?? null,
        connectedAt: (c as unknown as { connectedAt?: number }).connectedAt ?? null,
      })),
      connectedAccounts: connectedAccounts.map((a) => ({
        provider: a.provider,
        scopeStatus: a.scopeStatus,
        scopes: a.scopes?.length ?? 0,
        connectedAt: a.connectedAt,
      })),
      aiCallsCount: aiCalls.length,
      latestAiCalls: aiCalls.slice(0, 3).map((c) => ({
        taskTag: (c as unknown as { taskTag?: string }).taskTag,
        model: (c as unknown as { model?: string }).model,
        inputTokens: (c as unknown as { inputTokens?: number }).inputTokens,
        outputTokens: (c as unknown as { outputTokens?: number }).outputTokens,
        costUsd: (c as unknown as { costUsd?: number }).costUsd,
        ts: (c as unknown as { ts?: number }).ts,
      })),
      trendObservationsCount: trendObservations.length,
      oauthStateTokensActive: oauthTokens.length,
    };
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

export const peekPostDates = internalQuery({
  args: {},
  handler: async (ctx) => {
    const creators = await ctx.db.query("creators").collect();
    const test = creators.filter((c) => c.clerkUserId.startsWith("test_real_world_kevin_"));
    if (test.length === 0) return { error: "no test creator" };
    const me = test[test.length - 1];
    const cache = await ctx.db.query("scrapeCreatorsCache").collect();
    const myCache = cache.filter((row) => row.creatorId === me._id);
    const out: Array<{ id?: unknown; dateIso?: string; playCount?: unknown; desc?: string }> = [];
    for (const row of myCache) {
      const payload = row.payload as Record<string, unknown>;
      if (!payload) continue;
      const isIndexedObject =
        typeof payload === "object" && Object.keys(payload).every((k) => /^\d+$/.test(k));
      const indexedAsArray = isIndexedObject
        ? Object.keys(payload).sort((a, b) => Number(a) - Number(b)).map((k) => (payload as Record<string, unknown>)[k])
        : undefined;
      const posts = (indexedAsArray ??
        (payload?.posts as unknown[]) ??
        (payload?.aweme_list as unknown[]) ??
        (payload?.itemList as unknown[]) ??
        []) as Array<Record<string, unknown>>;
      if (!Array.isArray(posts)) continue;
      for (const post of posts) {
        const id = post?.aweme_id ?? post?.id ?? (post?.video as Record<string, unknown> | undefined)?.id;
        const ct =
          (post?.create_time as number | undefined) ??
          (post?.createTime as number | undefined) ??
          (post?.created_at as number | undefined);
        const dateIso = typeof ct === "number" ? new Date(ct * 1000).toISOString().slice(0, 10) : undefined;
        const stats = post?.statistics as Record<string, unknown> | undefined;
        const playCount = stats?.play_count;
        const desc = (post?.desc as string | undefined) ?? (post?.caption as string | undefined) ?? "";
        out.push({ id, dateIso, playCount, desc: desc.slice(0, 80) });
      }
    }
    return { creatorId: me._id, postCount: out.length, posts: out.slice(0, 15) };
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
