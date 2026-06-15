/**
 * CreatifyClient + endpoints — unit tests
 *
 * Coverage:
 *  - dual-header auth (X-API-ID + X-API-KEY) injection on every call
 *  - retry on 5xx with exponential backoff (3 attempts max)
 *  - 4xx fails immediately (no retry)
 *  - 429 retries respecting retry-after, then converts to CreatifyRateLimitError
 *  - timeout via AbortController converts to CreatifyTimeoutError
 *  - PUT body + GET poll paths
 *  - endpoint wrappers build the right path/body and surface ids
 *  - status helpers classify the lifecycle correctly
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  CreatifyClient,
  CreatifyHttpError,
  CreatifyRateLimitError,
  CreatifyTimeoutError,
} from "../client";
import {
  createAdClone,
  createLinkFromUrl,
  generateAiScript,
  getVideoJob,
  updateLink,
} from "../endpoints";
import { isDoneStatus, isFailedStatus, isTerminalStatus } from "../types";

const TEST_ID = "id-abc";
const TEST_KEY = "key-xyz";
const TEST_BASE = "https://api.example-creatify.test";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function makeClient(fetchImpl: typeof fetch, extra: Record<string, unknown> = {}): CreatifyClient {
  return new CreatifyClient({
    apiId: TEST_ID,
    apiKey: TEST_KEY,
    baseUrl: TEST_BASE,
    sleep: async () => {},
    random: () => 0.5,
    fetchImpl,
    ...extra,
  });
}

describe("CreatifyClient", () => {
  beforeEach(() => vi.clearAllMocks());

  it("injects X-API-ID + X-API-KEY on every call and returns parsed JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    const out = await client.request<{ ok: boolean }>("/api/links/", { method: "POST", body: { url: "u" } });
    expect(out).toEqual({ ok: true });
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers["X-API-ID"]).toBe(TEST_ID);
    expect(init.headers["X-API-KEY"]).toBe(TEST_KEY);
    expect(init.headers["content-type"]).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ url: "u" }));
  });

  it("throws if credentials are missing", () => {
    expect(() => new CreatifyClient({ apiId: "", apiKey: "" })).toThrow(/CREATIFY_API_ID/);
  });

  it("retries 5xx up to maxAttempts then throws CreatifyHttpError", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      .mockResolvedValueOnce(new Response("boom", { status: 502 }))
      .mockResolvedValueOnce(new Response("boom", { status: 503 }));
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    await expect(client.request("/x")).rejects.toBeInstanceOf(CreatifyHttpError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry 4xx", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 400 }));
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    await expect(client.request("/x")).rejects.toBeInstanceOf(CreatifyHttpError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("converts exhausted 429 to CreatifyRateLimitError", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("slow", { status: 429, headers: { "retry-after": "0" } }));
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    await expect(client.request("/x")).rejects.toBeInstanceOf(CreatifyRateLimitError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("converts an aborted request to CreatifyTimeoutError", async () => {
    const fetchImpl = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = init.signal as AbortSignal;
        signal.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
      });
    });
    const client = makeClient(fetchImpl as unknown as typeof fetch, { timeoutMs: 5, maxAttempts: 1 });
    await expect(client.request("/x")).rejects.toBeInstanceOf(CreatifyTimeoutError);
  });
});

describe("Creatify endpoints", () => {
  beforeEach(() => vi.clearAllMocks());

  it("createLinkFromUrl POSTs to /api/links/ and returns the link", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "link-1", url: "https://x" }));
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    const link = await createLinkFromUrl("https://x", client);
    expect(link.id).toBe("link-1");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${TEST_BASE}/api/links/`);
    expect(init.method).toBe("POST");
  });

  it("updateLink PUTs metadata + images to /api/links/{id}/", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "link-1" }));
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    await updateLink("link-1", { title: "Tidy", image_urls: ["https://img"] }, client);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${TEST_BASE}/api/links/link-1/`);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ title: "Tidy", image_urls: ["https://img"] });
  });

  it("createAdClone defaults aspect_ratio to 9x16 and omits unset fields", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "job-1", status: "in_queue" }));
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    const job = await createAdClone({ link: "link-1", video_url: "https://winner" }, client);
    expect(job.id).toBe("job-1");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${TEST_BASE}/api/ads_clone/`);
    expect(JSON.parse(init.body)).toEqual({
      link: "link-1",
      video_url: "https://winner",
      aspect_ratio: "9x16",
    });
  });

  it("getVideoJob routes ad_clone to GET /api/ads_clone/{id}/", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ id: "job-1", status: "done", video_output: "https://v.mp4" }));
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    const job = await getVideoJob("ad_clone", "job-1", client);
    expect(job.video_output).toBe("https://v.mp4");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${TEST_BASE}/api/ads_clone/job-1/`);
    expect(init.method).toBe("GET");
  });

  it("getVideoJob routes url_to_video and aurora to their endpoints", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse({ id: "j", status: "running" }));
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    await getVideoJob("url_to_video", "j", client);
    await getVideoJob("aurora", "j", client);
    expect(fetchImpl.mock.calls[0][0]).toBe(`${TEST_BASE}/api/link_to_videos/j/`);
    expect(fetchImpl.mock.calls[1][0]).toBe(`${TEST_BASE}/api/aurora/j/`);
  });

  it("generateAiScript POSTs url to /api/ai_scripts/", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "s-1", script: "hook..." }));
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    const s = await generateAiScript({ url: "https://x" }, client);
    expect(s.script).toContain("hook");
    expect(fetchImpl.mock.calls[0][0]).toBe(`${TEST_BASE}/api/ai_scripts/`);
  });

  it("surfaces a clear error when create response has no id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ detail: "bad" }));
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    await expect(createAdClone({ link: "l", video_url: "v" }, client)).rejects.toThrow(/missing id/);
  });
});

describe("status helpers", () => {
  it("classifies done / failed / in-flight", () => {
    expect(isDoneStatus("done")).toBe(true);
    expect(isDoneStatus("COMPLETED")).toBe(true);
    expect(isDoneStatus("running")).toBe(false);
    expect(isFailedStatus("failed")).toBe(true);
    expect(isFailedStatus("error")).toBe(true);
    expect(isFailedStatus("done")).toBe(false);
    expect(isTerminalStatus("in_queue")).toBe(false);
    expect(isTerminalStatus("done")).toBe(true);
    expect(isTerminalStatus("failed")).toBe(true);
    expect(isTerminalStatus(null)).toBe(false);
  });
});
