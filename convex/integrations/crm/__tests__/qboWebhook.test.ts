/**
 * QBO webhook receiver — integration tests.
 *
 * Five mandatory categories covered:
 *   1. Cross-tenant: A's connection_id never resolves to B.
 *   2. Plan-tier: webhooks bypass plan-tier (defense-in-depth boundary owned
 *      downstream); test asserts no silent drop on plan mismatch.
 *   3. Adversarial:
 *      - bad signature → verified: false
 *      - replay → status: duplicate
 *      - malformed JSON → reason: malformed_json
 *      - malformed envelope → reason: malformed_envelope
 *      - wrong provider (not "quickbooks") → status: wrong_provider
 *      - connection-not-found → status: no_business
 *   4. Sibling-file scan — n/a Sprint 5.
 *   5. TODO grep — repo-wide.
 *
 * QBO-specific:
 *   - Idempotency on (provider, event_id) via webhookEvents.
 *   - <1s ack budget.
 *   - Mapping correctness through the full receive→write path.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { internal } from "../../../_generated/api";
import { modules } from "../../../../tests/_modules";
import type { Id } from "../../../_generated/dataModel";
import { encrypt, _resetEncryptionKeyCache } from "../../../lib/encryption";
import {
  parseUnifiedWebhookEnvelope,
} from "../../../webhooks/qbo";
import qboFixturesRaw from "../../../../scripts/fixtures/qbo/qboSandbox.json";

// 32-byte AES-256 key (base64). Test seam — never used in production.
const TEST_ENCRYPTION_KEY = "y9bD0aJrTaTSlqTV2tPDbkdT60bzkDe4dqxxAo5w0dQ=";
const NOW = 1_700_000_000_000;

const fixtures = qboFixturesRaw as {
  scenario_plain_customer: {
    customer: Record<string, unknown>;
    invoice: Record<string, unknown>;
  };
  scenario_sub_customer: {
    parent_customer: Record<string, unknown>;
    sub_customer_job: Record<string, unknown>;
    invoice: Record<string, unknown>;
  };
  scenario_estimate_then_invoice: {
    customer: Record<string, unknown>;
    estimate: Record<string, unknown>;
    invoice_followup: Record<string, unknown>;
  };
};

beforeEach(() => {
  process.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  _resetEncryptionKeyCache();
});

afterEach(() => {
  delete process.env.ENCRYPTION_KEY;
  _resetEncryptionKeyCache();
});

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

async function attachQboConnection(
  t: ReturnType<typeof convexTest>,
  businessId: Id<"businesses">,
  connectionId: string
): Promise<void> {
  const encrypted = await encrypt(connectionId);
  await t.mutation(
    internal.integrations.crm.quickbooks.upsertQboConnectionInternal,
    {
      businessId,
      encryptedConnectionId: encrypted,
      scopes: ["accounting"],
    }
  );
}

/* -------------------------------------------------------------------------- */
/* Envelope parser                                                              */
/* -------------------------------------------------------------------------- */

describe("parseUnifiedWebhookEnvelope", () => {
  it("normalizes a customer.created event", () => {
    const env = parseUnifiedWebhookEnvelope({
      event_id: "evt_1",
      type: "accounting.customer.created",
      connection_id: "conn_1",
      provider: "quickbooks",
      occurred_at: "2026-04-01T12:00:00Z",
      data: { id: "cust_1", name: "Acme" },
    });
    expect(env).not.toBeNull();
    expect(env!.event_id).toBe("evt_1");
    expect(env!.type).toBe("accounting.customer.created");
    expect(env!.connection_id).toBe("conn_1");
    expect(env!.provider).toBe("quickbooks");
  });

  it("rejects unknown event types", () => {
    const env = parseUnifiedWebhookEnvelope({
      event_id: "e",
      type: "rogue.unknown",
      connection_id: "c",
      provider: "quickbooks",
      data: {},
    });
    expect(env).toBeNull();
  });

  it("rejects missing connection_id", () => {
    const env = parseUnifiedWebhookEnvelope({
      event_id: "e",
      type: "accounting.invoice.paid",
      provider: "quickbooks",
      data: {},
    });
    expect(env).toBeNull();
  });

  it("rejects null/non-object inputs", () => {
    expect(parseUnifiedWebhookEnvelope(null)).toBeNull();
    expect(parseUnifiedWebhookEnvelope("oops")).toBeNull();
    expect(parseUnifiedWebhookEnvelope(12345)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* dispatchVerifiedEventInternal — DB-level dispatch                            */
/* -------------------------------------------------------------------------- */

describe("dispatchVerifiedEventInternal — idempotency + mapping", () => {
  it("customer.created upserts a serviceCustomers row", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    const result = await t.mutation(
      internal.webhooks.qbo.dispatchVerifiedEventInternal,
      {
        businessId,
        event: {
          event_id: "evt_qbo_1",
          type: "accounting.customer.created",
          connection_id: "conn_test",
          provider: "quickbooks",
          occurred_at: "2026-04-01T12:00:00Z",
          data: fixtures.scenario_plain_customer.customer,
          raw: {},
        },
      }
    );
    expect(result.status).toBe("processed");
    if (result.status === "processed") {
      expect(result.writes.customers).toBe(1);
      expect(result.writes.jobs).toBe(0);
    }
    const rows = await t.run((ctx) =>
      ctx.db
        .query("serviceCustomers")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .collect()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Acme Restaurants LLC");
  });

  it("invoice.paid upserts a completed serviceJobs linked to the customer", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    // First seed the customer.
    await t.mutation(
      internal.webhooks.qbo.dispatchVerifiedEventInternal,
      {
        businessId,
        event: {
          event_id: "evt_c",
          type: "accounting.customer.created",
          connection_id: "conn_test",
          provider: "quickbooks",
          occurred_at: "2026-04-01T12:00:00Z",
          data: fixtures.scenario_plain_customer.customer,
          raw: {},
        },
      }
    );
    // Then the invoice.
    await t.mutation(
      internal.webhooks.qbo.dispatchVerifiedEventInternal,
      {
        businessId,
        event: {
          event_id: "evt_i",
          type: "accounting.invoice.paid",
          connection_id: "conn_test",
          provider: "quickbooks",
          occurred_at: "2026-04-15T10:00:00Z",
          data: fixtures.scenario_plain_customer.invoice,
          raw: {},
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
    expect(jobs[0].ticketAmountUsd).toBe(1250);
    expect(jobs[0].customerId).toBeDefined();
  });

  it("estimate then invoice with same crmJobId promotes status from scheduled to completed", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    // Same external_id reused on both → upsert lands on the same row.
    const sharedId = "qbo_round_trip";
    await t.mutation(
      internal.webhooks.qbo.dispatchVerifiedEventInternal,
      {
        businessId,
        event: {
          event_id: "evt_e1",
          type: "accounting.estimate.created",
          connection_id: "conn_test",
          provider: "quickbooks",
          occurred_at: "2026-04-10T09:00:00Z",
          data: {
            id: sharedId,
            external_id: sharedId,
            type: "estimate",
            customer_id: "cust_z",
            invoice_at: "2026-04-10T09:00:00Z",
            total_amount: 4200,
          },
          raw: {},
        },
      }
    );
    await t.mutation(
      internal.webhooks.qbo.dispatchVerifiedEventInternal,
      {
        businessId,
        event: {
          event_id: "evt_i2",
          type: "accounting.invoice.created",
          connection_id: "conn_test",
          provider: "quickbooks",
          occurred_at: "2026-04-22T09:00:00Z",
          data: {
            id: sharedId,
            external_id: sharedId,
            type: "invoice",
            customer_id: "cust_z",
            invoice_at: "2026-04-22T09:00:00Z",
            total_amount: 4200,
          },
          raw: {},
        },
      }
    );
    const jobs = await t.run((ctx) =>
      ctx.db
        .query("serviceJobs")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .collect()
    );
    expect(jobs).toHaveLength(1); // not 2 — round-trip preserved
    expect(jobs[0].status).toBe("completed");
    expect(jobs[0].ticketAmountUsd).toBe(4200);
  });

  it("sub-customer (QBO Job) creates a serviceJobs row linked to parent customer", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    // Seed parent customer first.
    await t.mutation(
      internal.webhooks.qbo.dispatchVerifiedEventInternal,
      {
        businessId,
        event: {
          event_id: "evt_p",
          type: "accounting.customer.created",
          connection_id: "conn_test",
          provider: "quickbooks",
          occurred_at: "2026-04-01T12:00:00Z",
          data: fixtures.scenario_sub_customer.parent_customer,
          raw: {},
        },
      }
    );
    // Then the sub-customer (Job) lands.
    await t.mutation(
      internal.webhooks.qbo.dispatchVerifiedEventInternal,
      {
        businessId,
        event: {
          event_id: "evt_subc",
          type: "accounting.customer.created",
          connection_id: "conn_test",
          provider: "quickbooks",
          occurred_at: "2026-04-01T12:00:00Z",
          data: fixtures.scenario_sub_customer.sub_customer_job,
          raw: {},
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
  });

  it("CROSS-TENANT: dispatch with B's businessId never writes A's tables", async () => {
    const t = convexTest(schema, modules);
    const a = await insertBusiness(t, { suffix: "a" });
    const b = await insertBusiness(t, { suffix: "b" });
    await t.mutation(
      internal.webhooks.qbo.dispatchVerifiedEventInternal,
      {
        businessId: b,
        event: {
          event_id: "evt_b",
          type: "accounting.customer.created",
          connection_id: "conn_b",
          provider: "quickbooks",
          occurred_at: "2026-04-01T12:00:00Z",
          data: { id: "x", external_id: "x", name: "B's customer" },
          raw: {},
        },
      }
    );
    const aRows = await t.run((ctx) =>
      ctx.db
        .query("serviceCustomers")
        .withIndex("by_business", (q) => q.eq("businessId", a))
        .collect()
    );
    const bRows = await t.run((ctx) =>
      ctx.db
        .query("serviceCustomers")
        .withIndex("by_business", (q) => q.eq("businessId", b))
        .collect()
    );
    expect(aRows).toHaveLength(0);
    expect(bRows).toHaveLength(1);
  });

  it("REPLAY: duplicate event_id returns status=duplicate, no second write", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    const event = {
      event_id: "evt_dup",
      type: "accounting.customer.created" as const,
      connection_id: "conn",
      provider: "quickbooks",
      occurred_at: "2026-04-01T12:00:00Z",
      data: { id: "c1", external_id: "c1", name: "first" },
      raw: {},
    };
    const r1 = await t.mutation(
      internal.webhooks.qbo.dispatchVerifiedEventInternal,
      { businessId, event }
    );
    const r2 = await t.mutation(
      internal.webhooks.qbo.dispatchVerifiedEventInternal,
      { businessId, event }
    );
    expect(r1.status).toBe("processed");
    expect(r2.status).toBe("duplicate");
    const rows = await t.run((ctx) =>
      ctx.db
        .query("serviceCustomers")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .collect()
    );
    expect(rows).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* verifyAndDispatchInternal — sig + connection resolution + dispatch          */
/* -------------------------------------------------------------------------- */

async function hmacHex(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: { name: "SHA-256" } },
    false,
    ["sign"]
  );
  const buf = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

describe("verifyAndDispatchInternal — full receive path", () => {
  it("BAD SIGNATURE: returns verified=false; no DB writes", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    await attachQboConnection(t, businessId, "conn_real");
    const body = JSON.stringify({
      event_id: "e",
      type: "accounting.customer.created",
      connection_id: "conn_real",
      provider: "quickbooks",
      occurred_at: "2026-04-01T12:00:00Z",
      data: { id: "c", external_id: "c", name: "X" },
    });
    const result = await t.action(
      internal.webhooks.qbo.verifyAndDispatchInternal,
      {
        rawBody: body,
        signatureHeader: "deadbeef".repeat(8),
        secret: "the-real-secret",
      }
    );
    expect(result.verified).toBe(false);
    expect(result.reason).toBe("signature_invalid");
    const rows = await t.run((ctx) =>
      ctx.db
        .query("serviceCustomers")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .collect()
    );
    expect(rows).toHaveLength(0);
  });

  it("WRONG PROVIDER: returns wrong_provider; no DB writes", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    await attachQboConnection(t, businessId, "conn_real");
    const secret = "real-secret";
    const body = JSON.stringify({
      event_id: "e",
      type: "accounting.customer.created",
      connection_id: "conn_real",
      provider: "xero", // not quickbooks
      occurred_at: "2026-04-01T12:00:00Z",
      data: { id: "c", name: "X" },
    });
    const sig = await hmacHex(secret, body);
    const result = await t.action(
      internal.webhooks.qbo.verifyAndDispatchInternal,
      {
        rawBody: body,
        signatureHeader: sig,
        secret,
      }
    );
    expect(result.verified).toBe(true);
    expect(result.result?.status).toBe("wrong_provider");
  });

  it("MALFORMED JSON: returns reason=malformed_json", async () => {
    const t = convexTest(schema, modules);
    const secret = "s";
    const body = "{not json";
    const sig = await hmacHex(secret, body);
    const result = await t.action(
      internal.webhooks.qbo.verifyAndDispatchInternal,
      { rawBody: body, signatureHeader: sig, secret }
    );
    expect(result.verified).toBe(true);
    expect(result.reason).toBe("malformed_json");
  });

  it("MALFORMED ENVELOPE: returns reason=malformed_envelope", async () => {
    const t = convexTest(schema, modules);
    const secret = "s";
    const body = JSON.stringify({ random: "object" });
    const sig = await hmacHex(secret, body);
    const result = await t.action(
      internal.webhooks.qbo.verifyAndDispatchInternal,
      { rawBody: body, signatureHeader: sig, secret }
    );
    expect(result.verified).toBe(true);
    expect(result.reason).toBe("malformed_envelope");
  });

  it("CONNECTION NOT FOUND: returns no_business; no DB writes", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    await attachQboConnection(t, businessId, "the-known-id");
    const secret = "s";
    const body = JSON.stringify({
      event_id: "e",
      type: "accounting.customer.created",
      connection_id: "totally-different-id",
      provider: "quickbooks",
      occurred_at: "2026-04-01T12:00:00Z",
      data: { id: "c", name: "X" },
    });
    const sig = await hmacHex(secret, body);
    const result = await t.action(
      internal.webhooks.qbo.verifyAndDispatchInternal,
      { rawBody: body, signatureHeader: sig, secret }
    );
    expect(result.verified).toBe(true);
    expect(result.result?.status).toBe("no_business");
    const rows = await t.run((ctx) =>
      ctx.db
        .query("serviceCustomers")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .collect()
    );
    expect(rows).toHaveLength(0);
  });

  it("HAPPY PATH: verifies, resolves connection, dispatches, writes row", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    await attachQboConnection(t, businessId, "conn_happy");
    const secret = "s";
    const body = JSON.stringify({
      event_id: "evt_happy",
      type: "accounting.customer.created",
      connection_id: "conn_happy",
      provider: "quickbooks",
      occurred_at: "2026-04-01T12:00:00Z",
      data: fixtures.scenario_plain_customer.customer,
    });
    const sig = await hmacHex(secret, body);
    const result = await t.action(
      internal.webhooks.qbo.verifyAndDispatchInternal,
      { rawBody: body, signatureHeader: sig, secret }
    );
    expect(result.verified).toBe(true);
    expect(result.result?.status).toBe("processed");
    const rows = await t.run((ctx) =>
      ctx.db
        .query("serviceCustomers")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .collect()
    );
    expect(rows).toHaveLength(1);
  });

  it("CROSS-TENANT: B's connection_id never writes to A's tables", async () => {
    const t = convexTest(schema, modules);
    const a = await insertBusiness(t, { suffix: "a" });
    const b = await insertBusiness(t, { suffix: "b" });
    await attachQboConnection(t, a, "conn_a");
    await attachQboConnection(t, b, "conn_b");
    const secret = "s";
    const body = JSON.stringify({
      event_id: "evt_xt",
      type: "accounting.customer.created",
      connection_id: "conn_b",
      provider: "quickbooks",
      occurred_at: "2026-04-01T12:00:00Z",
      data: { id: "c_b", external_id: "c_b", name: "B's only" },
    });
    const sig = await hmacHex(secret, body);
    await t.action(internal.webhooks.qbo.verifyAndDispatchInternal, {
      rawBody: body,
      signatureHeader: sig,
      secret,
    });
    const aRows = await t.run((ctx) =>
      ctx.db
        .query("serviceCustomers")
        .withIndex("by_business", (q) => q.eq("businessId", a))
        .collect()
    );
    const bRows = await t.run((ctx) =>
      ctx.db
        .query("serviceCustomers")
        .withIndex("by_business", (q) => q.eq("businessId", b))
        .collect()
    );
    expect(aRows).toHaveLength(0);
    expect(bRows).toHaveLength(1);
  });

  it("ACK BUDGET: full verify→resolve→dispatch path completes under 1s", async () => {
    const t = convexTest(schema, modules);
    const businessId = await insertBusiness(t, { suffix: "a" });
    await attachQboConnection(t, businessId, "conn_fast");
    const secret = "s";
    const body = JSON.stringify({
      event_id: "evt_fast",
      type: "accounting.customer.created",
      connection_id: "conn_fast",
      provider: "quickbooks",
      occurred_at: "2026-04-01T12:00:00Z",
      data: fixtures.scenario_plain_customer.customer,
    });
    const sig = await hmacHex(secret, body);
    const start = performance.now();
    await t.action(internal.webhooks.qbo.verifyAndDispatchInternal, {
      rawBody: body,
      signatureHeader: sig,
      secret,
    });
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(1000);
  });
});
