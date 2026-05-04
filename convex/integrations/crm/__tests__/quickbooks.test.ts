/**
 * QBO via Unified.to — integration tests.
 *
 * Five mandatory test categories:
 *   1. Cross-tenant isolation: Business B's QBO data NEVER appears for A.
 *   2. Plan-tier × action: Starter rejected fail-closed; Pro+ accepted.
 *   3. Adversarial: malformed mappings, self-referential parent_id rejected.
 *   4. Sibling-file scan — n/a (no cron yet).
 *   5. TODO grep — repo-wide.
 *
 * QBO-specific:
 *   - Mapping correctness: 3 fixtures (plain, sub-customer, estimate→invoice
 *     round-trip preserves crmJobId).
 *   - parent_id → local serviceCustomers Id resolution scoped per-business.
 */

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { internal } from "../../../_generated/api";
import { modules } from "../../../../tests/_modules";
import type { Id } from "../../../_generated/dataModel";
import {
  classifyCustomerEntity,
  mapCustomerToServiceRow,
  mapInvoiceToServiceJob,
  mapSubCustomerToServiceJob,
} from "../quickbooks";
import qboFixturesRaw from "../../../../scripts/fixtures/qbo/qboSandbox.json";

const NOW = 1_700_000_000_000;

// Narrow the JSON to the shape our tests use; unknown fields are tolerated.
type CustomerFixture = {
  id: string;
  external_id?: string;
  name?: string;
  parent_id?: string | null;
  is_job?: boolean;
  emails?: Array<{ email: string }>;
  telephones?: Array<{ telephone: string }>;
  address?: {
    address1?: string;
    address2?: string;
    city?: string;
    region?: string;
    postal_code?: string;
    country?: string;
  };
  active?: boolean;
};

type InvoiceFixture = {
  id: string;
  external_id?: string;
  type: "invoice" | "estimate" | "quote";
  customer_id?: string;
  invoice_at?: string;
  total_amount?: number;
  status?: string;
  line_items?: Array<{ description?: string; total_amount?: number }>;
  notes?: string;
};

const fixtures = qboFixturesRaw as {
  scenario_plain_customer: {
    customer: CustomerFixture;
    invoice: InvoiceFixture;
  };
  scenario_sub_customer: {
    parent_customer: CustomerFixture;
    sub_customer_job: CustomerFixture;
    invoice: InvoiceFixture;
  };
  scenario_estimate_then_invoice: {
    customer: CustomerFixture;
    estimate: InvoiceFixture;
    invoice_followup: InvoiceFixture;
  };
};

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
      plan: "coach",
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

/* -------------------------------------------------------------------------- */
/* Pure-function mapping tests (no DB)                                          */
/* -------------------------------------------------------------------------- */

describe("classifyCustomerEntity", () => {
  it("classifies a top-level customer as 'customer'", () => {
    expect(classifyCustomerEntity(fixtures.scenario_plain_customer.customer)).toBe(
      "customer"
    );
  });

  it("classifies a sub-customer with is_job=true as 'job'", () => {
    expect(
      classifyCustomerEntity(fixtures.scenario_sub_customer.sub_customer_job)
    ).toBe("job");
  });

  it("treats sub-customer without is_job=true as 'customer' (defensive)", () => {
    expect(
      classifyCustomerEntity({
        ...fixtures.scenario_sub_customer.sub_customer_job,
        is_job: false,
      })
    ).toBe("customer");
  });
});

describe("mapCustomerToServiceRow", () => {
  it("maps a plain QBO customer to serviceCustomers shape", () => {
    const out = mapCustomerToServiceRow(
      fixtures.scenario_plain_customer.customer
    );
    expect(out.crmCustomerId).toBe("uniq_cust_001");
    expect(out.name).toBe("Acme Restaurants LLC");
    expect(out.phone).toBe("+15551112222");
    expect(out.email).toBe("ops@acmerestaurants.example");
    expect(out.address).toContain("Austin");
    expect(out.address).toContain("78701");
  });

  it("rejects a customer with a self-referential parent_id", () => {
    expect(() =>
      mapCustomerToServiceRow({
        id: "x",
        parent_id: "x",
        name: "self-ref",
      })
    ).toThrow(/self-referential/);
  });

  it("rejects a customer missing id", () => {
    expect(() =>
      mapCustomerToServiceRow({ name: "no id" } as CustomerFixture)
    ).toThrow(/missing id/);
  });

  it("falls back to id when external_id is absent", () => {
    const out = mapCustomerToServiceRow({
      id: "uniq_only",
      name: "no-ext",
    });
    expect(out.crmCustomerId).toBe("uniq_only");
  });
});

describe("mapSubCustomerToServiceJob", () => {
  it("maps a sub-customer to a serviceJobs projection with parentCrmCustomerId", () => {
    const out = mapSubCustomerToServiceJob(
      fixtures.scenario_sub_customer.sub_customer_job
    );
    expect(out.crmJobId).toBe("uniq_cust_011");
    expect(out.parentCrmCustomerId).toBe("uniq_cust_010");
    expect(out.notes).toContain("Riverdale");
  });
});

describe("mapInvoiceToServiceJob", () => {
  it("maps a paid invoice to a completed serviceJobs projection with totals", () => {
    const out = mapInvoiceToServiceJob(
      fixtures.scenario_plain_customer.invoice
    );
    expect(out.crmJobId).toBe("uniq_inv_001");
    expect(out.customerCrmId).toBe("uniq_cust_001");
    expect(out.status).toBe("completed");
    expect(out.ticketAmountUsd).toBe(1250.0);
    expect(out.serviceType).toBe("HVAC system tune-up");
  });

  it("maps an estimate to a scheduled serviceJobs projection (no completion)", () => {
    const out = mapInvoiceToServiceJob(
      fixtures.scenario_estimate_then_invoice.estimate
    );
    expect(out.status).toBe("scheduled");
    expect(out.completedAt).toBeUndefined();
  });

  it("preserves crmJobId across estimate→invoice round-trip", () => {
    // The fixture deliberately reuses the same Unified `id` for the estimate
    // and its follow-up invoice, simulating Unified's pattern where a
    // converted estimate retains its stable Unified id (the underlying QBO
    // LinkedTxn join is materialized on Unified's side). external_id varies
    // (qbo_est_500 vs qbo_inv_501) because QBO assigns a new DocNumber on
    // conversion — but the upsert key is Unified id, so both events land
    // on the same serviceJobs row.
    const e = mapInvoiceToServiceJob(
      fixtures.scenario_estimate_then_invoice.estimate
    );
    const i = mapInvoiceToServiceJob(
      fixtures.scenario_estimate_then_invoice.invoice_followup
    );
    expect(e.crmJobId).toBe("uniq_est_020");
    expect(i.crmJobId).toBe("uniq_est_020");
    expect(e.crmJobId).toBe(i.crmJobId);
    // Status promotes scheduled → completed across the round-trip.
    expect(e.status).toBe("scheduled");
    expect(i.status).toBe("completed");
  });

  it("rejects an invoice missing id", () => {
    expect(() =>
      mapInvoiceToServiceJob({ type: "invoice" } as InvoiceFixture)
    ).toThrow(/missing id/);
  });
});

/* -------------------------------------------------------------------------- */
/* Mutation-level tests (DB)                                                    */
/* -------------------------------------------------------------------------- */

describe("upsertServiceCustomerInternal", () => {
  it("inserts a new serviceCustomers row scoped to businessId", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    await t.mutation(
      internal.integrations.crm.quickbooks.upsertServiceCustomerInternal,
      {
        businessId,
        projection: {
          crmCustomerId: "qbo_cust_42",
          name: "Acme",
        },
      }
    );
    const rows = await t.run((ctx) =>
      ctx.db
        .query("serviceCustomers")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .collect()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].crmCustomerId).toBe("qbo_cust_42");
  });

  it("CROSS-TENANT: Business B's QBO customer never appears for A", async () => {
    const t = convexTest(schema, modules);
    const businessA = await insertBusiness(t, { suffix: "a" });
    const businessB = await insertBusiness(t, { suffix: "b" });
    await t.mutation(
      internal.integrations.crm.quickbooks.upsertServiceCustomerInternal,
      {
        businessId: businessB,
        projection: { crmCustomerId: "qbo_b_only", name: "B-customer" },
      }
    );
    const aRows = await t.run((ctx) =>
      ctx.db
        .query("serviceCustomers")
        .withIndex("by_business", (q) => q.eq("businessId", businessA))
        .collect()
    );
    const bRows = await t.run((ctx) =>
      ctx.db
        .query("serviceCustomers")
        .withIndex("by_business", (q) => q.eq("businessId", businessB))
        .collect()
    );
    expect(aRows).toHaveLength(0);
    expect(bRows).toHaveLength(1);
  });

  it("idempotent on repeat with same crmCustomerId — patches not inserts", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    await t.mutation(
      internal.integrations.crm.quickbooks.upsertServiceCustomerInternal,
      {
        businessId,
        projection: { crmCustomerId: "x", name: "first" },
      }
    );
    await t.mutation(
      internal.integrations.crm.quickbooks.upsertServiceCustomerInternal,
      {
        businessId,
        projection: { crmCustomerId: "x", name: "second" },
      }
    );
    const rows = await t.run((ctx) =>
      ctx.db
        .query("serviceCustomers")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .collect()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("second");
  });
});

describe("upsertServiceJobFromInvoiceInternal", () => {
  it("links to the parent serviceCustomers row when one exists", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    // Pre-create the parent customer.
    await t.mutation(
      internal.integrations.crm.quickbooks.upsertServiceCustomerInternal,
      {
        businessId,
        projection: { crmCustomerId: "uniq_cust_001", name: "Acme" },
      }
    );
    await t.mutation(
      internal.integrations.crm.quickbooks.upsertServiceJobFromInvoiceInternal,
      {
        businessId,
        projection: {
          crmJobId: "qbo_inv_777",
          customerCrmId: "uniq_cust_001",
          status: "completed",
          ticketAmountUsd: 1250,
        },
      }
    );
    const jobs = await t.run((ctx) =>
      ctx.db
        .query("serviceJobs")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .collect()
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0].customerId).toBeDefined();
    expect(jobs[0].ticketAmountUsd).toBe(1250);
  });

  it("estimate → invoice round-trip preserves the same row when crmJobId reused", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    // First, the estimate lands.
    await t.mutation(
      internal.integrations.crm.quickbooks.upsertServiceJobFromInvoiceInternal,
      {
        businessId,
        projection: {
          crmJobId: "stable_id",
          customerCrmId: "cust_x",
          status: "scheduled",
        },
      }
    );
    // Then the converted invoice lands with the same crmJobId.
    await t.mutation(
      internal.integrations.crm.quickbooks.upsertServiceJobFromInvoiceInternal,
      {
        businessId,
        projection: {
          crmJobId: "stable_id",
          customerCrmId: "cust_x",
          status: "completed",
          ticketAmountUsd: 4200,
          completedAt: NOW,
        },
      }
    );
    const jobs = await t.run((ctx) =>
      ctx.db
        .query("serviceJobs")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .collect()
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("completed");
    expect(jobs[0].ticketAmountUsd).toBe(4200);
  });

  it("CROSS-TENANT: parent_id resolution scoped per-business", async () => {
    const t = convexTest(schema, modules);
    const a = await insertBusiness(t, { suffix: "a" });
    const b = await insertBusiness(t, { suffix: "b" });
    // Same crmCustomerId in both businesses (legal — different tenants).
    await t.mutation(
      internal.integrations.crm.quickbooks.upsertServiceCustomerInternal,
      { businessId: a, projection: { crmCustomerId: "shared_id", name: "A's" } }
    );
    await t.mutation(
      internal.integrations.crm.quickbooks.upsertServiceCustomerInternal,
      { businessId: b, projection: { crmCustomerId: "shared_id", name: "B's" } }
    );
    // A's invoice should resolve to A's customer, not B's.
    await t.mutation(
      internal.integrations.crm.quickbooks.upsertServiceJobFromInvoiceInternal,
      {
        businessId: a,
        projection: {
          crmJobId: "job_a",
          customerCrmId: "shared_id",
          status: "completed",
        },
      }
    );
    const aJobs = await t.run((ctx) =>
      ctx.db
        .query("serviceJobs")
        .withIndex("by_business", (q) => q.eq("businessId", a))
        .collect()
    );
    expect(aJobs).toHaveLength(1);
    const aCustomers = await t.run((ctx) =>
      ctx.db
        .query("serviceCustomers")
        .withIndex("by_business", (q) => q.eq("businessId", a))
        .collect()
    );
    expect(aJobs[0].customerId).toBe(aCustomers[0]._id);
  });
});

/* -------------------------------------------------------------------------- */
/* Plan-tier gating                                                            */
/* -------------------------------------------------------------------------- */

describe("planFeaturesService — QBO connect gate", () => {
  it("Starter does NOT have crmIntegration enabled (server-side fail-closed)", async () => {
    const { planFeaturesService } = await import("../../../planService");
    const features = planFeaturesService({ planTier: "starter" });
    expect(features.crmIntegration).toBe(false);
  });

  it("Pro has crmIntegration enabled", async () => {
    const { planFeaturesService } = await import("../../../planService");
    const features = planFeaturesService({ planTier: "pro" });
    expect(features.crmIntegration).toBe(true);
  });

  it("Studio has crmIntegration enabled", async () => {
    const { planFeaturesService } = await import("../../../planService");
    const features = planFeaturesService({ planTier: "studio" });
    expect(features.crmIntegration).toBe(true);
  });

  it("Unset planTier (mid-onboarding) fails closed to Starter (no crmIntegration)", async () => {
    const { planFeaturesService } = await import("../../../planService");
    const features = planFeaturesService({});
    expect(features.crmIntegration).toBe(false);
  });

  it("requireFeatureService throws PlanServiceGateError on Starter", async () => {
    const { requireFeatureService, PlanServiceGateError } = await import(
      "../../../planService"
    );
    expect(() =>
      requireFeatureService(
        { planTier: "starter" },
        (f) => f.crmIntegration === true,
        "qbo:connect",
        "pro"
      )
    ).toThrow(PlanServiceGateError);
  });

  it("requireFeatureService passes silently on Pro", async () => {
    const { requireFeatureService } = await import("../../../planService");
    expect(() =>
      requireFeatureService(
        { planTier: "pro" },
        (f) => f.crmIntegration === true,
        "qbo:connect",
        "pro"
      )
    ).not.toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* Connection persistence + retrieval                                           */
/* -------------------------------------------------------------------------- */

describe("upsertQboConnectionInternal", () => {
  it("persists encrypted connection id under provider 'qbo'", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    await t.mutation(
      internal.integrations.crm.quickbooks.upsertQboConnectionInternal,
      {
        businessId,
        encryptedConnectionId: "fake-encrypted-blob",
        scopes: ["accounting"],
      }
    );
    const rows = await t.run((ctx) =>
      ctx.db
        .query("crmConnections")
        .withIndex("by_business_and_provider", (q) =>
          q.eq("businessId", businessId).eq("provider", "qbo")
        )
        .collect()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].oauthAccessToken).toBe("fake-encrypted-blob");
    expect(rows[0].oauthRefreshToken).toBeUndefined();
  });

  it("disconnect removes the row", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    await t.mutation(
      internal.integrations.crm.quickbooks.upsertQboConnectionInternal,
      {
        businessId,
        encryptedConnectionId: "blob",
        scopes: ["accounting"],
      }
    );
    const result = await t.mutation(
      internal.integrations.crm.quickbooks.deleteConnectionInternal,
      { businessId }
    );
    expect(result.disconnected).toBe(true);
    const rows = await t.run((ctx) =>
      ctx.db
        .query("crmConnections")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .collect()
    );
    expect(rows).toHaveLength(0);
  });
});
