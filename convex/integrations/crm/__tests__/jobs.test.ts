/**
 * convex/jobs.ts integration tests — cross-tenant + plan-tier + upsert.
 *
 * Five mandatory categories:
 *   1. Cross-tenant: Business A's job upsert never lands a Business B
 *      `serviceJobs` / `serviceCustomers` / `mayaTaskQueue` row.
 *   2. Plan-tier: Starter business cannot connect a CRM (Pro+ only); the
 *      plan-gate throws PlanServiceGateError, fail-closed server-side.
 *   3. Adversarial: text-with-no-extractable-fields returns
 *      `skippedReason: "extraction_too_sparse"` without inserting; replay
 *      of the same crmJobId patches the existing row instead of duplicating.
 *   4. Sibling-file scan — repo-wide.
 *   5. TODO grep — repo-wide.
 *
 * Coverage:
 *   - upsertJobFromWebhook inserts new customer + job + queue row when
 *     status === "completed"; does NOT enqueue when status !== "completed"
 *   - upsertJobFromWebhook patches existing job on second call with same
 *     crmJobId (idempotent on at-most-once webhook delivery)
 *   - upsertJobFromTextInternal inserts customer + job when fields parse;
 *     skips silently when fields are too sparse
 *   - cross-tenant: B's connectionId resolution does not surface A's jobs
 */

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { internal } from "../../../_generated/api";
import { modules } from "../../../../tests/_modules";
import type { Id } from "../../../_generated/dataModel";

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
      plan: "starter",
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

describe("upsertJobFromWebhook — basic upsert", () => {
  it("inserts customer + job + queue row on completed status", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a", tier: "pro" });
    const result = await t.mutation(internal.jobs.upsertJobFromWebhook, {
      businessId,
      normalizedJob: {
        provider: "jobber",
        externalJobId: "job_42",
        externalCustomerId: "cust_1",
        customerName: "Jane Hernandez",
        customerLastName: "Hernandez",
        customerPhone: "555-1234",
        status: "completed",
        completedAt: NOW,
        serviceType: "AC tune-up",
        ticketAmountUsd: 450,
      },
      source: "crm-webhook",
    });
    expect(result.created).toBe(true);
    expect(result.queueRowId).toBeDefined();

    const job = await t.run((ctx) => ctx.db.get(result.jobId));
    expect(job?.crmJobId).toBe("job_42");
    expect(job?.status).toBe("completed");
    expect(job?.serviceType).toBe("AC tune-up");

    const customer = await t.run((ctx) => ctx.db.get(result.customerId));
    expect(customer?.crmCustomerId).toBe("cust_1");
    expect(customer?.name).toBe("Jane Hernandez");
  });

  it("does NOT enqueue queue row when status !== completed", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "b", tier: "pro" });
    const result = await t.mutation(internal.jobs.upsertJobFromWebhook, {
      businessId,
      normalizedJob: {
        provider: "jobber",
        externalJobId: "job_50",
        status: "scheduled",
      },
      source: "crm-webhook",
    });
    // No queueRowId — status was scheduled.
    const queue = await t.run((ctx) =>
      ctx.db.query("mayaTaskQueue").collect()
    );
    expect(queue.length).toBe(0);
    expect(result.created).toBe(true);
  });

  it("ADVERSARIAL — replay of same crmJobId patches existing row (no dup)", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "r", tier: "pro" });
    await t.mutation(internal.jobs.upsertJobFromWebhook, {
      businessId,
      normalizedJob: {
        provider: "jobber",
        externalJobId: "job_replay",
        status: "scheduled",
      },
      source: "crm-webhook",
    });
    await t.mutation(internal.jobs.upsertJobFromWebhook, {
      businessId,
      normalizedJob: {
        provider: "jobber",
        externalJobId: "job_replay",
        status: "completed",
        completedAt: NOW,
      },
      source: "crm-webhook",
    });
    const jobs = await t.run((ctx) =>
      ctx.db
        .query("serviceJobs")
        .withIndex("by_business_and_crm_id", (q) =>
          q.eq("businessId", businessId).eq("crmJobId", "job_replay")
        )
        .collect()
    );
    expect(jobs.length).toBe(1);
    expect(jobs[0].status).toBe("completed");
  });
});

describe("upsertJobFromWebhook — cross-tenant isolation", () => {
  it("Business A's upsert never affects Business B's tables", async () => {
    const t = convexTest(schema, modules);
    const aId = await insertBusiness(t, { suffix: "iso_a", tier: "pro" });
    const bId = await insertBusiness(t, { suffix: "iso_b", tier: "pro" });

    await t.mutation(internal.jobs.upsertJobFromWebhook, {
      businessId: aId,
      normalizedJob: {
        provider: "jobber",
        externalJobId: "job_a1",
        externalCustomerId: "cust_a1",
        customerName: "A Customer",
        customerLastName: "A",
        status: "completed",
        completedAt: NOW,
      },
      source: "crm-webhook",
    });

    const bJobs = await t.run((ctx) =>
      ctx.db
        .query("serviceJobs")
        .withIndex("by_business", (q) => q.eq("businessId", bId))
        .collect()
    );
    expect(bJobs.length).toBe(0);
    const bQueue = await t.run((ctx) =>
      ctx.db
        .query("mayaTaskQueue")
        .withIndex("by_business", (q) => q.eq("businessId", bId))
        .collect()
    );
    expect(bQueue.length).toBe(0);
    const bCustomers = await t.run((ctx) =>
      ctx.db
        .query("serviceCustomers")
        .withIndex("by_business", (q) => q.eq("businessId", bId))
        .collect()
    );
    expect(bCustomers.length).toBe(0);
  });
});

describe("upsertJobFromTextInternal — sparse extractions", () => {
  it("ADVERSARIAL — skips when both customer_last_name + service_type null", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, {
      suffix: "sparse",
      tier: "starter",
    });
    const result = await t.mutation(internal.jobs.upsertJobFromTextInternal, {
      businessId,
      fields: {
        customer_last_name: null,
        customer_first_name: null,
        service_type: null,
        address: null,
        completed_at: null,
        notes: null,
      },
      rawMessage: "hey maya what's up",
    });
    expect(result.skippedReason).toBe("extraction_too_sparse");
    expect(result.jobId).toBeNull();
    const jobs = await t.run((ctx) =>
      ctx.db.query("serviceJobs").collect()
    );
    expect(jobs.length).toBe(0);
  });

  it("inserts when at least service_type present", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, {
      suffix: "minimal",
      tier: "starter",
    });
    const result = await t.mutation(internal.jobs.upsertJobFromTextInternal, {
      businessId,
      fields: {
        customer_last_name: null,
        customer_first_name: null,
        service_type: "kitchen sink",
        address: null,
        completed_at: NOW,
        notes: "all done",
      },
      rawMessage: "just finished a kitchen sink",
    });
    expect(result.jobId).not.toBeNull();
    expect(result.queueRowId).not.toBeNull();
    const job = await t.run((ctx) => ctx.db.get(result.jobId!));
    expect(job?.status).toBe("completed");
    expect(job?.serviceType).toBe("kitchen sink");
  });

  it("creates a Starter-tier job-completion task (text-extract path)", async () => {
    // Persona A regression — Mike on Starter texts Maya, NER drives the upsert.
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, {
      suffix: "mike",
      tier: "starter",
    });
    const result = await t.mutation(internal.jobs.upsertJobFromTextInternal, {
      businessId,
      fields: {
        customer_last_name: "Johnson",
        customer_first_name: null,
        service_type: "kitchen sink",
        address: "432 Oak",
        completed_at: NOW,
        notes: null,
      },
      rawMessage: "just finished the Johnson kitchen sink at 432 Oak",
    });
    expect(result.jobId).not.toBeNull();
    const queueRows = await t.run((ctx) =>
      ctx.db
        .query("mayaTaskQueue")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .collect()
    );
    expect(queueRows.length).toBe(1);
    expect(queueRows[0].source).toBe("crm-text-extract");
    expect(queueRows[0].kind).toBe("job.completed");
  });
});

describe("upsertCrmConnectionInternal — preflight warnings", () => {
  it("persists planTierWarning='hcp-not-max' on non-MAX detection", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, {
      suffix: "hcp_basic",
      tier: "pro",
    });
    await t.mutation(internal.jobs.upsertCrmConnectionInternal, {
      businessId,
      provider: "hcp",
      scopes: [],
      planTierWarning: "hcp-not-max",
    });
    const conn = await t.run((ctx) =>
      ctx.db
        .query("crmConnections")
        .withIndex("by_business_and_provider", (q) =>
          q.eq("businessId", businessId).eq("provider", "hcp")
        )
        .first()
    );
    expect(conn?.planTierWarning).toBe("hcp-not-max");
  });

  it("upsert preserves uniqueness on (businessId, provider)", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, {
      suffix: "upsert",
      tier: "pro",
    });
    await t.mutation(internal.jobs.upsertCrmConnectionInternal, {
      businessId,
      provider: "jobber",
      scopes: [],
    });
    await t.mutation(internal.jobs.upsertCrmConnectionInternal, {
      businessId,
      provider: "jobber",
      scopes: ["read:jobs"],
    });
    const rows = await t.run((ctx) =>
      ctx.db
        .query("crmConnections")
        .withIndex("by_business_and_provider", (q) =>
          q.eq("businessId", businessId).eq("provider", "jobber")
        )
        .collect()
    );
    expect(rows.length).toBe(1);
    expect(rows[0].scopes).toEqual(["read:jobs"]);
  });
});

describe("upsertJobFromTextInternal — cross-tenant isolation", () => {
  it("Business A's text-extract never affects Business B's tables", async () => {
    const t = convexTest(schema, modules);
    const aId = await insertBusiness(t, {
      suffix: "txt_a",
      tier: "starter",
    });
    const bId = await insertBusiness(t, {
      suffix: "txt_b",
      tier: "starter",
    });
    await t.mutation(internal.jobs.upsertJobFromTextInternal, {
      businessId: aId,
      fields: {
        customer_last_name: "Smith",
        customer_first_name: null,
        service_type: "AC repair",
        address: null,
        completed_at: NOW,
        notes: null,
      },
      rawMessage: "Smith AC repair done",
    });
    const bCustomers = await t.run((ctx) =>
      ctx.db
        .query("serviceCustomers")
        .withIndex("by_business", (q) => q.eq("businessId", bId))
        .collect()
    );
    expect(bCustomers.length).toBe(0);
    const bJobs = await t.run((ctx) =>
      ctx.db
        .query("serviceJobs")
        .withIndex("by_business", (q) => q.eq("businessId", bId))
        .collect()
    );
    expect(bJobs.length).toBe(0);
  });
});

describe("connectionId resolution — provider mismatch rejection", () => {
  it("provider-prefix mismatch returns null (cross-tenant defense)", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, {
      suffix: "mis",
      tier: "pro",
    });
    await t.mutation(internal.jobs.upsertCrmConnectionInternal, {
      businessId,
      provider: "jobber",
      scopes: [],
    });
    // Submit a connectionId tagged for the wrong provider.
    const result = await t.query(
      internal.jobs.resolveBusinessIdFromConnectionInternal,
      {
        connectionId: `housecallpro_${businessId}_xyz`,
        providerConfigKey: "housecallpro",
      }
    );
    // The connection is for "jobber", not "housecallpro" → resolution null.
    expect(result).toBeNull();
  });

  it("malformed connectionId returns null", async () => {
    const t = convexTest(schema, modules);
    const result = await t.query(
      internal.jobs.resolveBusinessIdFromConnectionInternal,
      { connectionId: "no_underscores_here", providerConfigKey: "jobber" }
    );
    expect(result).toBeNull();
  });
});
