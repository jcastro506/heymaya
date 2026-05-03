/**
 * Gmail action wrappers — schema validation tests.
 *
 * Coverage:
 *  - sendEmail params schema rejects malformed inputs (bad email, empty subject)
 *  - getThread response normalizer (header parsing helpers)
 *  - applyLabel rejects empty label sets
 *  - happy path — sendEmail invokes runAction with the right slug + params
 */

import { describe, it, expect, vi } from "vitest";
import { ComposioClient } from "../client";
import {
  sendEmail,
  SendEmailParamsSchema,
  applyLabel,
  parseFromHeader,
  headerValue,
} from "../actions/gmail";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

const TEST_KEY = "test-key";
const TEST_BASE = "https://api.example-composio.test";

describe("Gmail action wrappers", () => {
  it("SendEmailParamsSchema rejects malformed email + empty subject", () => {
    expect(() =>
      SendEmailParamsSchema.parse({
        to: "not-an-email",
        subject: "x",
        body: "y",
      })
    ).toThrow();
    expect(() =>
      SendEmailParamsSchema.parse({
        to: "good@example.com",
        subject: "",
        body: "y",
      })
    ).toThrow();
  });

  it("sendEmail invokes GMAIL_SEND_EMAIL with the right body shape", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        successful: true,
        data: { id: "m1", threadId: "t1" },
      })
    );
    const client = new ComposioClient({
      apiKey: TEST_KEY,
      baseUrl: TEST_BASE,
      fetchImpl,
      sleep: async () => {},
    });
    const out = await sendEmail(
      { connectedAccountId: "acc_1", client },
      {
        to: "brand@partnerships.com",
        subject: "Re: Partnership opportunity",
        body: "Hi! Let me think and get back.",
        threadId: "thread_x",
      }
    );
    expect(out.id).toBe("m1");
    expect(out.threadId).toBe("t1");
    const url = fetchImpl.mock.calls[0][0] as string;
    expect(url).toContain("/api/v3/actions/GMAIL_SEND_EMAIL/execute");
    const body = JSON.parse(
      (fetchImpl.mock.calls[0][1] as RequestInit).body as string
    );
    expect(body.connectedAccountId).toBe("acc_1");
    expect(body.input.to).toBe("brand@partnerships.com");
    expect(body.input.threadId).toBe("thread_x");
  });

  it("applyLabel ADVERSARIAL — rejects empty label sets", async () => {
    const client = new ComposioClient({
      apiKey: TEST_KEY,
      baseUrl: TEST_BASE,
      fetchImpl: vi.fn(),
      sleep: async () => {},
    });
    await expect(
      applyLabel(
        { connectedAccountId: "acc_1", client },
        { threadId: "t1" }
      )
    ).rejects.toThrow(/at least one of/);
  });

  it("parseFromHeader handles 'Display Name <user@example.com>'", () => {
    expect(parseFromHeader("Brand Name <partnerships@brand.com>")).toEqual({
      email: "partnerships@brand.com",
      name: "Brand Name",
      domain: "brand.com",
    });
  });

  it("parseFromHeader handles bare 'user@example.com'", () => {
    expect(parseFromHeader("user@brand.com")).toEqual({
      email: "user@brand.com",
      name: null,
      domain: "brand.com",
    });
  });

  it("headerValue is case-insensitive", () => {
    const msg = {
      headers: [
        { name: "From", value: "x@y.com" },
        { name: "Subject", value: "hi" },
      ],
    };
    expect(headerValue(msg, "from")).toBe("x@y.com");
    expect(headerValue(msg, "SUBJECT")).toBe("hi");
    expect(headerValue(msg, "missing")).toBeNull();
  });
});
