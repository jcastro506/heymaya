/**
 * universalRunner — unit tests.
 *
 * Coverage:
 *  - happy path: action invoked, envelope unwrapped, schema validated
 *  - rejects non-SCREAMING_SNAKE action slugs
 *  - throws ComposioError when envelope.successful = false
 *  - throws when response data fails the per-action Zod schema
 *  - tolerates the success/successful + data/result envelope variants
 */

import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { ComposioClient, ComposioError } from "../client";
import { runAction } from "../universalRunner";

const TEST_KEY = "test-key";
const TEST_BASE = "https://api.example-composio.test";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

const SimpleResponseSchema = z.object({
  id: z.string(),
  count: z.number(),
});

describe("runAction", () => {
  it("happy path — invokes the right path and returns parsed data", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        successful: true,
        data: { id: "msg_1", count: 3 },
      })
    );
    const client = new ComposioClient({
      apiKey: TEST_KEY,
      baseUrl: TEST_BASE,
      fetchImpl,
      sleep: async () => {},
    });
    const result = await runAction({
      provider: "gmail",
      action: "GMAIL_SEND_EMAIL",
      params: { to: "x@y.com" },
      connectedAccountId: "acc_1",
      responseSchema: SimpleResponseSchema,
      client,
    });
    expect(result.successful).toBe(true);
    expect(result.data).toEqual({ id: "msg_1", count: 3 });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain("/api/v3/actions/GMAIL_SEND_EMAIL/execute");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.connectedAccountId).toBe("acc_1");
    expect(body.input.to).toBe("x@y.com");
  });

  it("ADVERSARIAL — rejects non-SCREAMING_SNAKE action slugs", async () => {
    const client = new ComposioClient({
      apiKey: TEST_KEY,
      baseUrl: TEST_BASE,
      fetchImpl: vi.fn(),
      sleep: async () => {},
    });
    await expect(
      runAction({
        provider: "gmail",
        action: "gmail.send.email", // wrong case + dots
        params: {},
        responseSchema: SimpleResponseSchema,
        client,
      })
    ).rejects.toBeInstanceOf(ComposioError);
  });

  it("throws ComposioError when envelope.successful = false", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        successful: false,
        error: "missing scope",
      })
    );
    const client = new ComposioClient({
      apiKey: TEST_KEY,
      baseUrl: TEST_BASE,
      fetchImpl,
      sleep: async () => {},
    });
    await expect(
      runAction({
        provider: "gmail",
        action: "GMAIL_SEND_EMAIL",
        params: {},
        responseSchema: SimpleResponseSchema,
        client,
      })
    ).rejects.toThrow(/missing scope/);
  });

  it("throws ComposioError when response data fails per-action schema", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        successful: true,
        data: { id: "msg_1" /* missing 'count' */ },
      })
    );
    const client = new ComposioClient({
      apiKey: TEST_KEY,
      baseUrl: TEST_BASE,
      fetchImpl,
      sleep: async () => {},
    });
    await expect(
      runAction({
        provider: "gmail",
        action: "GMAIL_SEND_EMAIL",
        params: {},
        responseSchema: SimpleResponseSchema,
        client,
      })
    ).rejects.toThrow(/did not match schema/);
  });

  it("tolerates success/result envelope variants (instead of successful/data)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        result: { id: "x", count: 1 },
      })
    );
    const client = new ComposioClient({
      apiKey: TEST_KEY,
      baseUrl: TEST_BASE,
      fetchImpl,
      sleep: async () => {},
    });
    const result = await runAction({
      provider: "gmail",
      action: "GMAIL_SEND_EMAIL",
      params: {},
      responseSchema: SimpleResponseSchema,
      client,
    });
    expect(result.data).toEqual({ id: "x", count: 1 });
  });
});
