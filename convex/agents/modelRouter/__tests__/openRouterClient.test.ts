import { describe, it, expect, vi } from "vitest";
import {
  callOpenRouter,
  OpenRouterError,
} from "../openRouterClient";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const SAMPLE_BODY = {
  id: "gen-1",
  model: "google/gemini-3-flash",
  choices: [
    {
      message: { content: "hello back" },
      finish_reason: "stop",
    },
  ],
  usage: {
    prompt_tokens: 100,
    completion_tokens: 250,
    completion_tokens_details: { reasoning_tokens: 150 },
  },
};

describe("openRouterClient / callOpenRouter", () => {
  it("sends required headers + reasoning param shape for `medium`", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(SAMPLE_BODY));
    await callOpenRouter({
      model: "google/gemini-3-flash",
      messages: [{ role: "user", content: "hi" }],
      thinkingBudget: "medium",
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer test-key");
    expect(headers["HTTP-Referer"]).toBe("https://heymaya.app");
    expect(headers["X-Title"]).toBe("HeyMaya");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("google/gemini-3-flash");
    expect(body.reasoning).toEqual({ effort: "medium" });
    expect(body.stream).toBe(false);
  });

  it("encodes `none` budget as { enabled: false }", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(SAMPLE_BODY));
    await callOpenRouter({
      model: "google/gemini-3-flash",
      messages: [{ role: "user", content: "hi" }],
      thinkingBudget: "none",
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const body = JSON.parse(
      (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string
    );
    expect(body.reasoning).toEqual({ enabled: false });
  });

  it("parses usage including reasoning tokens; subtracts from completion", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(SAMPLE_BODY));
    const result = await callOpenRouter({
      model: "google/gemini-3-flash",
      messages: [{ role: "user", content: "hi" }],
      thinkingBudget: "low",
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.usage.inputTokens).toBe(100);
    expect(result.usage.thinkingTokens).toBe(150);
    // completion_tokens (250) - reasoning_tokens (150) = visible output 100
    expect(result.usage.outputTokens).toBe(100);
    expect(result.content).toBe("hello back");
    expect(result.finishReason).toBe("stop");
  });

  it("retries on 5xx (3 attempts total) then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "boom" }, 503))
      .mockResolvedValueOnce(jsonResponse({ error: "still" }, 502))
      .mockResolvedValueOnce(jsonResponse(SAMPLE_BODY, 200));
    const result = await callOpenRouter({
      model: "m",
      messages: [{ role: "user", content: "x" }],
      thinkingBudget: "low",
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      retryDelayMs: () => 0,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(result.content).toBe("hello back");
  });

  it("does NOT retry on 4xx", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: "bad request" }, 400)
    );
    await expect(
      callOpenRouter({
        model: "m",
        messages: [{ role: "user", content: "x" }],
        thinkingBudget: "low",
        apiKey: "k",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        retryDelayMs: () => 0,
      })
    ).rejects.toBeInstanceOf(OpenRouterError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws OpenRouterError after exhausting retries on persistent 5xx", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: "down" }, 500)
    );
    const promise = callOpenRouter({
      model: "m",
      messages: [{ role: "user", content: "x" }],
      thinkingBudget: "low",
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      retryDelayMs: () => 0,
    });
    await expect(promise).rejects.toBeInstanceOf(OpenRouterError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("retries on network errors (fetch throws)", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(jsonResponse(SAMPLE_BODY));
    const result = await callOpenRouter({
      model: "m",
      messages: [{ role: "user", content: "x" }],
      thinkingBudget: "low",
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      retryDelayMs: () => 0,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.content).toBe("hello back");
  });
});
