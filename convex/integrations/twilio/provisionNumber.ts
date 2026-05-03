/**
 * PARKED FOR RE-SCOPE (operator decision 2026-04-27):
 *   Direct Twilio number-provisioning is on hold pending the operator's
 *   re-scope of step 11 (channel pairing). OpenClaw natively handles
 *   iMessage / WhatsApp / SMS / voice via `openclaw cli channels pair`, so
 *   the direct-provisioning path may be redundant. This file is intentionally
 *   left compiling so any consumer reaching for `provisionMyNumber` gets a
 *   clear, scoped error rather than a missing-export. The deploy orchestrator
 *   skips this entirely in v0 — see `convex/onboarding/business/deployServiceMaya.ts`.
 *
 * Twilio number provisioning — onboarding step 10 + voice setup step.
 *
 * Sprint 2 (service product). Per § 5 step 10, every operator gets a unique
 * local US number ($1.15/mo carry per § 1 voice economics). This module:
 *
 *   1. Lists `AvailablePhoneNumbers` filtered by area code + capability.
 *   2. Picks the first match.
 *   3. POSTs to `IncomingPhoneNumbers` to assign it to our account, configures
 *      inbound webhook URLs (SMS + Voice both point at our Convex httpAction
 *      surfaces).
 *   4. Persists into `voiceChannels` (Studio voice) or extends
 *      `businesses.twilioNumber` (Starter/Pro who only use SMS).
 *   5. A2P 10DLC: if `TWILIO_MESSAGING_SERVICE_SID` isn't set, we throw a
 *      `TwilioA2PNotRegisteredError`. The HeyMaya brand campaign must be
 *      pre-registered (operator-precondition).
 *
 * Cross-tenant safety: every internal mutation re-resolves the businessId
 * passed in. Public action wrappers re-resolve via Clerk identity.
 */

import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import {
  TwilioA2PNotRegisteredError,
  TwilioApiError,
  TwilioAuthError,
  TwilioClient,
  TwilioNoNumbersAvailableError,
  readTwilioConfigFromEnv,
} from "./client";
import {
  PlanServiceGateError,
  planFeaturesService,
} from "../../planService";

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

export interface ProvisionNumberArgs {
  businessId: Id<"businesses">;
  /** US local area code preference (e.g. "415"). Optional — fallback is any US local. */
  areaCode?: string;
  smsEnabled: boolean;
  voiceEnabled: boolean;
}

export interface ProvisionedNumberRow {
  twilioNumberSid: string;
  twilioPhoneNumber: string;
  voice: boolean;
  sms: boolean;
}

interface AvailableNumberPayload {
  available_phone_numbers: Array<{
    phone_number?: string;
    friendly_name?: string;
    capabilities?: { voice?: boolean; SMS?: boolean; MMS?: boolean };
  }>;
}

interface IncomingNumberPayload {
  sid?: string;
  phone_number?: string;
}

/* -------------------------------------------------------------------------- */
/* Internal mutations                                                          */
/* -------------------------------------------------------------------------- */

export const recordTwilioNumberOnBusiness = internalMutation({
  args: {
    businessId: v.id("businesses"),
    twilioPhoneNumber: v.string(),
    voiceEnabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const business = await ctx.db.get(args.businessId);
    if (!business) {
      throw new Error(
        `recordTwilioNumberOnBusiness: business ${args.businessId} not found.`
      );
    }
    await ctx.db.patch(args.businessId, {
      twilioNumber: args.twilioPhoneNumber,
      voiceEnabled: args.voiceEnabled,
      updatedAt: Date.now(),
    });
  },
});

export const upsertVoiceChannel = internalMutation({
  args: {
    businessId: v.id("businesses"),
    twilioNumberSid: v.string(),
    twilioPhoneNumber: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"voiceChannels">> => {
    const existing = await ctx.db
      .query("voiceChannels")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        twilioNumberSid: args.twilioNumberSid,
        twilioPhoneNumber: args.twilioPhoneNumber,
      });
      return existing._id;
    }
    return await ctx.db.insert("voiceChannels", {
      businessId: args.businessId,
      twilioNumberSid: args.twilioNumberSid,
      twilioPhoneNumber: args.twilioPhoneNumber,
      provisionedAt: Date.now(),
      monthlyMinutesUsed: 0,
    });
  },
});

export const getBusinessForProvisioning = internalQuery({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args): Promise<Doc<"businesses"> | null> => {
    return await ctx.db.get(args.businessId);
  },
});

/* -------------------------------------------------------------------------- */
/* Provisioning action                                                          */
/* -------------------------------------------------------------------------- */

const PROVISIONING_LOOKUP_LIMIT = 1; // first match wins; saves API quota

let __injectedTwilioClient: TwilioClient | null = null;

/**
 * Test seam — inject a TwilioClient mock for unit/integration tests.
 */
export function __setTwilioClient(client: TwilioClient | null): void {
  __injectedTwilioClient = client;
}

function newTwilioClient(): TwilioClient {
  if (__injectedTwilioClient) return __injectedTwilioClient;
  return new TwilioClient(readTwilioConfigFromEnv());
}

function inboundWebhookBase(): string {
  const base =
    process.env.NEXT_PUBLIC_CONVEX_SITE_URL ??
    process.env.CONVEX_SITE_URL ??
    process.env.APP_URL;
  if (!base) {
    throw new Error(
      "provisionNumber: NEXT_PUBLIC_CONVEX_SITE_URL must be set so Twilio inbound webhooks have a target."
    );
  }
  return base.replace(/\/$/, "");
}

export const provisionNumber = internalAction({
  args: {
    businessId: v.id("businesses"),
    areaCode: v.optional(v.string()),
    smsEnabled: v.boolean(),
    voiceEnabled: v.boolean(),
  },
  handler: async (ctx, args): Promise<ProvisionedNumberRow> => {
    const business = await ctx.runQuery(
      internal.integrations.twilio.provisionNumber.getBusinessForProvisioning,
      { businessId: args.businessId }
    );
    if (!business) {
      throw new Error(
        `provisionNumber: business ${args.businessId} not found.`
      );
    }

    // Plan-tier gate: voice is Studio-only. Pro gets the inclusion bucket
    // (mins) but the voice CHANNEL provisioning surface is Studio-gated per
    // § 5 onboarding Q8 ("set up now on Studio").
    if (args.voiceEnabled) {
      const features = planFeaturesService(business);
      if (!features.voice || features.plan === "starter") {
        throw new PlanServiceGateError(
          features.plan,
          "twilio:voice-provision",
          "studio"
        );
      }
    }

    const client = newTwilioClient();

    // A2P 10DLC: SMS without a registered messaging service is restricted
    // post-March-2024 in the US. Operator must register the HeyMaya brand
    // campaign before onboarding will provision SMS-capable numbers in
    // production. Fail-fast with a clear error.
    if (args.smsEnabled && !client.messagingService) {
      throw new TwilioA2PNotRegisteredError(
        "Twilio: TWILIO_MESSAGING_SERVICE_SID is not set. Operator must " +
          "register the HeyMaya brand campaign + messaging service in the " +
          "Twilio console before SMS provisioning will succeed."
      );
    }

    // Step 1: list available numbers.
    const search = await client.request<AvailableNumberPayload>(
      "/AvailablePhoneNumbers/US/Local.json",
      {
        method: "GET",
        query: {
          AreaCode: args.areaCode,
          SmsEnabled: args.smsEnabled || undefined,
          VoiceEnabled: args.voiceEnabled || undefined,
          PageSize: PROVISIONING_LOOKUP_LIMIT,
        },
      }
    );

    const candidate = (search.available_phone_numbers ?? [])[0];
    if (!candidate?.phone_number) {
      throw new TwilioNoNumbersAvailableError(
        args.areaCode ?? null,
        `Twilio: no available US local numbers for area code '${args.areaCode ?? "any"}' with sms=${args.smsEnabled} voice=${args.voiceEnabled}.`
      );
    }

    // Step 2: claim the number + configure inbound webhooks.
    const webhookBase = inboundWebhookBase();
    const form: Record<string, string | number | boolean> = {
      PhoneNumber: candidate.phone_number,
    };
    if (args.smsEnabled) {
      form.SmsUrl = `${webhookBase}/api/webhooks/twilio/sms`;
      form.SmsMethod = "POST";
      // Bind to the brand-shared messaging service for A2P 10DLC.
      if (client.messagingService) {
        form.SmsApplicationSid = ""; // no app-level SID; we own the routing
      }
    }
    if (args.voiceEnabled) {
      form.VoiceUrl = `${webhookBase}/api/webhooks/twilio/voice`;
      form.VoiceMethod = "POST";
    }

    const created = await client.request<IncomingNumberPayload>(
      "/IncomingPhoneNumbers.json",
      { method: "POST", form }
    );
    const sid = created.sid;
    const phoneNumber = created.phone_number ?? candidate.phone_number;
    if (!sid) {
      throw new TwilioApiError(
        200,
        null,
        "/IncomingPhoneNumbers",
        "Twilio: IncomingPhoneNumber create did not return a SID."
      );
    }

    // Step 3: persist. Studio voice → voiceChannels row; everyone gets the
    // number on the businesses row for SMS-first wiring.
    await ctx.runMutation(
      internal.integrations.twilio.provisionNumber.recordTwilioNumberOnBusiness,
      {
        businessId: args.businessId,
        twilioPhoneNumber: phoneNumber,
        voiceEnabled: args.voiceEnabled,
      }
    );
    if (args.voiceEnabled) {
      await ctx.runMutation(
        internal.integrations.twilio.provisionNumber.upsertVoiceChannel,
        {
          businessId: args.businessId,
          twilioNumberSid: sid,
          twilioPhoneNumber: phoneNumber,
        }
      );
    }

    return {
      twilioNumberSid: sid,
      twilioPhoneNumber: phoneNumber,
      voice: args.voiceEnabled,
      sms: args.smsEnabled,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Public action wrapper — Clerk identity → business resolution                */
/* -------------------------------------------------------------------------- */

export const provisionMyNumber = action({
  args: {
    areaCode: v.optional(v.string()),
    smsEnabled: v.boolean(),
    voiceEnabled: v.boolean(),
  },
  handler: async (ctx, args): Promise<ProvisionedNumberRow> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Twilio: not authenticated.");
    }
    const business = await ctx.runQuery(
      internal.integrations.zernio.oauth.getMyBusinessForOAuth,
      { clerkUserId: identity.subject }
    );
    if (!business) {
      throw new Error(
        "Twilio: no service-business row for signed-in user."
      );
    }
    return await ctx.runAction(
      internal.integrations.twilio.provisionNumber.provisionNumber,
      {
        businessId: business.business._id,
        areaCode: args.areaCode,
        smsEnabled: args.smsEnabled,
        voiceEnabled: args.voiceEnabled,
      }
    );
  },
});

/* re-export classes referenced from this module so consumers don't need to
 * import twilio/client.ts directly */
export { TwilioAuthError, TwilioA2PNotRegisteredError, TwilioNoNumbersAvailableError };
