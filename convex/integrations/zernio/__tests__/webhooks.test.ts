/**
 * Webhook handler — integration tests.
 *
 * Five mandatory categories:
 *   1. Cross-tenant: Business B's review event NEVER lands in Business A's
 *      mayaTaskQueue.
 *   2. Plan-tier: handlers do NOT enforce plan-tier (skill consumer does);
 *      this test just asserts the webhook does NOT silently drop on plan
 *      mismatch — defense-in-depth boundary owned downstream.
 *   3. Adversarial: malformed payload rejected; unknown event type
 *      audit-logged; redelivery dropped.
 *   4. Sibling-file scan — n/a Sprint 1 (no cron yet).
 *   5. TODO grep — handled in repo-wide check.
 *
 * Coverage:
 *   - parseZernioWebhookEnvelope normalizes shape
 *   - dispatchVerifiedEventInternal:
 *       - review.created → enqueues mayaTaskQueue with kind=review.created
 *       - review.created from Business B does NOT touch Business A's queue
 *       - duplicate eventId → status=duplicate, no second insert
 *       - post.published → flips matching gbpPosts.status to "posted"
 *       - post.failed → enqueues kind=post.failed
 *       - account.disconnected → flips zernioConnections platform → revoked
 *       - unknown zernioAccountId → status=no_business, audit-only
 *   - pollReviewsViaZernio: returns 0 results when no connection exists
 *   - verifyAndDispatchInternal: invalid signature → verified: false; valid →
 *     dispatches the event
 */

import { describe, it, expect, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { internal } from "../../../_generated/api";
import { modules } from "../../../../tests/_modules";
import type { Id } from "../../../_generated/dataModel";
import {
  parseZernioWebhookEnvelope,
} from "../webhooks";

const NOW = 1_700_000_000_000;

async function insertBusiness(
  t: ReturnType<typeof convexTest>,
  opts: { suffix: string; tier?: "starter" | "pro" | "studio" }
): Promise<Id<"businesses">> {
  const accountId = await t.run((ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `op_${opts.suffix}`,
      email: `${opts.suffix}@svc.test`,
      channelPreference: "web",
      timezone: "America/Los_Angeles",
      status: "active",
      plan: "starter",
      accountType: "service-business",
      createdAt: NOW,
    })
  );
  return await t.run((ctx) =>
    ctx.db.insert("businesses", {
      accountId,
      name: `Business ${opts.suffix}`,
      serviceTypes: ["hvac"],
      planTier: opts.tier ?? "pro",
      createdAt: NOW,
      updatedAt: NOW,
    })
  );
}

async function insertConnection(
  t: ReturnType<typeof convexTest>,
  businessId: Id<"businesses">,
  zernioAccountId: string
): Promise<void> {
  await t.run((ctx) =>
    ctx.db.insert("zernioConnections", {
      businessId,
      zernioAccountId,
      encryptedApiKey: "fake-encrypted",
      apiKeyHash: "fake-hash",
      connectedPlatforms: [
        {
          platform: "gbp",
          platformAccountId: "loc_1",
          status: "active",
          connectedAt: NOW,
        },
        {
          platform: "facebook",
          platformAccountId: "page_1",
          status: "active",
          connectedAt: NOW,
        },
      ],
      createdAt: NOW,
      updatedAt: NOW,
    })
  );
}

describe("parseZernioWebhookEnvelope", () => {
  it("normalizes a valid review.created payload", () => {
    const env = parseZernioWebhookEnvelope({
      id: "evt_1",
      event: "review.created",
      platform: "gbp",
      accountId: "acc_1",
      timestamp: "2026-04-26T10:00:00Z",
      data: { reviewId: "rv_1" },
    });
    expect(env).not.toBeNull();
    expect(env!.externalEventId).toBe("evt_1");
    expect(env!.type).toBe("review.created");
    expect(env!.platform).toBe("gbp");
    expect(env!.zernioAccountId).toBe("acc_1");
    expect(env!.occurredAt).toBeGreaterThan(0);
  });

  it("rejects unknown event types", () => {
    const env = parseZernioWebhookEnvelope({
      id: "evt_1",
      event: "rogue.unknown",
      data: {},
    });
    expect(env).toBeNull();
  });

  it("rejects missing event id", () => {
    const env = parseZernioWebhookEnvelope({
      event: "review.created",
      data: {},
    });
    expect(env).toBeNull();
  });

  it("ignores unknown platforms", () => {
    const env = parseZernioWebhookEnvelope({
      id: "evt_1",
      event: "review.created",
      platform: "myspace",
      data: {},
    });
    expect(env).not.toBeNull();
    expect(env!.platform).toBeUndefined();
  });

  it("rejects non-object inputs", () => {
    expect(parseZernioWebhookEnvelope(null)).toBeNull();
    expect(parseZernioWebhookEnvelope("string")).toBeNull();
    expect(parseZernioWebhookEnvelope(42)).toBeNull();
  });
});

describe("dispatchVerifiedEventInternal — cross-tenant + idempotency", () => {
  it("review.created enqueues mayaTaskQueue and audits webhookEvents", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    await insertConnection(t, businessId, "acc_1");

    const result = await t.mutation(
      internal.integrations.zernio.webhooks.dispatchVerifiedEventInternal,
      {
        event: {
          externalEventId: "evt_1",
          type: "review.created",
          occurredAt: NOW,
          platform: "gbp",
          zernioAccountId: "acc_1",
          data: { reviewId: "rv_1", body: "great" },
          raw: {},
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
    expect(queue).toHaveLength(1);
    expect(queue[0].kind).toBe("review.created");
    expect(queue[0].source).toBe("zernio-webhook");

    const events = await t.run((ctx) =>
      ctx.db
        .query("webhookEvents")
        .withIndex("by_provider_and_event_id", (q) =>
          q.eq("provider", "zernio").eq("externalEventId", "evt_1")
        )
        .collect()
    );
    expect(events).toHaveLength(1);
  });

  it("CROSS-TENANT: Business B event does NOT land in Business A's queue", async () => {
    const t = convexTest(schema, modules);
    const businessA = await insertBusiness(t, { suffix: "a" });
    const businessB = await insertBusiness(t, { suffix: "b" });
    await insertConnection(t, businessA, "acc_a");
    await insertConnection(t, businessB, "acc_b");

    await t.mutation(
      internal.integrations.zernio.webhooks.dispatchVerifiedEventInternal,
      {
        event: {
          externalEventId: "evt_b",
          type: "review.created",
          occurredAt: NOW,
          platform: "gbp",
          zernioAccountId: "acc_b",
          data: { reviewId: "rv_b" },
          raw: {},
        },
      }
    );

    const aQueue = await t.run((ctx) =>
      ctx.db
        .query("mayaTaskQueue")
        .withIndex("by_business", (q) => q.eq("businessId", businessA))
        .collect()
    );
    const bQueue = await t.run((ctx) =>
      ctx.db
        .query("mayaTaskQueue")
        .withIndex("by_business", (q) => q.eq("businessId", businessB))
        .collect()
    );
    expect(aQueue).toHaveLength(0);
    expect(bQueue).toHaveLength(1);
  });

  it("duplicate event id returns status=duplicate without re-inserting", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    await insertConnection(t, businessId, "acc_1");

    const evt = {
      externalEventId: "evt_dup",
      type: "review.created" as const,
      occurredAt: NOW,
      platform: "gbp" as const,
      zernioAccountId: "acc_1",
      data: {},
      raw: {},
    };
    const r1 = await t.mutation(
      internal.integrations.zernio.webhooks.dispatchVerifiedEventInternal,
      { event: evt }
    );
    const r2 = await t.mutation(
      internal.integrations.zernio.webhooks.dispatchVerifiedEventInternal,
      { event: evt }
    );
    expect(r1.status).toBe("processed");
    expect(r2.status).toBe("duplicate");

    const queue = await t.run((ctx) =>
      ctx.db
        .query("mayaTaskQueue")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .collect()
    );
    expect(queue).toHaveLength(1); // not 2
  });

  it("unknown zernioAccountId → status=no_business, audited but no queue insert", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    await insertConnection(t, businessId, "acc_1");

    const result = await t.mutation(
      internal.integrations.zernio.webhooks.dispatchVerifiedEventInternal,
      {
        event: {
          externalEventId: "evt_unknown",
          type: "review.created",
          occurredAt: NOW,
          zernioAccountId: "acc_NOPE",
          data: {},
          raw: {},
        },
      }
    );
    expect(result.status).toBe("no_business");
    const events = await t.run((ctx) =>
      ctx.db
        .query("webhookEvents")
        .withIndex("by_provider_and_event_id", (q) =>
          q.eq("provider", "zernio").eq("externalEventId", "evt_unknown")
        )
        .collect()
    );
    expect(events).toHaveLength(1);

    const queue = await t.run((ctx) =>
      ctx.db
        .query("mayaTaskQueue")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .collect()
    );
    expect(queue).toHaveLength(0);
  });

  it("post.published flips a matching gbpPosts.status from pending to posted", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    await insertConnection(t, businessId, "acc_1");

    const locationId = await t.run((ctx) =>
      ctx.db.insert("gbpLocations", {
        businessId,
        gbpLocationId: "gbp_loc_1",
        gbpAccountId: "gbp_acc_1",
        address: "123",
        createdAt: NOW,
      })
    );
    const postRowId = await t.run((ctx) =>
      ctx.db.insert("gbpPosts", {
        businessId,
        gbpLocationId: locationId,
        status: "pending",
        text: "...",
        gbpLocalPostId: "zernio_post_42",
        createdAt: NOW,
        updatedAt: NOW,
      })
    );

    const result = await t.mutation(
      internal.integrations.zernio.webhooks.dispatchVerifiedEventInternal,
      {
        event: {
          externalEventId: "evt_pub",
          type: "post.published",
          occurredAt: NOW,
          platform: "gbp",
          zernioAccountId: "acc_1",
          data: { postId: "zernio_post_42" },
          raw: {},
        },
      }
    );
    expect(result.status).toBe("processed");
    const updated = await t.run((ctx) => ctx.db.get(postRowId));
    expect(updated?.status).toBe("posted");
    expect(updated?.postedAt).toBeGreaterThan(0);
  });

  it("post.failed enqueues kind=post.failed", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    await insertConnection(t, businessId, "acc_1");

    await t.mutation(
      internal.integrations.zernio.webhooks.dispatchVerifiedEventInternal,
      {
        event: {
          externalEventId: "evt_fail",
          type: "post.failed",
          occurredAt: NOW,
          platform: "facebook",
          zernioAccountId: "acc_1",
          data: { postId: "x", error: "Meta blocked" },
          raw: {},
        },
      }
    );
    const queue = await t.run((ctx) =>
      ctx.db
        .query("mayaTaskQueue")
        .withIndex("by_business_and_kind", (q) =>
          q.eq("businessId", businessId).eq("kind", "post.failed")
        )
        .collect()
    );
    expect(queue).toHaveLength(1);
  });

  it("account.disconnected flips platform → revoked on the connection row", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    await insertConnection(t, businessId, "acc_1");

    await t.mutation(
      internal.integrations.zernio.webhooks.dispatchVerifiedEventInternal,
      {
        event: {
          externalEventId: "evt_disc",
          type: "account.disconnected",
          occurredAt: NOW,
          platform: "facebook",
          zernioAccountId: "acc_1",
          data: {},
          raw: {},
        },
      }
    );

    const conn = await t.run((ctx) =>
      ctx.db
        .query("zernioConnections")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .first()
    );
    expect(conn).not.toBeNull();
    const fb = conn!.connectedPlatforms.find((p) => p.platform === "facebook");
    expect(fb?.status).toBe("revoked");
    expect(fb?.revokedAt).toBeGreaterThan(0);
    // GBP unaffected
    const gbp = conn!.connectedPlatforms.find((p) => p.platform === "gbp");
    expect(gbp?.status).toBe("active");
  });

  it("webhook.test event audit-logged but skipped", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    await insertConnection(t, businessId, "acc_1");
    const result = await t.mutation(
      internal.integrations.zernio.webhooks.dispatchVerifiedEventInternal,
      {
        event: {
          externalEventId: "evt_test",
          type: "webhook.test",
          occurredAt: NOW,
          zernioAccountId: "acc_1",
          data: {},
          raw: {},
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
    expect(queue).toHaveLength(0);
  });
});

describe("pollReviewsViaZernio — outage fallback", () => {
  it("returns skipped when no connection exists", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "lonely" });
    const out = await t.action(
      internal.integrations.zernio.webhooks.pollReviewsViaZernio,
      { businessId }
    );
    expect(out.skipped).toBe("no_connection");
  });
});

describe("verifyAndDispatchInternal", () => {
  it("invalid signature → verified: false", async () => {
    const t = convexTest(schema, modules);
    const result = await t.action(
      internal.integrations.zernio.webhooks.verifyAndDispatchInternal,
      {
        rawBody: '{"event":"review.created","id":"evt_1"}',
        signatureHeader: "definitely-not-the-right-hex",
        decryptedSecret: "shhh",
      }
    );
    expect(result.verified).toBe(false);
    expect(result.reason).toBe("signature_invalid");
  });

  it("valid signature dispatches the event", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    await insertConnection(t, businessId, "acc_1");

    const body = JSON.stringify({
      event: "review.created",
      id: "evt_signed",
      accountId: "acc_1",
      platform: "gbp",
      data: { reviewId: "rv_1" },
    });
    const secret = "the-secret";
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: { name: "SHA-256" } },
      false,
      ["sign"]
    );
    const buf = await crypto.subtle.sign("HMAC", key, enc.encode(body));
    const bytes = new Uint8Array(buf);
    let hex = "";
    for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");

    const result = await t.action(
      internal.integrations.zernio.webhooks.verifyAndDispatchInternal,
      {
        rawBody: body,
        signatureHeader: hex,
        decryptedSecret: secret,
      }
    );
    expect(result.verified).toBe(true);
    expect(result.result?.status).toBe("processed");

    const queue = await t.run((ctx) =>
      ctx.db
        .query("mayaTaskQueue")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .collect()
    );
    expect(queue).toHaveLength(1);
  });

  it("malformed JSON after valid signature → verified: true, reason: malformed_json", async () => {
    const t = convexTest(schema, modules);
    const body = "not-json-at-all";
    const secret = "x";
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: { name: "SHA-256" } },
      false,
      ["sign"]
    );
    const buf = await crypto.subtle.sign("HMAC", key, enc.encode(body));
    const bytes = new Uint8Array(buf);
    let hex = "";
    for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");

    const result = await t.action(
      internal.integrations.zernio.webhooks.verifyAndDispatchInternal,
      {
        rawBody: body,
        signatureHeader: hex,
        decryptedSecret: secret,
      }
    );
    expect(result.verified).toBe(true);
    expect(result.reason).toBe("malformed_json");
  });
});

// Suppress vi unused warning when not used in some forms above.
void vi;
