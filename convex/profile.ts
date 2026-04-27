/**
 * Profile screen — Sprint 6A.
 *
 * Mutations + actions backing the Profile/Settings page at
 * `app/(creator)/profile/page.tsx`. Every gated entry point:
 *   1. Re-resolves the signed-in creator from `ctx.auth.getUserIdentity()`
 *      — never trusts a `creatorId` arg from the client.
 *   2. Calls `planFeatures(creator)` for plan-tier gating (server-side, fail-
 *      closed). Frontend hiding is UX; this is the gate.
 *   3. Logs destructive / connection-state changes to `mayaActionLog` so the
 *      operator dashboard can audit who-did-what-when.
 *
 * The Composio OAuth start/complete flow is reused from
 * `convex/integrations/composio/oauth.ts` — we don't re-wrap it here. This
 * module owns:
 *   - updateCreatorPicture           — edit the 5 USER.md fields + tone
 *   - addHandle / removeHandle       — handle list ops (add re-uses verifyHandle)
 *   - disconnectProvider             — flip scopeStatus to "revoked"
 *   - updateChannelPreference        — set creators.channelPreference
 *   - setAutoSendThreshold           — Pro+ only, per-provider threshold
 *   - resetMayaMemory                — destructive; logs to mayaActionLog
 *   - exportCreatorData              — GDPR-style JSON export to ctx.storage
 *   - getProfileSummary (query)      — page-level fetch for the Profile UI
 */

import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  PlanGateError,
  planFeatures,
  type Channel,
  type Provider,
} from "./lib/planFeatures";
import { runOpenclawChannelCommand } from "./integrations/openclaw/cliClient";

/* -------------------------------------------------------------------------- */
/* Validators                                                                  */
/* -------------------------------------------------------------------------- */

const PROVIDER_VALIDATOR = v.union(
  v.literal("gmail"),
  v.literal("stripe"),
  v.literal("calendar"),
  v.literal("apollo"),
  v.literal("hunter")
);

const CHANNEL_VALIDATOR = v.union(
  v.literal("imessage"),
  v.literal("whatsapp"),
  v.literal("sms"),
  v.literal("web")
);

const TONE_VALIDATOR = v.union(
  v.literal("supportive"),
  v.literal("strategic"),
  v.literal("tough-love")
);

const REVENUE_STREAM_VALIDATOR = v.union(
  v.literal("brand-deals"),
  v.literal("affiliate"),
  v.literal("merch"),
  v.literal("courses"),
  v.literal("subs"),
  v.literal("ad-rev"),
  v.literal("email-list"),
  v.literal("live-events"),
  v.literal("consulting"),
  v.literal("other")
);

const CAREER_STAGE_VALIDATOR = v.union(
  v.literal("just-starting"),
  v.literal("building"),
  v.literal("monetizing"),
  v.literal("scaling")
);

/**
 * Cap on the long-string fields so an attacker can't store a 10MB blob via
 * the editor. Mirrors the rough scale the synthesis pipeline produces.
 */
const MAX_LONG_FIELD_CHARS = 5_000;

/* -------------------------------------------------------------------------- */
/* Internal helper: resolve the signed-in creator                              */
/* -------------------------------------------------------------------------- */

async function getCurrentCreator(
  ctx: MutationCtx | QueryCtx
): Promise<Doc<"creators"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("creators")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
    .first();
}

async function requireCurrentCreator(
  ctx: MutationCtx
): Promise<Doc<"creators">> {
  const c = await getCurrentCreator(ctx);
  if (!c) throw new Error("Not authenticated.");
  return c;
}

/* -------------------------------------------------------------------------- */
/* Page-level read for the Profile screen                                      */
/* -------------------------------------------------------------------------- */

/**
 * Single Convex subscription that backs the Profile page. Returning a bundle
 * keeps the React component to one query rather than 5; every field is
 * already cross-tenant-safe because we resolve from `ctx.auth` first.
 */
export const getProfileSummary = query({
  args: {},
  handler: async (ctx) => {
    const creator = await getCurrentCreator(ctx);
    if (!creator) return null;

    const picture = await ctx.db
      .query("creatorPicture")
      .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
      .first();
    const handles = await ctx.db
      .query("creatorHandles")
      .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
      .collect();
    const accounts = await ctx.db
      .query("connectedAccounts")
      .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
      .collect();

    const features = planFeatures(creator);

    return {
      creator: {
        _id: creator._id,
        email: creator.email,
        plan: creator.plan,
        trialEndsAt: creator.trialEndsAt ?? null,
        timezone: creator.timezone,
        channelPreference: creator.channelPreference,
        tonePreference: creator.tonePreference ?? null,
        phoneNumber: creator.phoneNumber ?? null,
      },
      picture: picture
        ? {
            _id: picture._id,
            careerStage: picture.careerStage ?? null,
            locationSoul: picture.locationSoul ?? null,
            monthlyRevenueUsd: picture.monthlyRevenueUsd ?? null,
            currentRevenueStreams: picture.currentRevenueStreams ?? [],
            longTermGoals: picture.longTermGoals ?? null,
            niche: picture.niche,
            voiceFingerprint: picture.voiceFingerprint,
          }
        : null,
      handles: handles.map((h) => ({
        _id: h._id,
        platform: h.platform,
        handle: h.handle,
        verified: h.verified,
        scrapedAt: h.scrapedAt ?? null,
        followerCount: h.followerCount ?? null,
      })),
      // Scrub `composioAccountId` from the wire — never leak even encrypted
      // secrets to the client. The hash is OK to expose (it's a one-way
      // function) but we drop it too for minimum surface.
      accounts: accounts.map((a) => ({
        _id: a._id,
        provider: a.provider,
        scopeStatus: a.scopeStatus,
        scopes: a.scopes,
        autoSendThreshold: a.autoSendThreshold ?? null,
        connectedAt: a.connectedAt,
      })),
      features: {
        plan: features.plan,
        maxHandles: features.maxHandles,
        allowedChannels: features.allowedChannels,
        allowedProviders: features.allowedProviders,
        gmailDealDeskEnabled: features.gmailDealDeskEnabled,
        brandOutreachEnabled: features.brandOutreachEnabled,
        brandContactDiscoveryEnabled: features.brandContactDiscoveryEnabled,
      },
    };
  },
});

/* -------------------------------------------------------------------------- */
/* updateCreatorPicture — the 5 USER.md fields + tonePreference                */
/* -------------------------------------------------------------------------- */

/**
 * Patch the editable Profile fields onto `creatorPicture` + `creators`. Same
 * required-vs-optional shape as `submitOnboardingAnswers` for the picture
 * fields, but tonePreference is a separate Profile-only knob that lives on
 * `creators` (not `creatorPicture`) because the synthesis pipeline doesn't
 * own it — the creator does.
 *
 * Cross-tenant: identity → creators row → patch in place. No `creatorId` arg
 * accepted; the client cannot spoof.
 *
 * Plan-tier: every plan can edit their picture (no gate). The fields edited
 * here are USER.md inputs Maya needs regardless of tier.
 */
export const updateCreatorPicture = mutation({
  args: {
    careerStage: v.optional(CAREER_STAGE_VALIDATOR),
    locationSoul: v.optional(
      v.object({
        city: v.optional(v.string()),
        state: v.optional(v.string()),
        country: v.optional(v.string()),
        timezone: v.optional(v.string()),
      })
    ),
    monthlyRevenueUsd: v.optional(v.number()),
    currentRevenueStreams: v.optional(v.array(REVENUE_STREAM_VALIDATOR)),
    longTermGoals: v.optional(
      v.object({
        oneYear: v.optional(v.string()),
        fiveYear: v.optional(v.string()),
      })
    ),
    tonePreference: v.optional(TONE_VALIDATOR),
  },
  handler: async (ctx, args) => {
    const creator = await requireCurrentCreator(ctx);

    // Adversarial-input gates. Mirror the shape used in
    // `submitOnboardingAnswers` so the rules stay consistent — the Profile
    // editor cannot relax onboarding's validation (e.g. negative revenue).
    if (
      args.monthlyRevenueUsd !== undefined &&
      args.monthlyRevenueUsd !== null &&
      (!Number.isFinite(args.monthlyRevenueUsd) || args.monthlyRevenueUsd < 0)
    ) {
      throw new Error("monthlyRevenueUsd must be a non-negative finite number.");
    }
    if (args.longTermGoals?.oneYear !== undefined) {
      assertShortString(args.longTermGoals.oneYear, "longTermGoals.oneYear");
    }
    if (args.longTermGoals?.fiveYear !== undefined) {
      assertShortString(args.longTermGoals.fiveYear, "longTermGoals.fiveYear");
    }
    if (args.locationSoul) {
      for (const k of ["city", "state", "country", "timezone"] as const) {
        const v0 = args.locationSoul[k];
        if (v0 !== undefined) assertShortString(v0, `locationSoul.${k}`);
      }
    }

    // Patch tone on creators if supplied — separate concern from picture.
    if (args.tonePreference !== undefined) {
      await ctx.db.patch(creator._id, {
        tonePreference: args.tonePreference,
      });
    }

    // Patch picture if there's anything to set there.
    const pictureArgs = {
      careerStage: args.careerStage,
      locationSoul: args.locationSoul,
      monthlyRevenueUsd: args.monthlyRevenueUsd,
      currentRevenueStreams: args.currentRevenueStreams,
      longTermGoals: args.longTermGoals,
    };
    const hasPictureUpdates = Object.values(pictureArgs).some(
      (v0) => v0 !== undefined
    );
    if (!hasPictureUpdates) return null;

    const existing = await ctx.db
      .query("creatorPicture")
      .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, pictureArgs);
      return existing._id;
    }
    // No picture row yet (rare: editing Profile before deploy synthesis).
    // Insert with empty synthesis-owned fields — the synth pass writes them
    // on the next deploy. Marked model="awaiting-synthesis" so it's obvious
    // in dashboards which rows the synthesizer hasn't reached.
    return await ctx.db.insert("creatorPicture", {
      creatorId: creator._id,
      niche: "",
      audience: { ageRanges: [], topGeos: [], interestTags: [] },
      voiceFingerprint: "",
      topHooks: [],
      bottomHooks: [],
      postingCadence: { perPlatform: [] },
      brandDealHistory: [],
      generatedAt: Date.now(),
      model: "awaiting-synthesis",
      sourceCitations: [],
      ...pictureArgs,
    });
  },
});

/* -------------------------------------------------------------------------- */
/* Connected handles — add / remove                                            */
/* -------------------------------------------------------------------------- */

/**
 * Profile-side add. Verification still flows through the existing
 * `verifyHandle` action (the Profile page calls that action first, then this
 * mutation persists the verified row). We re-check the plan-tier handle cap
 * server-side because the verify step doesn't gate.
 */
export const addCreatorHandle = mutation({
  args: {
    platform: v.union(
      v.literal("tiktok"),
      v.literal("instagram"),
      v.literal("youtube"),
      v.literal("linkedin"),
      v.literal("x"),
      v.literal("threads"),
      v.literal("reddit"),
      v.literal("pinterest")
    ),
    handle: v.string(),
    followerCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const creator = await requireCurrentCreator(ctx);
    const features = planFeatures(creator);

    const handle = args.handle.trim().replace(/^@+/, "");
    if (handle.length === 0) {
      throw new Error("handle is required.");
    }
    if (handle.length > 200) {
      throw new Error("handle is too long.");
    }

    // Per-platform uniqueness: if this creator already has a row for this
    // platform, replace the handle in place rather than inserting a duplicate.
    const existingByPlatform = await ctx.db
      .query("creatorHandles")
      .withIndex("by_creator_and_platform", (q) =>
        q.eq("creatorId", creator._id).eq("platform", args.platform)
      )
      .first();

    if (existingByPlatform) {
      await ctx.db.patch(existingByPlatform._id, {
        handle,
        verified: true,
        scrapedAt: Date.now(),
        followerCount: args.followerCount,
      });
      return existingByPlatform._id;
    }

    // Plan-tier max-handles cap. Counts existing rows BEFORE insert.
    const existingAll = await ctx.db
      .query("creatorHandles")
      .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
      .collect();
    if (existingAll.length >= features.maxHandles) {
      throw new PlanGateError(
        creator.plan,
        `addHandle:cap=${features.maxHandles}`,
        creator.plan === "starter" ? "pro" : "studio"
      );
    }

    return await ctx.db.insert("creatorHandles", {
      creatorId: creator._id,
      platform: args.platform,
      handle,
      verified: true,
      scrapedAt: Date.now(),
      followerCount: args.followerCount,
    });
  },
});

export const removeCreatorHandle = mutation({
  args: {
    handleId: v.id("creatorHandles"),
  },
  handler: async (ctx, args) => {
    const creator = await requireCurrentCreator(ctx);
    const row = await ctx.db.get(args.handleId);
    if (!row) return; // idempotent — already gone
    if (row.creatorId !== creator._id) {
      throw new Error("handleId does not belong to signed-in creator.");
    }
    await ctx.db.delete(args.handleId);
  },
});

/* -------------------------------------------------------------------------- */
/* disconnectProvider — flip scopeStatus to "revoked" (audit trail preserved) */
/* -------------------------------------------------------------------------- */

/**
 * Flip the connectedAccounts row to `scopeStatus: "revoked"`. We do NOT
 * delete the row — keeping it preserves the audit trail (when did the creator
 * connect Gmail, when did they disconnect, etc.). A re-connect will upsert
 * the same provider row back to `active` via Composio OAuth.
 *
 * Idempotent: calling on an already-revoked row is a no-op (no error, no log
 * entry duplicate). Calling on a non-existent provider row also returns
 * cleanly — Profile UI may race against an OAuth callback and we don't want
 * to surface a spurious error.
 */
export const disconnectProvider = mutation({
  args: {
    provider: PROVIDER_VALIDATOR,
  },
  handler: async (ctx, args) => {
    const creator = await requireCurrentCreator(ctx);
    const row = await ctx.db
      .query("connectedAccounts")
      .withIndex("by_creator_and_provider", (q) =>
        q.eq("creatorId", creator._id).eq("provider", args.provider)
      )
      .first();
    if (!row) return { revoked: false, reason: "not-connected" as const };
    if (row.scopeStatus === "revoked") {
      return { revoked: false, reason: "already-revoked" as const };
    }
    await ctx.db.patch(row._id, { scopeStatus: "revoked" });
    await ctx.db.insert("mayaActionLog", {
      creatorId: creator._id,
      entryId: `profile.disconnect.${args.provider}`,
      outcome: "ran",
      detail: `Creator disconnected ${args.provider}`,
      ts: Date.now(),
    });
    return { revoked: true, reason: null };
  },
});

/* -------------------------------------------------------------------------- */
/* updateChannelPreference                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Set `creators.channelPreference`. Plan-tier-gated server-side: Starter
 * cannot pick imessage/whatsapp (only web/sms). Studio + Pro get all four.
 *
 * The actual channel pairing flow (the QR / SMS code exchange that proves
 * the creator's phone) lands in Sprint 6C — this mutation only stores the
 * preference. If the creator picks `imessage` without a paired channel,
 * outbound routing will fall back to web until pairing completes (handled
 * in the OpenClaw gateway config, not here).
 */
export const updateChannelPreference = mutation({
  args: {
    channel: CHANNEL_VALIDATOR,
  },
  handler: async (ctx, args) => {
    const creator = await requireCurrentCreator(ctx);
    const features = planFeatures(creator);
    if (!features.allowedChannels.includes(args.channel)) {
      throw new PlanGateError(
        creator.plan,
        `channel:${args.channel}`,
        "pro"
      );
    }
    await ctx.db.patch(creator._id, { channelPreference: args.channel });
  },
});

/* -------------------------------------------------------------------------- */
/* setAutoSendThreshold — Pro+ only, per-provider numeric                     */
/* -------------------------------------------------------------------------- */

/**
 * Per-provider auto-send threshold (USD). Currently only meaningful for
 * `gmail` (the deal-triage path consults `connectedAccounts.autoSendThreshold`
 * before auto-sending the firm-decline variant). Storing per-provider keeps
 * the door open for future write-providers to gain their own thresholds.
 *
 * Hidden from Starter UX entirely; server-side this still rejects fail-closed.
 */
export const setAutoSendThreshold = mutation({
  args: {
    provider: PROVIDER_VALIDATOR,
    thresholdUsd: v.number(),
  },
  handler: async (ctx, args) => {
    const creator = await requireCurrentCreator(ctx);
    const features = planFeatures(creator);
    // Gate on gmailDealDeskEnabled + provider allowlist together — Starter is
    // blocked from any threshold (no deal-desk), Pro can set Gmail, Studio
    // can set Gmail + future providers in allowedProviders.
    if (!features.gmailDealDeskEnabled) {
      throw new PlanGateError(
        creator.plan,
        "autoSendThreshold",
        "pro"
      );
    }
    if (!features.allowedProviders.includes(args.provider)) {
      throw new PlanGateError(
        creator.plan,
        `autoSendThreshold:${args.provider}`,
        args.provider === "apollo" || args.provider === "hunter"
          ? "studio"
          : "pro"
      );
    }
    if (
      !Number.isFinite(args.thresholdUsd) ||
      args.thresholdUsd < 0 ||
      args.thresholdUsd > 50_000
    ) {
      throw new Error(
        "thresholdUsd must be a non-negative finite number ≤ 50000."
      );
    }
    const row = await ctx.db
      .query("connectedAccounts")
      .withIndex("by_creator_and_provider", (q) =>
        q.eq("creatorId", creator._id).eq("provider", args.provider)
      )
      .first();
    if (!row) {
      throw new Error(
        `Cannot set auto-send threshold: ${args.provider} is not connected.`
      );
    }
    await ctx.db.patch(row._id, { autoSendThreshold: args.thresholdUsd });
  },
});

/* -------------------------------------------------------------------------- */
/* resetMayaMemory — wipes OpenClaw memory via CLI                             */
/* -------------------------------------------------------------------------- */

/**
 * Wipe Maya's running memory via the OpenClaw CLI.
 *
 * What gets wiped:
 *   - OpenClaw long-term diary entries (`memory rem-backfill --rollback`)
 *   - OpenClaw short-term staged candidates
 *     (`memory rem-backfill --rollback-short-term`)
 *
 * What is preserved (intentional UX decision — Profile copy says "your
 * handles, deals, and connections stay"):
 *   - `creators` row (plan, billing, channel preference)
 *   - `creatorPicture`, `creatorHandles`, `connectedAccounts`, `pairedChannels`
 *   - `brandDeals`, `pitchOutreach`, `posts`, `postMetrics`
 *   - `dailyBriefs` / `weeklyReviews` / `mayaActionLog` — these are
 *     Convex-side operational records of what Maya did, not Maya's running
 *     memory. Keeping them lets the operator audit pre/post the reset.
 *
 * Why we don't `agents delete` + redeploy: that path nukes the workspace
 * entirely (handles, soul, channel pairings) which violates the Profile
 * copy. If the operator needs that, they trigger it out of band.
 *
 * OpenClaw CLI surface (per https://docs.openclaw.ai/cli/memory.md): the
 * docs do NOT expose a `memory reset` subcommand. `rem-backfill` rollbacks
 * are the closest primitive. If a future OpenClaw release adds a true
 * reset, swap the COMMAND_PATH entry in `cliClient.ts` — no caller change.
 *
 * Cross-tenant: action re-resolves the creator from Clerk identity, looks
 * up `creators.mayaFlyAppId` via internal query, and refuses to issue any
 * CLI command if the creator has no Fly app on file. We never accept a
 * `creatorId` arg from the client.
 *
 * Confirmation: requires literal string "RESET" (case-sensitive, no
 * whitespace). Anything else fail-closed.
 */
export const resetMayaMemory = action({
  args: {
    confirm: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    logged: true;
    rolledBackLongTerm: boolean;
    rolledBackShortTerm: boolean;
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated.");
    if (args.confirm !== "RESET") {
      throw new Error(
        "Memory reset requires confirm='RESET' (got something else)."
      );
    }
    const me: { creatorId: Id<"creators">; mayaFlyAppId: string | null } | null =
      await ctx.runQuery(internal.profile._getResetTargetForUser, {
        clerkUserId: identity.subject,
      });
    if (!me) {
      throw new Error("Creator row not found for signed-in user.");
    }

    // Defense-in-depth: refuse to issue ANY CLI call if there's no Fly app
    // on file. Without an --agent value, the CLI would either error out or
    // (worse) target the operator's default agent context.
    if (!me.mayaFlyAppId) {
      await ctx.runMutation(internal.profile._logMemoryResetOutcome, {
        creatorId: me.creatorId,
        outcome: "skipped_dependency_missing",
        detail:
          "No mayaFlyAppId on creator row — Maya not deployed yet, nothing to wipe.",
      });
      return {
        logged: true,
        rolledBackLongTerm: false,
        rolledBackShortTerm: false,
      };
    }

    // Issue the two rollback commands. We treat these as best-effort: if one
    // fails, we still attempt the other and report partial success rather
    // than throwing (the creator's expectation is "I asked for a reset, I
    // want as much wiped as possible").
    const longTerm = await runOpenclawChannelCommand({
      command: "memoryRollback",
      args: ["--rollback", "--agent", me.mayaFlyAppId, "--format", "json"],
    });
    const shortTerm = await runOpenclawChannelCommand({
      command: "memoryRollbackShortTerm",
      args: [
        "--rollback-short-term",
        "--agent",
        me.mayaFlyAppId,
        "--format",
        "json",
      ],
    });

    const rolledBackLongTerm = longTerm.ok;
    const rolledBackShortTerm = shortTerm.ok;
    const fullySucceeded = rolledBackLongTerm && rolledBackShortTerm;
    const detailParts: string[] = [
      `agent=${me.mayaFlyAppId}`,
      `longTerm=${rolledBackLongTerm ? "ok" : `failed:${longTerm.stderr ?? "no detail"}`}`,
      `shortTerm=${rolledBackShortTerm ? "ok" : `failed:${shortTerm.stderr ?? "no detail"}`}`,
    ];
    await ctx.runMutation(internal.profile._logMemoryResetOutcome, {
      creatorId: me.creatorId,
      outcome: fullySucceeded ? "ran" : "failed",
      detail: detailParts.join(" | ").slice(0, 500),
    });

    return {
      logged: true,
      rolledBackLongTerm,
      rolledBackShortTerm,
    };
  },
});

export const _getResetTargetForUser = internalQuery({
  args: { clerkUserId: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{ creatorId: Id<"creators">; mayaFlyAppId: string | null } | null> => {
    const creator = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", args.clerkUserId))
      .first();
    if (!creator) return null;
    return {
      creatorId: creator._id,
      mayaFlyAppId: creator.mayaFlyAppId ?? null,
    };
  },
});

export const _logMemoryResetOutcome = internalMutation({
  args: {
    creatorId: v.id("creators"),
    outcome: v.union(
      v.literal("ran"),
      v.literal("failed"),
      v.literal("skipped_dependency_missing")
    ),
    detail: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("mayaActionLog", {
      creatorId: args.creatorId,
      entryId: "memory.reset",
      outcome: args.outcome,
      detail: args.detail,
      ts: Date.now(),
    });
  },
});

/* -------------------------------------------------------------------------- */
/* exportCreatorData — GDPR-style JSON download                                */
/* -------------------------------------------------------------------------- */

/**
 * Aggregate the signed-in creator's data into a JSON blob, upload to Convex
 * storage, return a signed URL. Sensitive fields are scrubbed before the
 * blob lands in storage:
 *   - `composioAccountId` (encrypted Composio token) — DROPPED entirely
 *   - `composioAccountIdHash` — DROPPED (one-way but still surface-scrub)
 *
 * Cross-tenant: every collected table is filtered by `creatorId === me._id`
 * via the `by_creator` index. The signed URL is per-blob and expires per
 * Convex storage policy; the storage row itself is unrelated to other
 * creators' rows.
 */
export const exportCreatorData = action({
  args: {},
  handler: async (
    ctx
  ): Promise<{ url: string; storageId: Id<"_storage"> }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated.");
    const bundle: ExportBundle = await ctx.runQuery(
      internal.profile._collectExportBundle,
      { clerkUserId: identity.subject }
    );
    const json = JSON.stringify(bundle, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const storageId = await ctx.storage.store(blob);
    const url = await ctx.storage.getUrl(storageId);
    if (!url) {
      throw new Error("Failed to issue signed URL for export blob.");
    }
    return { url, storageId };
  },
});

interface ExportBundle {
  exportedAt: number;
  creator: Record<string, unknown>;
  creatorPicture: Record<string, unknown> | null;
  creatorHandles: Array<Record<string, unknown>>;
  connectedAccounts: Array<Record<string, unknown>>;
  posts: Array<Record<string, unknown>>;
  dailyBriefs: Array<Record<string, unknown>>;
  weeklyReviews: Array<Record<string, unknown>>;
}

export const _collectExportBundle = internalQuery({
  args: { clerkUserId: v.string() },
  handler: async (ctx, args): Promise<ExportBundle> => {
    const creator = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", args.clerkUserId))
      .first();
    if (!creator) {
      throw new Error("Creator row not found for signed-in user.");
    }
    const picture = await ctx.db
      .query("creatorPicture")
      .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
      .first();
    const handles = await ctx.db
      .query("creatorHandles")
      .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
      .collect();
    const accounts = await ctx.db
      .query("connectedAccounts")
      .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
      .collect();
    const posts = await ctx.db
      .query("posts")
      .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
      .collect();
    const briefs = await ctx.db
      .query("dailyBriefs")
      .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
      .collect();
    const reviews = await ctx.db
      .query("weeklyReviews")
      .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
      .collect();

    return {
      exportedAt: Date.now(),
      creator: stripSecretFields(creator),
      creatorPicture: picture ? stripSecretFields(picture) : null,
      creatorHandles: handles.map(stripSecretFields),
      connectedAccounts: accounts.map(scrubConnectedAccount),
      posts: posts.map(stripSecretFields),
      dailyBriefs: briefs.map(stripSecretFields),
      weeklyReviews: reviews.map(stripSecretFields),
    };
  },
});

/** Strip Convex internal `_creationTime`-style metadata is not needed —
 * we keep it for forensics. This helper exists as a single point of edit
 * if we later decide to redact more fields globally. */
function stripSecretFields<T extends Record<string, unknown>>(row: T): T {
  // Defensive scrub even on tables that don't currently carry a token field.
  // If we later add a token to any row this prevents accidental leaks.
  const out = { ...row } as Record<string, unknown>;
  delete out.composioAccountId;
  delete out.composioAccountIdHash;
  return out as T;
}

function scrubConnectedAccount(
  row: Doc<"connectedAccounts">
): Record<string, unknown> {
  // Explicit allowlist for connectedAccounts — never let the encrypted
  // composioAccountId or its hash escape, even by accident.
  return {
    _id: row._id,
    _creationTime: row._creationTime,
    creatorId: row.creatorId,
    provider: row.provider,
    scopes: row.scopes,
    scopeStatus: row.scopeStatus,
    autoSendThreshold: row.autoSendThreshold ?? null,
    connectedAt: row.connectedAt,
  };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function assertShortString(value: string, fieldName: string): void {
  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string.`);
  }
  if (value.length > MAX_LONG_FIELD_CHARS) {
    throw new Error(
      `${fieldName} exceeds ${MAX_LONG_FIELD_CHARS} character cap.`
    );
  }
}

// Re-exports for tests that want to assert on the validator union members.
export const _internal = {
  PROVIDER_VALIDATOR,
  CHANNEL_VALIDATOR,
  TONE_VALIDATOR,
  MAX_LONG_FIELD_CHARS,
} as const;

// Type re-exports so external code (tests, frontend types) can lean on them.
export type ProfileChannel = Channel;
export type ProfileProvider = Provider;
