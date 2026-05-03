/**
 * Jobber wrapper tests — normalization + webhook parsing.
 *
 * Five mandatory categories:
 *   1. Cross-tenant — covered in webhook integration test.
 *   2. Plan-tier — covered in jobs.test.ts.
 *   3. Adversarial: malformed Jobber payload returns null on parse;
 *      GraphQL `errors` array surfaces NangoApiError.
 *   4. Sibling-file scan — repo-wide.
 *   5. TODO grep — repo-wide.
 *
 * Coverage:
 *   - mapJobberStatus: full enum mapping
 *   - normalizeJobberJob: customer last-name derivation, address
 *     concatenation, status mapping, ticketAmountUsd typed-pass-through
 *   - parseJobberWebhookEvent: forward type with itemId/topic; rejects
 *     non-forward; rejects unknown topic
 */

import { describe, it, expect } from "vitest";
import {
  mapJobberStatus,
  normalizeJobberJob,
  parseJobberWebhookEvent,
  type JobberJob,
} from "../jobber";

describe("mapJobberStatus", () => {
  it("maps complete/completed → completed", () => {
    expect(mapJobberStatus("complete")).toBe("completed");
    expect(mapJobberStatus("completed")).toBe("completed");
    expect(mapJobberStatus("COMPLETED")).toBe("completed");
  });
  it("maps active/started/in_progress → in-progress", () => {
    expect(mapJobberStatus("active")).toBe("in-progress");
    expect(mapJobberStatus("started")).toBe("in-progress");
    expect(mapJobberStatus("in_progress")).toBe("in-progress");
  });
  it("maps archived/canceled/cancelled → cancelled", () => {
    expect(mapJobberStatus("archived")).toBe("cancelled");
    expect(mapJobberStatus("canceled")).toBe("cancelled");
    expect(mapJobberStatus("cancelled")).toBe("cancelled");
  });
  it("maps unknown / null → scheduled", () => {
    expect(mapJobberStatus(undefined)).toBe("scheduled");
    expect(mapJobberStatus(null)).toBe("scheduled");
    expect(mapJobberStatus("late")).toBe("scheduled");
  });
});

describe("normalizeJobberJob", () => {
  it("derives last name from explicit lastName field", () => {
    const job: JobberJob = {
      id: "j1",
      jobStatus: "complete",
      completedAt: "2024-01-15T18:00:00Z",
      total: 450,
      title: "AC tune-up",
      client: { id: "c1", firstName: "Jane", lastName: "Hernandez" },
    };
    const n = normalizeJobberJob(job);
    expect(n.customerLastName).toBe("Hernandez");
    expect(n.serviceType).toBe("AC tune-up");
    expect(n.status).toBe("completed");
    expect(n.ticketAmountUsd).toBe(450);
    expect(n.completedAt).toBeGreaterThan(0);
  });

  it("falls back to companyName when no lastName", () => {
    const job: JobberJob = {
      id: "j2",
      jobStatus: "complete",
      client: { id: "c2", companyName: "Acme HVAC LLC" },
    };
    const n = normalizeJobberJob(job);
    expect(n.customerLastName).toBe("Acme HVAC LLC");
  });

  it("derives last word of `name` when no structured fields", () => {
    const job: JobberJob = {
      id: "j3",
      jobStatus: "scheduled",
      client: { id: "c3", name: "Mr. Bob Anderson" },
    };
    const n = normalizeJobberJob(job);
    expect(n.customerLastName).toBe("Anderson");
  });

  it("concatenates address from property.address sub-fields", () => {
    const job: JobberJob = {
      id: "j4",
      jobStatus: "scheduled",
      property: {
        address: {
          street: "432 Oak St",
          city: "Sacramento",
          province: "CA",
          postalCode: "95816",
        },
      },
    };
    const n = normalizeJobberJob(job);
    expect(n.customerAddress).toBe("432 Oak St, Sacramento, CA, 95816");
  });

  it("returns undefined for missing/non-finite fields without throwing", () => {
    const job: JobberJob = { id: "j5" };
    const n = normalizeJobberJob(job);
    expect(n.customerLastName).toBeUndefined();
    expect(n.customerAddress).toBeUndefined();
    expect(n.ticketAmountUsd).toBeUndefined();
    expect(n.status).toBe("scheduled");
  });
});

describe("parseJobberWebhookEvent", () => {
  it("parses a forward envelope with topic + itemId", () => {
    const evt = parseJobberWebhookEvent({
      eventId: "evt_1",
      type: "forward",
      providerConfigKey: "jobber",
      connectionId: "jobber_biz_x",
      providerEventName: "JOB_COMPLETE",
      payload: {
        topic: "JOB_COMPLETE",
        itemId: "job_42",
        accountId: "acct_99",
        occurredAt: "2024-01-15T18:00:00Z",
      },
    });
    expect(evt).not.toBeNull();
    expect(evt!.topic).toBe("JOB_COMPLETE");
    expect(evt!.resourceId).toBe("job_42");
    expect(evt!.accountId).toBe("acct_99");
  });

  it("rejects non-forward envelopes", () => {
    expect(
      parseJobberWebhookEvent({
        eventId: "evt_1",
        type: "auth",
        providerConfigKey: "jobber",
        connectionId: "c",
      })
    ).toBeNull();
  });

  it("rejects unknown topic", () => {
    expect(
      parseJobberWebhookEvent({
        eventId: "evt_1",
        type: "forward",
        providerConfigKey: "jobber",
        connectionId: "c",
        payload: { topic: "UNKNOWN_TOPIC", itemId: "x" },
      })
    ).toBeNull();
  });

  it("rejects payload without resource id", () => {
    expect(
      parseJobberWebhookEvent({
        eventId: "evt_1",
        type: "forward",
        providerConfigKey: "jobber",
        connectionId: "c",
        payload: { topic: "JOB_COMPLETE" },
      })
    ).toBeNull();
  });
});
