/**
 * Server-side PostHog capture — Wave 3 safety.
 *
 * The capture helpers are best-effort + fail-open: telemetry must never break
 * a deploy or webhook. These assert:
 *   - no key set → no network call, no throw (analytics disabled).
 *   - a network failure is swallowed, not propagated.
 *   - key set → posts to the capture endpoint with the right shape.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { capturePosthogEvent, captureAiGeneration } from "../posthog";

const origKey = process.env.POSTHOG_KEY;

afterEach(() => {
  if (origKey === undefined) delete process.env.POSTHOG_KEY;
  else process.env.POSTHOG_KEY = origKey;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("capturePosthogEvent", () => {
  it("is a no-op (no fetch) when POSTHOG_KEY is unset", async () => {
    delete process.env.POSTHOG_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await capturePosthogEvent({ distinctId: "u1", event: "x" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("swallows a network failure instead of throwing", async () => {
    process.env.POSTHOG_KEY = "phc_test";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down"))
    );
    await expect(
      capturePosthogEvent({ distinctId: "u1", event: "x" })
    ).resolves.toBeUndefined();
  });

  it("posts to the capture endpoint with api_key + event when key is set", async () => {
    process.env.POSTHOG_KEY = "phc_test";
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchSpy);
    await capturePosthogEvent({
      distinctId: "user-1",
      event: "agent_deployed",
      properties: { account_id: "acc-1" },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0];
    const payload = JSON.parse((init as { body: string }).body);
    expect(payload.api_key).toBe("phc_test");
    expect(payload.event).toBe("agent_deployed");
    expect(payload.distinct_id).toBe("user-1");
    expect(payload.properties.account_id).toBe("acc-1");
  });

  it("captureAiGeneration maps telemetry onto $ai_* properties", async () => {
    process.env.POSTHOG_KEY = "phc_test";
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchSpy);
    await captureAiGeneration({
      distinctId: "user-1",
      turnId: "turn-1",
      model: "google/gemini-3-flash-preview",
      tokensIn: 100,
      tokensOut: 50,
      latencyMs: 2000,
      costUsd: 0.001,
    });
    const [, init] = fetchSpy.mock.calls[0];
    const payload = JSON.parse((init as { body: string }).body);
    expect(payload.event).toBe("$ai_generation");
    expect(payload.properties.$ai_trace_id).toBe("turn-1");
    expect(payload.properties.$ai_input_tokens).toBe(100);
    expect(payload.properties.$ai_latency).toBe(2); // ms → seconds
  });
});
