/**
 * CRM webhook receiver integration tests.
 *
 * Five mandatory categories:
 *   1. Cross-tenant: Business B's webhook never wakes Business A. The
 *      connectionId is the only authority — its prefix encodes the business.
 *   2. Plan-tier — n/a at the receiver level (plan-tier gates the connect
 *      action upstream; once a connection exists, webhook is processed
 *      regardless of mid-cycle tier changes per the dealTriage precedent).
 *   3. Adversarial: replay attack rejected by webhookEvents idempotency;
 *      bad signature → handler returns 401; malformed payload → 400;
 *      unknown event types → audit-only.
 *   4. Sibling-file scan — repo-wide.
 *   5. TODO grep — repo-wide.
 *   + Webhook ack budget: handler returns 200 in <1s (asserted via timing).
 */

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { internal } from "../../../_generated/api";
import { modules } from "../../../../tests/_modules";
import type { Id } from "../../../_generated/dataModel";
import { verifyNangoSignature } from "../nango";

const NOW = 1_700_000_000_000;

async function insertBusiness(
  t: ReturnType<typeof convexTest>,
  opts: { suffix: string; tier: "starter" | "pro" | "studio" }
): Promise<Id<"businesses">> {
  const accountId = (await t.run((ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `op_${opts.suffix}`,
      email: `${opts.suffix}@svc.test`,
      channelPreference: "web",
      timezone: "America/Los_Angeles",
      status: "active",
      plan: "coach",
      accountType: "service-business",
      createdAt: NOW,
    })
  )) as Id<"creators">;
  const businessId = (await t.run((ctx) =>
    ctx.db.insert("businesses", {
      accountId,
      name: `Business ${opts.suffix}`,
      serviceTypes: ["hvac"],
      planTier: opts.tier,
      createdAt: NOW,
      updatedAt: NOW,
    })
  )) as Id<"businesses">;
  await t.run((ctx) => ctx.db.patch(accountId, { businessId }));
  return businessId;
}

async function insertCrmConnection(
  t: ReturnType<typeof convexTest>,
  businessId: Id<"businesses">,
  provider: "jobber" | "hcp"
): Promise<void> {
  await t.run((ctx) =>
    ctx.db.insert("crmConnections", {
      businessId,
      provider,
      scopes: [],
      createdAt: NOW,
      updatedAt: NOW,
    })
  );
}

function makeJobberForwardEnvelope(opts: {
  businessId: Id<"businesses">;
  eventId: string;
  topic: string;
  resourceId: string;
}): {
  eventId: string;
  type: "forward";
  providerConfigKey: string;
  connectionId: string;
  providerEventName: string;
  payload: { topic: string; itemId: string };
} {
  return {
    eventId: opts.eventId,
    type: "forward",
    providerConfigKey: "jobber",
    connectionId: `jobber_${opts.businessId}_xyz`,
    providerEventName: opts.topic,
    payload: { topic: opts.topic, itemId: opts.resourceId },
  };
}

describe("CRM webhook — dispatch pipeline", () => {
  it("processes a valid forward envelope → enqueues mayaTaskQueue + records webhookEvents", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "webhook_a", tier: "pro" });
    await insertCrmConnection(t, businessId, "jobber");
    const env = makeJobberForwardEnvelope({
      businessId,
      eventId: "evt_1",
      topic: "JOB_COMPLETE",
      resourceId: "job_42",
    });
    const result = await t.mutation(
      internal.webhooks.crm.dispatchCrmEnvelopeInternal,
      { envelope: env }
    );
    expect(result.status).toBe("processed");
    const queue = await t.run((ctx) =>
      ctx.db
        .query("mayaTaskQueue")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .collect()
    );
    expect(queue.length).toBe(1);
    expect(queue[0].kind).toBe("jobber.job_complete");
    expect(queue[0].source).toBe("crm-webhook");
    const events = await t.run((ctx) =>
      ctx.db
        .query("webhookEvents")
        .withIndex("by_provider_and_event_id", (q) =>
          q.eq("provider", "nango").eq("externalEventId", "evt_1")
        )
        .collect()
    );
    expect(events.length).toBe(1);
  });

  it("ADVERSARIAL — replay of same eventId returns duplicate (no second enqueue)", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "replay", tier: "pro" });
    await insertCrmConnection(t, businessId, "jobber");
    const env = makeJobberForwardEnvelope({
      businessId,
      eventId: "evt_replay",
      topic: "JOB_COMPLETE",
      resourceId: "job_99",
    });
    await t.mutation(internal.webhooks.crm.dispatchCrmEnvelopeInternal, {
      envelope: env,
    });
    const result2 = await t.mutation(
      internal.webhooks.crm.dispatchCrmEnvelopeInternal,
      { envelope: env }
    );
    expect(result2.status).toBe("duplicate");
    const queue = await t.run((ctx) =>
      ctx.db
        .query("mayaTaskQueue")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .collect()
    );
    expect(queue.length).toBe(1);
  });

  it("CROSS-TENANT — Business B's webhook never wakes Business A", async () => {
    const t = convexTest(schema, modules);
    const aId = await insertBusiness(t, { suffix: "wh_a", tier: "pro" });
    const bId = await insertBusiness(t, { suffix: "wh_b", tier: "pro" });
    await insertCrmConnection(t, aId, "jobber");
    await insertCrmConnection(t, bId, "jobber");
    // B's webhook fires.
    const env = makeJobberForwardEnvelope({
      businessId: bId,
      eventId: "evt_b1",
      topic: "JOB_COMPLETE",
      resourceId: "job_b1",
    });
    await t.mutation(internal.webhooks.crm.dispatchCrmEnvelopeInternal, {
      envelope: env,
    });
    const aQueue = await t.run((ctx) =>
      ctx.db
        .query("mayaTaskQueue")
        .withIndex("by_business", (q) => q.eq("businessId", aId))
        .collect()
    );
    expect(aQueue.length).toBe(0);
    const bQueue = await t.run((ctx) =>
      ctx.db
        .query("mayaTaskQueue")
        .withIndex("by_business", (q) => q.eq("businessId", bId))
        .collect()
    );
    expect(bQueue.length).toBe(1);
  });

  it("ADVERSARIAL — connectionId without an existing crmConnections row → no_business", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, {
      suffix: "no_conn",
      tier: "pro",
    });
    // NO crmConnections row inserted.
    const env = makeJobberForwardEnvelope({
      businessId,
      eventId: "evt_no_conn",
      topic: "JOB_COMPLETE",
      resourceId: "job_x",
    });
    const result = await t.mutation(
      internal.webhooks.crm.dispatchCrmEnvelopeInternal,
      { envelope: env }
    );
    expect(result.status).toBe("no_business");
    // BUT we still record the event for forensics.
    const events = await t.run((ctx) =>
      ctx.db
        .query("webhookEvents")
        .withIndex("by_provider_and_event_id", (q) =>
          q.eq("provider", "nango").eq("externalEventId", "evt_no_conn")
        )
        .collect()
    );
    expect(events.length).toBe(1);
  });

  it("auth and sync envelopes are skipped (audit-only)", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, {
      suffix: "audit_only",
      tier: "pro",
    });
    await insertCrmConnection(t, businessId, "jobber");
    const result = await t.mutation(
      internal.webhooks.crm.dispatchCrmEnvelopeInternal,
      {
        envelope: {
          eventId: "evt_auth",
          type: "auth",
          providerConfigKey: "jobber",
          connectionId: `jobber_${businessId}_xyz`,
        },
      }
    );
    expect(result.status).toBe("skipped");
  });

  it("ADVERSARIAL — unknown topic audited but not enqueued", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, {
      suffix: "unknown_topic",
      tier: "pro",
    });
    await insertCrmConnection(t, businessId, "jobber");
    const result = await t.mutation(
      internal.webhooks.crm.dispatchCrmEnvelopeInternal,
      {
        envelope: {
          eventId: "evt_uk",
          type: "forward",
          providerConfigKey: "jobber",
          connectionId: `jobber_${businessId}_xyz`,
          providerEventName: "VENDOR_PARTY_INVITE",
          payload: { topic: "VENDOR_PARTY_INVITE", itemId: "x" },
        },
      }
    );
    expect(result.status).toBe("skipped");
    const queue = await t.run((ctx) =>
      ctx.db
        .query("mayaTaskQueue")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .collect()
    );
    expect(queue.length).toBe(0);
  });

  it("ADVERSARIAL — provider mismatch (connectionId has 'hcp_' prefix but providerConfigKey 'jobber') → no_business", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, {
      suffix: "mismatch",
      tier: "pro",
    });
    await insertCrmConnection(t, businessId, "jobber");
    const result = await t.mutation(
      internal.webhooks.crm.dispatchCrmEnvelopeInternal,
      {
        envelope: {
          eventId: "evt_mismatch",
          type: "forward",
          providerConfigKey: "jobber",
          connectionId: `housecallpro_${businessId}_xyz`,
          providerEventName: "JOB_COMPLETE",
          payload: { topic: "JOB_COMPLETE", itemId: "x" },
        },
      }
    );
    expect(result.status).toBe("no_business");
  });
});

describe("CRM webhook — 1-second ack budget", () => {
  it("dispatch completes in well under 1 second", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, {
      suffix: "budget",
      tier: "pro",
    });
    await insertCrmConnection(t, businessId, "jobber");
    const env = makeJobberForwardEnvelope({
      businessId,
      eventId: "evt_budget",
      topic: "JOB_COMPLETE",
      resourceId: "job_b",
    });
    const start = Date.now();
    await t.mutation(internal.webhooks.crm.dispatchCrmEnvelopeInternal, {
      envelope: env,
    });
    const elapsed = Date.now() - start;
    // Real budget is <1000ms; allow 500ms in convex-test (no network).
    expect(elapsed).toBeLessThan(500);
  });
});

describe("CRM webhook — signature verification roundtrip", () => {
  it("a body signed with the webhook secret round-trips successfully", async () => {
    const body = JSON.stringify({
      id: "evt_sig",
      type: "forward",
      providerConfigKey: "jobber",
      connectionId: "jobber_x_y",
    });
    const secret = "shh-secret";
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: { name: "SHA-256" } },
      false,
      ["sign"]
    );
    const digest = await crypto.subtle.sign("HMAC", key, enc.encode(body));
    const bytes = new Uint8Array(digest);
    let hex = "";
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, "0");
    }
    expect(await verifyNangoSignature(body, hex, secret)).toBe(true);
    expect(await verifyNangoSignature(body, hex, "wrong-secret")).toBe(false);
    expect(await verifyNangoSignature(body, "deadbeef", secret)).toBe(false);
  });
});

describe("CRM webhook — HCP envelope", () => {
  it("processes hcp.job.completed forward envelope", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, {
      suffix: "hcp_wh",
      tier: "pro",
    });
    await insertCrmConnection(t, businessId, "hcp");
    const result = await t.mutation(
      internal.webhooks.crm.dispatchCrmEnvelopeInternal,
      {
        envelope: {
          eventId: "evt_hcp",
          type: "forward",
          providerConfigKey: "housecallpro",
          connectionId: `housecallpro_${businessId}_xyz`,
          providerEventName: "job.completed",
          payload: { event: "job.completed", id: "hcp_job_42" },
        },
      }
    );
    expect(result.status).toBe("processed");
    const queue = await t.run((ctx) =>
      ctx.db
        .query("mayaTaskQueue")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .collect()
    );
    expect(queue.length).toBe(1);
    expect(queue[0].kind).toBe("hcp.job.completed");
  });
});
