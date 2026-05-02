import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import {
  buildCalendarHold,
  calendarHoldIdempotencyKey,
} from "./calendarScheduling";
import {
  normalizeCalendarLookaheadEvents,
  type CalendarEventClassification,
  type CalendarLookaheadEventInput,
  type CalendarProviderMode,
} from "./calendarLookahead";
import {
  buildMorningBrief,
  type BriefCitation,
  type PlanIdea,
} from "./dailyBrief";
import {
  applyCreatorReadbackCorrections,
  buildCreatorReadback,
} from "./onboardingIntake";
import {
  nextOnboardingStep,
  onboardingProgressPercent,
  type CreatorMayaOnboardingState,
} from "./onboardingFlow";
import {
  evaluateOpenClawDeployGate,
  type OpenClawDeployMode,
} from "./openClawDeployGate";
import {
  canSendBrandOutreach,
  scoreBrandFit,
} from "./brandOutreach";
import {
  brandAutonomyAllowed,
  creatorMayaTierFeatures,
  type CreatorMayaTier,
} from "./tiering";
import {
  selectOnboardingVideoSamples,
  type TikTokPostCandidate,
} from "./videoSampling";
import { buildCreatorMayaWorkspaceManifest } from "./workspaceManifest";
import { listEvents } from "../integrations/composio/actions/calendar";
import { decrypt, encrypt } from "../lib/encryption";
import type {
  NormalizedPost,
  NormalizedProfile,
} from "../integrations/scrapeCreators/endpoints";

type LatestByCreatorTable =
  | "creatorMayaV0Onboarding"
  | "creatorMayaV0TiktokAccounts"
  | "creatorMayaV0CalendarConnections"
  | "creatorMayaV0Intake"
  | "creatorMayaV0CreatorPictures";

type DeletableByCreatorTable =
  | LatestByCreatorTable
  | "creatorMayaV0TiktokPosts"
  | "creatorMayaV0CalendarEvents";

type TikTokConnectionResult = {
  onboarding: Doc<"creatorMayaV0Onboarding">;
  postCount: number;
  selectedPostIds: string[];
  diagnostics: ReturnType<typeof selectOnboardingVideoSamples>["diagnostics"];
};

type ScrapeCreatorsPullResult = {
  platforms: Array<{
    platform: string;
    profile: NormalizedProfile | null;
    posts: NormalizedPost[];
  }>;
};

type CalendarConnectionImportResult = {
  onboarding: Omit<CreatorMayaOnboardingState, "signedUp"> & {
    creatorId: Id<"creators">;
    currentStep: string;
    progressPercent: number;
    updatedAt: number;
  };
  providerMode: "google_api";
  lookaheadImported: number;
  contentArcCount: number;
};

type GoogleTokenResponse = {
  access_token: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
};

const creatorStageValidator = v.union(
  v.literal("just_starting"),
  v.literal("growing_consistently"),
  v.literal("monetizing"),
  v.literal("trying_full_time"),
  v.literal("already_full_time")
);

const toneValidator = v.union(
  v.literal("supportive"),
  v.literal("strategic"),
  v.literal("tough_love")
);

const tierValidator = v.union(
  v.literal("starter"),
  v.literal("pro"),
  v.literal("studio")
);

const tiktokPostInputValidator = v.object({
  id: v.string(),
  caption: v.string(),
  createdAt: v.number(),
  durationSec: v.optional(v.number()),
  hasVideo: v.boolean(),
  thumbnailUrl: v.optional(v.string()),
  videoUrl: v.optional(v.string()),
  formatKey: v.optional(v.string()),
  metrics: v.object({
    views: v.optional(v.number()),
    likes: v.optional(v.number()),
    comments: v.optional(v.number()),
    shares: v.optional(v.number()),
  }),
});

const availabilityWindowValidator = v.object({
  startMs: v.number(),
  endMs: v.number(),
});

const calendarLookaheadEventValidator = v.object({
  providerEventId: v.string(),
  title: v.string(),
  description: v.optional(v.string()),
  startMs: v.number(),
  endMs: v.number(),
  location: v.optional(v.string()),
  recurring: v.optional(v.boolean()),
});

const calendarProviderModeValidator = v.union(
  v.literal("google_api"),
  v.literal("apple_phone_api"),
  v.literal("mock")
);

export const getOrCreateAccount = mutation({
  args: {
    email: v.string(),
    timezone: v.string(),
    tier: v.optional(tierValidator),
  },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const existing = await creatorByIdentity(ctx, identity.subject);
    const now = Date.now();
    const creatorId =
      existing?._id ??
      (await ctx.db.insert("creators", {
        clerkUserId: identity.subject,
        email: args.email,
        channelPreference: "imessage",
        timezone: args.timezone,
        status: "onboarding",
        plan: args.tier ?? "starter",
        accountType: "creator",
        createdAt: now,
      }));

    if (existing) {
      await ctx.db.patch(existing._id, {
        email: args.email,
        timezone: args.timezone,
        channelPreference: "imessage",
        plan: args.tier ?? existing.plan,
        accountType: "creator",
      });
    }

    const onboarding = await patchOnboarding(ctx, creatorId, {});
    return { creatorId, onboarding };
  },
});

export const connectTikTokMock = mutation({
  args: {
    handle: v.string(),
    displayName: v.string(),
    followerCount: v.number(),
    bio: v.string(),
    avatarUrl: v.optional(v.string()),
    posts: v.optional(v.array(tiktokPostInputValidator)),
  },
  handler: async (ctx, args) => {
    const creator = await requireCurrentCreator(ctx);
    const now = Date.now();

    await deleteByCreator(ctx, "creatorMayaV0TiktokAccounts", creator._id);
    await deleteByCreator(ctx, "creatorMayaV0TiktokPosts", creator._id);

    await ctx.db.insert("creatorMayaV0TiktokAccounts", {
      creatorId: creator._id,
      handle: args.handle,
      displayName: args.displayName,
      followerCount: args.followerCount,
      bio: args.bio,
      avatarUrl: args.avatarUrl,
      verifiedAt: now,
    });

    const inputPosts = args.posts ?? mockTikTokPosts(now);
    const candidates: TikTokPostCandidate[] = inputPosts.map((post) => ({
      id: post.id,
      createdAt: post.createdAt,
      durationSec: post.durationSec ?? null,
      hasVideo: post.hasVideo,
      caption: post.caption,
      formatKey: post.formatKey,
      metrics: {
        views: post.metrics.views ?? null,
        likes: post.metrics.likes ?? null,
        comments: post.metrics.comments ?? null,
        shares: post.metrics.shares ?? null,
      },
    }));
    const sampleResult = selectOnboardingVideoSamples(candidates);
    const selected = new Map(
      sampleResult.selected.map((sample) => [sample.post.id, sample])
    );

    for (const post of inputPosts) {
      const sample = selected.get(post.id);
      await ctx.db.insert("creatorMayaV0TiktokPosts", {
        creatorId: creator._id,
        tiktokPostId: post.id,
        caption: post.caption,
        thumbnailUrl: post.thumbnailUrl,
        videoUrl: post.videoUrl,
        durationSec: post.durationSec,
        publishedAt: post.createdAt,
        viewCount: post.metrics.views ?? 0,
        likeCount: post.metrics.likes ?? 0,
        commentCount: post.metrics.comments ?? 0,
        shareCount: post.metrics.shares ?? 0,
        formatKey: post.formatKey,
        selectedForAnalysis: Boolean(sample),
        watchMode: sample?.watchMode,
        sampleReasons: sample ? [...sample.reasons] : undefined,
        createdAt: now,
      });
    }

    const onboarding = await patchOnboarding(ctx, creator._id, {
      tiktokConnected: true,
      metadataPulled: true,
      videoSamplesAnalyzed: true,
    });

    return {
      onboarding,
      postCount: inputPosts.length,
      selectedPostIds: sampleResult.selected.map((sample) => sample.post.id),
      diagnostics: sampleResult.diagnostics,
    };
  },
});

export const connectTikTokWithScrapeCreators = action({
  args: {
    handle: v.string(),
  },
  handler: async (ctx, args): Promise<TikTokConnectionResult> => {
    const creator = await requireCurrentCreatorForAction(ctx);
    const result = (await ctx.runAction(
      internal.integrations.scrapeCreators.runFullScrapePull.runFullScrapePull,
      {
        creatorId: creator._id,
        handles: [{ platform: "tiktok", handle: args.handle }],
      }
    )) as ScrapeCreatorsPullResult;
    const tiktok = result.platforms.find(
      (platform: ScrapeCreatorsPullResult["platforms"][number]) =>
        platform.platform === "tiktok"
    );
    if (!tiktok?.profile) {
      throw new Error(
        `connectTikTokWithScrapeCreators: TikTok profile unavailable for @${args.handle}.`
      );
    }

    return (await ctx.runMutation(
      internal.creatorMayaV0.backend.storeTikTokPullForCreator,
      {
        creatorId: creator._id,
        profile: tiktok.profile,
        posts: tiktok.posts,
      }
    )) as TikTokConnectionResult;
  },
});

export const connectCalendarMock = mutation({
  args: {
    provider: v.optional(v.union(v.literal("google"), v.literal("apple"), v.literal("mock"))),
    timezone: v.string(),
    availabilityWindows: v.array(availabilityWindowValidator),
    canCreateHolds: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const creator = await requireCurrentCreator(ctx);
    const now = Date.now();
    const provider = args.provider ?? "mock";

    await deleteByCreator(ctx, "creatorMayaV0CalendarConnections", creator._id);

    await ctx.db.insert("creatorMayaV0CalendarConnections", {
      creatorId: creator._id,
      provider,
      timezone: args.timezone,
      scopes: ["free_busy", "create_maya_holds"],
      canCreateHolds: args.canCreateHolds ?? true,
      connectedAt: now,
      status: "active",
    });

    for (const window of args.availabilityWindows) {
      await ctx.db.insert("creatorMayaV0CalendarEvents", {
        creatorId: creator._id,
        providerEventId: `availability:${window.startMs}:${window.endMs}`,
        title: "Available for content",
        startMs: window.startMs,
        endMs: window.endMs,
        createdBy: "external",
        source: "availability",
        createdAt: now,
      });
    }

    const onboarding = await patchOnboarding(ctx, creator._id, {
      calendarConnected: true,
    });
    return { onboarding };
  },
});

export const connectCalendarProvider = mutation({
  args: {
    provider: v.union(v.literal("google"), v.literal("apple")),
    providerMode: calendarProviderModeValidator,
    timezone: v.string(),
    externalAccountId: v.optional(v.string()),
    lookaheadDays: v.optional(v.number()),
    canCreateHolds: v.optional(v.boolean()),
    availabilityWindows: v.optional(v.array(availabilityWindowValidator)),
    lookaheadEvents: v.optional(v.array(calendarLookaheadEventValidator)),
  },
  handler: async (ctx, args) => {
    const creator = await requireCurrentCreator(ctx);
    const now = Date.now();
    assertProviderModeMatchesProvider(args.provider, args.providerMode);

    await deleteByCreator(ctx, "creatorMayaV0CalendarConnections", creator._id);

    await ctx.db.insert("creatorMayaV0CalendarConnections", {
      creatorId: creator._id,
      provider: args.provider,
      providerMode: args.providerMode,
      externalAccountId: args.externalAccountId,
      timezone: args.timezone,
      scopes: calendarScopesForMode(args.providerMode),
      canCreateHolds: args.canCreateHolds ?? true,
      connectedAt: now,
      lastSyncedAt: args.lookaheadEvents ? now : undefined,
      lookaheadDays: args.lookaheadDays ?? 14,
      status: "active",
    });

    for (const window of args.availabilityWindows ?? []) {
      await ctx.db.insert("creatorMayaV0CalendarEvents", {
        creatorId: creator._id,
        providerEventId: `availability:${window.startMs}:${window.endMs}`,
        title: "Available for content",
        startMs: window.startMs,
        endMs: window.endMs,
        createdBy: "external",
        source: "availability",
        createdAt: now,
      });
    }

    const normalized = normalizeCalendarLookaheadEvents(
      args.lookaheadEvents ?? []
    );
    await storeCalendarEvents(ctx, creator._id, normalized, now);

    const onboarding = await patchOnboarding(ctx, creator._id, {
      calendarConnected: true,
    });
    return {
      onboarding,
      providerMode: args.providerMode,
      lookaheadImported: normalized.length,
      contentArcCount: normalized.reduce(
        (sum, event) => sum + event.contentArc.length,
        0
      ),
    };
  },
});

export const disconnectCalendarProvider = mutation({
  args: {},
  handler: async (ctx) => {
    const creator = await requireCurrentCreator(ctx);
    await deleteByCreator(ctx, "creatorMayaV0CalendarConnections", creator._id);
    await deleteByCreator(ctx, "creatorMayaV0CalendarEvents", creator._id);
    const onboarding = await patchOnboarding(ctx, creator._id, {
      calendarConnected: false,
    });
    return { onboarding, disconnected: true };
  },
});

export const syncGoogleCalendarLookahead = action({
  args: {
    timeMin: v.string(),
    timeMax: v.string(),
    calendarId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const creator = await requireCurrentCreatorForAction(ctx);
    const connection = await ctx.runQuery(
      internal.creatorMayaV0.backend.latestCalendarConnectionForCreator,
      { creatorId: creator._id }
    );
    if (!connection || connection.status !== "active") {
      throw new Error("syncGoogleCalendarLookahead: active calendar required.");
    }
    if (connection.providerMode !== "google_api") {
      throw new Error(
        "syncGoogleCalendarLookahead: Google API calendar connection required."
      );
    }

    let response: { items: Array<Parameters<typeof calendarEventToLookaheadInput>[0]> };
    if (connection.oauthAccessToken) {
      response = await listGoogleCalendarEventsWithStoredToken(ctx, connection, {
        timeMin: args.timeMin,
        timeMax: args.timeMax,
        calendarId: args.calendarId ?? "primary",
      });
    } else {
      const connectedAccountId =
        connection.externalAccountId ??
        (await decryptLatestCalendarAccountForCreator(ctx, creator._id));
      if (!connectedAccountId) {
        throw new Error(
          "syncGoogleCalendarLookahead: Google OAuth connected account required."
        );
      }
      response = await listEvents(
        { connectedAccountId },
        {
          timeMin: args.timeMin,
          timeMax: args.timeMax,
          calendarId: args.calendarId ?? "primary",
          singleEvents: true,
          orderBy: "startTime",
          maxResults: 100,
        }
      );
    }

    const lookaheadEvents: CalendarLookaheadEventInput[] = response.items
      .map(calendarEventToLookaheadInput)
      .filter((event): event is CalendarLookaheadEventInput => event !== null);

    const normalized = normalizeCalendarLookaheadEvents(lookaheadEvents);
    await ctx.runMutation(
      internal.creatorMayaV0.backend.storeCalendarLookaheadForCreator,
      {
        creatorId: creator._id,
        events: normalized,
      }
    );

    return {
      imported: normalized.length,
      contentArcCount: normalized.reduce(
        (sum, event) => sum + event.contentArc.length,
        0
      ),
    };
  },
});

export const connectGoogleCalendarFromOAuth = action({
  args: {
    timeMin: v.string(),
    timeMax: v.string(),
    timezone: v.string(),
    calendarId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<CalendarConnectionImportResult> => {
    const creator = await requireCurrentCreatorForAction(ctx);
    const connectedAccount = (await ctx.runQuery(
      internal.creatorMayaV0.backend.latestConnectedCalendarAccountForCreator,
      { creatorId: creator._id }
    )) as Doc<"connectedAccounts"> | null;
    if (!connectedAccount || connectedAccount.scopeStatus !== "active") {
      throw new Error(
        "connectGoogleCalendarFromOAuth: active Google Calendar OAuth account required."
      );
    }

    const connectedAccountId = await decrypt(connectedAccount.composioAccountId);
    const response = await listEvents(
      { connectedAccountId },
      {
        timeMin: args.timeMin,
        timeMax: args.timeMax,
        calendarId: args.calendarId ?? "primary",
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 100,
      }
    );
    const normalized = normalizeCalendarLookaheadEvents(
      response.items
        .map(calendarEventToLookaheadInput)
        .filter((event): event is CalendarLookaheadEventInput => event !== null)
    );

    return (await ctx.runMutation(
      internal.creatorMayaV0.backend.storeGoogleCalendarConnectionForCreator,
      {
        creatorId: creator._id,
        timezone: args.timezone,
        scopes: connectedAccount.scopes,
        events: normalized,
      }
    )) as CalendarConnectionImportResult;
  },
});

export const storeGoogleCalendarOAuthConnection = mutation({
  args: {
    timezone: v.string(),
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    tokenType: v.optional(v.string()),
    scope: v.optional(v.string()),
    externalAccountId: v.optional(v.string()),
    lookaheadEvents: v.array(calendarLookaheadEventValidator),
  },
  handler: async (ctx, args): Promise<CalendarConnectionImportResult> => {
    const creator = await requireCurrentCreator(ctx);
    const accessToken = await encrypt(args.accessToken);
    const refreshToken = args.refreshToken
      ? await encrypt(args.refreshToken)
      : undefined;
    const normalized = normalizeCalendarLookaheadEvents(args.lookaheadEvents);

    return await storeDirectGoogleCalendarConnection(ctx, {
      creatorId: creator._id,
      timezone: args.timezone,
      scopes: googleCalendarScopesFromOAuthScope(args.scope),
      encryptedAccessToken: accessToken,
      encryptedRefreshToken: refreshToken,
      expiresAt: args.expiresAt,
      tokenType: args.tokenType,
      oauthScope: args.scope,
      externalAccountId: args.externalAccountId,
      events: normalized,
    });
  },
});

export const submitIntake = mutation({
  args: {
    ninetyDayGoal: v.string(),
    creatorStage: creatorStageValidator,
    biggestBlocker: v.string(),
    weeklyHoursAvailable: v.number(),
    tone: toneValidator,
    doNotSuggest: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const creator = await requireCurrentCreator(ctx);
    const now = Date.now();
    const inferredSignals = await inferCreatorSignals(ctx, creator._id);
    const readback = buildCreatorReadback(inferredSignals, args);

    await deleteByCreator(ctx, "creatorMayaV0Intake", creator._id);
    await ctx.db.insert("creatorMayaV0Intake", {
      creatorId: creator._id,
      answers: args,
      inferredSignals,
      readback,
      createdAt: now,
      updatedAt: now,
    });

    const onboarding = await patchOnboarding(ctx, creator._id, {
      interviewComplete: true,
    });
    return { onboarding, readback };
  },
});

export const confirmReadback = mutation({
  args: {
    corrections: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const creator = await requireCurrentCreator(ctx);
    const now = Date.now();
    const intake = await latestByCreator(ctx, "creatorMayaV0Intake", creator._id);
    if (!intake) throw new Error("confirmReadback: intake required.");

    const corrected = applyCreatorReadbackCorrections(
      intake.readback,
      args.corrections ?? {}
    );
    await ctx.db.patch(intake._id, {
      correctedReadback: corrected,
      updatedAt: now,
    });

    await deleteByCreator(ctx, "creatorMayaV0CreatorPictures", creator._id);
    await ctx.db.insert("creatorMayaV0CreatorPictures", {
      creatorId: creator._id,
      stage: corrected.stage,
      goal: corrected.goal,
      niche: corrected.niche,
      audience: corrected.audience,
      voiceFingerprint: `${corrected.tone} and creator-specific`,
      contentPillars: [corrected.niche, "calendar-aware content", corrected.goal],
      workingHooks: [corrected.planBias],
      weakHooks: [`Avoid: ${corrected.blocker}`],
      scheduleConstraints: [corrected.currentReality],
      doNotSuggest: [...corrected.doNotSuggest],
      confidence: 0.72,
      sourceCitations: [
        { sourceType: "creator_post", sourceId: "metadata_pool", summary: "TikTok metadata pull" },
        { sourceType: "calendar", sourceId: "availability", summary: "Connected calendar availability" },
      ],
      generatedAt: now,
    });

    const onboarding = await patchOnboarding(ctx, creator._id, {
      readbackConfirmed: true,
      creatorPictureReady: true,
    });
    return { onboarding, creatorPictureReady: true };
  },
});

export const pairImessage = mutation({
  args: {
    phoneNumber: v.string(),
  },
  handler: async (ctx, args) => {
    const creator = await requireCurrentCreator(ctx);
    await ctx.db.patch(creator._id, {
      phoneNumber: args.phoneNumber,
      channelPreference: "imessage",
    });
    const onboarding = await patchOnboarding(ctx, creator._id, {
      imessagePaired: true,
    });
    return { onboarding };
  },
});

export const collectPhoneForNativePairing = mutation({
  args: {
    phoneNumber: v.string(),
  },
  handler: async (ctx, args) => {
    const creator = await requireCurrentCreator(ctx);
    await ctx.db.patch(creator._id, {
      phoneNumber: args.phoneNumber,
      channelPreference: "imessage",
    });
    return { phoneNumber: args.phoneNumber, channelPreference: "imessage" };
  },
});

export const recordLiveOpenClawDeployment = mutation({
  args: {
    mode: v.union(v.literal("live_test"), v.literal("production")),
    flyAppId: v.string(),
    machineId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const creator = await requireCurrentCreator(ctx);
    const now = Date.now();
    await ctx.db.patch(creator._id, {
      mayaFlyAppId: args.flyAppId,
    });
    await ctx.db.insert("creatorMayaV0OpenClawDeployments", {
      creatorId: creator._id,
      mode: args.mode,
      status: "deployed",
      deployLabel: `${args.mode}:${args.flyAppId}`,
      flyAppId: args.flyAppId,
      machineId: args.machineId,
      createdAt: now,
    });
    const onboarding = await patchOnboarding(ctx, creator._id, {
      mayaDeployed: true,
    });
    return { onboarding, flyAppId: args.flyAppId };
  },
});

export const markImessagePairedFromNativeChannel = mutation({
  args: {},
  handler: async (ctx) => {
    const creator = await requireCurrentCreator(ctx);
    const row = await ctx.db
      .query("pairedChannels")
      .withIndex("by_creator_and_channel", (q) =>
        q.eq("creatorId", creator._id).eq("channel", "imessage")
      )
      .collect()
      .then((rows) =>
        rows
          .filter((candidate) => candidate.status === "active")
          .sort((a, b) => (b.pairedAt ?? 0) - (a.pairedAt ?? 0))[0]
      );
    if (!row) {
      throw new Error(
        "markImessagePairedFromNativeChannel: active OpenClaw iMessage pairing required."
      );
    }
    await ctx.db.patch(creator._id, {
      phoneNumber: row.phoneNumber,
      channelPreference: "imessage",
    });
    const onboarding = await patchOnboarding(ctx, creator._id, {
      imessagePaired: true,
    });
    return {
      onboarding,
      externalIdentifier: row.externalIdentifier,
      pairedAt: row.pairedAt,
    };
  },
});

export const deployOpenClaw = mutation({
  args: {
    mode: v.union(v.literal("mock"), v.literal("live_test"), v.literal("production")),
    hasFlyToken: v.optional(v.boolean()),
    allowPaidDeploy: v.optional(v.boolean()),
    allMockE2EGatesGreen: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const creator = await requireCurrentCreator(ctx);
    const onboarding = await getOnboardingState(ctx, creator._id);
    const picture = await latestByCreator(
      ctx,
      "creatorMayaV0CreatorPictures",
      creator._id
    );
    const tiktok = await latestByCreator(
      ctx,
      "creatorMayaV0TiktokAccounts",
      creator._id
    );

    const gate = evaluateOpenClawDeployGate({
      mode: args.mode as OpenClawDeployMode,
      creatorId: creator._id,
      workspaceManifestReady: Boolean(picture && tiktok),
      phoneNumberCollected: Boolean(creator.phoneNumber),
      calendarConnected: onboarding.calendarConnected,
      creatorPictureReady: onboarding.creatorPictureReady,
      hasFlyToken: args.hasFlyToken ?? Boolean(process.env.FLY_API_TOKEN),
      allowPaidDeploy: args.allowPaidDeploy ?? false,
      allMockE2EGatesGreen: args.allMockE2EGatesGreen ?? false,
    });

    const now = Date.now();
    if (!gate.ok) {
      await ctx.db.insert("creatorMayaV0OpenClawDeployments", {
        creatorId: creator._id,
        mode: args.mode,
        status: "blocked",
        blockers: [...gate.blockers],
        createdAt: now,
      });
      return { ok: false, blockers: gate.blockers };
    }

    if (!picture || !tiktok) throw new Error("deployOpenClaw: missing seed data.");

    const workspace = buildCreatorMayaWorkspaceManifest({
      creatorId: creator._id,
      timezone: creator.timezone,
      tiktokHandle: tiktok.handle,
      calendarConnected: onboarding.calendarConnected,
      imessagePaired: onboarding.imessagePaired,
      creatorPicture: {
        niche: picture.niche,
        stage: picture.stage,
        goal: picture.goal,
        voiceFingerprint: picture.voiceFingerprint,
        contentPillars: picture.contentPillars,
        workingHooks: picture.workingHooks,
        weakHooks: picture.weakHooks,
        scheduleConstraints: picture.scheduleConstraints,
      },
    });

    await ctx.db.insert("creatorMayaV0OpenClawDeployments", {
      creatorId: creator._id,
      mode: args.mode,
      status: "deployed",
      deployLabel: gate.deployLabel,
      workspaceFiles: workspace.files,
      createdAt: now,
    });

    await patchOnboarding(ctx, creator._id, { mayaDeployed: true });
    return { ok: true, deployLabel: gate.deployLabel };
  },
});

export const runMorningBrief = mutation({
  args: {
    nowMs: v.number(),
  },
  handler: async (ctx, args) => {
    const creator = await requireCurrentCreator(ctx);
    const picture = await latestByCreator(
      ctx,
      "creatorMayaV0CreatorPictures",
      creator._id
    );
    if (!picture) throw new Error("runMorningBrief: creator picture required.");

    const windows = await ctx.db
      .query("creatorMayaV0CalendarEvents")
      .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
      .collect();
    const availability = windows
      .filter((event) => event.source === "availability")
      .map((event) => ({ startMs: event.startMs, endMs: event.endMs }));

    const citations: BriefCitation[] = [
      {
        sourceType: "video_analysis",
        sourceId: "selected_samples",
        summary: "Selected TikTok samples and metadata shaped this recommendation.",
      },
    ];
    const planIdea: PlanIdea = {
      id: "idea_result_first",
      hook: picture.workingHooks[0] ?? "show the result before explaining",
      shotList: "Open on the result, then explain the setup.",
      caption: "Show the payoff first.",
      whyItFits: `This fits ${picture.niche} and the creator's current goal: ${picture.goal}.`,
      durationMin: Math.min(60, Math.max(30, picture.scheduleConstraints.length * 15)),
      citations,
    };

    const result = buildMorningBrief({
      creatorId: creator._id,
      timezone: creator.timezone,
      nowMs: args.nowMs,
      lastOutboundUnanswered: false,
      todaysAvailability: availability,
      activePlanIdeas: [planIdea],
      recentSignals: [
        {
          id: "creator_picture",
          summary: `Maya has enough TikTok and calendar context to recommend one ${picture.niche} post today.`,
          citations,
          urgency: "normal",
        },
      ],
    });

    const localDate = localDateFor(args.nowMs, creator.timezone);
    const now = Date.now();
    await ctx.db.insert("creatorMayaV0DailyBriefs", {
      creatorId: creator._id,
      localDate,
      shouldSend: result.shouldSend,
      message: result.shouldSend ? result.dailyBrief.message : undefined,
      noSendReason: result.shouldSend ? undefined : result.dailyBrief.noSendReason,
      proposedWorkStartMs: result.shouldSend
        ? result.dailyBrief.proposedWorkStartMs
        : undefined,
      proposedWorkEndMs: result.shouldSend
        ? result.dailyBrief.proposedWorkEndMs
        : undefined,
      citations: [...result.dailyBrief.citations],
      sentAt: result.shouldSend ? now : undefined,
      createdAt: now,
    });
    await ctx.db.insert("creatorMayaV0ActionLog", {
      creatorId: creator._id,
      action: result.actionLog.action,
      status: result.shouldSend ? "ok" : "skipped",
      reason: result.actionLog.reason,
      metadata: result.actionLog,
      createdAt: now,
    });

    return result;
  },
});

export const scheduleLatestBriefHold = mutation({
  args: {},
  handler: async (ctx) => {
    const creator = await requireCurrentCreator(ctx);
    const briefs = await ctx.db
      .query("creatorMayaV0DailyBriefs")
      .withIndex("by_creator_and_created", (q) => q.eq("creatorId", creator._id))
      .collect();
    const brief = briefs
      .filter((row) => row.shouldSend && row.proposedWorkStartMs && row.proposedWorkEndMs)
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!brief || !brief.proposedWorkStartMs || !brief.proposedWorkEndMs) {
      return { ok: false, reason: "no_schedulable_brief" };
    }

    const planItemId = `brief:${brief._id}`;
    const key = calendarHoldIdempotencyKey({
      creatorId: creator._id,
      planItemId,
      startMs: brief.proposedWorkStartMs,
      endMs: brief.proposedWorkEndMs,
    });
    const existing = await ctx.db
      .query("creatorMayaV0CalendarEvents")
      .withIndex("by_creator_and_idempotency", (q) =>
        q.eq("creatorId", creator._id).eq("idempotencyKey", key)
      )
      .first();
    if (existing) return { ok: true, eventId: existing._id, idempotent: true };

    const hold = buildCalendarHold({
      creatorId: creator._id,
      planItemId,
      title: "Film TikTok with Maya",
      description: brief.message ?? "Maya recommended content work block.",
      durationMin: Math.round(
        (brief.proposedWorkEndMs - brief.proposedWorkStartMs) / 60_000
      ),
      searchStartMs: brief.proposedWorkStartMs,
      searchEndMs: brief.proposedWorkEndMs,
      busyBlocks: [],
      approvedByCreator: true,
    });
    if (!hold.ok) return hold;

    const eventId = await ctx.db.insert("creatorMayaV0CalendarEvents", {
      creatorId: creator._id,
      providerEventId: `maya:${key}`,
      title: hold.hold.title,
      description: hold.hold.description,
      startMs: hold.hold.startMs,
      endMs: hold.hold.endMs,
      createdBy: "maya",
      mayaOwnerKey: hold.hold.mayaOwnerKey,
      idempotencyKey: hold.hold.idempotencyKey,
      source: "content_hold",
      createdAt: Date.now(),
    });
    return { ok: true, eventId, idempotent: false };
  },
});

export const queueBrandTarget = mutation({
  args: {
    brandName: v.string(),
    category: v.string(),
    contactProvenance: v.optional(v.string()),
    audienceFit: v.number(),
    contentFit: v.number(),
    timingFit: v.number(),
    valuesFit: v.number(),
    requestedAutonomyLevel: v.number(),
    creatorApproved: v.boolean(),
    suppressed: v.boolean(),
  },
  handler: async (ctx, args) => {
    const creator = await requireCurrentCreator(ctx);
    const tier = creator.plan as CreatorMayaTier;
    const requested = clampAutonomy(args.requestedAutonomyLevel);
    const fit = scoreBrandFit({
      brandId: `brand:${args.brandName}`,
      brandName: args.brandName,
      category: args.category,
      contactProvenance: args.contactProvenance ?? null,
      audienceFit: args.audienceFit,
      contentFit: args.contentFit,
      timingFit: args.timingFit,
      valuesFit: args.valuesFit,
    });

    const canSend = canSendBrandOutreach({
      tier,
      requestedAutonomyLevel: requested,
      creatorApproved: args.creatorApproved,
      contactHasProvenance: Boolean(args.contactProvenance),
      suppressed: args.suppressed,
    });

    const now = Date.now();
    const targetId = await ctx.db.insert("creatorMayaV0BrandTargets", {
      creatorId: creator._id,
      brandName: args.brandName,
      category: args.category,
      score: fit.score,
      reasons: [...fit.reasons],
      contactProvenance: args.contactProvenance,
      status: canSend ? "queued" : "researched",
      createdAt: now,
      updatedAt: now,
    });

    return {
      targetId,
      fit,
      canSend,
      autonomyAllowed: brandAutonomyAllowed(tier, requested),
      tierFeatures: creatorMayaTierFeatures(tier),
    };
  },
});

export const state = query({
  args: {},
  handler: async (ctx) => {
    const creator = await currentCreator(ctx);
    if (!creator) return null;
    const onboarding = await getOnboardingState(ctx, creator._id);
    const currentStep = nextOnboardingStep(onboarding);
    const tiktok = await latestByCreator(ctx, "creatorMayaV0TiktokAccounts", creator._id);
    const calendar = await latestByCreator(ctx, "creatorMayaV0CalendarConnections", creator._id);
    const picture = await latestByCreator(ctx, "creatorMayaV0CreatorPictures", creator._id);
    const deployments = await ctx.db
      .query("creatorMayaV0OpenClawDeployments")
      .withIndex("by_creator_and_created", (q) => q.eq("creatorId", creator._id))
      .collect();
    const calendarEvents = await ctx.db
      .query("creatorMayaV0CalendarEvents")
      .withIndex("by_creator_and_start", (q) => q.eq("creatorId", creator._id))
      .collect();
    const pairedChannels = await ctx.db
      .query("pairedChannels")
      .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
      .collect();
    return {
      creator,
      onboarding: {
        ...onboarding,
        currentStep,
        progressPercent: onboardingProgressPercent(onboarding),
      },
      tiktok,
      calendar,
      calendarEvents,
      pairedChannels,
      picture,
      latestDeployment: deployments.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null,
    };
  },
});

export const creatorForIdentity = internalQuery({
  args: { subject: v.string() },
  handler: async (ctx, args) => {
    return await creatorByIdentity(ctx, args.subject);
  },
});

export const latestCalendarConnectionForCreator = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, args) => {
    return await latestByCreator(
      ctx,
      "creatorMayaV0CalendarConnections",
      args.creatorId
    );
  },
});

export const latestConnectedCalendarAccountForCreator = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("connectedAccounts")
      .withIndex("by_creator_and_provider", (q) =>
        q.eq("creatorId", args.creatorId).eq("provider", "calendar")
      )
      .first();
  },
});

export const storeGoogleCalendarConnectionForCreator = internalMutation({
  args: {
    creatorId: v.id("creators"),
    timezone: v.string(),
    scopes: v.array(v.string()),
    events: v.array(v.any()),
  },
  handler: async (ctx, args) => {
    return await storeDirectGoogleCalendarConnection(ctx, {
      creatorId: args.creatorId,
      timezone: args.timezone,
      scopes: args.scopes,
      events: args.events as ReturnType<typeof normalizeCalendarLookaheadEvents>,
    });
  },
});

export const refreshGoogleCalendarAccessTokenForCreator = internalMutation({
  args: {
    connectionId: v.id("creatorMayaV0CalendarConnections"),
    encryptedAccessToken: v.string(),
    expiresAt: v.optional(v.number()),
    tokenType: v.optional(v.string()),
    scope: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.connectionId, {
      oauthAccessToken: args.encryptedAccessToken,
      oauthExpiresAt: args.expiresAt,
      oauthTokenType: args.tokenType,
      oauthScope: args.scope,
      lastSyncedAt: Date.now(),
    });
  },
});

export const storeCalendarLookaheadForCreator = internalMutation({
  args: {
    creatorId: v.id("creators"),
    events: v.array(v.any()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await storeCalendarEvents(
      ctx,
      args.creatorId,
      args.events as ReturnType<typeof normalizeCalendarLookaheadEvents>,
      now
    );
    const connection = await latestByCreator(
      ctx,
      "creatorMayaV0CalendarConnections",
      args.creatorId
    );
    if (connection) {
      await ctx.db.patch(connection._id, { lastSyncedAt: now });
    }
    return { imported: args.events.length };
  },
});

export const storeTikTokPullForCreator = internalMutation({
  args: {
    creatorId: v.id("creators"),
    profile: v.any(),
    posts: v.array(v.any()),
  },
  handler: async (ctx, args) => {
    const profile = args.profile as NormalizedProfile;
    const posts = args.posts as NormalizedPost[];
    const now = Date.now();

    await deleteByCreator(ctx, "creatorMayaV0TiktokAccounts", args.creatorId);
    await deleteByCreator(ctx, "creatorMayaV0TiktokPosts", args.creatorId);

    await ctx.db.insert("creatorMayaV0TiktokAccounts", {
      creatorId: args.creatorId,
      handle: profile.handle,
      displayName: profile.displayName ?? profile.handle,
      followerCount: profile.followerCount,
      bio: profile.bio ?? "",
      avatarUrl: profile.avatarUrl ?? undefined,
      verifiedAt: now,
    });

    const candidates: TikTokPostCandidate[] = posts.map((post) => ({
      id: post.postId,
      createdAt: post.postedAt ?? now,
      durationSec: post.videoDurationSec ?? null,
      hasVideo: post.mediaType === "video",
      caption: post.caption ?? "",
      metrics: {
        views: post.metrics.viewCount,
        likes: post.metrics.likeCount,
        comments: post.metrics.commentCount,
        shares: post.metrics.shareCount,
      },
    }));
    const sampleResult = selectOnboardingVideoSamples(candidates);
    const selected = new Map(
      sampleResult.selected.map((sample) => [sample.post.id, sample])
    );

    for (const post of posts) {
      const sample = selected.get(post.postId);
      await ctx.db.insert("creatorMayaV0TiktokPosts", {
        creatorId: args.creatorId,
        tiktokPostId: post.postId,
        caption: post.caption ?? "",
        thumbnailUrl: post.thumbnailUrl ?? undefined,
        videoUrl: post.videoUrl ?? undefined,
        durationSec: post.videoDurationSec ?? undefined,
        publishedAt: post.postedAt ?? now,
        viewCount: post.metrics.viewCount ?? 0,
        likeCount: post.metrics.likeCount ?? 0,
        commentCount: post.metrics.commentCount ?? 0,
        shareCount: post.metrics.shareCount ?? 0,
        selectedForAnalysis: Boolean(sample),
        watchMode: sample?.watchMode,
        sampleReasons: sample ? [...sample.reasons] : undefined,
        createdAt: now,
      });
    }

    const onboarding = await patchOnboarding(ctx, args.creatorId, {
      tiktokConnected: true,
      metadataPulled: true,
      videoSamplesAnalyzed: true,
    });

    return {
      onboarding,
      postCount: posts.length,
      selectedPostIds: sampleResult.selected.map((sample) => sample.post.id),
      diagnostics: sampleResult.diagnostics,
    };
  },
});

async function requireIdentity(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Creator Maya v0 requires auth.");
  return identity;
}

async function requireCurrentCreatorForAction(
  ctx: ActionCtx
): Promise<Doc<"creators">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Creator Maya v0 requires auth.");
  const creator = (await ctx.runQuery(
    internal.creatorMayaV0.backend.creatorForIdentity,
    { subject: identity.subject }
  )) as Doc<"creators"> | null;
  if (!creator) throw new Error("Creator Maya v0 creator not found.");
  return creator;
}

async function decryptLatestCalendarAccountForCreator(
  ctx: ActionCtx,
  creatorId: Id<"creators">
): Promise<string | null> {
  const connectedAccount = (await ctx.runQuery(
    internal.creatorMayaV0.backend.latestConnectedCalendarAccountForCreator,
    { creatorId }
  )) as Doc<"connectedAccounts"> | null;
  if (!connectedAccount || connectedAccount.scopeStatus !== "active") return null;
  return await decrypt(connectedAccount.composioAccountId);
}

async function currentCreator(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await creatorByIdentity(ctx, identity.subject);
}

async function requireCurrentCreator(ctx: QueryCtx | MutationCtx) {
  const creator = await currentCreator(ctx);
  if (!creator) throw new Error("Creator Maya v0 creator not found.");
  return creator;
}

async function creatorByIdentity(ctx: QueryCtx | MutationCtx, subject: string) {
  return await ctx.db
    .query("creators")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", subject))
    .first();
}

async function patchOnboarding(
  ctx: MutationCtx,
  creatorId: Id<"creators">,
  patch: Partial<CreatorMayaOnboardingState>
) {
  const current = await getOnboardingState(ctx, creatorId);
  const next = { ...current, ...patch };
  const currentStep = nextOnboardingStep(next);
  const progressPercent = onboardingProgressPercent(next);
  const existing = await latestByCreator(ctx, "creatorMayaV0Onboarding", creatorId);
  const row = {
    creatorId,
    tiktokConnected: next.tiktokConnected,
    metadataPulled: next.metadataPulled,
    videoSamplesAnalyzed: next.videoSamplesAnalyzed,
    calendarConnected: next.calendarConnected,
    interviewComplete: next.interviewComplete,
    readbackConfirmed: next.readbackConfirmed,
    creatorPictureReady: next.creatorPictureReady,
    imessagePaired: next.imessagePaired,
    mayaDeployed: next.mayaDeployed,
    currentStep,
    progressPercent,
    updatedAt: Date.now(),
  };
  if (existing) await ctx.db.patch(existing._id, row);
  else await ctx.db.insert("creatorMayaV0Onboarding", row);
  return row;
}

async function storeDirectGoogleCalendarConnection(
  ctx: MutationCtx,
  args: {
    creatorId: Id<"creators">;
    timezone: string;
    scopes: string[];
    events: ReturnType<typeof normalizeCalendarLookaheadEvents>;
    encryptedAccessToken?: string;
    encryptedRefreshToken?: string;
    expiresAt?: number;
    tokenType?: string;
    oauthScope?: string;
    externalAccountId?: string;
  }
): Promise<CalendarConnectionImportResult> {
  const now = Date.now();

  await deleteByCreator(ctx, "creatorMayaV0CalendarConnections", args.creatorId);
  await ctx.db.insert("creatorMayaV0CalendarConnections", {
    creatorId: args.creatorId,
    provider: "google",
    providerMode: "google_api",
    externalAccountId: args.externalAccountId,
    oauthAccessToken: args.encryptedAccessToken,
    oauthRefreshToken: args.encryptedRefreshToken,
    oauthExpiresAt: args.expiresAt,
    oauthTokenType: args.tokenType,
    oauthScope: args.oauthScope,
    timezone: args.timezone,
    scopes:
      args.scopes.length > 0
        ? args.scopes
        : calendarScopesForMode("google_api"),
    canCreateHolds: args.scopes.some((scope) =>
      scope.includes("calendar.events")
    ),
    connectedAt: now,
    lastSyncedAt: now,
    lookaheadDays: 14,
    status: "active",
  });

  await storeCalendarEvents(ctx, args.creatorId, args.events, now);
  const onboarding = await patchOnboarding(ctx, args.creatorId, {
    calendarConnected: true,
  });
  return {
    onboarding,
    providerMode: "google_api",
    lookaheadImported: args.events.length,
    contentArcCount: args.events.reduce(
      (sum, event) => sum + event.contentArc.length,
      0
    ),
  };
}

async function storeCalendarEvents(
  ctx: MutationCtx,
  creatorId: Id<"creators">,
  events: ReturnType<typeof normalizeCalendarLookaheadEvents>,
  now: number
) {
  for (const event of events) {
    const existing = await ctx.db
      .query("creatorMayaV0CalendarEvents")
      .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
      .collect()
      .then((rows) =>
        rows.find((row) => row.providerEventId === event.providerEventId)
      );
    const row = {
      creatorId,
      providerEventId: event.providerEventId,
      title: event.title,
      description: event.description,
      startMs: event.startMs,
      endMs: event.endMs,
      createdBy: "external" as const,
      source: "context" as const,
      classification: event.classification as CalendarEventClassification,
      contentArc: event.contentArc,
      privacyRedacted: event.privacyRedacted,
      createdAt: now,
    };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("creatorMayaV0CalendarEvents", row);
  }
}

function assertProviderModeMatchesProvider(
  provider: "google" | "apple",
  providerMode: CalendarProviderMode
) {
  if (provider === "google" && providerMode !== "google_api") {
    throw new Error("Google calendar must use google_api mode.");
  }
  if (provider === "apple" && providerMode !== "apple_phone_api") {
    throw new Error("Apple calendar must use apple_phone_api mode.");
  }
}

function calendarScopesForMode(providerMode: CalendarProviderMode): string[] {
  if (providerMode === "google_api") {
    return ["calendar.events.read", "calendar.events.write.maya_holds"];
  }
  if (providerMode === "apple_phone_api") {
    return ["apple_phone.calendar.read", "apple_phone.calendar.write.maya_holds"];
  }
  return ["free_busy", "create_maya_holds"];
}

function googleCalendarScopesFromOAuthScope(scope: string | undefined): string[] {
  if (!scope) return ["calendar.events.read"];
  return scope
    .split(/[,\s]+/)
    .filter(Boolean)
    .map((value) => {
      if (value.endsWith("/auth/calendar.events")) return "calendar.events.write.maya_holds";
      if (value.endsWith("/auth/calendar.readonly")) return "calendar.events.read";
      if (value.endsWith("/auth/calendar.events.readonly")) return "calendar.events.read";
      return value;
    });
}

async function listGoogleCalendarEventsWithStoredToken(
  ctx: ActionCtx,
  connection: Doc<"creatorMayaV0CalendarConnections">,
  args: { timeMin: string; timeMax: string; calendarId: string }
): Promise<{ items: Array<Parameters<typeof calendarEventToLookaheadInput>[0]> }> {
  let accessToken = await decrypt(connection.oauthAccessToken ?? "");
  const shouldRefresh =
    connection.oauthRefreshToken &&
    (!connection.oauthExpiresAt || connection.oauthExpiresAt < Date.now() + 60_000);
  if (shouldRefresh) {
    accessToken = await refreshGoogleAccessToken(ctx, connection);
  }

  let response = await fetchGoogleCalendarEvents(accessToken, args);
  if (response.status === 401 && connection.oauthRefreshToken) {
    accessToken = await refreshGoogleAccessToken(ctx, connection);
    response = await fetchGoogleCalendarEvents(accessToken, args);
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Google Calendar list failed: ${response.status} ${text.slice(0, 240)}`
    );
  }
  const body = (await response.json()) as {
    items?: Array<Parameters<typeof calendarEventToLookaheadInput>[0]>;
  };
  return { items: body.items ?? [] };
}

async function refreshGoogleAccessToken(
  ctx: ActionCtx,
  connection: Doc<"creatorMayaV0CalendarConnections">
): Promise<string> {
  const refreshToken = connection.oauthRefreshToken
    ? await decrypt(connection.oauthRefreshToken)
    : null;
  if (!refreshToken) {
    throw new Error("Google Calendar refresh token is not available.");
  }
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Google Calendar refresh requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Convex env."
    );
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Google Calendar refresh failed: ${response.status} ${text.slice(0, 240)}`
    );
  }
  const token = (await response.json()) as GoogleTokenResponse;
  const expiresAt =
    typeof token.expires_in === "number"
      ? Date.now() + token.expires_in * 1000
      : undefined;
  await ctx.runMutation(
    internal.creatorMayaV0.backend.refreshGoogleCalendarAccessTokenForCreator,
    {
      connectionId: connection._id,
      encryptedAccessToken: await encrypt(token.access_token),
      expiresAt,
      tokenType: token.token_type,
      scope: token.scope,
    }
  );
  return token.access_token;
}

async function fetchGoogleCalendarEvents(
  accessToken: string,
  args: { timeMin: string; timeMax: string; calendarId: string }
): Promise<Response> {
  const params = new URLSearchParams({
    timeMin: args.timeMin,
    timeMax: args.timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "100",
  });
  return await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      args.calendarId
    )}/events?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
}

function calendarTimeToMs(
  time:
    | {
        dateTime?: string;
        date?: string;
        timeZone?: string;
      }
    | undefined
): number | null {
  const raw = time?.dateTime ?? time?.date;
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

function calendarEventToLookaheadInput(event: {
  id: string;
  summary?: string;
  description?: string;
  start?: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  end?: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  location?: string;
  recurringEventId?: string;
}): CalendarLookaheadEventInput | null {
  const startMs = calendarTimeToMs(event.start);
  const endMs = calendarTimeToMs(event.end);
  if (startMs === null || endMs === null) return null;
  return {
    providerEventId: event.id,
    title: event.summary ?? "Untitled calendar event",
    description: event.description,
    startMs,
    endMs,
    location: event.location,
    recurring: Boolean(event.recurringEventId),
  };
}

async function getOnboardingState(
  ctx: QueryCtx | MutationCtx,
  creatorId: Id<"creators">
): Promise<CreatorMayaOnboardingState> {
  const row = await latestByCreator(ctx, "creatorMayaV0Onboarding", creatorId);
  return {
    signedUp: true,
    tiktokConnected: row?.tiktokConnected ?? false,
    metadataPulled: row?.metadataPulled ?? false,
    videoSamplesAnalyzed: row?.videoSamplesAnalyzed ?? false,
    calendarConnected: row?.calendarConnected ?? false,
    interviewComplete: row?.interviewComplete ?? false,
    readbackConfirmed: row?.readbackConfirmed ?? false,
    creatorPictureReady: row?.creatorPictureReady ?? false,
    imessagePaired: row?.imessagePaired ?? false,
    mayaDeployed: row?.mayaDeployed ?? false,
  };
}

async function latestByCreator<T extends LatestByCreatorTable>(
  ctx: QueryCtx | MutationCtx,
  table: T,
  creatorId: Id<"creators">
): Promise<Doc<T> | null> {
  const rows = await collectByCreator(ctx, table, creatorId);
  return (rows[rows.length - 1] as Doc<T> | undefined) ?? null;
}

async function deleteByCreator(
  ctx: MutationCtx,
  table: DeletableByCreatorTable,
  creatorId: Id<"creators">
) {
  const rows = await collectByCreator(ctx, table, creatorId);
  for (const row of rows) await ctx.db.delete(row._id);
}

async function collectByCreator<T extends DeletableByCreatorTable>(
  ctx: QueryCtx | MutationCtx,
  table: T,
  creatorId: Id<"creators">
): Promise<Array<Doc<T>>> {
  switch (table) {
    case "creatorMayaV0Onboarding":
      return (await ctx.db
        .query("creatorMayaV0Onboarding")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()) as unknown as Array<Doc<T>>;
    case "creatorMayaV0TiktokAccounts":
      return (await ctx.db
        .query("creatorMayaV0TiktokAccounts")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()) as unknown as Array<Doc<T>>;
    case "creatorMayaV0TiktokPosts":
      return (await ctx.db
        .query("creatorMayaV0TiktokPosts")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()) as unknown as Array<Doc<T>>;
    case "creatorMayaV0CalendarConnections":
      return (await ctx.db
        .query("creatorMayaV0CalendarConnections")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()) as unknown as Array<Doc<T>>;
    case "creatorMayaV0CalendarEvents":
      return (await ctx.db
        .query("creatorMayaV0CalendarEvents")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()) as unknown as Array<Doc<T>>;
    case "creatorMayaV0Intake":
      return (await ctx.db
        .query("creatorMayaV0Intake")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()) as unknown as Array<Doc<T>>;
    case "creatorMayaV0CreatorPictures":
      return (await ctx.db
        .query("creatorMayaV0CreatorPictures")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()) as unknown as Array<Doc<T>>;
  }
}

async function inferCreatorSignals(
  ctx: QueryCtx | MutationCtx,
  creatorId: Id<"creators">
) {
  const tiktok = await latestByCreator(ctx, "creatorMayaV0TiktokAccounts", creatorId);
  const posts = await ctx.db
    .query("creatorMayaV0TiktokPosts")
    .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
    .collect();
  const strongest = posts.sort((a, b) => b.viewCount - a.viewCount)[0];
  return {
    inferredNiche: tiktok?.bio || "TikTok creator",
    strongestPattern: strongest?.formatKey ?? "result-first posts",
    weakestPattern: "context-heavy openings",
    calendarReality: "Use connected availability windows for filming and editing.",
    audienceHypothesis: `${tiktok?.displayName ?? "The creator"}'s TikTok audience`,
  };
}

function mockTikTokPosts(now: number) {
  return Array.from({ length: 30 }, (_, i) => ({
    id: `mock_tt_${i}`,
    caption: `Mock TikTok ${i}`,
    createdAt: now - i * 86_400_000,
    durationSec: 15 + (i % 5) * 8,
    hasVideo: true,
    thumbnailUrl: `https://example.com/thumb-${i}.jpg`,
    videoUrl: `https://example.com/video-${i}.mp4`,
    formatKey: i === 11 ? "green-screen-rant" : "result-first",
    metrics: {
      views: 1_000 + i * 250,
      likes: 100 + i * 20,
      comments: 10 + i,
      shares: 5 + i,
    },
  }));
}

function localDateFor(ms: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function clampAutonomy(value: number): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0) return 0;
  if (value === 1) return 1;
  if (value === 2) return 2;
  if (value === 3) return 3;
  return 4;
}
