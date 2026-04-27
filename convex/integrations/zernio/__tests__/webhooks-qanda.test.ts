/**
 * Wave C.6 — GBP Q&A webhook routing.
 *
 * [DEPRECATED 2026-04-27 — Q&A path retired]
 * GBP Q&A API was deprecated by Google ("replaced by AI-powered
 * 'Ask Maps'"). The Q&A draft variant of `maya-service-review-reply-drafter`
 * was removed in Path D. These tests stay green because they exercise the
 * webhook normalizer's defensive handling — the normalizer still parses
 * `question.created` / `question.updated` events without crashing. But:
 *   - The resulting `mayaTaskQueue` rows are inert (no skill claims them).
 *   - In production, Zernio will never send these events because GBP no
 *     longer exposes Q&A via API.
 *   - These tests provide regression coverage for the defensive handling
 *     in case Zernio ever back-ports an "Ask Maps" replacement.
 *
 * See `docs/spikes/zernio-capability-audit.md`.
 *
 * Five mandatory categories applied:
 *   1. Cross-tenant — Business B's question does not land in Business A's queue.
 *   2. Plan-tier — webhook layer plan-agnostic (Q&A drafting is universal per
 *      north-star rule).
 *   3. Adversarial — unknown zernioAccountId → no_business; duplicate event id
 *      → duplicate; rejected unknown event types unchanged.
 *   4. Sibling-file scan — separate file.
 *   5. TODO grep — separate file.
 */

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { internal } from "../../../_generated/api";
import { modules } from "../../../../tests/_modules";
import type { Id } from "../../../_generated/dataModel";
import { parseZernioWebhookEnvelope } from "../webhooks";

const NOW = 1_700_000_000_000;

async function insertBusiness(
  t: ReturnType<typeof convexTest>,
  suffix: string
): Promise<Id<"businesses">> {
  const accountId = await t.run((ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `op_${suffix}`,
      email: `${suffix}@svc.test`,
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
      name: `Business ${suffix}`,
      serviceTypes: ["hvac"],
      planTier: "pro",
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
      ],
      createdAt: NOW,
      updatedAt: NOW,
    })
  );
}

describe("Wave C.6 — Zernio question.* envelope parser", () => {
  it("normalizes a question.created payload", () => {
    const env = parseZernioWebhookEnvelope({
      id: "evt_qa1",
      event: "question.created",
      platform: "gbp",
      accountId: "acc_qa",
      timestamp: "2026-04-26T11:00:00Z",
      data: { questionId: "qq_1", text: "Do you do water heaters?" },
    });
    expect(env).not.toBeNull();
    expect(env!.type).toBe("question.created");
    expect(env!.platform).toBe("gbp");
  });

  it("normalizes a question.updated payload", () => {
    const env = parseZernioWebhookEnvelope({
      id: "evt_qa2",
      event: "question.updated",
      platform: "gbp",
      accountId: "acc_qa",
      timestamp: "2026-04-26T11:00:00Z",
      data: { questionId: "qq_2" },
    });
    expect(env).not.toBeNull();
    expect(env!.type).toBe("question.updated");
  });
});

describe("Wave C.6 — question.* dispatch", () => {
  it("question.created enqueues a mayaTaskQueue row", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, "qa");
    await insertConnection(t, businessId, "acc_qa");

    const result = await t.mutation(
      internal.integrations.zernio.webhooks.dispatchVerifiedEventInternal,
      {
        event: {
          externalEventId: "evt_qa_1",
          type: "question.created",
          occurredAt: NOW,
          platform: "gbp",
          zernioAccountId: "acc_qa",
          data: { questionId: "qq_1", text: "Do you do water heaters?" },
          raw: {},
        },
      }
    );
    expect(result.status).toBe("processed");

    const queue = await t.run((ctx) =>
      ctx.db
        .query("mayaTaskQueue")
        .withIndex("by_business_and_kind", (q) =>
          q.eq("businessId", businessId).eq("kind", "question.created")
        )
        .collect()
    );
    expect(queue.length).toBe(1);
    expect((queue[0].payload as { platform: string }).platform).toBe("gbp");
  });

  it("cross-tenant: Business B's question never lands in Business A's queue", async () => {
    const t = convexTest(schema, modules);
    const a = await insertBusiness(t, "a");
    const b = await insertBusiness(t, "b");
    await insertConnection(t, a, "acc_a");
    await insertConnection(t, b, "acc_b");

    await t.mutation(
      internal.integrations.zernio.webhooks.dispatchVerifiedEventInternal,
      {
        event: {
          externalEventId: "evt_b1",
          type: "question.created",
          occurredAt: NOW,
          platform: "gbp",
          zernioAccountId: "acc_b",
          data: { questionId: "qq_b" },
          raw: {},
        },
      }
    );

    const queueA = await t.run((ctx) =>
      ctx.db
        .query("mayaTaskQueue")
        .withIndex("by_business_and_kind", (q) =>
          q.eq("businessId", a).eq("kind", "question.created")
        )
        .collect()
    );
    expect(queueA.length).toBe(0);
  });

  it("question.created from unknown account → no_business audit-only", async () => {
    const t = convexTest(schema, modules);
    const result = await t.mutation(
      internal.integrations.zernio.webhooks.dispatchVerifiedEventInternal,
      {
        event: {
          externalEventId: "evt_unknown_q",
          type: "question.created",
          occurredAt: NOW,
          platform: "gbp",
          zernioAccountId: "acc_doesnt_exist",
          data: {},
          raw: {},
        },
      }
    );
    expect(result.status).toBe("no_business");
  });

  it("duplicate question.created → status=duplicate", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, "dup");
    await insertConnection(t, businessId, "acc_dup");
    const args = {
      event: {
        externalEventId: "evt_dup_1",
        type: "question.created" as const,
        occurredAt: NOW,
        platform: "gbp" as const,
        zernioAccountId: "acc_dup",
        data: {},
        raw: {},
      },
    };
    const first = await t.mutation(
      internal.integrations.zernio.webhooks.dispatchVerifiedEventInternal,
      args
    );
    const second = await t.mutation(
      internal.integrations.zernio.webhooks.dispatchVerifiedEventInternal,
      args
    );
    expect(first.status).toBe("processed");
    expect(second.status).toBe("duplicate");
  });
});
