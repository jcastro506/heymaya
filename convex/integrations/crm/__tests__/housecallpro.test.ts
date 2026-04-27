/**
 * HCP wrapper tests — normalization + MAX-plan detection + webhook parsing.
 *
 * Five mandatory categories:
 *   1. Cross-tenant — webhook integration test.
 *   2. Plan-tier — covered in jobs.test.ts.
 *   3. Adversarial: MAX-plan probe handles 401/403/404/5xx with the right
 *      classification; non-MAX preflight auto-routes by returning
 *      `plan: "non-max"` so the action layer can persist
 *      `planTierWarning: "hcp-not-max"`.
 *   4. Sibling-file scan — repo-wide.
 *   5. TODO grep — repo-wide.
 *
 * Coverage:
 *   - mapHcpStatus: full enum mapping
 *   - normalizeHcpJob: customer name/address/phone derivation, completed_at
 *     fallback to work_timestamps
 *   - detectHcpPlan: 200 → max, 403 → non-max, 401 → auth-failed, 5xx → unknown
 *   - parseHcpWebhookEvent: forward type with event/data.id; rejects non-forward
 */

import { describe, it, expect, vi } from "vitest";
import {
  HCP_NOT_MAX_PLAN_WARNING,
  detectHcpPlan,
  mapHcpStatus,
  normalizeHcpJob,
  parseHcpWebhookEvent,
  type HcpJob,
} from "../housecallpro";
import { NangoClient } from "../nango";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("mapHcpStatus", () => {
  it("maps completed/complete → completed", () => {
    expect(mapHcpStatus("completed")).toBe("completed");
    expect(mapHcpStatus("complete")).toBe("completed");
  });
  it("maps in progress / on my way → in-progress", () => {
    expect(mapHcpStatus("in progress")).toBe("in-progress");
    expect(mapHcpStatus("in_progress")).toBe("in-progress");
    expect(mapHcpStatus("on my way")).toBe("in-progress");
    expect(mapHcpStatus("on_my_way")).toBe("in-progress");
  });
  it("maps canceled → cancelled", () => {
    expect(mapHcpStatus("canceled")).toBe("cancelled");
    expect(mapHcpStatus("cancelled")).toBe("cancelled");
  });
  it("maps unknown → scheduled", () => {
    expect(mapHcpStatus(undefined)).toBe("scheduled");
    expect(mapHcpStatus("late")).toBe("scheduled");
  });
});

describe("normalizeHcpJob", () => {
  it("derives full name + last name from customer fields", () => {
    const job: HcpJob = {
      id: "hcp_1",
      work_status: "completed",
      total_amount: 850,
      description: "AC repair",
      completed_at: "2024-01-15T18:00:00Z",
      customer: {
        id: "cust_1",
        first_name: "Jane",
        last_name: "Garcia",
        mobile_number: "555-1234",
      },
    };
    const n = normalizeHcpJob(job);
    expect(n.customerLastName).toBe("Garcia");
    expect(n.customerName).toBe("Jane Garcia");
    expect(n.customerPhone).toBe("555-1234");
    expect(n.status).toBe("completed");
    expect(n.serviceType).toBe("AC repair");
    expect(n.ticketAmountUsd).toBe(850);
  });

  it("falls back to work_timestamps.completed_at when completed_at missing", () => {
    const job: HcpJob = {
      id: "hcp_2",
      work_status: "completed",
      work_timestamps: { completed_at: "2024-02-01T10:00:00Z" },
    };
    const n = normalizeHcpJob(job);
    expect(n.completedAt).toBeGreaterThan(0);
  });

  it("falls back to company name when individual names missing", () => {
    const job: HcpJob = {
      id: "hcp_3",
      customer: { id: "c", company: "Smith HVAC" },
    };
    const n = normalizeHcpJob(job);
    expect(n.customerLastName).toBe("Smith HVAC");
  });

  it("concatenates address from customer.addresses[0]", () => {
    const job: HcpJob = {
      id: "hcp_4",
      customer: {
        id: "c",
        addresses: [
          { street: "100 Pine", city: "Austin", state: "TX", zip: "78701" },
        ],
      },
    };
    const n = normalizeHcpJob(job);
    expect(n.customerAddress).toBe("100 Pine, Austin, TX, 78701");
  });
});

describe("detectHcpPlan", () => {
  it("200 → plan: max", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { jobs: [] }));
    const client = new NangoClient({
      secretKey: "sk_test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const probe = await detectHcpPlan(client, "hcp_biz_x");
    expect(probe.plan).toBe("max");
  });

  it("403 → plan: non-max (auto-route trigger)", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(403, { error: "feature gated" })
    );
    const client = new NangoClient({
      secretKey: "sk_test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });
    const probe = await detectHcpPlan(client, "hcp_biz_x");
    expect(probe.plan).toBe("non-max");
    expect(HCP_NOT_MAX_PLAN_WARNING).toBe("hcp-not-max");
  });

  it("404 → plan: non-max", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(404, { error: "not found" })
    );
    const client = new NangoClient({
      secretKey: "sk_test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });
    const probe = await detectHcpPlan(client, "hcp_biz_x");
    expect(probe.plan).toBe("non-max");
  });

  it("401 → plan: auth-failed", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(401, { error: "unauthorized" })
    );
    const client = new NangoClient({
      secretKey: "sk_test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });
    const probe = await detectHcpPlan(client, "hcp_biz_x");
    expect(probe.plan).toBe("auth-failed");
  });

  it("5xx (after retries) → plan: unknown", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(503, { error: "upstream" })
    );
    const client = new NangoClient({
      secretKey: "sk_test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
      maxAttempts: 1,
      random: () => 0,
    });
    const probe = await detectHcpPlan(client, "hcp_biz_x");
    expect(probe.plan).toBe("unknown");
  });
});

describe("parseHcpWebhookEvent", () => {
  it("parses a forward envelope with event + id", () => {
    const evt = parseHcpWebhookEvent({
      eventId: "evt_1",
      type: "forward",
      providerConfigKey: "housecallpro",
      connectionId: "hcp_biz_x",
      providerEventName: "job.completed",
      payload: {
        event: "job.completed",
        id: "job_42",
        company_id: "co_1",
        occurred_at: "2024-01-15T18:00:00Z",
      },
    });
    expect(evt).not.toBeNull();
    expect(evt!.type).toBe("job.completed");
    expect(evt!.resourceId).toBe("job_42");
    expect(evt!.companyId).toBe("co_1");
  });

  it("rejects non-forward envelopes", () => {
    expect(
      parseHcpWebhookEvent({
        eventId: "evt_1",
        type: "auth",
        providerConfigKey: "housecallpro",
        connectionId: "c",
      })
    ).toBeNull();
  });

  it("rejects unknown event type", () => {
    expect(
      parseHcpWebhookEvent({
        eventId: "evt_1",
        type: "forward",
        providerConfigKey: "housecallpro",
        connectionId: "c",
        payload: { event: "unknown.event", id: "x" },
      })
    ).toBeNull();
  });
});
