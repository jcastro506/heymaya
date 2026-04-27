/**
 * videoSynthWorker — Convex-side HTTP client unit tests.
 *
 * Covers:
 *  - Auth header set correctly (Bearer + WORKER_SHARED_SECRET)
 *  - Request body shape forwarded verbatim
 *  - Success path returns parsed worker response
 *  - 401 from worker → VideoSynthWorkerError stage="auth", retryable=false
 *  - 5xx from worker → retryable=true
 *  - Network/timeout error → retryable=true
 *  - Malformed (non-JSON) response → bad-response
 *  - Worker ok:false → worker-error
 *  - Test seam (`_setVideoSynthClientForTests`) is honored
 *  - Feature flag helper `isVideoSynthWorkerEnabled()` recognizes truthy
 *    values, defaults to false
 *  - Missing env vars fail-closed with config error
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  synthesizeViaWorker,
  _setVideoSynthClientForTests,
  isVideoSynthWorkerEnabled,
  VideoSynthWorkerError,
  type SynthesizeWorkerRequest,
  type SynthesizeWorkerResponse,
} from "../client";

const WORKER_URL = "https://heymaya-video-synth.example.fly.dev";
const SECRET = "test-shared-secret-32bytes-hex-ok";

beforeEach(() => {
  process.env.VIDEO_SYNTH_WORKER_URL = WORKER_URL;
  process.env.WORKER_SHARED_SECRET = SECRET;
  delete process.env.USE_VIDEO_SYNTH_WORKER;
});

afterEach(() => {
  _setVideoSynthClientForTests(null);
  vi.unstubAllGlobals();
});

function fakeWorkerResponseBody(): SynthesizeWorkerResponse & { ok: true } {
  return {
    ok: true as const,
    content: '{"niche":"home gym builds"}',
    model: "gemini-3-flash",
    usage: { inputTokens: 10_000, outputTokens: 800, thinkingTokens: 4_000 },
    diagnostics: {
      videosRequested: 5,
      videosDownloaded: 5,
      videosUploaded: 5,
      skippedVideos: [],
      totalElapsedMs: 12_000,
      downloadElapsedMs: 4_500,
      uploadElapsedMs: 1_200,
      geminiElapsedMs: 6_000,
    },
  };
}

function makeRequest(): SynthesizeWorkerRequest {
  return {
    creatorId: "creator_123",
    systemPrompt: "x".repeat(60),
    userPayloadJson: '{"creator":{"plan":"pro"}}',
    posts: [
      {
        postId: "tt_post_0",
        platform: "tiktok",
        videoUrl: "https://www.tiktok.com/@u/video/0",
        kind: "video",
      },
      {
        postId: "tt_post_1",
        platform: "tiktok",
        videoUrl: "https://www.tiktok.com/@u/video/1",
        kind: "text-context",
      },
    ],
    thinkingBudget: "high",
  };
}

/* -------------------------------------------------------------------------- */
/* Happy path                                                                  */
/* -------------------------------------------------------------------------- */

type FetchCall = [input: RequestInfo | URL, init?: RequestInit];
function fetchCallAt(
  spy: ReturnType<typeof vi.fn>,
  i: number
): FetchCall {
  return spy.mock.calls[i] as unknown as FetchCall;
}

describe("synthesizeViaWorker — happy path", () => {
  it("POSTs to {WORKER_URL}/synthesize with bearer + JSON body", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify(fakeWorkerResponseBody()), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    const out = await synthesizeViaWorker(makeRequest(), {
      fetchImpl: fetchSpy,
    });
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchCallAt(fetchSpy, 0);
    expect(url).toBe(`${WORKER_URL}/synthesize`);
    expect(init).toBeDefined();
    const initObj = init as RequestInit;
    expect(initObj.method).toBe("POST");
    const headers = initObj.headers as Record<string, string>;
    expect(headers["authorization"]).toBe(`Bearer ${SECRET}`);
    expect(headers["content-type"]).toBe("application/json");
    expect(out.content).toMatch(/home gym/);
    expect(out.model).toBe("gemini-3-flash");
  });

  it("forwards the request body verbatim (creatorId + posts + prompt)", async () => {
    const fetchSpy = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string);
      expect(body.creatorId).toBe("creator_123");
      expect(body.posts).toHaveLength(2);
      expect(body.thinkingBudget).toBe("high");
      expect(body.systemPrompt.length).toBeGreaterThanOrEqual(60);
      return new Response(JSON.stringify(fakeWorkerResponseBody()), {
        status: 200,
      });
    });
    await synthesizeViaWorker(makeRequest(), { fetchImpl: fetchSpy });
  });

  it("strips trailing slash from worker URL before appending /synthesize", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify(fakeWorkerResponseBody()), { status: 200 })
    );
    await synthesizeViaWorker(makeRequest(), {
      fetchImpl: fetchSpy,
      workerUrl: `${WORKER_URL}/`,
    });
    const [url] = fetchCallAt(fetchSpy, 0);
    expect(url).toBe(`${WORKER_URL}/synthesize`);
  });

  it("forwards the optional retryReminder when present", async () => {
    const fetchSpy = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string);
      expect(body.retryReminder).toBe("Try again, JSON only.");
      return new Response(JSON.stringify(fakeWorkerResponseBody()), {
        status: 200,
      });
    });
    await synthesizeViaWorker(
      { ...makeRequest(), retryReminder: "Try again, JSON only." },
      { fetchImpl: fetchSpy }
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Error paths                                                                 */
/* -------------------------------------------------------------------------- */

describe("synthesizeViaWorker — error paths", () => {
  it("401 → VideoSynthWorkerError stage='auth', retryable=false", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, error: { code: "invalid-bearer" } }), {
        status: 401,
      })
    );
    await expect(() =>
      synthesizeViaWorker(makeRequest(), { fetchImpl: fetchSpy })
    ).rejects.toMatchObject({
      name: "VideoSynthWorkerError",
      stage: "auth",
      retryable: false,
      status: 401,
    });
  });

  it("502 worker-error → retryable=true", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: false,
          error: { code: "gemini-failure", detail: "upstream 503" },
        }),
        { status: 502 }
      )
    );
    await expect(() =>
      synthesizeViaWorker(makeRequest(), { fetchImpl: fetchSpy })
    ).rejects.toMatchObject({
      name: "VideoSynthWorkerError",
      stage: "worker-error",
      retryable: true,
      status: 502,
    });
  });

  it("503 → retryable=true", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({ ok: false, error: { code: "gemini-init" } }),
        { status: 503 }
      )
    );
    await expect(() =>
      synthesizeViaWorker(makeRequest(), { fetchImpl: fetchSpy })
    ).rejects.toMatchObject({
      stage: "worker-error",
      retryable: true,
    });
  });

  it("network error → retryable=true, stage='network'", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    await expect(() =>
      synthesizeViaWorker(makeRequest(), { fetchImpl: fetchSpy })
    ).rejects.toMatchObject({
      stage: "network",
      retryable: true,
    });
  });

  it("non-JSON body → bad-response", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response("not-json-at-all", { status: 200 })
    );
    await expect(() =>
      synthesizeViaWorker(makeRequest(), { fetchImpl: fetchSpy })
    ).rejects.toMatchObject({
      stage: "bad-response",
    });
  });

  it("200 but missing required fields → worker-error", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({ ok: true, content: "{}" }), // no model / usage / diagnostics
        { status: 200 }
      )
    );
    await expect(() =>
      synthesizeViaWorker(makeRequest(), { fetchImpl: fetchSpy })
    ).rejects.toMatchObject({
      stage: "worker-error",
    });
  });

  it("worker ok:false at 200 status → worker-error with detail", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: false,
          error: { code: "internal", detail: "all videos failed" },
        }),
        { status: 200 }
      )
    );
    await expect(() =>
      synthesizeViaWorker(makeRequest(), { fetchImpl: fetchSpy })
    ).rejects.toMatchObject({
      stage: "worker-error",
      message: expect.stringContaining("all videos failed"),
    });
  });

  it("missing VIDEO_SYNTH_WORKER_URL → config error, not retryable", async () => {
    delete process.env.VIDEO_SYNTH_WORKER_URL;
    await expect(() =>
      synthesizeViaWorker(makeRequest(), { fetchImpl: vi.fn() })
    ).rejects.toMatchObject({
      stage: "config",
      retryable: false,
    });
  });

  it("missing WORKER_SHARED_SECRET → config error, not retryable", async () => {
    delete process.env.WORKER_SHARED_SECRET;
    await expect(() =>
      synthesizeViaWorker(makeRequest(), { fetchImpl: vi.fn() })
    ).rejects.toMatchObject({
      stage: "config",
      retryable: false,
    });
  });

  it("VideoSynthWorkerError carries cause for diagnostics", () => {
    const cause = new Error("original");
    const e = new VideoSynthWorkerError(
      "wrapped",
      "network",
      true,
      undefined,
      cause
    );
    expect(e.cause).toBe(cause);
    expect(e.name).toBe("VideoSynthWorkerError");
  });
});

/* -------------------------------------------------------------------------- */
/* Test seam                                                                   */
/* -------------------------------------------------------------------------- */

describe("_setVideoSynthClientForTests", () => {
  it("injected impl bypasses the real fetch entirely", async () => {
    const realFetch = vi.fn(async () => new Response("never-called"));
    const injected = vi.fn(async () => fakeWorkerResponseBody());
    _setVideoSynthClientForTests(injected);
    const out = await synthesizeViaWorker(makeRequest(), {
      fetchImpl: realFetch,
    });
    expect(injected).toHaveBeenCalledOnce();
    expect(realFetch).not.toHaveBeenCalled();
    expect(out.content).toMatch(/home gym/);
  });

  it("null resets to the real impl", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify(fakeWorkerResponseBody()), { status: 200 })
    );
    _setVideoSynthClientForTests(async () => fakeWorkerResponseBody());
    _setVideoSynthClientForTests(null);
    await synthesizeViaWorker(makeRequest(), { fetchImpl: fetchSpy });
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});

/* -------------------------------------------------------------------------- */
/* Feature flag                                                                */
/* -------------------------------------------------------------------------- */

describe("isVideoSynthWorkerEnabled", () => {
  it("returns false when env var is unset (default fallback to OpenRouter)", () => {
    delete process.env.USE_VIDEO_SYNTH_WORKER;
    expect(isVideoSynthWorkerEnabled()).toBe(false);
  });

  it("returns true for 'true' / 'TRUE' / 'True'", () => {
    process.env.USE_VIDEO_SYNTH_WORKER = "true";
    expect(isVideoSynthWorkerEnabled()).toBe(true);
    process.env.USE_VIDEO_SYNTH_WORKER = "TRUE";
    expect(isVideoSynthWorkerEnabled()).toBe(true);
    process.env.USE_VIDEO_SYNTH_WORKER = "True";
    expect(isVideoSynthWorkerEnabled()).toBe(true);
  });

  it("returns true for '1' and 'yes'", () => {
    process.env.USE_VIDEO_SYNTH_WORKER = "1";
    expect(isVideoSynthWorkerEnabled()).toBe(true);
    process.env.USE_VIDEO_SYNTH_WORKER = "yes";
    expect(isVideoSynthWorkerEnabled()).toBe(true);
  });

  it("returns false for 'false' / '0' / 'off' / 'no' / random strings", () => {
    for (const v of ["false", "0", "off", "no", "maybe", " ", ""]) {
      process.env.USE_VIDEO_SYNTH_WORKER = v;
      expect(isVideoSynthWorkerEnabled()).toBe(false);
    }
  });
});
