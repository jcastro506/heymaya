/**
 * Twilio number webhook router for Studio voice operators.
 *
 * Wave D — service plan § 13 Sprint 6. The OpenClaw `voice-call` plugin
 * owns the inbound voice flow end-to-end: TwiML answer, Media Streams
 * bridging, STT, TTS, tool dispatch, recording. We do NOT write any of
 * that — per `feedback_openclaw_native_first.md`, those are reimplementations
 * of native plugin features.
 *
 * What we DO own:
 *   - Pointing the operator's Twilio number's Voice URL at the Fly machine
 *     where their per-business OpenClaw gateway runs.
 *
 * The plugin serves its inbound endpoint at port 8787 path `/voice` (per
 * `voiceCallConfig.ts`); we POST a webhook URL update to Twilio's
 * `IncomingPhoneNumbers/{sid}` resource so Voice + Media Streams flow
 * directly into the plugin. SMS goes to a different endpoint (Convex
 * httpAction surface) because OpenClaw has no native SMS channel — see
 * `feedback_openclaw_native_first.md`.
 *
 * Studio-only — gating is enforced both server-side via `planFeaturesService`
 * and at the action's entry point.
 */

import { v } from "convex/values";
import {
  internalAction,
  internalQuery,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import {
  TwilioApiError,
  TwilioAuthError,
  TwilioClient,
  readTwilioConfigFromEnv,
} from "./client";
import {
  PlanServiceGateError,
  planFeaturesService,
} from "../../planService";

/**
 * Build the public-facing Voice URL that Twilio should POST to. The
 * `voice-call` plugin runs on the Fly machine; we build the URL from the
 * Fly app name (deterministic per business — see
 * `convex/onboarding/business/deployServiceMaya.ts` `flyAppNameForBusiness`).
 *
 * Fly machines expose ports via `<app-name>.fly.dev`. The plugin's `serve`
 * config pins port 8787 + path `/voice`.
 */
export function voiceWebhookUrlFor(flyAppName: string): string {
  return `https://${flyAppName}.fly.dev/voice/inbound`;
}

let __injectedTwilioClient: TwilioClient | null = null;

export function __setTwilioClientForWebhooks(c: TwilioClient | null): void {
  __injectedTwilioClient = c;
}

function newClient(): TwilioClient {
  if (__injectedTwilioClient) return __injectedTwilioClient;
  return new TwilioClient(readTwilioConfigFromEnv());
}

export interface ConfigureVoiceWebhookArgs {
  businessId: Id<"businesses">;
}

export interface ConfigureVoiceWebhookResult {
  ok: true;
  twilioPhoneNumber: string;
  voiceUrl: string;
}

/**
 * Update the operator's Twilio number's Voice webhook to route into their
 * per-business `voice-call` plugin. Idempotent — Twilio's POST to
 * `IncomingPhoneNumbers/{sid}` overwrites the existing URL.
 *
 * Studio-only. Throws `PlanServiceGateError` for non-Studio.
 *
 * Surgical addition: this is called from the deploy orchestrator's
 * Studio-deploy branch ONLY. Non-Studio bundles never reach here.
 */
export const configureVoiceWebhook = internalAction({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args): Promise<ConfigureVoiceWebhookResult> => {
    const business = await ctx.runQuery(
      internal.integrations.twilio.configureWebhooks.getBusinessForVoice,
      { businessId: args.businessId }
    );
    if (!business) {
      throw new Error(
        `configureVoiceWebhook: business ${args.businessId} not found.`
      );
    }
    const features = planFeaturesService(business);
    if (!features.voice || features.plan !== "studio") {
      throw new PlanServiceGateError(
        features.plan,
        "twilio:configure-voice-webhook",
        "studio"
      );
    }

    const channel = await ctx.runQuery(
      internal.integrations.twilio.configureWebhooks.getVoiceChannelForBusiness,
      { businessId: args.businessId }
    );
    if (!channel) {
      throw new Error(
        `configureVoiceWebhook: voiceChannels row missing — provision the Twilio number first.`
      );
    }
    if (!business.mayaFlyAppId) {
      throw new Error(
        `configureVoiceWebhook: mayaFlyAppId missing on business ${args.businessId}; deploy Maya first.`
      );
    }

    const voiceUrl = voiceWebhookUrlFor(business.mayaFlyAppId);
    const client = newClient();
    try {
      await client.request<{ sid: string }>(
        `/IncomingPhoneNumbers/${encodeURIComponent(channel.twilioNumberSid)}.json`,
        {
          method: "POST",
          form: {
            VoiceUrl: voiceUrl,
            VoiceMethod: "POST",
          },
        }
      );
    } catch (err) {
      if (err instanceof TwilioAuthError || err instanceof TwilioApiError) {
        throw err;
      }
      throw new Error(
        `configureVoiceWebhook: ${(err as Error).message}`
      );
    }

    return {
      ok: true,
      twilioPhoneNumber: channel.twilioPhoneNumber,
      voiceUrl,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Internal queries                                                            */
/* -------------------------------------------------------------------------- */

export const getBusinessForVoice = internalQuery({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args): Promise<Doc<"businesses"> | null> => {
    return await ctx.db.get(args.businessId);
  },
});

export const getVoiceChannelForBusiness = internalQuery({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args): Promise<Doc<"voiceChannels"> | null> => {
    return await ctx.db
      .query("voiceChannels")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .first();
  },
});
