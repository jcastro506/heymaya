/**
 * Coach/Manager rewrite (2026-05-04) — single-screen onboarding submit.
 *
 * Replaces the previous 6-step flow (HandlesStep → PullingStep → QuestionsStep
 * → ChannelStep → ComposioStep → DeployStep) with a single screen that asks
 * for handle / name / phone, then immediately backgrounds the deploy
 * pipeline. The shape of "what runs in the background" is unchanged — we still
 * rely on `kickoffBulkPullJob` + `runOnboardingDeploy` (which internally waits
 * for bulk-pull, runs the multimodal synth, generates the workspace bundle,
 * and provisions Maya on Fly).
 *
 * What this action does (in order):
 *   1. Re-resolve creator from Clerk identity (cross-tenant fail-closed).
 *   2. Validate phone (E.164-ish), name, and TikTok handle. Verify the
 *      handle is real via the existing single-platform reader.
 *   3. Patch the creators row: phoneNumber, displayName, primaryHandle,
 *      channelPreference: "imessage" (TikTok-only product is iMessage-only).
 *   4. Upsert the creatorHandles row for TikTok.
 *   5. Kick off the bulk-pull job (returns immediately; ScrapeCreators read
 *      runs in its own scheduled action).
 *   6. Schedule `deployMaya` on the same creatorId. The deploy waits for
 *      bulk-pull internally, runs synth if not pre-fired, generates the
 *      workspace bundle, and provisions Fly. The user is redirected to a
 *      status page that subscribes to creators.status + the job rows.
 *
 * Cross-tenant safety:
 *   - The handler re-resolves the creator from `ctx.auth.getUserIdentity()`.
 *     The client cannot pass a creatorId; there's no surface where it could.
 *   - All internal mutations take a creatorId argument that's the resolved
 *     id only — no path lets a client choose a different one.
 *
 * Why this is one action with internal sub-steps:
 *   - `verifyHandle` is an external API call — must be in an action.
 *   - DB writes must be in mutations — we runMutation from the action.
 *   - The kickoff of the heavy pipeline must be scheduled (Convex doesn't keep
 *     detached promises across action returns), so we use `runAfter(0, ...)`.
 */

import { v } from "convex/values";
import {
  action,
  internalMutation,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import {
  verifyHandleImpl,
  HandleNotFoundError,
} from "../../integrations/scrapeCreators/verifyHandle";

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

export type SubmitOnboardingResult =
  | { ok: true; creatorId: Id<"creators">; bulkPullJobId: Id<"onboardingJobs"> | null }
  | {
      ok: false;
      reason:
        | "unauthenticated"
        | "creator-not-found"
        | "invalid-handle"
        | "handle-not-found"
        | "invalid-name"
        | "invalid-phone"
        | "deploy-schedule-failed";
      message: string;
    };

/* -------------------------------------------------------------------------- */
/* Validation helpers — pure                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Strip leading `@`s, whitespace, and anything from the first remaining `@`
 * onwards. Mirrors the ScrapeCreators verifier so the value the user sees
 * in the UI matches what we round-trip through verification, and so a user
 * pasting their email into the handle field still resolves to the leading
 * username segment.
 */
export function normalizeHandleInput(input: string): string {
  return input.trim().replace(/^@+/, "").split("@")[0];
}

/**
 * Permissive E.164-ish check. Accepts +<country><digits> with 7-15 total
 * digits, which is the ITU-T E.164 ceiling. We do NOT consult a country
 * database here — invalid country codes will fail downstream when Twilio
 * tries to provision the channel, which is fine for v0. The point of the
 * client-side validator is to bounce obvious typos before the user has to
 * wait on the server.
 */
export function isValidE164(phone: string): boolean {
  const trimmed = phone.trim();
  if (!/^\+[1-9]\d{6,14}$/.test(trimmed)) return false;
  return true;
}

export function normalizePhoneNumberForOnboarding(input: string): string | null {
  const trimmed = input.trim();
  if (isValidE164(trimmed)) return trimmed;

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/**
 * Display-name validation. Must be 1-80 chars after trim, no control chars.
 * The 80-char cap mirrors typical platform display-name caps and gives Maya
 * something reasonable to address the creator by in iMessage.
 */
export function isValidDisplayName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 80) return false;
  // eslint-disable-next-line no-control-regex: intentional control-char filter so smart-quote / null-byte injections never reach the soul.md generator.
  if (/[\x00-\x08\x0b-\x1f\x7f]/.test(trimmed)) return false;
  return true;
}

/* -------------------------------------------------------------------------- */
/* Internal mutations                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Persist the three fields collected on the single screen, plus upsert the
 * TikTok handle row. All writes happen in one mutation so a partial failure
 * doesn't leave the creators row half-patched.
 *
 * `channelPreference` is now operator-selectable on the form (Sprint 6).
 * MVP supports `imessage` + `sms`; the form defaults via the salvaged
 * `recommendChannel(userAgent)` helper. The deploy pipeline downstream
 * already validates the channel before pairing, so an invalid value
 * here never reaches the messenger relay.
 */
export const persistOnboardingSubmission = internalMutation({
  args: {
    creatorId: v.id("creators"),
    displayName: v.string(),
    phoneNumber: v.string(),
    handle: v.string(),
    followerCount: v.optional(v.number()),
    channelPreference: v.union(
      v.literal("imessage"),
      v.literal("sms")
    ),
  },
  handler: async (ctx, args): Promise<void> => {
    const creator = await ctx.db.get(args.creatorId);
    if (!creator) {
      throw new Error(
        `persistOnboardingSubmission: creator ${args.creatorId} not found.`
      );
    }

    // Patch the creators row. Idempotent — re-submitting overwrites the prior
    // values. Status is left at "onboarding" until the deploy action lands and
    // patches it to "active" on success.
    await ctx.db.patch(args.creatorId, {
      displayName: args.displayName,
      phoneNumber: args.phoneNumber,
      primaryHandle: args.handle,
      channelPreference: args.channelPreference,
    });

    // Upsert the TikTok handle row. Per-creator+platform uniqueness is
    // enforced by the index `by_creator_and_platform`.
    const existing = await ctx.db
      .query("creatorHandles")
      .withIndex("by_creator_and_platform", (q) =>
        q.eq("creatorId", args.creatorId).eq("platform", "tiktok")
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        handle: args.handle,
        verified: true,
        scrapedAt: Date.now(),
        followerCount: args.followerCount,
      });
    } else {
      await ctx.db.insert("creatorHandles", {
        creatorId: args.creatorId,
        platform: "tiktok",
        handle: args.handle,
        verified: true,
        scrapedAt: Date.now(),
        followerCount: args.followerCount,
      });
    }
  },
});

/* -------------------------------------------------------------------------- */
/* Public action — invoked by the new single-screen onboarding form           */
/* -------------------------------------------------------------------------- */

/**
 * Action invoked by the new `app/onboarding/maya/page.tsx` single-screen
 * form. Returns a discriminated-union result so the client can render
 * specific error states inline (handle not found, etc.) without parsing
 * error messages.
 *
 * The deploy is fire-and-forget via `ctx.scheduler.runAfter(0, ...)` so this
 * action returns sub-200ms (after the verifyHandle round-trip). The status
 * page subscribes to live progress via `creators.me` + `getJobStatus`.
 */
export const submitOnboarding = action({
  args: {
    handle: v.string(),
    displayName: v.string(),
    phoneNumber: v.string(),
    // Sprint 6 — channel preference is now a real form field. Default
    // is operator-selectable via the salvaged `recommendChannel(userAgent)`
    // helper on the form. Optional in args for back-compat with any
    // pre-Sprint-6 callers; the action coerces to "imessage" if missing.
    channelPreference: v.optional(
      v.union(v.literal("imessage"), v.literal("sms"))
    ),
  },
  handler: async (ctx, args): Promise<SubmitOnboardingResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return {
        ok: false,
        reason: "unauthenticated",
        message: "submitOnboarding: signed-in Clerk user required.",
      };
    }

    const me: Doc<"creators"> | null = await ctx.runQuery(
      internal.onboarding.maya.deployMaya.findCreatorByClerkUser,
      { clerkUserId: identity.subject }
    );
    if (!me) {
      return {
        ok: false,
        reason: "creator-not-found",
        message: "submitOnboarding: creators row not found for signed-in user.",
      };
    }

    const handle = normalizeHandleInput(args.handle);
    if (handle.length === 0 || handle.length > 200) {
      return {
        ok: false,
        reason: "invalid-handle",
        message: "Handle must be 1-200 characters after stripping '@'.",
      };
    }

    const displayName = args.displayName.trim();
    if (!isValidDisplayName(displayName)) {
      return {
        ok: false,
        reason: "invalid-name",
        message: "Name must be 1-80 characters with no control characters.",
      };
    }

    const phoneNumber = normalizePhoneNumberForOnboarding(args.phoneNumber);
    if (!phoneNumber) {
      return {
        ok: false,
        reason: "invalid-phone",
        message: "Enter a 10-digit US phone number, like 415-555-1234.",
      };
    }

    // Verify the TikTok handle resolves to a real profile. This is the
    // account-takeover guard from the legacy flow, kept verbatim.
    let verified;
    try {
      verified = await verifyHandleImpl({ platform: "tiktok", handle });
    } catch (err) {
      if (err instanceof HandleNotFoundError) {
        return {
          ok: false,
          reason: "handle-not-found",
          message: `We couldn't find @${handle} on TikTok.`,
        };
      }
      // Surface as handle-not-found from the user's POV — the caller usually
      // can't act on a transient ScrapeCreators failure either.
      return {
        ok: false,
        reason: "handle-not-found",
        message: `Couldn't verify @${handle}: ${(err as Error).message}`,
      };
    }

    // Persist the four submission fields in one mutation. Idempotent.
    await ctx.runMutation(
      internal.onboarding.maya.submitOnboarding.persistOnboardingSubmission,
      {
        creatorId: me._id,
        displayName,
        phoneNumber,
        handle: verified.handle,
        followerCount: verified.followerCount,
        // Sprint 6 — channel preference is now operator-selectable.
        // Default to "imessage" for back-compat when callers omit it.
        channelPreference: args.channelPreference ?? "imessage",
      }
    );

    // Kick off bulk-pull immediately. The kickoff is idempotent (existing
    // pending/running/done rows are returned as-is) so re-submitting does
    // the right thing.
    let bulkPullJobId: Id<"onboardingJobs"> | null = null;
    try {
      const existing = await ctx.runQuery(
        internal.onboarding.maya.jobs.getLatestJobForCreator,
        { creatorId: me._id, jobType: "bulk-pull" }
      );
      if (
        existing &&
        (existing.status === "pending" ||
          existing.status === "running" ||
          existing.status === "done")
      ) {
        bulkPullJobId = existing._id;
      } else {
        bulkPullJobId = await ctx.runMutation(
          internal.onboarding.maya.jobs.insertJobRow,
          { creatorId: me._id, jobType: "bulk-pull", now: Date.now() }
        );
        await ctx.scheduler.runAfter(
          0,
          internal.onboarding.maya.jobs.runBulkPullJob,
          { jobId: bulkPullJobId }
        );
      }
    } catch (err) {
      // Falling through is fine — deployMaya will run the bulk pull inline if
      // there's no pre-fired job. We log via the message; UI doesn't need to
      // see this.
      console.error("submitOnboarding: bulk-pull kickoff failed", err);
    }

    // Schedule the deploy chain. `deployMaya` waits for bulk-pull internally,
    // runs synth if not already done, generates the workspace bundle, and
    // provisions Maya on Fly. The status page subscribes to live state.
    try {
      await ctx.scheduler.runAfter(
        0,
        internal.onboarding.maya.deployMaya.deployMaya,
        { creatorId: me._id }
      );
    } catch (err) {
      return {
        ok: false,
        reason: "deploy-schedule-failed",
        message: `Couldn't schedule Maya's deploy: ${(err as Error).message}`,
      };
    }

    return { ok: true, creatorId: me._id, bulkPullJobId };
  },
});
