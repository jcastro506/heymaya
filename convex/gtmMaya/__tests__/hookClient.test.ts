import { describe, expect, it, vi } from "vitest";
import {
  runMainSessionChat,
  type HookEndpoint,
} from "../openclaw/hookClient";

// PR 1 (ARCHITECTURE_OPENCLAW_NATIVE §2) — founder DMs run in the durable
// `agent:main:main` session via the gateway's OpenAI-compatible endpoint.
// These tests lock the contract: URL/headers/session routing, reply
// extraction, and the timeout semantics that forbid retry (a retried request
// would re-inject the founder's text into the session as a duplicate).

const ENDPOINT: HookEndpoint = {
  baseUrl: "https://clawlaunch-test.fly.dev/hooks",
  token: "tok_test",
};

function okResponse(content: string): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }] }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

describe("runMainSessionChat", () => {
  it("POSTs to the gateway root /v1/chat/completions with durable-session headers", async () => {
    const fetchImpl = vi.fn(async () => okResponse("hey — on it."));
    const res = await runMainSessionChat(
      ENDPOINT,
      { text: "post the first two" },
      fetchImpl as unknown as typeof fetch
    );
    expect(res.ok).toBe(true);
    expect(res.text).toBe("hey — on it.");

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    // /hooks is stripped — the OpenAI surface lives at the gateway root.
    expect(url).toBe("https://clawlaunch-test.fly.dev/v1/chat/completions");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok_test");
    expect(headers["x-openclaw-session-key"]).toBe("agent:main:main");
    expect(headers["x-openclaw-message-channel"]).toBe("telegram");
    const body = JSON.parse(init.body as string) as {
      model: string;
      stream: boolean;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe("openclaw/main");
    expect(body.stream).toBe(false);
    expect(body.messages).toEqual([
      { role: "user", content: "post the first two" },
    ]);
  });

  it("surfaces non-2xx as ok:false with status (no throw)", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("unauthorized", { status: 401 })
    );
    const res = await runMainSessionChat(
      ENDPOINT,
      { text: "hello" },
      fetchImpl as unknown as typeof fetch
    );
    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
    expect(res.timedOut).toBeUndefined();
  });

  it("flags aborts as timedOut so the caller never retries a maybe-running turn", async () => {
    const abortErr = new Error("This operation was aborted");
    abortErr.name = "AbortError";
    const fetchImpl = vi.fn(async () => {
      throw abortErr;
    });
    const res = await runMainSessionChat(
      ENDPOINT,
      { text: "hello", timeoutMs: 50 },
      fetchImpl as unknown as typeof fetch
    );
    expect(res.ok).toBe(false);
    expect(res.status).toBe(0);
    expect(res.timedOut).toBe(true);
  });

  it("treats connection failures as retryable (status 0, not timedOut)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const res = await runMainSessionChat(
      ENDPOINT,
      { text: "hello" },
      fetchImpl as unknown as typeof fetch
    );
    expect(res.ok).toBe(false);
    expect(res.status).toBe(0);
    expect(res.timedOut).toBe(false);
  });
});
