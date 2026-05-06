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
import { assembleWorkspaceBundle } from "../agents/packs/maya/workspace/assembleWorkspaceBundle";
import type { WorkspaceInputs } from "../agents/packs/maya/workspace/types";
import {
  CREATOR_MAYA_V0_PINNED_CLAWHUB_LOCK,
  CREATOR_MAYA_V0_PINNED_CLAWHUB_SKILLS,
} from "./pinnedClawhubSkills";
import { listEvents } from "../integrations/composio/actions/calendar";
import { decrypt, encrypt } from "../lib/encryption";
import {
  FlyClient,
  FlyError,
  type FlyMachine,
  type FlyMachineConfig,
} from "../lib/flyClient";
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

type LiveOpenClawDeployResult =
  | {
      ok: true;
      mode: "live_test" | "production";
      flyAppId: string;
      machineId: string;
      machineState: string;
    }
  | { ok: false; blockers: string[] };

const OPENCLAW_IMAGE =
  process.env.MAYA_OPENCLAW_IMAGE ??
  "registry.fly.io/heymaya-openclaw:v2026.4.23";

const OPENCLAW_MACHINE_GUEST = {
  cpu_kind: "shared" as const,
  cpus: 1,
  memory_mb: 1024,
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
  v.literal("coach"),
  v.literal("manager")
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
        plan: args.tier ?? "coach",
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

export const recordLiveOpenClawDeploymentInternal = internalMutation({
  args: {
    creatorId: v.id("creators"),
    mode: v.union(v.literal("live_test"), v.literal("production")),
    flyAppId: v.string(),
    machineId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch(args.creatorId, {
      mayaFlyAppId: args.flyAppId,
    });
    await ctx.db.insert("creatorMayaV0OpenClawDeployments", {
      creatorId: args.creatorId,
      mode: args.mode,
      status: "deployed",
      deployLabel: `${args.mode}:${args.flyAppId}`,
      flyAppId: args.flyAppId,
      machineId: args.machineId,
      createdAt: now,
    });
    const onboarding = await patchOnboarding(ctx, args.creatorId, {
      mayaDeployed: true,
    });
    return { onboarding, flyAppId: args.flyAppId };
  },
});

export const liveOpenClawDeployPayload = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, args) => {
    const creator = await ctx.db.get(args.creatorId);
    if (!creator) return null;
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
    return { creator, onboarding, picture, tiktok };
  },
});

export const deployOpenClawLive = action({
  args: {
    mode: v.union(v.literal("live_test"), v.literal("production")),
    confirm: v.boolean(),
  },
  handler: async (ctx, args): Promise<LiveOpenClawDeployResult> => {
    if (!args.confirm) {
      return { ok: false as const, blockers: ["live_deploy_not_confirmed"] };
    }
    if (
      args.mode === "production" &&
      process.env.CREATOR_MAYA_ALLOW_PRODUCTION_DEPLOY !== "true"
    ) {
      return { ok: false as const, blockers: ["production_deploy_not_enabled"] };
    }

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { ok: false as const, blockers: ["signed_in_user_required"] };

    const creator = (await ctx.runQuery(
      internal.creatorMayaV0.backend.creatorForIdentity,
      { subject: identity.subject }
    )) as Doc<"creators"> | null;
    if (!creator) return { ok: false as const, blockers: ["creator_not_found"] };

    const payload = await ctx.runQuery(
      internal.creatorMayaV0.backend.liveOpenClawDeployPayload,
      { creatorId: creator._id }
    );
    if (!payload) return { ok: false as const, blockers: ["creator_not_found"] };

    const gate = evaluateOpenClawDeployGate({
      mode: args.mode,
      creatorId: creator._id,
      workspaceManifestReady: Boolean(payload.picture && payload.tiktok),
      phoneNumberCollected: Boolean(payload.creator.phoneNumber),
      calendarConnected: payload.onboarding.calendarConnected,
      creatorPictureReady: payload.onboarding.creatorPictureReady,
      hasFlyToken: Boolean(process.env.FLY_API_TOKEN),
      allowPaidDeploy: true,
      allMockE2EGatesGreen: true,
    });
    if (!gate.ok) return { ok: false as const, blockers: [...gate.blockers] };

    if (!payload.picture || !payload.tiktok) {
      return { ok: false as const, blockers: ["workspace_manifest_missing"] };
    }

    const appName = appNameForCreatorMayaLive(creator._id, args.mode);
    const workspace = buildCreatorWorkspaceForDeploy({
      creator,
      v0Picture: payload.picture,
      tiktokHandle: payload.tiktok.handle,
    });

    const fly = new FlyClient({ orgSlug: process.env.FLY_ORG_SLUG ?? "personal" });
    try {
      try {
        await fly.createApp({ appName });
      } catch (err) {
        if (!isFlyAlreadyExists(err)) throw err;
      }

      // Push provider + channel secrets BEFORE machine create so the runtime
      // sees them on first boot. Only the keys we have at deploy time get
      // forwarded — operator can add more later via `fly secrets set`. The
      // OPENROUTER_API_KEY is non-negotiable: without it OpenClaw falls back
      // to its bundled `codex` provider and every model call fails with
      // "No API key found for provider 'openai'" (root cause documented in
      // /memory/session_handoff_telegram_channel_2026_05_03.md). Channel
      // secrets are conditional on the channel being routed — we forward
      // unconditionally because reads are cheap and OpenClaw only enables a
      // channel when its config block is present.
      const machineSecrets: Record<string, string> = {};
      for (const k of [
        "OPENROUTER_API_KEY",
        "TELEGRAM_BOT_TOKEN",
        "TELEGRAM_BOT_USERNAME",
        "CLAW_MESSENGER_API_KEY",
      ]) {
        const v = process.env[k];
        if (v) machineSecrets[k] = v;
      }
      if (Object.keys(machineSecrets).length > 0) {
        await fly.setAppSecrets(appName, machineSecrets);
      }

      const existing = await fly.listMachines(appName).catch(() => []);
      const reusable =
        args.mode === "production"
          ? existing.find((machine) => machine.name === appName)
          : null;

      const machine: FlyMachine =
        reusable ??
        (await fly.createMachine({
          appName,
          name: appName,
          config: creatorMayaLiveMachineConfig(workspace.files, {
            creatorId: creator._id,
            mode: args.mode,
            appName,
          }),
        }));

      if (machine.state !== "started") {
        await fly.startMachine(appName, machine.id);
      }

      const final: FlyMachine =
        machine.state === "started"
          ? machine
          : await fly.waitForState(appName, machine.id, "started", {
              timeoutMs: 150_000,
              intervalMs: 3_000,
            });

      await ctx.runMutation(
        internal.creatorMayaV0.backend.recordLiveOpenClawDeploymentInternal,
        {
          creatorId: creator._id,
          mode: args.mode,
          flyAppId: appName,
          machineId: final.id,
        }
      );

      return {
        ok: true as const,
        mode: args.mode,
        flyAppId: appName,
        machineId: final.id,
        machineState: final.state,
      };
    } catch (err) {
      return {
        ok: false as const,
        blockers: [
          err instanceof Error ? err.message : "openclaw_live_deploy_failed",
        ],
      };
    }
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

    const workspace = buildCreatorWorkspaceForDeploy({
      creator,
      v0Picture: picture,
      tiktokHandle: tiktok.handle,
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

/**
 * Sprint 7 Slice B — iMessage-tap OAuth completion.
 *
 * Mirror of `storeGoogleCalendarOAuthConnection` (which is the
 * Clerk-session mutation) but takes the creatorId directly because the
 * iMessage callback resolved it via the `oauthStateTokens` handoff.
 * Tokens are encrypted at rest the same way the session-side helper
 * does.
 */
export const storeGoogleCalendarOAuthConnectionForCreator = internalMutation({
  args: {
    creatorId: v.id("creators"),
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
    const accessToken = await encrypt(args.accessToken);
    const refreshToken = args.refreshToken
      ? await encrypt(args.refreshToken)
      : undefined;
    const normalized = normalizeCalendarLookaheadEvents(args.lookaheadEvents);
    return await storeDirectGoogleCalendarConnection(ctx, {
      creatorId: args.creatorId,
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

/**
 * Sprint 7 Slice B — Google Calendar v3 events.insert.
 *
 * Mirrors the read helper above: takes a *resolved* access token (the
 * caller is responsible for token refresh, the same way
 * `listGoogleCalendarEventsWithStoredToken` is responsible). Returns the
 * created event's id + htmlLink so Maya can text the operator a confirm.
 *
 * Inputs intentionally narrow: the only fields we surface today are the
 * ones a creator can request via natural-language ("block 3pm Tuesday for
 * filming"). If/when we need attendees, conferencing, recurrence, etc.,
 * extend `GoogleCalendarEventCreate` rather than passing a raw record —
 * defense-in-depth against accidentally leaking arbitrary payloads to
 * Google.
 */
export interface GoogleCalendarEventCreate {
  /** `summary` on the Google API. */
  summary: string;
  description?: string;
  location?: string;
  /** ISO 8601 with timezone (e.g. "2026-05-12T15:00:00-07:00"). */
  start: { dateTime: string; timeZone?: string };
  end: { dateTime: string; timeZone?: string };
}

export async function createGoogleCalendarEvent(
  accessToken: string,
  calendarId: string,
  payload: GoogleCalendarEventCreate
): Promise<{ id: string; htmlLink: string }> {
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      calendarId
    )}/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Google Calendar create failed: ${response.status} ${text.slice(0, 240)}`
    );
  }
  const body = (await response.json()) as { id?: string; htmlLink?: string };
  if (!body.id || !body.htmlLink) {
    throw new Error(
      "Google Calendar create returned without id or htmlLink — refusing to surface partial result."
    );
  }
  return { id: body.id, htmlLink: body.htmlLink };
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

function appNameForCreatorMayaLive(
  creatorId: string,
  mode: "live_test" | "production"
): string {
  const short = creatorId.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 18);
  if (mode === "production") return `heymaya-cmv0-${short}`;
  return `heymaya-cmv0-${short}-${Date.now().toString(36)}`;
}

/**
 * Sprint 2 (slice A) — single deploy path. Adapt the v0
 * `creatorMayaV0CreatorPictures` doc + tiktok handle into the canonical
 * `WorkspaceInputs` consumed by `assembleWorkspaceBundle`, then flatten the
 * resulting bundle into the `Record<string, string>` shape that
 * `creatorMayaLiveMachineConfig` already expects (with `jobs.json` materialized
 * as a workspace file at `/data/cron/jobs.json` per its tar-upload mapping).
 *
 * Pinned ClawHub skills (Slice D) are layered on top so the legacy
 * `.clawhub/lock.json` + per-skill `skills/<slug>/...` files continue to
 * land on disk for the OpenClaw runtime to discover.
 *
 * The v0 `creatorMayaV0CreatorPictures` schema is much narrower than the
 * canonical `creatorPicture` table — niche/stage/goal/voice + pillars/hooks/
 * schedule. The generators handle missing optional fields with
 * `not yet provided` placeholders, so this adapter only fills the fields the
 * v0 capture flow has and leaves the rest unset.
 */
function buildCreatorWorkspaceForDeploy(input: {
  creator: Doc<"creators">;
  v0Picture: Doc<"creatorMayaV0CreatorPictures">;
  tiktokHandle: string;
}): { files: Record<string, string> } {
  const { creator, v0Picture, tiktokHandle } = input;
  const now = Date.now();

  // Adapter: synthesize the canonical `creatorPicture` shape from the v0
  // narrow capture. We populate the load-bearing fields the generators
  // dereference (niche, voiceFingerprint) and leave the rest as
  // schema-required-but-empty defaults so the generators emit grounded
  // placeholders rather than blowing up.
  const picture: Doc<"creatorPicture"> = {
    _id: `cmv0_picture_${creator._id}` as unknown as Id<"creatorPicture">,
    _creationTime: now,
    creatorId: creator._id,
    niche: v0Picture.niche,
    audience: { ageRanges: [], topGeos: [], interestTags: [] },
    voiceFingerprint: v0Picture.voiceFingerprint,
    topHooks: [],
    bottomHooks: [],
    postingCadence: { perPlatform: [] },
    brandDealHistory: [],
    generatedAt: v0Picture.generatedAt,
    model: "creatorMayaV0",
    sourceCitations: [],
  };

  // Single TikTok handle — Sprint 2 v0 is TikTok-only. The handle on the
  // v0 row is stored bare; the creatorHandles convention is `@`-prefixed.
  const handles: ReadonlyArray<Doc<"creatorHandles">> = [
    {
      _id: `cmv0_handle_${creator._id}` as unknown as Id<"creatorHandles">,
      _creationTime: now,
      creatorId: creator._id,
      platform: "tiktok",
      handle: tiktokHandle.startsWith("@") ? tiktokHandle : `@${tiktokHandle}`,
      verified: true,
    } as Doc<"creatorHandles">,
  ];

  const inputs: WorkspaceInputs = {
    creator,
    picture,
    handles,
    connectedAccounts: [],
    plan: creator.plan,
    now,
  };

  const bundle = assembleWorkspaceBundle(inputs);

  const files: Record<string, string> = {};
  for (const [name, content] of bundle.files) {
    files[name] = content;
  }
  // jobs.json gets materialized as a workspace file. The Fly machine config
  // routes it to `/data/cron/jobs.json` via guest_path mapping in
  // `creatorMayaLiveMachineConfig` (see the `name === "jobs.json"` branch).
  files["jobs.json"] = JSON.stringify(bundle.jobsJson, null, 2);

  // Pinned ClawHub vendor skills + lock file (Slice D registry).
  files[".clawhub/lock.json"] = `${JSON.stringify(
    CREATOR_MAYA_V0_PINNED_CLAWHUB_LOCK,
    null,
    2
  )}\n`;
  for (const skill of CREATOR_MAYA_V0_PINNED_CLAWHUB_SKILLS) {
    for (const [path, body] of Object.entries(skill.files)) {
      files[`skills/${skill.slug}/${path}`] = body;
    }
  }

  return { files };
}

export function creatorMayaLiveMachineConfig(
  workspaceFiles: Record<string, string>,
  metadata: { creatorId: string; mode: string; appName: string }
): FlyMachineConfig {
  // Resolve claw-messenger config from deploy-time env. The plugin's config
  // schema requires an `apiKey` literal (auto-detect-from-env isn't supported
  // the way the telegram plugin auto-reads TELEGRAM_BOT_TOKEN). When the key
  // isn't set we omit the channel block entirely — OpenClaw just won't load
  // the plugin's channel handler. See
  // node_modules/@emotion-machine/claw-messenger/README.md for the schema.
  const clawApiKey = process.env.CLAW_MESSENGER_API_KEY;
  // Composio's OpenClaw plugin (`@composio/openclaw-plugin`) registers every
  // toolkit attached to the consumer's Composio workspace as native OpenClaw
  // tools at runtime — Maya can call e.g. `gmail.threads.list` or
  // `tiktok.videos.list` by name, no MCP search/execute round-trip. The
  // OAuth lifecycle (generate connect link, persist composioAccountId) lives
  // in `convex/integrations/composio/oauth.ts`; the plugin authenticates each
  // tool call with the same Composio entity, looked up by user_id at runtime.
  // The plugin only takes a consumerKey — it does NOT support a toolkit
  // allowlist (verified against the README at
  // https://github.com/ComposioHQ/openclaw-composio-plugin), so we cannot
  // prune the surface from this side. Toolkit shape is decided in the
  // Composio dashboard. We omit the install when COMPOSIO_CONSUMER_KEY is
  // missing so dev / test deploys without a key still boot.
  const composioConsumerKey = process.env.COMPOSIO_CONSUMER_KEY;
  const channels: Record<string, unknown> = {
    // Telegram channel — auto-detects token from TELEGRAM_BOT_TOKEN env.
    // OpenClaw long-polls by default; webhook setup is opt-in. Per
    // https://docs.openclaw.ai/channels/telegram (2026-05-03).
    telegram: {
      enabled: true,
    },
  };
  if (clawApiKey) {
    channels["claw-messenger"] = {
      enabled: true,
      apiKey: clawApiKey,
      serverUrl: "wss://claw-messenger.onrender.com",
      preferredService: "iMessage",
      // dmPolicy: "open" for the operator-test creator. Multi-tenant pair
      // gating moves to "pairing" or "allowlist" once we wire the per-creator
      // pair flow through channels.ts. See README at
      // node_modules/@emotion-machine/claw-messenger/README.md.
      dmPolicy: "open",
    };
  }
  return {
    image: OPENCLAW_IMAGE,
    env: {
      OPENCLAW_STATE_DIR: "/data",
      MAYA_OPENCLAW_VERSION: "2026.4.23",
      MAYA_APP_NAME: metadata.appName,
      // Force IPv4-first DNS so outbound calls to OpenRouter / LiteLLM /
      // Telegram / Claw Messenger relays don't time out on Fly's IPv6-default
      // egress. Documented root cause in
      // /memory/session_handoff_telegram_channel_2026_05_03.md late update.
      NODE_OPTIONS: "--dns-result-order=ipv4first",
    },
    files: [
      ...Object.entries(workspaceFiles).map(([name, content]) => ({
        guest_path: name === "jobs.json" ? "/data/cron/jobs.json" : `/data/workspace/${name}`,
        raw_value: base64UtfEncode(content),
      })),
      {
        guest_path: "/data/openclaw.json",
        raw_value: base64UtfEncode(
          JSON.stringify({
            agents: {
              defaults: {
                workspace: "/data/workspace",
                // Without this, OpenClaw 2026.4.23 falls back to its bundled
                // `codex` provider (gpt-5.5) and every call fails with no
                // OpenAI key. The `openrouter/...` prefix routes through the
                // configured OpenRouter provider, which reads OPENROUTER_API_KEY
                // from env (set as a Fly secret above). See
                // https://docs.openclaw.ai/providers/openrouter.md
                model: {
                  primary: "openrouter/google/gemini-3-flash-preview",
                },
              },
            },
            skills: {
              load: {
                watch: true,
              },
            },
            channels,
          })
        ),
      },
    ],
    guest: OPENCLAW_MACHINE_GUEST,
    restart: { policy: "always" },
    metadata: {
      creator_id: metadata.creatorId,
      product: "creator-maya-v0",
      mode: metadata.mode,
      schema_version: "1",
    },
    init: {
      cmd: [
        "/bin/sh",
        "-lc",
        [
          "test -s /data/workspace/AGENTS.md",
          "test -s /data/workspace/SOUL.md",
          "test -s /data/workspace/USER.md",
          "test -s /data/cron/jobs.json",
          "test -s /data/openclaw.json",
          "if [ ! -w /data/workspace ]; then boot=/data/workspace.bootstrap.$$; mv /data/workspace \"$boot\"; mkdir -p /data/workspace; cp -R \"$boot/.\" /data/workspace; fi",
          "if [ ! -w /data/cron ]; then boot=/data/cron.bootstrap.$$; mv /data/cron \"$boot\"; mkdir -p /data/cron; cp \"$boot/jobs.json\" /data/cron/jobs.json; fi",
          "mkdir -p /data/workspace/state /data/canvas",
          "test -w /data/workspace",
          "test -w /data/cron",
          // Install claw-messenger plugin if it isn't already on the image.
          // Idempotent — re-running on every boot keeps the runtime self-
          // healing across image rebuilds. `|| true` so a registry hiccup
          // doesn't block gateway start; the channels block above only takes
          // effect if the plugin actually registered.
          "openclaw plugins install @emotion-machine/claw-messenger || true",
          // Install Composio's OpenClaw plugin so Maya gets every connected
          // toolkit (TikTok analytics, Gmail, Google Calendar, LinkedIn,
          // X/Twitter) as native tools at runtime. Idempotent install + set
          // consumerKey + restart gateway. Skipped entirely when
          // COMPOSIO_CONSUMER_KEY is missing so dev / test deploys still
          // boot. Per
          // https://github.com/ComposioHQ/openclaw-composio-plugin the plugin
          // exposes only `consumerKey` / `enabled` / `mcpUrl` — there is no
          // toolkit allowlist, so toolkit shape lives in the Composio
          // dashboard, not here.
          ...(composioConsumerKey
            ? [
                "openclaw plugins install @composio/openclaw-plugin || true",
                `openclaw config set plugins.entries.composio.config.consumerKey ${shellEscape(composioConsumerKey)} || true`,
                "openclaw gateway restart || true",
              ]
            : []),
          "exec openclaw gateway --allow-unconfigured",
        ].join(" && "),
      ],
    },
  };
}

function base64UtfEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/**
 * Escape a string for safe use as a single argument inside the boot shell
 * `sh -lc "..."` command. We wrap in single quotes (which neutralise every
 * shell metacharacter) and then handle the only interior threat: a literal
 * `'` is closed-then-escaped-then-reopened. Used for the Composio
 * consumerKey injected into `openclaw config set`.
 */
function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function isFlyAlreadyExists(err: unknown): boolean {
  if (!(err instanceof FlyError)) return false;
  if (err.status !== 409 && err.status !== 422) return false;
  const body = (err.body ?? "").toLowerCase();
  return body.includes("already") || body.includes("exists") || body.includes("taken");
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
